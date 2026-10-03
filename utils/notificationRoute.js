// Where tapping an in-app notification goes. `notifications.type` (20261066) is the
// authority; a NULL type — a row from something that does not set it — falls back to the
// title keywords this app has always used. 20261066's backfill ran this same keyword test
// in SQL, so old rows route exactly as they did before the column existed.
//
// Only 'duty' has a destination. 'message' rows carry no conversation id (the push does,
// the row does not), so opening the hub from one would land on the wrong tab; it stays
// inert until the hub can be opened on its Messages tab.
export const DUTY_KEYWORDS = ['duty', 'nöbetçi', 'مناوبة', 'дежурн', 'εφημερεύ', 'garde', 'guardia', 'notdienst', 'نوبتی']

export function notificationRoute(item) {
  if (item?.type) return item.type === 'duty' ? 'duty' : null
  const title = (item?.title ?? '').toLowerCase()
  return DUTY_KEYWORDS.some(kw => title.includes(kw)) ? 'duty' : null
}

// The in-app list. Asks for `type`; if the column does not exist (42703 — this bundle is
// running against a database from before 20261066), reads again without it, and every
// row then routes by keywords as above. Lets the app and the migration ship in either order.
const NOTIF_COLS = 'id, title, body, read, created_at'
export async function fetchNotifications(supabase, userId) {
  const q = cols => supabase.from('notifications').select(cols)
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(50)
  const first = await q(`${NOTIF_COLS}, type`)
  return first.error?.code === '42703' ? q(NOTIF_COLS) : first
}
