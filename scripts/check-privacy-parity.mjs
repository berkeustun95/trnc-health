#!/usr/bin/env node
// ─── Privacy parity guard — THREE copies of one document ────────────────────
//
//   npm run privacy:check              # fail on drift  (web:deploy, ota)
//   npm run privacy:check -- --warn    # report, exit 0 (pre-push)
//   npm run privacy:check -- --self    # prove every failure path is reachable
//
// ─── READ THIS BEFORE TRUSTING A GREEN RUN ──────────────────────────────────
//
// THIS GUARD ANSWERS: "do the three privacy FILES in this repo say the same thing?"
// IT DOES NOT ANSWER: "do the three published URLs say the same thing?"
//
// Those are different questions and the gap between them is the whole hazard. Each
// copy publishes by a DIFFERENT action:
//
//   docs/privacy.html        → GitHub Pages, on `git push`
//   web/privacy.html         → `npm run web:deploy` (Cloudflare Worker `getadaapp`)
//   LegalScreen.js PRIVACY   → `npm run ota`        (EAS Update)
//
// so all three files can be identical in the repo while three different versions are
// live. That is exactly how they reached June 2026 / July 2026 / July 11 2026
// simultaneously — nobody edited them apart, they were PUBLISHED apart.
//
// This is the same "committed is not applied" gap check-terms-commitment.mjs names for
// migrations, in a second setting. The output says so on every run, because a guard
// that lets a reader confuse those two questions is worse than no guard at all.
//
// ─── WHY IT WARNS IN pre-push AND FAILS IN THE PUBLISH WRAPPERS ─────────────
//
// `git push` publishes docs/ ONLY. Blocking a push because the in-app copy has not
// shipped yet would fire on a state that is normal and correct — LegalScreen's copy is
// routinely committed and waiting for the next OTA. A guard that goes red on a correct
// state gets disabled, and then it is not a guard.
//
// So: warn on push, FAIL at each publish action, where drift becomes visible to a user.

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const COPIES = [
  { label: 'docs/privacy.html',      path: 'docs/privacy.html',      publishes: 'GitHub Pages, on `git push`',      extract: s => s },
  { label: 'web/privacy.html',       path: 'web/privacy.html',       publishes: '`npm run web:deploy`',             extract: s => s },
  { label: 'LegalScreen.js PRIVACY', path: 'screens/LegalScreen.js', publishes: '`npm run ota`',                    extract: s => {
      const m = s.match(/const PRIVACY = `([\s\S]*?)`\n/)
      if (!m) throw new Error('could not locate the PRIVACY template literal in LegalScreen.js')
      return m[1]
    } },
]

const flatten = s => s.replace(/<[^>]+>/g, ' ').replace(/&mdash;/g, '—').replace(/&amp;/g, '&').replace(/\s+/g, ' ')

// ── Substance every copy must carry. Each is a COMMITMENT, not a phrasing preference:
//    a copy missing one is making a different promise from its siblings.
const MARKERS = [
  { key: '30-day purge',        re: /deleted automatically after 30 days/i,
    why: 'the moderation retention rule, also promised in both Terms copies' },
  { key: 'rejection linkage',   re: /linked to your account/i,
    why: 'what makes a rejection record personal data' },
  { key: 'under-13 non-storage', re: /we do not store that date/i,
    why: 'the age rule; overclaiming or omitting it are both wrong' },
  { key: 'public/not-public',   re: /what is public and what is not/i,
    why: 'the section users actually care about' },
  { key: 'provider sees name',  re: /provider you book with is shown your full name/i,
    why: 'the one disclosure that is live today, via get_customer_contacts' },
  { key: 'booking-form phone',  re: /separate from the phone number on your profile/i,
    why: 'without it, "never shared" is false for garage bookings' },
]

// ── The field list is DERIVED from App.js PROFILE_COLUMNS, not typed here. A column
//    added to the app therefore fails this guard until it is either disclosed in all
//    three copies or exempted below WITH A REASON — which is the review moment a
//    hardcoded list never creates.
const DISCLOSURE = {
  first_name:        /first and last name/i,
  last_name:         /first and last name/i,
  display_name:      /display name/i,
  date_of_birth:     /date of birth/i,
  region:            /\bregion\b/i,
  resident_status:   /resident status/i,
  student_level:     /study level/i,
  institution_id:    /institution/i,
  phone:             /phone number/i,
  nationality:       /nationality/i,
  nationality_code:  /nationality/i,
  preferred_language:/preferred language/i,
  avatar_url:        /profile picture|profile photo|avatar/i,
}

