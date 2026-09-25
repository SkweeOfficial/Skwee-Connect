import type { SupabaseClient } from '@supabase/supabase-js'
import type { OrderItem, OrderPayload } from './types'

/** Meta's `order` object on an inbound message (customer sent their cart). */
export interface MetaOrder {
  catalog_id?: string
  text?: string
  product_items?: {
    product_retailer_id?: string
    quantity?: number | string
    item_price?: number | string
    currency?: string
  }[]
}

function toNumber(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/**
 * Normalise Meta's order envelope into our `OrderPayload`. Lines with no
 * retailer id or a non-positive quantity are dropped; null when nothing
 * usable is left.
 */
export function parseOrderMessage(order: MetaOrder | undefined): OrderPayload | null {
  if (!order || !Array.isArray(order.product_items)) return null
  const items: OrderItem[] = []
  for (const line of order.product_items) {
    const retailerId = line?.product_retailer_id?.trim()
    const quantity = toNumber(line?.quantity)
    if (!retailerId || quantity == null || quantity <= 0) continue
    items.push({
      retailer_id: retailerId,
      quantity: Math.floor(quantity),
      item_price: toNumber(line.item_price),
      currency: line.currency?.trim() || null,
    })
  }
  if (items.length === 0) return null
  return {
    catalog_id: order.catalog_id?.trim() || null,
    text: order.text?.trim() || null,
    items,
  }
}

/**
 * Fill in product names from the catalog cache so the inbox and the
 * public webhook show "Party Dress (4-5Y)" rather than a bare SKU.
 * Best-effort: unknown ids keep a null name.
 */
export async function withCatalogNames(
  db: SupabaseClient,
  accountId: string,
  order: OrderPayload,
): Promise<OrderPayload> {
  try {
    const { data } = await db
      .from('catalog_products')
      .select('retailer_id, name, size')
      .eq('account_id', accountId)
      .in(
        'retailer_id',
        order.items.map((i) => i.retailer_id),
      )
    const names = new Map(
      ((data ?? []) as { retailer_id: string; name: string; size: string | null }[]).map(
        (r) => [r.retailer_id, r.size ? `${r.name} (${r.size})` : r.name],
      ),
    )
    return {
      ...order,
      items: order.items.map((i) => ({ ...i, name: names.get(i.retailer_id) ?? null })),
    }
  } catch {
    return order
  }
}
