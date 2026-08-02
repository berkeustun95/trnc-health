-- ─── Garage booking lifecycle — Slice 2b (additive twin of process_grooming_pending) ─
--
-- Owner reminder (~1h pre-expiry) + appointment-relative auto-decline that frees the
-- slot, for garage bookings. The ONLY difference from the grooming twin is the
-- `f.type = 'garage'` filter.
--
-- REUSES (does NOT edit): appointments.reminded_at, the owner RLS policies
-- (ownership-keyed, already cover garages), insert_notification, and
-- grooming_notif_text() (service-neutral copy — read-only call, never modified).
-- Grooming's process_grooming_pending() + its cron job are left byte-for-byte intact.
--
-- EXECUTION NOTE: the Supabase SQL editor runs as current_user='authenticated'
-- (session_user='postgres'), which lacks CREATE on schema public → CREATE FUNCTION
-- fails with "permission denied for schema public". SET ROLE postgres switches to a
-- role that can create it (session_user is postgres, so the switch is permitted) and
-- makes postgres the function OWNER — correct for a SECURITY DEFINER cron function.
-- RESET ROLE restores the session at the end. Mirrors 20260731_garages_directory.sql.
--
-- PRECONDITION: pg_cron + pg_net installed (verified live).
-- Idempotent / safe to re-run (drop-then-create; unschedule-then-schedule).

SET ROLE postgres;

BEGIN;

CREATE OR REPLACE FUNCTION public.process_garage_pending() RETURNS void
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
    WHERE a.status = 'pending' AND f.type = 'garage'      -- ← only difference from grooming twin
  LOOP
    -- Expire at (slot − 6h) OR (booking + 2h), whichever is LATER, so a last-minute
    -- booking still gets ≥2h of grace before auto-decline.
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

-- ─── Schedule every 15 min (outside the txn; unschedule-then-schedule = idempotent) ─
DO $$
BEGIN
  PERFORM cron.unschedule('garage-pending-processor');
EXCEPTION WHEN OTHERS THEN
  NULL;  -- not yet scheduled
END $$;
SELECT cron.schedule('garage-pending-processor', '*/15 * * * *',
  $$ SELECT process_garage_pending(); $$);

RESET ROLE;

-- ─── Verification (run after applying) ───────────────────────────────────────
--   -- (i) Cron job registered:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'garage-pending-processor';
--   -- expect: garage-pending-processor | */15 * * * * | t
--
--   -- (ii) Dry run is safe/idempotent (no pending garage rows yet → no-op):
--   SELECT process_garage_pending();
--
--   -- (iii) Grooming processor + cron STILL intact (byte-for-byte untouched):
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'grooming-pending-processor';
--   SELECT proname FROM pg_proc WHERE proname = 'process_grooming_pending';
--
--   -- (iv) Function owned by postgres (SECURITY DEFINER runs with full privileges):
--   SELECT proname, pg_get_userbyid(proowner) FROM pg_proc WHERE proname = 'process_garage_pending';
--   -- expect: process_garage_pending | postgres

-- ─── Rollback ────────────────────────────────────────────────────────────────
--   SET ROLE postgres;
--   DO $$ BEGIN PERFORM cron.unschedule('garage-pending-processor'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
--   DROP FUNCTION IF EXISTS public.process_garage_pending();
--   RESET ROLE;
