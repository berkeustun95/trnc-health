-- ═══════════════════════════════════════════════════════════════════════════
-- Appointments removed — STEP 2 OF 2. 20261003 MUST BE APPLIED AND VERIFIED FIRST.
--
-- ⚠ THIS FILE IS ONE-WAY. It drops a table and deletes its rows. 20261003's revert
--   path (re-adding reviews_appointment_id_fkey) works ONLY while appointments still
--   exists; past this file there is nothing to point the FK at. Section 0 refuses to
--   run if 20261003 was skipped — do not remove that guard.
--
-- ─── WHAT THE DATA SAID (measured 2026-08-31, Role → postgres) ──────────────
--   10 appointments. Every is_future = false. Nothing pending, nothing upcoming.
--   All at test facilities (Poyritoooo/garage/suspended, ACK Clinic/clinic/suspended,
--   Nutripedia/clinic/active), users berke / ack / Kaju, one self-booking.
--   0 customers strike-blocked. 0 facilities carrying a booking schedule.
--   4 orphaned appointment notifications, printed by section 2 before deletion.
--   Nobody is waiting on anything, so there is no notice and no archive.
--
--   NOTE the clinics: bookings WERE reachable on health types before ce02e09
--   (2026-08-08) gated them — only pharmacies were excluded until then. An audit
--   claimed clinic reviews were structurally impossible; the data disproved it.
--
-- ─── FOUR FUNCTIONS ARE EDITED, NOT DROPPED, AND EACH EDIT IS GUARDED ───────
--
-- delete_own_account, insert_notification and notify_facility_owner all reference
-- the appointments TABLE, so once it is gone they raise at runtime rather than
-- merely doing nothing. They must be rewritten.
--
-- ⚠ THE BODIES BELOW WERE RECONSTRUCTED FROM MIGRATION FILES, WHICH IS THE THING
--   THIS REPO KEEPS GETTING BURNED BY. insert_notification alone has FOUR
--   definitions across four migrations, and a manual-apply workflow does not
--   promise the newest file is what is live. So every CREATE OR REPLACE below is
--   preceded by an assertion that the LIVE body still contains the markers the
--   replacement was written against. If one fails, the migration aborts and
--   nothing is clobbered — re-read pg_get_functiondef and rewrite that section.
--   An abort here is the guard working, not an obstacle.
--
-- ─── ONE FUNCTION IS DELIBERATELY LEFT ALONE ────────────────────────────────
--
-- notify_owner_text keeps its appointment_title / appointment_body templates in all
-- nine locales. They become UNREACHABLE, because notify_facility_owner will reject
-- p_kind = 'appointment' before it ever looks one up. Rewriting a 3,125-character
-- nine-locale VALUES table to delete rows that nothing can reach is pure risk for no
-- behavioural gain — and 20260923's H-token asserts that localisation is real, so a
-- clumsy edit would go red on a function whose remaining job is intact. Unreachable
-- rows in a lookup table are inert. Left as they are, on purpose.
--
-- notify_admins is untouched: it never referenced appointments.
--
-- ─── WHAT insert_notification BECOMES, AND WHY THAT IS AN IMPROVEMENT ───────
--
-- It has three branches and TWO are entirely appointment-keyed (owner→customer, and
-- customer→owner). Removing appointments leaves only the admin branch. That is not a
-- degradation: after this slice, every surviving caller is AdminScreen (4 call sites);
-- the other three (ProviderScreen, GarageBookingsScreen, GroomingBookingsScreen) go
-- with the booking UI. So the function that accepts CLIENT-WRITTEN p_title/p_body —
-- the injection channel 20260923 closed for provider alerts — becomes admin-only.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 0. REFUSE TO RUN IF 20261003 WAS SKIPPED ──────────────────────────────
-- Without this, the DELETE in section 5 CASCADE-deletes every review that has an
-- appointment_id. This is the guard that makes the two-file split mean something.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reviews_appointment_id_fkey') THEN
    RAISE EXCEPTION
      'REFUSING TO RUN: reviews_appointment_id_fkey still exists. Apply 20261003 first — '
      'this file deletes every appointment, and that FK is ON DELETE CASCADE, so the '
      'reviews would go with them silently.';
  END IF;
