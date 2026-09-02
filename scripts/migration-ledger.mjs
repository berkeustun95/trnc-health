#!/usr/bin/env node
// ─── Applied-migrations ledger ───────────────────────────────────────────────
//
//   node scripts/migration-ledger.mjs             # regenerate supabase/migration_ledger_check.sql
//   node scripts/migration-ledger.mjs --baseline   # emit the one-time bootstrap migration
//   node scripts/migration-ledger.mjs --stamp <file.sql>   # print the INSERT for one migration
//
// WHY THIS EXISTS: migrations are applied by selecting text in the Supabase SQL editor
// and running it. That has three failure modes and the workflow detects none of them:
//
//   1. PARTIAL APPLICATION — a truncated selection applies some statements. This is
//      what happened to 20260802_garage_booking_details.sql: its ADD COLUMN landed and
//      its DROP COLUMN did not, and the file has no BEGIN/COMMIT to make that impossible.
//   2. NEVER APPLIED — a file is committed and forgotten. verify_schema.sql catches this
//      only for objects somebody remembered to register.
//   3. APPLIED, THEN EDITED — the file on disk no longer matches what ran. Nothing today
//      can see this, which is exactly why 20260802 cannot be diagnosed any further.
//
// The ledger closes all three. Every migration's LAST statement, inside its transaction,
// records its own filename and the sha256 of the file as applied. Then:
//   • partial paste  → the INSERT is never reached, so the transaction never commits
//   • never applied  → no ledger row; the check below lists it
//   • edited after   → checksum no longer matches disk; the check below lists it
//
// The checksum algorithm lives HERE and only here, so the baseline, the per-migration
// stamp, and the check can never drift apart.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATIONS = resolve(ROOT, 'supabase/migrations')
const CHECK_OUT = resolve(ROOT, 'supabase/migration_ledger_check.sql')

// The bootstrap migration cannot appear in its own baseline: its checksum would have to
// be computed from a file that contains that checksum. It is excluded by name, and the
// LEDGER TABLE EXISTING is its own applied-record — nothing else can have created it.
const BOOTSTRAP = '20260903_migration_ledger.sql'

// Only supabase/migrations/. The root-level supabase/*.sql files predate this convention
// and are legacy; the ledger tracks the directory the workflow actually uses.
const files = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()
const tracked = files.filter(f => f !== BOOTSTRAP)

const q = s => `'${String(s).replace(/'/g, "''")}'`

// ─── THE STAMP BLOCK, AND WHY THE CHECKSUM IGNORES IT ────────────────────────
//
// A migration records its own checksum as its last statement. That is circular on its
// face: the checksum is of the file, and the checksum lives IN the file, so writing it
// changes it. (Measured, not assumed: appending a stamp moved one file's hash from
// 9ccb1607… to 831a11c1…. A hash fixed-point is not findable.)
//
// The first version of this tool sidestepped it by printing the stamp for a human to
// paste into the SQL editor while the committed file stayed unstamped. That worked but
// left the file on disk different from the text that actually ran.
//
// This version resolves it properly: the checksum is of THE FILE WITH THE STAMP BLOCK
// STRIPPED. So a file can carry its own stamp, disk and ledger agree, and the migration
// file itself is the thing you paste.
//
// ─── WHY THE CANONICAL-BODY MATCH IS LOAD-BEARING (do not remove it) ─────────
//
// Stripping means the region between the markers is EXCLUDED FROM THE CHECKSUM but is
// still executed when the file is pasted. Without checkCanonical() below, the stamp
// block is therefore a place to hide DDL: a `DROP TABLE users;` sitting between the
// markers would run on paste and leave no trace in the hash, so the ledger would attest
// a file whose real content differs from what it verified. That is precisely the
// "applied, then edited" failure this whole table exists to detect — reintroduced, and
// invisible, inside the mechanism meant to catch it.
//
// checkCanonical() closes that by requiring the region to be EXACTLY the generated
// INSERT (comment lines aside). The stripped content is then fully determined by
// (filename, checksum) and carries no information of its own, which is what makes
// ignoring it safe.
//
// The markers are RESERVED TOKENS. A migration must not use them in prose — the guards
// below fail closed and loudly if it does. If the stamp's SQL shape ever has to change,
// bump the marker to `ledger:stamp:begin:v2` and keep a reader for both.

