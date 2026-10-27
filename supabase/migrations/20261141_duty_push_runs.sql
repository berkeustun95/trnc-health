-- ═══════════════════════════════════════════════════════════════════════════
-- 20261141 — duty_push_runs: one summary row per send-duty-notification invocation
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Until now the function recorded nothing about push outcomes (failures went to console.error and
-- vanished with the log window). This table answers "did the duty pushes go out?" from the DB.
--
-- The function inserts the row at START (outcome 'running', finished_at NULL) and updates it at the
-- END. A run cut off mid-way therefore stays 'running' with finished_at NULL: visible as unfinished.
--
-- ─── WHAT IS RECORDED, AND WHAT IS NOT ──────────────────────────────────────
--   Counts only. NO push token, NO user id, NO message text, NO pharmacy name.
--   error_kinds = counts by Expo error code, e.g. {"DeviceNotRegistered": 3}. The function only
--   writes codes matching ^[A-Za-z0-9_]{1,64}$ (anything else is counted under "other").
--   ⚠ push_ok = Expo ACCEPTED the message ("ok" ticket). It is NOT proof the phone received it
--   (that needs Expo receipts, a second call this table does not make).
--
-- ─── WHO CAN READ / WRITE ───────────────────────────────────────────────────
--   RLS ON, ZERO policies, all anon/authenticated privileges revoked. Only service_role (the Edge
--   Function; it bypasses RLS) can insert/update/select/delete. Customers, providers, guests and
--   admins-in-the-app cannot touch it. Read it from the SQL editor or the supabase-readonly workflow
--   (supabase/readonly/duty_push_runs.sql). No admin policy on purpose: no screen needs it.
--
-- ─── RETENTION ──────────────────────────────────────────────────────────────
--   pg_cron 'purge-duty-push-runs', 03:47 UTC daily, deletes rows older than 90 days (inline DELETE,
--   like eatery-orders-retention; clear of the 03:27 / 03:33 / 03:40 purges).
--
-- ─── DEPLOY ORDER ───────────────────────────────────────────────────────────
--   Apply this FIRST, then deploy the function. The function tolerates a missing table (logs and
--   carries on), so the reverse order loses logging only, never pushes.

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.duty_push_runs (
  id                   bigint      GENERATED ALWAYS AS IDENTITY,
  started_at           timestamptz NOT NULL DEFAULT now(),
  finished_at          timestamptz,
  duty_date            date,
  outcome              text        NOT NULL DEFAULT 'running',
  pharmacies           int         NOT NULL DEFAULT 0,
  notified             int         NOT NULL DEFAULT 0,
  notif_batches_failed int         NOT NULL DEFAULT 0,
  push_attempted       int         NOT NULL DEFAULT 0,
  push_ok              int         NOT NULL DEFAULT 0,
  push_errors          int         NOT NULL DEFAULT 0,
  error_kinds          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT duty_push_runs_pkey PRIMARY KEY (id),
  CONSTRAINT duty_push_runs_outcome_check CHECK (outcome = ANY (ARRAY['running','sent','no_duties','no_profiles','duty_query_failed','profiles_query_failed','push_failed']::text[])),
  CONSTRAINT duty_push_runs_counts_check CHECK (
    pharmacies >= 0 AND notified >= 0 AND notif_batches_failed >= 0
    AND push_attempted >= 0 AND push_ok >= 0 AND push_errors >= 0
    AND push_ok + push_errors <= push_attempted),
  CONSTRAINT duty_push_runs_error_kinds_check CHECK (jsonb_typeof(error_kinds) = 'object'),
  CONSTRAINT duty_push_runs_finished_check CHECK (finished_at IS NULL OR finished_at >= started_at)
);

COMMENT ON TABLE public.duty_push_runs IS
  'One summary row per send-duty-notification invocation (counts only: no token, user id or text). RLS on, zero policies: service_role only. outcome running + finished_at NULL = cut off. push_ok = accepted by Expo, not delivered. 90-day purge-duty-push-runs. 20261141.';

CREATE INDEX IF NOT EXISTS idx_duty_push_runs_started_at ON public.duty_push_runs (started_at DESC);

ALTER TABLE public.duty_push_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.duty_push_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.duty_push_runs TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-duty-push-runs') THEN
    PERFORM cron.unschedule('purge-duty-push-runs');
  END IF;
END $$;
SELECT cron.schedule('purge-duty-push-runs', '47 3 * * *',
  $$ DELETE FROM public.duty_push_runs WHERE started_at < now() - interval '90 days' $$);

-- ─── Assertions + probes (inside the transaction; a failure rolls the file back) ─
DO $$
DECLARE
  v_t        regclass := to_regclass('public.duty_push_runs');
  v_n        int;
  v_names    text;
  v_role     text;
  v_priv     text;
  v_anon_ins text := 'unset';
  v_auth_sel text := 'unset';
  v_bad_out  text := 'unset';
  v_bad_cnt  text := 'unset';
  v_svc_rows int  := -1;
  v_sched    text;
  v_cmd      text;
  v_before   int;
  v_pf       text := 'unset';
