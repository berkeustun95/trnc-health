// ─── Production writes happen in GitHub Actions, nowhere else ────────────────
//
// Decided 2026-10-01, after a local `import-gisekibris-events.mjs --selftest` (a flag
// that script did not have) silently ran a real import and rewrote a production row.
//
// Every script that can write production calls prodWriteGuard() FIRST — before .env is
// read and before any client exists. Outside CI a write-mode run stops here with the
// workflow to dispatch instead; dry-run modes still pass.
//
// ⚠ THIS IS A TRIPWIRE, NOT THE BOUNDARY. `GITHUB_ACTIONS=true node …` walks past it.
//   The boundary is that no service key lives on a developer machine: the only copy is
//   the repository secret SUPABASE_SERVICE_ROLE_KEY. What this file adds is that a
//   key which quietly comes back to a laptop still cannot be used by accident.
//
// scripts/check-prod-write-guard.mjs asserts every write-capable script calls this
// before it creates a client. A new writer that forgets is a red CI step, not a memory.

import { execFileSync } from 'node:child_process'

export const inCI = () => process.env.GITHUB_ACTIONS === 'true'

export function prodWriteGuard({ wouldWrite, workflow, dryHint }) {
  if (!wouldWrite || inCI()) return
  console.error([
    'REFUSED: this run would write to the production database, and production is',
    'written only from GitHub Actions. Nothing was run.',
    '',
    workflow
      ? `  Run it in CI:  gh workflow run ${workflow}   (then: gh run watch)`
      : '  This script has no workflow: it is retired, shelved, or needs inputs that are',
    workflow ? '' : '  not in the repo. Give it a workflow before it writes again.',
    dryHint ? `  Locally, only the dry run is allowed:  ${dryHint}` : '',
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n'))
  process.exit(1)
}

// The service key: the repository secret on the runner; locally, the Keychain entry if
// one still exists (read-only dry runs). Fails loudly, never falls back to anything else.
export function serviceRoleKey() {
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || ''
  if (!key && !inCI()) {
    try {
      key = execFileSync('security', ['find-generic-password', '-s', 'ada-supabase-service-role', '-w'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    } catch { /* reported below */ }
  }
  if (!key) {
    console.error(inCI()
      ? 'SUPABASE_SERVICE_ROLE_KEY is not set — add it to the workflow env from the repository secret.'
      : 'No service key on this machine (removed 2026-10-01 by design). Production reads that need\n' +
        'one, and all writes, run in GitHub Actions — see .github/workflows/.')
    process.exit(1)
  }
  if (key.startsWith('sb_publishable_')) {
    console.error('The service key is the PUBLISHABLE key: it is bound by RLS and cannot do this job.')
    process.exit(1)
  }
  return key
}
