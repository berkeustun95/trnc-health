import { supabase } from '../lib/supabase'

// The calls ConversationScreen and ConversationsScreen make, as one object, so Bandabuliya's listing chat can
// reuse both screens (and every block / leave / decline rule in them) with its own adapter
// (utils/marketplaceApi.js MARKETPLACE_CHAT). Each returns Supabase's { data, error } shape.
// STUDENT_CHAT is exactly the calls the screens made before the adapter existed: Student Hub is unchanged.
export const STUDENT_CHAT = {
  list: () => supabase.rpc('list_conversations'),
  messages: conversationId => supabase
    .from('messages')
    .select('id, sender_id, sender_display_name, body, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true }),
  start: (other, body) => supabase.rpc('start_conversation', { p_recipient_id: other.userId, p_body: body }),
  send: (conversationId, body) => supabase.rpc('send_message', { p_conversation_id: conversationId, p_body: body }),
  act: (rpc, args) => supabase.rpc(rpc, args),
}
