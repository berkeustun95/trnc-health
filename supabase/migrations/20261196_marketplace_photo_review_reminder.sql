-- ═══════════════════════════════════════════════════════════════════════════
-- 20261196 — Bandabuliya (marketplace): remind admins when listing photos wait for review
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT IT DOES, IN PLAIN ENGLISH
-- Every 5 minutes a pg_cron job calls public.marketplace_photo_review_reminder(). It sends every admin an in-app
-- notice and a push ("Bandabuliya" / "<n> fotoğraf onay bekliyor") when ALL THREE hold (Berke: "at most one every
-- 30 minutes, with the count"; no quiet hours, his choice):
--   (a) at least one photo is WAITING;
--   (b) at least one waiting photo arrived AFTER the last reminder (a queue the admins already know about does not
--       ping again every 30 minutes; it pings again only when something new joins it);
--   (c) the last reminder was at least 30 minutes ago (no reminder ever = send).
-- "Waiting" is ONE predicate, used for both the count and the "new" test: marketplace_photos.status = 'pending' AND
-- its listing's deleted_at IS NULL. A photo on a deleted listing is neither counted nor a reason to send.
-- n in the text = the number of waiting photos at send time (old + new).
--
-- WHY "NEW" CAN BE READ FROM created_at: a photo never goes back to pending. Every upload is a new row
-- (marketplace_photo_insert_guard, 20261183 and 20261190, forces status := 'pending' and created_at := now() on
-- INSERT, so a client can neither backdate nor pre-approve it); marketplace_photos has NO UPDATE grant or policy for
-- any client role (20261183 section 4: SELECT, column INSERT and DELETE only); and the one writer of status, the
-- marketplace-photo-review function, settles a row only from pending (`.eq('status', 'pending')`) to approved or
-- rejected. So "a pending photo newer than the last reminder" really is a photo nobody has been told about.
-- Known edge, accepted: created_at is the photo's transaction START. An insert that began before a reminder run and
-- committed after it (a window of milliseconds) is never "new"; it is counted, but triggers no send of its own until
-- the next photo arrives.
--
-- WHERE "LAST SENT" LIVES: a one-row table, public.marketplace_photo_reminder_state, not max(push_log.sent_at).
--   • push_log has no index leading on kind, and nothing purges it: this read runs every 5 minutes, forever, and
--     would scan a table that only grows.
--   • push_log.user_id cascades on profile delete: deleting the only admin who was reminded would erase "last sent"
--     and re-ping a queue the other admins already know about.
--   • The row is locked (FOR UPDATE) for the whole run, so a manual service_role call and the cron tick cannot both
--     send.
--   • The stamp is written ONLY when at least one admin was notified. With zero admins nothing is sent and nothing
--     is stamped, so the next tick re-evaluates (one cheap count every 5 minutes) and the first admin to exist gets
--     the current queue. That is deliberate.
--
-- WHO CAN READ / WRITE WHAT
--   • marketplace_photo_reminder_state: RLS ON with NO policies, and every grant revoked from PUBLIC, anon and
--     authenticated. No app user (customer, guest, provider, admin) can read or change it through the API. Only
--     the postgres-owned function below writes it. It holds one timestamp and no user data.
--   • marketplace_photo_review_reminder(): EXECUTE for service_role only (postgres owns it; pg_cron runs as
--     postgres). anon and authenticated cannot call it. The grants are the ONLY guard: under cron auth.uid() is
--     NULL, so the function cannot check a caller. It takes no arguments, so a caller cannot choose who is told
--     or what the text says.
--   • notifications: one row per admin (profiles.role = 'admin'), type 'admin_alert'. Readable only by that admin
--     (the unchanged "users read own notifications" policy). The row carries no deep link: notifications has no
--     data column, and listing_id (20261192) stays NULL because the notice is about the queue, not one listing.
--     Only the push carries data.
--   • push_log: one row per admin, kind 'mk_photos_waiting', request_id NULL when the admin has no push token
--     ("no token, nothing sent" is a different fact from "never got here"; as notify_admins).
--   • Customers and providers are never notified: the loop reads profiles.role = 'admin' only.
--
-- THE TEXT: Turkish, deliberately. The other admin alerts (notify_admins) are English; Berke worded this one in
-- Turkish. Title 'Bandabuliya', body '<n> fotoğraf onay bekliyor'.
--
-- THE PUSH DATA, EXACTLY {"screen": "admin", "tab": "marketplace", "view": "photos"}.
-- The screen key must never name the marketplace module itself: the bundles in production today route that
-- screen to a listing view with a null id, and this job fires before the app OTA that knows the admin route lands.
-- Bundles that do not know screen 'admin' ignore the tap.
--
-- THE JOB: 'marketplace-photo-review-reminder', every 5 minutes, SELECT public.marketplace_photo_review_reminder();
-- No edge function. To stop it: SELECT cron.unschedule('marketplace-photo-review-reminder'); (a migration).
--
-- ROLLBACK (not part of this transaction; by hand only if ever needed, as a migration):
--   SELECT cron.unschedule('marketplace-photo-review-reminder');
--   DROP FUNCTION IF EXISTS public.marketplace_photo_review_reminder();
--   DROP TABLE IF EXISTS public.marketplace_photo_reminder_state;
--   (then delete this file's row from schema_migrations_applied)
--
-- Apply: gh workflow run supabase-migrate -f file=20261196_marketplace_photo_review_reminder.sql (dry), then -f apply=true.
SET ROLE postgres;
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ─── Pre-flight ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.marketplace_photos') IS NULL OR to_regclass('public.marketplace_listings') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: 20261183 (marketplace_listings / marketplace_photos) is not applied. Nothing applied.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.marketplace_listings'::regclass
                  AND attname = 'deleted_at' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'REFUSING: marketplace_listings.deleted_at is missing. Nothing applied.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.marketplace_photos'::regclass
                  AND attname = 'created_at' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'REFUSING: marketplace_photos.created_at is missing. Nothing applied.';
  END IF;
  IF to_regclass('public.push_log') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: public.push_log (20260923) is missing. Nothing applied.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.push_log'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) ILIKE '%kind%') THEN
    RAISE EXCEPTION 'REFUSING: push_log has a CHECK on kind; mk_photos_waiting would be refused. Nothing applied.';
  END IF;
  IF to_regclass('public.notifications') IS NULL OR NOT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conrelid = 'public.notifications'::regclass
          AND conname = 'notifications_type_check' AND pg_get_constraintdef(oid) LIKE '%''admin_alert''%') THEN
    RAISE EXCEPTION 'REFUSING: notifications.type does not accept admin_alert (notifications_type_check). Nothing applied.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'net' AND p.proname = 'http_post') THEN
    RAISE EXCEPTION 'REFUSING: net.http_post (pg_net) is missing. Nothing applied.';
  END IF;
  IF to_regprocedure('cron.schedule(text,text,text)') IS NULL OR to_regclass('cron.job') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: pg_cron (cron.schedule / cron.job) is missing. Nothing applied.';
  END IF;
END $$;

-- ─── 1. Last-sent state: one row, no client access ──────────────────────────
CREATE TABLE IF NOT EXISTS public.marketplace_photo_reminder_state (
  id           boolean     NOT NULL DEFAULT true,
  last_sent_at timestamptz,
  CONSTRAINT marketplace_photo_reminder_state_pkey PRIMARY KEY (id),
  CONSTRAINT marketplace_photo_reminder_state_one_row CHECK (id)
);
COMMENT ON TABLE public.marketplace_photo_reminder_state IS
  'One row: when admins were last reminded about Bandabuliya photos waiting for review (20261196). Written only by marketplace_photo_review_reminder(); no client access.';
ALTER TABLE public.marketplace_photo_reminder_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketplace_photo_reminder_state FROM PUBLIC, anon, authenticated;
-- A re-apply never resets the stamp.
INSERT INTO public.marketplace_photo_reminder_state (id, last_sent_at) VALUES (true, NULL) ON CONFLICT (id) DO NOTHING;

-- ─── 2. The reminder ────────────────────────────────────────────────────────
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
  bdy := v_count || ' fotoğraf onay bekliyor';

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

-- ─── 3. The job ─────────────────────────────────────────────────────────────
SELECT cron.unschedule('marketplace-photo-review-reminder') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'marketplace-photo-review-reminder');
SELECT cron.schedule('marketplace-photo-review-reminder', '*/5 * * * *', 'SELECT public.marketplace_photo_review_reminder();');

