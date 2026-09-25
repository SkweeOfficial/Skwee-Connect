// ============================================================
// Commerce — Meta catalog product cards + WhatsApp cart orders.
// ============================================================

/** One row of the `catalog_products` cache (migration 040). */
export interface CatalogProduct {
  retailer_id: string
  item_group_id: string | null
  name: string
  description: string | null
  price_text: string | null
  price_amount: number | null
  currency: string | null
  availability: string | null
  image_url: string | null
  url: string | null
  size: string | null
  color: string | null
}

/**
 * All variants (sizes / colours) of one product, grouped by the feed's
 * `item_group_id`. This is the unit the AI recommends: it names a group
 * id, and every in-stock variant of it goes into the card so the
 * customer picks their size inside WhatsApp.
 */
export interface ProductGroup {
  /** `item_group_id` when set, else the single item's retailer_id. */
  id: string
  name: string
  description: string | null
  /** Lowest variant price, as Meta displays it. */
  priceText: string | null
  sizes: string[]
  colors: string[]
  items: CatalogProduct[]
}

/** Snapshot of a catalog item as it looked when the card was sent. */
export interface ProductCardItem {
  retailer_id: string
  name: string
  price_text?: string | null
  image_url?: string | null
  size?: string | null
}

/**
 * Persisted shape of an outbound product / product-list message, stored
 * in `messages.interactive_payload` next to (but separate from) the
 * buttons/list payloads. `product` always has exactly one section with
 * one item.
 */
export interface ProductMessagePayload {
  kind: 'product' | 'product_list'
  catalog_id: string
  header?: string
  body?: string
  footer?: string
  sections: { title: string; items: ProductCardItem[] }[]
}

/** One line of a WhatsApp cart order. */
export interface OrderItem {
  retailer_id: string
  quantity: number
  /** Unit price the customer saw in WhatsApp (major units). */
  item_price: number | null
  currency: string | null
  /** Filled from the catalog cache when the item is known. */
  name?: string | null
}

/** `messages.order_payload` for an inbound `order` message. */
export interface OrderPayload {
  catalog_id: string | null
  /** Optional note the customer typed with the order. */
  text: string | null
  items: OrderItem[]
}

export function isProductMessagePayload(
  payload: unknown,
): payload is ProductMessagePayload {
  if (!payload || typeof payload !== 'object') return false
  const kind = (payload as { kind?: unknown }).kind
  return (
    (kind === 'product' || kind === 'product_list') &&
    Array.isArray((payload as { sections?: unknown }).sections)
  )
}
