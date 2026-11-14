-- ═══════════════════════════════════════════════════════════════════════════
-- 20261203 — onboarding_events: 90-day retention (pg_cron 03:37 UTC)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 20261202 created onboarding_events with no retention. It is a counter that answers a LAUNCH question
-- (does the notification offer appear, what is answered), so rows need not outlive the answer. Without a
-- purge it grows forever and quietly becomes a long-lived record of app usage. Same shape as the
-- app_update_events purge (20261051): a plain function plus a pg_cron job, plus a created_at index for it.
--
-- ─── WHO CAN READ / WRITE / DELETE ──────────────────────────────────────────
--   Unchanged on the table: anyone (no session, guests, signed-up users) may INSERT the three payload
--   columns; no client may SELECT, UPDATE or DELETE. The DO block re-asserts that policy set.
--   The purge is the ONLY deleter: public.purge_onboarding_events(interval) runs nightly as the cron job's
--   owner (postgres, the table owner, which RLS does not apply to). EXECUTE is revoked from PUBLIC, anon,
--   authenticated AND service_role, so no app role and no server key can trigger a purge; only postgres
--   (the owner, i.e. the cron job and the SQL editor) can run it.
--
-- Deviation from 20261051, on purpose: service_role is in the REVOKE. Supabase's default privileges grant
-- EXECUTE on every new public function to service_role by name, so revoking only PUBLIC/anon/authenticated
-- (as 20261051 does) would leave the purge callable with the service key.
--
-- Interval is a DEFAULTED PARAMETER, as in 20261051 (no floor there, none here): only postgres can call it.
-- SECURITY INVOKER (the default) + SET search_path = public: the purge_app_update_events posture.
-- 03:37 UTC: read from the cron.schedule calls in supabase/migrations/ (not from live cron.job), no job names
-- minute 37 at 03:xx: the nightly purges sit at :17 :23 :27 :33 :41 :47 :51 :53 :57, google-places-refresh at
-- :21, eatery-orders-retention hourly at :40; only the paused every-minute live-scores polls would overlap.
--
-- No counts, ids or e-mails anywhere (the assertions print none): supabase-migrate prints this file to public
-- Actions logs.
--
-- Apply: supabase-migrate (dry), then apply=true after Berke's go. No new column => no NOTIFY pgrst.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS idx_onboarding_events_created_at ON public.onboarding_events (created_at DESC);

CREATE OR REPLACE FUNCTION public.purge_onboarding_events(p_older_than interval DEFAULT interval '90 days')
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_cut timestamptz := now() - p_older_than;
  n int;
BEGIN
  DELETE FROM public.onboarding_events WHERE created_at < v_cut;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('deleted', n, 'cutoff', v_cut);
END;
$function$;

ALTER FUNCTION public.purge_onboarding_events(interval) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.purge_onboarding_events(interval) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.purge_onboarding_events(interval) IS
  'Nightly retention for onboarding_events: deletes rows older than 90 days. Cron purge-onboarding-events 03:37 UTC. Not callable by any client or service_role. 20261203.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-onboarding-events') THEN
    PERFORM cron.unschedule('purge-onboarding-events');
  END IF;
END $$;
SELECT cron.schedule('purge-onboarding-events', '37 3 * * *', $$SELECT public.purge_onboarding_events()$$);

-- ─── Assertions. Each derives what it checks and prints what it read (never a row count). ─
DO $$
DECLARE
  v_e       regclass := to_regclass('public.onboarding_events');
  v_fn      regprocedure := to_regprocedure('public.purge_onboarding_events(interval)');
  v_n       int;
  v_names   text;
  v_cmd     text;
  v_sched   text;
  v_active  boolean;
  v_role    text;
  v_holders text;
  v_d1      bigint;
  v_d89     bigint;
  v_d91     bigint;
  v_d400    bigint;
  v_left    text := 'unset';
