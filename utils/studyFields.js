// Subjects and the study-year ceiling for the Slice 2 study fields (20261024). Imports
// nothing, so it runs under plain Node for the tests.

// Ids are permanent, slugs are not — 'other' is found by id.
export const OTHER_SUBJECT_ID = '00000000-0000-4000-d000-0000000000ff'

const FALLBACK_LANG = 'English'

// lang, then English, then any language that has one. null = no name anywhere.
export function subjectName(row, lang) {
  const names = (row?.subject_i18n ?? []).filter(n => typeof n?.name === 'string' && n.name.trim())
  const hit = names.find(n => n.lang === lang) ?? names.find(n => n.lang === FALLBACK_LANG) ?? names[0]
  return hit ? hit.name.trim() : null
}

// Rows with no name in any language are DROPPED, not rendered blank: a subject_i18n gap
// must not put an empty, selectable row in front of a user.
export function subjectOptions(rows, lang) {
  return (rows ?? [])
    .map(r => ({ value: r.id, label: subjectName(r, lang), sort: r.sort_order ?? 0, other: r.id === OTHER_SUBJECT_ID }))
    .filter(o => o.label)
    .sort((a, b) => (a.other - b.other) || (a.sort - b.sort))
    .map(({ value, label }) => ({ value, label }))
}

// The upper bound for a study-year picker. The UTC year, never getFullYear(): at 00:30 on
// 1 January in Nicosia (UTC+3) the local year is already the new one while the database's
// current_date (UTC on prod) is not. The device clock is otherwise trusted — for the
// few hours a year it is wrong, check_profile_study_years() rejects a future end year and
// both screens show STUDY_END_YEAR_IN_FUTURE as a sentence.
export const studyYearCeiling = () => new Date().getUTCFullYear()

// Newest first. maxYear is studyYearCeiling(); minYear is STUDY_YEAR_MIN, or the start
// year for the end-year list (profiles_study_years_order_check).
export function studyYearOptions(maxYear, minYear) {
  const out = []
  for (let y = maxYear; y >= minYear; y--) out.push({ value: y, label: String(y) })
  return out
}
