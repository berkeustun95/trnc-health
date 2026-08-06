-- ─── Content filter parity on facility_change_requests (submit-time) ──────────
-- Health owners don't write facilities directly — they submit edits as a
-- proposed_changes jsonb blob into facility_change_requests, and admin approval
-- later writes them to facilities. That means the facilities content filter
-- (check_facility_content) only fires at APPROVE time: bad content sits queued,
-- the admin has to discover + reject it, and the owner gets no immediate feedback.
--
-- This adds the SAME filter at SUBMIT time so the owner self-corrects. It REUSES
-- contains_blocked_term + contains_payment_solicitation UNCHANGED, and RAISEs the
-- SAME codes (BLOCKED_TERM / BLOCKED_PAYMENT) → the existing client
-- moderationErrorKey mapping + i18n (contentBlockedTerm / contentPaymentBlocked)
-- apply with no new strings.
--
-- ADDITIVE: does NOT touch check_facility_content on facilities — that stays as
-- the approval-time backstop. No admin exemption and no app.trusted_facility_write
-- check — content is ALWAYS checked, matching the facilities precedent.
--
-- All jsonb string values are concatenated (not a whitelist): the filter is
-- conservative, so phone numbers and the languages list ("English, Turkish")
-- don't trip it, and this stays correct if a new free-text key is ever added.
--
-- Idempotent (CREATE OR REPLACE; DROP TRIGGER IF EXISTS). Apply in Supabase
-- (SQL-editor Role dropdown = postgres) BEFORE publishing the OTA. No native build.

BEGIN;

CREATE OR REPLACE FUNCTION public.check_change_request_content()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_text text;
BEGIN
  -- Concatenate every string value in the proposed_changes blob.
  SELECT string_agg(value, '  ')
    INTO v_text
    FROM jsonb_each_text(NEW.proposed_changes);

  IF contains_blocked_term(v_text) THEN
    RAISE EXCEPTION 'BLOCKED_TERM';
  END IF;
  IF contains_payment_solicitation(v_text) THEN
    RAISE EXCEPTION 'BLOCKED_PAYMENT';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_change_request_content ON public.facility_change_requests;
CREATE TRIGGER check_change_request_content
  BEFORE INSERT OR UPDATE ON public.facility_change_requests
  FOR EACH ROW EXECUTE FUNCTION public.check_change_request_content();

COMMIT;

-- ─── Verification (run after applying) ───────────────────────────────────────
--   -- Blocked payment content → FAILS with BLOCKED_PAYMENT:
--   INSERT INTO facility_change_requests (facility_id, provider_id, proposed_changes)
--   VALUES ('<facility_id>', auth.uid(),
--           '{"description":"Pay me by bank transfer: TR33 0006 1005 1978 6457 8413 26"}');
--   -- Profanity → FAILS with BLOCKED_TERM:
--   INSERT INTO facility_change_requests (facility_id, provider_id, proposed_changes)
--   VALUES ('<facility_id>', auth.uid(), '{"description":"this place is shit"}');
--   -- Clean content → succeeds:
--   INSERT INTO facility_change_requests (facility_id, provider_id, proposed_changes)
--   VALUES ('<facility_id>', auth.uid(),
--           '{"description":"Open Mon-Fri, English and Turkish spoken","phone":"05330000000"}');

-- ─── Rollback ────────────────────────────────────────────────────────────────
--   BEGIN;
--   DROP TRIGGER IF EXISTS check_change_request_content ON public.facility_change_requests;
--   DROP FUNCTION IF EXISTS public.check_change_request_content();
--   COMMIT;
