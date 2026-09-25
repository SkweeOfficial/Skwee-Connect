import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AiConfig } from './types'

// Shared, hoisted mock state so the module mocks can close over it.
const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  engineSendProducts: vi.fn(),
  loadProductContext: vi.fn(),
  state: {
    conv: null as Record<string, unknown> | null,
    autoResponders: [] as { id: string }[],
    claim: true as boolean,
    updatePayload: null as Record<string, unknown> | null,
    rpcCalls: [] as { name: string; args: unknown }[],
  },
}))

vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('./context', () => ({ buildConversationContext: h.buildConversationContext }))
vi.mock('./knowledge', () => ({ retrieveKnowledge: h.retrieveKnowledge }))
vi.mock('./generate', () => ({ generateReply: h.generateReply }))
vi.mock('@/lib/flows/meta-send', () => ({
  engineSendText: h.engineSendText,
  engineSendProducts: h.engineSendProducts,
}))
vi.mock('@/lib/commerce/recommend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/commerce/recommend')>()),
  loadProductContext: h.loadProductContext,
}))
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'automations') {
        // .select().eq().eq().in().limit() → active auto-responders
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          limit: () =>
            Promise.resolve({ data: h.state.autoResponders, error: null }),
        }
        return chain
      }
      // conversations
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: h.state.conv, error: null }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          h.state.updatePayload = payload
          return { eq: () => Promise.resolve({ error: null }) }
        },
      }
    },
    rpc: (name: string, args: unknown) => {
      h.state.rpcCalls.push({ name, args })
      return Promise.resolve({ data: h.state.claim, error: null })
    },
  }),
}))

import { dispatchInboundToAiReply } from './auto-reply'

const ARGS = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  configOwnerUserId: 'user-1',
}

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...overrides,
  }
}

beforeEach(() => {
  h.state.conv = {
    assigned_agent_id: null,
    ai_autoreply_disabled: false,
    ai_reply_count: 0,
  }
  h.state.autoResponders = []
  h.state.claim = true
  h.state.updatePayload = null
  h.state.rpcCalls = []
  h.loadAiConfig.mockResolvedValue(aiConfig())
  h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'hi' }])
  h.retrieveKnowledge.mockResolvedValue([])
  h.generateReply.mockResolvedValue({ text: 'Hello!', handoff: false })
  h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'm1' })
  h.engineSendProducts.mockResolvedValue({ whatsapp_message_id: 'm2' })
  h.loadProductContext.mockResolvedValue(null)
})

describe('dispatchInboundToAiReply — eligibility gates', () => {
  it('claims a slot and sends on the happy path', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.rpcCalls).toEqual([
      {
        name: 'claim_ai_reply_slot',
        args: { conversation_id: 'conv-1', max_replies: 3 },
      },
    ])
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', text: 'Hello!' }),
    )
  })

  it('grounds the reply in retrieved knowledge', async () => {
    h.retrieveKnowledge.mockResolvedValue(['Returns accepted within 30 days.'])
    await dispatchInboundToAiReply(ARGS)
    expect(h.retrieveKnowledge).toHaveBeenCalled()
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('Returns accepted within 30 days.')
  })

  it('stands down when an active message-level automation exists', async () => {
    h.state.autoResponders = [{ id: 'auto-1' }]
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('does not send when the atomic slot claim loses the race', async () => {
    h.state.claim = false
    await dispatchInboundToAiReply(ARGS)
    // It still attempts the claim, but the send is skipped.
    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when AI is off / not configured', async () => {
    h.loadAiConfig.mockResolvedValue(null)
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply is disabled for the account', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when a human agent is assigned', async () => {
    h.state.conv = {
      assigned_agent_id: 'agent-9',
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply was disabled on this conversation', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when the per-conversation cap is reached', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 3,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when there is nothing to reply to', async () => {
    h.buildConversationContext.mockResolvedValue([])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — handoff', () => {
  it('disables auto-reply, writes a summary, and does not send on handoff', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.rpcCalls).toHaveLength(0)
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain(
      'AI agent handed off',
    )
    // No handoff target configured → conversation left unassigned.
    expect(h.state.updatePayload).not.toHaveProperty('assigned_agent_id')
  })

  it('routes to the configured handoff agent on handoff', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-7' }))
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'agent-7',
    })
  })
})

