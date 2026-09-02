#!/usr/bin/env node
// ─── Profile completion gate probe ───────────────────────────────────────────
//
//   npm run profile:check
//
// Two halves that must agree — constants/profileGate.js + utils/reservedNames.js on the
// client, and the migrations in supabase/migrations/ on the database side — plus four
// live assertions against the deployed schema.
//
// "the migrations", plural and unpinned: a CHECK constraint is redefined under the same
// name by a later file, so the field-vocabulary section resolves each one to the NEWEST
// migration that defines it rather than reading 20261001 forever. See section 6.
//
// WATCHED RED FIRST. Every check below was broken deliberately and observed failing
// before it was trusted; the red output is in the journal entry for this slice. A check
// nobody has watched fail is a decoration, and it is worse than nothing because it buys
// confidence it has not earned.
//
// ─── WHAT EACH HALF CAN AND CANNOT SEE ──────────────────────────────────────
//
// The REPO half reads text. It answers "were these two files written to agree", and it
// cannot answer "was the migration applied" — same honest limit as
// scripts/check-terms-commitment.mjs, and worth saying out loud rather than letting a
// green tick imply more than it proved.
//
// The LIVE half holds only the ANON key, which is all the repo has. That is enough for
// four things that matter, and each is paired with a POSITIVE CONTROL, because a zero
// from a working instrument and a zero from a dead one are the same character on the
// screen:
//   • reserved_names is world-readable by design (the client mirrors it inline), so the
//     live rows can be compared against utils/reservedNames.js term for term. This is
//     the only check here that survives an admin editing the table at runtime.
//   • institutions must return ZERO rows to anon — its single policy is TO authenticated.
//     Control: reserved_names returns rows through the identical request path.
//   • profiles must return ZERO rows to anon.
//   • display_name_available must be UNREACHABLE by anon. Control: an RPC anon IS
//     allowed to call returns 200 through the identical path.
//
// The one thing NEITHER half can check is normalize_display_name() itself: it is
// REVOKEd from anon and authenticated on purpose (no new RPCs), so there is no way to
// call it from here. Its behaviour is asserted inside the migration's own DO block,
// which runs as postgres at apply time. The JS mirror is exercised below, and the two
// character classes are compared as literals.

import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MIN_SIGNUP_AGE, CURRENT_PROFILE_SCHEMA_VERSION, RESIDENT_STATUSES,
         STUDENT_LEVELS, DISPLAY_PREFERENCES, GATE_EXEMPT_MODULES, GATE_EXEMPT_SCREENS,
         GATE_READONLY_PROP, GATE_READONLY_HANDLER, GATE_FORBIDDEN_PROP,
       } from '../constants/profileGate.js'
import { GREEK_MONTHS, FALLBACK_MONTHS, monthNames, intlTrusted } from '../constants/months.js'
import { REGIONS } from '../constants/regions.js'
import { RESERVED_NAMES, normalizeDisplayName, isReservedDisplayName } from '../utils/reservedNames.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATIONS = resolve(ROOT, 'supabase/migrations')
const SCHEMA_FILE = '20261001_profile_completion_schema.sql'
const RPC_FILE = '20261002_display_name_availability_rpc.sql'

const fails = []
const notes = []
const fail = m => fails.push(m)
const ok = m => notes.push(`  ok   ${m}`)

const sql = readFileSync(resolve(MIGRATIONS, SCHEMA_FILE), 'utf8')
const rpcSql = readFileSync(resolve(MIGRATIONS, RPC_FILE), 'utf8')

// Slice a dollar-quoted function body out of a migration. Anchored on the CREATE line
// and terminated by the matching $function$ — NOT by the first ';', which appears inside
// every body here. A slice that runs to a terminator appearing earlier in the file is
// how a validator ends up cheerfully reporting on zero rows.
function fnBody(text, name) {
  const start = text.indexOf(`FUNCTION public.${name}(`)
  if (start < 0) return null
  const open = text.indexOf('$function$', start)
  const close = text.indexOf('$function$', open + 10)
  if (open < 0 || close < 0) return null
  return text.slice(open + 10, close)
}

// ─── 1. MIN_SIGNUP_AGE — the number that must not be inlined ─────────────────
{
  const body = fnBody(sql, 'check_profile_name_content')
  if (!body) {
    fail(`could not find check_profile_name_content() in ${SCHEMA_FILE}`)
  } else {
    const m = body.match(/current_date\s*-\s*interval\s*'(\d+)\s+years'/)
    if (!m) {
      fail(`the age rule is missing from check_profile_name_content(). It CANNOT be a ` +
           `CHECK constraint (CURRENT_DATE is STABLE), so if it is not in the trigger ` +
           `body it does not exist anywhere.`)
    } else if (Number(m[1]) !== MIN_SIGNUP_AGE) {
      fail(`MIN_SIGNUP_AGE disagrees: constants/profileGate.js says ${MIN_SIGNUP_AGE}, ` +
           `${SCHEMA_FILE} enforces ${m[1]}. The client would let a user through that ` +
           `the database then rejects, or the reverse.`)
    } else {
      ok(`MIN_SIGNUP_AGE = ${MIN_SIGNUP_AGE} in both halves`)
    }
    if (!/UNDERAGE/.test(body)) fail('the trigger does not raise UNDERAGE')
  }
}

