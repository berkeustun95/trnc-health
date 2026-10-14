// ─── Island Calendar (Home lab, Variant C): the Oli pill line and hero wash for a dated day ──
// Pure data + small functions, no React. The key list is exported so scripts/check-tile-labels.mjs
// measures every key it can return (it reads the array below as text: keep it on one line).

export const CAL_PILL_KEYS = ['hrCalNewYear', 'hrCalPublicHoliday', 'hrCalBayram']

const KIND_KEY = {
  newYear: 'hrCalNewYear',
  publicHoliday: 'hrCalPublicHoliday',
  bayram: 'hrCalBayram',
  bayramEve: 'hrCalBayram',
}

/** i18n key for an islandCalendar entry, or null (an ordinary day). */
export function calPillKey(day) {
  return (day && KIND_KEY[day.kind]) || null
}

/** The DEVICE-local date as 'YYYY-MM-DD' (never UTC: toISOString would flip the day at night). */
export function localDateStr(now = new Date()) {
  const p = n => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}
