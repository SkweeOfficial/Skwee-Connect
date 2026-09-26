import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  listCatalogProducts,
  sendProductListMessage,
  sendProductMessage,
} from './meta-api'

function okFetch(body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
}

const BASE = { phoneNumberId: 'pn', accessToken: 'tok', to: '919876543210', catalogId: 'cat' }

afterEach(() => vi.unstubAllGlobals())

describe('sendProductMessage', () => {
  it('posts a product interactive message', async () => {
    const fetchMock = okFetch({ messages: [{ id: 'wamid.1' }] })
    vi.stubGlobal('fetch', fetchMock)
    const res = await sendProductMessage({ ...BASE, productRetailerId: 'sku-1', bodyText: 'Hi' })
    expect(res.messageId).toBe('wamid.1')
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body.interactive).toEqual({
      type: 'product',
      body: { text: 'Hi' },
      action: { catalog_id: 'cat', product_retailer_id: 'sku-1' },
    })
  })

  it('requires a retailer id', async () => {
    vi.stubGlobal('fetch', vi.fn())
    await expect(sendProductMessage({ ...BASE, productRetailerId: '' })).rejects.toThrow(
      /productRetailerId/,
    )
  })
})

describe('sendProductListMessage', () => {
  it('posts sections of product items', async () => {
    const fetchMock = okFetch({ messages: [{ id: 'wamid.2' }] })
    vi.stubGlobal('fetch', fetchMock)
    await sendProductListMessage({
      ...BASE,
      headerText: 'Picks',
      bodyText: 'Have a look',
      sections: [{ title: 'Dress', productRetailerIds: ['d1', 'd2'] }],
    })
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body.interactive).toEqual({
      type: 'product_list',
      header: { type: 'text', text: 'Picks' },
      body: { text: 'Have a look' },
      action: {
        catalog_id: 'cat',
        sections: [
          { title: 'Dress', product_items: [{ product_retailer_id: 'd1' }, { product_retailer_id: 'd2' }] },
        ],
      },
    })
  })

  it('rejects more than 30 products before calling Meta', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      sendProductListMessage({
        ...BASE,
        headerText: 'h',
        bodyText: 'b',
        sections: [{ title: 'All', productRetailerIds: Array.from({ length: 31 }, (_, i) => `p${i}`) }],
      }),
    ).rejects.toThrow(/at most 30/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects duplicate products and long section titles', async () => {
    vi.stubGlobal('fetch', vi.fn())
    await expect(
      sendProductListMessage({
        ...BASE,
        headerText: 'h',
        bodyText: 'b',
        sections: [
          { title: 'A', productRetailerIds: ['x'] },
          { title: 'B', productRetailerIds: ['x'] },
        ],
      }),
    ).rejects.toThrow(/duplicate/)
    await expect(
      sendProductListMessage({
        ...BASE,
        headerText: 'h',
        bodyText: 'b',
        sections: [{ title: 'x'.repeat(25), productRetailerIds: ['x'] }],
      }),
    ).rejects.toThrow(/24 chars/)
  })
})

describe('listCatalogProducts', () => {
  it('follows paging and skips incomplete items', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ retailer_id: 'a', name: 'A' }, { retailer_id: 'b' }],
            paging: { next: 'https://graph.facebook.com/next-page' },
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ retailer_id: 'c', name: 'C' }] })))
    vi.stubGlobal('fetch', fetchMock)
    const items = await listCatalogProducts({ catalogId: 'cat', accessToken: 'tok' })
    expect(items.map((i) => i.retailer_id)).toEqual(['a', 'c'])
    expect(fetchMock.mock.calls[0][0]).toContain('sale_price')
    expect(fetchMock.mock.calls[1][0]).toBe('https://graph.facebook.com/next-page')
  })

  it('surfaces Meta errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { message: 'No permission' } }), { status: 403 })),
    )
    await expect(listCatalogProducts({ catalogId: 'cat', accessToken: 'tok' })).rejects.toThrow(
      'No permission',
    )
  })
})
