#!/usr/bin/env node
// ─── Dark-launch flag guard ──────────────────────────────────────────────────
//
//   node scripts/check-module-flags.mjs        # exit 0 if flags match the baseline
//
// WHY: a module is dark-launched by leaving its MODULE_FLAGS entry false. Flipping one
// to true LOCALLY is the only practical way to look at a gated screen — the customer
// route is Home tile -> App.js gate -> screen, and admins never enter that chain at all
// (they short-circuit to AdminScreen), so the `|| isAdmin` bypass cannot be used to
// preview it.
//
// The danger is not the flip. It is forgetting to unflip:
//   • committing it   -> the module is live for everyone on the next release
//   • `eas update`    -> the module is live for everyone IMMEDIATELY, because eas update
//                        bundles the WORKING TREE, not git HEAD. An uncommitted flip
//                        ships. That is the real risk, and it is the one a git hook
//                        cannot see.
//
// THE BASELINE LIVES HERE, IN A COMMITTED FILE, ON PURPOSE. Launching a module for real
// means editing constants/flags.js AND this file in the same commit — two deliberate
// edits instead of one forgettable one. If you flip a flag and this guard fails, that is
// the guard working; do not "fix" it by loosening the baseline unless you are genuinely
// launching.

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FLAGS_FILE = 'constants/flags.js'

// ─── EXPECTED STATE — update this ONLY when a module genuinely launches ──────
const EXPECTED_MODULES = {
  homeServices:  false,
  grooming:      false,
  garages:       false,
  transport:     false,
  insurance:     false,
  pets:          true,   // live
  events:        true,   // live
  jobs:          false,
  accommodation: true,   // live 2026-08-24 — Novest partner feed, 88 listings
  studentHub:    false,
  explore:       true,   // live 2026-08-26 — Explore module + map tab
  towing:        true,   // live
  checkins:      false,
}
// ─── GO-LIVE WAITLIST BLAST ──────────────────────────────────────────────────
//
// notify_module_waitlist() is never called by anything — no trigger, no cron, nothing in
// the OTA path. It is a manual step, and a missed one is INVISIBLE: the people affected
// keep waiting and never complain about a notification they do not know was due.
//
// pets proved it. Four people sat un-notified for SIXTEEN DAYS after the module went
// live, and it only came to light because an unrelated towing error sent someone
// looking at the table. Nothing was going to surface that on its own.
//
// So: a module listed live in EXPECTED_MODULES must also appear here, or the guard
// fails. The day you flip a module on, you cannot push until you have answered the
// question "and did I notify the people waiting for it?".
//
// ⚠ HONEST LIMIT — this is a forced ACKNOWLEDGEMENT, not proof of delivery. This script
//   runs offline and cannot reach the database. It guarantees the question gets asked at
//   the right moment and leaves the answer in git history; it cannot guarantee the blast
//   actually sent. Pair it with supabase/audit_module_waitlist_owed.sql, which is the
//   part that checks reality.
const WAITLIST_BLAST_DONE = new Set([
  'pets',    // 4 notified 2026-08-23, 16 days late — see the note above
  'events',  // 1 signup
  'towing',  // 0 signups: every entry point was flag-gated, so nobody could reach
             // its Coming Soon screen to sign up. Nothing owed, ever.

  // 7 notified 2026-08-24, same day as launch — the OTA landed, was verified on the
  // Play Store build across two full open/kill/reopen cycles, and the blast went out
  // immediately after. This entry was briefly the word OWED instead of a date, because
  // the guard blocks both `git push` and `npm run ota` while a live module's blast is
  // outstanding, and the SOP requires notifying LAST. See the log entry "The guard and
  // the SOP contradict each other" — that deadlock is unfixed and will hit the next six
  // launches.
  'accommodation',

  // 2 owed as of 2026-08-26 — NOT yet sent, blast after OTA verification.
  //
  // The guard wants this entry at PUSH time; the go-live SOP notifies at step 10, AFTER
  // the OTA is verified on device. Both cannot be first, and that deadlock is recorded
  // as unfixed. The resolution is that this Set is an ACKNOWLEDGEMENT, not a delivery
  // claim — so it carries the honest state instead of a false one. A follow-up commit
  // replaces this comment with the sent date, as 'accommodation' above did.
  'explore',
])

const EXPECTED_SCALARS = {
  FEATURED_LIVE:         false,
  EXPLORE_FEATURED_LIVE: false,
  PRICE_COMPARE_LIVE:    false,
  // Swaps the bottom-nav map tab from the health MapScreen to the Explore map. Unlike the
  // others this does not gate NEW content — it replaces a surface users already have, so
  // an accidental flip is a downgrade for every user, not merely an early reveal.
  EXPLORE_MAP_LIVE:      true,
}

const src = readFileSync(resolve(ROOT, FLAGS_FILE), 'utf8')

// Strip // and /* */ comments so a commented-out `accommodation: true` in the prose
// above the object cannot be read as a live value.
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')

const block = code.match(/export\s+const\s+MODULE_FLAGS\s*=\s*\{([\s\S]*?)\}/)
if (!block) {
  console.error(`FLAG GUARD: could not find MODULE_FLAGS in ${FLAGS_FILE}.`)
  process.exit(1)
}

const actualModules = {}
for (const m of block[1].matchAll(/([A-Za-z0-9_]+)\s*:\s*(true|false)/g)) {
  actualModules[m[1]] = m[2] === 'true'
}
const actualScalars = {}
for (const k of Object.keys(EXPECTED_SCALARS)) {
  const m = code.match(new RegExp(`export\\s+const\\s+${k}\\s*=\\s*(true|false)`))
  if (m) actualScalars[k] = m[1] === 'true'
}

