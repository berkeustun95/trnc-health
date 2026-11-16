-- ═══════════════════════════════════════════════════════════════════════════
-- 20261211 — Data jobs, release 2 part 2: the watchdog (slice 5)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Applied in ONE supabase-migrate run after its sibling 20261210_data_jobs_switches.sql (needs its grace column).
--
-- WHAT IT DOES, IN PLAIN ENGLISH
-- Every 30 minutes (pg_cron 'data-jobs-watchdog', minutes 14 and 44: free of the :00/:30 duty jobs, the */5 reminder,
-- the :40 eatery job and every 03:xx purge) data_jobs_watchdog() reads data_jobs_overview(now()), compares it with
-- what it saw last time, and, ONLY WHEN SOMETHING CHANGED, tells every admin ONCE with a single combined notice (an
-- in-app notice plus an Expo push, the 20261196 pattern). Lines in it:
--   • a job entered attention (it was fine or unknown before, now failed / stale / inactive-with-an-expectation):
--     "<job>: <state>";
--   • a job is STILL in attention and was last announced more than 24 hours ago: "<job>: hâlâ <state>" (a daily nag
--     for as long as it stays red, so a red job cannot be forgotten);
--   • a job left attention and is not paused: "<job>: düzeldi";
--   • a job was paused or resumed, by anyone: "<job>: durduruldu (<note>)" / "<job>: yeniden başladı" (the
--     accountability line for an admin pause);
--   • Mondays 09:00-09:29 Asia/Famagusta, for each job that is paused and was not reminded in the last 6 days:
--     "<job>: hâlâ durdurulmuş (<dd.mm>, <note>)".
-- Nothing changed = nothing sent. The text is Turkish (title 'Veri işleri'); job keys are not user data. The body is
-- capped at about 300 characters: lines that do not fit become "…+N".
--
-- FIRST RUN: a job that is ALREADY in attention when the watchdog first runs counts as "just entered" and IS announced,
-- on purpose (that is the point of a watchdog: an existing problem should not stay silent). What keeps the release
-- itself quiet is 20261210's grace: every job's "stale" clock starts at that apply, so applying R2 alone makes no job
-- stale, and only real failures (failed, cut off, a cron job missing) can speak on the first tick. A job whose own writer
-- does not exist yet (the edge functions come in a later release) becomes stale, and is announced, once its
-- expected_every has passed since the apply: about 36 h, until that release is deployed.
-- If a tick has something to say but there is no admin at all, NOTHING is written (no state either), so the next tick
-- says it to the first admin that exists.
--
-- WHERE "WHAT WAS SEEN LAST" LIVES: public.data_jobs_alert_state, one row per job (job_key references data_jobs):
-- last_attention, last_paused, alerted_at (when the current attention episode was last announced) and reminded_at
-- (when the weekly "still paused" line was last sent). The weekly reminder is a per-job column, not a separate
-- singleton, because "reminded in the last 6 days" is a per-job fact.
--
-- WHO CAN READ / WRITE WHAT
--   data_jobs_alert_state: RLS ON, ZERO policies, every privilege revoked from PUBLIC, anon, authenticated AND
--     service_role. Only the owner (postgres) and the functions below, which run as the owner, touch it. It holds job
--     names and times, no user data.
--   data_jobs_watchdog(p_now): EXECUTE for the OWNER ONLY (revoked from PUBLIC, anon, authenticated, service_role). Only
--     the pg_cron job (runs as postgres) calls it. It takes no argument a caller could use to choose who is told or what
--     the text says: p_now only moves the clock (it is there so the probe below can test the Monday slot). SECURITY
--     DEFINER, search_path public.
--   notifications: one row per admin (profiles.role = 'admin'), type 'admin_alert', readable only by that admin through
--     the unchanged "users read own notifications" policy. Customers, providers and guests are never notified: the loop
--     reads profiles.role = 'admin' only. The push carries data {"screen": "admin", "tab": "datajobs"} (bundles that do
--     not know the route ignore the tap).
--   push_log: one row per admin, kind 'data_jobs_alert', request_id NULL when the admin has no push token. push_log has
--     no CHECK on kind (asserted below, as 20261196 and 20261194 do), so the new kind needs no constraint change.
--   data_jobs_watchdog_age(): EXECUTE for service_role ONLY. Returns the seconds since the watchdog's last SUCCEEDED
--     cron run inside the 30-day window (NULL if none). daily-health will call it, so a stopped watchdog turns that
--     check red. SECURITY DEFINER because service_role cannot read cron.job_run_details; it reads cron's status and
--     times only, never return_message or the command.
--   The registry row for the watchdog itself ('data-jobs-watchdog', cron_sql, 2 hours) keeps 20261205's coverage rule:
--   every cron job has exactly one data_jobs row (asserted again here).
--
-- Public logs: no user totals and no ids are printed; job names are fine.
-- Apply: supabase-migrate (with 20261210 in ONE run). Adds functions only; it ends with NOTIFY pgrst.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── 0. Pre-flight ──────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.data_jobs') AND attname = 'records_expected_from' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'REFUSING: 20261210 (data_jobs.records_expected_from) is not applied. Nothing applied.';
  END IF;
  IF to_regprocedure('public.data_jobs_overview(timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: data_jobs_overview is missing. Nothing applied.';
  END IF;
  IF to_regclass('public.push_log') IS NULL OR to_regclass('public.notifications') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: push_log / notifications are missing. Nothing applied.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.push_log'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) ILIKE '%kind%') THEN
    RAISE EXCEPTION 'REFUSING: push_log has a CHECK on kind; data_jobs_alert would be refused. Nothing applied.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.notifications'::regclass
                  AND conname = 'notifications_type_check' AND pg_get_constraintdef(oid) LIKE '%''admin_alert''%') THEN
    RAISE EXCEPTION 'REFUSING: notifications.type does not accept admin_alert. Nothing applied.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'net' AND p.proname = 'http_post') THEN
    RAISE EXCEPTION 'REFUSING: net.http_post (pg_net) is missing. Nothing applied.';
  END IF;
  IF to_regprocedure('cron.schedule(text,text,text)') IS NULL OR to_regclass('cron.job') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: pg_cron is missing. Nothing applied.';
  END IF;