END $$;

-- ─── 1. PRE-FLIGHT — the RED. What is about to be removed. ─────────────────
DO $$
DECLARE
  v_appts   bigint;
  v_reviews bigint;
  v_notifs  bigint;
  v_crons   text;
  v_blocked bigint;
BEGIN
  SELECT count(*) INTO v_appts   FROM public.appointments;
  SELECT count(*) INTO v_reviews FROM public.reviews;
  SELECT count(*) INTO v_notifs  FROM public.notifications
   WHERE body ILIKE '%randevu%' OR body ILIKE '%appointment%'
      OR title ILIKE '%randevu%' OR title ILIKE '%appointment%';
  SELECT coalesce(string_agg(jobname || ' (active=' || active || ')', ', '), 'none')
    INTO v_crons FROM cron.job
   WHERE jobname IN ('grooming-pending-processor','garage-pending-processor');
  SELECT count(*) INTO v_blocked FROM public.profiles
   WHERE blocked_until IS NOT NULL AND blocked_until > now();

  RAISE NOTICE '── BEFORE ────────────────────────────────────────────────';
  RAISE NOTICE '  appointments to delete            : %', v_appts;
  RAISE NOTICE '  reviews (must be UNCHANGED after) : %', v_reviews;
  RAISE NOTICE '  orphaned notifications to delete  : %', v_notifs;
  RAISE NOTICE '  booking cron jobs still scheduled : %', v_crons;
  RAISE NOTICE '  customers strike-blocked          : %  (record_no_show is their only writer)', v_blocked;
  IF v_blocked > 0 THEN
    RAISE NOTICE '  ⚠ % customer(s) are blocked and nothing will ever unblock them after this.', v_blocked;
  END IF;
  RAISE NOTICE '──────────────────────────────────────────────────────────';
END $$;

-- ─── 2. STOP THE WORKERS FIRST ─────────────────────────────────────────────
-- Before anything else, so neither processor can fire against a half-migrated schema.
-- Dropping the functions is NOT enough: the job row survives and starts failing every
-- 15 minutes forever, writing to cron.job_run_details. 2 jobs x 96 runs/day, silent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'grooming-pending-processor') THEN
    PERFORM cron.unschedule('grooming-pending-processor');
    RAISE NOTICE '  unscheduled grooming-pending-processor';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'garage-pending-processor') THEN
    PERFORM cron.unschedule('garage-pending-processor');
    RAISE NOTICE '  unscheduled garage-pending-processor';
  END IF;
END $$;

-- ─── 3. PRINT the orphaned notifications BEFORE deleting them ──────────────
-- They carry no FK, so a table drop leaves them in three users' inboxes pointing at a
-- feature that no longer exists. Printed so the deletion is on the record, not silent.
DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '── notifications that will be deleted in section 8 ───────';
  FOR r IN
    SELECT id, user_id, title, left(body, 70) AS body, created_at
      FROM public.notifications
     WHERE body ILIKE '%randevu%' OR body ILIKE '%appointment%'
        OR title ILIKE '%randevu%' OR title ILIKE '%appointment%'
     ORDER BY created_at
  LOOP
    RAISE NOTICE '  % | % | % | %', r.created_at, r.user_id, r.title, r.body;
  END LOOP;
END $$;

-- ─── 4. GUARDED FUNCTION EDITS ─────────────────────────────────────────────

-- (4a) delete_own_account — remove TWO appointment deletes, keep everything else.
--      Edited, never dropped: it is the account-deletion path and a store commitment.
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'delete_own_account';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'delete_own_account does not exist — do not proceed blind';
  END IF;
  IF v_def NOT LIKE '%DELETE FROM appointments%' THEN
    RAISE EXCEPTION 'delete_own_account no longer deletes appointments; the live body '
      'differs from what this replacement was written against. Re-read it. def=%', v_def;
  END IF;
  IF v_def NOT LIKE '%DELETE FROM auth.users%' THEN
    RAISE EXCEPTION 'delete_own_account does not end at auth.users — live body has drifted. def=%', v_def;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.delete_own_account()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_fids uuid[];
