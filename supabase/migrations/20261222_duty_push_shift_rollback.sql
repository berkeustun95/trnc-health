-- ════════════════════════════════════════════════════════════════════════════
-- 20261222 — ROLLBACK of 20261221: duty-pharmacy push back to 17:00 / 13:00 / 08:00
-- ════════════════════════════════════════════════════════════════════════════
--
-- DO NOT APPLY unless Berke says so. This file lives on its own branch (chore/duty-push-shift-rollback, a DRAFT PR
-- that is never merged); applying it is a manual decision after the 3-minute experiment.
--
-- WHAT. Restores the state 20261210 + 20261139 left:
--  1. public.duty_push_due(timestamptz): the 20261210 definition, byte for byte (no + interval '3 minutes').
--  2. cron job 'duty-push': schedule '27,57 * * * *' -> '0,30 * * * *' through cron.alter_job(job_id, schedule).
--     The command is never written; its md5 is captured before and asserted equal after. The jobid does not change.
--  The weekend-digest job and weekend_digest_due() are never touched (md5-asserted).
--
-- WHO CAN CALL WHAT. Unchanged from 20261221: duty_push_due is executable by the owner and the cron role only;
-- anon and authenticated hold no EXECUTE (asserted by role name, owner as positive control). No table, policy or
-- grant is touched.
--
-- PROOF INSIDE THE TRANSACTION (any failure rolls the whole file back; messages carry times and booleans only):
-- the function text / volatility / owner / search_path / ACL; for every local day of three windows (Fri 20 - Sun 22 Nov
-- 2026, the March and October 2027 clock changes), over the ticks the job's own schedule produces, exactly ONE tick is
-- due and it is the slot itself (Mon-Fri 17:00, Thursday closing minus 30 min, Sat 13:00, Sun 08:00); a tick 3 minutes
-- early (16:57) and the :27 / :57 ticks are not due; the pause switch still stops the send.
-- REFUSAL: duty-push paused at apply time, or the live state is not what 20261221 left.
--
-- Apply: gh workflow run supabase-migrate -f file=20261222_duty_push_shift_rollback.sql (dry), then -f apply=true
-- (Berke approves production-db).
-- ════════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── 1. Pre-flight: the live state must be exactly what 20261221 left ────────
DO $$
DECLARE
  v_n      int;
  v_def    text;