function catalogItem(retailer_id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    retailer_id,
    item_group_id: null,
    name,
    description: null,
    price_text: '₹1,290.00',
    price_amount: 1290,
    currency: 'INR',
    availability: 'in stock',
    image_url: null,
    url: null,
    size: null,
    color: null,
    ...extra,
  }
}

const PRODUCTS = {
  catalogId: 'cat-1',
  groups: [
    {
      id: 'dress',
      name: 'Party Dress',
      description: null,
      priceText: '₹1,290.00',
      sizes: ['2-3Y', '4-5Y'],
      colors: [],
      items: [
        catalogItem('dress__2-3Y', 'Party Dress', { item_group_id: 'dress', size: '2-3Y' }),
        catalogItem('dress__4-5Y', 'Party Dress', { item_group_id: 'dress', size: '4-5Y' }),
      ],
    },
    {
      id: 'tee',
      name: 'Linen Tee',
      description: null,
      priceText: '₹790.00',
      sizes: [],
      colors: [],
      items: [catalogItem('tee', 'Linen Tee')],
    },
  ],
}

describe('dispatchInboundToAiReply — product cards', () => {
  it('lists the catalog in the prompt when one is linked', async () => {
    h.loadProductContext.mockResolvedValue(PRODUCTS)
    h.generateReply.mockResolvedValue({ text: 'Hello!', handoff: false, productIds: [] })
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('id: dress | Party Dress')
    expect(systemPrompt).toContain('[[PRODUCTS:')
    // No products picked → plain text as before.
    expect(h.engineSendText).toHaveBeenCalled()
    expect(h.engineSendProducts).not.toHaveBeenCalled()
  })

  it('sends the picked products as one card with the reply as its body', async () => {
    h.loadProductContext.mockResolvedValue(PRODUCTS)
    h.generateReply.mockResolvedValue({
      text: 'These would suit her!',
      handoff: false,
      productIds: ['dress', 'made-up-id'],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.engineSendProducts).toHaveBeenCalledTimes(1)
    const { payload, aiGenerated } = h.engineSendProducts.mock.calls[0][0]
    expect(aiGenerated).toBe(true)
    expect(payload).toMatchObject({
      kind: 'product_list',
      catalog_id: 'cat-1',
      body: 'These would suit her!',
      sections: [{ title: 'Party Dress' }],
    })
    expect(payload.sections[0].items.map((i: { retailer_id: string }) => i.retailer_id)).toEqual([
      'dress__2-3Y',
      'dress__4-5Y',
    ])
  })

  it('sends a single-product card for a one-variant product', async () => {
    h.loadProductContext.mockResolvedValue(PRODUCTS)
    h.generateReply.mockResolvedValue({ text: '', handoff: false, productIds: ['tee'] })
    await dispatchInboundToAiReply(ARGS)
    const { payload } = h.engineSendProducts.mock.calls[0][0]
    expect(payload.kind).toBe('product')
    expect(payload.sections[0].items[0].retailer_id).toBe('tee')
    // Empty text with a card is a real reply, not a handoff.
    expect(h.state.updatePayload).toBeNull()
  })

  it('falls back to text when every picked id is unknown', async () => {
    h.loadProductContext.mockResolvedValue(PRODUCTS)
    h.generateReply.mockResolvedValue({ text: 'Hello!', handoff: false, productIds: ['nope'] })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendProducts).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: 'Hello!' }))
  })

  it('falls back to text when Meta rejects the card', async () => {
    h.loadProductContext.mockResolvedValue(PRODUCTS)
    h.generateReply.mockResolvedValue({ text: 'Try this', handoff: false, productIds: ['tee'] })
    h.engineSendProducts.mockRejectedValue(new Error('Catalog not linked'))
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: 'Try this' }))
  })

  it('does not resend as text when the card went out but the DB write failed', async () => {
    h.loadProductContext.mockResolvedValue(PRODUCTS)
    h.generateReply.mockResolvedValue({ text: 'Try this', handoff: false, productIds: ['tee'] })
    h.engineSendProducts.mockRejectedValue(new Error('sent to Meta but DB insert failed: x'))
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })
})