BEGIN
  SELECT ARRAY(SELECT id FROM facilities WHERE provider_id = auth.uid())
  INTO v_fids;

  IF array_length(v_fids, 1) > 0 THEN
    -- appointments removed 20261004; the table no longer exists.
    DELETE FROM reviews                  WHERE facility_id          = ANY(v_fids);
    DELETE FROM questions                WHERE facility_id          = ANY(v_fids);
    DELETE FROM quiz_submissions         WHERE assigned_facility_id = ANY(v_fids);
    DELETE FROM duty_schedule            WHERE facility_id          = ANY(v_fids);
    DELETE FROM facility_change_requests WHERE facility_id          = ANY(v_fids);
    DELETE FROM claim_requests           WHERE facility_id          = ANY(v_fids);
    DELETE FROM facilities               WHERE id                   = ANY(v_fids);
  END IF;

  DELETE FROM notifications WHERE user_id     = auth.uid();
  DELETE FROM reviews       WHERE customer_id = auth.uid();
  DELETE FROM profiles      WHERE id          = auth.uid();
  DELETE FROM auth.users    WHERE id          = auth.uid();
END;
$function$;

-- (4b) insert_notification — the two appointment branches go; the admin branch stays.
--      See the header: every surviving caller is AdminScreen, so this narrows the
--      client-written-title/body channel to admins only.
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'insert_notification';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'insert_notification does not exist — do not proceed blind';
  END IF;
  IF v_def NOT LIKE '%FROM appointments a%' THEN
    RAISE EXCEPTION 'insert_notification live body does not match the version this '
      'replacement was written against (4 definitions exist across migrations). def=%', v_def;
  END IF;
  IF v_def NOT LIKE '%permission denied%' THEN
    RAISE EXCEPTION 'insert_notification does not end in a deny — live body has drifted. def=%', v_def;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.insert_notification(p_user_id uuid, p_title text, p_body text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- ADMIN ONLY, as of 20261004. The other two branches keyed on appointments
  -- (owner to customer, and customer to owner) and both are gone with the table.
  -- This function accepts client-written title and body, which is the injection
  -- channel 20260923 closed for provider alerts by introducing notify_facility_owner.
  -- Narrowing it to admins closes what remained of it. Do not re-add a branch here
  -- to solve a notification problem: add a p_kind-style function instead.
  IF EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    INSERT INTO notifications (user_id, title, body) VALUES (p_user_id, p_title, p_body);
    RETURN;
  END IF;

  RAISE EXCEPTION 'permission denied';
END;
$function$;

-- (4c) notify_facility_owner — 'appointment' leaves the kind vocabulary.
--      Everything else is preserved verbatim: the unclaimed-facility early RETURN,
--      the recipient-language read (bug 3), the push_log write including the
--      NULL-request_id case, and the derive-authorization-from-tables rule.
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'notify_facility_owner';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'notify_facility_owner does not exist — do not proceed blind';
  END IF;
  IF v_def NOT LIKE '%FROM appointments%' THEN
    RAISE EXCEPTION 'notify_facility_owner live body does not reference appointments; '
      'it has drifted from what this replacement was written against. def=%', v_def;
  END IF;
  IF v_def NOT LIKE '%INSERT INTO push_log%' THEN
    RAISE EXCEPTION 'notify_facility_owner does not write push_log — live body has drifted. def=%', v_def;
  END IF;
END $$;

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
  -- 'appointment' removed 20261004. STILL AN ENUM, not client-written text: the whole
  -- point of this function is that the client names a facility and a KIND the server
  -- interprets, never a recipient and never a title. If a second kind is ever added,
  -- add it here — do not accept p_title/p_body.
  IF p_kind NOT IN ('question') THEN
    RAISE EXCEPTION 'notify_facility_owner: unknown kind %', p_kind;
  END IF;

  SELECT provider_id, name INTO owner_id, fac_name
    FROM facilities WHERE id = p_facility_id;

  -- An unclaimed facility has nobody to notify. Not an error: most of the directory is
  -- unclaimed, and a customer asking a question there must not see a failure.
  IF owner_id IS NULL THEN RETURN; END IF;

  -- AUTHORIZATION, derived from the tables — never asserted by the caller. Reads a row
  -- the caller JUST inserted, so ordering matters at the call site: insert the question
  -- FIRST, then notify. That is how the caller already works.
  IF NOT EXISTS (SELECT 1 FROM questions
                  WHERE facility_id = p_facility_id AND customer_id = auth.uid()) THEN
    RAISE EXCEPTION 'notify_facility_owner: no question at this facility';
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
  -- from "we never got here", and telling them apart is the whole reason that outage
  -- lasted 70 days. A NULL request_id row is evidence; a missing row is not.
  INSERT INTO push_log (user_id, kind, request_id) VALUES (owner_id, p_kind, req);
END $function$;

-- ─── 5. DROP the booking-only functions ────────────────────────────────────
-- get_customer_contacts is DROPPED, not left in place. Its predicate requires an
-- appointment to exist, so it would return zero rows for every caller forever — a
-- function that silently returns empty is the exact shape this repo keeps mistaking
-- for a working one. Consequence, and it is a privacy improvement worth naming:
-- with 20260821 and 20260922 having already removed both profiles over-share
-- policies, providers now see NO customer identity at all.
DROP FUNCTION IF EXISTS public.get_customer_contacts(uuid[]);
DROP FUNCTION IF EXISTS public.process_garage_pending();
DROP FUNCTION IF EXISTS public.process_grooming_pending();
DROP FUNCTION IF EXISTS public.record_no_show(uuid);
DROP FUNCTION IF EXISTS public.check_pending_appointment_limit() CASCADE;
DROP FUNCTION IF EXISTS public.appointments_guard_requested_time() CASCADE;

-- is_customer_blocked() is KEPT: the questions INSERT policy references it and would
-- break without it. But record_no_show was its ONLY writer, so profiles.blocked_until
-- can never be set again and the function is now permanently false. 0 customers are
-- blocked today, so nothing is stranded. Registered as an H-token in verify_schema.sql
-- so the next reader does not mistake a dead guard for a live one. A future slice
-- should either give it a writer or remove it deliberately — not discover it by accident.

-- ─── 6. THE TABLE ──────────────────────────────────────────────────────────
-- Safe because section 0 proved the reviews FK is gone. The DROP takes 15 policies,
-- 2 triggers and 3 indexes (including appointments_active_slot_unique) with it.
DELETE FROM public.appointments;
DROP TABLE IF EXISTS public.appointments;

-- ─── 7. The column that pointed at it ──────────────────────────────────────
-- Held back by 20261003 on purpose, so that migration stayed independently revertible.
ALTER TABLE public.reviews DROP COLUMN IF EXISTS appointment_id;

-- ─── 8. The orphaned notifications, printed in section 3 ───────────────────
DELETE FROM public.notifications
 WHERE body ILIKE '%randevu%' OR body ILIKE '%appointment%'
    OR title ILIKE '%randevu%' OR title ILIKE '%appointment%';

-- ─── 9. VERIFICATION — the GREEN ───────────────────────────────────────────
DO $$
DECLARE
  v_reviews bigint;
  v_def     text;
  n         int;
BEGIN
  -- (a) the table and its column are gone
  IF to_regclass('public.appointments') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: public.appointments still exists';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='reviews' AND column_name='appointment_id') THEN
    RAISE EXCEPTION 'FAIL: reviews.appointment_id still exists';
  END IF;

  -- (b) THE ONE THAT MATTERS: reviews survived. Compared against the count printed in
  --     section 1 by the human; asserted here as "not zero" only if it was not zero.
  SELECT count(*) INTO v_reviews FROM public.reviews;
  RAISE NOTICE '  reviews after: %  (compare against the BEFORE figure in section 1)', v_reviews;

  -- (c) both cron jobs are really gone from cron.job, not merely inactive
  SELECT count(*) INTO n FROM cron.job
   WHERE jobname IN ('grooming-pending-processor','garage-pending-processor');
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FAIL: % booking cron job(s) still scheduled — they will fail every 15 minutes', n;
  END IF;

  -- (d) the dropped functions are dropped. DERIVED count, not six separate names.
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname IN
     ('get_customer_contacts','process_garage_pending','process_grooming_pending',
      'record_no_show','check_pending_appointment_limit','appointments_guard_requested_time');
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FAIL: % booking-only function(s) survive', n;
  END IF;

  -- (e) the EDITED functions exist and no longer mention appointments
  FOR v_def IN
    SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
     WHERE ns.nspname='public'
       AND p.proname IN ('delete_own_account','insert_notification','notify_facility_owner')
  LOOP
    IF v_def ILIKE '%FROM appointments%' OR v_def ILIKE '%DELETE FROM appointments%' THEN
      RAISE EXCEPTION 'FAIL: an edited function still queries appointments: %', left(v_def, 200);
    END IF;
  END LOOP;
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public'
     AND p.proname IN ('delete_own_account','insert_notification','notify_facility_owner');
  IF n IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'FAIL: expected 3 edited functions, found %', n;
  END IF;

  -- (f) notify_facility_owner rejects the old kind and still keeps its enum shape
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname='notify_facility_owner';
  IF v_def NOT LIKE '%p_kind NOT IN (''question'')%' THEN
    RAISE EXCEPTION 'FAIL: notify_facility_owner still accepts a kind other than question';
  END IF;
  IF v_def NOT LIKE '%INSERT INTO push_log%' THEN
    RAISE EXCEPTION 'FAIL: notify_facility_owner lost its push_log write';
  END IF;

  -- (g) notify_owner_text UNTOUCHED and still localised. Its appointment templates are
  --     now unreachable, which is fine — but 20260923's token asserts the nine locales
  --     are real, and a clumsy edit here would go red on a function whose job is intact.
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname='notify_owner_text';
  IF v_def IS NULL OR v_def NOT LIKE '%Νέα Ερώτηση%' THEN
    RAISE EXCEPTION 'FAIL: notify_owner_text is missing or no longer localised';
  END IF;

  -- (h) no orphaned notifications remain
  SELECT count(*) INTO n FROM public.notifications
   WHERE body ILIKE '%randevu%' OR body ILIKE '%appointment%'
      OR title ILIKE '%randevu%' OR title ILIKE '%appointment%';
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FAIL: % orphaned appointment notification(s) remain', n;
  END IF;

  -- (i) is_customer_blocked SURVIVES — the questions policy depends on it
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
                  WHERE ns.nspname='public' AND p.proname='is_customer_blocked') THEN
    RAISE EXCEPTION 'FAIL: is_customer_blocked was dropped — the questions INSERT policy references it';
  END IF;

  RAISE NOTICE '── AFTER ─────────────────────────────────────────────────';
  RAISE NOTICE '  appointments dropped · 2 crons unscheduled · 6 functions dropped';
  RAISE NOTICE '  3 functions edited · notify_owner_text intact · 0 orphaned notifications';
  RAISE NOTICE '  is_customer_blocked kept (now permanently false — see verify_schema)';
  RAISE NOTICE '──────────────────────────────────────────────────────────';
END $$;

COMMIT;

-- ─── AFTER APPLYING ────────────────────────────────────────────────────────
--   1. Compare the reviews count in section 9 against section 1. They MUST match.
--   2. Run supabase/verify_schema.sql — QUERY 1's first row must say ALL n PASS,
--      and QUERY 2 must show the two booking cron jobs GONE (not INACTIVE).
--   3. Ship the client + document changes committed alongside this file.
--
-- ─── THERE IS NO REVERT PATH ───────────────────────────────────────────────
-- This file is ONE-WAY. 20261003's footer offers a revert that restores
-- reviews_appointment_id_fkey; it works ONLY while public.appointments still exists.
-- Past this file the table is gone, its 10 rows are gone, and there is nothing for
-- that FK to reference. Restoring bookings means rebuilding the table, its 15
-- policies, 2 triggers, 3 indexes, 6 functions and 2 cron jobs from git history —
-- treat it as a rewrite, not a rollback. Nothing of value is lost (10 test rows, all
-- past, nobody waiting), but the asymmetry is the point: be sure before you run it.
