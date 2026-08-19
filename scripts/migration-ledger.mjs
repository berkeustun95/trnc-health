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

const sha256 = f => createHash('sha256').update(readFileSync(resolve(MIGRATIONS, f))).digest('hex')
const q = s => `'${String(s).replace(/'/g, "''")}'`

// ─── --stamp: the line a new migration ends with ─────────────────────────────

const stampIdx = process.argv.indexOf('--stamp')
if (stampIdx !== -1) {
  const f = basename(process.argv[stampIdx + 1] ?? '')
  if (!f || !files.includes(f)) {
    console.error(`Usage: --stamp <filename.sql>  (must exist in supabase/migrations/)`)
    process.exit(1)
  }
  console.log(`
-- Last statement of ${f}, INSIDE its BEGIN/COMMIT. If the paste is truncated before
-- this line, the transaction never commits and nothing applies.
INSERT INTO public.schema_migrations_applied (filename, checksum)
VALUES (${q(f)}, ${q(sha256(f))})
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
`)
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
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='appointments' AND column_name='service_type')
    THEN missing := missing || ' appointments.service_type still present;'; END IF;
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
