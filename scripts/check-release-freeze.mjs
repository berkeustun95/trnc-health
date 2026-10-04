#!/usr/bin/env node
// ─── Release freeze: refuses `npm run ota` (production) while release-freeze.json is frozen ──
//
// Runs FIRST in the production `ota` script, before any other guard. `ota:preview` never calls it:
// branches and the PREVIEW channel keep working during a freeze.
//
// Exception (CLAUDE.md "RELEASE FREEZE"): an urgent bug fix with Berke's explicit OK in chat, Preview
// first, then production with FREEZE_OVERRIDE=1 — and logged in the dev journal. The override is
// an env var Berke has to hand over; nothing in the repo sets it.
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const file = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'release-freeze.json')
let f
try { f = JSON.parse(readFileSync(file, 'utf8')) } catch (e) {
  console.error(`release freeze: cannot read ${file} (${e.message}) — refusing rather than guessing.`)
  process.exit(1)
}
if (typeof f.frozen !== 'boolean') { console.error('release freeze: "frozen" must be true or false — refusing.'); process.exit(1) }
if (!f.frozen) { console.log('release freeze: off'); process.exit(0) }

const bar = '═'.repeat(72)
if (process.env.FREEZE_OVERRIDE === '1') {
  console.warn(`\n${bar}\n  RELEASE FREEZE OVERRIDDEN (FREEZE_OVERRIDE=1) — frozen since ${f.since}.\n  Only for an urgent fix with Berke's explicit OK, already tested on Preview. Log it in the journal.\n${bar}\n`)
  process.exit(0)
}
console.error(`\n${bar}
  RELEASE FREEZE — production OTA refused. Nothing was published.
  Frozen since ${f.since} on runtimes ${(f.runtimes || []).join(', ')}.
  ${f.reason}
  Allowed: work on branches and the PREVIEW channel (npm run ota:preview).
  Urgent fix only: Berke's explicit OK in chat → Preview first → then
    FREEZE_OVERRIDE=1 npm run ota -- --message "…"   (and log it).
  Unfreeze: ${f.unfreeze}
${bar}\n`)
process.exit(1)
