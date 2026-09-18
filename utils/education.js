// ─── The education editor's rules, with nothing around them ─────────────────
//
// ► THIS MODULE IMPORTS NOTHING, AND THAT IS LOAD-BEARING.
//   Every rule below mirrors a CHECK, a trigger or a unique index on
//   student_education (20261026). A rule that disagrees with the database produces a
//   23514 on a live screen, so these need to be testable under plain Node against the
//   real functions rather than a copy — the same reason constants/messaging.js and
//   constants/profileGate.js import nothing.
//
// ─── WHAT THE SCHEMA MAKES TRUE, WHICH THE UI ONLY MIRRORS ─────────────────
//
//   student_education_one_open_per_user
//     UNIQUE (user_id) WHERE study_end_year IS NULL
//     → AT MOST ONE open enrolment. "Currently studying" is a section that holds one row
//       or none, and that is not a UI convention — the index makes a second one
//       impossible. The UI mirrors the constraint instead of inventing its own.
//
//   student_education_user_inst_level_key
//     UNIQUE (user_id, institution_id, level)
//     → The same degree at the same place cannot exist twice. Adding "EMU, university"
//       when that row already exists must EDIT it, never insert.
//
//   student_education_years_order_check
//     CHECK (study_end_year IS NULL OR (study_start_year IS NOT NULL AND end >= start))
//     → An end year requires a start year. This is why a past enrolment needs both.
//
//   check_student_education_years (BEFORE INSERT OR UPDATE → check_profile_study_years)
//     → Rejects a FUTURE end year, as P0001 'STUDY_END_YEAR_IN_FUTURE'. The picker's
//       ceiling is the current UTC year for that reason, not 2100.

// Columns the editor reads. `mirror_owned` is read but never shown: it decides whether a
// row is still the transition trigger's to touch, which changes what a write must do.
export const EDUCATION_SELECT =
  'id, institution_id, level, subject_id, study_start_year, study_end_year, listing_opt_in, mirror_owned'

export const LEVELS = ['university', 'postgraduate']

// ─── CURRENT vs PREVIOUS is derived, never stored ──────────────────────────
//
// `study_end_year IS NULL` is the whole definition of "currently studying", and it is
// only a definition because of the partial unique index above. Deriving it here rather
// than carrying an `is_current` flag means the UI cannot disagree with the database.
export function splitEnrolments(rows) {
  const list = Array.isArray(rows) ? rows : []
  const current = list.find(r => r && r.study_end_year == null) || null
  const past = list
    .filter(r => r && r.study_end_year != null)
    .sort((a, b) => (b.study_end_year - a.study_end_year) || (b.study_start_year ?? 0) - (a.study_start_year ?? 0))
  return { current, past }
}

// Is this the same enrolment as an existing row? Matches the UNIQUE key exactly —
// (institution, level) within one user — so the caller can route an "add" that collides
// into an edit rather than a 23505.
export function findSameEnrolment(rows, { institutionId, level }, exceptId = null) {
  const list = Array.isArray(rows) ? rows : []
  return list.find(r =>
    r && r.id !== exceptId && r.institution_id === institutionId && r.level === level) || null
}

// ─── Draft validation, mirroring the constraints in the same order ─────────
//
// Returns an i18n key, or null when the draft is writable. Never a raw message: the
// caller renders this, and a constraint name on screen is not copy.
export function enrolmentError(draft, { yearCeiling, minYear = 1950 } = {}) {
  if (!draft) return 'eduErrIncomplete'
  const { institutionId, level, startYear, endYear } = draft

  // institution_id and level are both NOT NULL on the table.
  if (!institutionId) return 'eduErrNeedInstitution'
  if (!LEVELS.includes(level)) return 'eduErrNeedLevel'

  const hasStart = startYear != null
  const hasEnd = endYear != null

  // student_education_years_order_check: an end year requires a start year, and the CHECK
  // is written with an explicit IS NOT NULL arm precisely because `end >= start` is
  // UNKNOWN when start is NULL — and a CHECK passes on UNKNOWN.
  if (hasEnd && !hasStart) return 'eduErrEndNeedsStart'
  if (hasEnd && hasStart && endYear < startYear) return 'eduErrYearsOrder'

  // check_profile_study_years() raises STUDY_END_YEAR_IN_FUTURE. Caught here so the user
  // is told before the write rather than by a rejected save.
  if (hasEnd && yearCeiling != null && endYear > yearCeiling) return 'eduErrEndFuture'

  // Sanity bounds, matching the two range CHECKs.
  if (hasStart && (startYear < minYear || startYear > 2100)) return 'eduErrYearRange'
  if (hasEnd && (endYear < minYear || endYear > 2100)) return 'eduErrYearRange'

  return null
}