const problems = []
for (const [k, want] of Object.entries(EXPECTED_MODULES)) {
  if (!(k in actualModules)) { problems.push(`MODULE_FLAGS.${k} is missing from ${FLAGS_FILE}`); continue }
  if (actualModules[k] !== want) {
    problems.push(`MODULE_FLAGS.${k} is ${actualModules[k]}, baseline says ${want}`
      + (actualModules[k] ? '  <-- a gated module would go LIVE' : ''))
  }
}
for (const k of Object.keys(actualModules)) {
  if (!(k in EXPECTED_MODULES)) problems.push(`MODULE_FLAGS.${k} is new and not in this guard's baseline — add it`)
}
// A scalar the baseline knows about that is NOT DECLARED in flags.js is a failure, not a
// skip. The old `if (k in actualScalars && ...)` form passed silently when the export was
// missing entirely — caught for real when a `git checkout -- constants/flags.js` (reverting
// a preview flip) also discarded a newly-added declaration: the guard reported OK, while
// App.js imported EXPLORE_MAP_LIVE from a file that no longer exported it. It resolves to
// undefined, which is falsy, so the app looks correct and the flag has silently ceased to
// exist. The one state a flag guard must never report OK is "the flag is gone".
for (const [k, want] of Object.entries(EXPECTED_SCALARS)) {
  if (!(k in actualScalars)) {
    problems.push(`${k} is in this guard's baseline but is not declared in ${FLAGS_FILE} — `
      + `importers get undefined (falsy), so the gate silently defaults open-or-closed with nothing to say it went missing`)
    continue
  }
  if (actualScalars[k] !== want) {
    problems.push(`${k} is ${actualScalars[k]}, baseline says ${want}`)
  }
}

// A live module with nobody having answered for its waitlist.
for (const [k, live] of Object.entries(actualModules)) {
  if (live && !WAITLIST_BLAST_DONE.has(k)) {
    problems.push(`MODULE_FLAGS.${k} is LIVE but not listed in WAITLIST_BLAST_DONE — `
      + `run supabase/audit_module_waitlist_owed.sql, send anything owed, then add '${k}' there`)
  }
}

// ─── NOTIFY-PATH AGREEMENT ───────────────────────────────────────────────────
//
// A module can accept "Notify me" signups the moment ComingSoonScreen is given its key
// — module_waitlist's CHECK is only a shape guard (^[a-zA-Z]{2,40}$ since 20260814), so
// ANY key is accepted. But notifying those people needs the key to ALSO be in two
// hardcoded SQL lists inside notify_module_waitlist / module_notif_text.
//
// Nothing connected those three facts, and they drifted: explore, studentHub and towing
// all collected signups for months while being un-notifiable. The failure is invisible
// until the one moment it matters — the day you launch the module — and it surfaces as
// either "unknown module" or, worse, a NOT NULL violation on notifications.title that
// names nothing relevant.
//
// So the check is mechanical and runs wherever this script already runs: every push
// (.githooks/pre-push), every `npm run ota`, every `eas build`. Add a module to
// MODULE_FLAGS without adding it to the notify path and you cannot ship.
// ⚠ POINTS AT THE MIGRATION THAT MOST RECENTLY REDEFINED THESE TWO FUNCTIONS, not at a
// fixed historical file. CREATE OR REPLACE means the newest definition is the only true
// one, so a migration that adds a module to the notify path MUST repoint this constant in
// the same commit — otherwise the guard reads a superseded file and blocks every push
// complaining about a module the database already knows about.
const NOTIFY_SQL = 'supabase/migrations/20260918_notify_waitlist_add_checkins.sql'
try {
  const sql = readFileSync(resolve(ROOT, NOTIFY_SQL), 'utf8')

  // the RPC's guard list
  const guard = sql.slice(sql.indexOf('p_module NOT IN'))
  const whitelist = new Set([...guard.slice(0, 400).matchAll(/'([a-zA-Z]+)'/g)].map(m => m[1]))

  // the English-fallback display-name list — the one whose absence yields a NULL title
  const fbTail = sql.lastIndexOf('AS g(mod, nm)')
  const fbHead = sql.lastIndexOf('(SELECT nm FROM (VALUES', fbTail)
  const names = new Set([...sql.slice(fbHead, fbTail).matchAll(/\('([a-zA-Z]+)',/g)].map(m => m[1]))

  for (const k of Object.keys(actualModules)) {
    if (!whitelist.has(k)) problems.push(`MODULE_FLAGS.${k} is missing from the notify_module_waitlist whitelist in ${NOTIFY_SQL} — signups for it could never be notified`)
    if (!names.has(k))     problems.push(`MODULE_FLAGS.${k} has no English display name in module_notif_text (${NOTIFY_SQL}) — a blast would abort on notifications.title NOT NULL`)
  }
} catch (e) {
  problems.push(`could not read ${NOTIFY_SQL} to verify the notify path: ${e.message}`)
}

if (problems.length) {
  console.error('')
  console.error('  ┌─ FLAG GUARD FAILED ────────────────────────────────────────────┐')
  for (const p of problems) console.error(`  │ ${p}`)
  console.error('  └────────────────────────────────────────────────────────────────┘')
  console.error('')
  console.error(`  If you flipped a flag to preview a screen, revert it:`)
  console.error(`      git checkout -- ${FLAGS_FILE}`)
  console.error('')
  console.error(`  If a module is genuinely launching, update BOTH files in one commit:`)
  console.error(`      ${FLAGS_FILE}  and  scripts/check-module-flags.mjs`)
  console.error('')
  process.exit(1)
}

console.log(`flag guard: OK (${Object.values(EXPECTED_MODULES).filter(Boolean).length} module(s) live: `
  + Object.entries(EXPECTED_MODULES).filter(([, v]) => v).map(([k]) => k).join(', ') + ')')
