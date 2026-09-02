// Extensions are explicit so plain Node (scripts/check-duty-staleness.mjs) can import
// this and exercise the REAL classifier instead of a copy. Metro resolves both forms.
//
// ─── ONE CLASSIFIER, TWO CONSUMERS ──────────────────────────────────────────
//
// DutyListScreen and the staleness check must agree on what "stale" means. Two
// implementations would drift the first time either was tuned, and the drift would be
// invisible: both would keep working and disagree. The screen would tell a user the list
// is fine while the check said it had run out, or the reverse.
//
// ─── WHY "ABSENT" IS NOT A NORMAL OUTCOME ───────────────────────────────────
//
// There is ALWAYS a duty pharmacy in the TRNC — that is the entire point of the rotation.
// Measured against the only real roster we have (duty_june_2026.sql): 30 of 30 days
// covered, 13-15 pharmacies per day, every region every day, zero gaps.
//
// So zero rows for a date NEVER describes the world. It describes our missing data. Any
// UI built on this classifier must therefore treat 'stale' and 'absent' as OUR failure
// and hand the user a way through — never as a neutral "no duty pharmacy tonight", which
// is both false and, at 2am, dangerous.

export const DUTY_FRESH   = 'fresh'   // rows for today across a plausible spread of districts
export const DUTY_PARTIAL = 'partial' // rows for today, but so few districts the roster is broken
export const DUTY_STALE   = 'stale'   // rows exist, but none for today: the roster ran out or has a gap
export const DUTY_ABSENT  = 'absent'  // no rows at all: never seeded, or wiped

// ─── THE COVERAGE THRESHOLD, MEASURED — NOT GUESSED ─────────────────────────
//
// All 121 days in duty_list, grouped by date, read 2026-09-02:
//
//     13 rows / 6 districts -> 17 days        1 row / 1 district -> 2 days
//     13 rows / 7 districts -> 50 days
//     15 rows / 6 districts -> 14 days
//     15 rows / 8 districts -> 38 days
//
// 119 normal days sit at 13-15 rows across 6-8 districts; the 2 broken days sit at
// 1 row / 1 district. NOTHING lies between 1 district and 6, so any threshold inside
// that gap separates the populations cleanly. 3 leaves ~2 districts of slack each side.
//
// DISTRICTS, NOT ROW COUNT, and the difference decides a real case. A count is
// confounded twice: a district legitimately carries 1-3 duty pharmacies a night, and a
// roster of 13 rows ALL IN ONE DISTRICT — an import that parsed one district's page
// repeatedly — passes a count test while being exactly the failure this state exists to
// catch. Coverage cannot be fooled that way, and it measures what actually harms
// someone: whether their own district appears at all. 28/29 Eylül 2026 are the live
// case — one pharmacy each, in Karpaz and İskele, so a user anywhere else saw a
// confident list containing nothing they could reach.
export const PARTIAL_MAX_DISTRICTS = 3

// todayCount:     number of duty_list rows whose duty_date === today
// todayDistricts: distinct `region` values among those rows
// maxDate:        the newest duty_date in the table, or null when the table is empty
//
// ⚠ OMITTING todayDistricts DISABLES THE COVERAGE CHECK, yielding the old two-state
//   behaviour. Deliberate — inventing a verdict from an absent input is worse than
//   declining to judge — but it means a caller that forgets it silently loses the guard.
//   All three callers pass it. A fourth must too.
export function dutyStatus({ todayCount, maxDate, todayDistricts }) {
  if (todayCount > 0) {
    if (todayDistricts != null && todayDistricts <= PARTIAL_MAX_DISTRICTS) return DUTY_PARTIAL
    return DUTY_FRESH
  }
  return maxDate ? DUTY_STALE : DUTY_ABSENT
}

// Days of roster remaining from `today` inclusive. Null when there is nothing at all.
//
// Counts to the LAST DAY COVERED, not the number of rows — a roster that ends on the 3rd
// with 40 rows still runs out on the 3rd. Callers use this to warn while there is still
// time to act, which is the whole point: by the time todayCount hits zero, users are
// already being failed.
export function dutyDaysRemaining({ maxDate, today }) {
  if (!maxDate) return null
  const ms = Date.parse(`${maxDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)
  return Math.floor(ms / 86400000)
}

// YYYY-MM-DD in LOCAL time, matching how both consumers build "today".
//
// ⚠ Deliberately not toISOString().slice(0,10), which is UTC. TRNC runs UTC+2/+3, so
//   between local midnight and 03:00 the UTC date is still YESTERDAY — exactly the hours
//   when someone is looking for a duty pharmacy. That bug would show the previous night's
//   roster to the people least able to afford a wrong answer.
export function localDateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
