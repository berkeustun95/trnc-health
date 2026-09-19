// Profile completion gate — the single source of truth for every value the gate and
// the wizard key on. Imported by App.js, the wizard, and scripts/check-profile-gate.mjs
// (which runs it under plain Node), so this file imports NOTHING.
//
// Anything here that also exists in SQL is mirrored in
// supabase/migrations/20261001_profile_completion_schema.sql, and
// `npm run profile:check` fails if the two disagree. Two halves that must agree
// character-for-character, same contract as utils/moderationNormalize.js and
// 20260925_moderation_normalization.sql.

// ─── AGE ─────────────────────────────────────────────────────────────────────
// Matches the Google Play target-age declaration of 2026-08-29 (13-15 / 16-17 / 18+),
// which makes ADA a declared MIXED-AUDIENCE app.
//
// NEVER INLINE THIS. It appears exactly twice: here, and as `interval '13 years'` in
// the check_profile_name_content() trigger. The probe reads both.
export const MIN_SIGNUP_AGE = 13

// Oldest plausible account holder. Only used to bound the year dropdown.
export const MAX_SIGNUP_AGE = 100

// Majority, for the messaging age rule: an adult may not INITIATE a conversation with an
// under-18. Minor→minor, minor→adult and adult→adult are all fine; only adult→minor is
// refused, and it is refused server-side in may_initiate_by_age() because a client-side
// age check is a client-side age check.
//
// NEVER INLINE THIS EITHER. Exactly twice, same contract as MIN_SIGNUP_AGE: here, and as
// `interval '18 years'` in may_initiate_by_age() (20261029). It cannot be a CHECK
// constraint — CURRENT_DATE is STABLE and a CHECK needs IMMUTABLE — so a function is the
// only home it has. `npm run profile:check` fails if the two halves disagree, and the
// migration's own DO block fails if a SECOND function in the schema grows a copy.
export const ADULT_AGE = 18

// ─── SCHEMA VERSION ──────────────────────────────────────────────────────────
// The gate fires when profiles.profile_schema_version < this. The column DEFAULTs to 0
// in the database, so every existing row and every new signup is gated until the wizard
// writes this value. Bump it — and only then — when a future slice adds a field that
// existing completed profiles must come back and fill in.
export const CURRENT_PROFILE_SCHEMA_VERSION = 1

// ─── EXEMPTIONS ──────────────────────────────────────────────────────────────
// What stays reachable with an incomplete profile. These are what people open in an
// emergency; blocking someone from finding an on-duty pharmacy at 2am is not acceptable.
export const GATE_EXEMPT_MODULES = ['pharmacy', 'health', 'towing']

// ⚠ THE KEYS ABOVE ARE MODULE IDENTIFIERS AND THEY DO NOT SAY WHAT THEY GRANT.
//   'health' in particular does NOT mean the health module: HomeScreen's hub carries a
//   tile for every marketplace module, so granting "the health module" would grant the
//   whole app. What is actually granted is the FACILITY DIRECTORY and a FACILITY
//   PROFILE, READ-ONLY — HomeScreen in its facility-list mode with the hub unreachable.
//   This map is the real contract; the array above is just its key set, kept because the
//   spec names those three strings.
//
// These are the screens the GATE BLOCK ITSELF renders. TowingDetailScreen is exempt in
// effect but is NOT listed: TowingScreen renders it internally (TowingScreen.js:224), so
// naming it here would make the probe permanently red against a correct gate — and a
// checker carrying a known-false positive teaches the reader to skim, which is how the
// next real failure gets skimmed too.
export const GATE_EXEMPT_SCREENS = {
  pharmacy: ['DutyListScreen'],
  health:   ['HomeScreen', 'FacilityProfileScreen'],
  towing:   ['TowingScreen'],
}

