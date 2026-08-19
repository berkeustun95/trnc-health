-- ─── Capture: reconcile the repo with the live schema ────────────────────────
--
-- PROPOSAL — do not apply until supabase/schema_drift_audit.sql has been run. If its
-- sections B, E–H or K return rows, EXTEND this file rather than applying it and then
-- needing a second capture. One item is already known to be pending that run:
-- duty_list_date_idx exists in the database and is created by no migration, but its
-- definition can only be read from pg_indexes, so it cannot be recorded here yet.
--
-- HOW THE DRIFT WAS FOUND: every DDL statement in supabase/ and supabase/migrations/
-- is replayed by scripts/audit-schema-drift.mjs to build the schema the repo claims,
-- then compared against the live schema. Not against verify_schema.sql's register —
-- that only checks what somebody remembered to add to it, so anything that drifted
-- before a token existed is invisible to it by construction.
--
-- THE AUDIT'S FIRST RUN WAS MOSTLY WRONG, and that is worth recording. It reported
-- ~70 rows; all but three were parser defects — drop-then-create idempotency read as
-- "dropped", inline unnamed CHECK constraints never parsed, root files replayed in
-- alphabetical order so an ALTER preceded its CREATE TABLE, and truncated multi-word
-- type names. A tool whose output has to be hand-filtered is worse than no tool,
-- because the filtering is the judgement it was supposed to automate. The generator
-- was fixed and its naming logic validated against the 47 real constraint names
-- captured from the live database in 20260718_capture_2_check_constraints.sql.
--
-- WHAT SURVIVED: two columns, and one table.
--
-- THE PATTERN WORTH KEEPING: of 390 columns compared, every additive migration had
-- applied correctly — zero repo columns are missing from the database. But the repo
-- contains exactly one DROP COLUMN and one RENAME COLUMN, and NEITHER took effect.
-- Manual-apply lands the additive half of a migration and misses the destructive
-- half. Both steps below are that, by two different routes.
--
-- Follows from it, for every future migration: wrap destructive statements in
-- BEGIN/COMMIT so the additive half cannot survive without them.
--
-- Idempotent: both drops are IF EXISTS, the COMMENT is a replace, and each
-- destructive step is preceded by a guard that ABORTS if the column has gained data
-- since this was written (both were empty at authoring time, verified).
--
-- EXECUTION: SET ROLE postgres. SQL editor Role selector = postgres.
-- RUN THE PRE-FLIGHT PROBES FIRST — foot of this file.

SET ROLE postgres;
BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- WITHDRAWN: step 1 was going to DROP NOT NULL on events.organizer_id. It is not
-- needed. supabase/events_gisekibris_migration.sql:29 already does exactly that, and
-- it has already been applied — the column is nullable in the database and the repo
-- says so too. It was reported as drift by an audit bug, not by the database:
-- root-level SQL files were replayed in alphabetical order, so
-- events_gisekibris_migration.sql (the ALTER) ran before events_migration.sql (the
-- CREATE TABLE that sets NOT NULL), the ALTER hit a table that did not exist yet, and
-- the CREATE then won. Fixed by replaying every CREATE TABLE before any ALTER.
-- The same bug produced the beaches/landmarks description-jsonb false positive.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. appointments.service_type — finish what 20260802 started.
--
-- 20260802_garage_booking_details.sql replaced this single-text column with the
-- garage_booking_details jsonb. `garage_booking_details` IS live, so that file was
-- run — but its DROP COLUMN never took effect. The file has no BEGIN/COMMIT (only
-- SET ROLE … RESET ROLE), so its statements autocommit independently and a partial
-- paste leaves exactly this state.
--
-- Dead column: no app code reads appointments.service_type (the garage UI reads
-- facilities.service_types, a different column on a different table), and all 10
-- appointment rows have it NULL.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.appointments WHERE service_type IS NOT NULL;
  IF n > 0 THEN
    RAISE EXCEPTION
      'appointments.service_type holds % non-null row(s) — it was empty when this '
      'migration was written. Something now writes it. Do NOT drop it blind: find the '
      'writer, decide whether the value belongs in garage_booking_details, then re-run.', n;
  END IF;
