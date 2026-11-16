// Where tapping an in-app notification goes. `notifications.type` (20261066) is the
// authority; a NULL type — a row from something that does not set it — falls back to the
// title keywords this app has always used. 20261066's backfill ran this same keyword test
// in SQL, so old rows route exactly as they did before the column existed.
//
// 'duty' and 'weekend' (20261175, the Friday digest → Keşfet, weekend events) have a destination. 'message' rows (20261087) carry the
// conversation id but not its kind: Student Hub and Bandabuliya threads both write type 'message'. fetchNotifications marks the
// rows whose conversation is one of the user's listing threads (listing_conversation); only those open that chat
// ('marketplace_conversation', and only where MARKETPLACE is on). Every other message row stays inert, as before.
// 'marketplace' (a photo decision, marketplace-photo-review) carries `listing_id` (20261192): with it the row opens that
// listing ('marketplace_listing'), without it İlanlarım ('marketplace'; rows from before 20261192 have NULL, on purpose).
// Both only where Bandabuliya is reachable (MARKETPLACE), so a dark bundle leaves the row inert. The listing tap is async
// (the listing may be gone), so App.js runs it through createListingTap: one pending tap at a time, closing Bildirimler cancels it.
import { MARKETPLACE } from '../constants/redesign'

export const DUTY_KEYWORDS = ['duty', 'nöbetçi', 'مناوبة', 'дежурн', 'εφημερεύ', 'garde', 'guardia', 'notdienst', 'نوبتی']

export function notificationRoute(item) {
  if (item?.type) {
    if (item.type === 'marketplace') return MARKETPLACE ? (item.listing_id ? 'marketplace_listing' : 'marketplace') : null
    if (item.type === 'message') return MARKETPLACE && item.listing_conversation === true && item.conversation_id ? 'marketplace_conversation' : null
    return item.type === 'duty' || item.type === 'weekend' ? item.type : null
  }
  const title = (item?.title ?? '').toLowerCase()
  return DUTY_KEYWORDS.some(kw => title.includes(kw)) ? 'duty' : null
}

// The admin photo-review reminder push (20261196) → AdminScreen's Bandabuliya tab, Photos view. Only AdminScreen reads
// the request, so a non-admin tap is a no-op; a dark bundle ignores it like every Bandabuliya push.
export function adminPushRequest(data) {
  if (!MARKETPLACE || data?.screen !== 'admin' || data.tab !== 'marketplace') return null
  return { tab: 'Bandabuliya', view: 'Photos' }
}

// The in-app list. Asks for `type`, `conversation_id` and `listing_id`; a 42703 (this bundle is running against a database
// from before 20261192 / 20261087 / 20261066) drops the newest column first, so a missing `listing_id` does not also lose
// `conversation_id` or `type`. Rows without `type` route by keywords as above. Lets the app and the migrations ship in either order.
// With Bandabuliya reachable and a signed-in (non-guest) user, message rows are matched against list_conversations('listing')
// — the bare rpc, not MARKETPLACE_CHAT.list (no extra lookups, never the Preview sample data).
const NOTIF_COLS = 'id, title, body, read, created_at'

async function markConversations(supabase, rows) {
  if (!rows.some(n => n.type === 'message' && n.conversation_id)) return rows
  try {
    const { data, error } = await supabase.rpc('list_conversations', { p_kind: 'listing' })
    if (error || !Array.isArray(data)) return rows
    const ids = new Set(data.map(c => c.conversation_id))
    return rows.map(n => (n.type === 'message' && ids.has(n.conversation_id) ? { ...n, listing_conversation: true } : n))
  } catch { return rows }
}

export async function fetchNotifications(supabase, userId, { guest = false } = {}) {
  const q = cols => supabase.from('notifications').select(cols)
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(50)
  let res = await q(`${NOTIF_COLS}, type, conversation_id, listing_id`)
  if (res.error?.code === '42703') res = await q(`${NOTIF_COLS}, type, conversation_id`)
  if (res.error?.code === '42703') res = await q(`${NOTIF_COLS}, type`)
  if (res.error?.code === '42703') res = await q(NOTIF_COLS)
  if (!MARKETPLACE || guest || !Array.isArray(res.data)) return res
  const data = await markConversations(supabase, res.data)
  return data === res.data ? res : { ...res, data }
}

// The tap on a 'marketplace_listing' row: the listing may have been deleted since the list loaded, and the listing page
// would then say "no longer live". Decide BEFORE mounting Bandabuliya: the listing if the seller can still read it, else
// İlanlarım ('mine', the same landing as a row without a listing id). A failed read also lands on İlanlarım.
export async function marketplaceListingTarget(listingId, getListing) {
  try { return (await getListing(listingId)) ? { view: 'listing', listingId } : 'mine' } catch { return 'mine' }
}

// One listing-row tap at a time. run() ignores a tap while one is pending; cancel() (Bildirimler closing, by any path) makes
// the pending tap's late result do nothing. Only the tap that is still current calls onTarget.
export function createListingTap() {
  let current = null
  return {
    run(resolve, onTarget) {
      if (current) return false
      const mine = (current = {})
      Promise.resolve().then(resolve).then(target => {
        if (current !== mine) return
        current = null
        onTarget(target)
      })
      return true
    },
    cancel() { current = null },
  }
}
