// Date helpers shared by the profile wizard and ProfileScreen.
//
// ageOn() is here rather than in either screen because it MIRRORS THE DATABASE. The
// 13-year minimum cannot be a CHECK constraint — CURRENT_DATE is STABLE and a CHECK
// requires IMMUTABLE — so it lives in check_profile_name_content()'s
// `date_of_birth > current_date - interval '13 years'`, and every client-side check of it
// is a mirror that must agree. Two copies of a mirror is two chances to drift from the
// one thing that actually enforces the rule, and the drift would show up as the database
// raising UNDERAGE on a date the client just accepted.
//
// The number itself is NEVER inlined here: MIN_SIGNUP_AGE lives in
// constants/profileGate.js, callers pass it, and `npm run profile:check` reads both this
// repo's copy and the trigger body and fails if they disagree.

export const pad = n => String(n).padStart(2, '0')

// Age in whole years at `now`.
export function ageOn(y, m, d, now = new Date()) {
  let age = now.getFullYear() - y
  const beforeBirthday =
    now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)
  if (beforeBirthday) age -= 1
  return age
}

// 31 when the month or year is not yet chosen: the day list has to exist before the
// other two dropdowns are touched, and a real month narrows it on the next render.
export function daysInMonth(y, m) {
  if (!y || !m) return 31
  return new Date(y, m, 0).getDate()
}
