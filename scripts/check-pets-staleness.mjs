#!/usr/bin/env node
// ─── Pets content staleness + the wrapper/regulatory split ──────────────────
//
//   npm run pets:health          hard fail past the threshold (used by npm run ota)
//   npm run pets:health -- --warn   print and exit 0 (used by .githooks/pre-push)
//
// ─── WHY THIS EXISTS, AND WHY IT IS A CONTENT CHECK ─────────────────────────
//
// Every check in this repo asked whether a column EXISTS. None asked whether the CONTENT
// IS CURRENT — and that is the failure that reached users: the duty roster ran out on
// 2026-06-30 and nobody noticed for two months while passing every schema check, because
// an empty table has a perfectly correct schema. A three-month-old import requirement has
// a perfectly correct schema too.
//
// The pets module is LIVE to every user and tells people what paperwork to bring to a
// border. `LAST_VERIFIED = 'June 2026'` was hardcoded in three separate files and nothing
// anywhere could ask how old it was. This is that question, asked out loud.
//
// ─── WHY --warn EXISTS, AND WHY pre-push USES IT ────────────────────────────
//
// CLAUDE.md's own rule, learned from check-duty-staleness and check-novest-staleness:
// "a push must not be blocked because a roster is running low; that is data operations,
// and a guard that blocks unrelated work gets disabled." A disabled guard protects
// nobody. So this WARNS on push — visible every time, blocking nothing — and FAILS inside
// `npm run ota`, which is where stale content would actually reach a user. Same split
// check-privacy-parity.mjs already uses, for the same reason.
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  verifiedOn, reviewedBy, sourceUrl, PENDING,
  VET_DEPT_PHONE, VET_DEPT_EMAIL,
  STALE_AFTER_DAYS, USER_NOTICE_AFTER_DAYS,
  verifiedDate, daysSinceVerified, isStale, showUserStaleNotice, verifiedLabel,
  REGULATORY_KEYS, REGULATORY_LOCALES, fallsBackToEnglish,
} from '../constants/petsContent.js'
import { LANG_CODES } from '../constants/i18n.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WARN_ONLY = process.argv.includes('--warn')
const problems = []
let assertions = 0
const check = (cond, msg) => { assertions++; if (!cond) problems.push(msg) }
const c = { g: s => `\x1b[32m${s}\x1b[0m`, r: s => `\x1b[31m${s}\x1b[0m`,
            y: s => `\x1b[33m${s}\x1b[0m`, d: s => `\x1b[2m${s}\x1b[0m` }

// ─── 0. CONTROLS ────────────────────────────────────────────────────────────
//
// Asked BEFORE the run: what does this print if the content is PERFECTLY FRESH? "0 days
// old, fresh." If it is broken? A day count over the threshold, or "unparseable". Those
// differ, so this is a probe and not a formality.
//
// The clock is INJECTED into every helper, so both sides of both thresholds are driven
// below with fake dates. A function that read the wall clock internally could never be
// tested at the boundary it exists to defend.
if (!verifiedDate()) problems.push(`CONTROL: verifiedOn ${JSON.stringify(verifiedOn)} does not parse as YYYY-MM — every figure below is meaningless`)
const d = verifiedDate()
if (d) {
  const fresh = new Date(d.getTime() + 1 * 86400000)
  const old   = new Date(d.getTime() + (STALE_AFTER_DAYS + 1) * 86400000)
  check(isStale(old) === true,   'CONTROL: isStale() did not fire one day past the threshold — the check cannot go red')
  check(isStale(fresh) === false, 'CONTROL: isStale() fired on day-one-old content — the check cannot go green')
  // The exact boundary, both sides. `> STALE_AFTER_DAYS`, so day 90 is still fresh.
  check(isStale(new Date(d.getTime() + STALE_AFTER_DAYS * 86400000)) === false,
    `CONTROL: day ${STALE_AFTER_DAYS} exactly should still be fresh (the test is > not >=)`)
  check(showUserStaleNotice(new Date(d.getTime() + (USER_NOTICE_AFTER_DAYS + 1) * 86400000)) === true,
    'CONTROL: the user notice did not fire past its own threshold')
  check(showUserStaleNotice(old) === false,
    `CONTROL: the user notice fired at ${STALE_AFTER_DAYS + 1} days — it must not appear before ${USER_NOTICE_AFTER_DAYS}`)
}
// An unparseable stamp must read as STALE, never as fresh — "we do not know how old this
// is" and "it is too old" are the same answer on regulatory content. That branch cannot be
// exercised from here (verifiedOn is a module const and there is no seam to override it),
// and a check that pretends to test it would be a decoration. It is covered instead by the
// CONTROL at the top of this block, which fails loudly if the stamp stops parsing.
check(STALE_AFTER_DAYS < USER_NOTICE_AFTER_DAYS,
  `thresholds are inverted: the team warning (${STALE_AFTER_DAYS}d) must come BEFORE the user notice (${USER_NOTICE_AFTER_DAYS}d)`)

