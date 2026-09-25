-- ═══════════════════════════════════════════════════════════════════════════
-- 20261052 — app_update_events_purge_status(): read-only view of ONE cron job
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 20261051 scheduled a nightly purge for app_update_events. Whether that job EXISTS was
-- proved when it applied (the DO block read cron.job inside the transaction). Whether it
-- ever FIRES cannot be proved that way, and it is the one thing the PGlite harness can never
-- model — pg_cron is stubbed there, so a green harness run says nothing about it.
--
-- Checking it needs `cron`, and nothing outside the SQL editor can reach that schema:
-- PostgREST exposes `public` only (PGRST106), and the anon key is the only credential this
-- repo holds. This function is the narrowest possible window onto the one job that matters.
--
-- ─── WHAT IT DELIBERATELY CANNOT DO ─────────────────────────────────────────
--
--   • It takes NO PARAMETERS. The job name is a literal in the body, so there is no input to
--     steer and no way to ask it about a different job. That is the whole security design,
--     and `pronargs = 0` is what verify_schema asserts — a structural fact, not a promise.
--   • It returns four columns. No jobid, no command, no database, no username — nothing that
--     describes the schedule or the server, only whether the run worked and what it said.
--   • It is STABLE and reads. It cannot schedule, unschedule or run anything.
--
-- ─── ⚠ WHO CAN CALL IT, AND WHAT THAT MEANS ────────────────────────────────
--
-- EXECUTE is granted to `anon`, which means ANYONE HOLDING THE ANON KEY CAN CALL IT — and
-- that key ships inside the app bundle, so treat it as public. Berke's call, made knowingly.
--
-- What that exposes: the timestamps of a maintenance job, and `return_message`, which on a
-- healthy run carries {"deleted": n, ...}. `n` is a coarse signal of how many update popups
-- were shown ~90 days ago. That is the entire disclosure. It carries no identifier, nothing
-- about any user, and nothing about any other job.
--
-- If that ever stops being acceptable the fix is one line — REVOKE the grant — and the
-- function keeps working for the SQL editor, which is where it is authoritative anyway.
--
-- ─── ⚠ NEVER NAME ANOTHER CRON JOB ANYWHERE IN THIS FUNCTION ───────────────
--
-- verify_schema asserts, DERIVED FROM cron.job RATHER THAN FROM A REMEMBERED LIST, that this
-- function's definition mentions no job name but its own. `pg_get_functiondef()` returns the
-- COMMENTS as well as the code, so a comment that mentions a neighbouring job by name would
-- fail that check — and the tempting "fix" would be to delete the comment rather than the
-- reference. This repo has already met that trap once (the NOT ILIKE '%appointments%' token
-- in verify_schema). So: refer to other jobs by what they do, never by name, in this file.
--
-- Apply: SQL Editor, Role = postgres, whole file ONCE, copied from disk. Idempotent.
-- Creates no table ⇒ no NOTIFY pgrst needed, but it is harmless and kept for the RPC cache.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.app_update_events_purge_status()
RETURNS TABLE (status text, start_time timestamptz, end_time timestamptz, return_message text)
LANGUAGE sql
STABLE
SECURITY DEFINER
-- pg_catalog first and public second, with every object below schema-qualified anyway. A
-- SECURITY DEFINER function with a loose search_path is the classic privilege-escalation
-- shape; this one resolves nothing by bare name.
SET search_path = pg_catalog, public
AS $function$
  SELECT d.status, d.start_time, d.end_time, d.return_message
    FROM cron.job_run_details d
    JOIN cron.job j ON j.jobid = d.jobid
   WHERE j.jobname = 'purge-app-update-events'
   ORDER BY d.start_time DESC
   LIMIT 5
$function$;

COMMENT ON FUNCTION public.app_update_events_purge_status() IS
  'Last 5 runs of the app_update_events retention job. No parameters, so it cannot be '
  'pointed at anything else. Returns status/start/end/message only.';

