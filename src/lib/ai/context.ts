import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from './types'
import { aiContextMessageLimit } from './defaults'
import { isProductMessagePayload } from '@/lib/commerce/types'
import { productCardsNote } from '@/lib/commerce/catalog'

interface DbMessage {
  sender_type: 'customer' | 'agent' | 'bot'
  content_text: string | null
  interactive_payload?: unknown
}

/** Text the model sees for a message: product cards we sent are named,
 *  so a follow-up ("the second one in blue?") has something to refer to. */
function messageText(m: DbMessage): string {
  const text = m.content_text?.trim() ?? ''
  if (!isProductMessagePayload(m.interactive_payload)) return text
  const note = productCardsNote(m.interactive_payload)
  return text ? `${text}\n${note}` : note
}

/**
 * Fetch the last N text-bearing messages of a conversation and map them
 * to the provider-neutral chat shape. Customer messages become `user`;
 * agent and bot messages become `assistant`. Plain text, interactive
 * messages (button taps, our menus and product cards) and cart orders
 * are included by their text; media and templates are excluded.
 *
 * Ordered oldest-first (chronological) so the transcript reads
 * naturally and the most recent customer message lands last.
 */
export async function buildConversationContext(
  db: SupabaseClient,
  conversationId: string,
  limit: number = aiContextMessageLimit(),
): Promise<ChatMessage[]> {
  const { data, error } = await db
    .from('messages')
    .select('sender_type, content_text, interactive_payload')
    .eq('conversation_id', conversationId)
    .in('content_type', ['text', 'interactive', 'order'])
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  const rows = ((data ?? []) as DbMessage[]).reverse()
  return rows
    .map((m) => ({
      role: (m.sender_type === 'customer' ? 'user' : 'assistant') as ChatMessage['role'],
      content: messageText(m),
    }))
    .filter((m) => m.content)
}