// ─── 1. PENDING values must still be null ───────────────────────────────────
//
// These replaced two floating "verify before shipping" comments that survived every
// release since the module went live. A comment is tracked by nothing; this is.
check(reviewedBy === null,
  `reviewedBy is ${JSON.stringify(reviewedBy)} but is still listed in PENDING. If somebody at the Vet Department actually confirmed these requirements, DELETE the PENDING entry in the same commit. If not, this is an invented attribution.`)
check(sourceUrl === null,
  `sourceUrl is ${JSON.stringify(sourceUrl)} but is still listed in PENDING. A guessed URL lends an authority nobody granted.`)
for (const [k, why] of Object.entries(PENDING)) {
  check(typeof why === 'string' && why.trim().length > 0,
    `PENDING.${k} has no reason written against it — "owed" with no why rots into "nobody knows"`)
}

// ─── 2. Vet Department contacts ─────────────────────────────────────────────
// Shape only. Nothing here can prove the number still reaches the department — that is
// PENDING.vetDeptContacts, and it needs a human to dial it.
check(/^\d{8,}$/.test(VET_DEPT_PHONE), `VET_DEPT_PHONE ${JSON.stringify(VET_DEPT_PHONE)} is not a dialable digit string`)
check(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(VET_DEPT_EMAIL), `VET_DEPT_EMAIL ${JSON.stringify(VET_DEPT_EMAIL)} is malformed`)