// ─── The row an editor write sends ─────────────────────────────────────────
//
// ► mirror_owned IS ALWAYS false, AND IT IS ALWAYS NAMED.
//   On INSERT the column already defaults to false, so naming it changes nothing — but on
//   UPDATE it is the whole point. The transition trigger may only touch rows it created
//   (mirror_owned true: the backfill and its own inserts), and the app editing one of
//   those must CLAIM it in the same write. 20261026's unlist branch is scoped
//   `WHERE user_id = NEW.id AND mirror_owned`, so an unclaimed row is still the trigger's
//   to unlist and a claimed one is not.
//
//   Naming it in both paths rather than relying on the default also means one grep answers
//   "does the app ever leave a row trigger-owned", which a default cannot.
export function enrolmentRow(draft, { userId, listingOptIn }) {
  return {
    user_id: userId,
    institution_id: draft.institutionId,
    level: draft.level,
    subject_id: draft.subjectId ?? null,
    study_start_year: draft.startYear ?? null,
    study_end_year: draft.endYear ?? null,
    listing_opt_in: listingOptIn === true,
    mirror_owned: false,
  }
}

// ─── Does this save have to clear the stale profiles columns? ──────────────
//
// The ONE case where the editor must touch profiles' affiliation columns at all, and it
// is forced by two CHECKs pulling in opposite directions:
//
//   profiles_student_level_coupling_check
//     CHECK (student_level IS NULL OR (resident_status IS NOT NULL AND resident_status = 'student'))
//     → leaving 'student' REQUIRES student_level to go null in the same write.
//
//   profiles_institution_coupling_check
//     CHECK (institution_id IS NULL
//            OR (student_level IS NOT NULL AND student_level IN ('university','postgraduate'))
//            OR study_end_year IS NOT NULL)
//     → with student_level now null, a stale non-null institution_id only survives on the
//       third arm. A stale study_end_year saves a graduate; a CURRENT student has none.
//
// So the reachable set is exact and narrow: someone whose profiles row still carries an
// institution with NO end year, changing their status away from 'student'. Everyone else
// — graduates, and anyone whose profiles columns are already clear — is unaffected.
//
// ─── WHY THIS IS DETECTED FROM THE ERROR AND NOT PREDICTED FROM A READ ─────
//
// The obvious shape is to SELECT the stale columns and decide up front. That shape breaks
// this build on the day it is supposed to pay off: 20261027 drops those five columns after
// this release has soaked, and THIS is the release that will be installed when it does. A
// screen that names a dropped column 42703s through PostgREST — which is the exact outage
// (`column does not exist`) the whole OTA-before-drop sequencing exists to avoid, just
// pointed at a different screen.
//
// So the editor never reads them and never speculatively writes them. It saves WITHOUT
// them, and only if the database refuses does it do anything about it:
//
//   before 20261027, common case  → one write, succeeds
//   before 20261027, narrow case  → 23514, then claim rows, then retry WITH the clear
//   after  20261027               → the columns and their CHECKs are gone, so the first
//                                    write always succeeds and the retry is unreachable
//
// The retry is the only place the five are ever named, and it can only be reached while
// they still exist. That is what makes this release safe on both sides of the drop.
export function isInstitutionCouplingBlock(error) {
  const message = `${error?.message ?? ''} ${error?.details ?? ''}`
  return error?.code === '23514' && message.includes('profiles_institution_coupling_check')
}

// The five columns 20261027 drops, cleared together because the CHECKs couple them:
// profiles_study_fields_require_institution_check needs the study fields to go with the
// institution, and profiles_listing_opt_in_requires_institution_check needs the opt-in to.
// Sent ONLY when needsProfilesClear() is true.
export function profilesAffiliationClear() {
  return {
    institution_id: null,
    study_start_year: null,
    study_end_year: null,
    subject_id: null,
    student_listing_opt_in: false,
  }
}
