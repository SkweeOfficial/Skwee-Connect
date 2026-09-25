import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseOrderMessage, withCatalogNames } from './orders'

describe('parseOrderMessage', () => {
  it('normalises Meta order lines', () => {
    expect(
      parseOrderMessage({
        catalog_id: '123',
        text: ' gift wrap please ',
        product_items: [
          { product_retailer_id: 'd__4', quantity: '2', item_price: '1290', currency: 'INR' },
          { product_retailer_id: 'tee', quantity: 1, item_price: 790, currency: 'INR' },
          { product_retailer_id: '', quantity: 1 },
          { product_retailer_id: 'zero', quantity: 0 },
        ],
      }),
    ).toEqual({
      catalog_id: '123',
      text: 'gift wrap please',
      items: [
        { retailer_id: 'd__4', quantity: 2, item_price: 1290, currency: 'INR' },
        { retailer_id: 'tee', quantity: 1, item_price: 790, currency: 'INR' },
      ],
    })
  })

  it('returns null for an empty or missing order', () => {
    expect(parseOrderMessage(undefined)).toBeNull()
    expect(parseOrderMessage({ product_items: [] })).toBeNull()
  })
})

describe('withCatalogNames', () => {
  it('adds names (with size) from the catalog cache', async () => {
    const chain = {
      from: () => chain,
      select: () => chain,
      eq: () => chain,
      in: () =>
        Promise.resolve({
          data: [{ retailer_id: 'd__4', name: 'Party Dress', size: '4-5Y' }],
          error: null,
        }),
    }
    const out = await withCatalogNames(chain as unknown as SupabaseClient, 'acct', {
      catalog_id: null,
      text: null,
      items: [
        { retailer_id: 'd__4', quantity: 1, item_price: 1, currency: 'INR' },
        { retailer_id: 'x', quantity: 1, item_price: 1, currency: 'INR' },
      ],
    })
    expect(out.items.map((i) => i.name)).toEqual(['Party Dress (4-5Y)', null])
  })
})
