// When an event stops being listed: ONE rule for Etkinlikler and the Home events strip, so
// the two can never disagree about whether something is still on (Berke, 2026-11-01).
//
//   end_date set      → listed until end_date.
//   no end_date       → listed until 06:00 CYPRUS time on the morning after its Cyprus start
//                       date. Gişe Kıbrıs often sends no end; nightlife runs past midnight, and
//                       by 06:00 the night is over.
//
// The list used to keep anything that STARTED in the last 24 h and ignore end_date: a
// 19:00 Halloween party still showed at 15:30 next day, and a festival with a real end
// vanished 24 h after its first evening.
//
// Pure and offline (no react-native import), so scripts/test-event-visibility.mjs runs it
// under plain Node.

const TZ = 'Europe/Nicosia'
const H = 60 * 60 * 1000
export const NO_END_CUTOFF_HOUR = 6

// Cyprus wall clock of an instant: { y, m, d, offsetMs }. Fixed +03:00 if Intl is unavailable
// (as utils/towingHours.js): at worst a winter cut-off lands an hour early.
function cyprusParts(instant) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(instant)
    const get = t => Number(parts.find(p => p.type === t)?.value)
    const y = get('year'), m = get('month'), d = get('day'), hh = get('hour'), mm = get('minute')
    if ([y, m, d, hh, mm].every(Number.isFinite)) {
      const wall = Date.UTC(y, m - 1, d, hh % 24, mm)
      const offsetMs = Math.round((wall - instant.getTime()) / 60000) * 60000
      return { y, m, d, offsetMs }
    }
  } catch {}
  const t = new Date(instant.getTime() + 3 * H)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), offsetMs: 3 * H }
}

// The instant an event stops being listed (Date), or null if start_date is unreadable.
export function eventListedUntil(event) {
  if (event?.end_date) {
    const e = new Date(event.end_date)
    if (!Number.isNaN(e.getTime())) return e
  }
  const s = new Date(event?.start_date)
  if (Number.isNaN(s.getTime())) return null
  const { y, m, d } = cyprusParts(s)
  // 06:00 on the next Cyprus day, as if it were UTC; then shift by the Cyprus offset in force
  // at that morning (read 3 h earlier, which is still after the 03:00/04:00 DST switch).
  const wallAsUtc = Date.UTC(y, m - 1, d + 1, NO_END_CUTOFF_HOUR, 0)
  return new Date(wallAsUtc - cyprusParts(new Date(wallAsUtc - 3 * H)).offsetMs)
}

export function isEventOver(event, now = new Date()) {
  const until = eventListedUntil(event)
  return !until || until.getTime() <= now.getTime()
}

// Started and not over. Upcoming = !isEventOver && !isEventOnNow.
export function isEventOnNow(event, now = new Date()) {
  const s = new Date(event?.start_date)
  return !Number.isNaN(s.getTime()) && s.getTime() <= now.getTime() && !isEventOver(event, now)
}

// The server half, for PostgREST .or(): every row that COULD still be listed. A no-end event is
// listed at most 30 h after it starts (00:00 start → 06:00 next day), so 30 h back is enough;
// isEventOver then applies the exact rule on the client.
export function maybeListedFilter(now = new Date()) {
  const nowIso = now.toISOString()
  const since = new Date(now.getTime() - 30 * H).toISOString()
  return `end_date.gte.${nowIso},and(end_date.is.null,start_date.gte.${since})`
}
