import { describe, expect, it } from 'vitest'
import {
  buildProductMessagePayload,
  formatProductsForPrompt,
  groupCatalogProducts,
  isOrderable,
  orderSummaryText,
  parseMetaPrice,
  rankProductGroups,
} from './catalog'
import type { CatalogProduct } from './types'

function item(retailer_id: string, extra: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    retailer_id,
    item_group_id: null,
    name: retailer_id,
    description: null,
    price_text: '₹1,000.00',
    price_amount: 1000,
    currency: 'INR',
    availability: 'in stock',
    image_url: null,
    url: null,
    size: null,
    color: null,
    ...extra,
  }
}

describe('parseMetaPrice', () => {
  it('reads Meta display prices', () => {
    expect(parseMetaPrice('₹1,290.00')).toBe(1290)
    expect(parseMetaPrice('1290.50 INR')).toBe(1290.5)
    expect(parseMetaPrice('')).toBeNull()
    expect(parseMetaPrice('free')).toBeNull()
  })
})

describe('isOrderable', () => {
  it('keeps in-stock and preorder items, drops out-of-stock', () => {
    expect(isOrderable('in stock')).toBe(true)
    expect(isOrderable('Preorder')).toBe(true)
    expect(isOrderable(null)).toBe(true)
    expect(isOrderable('out of stock')).toBe(false)
    expect(isOrderable('discontinued')).toBe(false)
  })
})

describe('groupCatalogProducts', () => {
  it('groups variants, collects sizes and shows the cheapest price', () => {
    const groups = groupCatalogProducts([
      item('dress__4', { item_group_id: 'dress', name: 'Party Dress', size: '4-5Y', price_text: '₹1,390.00', price_amount: 1390 }),
      item('dress__2', { item_group_id: 'dress', name: 'Party Dress', size: '2-3Y', price_text: '₹1,290.00', price_amount: 1290 }),
      item('dress__6', { item_group_id: 'dress', name: 'Party Dress', size: '6-7Y', availability: 'out of stock' }),
      item('tee', { name: 'Linen Tee', color: 'Oat' }),
    ])
    expect(groups.map((g) => g.id)).toEqual(['dress', 'tee'])
    expect(groups[0].sizes).toEqual(['4-5Y', '2-3Y'])
    expect(groups[0].items).toHaveLength(2)
    expect(groups[0].priceText).toBe('₹1,290.00')
    expect(groups[1].colors).toEqual(['Oat'])
  })

  it('drops a product whose every variant is out of stock', () => {
    expect(groupCatalogProducts([item('x', { availability: 'out of stock' })])).toEqual([])
  })
})

describe('rankProductGroups', () => {
  const groups = groupCatalogProducts([
    item('tee', { name: 'Linen Tee', description: 'Soft everyday tee' }),
    item('dress', { name: 'Party Dress', description: 'Twirly dress for birthdays' }),
    item('shorts', { name: 'Denim Shorts', color: 'Blue' }),
  ])

  it('puts name matches first, handling plurals', () => {
    const ranked = rankProductGroups(groups, 'Do you have party dresses for a 4 year old girl?', 3)
    expect(ranked[0].id).toBe('dress')
  })

  it('matches on colour', () => {
    expect(rankProductGroups(groups, 'something in blue', 1)[0].id).toBe('shorts')
  })

  it('tops up with catalog order when nothing matches', () => {
    expect(rankProductGroups(groups, 'what do you sell?', 2).map((g) => g.id)).toEqual([
      'tee',
      'dress',
    ])
  })
})

describe('formatProductsForPrompt', () => {
  it('writes one line per product with its id', () => {
    const [g] = groupCatalogProducts([
      item('d1', { item_group_id: 'dress', name: 'Party Dress', size: '2-3Y' }),
    ])
    expect(formatProductsForPrompt([g])).toBe(
      '- id: dress | Party Dress | price: ₹1,000.00 | sizes: 2-3Y',
    )
  })
})

describe('buildProductMessagePayload', () => {
  it('sends one variant as a single-product card', () => {
    const groups = groupCatalogProducts([item('tee', { name: 'Linen Tee' })])
    expect(buildProductMessagePayload({ catalogId: 'c', groups, bodyText: 'Try this' })).toEqual({
      kind: 'product',
      catalog_id: 'c',
      body: 'Try this',
      sections: [
        {
          title: 'Linen Tee',
          items: [
            { retailer_id: 'tee', name: 'Linen Tee', price_text: '₹1,000.00', image_url: null, size: null },
          ],
        },
      ],
    })
  })

  it('sends several products as a list with a section each and a header', () => {
    const groups = groupCatalogProducts([
      item('a1', { item_group_id: 'a', name: 'A really long product name here', size: 'S' }),
      item('a2', { item_group_id: 'a', name: 'A really long product name here', size: 'M' }),
      item('b', { name: 'B' }),
    ])
    const payload = buildProductMessagePayload({ catalogId: 'c', groups, bodyText: '' })!
    expect(payload.kind).toBe('product_list')
    expect(payload.header).toBeTruthy()
    expect(payload.body).toBeTruthy()
    expect(payload.sections.map((s) => s.items.length)).toEqual([2, 1])
    expect(payload.sections[0].title.length).toBeLessThanOrEqual(24)
  })

  it('stays within 30 items', () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      item(`v${i}`, { item_group_id: `g${i % 4}`, name: `G${i % 4}`, size: `${i}` }),
    )
    const payload = buildProductMessagePayload({
      catalogId: 'c',
      groups: groupCatalogProducts(rows),
      bodyText: 'x',
    })!
    expect(payload.sections.reduce((n, s) => n + s.items.length, 0)).toBe(30)
  })

  it('returns null with nothing to send', () => {
    expect(buildProductMessagePayload({ catalogId: 'c', groups: [], bodyText: 'x' })).toBeNull()
  })
})

describe('orderSummaryText', () => {
  it('counts quantities and totals the order', () => {
    expect(
      orderSummaryText({
        catalog_id: 'c',
        text: null,
        items: [
          { retailer_id: 'a', quantity: 2, item_price: 1290, currency: 'INR' },
          { retailer_id: 'b', quantity: 1, item_price: 1290, currency: 'INR' },
        ],
      }),
    ).toBe('🛒 Order: 3 items · INR 3,870')
  })

  it('omits the total when a price is missing', () => {
    expect(
      orderSummaryText({
        catalog_id: null,
        text: null,
        items: [{ retailer_id: 'a', quantity: 1, item_price: null, currency: null }],
      }),
    ).toBe('🛒 Order: 1 item')
  })
})
