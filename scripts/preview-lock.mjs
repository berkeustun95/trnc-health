#!/usr/bin/env node
// ─── One session at a time on the Preview channel + the test phone ──────────────────────────
//
//   node scripts/preview-lock.mjs take <holder> "<what for>"   # before ota:preview / any phone use
//   node scripts/preview-lock.mjs release <holder>             # after YOUR phone check
//   node scripts/preview-lock.mjs status
//   node scripts/preview-lock.mjs check                        # in ota:preview: needs ADA_PREVIEW_HOLDER
//   node scripts/preview-lock.mjs check --if-phone             # in start/android: the same, only while the
//                                                              # test phone is attached over adb
//
// WHY (2026-11-01): the Preview channel is shared and the newest update wins on the phone. One
// session published its Preview minutes after another's; the second session's device check then
// silently ran the first session's bundle, and an Expo Go session took the phone mid-run.
//
// The lock is a file in the vault, so every worktree and session on this Mac sees the same one.
// Taking it is an exclusive create (open 'wx'): two sessions cannot both get it. It never expires
// on its own: a stale lock is released by its holder, or with --force on Berke's word (log it).
//
// ─── --production: the same lock for `npm run ota` ──────────────────────────────────────────
//
//   node scripts/preview-lock.mjs --production take <holder> "<what for>"   # before npm run ota
//   node scripts/preview-lock.mjs --production release <holder>             # after the IDs are read back
//   node scripts/preview-lock.mjs --production check                        # in ota: needs ADA_PRODUCTION_HOLDER
//
// WHY (2026-11-01): two sessions each had a production go. Both preflights read production before
// either publish landed, so both saw their HEAD contain it; the slower export (7 min) landed a
// minute after the other and silently replaced it (46d63ffb → 4056472e dropped the map chip).
// Held for the whole publish, the lock serialises them, and the second preflight then sees the
// first update and refuses unless HEAD contains it (check-ota-preflight.mjs). Separate file, so a
// Preview check on the phone never blocks a production publish or the reverse.

// ─── --suite: one full local test suite at a time across sessions ────────────────────────────
//
//   node scripts/preview-lock.mjs --suite take <holder> "<what for>"   # before jest / the full guard run
//   ADA_SUITE_HOLDER=<holder> npm test                                 # jest, refused without the lock
//   node scripts/preview-lock.mjs --suite release <holder>             # right after the run
//
// WHY (2026-11-15): on this 4-core Mac a review fan-out ran ~7 jest runs plus guard batches in one
// session while another session ran its pre-merge suite: load average 293, 8 tests timed out, and
// the clean re-run took 18 s instead of 337 s. Only QA and a session's own pre-merge check run the
// suite (reviewers read code), jest is capped at 2 workers (package.json), and this lock serialises
// the runs. The ota / ota:preview chains run their small jest files under the publish locks instead.
// Heavy single checks take the same lock (their npm scripts start with `--suite check`): ads:check,
// ads:selftest, release-lane:test, check:migration-numbers (>= 5 s CPU, measured 2026-11-15). The pre-push
// hook and the publish chains call the node scripts directly.

// Hermes publishes only runtime-1.4.0 Previews (ada-publish), which this phone's 1.4.2 build never
// loads, and has no vault: `check` there finds no lock directory and passes, saying so.