// ─── 2. The gate actually fires for everyone ─────────────────────────────────
{
  if (!Number.isInteger(CURRENT_PROFILE_SCHEMA_VERSION) || CURRENT_PROFILE_SCHEMA_VERSION < 1) {
    fail(`CURRENT_PROFILE_SCHEMA_VERSION must be an integer >= 1, got ` +
         `${CURRENT_PROFILE_SCHEMA_VERSION} — the gate compares < against it`)
  }
  if (!/profile_schema_version\s+integer\s+NOT NULL DEFAULT 0/.test(sql)) {
    fail(`profiles.profile_schema_version must DEFAULT 0. Any other default means ` +
         `existing rows and new signups are NOT gated, and there is no backfill to ` +
         `catch it — the default IS the backfill.`)
  } else {
    ok('profile_schema_version DEFAULTs to 0, so every row starts gated')
  }
}

// ─── 3. The reserved list, term for term and mode for mode ───────────────────
function parseReservedSeed(text) {
  const start = text.indexOf('INSERT INTO public.reserved_names')
  if (start < 0) return null
  // Terminate on the ON CONFLICT line, which is the real end of this statement. Do not
  // slice to the next ';' — there is none until well past it.
  const end = text.indexOf('ON CONFLICT (term)', start)
  if (end < 0) return null
  const rows = [...text.slice(start, end).matchAll(/\(\s*'((?:[^']|'')*)'\s*,\s*'(exact|contains)'/g)]
  return rows.map(r => ({ term: r[1].replace(/''/g, "'"), mode: r[2] }))
}
{
  const seed = parseReservedSeed(sql)
  if (!seed) {
    fail(`could not parse the reserved_names seed out of ${SCHEMA_FILE}`)
  } else if (seed.length === 0) {
    fail(`the reserved_names seed parsed to ZERO rows — the parser is broken, not the ` +
         `data. Fix what it measures, not what it reports.`)
  } else {
    const a = RESERVED_NAMES.map(r => `${r.term}|${r.mode}`).sort()
    const b = seed.map(r => `${r.term}|${r.mode}`).sort()
    if (a.join('\n') !== b.join('\n')) {
      const onlyJs = a.filter(x => !b.includes(x))
      const onlySql = b.filter(x => !a.includes(x))
      fail(`reserved list drift (${a.length} in utils/reservedNames.js, ${b.length} in ` +
           `${SCHEMA_FILE})\n         only in JS:  ${onlyJs.join(', ') || '—'}\n` +
           `         only in SQL: ${onlySql.join(', ') || '—'}`)
    } else {
      ok(`reserved list matches in both halves (${seed.length} terms)`)
    }
  }
}

// ─── 4. Reserved words have NOT leaked into blocked_terms ────────────────────
// This is the failure that would land on SIX UNRELATED SURFACES: blocked_terms feeds
// contains_blocked_term(), which every UGC content trigger calls, so 'destek' or
// 'support' in there rejects ordinary reviews, questions, answers, facility
// descriptions, change requests and place submissions across the whole app.
{
  const terms = new Set()
  for (const f of readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql'))) {
    const text = readFileSync(resolve(MIGRATIONS, f), 'utf8')
    let i = 0
    for (;;) {
      const start = text.indexOf('INTO blocked_terms', i)
      if (start < 0) break
      i = start + 1
      const end = text.indexOf(';', start)
      if (end < 0) continue
      for (const m of text.slice(start, end).matchAll(/\(\s*'((?:[^']|'')*)'\s*\)/g)) {
        terms.add(m[1].replace(/''/g, "'").toLowerCase())
      }
    }
  }
  // Positive control. The seed in 20260712 carries ~54 terms; a parser that found a
  // handful has silently stopped measuring, and would then certify the separation it
  // never checked.
  if (terms.size < 40) {
    fail(`the blocked_terms parse found only ${terms.size} terms — expected 40+. The ` +
         `parser is broken, so the separation check below proves nothing.`)
  } else {
    const leaked = RESERVED_NAMES.filter(r => terms.has(r.term.toLowerCase()))
    if (leaked.length) {
      fail(`RESERVED WORDS ARE IN blocked_terms: ${leaked.map(r => r.term).join(', ')}. ` +
           `That table feeds all six UGC content triggers — these words are now being ` +
           `rejected in ordinary reviews, questions and answers app-wide.`)
    } else {
      ok(`no reserved word is in blocked_terms (${terms.size} terms scanned)`)
    }
  }
}

// ─── 5. The two space classes are literally the same set ─────────────────────
// JavaScript's \s covers the Unicode space separators and PostgreSQL's [[:space:]] does
// not (or does, depending on ctype). If the two halves fold different sets, the client
// and the server disagree about a name containing a NO-BREAK SPACE — which is
// indistinguishable from a space on screen, so the disagreement is an impersonation
// vector as well as a UX bug.
function codepoints(source, re) {
  const out = new Set()
  for (const m of source.matchAll(re)) {
    const lo = parseInt(m[1], 16)
    const hi = m[2] ? parseInt(m[2], 16) : lo
    for (let c = lo; c <= hi; c++) out.add(c)
  }
  return out
}
{
  const body = fnBody(sql, 'normalize_display_name')
  const js = readFileSync(resolve(ROOT, 'utils/reservedNames.js'), 'utf8')
  const jsBlock = js.slice(js.indexOf('const UNICODE_SPACE'), js.indexOf("]', 'g')"))
  const sqlSet = body ? codepoints(body, /U&'\\([0-9A-Fa-f]{4})(?:-\\([0-9A-Fa-f]{4}))?'/g) : new Set()
  const jsSet = codepoints(jsBlock, /\\\\u([0-9A-Fa-f]{4})(?:-\\\\u([0-9A-Fa-f]{4}))?/g)
  if (sqlSet.size === 0 || jsSet.size === 0) {
    fail(`the space-class parse found ${sqlSet.size} SQL and ${jsSet.size} JS ` +
         `codepoints — at least one side did not parse, so this check proves nothing`)
  } else {
    const onlySql = [...sqlSet].filter(c => !jsSet.has(c))
    const onlyJs = [...jsSet].filter(c => !sqlSet.has(c))
    if (onlySql.length || onlyJs.length) {
      const hex = a => a.map(c => 'U+' + c.toString(16).toUpperCase().padStart(4, '0')).join(' ')
      fail(`space-fold drift — only in SQL: ${hex(onlySql) || '—'} | only in JS: ` +
           `${hex(onlyJs) || '—'}. Client and server now normalize differently.`)
    } else {
      ok(`space fold covers the same ${sqlSet.size} codepoints in both halves`)
    }
  }
}