-- REVOKE FIRST, THEN GRANT, and the order is not style: a function is created with EXECUTE
-- held by PUBLIC, so a GRANT alone would leave that in place and the REVOKE afterwards would
-- undo the grant it was meant to narrow.
REVOKE ALL ON FUNCTION public.app_update_events_purge_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_update_events_purge_status() TO anon;

-- ─── Assertions. Each derives what it checks and prints what it read. ───────
DO $$
DECLARE
  v_fn    regprocedure := to_regprocedure('public.app_update_events_purge_status()');
  v_def   text;
  v_nargs int;
  v_secdef boolean;
  v_cfg   text[];
  v_leaks text;
  v_rows  int := -1;
BEGIN
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'app_update_events_purge_status() does not exist. Nothing committed; re-run the file as one paste.';
  END IF;

  SELECT p.pronargs, p.prosecdef, p.proconfig, pg_get_functiondef(p.oid)
    INTO v_nargs, v_secdef, v_cfg, v_def
    FROM pg_proc p WHERE p.oid = v_fn;

  -- NO PARAMETERS is the security property, not a style choice: with nothing to pass, a
  -- caller cannot ask about another job however the body is later edited.
  IF v_nargs IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'app_update_events_purge_status must take NO parameters; pronargs = %', v_nargs;
  END IF;
  IF v_secdef IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'app_update_events_purge_status must be SECURITY DEFINER (it reads cron, which anon cannot)';
  END IF;
  IF v_cfg IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(v_cfg) c WHERE c LIKE 'search_path=%') THEN
    RAISE EXCEPTION 'app_update_events_purge_status has no SET search_path; found proconfig = %', coalesce(v_cfg::text, '(null)');
  END IF;

  -- IT MUST NOT BE ABLE TO REPORT ON ANY OTHER JOB — derived from cron.job, never from a
  -- list written here. A remembered list cannot fail correctly: it goes green on the one
  -- job somebody forgot to name. Every jobname on this server except its own is checked.
  SELECT string_agg(j.jobname, ', ' ORDER BY j.jobname) INTO v_leaks
    FROM cron.job j
   WHERE j.jobname IS DISTINCT FROM 'purge-app-update-events'
     AND position(j.jobname in v_def) > 0;
  IF v_leaks IS NOT NULL THEN
    RAISE EXCEPTION 'app_update_events_purge_status references other cron job(s): % — it must only ever report its own', v_leaks;
  END IF;
  IF position('purge-app-update-events' in v_def) = 0 THEN
    RAISE EXCEPTION 'app_update_events_purge_status does not name its own job — it would report nothing, or everything';
  END IF;

  -- Privileges, both directions, resolved with has_function_privilege so inherited grants
  -- are visible. anon YES (it is the only credential outside the SQL editor);
  -- authenticated and PUBLIC no.
  IF NOT has_function_privilege('anon', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon cannot EXECUTE app_update_events_purge_status — the check it exists for is unreachable';
  END IF;
  IF has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated holds EXECUTE on app_update_events_purge_status; only anon was granted';
  END IF;

  -- BEHAVIOUR: it runs, and it returns at most 5 rows. Zero rows is CORRECT before the job
  -- has ever fired, so this asserts the cap and the callability, not a row count.
  SELECT count(*) INTO v_rows FROM public.app_update_events_purge_status();
  IF v_rows > 5 THEN
    RAISE EXCEPTION 'app_update_events_purge_status returned % rows; the LIMIT 5 is not in force', v_rows;
  END IF;
  RAISE LOG 'app_update_events_purge_status: % run(s) visible at apply time', v_rows;
END $$;

-- ─── ledger:stamp:begin ──────────────────────────────────────────────
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
VALUES ('20261052_purge_status_reporter.sql', '6aa6be043e4c87646e206fddb1570fd034296c06cf600a909ec94db456034782')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   SELECT * FROM public.app_update_events_purge_status();
--     -- 0 rows until the job has fired once. After 03:33 UTC expect status='succeeded'
--     -- and return_message carrying {"deleted": n, "cutoff": ...}.
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   DROP FUNCTION IF EXISTS public.app_update_events_purge_status();
