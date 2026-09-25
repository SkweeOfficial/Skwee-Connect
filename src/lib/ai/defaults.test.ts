import { describe, expect, it } from 'vitest'
import { HANDOFF_SENTINEL, buildSystemPrompt } from './defaults'

const CATALOG = '- id: dress | Party Dress | price: ₹1,290.00'

describe('buildSystemPrompt — product catalog', () => {
  it('teaches the product marker and lists the catalog in auto-reply mode', () => {
    const prompt = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', productCatalog: CATALOG })
    expect(prompt).toContain('[[PRODUCTS: id1, id2]]')
    expect(prompt).toContain(CATALOG)
  })

  it('leaves the catalog out of drafts', () => {
    const prompt = buildSystemPrompt({ userPrompt: null, mode: 'draft', productCatalog: CATALOG })
    expect(prompt).not.toContain('[[PRODUCTS:')
    expect(prompt).not.toContain(CATALOG)
  })

  it('does not hand off product questions just because the knowledge base misses them', () => {
    const withCatalog = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      knowledge: ['Returns within 30 days.'],
      productCatalog: CATALOG,
    })
    expect(withCatalog).toContain(
      `if neither they nor the product catalog below cover the question, do not guess — reply with exactly ${HANDOFF_SENTINEL}`,
    )

    const without = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      knowledge: ['Returns within 30 days.'],
    })
    expect(without).toContain("if they don't cover the question, do not guess")
    expect(without).not.toContain('[[PRODUCTS:')
  })
})
