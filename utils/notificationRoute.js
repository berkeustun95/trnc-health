// Where tapping an in-app notification goes. `notifications.type` (20261066) is the
// authority; a NULL type — a row from something that does not set it — falls back to the
// title keywords this app has always used. 20261066's backfill ran this same keyword test
// in SQL, so old rows route exactly as they did before the column existed.
//
// 'duty' and 'weekend' (20261175, the Friday digest → Keşfet, weekend events) have a destination. 'message' rows (20261087) carry the
// conversation id but not its kind: Student Hub and Bandabuliya threads both write type 'message'. fetchNotifications marks the
// rows whose conversation is one of the user's listing threads (listing_conversation); only those open that chat
// ('marketplace_conversation', and only where MARKETPLACE is on). Every other message row stays inert, as before.
// 'marketplace' (a photo decision, marketplace-photo-review) opens İlanlarım — the row carries no listing id, the push
// does — and only where Bandabuliya is reachable (MARKETPLACE), so a dark bundle leaves the row inert.
import { MARKETPLACE } from '../constants/redesign'

export const DUTY_KEYWORDS = ['duty', 'nöbetçi', 'مناوبة', 'дежурн', 'εφημερεύ', 'garde', 'guardia', 'notdienst', 'نوبتی']

export function notificationRoute(item) {
  if (item?.type) {
    if (item.type === 'marketplace') return MARKETPLACE ? 'marketplace' : null
    if (item.type === 'message') return MARKETPLACE && item.listing_conversation === true && item.conversation_id ? 'marketplace_conversation' : null
    return item.type === 'duty' || item.type === 'weekend' ? item.type : null
  }
  const title = (item?.title ?? '').toLowerCase()
  return DUTY_KEYWORDS.some(kw => title.includes(kw)) ? 'duty' : null
}

// The in-app list. Asks for `type` and `conversation_id`; a 42703 (this bundle is running against a database from before
// 20261066 / 20261087) drops the newest column first, then the next, so a missing `conversation_id` does not also lose `type`.
// Rows without `type` route by keywords as above. Lets the app and the migrations ship in either order.
// With Bandabuliya reachable and a signed-in (non-guest) user, message rows are then matched against list_conversations('listing')
// — the bare rpc, not MARKETPLACE_CHAT.list (no extra lookups, never the Preview sample data). An error leaves rows unmarked.
const NOTIF_COLS = 'id, title, body, read, created_at'
export async function fetchNotifications(supabase, userId, { guest = false } = {}) {
  const q = cols => supabase.from('notifications').select(cols)
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(50)
  let res = await q(`${NOTIF_COLS}, type, conversation_id`)
  if (res.error?.code === '42703') res = await q(`${NOTIF_COLS}, type`)
  if (res.error?.code === '42703') res = await q(NOTIF_COLS)
  const msgRows = (res.data ?? []).filter(n => n.type === 'message' && n.conversation_id)
  if (!MARKETPLACE || guest || !msgRows.length) return res
  try {
    const { data, error } = await supabase.rpc('list_conversations', { p_kind: 'listing' })
    if (error || !Array.isArray(data)) return res
    const ids = new Set(data.map(c => c.conversation_id))
    return { ...res, data: res.data.map(n => (n.type === 'message' && ids.has(n.conversation_id) ? { ...n, listing_conversation: true } : n)) }
  } catch { return res }
}
