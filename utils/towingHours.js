// Çekici & Yol Yardım — "open now" and list ordering.
//
// THESE TWO LIVE TOGETHER ON PURPOSE. The sort's top key is open-now, so a change to
// how openness is computed silently changes the order of an emergency list. Splitting
// them across files is the likeliest way for that to drift unnoticed.
//
// Pure and offline: no network, no DB. The DB cannot do this work — open-now depends on
// the current time in Cyprus, so Postgres could only answer it for the instant the query
// ran. That is why sorting happens client-side (see sortTowingCompanies).

// ─── Cyprus local time ──────────────────────────────────────────────────────
//
// NOT device time. A newcomer's phone is very often still on their home timezone, and
// this module's whole audience is newcomers. Europe/Nicosia is the only correct clock
// for "is this firm open right now".
const TZ = 'Europe/Nicosia'
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

// Returns { day: 'mon'|…, minutes: 0..1439 } in Cyprus local time.
//
// Intl with an explicit timeZone handles EET/EEST for us. If it is unavailable or throws
// (a stripped Hermes ICU build), we fall back to a FIXED +03:00 — Cyprus summer time.
// The fallback is deliberately not clever: being an hour out in winter shifts a boundary,
// while guessing DST wrong could too, and a fixed offset at least fails predictably.
export function cyprusNow(now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(now)
    const get = t => parts.find(p => p.type === t)?.value
    const wd = (get('weekday') || '').toLowerCase().slice(0, 3)
    const h  = Number(get('hour'))
    const m  = Number(get('minute'))
    if (DAY_KEYS.includes(wd) && Number.isFinite(h) && Number.isFinite(m)) {
      return { day: wd, minutes: (h % 24) * 60 + m }
    }
  } catch {}
  const t = new Date(now.getTime() + 3 * 3600 * 1000)   // fixed +03:00 fallback
  return { day: DAY_KEYS[t.getUTCDay()], minutes: t.getUTCHours() * 60 + t.getUTCMinutes() }
}

const toMinutes = hhmm => {
  if (typeof hhmm !== 'string') return null
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}
const prevDay = day => DAY_KEYS[(DAY_KEYS.indexOf(day) + 6) % 7]
const nextDay = day => DAY_KEYS[(DAY_KEYS.indexOf(day) + 1) % 7]
const fmt = mins => `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`

// One day's window, or null when closed. Absent key == closed, same as explicit null.
function windowFor(hours, day) {
  const w = hours?.[day]
  if (!w || typeof w !== 'object') return null
  const open = toMinutes(w.open), close = toMinutes(w.close)
  if (open == null || close == null) return null
  // close <= open means the shift CROSSES MIDNIGHT (e.g. 20:00–04:00). For towing this
  // is the normal case, not an edge case, so it is modelled rather than rejected.
  return { open, close, overnight: close <= open }
}

// ─── The status a card renders ──────────────────────────────────────────────
//
// Returns one of:
//   { state: 'open',    always: true }            → "Şu an açık" + 7/24 badge
//   { state: 'open',    until: 'HH:MM' }          → "Şu an açık"
//   { state: 'opens',   at: 'HH:MM', tomorrow }   → "HH:MM'de açılır"
//   { state: 'closed' }                           → "Bugün kapalı"
//
// A closed firm is NEVER hidden — it sorts down and says when it opens. On an emergency
// screen a closed number the user can try later beats an empty list.
export function openState(company, now = new Date()) {
  if (company?.is_24_7) return { state: 'open', always: true }

  const hours = company?.opening_hours
  if (!hours || typeof hours !== 'object') return { state: 'closed', unknown: true }

  const { day, minutes } = cyprusNow(now)

  // Yesterday's overnight shift may still be running (it is 02:00 and they opened 20:00).
  const y = windowFor(hours, prevDay(day))
  if (y?.overnight && minutes < y.close) return { state: 'open', until: fmt(y.close) }

  const today = windowFor(hours, day)
  if (today) {
    if (today.overnight) {
      if (minutes >= today.open) return { state: 'open', until: fmt(today.close) }
    } else if (minutes >= today.open && minutes < today.close) {
      return { state: 'open', until: fmt(today.close) }
    }
    if (minutes < today.open) return { state: 'opens', at: fmt(today.open) }
  }

  // Closed for the rest of today — look ahead for the next opening, up to a week out.
  for (let i = 1; i <= 7; i++) {
    let d = day
    for (let k = 0; k < i; k++) d = nextDay(d)
    const w = windowFor(hours, d)
    if (w) return { state: 'opens', at: fmt(w.open), tomorrow: i === 1, days: i }
  }
  return { state: 'closed' }
}

export const isOpenNow = (company, now = new Date()) => openState(company, now).state === 'open'

// ─── Ordering ───────────────────────────────────────────────────────────────
//
// open-now → is_featured → sort_order → name
//
// OPEN-NOW OUTRANKS FEATURED, DELIBERATELY. A paid slot must never push a firm that is
// actually open below one that is shut: sending a stranded driver to a closed shutter
// burns the user and gains the advertiser nothing, because an unanswered call is not a
// lead. Featured competes WITHIN the open group. Do not reorder these two keys.
//
// Runs in JS, not SQL, because open-now is a function of the current Cyprus time — see
// the note at the top of this file. Tens of rows, so the cost is irrelevant.
export function sortTowingCompanies(companies, now = new Date()) {
  const open = new Map(companies.map(c => [c.id, isOpenNow(c, now)]))
  return [...companies].sort((a, b) => {
    const ao = open.get(a.id), bo = open.get(b.id)
    if (ao !== bo) return ao ? -1 : 1
    if (!!a.is_featured !== !!b.is_featured) return a.is_featured ? -1 : 1
    const as = a.sort_order ?? 0, bs = b.sort_order ?? 0
    if (as !== bs) return as - bs
    return String(a.name || '').localeCompare(String(b.name || ''), 'tr')
  })
}
