-- ═══════════════════════════════════════════════════════════════════════════
-- 20261218 — Admin alerts in English (the admin area is English only)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT IT DOES, IN PLAIN ENGLISH
-- The two server-side admin alert pushes were Turkish. The admin area is English only now, so their TEXT becomes English.
-- Nothing else changes: same recipients (profiles.role = 'admin' only), same rules (what triggers a send, the 24 h
-- re-alert, the Monday 09:00 slot, the 30 minute window, the 300 character body cap with "…+N"), same locks, same push
-- data, same state tables, same cron jobs, same grants. CREATE OR REPLACE of two functions that 20261211 and 20261196
-- created (and that are live), so no new notification writer appears: the 1066_notification_type count stays 8.
--
--   data_jobs_watchdog(timestamptz)        title 'Veri işleri' -> 'Data jobs'. Words: failed / stale / off
--                                          (were başarısız / sessiz / kapalı). Lines: "<key>: <word>",
--                                          "<key>: still <word>", "<key>: recovered", "<key>: paused (<note>)",
--                                          "<key>: resumed", "<key>: still paused (DD.MM, <note>)".
--   marketplace_photo_review_reminder()    title stays 'Bandabuliya' (the module name). Body "<n> photo waiting for review"
--                                          when n = 1, "<n> photos waiting for review" otherwise.
--
-- DEDUPE IS NOT TEXT-BASED: the watchdog decides from public.data_jobs_alert_state and the reminder from
-- public.marketplace_photo_reminder_state, never from a title or a body, so changing the words changes nothing about
-- when something is sent. Notices already stored in Turkish stay as they are (the admin Data jobs read-only probe matches both titles).
--
-- WHO CAN READ / WRITE WHAT (unchanged; asserted again below)
--   data_jobs_watchdog(p_now): EXECUTE for the OWNER ONLY (revoked from PUBLIC, anon, authenticated, service_role).
--   marketplace_photo_review_reminder(): EXECUTE for service_role only (revoked from PUBLIC, anon, authenticated).
--   Both are SECURITY DEFINER with search_path public and write notifications (type 'admin_alert', one row per admin;
--   read only by that admin through the unchanged "users read own notifications" policy), push_log and pg_net requests.
--   Customers, providers and guests are never notified.
--
-- THE SELF-TEST runs inside this transaction: the watchdog probes of 20261211 re-run against the English text (every
-- probe row is rolled back; what it captured is compared before and after, so a re-run is safe), the function
-- definitions are checked for the English code shapes AND for the absence of any Turkish text (with a positive
-- control for that check), and the reminder's body text is asserted from its definition.
--
-- Public logs: no user totals and no ids are printed; job names are fine.
-- Apply: supabase-migrate. Adds no table, column or constraint; replaces two function bodies.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── 0. Pre-flight ──────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.data_jobs_watchdog(timestamptz)') IS NULL OR to_regclass('public.data_jobs_alert_state') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: 20261211 (data_jobs_watchdog) is not applied. Nothing applied.';
  END IF;
  IF to_regprocedure('public.marketplace_photo_review_reminder()') IS NULL OR to_regclass('public.marketplace_photo_reminder_state') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: 20261196 (marketplace_photo_review_reminder) is not applied. Nothing applied.';
  END IF;
END $$;

