-- ═══════════════════════════════════════════════════════════════════════════
-- 20261241 — Döveç health watchdog: a database-side check every 15 minutes that tells the admins
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHY
-- The Döveç health check lives in a GitHub workflow (.github/workflows/dovec-health.yml, scripts/check-dovec-health.mjs). It is
-- scheduled hourly but GitHub runs it every 8-9 hours, and its failure e-mail reaches nobody. Both stay UNCHANGED as a backup.
-- This file adds the same five checks inside the database, on pg_cron, and sends the admins an in-app notice plus an Expo
-- push (the 20261211 data_jobs_watchdog pattern).
--
-- WHAT IT DOES, IN PLAIN ENGLISH
--   1. dovec_leads.status_changed_at (new column) + trigger dovec_leads_stamp_status. dovec_leads had NO time of "when did the
--      status change": sent_at is set on send only, created_at is the insert time, next_attempt_at is a retry clock, and two
--      UPDATEs (dovec_leads_wipe_pii settles a 7-day-old retry/pending to 'failed'; dovec_leads_forget_user sets 'failed' on
--      account deletion) change status without stamping any time. "Failed or rejected in the last 24 hours" therefore cannot
--      be read from created_at (the script's approximation: an enquiry that settles to 'failed' after 7 days is 7 days old
--      and is missed). The trigger (BEFORE INSERT OR UPDATE OF status, FOR EACH ROW, touches only NEW) sets
--      status_changed_at := now() on insert and, on update, only when the status really changes (IS DISTINCT FROM).
--      BACKFILL: every existing row gets status_changed_at = created_at. The true time of an old status change is not
--      knowable, so historical rows read as "changed when created" and never raise an alert; only a status change made after
--      this apply is stamped truthfully.
--   2. public.dovec_health_watchdog(p_now): reads dovec_settings (id = 1) and dovec_leads (is_test = false only) and checks
--      the same five conditions as the script:
--        suspended    dovec_settings.suspended
--        last_status  last_run_status IS DISTINCT FROM 'ok'
--        stale        last_good_sync_at IS NULL or older than 30 minutes
--        stuck        a lead in ('retry','pending') with created_at older than 1 hour
--        failed       a lead in ('rejected','failed') whose status_changed_at is newer than 24 hours
--      NOT ARMED while last_run_at IS NULL (the sync has never run): returns 0, writes nothing. `published` is not itself a
--      condition: with published = false and nothing wrong it stays silent. A NEW failure while 'failed' is already red (a
--      status_changed_at newer than the one last announced) produces a fresh line.
--      MISSING dovec_settings ROW: the function RAISES. The row cannot be deleted by any app role (service_role has no DELETE;
--      CHECK id = 1), so a missing row is a broken database, not a Döveç problem. The raise makes the pg_cron run fail, the
--      data_jobs registry row below turns 'failed', and the existing data-jobs watchdog announces it to the admins through its
--      own channel (change-only, daily nag). Quiet would hide it; a push line here would need a sixth condition.
--   3. Alerts (admins only, profiles.role = 'admin'): one notifications row per admin, type 'admin_alert', title 'Döveç', ONE
--      combined notice per tick; an Expo push with data {"screen":"admin","tab":"datajobs"}; one push_log row per admin, kind
--      'dovec_health_alert', request_id NULL when the admin has no push token. Only when something CHANGED: a condition turns
--      red (its line), stays red for more than 24 hours since last announced (the same line + " (hâlâ)"), or recovers
--      ("Döveç: düzeldi (...)"). Nothing changed = nothing sent. No admin at all = nothing written, state included, so the next
--      tick tells the first admin that exists. Only booleans, times and one fixed status word are read into the text: never an
--      id, a count, a name or a phone number. The lines (Turkish, as specified by Berke 2026-11-28):
--        suspended  Döveç: talepler iletilemiyor (anahtar reddedildi)
--        last_status  Döveç: son eşitleme hatalı (<last_run_status>)   [the value is one of the fixed words of
--                       dovec_settings_status_check, asserted below to be [a-z0-9_]+ only]
--        stale      Döveç: 30 dakikadır başarılı eşitleme yok
--        stuck      Döveç: bir talep 1 saattir gönderilemiyor
--        failed     Döveç: bir talep reddedildi ya da gönderilemedi
--        repeat     the same line + " (hâlâ)"
--        recovery   Döveç: düzeldi (anahtar) / (eşitleme durumu) / (eşitleme) / (bekleyen talep) / (reddedilen talep)
--      NOTE: 20261218 made the two OLDER admin alerts English ("the admin area is English only"). The lines above are the ones
--      Berke approved for this file; changing them to English later is a text-only CREATE OR REPLACE.
--   4. pg_cron job 'dovec-health-check', '9,24,39,54 * * * *' (every 15 minutes; the minutes are free of every other active
--      job, asserted below against the live cron.job, :00 kept free), command SELECT public.dovec_health_watchdog();, plus its
--      data_jobs row ('dovec-health-check', cron_sql, health, expected every 1 hour, sort 61). The registry row's grace
--      (20261210 records_expected_from = the apply time) keeps the data-jobs watchdog quiet until one hour after the apply.
--
-- WHERE "WHAT WAS ANNOUNCED LAST" LIVES: public.dovec_health_alert_state, one row per condition key: last_red, alerted_at
-- (when its current red episode was last announced) and last_failure_at (the newest failure time already announced). A row is
-- written only when something changed, so a healthy system keeps the table empty.
--
-- WHO CAN READ / WRITE WHAT
--   dovec_leads.status_changed_at: a plain column of dovec_leads, which keeps RLS on, ZERO policies, no privilege of any kind
--     for anon / authenticated (table or column), service_role SELECT / INSERT / UPDATE and no DELETE (asserted again). The
--     edge function (service_role) never sets the column; the trigger does.
--   dovec_leads_stamp_status(): a trigger function, SECURITY INVOKER (it only assigns NEW.status_changed_at), search_path
--     public; EXECUTE revoked from PUBLIC, anon, authenticated AND service_role (a trigger needs no EXECUTE at fire time; the
--     probes below prove an insert and a status update by service_role still work).
--   dovec_health_alert_state: RLS ON, ZERO policies, every privilege revoked from PUBLIC, anon, authenticated AND service_role.
--     Owner postgres only. It holds condition names and times, no user data.
--   dovec_health_watchdog(p_now): EXECUTE for the OWNER ONLY (revoked from PUBLIC, anon, authenticated, service_role). SECURITY
--     DEFINER, search_path public. Only the pg_cron job (runs as postgres) calls it. p_now only moves the clock; no argument
--     chooses who is told or what is said.
--   notifications: one row per admin, type 'admin_alert', readable only by that admin through the unchanged "users read own
--     notifications" policy. Customers, providers and guests are never notified. push_log: no CHECK on kind (asserted).
--   NOTIFICATION WRITERS: this is a new function that inserts into notifications, so verify_schema.sql's
--     1066_notification_type writer count goes from 8 to 9 in the same PR, with the reason in its comment.
--
-- THE SELF-TEST inside this transaction (every probe row rolled back via ZZ_PROBE_ROLLBACK; what it captured is compared before
-- and after): each of the five conditions broken on purpose gives its exact line (admins only, push iff a token), a healthy
-- system and published = false stay quiet, not-armed stays quiet, change-only, the 24 h repeat (23 h silent, 25 h "(hâlâ)"),
-- recovery then silence, the 7-day settle (an 8-day-old 'retry' enquiry settled by dovec_leads_wipe_pii alerts as failed, which a
-- created_at-based check would have missed), a test enquiry ignored, a second failure while red, the trigger's stamping rules, and
-- the denials with the owner's calls as the positive control.
--
-- Public logs: no user totals and no ids are printed; job names and fixed status words are fine.
-- Apply: supabase-migrate. Adds one column, one table, two functions, one trigger and one cron job; ends with NOTIFY pgrst.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── 0. Pre-flight ──────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.dovec_settings') IS NULL OR to_regclass('public.dovec_leads') IS NULL
     OR to_regprocedure('public.dovec_leads_wipe_pii()') IS NULL OR to_regprocedure('public.dovec_leads_forget_user()') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: 20261229 (Döveç projects) is not applied. Nothing applied.';
  END IF;
  IF to_regclass('public.data_jobs') IS NULL OR to_regclass('public.data_jobs_alert_state') IS NULL
     OR to_regprocedure('public.data_jobs_overview(timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: the data_jobs registry / watchdog (20261205, 20261211) is not applied. Nothing applied.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.data_jobs') AND attname = 'records_expected_from' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'REFUSING: 20261210 (data_jobs.records_expected_from) is not applied. Nothing applied.';
  END IF;
  IF to_regclass('public.push_log') IS NULL OR to_regclass('public.notifications') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: push_log / notifications are missing. Nothing applied.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.push_log'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) ILIKE '%kind%') THEN
    RAISE EXCEPTION 'REFUSING: push_log has a CHECK on kind; dovec_health_alert would be refused. Nothing applied.';
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
  IF to_regprocedure('public.dovec_leads_enforce_limits()') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: dovec_leads_enforce_limits is missing. Nothing applied.';
  END IF;
