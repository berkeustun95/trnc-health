// Pure helpers for the admin "Data jobs" screen. `state` is computed by the server
// (admin_data_jobs); nothing here recomputes it, it only groups and counts.
// Display groups, in order. Server order is kept inside a group (Array.prototype.sort is stable).
// `attention` is computed by the server; a deliberately-off job is inactive with attention false.
const groupOf = job => {
  if (job?.attention === true) return 0
  if (job?.state === 'paused' || job?.state === 'inactive') return 1
  if (job?.state === 'ok') return 3
  return 2
}

export function countAttention(jobs) {
  return (jobs || []).filter(j => j?.attention === true).length
}

export function countNoRecord(jobs) {
  return (jobs || []).filter(j => j?.state === 'no_record').length
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
