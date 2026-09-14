// Student Hub arrival tasks — the pure rules. No React Native, no storage, no network,
// so they run under plain node. The shell around them is studentTasks.js.
//
// Everything a student ticks is DEVICE-LOCAL: no table, no user_id. A guest behaves
// exactly like a signed-in user, and a reinstall starts clean.

export const KEY_CACHE    = 'ada_student_tasks_cache_v1'
export const KEY_PROGRESS = 'ada_student_task_progress_v1'

// `lang` is the full English name the app stores ('Turkish'), matching
// student_task_i18n.lang. Anything else — including a legacy 'en' still sitting in a
// profile row — falls through to English, exactly as t() does.
export const FALLBACK_LANG = 'English'

export function pickContent(task, lang) {
  const rows = Array.isArray(task?.student_task_i18n) ? task.student_task_i18n : []
  return rows.find(r => r?.lang === lang) || rows.find(r => r?.lang === FALLBACK_LANG) || null
}

// The database CHECK guarantees this shape for fresh rows; the filter is for a cache
// written by an older build.
export function stepsOf(content) {
  if (!Array.isArray(content?.steps)) return []
  return content.steps.filter(s => typeof s?.id === 'string' && typeof s?.text === 'string')
}

export function documentsOf(content) {
  if (!Array.isArray(content?.documents)) return []
  return content.documents.filter(d => typeof d === 'string' && d.trim() !== '')
}

// Progress is { [slug]: { [stepId]: true } }. Counted against the steps that exist NOW,
// so a tick on a step the content no longer has does not inflate the total.
export function countDone(progress, slug, steps) {
  const ticked = progress?.[slug] || {}
  return steps.filter(s => ticked[s.id] === true).length
}

export function isTicked(progress, slug, stepId) {
  return progress?.[slug]?.[stepId] === true
}

export function toggleStep(progress, slug, stepId) {
  const ticked = { ...(progress?.[slug] || {}) }
  if (ticked[stepId] === true) delete ticked[stepId]
  else ticked[stepId] = true
  const next = { ...(progress || {}) }
  if (Object.keys(ticked).length) next[slug] = ticked
  else delete next[slug]
  return next
}

export function resetTask(progress, slug) {
  const next = { ...(progress || {}) }
  delete next[slug]
  return next
}

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)

export function parseProgress(raw) {
  try {
    const v = JSON.parse(raw)
    return isPlainObject(v) ? v : {}
  } catch {
    return {}
  }
}

export function parseCache(raw) {
  try {
    const v = JSON.parse(raw)
    return isPlainObject(v) && Array.isArray(v.tasks) && v.tasks.length ? v : null
  } catch {
    return null
  }
}
