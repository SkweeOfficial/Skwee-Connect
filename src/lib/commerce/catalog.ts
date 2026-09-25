import { PRODUCT_MESSAGE_LIMITS } from '@/lib/whatsapp/meta-api'
import type {
  CatalogProduct,
  OrderPayload,
  ProductCardItem,
  ProductGroup,
  ProductMessagePayload,
} from './types'

// ============================================================
// Pure catalog helpers: grouping, ranking for the AI prompt, and
// building the product-card payload. No I/O — see ./recommend.ts and
// ./sync.ts for the database / Graph API sides.
// ============================================================

/** Header on multi-product cards (Meta requires one on product lists). */
export const PRODUCT_LIST_HEADER = 'Recommended for you'

/** Body used when the model picked products but wrote no text. */
export const PRODUCT_LIST_FALLBACK_BODY = 'Tap to view and add to your cart.'

/** Meta's availability values that can still be ordered. */
const ORDERABLE = new Set(['in stock', 'available for order', 'preorder'])

/** Treat a missing availability as orderable — Meta defaults it to in stock. */
export function isOrderable(availability: string | null | undefined): boolean {
  if (!availability) return true
  return ORDERABLE.has(availability.trim().toLowerCase())
}

/**
 * Parse Meta's display price ("₹1,290.00", "1290.00 INR") into a number
 * in major units. Null when there's no number in it.
 */
export function parseMetaPrice(price: string | null | undefined): number | null {
  if (!price) return null
  const match = price.replace(/,/g, '').match(/\d+(?:\.\d+)?/)
  if (!match) return null
  const n = Number(match[0])
  return Number.isFinite(n) ? n : null
}

/**
 * Group orderable catalog items into products by `item_group_id`,
 * keeping catalog order. Out-of-stock variants are dropped; a product
 * with no orderable variant disappears entirely.
 */
export function groupCatalogProducts(rows: CatalogProduct[]): ProductGroup[] {
  const groups = new Map<string, ProductGroup>()
  for (const row of rows) {
    if (!isOrderable(row.availability)) continue
    const id = row.item_group_id || row.retailer_id
    let g = groups.get(id)
    if (!g) {
      g = {
        id,
        name: row.name,
        description: row.description,
        priceText: row.price_text,
        sizes: [],
        colors: [],
        items: [],
      }
      groups.set(id, g)
    }
    g.items.push(row)
    if (row.size && !g.sizes.includes(row.size)) g.sizes.push(row.size)
    if (row.color && !g.colors.includes(row.color)) g.colors.push(row.color)
    // Show the cheapest variant's price ("from ₹…" is implied by sizes).
    const current = parseMetaPrice(g.priceText)
    if (row.price_amount != null && (current == null || row.price_amount < current)) {
      g.priceText = row.price_text
    }
  }
  return [...groups.values()]
}

const STOPWORDS = new Set([
  'a', 'an', 'and', 'any', 'are', 'can', 'do', 'does', 'for', 'have', 'hi',
  'hello', 'i', 'im', 'in', 'is', 'it', 'me', 'my', 'need', 'of', 'on',
  'or', 'please', 'recommend', 'show', 'some', 'something', 'the', 'there',
  'this', 'to', 'want', 'what', 'which', 'with', 'you', 'your', 'looking',
  'get', 'buy', 'suggest', 'good', 'best', 'like', 'would', 'could',
])

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
}

/** Exact word, or a shared stem for words of 4+ letters ("dress" ~ "dresses"). */
function wordMatches(token: string, word: string): boolean {
  if (token === word) return true
  if (token.length < 4 || word.length < 4) return false
  return word.startsWith(token) || token.startsWith(word)
}

function fieldScore(tokens: string[], text: string | null, weight: number): number {
  if (!text) return 0
  const words = tokenize(text)
  let score = 0
  for (const t of tokens) {
    if (words.some((w) => wordMatches(t, w))) score += weight
  }
  return score
}

/**
 * Rank products against what the customer said. Name matches weigh
 * most, then colour / size, then description. Matches come first; the
 * rest of the list is topped up in catalog order so a vague ask ("what
 * do you have?") still gives the model something to recommend.
 */
