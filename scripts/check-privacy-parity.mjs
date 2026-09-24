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
//   constants/legal/privacy.en.js → `npm run ota`   (EAS Update)
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
import { GOLIVE_STALE } from './lib/legal-claims.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const COPIES = [
  { label: 'docs/privacy.html',      path: 'docs/privacy.html',      publishes: 'GitHub Pages, on `git push`',      extract: s => s },
  { label: 'web/privacy.html',       path: 'web/privacy.html',       publishes: '`npm run web:deploy`',             extract: s => s },
  // MOVED 2026-09-12 out of screens/LegalScreen.js, where it was a 13KB template literal
  // inside a screen component. Repointed in the same commit as the move: this extract
  // THROWS rather than returning empty when the literal is absent, so a forgotten repoint
  // is a loud failure and not a guard quietly comparing nothing.
  { label: 'constants/legal/privacy.en.js', path: 'constants/legal/privacy.en.js', publishes: '`npm run ota`', extract: s => {
      const m = s.match(/export default `([\s\S]*)`\n$/)
      if (!m) throw new Error('could not locate the default-export template literal in constants/legal/privacy.en.js')
      return m[1]
    } },
]

// ─── ENCODING. All four bodies, not just the privacy pair. ──────────────────
//
// WHY THIS LIVES IN THE PRIVACY GUARD. It is not about privacy — it is about all four
// legal documents — but this is the only guard that already loads one of them, runs at
// both publish actions, and exists to stop a legal document going out wrong. A fifth
// script asserting one thing would be a script nobody remembers to run.
//
// WHAT IT CATCHES. The bodies reached this repo once as UTF-8 that had been read back as
// cp1252: every accented character doubled, and the company number lost a byte outright —
// MŞ29454 arrived as MÅ29454, which no decoder can repair because the 0x9E is simply
// gone. That is a legal entity identifier, and it would have shipped looking like a typo
// rather than like corruption.
//
// ⚠ IT ASSERTS BYTES, NOT CHARACTERS. `MŞ29454` compared as a STRING passes on a file
//   that is itself mojibake in a consistent way. Reading the raw bytes and looking for
//   4d c5 9e … is the only form of this check that cannot be satisfied by a corrupted
//   file, because it is asking what is actually on disk.
// ALL SEVEN published copies, not only the in-app four. The corruption this exists to
// catch happens in TRANSFER, and the HTML copies are produced by the same hand-off from
// the same source — so checking only the JS would leave the two store-registered URLs
// and the GitHub Pages copies unguarded against exactly the failure that already
// happened once.
const LEGAL_BODIES = [
  'constants/legal/privacy.en.js', 'constants/legal/privacy.tr.js',
  'constants/legal/terms.en.js',   'constants/legal/terms.tr.js',
  'docs/privacy.html',             'docs/terms.html',
  'web/privacy.html',
]
// MŞ29454 — the TRNC company number, as UTF-8 bytes.
const COMPANY_NO_BYTES = Buffer.from('4d c59e 32 39 34 35 34'.replace(/ /g, ''), 'hex')

