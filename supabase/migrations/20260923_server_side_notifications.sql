-- ═══ Provider + admin notifications move SERVER-SIDE ═══════════════════════
--
-- Closes three instances of one bug and one injection channel. Audit:
-- 2026-08-27_notify-provider-audit.md · plan: 2026-08-27_notify-provider-fix-plan.md
--
-- ─── THE INJECTION CHANNEL IS THE POINT OF THIS MIGRATION ───────────────────
--
-- insert_notification(p_user_id, p_title, p_body) takes CLIENT-SUPPLIED title and body.
-- Branch 3 (added 20260726) lets any customer with one appointment call it against that
-- facility's owner. So today a customer can write arbitrary text into a provider's
-- notification feed — "ADA: your account is suspended, tap here to restore it." The
-- provider has no way to tell it from us, because in their inbox it IS us.
--
-- notify_facility_owner() takes p_kind, not p_title/p_body. The strings live in
-- notify_owner_text() and cannot be reached from a client. That is the fix; the three
-- dead-notification bugs below are fixed on the way past.
--
-- ─── THE THREE DEAD PATHS ───────────────────────────────────────────────────
--
-- All three do the same thing: a client reads someone else's profile for a push_token,
-- RLS returns zero rows, and the code treats "no rows" as "no token" — a legitimate
-- state — so it fails silently and looks identical to success.
--
--   utils/notify.js:12          customer → provider   push dead since 2026-06-18
--   ContentReportMenu.js:32     any user → admins     push AND in-app dead
--   ProviderOnboardingScreen:137 provider → admins    push AND in-app dead
--
-- The last two loop `for (const admin of admins ?? [])`, so an empty result skips the
-- body entirely: no push and no notifications row. **No admin has been alerted to a
-- content report or a provider application.** On a UGC health app that is a moderation
-- gap, and check-ins will add report-a-place into the same dead path.
--
-- ─── WHY NOT A POLICY ───────────────────────────────────────────────────────
--
-- Letting a customer read a provider's push_token would recreate the over-share dropped
-- by 20260821/20260922, and would ship another user's push token into the client where
-- anyone can read it out of memory or traffic. The five notification paths that WORK
-- (process_grooming_pending, process_garage_pending, process_featured_expiring,
-- notify_module_waitlist, send-duty-notification) all do the lookup inside a DEFINER
-- context. This migration makes the exceptions match them; it invents nothing.
--
-- ─── push_log — and why it starts HERE ──────────────────────────────────────
--
-- supabase/verify_push_delivery.sql already diagnosed this and recommended it:
--
--   "Every push in this project is `PERFORM net.http_post(...)`, in five separate
--    processors, and every one throws away the request_id ... Capturing it would make
--    delivery answerable rather than inferable."
--
-- PERFORM discards the bigint request_id, so delivery can only be guessed by timestamp
-- against net._http_response before pg_net prunes it. These two functions are the SIXTH
-- and SEVENTH senders; adopting push_log now costs one INSERT and stops the deferred
-- rollout from growing. The other five migrate in their own slice.
--
-- Note what push_log does and does not prove. It records that we ASKED Expo to send —
-- request_id, recipient, kind, time. Expo returns HTTP 200 even for a failed ticket, so
-- joining to net._http_response tells you the call succeeded, not that a device buzzed.
-- It converts "we hope pushes fire" into "we can see which ones we attempted", which is
-- exactly the gap that let a 70-day outage go unnoticed.
--
-- ─── TWO ACCEPTED PROPERTIES, NAMED SO THEY ARE NOT SURPRISES ───────────────
--
-- 1. BOTH RPCs ARE REPLAYABLE. A caller holding one genuine appointment, question or
--    report can invoke them repeatedly and re-ping the recipient. That is strictly
--    better than what it replaces — the text is fixed and server-owned, and a real
--    relationship is still required — but it is not a rate limit, and it is not one by
--    oversight. If provider-side nuisance ever shows up, the fix is a throttle keyed on
--    (auth.uid(), p_facility_id, kind) against push_log, which is now recorded and makes
--    that throttle a query rather than a new table.
--
-- 2. THE i18n KEYS ARE NOW A REFERENCE, NOT A CALL SITE. notifNewApptTitle/Body and
--    notifNewQuestionTitle/Body in constants/i18n.js are no longer read by any screen —
--    the strings that ship now live in notify_owner_text() below. They are still the
--    SOURCE those strings were ported from, and scripts/check-notify-health.mjs imports
--    them to detect the two copies drifting apart. DO NOT DELETE THEM as unused; an
--    unused-key linter will be wrong about these four.
--
-- Apply by hand: SQL editor, Role = postgres. Then `node scripts/migration-ledger.mjs`
-- and re-run supabase/verify_schema.sql.

