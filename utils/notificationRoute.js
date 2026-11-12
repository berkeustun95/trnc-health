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
// does — and only where Bandabuliya is reachable (MARKETPLACE), so a dark bundle leaves the row inert. When
// fetchNotifications can tell which listing the decision was about it sets `listing_id` on the row and the route becomes
// 'marketplace_listing' (that listing; App.js falls back to İlanlarım if it is gone by the time of the tap). That tap is
// async, so App.js runs it through createListingTap: one pending tap at a time, and closing Bildirimler cancels it.
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

// The in-app list. Asks for `type` and `conversation_id`; a 42703 (this bundle is running against a database from before
// 20261066 / 20261087) drops the newest column first, then the next, so a missing `conversation_id` does not also lose `type`.
// Rows without `type` route by keywords as above. Lets the app and the migrations ship in either order.
// With Bandabuliya reachable and a signed-in (non-guest) user, two independent annotations run concurrently, each from the
// same rows (they touch disjoint row types, so the results merge); an error in one leaves its rows unmarked and never costs
// the other:
//  - message rows are matched against list_conversations('listing') — the bare rpc, not MARKETPLACE_CHAT.list (no extra
//    lookups, never the Preview sample data);
//  - photo-decision rows ('marketplace') get the listing id when it is certain (below): the time window pins ONE listing AND
//    the notice body names that listing's title.
const NOTIF_COLS = 'id, title, body, read, created_at'

// marketplace-photo-review stamps reviewed_at on the rejected photo(s), then inserts the notice (created_at is the DB
// clock, a few seconds later), and sends at most one notice per seller per 10 minutes. The row carries no listing id, so
// a notice is tied to a listing only when every rejected photo of this user reviewed in this window around it belongs to
// ONE listing. The window is generous before (a slow insert, clock skew) and tight after (a photo reviewed after the
// notice is not its cause).
const PHOTO_WINDOW_BEFORE_MS = 60_000
const PHOTO_WINDOW_AFTER_MS = 5_000
const PHOTO_READ_LIMIT = 500

// The title as marketplace-photo-review's rejectText writes it into the notice body
// (supabase/functions/marketplace-photo-review/review.ts): over 40 characters it is cut to 39, trimmed, plus an ellipsis.
// Keep in step with that file.
function noticeTitle(title) {
  return title.length > 40 ? title.slice(0, 39).trimEnd() + '…' : title
}

async function markConversations(supabase, rows) {
  if (!rows.some(n => n.type === 'message' && n.conversation_id)) return rows
  try {
    const { data, error } = await supabase.rpc('list_conversations', { p_kind: 'listing' })
    if (error || !Array.isArray(data)) return rows
    const ids = new Set(data.map(c => c.conversation_id))
    return rows.map(n => (n.type === 'message' && ids.has(n.conversation_id) ? { ...n, listing_conversation: true } : n))
  } catch { return rows }
}

// Own rejected photos (owner-read RLS), bounded to the notices' time span; a truncated read decides nothing. Then one read
// of the candidate listings with the seller's own-read policy (it hides a deleted listing: the same "gone" as getListing).
// The notice body must also contain that listing's title (a second, stricter test: if one of two same-window listings'
// rejected rows later vanish, the notice about A cannot open B; a renamed listing falls back to İlanlarım).
async function markPhotoListings(supabase, userId, rows) {
  const notices = rows.filter(n => n.type === 'marketplace' && !n.listing_id && Number.isFinite(Date.parse(n.created_at)))
  if (!notices.length) return rows
  try {
    const times = notices.map(n => Date.parse(n.created_at))
    const from = new Date(Math.min(...times) - PHOTO_WINDOW_BEFORE_MS).toISOString()
    const to = new Date(Math.max(...times) + PHOTO_WINDOW_AFTER_MS).toISOString()
    const { data: photos, error, count } = await supabase.from('marketplace_photos')
      .select('listing_id, reviewed_at', { count: 'exact' })
      .eq('owner_id', userId).eq('status', 'rejected').gte('reviewed_at', from).lte('reviewed_at', to).limit(PHOTO_READ_LIMIT)
    if (error || !Array.isArray(photos) || count !== photos.length) return rows
    const reviewed = photos.map(p => ({ id: p.listing_id, at: Date.parse(p.reviewed_at) })).filter(p => p.id && Number.isFinite(p.at))
    const pick = new Map()
    for (const n of notices) {
      const t0 = Date.parse(n.created_at)
      const ids = new Set(reviewed.filter(p => p.at >= t0 - PHOTO_WINDOW_BEFORE_MS && p.at <= t0 + PHOTO_WINDOW_AFTER_MS).map(p => p.id))
      if (ids.size === 1) pick.set(n.id, [...ids][0])
    }
    if (!pick.size) return rows
    const { data: live, error: liveError } = await supabase.from('marketplace_listings')
      .select('id, title').eq('owner_id', userId).in('id', [...new Set(pick.values())]).limit(50)
    if (liveError || !Array.isArray(live)) return rows
    const titles = new Map(live.map(l => [l.id, typeof l.title === 'string' ? noticeTitle(l.title) : '']))
    let changed = false
    const out = rows.map(n => {
      const t = titles.get(pick.get(n.id))
      if (!(t && typeof n.body === 'string' && n.body.includes(t))) return n
      changed = true
      return { ...n, listing_id: pick.get(n.id) }
    })
    return changed ? out : rows
  } catch { return rows }
}

export async function fetchNotifications(supabase, userId, { guest = false } = {}) {
  const q = cols => supabase.from('notifications').select(cols)
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(50)
  let res = await q(`${NOTIF_COLS}, type, conversation_id`)
  if (res.error?.code === '42703') res = await q(`${NOTIF_COLS}, type`)
  if (res.error?.code === '42703') res = await q(NOTIF_COLS)
  if (!MARKETPLACE || guest || !Array.isArray(res.data)) return res
  const [withChats, withPhotos] = await Promise.all([markConversations(supabase, res.data), markPhotoListings(supabase, userId, res.data)])
  if (withChats === res.data && withPhotos === res.data) return res
  const photoMark = new Map(withPhotos.filter(n => n.listing_id).map(n => [n.id, n.listing_id]))
  const data = withChats.map(n => (n.type === 'marketplace' && photoMark.has(n.id) ? { ...n, listing_id: photoMark.get(n.id) } : n))
  return { ...res, data }
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