function checkEncoding(problems, log) {
  log('\n  encoding (raw bytes, so a consistently-mojibake file cannot pass)')
  for (const rel of LEGAL_BODIES) {
    const abs = join(ROOT, rel)
    if (!existsSync(abs)) { problems.push(`${rel} is missing`); log(`    ✗ ${rel} missing`); continue }
    const raw = readFileSync(abs)
    // Strict UTF-8: Node's decoder substitutes U+FFFD rather than throwing, so the
    // round-trip is what makes this strict. A file with an invalid sequence re-encodes
    // to different bytes and fails here.
    const strict = Buffer.compare(Buffer.from(raw.toString('utf8'), 'utf8'), raw) === 0
    const hasNo  = raw.includes(COMPANY_NO_BYTES)
    // Mojibake signature: 'Ã' or 'Â' immediately before another high character is what
    // UTF-8-read-as-latin1 always produces, and never occurs in correct Turkish.
    const moji   = /[\u00c2\u00c3\u00c5][\u0080-\u00bf\u017e\u0178]/.test(raw.toString('utf8'))
    if (!strict) { problems.push(`${rel} is not valid UTF-8`); log(`    ✗ ${rel} not valid UTF-8`) }
    else if (!hasNo) { problems.push(`${rel} does not contain the company number MŞ29454 as UTF-8 bytes — the document is corrupted or the entity block was dropped`); log(`    ✗ ${rel} company number bytes absent`) }
    else if (moji) { problems.push(`${rel} carries a mojibake signature`); log(`    ✗ ${rel} mojibake signature`) }
    else log(`    ✓ ${rel.padEnd(30)} utf-8, MŞ29454 intact`)
  }
}

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
  // Both of these markers changed on 2026-08-31 with 20261004. They used to assert
  // "a provider you book with is shown your full name" and the garage booking-form
  // phone exception. Appointments were removed, get_customer_contacts was DROPPED,
  // and providers now see no customer data at all — so the OLD markers describe text
  // that must NOT be there any more. Updated here rather than deleted: the fact is
  // still worth asserting, it just inverted.
  { key: 'providers see nothing', re: /providers are not shown any of your personal data/i,
    why: 'inverted 20261004 — the old text promised providers your full name' },
  { key: 'question attribution',  re: /sees the question and your display name/i,
    why: 'what a provider CAN see now, and the only thing they can' },
  // Location section, 2026-09-24. Two promises that each copy must make identically: the
  // contact-tap district is anonymous, and the weather request goes to a named third party
  // at a stated precision (tied to App.js below).
  { key: 'contact taps anonymous', re: /cannot be traced back to you/i,
    why: 'contact_events stores a district with no account, device or position' },
  { key: 'weather processor',      re: /rounded to about 10 km and sent to our server, which asks MET Norway/i,
    why: 'names the provider, the proxy and the precision App.js actually sends' },
  { key: 'walking-path processor', re: /sent to our server, which asks openrouteservice \(run by HeiGIT/i,
    why: 'the live walking leg: HeiGIT sees our server only, and keeps ~1 km in its logs' },
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
  // 20261024. "subject" alone is useless here — every copy already says "subject to the
  // advertising restrictions" — so each rule names a phrase only the disclosure uses.
  subject_id:             /field of study/i,
  // ⚠ THESE MATCH PROSE, SO THEY MUST NOT PIN ONE PHRASING. Both read
  //   /year you .../ until 2026-09-20, which disclosed the same two facts as "the year
  //   you started and the year you graduated". The Student Hub rewrite said "the years
  //   you started and graduated" — plural, and the two facts merged into one clause —
  //   and the guard went red on copy that discloses BOTH of them perfectly well.
  //   The only way to green without touching this was to make reviewed legal copy worse,
  //   which is the trap the 0902 note in CLAUDE.md describes: when a check forbids a
  //   CORRECT system from doing something, the check is what is wrong.
  //   Still discriminating — "the years you started" alone leaves study_end_year red.
  study_start_year:       /years? you started/i,
  study_end_year:         /years? you (started and )?graduated/i,
  student_listing_opt_in: /student list/i,
  // student_education's names for facts profiles already discloses (20261026). Both
  // spellings carry a rule so the check survives 20261027 moving the column between
  // tables — `listing_opt_in` is `student_listing_opt_in`, and `level` is `student_level`
  // recorded once per enrolment instead of once per person.
  listing_opt_in:         /student list/i,
  level:                  /study level/i,
}

// Columns that are not user-supplied personal data to itemise. Each needs a REASON.
const EXEMPT = {
  // student_education's own columns. id/created_at are never in EDUCATION_COLUMNS and need
  // no entry; mirror_owned does, because leaving it out silently is exactly the "reasoned
  // off the list" move that put `level` in the wrong place once already.
  mirror_owned:            'provenance, not something the user told us: which rows the 20261026 transition trigger may touch',
  role:                    'assigned by us, always customer at signup (20260827)',
  blocked_until:           'a moderation outcome, covered by the Terms not the data list',
  profile_completed_at:    'internal flag, derived from fields already disclosed',
  profile_schema_version:  'internal versioning, no personal content',
  age_ineligible:          'the under-13 marker; disclosed as prose, not as a field',
  // ─── The four consent columns (20261016) ──────────────────────────────────
  //
  // Disclosed as ONE PROSE BULLET rather than four field entries. Section 1 of the
  // privacy body already carries it, and it is the sentence these exemptions point at:
  //
  //   "Consent records: which version of our Terms of Service and Privacy Policy you
  //    accepted, in which language, and when. If you opt in to marketing messages, we
  //    record when you did so, and when you withdrew it if you later do."
  //
  // That one sentence covers all four. Four separate field entries would describe the
  // SCHEMA rather than the event, and a reader does not have four consent facts about
  // themselves — they have one, recorded four ways.
  terms_version:           'part of the consent record, disclosed as one prose bullet in section 1',
  terms_accepted_at:       'part of the consent record; the "when" in that bullet',
  terms_locale:            'part of the consent record; the "in which language" in that bullet',
  marketing_opt_in_at:     'part of the consent record; the marketing sentence in that bullet',
}

