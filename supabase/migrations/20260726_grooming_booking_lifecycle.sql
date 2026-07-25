-- ─── Grooming slot booking — Slice 3 (owner-confirm lifecycle) ───────────────
--
-- Lets a CUSTOMER book a grooming slot (lands 'pending'), the OWNER confirm/decline
-- from a role-agnostic "My bookings" surface, with reliable notifications, an owner
-- reminder, and appointment-relative auto-expiry that frees the slot.
--
-- WHY A MIGRATION (not OTA): the provider appointment/profile read+update policies
-- are gated on get_my_role()='provider'. Grooming owners are role='customer'
-- (Slice-1 role-trap avoidance), so they cannot see or manage their own bookings.
-- This migration grants that access via ADDITIVE, ownership-keyed policies — the
-- existing role='provider' policies are left byte-for-byte intact, so every health
-- provider path behaves identically.
--
-- WHAT THIS ADDS
--   1. appointments.reminded_at (nullable) — one-shot reminder guard; health ignores it.
--   2. Additive owner SELECT + UPDATE policies on appointments (facility ownership).
--   3. Additive, NARROWLY-scoped owner SELECT policy on profiles (only the caller's
--      OWN booking-customers — same EXISTS predicate as "providers read customer
--      push token", minus the role prefix).
--   4. insert_notification: ADD a customer→owner branch (new-booking inbox row);
--      existing admin + owner→customer branches preserved exactly.
--   5. grooming_notif_text() — server-side i18n (9 langs) for cron-sent messages.
--   6. process_grooming_pending() — owner reminder (once, ~1h before expiry) +
--      auto-decline of stale requests. Sets 'cancelled' on expiry (existing CHECK
--      value → no CHECK change), which leaves the partial active-slot unique index
--      → the slot is freed. expire_at = GREATEST(requested_time − 6h, created_at + 2h).
--   7. cron.schedule('grooming-pending-processor', '*/15 * * * *', …).
--
-- PRECONDITION: pg_cron + pg_net installed (verified live). APPLY BEFORE the OTA.
-- Idempotent / safe to re-run (drop-then-create; IF NOT EXISTS; unschedule-then-schedule).

BEGIN;

-- ─── 1. Reminder guard column ────────────────────────────────────────────────
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS reminded_at timestamptz;

-- ─── 2. Owner appointment access (ADDITIVE; role='provider' policies untouched) ─
DROP POLICY IF EXISTS "owner read facility appointments" ON public.appointments;
CREATE POLICY "owner read facility appointments" ON public.appointments
  FOR SELECT TO public
  USING (facility_id IN (SELECT my_provider_facility_ids()));

DROP POLICY IF EXISTS "owner update facility appointments" ON public.appointments;
CREATE POLICY "owner update facility appointments" ON public.appointments
  FOR UPDATE TO public
  USING (facility_id IN (SELECT my_provider_facility_ids()))
  WITH CHECK (facility_id IN (SELECT my_provider_facility_ids())
              AND status = ANY (ARRAY['confirmed'::text, 'cancelled'::text, 'completed'::text]));
  -- 'no_show' deliberately excluded from WITH CHECK → must route through
  -- record_no_show() so the customer strike is still recorded. Also blocks an
  -- owner from reverting a row to 'pending'.

-- ─── 3. Owner profile read — NARROW: only the caller's own booking-customers ──
-- Same EXISTS predicate as "providers read customer push token", minus the role
-- prefix. A row is readable ONLY if that profile is the customer of an appointment
-- at a facility the caller owns — never broad profile access.
DROP POLICY IF EXISTS "owner read booking customer profile" ON public.profiles;
CREATE POLICY "owner read booking customer profile" ON public.profiles
  FOR SELECT TO public
  USING (EXISTS (
    SELECT 1 FROM appointments a JOIN facilities f ON a.facility_id = f.id
    WHERE a.customer_id = profiles.id
      AND f.provider_id = auth.uid()
  ));

-- ─── 4. insert_notification — ADD customer→owner branch ──────────────────────
CREATE OR REPLACE FUNCTION public.insert_notification(p_user_id uuid, p_title text, p_body text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Admins can notify anyone. (unchanged)
  IF EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    INSERT INTO notifications (user_id, title, body) VALUES (p_user_id, p_title, p_body);
    RETURN;
  END IF;

  -- Owner/provider → a customer who holds an appointment at their facility. (unchanged)
  IF EXISTS (
    SELECT 1 FROM appointments a
    JOIN facilities f ON f.id = a.facility_id
    WHERE a.customer_id = p_user_id
      AND f.provider_id = auth.uid()
  ) THEN
    INSERT INTO notifications (user_id, title, body) VALUES (p_user_id, p_title, p_body);
    RETURN;
  END IF;

  -- NEW: customer → the OWNER of a facility where the caller holds an appointment.
  IF EXISTS (
    SELECT 1 FROM appointments a
    JOIN facilities f ON f.id = a.facility_id
    WHERE a.customer_id = auth.uid()
      AND f.provider_id = p_user_id
  ) THEN
    INSERT INTO notifications (user_id, title, body) VALUES (p_user_id, p_title, p_body);
    RETURN;
  END IF;

  RAISE EXCEPTION 'permission denied';
END;
$function$;

-- ─── 5. Server-side i18n for cron messages (recipient's language, EN fallback) ─
-- remTitle/remBody → owner reminder; expTitle/expBody → customer auto-expiry.
-- p_lang is profiles.preferred_language ('English','Turkish',…). {name} placeholder
-- in expBody is substituted by the caller.
CREATE OR REPLACE FUNCTION public.grooming_notif_text(p_key text, p_lang text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path = public
AS $function$
  SELECT coalesce(
    (SELECT txt FROM (VALUES
      ('remTitle','English','Booking awaiting confirmation'),
      ('remTitle','Turkish','Onay bekleyen randevu'),
      ('remTitle','Arabic','حجز بانتظار التأكيد'),
      ('remTitle','Russian','Запись ожидает подтверждения'),
      ('remTitle','Greek','Κράτηση σε αναμονή επιβεβαίωσης'),
      ('remTitle','French','Réservation en attente de confirmation'),
      ('remTitle','Spanish','Reserva pendiente de confirmación'),
      ('remTitle','German','Buchung wartet auf Bestätigung'),
      ('remTitle','Persian','رزرو در انتظار تأیید'),

      ('remBody','English','A booking request is still awaiting your confirmation.'),
      ('remBody','Turkish','Bir randevu talebi hâlâ onayınızı bekliyor.'),
      ('remBody','Arabic','لا يزال طلب حجز بانتظار تأكيدك.'),
      ('remBody','Russian','Запрос на запись всё ещё ожидает вашего подтверждения.'),
      ('remBody','Greek','Ένα αίτημα κράτησης αναμένει ακόμη την επιβεβαίωσή σας.'),
      ('remBody','French','Une demande de réservation attend toujours votre confirmation.'),
      ('remBody','Spanish','Una solicitud de reserva sigue esperando tu confirmación.'),
      ('remBody','German','Eine Buchungsanfrage wartet noch auf deine Bestätigung.'),
      ('remBody','Persian','یک درخواست رزرو هنوز در انتظار تأیید شماست.'),

      ('expTitle','English','Booking not confirmed'),
      ('expTitle','Turkish','Randevu onaylanmadı'),
      ('expTitle','Arabic','لم يتم تأكيد الحجز'),
      ('expTitle','Russian','Запись не подтверждена'),
      ('expTitle','Greek','Η κράτηση δεν επιβεβαιώθηκε'),
      ('expTitle','French','Réservation non confirmée'),
      ('expTitle','Spanish','Reserva no confirmada'),
      ('expTitle','German','Buchung nicht bestätigt'),
      ('expTitle','Persian','رزرو تأیید نشد'),

      ('expBody','English','Your request at {name} expired because it wasn''t confirmed in time. The slot is free again.'),
      ('expBody','Turkish','{name} için talebiniz zamanında onaylanmadığı için sona erdi. Saat yeniden müsait.'),
      ('expBody','Arabic','انتهت صلاحية طلبك في {name} لعدم تأكيده في الوقت المناسب. الموعد متاح مجددًا.'),
      ('expBody','Russian','Ваш запрос в {name} истёк, так как не был вовремя подтверждён. Слот снова свободен.'),
      ('expBody','Greek','Το αίτημά σας στο {name} έληξε επειδή δεν επιβεβαιώθηκε έγκαιρα. Η ώρα είναι ξανά διαθέσιμη.'),
      ('expBody','French','Votre demande chez {name} a expiré faute de confirmation à temps. Le créneau est de nouveau libre.'),
      ('expBody','Spanish','Tu solicitud en {name} expiró porque no se confirmó a tiempo. El turno vuelve a estar libre.'),
      ('expBody','German','Deine Anfrage bei {name} ist abgelaufen, da sie nicht rechtzeitig bestätigt wurde. Der Termin ist wieder frei.'),
      ('expBody','Persian','درخواست شما در {name} چون به‌موقع تأیید نشد منقضی شد. این زمان دوباره آزاد است.')
    ) AS m(k, l, txt)
    WHERE m.k = p_key AND m.l = coalesce(p_lang, 'English')),
    -- English fallback when the language is missing/unknown.
    (SELECT txt FROM (VALUES
      ('remTitle','Booking awaiting confirmation'),
      ('remBody','A booking request is still awaiting your confirmation.'),
      ('expTitle','Booking not confirmed'),
      ('expBody','Your request at {name} expired because it wasn''t confirmed in time. The slot is free again.')
    ) AS f(k, txt) WHERE f.k = p_key)
  );
$function$;

-- ─── 6. Pending processor: reminder (once, ~1h pre-expiry) + auto-decline ────
CREATE OR REPLACE FUNCTION public.process_grooming_pending() RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  r         record;
  expire_at timestamptz;
  tok       text;
  plang     text;
  ttl       text;
  bdy       text;
BEGIN
  FOR r IN
    SELECT a.id, a.customer_id, a.requested_time, a.created_at, a.reminded_at,
           f.provider_id, f.name AS facility_name
    FROM appointments a
    JOIN facilities f ON f.id = a.facility_id
    WHERE a.status = 'pending' AND f.type = 'grooming'
  LOOP
    -- Decision 4: expire at (slot − 6h) OR (booking + 2h), whichever is LATER,
    -- so a last-minute booking still gets ≥2h of grace before auto-decline.
    expire_at := greatest(r.requested_time - interval '6 hours',
                          r.created_at     + interval '2 hours');

    IF now() >= expire_at THEN
      -- Auto-decline. `AND status='pending'` guards a race with an owner confirm.
      -- 'cancelled' leaves the partial active-slot unique index → slot freed.
      UPDATE appointments SET status = 'cancelled'
        WHERE id = r.id AND status = 'pending';

      SELECT push_token, preferred_language INTO tok, plang
        FROM profiles WHERE id = r.customer_id;
      ttl := grooming_notif_text('expTitle', plang);
      bdy := replace(grooming_notif_text('expBody', plang), '{name}', r.facility_name);
      INSERT INTO notifications (user_id, title, body) VALUES (r.customer_id, ttl, bdy);
      IF tok IS NOT NULL THEN
        PERFORM net.http_post(
          url     := 'https://exp.host/--/api/v2/push/send',
          body    := jsonb_build_object('to', tok, 'title', ttl, 'body', bdy, 'sound', 'default'),
          headers := jsonb_build_object('Content-Type', 'application/json'));
      END IF;

    ELSIF r.reminded_at IS NULL AND now() >= (expire_at - interval '1 hour') THEN
      -- One owner nudge ~1h before auto-decline; reminded_at makes it one-shot.
      UPDATE appointments SET reminded_at = now() WHERE id = r.id;

      SELECT push_token, preferred_language INTO tok, plang
        FROM profiles WHERE id = r.provider_id;
      ttl := grooming_notif_text('remTitle', plang);
      bdy := grooming_notif_text('remBody', plang);
      INSERT INTO notifications (user_id, title, body) VALUES (r.provider_id, ttl, bdy);
      IF tok IS NOT NULL THEN
        PERFORM net.http_post(
          url     := 'https://exp.host/--/api/v2/push/send',
          body    := jsonb_build_object('to', tok, 'title', ttl, 'body', bdy, 'sound', 'default'),
          headers := jsonb_build_object('Content-Type', 'application/json'));
      END IF;
    END IF;
  END LOOP;
END;
$function$;

COMMIT;

-- ─── 7. Schedule every 15 min (outside the txn; unschedule-then-schedule = idempotent) ─
DO $$
BEGIN
  PERFORM cron.unschedule('grooming-pending-processor');
EXCEPTION WHEN OTHERS THEN
  NULL;  -- not yet scheduled
END $$;
SELECT cron.schedule('grooming-pending-processor', '*/15 * * * *',
  $$ SELECT process_grooming_pending(); $$);

-- ─── Verification (run after applying) ───────────────────────────────────────
--   -- (i) Cron job registered:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'grooming-pending-processor';
--   -- expect: grooming-pending-processor | */15 * * * * | t
--
--   -- (ii) Dry run is safe/idempotent (no pending grooming rows yet → no-op):
--   SELECT process_grooming_pending();
--
--   -- (iii) New policies exist:
--   SELECT policyname FROM pg_policies WHERE tablename='appointments'
--     AND policyname LIKE 'owner %';                       -- 2 rows
--   SELECT policyname FROM pg_policies WHERE tablename='profiles'
--     AND policyname='owner read booking customer profile';-- 1 row
--
--   -- (iv) Health provider policies still present & unchanged:
--   SELECT policyname FROM pg_policies WHERE tablename='appointments'
--     AND policyname IN ('provider read facility appointments','provider update facility appointments');
--
--   -- (v) i18n helper resolves + falls back:
--   SELECT grooming_notif_text('remTitle','Turkish');   -- 'Onay bekleyen randevu'
--   SELECT grooming_notif_text('expTitle','Klingon');   -- English fallback

-- ─── Rollback ────────────────────────────────────────────────────────────────
--   DO $$ BEGIN PERFORM cron.unschedule('grooming-pending-processor'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
--   DROP FUNCTION IF EXISTS public.process_grooming_pending();
--   DROP FUNCTION IF EXISTS public.grooming_notif_text(text, text);
--   DROP POLICY IF EXISTS "owner read booking customer profile" ON public.profiles;
--   DROP POLICY IF EXISTS "owner update facility appointments" ON public.appointments;
--   DROP POLICY IF EXISTS "owner read facility appointments" ON public.appointments;
--   ALTER TABLE public.appointments DROP COLUMN IF EXISTS reminded_at;
--   -- restore insert_notification to the pre-Slice-3 body (capture_3, without the
--   -- customer→owner branch).