// ─── 6. Field vocabularies match their CHECK constraints ─────────────────────
//
// ⚠ THE NEWEST DEFINITION WINS, AND IT IS DERIVED — NOT POINTED AT. A constraint is
//   redefined by DROP-then-ADD under the SAME NAME, so reading only 20261001 answers
//   "what did the FIRST migration say", which stops being the question the moment a
//   later file narrows one (20261006 dropped 'newcomer'). Reading a fixed file would
//   then report drift against a client that is exactly right — an instrument failing
//   while the system is healthy, the standing hazard in CLAUDE.md.
//
//   check-module-flags.mjs solves the same problem for two functions with a hand-
//   maintained NOTIFY_SQL pointer, and its own comment says that pointer MUST be
//   repointed by hand or the guard blocks every push. Deriving the answer from the
//   directory has no such step: a new migration is picked up because it exists.
//
//   Comments are stripped BEFORE the scan. This file's own headers name constraints in
//   prose, and a prose mention must never win over a real ADD — the frame-of-reference
//   rule: know exactly what you are reading before comparing it to anything.
//
//   Honest limit, same as everywhere else in the repo half: this reads FILES. It says
//   the client and the newest migration were WRITTEN to agree. Whether that migration
//   was ever applied is what supabase/verify_schema.sql answers, and only if somebody
//   runs it.
const MIGRATION_FILES = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()
const stripSqlComments = text => text.split('\n').map(l => l.replace(/--.*$/, '')).join('\n')

// Balanced-paren slice from the CHECK's opening paren. The old form was lazy up to the
// first `);`, which happens to be right for `IN ('a','b'));` and quietly wrong for any
// predicate whose parens nest the other way round.
function checkBody(code, from) {
  const open = code.indexOf('(', from)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < code.length; i++) {
    if (code[i] === '(') depth++
    else if (code[i] === ')' && --depth === 0) return code.slice(open + 1, i)
  }
  return null
}

// The last ADD across sorted files wins; a DROP that is never followed by an ADD leaves
// the constraint GONE, and that must fail loudly rather than fall back to an older file.
function resolveConstraint(constraint) {
  let winner = null
  for (const file of MIGRATION_FILES) {
    const code = stripSqlComments(readFileSync(resolve(MIGRATIONS, file), 'utf8'))
    const events = []
    for (const m of code.matchAll(new RegExp(`ADD\\s+CONSTRAINT\\s+${constraint}\\s+CHECK`, 'g'))) {
      events.push({ at: m.index, kind: 'add' })
    }
    for (const m of code.matchAll(new RegExp(`DROP\\s+CONSTRAINT\\s+(?:IF\\s+EXISTS\\s+)?${constraint}\\b`, 'g'))) {
      events.push({ at: m.index, kind: 'drop' })
    }
    if (!events.length) continue
    events.sort((x, y) => x.at - y.at)
    const last = events[events.length - 1]
    winner = last.kind === 'add'
      ? { file, body: checkBody(code, last.at) }
      : { file, body: null, dropped: true }
  }
  return winner
}

function checkVocab(label, constraint, expected) {
  const found = resolveConstraint(constraint)
  if (!found) return fail(`no migration in supabase/migrations/ defines ${constraint}`)
  if (found.dropped) {
    return fail(`${found.file} DROPs ${constraint} and never re-adds it — the ${label} ` +
                `vocabulary is enforced by nothing on the database side`)
  }
  if (found.body === null) {
    return fail(`${constraint} was found in ${found.file} but its CHECK body did not ` +
                `parse — this check proves nothing about ${label}`)
  }
  const got = [...found.body.matchAll(/'([a-z_]+)'/g)].map(x => x[1])
  const a = [...expected].sort().join(',')
  const b = [...new Set(got)].sort().join(',')
  if (a !== b) fail(`${label} drift — constants: [${a}] · ${constraint} as defined in ` +
                    `${found.file}: [${b}]`)
  else ok(`${label} matches ${constraint} (${expected.length} values, newest definition: ${found.file})`)
}
checkVocab('RESIDENT_STATUSES', 'profiles_resident_status_check', RESIDENT_STATUSES)
checkVocab('STUDENT_LEVELS', 'profiles_student_level_check', STUDENT_LEVELS)
checkVocab('DISPLAY_PREFERENCES', 'profiles_display_preference_check', DISPLAY_PREFERENCES)
checkVocab('REGIONS', 'profiles_region_check', REGIONS)
checkVocab('REGIONS (institutions)', 'institutions_city_check', REGIONS)