// ─── GO-LIVE TRIPWIRE: three sentences that become FALSE the day the Student Hub ships ──
//
// This is the OPPOSITE of the flag exemption removed on 2026-09-15, and the difference is
// the direction it fires in. That exemption SUPPRESSED a failure while the flag was off,
// so it went quiet on go-live day, months later, with nobody left who remembered why the
// OTA was blocked. This SUPPRESSES NOTHING: it is silent while the flag is off and fires
// exactly once, on the publish that first makes the sentences untrue.
//
// All three are statements about the world that slice 4 changes:
//   1. "Your data is never visible to other customers" — the student list is one customer's
//      data shown to another. Present in all FOUR copies, Turkish included.
//   2. "there is no student list in the app yet, so turning it on shows you to no one" —
//      added with slice 2, honest then, false the moment the list renders.
//   3. "Not used yet — nothing in the app reads them" — same bullet, same problem.
//
// FOUR copies: privacy.tr.js is NOT in COPIES above (the parity comparison is between the
// three English ones) and would otherwise ship a Turkish promise the English copy had
// retracted — the worse half of the failure, because the Turkish reader is the one most
// likely to be a student here.
//
// It does NOT check what the replacement text SAYS. Berke writes that copy; a guard that
// demanded particular wording would be a guard with opinions about prose. It checks only
// that the retracted claims are gone, and the DERIVED disclosure rules above independently
// keep student_listing_opt_in itemised in all three English copies.
const GOLIVE_FLAG = 'studentHub'
// MOVED to scripts/lib/legal-claims.mjs 2026-09-20, imported above. check-legal-live.mjs
// asks the same question of the published URLs, and two copies of this list would drift
// into a pair that reports something neither of them means. One owner.
const GOLIVE_COPIES = [
  { label: 'docs/privacy.html',              path: 'docs/privacy.html',              lang: 'en' },
  { label: 'web/privacy.html',               path: 'web/privacy.html',               lang: 'en' },
  { label: 'constants/legal/privacy.en.js',  path: 'constants/legal/privacy.en.js',  lang: 'en' },
  { label: 'constants/legal/privacy.tr.js',  path: 'constants/legal/privacy.tr.js',  lang: 'tr' },
]

// Reads the RUNTIME flag file, not this script's own copy. check-module-flags.mjs already
// fails when the two disagree, so the pair is covered; what matters here is the value that
// would actually be bundled.
function readStudentHubFlag(raw) {
  const src = raw ?? readFileSync(join(ROOT, 'constants/flags.js'), 'utf8')
  const m = src.match(new RegExp(`${GOLIVE_FLAG}\\s*:\\s*(true|false)`))
  if (!m) throw new Error(`could not read MODULE_FLAGS.${GOLIVE_FLAG} from constants/flags.js`)
  return m[1] === 'true'
}

function checkGoLive(problems, log, flagOn, texts) {
  log(`\n  go-live tripwire (MODULE_FLAGS.${GOLIVE_FLAG} = ${flagOn})`)
  for (const st of GOLIVE_STALE) {
    const present = GOLIVE_COPIES
      .filter(c => st[c.lang].test(texts[c.path]))
      .map(c => c.label)
    if (!flagOn) {
      log(`    · ${st.key.padEnd(34)} ${present.length ? `in ${present.length} copy/copies — armed` : 'already removed'}`)
      continue
    }
    if (present.length) {
      problems.push(`the Student Hub is LIVE but "${st.key}" is still in: ${present.join(', ')} — ${st.why}. Rewrite all four privacy copies before publishing.`)
      log(`    ✗ ${st.key.padEnd(34)} STILL PRESENT in ${present.join(', ')}`)
    } else {
      log(`    ✓ ${st.key.padEnd(34)} removed from all four copies`)
    }
  }
  if (!flagOn) log('    · silent until the flag flips; fires on the publish that makes these untrue')
}