END $$;

ALTER TABLE public.appointments DROP COLUMN IF EXISTS service_type;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. claim_requests.kteb_confirmed — remove a resurrected column.
--
-- 20260719_claim_rename_and_tax_no.sql does
--     RENAME COLUMN kteb_confirmed TO business_verified
-- and the database has BOTH columns. A rename cannot produce both, so the sequence
-- was: rename ran (business_verified and tax_registration_no are both live, which
-- proves it), and then 20260719_claim_evidence_and_guard.sql — whose line reads
--     ADD COLUMN IF NOT EXISTS kteb_confirmed boolean NOT NULL DEFAULT false
-- — was re-run afterwards and recreated the old column from scratch.
--
-- THE GENERAL LESSON, worth more than this one column: `ADD COLUMN IF NOT EXISTS`
-- is NOT re-run-safe once a later migration renames that column. The guard checks
-- the OLD name, which by then no longer exists, so the column is silently re-added
-- and you end up with the pre-rename column and the post-rename column side by side.
-- Re-running an "idempotent" migration out of order is not free.
--
-- Safe to drop: business_verified carries the real value, and both columns are
-- currently all-false across all 3 rows, so no information is lost.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.claim_requests
   WHERE kteb_confirmed IS DISTINCT FROM business_verified;
  IF n > 0 THEN
    RAISE EXCEPTION
      'claim_requests: % row(s) where kteb_confirmed differs from business_verified. '
      'The columns were identical when this migration was written, so dropping now '
      'WOULD LOSE information. Reconcile the two columns first.', n;
  END IF;
END $$;

ALTER TABLE public.claim_requests DROP COLUMN IF EXISTS kteb_confirmed;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. facilities_backup_20260718 — ARCHIVE HERE, THEN DROP.
--
-- A live table with no CREATE TABLE anywhere in the repo, no verify_schema entry, and
-- no reader: nothing in app code, scripts, functions, views or policies references it.
-- It is a pre-dedup snapshot of `facilities` taken during the 2026-07-18 capture work
-- and never cleaned up.
--
-- WHAT IS ACTUALLY IN IT (411 rows / 26 columns, measured before writing this):
--   397  also present in `facilities` today, byte-identical except 3 rows differing on
--        status (2) and photos (1)
--    12  deleted DUPLICATES — six state hospitals appeared 3× in the snapshot and
--        appear once now, so the dedup that followed removed 12 rows
--     2  unique to the snapshot (below)
-- and `facilities` has since gained 10 columns the snapshot does not have (category,
-- city, area, service_types, service_prices, hidden_*, featured_*), so it could not
-- serve as a restore source even if someone wanted it to.
--
-- THE ONLY UNRECOVERABLE CONTENT, archived verbatim so the drop loses nothing:
--   name: 'Near East Hospital'    type: hospital  address: 'Yakın Doğu Blv, Lefkoşa'
--   name: 'Gönyeli Diş Kliniği'   type: dentist   address: 'Gönyeli, Lefkoşa'
--   both: phone NULL, verified true, is_public FALSE, status 'active',
--         provider_id NULL, created_at 2026-05-30T22:01:56.848802+00
--
-- WHY DROPPING IS SAFE RATHER THAN MERELY TIDY: every one of the 399 rows in
-- `facilities` today has is_public = true. Both deleted rows had is_public = FALSE —
-- they were hidden from the public directory, carried no phone number, and were created
-- in the 2026-05-30 bulk seed. They are seed stubs that were deliberately excluded and
-- then removed, not data anyone lost.
--
-- AND WHY NOT KEEP IT: it sits in the PostgREST API surface. It is unreachable today
-- only because RLS is on with zero policies — one accidental permissive policy away
-- from publishing 411 rows. A COMMENT would convert an unfinished incident artifact
-- into permanent furniture; the point of this migration is to close 18 July, not to
-- register it.
--
-- SEPARATE PRODUCT QUESTION, deliberately NOT actioned here: Near East Hospital is a
-- real and significant private hospital in Lefkoşa and there is no facility of that
-- name, or any 'Yakın Doğu' spelling, in the directory today. Gönyeli has 20 pharmacies
-- and no dentist. Both may be intentional. Raised in docs/schema-drift-audit.md; adding
-- a facility is curation, not a schema migration.
--
-- No CASCADE, on purpose: if anything does depend on this table, the DROP must fail and
-- tell us rather than quietly taking the dependency with it.
DROP TABLE IF EXISTS public.facilities_backup_20260718;

