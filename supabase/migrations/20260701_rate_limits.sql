-- ── Rate limits & trial expiry enforcement ────────────────────────────────────


-- ── 1. Block new bookings to facilities with an expired trial ─────────────────
-- The client-side gate in App.js already blocks the provider dashboard, but a
-- customer could still book with an expired-trial facility without this check.

CREATE POLICY "appointments_no_expired_trial" ON appointments
  FOR INSERT WITH CHECK (
    NOT EXISTS (
      SELECT 1 FROM facilities
      WHERE id = facility_id
        AND status = 'trial'
        AND trial_ends_at IS NOT NULL
        AND trial_ends_at < now()
    )
  );


-- ── 2. Rate-limit pending appointments per customer (max 10) ──────────────────

CREATE OR REPLACE FUNCTION check_pending_appointment_limit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (
    SELECT COUNT(*) FROM appointments
    WHERE customer_id = NEW.customer_id
      AND status = 'pending'
  ) >= 10 THEN
    RAISE EXCEPTION 'Too many pending appointments. Please wait for existing requests to be reviewed.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_pending_appointment_limit
  BEFORE INSERT ON appointments
  FOR EACH ROW EXECUTE FUNCTION check_pending_appointment_limit();


-- ── 3. Rate-limit open questions per customer per facility (max 3) ────────────

CREATE OR REPLACE FUNCTION check_question_limit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (
    SELECT COUNT(*) FROM questions q
    WHERE q.customer_id = NEW.customer_id
      AND q.facility_id = NEW.facility_id
      AND NOT EXISTS (SELECT 1 FROM answers a WHERE a.question_id = q.id)
  ) >= 3 THEN
    RAISE EXCEPTION 'You already have 3 unanswered questions at this facility.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_question_limit
  BEFORE INSERT ON questions
  FOR EACH ROW EXECUTE FUNCTION check_question_limit();
