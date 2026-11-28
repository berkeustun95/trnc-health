-- ═══════════════════════════════════════════════════════════════════════════
-- 20261242 — Döveç: one in-app notice (+ push) when an enquiry could not be delivered
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT IT DOES, IN PLAIN ENGLISH
-- A person sends an enquiry about a Döveç project. The app says "received" the moment ADA has saved it; the send to Döveç
-- happens right after (dovec-lead, background). If Döveç then refuses it ('rejected'), the send is given up ('failed'), or it
-- is still waiting after 24 hours ('pending' / 'retry'), the person is told ONCE, in their own language: "Enquiry not
-- delivered ... please send it again or contact Döveç on WhatsApp". A pg_cron job runs every 10 minutes and calls
-- public.dovec_notify_undelivered(); the edge function writes no notification, so there is ONE writer.
--
-- WHICH ENQUIRIES (all must hold): not the test enquiry · send_live (this enquiry was really meant for Döveç) · it has a user ·
-- its PII is not wiped · not notified before · created within the last 8 days (the 7-day retry window, plus the daily 03:30
-- wipe that settles leftovers as 'failed') · and EITHER status 'rejected' / 'failed' (next tick), OR status 'pending' /
-- 'retry' and at least 24 hours old. 'sent' and 'mock' are never picked. A lead Döveç accepts after its notice gets nothing
-- more: undelivered_notified_at is set once and never cleared.
--
-- NEW COLUMNS on dovec_leads
--   send_live boolean NOT NULL DEFAULT false           set true by the edge function ONLY on a live insert. Every existing row
--                                                       stays false, so nothing from the dark / mock period can ever be notified.
--   undelivered_notified_at timestamptz (NULL = no)    one notice per enquiry, ever.
--
-- THE TYPE: notifications_type_check gains 'dovec_undelivered' (read from the live definition and extended, as 20261183 did,
-- so every other module's type survives). The app treats an unknown type as "no destination" (utils/notificationRoute.js), so
-- the row shows in Bildirimler and opens nothing; no app change is needed.
--
-- THE PUSH: Expo, when profiles.push_token is not null. `data` is exactly {"screen": "notifications"}: pushRoute.js already
-- sends that to the notifications list (App.js setShowNotifs(true)), so a tap lands on the notice itself. Opening the Döveç
-- project page from a push needs an App.js change; deliberately not done here. The notifications row has no data column.
--
-- THE TEXT lives ONLY here (public.dovec_undelivered_text), keyed by the nine LANGUAGES names of constants/i18n.js (full
-- English names: English, Turkish, Arabic, Russian, Greek, French, Spanish, German, Persian); NULL or an unknown name -> English.
-- It is NOT in constants/i18n.js, so the i18n guard does not apply (a guard is only needed when the text also lives in i18n.js).
-- Placeholders {project} (the project name, or its id when the name is NULL) and {reference} (ADA-n) are filled with replace(),
-- never format(), so user-influenced text cannot act as a format string. {reference} is filled first, {project} last, so a
-- project name containing "{reference}" is never re-expanded.
--
-- WHO CAN READ / WRITE WHAT
--   • dovec_leads (the two new columns included): unchanged. RLS on, ZERO policies, no privilege for anon / authenticated;
--     service_role SELECT, INSERT, UPDATE (no DELETE). The new columns inherit that: only the dovec-lead edge function (service
--     role) reads or sets them. A customer can never read any lead, their own included.
--   • notifications: the notice is one row for the enquiring user, type 'dovec_undelivered'. It is readable only by its owner
--     through the existing "users read own notifications" policy (unchanged here); nobody else can read it.
--   • push_log: one row per notice, kind 'dovec_undelivered', request_id NULL when the user has no push token ("no token,
--     nothing sent" is not "never got here"). push_log has no CHECK on kind. Unchanged access.
--   • public.dovec_notify_undelivered(): SECURITY DEFINER, search_path pinned to '', callable by NOBODY but its owner
--     (EXECUTE revoked from PUBLIC, anon, authenticated and service_role); pg_cron runs it as postgres. It takes no argument, so a
--     caller cannot choose who is told or what the text says.
--   • public.dovec_undelivered_text(text, text, text): pure text lookup, same owner-only EXECUTE.
--
-- THE JOB: 'dovec-notify-undelivered', minutes 7,17,27,37,47,57 (two minutes after dovec-lead-retry, so a send it just gave up on is
-- noticed within the tick), pure SQL, one data_jobs row (20261205). Stop it: SELECT cron.unschedule('dovec-notify-undelivered');
--
-- PRINTS no user ids and no counts of user rows. The behaviour block inserts its own probe rows under existing profiles that
-- have no push token (so no HTTP request is ever queued) and ends in a deliberate exception: nothing it writes survives.
-- Sequences are not rolled back: it burns values of public.dovec_lead_external_seq, so ADA-n numbers will show a gap.
--
-- ROLLBACK (by hand, as a migration, only if ever needed): SELECT cron.unschedule('dovec-notify-undelivered'); DROP FUNCTION
-- public.dovec_notify_undelivered(); DROP FUNCTION public.dovec_undelivered_text(text, text, text); DELETE the data_jobs row;
-- ALTER TABLE public.dovec_leads DROP COLUMN undelivered_notified_at, DROP COLUMN send_live; remove 'dovec_undelivered' from
-- notifications_type_check (only if no such rows exist); delete this file's schema_migrations_applied row.
--
-- Apply: gh workflow run supabase-migrate -f file=20261242_dovec_undelivered_notice.sql (dry), then -f apply=true.
SET ROLE postgres;
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ─── Pre-flight ─────────────────────────────────────────────────────────────
DO $$
DECLARE v_def text;
BEGIN
  IF to_regclass('public.dovec_leads') IS NULL OR to_regprocedure('public.dovec_leads_wipe_pii()') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: 20261229 (dovec_leads) is not applied. Nothing applied.';
  END IF;
  IF to_regclass('public.profiles') IS NULL OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.profiles'::regclass
        AND attname = 'push_token' AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.profiles'::regclass AND attname = 'preferred_language' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'REFUSING: profiles.push_token / profiles.preferred_language is missing. Nothing applied.';
  END IF;
  IF to_regclass('public.push_log') IS NULL OR to_regclass('public.notifications') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: public.push_log / public.notifications is missing. Nothing applied.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.push_log'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) ILIKE '%kind%') THEN
    RAISE EXCEPTION 'REFUSING: push_log has a CHECK on kind; dovec_undelivered would be refused. Nothing applied.';
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint WHERE conname = 'notifications_type_check'
     AND conrelid = 'public.notifications'::regclass;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'REFUSING: notifications_type_check is missing. Nothing applied.';
  END IF;
  IF v_def !~ '^CHECK \(\(type = ANY \(ARRAY\[''[a-z_]+''::text(, ''[a-z_]+''::text)*\]\)\)\)$' THEN
    RAISE EXCEPTION 'REFUSING: notifications_type_check is not a plain value list: %. Nothing applied.', v_def;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'net' AND p.proname = 'http_post') THEN
    RAISE EXCEPTION 'REFUSING: net.http_post (pg_net) is missing. Nothing applied.';
  END IF;
  IF to_regprocedure('cron.schedule(text,text,text)') IS NULL OR to_regclass('cron.job') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: pg_cron (cron.schedule / cron.job) is missing. Nothing applied.';
  END IF;
  IF to_regclass('public.data_jobs') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: public.data_jobs (20261205) is missing. Nothing applied.';
  END IF;
END $$;

-- ─── 1. Columns ─────────────────────────────────────────────────────────────
ALTER TABLE public.dovec_leads
  ADD COLUMN IF NOT EXISTS send_live boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS undelivered_notified_at timestamptz;
COMMENT ON COLUMN public.dovec_leads.send_live IS
  'True only when the dovec-lead function inserted this enquiry in live mode (both locks open): it was really meant for Döveç. Existing and mock rows stay false, so they can never be notified as undelivered. 20261242.';
COMMENT ON COLUMN public.dovec_leads.undelivered_notified_at IS
  'When the person was told this enquiry could not be delivered (dovec_notify_undelivered). NULL = not told. Set once, never cleared: one notice per enquiry, ever. 20261242.';

-- ─── 2. notifications.type gains dovec_undelivered ──────────────────────────
-- Idempotent: the live values are kept in their order and the new one is appended only when missing.
-- drift:extend-check notifications_type_check dovec_undelivered
DO $$
DECLARE v_def text; v_vals text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint WHERE conname = 'notifications_type_check'
     AND conrelid = 'public.notifications'::regclass;
  SELECT array_agg(m[1] ORDER BY n) INTO v_vals FROM regexp_matches(v_def, '''([a-z_]+)''::text', 'g') WITH ORDINALITY AS r(m, n);
  IF 'dovec_undelivered' = ANY (v_vals) THEN
    RAISE NOTICE 'notifications_type_check already allows dovec_undelivered: unchanged';
  ELSE
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check, '
                   'ADD CONSTRAINT notifications_type_check CHECK (type IN (%s))',
                   (SELECT string_agg(quote_literal(v), ', ' ORDER BY n) FROM unnest(v_vals || 'dovec_undelivered'::text) WITH ORDINALITY AS u(v, n)));
    RAISE NOTICE 'notifications_type_check: added dovec_undelivered to %', v_vals;
  END IF;
END $$;

-- ─── 3. The text, one place ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dovec_undelivered_text(p_language text, p_project text, p_reference text)
 RETURNS TABLE (title text, body text)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT t.j ->> 'title',
         replace(replace(t.j ->> 'body', '{reference}', COALESCE(p_reference, '')), '{project}', COALESCE(p_project, ''))
    FROM (SELECT COALESCE(x.v -> p_language, x.v -> 'English') AS j
            FROM (SELECT $t${
  "English": {"title": "Enquiry not delivered", "body": "Your enquiry about {project} ({reference}) couldn't be delivered to Döveç. Please send it again or contact Döveç on WhatsApp."},
  "Turkish": {"title": "Talebiniz iletilemedi", "body": "{project} projesi için gönderdiğiniz talep ({reference}) Döveç'e iletilemedi. Lütfen talebinizi yeniden gönderin veya Döveç'e WhatsApp'tan ulaşın."},
  "Arabic": {"title": "تعذّر إرسال طلبك", "body": "تعذّر إرسال طلبك بخصوص {project} ({reference}) إلى Döveç. يُرجى إرساله مرة أخرى أو التواصل مع Döveç عبر WhatsApp."},
  "Russian": {"title": "Заявка не доставлена", "body": "Вашу заявку по проекту {project} ({reference}) не удалось доставить в Döveç. Пожалуйста, отправьте её ещё раз или свяжитесь с Döveç через WhatsApp."},
  "Greek": {"title": "Το αίτημά σας δεν παραδόθηκε", "body": "Το αίτημά σας για το έργο {project} ({reference}) δεν μπόρεσε να παραδοθεί στη Döveç. Παρακαλούμε στείλτε το ξανά ή επικοινωνήστε με τη Döveç μέσω WhatsApp."},
  "French": {"title": "Demande non transmise", "body": "Votre demande concernant {project} ({reference}) n'a pas pu être transmise à Döveç. Veuillez la renvoyer ou contacter Döveç sur WhatsApp."},
  "Spanish": {"title": "Solicitud no entregada", "body": "No se pudo entregar a Döveç su solicitud sobre {project} ({reference}). Por favor, envíela de nuevo o póngase en contacto con Döveç por WhatsApp."},
  "German": {"title": "Anfrage nicht zugestellt", "body": "Ihre Anfrage zu {project} ({reference}) konnte nicht an Döveç zugestellt werden. Bitte senden Sie sie erneut oder kontaktieren Sie Döveç über WhatsApp."},
  "Persian": {"title": "درخواست شما ارسال نشد", "body": "درخواست شما درباره {project} ({reference}) به Döveç ارسال نشد. لطفاً دوباره آن را ارسال کنید یا از طریق WhatsApp با Döveç تماس بگیرید."}
}$t$::jsonb AS v) x) t;
$function$;
REVOKE ALL ON FUNCTION public.dovec_undelivered_text(text, text, text) FROM PUBLIC, anon, authenticated, service_role;

-- ─── 4. The notifier ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dovec_notify_undelivered()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  r       record;
  v_tok   text;
  v_lang  text;
  v_title text;
  v_body  text;
  v_req   bigint;
BEGIN
  FOR r IN
    SELECT l.id, l.user_id, l.external_id, COALESCE(l.project_name, l.project_id) AS project
      FROM public.dovec_leads l
     WHERE NOT l.is_test AND l.send_live AND l.user_id IS NOT NULL AND l.pii_wiped_at IS NULL AND l.undelivered_notified_at IS NULL
       AND l.created_at > now() - interval '8 days'
       AND (l.status IN ('rejected', 'failed')
            OR (l.status IN ('pending', 'retry') AND l.created_at <= now() - interval '24 hours'))
       AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = l.user_id)
     ORDER BY l.created_at, l.id
       FOR UPDATE OF l SKIP LOCKED
  LOOP
    SELECT p.push_token, p.preferred_language INTO v_tok, v_lang FROM public.profiles p WHERE p.id = r.user_id;
    SELECT x.title, x.body INTO v_title, v_body FROM public.dovec_undelivered_text(v_lang, r.project, r.external_id) x;

    INSERT INTO public.notifications (user_id, title, body, type) VALUES (r.user_id, v_title, v_body, 'dovec_undelivered');

    v_req := NULL;
    IF v_tok IS NOT NULL THEN
      BEGIN
        SELECT net.http_post(
          url     := 'https://exp.host/--/api/v2/push/send',
          body    := jsonb_build_object('to', v_tok, 'title', v_title, 'body', v_body, 'sound', 'default',
                       'data', jsonb_build_object('screen', 'notifications')),
          headers := jsonb_build_object('Content-Type', 'application/json')) INTO v_req;
      EXCEPTION WHEN OTHERS THEN
        v_req := NULL;   -- the in-app notice is the record; a push that cannot be queued must not stop it or the stamp
      END;
    END IF;
    INSERT INTO public.push_log (user_id, kind, request_id) VALUES (r.user_id, 'dovec_undelivered', v_req);

    UPDATE public.dovec_leads SET undelivered_notified_at = now() WHERE id = r.id;
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public.dovec_notify_undelivered() FROM PUBLIC, anon, authenticated, service_role;

-- ─── 5. The job ─────────────────────────────────────────────────────────────
SELECT cron.unschedule('dovec-notify-undelivered') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dovec-notify-undelivered');
SELECT cron.schedule('dovec-notify-undelivered', '7,17,27,37,47,57 * * * *', 'SELECT public.dovec_notify_undelivered();');

-- Every cron job needs exactly one data_jobs row (20261205). The job always runs (the SQL is cheap), so a missed run is a real alarm.
INSERT INTO public.data_jobs (key, runner, kind, cron_jobnames, schedule_note, expected_every, sort) VALUES
  ('dovec-notify-undelivered', 'cron_sql', 'push', ARRAY['dovec-notify-undelivered'], NULL, interval '1 hour', 30)
ON CONFLICT (key) DO NOTHING;

-- ─── Assertions ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  r       text;
  v_n     int;
  v_got   text;
  v_def   text;
BEGIN
  -- Columns: exact types and defaults.
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                  WHERE a.attrelid = 'public.dovec_leads'::regclass AND a.attname = 'send_live' AND a.attnotnull
                    AND a.atttypid = 'boolean'::regtype AND pg_get_expr(d.adbin, d.adrelid) = 'false') THEN
    RAISE EXCEPTION 'dovec_leads.send_live is not boolean NOT NULL DEFAULT false';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.dovec_leads'::regclass AND attname = 'undelivered_notified_at'
                  AND NOT attnotnull AND atttypid = 'timestamptz'::regtype AND NOT attisdropped) THEN
    RAISE EXCEPTION 'dovec_leads.undelivered_notified_at is not a nullable timestamptz';
  END IF;

  -- The table stays service-role only: RLS on, zero policies, no app role holds any table or column privilege (positive control below).
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.dovec_leads'::regclass) THEN RAISE EXCEPTION 'dovec_leads has RLS off'; END IF;
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'dovec_leads';
  IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'dovec_leads has % policies, expected 0', v_n; END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_table_privilege(r, 'public.dovec_leads', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_any_column_privilege(r, 'public.dovec_leads', 'SELECT,INSERT,UPDATE,REFERENCES')
       OR has_column_privilege(r, 'public.dovec_leads', 'send_live', 'SELECT,INSERT,UPDATE')
       OR has_column_privilege(r, 'public.dovec_leads', 'undelivered_notified_at', 'SELECT,INSERT,UPDATE') THEN
      RAISE EXCEPTION '% holds a privilege on dovec_leads (a customer could read leads)', r;
    END IF;
  END LOOP;
  IF NOT (has_column_privilege('service_role', 'public.dovec_leads', 'send_live', 'SELECT,INSERT,UPDATE')
          AND has_column_privilege('service_role', 'public.dovec_leads', 'undelivered_notified_at', 'SELECT,UPDATE')) THEN
    RAISE EXCEPTION 'service_role cannot use the new columns (positive control)';
  END IF;

  -- The type: admitted, and the old ones survive.
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint WHERE conname = 'notifications_type_check' AND conrelid = 'public.notifications'::regclass;
  IF v_def NOT LIKE '%''dovec_undelivered''::text%' OR v_def NOT LIKE '%''message''::text%' OR v_def NOT LIKE '%''admin_alert''::text%' THEN
    RAISE EXCEPTION 'notifications_type_check lost a type or lacks dovec_undelivered: %', v_def;
  END IF;

  -- The functions: owner postgres, search_path pinned to '', EXECUTE for nobody but the owner.
  FOREACH r IN ARRAY ARRAY['public.dovec_notify_undelivered()', 'public.dovec_undelivered_text(text,text,text)'] LOOP
    IF to_regprocedure(r) IS NULL THEN RAISE EXCEPTION '% is missing', r; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r) AND p.proowner = 'postgres'::regrole
                    AND p.proconfig = ARRAY['search_path=""']) THEN
      RAISE EXCEPTION '% is not postgres-owned with search_path pinned to empty (proconfig: %)', r,
        (SELECT p.proconfig::text FROM pg_proc p WHERE p.oid = to_regprocedure(r));
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                WHERE p.oid = to_regprocedure(r) AND a.privilege_type = 'EXECUTE' AND a.grantee IS DISTINCT FROM p.proowner) THEN
      RAISE EXCEPTION '% is EXECUTE-able by a role other than its owner', r;
    END IF;
    FOREACH v_got IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF has_function_privilege(v_got, r, 'EXECUTE') THEN RAISE EXCEPTION '% can execute %', v_got, r; END IF;
    END LOOP;
    IF NOT has_function_privilege('postgres', r, 'EXECUTE') THEN RAISE EXCEPTION 'the owner cannot execute % (positive control)', r; END IF;
  END LOOP;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('public.dovec_notify_undelivered()')) THEN
    RAISE EXCEPTION 'dovec_notify_undelivered() is not SECURITY DEFINER';
  END IF;
  v_def := pg_get_functiondef(to_regprocedure('public.dovec_notify_undelivered()'));
  IF v_def NOT LIKE '%NOT l.is_test AND l.send_live AND l.user_id IS NOT NULL AND l.pii_wiped_at IS NULL AND l.undelivered_notified_at IS NULL%'
     OR v_def NOT LIKE '%FOR UPDATE OF l SKIP LOCKED%' OR v_def NOT LIKE '%INSERT INTO public.notifications (user_id, title, body, type) VALUES%' THEN
    RAISE EXCEPTION 'dovec_notify_undelivered() body lost its picker, its row lock or its 4-column notifications insert';
  END IF;

  -- The job: exactly one, the exact schedule and command, covered by exactly one data_jobs row.
  SELECT count(*) INTO v_n FROM cron.job WHERE jobname = 'dovec-notify-undelivered';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'dovec-notify-undelivered: % jobs, expected 1', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dovec-notify-undelivered' AND active AND schedule = '7,17,27,37,47,57 * * * *'
                  AND btrim(command) = 'SELECT public.dovec_notify_undelivered();') THEN
    RAISE EXCEPTION 'dovec-notify-undelivered has the wrong schedule or command';
  END IF;
  IF (SELECT count(*) FROM public.data_jobs d WHERE 'dovec-notify-undelivered' = ANY (d.cron_jobnames)) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'dovec-notify-undelivered is not covered by exactly one data_jobs row';
  END IF;

  -- push_log has no CHECK on kind (so 'dovec_undelivered' needs no change); print what is there.
  SELECT count(*) INTO v_n FROM pg_constraint WHERE conrelid = 'public.push_log'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%kind%';
  RAISE NOTICE 'push_log CHECK constraints on kind: %', v_n;
  IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'push_log carries % CHECK constraint(s) on kind', v_n; END IF;
END $$;

-- The text: the two approved strings verbatim, every language complete, the placeholders filled, the fallback English.
DO $$
DECLARE
  v_n    int;
  v_en   record;
  v_tr   record;
  v_l    text;
  r      record;
BEGIN
  SELECT * INTO v_en FROM public.dovec_undelivered_text('English', 'D-Point', 'ADA-7');
  IF v_en.title IS DISTINCT FROM 'Enquiry not delivered'
     OR v_en.body IS DISTINCT FROM 'Your enquiry about D-Point (ADA-7) couldn''t be delivered to Döveç. Please send it again or contact Döveç on WhatsApp.' THEN
    RAISE EXCEPTION 'English text differs from the approved string';
  END IF;
  SELECT * INTO v_tr FROM public.dovec_undelivered_text('Turkish', 'D-Point', 'ADA-7');
  IF v_tr.title IS DISTINCT FROM 'Talebiniz iletilemedi'
     OR v_tr.body IS DISTINCT FROM 'D-Point projesi için gönderdiğiniz talep (ADA-7) Döveç''e iletilemedi. Lütfen talebinizi yeniden gönderin veya Döveç''e WhatsApp''tan ulaşın.' THEN
    RAISE EXCEPTION 'Turkish text differs from the approved string';
  END IF;
  FOREACH v_l IN ARRAY ARRAY['English', 'Turkish', 'Arabic', 'Russian', 'Greek', 'French', 'Spanish', 'German', 'Persian'] LOOP
    SELECT * INTO r FROM public.dovec_undelivered_text(v_l, 'D-Point', 'ADA-7');
    IF r.title IS NULL OR r.title = '' OR r.body NOT LIKE '%D-Point%' OR r.body NOT LIKE '%(ADA-7)%' OR r.body NOT LIKE '%Döveç%'
       OR r.body NOT LIKE '%WhatsApp%' OR r.body LIKE '%{%' OR r.body LIKE '%}%' THEN
      RAISE EXCEPTION '% text is incomplete (title / project / reference / Döveç / WhatsApp / unfilled placeholder)', v_l;
    END IF;
  END LOOP;
  SELECT count(DISTINCT x.title) INTO v_n FROM unnest(ARRAY['English', 'Turkish', 'Arabic', 'Russian', 'Greek', 'French', 'Spanish', 'German', 'Persian']) l,
    LATERAL public.dovec_undelivered_text(l, 'p', 'r') x;
  IF v_n IS DISTINCT FROM 9 THEN RAISE EXCEPTION 'expected 9 distinct titles, found %', v_n; END IF;
  -- NULL, an unknown name and an ISO code all fall back to English.
  FOREACH v_l IN ARRAY ARRAY['Klingon', 'tr', 'en', ''] LOOP
    IF (SELECT x.title FROM public.dovec_undelivered_text(v_l, 'p', 'r') x) IS DISTINCT FROM 'Enquiry not delivered' THEN
      RAISE EXCEPTION 'language "%" did not fall back to English', v_l;
    END IF;
  END LOOP;
  IF (SELECT x.title FROM public.dovec_undelivered_text(NULL, 'p', 'r') x) IS DISTINCT FROM 'Enquiry not delivered' THEN
    RAISE EXCEPTION 'a NULL language did not fall back to English';
  END IF;
  -- A project name that looks like a placeholder is not expanded again.
  IF (SELECT x.body FROM public.dovec_undelivered_text('English', '{reference}', 'ADA-7') x) NOT LIKE 'Your enquiry about {reference} (ADA-7)%' THEN
    RAISE EXCEPTION 'a project name containing a placeholder was expanded';
  END IF;
END $$;

-- Behaviour: probe rows under existing profiles WITHOUT a push token (so no HTTP request is ever queued), ALL rolled back.
DO $$
DECLARE
  v_users uuid[];
  v_proj  text;
  v_ua    uuid; v_ub uuid; v_uc uuid;
  v_ids   jsonb := '{}'::jsonb;
  v_id    bigint;
  v_res   text;
  v_want  text;
  v_n     int;
  lbl     text;
  mk      text;
BEGIN
  SELECT array_agg(id) INTO v_users FROM (SELECT id FROM public.profiles WHERE push_token IS NULL ORDER BY id LIMIT 3) s;
  SELECT id INTO v_proj FROM public.dovec_projects ORDER BY id LIMIT 1;
  IF coalesce(array_length(v_users, 1), 0) < 3 OR v_proj IS NULL THEN
    RAISE EXCEPTION 'need three profiles without a push token and one dovec_projects row to run the behaviour probe with';
  END IF;
  v_ua := v_users[1]; v_ub := v_users[2]; v_uc := v_users[3];

  BEGIN
    -- label | user | status | age | send_live | pii wiped | has user
    FOR lbl, mk IN SELECT * FROM (VALUES
        ('pending25h',  'a|pending|25 hours|t'),
        ('pending23h',  'a|pending|23 hours|t'),
        ('rejected5m',  'a|rejected|5 minutes|t'),
        ('failed30m',   'b|failed|30 minutes|t'),
        ('retry25h',    'b|retry|25 hours|t'),
        ('retry23h',    'b|retry|23 hours|t'),
        ('sent',        'c|sent|25 hours|t'),
        ('mock',        'c|mock|25 hours|t'),
        ('notlive',     'c|pending|25 hours|f'),
        ('nouser',      'n|rejected|25 hours|t'),
        ('old9d',       'b|rejected|9 days|t')) x(l, m) LOOP
      INSERT INTO public.dovec_leads (client_request_id, payload_hash, project_id, name, phone, language, language_code, consent,
                                      consent_text_version, status, user_id, created_at, send_live)
      SELECT gen_random_uuid(), repeat('d', 64), v_proj, 'Probe', '+441234567890', 'English', 'en', true, 'probe',
             split_part(mk, '|', 2),
             CASE split_part(mk, '|', 1) WHEN 'a' THEN v_ua WHEN 'b' THEN v_ub WHEN 'c' THEN v_uc ELSE NULL END,
             now() - split_part(mk, '|', 3)::interval, split_part(mk, '|', 4) = 't'
      RETURNING id INTO v_id;
      v_ids := v_ids || jsonb_build_object(lbl, v_id);
    END LOOP;

    PERFORM public.dovec_notify_undelivered();
    SELECT string_agg(jk.key || '=' || (SELECT count(*) FROM public.notifications n JOIN public.dovec_leads l ON l.id = (v_ids ->> jk.key)::bigint
                                    WHERE n.type = 'dovec_undelivered' AND n.user_id IS NOT DISTINCT FROM l.user_id
                                      AND position('(' || l.external_id || ')' IN n.body) > 0)::text, ',' ORDER BY jk.key)
      INTO v_res FROM jsonb_object_keys(v_ids) AS jk(key);
    v_want := 'failed30m=1,mock=0,notlive=0,nouser=0,old9d=0,pending23h=0,pending25h=1,rejected5m=1,retry23h=0,retry25h=1,sent=0';
    IF v_res IS DISTINCT FROM v_want THEN RAISE EXCEPTION 'first tick: got % | expected %', v_res, v_want; END IF;

    -- push_log: one row per notice, request_id NULL (no token), kind as agreed
    SELECT count(*) INTO v_n FROM public.push_log WHERE kind = 'dovec_undelivered' AND request_id IS NULL
       AND user_id IN (v_ua, v_ub, v_uc) AND sent_at >= now() - interval '1 minute';
    IF v_n < 4 THEN RAISE EXCEPTION 'expected the 4 notices to be logged in push_log with request_id NULL, found %', v_n; END IF;

    -- a second tick: nothing more
    PERFORM public.dovec_notify_undelivered();
    SELECT count(*) INTO v_n FROM public.dovec_leads WHERE id IN (SELECT (value)::bigint FROM jsonb_each_text(v_ids)) AND undelivered_notified_at IS NOT NULL;
    IF v_n IS DISTINCT FROM 4 THEN RAISE EXCEPTION 'after a second tick % leads are stamped, expected 4', v_n; END IF;
    SELECT count(*) INTO v_n FROM public.notifications n JOIN public.dovec_leads l ON n.type = 'dovec_undelivered' AND n.user_id = l.user_id
       AND position('(' || l.external_id || ')' IN n.body) > 0 WHERE l.id IN (SELECT (value)::bigint FROM jsonb_each_text(v_ids));
    IF v_n IS DISTINCT FROM 4 THEN RAISE EXCEPTION 'a second tick changed the number of notices (%)', v_n; END IF;

    -- notified, then delivered: still exactly one
    UPDATE public.dovec_leads SET status = 'sent' WHERE id = (v_ids ->> 'rejected5m')::bigint;
    PERFORM public.dovec_notify_undelivered();
    SELECT count(*) INTO v_n FROM public.notifications n JOIN public.dovec_leads l ON n.type = 'dovec_undelivered' AND n.user_id = l.user_id
       AND position('(' || l.external_id || ')' IN n.body) > 0 WHERE l.id = (v_ids ->> 'rejected5m')::bigint;
    IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'a lead notified and then sent has % notices, expected 1', v_n; END IF;

    -- the 23 h pending lead is picked once it passes 24 h
    UPDATE public.dovec_leads SET created_at = now() - interval '25 hours' WHERE id = (v_ids ->> 'pending23h')::bigint;
    PERFORM public.dovec_notify_undelivered();
    SELECT count(*) INTO v_n FROM public.dovec_leads WHERE id = (v_ids ->> 'pending23h')::bigint AND undelivered_notified_at IS NOT NULL;
    IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'the lead that crossed 24 h was not notified'; END IF;

    -- the picker sees nothing from the dark / mock period
    SELECT count(*) INTO v_n FROM public.dovec_leads WHERE send_live AND id NOT IN (SELECT (value)::bigint FROM jsonb_each_text(v_ids))
       AND created_at > now() - interval '1 minute';
    IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'unexpected live rows appeared during the probe'; END IF;

    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  -- nothing the probe wrote survived: no notice of the new type exists, and no probe lead
  SELECT count(*) INTO v_n FROM public.notifications WHERE type = 'dovec_undelivered';
  IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'the probe left % notices behind', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.dovec_leads WHERE consent_text_version = 'probe';
  IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'the probe left % leads behind', v_n; END IF;
  RAISE NOTICE '20261242 OK: columns, type, text (9 languages), owner-only functions, job every 10 minutes, behaviour probe rolled back';
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
VALUES ('20261242_dovec_undelivered_notice.sql', '704219fd998a41b9eebb23db05402088a2197e502dae6c4b796d336a283cc661')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

NOTIFY pgrst, 'reload schema';