SET ROLE postgres;
BEGIN;

-- ─── 1. push_log ────────────────────────────────────────────────────────────
-- No FK on request_id: net._http_response is pruned on pg_net's own schedule, and a FK
-- would either block that prune or cascade our audit rows away with it.
CREATE TABLE IF NOT EXISTS public.push_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  request_id  bigint,                        -- net.http_post's id; NULL = no token, not sent
  sent_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_log_sent_at ON public.push_log (sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_push_log_user_kind ON public.push_log (user_id, kind, sent_at DESC);

-- RLS ON with an admin-only read and NO write policy at all. Rows arrive only from
-- SECURITY DEFINER functions, which bypass RLS — so "no INSERT policy" is the correct
-- and complete write rule, not an omission.
ALTER TABLE public.push_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS push_log_admin_read ON public.push_log;
CREATE POLICY push_log_admin_read ON public.push_log
  FOR SELECT TO authenticated USING (is_admin());

-- ─── 2. notify_owner_text — the strings, server-side ────────────────────────
-- Lifted VERBATIM from constants/i18n.js (notifNewApptTitle/Body, notifNewQuestionTitle/
-- Body) in all 9 locales, so a provider sees the same wording that was always intended —
-- this migration changes who can set the text, not what it says. {name} = facility name.
-- English fallback for an unknown/NULL language, matching module_notif_text.
CREATE OR REPLACE FUNCTION public.notify_owner_text(p_key text, p_lang text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path = public
AS $function$
  SELECT coalesce(
    (SELECT txt FROM (VALUES
      ('appointment_title','English','New Appointment Request'),
      ('appointment_title','Turkish','Yeni Randevu Talebi'),
      ('appointment_title','Arabic','طلب موعد جديد'),
      ('appointment_title','Russian','Новый запрос на запись'),
      ('appointment_title','Greek','Νέο Αίτημα Ραντεβού'),
      ('appointment_title','French','Nouvelle demande de rendez-vous'),
      ('appointment_title','Spanish','Nueva solicitud de cita'),
      ('appointment_title','German','Neue Terminanfrage'),
      ('appointment_title','Persian','درخواست نوبت جدید'),

      ('appointment_body','English','{name} has a new appointment request.'),
      ('appointment_body','Turkish','{name} için yeni bir randevu talebi var.'),
      ('appointment_body','Arabic','{name} لديها طلب موعد جديد.'),
      ('appointment_body','Russian','{name} получила новый запрос на запись.'),
      ('appointment_body','Greek','Η {name} έχει νέο αίτημα ραντεβού.'),
      ('appointment_body','French','{name} a une nouvelle demande de rendez-vous.'),
      ('appointment_body','Spanish','{name} tiene una nueva solicitud de cita.'),
      ('appointment_body','German','{name} hat eine neue Terminanfrage.'),
      ('appointment_body','Persian','{name} یک درخواست نوبت جدید دارد.'),

      ('question_title','English','New Question'),
      ('question_title','Turkish','Yeni Soru'),
      ('question_title','Arabic','سؤال جديد'),
      ('question_title','Russian','Новый вопрос'),
      ('question_title','Greek','Νέα Ερώτηση'),
      ('question_title','French','Nouvelle question'),
      ('question_title','Spanish','Nueva pregunta'),
      ('question_title','German','Neue Frage'),
      ('question_title','Persian','سوال جدید'),

      ('question_body','English','{name} received a new question from a user.'),
      ('question_body','Turkish','{name} bir kullanıcıdan yeni soru aldı.'),
      ('question_body','Arabic','تلقّت {name} سؤالاً جديداً من مستخدم.'),
      ('question_body','Russian','{name} получила новый вопрос от пользователя.'),
      ('question_body','Greek','Η {name} έλαβε νέα ερώτηση από χρήστη.'),
      ('question_body','French','{name} a reçu une nouvelle question d''un utilisateur.'),
      ('question_body','Spanish','{name} recibió una nueva pregunta de un usuario.'),
      ('question_body','German','{name} hat eine neue Frage von einem Nutzer erhalten.'),
      ('question_body','Persian','{name} یک سوال جدید از کاربر دریافت کرد.')
    ) AS m(k, l, txt)
    WHERE m.k = p_key AND m.l = coalesce(p_lang, 'English')),
    (SELECT txt FROM (VALUES
      ('appointment_title','New Appointment Request'),
      ('appointment_body','{name} has a new appointment request.'),
      ('question_title','New Question'),
      ('question_body','{name} received a new question from a user.')
    ) AS f(k, txt) WHERE f.k = p_key)
  );
$function$;

-- ─── 3. notify_facility_owner ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_facility_owner(p_facility_id uuid, p_kind text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  owner_id  uuid;
  fac_name  text;
  tok       text;
  plang     text;
  ttl       text;
  bdy       text;
  req       bigint;
BEGIN
  IF p_kind NOT IN ('appointment','question') THEN
    RAISE EXCEPTION 'notify_facility_owner: unknown kind %', p_kind;
  END IF;

  SELECT provider_id, name INTO owner_id, fac_name
    FROM facilities WHERE id = p_facility_id;

  -- An unclaimed facility has nobody to notify. Not an error: most of the directory is
  -- unclaimed, and a customer booking there must not see a failure.
  IF owner_id IS NULL THEN RETURN; END IF;

  -- AUTHORIZATION, derived from the tables — never asserted by the caller. The client
  -- passes a facility id and a kind; it cannot name a recipient and cannot claim a
  -- relationship it does not have.
  --
  -- Both branches read a row the caller JUST inserted, so ordering matters at the call
  -- site: insert the appointment/question FIRST, then notify. That is how both callers
  -- already work, and it is why the appointment path survived while the question path
  -- did not — insert_notification's branch 3 keys on appointments only.
  IF p_kind = 'appointment' THEN
    IF NOT EXISTS (SELECT 1 FROM appointments
                    WHERE facility_id = p_facility_id AND customer_id = auth.uid()) THEN
      RAISE EXCEPTION 'notify_facility_owner: no appointment at this facility';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM questions
                    WHERE facility_id = p_facility_id AND customer_id = auth.uid()) THEN
      RAISE EXCEPTION 'notify_facility_owner: no question at this facility';
    END IF;
  END IF;

  -- The recipient's language, read here rather than in the client. This is bug 3: the
  -- old client read `prov.preferred_language` from a query RLS always emptied, so `lang`
  -- fell back to English every time, against a comment promising localisation.
  SELECT push_token, preferred_language INTO tok, plang
    FROM profiles WHERE id = owner_id;

  ttl := notify_owner_text(p_kind || '_title', plang);
  bdy := replace(notify_owner_text(p_kind || '_body', plang), '{name}', coalesce(fac_name, 'A facility'));

  INSERT INTO notifications (user_id, title, body) VALUES (owner_id, ttl, bdy);

  IF tok IS NOT NULL THEN
    SELECT net.http_post(
      url     := 'https://exp.host/--/api/v2/push/send',
      body    := jsonb_build_object('to', tok, 'title', ttl, 'body', bdy, 'sound', 'default'),
      headers := jsonb_build_object('Content-Type', 'application/json')) INTO req;
  END IF;

  -- Logged even when req IS NULL. "No token, so nothing was sent" is a DIFFERENT fact
  -- from "we never got here", and telling them apart is the whole reason this outage
  -- lasted 70 days. A NULL request_id row is evidence; a missing row is not.
  INSERT INTO push_log (user_id, kind, request_id) VALUES (owner_id, p_kind, req);
END $function$;

GRANT EXECUTE ON FUNCTION public.notify_facility_owner(uuid, text) TO authenticated;

-- ─── 4. notify_admins ───────────────────────────────────────────────────────
-- Admin-facing strings are ENGLISH ONLY, deliberately. Admins are the operator, the
-- copy is operational, and inventing nine translations nobody has reviewed would be
-- worse than one language that is correct. notify_owner_text's shape is available if
-- that ever changes.
CREATE OR REPLACE FUNCTION public.notify_admins(p_kind text, p_ref_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r     record;
  ttl   text;
  bdy   text;
  label text;
  req   bigint;
  n     integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RETURN 0; END IF;

  IF p_kind = 'content_report' THEN
    -- Authorized by the reporter's OWN report row, which also supplies the label — so
    -- the caller cannot pick the words and cannot notify about a report it did not file.
    SELECT content_type INTO label FROM content_reports
      WHERE content_id = p_ref_id AND reporter_id = auth.uid()
      ORDER BY created_at DESC LIMIT 1;
    IF label IS NULL THEN
      RAISE EXCEPTION 'notify_admins: no report by this user for that content';
    END IF;
    ttl := 'Content reported';
    bdy := 'A ' || (CASE WHEN label = 'facility' THEN 'business listing' ELSE label END)
           || ' was reported and is awaiting review.';

  ELSIF p_kind = 'facility_submission' THEN
    -- create_facility_claim always writes a claim_requests row, in both the claim and
    -- the new-application flow, so this one predicate authorizes both.
    IF NOT EXISTS (SELECT 1 FROM claim_requests
                    WHERE facility_id = p_ref_id AND requester_id = auth.uid()) THEN
      RAISE EXCEPTION 'notify_admins: no submission by this user for that facility';
    END IF;
    SELECT name INTO label FROM facilities WHERE id = p_ref_id;
    ttl := 'New facility submission';
    bdy := coalesce(label, 'A facility') || ' submitted for review.';

  ELSE
    RAISE EXCEPTION 'notify_admins: unknown kind %', p_kind;
  END IF;

  FOR r IN SELECT id, push_token FROM profiles WHERE role = 'admin' LOOP
    INSERT INTO notifications (user_id, title, body) VALUES (r.id, ttl, bdy);
    req := NULL;
    IF r.push_token IS NOT NULL THEN
      SELECT net.http_post(
        url     := 'https://exp.host/--/api/v2/push/send',
        body    := jsonb_build_object('to', r.push_token, 'title', ttl, 'body', bdy, 'sound', 'default'),
        headers := jsonb_build_object('Content-Type', 'application/json')) INTO req;
    END IF;
    INSERT INTO push_log (user_id, kind, request_id) VALUES (r.id, p_kind, req);
    n := n + 1;
  END LOOP;

  RETURN n;
END $function$;

GRANT EXECUTE ON FUNCTION public.notify_admins(text, uuid) TO authenticated;

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
VALUES ('20260923_server_side_notifications.sql', 'a11cab7b6e4d6780152dc2104b64a3789786d78ee4001596f7784080a323d6a1')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- No ADD COLUMN on an existing table, so no PostgREST reload is needed for a column
-- cache. push_log is new and read only by SQL/admin tooling, not by PostgREST today.

-- ─── Verification (Role = postgres) ─────────────────────────────────────────
--   -- 1. objects exist and are callable by the app:
--   SELECT proname, prosecdef,
--          has_function_privilege('authenticated', oid, 'EXECUTE') AS app_can_call
--     FROM pg_proc WHERE proname IN ('notify_facility_owner','notify_admins','notify_owner_text');
--   -- expect notify_facility_owner + notify_admins: prosecdef=t, app_can_call=t
--
--   -- 2. the strings really are all nine locales, not English nine times:
--   SELECT public.notify_owner_text('appointment_title','Turkish');   -- Yeni Randevu Talebi
--   SELECT public.notify_owner_text('question_body','German');        -- {name} hat eine neue Frage…
--   SELECT public.notify_owner_text('question_title','Klingon');      -- New Question (fallback)
--
--   -- 3. WATCH IT REFUSE. As a signed-in customer with NO appointment at this facility:
--   SELECT public.notify_facility_owner('<some facility uuid>', 'appointment');
--   -- expect: notify_facility_owner: no appointment at this facility
--   SELECT public.notify_facility_owner('<some facility uuid>', 'spam');
--   -- expect: notify_facility_owner: unknown kind spam
--
--   -- 4. THE INJECTION IS CLOSED — there is no argument left to inject through.
--   --    Compare the two signatures: insert_notification takes text the caller writes,
--   --    notify_facility_owner takes an enum the server interprets.
--   SELECT pg_get_function_arguments(oid), proname FROM pg_proc
--    WHERE proname IN ('insert_notification','notify_facility_owner');
--
--   -- 5. push_log is not world-readable:
--   SELECT relrowsecurity FROM pg_class WHERE oid='public.push_log'::regclass;  -- expect t
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname='public' AND tablename='push_log';   -- expect ONE row, admin SELECT
--
--   -- 6. after the client OTA, real traffic shows up here:
--   SELECT kind, count(*), count(request_id) AS pushes_attempted,
--          count(*) - count(request_id) AS no_token
--     FROM public.push_log GROUP BY kind ORDER BY kind;

-- ─── Rollback ───────────────────────────────────────────────────────────────
--   BEGIN;
--   DROP FUNCTION IF EXISTS public.notify_admins(text, uuid);
--   DROP FUNCTION IF EXISTS public.notify_facility_owner(uuid, text);
--   DROP FUNCTION IF EXISTS public.notify_owner_text(text, text);
--   DROP TABLE IF EXISTS public.push_log;
--   COMMIT;
--   DELETE FROM public.schema_migrations_applied
--    WHERE filename = '20260923_server_side_notifications.sql';
-- ⚠ Roll the CLIENT back too, or notify.js calls an RPC that no longer exists and
--   providers go silent again — the state this migration exists to end.