// ─── 7. The JS mirror behaves ────────────────────────────────────────────────
// Same case table as the migration's DO block, so a divergence shows up as one side
// passing and the other failing rather than as both being quietly wrong together.
{
  const cases = [
    ['  BERKE   Ustun ', 'berke ustun', 'case fold + whitespace collapse'],
    ['Berke Ustun', 'berke ustun', 'NO-BREAK SPACE folded'],
    ['Berke Ustun', 'berke ustun', 'THIN SPACE folded'],
    ['SİKİ', 'siki', 'Turkish capital İ (the shift-key evasion)'],
    ['sık', 'sık', 'dotless ı NOT folded (sık sık must not match sik)'],
    ['göt', 'göt', 'accents NOT folded (göt must not match "got")'],
    ['BER​KE', 'berke', 'zero-width stripped'],
    ['​​', null, 'an all-invisible name normalizes to null'],
    ['Merhaba 123', 'merhaba 123', 'CONTROL — ordinary text survives intact'],
  ]
  for (const [input, expected, why] of cases) {
    const got = normalizeDisplayName(input)
    if (got !== expected) {
      fail(`normalizeDisplayName(${JSON.stringify(input)}) = ${JSON.stringify(got)}, ` +
           `expected ${JSON.stringify(expected)} — ${why}`)
    }
  }
  if (normalizeDisplayName('Berke') === normalizeDisplayName('Berkee')) {
    fail('CONTROL FAILED — two different names normalize to the same key')
  }

  const reserved = [
    ['Ada', true, 'exact mode: the bare app name'],
    ['ADA Destek', true, 'contains mode: role word'],
    ['Novest Team', true, 'contains mode: partner brand'],
    ['Gişe Kıbrıs', true, 'contains mode: TR spelling'],
    ['Gise Kibris', true, 'contains mode: ASCII spelling (no accent folding)'],
    ['Ada Yılmaz', false, 'a REAL NAME — exact mode is what stops this'],
    ['Adana Kebap', false, 'contains-mode ada would have rejected this'],
    ['Oliver', false, 'contains-mode oli would have rejected this'],
    ['Berke', false, 'CONTROL — an ordinary name'],
  ]
  for (const [input, expected, why] of reserved) {
    if (isReservedDisplayName(input) !== expected) {
      fail(`isReservedDisplayName(${JSON.stringify(input)}) = ${!expected}, expected ` +
           `${expected} — ${why}`)
    }
  }
  ok(`display-name normalization and reserved matching behave (${cases.length + reserved.length} cases)`)
}

