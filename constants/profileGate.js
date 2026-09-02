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

export const STUDENT_LEVELS = ['university', 'postgraduate', 'high_school', 'language_course', 'vocational']

// The two levels that require an institution. A language course or a high school is not
// something we hold a directory for.
export const INSTITUTION_REQUIRED_LEVELS = ['university', 'postgraduate']

export const DISPLAY_PREFERENCES = ['display_name', 'full_name']

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
export const STEP_TITLE_KEY = { 1: 'pgTitle1', 2: 'pgTitle3' }

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