// Columns that are not user-supplied personal data to itemise. Each needs a REASON.
const EXEMPT = {
  role:                    'assigned by us, always customer at signup (20260827)',
  blocked_until:           'a moderation outcome, covered by the Terms not the data list',
  profile_completed_at:    'internal flag, derived from fields already disclosed',
  profile_schema_version:  'internal versioning, no personal content',
  age_ineligible:          'the under-13 marker; disclosed as prose, not as a field',
}

function readColumns() {
  const app = readFileSync(join(ROOT, 'App.js'), 'utf8')
  const m = app.match(/const PROFILE_COLUMNS\s*=\s*'([^']+)'/)
  if (!m) throw new Error('could not locate PROFILE_COLUMNS in App.js')
  return m[1].split(',').map(c => c.trim()).filter(Boolean)
}

function loadCopies() {
  return COPIES.map(c => {
    const p = join(ROOT, c.path)
    if (!existsSync(p)) throw new Error(`missing copy: ${c.path}`)
    return { ...c, text: flatten(c.extract(readFileSync(p, 'utf8'))) }
  })
}

function check(copies, columns, log = console.log) {
  const problems = []

  // ── 1. same "Last updated" ──
  log('  dates')
  const dates = copies.map(c => {
    const m = c.text.match(/Last updated:\s*([A-Za-z0-9 ,]+?)\s{2,}|Last updated:\s*([A-Za-z]+ \d{1,2}, \d{4}|[A-Za-z]+ \d{4})/)
    return { label: c.label, date: (m && (m[2] || m[1]) || '').trim() }
  })
  for (const d of dates) log(`    ${d.date ? '·' : '✗'} ${d.label.padEnd(24)} ${d.date || '(no "Last updated" found)'}`)
  const distinct = [...new Set(dates.map(d => d.date))]
  if (dates.some(d => !d.date)) problems.push('a copy has no parseable "Last updated" date')
  else if (distinct.length !== 1) problems.push(`the three copies carry ${distinct.length} different dates: ${distinct.join(' / ')}`)
  else log(`    ✓ all three agree: ${distinct[0]}`)

  // ── 2. substance markers ──
  log('\n  commitments (each copy must make the same promises)')
  for (const mk of MARKERS) {
    const missing = copies.filter(c => !mk.re.test(c.text)).map(c => c.label)
    if (missing.length) {
      problems.push(`"${mk.key}" missing from: ${missing.join(', ')} — ${mk.why}`)
      log(`    ✗ ${mk.key.padEnd(22)} missing from ${missing.join(', ')}`)
    } else log(`    ✓ ${mk.key.padEnd(22)} in all ${copies.length}`)
  }

  // ── 3. DERIVED field coverage ──
  log('\n  profile fields (derived from App.js PROFILE_COLUMNS, not a list typed here)')
  const unknown = [], gaps = []
  for (const col of columns) {
    if (EXEMPT[col]) continue
    const re = DISCLOSURE[col]
    if (!re) { unknown.push(col); continue }
    const missing = copies.filter(c => !re.test(c.text)).map(c => c.label)
    if (missing.length) { gaps.push({ col, missing }); log(`    ✗ ${col.padEnd(20)} undisclosed in ${missing.join(', ')}`) }
  }
  const covered = columns.filter(c => !EXEMPT[c] && DISCLOSURE[c]).length
  if (!gaps.length && !unknown.length) log(`    ✓ all ${covered} disclosable column(s) appear in all three copies`)
  for (const g of gaps) problems.push(`profiles.${g.col} is collected but not disclosed in: ${g.missing.join(', ')}`)
  for (const u of unknown) {
    problems.push(`profiles.${u} is in PROFILE_COLUMNS but this guard has no rule for it — disclose it in all three copies, or add it to EXEMPT with a reason`)
    log(`    ✗ ${u.padEnd(20)} NEW COLUMN — no disclosure rule and not exempt`)
  }
  log(`    · ${Object.keys(EXEMPT).length} column(s) exempt: ${Object.keys(EXEMPT).join(', ')}`)

  return problems
}