export function rankProductGroups(
  groups: ProductGroup[],
  query: string,
  limit: number,
): ProductGroup[] {
  const tokens = [...new Set(tokenize(query))]
  const scored = groups.map((g, index) => ({
    g,
    index,
    score:
      tokens.length === 0
        ? 0
        : fieldScore(tokens, g.name, 3) +
          fieldScore(tokens, [...g.colors, ...g.sizes].join(' '), 2) +
          fieldScore(tokens, g.description, 1),
  }))
  scored.sort((a, b) => b.score - a.score || a.index - b.index)
  return scored.slice(0, limit).map((s) => s.g)
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** Compact catalog listing for the system prompt — one line per product. */
export function formatProductsForPrompt(groups: ProductGroup[]): string {
  return groups
    .map((g) => {
      const parts = [`id: ${g.id}`, oneLine(g.name, 80)]
      if (g.priceText) parts.push(`price: ${g.priceText}`)
      if (g.sizes.length) parts.push(`sizes: ${g.sizes.join(', ')}`)
      if (g.colors.length) parts.push(`colours: ${g.colors.join(', ')}`)
      if (g.description) parts.push(oneLine(g.description, 160))
      return `- ${parts.join(' | ')}`
    })
    .join('\n')
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function toCardItem(p: CatalogProduct): ProductCardItem {
  return {
    retailer_id: p.retailer_id,
    name: p.name,
    price_text: p.price_text,
    image_url: p.image_url,
    size: p.size,
  }
}

/**
 * Build the card for the products the model picked. One product with
 * one variant becomes a single-product card; anything more becomes a
 * product list with a section per product (its sizes as the items),
 * trimmed to Meta's 10-section / 30-item caps. Null when nothing is
 * left to send.
 */
export function buildProductMessagePayload(args: {
  catalogId: string
  groups: ProductGroup[]
  bodyText: string
}): ProductMessagePayload | null {
  const { catalogId } = args
  const body = args.bodyText.trim()
  const groups = args.groups
    .filter((g) => g.items.length > 0)
    .slice(0, PRODUCT_MESSAGE_LIMITS.maxSections)
  if (groups.length === 0) return null

  if (groups.length === 1 && groups[0].items.length === 1) {
    const item = groups[0].items[0]
    return {
      kind: 'product',
      catalog_id: catalogId,
      ...(body ? { body: clip(body, PRODUCT_MESSAGE_LIMITS.bodyMaxLength) } : {}),
      sections: [
        {
          title: clip(item.name, PRODUCT_MESSAGE_LIMITS.sectionTitleMaxLength),
          items: [toCardItem(item)],
        },
      ],
    }
  }

  let budget: number = PRODUCT_MESSAGE_LIMITS.maxProductsTotal
  const sections: ProductMessagePayload['sections'] = []
  for (const g of groups) {
    if (budget <= 0) break
    const items = g.items.slice(0, budget).map(toCardItem)
    budget -= items.length
    sections.push({
      title: clip(g.name, PRODUCT_MESSAGE_LIMITS.sectionTitleMaxLength),
      items,
    })
  }

  return {
    kind: 'product_list',
    catalog_id: catalogId,
    header: PRODUCT_LIST_HEADER,
    body: clip(body || PRODUCT_LIST_FALLBACK_BODY, PRODUCT_MESSAGE_LIMITS.bodyMaxLength),
    sections,
  }
}

/**
 * How a sent card appears in the model's transcript, so a follow-up
 * ("the second one in blue?") has something to refer to.
 */
export function productCardsNote(payload: ProductMessagePayload): string {
  return `[Sent product cards: ${payload.sections.map((s) => s.title).join(', ')}]`
}

/** Single-line preview for the conversation list. */
export function productPayloadPreviewText(payload: ProductMessagePayload): string {
  const body = payload.body?.trim()
  if (body) return body
  const first = payload.sections[0]?.items[0]?.name
  return first ? `🛍️ ${first}` : '[products]'
}

/** Format an amount for an order summary, e.g. "INR 3,870". */
function formatMoney(amount: number, currency: string | null): string {
  const n = Number.isInteger(amount)
    ? amount.toLocaleString('en-US')
    : amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency ? `${currency} ${n}` : n
}

/** Total of an order's lines, or null when any line has no price. */
export function orderTotal(order: OrderPayload): number | null {
  let total = 0
  for (const item of order.items) {
    if (item.item_price == null) return null
    total += item.item_price * item.quantity
  }
  return Math.round(total * 100) / 100
}

/** "🛒 Order: 3 items · INR 3,870" — conversation list + content_text. */
export function orderSummaryText(order: OrderPayload): string {
  const count = order.items.reduce((n, i) => n + i.quantity, 0)
  const label = `🛒 Order: ${count} item${count === 1 ? '' : 's'}`
  const total = orderTotal(order)
  if (total == null) return label
  return `${label} · ${formatMoney(total, order.items[0]?.currency ?? null)}`
}