// TWO derived sources, not one. PROFILE_COLUMNS is what profiles holds; EDUCATION_COLUMNS
// is what student_education holds (20261026). The second exists because the first is about
// to shrink: 20261027 moves the five affiliation columns out of profiles, and a guard
// reading only PROFILE_COLUMNS would quietly stop checking that they are disclosed — going
// GREEN because the data moved, while the app still collects every one of those facts.
//
// Both are READ, never retyped here. `listing_opt_in` is the same fact PROFILE_COLUMNS
// calls `student_listing_opt_in`, so the union is de-duplicated by DISCLOSURE key below.
function readColumns() {
  const app = readFileSync(join(ROOT, 'App.js'), 'utf8')
  const m = app.match(/const PROFILE_COLUMNS\s*=\s*'([^']+)'/)
  if (!m) throw new Error('could not locate PROFILE_COLUMNS in App.js')
  const profile = m[1].split(',').map(c => c.trim()).filter(Boolean)

  const gate = readFileSync(join(ROOT, 'constants/profileGate.js'), 'utf8')
  const e = gate.match(/export const EDUCATION_COLUMNS\s*=\s*\[([\s\S]*?)\]/)
  if (!e) throw new Error('could not locate EDUCATION_COLUMNS in constants/profileGate.js')
  // Match ANY quoted entry, then validate the shape — do NOT filter by shape while
  // matching. A narrow `'([a-z_]+)'` silently SKIPS anything it cannot read (a digit, a
  // stray capital) and the column simply leaves the guard's world with no error: the
  // count drops by one and everything still reports green. That is precisely the
  // going-green-because-the-data-moved failure this list was added to prevent, rebuilt
  // inside its own parser. Caught by a red-first probe that mutated 'level' to 'levelXX'
  // and watched the check NOT go red.
  const education = [...e[1].matchAll(/'([^']*)'/g)].map(x => x[1])
  const bad = education.filter(c => !/^[a-z0-9_]+$/.test(c))
  if (bad.length) throw new Error(`EDUCATION_COLUMNS contains entries that are not column names: ${bad.join(', ')}`)
  if (!education.length) throw new Error('EDUCATION_COLUMNS parsed to zero columns — the guard would check nothing')

  // The union carries its ORIGIN, so a failure message can name the file to edit.
  // `listing_opt_in` and `student_listing_opt_in` are the same fact under two names; the
  // Set de-duplicates the rest.
  const columns = [...new Set([...profile, ...education])]
  columns.sourceOf = c => (profile.includes(c) ? 'App.js PROFILE_COLUMNS' : 'EDUCATION_COLUMNS in constants/profileGate.js')
  return columns
}

function loadCopies() {
  return COPIES.map(c => {
    const p = join(ROOT, c.path)
    if (!existsSync(p)) throw new Error(`missing copy: ${c.path}`)
    return { ...c, text: flatten(c.extract(readFileSync(p, 'utf8'))) }
  })
}

function loadGoLiveTexts() {
  const out = {}
  for (const c of GOLIVE_COPIES) {
    const p = join(ROOT, c.path)
    if (!existsSync(p)) throw new Error(`missing privacy copy: ${c.path}`)
    out[c.path] = flatten(readFileSync(p, 'utf8'))
  }
  return out
}

// `world` lets --self substitute a mutated flag/texts without touching the real files.
function check(copies, columns, log = console.log, world = null) {
  const problems = []
  const flagOn = world ? world.flagOn : readStudentHubFlag()
  const texts  = world ? world.texts  : loadGoLiveTexts()
  checkEncoding(problems, log)
  checkGoLive(problems, log, flagOn, texts)

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
    problems.push(`${u} is in ${columns.sourceOf?.(u) ?? 'the column union'} but this guard has no rule for it — disclose it in all three copies, or add it to EXEMPT with a reason`)
    log(`    ✗ ${u.padEnd(20)} NEW COLUMN — no disclosure rule and not exempt`)
  }
  log(`    · ${Object.keys(EXEMPT).length} column(s) exempt: ${Object.keys(EXEMPT).join(', ')}`)

  return problems
}