END $$;

-- ─── 1. dovec_leads.status_changed_at: set by a trigger, backfilled once ────
-- Three plain statements, each safe to run twice: the backfill only fills NULLs, so a re-run never overwrites a real stamp.
ALTER TABLE public.dovec_leads ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;
UPDATE public.dovec_leads SET status_changed_at = created_at WHERE status_changed_at IS NULL;
ALTER TABLE public.dovec_leads ALTER COLUMN status_changed_at SET DEFAULT now();
ALTER TABLE public.dovec_leads ALTER COLUMN status_changed_at SET NOT NULL;
COMMENT ON COLUMN public.dovec_leads.status_changed_at IS
  'When the status last changed, set by the dovec_leads_stamp_status trigger (insert time on insert; on update only when status IS DISTINCT FROM the old one). Rows that existed at 20261241 carry created_at (the true time was not recorded). Read by dovec_health_watchdog(). 20261241.';

CREATE OR REPLACE FUNCTION public.dovec_leads_stamp_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status_changed_at := now();
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.dovec_leads_stamp_status() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS dovec_leads_stamp_status ON public.dovec_leads;
CREATE TRIGGER dovec_leads_stamp_status BEFORE INSERT OR UPDATE OF status ON public.dovec_leads
  FOR EACH ROW EXECUTE FUNCTION public.dovec_leads_stamp_status();

-- ─── 2. State: what was announced last time ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dovec_health_alert_state (
  condition       text        NOT NULL,
  last_red        boolean     NOT NULL,
  alerted_at      timestamptz,
  last_failure_at timestamptz,
  CONSTRAINT dovec_health_alert_state_pkey PRIMARY KEY (condition),
  CONSTRAINT dovec_health_alert_state_condition_check CHECK (condition = ANY (ARRAY['suspended','last_status','stale','stuck','failed']::text[]))
);
COMMENT ON TABLE public.dovec_health_alert_state IS
  'What dovec_health_watchdog() announced last time, per condition (red or not, when last announced, newest failure time announced). RLS on, zero policies, no grants: only the owner and the watchdog touch it. 20261241.';
ALTER TABLE public.dovec_health_alert_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dovec_health_alert_state FROM PUBLIC, anon, authenticated, service_role;