// ─── 8. The RPC file still says what its justification rests on ──────────────
{
  const body = fnBody(rpcSql, 'display_name_available')
  if (!body) fail(`could not find display_name_available() in ${RPC_FILE}`)
  else {
    if (!/is_anonymous_session/.test(body)) {
      fail(`display_name_available() has no is_anonymous_session() guard. In Supabase ` +
           `the 'authenticated' role INCLUDES guest sessions, so the GRANT alone does ` +
           `not exclude them — the in-body guard is the only thing that does.`)
    } else ok('display_name_available() guards anonymous sessions in-body')
    if (!/REVOKE ALL ON FUNCTION public\.display_name_available\(text\) FROM anon/.test(rpcSql)) {
      fail(`${RPC_FILE} does not REVOKE the RPC from anon`)
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SLICE 2 — the wizard and the gate
// ════════════════════════════════════════════════════════════════════════════
//
// Some of these cannot pass until the wizard and the gate block exist. They report
// NOT BUILT YET rather than a vague failure, which is the honest red before
// implementation — the same shape as the live half below reporting "not applied yet".

const APP_JS = readFileSync(resolve(ROOT, 'App.js'), 'utf8')
const FLAGS = readFileSync(resolve(ROOT, 'constants/flags.js'), 'utf8')
const MODFLAGS = readFileSync(resolve(ROOT, 'scripts/check-module-flags.mjs'), 'utf8')
const MONTHS_SRC = readFileSync(resolve(ROOT, 'constants/months.js'), 'utf8')
const I18N_GUARD = readFileSync(resolve(ROOT, 'scripts/validate-i18n-coverage.mjs'), 'utf8')
const WIZARD_PATH = 'screens/ProfileSetupScreen.js'
let WIZARD = null
try { WIZARD = readFileSync(resolve(ROOT, WIZARD_PATH), 'utf8') } catch { /* not built yet */ }
const EDITOR_PATH = 'screens/ProfileScreen.js'
let EDITOR = null
try { EDITOR = readFileSync(resolve(ROOT, EDITOR_PATH), 'utf8') } catch { /* not built yet */ }

// Comments stripped before any of the scans below. Both files DISCUSS the columns they
// must not inline or write — the full_name note in ProfileScreen names the column six
// times in prose — and a scan that reads prose as code is the standing hazard in
// CLAUDE.md: it would forbid a correct file from explaining itself, and the tempting fix
// would be to delete the explanation.
const stripJsComments = text => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n')

const notBuilt = what => fail(`NOT BUILT YET — ${what}. This is the expected red before ` +
                             `Slice 2 is implemented, not a regression.`)

// ─── S2-1. The flag is dark in BOTH halves ───────────────────────────────────
{
  const inFlags = /export const PROFILE_GATE_LIVE = (true|false)/.exec(FLAGS)
  const inBase = /PROFILE_GATE_LIVE:\s*(true|false)/.exec(MODFLAGS)
  if (!inFlags) fail('PROFILE_GATE_LIVE is missing from constants/flags.js')
  else if (!inBase) {
    fail('PROFILE_GATE_LIVE is missing from EXPECTED_SCALARS in check-module-flags.mjs — ' +
         'the OTA wrapper cannot guard a flag it does not know about, and `eas update` ' +
         'bundles the WORKING TREE')
  } else if (inFlags[1] !== inBase[1]) {
    fail(`PROFILE_GATE_LIVE is ${inFlags[1]} in flags.js and ${inBase[1]} in the baseline — ` +
         `npm run check:flags would block, which is the guard working`)
  } else {
    ok(`PROFILE_GATE_LIVE = ${inFlags[1]} in both flags.js and the OTA baseline`)
  }
  // Slice between the two declarations — with a POSITIVE CONTROL, because a slice whose
  // end marker appears BEFORE its start marker returns '' and the test below then passes
  // on everything. That is the towing-seed-validator bug (CLAUDE.md: "all 4 rows valid",
  // having parsed zero), and it bit again while writing this file: a break that targeted
  // the wrong indentation changed nothing, the check went green, and it read as a dead
  // check rather than a broken test. Assert the slice contains something it must.
  const modBlock = MODFLAGS.slice(MODFLAGS.indexOf('const EXPECTED_MODULES = {'),
                                  MODFLAGS.indexOf('const EXPECTED_SCALARS = {'))
  if (!/checkins/.test(modBlock)) {
    fail('the EXPECTED_MODULES slice did not parse (no known module key in it) — the ' +
         'check below proves nothing about where PROFILE_GATE_LIVE lives')
  } else if (/PROFILE_GATE_LIVE/.test(modBlock)) {
    fail('PROFILE_GATE_LIVE is in EXPECTED_MODULES. It gates a BLOCK, not a module — a ' +
         'loop over the module map must never be able to switch it on')
  } else {
    ok(`PROFILE_GATE_LIVE is not in the module map (${modBlock.match(/^\s+\w+:/gm).length} keys scanned)`)
  }
}

// ─── S2-2/3/4. Month names, measured across all nine locales ─────────────────
// The whole table is PRINTED on every run, not just asserted, so an ICU or CLDR change
// is visible rather than inferred from a check that happens to still pass.
{
  const LANGS = { English:'en', Turkish:'tr', Arabic:'ar', Russian:'ru', Greek:'el',
                  French:'fr', Spanish:'es', German:'de', Persian:'fa' }
  const SAMPLE = m => new Date(Date.UTC(2026, m, 15))

  // (2) Every locale must be REQUESTED with the calendar pinned. Persian is the only
  // one that needs it today — measured, see constants/months.js — but a bare request
  // anywhere is a latent version of the same bug.
  if (!/-u-ca-gregory/.test(MONTHS_SRC)) {
    fail('constants/months.js does not pin the calendar with -u-ca-gregory. Persian ' +
         'resolves to the Jalali calendar and a user would pick دی for January')
  } else if (/DateTimeFormat\(\s*`?\$\{?code\}?`?\s*,/.test(MONTHS_SRC)) {
    fail('constants/months.js formats with a bare locale code somewhere — every ' +
         'DateTimeFormat must carry -u-ca-gregory')
  } else ok('every locale is requested with the calendar pinned (-u-ca-gregory)')

  // (4) THE POSITIVE CONTROL, and it is two-sided. It is not enough that the pinned
  // form gives ژانویه: the BARE form must give something DIFFERENT, or the suffix is
  // doing nothing and this check would pass on a runtime with no Persian calendar at
  // all — a probe that cannot tell a working fix from an absent problem.
  const faBare = new Intl.DateTimeFormat('fa', { month:'long', timeZone:'UTC' }).format(SAMPLE(0))
  const faGreg = new Intl.DateTimeFormat('fa-u-ca-gregory', { month:'long', timeZone:'UTC' }).format(SAMPLE(0))
  if (faGreg !== 'ژانویه') {
    fail(`CONTROL: Persian January under -u-ca-gregory is "${faGreg}", expected ژانویه. ` +
         `This runtime's ICU no longer behaves as measured — re-check the whole approach`)
  } else if (faBare === faGreg) {
    fail(`CONTROL FAILED: bare Persian January is also "${faBare}". The suffix is not ` +
         `changing anything here, so this check cannot distinguish a working pin from ` +
         `a runtime that has no Persian calendar`)
  } else {
    ok(`calendar pin verified: bare fa = "${faBare}" (Jalali) vs pinned = "${faGreg}"`)
  }

  // (3) The Greek override: 12 entries, NOMINATIVE, and every one different from what
  // ICU returns. If a future ICU starts returning the standalone form, or somebody
  // deletes the override as redundant, this goes red rather than silently reverting.
  const elIntl = Array.from({length:12}, (_, m) =>
    new Intl.DateTimeFormat('el-u-ca-gregory', { month:'long', timeZone:'UTC' }).format(SAMPLE(m)))
  if (GREEK_MONTHS.length !== 12) {
    fail(`GREEK_MONTHS has ${GREEK_MONTHS.length} entries, expected 12`)
  } else if (GREEK_MONTHS[0] !== 'Ιανουάριος') {
    fail(`GREEK_MONTHS[0] is "${GREEK_MONTHS[0]}", expected the nominative Ιανουάριος. ` +
         `ICU returns the genitive Ιανουαρίου, which reads "of January" in a dropdown`)
  } else if (monthNames('Greek')[0] !== 'Ιανουάριος') {
    fail(`monthNames('Greek')[0] is "${monthNames('Greek')[0]}" — the override is defined ` +
         `but is not reaching the UI`)
  } else {
    const same = GREEK_MONTHS.filter((g, i) => g === elIntl[i])
    if (same.length) {
      fail(`${same.length} Greek override entries are identical to ICU's genitive ` +
           `(${same.join(', ')}) — either a typo, or ICU changed and the override needs ` +
           `re-measuring`)
    } else {
      ok(`Greek override is nominative and differs from ICU's genitive in all 12 months`)
    }
  }

  // (1, your addition) ALL NINE measured, not three. Print the table every run.
  const rows = []
  let anomalies = 0
  for (const [name, code] of Object.entries(LANGS)) {
    const cal = new Intl.DateTimeFormat(`${code}-u-ca-gregory`, { month:'long' }).resolvedOptions().calendar
    let differs = 0
    for (let m = 0; m < 12; m++) {
      const only = new Intl.DateTimeFormat(`${code}-u-ca-gregory`, { month:'long', timeZone:'UTC' }).format(SAMPLE(m))
      const parts = new Intl.DateTimeFormat(`${code}-u-ca-gregory`, { month:'long', day:'numeric', timeZone:'UTC' }).formatToParts(SAMPLE(m))
      if (only !== parts.find(p => p.type === 'month').value) differs++
    }
    const shipped = monthNames(name)[0]
    rows.push(`      ${name.padEnd(8)} cal=${cal.padEnd(8)} standalone≠in-date ${String(differs).padStart(2)}/12  ships "${shipped}"`)
    if (cal !== 'gregory') { anomalies++; fail(`${name} resolves to the ${cal} calendar even with -u-ca-gregory`) }
    const names = monthNames(name)
    if (names.length !== 12 || new Set(names).size !== 12 || names.some(n => !n)) {
      anomalies++
      fail(`${name} does not yield 12 distinct non-empty month names`)
    }
  }
  // Russian is the one locale ICU gives a real standalone table for. If that ever stops
  // being true, Russian needs the same override Greek has — and the only way to notice
  // is to assert it now.
  const ruDiff = Array.from({length:12}, (_, m) => {
    const only = new Intl.DateTimeFormat('ru-u-ca-gregory', { month:'long', timeZone:'UTC' }).format(SAMPLE(m))
    const parts = new Intl.DateTimeFormat('ru-u-ca-gregory', { month:'long', day:'numeric', timeZone:'UTC' }).formatToParts(SAMPLE(m))
    return only !== parts.find(p => p.type === 'month').value
  }).filter(Boolean).length
  if (ruDiff !== 12) {
    fail(`Russian standalone months now match the in-date form in ${12 - ruDiff} of 12 ` +
         `cases — ICU has stopped supplying a standalone table and Russian needs the ` +
         `same override Greek has`)
  }
  if (!anomalies) ok(`all 9 locales: Gregorian calendar, 12 distinct month names each`)
  notes.push('       nine-locale month measurement (printed every run, never remembered):')
  rows.forEach(r => notes.push(r))

  if (!intlTrusted) {
    fail('constants/months.js reports intlTrusted = false under Node, which ships full ' +
         'ICU. The runtime control is misfiring — fix the control, not the threshold')
  } else if (!/FALLBACK_MONTHS/.test(MONTHS_SRC) || FALLBACK_MONTHS.length !== 12) {
    fail('the English fallback table is missing or malformed')
  } else {
    ok('Intl runtime control passes under Node and an English fallback exists for Hermes')
  }
}

// ─── S2-5. The wizard is inside the i18n guard's SURFACES ────────────────────
{
  const surfaces = I18N_GUARD.slice(I18N_GUARD.indexOf('const SURFACES = ['),
                                    I18N_GUARD.indexOf(']', I18N_GUARD.indexOf('const SURFACES = [')))
  if (!surfaces.includes(WIZARD_PATH)) {
    if (!WIZARD) notBuilt(`${WIZARD_PATH} is not in validate-i18n-coverage's SURFACES`)
    else fail(`${WIZARD_PATH} EXISTS but is NOT in validate-i18n-coverage's SURFACES. ` +
              `Every user is forced through this screen in whatever language they picked, ` +
              `and t() falls back to English silently — so an untranslated key renders ` +
              `English on an RTL screen and no existence check can see it`)
  } else ok(`${WIZARD_PATH} is inside the i18n guard's SURFACES`)
}

// ─── S2-6. The gate block renders EXACTLY the exempt screens, and nothing else ─
// This is the check that matters most in Slice 2. "What is reachable while gated" has
// to be one readable allow-list; if it becomes an emergent property of App.js's ~25
// branch chain, nobody can answer the question by reading anything.
{
  const start = APP_JS.indexOf('} else if (gateActive) {')
  if (start < 0) {
    notBuilt('the `} else if (gateActive) {` block is not in App.js')
  } else {
    const end = APP_JS.indexOf("} else if (profile.role === 'admin'", start)
    if (end < 0) {
      fail('the gate block is not followed by the admin branch — the chain order changed, ' +
           'and the gate must sit AFTER `loading || !profile` and BEFORE the role branches')
    } else {
      const block = APP_JS.slice(start, end)
      const rendered = new Set([...block.matchAll(/<([A-Z][A-Za-z]*Screen)\b/g)].map(m => m[1]))
      const allowed = new Set([...Object.values(GATE_EXEMPT_SCREENS).flat(), 'ProfileSetupScreen'])
      const extra = [...rendered].filter(x => !allowed.has(x))
      const missing = [...allowed].filter(x => !rendered.has(x))
      if (extra.length) {
        fail(`the gate block renders ${extra.join(', ')}, which GATE_EXEMPT_SCREENS does ` +
             `not permit. A gated user can reach it`)
      } else if (missing.length) {
        fail(`the gate block never renders ${missing.join(', ')}, which GATE_EXEMPT_SCREENS ` +
             `promises. GATE_EXEMPT_MODULES is lying to the next reader`)
      } else {
        ok(`gate block renders exactly the ${allowed.size} allowed screens ` +
           `(${GATE_EXEMPT_MODULES.join(', ')} + the wizard)`)
      }

      // S2-6b. READ-ONLY IS ENFORCED, NOT VISUALLY IMPLIED.
      if (rendered.has('FacilityProfileScreen')) {
        const okHandler = new RegExp(`${GATE_READONLY_PROP}=\\{${GATE_READONLY_HANDLER}\\}`).test(block)
        if (!okHandler) {
          fail(`the gate block renders FacilityProfileScreen without ` +
               `${GATE_READONLY_PROP}={${GATE_READONLY_HANDLER}} — asking a question, ` +
               `writing a review and reporting content all route through that prop, so ` +
               `without it a profile-less user can post`)
        } else if (new RegExp(`\\b${GATE_FORBIDDEN_PROP}=`).test(block)) {
          fail(`the gate block passes ${GATE_FORBIDDEN_PROP} — booking is the one write ` +
               `that does NOT go through ${GATE_READONLY_PROP}`)
        } else {
          ok(`read-only is enforced: writes route through ${GATE_READONLY_HANDLER}, no ${GATE_FORBIDDEN_PROP}`)
        }
      }
    }
  }
}

// ─── S2-7/8. The wizard's own two halves ─────────────────────────────────────
{
  if (!WIZARD) {
    notBuilt(`${WIZARD_PATH} does not exist`)
  } else {
    if (!/CURRENT_PROFILE_SCHEMA_VERSION/.test(WIZARD)) {
      fail(`the wizard does not write CURRENT_PROFILE_SCHEMA_VERSION. A literal ${CURRENT_PROFILE_SCHEMA_VERSION} ` +
           `there means the next bump silently fails to re-gate anyone`)
    } else ok('the wizard writes CURRENT_PROFILE_SCHEMA_VERSION, not a literal')

    // BOTH screens that write these columns, not just the wizard. Slice 3a gave
    // ProfileScreen the same ten fields; a vocabulary inlined THERE drifts from the CHECK
    // constraints exactly as silently, and the screen was outside every guard until now.
    for (const [label, src] of [['the wizard', WIZARD], [`${EDITOR_PATH}`, EDITOR]]) {
      if (!src) { notBuilt(`${label} does not exist`); continue }
      const code = stripJsComments(src)
      const inlined = []
      for (const v of [...RESIDENT_STATUSES, ...STUDENT_LEVELS, ...DISPLAY_PREFERENCES]) {
        const arr = new RegExp(`\\[[^\\]]*'${v}'[^\\]]*\\]`)
        if (arr.test(code)) inlined.push(v)
      }
      // CONTROL: the scan must be able to SEE this file's vocabulary use at all. Both
      // screens reach these lists through the imported constants, so the marker below is
      // present in a correct file and absent in one this scan failed to read — without
      // it, an unreadable or emptied file reports "no inlining" and passes.
      if (!/RESIDENT_STATUSES|RESIDENT_STATUS_LABEL_KEY/.test(code)) {
        fail(`${label} does not reference the resident-status vocabulary at all, so the ` +
             `inlining scan below proves nothing about it`)
      } else if (inlined.length) {
        fail(`${label} inlines a field vocabulary (${[...new Set(inlined)].join(', ')}) ` +
             `instead of importing it from constants/profileGate.js — the CHECK constraints ` +
             `and the UI would then drift silently`)
      } else {
        ok(`${label} takes its field vocabularies from constants/profileGate.js`)
      }
    }

    // ─── full_name has exactly ONE writer, and it is the trigger ─────────────
    // check_profile_name_content() DERIVES full_name from first_name + last_name.
    // 20261001 left ProfileScreen writing the column directly and named Slice 3 as the
    // moment that stops; two writers with disagreeing semantics is what that deferral
    // was about. A direct write does not error — it is silently overwritten on the next
    // first/last edit, or silently overwrites the derivation on this one.
    //
    // ⚠ SCANS THE .update() PAYLOADS, NOT THE FILE. The first version of this asserted
    //   `first_name:` appeared anywhere as a control, and it could not fail: the screen
    //   carries that property in its useState default and in the loaded initialForm, so
    //   deleting the actual write left the control green. Watched red, found green, fixed
    //   the instrument — the control and the claim were in different frames. Only the
    //   payload can answer "what does this screen SEND".
    if (EDITOR) {
      const code = stripJsComments(EDITOR)
      const payloads = []
      for (const m of code.matchAll(/\.update\(\s*\{/g)) {
        let depth = 0
        const open = code.indexOf('{', m.index)
        for (let k = open; k < code.length; k++) {
          if (code[k] === '{') depth++
          else if (code[k] === '}' && --depth === 0) { payloads.push(code.slice(open + 1, k)); break }
        }
      }
      const sent = payloads.join('\n')
      // SLICE CONTROL. A parse that found nothing returns '' and passes every absence
      // test below — the towing-seed-validator failure, which cheerfully reported on zero
      // rows. Assert the slice contains what the screen's whole job is before believing
      // anything it says about what is missing.
      if (payloads.length === 0) {
        fail(`${EDITOR_PATH}: no .update() payload parsed, so the full_name check proves ` +
             `nothing. Fix what this measures, not what it reports`)
      } else if (!/\bfirst_name:/.test(sent) || !/\bdisplay_name:/.test(sent)) {
        fail(`${EDITOR_PATH} sends no first_name/display_name in any of its ` +
             `${payloads.length} .update() payload(s) — the screen is not writing the ` +
             `columns it exists to edit, and the full_name absence below is vacuous`)
      } else if (/\bfull_name:/.test(sent)) {
        fail(`${EDITOR_PATH} SENDS full_name. That column is DERIVED by ` +
             `check_profile_name_content() from first_name + last_name — a second writer ` +
             `disagrees with the trigger silently, in whichever direction was written last`)
      } else {
        ok(`${EDITOR_PATH} sends first_name + display_name and never full_name ` +
           `(${payloads.length} update payload(s) scanned; trigger derives it)`)
      }
    }

    if (/MIN_SIGNUP_AGE/.test(WIZARD) === false) {
      fail('the wizard does not reference MIN_SIGNUP_AGE — the year range or the age ' +
           'comparison has the number inlined')
    }
  }
}

// ─── LIVE — anon key, four assertions, each with a positive control ──────────
try {
  for (const line of readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
} catch { /* no .env — handled below */ }

const URL_ = process.env.EXPO_PUBLIC_SUPABASE_URL
const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

if (!URL_ || !KEY) {
  fail('missing EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY (.env) — the live half did not run, ' +
       'so nothing here has been checked against the deployed schema')
} else {
  const get = path => fetch(`${URL_}/rest/v1/${path}`, { headers: { apikey: KEY } })
  const rpc = (name, body) => fetch(`${URL_}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })

  // CONTROL FIRST. If this fails, every "0 rows" below is a dead instrument, not a
  // result, and the checks that follow would certify a blind spot.
  const ctl = await get('reserved_names?select=term,match_mode')
  if (!ctl.ok) {
    fail(`live control failed: GET reserved_names -> ${ctl.status}. Either 20261001 is ` +
         `not applied yet (expected, before you paste it), or the read policy is wrong. ` +
         `Every live assertion below is UNCHECKED.`)
  } else {
    const rows = await ctl.json()
    if (!rows.length) {
      fail('reserved_names is EMPTY in the database — the seed did not land, and the ' +
           'wizard would accept "ADA Destek" as a display name')
    } else {
      const a = RESERVED_NAMES.map(r => `${r.term}|${r.mode}`).sort().join('\n')
      const b = rows.map(r => `${r.term}|${r.match_mode}`).sort().join('\n')
      if (a !== b) {
        fail(`utils/reservedNames.js has drifted from the LIVE reserved_names table ` +
             `(${RESERVED_NAMES.length} local, ${rows.length} live). The table is ` +
             `admin-editable, so this is the half that catches a runtime edit.`)
      } else {
        ok(`live reserved_names matches the client mirror (${rows.length} rows)`)
      }
    }

    // institutions: readable by authenticated ONLY. anon must get nothing.
    const inst = await get('institutions?select=id')
    const instRows = inst.ok ? await inst.json() : null
    if (inst.ok && instRows.length > 0) {
      fail(`institutions returned ${instRows.length} rows to ANON — its single policy is ` +
           `TO authenticated, so either a second policy was added or RLS is off`)
    } else {
      ok('institutions returns nothing to anon (control above proves the path works)')
    }

    // profiles: nothing, ever.
    const prof = await get('profiles?select=display_name&limit=1')
    const profRows = prof.ok ? await prof.json() : []
    if (prof.ok && profRows.length > 0) {
      fail('profiles returned rows to ANON — a display_name over-share is live, and the ' +
           'availability RPC is no longer the narrowest surface')
    } else {
      ok('profiles returns nothing to anon')
    }

    // The RPC must be unreachable by anon. Control: one anon IS allowed to call.
    const ctl2 = await rpc('explore_category_counts')
    const probe = await rpc('display_name_available', { p_name: 'ZZUnlikelyProbeName' })
    if (!ctl2.ok) {
      fail(`RPC control failed: explore_category_counts -> ${ctl2.status}. The ` +
           `display_name_available result below is therefore inconclusive, not a pass.`)
    } else if (probe.ok) {
      fail(`display_name_available answered an ANON call (${probe.status}) — EXECUTE was ` +
           `not revoked, so every guest session can query who holds which name`)
    } else {
      ok(`display_name_available is unreachable by anon (${probe.status}); ` +
         `control RPC returned ${ctl2.status}`)
    }
  }
}

// ─── Report ──────────────────────────────────────────────────────────────────
console.log('\nprofile gate probe\n')
for (const n of notes) console.log(n)
if (fails.length) {
  console.log('')
  for (const f of fails) console.error(`  FAIL ${f}`)
  console.error(`\n${fails.length} failure(s)\n`)
  process.exit(1)
}
console.log(`\nall ${notes.length} checks passed\n`)