-- ─── Assertions ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  r       text;
  v_n     int;
  v_names text;
BEGIN
  -- The function: DEFINER, owned by postgres, EXECUTE for service_role only.
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.marketplace_photo_review_reminder()')
                  AND prosecdef AND proowner = 'postgres'::regrole) THEN
    RAISE EXCEPTION 'marketplace_photo_review_reminder() is not a postgres-owned SECURITY DEFINER function';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_function_privilege(r, 'public.marketplace_photo_review_reminder()', 'EXECUTE') THEN
      RAISE EXCEPTION '% can execute marketplace_photo_review_reminder(): anyone could ping every admin', r;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role', 'public.marketplace_photo_review_reminder()', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot execute marketplace_photo_review_reminder() (positive control)';
  END IF;

  -- The state table: RLS on, no policies, no client privilege, exactly one row.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.marketplace_photo_reminder_state'::regclass) THEN
    RAISE EXCEPTION 'marketplace_photo_reminder_state has RLS off';
  END IF;
  SELECT count(*), string_agg(policyname, ', ') INTO v_n, v_names
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'marketplace_photo_reminder_state';
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'marketplace_photo_reminder_state has % policies, expected 0: %', v_n, v_names;
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_table_privilege(r, 'public.marketplace_photo_reminder_state', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') THEN
      RAISE EXCEPTION '% holds a privilege on marketplace_photo_reminder_state', r;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM public.marketplace_photo_reminder_state;
  IF v_n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'marketplace_photo_reminder_state has % rows, expected 1', v_n;
  END IF;

  -- The job: exactly one, every 5 minutes, the exact command.
  SELECT count(*) INTO v_n FROM cron.job WHERE jobname = 'marketplace-photo-review-reminder';
  IF v_n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'marketplace-photo-review-reminder: % jobs, expected 1', v_n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'marketplace-photo-review-reminder'
                  AND schedule = '*/5 * * * *'
                  AND btrim(command) = 'SELECT public.marketplace_photo_review_reminder();') THEN
    RAISE EXCEPTION 'marketplace-photo-review-reminder has the wrong schedule or command';
  END IF;
  RAISE NOTICE '20261196 OK: photo review reminder (service_role only), one-row state (RLS on, no policies), job every 5 minutes';
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
VALUES ('20261196_marketplace_photo_review_reminder.sql', '4ae0f5262af210ab97f95c7dd85c1fa4f02e7f1a2b6c273fde499c9394bf08e8')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