BEGIN
  IF to_regprocedure('public.duty_push_due(timestamp with time zone)') IS NULL
     OR to_regprocedure('public.data_job_paused(text)') IS NULL
     OR to_regprocedure('public.duty_thursday_closing_local()') IS NULL
     OR to_regprocedure('public.weekend_digest_due(timestamp with time zone)') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: duty_push_due / data_job_paused / duty_thursday_closing_local / weekend_digest_due is missing. Nothing applied.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = to_regprocedure('cron.alter_job(bigint,text,text,text,text,boolean)')
                    AND p.proargnames @> ARRAY['job_id', 'schedule']) THEN
    RAISE EXCEPTION 'REFUSING: this pg_cron has no cron.alter_job(job_id, schedule, ...). Nothing applied.';
  END IF;

  IF coalesce(public.data_job_paused('duty-push'), true) THEN
    RAISE EXCEPTION 'REFUSING: duty-push is paused; the sweep cannot prove one send per day. Resume it, then apply.';
  END IF;

  SELECT count(*) INTO v_n FROM cron.job WHERE jobname = 'duty-push';
  IF v_n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'REFUSING: expected exactly one cron job named duty-push, found %. Nothing applied.', v_n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job j
                  WHERE j.jobname = 'duty-push' AND j.active AND j.schedule = '27,57 * * * *'
                    AND j.command LIKE '%WHERE public.duty_push_due()%'
                    AND j.command LIKE '%timeout_milliseconds := 60000%'
                    AND j.command LIKE '%vault.decrypted_secrets%') THEN
    RAISE EXCEPTION 'REFUSING: duty-push is not the active job at 27,57 * * * * with the gate, the 60 s timeout and the Vault lookup (state 20261221 leaves). Nothing applied.';
  END IF;
  SELECT count(*) INTO v_n FROM cron.job WHERE command LIKE '%public.duty_push_due()%';
  IF v_n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'REFUSING: expected exactly one cron job calling duty_push_due, found %. Nothing applied.', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM cron.job WHERE jobname = 'weekend-digest';
  IF v_n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'REFUSING: expected exactly one cron job named weekend-digest, found %. Nothing applied.', v_n;
  END IF;

  v_def := pg_get_functiondef(to_regprocedure('public.duty_push_due(timestamp with time zone)'));
  IF v_def NOT LIKE '%FROM (SELECT (p_at + interval ''3 minutes'') AT TIME ZONE ''Asia/Famagusta'' AS t) l%'
     OR v_def NOT LIKE '%AND NOT public.data_job_paused(''duty-push'')%'
     OR v_def NOT LIKE '%public.duty_thursday_closing_local() - interval ''30 minutes''%' THEN
    RAISE EXCEPTION 'REFUSING: duty_push_due is not the 20261221 definition this file replaces. Nothing applied.';
  END IF;

  PERFORM set_config('r222.duty_cmd',  (SELECT md5(command) FROM cron.job WHERE jobname = 'duty-push'), true);
  PERFORM set_config('r222.duty_id',   (SELECT jobid::text FROM cron.job WHERE jobname = 'duty-push'), true);
  PERFORM set_config('r222.weekend_job', (SELECT md5(concat_ws('|', schedule, command, active::text, username)) FROM cron.job WHERE jobname = 'weekend-digest'), true);
  PERFORM set_config('r222.weekend_fn',  md5(pg_get_functiondef(to_regprocedure('public.weekend_digest_due(timestamp with time zone)'))), true);
  PERFORM set_config('r222.duty_attrs', (SELECT concat_ws('|', provolatile, prosecdef::text, proconfig::text, proacl::text, pg_get_userbyid(proowner), (SELECT lanname FROM pg_language l WHERE l.oid = prolang))
                                           FROM pg_proc WHERE oid = to_regprocedure('public.duty_push_due(timestamp with time zone)')), true);
  PERFORM set_config('r222.pause_row', (SELECT concat_ws('|', paused::text, paused_note, paused_by::text, paused_at::text) FROM public.data_jobs WHERE key = 'duty-push'), true);
  RAISE NOTICE '20261222 pre-flight ok: duty-push is active, unpaused, at 27,57 * * * * with the 3-minute gate';
END
$$;

-- ─── 2. The gate: the 20261210 definition, restored ──────────────────────────
CREATE OR REPLACE FUNCTION public.duty_push_due(p_at timestamptz DEFAULT now())
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (date_trunc('hour', l.t)
           + CASE WHEN extract(minute FROM l.t) >= 30 THEN interval '30 minutes' ELSE interval '0' END
         = l.t::date + CASE extract(isodow FROM l.t)::int
             WHEN 7 THEN time '08:00'
             WHEN 6 THEN time '13:30' - interval '30 minutes'
             WHEN 4 THEN public.duty_thursday_closing_local() - interval '30 minutes'
             ELSE        time '17:30' - interval '30 minutes'
           END)
         AND NOT public.data_job_paused('duty-push')
  FROM (SELECT p_at AT TIME ZONE 'Asia/Famagusta' AS t) l
$$;

-- ─── 3. The schedule only: back to :00 and :30 ───────────────────────────────
DO $$
DECLARE
  v_job bigint := current_setting('r222.duty_id')::bigint;
BEGIN
  PERFORM cron.alter_job(job_id := v_job, schedule := '0,30 * * * *');
END
$$;

-- ─── 4. What the file did, asserted ──────────────────────────────────────────
DO $$
DECLARE
  v_def   text;
  v_cmd   text;
  v_n     int;
  v_f     regprocedure := to_regprocedure('public.duty_push_due(timestamp with time zone)');