END $$;

-- ─── 1. State: what the watchdog saw last time ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.data_jobs_alert_state (
  job_key        text        NOT NULL REFERENCES public.data_jobs (key),
  last_attention boolean     NOT NULL,
  last_paused    boolean     NOT NULL,
  alerted_at     timestamptz,
  reminded_at    timestamptz,
  CONSTRAINT data_jobs_alert_state_pkey PRIMARY KEY (job_key)
);
COMMENT ON TABLE public.data_jobs_alert_state IS
  'What data_jobs_watchdog() saw last time, per job (attention, paused, when last announced, when last reminded). RLS on, zero policies, no grants: only the owner and the watchdog touch it. 20261211.';
ALTER TABLE public.data_jobs_alert_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.data_jobs_alert_state FROM PUBLIC, anon, authenticated, service_role;

-- ─── 2. The watchdog ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.data_jobs_watchdog(p_now timestamptz DEFAULT now())
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ov       jsonb;
  e          jsonb;
  s          public.data_jobs_alert_state;
  v_key      text;
  v_state    text;
  v_word     text;
  v_att      boolean;
  v_paused   boolean;
  v_note     text;
  v_pat      timestamptz;
  v_last_att boolean;
  v_last_pau boolean;
  v_alerted  timestamptz;
  v_rem      timestamptz;
  v_known    boolean;
  v_slot     boolean;
  v_lines    text[] := ARRAY[]::text[];
  v_changes  jsonb := '[]'::jsonb;
  v_has_admin boolean;
  r          record;
  ttl        text := 'Veri işleri';
  bdy        text := '';
  v_i        int;
  v_total    int;
  req        bigint;
  n          integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('data_jobs_watchdog'));
  v_ov := public.data_jobs_overview(p_now);
  v_slot := extract(isodow FROM (p_now AT TIME ZONE 'Asia/Famagusta')) = 1
        AND extract(hour FROM (p_now AT TIME ZONE 'Asia/Famagusta')) = 9
        AND extract(minute FROM (p_now AT TIME ZONE 'Asia/Famagusta')) < 30;

  FOR e IN SELECT x FROM jsonb_array_elements(v_ov) x LOOP
    v_key    := e->>'key';
    v_state  := e->>'state';
    v_att    := (e->>'attention')::boolean;
    v_paused := (e->>'paused')::boolean;
    v_note   := e->>'paused_note';
    v_pat    := (e->>'paused_at')::timestamptz;
    v_word   := CASE v_state WHEN 'failed' THEN 'başarısız' WHEN 'stale' THEN 'sessiz' WHEN 'inactive' THEN 'kapalı' ELSE v_state END;
    SELECT * INTO s FROM public.data_jobs_alert_state WHERE job_key = v_key;
    v_known    := FOUND;
    v_last_att := CASE WHEN v_known THEN s.last_attention ELSE false END;
    v_last_pau := CASE WHEN v_known THEN s.last_paused ELSE false END;
    v_alerted  := CASE WHEN v_known THEN s.alerted_at END;
    v_rem      := CASE WHEN v_known THEN s.reminded_at END;

    IF v_att AND NOT v_last_att THEN
      v_lines := v_lines || (v_key || ': ' || v_word);
      v_alerted := p_now;
    ELSIF v_att AND v_last_att AND (v_alerted IS NULL OR v_alerted < p_now - interval '24 hours') THEN
      v_lines := v_lines || (v_key || ': hâlâ ' || v_word);
      v_alerted := p_now;
    ELSIF NOT v_att AND v_last_att THEN
      IF NOT v_paused THEN
        v_lines := v_lines || (v_key || ': düzeldi');
      END IF;
      v_alerted := NULL;
    END IF;

    IF v_paused IS DISTINCT FROM v_last_pau THEN
      IF v_paused THEN
        v_lines := v_lines || (v_key || ': durduruldu (' || left(coalesce(v_note, ''), 60) || CASE WHEN char_length(coalesce(v_note, '')) > 60 THEN '…' ELSE '' END || ')');
      ELSE
        v_lines := v_lines || (v_key || ': yeniden başladı');
        v_rem := NULL;
      END IF;
    ELSIF v_slot AND v_paused AND (v_rem IS NULL OR v_rem < p_now - interval '6 days') THEN
      v_lines := v_lines || (v_key || ': hâlâ durdurulmuş (' || coalesce(to_char(v_pat AT TIME ZONE 'Asia/Famagusta', 'DD.MM'), '?') || ', '
                             || left(coalesce(v_note, ''), 60) || CASE WHEN char_length(coalesce(v_note, '')) > 60 THEN '…' ELSE '' END || ')');
      v_rem := p_now;
    END IF;

    IF NOT v_known OR v_att IS DISTINCT FROM v_last_att OR v_paused IS DISTINCT FROM v_last_pau
       OR v_alerted IS DISTINCT FROM (CASE WHEN v_known THEN s.alerted_at END) OR v_rem IS DISTINCT FROM (CASE WHEN v_known THEN s.reminded_at END) THEN
      v_changes := v_changes || jsonb_build_array(jsonb_build_object('k', v_key, 'a', v_att, 'p', v_paused, 'al', v_alerted, 'rm', v_rem));
    END IF;
  END LOOP;

  IF cardinality(v_lines) > 0 THEN
    SELECT EXISTS (SELECT 1 FROM profiles WHERE role = 'admin') INTO v_has_admin;
    IF NOT v_has_admin THEN
      RETURN 0;
    END IF;
  END IF;

  IF jsonb_array_length(v_changes) > 0 THEN
    INSERT INTO public.data_jobs_alert_state (job_key, last_attention, last_paused, alerted_at, reminded_at)
    SELECT c.k, c.a, c.p, c.al, c.rm
      FROM jsonb_to_recordset(v_changes) AS c(k text, a boolean, p boolean, al timestamptz, rm timestamptz)
    ON CONFLICT (job_key) DO UPDATE
      SET last_attention = excluded.last_attention, last_paused = excluded.last_paused,
          alerted_at = excluded.alerted_at, reminded_at = excluded.reminded_at;
  END IF;

  IF cardinality(v_lines) = 0 THEN
    RETURN 0;
  END IF;

  v_total := cardinality(v_lines);
  FOR v_i IN 1 .. v_total LOOP
    IF v_i > 1 AND char_length(bdy) + 1 + char_length(v_lines[v_i]) > 300 THEN
      bdy := bdy || E'\n…+' || (v_total - v_i + 1);
      EXIT;
    END IF;
    bdy := bdy || CASE WHEN v_i > 1 THEN E'\n' ELSE '' END || v_lines[v_i];
  END LOOP;

  FOR r IN SELECT id, push_token FROM profiles WHERE role = 'admin' LOOP
    INSERT INTO notifications (user_id, title, body, type) VALUES (r.id, ttl, bdy, 'admin_alert');
    req := NULL;
    IF r.push_token IS NOT NULL THEN
      SELECT net.http_post(
        url     := 'https://exp.host/--/api/v2/push/send',
        body    := jsonb_build_object('to', r.push_token, 'title', ttl, 'body', bdy, 'sound', 'default',
                     'data', jsonb_build_object('screen', 'admin', 'tab', 'datajobs')),
        headers := jsonb_build_object('Content-Type', 'application/json')) INTO req;
    END IF;
    INSERT INTO push_log (user_id, kind, request_id) VALUES (r.id, 'data_jobs_alert', req);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION public.data_jobs_watchdog(timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- ─── 3. data_jobs_watchdog_age(): is the watchdog itself still running? ─────
CREATE OR REPLACE FUNCTION public.data_jobs_watchdog_age()
 RETURNS integer
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN count(*) = 0 THEN NULL
              ELSE greatest(0, extract(epoch FROM now() - max(coalesce(d.end_time, d.start_time))))::integer END
    FROM cron.job j
    JOIN cron.job_run_details d ON d.jobid = j.jobid
   WHERE j.jobname = 'data-jobs-watchdog' AND d.status = 'succeeded'
     AND coalesce(d.start_time, d.end_time) > now() - interval '30 days'
$function$;

REVOKE ALL ON FUNCTION public.data_jobs_watchdog_age() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.data_jobs_watchdog_age() TO service_role;

-- ─── 4. The registry row and the cron job ───────────────────────────────────
INSERT INTO public.data_jobs (key, runner, kind, cron_jobnames, schedule_note, expected_every, sort) VALUES
  ('data-jobs-watchdog', 'cron_sql', 'health', ARRAY['data-jobs-watchdog'], NULL, interval '2 hours', 60)
ON CONFLICT (key) DO NOTHING;

SELECT cron.unschedule('data-jobs-watchdog') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'data-jobs-watchdog');
SELECT cron.schedule('data-jobs-watchdog', '14,44 * * * *', 'SELECT public.data_jobs_watchdog();');