-- ─── 1. The watchdog, English ───────────────────────────────────────────────
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
  ttl        text := 'Data jobs';
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
    v_word   := CASE v_state WHEN 'failed' THEN 'failed' WHEN 'stale' THEN 'stale' WHEN 'inactive' THEN 'off' ELSE v_state END;
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
      v_lines := v_lines || (v_key || ': still ' || v_word);
      v_alerted := p_now;
    ELSIF NOT v_att AND v_last_att THEN
      IF NOT v_paused THEN
        v_lines := v_lines || (v_key || ': recovered');
      END IF;
      v_alerted := NULL;
    END IF;

    IF v_paused IS DISTINCT FROM v_last_pau THEN
      IF v_paused THEN
        v_lines := v_lines || (v_key || ': paused (' || left(coalesce(v_note, ''), 60) || CASE WHEN char_length(coalesce(v_note, '')) > 60 THEN '…' ELSE '' END || ')');
      ELSE
        v_lines := v_lines || (v_key || ': resumed');
        v_rem := NULL;
      END IF;
    ELSIF v_slot AND v_paused AND (v_rem IS NULL OR v_rem < p_now - interval '6 days') THEN
      v_lines := v_lines || (v_key || ': still paused (' || coalesce(to_char(v_pat AT TIME ZONE 'Asia/Famagusta', 'DD.MM'), '?') || ', '
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

-- ─── 2. The photo reminder, English ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.marketplace_photo_review_reminder()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_last  timestamptz;
  v_count integer;
  v_new   integer;
  r       record;
  ttl     text;
  bdy     text;
  req     bigint;
  n       integer := 0;
BEGIN
  SELECT last_sent_at INTO v_last FROM marketplace_photo_reminder_state WHERE id FOR UPDATE;

  -- (c) at most one reminder every 30 minutes.
  IF v_last IS NOT NULL AND v_last > now() - interval '30 minutes' THEN
    RETURN 0;
  END IF;

  -- One predicate for both numbers: pending, on a listing that is not deleted.
  SELECT count(*),
         count(*) FILTER (WHERE v_last IS NULL OR p.created_at > v_last)
    INTO v_count, v_new
    FROM marketplace_photos p
    JOIN marketplace_listings l ON l.id = p.listing_id
   WHERE p.status = 'pending' AND l.deleted_at IS NULL;

  -- (a) something waits, and (b) something joined the queue since the last reminder.
  IF v_count < 1 OR v_new < 1 THEN
    RETURN 0;
  END IF;

  ttl := 'Bandabuliya';
  bdy := v_count || CASE WHEN v_count = 1 THEN ' photo waiting for review' ELSE ' photos waiting for review' END;

  FOR r IN SELECT id, push_token FROM profiles WHERE role = 'admin' LOOP
    INSERT INTO notifications (user_id, title, body, type) VALUES (r.id, ttl, bdy, 'admin_alert');
    req := NULL;
    IF r.push_token IS NOT NULL THEN
      SELECT net.http_post(
        url     := 'https://exp.host/--/api/v2/push/send',
        body    := jsonb_build_object('to', r.push_token, 'title', ttl, 'body', bdy, 'sound', 'default',
                     'data', jsonb_build_object('screen', 'admin', 'tab', 'marketplace', 'view', 'photos')),
        headers := jsonb_build_object('Content-Type', 'application/json')) INTO req;
    END IF;
    INSERT INTO push_log (user_id, kind, request_id) VALUES (r.id, 'mk_photos_waiting', req);
    n := n + 1;
  END LOOP;

  -- An upsert, not an UPDATE: if the state row were ever missing, an UPDATE would stamp nothing and every tick would send.
  IF n > 0 THEN
    INSERT INTO marketplace_photo_reminder_state (id, last_sent_at) VALUES (true, now())
    ON CONFLICT (id) DO UPDATE SET last_sent_at = excluded.last_sent_at;
  END IF;
  RETURN n;
END;
$function$;
REVOKE ALL ON FUNCTION public.marketplace_photo_review_reminder() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketplace_photo_review_reminder() TO service_role;

-- ─── Assertions + probes (inside the transaction; a failure rolls the file back) ─
DO $$
DECLARE
  v_n      int;
  v_fn     text;
  v_role   text;
  v_def    text;
  v_admin  uuid;
  v_cust   uuid;
  v_adm_n  int;
  v_tr     text := '(hâlâ|düzeldi|durduruldu|yeniden başladı|başarısız|sessiz|kapalı|Veri işleri|fotoğraf|onay bekliyor)';
BEGIN
  -- both functions: postgres-owned SECURITY DEFINER, search_path pinned, ACL present
  FOREACH v_fn IN ARRAY ARRAY['public.data_jobs_watchdog(timestamptz)', 'public.marketplace_photo_review_reminder()'] LOOP
    IF to_regprocedure(v_fn) IS NULL THEN RAISE EXCEPTION '% is missing', v_fn; END IF;
    IF (SELECT pg_get_userbyid(p.proowner) FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS DISTINCT FROM 'postgres'
       OR NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) THEN
      RAISE EXCEPTION '% is not a postgres-owned SECURITY DEFINER function', v_fn;
    END IF;
    IF (SELECT p.proconfig IS DISTINCT FROM ARRAY['search_path=public'] FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) THEN
      RAISE EXCEPTION '% lost its search_path pin', v_fn;
    END IF;
    IF (SELECT p.proacl IS NULL FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) THEN
      RAISE EXCEPTION '% carries the default ACL (NULL), which grants PUBLIC', v_fn;
    END IF;
    RAISE NOTICE '% EXECUTE held by: %', v_fn,
      (SELECT coalesce(string_agg(DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ', ' ORDER BY CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END), '(none)')
         FROM pg_proc p, LATERAL aclexplode(p.proacl) a WHERE p.oid = to_regprocedure(v_fn) AND a.privilege_type = 'EXECUTE');
  END LOOP;

  -- the watchdog: nobody but the owner
  IF EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) a
              WHERE p.oid = to_regprocedure('public.data_jobs_watchdog(timestamptz)') AND a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner) THEN
    RAISE EXCEPTION 'data_jobs_watchdog is EXECUTE-able by a role other than its owner';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_function_privilege(v_role, 'public.data_jobs_watchdog(timestamptz)', 'EXECUTE') THEN
      RAISE EXCEPTION '% can execute data_jobs_watchdog: anyone could ping every admin', v_role;
    END IF;
  END LOOP;

  -- the reminder: service_role only (positive control beside the denials)
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_function_privilege(v_role, 'public.marketplace_photo_review_reminder()', 'EXECUTE') THEN
      RAISE EXCEPTION '% can execute marketplace_photo_review_reminder(): anyone could ping every admin', v_role;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role', 'public.marketplace_photo_review_reminder()', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot execute marketplace_photo_review_reminder() (positive control)';
  END IF;

  -- the logic that must not have moved: shapes of both bodies (pg_get_functiondef), positives first
  v_def := pg_get_functiondef(to_regprocedure('public.data_jobs_watchdog(timestamptz)'));
  IF v_def NOT LIKE '%ttl        text := ''Data jobs'';%'
     OR v_def NOT LIKE '%WHEN ''failed'' THEN ''failed'' WHEN ''stale'' THEN ''stale'' WHEN ''inactive'' THEN ''off'' ELSE v_state END;%'
     OR v_def NOT LIKE '%(v_key || '': still '' || v_word)%'
     OR v_def NOT LIKE '%(v_key || '': recovered'')%'
     OR v_def NOT LIKE '%(v_key || '': paused ('' || left(coalesce(v_note, ''''), 60)%'
     OR v_def NOT LIKE '%(v_key || '': resumed'')%'
     OR v_def NOT LIKE '%(v_key || '': still paused ('' || coalesce(to_char(v_pat AT TIME ZONE ''Asia/Famagusta'', ''DD.MM''), ''?'')%'
     OR v_def NOT LIKE '%v_alerted < p_now - interval ''24 hours''%'
     OR v_def NOT LIKE '%> 300 THEN%'
     OR v_def NOT LIKE '%FOR r IN SELECT id, push_token FROM profiles WHERE role = ''admin'' LOOP%'
     OR v_def NOT LIKE '%INSERT INTO notifications (user_id, title, body, type) VALUES (r.id, ttl, bdy, ''admin_alert'')%'
     OR v_def NOT LIKE '%jsonb_build_object(''screen'', ''admin'', ''tab'', ''datajobs'')%'
     OR v_def NOT LIKE '%pg_advisory_xact_lock(hashtext(''data_jobs_watchdog''))%' THEN
    RAISE EXCEPTION 'data_jobs_watchdog does not have the expected English code shapes';
  END IF;
  -- the negative: no Turkish word in the definition (the function carries no comments). Positive control: the same
  -- pattern DOES match Turkish text, so an empty result means the text is gone, not that the pattern is blind.
  IF NOT ('hâlâ başarısız' ~* v_tr AND 'Veri işleri' ~* v_tr AND '5 fotoğraf onay bekliyor' ~* v_tr AND 'x: düzeldi' ~* v_tr) THEN
    RAISE EXCEPTION 'the Turkish-text pattern does not match Turkish text (the negative check would be blind)';
  END IF;
  IF v_def ~* v_tr OR v_def ~ '[çğışöüâÇĞİŞÖÜ]' THEN
    RAISE EXCEPTION 'data_jobs_watchdog still carries Turkish text';
  END IF;

  v_def := pg_get_functiondef(to_regprocedure('public.marketplace_photo_review_reminder()'));
  IF v_def NOT LIKE '%ttl := ''Bandabuliya'';%'
     OR v_def NOT LIKE '%bdy := v_count || CASE WHEN v_count = 1 THEN '' photo waiting for review'' ELSE '' photos waiting for review'' END;%'
     OR v_def NOT LIKE '%FOR r IN SELECT id, push_token FROM profiles WHERE role = ''admin'' LOOP%'
     OR v_def NOT LIKE '%INSERT INTO notifications (user_id, title, body, type) VALUES (r.id, ttl, bdy, ''admin_alert'')%'
     OR v_def NOT LIKE '%jsonb_build_object(''screen'', ''admin'', ''tab'', ''marketplace'', ''view'', ''photos'')%'
     OR v_def NOT LIKE '%VALUES (r.id, ''mk_photos_waiting'', req)%'
     OR v_def NOT LIKE '%v_last > now() - interval ''30 minutes''%'
     OR v_def NOT LIKE '%IF v_count < 1 OR v_new < 1 THEN%'
     OR v_def NOT LIKE '%IF n > 0 THEN%INSERT INTO marketplace_photo_reminder_state (id, last_sent_at) VALUES (true, now())%ON CONFLICT (id) DO UPDATE SET last_sent_at = excluded.last_sent_at;%' THEN
    RAISE EXCEPTION 'marketplace_photo_review_reminder does not have the expected English code shapes';
  END IF;
  IF v_def ~* v_tr OR v_def ~ '[çğışöüâÇĞİŞÖÜ]' THEN
    RAISE EXCEPTION 'marketplace_photo_review_reminder still carries Turkish text';
  END IF;
  RAISE NOTICE 'both functions: English text, unchanged logic shapes, no Turkish text left';

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
    -- jobs an admin paused for real before this runs: the probes must leave exactly that set behind
    v_paused_keys text := (SELECT coalesce(string_agg(key, ',' ORDER BY key), '') FROM public.data_jobs WHERE paused);
    v_notif_before bigint := (SELECT count(*) FROM public.notifications WHERE title = 'Data jobs');
    v_log_before   bigint := (SELECT count(*) FROM public.push_log WHERE kind = 'data_jobs_alert');
    v_state_before text   := (SELECT md5(coalesce(string_agg(row(job_key, last_attention, last_paused, alerted_at, reminded_at)::text, '|' ORDER BY job_key), '')) FROM public.data_jobs_alert_state);
  BEGIN
    BEGIN
      -- quiesce: whatever the live data says is recorded as already seen, so later ticks only report what a probe changed
      PERFORM public.data_jobs_watchdog(now());

      INSERT INTO public.data_jobs (key, runner, kind, expected_every, records_expected_from, sort)
        VALUES ('probe-wd-gh', 'github', 'health', interval '1 hour', now() - interval '5 days', 9990);
      INSERT INTO public.data_jobs (key, runner, kind, switchable, sort) VALUES ('probe-wd-sw', 'github', 'feed', true, 9991);

      -- 1. entered attention: one line; admins only; push iff a token
      DELETE FROM public.notifications WHERE title = 'Data jobs' AND user_id IN (SELECT id FROM public.profiles WHERE role = 'admin');
      DELETE FROM public.push_log WHERE kind = 'data_jobs_alert';
      PERFORM public.data_jobs_watchdog(now());
      SELECT coalesce(string_agg(l, ' | ' ORDER BY l), '-') INTO v_r FROM public.notifications n, regexp_split_to_table(n.body, E'\n') l
       WHERE n.user_id = v_admin AND n.title = 'Data jobs' AND l LIKE 'probe-wd-gh%';
      v_res := v_res || ('entered=' || v_r);
      SELECT count(*) INTO v_cnt FROM public.notifications WHERE title = 'Data jobs' AND type = 'admin_alert';
      v_res := v_res || ('notices_equal_admins=' || (v_cnt = v_adm_n)::text);
      SELECT count(*) INTO v_to_cust FROM public.notifications WHERE title = 'Data jobs' AND user_id IN (SELECT id FROM public.profiles WHERE role IS DISTINCT FROM 'admin');
      v_res := v_res || ('notices_to_non_admins=' || v_to_cust);
      SELECT count(*) INTO v_to_other FROM public.push_log WHERE kind = 'data_jobs_alert' AND user_id IN (SELECT id FROM public.profiles WHERE role IS DISTINCT FROM 'admin');
      v_res := v_res || ('push_log_to_non_admins=' || v_to_other);
      SELECT bool_and((pl.request_id IS NULL) = (p.push_token IS NULL)) AND count(*) = v_adm_n INTO v_push_ok
        FROM public.push_log pl JOIN public.profiles p ON p.id = pl.user_id WHERE pl.kind = 'data_jobs_alert';
      v_res := v_res || ('push_iff_token=' || coalesce(v_push_ok, false)::text);

      -- 2. second tick: nothing
      DELETE FROM public.notifications WHERE title = 'Data jobs' AND user_id IN (SELECT id FROM public.profiles WHERE role = 'admin');
      PERFORM public.data_jobs_watchdog(now());
      SELECT count(*) INTO v_cnt FROM public.notifications n WHERE n.title = 'Data jobs' AND n.body LIKE '%probe-wd%';
      v_res := v_res || ('second_tick_probe_lines=' || v_cnt);

      -- 3. still red and last announced 25 h ago: re-alert; 23 h ago: quiet
      UPDATE public.data_jobs_alert_state SET alerted_at = now() - interval '23 hours' WHERE job_key = 'probe-wd-gh';
      PERFORM public.data_jobs_watchdog(now());
      SELECT count(*) INTO v_cnt FROM public.notifications n WHERE n.title = 'Data jobs' AND n.body LIKE '%probe-wd%';
      v_res := v_res || ('realert_23h=' || v_cnt);
      UPDATE public.data_jobs_alert_state SET alerted_at = now() - interval '25 hours' WHERE job_key = 'probe-wd-gh';
      PERFORM public.data_jobs_watchdog(now());
      SELECT coalesce(string_agg(l, ' | ' ORDER BY l), '-') INTO v_r FROM public.notifications n, regexp_split_to_table(n.body, E'\n') l
       WHERE n.user_id = v_admin AND n.title = 'Data jobs' AND l LIKE 'probe-wd-gh%';
      v_res := v_res || ('realert_25h=' || v_r);

      -- 4. recovery
      DELETE FROM public.notifications WHERE title = 'Data jobs' AND user_id IN (SELECT id FROM public.profiles WHERE role = 'admin');
      INSERT INTO public.data_job_runs (job_key, started_at, finished_at, outcome, source) VALUES ('probe-wd-gh', now() - interval '1 minute', now(), 'ok', 'github');
      PERFORM public.data_jobs_watchdog(now());
      SELECT coalesce(string_agg(l, ' | ' ORDER BY l), '-') INTO v_r FROM public.notifications n, regexp_split_to_table(n.body, E'\n') l
       WHERE n.user_id = v_admin AND n.title = 'Data jobs' AND l LIKE 'probe-wd-gh%';
      v_res := v_res || ('recovered=' || v_r);

      -- 5. paused / resumed (with the note) by anyone
      DELETE FROM public.notifications WHERE title = 'Data jobs' AND user_id IN (SELECT id FROM public.profiles WHERE role = 'admin');
      UPDATE public.data_jobs SET paused = true, paused_note = 'maintenance', paused_by = v_admin, paused_at = timestamptz '2029-12-31 22:30+00' WHERE key = 'probe-wd-sw';
      PERFORM public.data_jobs_watchdog(now());
      SELECT coalesce(string_agg(l, ' | ' ORDER BY l), '-') INTO v_r FROM public.notifications n, regexp_split_to_table(n.body, E'\n') l
       WHERE n.user_id = v_admin AND n.title = 'Data jobs' AND l LIKE 'probe-wd-sw%';
      v_res := v_res || ('paused=' || v_r);

      -- 6. weekly "still paused": in the Monday 09:00-09:29 slot only, once per 6 days
      -- the clock jumps to 2030, where every real job's grace is over: record that as already seen first, so the body
      -- only carries what the probe changes (a full body would cut the probe's line and hide it)
      PERFORM public.data_jobs_watchdog(v_mon_in - interval '1 day');
      -- a really paused job would get its own Monday reminder line here and could crowd the probe's line out of the capped body
      UPDATE public.data_jobs_alert_state SET reminded_at = v_mon_in WHERE job_key NOT LIKE 'probe-wd-%' AND last_paused;
      DELETE FROM public.notifications WHERE title = 'Data jobs' AND user_id IN (SELECT id FROM public.profiles WHERE role = 'admin');
      PERFORM public.data_jobs_watchdog(v_mon_in);
      SELECT coalesce(string_agg(l, ' | ' ORDER BY l), '-') INTO v_r FROM public.notifications n, regexp_split_to_table(n.body, E'\n') l
       WHERE n.user_id = v_admin AND n.title = 'Data jobs' AND l LIKE 'probe-wd-sw%';
      v_res := v_res || ('weekly_in_slot=' || v_r);
      DELETE FROM public.notifications WHERE title = 'Data jobs' AND user_id IN (SELECT id FROM public.profiles WHERE role = 'admin');
      PERFORM public.data_jobs_watchdog(v_mon_in + interval '1 minute');
      SELECT count(*) INTO v_cnt FROM public.notifications n, regexp_split_to_table(n.body, E'\n') l WHERE n.user_id = v_admin AND n.title = 'Data jobs' AND l LIKE 'probe-wd-sw%';
      v_res := v_res || ('weekly_again_same_slot=' || v_cnt);
      UPDATE public.data_jobs_alert_state SET reminded_at = v_mon_in - interval '5 days' WHERE job_key = 'probe-wd-sw';
      PERFORM public.data_jobs_watchdog(v_mon_in + interval '2 minutes');
      SELECT count(*) INTO v_cnt FROM public.notifications n, regexp_split_to_table(n.body, E'\n') l WHERE n.user_id = v_admin AND n.title = 'Data jobs' AND l LIKE 'probe-wd-sw%';
      v_res := v_res || ('weekly_5_days=' || v_cnt);
      UPDATE public.data_jobs_alert_state SET reminded_at = v_mon_in - interval '7 days' WHERE job_key = 'probe-wd-sw';
      PERFORM public.data_jobs_watchdog(v_mon_in + interval '3 minutes');
      SELECT count(*) INTO v_cnt FROM public.notifications n, regexp_split_to_table(n.body, E'\n') l WHERE n.user_id = v_admin AND n.title = 'Data jobs' AND l LIKE 'probe-wd-sw%';
      v_res := v_res || ('weekly_7_days=' || v_cnt);
      -- outside the slot (reminder never sent): Mon 08:59, Mon 09:30, Mon 10:14, Tue 09:14, Sun 09:14 local; inside: 09:00 and 09:29
      UPDATE public.data_jobs_alert_state SET reminded_at = NULL WHERE job_key = 'probe-wd-sw';
      v_cnt := 0;
      DELETE FROM public.notifications WHERE title = 'Data jobs' AND user_id IN (SELECT id FROM public.profiles WHERE role = 'admin');
      PERFORM public.data_jobs_watchdog(timestamptz '2030-01-07 06:59+00');
      PERFORM public.data_jobs_watchdog(timestamptz '2030-01-07 07:30+00');
      PERFORM public.data_jobs_watchdog(timestamptz '2030-01-07 08:14+00');
      PERFORM public.data_jobs_watchdog(timestamptz '2030-01-08 07:14+00');
      PERFORM public.data_jobs_watchdog(timestamptz '2030-01-06 07:14+00');
      SELECT count(*) INTO v_cnt FROM public.notifications n, regexp_split_to_table(n.body, E'\n') l WHERE n.user_id = v_admin AND n.title = 'Data jobs' AND l LIKE 'probe-wd-sw%';
      v_res := v_res || ('weekly_outside_slot=' || v_cnt);
      PERFORM public.data_jobs_watchdog(timestamptz '2030-01-07 07:00+00');
      SELECT count(*) INTO v_cnt FROM public.notifications n, regexp_split_to_table(n.body, E'\n') l WHERE n.user_id = v_admin AND n.title = 'Data jobs' AND l LIKE 'probe-wd-sw%';
      v_res := v_res || ('weekly_0900=' || v_cnt);
      UPDATE public.data_jobs_alert_state SET reminded_at = NULL WHERE job_key = 'probe-wd-sw';
      PERFORM public.data_jobs_watchdog(timestamptz '2030-01-07 07:29+00');
      SELECT count(*) INTO v_cnt FROM public.notifications n, regexp_split_to_table(n.body, E'\n') l WHERE n.user_id = v_admin AND n.title = 'Data jobs' AND l LIKE 'probe-wd-sw%' AND l LIKE '%still paused%';
      v_res := v_res || ('weekly_0900_plus_0929_total=' || v_cnt);

      -- 7. resumed
      PERFORM public.data_jobs_watchdog(now());
      DELETE FROM public.notifications WHERE title = 'Data jobs' AND user_id IN (SELECT id FROM public.profiles WHERE role = 'admin');
      UPDATE public.data_jobs SET paused = false, paused_note = NULL, paused_by = NULL, paused_at = NULL WHERE key = 'probe-wd-sw';
      PERFORM public.data_jobs_watchdog(now());
      SELECT coalesce(string_agg(l, ' | ' ORDER BY l), '-') INTO v_r FROM public.notifications n, regexp_split_to_table(n.body, E'\n') l
       WHERE n.user_id = v_admin AND n.title = 'Data jobs' AND l LIKE 'probe-wd-sw%';
      v_res := v_res || ('resumed=' || v_r);

      -- 8. body cap: many lines are cut with "…+N"
      DELETE FROM public.notifications WHERE title = 'Data jobs' AND user_id IN (SELECT id FROM public.profiles WHERE role = 'admin');
      INSERT INTO public.data_jobs (key, runner, kind, expected_every, records_expected_from, sort)
        SELECT 'probe-wd-many-' || lpad(g::text, 2, '0'), 'github', 'health', interval '1 hour', now() - interval '5 days', 9992 FROM generate_series(1, 30) g;
      PERFORM public.data_jobs_watchdog(now());
      SELECT (char_length(body) <= 330 AND body ~ E'\n…\\+[0-9]+$')::text INTO v_r FROM public.notifications WHERE user_id = v_admin AND title = 'Data jobs';
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
      'entered=probe-wd-gh: stale', 'notices_equal_admins=true', 'notices_to_non_admins=0', 'push_log_to_non_admins=0', 'push_iff_token=true',
      'second_tick_probe_lines=0', 'realert_23h=0', 'realert_25h=probe-wd-gh: still stale', 'recovered=probe-wd-gh: recovered',
      'paused=probe-wd-sw: paused (maintenance)',
      'weekly_in_slot=probe-wd-sw: still paused (01.01, maintenance)', 'weekly_again_same_slot=0', 'weekly_5_days=0', 'weekly_7_days=1',
      'weekly_outside_slot=0', 'weekly_0900=1', 'weekly_0900_plus_0929_total=2',
      'resumed=probe-wd-sw: resumed', 'body_capped=true',
      'anon_state=denied', 'admin_state=denied', 'admin_age=denied', 'service_state=denied', 'age_service_role_call=ok',
      'anon_watchdog=denied', 'auth_watchdog=denied', 'service_watchdog=denied'];
    IF v_res IS DISTINCT FROM v_expect THEN
      RAISE EXCEPTION 'watchdog probe results differ. got: % | expected: %', v_res, v_expect;
    END IF;
    RAISE NOTICE 'watchdog probes (% checks): %', cardinality(v_res), v_res;
    RAISE NOTICE 'data_jobs_watchdog_age() before the first cron run: % (NULL is right)', coalesce(v_age::text, 'NULL');

    IF EXISTS (SELECT 1 FROM public.data_jobs WHERE key LIKE 'probe-wd-%')
       OR EXISTS (SELECT 1 FROM public.data_jobs_alert_state WHERE job_key LIKE 'probe-wd-%')
       OR (SELECT coalesce(string_agg(key, ',' ORDER BY key), '') FROM public.data_jobs WHERE paused) IS DISTINCT FROM v_paused_keys
       OR (SELECT count(*) FROM public.notifications WHERE title = 'Data jobs') IS DISTINCT FROM v_notif_before
       OR (SELECT count(*) FROM public.push_log WHERE kind = 'data_jobs_alert') IS DISTINCT FROM v_log_before
       OR (SELECT md5(coalesce(string_agg(row(job_key, last_attention, last_paused, alerted_at, reminded_at)::text, '|' ORDER BY job_key), '')) FROM public.data_jobs_alert_state) IS DISTINCT FROM v_state_before THEN
      RAISE EXCEPTION 'probe rows leaked';
    END IF;
  END;
  RAISE NOTICE '20261218 OK: admin alerts in English (watchdog owner-only, photo reminder service_role-only), logic shapes unchanged, no Turkish left';
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
VALUES ('20261218_admin_alerts_english.sql', '5c8f85f2815a1e0f0fee75f513798954eee27dd39484d2e85f1e5a0cb3c5c70d')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;