BEGIN
  v_def := pg_get_functiondef(v_f);
  IF position('FROM (SELECT p_at AT TIME ZONE ''Asia/Famagusta'' AS t) l' IN v_def) = 0
     OR v_def LIKE '%interval ''3 minutes''%' THEN
    RAISE EXCEPTION 'duty_push_due must read p_at AT TIME ZONE ''Asia/Famagusta'' with no 3-minute shift';
  END IF;
  IF v_def NOT LIKE '%AND NOT public.data_job_paused(''duty-push'')%'
     OR v_def NOT LIKE '%public.duty_thursday_closing_local() - interval ''30 minutes''%' THEN
    RAISE EXCEPTION 'duty_push_due lost its pause clause or its Thursday closing-time arm';
  END IF;
  IF (SELECT concat_ws('|', provolatile, prosecdef::text, proconfig::text, proacl::text, pg_get_userbyid(proowner), (SELECT lanname FROM pg_language l WHERE l.oid = prolang)) FROM pg_proc WHERE oid = v_f)
       IS DISTINCT FROM current_setting('r222.duty_attrs') THEN
    RAISE EXCEPTION 'duty_push_due changed volatility / security / search_path / ACL / owner / language';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_f AND p.provolatile = 's' AND NOT p.prosecdef
                    AND p.proconfig = ARRAY['search_path=""']
                    AND pg_get_userbyid(p.proowner) = 'postgres' AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'sql')) THEN
    RAISE EXCEPTION 'duty_push_due must be STABLE SQL, INVOKER, search_path empty, owned by postgres';
  END IF;
  IF has_function_privilege('anon', v_f, 'EXECUTE') OR has_function_privilege('authenticated', v_f, 'EXECUTE') THEN
    RAISE EXCEPTION 'duty_push_due must not be executable by anon or authenticated';
  END IF;
  IF NOT has_function_privilege('postgres', v_f, 'EXECUTE') THEN
    RAISE EXCEPTION 'positive control failed: the owner cannot execute duty_push_due';
  END IF;

  SELECT count(*) INTO v_n FROM cron.job WHERE jobname = 'duty-push';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'expected exactly one duty-push job, found %', v_n; END IF;
  SELECT command INTO v_cmd FROM cron.job WHERE jobname = 'duty-push' AND active AND schedule = '0,30 * * * *';
  IF v_cmd IS NULL THEN RAISE EXCEPTION 'duty-push is not the active job at 0,30 * * * *'; END IF;
  IF md5(v_cmd) IS DISTINCT FROM current_setting('r222.duty_cmd') THEN RAISE EXCEPTION 'the duty-push command changed'; END IF;
  IF (SELECT jobid::text FROM cron.job WHERE jobname = 'duty-push') IS DISTINCT FROM current_setting('r222.duty_id') THEN RAISE EXCEPTION 'the duty-push jobid changed'; END IF;
  IF v_cmd NOT LIKE '%public.duty_push_due()%' OR v_cmd NOT LIKE '%timeout_milliseconds := 60000%'
     OR v_cmd NOT LIKE '%vault.decrypted_secrets%' OR v_cmd LIKE '%eyJ%' OR v_cmd LIKE '%sb_secret%' THEN
    RAISE EXCEPTION 'the duty-push command lost its gate, its 60 s timeout or its Vault lookup (or carries a key)';
  END IF;
  SELECT count(*) INTO v_n FROM cron.job WHERE command LIKE '%public.duty_push_due()%';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'expected exactly one job calling duty_push_due, found %', v_n; END IF;

  IF (SELECT md5(concat_ws('|', schedule, command, active::text, username)) FROM cron.job WHERE jobname = 'weekend-digest') IS DISTINCT FROM current_setting('r222.weekend_job') THEN
    RAISE EXCEPTION 'the weekend-digest job changed';
  END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.weekend_digest_due(timestamp with time zone)'))) IS DISTINCT FROM current_setting('r222.weekend_fn') THEN
    RAISE EXCEPTION 'weekend_digest_due changed';
  END IF;
  RAISE NOTICE '20261222 gate + cron: duty-push back at 0,30 * * * *, command unchanged, weekend-digest job and gate unchanged';
END
$$;

-- ─── 5. The sweep: one due tick per local day, at the slot itself ────────────
DO $$
DECLARE
  v_sched   text;
  v_mins    int[];
  w         record;
  v_bad     text;
  v_lo      timestamptz;
  v_hi      timestamptz;
  v_time    time;
  v_days    int;