// ── --self: every failure path, mutation asserted to have landed first ──
function self() {
  const copies = loadCopies(), columns = readColumns(), quiet = () => {}
  if (check(copies, columns, quiet).length) {
    console.error('  --self cannot run: the real files are already failing.')
    return 1
  }
  console.log('  baseline: the real files PASS, so any red below is caused by the mutation\n')
  const cases = [
    ['date drift in one copy', () => [copies.map((c,i) => i===0 ? {...c, text: c.text.replace(/Last updated:\s*\w+ \d{4}/, 'Last updated: June 2026')} : c), columns],
      ([cs]) => /June 2026/.test(cs[0].text)],
    ['30-day rule dropped from web copy', () => [copies.map(c => c.label.startsWith('web') ? {...c, text: c.text.replace(/deleted automatically after 30 days/ig, 'kept')} : c), columns],
      ([cs]) => !/deleted automatically after 30 days/i.test(cs[1].text)],
    ['under-13 sentence dropped from in-app copy', () => [copies.map(c => c.label.startsWith('Legal') ? {...c, text: c.text.replace(/we do not store that date/ig, 'we store it')} : c), columns],
      ([cs]) => !/we do not store that date/i.test(cs[2].text)],
    ['a disclosed field vanishes from one copy', () => [copies.map((c,i) => i===0 ? {...c, text: c.text.replace(/date of birth/ig, 'REDACTED')} : c), columns],
      ([cs]) => !/date of birth/i.test(cs[0].text)],
    ['a NEW profile column appears', () => [copies, [...columns, 'passport_number']],
      ([,cols]) => cols.includes('passport_number')],
  ]
  let bad = 0
  for (const [name, build, landed] of cases) {
    const world = build()
    if (!landed(world)) { console.error(`    ✗ ${name.padEnd(46)} MUTATION DID NOT LAND — the test is broken, not the guard`); bad++; continue }
    const found = check(world[0], world[1], quiet)
    if (!found.length) { console.error(`    ✗ ${name.padEnd(46)} mutation landed but the guard stayed GREEN`); bad++; continue }
    console.log(`    ✓ ${name.padEnd(46)} red: ${found[0].slice(0, 90)}`)
  }
  console.log(`\n  ${cases.length - bad}/${cases.length} failure paths reachable`)
  return bad === 0 ? 0 : 1
}

// ── main ──
const warnOnly = process.argv.includes('--warn')
const isSelf   = process.argv.includes('--self')

console.log('privacy parity guard — THREE copies of one document')
console.log('  ANSWERS:     do the three privacy FILES in this repo say the same thing?')
console.log('  DOES *NOT*:  do the three published URLs say the same thing? Each copy publishes')
console.log('               by a different action, so identical files can still mean three')
console.log('               different live versions. Content parity is not URL parity.\n')
for (const c of COPIES) console.log(`    ${c.label.padEnd(24)} → ${c.publishes}`)
console.log('')

if (isSelf) {
  const code = self()
  console.log(code === 0 ? '\n  --self PASS — every failure path goes red.' : '\n  --self FAIL — a path is unreachable. Fix the guard.')
  process.exit(code)
}

let problems
try { problems = check(loadCopies(), readColumns()) }
catch (e) { console.error(`\n  FAIL — ${e.message}`); process.exit(warnOnly ? 0 : 1) }

if (!problems.length) {
  console.log('\n  PASS — the three FILES agree.')
  console.log('  This says nothing about what is LIVE. To publish: `git push` (docs/),')
  console.log('  `npm run web:deploy` (web/), `npm run ota` (in-app) — three separate actions.')
  process.exit(0)
}
console.error(`\n  ${warnOnly ? 'WARNING' : 'FAIL'} — the three privacy copies do not agree.`)
for (const p of problems) console.error('    • ' + p)
if (warnOnly) {
  console.error('\n  Not blocking the push: `git push` publishes docs/ only, and the in-app copy')
  console.error('  waiting for an OTA is a NORMAL state. This blocks at `web:deploy` and `ota`.')
  process.exit(0)
}
console.error('\n  Blocking: this IS a publish action. Fix every copy, not just the one you are shipping.')
process.exit(1)
