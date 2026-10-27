-- ═══════════════════════════════════════════════════════════════════════════
-- 20261142 — duty_push_runs: outcome 'partial' + push_retries
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 2026-10-27 15:00 UTC run: one Expo batch of 100 got HTTP 503 and was never retried (push_ok 10 of 110).
-- The function now retries a batch Expo did not accept (HTTP 5xx / 429 / thrown fetch) up to 3 times, and
-- records the outcome honestly:
--   sent         every ticket ok, or only error tickets (accepted batches are never retried)
--   partial      0 < push_ok < push_attempted
--   push_failed  push_ok = 0 while something was attempted
-- push_retries = number of retry requests made across the run (counts only, like every other column).
--
-- Access is unchanged: RLS on, zero policies, service_role only (asserted again below, column level included,
-- because ADD COLUMN inherits the table grants).
--
-- Deploy order: apply this FIRST, then deploy the function. A function deployed before this migration fails its
-- final UPDATE (unknown column) and logs it; pushes are unaffected, the row stays 'running'.

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.duty_push_runs ADD COLUMN IF NOT EXISTS push_retries int NOT NULL DEFAULT 0;

ALTER TABLE public.duty_push_runs DROP CONSTRAINT IF EXISTS duty_push_runs_retries_check;
ALTER TABLE public.duty_push_runs ADD CONSTRAINT duty_push_runs_retries_check CHECK (push_retries >= 0);

ALTER TABLE public.duty_push_runs DROP CONSTRAINT IF EXISTS duty_push_runs_outcome_check;
ALTER TABLE public.duty_push_runs ADD CONSTRAINT duty_push_runs_outcome_check CHECK (outcome = ANY (ARRAY[
  'running','sent','partial','no_duties','no_profiles','duty_query_failed','profiles_query_failed','push_failed']::text[]));

COMMENT ON COLUMN public.duty_push_runs.push_retries IS
  'Retry requests made for batches Expo did not accept (HTTP 5xx / 429 / thrown fetch). Accepted batches are never retried. 20261142.';

DO $$
DECLARE
  v_t        regclass := to_regclass('public.duty_push_runs');
  v_n        int;
  v_role     text;
  v_priv     text;
  v_before   int;
  v_res      text[] := ARRAY[]::text[];
  v_o        text;
BEGIN
  IF v_t IS NULL THEN RAISE EXCEPTION 'duty_push_runs missing — apply 20261141 first'; END IF;
  IF (SELECT relowner::regrole::text FROM pg_class WHERE oid = v_t) IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'duty_push_runs is owned by %, expected postgres', (SELECT relowner::regrole::text FROM pg_class WHERE oid = v_t);
  END IF;
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = v_t) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'RLS is not enabled on duty_push_runs';
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'duty_push_runs';
  IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'duty_push_runs must carry ZERO policies; found %', v_n; END IF;

  SELECT count(*) INTO v_n FROM pg_attribute WHERE attrelid = v_t AND attnum > 0 AND NOT attisdropped;
  IF v_n IS DISTINCT FROM 13 THEN RAISE EXCEPTION 'duty_push_runs must have 13 columns; found %', v_n; END IF;

  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege(v_role, v_t, v_priv) THEN
        RAISE EXCEPTION '% holds % on duty_push_runs', v_role, v_priv;
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = v_t AND a.attnum > 0 AND NOT a.attisdropped
                AND has_column_privilege(v_role, a.attrelid, a.attnum, 'SELECT,INSERT,UPDATE,REFERENCES')) THEN
      RAISE EXCEPTION '% holds a column privilege on duty_push_runs', v_role;
    END IF;
  END LOOP;
  -- positive control for the denials above
  FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
    IF NOT has_table_privilege('service_role', v_t, v_priv) THEN
      RAISE EXCEPTION 'service_role lost % on duty_push_runs', v_priv;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_before FROM public.duty_push_runs;
  BEGIN
    -- every outcome the function can write must be accepted; a stranger must be refused
    FOREACH v_o IN ARRAY ARRAY['running','sent','partial','no_duties','no_profiles','duty_query_failed','profiles_query_failed','push_failed','banana'] LOOP
      BEGIN
        INSERT INTO public.duty_push_runs (outcome, duty_date) VALUES (v_o, date '2999-12-31');
        v_res := array_append(v_res, v_o || ':accepted');
      EXCEPTION WHEN check_violation THEN v_res := array_append(v_res, v_o || ':rejected');
      END;
    END LOOP;
    BEGIN
      INSERT INTO public.duty_push_runs (push_retries) VALUES (-1);
      v_res := array_append(v_res, 'retries-1:accepted');
    EXCEPTION WHEN check_violation THEN v_res := array_append(v_res, 'retries-1:rejected');
    END;
    BEGIN
      INSERT INTO public.duty_push_runs (outcome, push_attempted, push_ok, push_retries) VALUES ('partial', 5, 2, 3);
      v_res := array_append(v_res, 'retries3:accepted');
    EXCEPTION WHEN check_violation THEN v_res := array_append(v_res, 'retries3:rejected');
    END;
    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;
  IF v_res IS DISTINCT FROM ARRAY['running:accepted','sent:accepted','partial:accepted','no_duties:accepted','no_profiles:accepted',
       'duty_query_failed:accepted','profiles_query_failed:accepted','push_failed:accepted','banana:rejected','retries-1:rejected','retries3:accepted'] THEN
    RAISE EXCEPTION 'outcome / retries probe: %', v_res;
  END IF;
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
VALUES ('20261142_duty_push_runs_partial_retries.sql', 'fe9a25a5cfee536d7f0ff636f216a08d7b2670e032f10363455e6e66f144fb72')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;
NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   verify_schema QUERY 1: the 20261142_duty_push_runs_partial_retries rows must read OK.
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   ALTER TABLE public.duty_push_runs DROP COLUMN push_retries;  then re-add the 20261141 outcome CHECK
--   (rows already holding 'partial' must be updated first).
