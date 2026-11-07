import { supabase } from '../lib/supabase'

// ─── Ask Oli chat history (oli_messages, 20261163) ───────────────────────────
// RLS returns only the caller's own rows, and nothing for a guest, so no user filter is needed to READ. Guests
// never call these: their chat stays on the phone. Rows older than 90 days are purged server-side.
export const HISTORY_LIMIT = 100

// → { rows (oldest first), error }. The newest HISTORY_LIMIT messages; older ones stay until the purge.
export async function loadOliHistory() {
  const { data, error } = await supabase.from('oli_messages')
    .select('id, role, body, payload, created_at')
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT)
  if (error) return { rows: [], error }
  return { rows: (data ?? []).reverse(), error: null }
}

// No RETURNING: user_id comes from the column DEFAULT (auth.uid()). A refusal (rate guard, offline) only means
// "not saved"; the answer is already on screen.
export async function saveOliMessage(row) {
  const { error } = await supabase.from('oli_messages').insert(row)
  return error ?? null
}

// Deletes every row the caller owns, then reads back the exact count: an RLS-filtered DELETE that matched
// nothing reports success too, so "deleted" is claimed only when nothing is left.
export async function deleteOliHistory(userId) {
  const { error } = await supabase.from('oli_messages').delete().eq('user_id', userId)
  if (error) return error
  const { count, error: readErr } = await supabase.from('oli_messages').select('id', { count: 'exact', head: true })
  if (readErr) return readErr
  return count === 0 ? null : new Error(`oli_messages: ${count} row(s) left after delete`)
}
