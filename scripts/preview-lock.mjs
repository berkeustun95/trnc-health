#!/usr/bin/env node
// ─── One session at a time on the Preview channel + the test phone ──────────────────────────
//
//   node scripts/preview-lock.mjs take <holder> "<what for>"   # before ota:preview / any phone use
//   node scripts/preview-lock.mjs release <holder>             # after YOUR phone check
//   node scripts/preview-lock.mjs status
//   node scripts/preview-lock.mjs check                        # in ota:preview: needs ADA_PREVIEW_HOLDER
//
// WHY (2026-11-01): the Preview channel is shared and the newest update wins on the phone. One
// session published its Preview minutes after another's; the second session's device check then
// silently ran the first session's bundle, and an Expo Go session took the phone mid-run.
//
// The lock is a file in the vault, so every worktree and session on this Mac sees the same one.
// Taking it is an exclusive create (open 'wx'): two sessions cannot both get it. It never expires
// on its own: a stale lock is released by its holder, or with --force on Berke's word (log it).
//
// Hermes publishes only runtime-1.4.0 Previews (ada-publish), which this phone's 1.4.2 build never
// loads, and has no vault: `check` there finds no lock directory and passes, saying so.

import { openSync, writeSync, closeSync, readFileSync, unlinkSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

const DIR = process.env.ADA_LOCK_DIR || join(homedir(), 'ObsidianVault', '10-ada', 'locks')
const FILE = join(DIR, 'preview-phone.lock.json')
const [cmd, holderArg, ...rest] = process.argv.slice(2)

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
  console.log(l ? `preview lock: HELD by ${describe(l)}` : 'preview lock: free')
  process.exit(0)
}

if (cmd === 'take') {
  if (!holderArg) { console.error('preview lock: take <holder> "<what for>"'); process.exit(2) }
  if (!existsSync(DIR)) { console.error(`preview lock: ${DIR} does not exist — this is not the Mac with the vault`); process.exit(2) }
  const lock = {
    holder: holderArg, purpose: rest.join(' '), since: new Date().toISOString(),
    worktree: process.cwd(), branch: gitOr('git rev-parse --abbrev-ref HEAD', null),
  }
  try {
    const fd = openSync(FILE, 'wx')
    writeSync(fd, JSON.stringify(lock, null, 2) + '\n'); closeSync(fd)
    console.log(`preview lock: TAKEN by ${describe(lock)}`)
    process.exit(0)
  } catch (e) {
    if (e.code !== 'EEXIST') throw e
    const l = read()
    if (l?.holder === holderArg) { console.log(`preview lock: already yours — ${describe(l)}`); process.exit(0) }
    console.error(`preview lock: REFUSED — held by ${l ? describe(l) : '(unreadable lock file)'}`)
    console.error(`  Wait for it, or ask the holder to release. File: ${FILE}`)
    process.exit(1)
  }
}

if (cmd === 'release') {
  const force = rest.includes('--force')
  const l = read()
  if (!l) { console.log('preview lock: already free'); process.exit(0) }
  if (l.holder !== holderArg && !force) {
    console.error(`preview lock: REFUSED — held by ${describe(l)}, not ${holderArg}. Only Berke's word justifies --force.`)
    process.exit(1)
  }
  unlinkSync(FILE)
  console.log(`preview lock: RELEASED (was ${describe(l)})${force && l.holder !== holderArg ? ' — FORCED, log it in the vault' : ''}`)
  process.exit(0)
}

if (cmd === 'check') {
  if (!existsSync(DIR)) { console.log(`preview lock: no lock directory on this machine (${DIR}) — not the test-phone Mac, skipped`); process.exit(0) }
  const me = process.env.ADA_PREVIEW_HOLDER
  const l = read()
  if (!l) {
    console.error('preview lock: REFUSED — nobody holds the lock. Take it first:')
    console.error('  node scripts/preview-lock.mjs take <holder> "<what for>"  then  ADA_PREVIEW_HOLDER=<holder> npm run ota:preview')
    process.exit(1)
  }
  if (!me || l.holder !== me) {
    console.error(`preview lock: REFUSED — held by ${describe(l)}${me ? `, not ${me}` : ' (set ADA_PREVIEW_HOLDER to your holder name)'}`)
    process.exit(1)
  }
  console.log(`preview lock: yours (${describe(l)})`)
  process.exit(0)
}

console.error('preview lock: take <holder> "<what for>" | release <holder> [--force] | status | check')
process.exit(2)