// ─── 3. The split must PARTITION the real key set ───────────────────────────
//
// Derived from constants/i18n.js, never from a remembered count. A REGULATORY_KEYS entry
// that does not name a real key exempts a ghost from the i18n guard and silently leaves
// the real key unguarded — the exact shape of a check that certifies its own blind spot.
const i18nSrc = readFileSync(resolve(ROOT, 'constants/i18n.js'), 'utf8').split('\n')
const enStart = i18nSrc.findIndex(l => /^  en: \{/.test(l))
const trStart = i18nSrc.findIndex(l => /^  tr: \{/.test(l))
check(enStart >= 0 && trStart > enStart, 'could not locate the en/tr locale blocks in constants/i18n.js — the partition check below would be measuring nothing')

const enPetsKeys = new Set()
for (let i = enStart; i < trStart; i++) {
  const m = /^    (pets[A-Za-z0-9_]*):/.exec(i18nSrc[i])
  if (m) enPetsKeys.add(m[1])
}
check(enPetsKeys.size > 100, `only ${enPetsKeys.size} pets* keys found in English — the scraper is probably broken, and a partition check over an empty set passes on everything`)

const regSet = new Set(REGULATORY_KEYS)
check(regSet.size === REGULATORY_KEYS.length,
  `REGULATORY_KEYS contains duplicates (${REGULATORY_KEYS.length} entries, ${regSet.size} unique)`)
const ghosts = REGULATORY_KEYS.filter(k => !enPetsKeys.has(k))
check(ghosts.length === 0,
  `REGULATORY_KEYS names ${ghosts.length} key(s) that do not exist in English: ${ghosts.join(', ')}. `
  + `A ghost exempts nothing from the i18n guard while the real key goes unguarded.`)
const wrapper = [...enPetsKeys].filter(k => !regSet.has(k))

// ─── 4. Locale bucket ───────────────────────────────────────────────────────
check(REGULATORY_LOCALES.includes('en') && REGULATORY_LOCALES.includes('tr'),
  `REGULATORY_LOCALES is ${JSON.stringify(REGULATORY_LOCALES)}. Turkish already carries all ${REGULATORY_KEYS.length} regulatory strings; dropping it DELETES working Turkish rule text in an official language of the TRNC. This slice adds and never removes.`)
const allCodes = Object.values(LANG_CODES)
const noticeLocales = allCodes.filter(fallsBackToEnglish)
check(noticeLocales.length === allCodes.length - REGULATORY_LOCALES.length,
  `fallsBackToEnglish disagrees with REGULATORY_LOCALES: ${noticeLocales.length} of ${allCodes.length}`)
check(!fallsBackToEnglish('tr') && !fallsBackToEnglish('en') && fallsBackToEnglish('ar'),
  'fallsBackToEnglish is not selecting the right locales')

// ─── 5. THE STALENESS QUESTION ──────────────────────────────────────────────
const days = daysSinceVerified()
const stale = isStale()
const userNotice = showUserStaleNotice()

// ─── REPORT ─────────────────────────────────────────────────────────────────
console.log('')
console.log('  pets content')
console.log(c.d('  ─────────────────────────────────────────────────────────────'))
console.log(`  verified            ${verifiedOn}  ${c.d(`(${verifiedLabel('English')}, resolved to the 1st — see the note in petsContent.js)`)}`)
console.log(`  age                 ${days === null ? c.r('UNKNOWN') : `${days} days`}`)
console.log(`  team threshold      ${STALE_AFTER_DAYS}d  ${stale ? c.r('EXCEEDED') : c.g('ok')}`)
console.log(`  user threshold      ${USER_NOTICE_AFTER_DAYS}d  ${userNotice ? c.r('EXCEEDED — the in-app notice is showing') : c.g('ok — no notice shown')}`)
console.log(`  reviewedBy          ${reviewedBy === null ? c.y('PENDING') : reviewedBy}`)
console.log(`  sourceUrl           ${sourceUrl === null ? c.y('PENDING') : sourceUrl}`)
console.log(`  language split      ${wrapper.length} wrapper (9 locales) · ${REGULATORY_KEYS.length} regulatory (${REGULATORY_LOCALES.join('+')} only)`)
console.log(`  notice renders to   ${noticeLocales.length} locale(s): ${noticeLocales.join(', ')}`)
console.log(`  assertions made     ${assertions}`)
console.log(c.d('  ─────────────────────────────────────────────────────────────'))

if (problems.length) {
  console.error(c.r(`\n  ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n`))
  for (const p of problems) console.error(`   • ${p}`)
  console.error('')
  process.exit(1)
}

if (stale) {
  const lines = [
    `pets content was last verified ${verifiedLabel('English')} — ${days} days ago, past the ${STALE_AFTER_DAYS}-day threshold.`,
    '',
    'This module tells people what paperwork to bring to a border. To clear it:',
    `  1. Call the TRNC Veterinary Department on ${VET_DEPT_PHONE} (or ${VET_DEPT_EMAIL})`,
    '  2. Confirm the import steps, intervals, fees and banned breeds are unchanged',
    '  3. Update verifiedOn in constants/petsContent.js, and fill in reviewedBy',
    '',
    userNotice
      ? `⚠ PAST ${USER_NOTICE_AFTER_DAYS} DAYS: users are now being shown the "may be out of date" notice in-app.`
      : `Users are NOT yet being warned — that starts at ${USER_NOTICE_AFTER_DAYS} days (${USER_NOTICE_AFTER_DAYS - days} days away).`,
  ]
  if (WARN_ONLY) {
    console.error(c.y('  ┌─ pets content is STALE (warning only) ─────────────────────────┐'))
    for (const l of lines) console.error(c.y('  │ ') + l)
    console.error(c.y('  └────────────────────────────────────────────────────────────────┘'))
    console.error(c.d('  Not blocking: a push must not be stopped because content needs a phone call.'))
    console.error(c.d('  `npm run ota` DOES block on this — that is where stale content reaches users.\n'))
    process.exit(0)
  }
  console.error(c.r('\n  ┌─ pets content is STALE — publish blocked ──────────────────────┐'))
  for (const l of lines) console.error(c.r('  │ ') + l)
  console.error(c.r('  └────────────────────────────────────────────────────────────────┘\n'))
  process.exit(1)
}

console.log(c.g(`  OK — verified ${days} days ago\n`))