import { openSync, writeSync, closeSync, readFileSync, unlinkSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

// The test phone (S20+, SM-G985F) by hardware serial: its Wi-Fi debugging address changes on every pairing.
const TEST_PHONE_SERIAL = 'R58N602DHYT'

const DIR = process.env.ADA_LOCK_DIR || join(homedir(), 'ObsidianVault', '10-ada', 'locks')
const PROD = process.argv.includes('--production')
const SUITE = process.argv.includes('--suite')
if (PROD && SUITE) { console.error('preview-lock: --production and --suite are separate locks; pass one'); process.exit(2) }
const FILE = join(DIR, PROD ? 'production-ota.lock.json' : SUITE ? 'test-suite.lock.json' : 'preview-phone.lock.json')
const NAME = PROD ? 'production lock' : SUITE ? 'suite lock' : 'preview lock'
const HOLDER_ENV = PROD ? 'ADA_PRODUCTION_HOLDER' : SUITE ? 'ADA_SUITE_HOLDER' : 'ADA_PREVIEW_HOLDER'
const [cmd, holderArg, ...rest] = process.argv.slice(2).filter(a => a !== '--production' && a !== '--suite')

function read() {
  try { return JSON.parse(readFileSync(FILE, 'utf8')) } catch { return null }
}
function age(since) {
  const m = Math.round((Date.now() - Date.parse(since)) / 60000)
  return m < 90 ? `${m} min` : `${(m / 60).toFixed(1)} h`
}
function describe(l) {
  return `${l.holder} since ${l.since} (${age(l.since)} ago) — ${l.purpose || 'no purpose given'} [${l.worktree || '?'} @ ${l.branch || '?'}]`
}
function gitOr(cmdline, fallback) {
  try { return execSync(cmdline, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { return fallback }
}

if (cmd === 'status') {
  const l = read()
  console.log(l ? `${NAME}: HELD by ${describe(l)}` : NAME + ': free')
  process.exit(0)
}

if (cmd === 'take') {
  if (!holderArg) { console.error(NAME + ': take <holder> "<what for>"'); process.exit(2) }
  if (!existsSync(DIR)) { console.error(`${NAME}: ${DIR} does not exist — this is not the Mac with the vault`); process.exit(2) }
  const lock = {
    holder: holderArg, purpose: rest.join(' '), since: new Date().toISOString(),
    worktree: process.cwd(), branch: gitOr('git rev-parse --abbrev-ref HEAD', null),
  }
  try {
    const fd = openSync(FILE, 'wx')
    writeSync(fd, JSON.stringify(lock, null, 2) + '\n'); closeSync(fd)
    console.log(`${NAME}: TAKEN by ${describe(lock)}`)
    process.exit(0)
  } catch (e) {
    if (e.code !== 'EEXIST') throw e
    const l = read()
    if (l?.holder === holderArg) { console.log(`${NAME}: already yours — ${describe(l)}`); process.exit(0) }
    console.error(`${NAME}: REFUSED — held by ${l ? describe(l) : '(unreadable lock file)'}`)
    console.error(`  Wait for it, or ask the holder to release. File: ${FILE}`)
    process.exit(1)
  }
}

if (cmd === 'release') {
  const force = rest.includes('--force')
  const l = read()
  if (!l) { console.log(NAME + ': already free'); process.exit(0) }
  if (l.holder !== holderArg && !force) {
    console.error(`${NAME}: REFUSED — held by ${describe(l)}, not ${holderArg}. Only Berke's word justifies --force.`)
    process.exit(1)
  }
  unlinkSync(FILE)
  console.log(`${NAME}: RELEASED (was ${describe(l)})${force && l.holder !== holderArg ? ' — FORCED, log it in the vault' : ''}`)
  process.exit(0)
}

// Is the test phone reachable over adb? A dev bundle (npm start / npm run android) reaches it that way:
// Metro over `adb reverse`, or the Expo Go / dev-client launch. No adb or no phone → nothing to guard.
function testPhoneAttached() {
  const adb = join(process.env.ANDROID_HOME || join(homedir(), 'Library', 'Android', 'sdk'), 'platform-tools', 'adb')
  const out = gitOr(`"${adb}" devices`, '')
  const serials = out.split('\n').slice(1).map(l => l.trim().split(/\s+/)).filter(([, st]) => st === 'device').map(([id]) => id)
  return serials.some(id => gitOr(`"${adb}" -s "${id}" shell getprop ro.serialno`, '').trim() === TEST_PHONE_SERIAL)
}

if (cmd === 'check') {
  if (holderArg === '--if-phone' && !testPhoneAttached()) {
    console.log(NAME + ': test phone not attached over adb — not needed for this dev server')
    process.exit(0)
  }
  if (!existsSync(DIR)) { console.log(`${NAME}: no lock directory on this machine (${DIR}) — not the test-phone Mac, skipped`); process.exit(0) }
  const me = process.env[HOLDER_ENV]
  const l = read()
  if (!l) {
    console.error(NAME + ': REFUSED — nobody holds the lock. Take it first:')
    console.error(PROD
      ? '  node scripts/preview-lock.mjs --production take <holder> "<what for>"  then  ADA_PRODUCTION_HOLDER=<holder> npm run ota'
      : SUITE
      ? '  node scripts/preview-lock.mjs --suite take <holder> "<what for>"  then  ADA_SUITE_HOLDER=<holder> npm test'
      : '  node scripts/preview-lock.mjs take <holder> "<what for>"  then  ADA_PREVIEW_HOLDER=<holder> npm run ota:preview  (or npm start / npm run android)')
    process.exit(1)
  }
  if (!me || l.holder !== me) {
    console.error(`${NAME}: REFUSED — held by ${describe(l)}${me ? `, not ${me}` : ` (set ${HOLDER_ENV} to your holder name)`}`)
    process.exit(1)
  }
  console.log(`${NAME}: yours (${describe(l)})`)
  process.exit(0)
}

console.error(NAME + ': take <holder> "<what for>" | release <holder> [--force] | status | check')
process.exit(2)