// ── --self: every failure path, mutation asserted to have landed first ──
function self() {
  const copies = loadCopies(), columns = readColumns(), quiet = () => {}
  // BASELINE FORCES THE FLAG OFF, and that is not cheating. --self asks "can every
  // failure path go red", and it needs a green starting point to attribute the red to the
  // mutation. Reading the live flag here makes the self-test unusable exactly when someone
  // has flipped the module on locally to preview it — which is step 4 of the go-live SOP,
  // i.e. a normal and correct working state. The tripwire's own paths are driven by
  // flipping flagOn to true as a MUTATION in the two cases below, so nothing goes unchecked.
  const realWorld = { flagOn: false, texts: loadGoLiveTexts() }
  if (check(copies, columns, quiet, realWorld).length) {
    console.error('  --self cannot run: the real files are already failing.')
    return 1
  }
  console.log('  baseline: the real files PASS, so any red below is caused by the mutation\n')
  const cases = [
    ['date drift in one copy', () => [copies.map((c,i) => i===0 ? {...c, text: c.text.replace(/Last updated:\s*[A-Za-z]+(?: \d{1,2},)? \d{4}/, 'Last updated: June 2026')} : c), columns],
      ([cs]) => /June 2026/.test(cs[0].text)],
    ['30-day rule dropped from web copy', () => [copies.map(c => c.label.startsWith('web') ? {...c, text: c.text.replace(/deleted automatically after 30 days/ig, 'kept')} : c), columns],
      ([cs]) => !/deleted automatically after 30 days/i.test(cs[1].text)],
    ['under-13 sentence dropped from in-app copy', () => [copies.map(c => c.label.startsWith('constants/legal') ? {...c, text: c.text.replace(/we do not store that date/ig, 'we store it')} : c), columns],
      ([cs]) => !/we do not store that date/i.test(cs[2].text)],
    ['a disclosed field vanishes from one copy', () => [copies.map((c,i) => i===0 ? {...c, text: c.text.replace(/date of birth/ig, 'REDACTED')} : c), columns],
      ([cs]) => !/date of birth/i.test(cs[0].text)],
    ['a NEW profile column appears', () => [copies, [...columns, 'passport_number']],
      ([,cols]) => cols.includes('passport_number')],
    // ── The SECOND derived source is load-bearing. If the guard ever stops reading
    //    EDUCATION_COLUMNS, 20261027 moving the affiliation columns out of profiles
    //    would silently retire four disclosure rules and this guard would go GREEN on
    //    unchanged obligations. A new education column with no rule must go red exactly
    //    the way a new profiles column does.
    ['a NEW student_education column appears', () => [copies, [...columns, 'transcript_url']],
      ([,cols]) => cols.includes('transcript_url')],
    // ── The go-live tripwire. Flipping the flag against copy that still carries a
    //    retracted sentence must turn it red.
    //
    //    ⚠ THE STALE SENTENCE IS INJECTED, NOT BORROWED FROM THE REAL FILES. Both cases
    //      below used to mutate only the flag and rely on realWorld.texts still being
    //      stale. That worked exactly until the copy was legitimately rewritten
    //      (2026-09-20), at which point neither mutation could land and BOTH paths went
    //      unreachable — reported as "MUTATION DID NOT LAND", i.e. a self-test that
    //      expires the moment the thing it guards is fixed. Injecting makes them
    //      permanently reachable, and `landed()` still runs the real GOLIVE_STALE regex
    //      over the injected text, so a sentence that drifts from its rule says so
    //      loudly instead of quietly passing.
    ['Student Hub goes live on stale privacy copy',
      () => {
        const texts = { ...realWorld.texts }
        texts['constants/legal/privacy.en.js'] += '\nYour data is never visible to other customers.\n'
        return [copies, columns, { flagOn: true, texts }]
      },
      ([,,w]) => w.flagOn === true && /never visible to other customers/i.test(w.texts['constants/legal/privacy.en.js'])],
    // ── …and the Turkish copy is checked INDEPENDENTLY: English clean, Turkish carrying
    //    the retracted sentence, must still fire — otherwise a Turkish reader keeps a
    //    promise the English reader has had retracted. That is the worse half of the
    //    failure, because the Turkish reader is the one most likely to be a student here.
    ['live, English clean, Turkish left stale',
      () => {
        const texts = { ...realWorld.texts }
        texts['constants/legal/privacy.tr.js'] += '\nVerileriniz diğer müşterilere hiçbir zaman görünmez.\n'
        return [copies, columns, { flagOn: true, texts }]
      },
      ([,,w]) => !/never visible to other customers/i.test(w.texts['web/privacy.html'])
             && /diğer müşterilere hiçbir zaman görünmez/i.test(w.texts['constants/legal/privacy.tr.js'])],
  ]
  let bad = 0
  for (const [name, build, landed] of cases) {
    const world = build()
    if (!landed(world)) { console.error(`    ✗ ${name.padEnd(46)} MUTATION DID NOT LAND — the test is broken, not the guard`); bad++; continue }
    const found = check(world[0], world[1], quiet, world[2] ?? realWorld)
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

// The policy's "about 10 km" is a promise about CODE: App.js rounds the weather request to
// 0.1°. If the rounding changes, the published sentence is false — so they fail together.
{
  const app = readFileSync(join(ROOT, 'App.js'), 'utf8')
  const ok = /Math\.round\(resolvedCoords\.latitude \* 10\) \/ 10/.test(app)
    && /Math\.round\(resolvedCoords\.longitude \* 10\) \/ 10/.test(app)
  if (!ok) problems.push('App.js no longer rounds the weather request to 0.1° — the Location section promises "about 10 km". Change the code and all copies together.')
  console.log(`\n  weather precision (App.js ↔ policy)\n    ${ok ? '✓ App.js rounds to 0.1° (~10 km), as the policy says' : '✗ App.js rounding no longer matches "about 10 km"'}`)
}

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
