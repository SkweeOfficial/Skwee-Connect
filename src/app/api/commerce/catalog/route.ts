import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { CatalogSyncError, syncCatalog } from '@/lib/commerce/sync'

// Meta Commerce catalog linked to the account's WhatsApp number — the
// source of the product cards the AI auto-reply bot sends.
//   GET   → { catalog_id, synced_at, product_count }   (any member)
//   PUT   { catalog_id } → save / clear the id          (admin+)
//   POST  → sync the catalog from Meta now              (admin+)

/** Meta catalog ids are numeric strings. */
const CATALOG_ID_RE = /^\d{5,30}$/

/** A full sync pages through the whole catalog — keep it deliberate. */
const SYNC_LIMIT = { limit: 5, windowMs: 60_000 }

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('catalog_id, catalog_synced_at')
      .eq('account_id', accountId)
      .maybeSingle()
    // RLS (catalog_products_select) scopes the count to this account.
    const { count } = await supabase
      .from('catalog_products')
      .select('id', { count: 'exact', head: true })
    return NextResponse.json({
      connected: !!config,
      catalog_id: config?.catalog_id ?? null,
      synced_at: config?.catalog_synced_at ?? null,
      product_count: count ?? 0,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    const raw = typeof body?.catalog_id === 'string' ? body.catalog_id.trim() : ''
    if (raw && !CATALOG_ID_RE.test(raw)) {
      return NextResponse.json(
        { error: 'That doesn’t look like a Meta catalog ID — it’s the long number shown in Commerce Manager.' },
        { status: 400 },
      )
    }

    const db = supabaseAdmin()
    const { data, error } = await db
      .from('whatsapp_config')
      .update({ catalog_id: raw || null, ...(raw ? {} : { catalog_synced_at: null }) })
      .eq('account_id', accountId)
      .select('catalog_id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: 'Connect WhatsApp before linking a catalog.' },
        { status: 400 },
      )
    }
    // Unlinking stops the bot offering products: clear the cache too.
    if (!raw) {
      await db.from('catalog_products').delete().eq('account_id', accountId)
    }
    return NextResponse.json({ catalog_id: raw || null })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST() {
  try {
    const { accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`catalog-sync:${userId}`, SYNC_LIMIT)
    if (!limit.success) return rateLimitResponse(limit)

    const { count, syncedAt } = await syncCatalog(supabaseAdmin(), accountId)
    return NextResponse.json({ product_count: count, synced_at: syncedAt })
  } catch (err) {
    if (err instanceof CatalogSyncError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