BEGIN
  IF v_t IS NULL THEN RAISE EXCEPTION 'duty_push_runs is not visible to this block'; END IF;
  IF (SELECT relowner::regrole::text FROM pg_class WHERE oid = v_t) IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'duty_push_runs is owned by %, expected postgres (SET ROLE postgres missing?)', (SELECT relowner::regrole::text FROM pg_class WHERE oid = v_t);
  END IF;
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = v_t) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'RLS is not enabled on duty_push_runs';
  END IF;

  SELECT count(*), coalesce(string_agg(policyname || ':' || cmd, ', ' ORDER BY policyname), '(none)')
    INTO v_n, v_names FROM pg_policies WHERE schemaname = 'public' AND tablename = 'duty_push_runs';
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'duty_push_runs must carry ZERO policies; found %: %', v_n, v_names;
  END IF;

  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege(v_role, v_t, v_priv) THEN
        RAISE EXCEPTION '% holds % on duty_push_runs', v_role, v_priv;
      END IF;
    END LOOP;
  END LOOP;
  -- positive control for the denials above: the role the function runs as keeps its access
  FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
    IF NOT has_table_privilege('service_role', v_t, v_priv) THEN
      RAISE EXCEPTION 'service_role lost % on duty_push_runs — the function could not log', v_priv;
    END IF;
  END LOOP;

  SELECT count(*), max(schedule), max(command) INTO v_n, v_sched, v_cmd
    FROM cron.job WHERE jobname = 'purge-duty-push-runs' AND active;
  IF v_n IS DISTINCT FROM 1 OR v_sched IS DISTINCT FROM '47 3 * * *'
     OR v_cmd NOT LIKE '%public.duty_push_runs%' OR v_cmd NOT LIKE '%interval ''90 days''%' THEN
    RAISE EXCEPTION 'purge-duty-push-runs: % active rows, schedule %, command %', v_n, v_sched, v_cmd;
  END IF;

  SELECT count(*) INTO v_before FROM public.duty_push_runs;

  BEGIN
    SET LOCAL ROLE service_role;
    INSERT INTO public.duty_push_runs (duty_date) VALUES (date '2999-12-31');
    UPDATE public.duty_push_runs SET outcome = 'sent', finished_at = now(), push_attempted = 2, push_ok = 1,
           push_errors = 1, error_kinds = '{"DeviceNotRegistered":1}'::jsonb
     WHERE duty_date = date '2999-12-31';
    BEGIN
      INSERT INTO public.duty_push_runs (outcome) VALUES ('push_failed');
      v_pf := 'accepted';
    EXCEPTION WHEN check_violation THEN v_pf := 'REJECTED';
    END;
    SELECT count(*) INTO v_svc_rows FROM public.duty_push_runs WHERE outcome = 'sent' AND push_errors = 1 AND duty_date = date '2999-12-31';
    RESET ROLE;

    SET LOCAL ROLE anon;
    BEGIN
      INSERT INTO public.duty_push_runs (duty_date) VALUES (current_date);
      v_anon_ins := 'ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN v_anon_ins := 'denied';
    END;
    RESET ROLE;

    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM 1 FROM public.duty_push_runs LIMIT 1;
      v_auth_sel := 'ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN v_auth_sel := 'denied';
    END;
    RESET ROLE;

    BEGIN
      INSERT INTO public.duty_push_runs (outcome) VALUES ('banana');
      v_bad_out := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_out := 'rejected';
    END;
    BEGIN
      INSERT INTO public.duty_push_runs (push_attempted, push_ok) VALUES (1, 2);
      v_bad_cnt := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_cnt := 'rejected';
    END;

    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;
  RESET ROLE;

  IF v_pf        IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'outcome push_failed was % — a total push failure could not be recorded', v_pf; END IF;
  IF v_svc_rows  IS DISTINCT FROM 1        THEN RAISE EXCEPTION 'service_role insert+update+select returned % rows, expected 1', v_svc_rows; END IF;
  IF v_anon_ins  IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'anon INSERT into duty_push_runs was %', v_anon_ins; END IF;
  IF v_auth_sel  IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'authenticated SELECT on duty_push_runs was %', v_auth_sel; END IF;
  IF v_bad_out   IS DISTINCT FROM 'rejected' THEN RAISE EXCEPTION 'outcome ''banana'' was %', v_bad_out; END IF;
  IF v_bad_cnt   IS DISTINCT FROM 'rejected' THEN RAISE EXCEPTION 'push_ok > push_attempted was %', v_bad_cnt; END IF;
  IF (SELECT count(*) FROM public.duty_push_runs) IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'probe rows leaked into duty_push_runs';
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
VALUES ('20261141_duty_push_runs.sql', '735871baf962d3654c9201a254c5c7ac4d0b10f047f7f3e086b30ded19ddaf12')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;
NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   verify_schema QUERY 1: the 20261141_duty_push_runs rows must read OK; QUERY 2: purge-duty-push-runs.
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   SELECT cron.unschedule('purge-duty-push-runs'); DROP TABLE public.duty_push_runs;
--   (the function keeps working: it tolerates a missing table)
