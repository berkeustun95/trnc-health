// Where tapping an in-app notification goes. `notifications.type` (20261066) is the
// authority; a NULL type — a row from something that does not set it — falls back to the
// title keywords this app has always used. 20261066's backfill ran this same keyword test
// in SQL, so old rows route exactly as they did before the column existed.
//
// 'duty' opens the roster; 'message' opens the Student Hub on that thread (20261087 gave the
// row its `conversation_id`; a row without one opens the Messages tab).
export const DUTY_KEYWORDS = ['duty', 'nöbetçi', 'مناوبة', 'дежурн', 'εφημερεύ', 'garde', 'guardia', 'notdienst', 'نوبتی']

export function notificationRoute(item) {
  if (item?.type) return item.type === 'duty' || item.type === 'message' ? item.type : null
  const title = (item?.title ?? '').toLowerCase()
  return DUTY_KEYWORDS.some(kw => title.includes(kw)) ? 'duty' : null
}

// The in-app list. Asks for `type` and `conversation_id`; each 42703 (this bundle running
// against a database from before 20261087, then 20261066) drops the newest column and reads
// again, so the app and the migrations ship in either order.
const NOTIF_COLS = 'id, title, body, read, created_at'
export async function fetchNotifications(supabase, userId) {
  const q = cols => supabase.from('notifications').select(cols)
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(50)
  const first = await q(`${NOTIF_COLS}, type, conversation_id`)
  if (first.error?.code !== '42703') return first
  const second = await q(`${NOTIF_COLS}, type`)
  return second.error?.code === '42703' ? q(NOTIF_COLS) : second
}