const STAMP_BEGIN = '-- ─── ledger:stamp:begin'
const STAMP_END   = '-- ─── ledger:stamp:end'

const CANONICAL_STAMP =
  /^INSERT INTO public\.schema_migrations_applied \(filename, checksum\)\nVALUES \('([^']+)', '([0-9a-f]{64})'\)\nON CONFLICT \(filename\) DO UPDATE\n  SET checksum = excluded\.checksum, applied_at = now\(\), applied_by = current_user;$/

// Remove the stamp block, or return the text untouched when there is none.
// Throws on anything ambiguous — never guesses.
function stripStamp(text, filename) {
  const nBegin = text.split(STAMP_BEGIN).length - 1
  const nEnd   = text.split(STAMP_END).length - 1
  if (nBegin === 0 && nEnd === 0) return text          // unstamped: byte-identical no-op
  if (nBegin !== 1 || nEnd !== 1) {
    throw new Error(`${filename}: ${nBegin} begin / ${nEnd} end marker(s) — expected exactly one of each`)
  }
  const i = text.indexOf(STAMP_BEGIN)
  const j = text.indexOf(STAMP_END)
  if (j < i) throw new Error(`${filename}: end marker precedes begin marker`)
  const e = text.indexOf('\n', j)
  if (e === -1) throw new Error(`${filename}: end marker line is unterminated`)

  const body = text.slice(i, e).split('\n').slice(1, -1)
    .filter(l => !l.startsWith('--')).join('\n').trim()
  const m = CANONICAL_STAMP.exec(body)
  if (!m) throw new Error(`${filename}: stamp region is not the canonical INSERT — refusing to strip`)
  if (m[1] !== filename) throw new Error(`${filename}: stamp names '${m[1]}' — copied from another migration?`)

  // slice(e), NOT slice(e + 1). The newline that terminates the END marker line belongs
  // to the ORIGINAL text — it is the one preceding COMMIT;. Consuming it as well as the
  // newline before BEGIN removes one too many and the round-trip silently fails. The
  // first draft of this function had exactly that bug; assertRoundTrip() caught it.
  return text.slice(0, i).replace(/\n$/, '') + text.slice(e)
}

function stampBlock(filename, checksum) {
  return `${STAMP_BEGIN} ──────────────────────────────────────────────
-- Machine-generated by scripts/migration-ledger.mjs --stamp. Do not hand-edit.
-- The checksum is of THIS FILE WITH THIS BLOCK STRIPPED, which is what lets the file
-- carry its own stamp. Everything between the markers is excluded from the checksum
-- but still runs — so it may contain NOTHING but this INSERT. See the note in the
-- generator: anything else here would execute on paste while leaving no trace in the
-- hash, and the ledger would be attesting a file it never actually verified.
--
-- This is also the LAST statement inside BEGIN/COMMIT: if a paste is truncated before
-- it, COMMIT is never reached and nothing applies.
INSERT INTO public.schema_migrations_applied (filename, checksum)
VALUES ('${filename}', '${checksum}')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
${STAMP_END} ────────────────────────────────────────────────`
}

const readMigration = f => readFileSync(resolve(MIGRATIONS, f), 'utf8')
const sha256text = t => createHash('sha256').update(Buffer.from(t, 'utf8')).digest('hex')

// THE checksum, used identically by --baseline, --stamp and the check generator.
const sha256 = f => sha256text(stripStamp(readMigration(f), f))

// ─── --stamp: write the migration's own checksum into the migration ──────────

