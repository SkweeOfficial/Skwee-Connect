import type { SupabaseClient } from '@supabase/supabase-js'
import { listCatalogProducts, type MetaCatalogProduct } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { parseMetaPrice } from './catalog'

const UPSERT_BATCH = 500

export class CatalogSyncError extends Error {
  readonly status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'CatalogSyncError'
    this.status = status
  }
}

/** Map a Graph API catalog item onto a `catalog_products` row. */
export function toCatalogRow(
  accountId: string,
  item: MetaCatalogProduct,
  syncedAt: string,
) {
  const blank = (v: string | undefined) => (v && v.trim() ? v.trim() : null)
  // On sale, Meta's `price` is the "was" price; cache what customers actually pay.
  const regular = parseMetaPrice(item.price)
  const sale = parseMetaPrice(item.sale_price)
  const onSale = sale != null && (regular == null || sale < regular)
  return {
    account_id: accountId,
    retailer_id: item.retailer_id,
    item_group_id: blank(item.retailer_product_group_id),
    name: item.name.trim(),
    description: blank(item.description),
    price_text: blank(onSale ? item.sale_price : item.price),
    price_amount: onSale ? sale : regular,
    currency: blank(item.currency),
    availability: blank(item.availability)?.toLowerCase() ?? null,
    image_url: blank(item.image_url),
    url: blank(item.url),
    size: blank(item.size),
    color: blank(item.color),
    synced_at: syncedAt,
  }
}

/**
 * Refresh the account's `catalog_products` cache from its linked Meta
 * catalog: upsert every item, then delete rows the catalog no longer
 * has. Uses the service-role client (RLS has no write policies).
 * Throws `CatalogSyncError` for setup problems the UI should show.
 */
export async function syncCatalog(
  db: SupabaseClient,
  accountId: string,
): Promise<{ count: number; syncedAt: string }> {
  const { data: config, error } = await db
    .from('whatsapp_config')
    .select('catalog_id, access_token')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw new CatalogSyncError(error.message, 500)
  if (!config) throw new CatalogSyncError('WhatsApp is not connected yet.')
  if (!config.catalog_id) {
    throw new CatalogSyncError('Add your Meta catalog ID first.')
  }

  let accessToken: string
  try {
    accessToken = decrypt(config.access_token)
  } catch {
    throw new CatalogSyncError(
      'The stored WhatsApp access token could not be decrypted. Re-save your WhatsApp configuration.',
    )
  }

  let items: MetaCatalogProduct[]
  try {
    items = await listCatalogProducts({ catalogId: config.catalog_id, accessToken })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new CatalogSyncError(
      `Meta refused to share the catalog: ${msg}. Check that the catalog ID is right and that the system user behind your access token has the catalog_management permission and is assigned to this catalog.`,
      502,
    )
  }

  const syncedAt = new Date().toISOString()
  // A catalog can repeat a retailer id across feeds; keep the last one so
  // one upsert batch never hits the same unique key twice.
  const rows = [
    ...new Map(
      items.map((item) => [item.retailer_id, toCatalogRow(accountId, item, syncedAt)]),
    ).values(),
  ]

  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const { error: upsertErr } = await db
      .from('catalog_products')
      .upsert(rows.slice(i, i + UPSERT_BATCH), { onConflict: 'account_id,retailer_id' })
    if (upsertErr) throw new CatalogSyncError(upsertErr.message, 500)
  }

  // Everything this run touched carries `syncedAt`; older rows are gone
  // from the catalog.
  const { error: deleteErr } = await db
    .from('catalog_products')
    .delete()
    .eq('account_id', accountId)
    .lt('synced_at', syncedAt)
  if (deleteErr) throw new CatalogSyncError(deleteErr.message, 500)

  await db
    .from('whatsapp_config')
    .update({ catalog_synced_at: syncedAt })
    .eq('account_id', accountId)

  return { count: rows.length, syncedAt }
}