BEGIN
  SELECT schedule INTO v_sched FROM cron.job WHERE jobname = 'duty-push';
  IF v_sched !~ '^[0-9]+(,[0-9]+)* \* \* \* \*$' THEN
    RAISE EXCEPTION 'duty-push schedule is not a plain minute list: %', v_sched;
  END IF;
  v_mins := string_to_array(split_part(v_sched, ' ', 1), ',')::int[];

  FOR w IN SELECT * FROM (VALUES
      ('Fri 20 - Sun 22 Nov 2026',      date '2026-11-20', date '2026-11-22'),
      ('March 2027 clock change',       date '2027-03-21', date '2027-04-04'),
      ('October 2027 clock change',     date '2027-10-24', date '2027-11-07')
    ) v(label, d0, d1)
  LOOP
    v_lo := ((w.d0 - 1)::timestamp AT TIME ZONE 'Asia/Famagusta') - interval '12 hours';
    v_hi := ((w.d1 + 2)::timestamp AT TIME ZONE 'Asia/Famagusta') + interval '12 hours';

    WITH ticks AS MATERIALIZED (
           SELECT h.h + make_interval(mins => m.m) AS ts
             FROM generate_series(date_trunc('hour', v_lo), v_hi, interval '1 hour') h(h), unnest(v_mins) m(m)),
         t AS MATERIALIZED (
           SELECT ts, (ts AT TIME ZONE 'Asia/Famagusta')::date AS d, (ts AT TIME ZONE 'Asia/Famagusta')::time AS lt,
                  public.duty_push_due(ts) AS due
             FROM ticks),
         days AS (
           SELECT g::date AS d,
                  (CASE extract(isodow FROM g)::int
                     WHEN 7 THEN time '08:00'
                     WHEN 6 THEN time '13:30' - interval '30 minutes'
                     WHEN 4 THEN public.duty_thursday_closing_local() - interval '30 minutes'
                     ELSE        time '17:30' - interval '30 minutes'
                   END) AS want
             FROM generate_series(w.d0::timestamp, w.d1::timestamp, interval '1 day') g),
         per AS (
           SELECT days.d, days.want,
                  (SELECT count(*) FROM t WHERE t.d = days.d AND t.due) AS n_due,
                  (SELECT min(t.lt) FROM t WHERE t.d = days.d AND t.due) AS due_at
             FROM days)
    SELECT string_agg(to_char(per.d, 'YYYY-MM-DD') || ' due ticks ' || per.n_due || ' at ' || coalesce(to_char(per.due_at, 'HH24:MI'), '-') || ' want ' || to_char(per.want, 'HH24:MI'), '; ' ORDER BY per.d)
      INTO v_bad
      FROM per
     WHERE per.n_due IS DISTINCT FROM 1 OR per.due_at IS DISTINCT FROM per.want;
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'sweep % failed: %', w.label, v_bad;
    END IF;

    SELECT count(*) INTO v_days FROM generate_series(w.d0::timestamp, w.d1::timestamp, interval '1 day');
    RAISE NOTICE '20261222 % (% .. %, Asia/Famagusta): one due tick per local day, % days', w.label, w.d0, w.d1, v_days;
  END LOOP;

  FOR w IN SELECT * FROM (VALUES (date '2026-11-20', time '17:00'), (date '2026-11-21', time '13:00'), (date '2026-11-22', time '08:00')) v(d, want) LOOP
    SELECT min((ts AT TIME ZONE 'Asia/Famagusta')::time) INTO v_time
      FROM (SELECT h.h + make_interval(mins => m.m) AS ts
              FROM generate_series(timestamptz '2026-11-19 00:00+00', timestamptz '2026-11-24 00:00+00', interval '1 hour') h(h), unnest(v_mins) m(m)) x
     WHERE (ts AT TIME ZONE 'Asia/Famagusta')::date = w.d AND public.duty_push_due(ts);
    RAISE NOTICE '20261222 % due at % Asia/Famagusta', to_char(w.d, 'Dy YYYY-MM-DD'), to_char(v_time, 'HH24:MI');
    IF v_time IS DISTINCT FROM w.want THEN
      RAISE EXCEPTION '% must be due at %, got %', w.d, w.want, v_time;
    END IF;
  END LOOP;
END
$$;