const stampIdx = process.argv.indexOf('--stamp')
if (stampIdx !== -1) {
  const f = basename(process.argv[stampIdx + 1] ?? '')
  if (!f || !files.includes(f)) {
    console.error(`Usage: --stamp <filename.sql>  (must exist in supabase/migrations/)`)
    process.exit(1)
  }
  if (f === BOOTSTRAP) {
    console.error(`${BOOTSTRAP} is the bootstrap — it is not tracked and must not be stamped.`)
    process.exit(1)
  }

  const original = readMigration(f)
  const bare     = stripStamp(original, f)      // re-stamping is idempotent
  const checksum = sha256text(bare)

  // Insert as the last statement inside the transaction.
  const commits = (bare.match(/^COMMIT;$/gm) || []).length
  if (commits !== 1) {
    console.error(`${f}: found ${commits} top-level 'COMMIT;' lines, need exactly 1 to place the stamp.`)
    console.error(`Place the block by hand as the last statement inside the transaction.`)
    process.exit(1)
  }
  const stamped = bare.replace('\nCOMMIT;', '\n' + stampBlock(f, checksum) + '\nCOMMIT;')

  // ─── SELF-ASSERTION: the stamper must be its own inverse ───────────────────
  // Not ceremony. The first implementation of stripStamp() was off by one newline and
  // this is what caught it. If insert and strip ever stop being exact inverses, every
  // stamp written from then on is wrong and the drift check goes red for the wrong
  // reason — so refuse to write rather than find out later.
  const back = stripStamp(stamped, f)
  if (back !== bare) {
    console.error(`${f}: ABORT — strip(stamp(x)) !== x. Insert and strip are not inverses.`)
    process.exit(1)
  }
  if (sha256text(back) !== checksum) {
    console.error(`${f}: ABORT — checksum does not survive the round trip.`)
    process.exit(1)
  }

  if (stamped === original) {
    console.log(`\nunchanged: ${f} already carries this stamp (${checksum.slice(0, 12)}…)\n`)
    process.exit(0)
  }
  writeFileSync(resolve(MIGRATIONS, f), stamped)
  console.log(`\nstamped: supabase/migrations/${f}`)
  console.log(`  checksum (stamp block excluded): ${checksum}`)
  console.log(`  round-trip verified: strip(stamped) is byte-identical to the unstamped file`)
  console.log(`\nNow regenerate the check:  node scripts/migration-ledger.mjs\n`)
  process.exit(0)
}

// ─── --baseline: the one-time bootstrap migration ────────────────────────────