// READ-ONLY IS ENFORCED, NOT IMPLIED. FacilityProfileScreen routes every write —
// ask a question, write a review, report content — through its onRequireAccount prop,
// and booking is already hidden for health types ("directory only"). The gate therefore
// passes a profile-completion sheet in place of the guest sheet, which closes all three
// at once with no change to that screen. These two names are what
// scripts/check-profile-gate.mjs asserts the gate block actually does, so "read-only"
// is a check rather than a comment.
export const GATE_READONLY_PROP = 'onRequireAccount'
export const GATE_READONLY_HANDLER = 'requireProfileCompletion'
// Must NOT appear in the gate block: it is the one write path that does not go through
// the prop above.
export const GATE_FORBIDDEN_PROP = 'onBook'

// ─── FIELD VOCABULARIES ──────────────────────────────────────────────────────
// Each list is mirrored by a CHECK constraint in 20261001. Order is the ORDER THE
// WIZARD RENDERS THEM IN and is a product decision, not alphabetical.
export const RESIDENT_STATUSES = ['student', 'working', 'resident', 'visiting']

// The one status that carries conditional logic: it is the only value of the four that
// makes student_level required, in the CHECK constraint and in both screens. Named HERE
// rather than written as a literal in the screens, for the same reason
// INSTITUTION_REQUIRED_LEVELS is a named subset — and because
// scripts/check-profile-gate.mjs forbids a vocabulary literal inside an array in either
// screen, which is what caught the first attempt at this.
//
// Derived from the list, so it cannot name a status the vocabulary no longer contains.
// NOT RESIDENT_STATUSES[0]: the order above is documented as the wizard's render order and
// is a product decision, so an index would quietly become 'working' the day someone
// reorders the chips.
export const RESIDENT_STATUS_STUDENT = RESIDENT_STATUSES.find(s => s === 'student')

export const STUDENT_LEVELS = ['university', 'postgraduate', 'high_school', 'language_course', 'vocational']

// The two levels that require an institution. A language course or a high school is not
// something we hold a directory for.
export const INSTITUTION_REQUIRED_LEVELS = ['university', 'postgraduate']

export const DISPLAY_PREFERENCES = ['display_name', 'full_name']

// ─── student_education's disclosable columns (20261026) ─────────────────────
//
// THIS EXISTS TO STOP A GUARD GOING GREEN BECAUSE THE DATA MOVED.
// check-privacy-parity derives what must be disclosed from App.js PROFILE_COLUMNS. When
// 20261027 drops institution_id / study_start_year / study_end_year / subject_id /
// student_listing_opt_in from profiles, they leave that list — and the disclosure rules
// for them stop being exercised, while the obligation is completely unchanged, because
// the app still collects every one of these facts. The guard would certify its own blind
// spot, which is worse than having no guard.
//
// So the guard reads BOTH lists. Keep this in step with the table: a column added here
// fails the guard until it is disclosed in all four privacy copies or exempted with a
// reason, which is the review moment a hardcoded list never creates.
//
// `level` is here because it is the SAME FACT as profiles.student_level — recorded once
// per enrolment rather than once per person — and that fact is already disclosed as
// "study level" in all four copies. An earlier draft left it out on the reasoning that a
// "university details" sentence covered it; no copy says that, and reasoning a column off
// the list is how a derived guard turns back into a remembered one.
export const EDUCATION_COLUMNS = [
  'institution_id', 'level', 'subject_id', 'study_start_year', 'study_end_year', 'listing_opt_in',
]

// ─── AFFILIATION PATCH (20261024) — REMOVED 2026-09-19, and not coming back ──
//
// affiliationPatch() existed because five profiles columns were coupled by four CHECKs,
// so a patch honouring three of them failed on the fourth with a 23514 on a live screen.
// It was the single writer for two slices, and both of its callers are gone:
// ProfileScreen and ProfileSetupScreen now write enrolments to student_education, and
// 20261027 drops the columns it existed to keep consistent.
//
// Deliberately deleted rather than left unused. A helper whose whole job is to write
// dropped columns is a loaded gun for the next person who greps for "how do I set the
// institution" — and it would 42703 the moment they called it. The coupling rules it
// encoded live on in the claim-then-clear-then-retry branch in both screens, which is the
// only code that may name those columns at all and can only run while they exist.
//
// student_level is NOT one of the five and is still written by both screens directly.