-- ─── 6. Tolerance controls ───────────────────────────────────────────────────
DO $$
DECLARE
  r      record;
  v_got  boolean;
  v_bad  text := '';
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('Wed 17:00 (the tick)',            timestamp '2026-11-18 17:00', true),
      ('Wed 17:20 (cron starts late)',    timestamp '2026-11-18 17:20', true),
      ('Wed 16:57 (the 3-minute-early tick)', timestamp '2026-11-18 16:57', false),
      ('Wed 17:30 (the :30 tick)',        timestamp '2026-11-18 17:30', false),
      ('Wed 17:57 (a :57 tick)',          timestamp '2026-11-18 17:57', false),
      ('Sat 13:00 (the tick)',            timestamp '2026-11-21 13:00', true),
      ('Sat 12:57 (the 3-minute-early tick)', timestamp '2026-11-21 12:57', false),
      ('Sat 13:30 (the :30 tick)',        timestamp '2026-11-21 13:30', false),
      ('Sun 08:00 (the tick)',            timestamp '2026-11-22 08:00', true),
      ('Sun 07:57 (the 3-minute-early tick)', timestamp '2026-11-22 07:57', false),
      ('Sun 08:30 (the :30 tick)',        timestamp '2026-11-22 08:30', false),
      ('Sun 13:00 (a Saturday slot)',     timestamp '2026-11-22 13:00', false)
    ) v(label, lt, want)
  LOOP
    v_got := public.duty_push_due(r.lt AT TIME ZONE 'Asia/Famagusta');
    IF v_got IS DISTINCT FROM r.want THEN v_bad := v_bad || r.label || ' got ' || v_got::text || ' want ' || r.want::text || '; '; END IF;
  END LOOP;
  IF v_bad <> '' THEN RAISE EXCEPTION 'tolerance controls failed: %', v_bad; END IF;
  RAISE NOTICE '20261222 tolerance: 17:00 and 17:20 due; the 3-minute-early ticks and the :30 / :57 ticks not due';
END
$$;

-- ─── 7. The pause switch still stops the send (sub-transaction, rolled back) ──
DO $$
DECLARE
  v_res   text[] := ARRAY[]::text[];
  v_at    timestamptz := timestamptz '2026-11-20 15:00+00';
BEGIN
  BEGIN
    v_res := v_res || ('due=' || public.duty_push_due(v_at)::text);
    UPDATE public.data_jobs SET paused = true, paused_note = 'probe', paused_by = NULL, paused_at = now() WHERE key = 'duty-push';
    IF NOT FOUND THEN RAISE EXCEPTION 'no data_jobs row for duty-push to probe the pause on'; END IF;
    v_res := v_res || ('paused=' || public.duty_push_due(v_at)::text);
    UPDATE public.data_jobs SET paused = false, paused_note = NULL, paused_by = NULL, paused_at = NULL WHERE key = 'duty-push';
    v_res := v_res || ('resumed=' || public.duty_push_due(v_at)::text);
    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  IF v_res IS DISTINCT FROM ARRAY['due=true', 'paused=false', 'resumed=true'] THEN
    RAISE EXCEPTION 'pause probe on Fri 17:00: got %, wanted due=true, paused=false, resumed=true', v_res;
  END IF;
  IF (SELECT concat_ws('|', paused::text, paused_note, paused_by::text, paused_at::text) FROM public.data_jobs WHERE key = 'duty-push')
       IS DISTINCT FROM current_setting('r222.pause_row') THEN
    RAISE EXCEPTION 'the pause probe left the duty-push data_jobs row changed';
  END IF;
  RAISE NOTICE '20261222 pause probe at Fri 2026-11-20 17:00 Asia/Famagusta: %', v_res;
  RAISE NOTICE '20261222 OK: duty-push back at 0,30 * * * *; Fri 17:00, Sat 13:00, Sun 08:00 Asia/Famagusta; one due tick per local day in all three windows; 16:57 not due; pause stops the send (true, false, true); weekend-digest untouched';
END
$$;

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
VALUES ('20261222_duty_push_shift_rollback.sql', '4106eb1bb605d372fa8b2846cd0a811b66cf2a0587dd758c6313e43162903128')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   supabase/verify_schema.sql QUERY 1 / Q2: the 20261210 and 20261139 duty-push tokens read OK again; the
--   20261221 tokens are gone from this branch (the shift is rolled back).
