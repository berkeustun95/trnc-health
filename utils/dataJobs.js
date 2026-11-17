// Pure helpers for the admin "Data jobs" screen. `state` is computed by the server
// (admin_data_jobs); nothing here recomputes it, it only groups and counts.
// Display group index (see GROUP_IDS).
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

// Non-empty groups only, in display order: attention, paused / off, no run record (also unknown states), healthy.
// Server order is kept inside a group.
const GROUP_IDS = ['attention', 'paused', 'noRecord', 'ok']
export function groupJobs(jobs) {
  const buckets = GROUP_IDS.map(id => ({ id, jobs: [] }))
  for (const j of jobs || []) buckets[groupOf(j)].jobs.push(j)
  return buckets.filter(g => g.jobs.length > 0)
}

// An empty or non-array result is an error: the registry cannot legitimately be empty.
export function isUsableJobs(data) {
  return Array.isArray(data) && data.length > 0
}

// A row the screen can trust: boolean attention, string key and state. An unknown state string is still valid.
export function isValidJob(j) {
  return !!j && typeof j.attention === 'boolean' && typeof j.key === 'string' && typeof j.state === 'string'
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

// i18n key for a failed pause/resume. The RPC raises ADMIN_ONLY / UNKNOWN_JOB / NOT_SWITCHABLE / NOTE_REQUIRED / BAD_ARGS;
// a function that is not deployed yet is PostgREST PGRST202 / 404 ("not available yet"). Anything else is generic.
export function switchErrorKey(error) {
  const msg = `${error?.message ?? ''} ${error?.details ?? ''}`
  if (error?.code === 'PGRST202' || error?.status === 404 || /PGRST202|Could not find the function/i.test(msg)) return 'adminJobsErrUnavailable'
  if (/NOTE_REQUIRED/.test(msg)) return 'adminJobsErrNote'
  if (/NOT_SWITCHABLE/.test(msg)) return 'adminJobsErrNotSwitchable'
  if (/ADMIN_ONLY/.test(msg)) return 'adminJobsErrAdminOnly'
  return 'adminJobsErrGeneric'
}