if (process.argv.includes('--baseline')) {
  const rows = tracked.map(f => `  (${q(f)}, ${q(sha256(f))})`)
  const sql = `-- ─── Applied-migrations ledger — bootstrap ───────────────────────────────────
--
-- GENERATED ONCE by scripts/migration-ledger.mjs --baseline. Do not regenerate: the
-- checksums below are a point-in-time baseline, and re-running would silently restate
-- whatever the files say today as though it had been verified.
--
-- WHY: migrations are applied by pasting into the SQL editor, which can apply a file
-- partially, skip it entirely, or apply a version that was later edited. Nothing in this
-- repo could detect any of those. See docs/schema-drift-audit.md.
--
-- ─── WHAT THE BASELINE ROWS ASSERT, EXACTLY ─────────────────────────────────
-- These ${rows.length} rows assert: **"this file matches live as of the 2026-08-19 schema drift
-- audit"** — NOT "this file is what was applied".
--
-- Those two statements differ, and 20260802_garage_booking_details.sql is the proof:
-- its ADD COLUMN is live and its DROP COLUMN is not, so *something other than the
-- current file* ran. Whatever that was is unrecoverable. The baseline records the state
-- the audit verified, and is honest that it cannot speak to provenance.
--
-- The distinction stops mattering for every migration applied AFTER this one, because
-- those stamp their own checksum at apply time — which is a provenance claim.
--
-- The baseline is defensible rather than assumed because the audit that day found
-- sections A/D/E/G empty across 390 columns, 153 constraints and 31 indexes: every
-- object the repo declares had reached the database. It is a verified state, not a hope.
--
-- ${BOOTSTRAP} is deliberately ABSENT from its own baseline — a file cannot contain its
-- own checksum. The existence of this table is its applied-record; nothing else creates it.
--
-- EXECUTION: SET ROLE postgres. SQL editor Role selector = postgres.

SET ROLE postgres;
BEGIN;

CREATE TABLE IF NOT EXISTS public.schema_migrations_applied (
  filename    text PRIMARY KEY,
  checksum    text NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  applied_by  text NOT NULL DEFAULT current_user
);

COMMENT ON TABLE public.schema_migrations_applied IS
  'One row per applied migration. Baseline rows (applied_by = ''baseline'') assert only '
  'that the file matched live as of the 2026-08-19 drift audit, NOT that the file is what '
  'ran. Rows written after that are provenance: the migration stamped its own checksum '
  'at apply time. Compare against disk with supabase/migration_ledger_check.sql.';

-- RLS on, zero policies. See the access note at the foot of this file.
ALTER TABLE public.schema_migrations_applied ENABLE ROW LEVEL SECURITY;

-- ORDERING GUARD, specific to this bootstrap.
--
-- The baseline is generated from the files on DISK, and it asserts they match live. At
-- the moment it was generated, 20260902_capture_schema_drift.sql was on disk but NOT yet
-- applied — so baselining before it runs would record a claim that is simply false for
-- that one file, in the very table built to stop false claims.
--
-- This aborts unless 20260902's four outcomes are all present. Apply 20260902 first.
DO $$
DECLARE
  missing text := '';
BEGIN
  -- appointments.service_type: RETIRED 2026-09-02. 20261004 dropped the whole table, so
  -- this clause can no longer distinguish anything — information_schema returns zero rows
  -- for a table that does not exist, which reads exactly like a correctly-dropped column.
  -- A check that cannot fail is worse than no check, so it is deleted rather than left
  -- to look like coverage. The table's absence is asserted by verify_schema.sql's
  -- '1004_appointments_removal / public.appointments is GONE' token, which owns that fact.
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='claim_requests' AND column_name='kteb_confirmed')
    THEN missing := missing || ' claim_requests.kteb_confirmed still present;'; END IF;
  IF to_regclass('public.facilities_backup_20260718') IS NOT NULL
    THEN missing := missing || ' facilities_backup_20260718 still present;'; END IF;
  IF to_regclass('public.duty_list_date_idx') IS NULL
    THEN missing := missing || ' duty_list_date_idx absent;'; END IF;
  IF missing <> '' THEN
    RAISE EXCEPTION
      'Apply 20260902_capture_schema_drift.sql BEFORE this migration.%'
      ' The baseline below claims every file on disk matches live, and that claim would'
      ' be false for 20260902 until it has run.', missing;
  END IF;
END $$;

INSERT INTO public.schema_migrations_applied (filename, checksum, applied_by) VALUES
${rows.map(r => r.replace(/\)$/, ", 'baseline')")).join(',\n')}
ON CONFLICT (filename) DO NOTHING;

COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Who can do what ─────────────────────────────────────────────────────────
-- RLS is ENABLED and there are ZERO policies, which in Postgres means: no row is
-- visible or writable to any role that RLS applies to. Concretely —
--   • anon (a logged-out client) and authenticated (every customer, provider,
--     organizer and admin): CANNOT read, insert, update or delete a single row. RLS
--     with no permissive policy denies by default.
--   • service_role and postgres: full access, because both BYPASS RLS.
--   • So this table is reachable only from the SQL editor and from a service_role
--     script. No app query can see it, which is correct — it is operational metadata
--     about the repo, not application data, and it names internal file paths.
-- No other table's policies are touched.

-- ─── Verification (run after applying) ───────────────────────────────────────
--   SELECT count(*) AS baseline_rows FROM public.schema_migrations_applied;
--   -- expect ${rows.length}
--
--   SELECT relrowsecurity,
--          (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
--   FROM pg_class c WHERE c.oid = 'public.schema_migrations_applied'::regclass;
--   -- expect true, 0
--
--   -- Then run supabase/migration_ledger_check.sql — it must return ZERO rows.

-- ─── Rollback ────────────────────────────────────────────────────────────────
--   SET ROLE postgres;
--   DROP TABLE IF EXISTS public.schema_migrations_applied;
--   RESET ROLE;
--   NOTIFY pgrst, 'reload schema';
`
  writeFileSync(resolve(MIGRATIONS, BOOTSTRAP), sql)
  console.log(`\nwritten: supabase/migrations/${BOOTSTRAP}`)
  console.log(`  baseline rows: ${rows.length}  (${files.length} files, minus the bootstrap itself)`)
  console.log('')
  process.exit(0)
}

