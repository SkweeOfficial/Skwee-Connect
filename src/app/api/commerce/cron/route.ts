import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { syncCatalog } from '@/lib/commerce/sync'

/**
 * Refresh every linked Meta catalog into `catalog_products`, so prices,
 * stock and new products reach the AI's product cards without anyone
 * pressing "Sync now". Hit hourly (the store's feed is pulled by Meta on
 * its own schedule; syncing more often than that gains nothing).
 *
 * Auth: `x-cron-secret: $AUTOMATION_CRON_SECRET`, same as the other
 * cron endpoints. One account failing doesn't stop the rest.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const suppliedBuf = Buffer.from(request.headers.get('x-cron-secret') ?? '')
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = supabaseAdmin()
  const { data: configs, error } = await db
    .from('whatsapp_config')
    .select('account_id')
    .not('catalog_id', 'is', null)
  if (error) {
    console.error('[commerce-cron] config scan failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let synced = 0
  const failed: { account_id: string; error: string }[] = []
  for (const { account_id } of (configs ?? []) as { account_id: string }[]) {
    try {
      await syncCatalog(db, account_id)
      synced += 1
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[commerce-cron] sync failed for ${account_id}:`, msg)
      failed.push({ account_id, error: msg })
    }
  }
  return NextResponse.json({ synced, failed })
}
