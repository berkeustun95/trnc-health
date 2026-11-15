// Pure helpers for the admin "Data jobs" screen. `state` is computed by the server
// (admin_data_jobs); nothing here recomputes it, it only groups and counts.
export const ATTENTION_STATES = ['failed', 'stale', 'inactive']

// Display groups, in order. Server order is kept inside a group (Array.prototype.sort is stable).
const GROUP_OF = { failed: 0, stale: 0, inactive: 0, paused: 1, no_record: 2, ok: 3 }

const groupOf = job => GROUP_OF[job?.state] ?? 2

export function countAttention(jobs) {
  return (jobs || []).filter(j => ATTENTION_STATES.includes(j?.state)).length
}

export function sortJobs(jobs) {
  return (jobs || []).map((j, i) => [j, i]).sort((a, b) => groupOf(a[0]) - groupOf(b[0]) || a[1] - b[1]).map(x => x[0])
}

// An empty or non-array result is an error: the registry cannot legitimately be empty.
export function isUsableJobs(data) {
  return Array.isArray(data) && data.length > 0
}

// { key, n } for "just now" (key 'AgoNow', no n) / minutes / hours / days. Null when unparseable.
export function ageParts(iso, now = Date.now()) {
  const ms = Date.parse(iso)
  if (!iso || Number.isNaN(ms)) return null
  const mins = Math.max(0, Math.floor((now - ms) / 60000))
  if (mins < 1) return { key: 'AgoNow' }
  if (mins < 60) return { key: 'AgoMin', n: mins }
  const hours = Math.floor(mins / 60)
  if (hours < 48) return { key: 'AgoHour', n: hours }
  return { key: 'AgoDay', n: Math.floor(hours / 24) }
}

// "15 Nov, 14:32" in Cyprus time (EET/EEST handled by Intl). Falls back to the raw ISO.
export function formatFamagusta(iso, locale = 'en-GB') {
  const ms = Date.parse(iso)
  if (!iso || Number.isNaN(ms)) return null
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: 'Asia/Famagusta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(ms))
  } catch {
    return String(iso)
  }
}