BEGIN
  IF v_e IS NULL THEN RAISE EXCEPTION 'onboarding_events is not visible to this block (apply 20261202 first)'; END IF;
  IF v_fn IS NULL THEN RAISE EXCEPTION 'purge_onboarding_events(interval) was not created — the 90-day retention would never run'; END IF;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'purge_onboarding_events') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'purge_onboarding_events must have exactly one overload';
  END IF;

  -- The JOB, derived from cron.job and PRINTED. A function nothing schedules is a retention policy on paper only.
  SELECT count(*), max(schedule), max(command), bool_and(active) INTO v_n, v_sched, v_cmd, v_active
    FROM cron.job WHERE jobname = 'purge-onboarding-events';
  RAISE NOTICE 'cron.job purge-onboarding-events: rows=%, schedule=%, active=%, command=%', v_n, v_sched, v_active, v_cmd;
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'expected exactly 1 cron job named purge-onboarding-events; found %', v_n; END IF;
  IF v_sched IS DISTINCT FROM '37 3 * * *' THEN RAISE EXCEPTION 'purge-onboarding-events schedule is %, expected 37 3 * * *', v_sched; END IF;
  IF btrim(v_cmd) IS DISTINCT FROM 'SELECT public.purge_onboarding_events()' THEN RAISE EXCEPTION 'purge-onboarding-events command is: %', v_cmd; END IF;
  IF v_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'purge-onboarding-events is not active'; END IF;

  -- EXECUTE: held by nobody but the owner. Derived from proacl (grantee 0 = PUBLIC), so a grant to ANY role
  -- shows up, not just the ones named here; then has_function_privilege per named role (resolves PUBLIC).
  IF (SELECT proacl FROM pg_proc WHERE oid = v_fn) IS NULL THEN
    RAISE EXCEPTION 'purge_onboarding_events has a NULL acl (= the default, PUBLIC may EXECUTE)';
  END IF;
  SELECT string_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END, ',')
    INTO v_holders
    FROM pg_proc p, LATERAL aclexplode(p.proacl) a LEFT JOIN pg_roles r ON r.oid = a.grantee
   WHERE p.oid = v_fn AND a.privilege_type = 'EXECUTE' AND a.grantee IS DISTINCT FROM p.proowner;
  IF v_holders IS NOT NULL THEN
    RAISE EXCEPTION 'purge_onboarding_events: EXECUTE held by % — only the owner may run it', v_holders;
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '% can EXECUTE purge_onboarding_events — it could wipe the counter', v_role;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('postgres', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'positive control: postgres cannot EXECUTE purge_onboarding_events — the cron job would fail';
  END IF;
  RAISE NOTICE 'purge_onboarding_events proacl: %', (SELECT proacl::text FROM pg_proc WHERE oid = v_fn);

  -- The index the purge reads.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'onboarding_events'
                    AND indexname = 'idx_onboarding_events_created_at' AND indexdef LIKE '%(created_at DESC)%') THEN
    RAISE EXCEPTION 'idx_onboarding_events_created_at (created_at DESC) is missing';
  END IF;

  -- The table's FULL policy set is still 20261202's three (this file touches no policy), printed.
  SELECT count(*), coalesce(string_agg(policyname || ':' || cmd || ':' || permissive, ', ' ORDER BY policyname), '(none)')
    INTO v_n, v_names
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'onboarding_events';
  RAISE NOTICE 'onboarding_events policies: %', v_names;
  IF v_names IS DISTINCT FROM 'oe_insert_public:INSERT:PERMISSIVE, oe_no_delete:DELETE:PERMISSIVE, oe_no_update:UPDATE:PERMISSIVE' THEN
    RAISE EXCEPTION 'onboarding_events must carry exactly the 3 policies of 20261202; found %: %', v_n, v_names;
  END IF;

  -- BEHAVIOUR, rolled back by a sentinel: it must delete what is OLD and keep what is NOT. Probe rows are told
  -- apart by id; the job's command is run AS STORED in cron.job. Real rows the purge touches inside this block
  -- come back with the rollback, so no purge is ever committed by this file.
  BEGIN
    INSERT INTO public.onboarding_events (event, platform, runtime_version, created_at)
      VALUES ('offer_shown', 'ios', 'zz-1203-probe', now() - interval '1 day') RETURNING id INTO v_d1;
    INSERT INTO public.onboarding_events (event, platform, runtime_version, created_at)
      VALUES ('offer_shown', 'ios', 'zz-1203-probe', now() - interval '89 days') RETURNING id INTO v_d89;
    INSERT INTO public.onboarding_events (event, platform, runtime_version, created_at)
      VALUES ('offer_shown', 'ios', 'zz-1203-probe', now() - interval '91 days') RETURNING id INTO v_d91;
    INSERT INTO public.onboarding_events (event, platform, runtime_version, created_at)
      VALUES ('offer_shown', 'ios', 'zz-1203-probe', now() - interval '400 days') RETURNING id INTO v_d400;

    EXECUTE v_cmd;

    SELECT coalesce(string_agg(CASE id WHEN v_d1 THEN '1d' WHEN v_d89 THEN '89d' WHEN v_d91 THEN '91d' WHEN v_d400 THEN '400d' END,
                               ',' ORDER BY created_at DESC), '(none)')
      INTO v_left
      FROM public.onboarding_events WHERE id IN (v_d1, v_d89, v_d91, v_d400);
    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'probe rows left after the cron command: %', v_left;
  -- POSITIVE CONTROL in the same comparison: the 1-day and 89-day rows must still be there.
  IF v_left IS DISTINCT FROM '1d,89d' THEN
    RAISE EXCEPTION 'purge kept the wrong probe rows: % (want 1d,89d: the 91- and 400-day rows gone, the 1- and 89-day rows kept)', v_left;
  END IF;
  -- By the captured ids, never by the runtime_version marker: that column is client text, so a client row carrying
  -- the marker would otherwise make every re-apply refuse. Identity values are never reused.
  IF EXISTS (SELECT 1 FROM public.onboarding_events WHERE id IN (v_d1, v_d89, v_d91, v_d400)) THEN
    RAISE EXCEPTION 'onboarding_events probe rows survived the rollback';
  END IF;
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
VALUES ('20261203_onboarding_events_retention.sql', '4f27e2421f90a4ba5dc92d4da2ffff67e9b3958ff886b0e49bd20c56c7485923')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   verify_schema QUERY 1: the 20261203_onboarding_events_retention rows must read OK;
--   QUERY 2: purge-onboarding-events OK and its schedule/command row OK.
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   SELECT cron.unschedule('purge-onboarding-events'); DROP FUNCTION public.purge_onboarding_events(interval);
--   DROP INDEX public.idx_onboarding_events_created_at; (and delete its schema_migrations_applied row)