-- ─── Assertions + probes (inside the transaction; a failure rolls the file back) ─
DO $$
DECLARE
  v_names  text;
  v_n      int;
  v_fn     text;
  v_role   text;
  v_admin  uuid;
  v_cust   uuid;
  v_adm_n  int;
BEGIN
  -- the state table: owner, RLS, ZERO policies, no client / service privilege
  IF (SELECT relowner::regrole::text FROM pg_class WHERE oid = to_regclass('public.data_jobs_alert_state')) IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'data_jobs_alert_state is not owned by postgres';
  END IF;
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.data_jobs_alert_state')) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'RLS is not enabled on data_jobs_alert_state';
  END IF;
  SELECT count(*), coalesce(string_agg(policyname || ':' || cmd, ', '), '(none)') INTO v_n, v_names
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'data_jobs_alert_state';
  IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'data_jobs_alert_state must carry ZERO policies; found %: %', v_n, v_names; END IF;
  RAISE NOTICE 'data_jobs_alert_state policies: % (%)', v_n, v_names;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_table_privilege(v_role, 'public.data_jobs_alert_state', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION '% holds a privilege on data_jobs_alert_state', v_role;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.data_jobs_alert_state') AND a.attnum > 0 AND NOT a.attisdropped
                AND (has_column_privilege(v_role, a.attrelid, a.attname, 'SELECT') OR has_column_privilege(v_role, a.attrelid, a.attname, 'INSERT')
                     OR has_column_privilege(v_role, a.attrelid, a.attname, 'UPDATE'))) THEN
      RAISE EXCEPTION '% holds a column privilege on data_jobs_alert_state', v_role;
    END IF;
  END LOOP;

  -- the functions: owner, DEFINER, EXECUTE sets from the ACL
  FOREACH v_fn IN ARRAY ARRAY['public.data_jobs_watchdog(timestamptz)', 'public.data_jobs_watchdog_age()'] LOOP
    IF to_regprocedure(v_fn) IS NULL THEN RAISE EXCEPTION '% is missing', v_fn; END IF;
    IF (SELECT pg_get_userbyid(p.proowner) FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS DISTINCT FROM 'postgres'
       OR NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) THEN
      RAISE EXCEPTION '% is not a postgres-owned SECURITY DEFINER function', v_fn;
    END IF;
    IF (SELECT p.proacl IS NULL FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) THEN
      RAISE EXCEPTION '% carries the default ACL (NULL), which grants PUBLIC', v_fn;
    END IF;
    RAISE NOTICE '% EXECUTE held by: %', v_fn,
      (SELECT coalesce(string_agg(DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ', ' ORDER BY CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END), '(none)')
         FROM pg_proc p, LATERAL aclexplode(p.proacl) a WHERE p.oid = to_regprocedure(v_fn) AND a.privilege_type = 'EXECUTE');
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) a
              WHERE p.oid = to_regprocedure('public.data_jobs_watchdog(timestamptz)') AND a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner) THEN
    RAISE EXCEPTION 'data_jobs_watchdog is EXECUTE-able by a role other than its owner';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_function_privilege(v_role, 'public.data_jobs_watchdog(timestamptz)', 'EXECUTE') THEN
      RAISE EXCEPTION '% can execute data_jobs_watchdog: anyone could ping every admin', v_role;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.data_jobs_watchdog_age()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.data_jobs_watchdog_age()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.data_jobs_watchdog_age()', 'EXECUTE') THEN
    RAISE EXCEPTION 'data_jobs_watchdog_age must be EXECUTE for service_role only';
  END IF;
  IF has_table_privilege('service_role', 'cron.job_run_details', 'SELECT') THEN
    RAISE NOTICE 'service_role can read cron.job_run_details here; data_jobs_watchdog_age stays DEFINER regardless';
  END IF;

  -- the log kind: push_log has no CHECK on kind (so 'data_jobs_alert' needs no change); print what is there
  SELECT count(*) INTO v_n FROM pg_constraint WHERE conrelid = 'public.push_log'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%kind%';
  IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'push_log carries % CHECK constraint(s) on kind', v_n; END IF;

  -- the job: exactly one, the exact command, a minute no other job fires at
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'data-jobs-watchdog') IS DISTINCT FROM 1
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'data-jobs-watchdog' AND schedule = '14,44 * * * *' AND active
                     AND btrim(command) = 'SELECT public.data_jobs_watchdog();') THEN
    RAISE EXCEPTION 'data-jobs-watchdog is not scheduled exactly once with the exact schedule and command';
  END IF;
  SELECT string_agg(jobname || ' (' || schedule || ')', ', ' ORDER BY jobname) INTO v_names FROM cron.job
   WHERE jobname <> 'data-jobs-watchdog'
     AND (schedule = '14,44 * * * *' OR split_part(schedule, ' ', 1) ~ '(^|,)(14|44)(,|$)' OR split_part(schedule, ' ', 1) = '*');
  IF v_names IS NOT NULL THEN RAISE EXCEPTION 'another cron job fires at the watchdog''s minutes: %', v_names; END IF;

  -- coverage (20261205's rule, repeated): every cron job has exactly one registry row, every listed name exists
  SELECT string_agg(j.jobname, ', ' ORDER BY j.jobname) INTO v_names
    FROM cron.job j WHERE (SELECT count(*) FROM public.data_jobs d WHERE j.jobname = ANY (d.cron_jobnames)) IS DISTINCT FROM 1;
  IF v_names IS NOT NULL THEN RAISE EXCEPTION 'cron jobs not covered by exactly one data_jobs row: %', v_names; END IF;
  SELECT string_agg(DISTINCT n, ', ' ORDER BY n) INTO v_names
    FROM public.data_jobs d, unnest(d.cron_jobnames) AS n WHERE NOT EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = n);
  IF v_names IS NOT NULL THEN RAISE EXCEPTION 'data_jobs lists cron jobs that do not exist: %', v_names; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.data_jobs WHERE key = 'data-jobs-watchdog' AND runner = 'cron_sql' AND kind = 'health'
                  AND expected_every = interval '2 hours' AND NOT switchable) THEN
    RAISE EXCEPTION 'the watchdog registry row is wrong';
  END IF;

  SELECT id INTO v_admin FROM public.profiles WHERE role = 'admin' ORDER BY id LIMIT 1;
  SELECT id INTO v_cust FROM public.profiles WHERE role IS DISTINCT FROM 'admin' ORDER BY id LIMIT 1;
  SELECT count(*) INTO v_adm_n FROM public.profiles WHERE role = 'admin';
  IF v_admin IS NULL OR v_cust IS NULL THEN RAISE EXCEPTION 'need one admin and one non-admin profile to run the positive controls with'; END IF;

  -- behaviour probes, ALL rolled back (ZZ_PROBE_ROLLBACK). Nothing below changes a real row for good.
  DECLARE
    v_res    text[] := ARRAY[]::text[];
    v_r      text;
    v_expect text[];
    v_cnt    int;
    v_to_cust int;
    v_to_other int;
    v_push_ok boolean;
    v_age    int;
    v_sr_call text;
    v_anon_call text;
    v_auth_call text;
    v_mon_in timestamptz := timestamptz '2030-01-07 07:14+00';   -- Monday 09:14 Asia/Famagusta (winter, +02)
  BEGIN
    BEGIN
      -- quiesce: whatever the live data says is recorded as already seen, so later ticks only report what a probe changed
      PERFORM public.data_jobs_watchdog(now());

      INSERT INTO public.data_jobs (key, runner, kind, expected_every, records_expected_from, sort)
        VALUES ('probe-wd-gh', 'github', 'health', interval '1 hour', now() - interval '5 days', 9990);
      INSERT INTO public.data_jobs (key, runner, kind, switchable, sort) VALUES ('probe-wd-sw', 'github', 'feed', true, 9991);

      -- 1. entered attention: one line; admins only; push iff a token
      DELETE FROM public.notifications WHERE title = 'Veri işleri' AND user_id IN (SELECT id FROM public.profiles WHERE role = 'admin');
      DELETE FROM public.push_log WHERE kind = 'data_jobs_alert';
      PERFORM public.data_jobs_watchdog(now());
      SELECT coalesce(string_agg(l, ' | ' ORDER BY l), '-') INTO v_r FROM public.notifications n, regexp_split_to_table(n.body, E'\n') l
       WHERE n.user_id = v_admin AND n.title = 'Veri işleri' AND l LIKE 'probe-wd-gh%';
      v_res := v_res || ('entered=' || v_r);
      SELECT count(*) INTO v_cnt FROM public.notifications WHERE title = 'Veri işleri' AND type = 'admin_alert';
      v_res := v_res || ('notices_equal_admins=' || (v_cnt = v_adm_n)::text);
      SELECT count(*) INTO v_to_cust FROM public.notifications WHERE title = 'Veri işleri' AND user_id IN (SELECT id FROM public.profiles WHERE role IS DISTINCT FROM 'admin');
      v_res := v_res || ('notices_to_non_admins=' || v_to_cust);
      SELECT count(*) INTO v_to_other FROM public.push_log WHERE kind = 'data_jobs_alert' AND user_id IN (SELECT id FROM public.profiles WHERE role IS DISTINCT FROM 'admin');
      v_res := v_res || ('push_log_to_non_admins=' || v_to_other);
      SELECT bool_and((pl.request_id IS NULL) = (p.push_token IS NULL)) AND count(*) = v_adm_n INTO v_push_ok
        FROM public.push_log pl JOIN public.profiles p ON p.id = pl.user_id WHERE pl.kind = 'data_jobs_alert';
      v_res := v_res || ('push_iff_token=' || coalesce(v_push_ok, false)::text);

      -- 2. second tick: nothing
      DELETE FROM public.notifications WHERE title = 'Veri işleri' AND user_id IN (SELECT id FROM public.profiles WHERE role = 'admin');
      PERFORM public.data_jobs_watchdog(now());
      SELECT count(*) INTO v_cnt FROM public.notifications n WHERE n.title = 'Veri işleri' AND n.body LIKE '%probe-wd%';
      v_res := v_res || ('second_tick_probe_lines=' || v_cnt);

      -- 3. still red and last announced 25 h ago: re-alert; 23 h ago: quiet
      UPDATE public.data_jobs_alert_state SET alerted_at = now() - interval '23 hours' WHERE job_key = 'probe-wd-gh';
      PERFORM public.data_jobs_watchdog(now());
      SELECT count(*) INTO v_cnt FROM public.notifications n WHERE n.title = 'Veri işleri' AND n.body LIKE '%probe-wd%';
      v_res := v_res || ('realert_23h=' || v_cnt);
      UPDATE public.data_jobs_alert_state SET alerted_at = now() - interval '25 hours' WHERE job_key = 'probe-wd-gh';
      PERFORM public.data_jobs_watchdog(now());
      SELECT coalesce(string_agg(l, ' | ' ORDER BY l), '-') INTO v_r FROM public.notifications n, regexp_split_to_table(n.body, E'\n') l
       WHERE n.user_id = v_admin AND n.title = 'Veri işleri' AND l LIKE 'probe-wd-gh%';
      v_res := v_res || ('realert_25h=' || v_r);

      -- 4. recovery
      DELETE FROM public.notifications WHERE title = 'Veri işleri' AND user_id IN (SELECT id FROM public.profiles WHERE role = 'admin');
      INSERT INTO public.data_job_runs (job_key, started_at, finished_at, outcome, source) VALUES ('probe-wd-gh', now() - interval '1 minute', now(), 'ok', 'github');
      PERFORM public.data_jobs_watchdog(now());
      SELECT coalesce(string_agg(l, ' | ' ORDER BY l), '-') INTO v_r FROM public.notifications n, regexp_split_to_table(n.body, E'\n') l
       WHERE n.user_id = v_admin AND n.title = 'Veri işleri' AND l LIKE 'probe-wd-gh%';
      v_res := v_res || ('recovered=' || v_r);

      -- 5. paused / resumed (with the note) by anyone
      DELETE FROM public.notifications WHERE title = 'Veri işleri' AND user_id IN (SELECT id FROM public.profiles WHERE role = 'admin');
      UPDATE public.data_jobs SET paused = true, paused_note = 'bakım', paused_by = v_admin, paused_at = timestamptz '2029-12-31 22:30+00' WHERE key = 'probe-wd-sw';
      PERFORM public.data_jobs_watchdog(now());
      SELECT coalesce(string_agg(l, ' | ' ORDER BY l), '-') INTO v_r FROM public.notifications n, regexp_split_to_table(n.body, E'\n') l
       WHERE n.user_id = v_admin AND n.title = 'Veri işleri' AND l LIKE 'probe-wd-sw%';
      v_res := v_res || ('paused=' || v_r);

      -- 6. weekly "still paused": in the Monday 09:00-09:29 slot only, once per 6 days
      -- the clock jumps to 2030, where every real job's grace is over: record that as already seen first, so the body
      -- only carries what the probe changes (a full body would cut the probe's line and hide it)
      PERFORM public.data_jobs_watchdog(v_mon_in - interval '1 day');
      DELETE FROM public.notifications WHERE title = 'Veri işleri' AND user_id IN (SELECT id FROM public.profiles WHERE role = 'admin');
      PERFORM public.data_jobs_watchdog(v_mon_in);
      SELECT coalesce(string_agg(l, ' | ' ORDER BY l), '-') INTO v_r FROM public.notifications n, regexp_split_to_table(n.body, E'\n') l
       WHERE n.user_id = v_admin AND n.title = 'Veri işleri' AND l LIKE 'probe-wd-sw%';
      v_res := v_res || ('weekly_in_slot=' || v_r);
      DELETE FROM public.notifications WHERE title = 'Veri işleri' AND user_id IN (SELECT id FROM public.profiles WHERE role = 'admin');
      PERFORM public.data_jobs_watchdog(v_mon_in + interval '1 minute');
      SELECT count(*) INTO v_cnt FROM public.notifications n, regexp_split_to_table(n.body, E'\n') l WHERE n.user_id = v_admin AND n.title = 'Veri işleri' AND l LIKE 'probe-wd-sw%';
      v_res := v_res || ('weekly_again_same_slot=' || v_cnt);
      UPDATE public.data_jobs_alert_state SET reminded_at = v_mon_in - interval '5 days' WHERE job_key = 'probe-wd-sw';
      PERFORM public.data_jobs_watchdog(v_mon_in + interval '2 minutes');
      SELECT count(*) INTO v_cnt FROM public.notifications n, regexp_split_to_table(n.body, E'\n') l WHERE n.user_id = v_admin AND n.title = 'Veri işleri' AND l LIKE 'probe-wd-sw%';
      v_res := v_res || ('weekly_5_days=' || v_cnt);
      UPDATE public.data_jobs_alert_state SET reminded_at = v_mon_in - interval '7 days' WHERE job_key = 'probe-wd-sw';
      PERFORM public.data_jobs_watchdog(v_mon_in + interval '3 minutes');
      SELECT count(*) INTO v_cnt FROM public.notifications n, regexp_split_to_table(n.body, E'\n') l WHERE n.user_id = v_admin AND n.title = 'Veri işleri' AND l LIKE 'probe-wd-sw%';
      v_res := v_res || ('weekly_7_days=' || v_cnt);
      -- outside the slot (reminder never sent): Mon 08:59, Mon 09:30, Mon 10:14, Tue 09:14, Sun 09:14 local; inside: 09:00 and 09:29
      UPDATE public.data_jobs_alert_state SET reminded_at = NULL WHERE job_key = 'probe-wd-sw';
      v_cnt := 0;
      DELETE FROM public.notifications WHERE title = 'Veri işleri' AND user_id IN (SELECT id FROM public.profiles WHERE role = 'admin');
      PERFORM public.data_jobs_watchdog(timestamptz '2030-01-07 06:59+00');
      PERFORM public.data_jobs_watchdog(timestamptz '2030-01-07 07:30+00');
      PERFORM public.data_jobs_watchdog(timestamptz '2030-01-07 08:14+00');
      PERFORM public.data_jobs_watchdog(timestamptz '2030-01-08 07:14+00');
      PERFORM public.data_jobs_watchdog(timestamptz '2030-01-06 07:14+00');
      SELECT count(*) INTO v_cnt FROM public.notifications n, regexp_split_to_table(n.body, E'\n') l WHERE n.user_id = v_admin AND n.title = 'Veri işleri' AND l LIKE 'probe-wd-sw%';
      v_res := v_res || ('weekly_outside_slot=' || v_cnt);
      PERFORM public.data_jobs_watchdog(timestamptz '2030-01-07 07:00+00');
      SELECT count(*) INTO v_cnt FROM public.notifications n, regexp_split_to_table(n.body, E'\n') l WHERE n.user_id = v_admin AND n.title = 'Veri işleri' AND l LIKE 'probe-wd-sw%';
      v_res := v_res || ('weekly_0900=' || v_cnt);
      UPDATE public.data_jobs_alert_state SET reminded_at = NULL WHERE job_key = 'probe-wd-sw';
      PERFORM public.data_jobs_watchdog(timestamptz '2030-01-07 07:29+00');
      SELECT count(*) INTO v_cnt FROM public.notifications n, regexp_split_to_table(n.body, E'\n') l WHERE n.user_id = v_admin AND n.title = 'Veri işleri' AND l LIKE 'probe-wd-sw%' AND l LIKE '%hâlâ durdurulmuş%';
      v_res := v_res || ('weekly_0900_plus_0929_total=' || v_cnt);

      -- 7. resumed
      PERFORM public.data_jobs_watchdog(now());
      DELETE FROM public.notifications WHERE title = 'Veri işleri' AND user_id IN (SELECT id FROM public.profiles WHERE role = 'admin');
      UPDATE public.data_jobs SET paused = false, paused_note = NULL, paused_by = NULL, paused_at = NULL WHERE key = 'probe-wd-sw';
      PERFORM public.data_jobs_watchdog(now());
      SELECT coalesce(string_agg(l, ' | ' ORDER BY l), '-') INTO v_r FROM public.notifications n, regexp_split_to_table(n.body, E'\n') l
       WHERE n.user_id = v_admin AND n.title = 'Veri işleri' AND l LIKE 'probe-wd-sw%';
      v_res := v_res || ('resumed=' || v_r);

      -- 8. body cap: many lines are cut with "…+N"
      DELETE FROM public.notifications WHERE title = 'Veri işleri' AND user_id IN (SELECT id FROM public.profiles WHERE role = 'admin');
      INSERT INTO public.data_jobs (key, runner, kind, expected_every, records_expected_from, sort)
        SELECT 'probe-wd-many-' || lpad(g::text, 2, '0'), 'github', 'health', interval '1 hour', now() - interval '5 days', 9992 FROM generate_series(1, 30) g;
      PERFORM public.data_jobs_watchdog(now());
      SELECT (char_length(body) <= 330 AND body ~ E'\n…\\+[0-9]+$')::text INTO v_r FROM public.notifications WHERE user_id = v_admin AND title = 'Veri işleri';
      v_res := v_res || ('body_capped=' || coalesce(v_r, 'none'));

      -- 9. who can reach the watchdog and its state: nobody but the owner (the owner calls above are the positive control)
      SET LOCAL ROLE anon;
      BEGIN PERFORM public.data_jobs_watchdog(); v_anon_call := 'ALLOWED'; EXCEPTION WHEN insufficient_privilege THEN v_anon_call := 'denied'; WHEN OTHERS THEN v_anon_call := SQLERRM; END;
      BEGIN PERFORM 1 FROM public.data_jobs_alert_state; v_res := v_res || 'anon_state=ALLOWED'::text; EXCEPTION WHEN insufficient_privilege THEN v_res := v_res || 'anon_state=denied'::text; END;
      SET LOCAL ROLE authenticated;
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
      BEGIN PERFORM public.data_jobs_watchdog(); v_auth_call := 'ALLOWED'; EXCEPTION WHEN insufficient_privilege THEN v_auth_call := 'denied'; WHEN OTHERS THEN v_auth_call := SQLERRM; END;
      BEGIN PERFORM 1 FROM public.data_jobs_alert_state; v_res := v_res || 'admin_state=ALLOWED'::text; EXCEPTION WHEN insufficient_privilege THEN v_res := v_res || 'admin_state=denied'::text; END;
      BEGIN PERFORM public.data_jobs_watchdog_age(); v_res := v_res || 'admin_age=ALLOWED'::text; EXCEPTION WHEN insufficient_privilege THEN v_res := v_res || 'admin_age=denied'::text; END;
      SET LOCAL ROLE service_role;
      BEGIN PERFORM public.data_jobs_watchdog(); v_sr_call := 'ALLOWED'; EXCEPTION WHEN insufficient_privilege THEN v_sr_call := 'denied'; WHEN OTHERS THEN v_sr_call := SQLERRM; END;
      BEGIN PERFORM 1 FROM public.data_jobs_alert_state; v_res := v_res || 'service_state=ALLOWED'::text; EXCEPTION WHEN insufficient_privilege THEN v_res := v_res || 'service_state=denied'::text; END;
      -- the one thing service_role may call (positive control for the denials above); NULL is right before the first cron run
      v_age := public.data_jobs_watchdog_age();
      v_res := v_res || 'age_service_role_call=ok'::text;
      SET LOCAL ROLE postgres;
      PERFORM set_config('request.jwt.claims', '', true);
      v_res := v_res || ('anon_watchdog=' || v_anon_call) || ('auth_watchdog=' || v_auth_call) || ('service_watchdog=' || v_sr_call);

      RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
    END;
    SET LOCAL ROLE postgres;

    v_expect := ARRAY[
      'entered=probe-wd-gh: sessiz', 'notices_equal_admins=true', 'notices_to_non_admins=0', 'push_log_to_non_admins=0', 'push_iff_token=true',
      'second_tick_probe_lines=0', 'realert_23h=0', 'realert_25h=probe-wd-gh: hâlâ sessiz', 'recovered=probe-wd-gh: düzeldi',
      'paused=probe-wd-sw: durduruldu (bakım)',
      'weekly_in_slot=probe-wd-sw: hâlâ durdurulmuş (01.01, bakım)', 'weekly_again_same_slot=0', 'weekly_5_days=0', 'weekly_7_days=1',
      'weekly_outside_slot=0', 'weekly_0900=1', 'weekly_0900_plus_0929_total=2',
      'resumed=probe-wd-sw: yeniden başladı', 'body_capped=true',
      'anon_state=denied', 'admin_state=denied', 'admin_age=denied', 'service_state=denied', 'age_service_role_call=ok',
      'anon_watchdog=denied', 'auth_watchdog=denied', 'service_watchdog=denied'];
    IF v_res IS DISTINCT FROM v_expect THEN
      RAISE EXCEPTION 'watchdog probe results differ. got: % | expected: %', v_res, v_expect;
    END IF;
    RAISE NOTICE 'watchdog probes (% checks): %', cardinality(v_res), v_res;
    RAISE NOTICE 'data_jobs_watchdog_age() before the first cron run: % (NULL is right)', coalesce(v_age::text, 'NULL');

    IF EXISTS (SELECT 1 FROM public.data_jobs WHERE key LIKE 'probe-wd-%')
       OR EXISTS (SELECT 1 FROM public.data_jobs_alert_state WHERE job_key LIKE 'probe-wd-%')
       OR EXISTS (SELECT 1 FROM public.data_jobs WHERE paused)
       OR EXISTS (SELECT 1 FROM public.notifications WHERE title = 'Veri işleri')
       OR EXISTS (SELECT 1 FROM public.push_log WHERE kind = 'data_jobs_alert')
       OR (SELECT count(*) FROM public.data_jobs_alert_state) > 0 THEN
      RAISE EXCEPTION 'probe rows leaked';
    END IF;
  END;
  RAISE NOTICE '20261211 OK: watchdog (owner only), state table (RLS on, no policies, no grants), job at :14 / :44, coverage holds';
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
VALUES ('20261211_data_jobs_watchdog.sql', '373d2521389a8b779ecd310a30cbca12d03f658f4824eee64f60e7bc6d331ae9')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Rollback (by hand, as a new migration, only if ever needed) ────────────
--   SELECT cron.unschedule('data-jobs-watchdog'); DELETE FROM public.data_jobs WHERE key = 'data-jobs-watchdog';
--   DROP FUNCTION public.data_jobs_watchdog_age(); DROP FUNCTION public.data_jobs_watchdog(timestamptz); DROP TABLE public.data_jobs_alert_state;