COMMIT;
RESET ROLE;

-- No ADD COLUMN, so no NOTIFY pgrst is strictly required. But steps 1 and 2 REMOVE
-- columns and step 3 removes a whole table, and a stale PostgREST cache would keep
-- advertising all three in the OpenAPI spec until it reloads.
NOTIFY pgrst, 'reload schema';

-- ─── Who can do what after this migration ────────────────────────────────────
-- Unchanged. No policy is added or altered, no RLS is enabled or disabled, no trigger
-- or function is touched. Every table keeps exactly the policies it has today.
--   • appointments / claim_requests: the dropped columns are unread by app code and
--     unreferenced by any policy, so no policy expression breaks.
--   • facilities_backup_20260718 ceases to exist, so it leaves the PostgREST API
--     surface entirely. Nothing could read it before (RLS on, zero policies) and
--     nothing referenced it, so no caller loses anything.

-- ─── Pre-flight probes (RUN BEFORE APPLYING) ─────────────────────────────────
--   -- P1. Both guards must return 0, or the corresponding step aborts by design.
--   SELECT count(*) AS service_type_rows FROM public.appointments WHERE service_type IS NOT NULL;
--   SELECT count(*) AS kteb_disagreements FROM public.claim_requests
--    WHERE kteb_confirmed IS DISTINCT FROM business_verified;
--
--   -- P2. Confirm the starting state this migration assumes.
--   SELECT table_name, column_name, is_nullable FROM information_schema.columns
--   WHERE table_schema='public'
--     AND (table_name, column_name) IN
--       (('events','organizer_id'), ('appointments','service_type'),
--        ('claim_requests','kteb_confirmed'), ('claim_requests','business_verified'))
--   ORDER BY 1, 2;
--   -- expect events.organizer_id YES; the other three present
--
--   -- P3. The backup table's RLS posture, which step 4's assertion depends on.
--   SELECT relname, relrowsecurity,
--          (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
--   FROM pg_class c WHERE c.oid = 'public.facilities_backup_20260718'::regclass;
--   -- expect relrowsecurity = true, policies = 0

-- ─── Verification (run after applying) ───────────────────────────────────────
--   -- The two columns are gone, organizer_id is nullable:
--   SELECT table_name, column_name FROM information_schema.columns
--   WHERE table_schema='public'
--     AND (table_name, column_name) IN
--       (('appointments','service_type'), ('claim_requests','kteb_confirmed'));
--   -- expect ZERO rows
--
--   SELECT is_nullable FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='events' AND column_name='organizer_id';
--   -- expect YES
--
--   -- Nothing else lost a column:
--   SELECT count(*) FROM information_schema.columns WHERE table_schema='public';
--   -- expect the pre-flight count minus exactly 2
--
--   -- Then re-run the full audit; sections A, C and D must all come back empty:
--   --   supabase/schema_drift_audit.sql

-- ─── Rollback ────────────────────────────────────────────────────────────────
--   Steps 1 and 2 destroy columns. Both were empty at authoring time and the guards
--   refuse to run if that changed, so a rollback restores structure, not data.
--   SET ROLE postgres;
--   BEGIN;
--   ALTER TABLE public.appointments   ADD COLUMN IF NOT EXISTS service_type text;
--   ALTER TABLE public.claim_requests ADD COLUMN IF NOT EXISTS kteb_confirmed boolean NOT NULL DEFAULT false;
--   COMMIT;
--   RESET ROLE;
--   NOTIFY pgrst, 'reload schema';
