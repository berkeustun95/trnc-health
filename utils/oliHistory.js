import { supabase } from '../lib/supabase'

// ─── Ask Oli chat history (oli_messages, 20261163) ───────────────────────────
// RLS returns only the caller's own rows, and nothing for a guest, so no user filter is needed to READ. Guests
// never call these: their chat stays on the phone. Rows older than 90 days are purged server-side.
export const HISTORY_LIMIT = 100

// → { rows (oldest first), error }. The newest HISTORY_LIMIT messages; older ones stay until the purge.
// A hung connection ends as an error after HISTORY_TIMEOUT_MS: the sheet blocks sending while history loads, so
// a load that never returns would leave the chat dead (2026-11-08).
export const HISTORY_TIMEOUT_MS = 10000
export async function loadOliHistory() {
  let q = supabase.from('oli_messages')
    .select('id, role, body, payload, created_at')
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT)
  let timer = null
  if (typeof AbortController === 'function') {
    const controller = new AbortController()
    timer = setTimeout(() => controller.abort(), HISTORY_TIMEOUT_MS)
    q = q.abortSignal(controller.signal)
  }
  let res
  try { res = await q } catch (e) { res = { data: null, error: e } } finally { clearTimeout(timer) }
  const { data, error } = res
  if (error) return { rows: [], error }
  return { rows: (data ?? []).reverse(), error: null }
}

// No RETURNING: user_id comes from the column DEFAULT (auth.uid()). A refusal (rate guard, offline) only means
// "not saved"; the answer is already on screen. Aborted after SAVE_TIMEOUT_MS so it always settles: the sheet
// retries a failed save, and a save that never answered would hold that retry forever.
export const SAVE_TIMEOUT_MS = 20000
export async function saveOliMessage(row) {
  let q = supabase.from('oli_messages').insert(row)
  let timer = null
  if (typeof AbortController === 'function') {
    const controller = new AbortController()
    timer = setTimeout(() => controller.abort(), SAVE_TIMEOUT_MS)
    q = q.abortSignal(controller.signal)
  }
  try { return (await q).error ?? null } catch (e) { return e } finally { clearTimeout(timer) }
}

// The rate guard (P0001) and the table CHECKs (23xxx) refuse the same row every time; anything else (offline, a
// dropped or expired connection) is worth sending again.
export const saveRefused = err => err?.code === 'P0001' || String(err?.code ?? '').startsWith('23')

// Deletes every row the caller owns, then reads back the exact count: an RLS-filtered DELETE that matched
// nothing reports success too, so "deleted" is claimed only when nothing is left.
export async function deleteOliHistory(userId) {
  const { error } = await supabase.from('oli_messages').delete().eq('user_id', userId)
  if (error) return error
  const { count, error: readErr } = await supabase.from('oli_messages').select('id', { count: 'exact', head: true })
  if (readErr) return readErr
  return count === 0 ? null : new Error(`oli_messages: ${count} row(s) left after delete`)
}