-- ─── 3. The watchdog ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dovec_health_watchdog(p_now timestamptz DEFAULT now())
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s           public.dovec_settings;
  st          public.dovec_health_alert_state;
  v_keys      text[] := ARRAY['suspended', 'last_status', 'stale', 'stuck', 'failed'];
  v_i         int;
  v_key       text;
  v_red       boolean;
  v_base      text;
  v_done      text;
  v_known     boolean;
  v_last_red  boolean;
  v_alerted   timestamptz;
  v_lf        timestamptz;
  v_na        timestamptz;
  v_nlf       timestamptz;
  v_failed_at timestamptz;
  v_lines     text[] := ARRAY[]::text[];
  v_changes   jsonb := '[]'::jsonb;
  v_has_admin boolean;
  r           record;
  ttl         text := 'Döveç';
  bdy         text := '';
  req         bigint;
  n           integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('dovec_health_watchdog'));

  SELECT * INTO s FROM public.dovec_settings WHERE id = 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dovec_settings has no row (id = 1)';
  END IF;
  IF s.last_run_at IS NULL THEN
    RETURN 0;
  END IF;

  SELECT max(l.status_changed_at) INTO v_failed_at
    FROM public.dovec_leads l
   WHERE NOT l.is_test AND l.status = ANY (ARRAY['rejected', 'failed']::text[])
     AND l.status_changed_at > p_now - interval '24 hours';

  FOR v_i IN 1 .. 5 LOOP
    v_key := v_keys[v_i];
    v_red := CASE v_key
      WHEN 'suspended'   THEN s.suspended
      WHEN 'last_status' THEN s.last_run_status IS DISTINCT FROM 'ok'
      WHEN 'stale'       THEN s.last_good_sync_at IS NULL OR s.last_good_sync_at < p_now - interval '30 minutes'
      WHEN 'stuck'       THEN EXISTS (SELECT 1 FROM public.dovec_leads l
                                       WHERE NOT l.is_test AND l.status = ANY (ARRAY['retry', 'pending']::text[])
                                         AND l.created_at < p_now - interval '1 hour')
      WHEN 'failed'      THEN v_failed_at IS NOT NULL
    END;
    v_base := CASE v_key
      WHEN 'suspended'   THEN 'Döveç: talepler iletilemiyor (anahtar reddedildi)'
      WHEN 'last_status' THEN 'Döveç: son eşitleme hatalı (' || coalesce(s.last_run_status, '?') || ')'
      WHEN 'stale'       THEN 'Döveç: 30 dakikadır başarılı eşitleme yok'
      WHEN 'stuck'       THEN 'Döveç: bir talep 1 saattir gönderilemiyor'
      WHEN 'failed'      THEN 'Döveç: bir talep reddedildi ya da gönderilemedi'
    END;
    v_done := CASE v_key
      WHEN 'suspended'   THEN 'Döveç: düzeldi (anahtar)'
      WHEN 'last_status' THEN 'Döveç: düzeldi (eşitleme durumu)'
      WHEN 'stale'       THEN 'Döveç: düzeldi (eşitleme)'
      WHEN 'stuck'       THEN 'Döveç: düzeldi (bekleyen talep)'
      WHEN 'failed'      THEN 'Döveç: düzeldi (reddedilen talep)'
    END;

    SELECT * INTO st FROM public.dovec_health_alert_state WHERE condition = v_key;
    v_known    := FOUND;
    v_last_red := CASE WHEN v_known THEN st.last_red ELSE false END;
    v_alerted  := CASE WHEN v_known THEN st.alerted_at END;
    v_lf       := CASE WHEN v_known THEN st.last_failure_at END;
    v_na := v_alerted;
    v_nlf := v_lf;

    IF v_red AND NOT v_last_red THEN
      v_lines := v_lines || v_base;
      v_na := p_now;
      IF v_key = 'failed' THEN v_nlf := v_failed_at; END IF;
    ELSIF v_red AND v_key = 'failed' AND v_failed_at > coalesce(v_lf, '-infinity'::timestamptz) THEN
      v_lines := v_lines || v_base;
      v_na := p_now;
      v_nlf := v_failed_at;
    ELSIF v_red AND (v_alerted IS NULL OR v_alerted < p_now - interval '24 hours') THEN
      v_lines := v_lines || (v_base || ' (hâlâ)');
      v_na := p_now;
    ELSIF NOT v_red AND v_last_red THEN
      v_lines := v_lines || v_done;
      v_na := NULL;
      v_nlf := NULL;
    END IF;

    IF v_red IS DISTINCT FROM v_last_red OR v_na IS DISTINCT FROM v_alerted OR v_nlf IS DISTINCT FROM v_lf THEN
      v_changes := v_changes || jsonb_build_array(jsonb_build_object('k', v_key, 'r', v_red, 'al', v_na, 'lf', v_nlf));
    END IF;
  END LOOP;

  IF cardinality(v_lines) > 0 THEN
    SELECT EXISTS (SELECT 1 FROM profiles WHERE role = 'admin') INTO v_has_admin;
    IF NOT v_has_admin THEN
      RETURN 0;
    END IF;
  END IF;

  IF jsonb_array_length(v_changes) > 0 THEN
    INSERT INTO public.dovec_health_alert_state (condition, last_red, alerted_at, last_failure_at)
    SELECT c.k, c.r, c.al, c.lf
      FROM jsonb_to_recordset(v_changes) AS c(k text, r boolean, al timestamptz, lf timestamptz)
    ON CONFLICT (condition) DO UPDATE
      SET last_red = excluded.last_red, alerted_at = excluded.alerted_at, last_failure_at = excluded.last_failure_at;
  END IF;

  IF cardinality(v_lines) = 0 THEN
    RETURN 0;
  END IF;

  bdy := array_to_string(v_lines, E'\n');

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
    INSERT INTO push_log (user_id, kind, request_id) VALUES (r.id, 'dovec_health_alert', req);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION public.dovec_health_watchdog(timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- ─── 4. The registry row and the cron job ───────────────────────────────────
INSERT INTO public.data_jobs (key, runner, kind, cron_jobnames, schedule_note, expected_every, sort) VALUES
  ('dovec-health-check', 'cron_sql', 'health', ARRAY['dovec-health-check'], NULL, interval '1 hour', 61)
ON CONFLICT (key) DO NOTHING;

SELECT cron.unschedule('dovec-health-check') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dovec-health-check');
SELECT cron.schedule('dovec-health-check', '9,24,39,54 * * * *', 'SELECT public.dovec_health_watchdog();');

-- ─── Assertions + probes (inside the transaction; a failure rolls the file back) ─
DO $$
DECLARE
  v_names  text;
  v_n      int;
  v_fn     text;
  v_role   text;
  v_priv   text;
  v_oid    regclass;
  v_admin  uuid;
  v_cust   uuid;
  v_adm_n  int;
  v_def    text;
BEGIN
  -- the new column: timestamptz, NOT NULL, DEFAULT now(), never NULL; the app roles still hold nothing on dovec_leads
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.dovec_leads') AND a.attname = 'status_changed_at' AND NOT a.attisdropped
                  AND a.atttypid = 'timestamptz'::regtype AND a.attnotnull) THEN
    RAISE EXCEPTION 'dovec_leads.status_changed_at is missing, not timestamptz or nullable';
  END IF;
  IF (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
       WHERE d.adrelid = to_regclass('public.dovec_leads') AND a.attname = 'status_changed_at') IS DISTINCT FROM 'now()' THEN
    RAISE EXCEPTION 'dovec_leads.status_changed_at has no DEFAULT now()';
  END IF;
  IF EXISTS (SELECT 1 FROM public.dovec_leads WHERE status_changed_at IS NULL OR status_changed_at < created_at) THEN
    RAISE EXCEPTION 'a dovec_leads row has no status_changed_at, or one earlier than created_at';
  END IF;
  v_oid := to_regclass('public.dovec_leads');
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_table_privilege(v_role, v_oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = v_oid AND a.attnum > 0 AND NOT a.attisdropped
                   AND has_column_privilege(v_role, v_oid, a.attnum, 'SELECT,INSERT,UPDATE,REFERENCES')) THEN
      RAISE EXCEPTION '% holds a privilege on dovec_leads (table or column)', v_role;
    END IF;
  END LOOP;
  FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE'] LOOP
    IF NOT has_table_privilege('service_role', v_oid, v_priv) THEN RAISE EXCEPTION 'service_role lost % on dovec_leads', v_priv; END IF;
  END LOOP;
  IF has_table_privilege('service_role', v_oid, 'DELETE') THEN RAISE EXCEPTION 'service_role can DELETE leads: unexpected'; END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'dovec_leads') IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'dovec_leads must carry ZERO policies';
  END IF;

  -- the trigger: exactly one stamp trigger, BEFORE INSERT OR UPDATE OF status, row level; the other dovec_leads triggers untouched
  SELECT pg_get_triggerdef(t.oid) INTO v_def FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgrelid = v_oid AND t.tgname = 'dovec_leads_stamp_status';
  RAISE NOTICE 'dovec_leads_stamp_status: %', coalesce(v_def, '(missing)');
  IF v_def IS NULL OR v_def NOT LIKE 'CREATE TRIGGER dovec_leads_stamp_status BEFORE INSERT OR UPDATE OF status ON public.dovec_leads FOR EACH ROW EXECUTE FUNCTION%dovec_leads_stamp_status()%' THEN
    RAISE EXCEPTION 'dovec_leads_stamp_status trigger has the wrong shape: %', v_def;
  END IF;
  SELECT string_agg(t.tgname, ', ' ORDER BY t.tgname) INTO v_names FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgrelid = v_oid;
  RAISE NOTICE 'dovec_leads triggers: %', v_names;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgrelid = v_oid AND t.tgname = 'dovec_leads_rate_limit') THEN
    RAISE EXCEPTION 'dovec_leads_rate_limit trigger is gone';
  END IF;

  -- the state table: owner, RLS, ZERO policies, no client / service privilege
  IF (SELECT relowner::regrole::text FROM pg_class WHERE oid = to_regclass('public.dovec_health_alert_state')) IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'dovec_health_alert_state is not owned by postgres';
  END IF;
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.dovec_health_alert_state')) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'RLS is not enabled on dovec_health_alert_state';
  END IF;
  SELECT count(*), coalesce(string_agg(policyname || ':' || cmd, ', '), '(none)') INTO v_n, v_names
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'dovec_health_alert_state';
  IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'dovec_health_alert_state must carry ZERO policies; found %: %', v_n, v_names; END IF;
  RAISE NOTICE 'dovec_health_alert_state policies: % (%)', v_n, v_names;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_table_privilege(v_role, 'public.dovec_health_alert_state', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION '% holds a privilege on dovec_health_alert_state', v_role;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.dovec_health_alert_state') AND a.attnum > 0 AND NOT a.attisdropped
                AND (has_column_privilege(v_role, a.attrelid, a.attname, 'SELECT') OR has_column_privilege(v_role, a.attrelid, a.attname, 'INSERT')
                     OR has_column_privilege(v_role, a.attrelid, a.attname, 'UPDATE'))) THEN
      RAISE EXCEPTION '% holds a column privilege on dovec_health_alert_state', v_role;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = to_regclass('public.dovec_health_alert_state') AND a.grantee = 0) THEN
    RAISE EXCEPTION 'dovec_health_alert_state is granted to PUBLIC';
  END IF;

  -- the functions: owner, EXECUTE sets from the ACL. The watchdog is DEFINER; the trigger function is INVOKER and stays so.
  FOREACH v_fn IN ARRAY ARRAY['public.dovec_health_watchdog(timestamptz)', 'public.dovec_leads_stamp_status()'] LOOP
    IF to_regprocedure(v_fn) IS NULL THEN RAISE EXCEPTION '% is missing', v_fn; END IF;
    IF (SELECT pg_get_userbyid(p.proowner) FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION '% is not owned by postgres', v_fn;
    END IF;
    IF (SELECT p.proacl IS NULL FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) THEN
      RAISE EXCEPTION '% carries the default ACL (NULL), which grants PUBLIC', v_fn;
    END IF;
    IF (SELECT p.proconfig IS DISTINCT FROM ARRAY['search_path=public'] FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) THEN
      RAISE EXCEPTION '% has no pinned search_path', v_fn;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) a
                WHERE p.oid = to_regprocedure(v_fn) AND a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner) THEN
      RAISE EXCEPTION '% is EXECUTE-able by a role other than its owner', v_fn;
    END IF;
    RAISE NOTICE '% EXECUTE held by: %', v_fn,
      (SELECT coalesce(string_agg(DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ', ' ORDER BY CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END), '(none)')
         FROM pg_proc p, LATERAL aclexplode(p.proacl) a WHERE p.oid = to_regprocedure(v_fn) AND a.privilege_type = 'EXECUTE');
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF has_function_privilege(v_role, v_fn, 'EXECUTE') THEN RAISE EXCEPTION '% can execute %', v_role, v_fn; END IF;
    END LOOP;
  END LOOP;
  IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure('public.dovec_health_watchdog(timestamptz)')) THEN
    RAISE EXCEPTION 'dovec_health_watchdog is not SECURITY DEFINER';
  END IF;
  IF (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure('public.dovec_leads_stamp_status()')) THEN
    RAISE EXCEPTION 'dovec_leads_stamp_status must stay SECURITY INVOKER (it only assigns NEW)';
  END IF;

  -- the status word in the "son eşitleme hatalı (...)" line: every allowed value of the CHECK is a fixed [a-z0-9_]+ word
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint WHERE conrelid = 'public.dovec_settings'::regclass AND conname = 'dovec_settings_status_check';
  IF v_def IS NULL THEN RAISE EXCEPTION 'dovec_settings_status_check is missing'; END IF;
  SELECT count(*), string_agg(m[1], ', ' ORDER BY m[1]) INTO v_n, v_names FROM regexp_matches(v_def, '''([^'']*)''', 'g') m;
  RAISE NOTICE 'dovec_settings_status_check allows % fixed words: %', v_n, v_names;
  IF v_n < 2 OR EXISTS (SELECT 1 FROM regexp_matches(v_def, '''([^'']*)''', 'g') m WHERE m[1] !~ '^[a-z0-9_]+$') THEN
    RAISE EXCEPTION 'dovec_settings_status_check allows a value that is not a fixed [a-z0-9_]+ word: %', v_def;
  END IF;

  -- the log kind: push_log has no CHECK on kind (so 'dovec_health_alert' needs no change)
  SELECT count(*) INTO v_n FROM pg_constraint WHERE conrelid = 'public.push_log'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%kind%';
  IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'push_log carries % CHECK constraint(s) on kind', v_n; END IF;

  -- the job: exactly one, the exact command, minutes no other ACTIVE job fires at. A minute field is expanded properly
  -- (lists, ranges, steps, '*'), not matched as text; an item this expansion cannot read refuses the file.
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'dovec-health-check') IS DISTINCT FROM 1
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dovec-health-check' AND schedule = '9,24,39,54 * * * *' AND active
                     AND btrim(command) = 'SELECT public.dovec_health_watchdog();') THEN
    RAISE EXCEPTION 'dovec-health-check is not scheduled exactly once with the exact schedule and command';
  END IF;
  SELECT string_agg(DISTINCT j.jobname || ' (' || j.schedule || ')', ', ') INTO v_names
    FROM cron.job j
   WHERE j.jobname <> 'dovec-health-check' AND j.active
     AND (j.schedule ~* 'second'
          OR EXISTS (
            SELECT 1
              FROM unnest(string_to_array(split_part(j.schedule, ' ', 1), ',')) it,
                   LATERAL generate_series(
                     CASE WHEN it ~ '^\*' THEN 0 ELSE substring(it from '^([0-9]+)')::int END,
                     CASE WHEN it ~ '^\*' THEN 59 WHEN it ~ '^[0-9]+-[0-9]+' THEN substring(it from '^[0-9]+-([0-9]+)')::int
                          WHEN it ~ '/' THEN 59 ELSE substring(it from '^([0-9]+)')::int END,
                     CASE WHEN it ~ '/[0-9]+$' THEN substring(it from '/([0-9]+)$')::int ELSE 1 END) m
             WHERE m IN (9, 24, 39, 54)));
  IF v_names IS NOT NULL THEN RAISE EXCEPTION 'another active cron job fires at the dovec health check''s minutes (9, 24, 39, 54): %', v_names; END IF;
  SELECT string_agg(j.jobname || ' (' || j.schedule || ')', ', ' ORDER BY j.jobname) INTO v_names
    FROM cron.job j WHERE j.active AND j.schedule !~ '^(\*|[0-9]+(-[0-9]+)?)(/[0-9]+)?(,(\*|[0-9]+(-[0-9]+)?)(/[0-9]+)?)* ' AND j.schedule !~* 'second';
  IF v_names IS NOT NULL THEN RAISE EXCEPTION 'an active cron job has a minute field this check cannot read: %', v_names; END IF;
  RAISE NOTICE 'active cron jobs checked for minute collisions: %', (SELECT count(*) FROM cron.job WHERE active AND jobname <> 'dovec-health-check');

  -- coverage (20261205's rule, repeated): every cron job has exactly one registry row, every listed name exists
  SELECT string_agg(j.jobname, ', ' ORDER BY j.jobname) INTO v_names
    FROM cron.job j WHERE (SELECT count(*) FROM public.data_jobs d WHERE j.jobname = ANY (d.cron_jobnames)) IS DISTINCT FROM 1;
  IF v_names IS NOT NULL THEN RAISE EXCEPTION 'cron jobs not covered by exactly one data_jobs row: %', v_names; END IF;
  SELECT string_agg(DISTINCT n, ', ' ORDER BY n) INTO v_names
    FROM public.data_jobs d, unnest(d.cron_jobnames) AS n WHERE NOT EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = n);
  IF v_names IS NOT NULL THEN RAISE EXCEPTION 'data_jobs lists cron jobs that do not exist: %', v_names; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.data_jobs WHERE key = 'dovec-health-check' AND runner = 'cron_sql' AND kind = 'health'
                  AND cron_jobnames = ARRAY['dovec-health-check'] AND expected_every = interval '1 hour' AND NOT switchable AND NOT paused
                  AND records_expected_from <= now()) THEN
    RAISE EXCEPTION 'the dovec health registry row is wrong';
  END IF;
  IF (SELECT e->>'state' FROM jsonb_array_elements(public.data_jobs_overview(now())) e WHERE e->>'key' = 'dovec-health-check') IS DISTINCT FROM 'no_record' THEN
    RAISE EXCEPTION 'the new registry row must read no_record (inside its grace) at the apply, not stale or failed';
  END IF;

  SELECT id INTO v_admin FROM public.profiles WHERE role = 'admin' ORDER BY id LIMIT 1;
  SELECT id INTO v_cust FROM public.profiles WHERE role IS DISTINCT FROM 'admin' ORDER BY id LIMIT 1;
  SELECT count(*) INTO v_adm_n FROM public.profiles WHERE role = 'admin';
  IF v_admin IS NULL OR v_cust IS NULL THEN RAISE EXCEPTION 'need one admin and one non-admin profile to run the positive controls with'; END IF;

  -- behaviour probes, ALL rolled back (ZZ_PROBE_ROLLBACK). Nothing below changes a real row for good.
  DECLARE
    v_res     text[] := ARRAY[]::text[];
    v_r       text;
    v_r2      text;
    v_expect  text[];
    v_cnt     int;
    v_cnt2    int;
    v_ok      boolean;
    v_id      bigint;
    v_id2     bigint;
    v_sr_call text;
    v_anon_call text;
    v_auth_call text;
    v_q       text := $q$SELECT coalesce(string_agg(l, ' | ' ORDER BY l), '-') FROM public.notifications n, regexp_split_to_table(n.body, E'\n') l WHERE n.user_id = $1 AND n.title = 'Döveç'$q$;
    v_clr     text := $q$DELETE FROM public.notifications WHERE title = 'Döveç' AND user_id IN (SELECT id FROM public.profiles WHERE role = 'admin')$q$;
    v_lead    text := $q$INSERT INTO public.dovec_leads (client_request_id, payload_hash, project_id, name, phone, language, language_code, consent, consent_text_version, status, created_at)
                         VALUES (gen_random_uuid(), repeat('d', 64), 'zz-probe-dv', 'Probe Person', '+441234567890', 'English', 'en', true, 'v', $1, $2) RETURNING id$q$;
    -- what exists before the probes: restored by the rollback, compared at the end
    v_set_before text := (SELECT row(published, suspended, last_good_sync_at, last_run_at, last_run_status, last_run_detail)::text FROM public.dovec_settings WHERE id = 1);
    v_notes_before int := (SELECT count(*) FROM public.notifications WHERE title = 'Döveç');
    v_plog_before int := (SELECT count(*) FROM public.push_log WHERE kind = 'dovec_health_alert');
    v_state_before int := (SELECT count(*) FROM public.dovec_health_alert_state);
    v_leads_before text := (SELECT md5(coalesce(string_agg(l::text, '|' ORDER BY l.id), '')) FROM public.dovec_leads l);
  BEGIN
    BEGIN
      -- isolate from the live data: whatever is there comes back with the rollback
      DELETE FROM public.dovec_leads;
      DELETE FROM public.dovec_health_alert_state;
      EXECUTE v_clr;
      DELETE FROM public.push_log WHERE kind = 'dovec_health_alert';
      INSERT INTO public.dovec_projects (id, name, city, status, website_url) VALUES ('zz-probe-dv', 'Probe Project', 'Probeville', 'on_sale', 'https://example.com/p');

      -- 1. a healthy system is quiet, published or not (published is not a condition)
      UPDATE public.dovec_settings SET published = false, suspended = false, last_run_at = now(), last_run_status = 'ok', last_good_sync_at = now() WHERE id = 1;
      PERFORM public.dovec_health_watchdog(now());
      SELECT count(*) INTO v_cnt FROM public.notifications WHERE title = 'Döveç';
      SELECT count(*) INTO v_cnt2 FROM public.dovec_health_alert_state;
      v_res := v_res || ('healthy_unpublished=' || v_cnt || '/' || v_cnt2);
      UPDATE public.dovec_settings SET published = true WHERE id = 1;
      PERFORM public.dovec_health_watchdog(now());
      SELECT count(*) INTO v_cnt FROM public.notifications WHERE title = 'Döveç';
      v_res := v_res || ('healthy_published=' || v_cnt);
      UPDATE public.dovec_settings SET published = false WHERE id = 1;

      -- 2. not armed (the sync has never run): nothing, even with conditions red
      UPDATE public.dovec_settings SET last_run_at = NULL, suspended = true, last_run_status = 'http_401', last_good_sync_at = NULL WHERE id = 1;
      PERFORM public.dovec_health_watchdog(now());
      SELECT count(*) INTO v_cnt FROM public.notifications WHERE title = 'Döveç';
      SELECT count(*) INTO v_cnt2 FROM public.dovec_health_alert_state;
      v_res := v_res || ('not_armed=' || v_cnt || '/' || v_cnt2);
      UPDATE public.dovec_settings SET last_run_at = now(), suspended = false, last_run_status = 'ok', last_good_sync_at = now() WHERE id = 1;

      -- 3. suspended: the exact line, admins only, push iff a token; again = nothing; fixed = "düzeldi", then silence
      UPDATE public.dovec_settings SET suspended = true WHERE id = 1;
      PERFORM public.dovec_health_watchdog(now());
      EXECUTE v_q INTO v_r USING v_admin;
      v_res := v_res || ('suspended=' || v_r);
      SELECT count(*) INTO v_cnt FROM public.notifications WHERE title = 'Döveç' AND type = 'admin_alert';
      v_res := v_res || ('notices_equal_admins=' || (v_cnt = v_adm_n)::text);
      SELECT count(*) INTO v_cnt FROM public.notifications WHERE title = 'Döveç' AND user_id IN (SELECT id FROM public.profiles WHERE role IS DISTINCT FROM 'admin');
      v_res := v_res || ('notices_to_non_admins=' || v_cnt);
      SELECT count(*) INTO v_cnt FROM public.push_log WHERE kind = 'dovec_health_alert' AND user_id IN (SELECT id FROM public.profiles WHERE role IS DISTINCT FROM 'admin');
      v_res := v_res || ('push_log_to_non_admins=' || v_cnt);
      SELECT bool_and((pl.request_id IS NULL) = (p.push_token IS NULL)) AND count(*) = v_adm_n INTO v_ok
        FROM public.push_log pl JOIN public.profiles p ON p.id = pl.user_id WHERE pl.kind = 'dovec_health_alert';
      v_res := v_res || ('push_iff_token=' || coalesce(v_ok, false)::text);
      EXECUTE v_clr;
      PERFORM public.dovec_health_watchdog(now());
      SELECT count(*) INTO v_cnt FROM public.notifications WHERE title = 'Döveç';
      v_res := v_res || ('suspended_again=' || v_cnt);
      UPDATE public.dovec_settings SET suspended = false WHERE id = 1;
      PERFORM public.dovec_health_watchdog(now());
      EXECUTE v_q INTO v_r USING v_admin;
      v_res := v_res || ('suspended_fixed=' || v_r);
      EXECUTE v_clr;
      PERFORM public.dovec_health_watchdog(now());
      SELECT count(*) INTO v_cnt FROM public.notifications WHERE title = 'Döveç';
      v_res := v_res || ('suspended_silent=' || v_cnt);

      -- 4. last_status: the status word is the only variable part
      UPDATE public.dovec_settings SET last_run_status = 'http_401' WHERE id = 1;
      PERFORM public.dovec_health_watchdog(now());
      EXECUTE v_q INTO v_r USING v_admin;
      v_res := v_res || ('last_status=' || v_r);
      EXECUTE v_clr;
      UPDATE public.dovec_settings SET last_run_status = 'ok' WHERE id = 1;
      PERFORM public.dovec_health_watchdog(now());
      EXECUTE v_q INTO v_r USING v_admin;
      v_res := v_res || ('last_status_fixed=' || v_r);
      EXECUTE v_clr;

      -- 5. stale: 29 minutes is fine, 31 is red, NULL is red
      UPDATE public.dovec_settings SET last_good_sync_at = now() - interval '29 minutes' WHERE id = 1;
      PERFORM public.dovec_health_watchdog(now());
      SELECT count(*) INTO v_cnt FROM public.notifications WHERE title = 'Döveç';
      v_res := v_res || ('stale_29min=' || v_cnt);
      UPDATE public.dovec_settings SET last_good_sync_at = now() - interval '31 minutes' WHERE id = 1;
      PERFORM public.dovec_health_watchdog(now());
      EXECUTE v_q INTO v_r USING v_admin;
      v_res := v_res || ('stale_31min=' || v_r);
      EXECUTE v_clr;
      UPDATE public.dovec_settings SET last_good_sync_at = now() WHERE id = 1;
      PERFORM public.dovec_health_watchdog(now());
      EXECUTE v_q INTO v_r USING v_admin;
      v_res := v_res || ('stale_fixed=' || v_r);
      EXECUTE v_clr;
      UPDATE public.dovec_settings SET last_good_sync_at = NULL WHERE id = 1;
      PERFORM public.dovec_health_watchdog(now());
      EXECUTE v_q INTO v_r USING v_admin;
      v_res := v_res || ('stale_null=' || v_r);
      EXECUTE v_clr;
      UPDATE public.dovec_settings SET last_good_sync_at = now() WHERE id = 1;
      PERFORM public.dovec_health_watchdog(now());
      EXECUTE v_clr;

      -- 6. stuck: a retry enquiry 59 minutes old is fine, 61 is red; sent again = "düzeldi"
      EXECUTE v_lead INTO v_id USING 'retry', now() - interval '59 minutes';
      PERFORM public.dovec_health_watchdog(now());
      SELECT count(*) INTO v_cnt FROM public.notifications WHERE title = 'Döveç';
      v_res := v_res || ('stuck_59min=' || v_cnt);
      UPDATE public.dovec_leads SET created_at = now() - interval '61 minutes' WHERE id = v_id;
      PERFORM public.dovec_health_watchdog(now());
      EXECUTE v_q INTO v_r USING v_admin;
      v_res := v_res || ('stuck_61min=' || v_r);
      EXECUTE v_clr;
      UPDATE public.dovec_leads SET status = 'sent', sent_at = now() WHERE id = v_id;
      PERFORM public.dovec_health_watchdog(now());
      EXECUTE v_q INTO v_r USING v_admin;
      v_res := v_res || ('stuck_fixed=' || v_r);
      EXECUTE v_clr;

      -- 7. the agreed test enquiry (is_test) is never read, stuck or failed
      INSERT INTO public.dovec_leads (external_id, client_request_id, payload_hash, name, phone, language, language_code, consent, consent_text_version, status, created_at, is_test)
        VALUES ('TEST-1', gen_random_uuid(), repeat('e', 64), 'Probe Test', '+441234567890', 'English', 'en', true, 'v', 'retry', now() - interval '5 hours', true);
      PERFORM public.dovec_health_watchdog(now());
      SELECT count(*) INTO v_cnt FROM public.notifications WHERE title = 'Döveç';
      UPDATE public.dovec_leads SET status = 'failed' WHERE is_test;
      PERFORM public.dovec_health_watchdog(now());
      SELECT count(*) INTO v_cnt2 FROM public.notifications WHERE title = 'Döveç';
      v_res := v_res || ('test_enquiry_ignored=' || v_cnt || '/' || v_cnt2);

      -- 8. failed: the exact line; a SECOND failure while red = a fresh line; both older than 24 h = "düzeldi"
      EXECUTE v_lead INTO v_id USING 'rejected', now();
      PERFORM public.dovec_health_watchdog(now());
      EXECUTE v_q INTO v_r USING v_admin;
      v_res := v_res || ('failed=' || v_r);
      EXECUTE v_clr;
      PERFORM public.dovec_health_watchdog(now());
      SELECT count(*) INTO v_cnt FROM public.notifications WHERE title = 'Döveç';
      v_res := v_res || ('failed_again=' || v_cnt);
      EXECUTE v_lead INTO v_id2 USING 'failed', now();
      UPDATE public.dovec_leads SET status_changed_at = now() + interval '5 minutes' WHERE id = v_id2;
      PERFORM public.dovec_health_watchdog(now() + interval '10 minutes');
      EXECUTE v_q INTO v_r USING v_admin;
      v_res := v_res || ('second_failure=' || v_r);
      EXECUTE v_clr;
      PERFORM public.dovec_health_watchdog(now() + interval '11 minutes');
      SELECT count(*) INTO v_cnt FROM public.notifications WHERE title = 'Döveç';
      v_res := v_res || ('second_failure_again=' || v_cnt);
      UPDATE public.dovec_leads SET status_changed_at = now() - interval '25 hours' WHERE id IN (v_id, v_id2);
      PERFORM public.dovec_health_watchdog(now() + interval '12 minutes');
      EXECUTE v_q INTO v_r USING v_admin;
      v_res := v_res || ('failed_fixed=' || v_r);
      EXECUTE v_clr;
      PERFORM public.dovec_health_watchdog(now() + interval '13 minutes');
      SELECT count(*) INTO v_cnt FROM public.notifications WHERE title = 'Döveç';
      v_res := v_res || ('failed_silent=' || v_cnt);

      -- 9. still red and last announced 25 h ago: the same line + (hâlâ); 23 h ago: quiet
      UPDATE public.dovec_settings SET suspended = true WHERE id = 1;
      PERFORM public.dovec_health_watchdog(now());
      EXECUTE v_clr;
      UPDATE public.dovec_health_alert_state SET alerted_at = now() - interval '23 hours' WHERE condition = 'suspended';
      PERFORM public.dovec_health_watchdog(now());
      SELECT count(*) INTO v_cnt FROM public.notifications WHERE title = 'Döveç';
      v_res := v_res || ('realert_23h=' || v_cnt);
      UPDATE public.dovec_health_alert_state SET alerted_at = now() - interval '25 hours' WHERE condition = 'suspended';
      PERFORM public.dovec_health_watchdog(now());
      EXECUTE v_q INTO v_r USING v_admin;
      v_res := v_res || ('realert_25h=' || v_r);
      EXECUTE v_clr;
      UPDATE public.dovec_settings SET suspended = false WHERE id = 1;
      PERFORM public.dovec_health_watchdog(now());
      EXECUTE v_clr;

      -- 10. the 7-day settle: an 8-day-old retry enquiry is already "stuck" (announced), dovec_leads_wipe_pii() settles it to
      --     failed, and the failed line fires from status_changed_at although created_at is 8 days old
      DELETE FROM public.dovec_leads WHERE NOT is_test;
      EXECUTE v_lead INTO v_id USING 'retry', now() - interval '8 days';
      PERFORM public.dovec_health_watchdog(now());
      EXECUTE v_clr;
      PERFORM public.dovec_leads_wipe_pii();
      PERFORM public.dovec_health_watchdog(now());
      EXECUTE v_q INTO v_r USING v_admin;
      v_res := v_res || ('settle=' || v_r);
      SELECT (l.created_at < now() - interval '7 days' AND l.status = 'failed')::text || '/' || (l.created_at < now() - interval '24 hours')::text || '/' || (l.status_changed_at >= now() - interval '1 minute')::text
        INTO v_r2 FROM public.dovec_leads l WHERE l.id = v_id;
      v_res := v_res || ('settle_old_created_at_fresh_stamp=' || v_r2);
      EXECUTE v_clr;

      -- 11. the trigger: stamp on insert, kept on a non-status update, kept when the status is "changed" to itself, restamped on a real
      --     change. Run as service_role (the edge function's role), which holds no EXECUTE on the trigger function (positive control).
      SET LOCAL ROLE service_role;
      INSERT INTO public.dovec_leads (client_request_id, payload_hash, project_id, name, phone, language, language_code, consent, consent_text_version, status)
        VALUES (gen_random_uuid(), repeat('f', 64), 'zz-probe-dv', 'Probe Person', '+441234567890', 'English', 'en', true, 'v', 'pending')
        RETURNING id INTO v_id;
      UPDATE public.dovec_leads SET status_changed_at = now() - interval '3 days' WHERE id = v_id;
      UPDATE public.dovec_leads SET attempts = 1 WHERE id = v_id;
      SELECT (status_changed_at < now() - interval '2 days')::text INTO v_r FROM public.dovec_leads WHERE id = v_id;
      UPDATE public.dovec_leads SET status = 'pending' WHERE id = v_id;
      SELECT v_r || '/' || (status_changed_at < now() - interval '2 days')::text INTO v_r FROM public.dovec_leads WHERE id = v_id;
      UPDATE public.dovec_leads SET status = 'sent', sent_at = now() WHERE id = v_id;
      SELECT v_r || '/' || (status_changed_at >= now() - interval '1 minute')::text INTO v_r FROM public.dovec_leads WHERE id = v_id;
      SET LOCAL ROLE postgres;
      v_res := v_res || ('stamp_kept_kept_restamped=' || v_r);

      -- 12. who can reach the watchdog and its state: nobody but the owner (the owner calls above are the positive control)
      SET LOCAL ROLE anon;
      BEGIN PERFORM public.dovec_health_watchdog(); v_anon_call := 'ALLOWED'; EXCEPTION WHEN insufficient_privilege THEN v_anon_call := 'denied'; WHEN OTHERS THEN v_anon_call := SQLERRM; END;
      BEGIN PERFORM 1 FROM public.dovec_health_alert_state; v_res := v_res || 'anon_state=ALLOWED'::text; EXCEPTION WHEN insufficient_privilege THEN v_res := v_res || 'anon_state=denied'::text; END;
      SET LOCAL ROLE authenticated;
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
      BEGIN PERFORM public.dovec_health_watchdog(); v_auth_call := 'ALLOWED'; EXCEPTION WHEN insufficient_privilege THEN v_auth_call := 'denied'; WHEN OTHERS THEN v_auth_call := SQLERRM; END;
      BEGIN PERFORM 1 FROM public.dovec_health_alert_state; v_res := v_res || 'admin_state=ALLOWED'::text; EXCEPTION WHEN insufficient_privilege THEN v_res := v_res || 'admin_state=denied'::text; END;
      BEGIN PERFORM 1 FROM public.dovec_leads; v_res := v_res || 'admin_leads=ALLOWED'::text; EXCEPTION WHEN insufficient_privilege THEN v_res := v_res || 'admin_leads=denied'::text; END;
      SET LOCAL ROLE service_role;
      BEGIN PERFORM public.dovec_health_watchdog(); v_sr_call := 'ALLOWED'; EXCEPTION WHEN insufficient_privilege THEN v_sr_call := 'denied'; WHEN OTHERS THEN v_sr_call := SQLERRM; END;
      BEGIN PERFORM 1 FROM public.dovec_health_alert_state; v_res := v_res || 'service_state=ALLOWED'::text; EXCEPTION WHEN insufficient_privilege THEN v_res := v_res || 'service_state=denied'::text; END;
      -- the legitimate path still works: service_role reads the leads table (positive control for the denials above)
      PERFORM 1 FROM public.dovec_leads;
      v_res := v_res || 'service_leads_read=ok'::text;
      SET LOCAL ROLE postgres;
      PERFORM set_config('request.jwt.claims', '', true);
      v_res := v_res || ('anon_watchdog=' || v_anon_call) || ('auth_watchdog=' || v_auth_call) || ('service_watchdog=' || v_sr_call);

      RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
    END;
    SET LOCAL ROLE postgres;

    v_expect := ARRAY[
      'healthy_unpublished=0/0', 'healthy_published=0', 'not_armed=0/0',
      'suspended=Döveç: talepler iletilemiyor (anahtar reddedildi)', 'notices_equal_admins=true', 'notices_to_non_admins=0', 'push_log_to_non_admins=0', 'push_iff_token=true',
      'suspended_again=0', 'suspended_fixed=Döveç: düzeldi (anahtar)', 'suspended_silent=0',
      'last_status=Döveç: son eşitleme hatalı (http_401)', 'last_status_fixed=Döveç: düzeldi (eşitleme durumu)',
      'stale_29min=0', 'stale_31min=Döveç: 30 dakikadır başarılı eşitleme yok', 'stale_fixed=Döveç: düzeldi (eşitleme)', 'stale_null=Döveç: 30 dakikadır başarılı eşitleme yok',
      'stuck_59min=0', 'stuck_61min=Döveç: bir talep 1 saattir gönderilemiyor', 'stuck_fixed=Döveç: düzeldi (bekleyen talep)',
      'test_enquiry_ignored=0/0',
      'failed=Döveç: bir talep reddedildi ya da gönderilemedi', 'failed_again=0', 'second_failure=Döveç: bir talep reddedildi ya da gönderilemedi', 'second_failure_again=0',
      'failed_fixed=Döveç: düzeldi (reddedilen talep)', 'failed_silent=0',
      'realert_23h=0', 'realert_25h=Döveç: talepler iletilemiyor (anahtar reddedildi) (hâlâ)',
      'settle=Döveç: bir talep reddedildi ya da gönderilemedi | Döveç: düzeldi (bekleyen talep)', 'settle_old_created_at_fresh_stamp=true/true/true',
      'stamp_kept_kept_restamped=true/true/true',
      'anon_state=denied', 'admin_state=denied', 'admin_leads=denied', 'service_state=denied', 'service_leads_read=ok',
      'anon_watchdog=denied', 'auth_watchdog=denied', 'service_watchdog=denied'];
    IF v_res IS DISTINCT FROM v_expect THEN
      RAISE EXCEPTION 'dovec health probe results differ. got: % | expected: %', v_res, v_expect;
    END IF;
    RAISE NOTICE 'dovec health probes (% checks): %', cardinality(v_res), v_res;

    IF EXISTS (SELECT 1 FROM public.dovec_projects WHERE id = 'zz-probe-dv')
       OR (SELECT row(published, suspended, last_good_sync_at, last_run_at, last_run_status, last_run_detail)::text FROM public.dovec_settings WHERE id = 1) IS DISTINCT FROM v_set_before
       OR (SELECT count(*) FROM public.notifications WHERE title = 'Döveç') IS DISTINCT FROM v_notes_before
       OR (SELECT count(*) FROM public.push_log WHERE kind = 'dovec_health_alert') IS DISTINCT FROM v_plog_before
       OR (SELECT count(*) FROM public.dovec_health_alert_state) IS DISTINCT FROM v_state_before
       OR (SELECT md5(coalesce(string_agg(l::text, '|' ORDER BY l.id), '')) FROM public.dovec_leads l) IS DISTINCT FROM v_leads_before THEN
      RAISE EXCEPTION 'probe rows leaked';
    END IF;
  END;
  RAISE NOTICE '20261241 OK: dovec health watchdog (owner only), state table (RLS on, no policies, no grants), stamp trigger, job at :09 :24 :39 :54, coverage holds';
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
VALUES ('20261241_dovec_health_watchdog.sql', 'd4baae1864d004c60576aa6332d82ef0bbfed365482847f24b4ad2f48bd6ba14')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Rollback (by hand, as a new migration, only if ever needed) ────────────
--   SELECT cron.unschedule('dovec-health-check'); DELETE FROM public.data_jobs WHERE key = 'dovec-health-check';
--   DROP FUNCTION public.dovec_health_watchdog(timestamptz); DROP TABLE public.dovec_health_alert_state;
--   DROP TRIGGER dovec_leads_stamp_status ON public.dovec_leads; DROP FUNCTION public.dovec_leads_stamp_status();
--   ALTER TABLE public.dovec_leads DROP COLUMN status_changed_at;
