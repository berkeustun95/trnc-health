-- ── Security Fixes ────────────────────────────────────────────────────────────
-- Addresses: insert_notification auth, duplicate reviews,
-- past-date bookings, and account deletion RPC.
--
-- NOTE: profiles table already has RLS enabled with existing policies.
-- Verify the "owner update" policy has WITH CHECK that prevents role
-- self-promotion: role = (SELECT role FROM profiles WHERE id = auth.uid())


-- ── 1. Fix insert_notification() — restrict to admin and provider roles ───────
-- Previously any authenticated user could send a notification to any other user.

CREATE OR REPLACE FUNCTION public.insert_notification(
  p_user_id uuid,
  p_title   text,
  p_body    text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Admins can notify anyone.
  IF EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    INSERT INTO notifications (user_id, title, body) VALUES (p_user_id, p_title, p_body);
    RETURN;
  END IF;

  -- Providers can only notify customers who have an appointment at their facility.
  IF EXISTS (
    SELECT 1 FROM appointments a
    JOIN facilities f ON f.id = a.facility_id
    WHERE a.customer_id = p_user_id
      AND f.provider_id = auth.uid()
  ) THEN
    INSERT INTO notifications (user_id, title, body) VALUES (p_user_id, p_title, p_body);
    RETURN;
  END IF;

  RAISE EXCEPTION 'permission denied';
END;
$$;


-- ── 3. Prevent duplicate reviews per customer per facility ────────────────────
-- Without this, a customer with multiple bookings at the same facility
-- could submit multiple ratings, skewing the average.

ALTER TABLE reviews
  ADD CONSTRAINT reviews_customer_facility_unique
  UNIQUE (customer_id, facility_id);


-- ── 4. Reject past-date appointments at DB level ──────────────────────────────
-- The UI uses minimumDate but a crafted request bypasses it.

ALTER TABLE appointments
  ADD CONSTRAINT appointments_requested_time_future
  CHECK (requested_time > now()) NOT VALID;


-- ── 5. Account deletion RPC ───────────────────────────────────────────────────
-- Called by ProfileScreen when user deletes their account.
-- Cleans up all user data before removing the auth record.

CREATE OR REPLACE FUNCTION public.delete_own_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_fids uuid[];
BEGIN
  -- Collect all facilities owned by this provider
  SELECT ARRAY(SELECT id FROM facilities WHERE provider_id = auth.uid())
  INTO v_fids;

  -- Clear child rows before deleting facilities (avoids FK violations)
  IF array_length(v_fids, 1) > 0 THEN
    DELETE FROM appointments             WHERE facility_id = ANY(v_fids);
    DELETE FROM reviews                  WHERE facility_id = ANY(v_fids);
    DELETE FROM questions                WHERE facility_id = ANY(v_fids);
    DELETE FROM quiz_submissions         WHERE assigned_facility_id = ANY(v_fids);
    DELETE FROM duty_schedule            WHERE facility_id = ANY(v_fids);
    DELETE FROM facility_change_requests WHERE facility_id = ANY(v_fids);
    DELETE FROM claim_requests           WHERE facility_id = ANY(v_fids);
    -- provider_documents + provider_credentials have ON DELETE CASCADE
    DELETE FROM facilities               WHERE id = ANY(v_fids);
  END IF;

  -- Clear customer-side data
  DELETE FROM notifications WHERE user_id     = auth.uid();
  DELETE FROM reviews       WHERE customer_id = auth.uid();
  DELETE FROM appointments  WHERE customer_id = auth.uid();
  DELETE FROM profiles      WHERE id          = auth.uid();
  DELETE FROM auth.users    WHERE id          = auth.uid();
END;
$$;
