-- ─── FIX S2 — pin search_path on the remaining SECURITY DEFINER functions ────
--
-- A SECURITY DEFINER function runs with the owner's privileges. Without a pinned
-- search_path, a caller who can create objects in a schema earlier on the search
-- path could shadow an unqualified table/function the definer references, and the
-- elevated function would execute the attacker's object. Pinning
-- `SET search_path TO 'public'` (pg_catalog is always searched implicitly, so
-- built-ins still resolve) closes this. Lower severity than S1 (needs specific
-- setup), same family, trivial fix, and it clears Supabase's
-- function_search_path_mutable linter warning.
--
-- SCOPE — the exact set. Of the 18 SECURITY DEFINER functions in `public`
-- (per 20260718_capture_3_functions.sql), 14 already pin search_path and every
-- post-capture 20260719_* definer function does too. These are the ONLY four
-- missing it:
--   • is_customer_blocked()        — used in appointments RLS
--   • my_provider_facility_ids()   — used in appointments/quiz RLS
--   • record_no_show(uuid)         — provider no-show RPC
--   • update_pharmacist_score()    — quiz_submissions status trigger
--
-- Each function below is byte-for-byte its current definition with ONE line added
-- (`SET search_path TO 'public'`). Bodies, signatures, return types, SECURITY
-- DEFINER, volatility, and grants are unchanged. SECURITY DEFINER is kept — these
-- need it.

BEGIN;

-- 1) is_customer_blocked() — reads profiles under definer rights for RLS.
CREATE OR REPLACE FUNCTION public.is_customer_blocked()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND blocked_until IS NOT NULL
      AND blocked_until > now()
  )
$function$;

-- 2) my_provider_facility_ids() — resolves the caller's owned facilities for RLS.
CREATE OR REPLACE FUNCTION public.my_provider_facility_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT id FROM facilities WHERE provider_id = auth.uid()
$function$;

-- 3) record_no_show(p_appointment_id uuid) — provider marks a confirmed
--    appointment as no-show and applies a strike.
CREATE OR REPLACE FUNCTION public.record_no_show(p_appointment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_customer_id uuid;
BEGIN
  SELECT a.customer_id INTO v_customer_id
  FROM appointments a
  JOIN facilities f ON f.id = a.facility_id
  WHERE a.id = p_appointment_id
    AND f.provider_id = auth.uid()
    AND a.status = 'confirmed';

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized or appointment not found';
  END IF;

  UPDATE appointments SET status = 'no_show' WHERE id = p_appointment_id;

  UPDATE profiles
  SET
    strikes = strikes + 1,
    blocked_until = CASE
      WHEN strikes + 1 >= 3 THEN now() + interval '7 days'
      ELSE blocked_until
    END
  WHERE id = v_customer_id;
END;
$function$;

-- 4) update_pharmacist_score() — quiz_submissions status-change trigger.
CREATE OR REPLACE FUNCTION public.update_pharmacist_score()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  response_mins float;
  points int;
BEGIN
  IF NEW.status = 'approved' AND OLD.status = 'pending' THEN
    response_mins := EXTRACT(EPOCH FROM (now() - OLD.created_at)) / 60.0;
    IF    response_mins <= 5  THEN points := 10;
    ELSIF response_mins <= 15 THEN points := 7;
    ELSE                           points := 5;
    END IF;
    NEW.reviewed_at := now();
    INSERT INTO pharmacist_scores (facility_id, total_points, total_reviews, avg_response_mins)
      VALUES (NEW.assigned_facility_id, points, 1, response_mins)
    ON CONFLICT (facility_id) DO UPDATE SET
      total_points      = pharmacist_scores.total_points + points,
      total_reviews     = pharmacist_scores.total_reviews + 1,
      avg_response_mins = (pharmacist_scores.avg_response_mins * pharmacist_scores.total_reviews + response_mins)
                          / (pharmacist_scores.total_reviews + 1),
      updated_at        = now();
  ELSIF NEW.status = 'timed_out' AND OLD.status = 'pending' THEN
    INSERT INTO pharmacist_scores (facility_id, total_points, total_reviews, avg_response_mins)
      VALUES (NEW.assigned_facility_id, 0, 0, 0)
    ON CONFLICT (facility_id) DO UPDATE SET
      total_points = GREATEST(0, pharmacist_scores.total_points - 5),
      updated_at   = now();
  END IF;
  RETURN NEW;