// ─── default: the read-only ledger check ─────────────────────────────────────
//
// A SEPARATE file from schema_drift_audit.sql on purpose. The audit must keep working
// before the ledger exists, and a query that references a missing table fails at plan
// time — there is no way to make one section conditional in plain SQL. Keeping them
// apart means neither can break the other.

const rows = tracked.map(f => `  (${q(f)}, ${q(sha256(f))})`)

const check = `-- ─── Applied-migrations ledger check — READ ONLY, SINGLE RESULT SET ──────────
--
-- GENERATED by scripts/migration-ledger.mjs. Do not hand-edit — regenerate after adding
-- a migration.
--
-- Compares public.schema_migrations_applied against the ${rows.length} files currently in
-- supabase/migrations/. ZERO ROWS = every migration is applied and unedited since.
--
-- Requires the ledger to exist (supabase/migrations/${BOOTSTRAP}).
-- Kept separate from schema_drift_audit.sql so that audit still runs before the ledger
-- exists — a query naming a missing table fails at plan time, and plain SQL has no way
-- to make one section conditional.
--
-- SAFE: SELECT only.

WITH ondisk (filename, checksum) AS (VALUES
${rows.join(',\n')}
)
SELECT * FROM (
  -- NEVER APPLIED — committed and forgotten. Apply it, or delete the file.
  SELECT 'L1-never-applied' AS section, d.filename AS c1,
         'no ledger row' AS c2, '' AS c3
  FROM ondisk d
  WHERE NOT EXISTS (SELECT 1 FROM public.schema_migrations_applied l
                    WHERE l.filename = d.filename)

  UNION ALL
  -- EDITED AFTER APPLYING — the file on disk is not what ran. The case nothing could
  -- previously detect. A baseline row differing here means the file changed since
  -- 2026-08-19; re-verify against live before trusting either side.
  SELECT 'L2-checksum-mismatch', d.filename,
         'ledger ' || left(l.checksum, 12) || '…  disk ' || left(d.checksum, 12) || '…',
         'applied_by=' || l.applied_by || ' at ' || l.applied_at::date
  FROM ondisk d
  JOIN public.schema_migrations_applied l ON l.filename = d.filename
  WHERE l.checksum <> d.checksum

  UNION ALL
  -- IN THE LEDGER, NOT ON DISK — a migration file was deleted or renamed after being
  -- applied. Not necessarily wrong, but the repo no longer describes something that ran.
  SELECT 'L3-ledger-orphan', l.filename,
         'file absent from supabase/migrations/', 'applied ' || l.applied_at::date
  FROM public.schema_migrations_applied l
  WHERE NOT EXISTS (SELECT 1 FROM ondisk d WHERE d.filename = l.filename)
    AND l.filename <> ${q(BOOTSTRAP)}
) r
ORDER BY section, c1;
`

writeFileSync(CHECK_OUT, check)
console.log('')
console.log(`written: ${CHECK_OUT.replace(ROOT + '/', '')}`)
console.log(`  migrations tracked: ${rows.length}  (${files.length} files, minus the bootstrap)`)
console.log(`  sections: L1 never-applied · L2 checksum-mismatch · L3 ledger-orphan`)
console.log('')
