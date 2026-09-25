import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const h = vi.hoisted(() => ({
  listCatalogProducts: vi.fn(),
  calls: [] as { table: string; op: string; args: unknown[] }[],
  config: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/whatsapp/meta-api', () => ({ listCatalogProducts: h.listCatalogProducts }))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => `plain:${v}` }))

import { CatalogSyncError, syncCatalog, toCatalogRow } from './sync'

/** Records every chained call; terminal calls resolve with no error. */
function fakeDb(): SupabaseClient {
  return {
    from(table: string) {
      const record = (op: string, args: unknown[]) => h.calls.push({ table, op, args })
      const chain: Record<string, unknown> = {}
      for (const op of ['select', 'eq', 'lt', 'update', 'delete']) {
        chain[op] = (...args: unknown[]) => {
          record(op, args)
          return chain
        }
      }
      chain.maybeSingle = () => Promise.resolve({ data: h.config, error: null })
      chain.upsert = (...args: unknown[]) => {
        record('upsert', args)
        return Promise.resolve({ error: null })
      }
      chain.then = (resolve: (v: unknown) => void) => resolve({ error: null })
      return chain
    },
  } as unknown as SupabaseClient
}

beforeEach(() => {
  h.calls = []
  h.config = { catalog_id: 'cat-1', access_token: 'enc' }
  h.listCatalogProducts.mockReset()
})

describe('toCatalogRow', () => {
  it('maps Graph fields and parses the price', () => {
    expect(
      toCatalogRow(
        'acct',
        {
          retailer_id: 'd__2',
          name: ' Party Dress ',
          price: '₹1,290.00',
          availability: 'In Stock',
          retailer_product_group_id: 'd',
          size: '2-3Y',
          description: '',
        },
        'T',
      ),
    ).toMatchObject({
      account_id: 'acct',
      retailer_id: 'd__2',
      item_group_id: 'd',
      name: 'Party Dress',
      description: null,
      price_amount: 1290,
      availability: 'in stock',
      size: '2-3Y',
      synced_at: 'T',
    })
  })
})

describe('syncCatalog', () => {
  it('upserts the catalog, deletes stale rows and stamps the sync time', async () => {
    h.listCatalogProducts.mockResolvedValue([
      { retailer_id: 'a', name: 'A' },
      { retailer_id: 'a', name: 'A again' },
      { retailer_id: 'b', name: 'B' },
    ])
    const res = await syncCatalog(fakeDb(), 'acct-1')
    expect(res.count).toBe(2)
    expect(h.listCatalogProducts).toHaveBeenCalledWith({ catalogId: 'cat-1', accessToken: 'plain:enc' })

    const upsert = h.calls.find((c) => c.op === 'upsert')!
    expect((upsert.args[0] as { name: string }[]).map((r) => r.name)).toEqual(['A again', 'B'])
    expect(h.calls).toContainEqual({ table: 'catalog_products', op: 'lt', args: ['synced_at', res.syncedAt] })
    expect(h.calls).toContainEqual({
      table: 'whatsapp_config',
      op: 'update',
      args: [{ catalog_synced_at: res.syncedAt }],
    })
  })

  it('asks for a catalog id first', async () => {
    h.config = { catalog_id: null, access_token: 'enc' }
    await expect(syncCatalog(fakeDb(), 'acct-1')).rejects.toThrow(CatalogSyncError)
    expect(h.listCatalogProducts).not.toHaveBeenCalled()
  })

  it('explains a Meta permission failure without touching the cache', async () => {
    h.listCatalogProducts.mockRejectedValue(new Error('(#200) Missing permission'))
    await expect(syncCatalog(fakeDb(), 'acct-1')).rejects.toThrow(/catalog_management/)
    expect(h.calls.some((c) => c.op === 'delete')).toBe(false)
  })
})