END;
$function$;

COMMIT;

-- ─── Rollback ────────────────────────────────────────────────────────────────
-- Recreates the four functions WITHOUT the search_path clause (re-opens the S2
-- search-path-shadowing gap). Bodies identical.
--
--   BEGIN;
--   CREATE OR REPLACE FUNCTION public.is_customer_blocked()
--    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
--   AS $function$
--     SELECT EXISTS (
--       SELECT 1 FROM profiles
--       WHERE id = auth.uid() AND blocked_until IS NOT NULL AND blocked_until > now()
--     )
--   $function$;
--
--   CREATE OR REPLACE FUNCTION public.my_provider_facility_ids()
--    RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER
--   AS $function$
--     SELECT id FROM facilities WHERE provider_id = auth.uid()
--   $function$;
--
--   CREATE OR REPLACE FUNCTION public.record_no_show(p_appointment_id uuid)
--    RETURNS void LANGUAGE plpgsql SECURITY DEFINER
--   AS $function$
--   DECLARE v_customer_id uuid;
--   BEGIN
--     SELECT a.customer_id INTO v_customer_id
--     FROM appointments a JOIN facilities f ON f.id = a.facility_id
--     WHERE a.id = p_appointment_id AND f.provider_id = auth.uid() AND a.status = 'confirmed';
--     IF v_customer_id IS NULL THEN RAISE EXCEPTION 'Not authorized or appointment not found'; END IF;
--     UPDATE appointments SET status = 'no_show' WHERE id = p_appointment_id;
--     UPDATE profiles SET strikes = strikes + 1,
--       blocked_until = CASE WHEN strikes + 1 >= 3 THEN now() + interval '7 days' ELSE blocked_until END
--     WHERE id = v_customer_id;
--   END;
--   $function$;
--
--   CREATE OR REPLACE FUNCTION public.update_pharmacist_score()
--    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
--   AS $function$
--   DECLARE response_mins float; points int;
--   BEGIN
--     IF NEW.status = 'approved' AND OLD.status = 'pending' THEN
--       response_mins := EXTRACT(EPOCH FROM (now() - OLD.created_at)) / 60.0;
--       IF    response_mins <= 5  THEN points := 10;
--       ELSIF response_mins <= 15 THEN points := 7;
--       ELSE                           points := 5;
--       END IF;
--       NEW.reviewed_at := now();
--       INSERT INTO pharmacist_scores (facility_id, total_points, total_reviews, avg_response_mins)
--         VALUES (NEW.assigned_facility_id, points, 1, response_mins)
--       ON CONFLICT (facility_id) DO UPDATE SET
--         total_points      = pharmacist_scores.total_points + points,
--         total_reviews     = pharmacist_scores.total_reviews + 1,
--         avg_response_mins = (pharmacist_scores.avg_response_mins * pharmacist_scores.total_reviews + response_mins)
--                             / (pharmacist_scores.total_reviews + 1),
--         updated_at        = now();
--     ELSIF NEW.status = 'timed_out' AND OLD.status = 'pending' THEN
--       INSERT INTO pharmacist_scores (facility_id, total_points, total_reviews, avg_response_mins)
--         VALUES (NEW.assigned_facility_id, 0, 0, 0)
--       ON CONFLICT (facility_id) DO UPDATE SET
--         total_points = GREATEST(0, pharmacist_scores.total_points - 5),
--         updated_at   = now();
--     END IF;
--     RETURN NEW;
--   END;
--   $function$;
--   COMMIT;
