import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from '@/lib/ai/types'
import { groupCatalogProducts, rankProductGroups } from './catalog'
import type { CatalogProduct, ProductGroup } from './types'

/** How many products the model sees per turn — keeps the prompt small. */
export const PROMPT_PRODUCT_LIMIT = 12

/** Upper bound on cached rows read per turn (a large store's catalog). */
const MAX_CATALOG_ROWS = 2000

/** Most products one reply may recommend (sections on the card). */
export const MAX_RECOMMENDED_PRODUCTS = 5

/** How many recent customer turns feed the product search. */
const QUERY_TURNS = 3

export interface ProductContext {
  catalogId: string
  /** Candidates offered to the model, best match first. */
  groups: ProductGroup[]
}

/**
 * The text to match products against: the last few customer turns, so
 * a follow-up like "in blue?" still carries "party dress" from before.
 */
export function productSearchQuery(messages: ChatMessage[]): string {
  return messages
    .filter((m) => m.role === 'user')
    .slice(-QUERY_TURNS)
    .map((m) => m.content)
    .join(' ')
}

/**
 * Load the products the AI may recommend this turn, or null when the
 * account has no catalog linked / synced (the bot then replies with text
 * only, exactly as before). Best-effort: a read failure also returns null.
 */
export async function loadProductContext(
  db: SupabaseClient,
  accountId: string,
  messages: ChatMessage[],
): Promise<ProductContext | null> {
  try {
    const { data: config } = await db
      .from('whatsapp_config')
      .select('catalog_id')
      .eq('account_id', accountId)
      .maybeSingle()
    const catalogId = (config?.catalog_id as string | null | undefined)?.trim()
    if (!catalogId) return null

    const { data: rows, error } = await db
      .from('catalog_products')
      .select(
        'retailer_id, item_group_id, name, description, price_text, price_amount, currency, availability, image_url, url, size, color',
      )
      .eq('account_id', accountId)
      .order('name', { ascending: true })
      .limit(MAX_CATALOG_ROWS)
    if (error || !rows || rows.length === 0) return null

    const groups = rankProductGroups(
      groupCatalogProducts(rows as CatalogProduct[]),
      productSearchQuery(messages),
      PROMPT_PRODUCT_LIMIT,
    )
    if (groups.length === 0) return null
    return { catalogId, groups }
  } catch (err) {
    console.error('[commerce] loadProductContext failed:', err)
    return null
  }
}

/**
 * Resolve the ids the model named to the candidate products, in the
 * model's order. Ids it made up (or that weren't offered this turn) are
 * dropped — we only ever send products we know are in the catalog.
 */
export function resolvePickedGroups(
  context: ProductContext,
  pickedIds: string[],
): ProductGroup[] {
  const byId = new Map(context.groups.map((g) => [g.id, g]))
  // Accept a variant's retailer id too — map it back to its product.
  for (const g of context.groups) {
    for (const item of g.items) {
      if (!byId.has(item.retailer_id)) byId.set(item.retailer_id, g)
    }
  }
  const out: ProductGroup[] = []
  for (const id of pickedIds) {
    const g = byId.get(id)
    if (g && !out.includes(g)) out.push(g)
    if (out.length >= MAX_RECOMMENDED_PRODUCTS) break
  }
  return out
}