// Mirrors the static bound on both year CHECKs in 20261024. The upper bound a picker
// offers is NOT 2100: it is the current UTC year (studyYearCeiling in utils/studyFields.js),
// because check_profile_study_years() rejects a future end year.
export const STUDY_YEAR_MIN = 1950

// Raised by check_profile_study_years() as P0001, not 23514 — matched on the message.
export const STUDY_END_YEAR_IN_FUTURE = 'STUDY_END_YEAR_IN_FUTURE'

// i18n keys for the two single-select groups. They live HERE, not inside the wizard,
// for the same reason REGION_LABEL_KEY lives in constants/regions.js:
// scripts/validate-i18n-coverage.mjs finds keys by scanning surface files for a LITERAL
// t('key'), and cannot see one reached through a variable — t(RESIDENT_STATUS_LABEL_KEY[s]).
// That blind spot is what let menuGarages sit untranslated in seven locales. Exported
// from constants/ so the guard imports the map and covers every value the moment it is
// added.
export const RESIDENT_STATUS_LABEL_KEY = {
  student:  'pgStatusStudent',
  working:  'pgStatusWorking',
  resident: 'pgStatusResident',
  // The value stays 'visiting' while the label reads "Tourist" / "Ziyaretçiyim". Renaming
  // it to 'tourist' would mean a second CHECK-constraint migration for a string no user
  // ever sees, and the two halves must agree character-for-character — a rename is a
  // drift opportunity bought for nothing.
  visiting: 'pgStatusVisiting',
}

// Same reason as the two maps below: a key reached through a variable — or through a
// TEMPLATE LITERAL, t(`pgTitle${step}`) — is invisible to the guard's literal scan. That
// is not hypothetical; the first draft of ProfileSetupScreen hid eleven keys this way and
// the i18n check went green over them.
// TWO steps, and step 2 keys pgTitle3 rather than pgTitle2. The old step 2 ("About you")
// was merged INTO step 1, so its title has no screen left to head and its i18n key is
// gone from all nine locales; the surviving titles are the ones that still describe a
// screen. Renumbering the keys would rewrite nine locales to say the same words under a
// different name.
// Steps 3 and 4 are the OPTIONAL study steps (Slice 2), reached only after step 2 has
// written profile_completed_at.
export const STEP_TITLE_KEY = { 1: 'pgTitle1', 2: 'pgTitle3', 3: 'pgTitleSubject', 4: 'pgTitleStudyYears' }

export const HELP_ROW_LABEL_KEY = {
  numbers:   'pgHelpNumbers',
  duty:      'pgHelpDuty',
  directory: 'pgHelpDirectory',
}

export const STUDENT_LEVEL_LABEL_KEY = {
  university:      'pgLevelUniversity',
  postgraduate:    'pgLevelPostgraduate',
  high_school:     'pgLevelHighSchool',
  language_course: 'pgLevelLanguageCourse',
  vocational:      'pgLevelVocational',
}

// Debounce on the display-name availability call. Long enough not to fire per keystroke,
// short enough that the answer is on screen before a fast typist reaches Continue.
export const DEBOUNCE_MS = 400

// Where a reserved-name false positive goes. "Ada" is a common Turkish woman's name, so
// this is a predictable outcome for a real user, not a hypothetical — the message names
// the reservation and offers a way out rather than failing generically.
export const SUPPORT_EMAIL = 'getadaapp@gmail.com'

// ─── DISPLAY NAME ────────────────────────────────────────────────────────────
export const DISPLAY_NAME_MIN = 3
export const DISPLAY_NAME_MAX = 20

// Statuses returned by the display_name_available() RPC. Each one gets its own copy in
// the wizard: a RESERVED name is not an obscenity and must not read as one.
export const NAME_STATUS = ['available', 'taken', 'reserved', 'blocked', 'invalid']

// ─── NATIONALITY ─────────────────────────────────────────────────────────────
// The TRNC has no ISO 3166-1 alpha-2 code and is this app's single most relevant
// nationality. XN sits in the ISO user-assigned range XA-XZ, which exists for exactly
// this. Do not "correct" it to CY — that is the Republic of Cyprus.
export const TRNC_NATIONALITY_CODE = 'XN'
