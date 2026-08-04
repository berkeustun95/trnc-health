-- ─── Report-a-facility — extend UGC moderation to facility listings ───────────
-- Mirrors review moderation (20260712_ugc_moderation.sql). Covers ALL facility
-- types uniformly (health/grooming/garage/home-service) — a report on a listing
-- covers its photos+description by covering the row. REUSES the content_reports
-- table, its rate-limit + UNIQUE, the guard_moderation_columns(TG_ARGV) fn, and
-- the auto_hide_on_report trigger fn.
--
-- SET ROLE postgres: ALTER TABLE facilities + CREATE TRIGGER/POLICY on facilities
-- need the table owner. Run this with editor impersonation OFF (as postgres) — if
-- current_user reads as 'authenticated', the editor is impersonating and SET ROLE
-- will fail 'must be owner'; turn impersonation off first. Same wrapper as
-- 20260805_city / 20260806_area. No GUC needed: auto-hide is permitted by the
-- guard's own justification check (3+ reporters), exactly like reviews.
--
-- APPLIED clean 2026-08-03 (as postgres): verify showed visible = total = 399,
-- zero facilities hidden — the restrictive SELECT filter is additive.

SET ROLE postgres;
BEGIN;

-- 1. Widen the report CHECK — reuses the whole content_reports machinery.
ALTER TABLE public.content_reports DROP CONSTRAINT IF EXISTS content_reports_content_type_check;
ALTER TABLE public.content_reports ADD CONSTRAINT content_reports_content_type_check
  CHECK (content_type IN ('review', 'question', 'answer', 'facility'));

-- 2. Moderation columns on facilities (mirror reviews exactly).
ALTER TABLE public.facilities ADD COLUMN IF NOT EXISTS hidden_at     timestamptz;
ALTER TABLE public.facilities ADD COLUMN IF NOT EXISTS hidden_reason text;

-- 3. Guard: only admin hides/unhides, EXCEPT visible→auto-hidden at 3+ reporters.
--    Binds the EXISTING guard_moderation_columns fn — no new function.
DROP TRIGGER IF EXISTS guard_facility_moderation ON public.facilities;
CREATE TRIGGER guard_facility_moderation
  BEFORE UPDATE ON public.facilities
  FOR EACH ROW EXECUTE FUNCTION guard_moderation_columns('facility');

-- 4. Auto-hide at 3 distinct reporters — add a 'facility' branch. review/question/
--    answer branches are byte-for-byte from 20260712 §8.
CREATE OR REPLACE FUNCTION auto_hide_reported_content()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int;
BEGIN
  SELECT count(DISTINCT reporter_id) INTO v_count
  FROM content_reports
  WHERE content_type = NEW.content_type AND content_id = NEW.content_id;

  IF v_count < 3 THEN RETURN NEW; END IF;

  IF NEW.content_type = 'review' THEN
    UPDATE reviews    SET hidden_at = now(), hidden_reason = 'auto_reports' WHERE id = NEW.content_id AND hidden_at IS NULL;
  ELSIF NEW.content_type = 'question' THEN
    UPDATE questions  SET hidden_at = now(), hidden_reason = 'auto_reports' WHERE id = NEW.content_id AND hidden_at IS NULL;
  ELSIF NEW.content_type = 'answer' THEN
    UPDATE answers    SET hidden_at = now(), hidden_reason = 'auto_reports' WHERE id = NEW.content_id AND hidden_at IS NULL;
  ELSIF NEW.content_type = 'facility' THEN
    UPDATE facilities SET hidden_at = now(), hidden_reason = 'auto_reports' WHERE id = NEW.content_id AND hidden_at IS NULL;
  END IF;

  RETURN NEW;
END;
$$;
-- The auto_hide_on_report trigger on content_reports is already bound; C-O-R keeps it.

-- 5. SELECT visibility — SEPARATE RESTRICTIVE policy. The existing permissive read
--    policy is UNTOUCHED; this only ANDs `hidden_at IS NULL` onto public reads.
DROP POLICY IF EXISTS "facilities_hide_reported" ON public.facilities;
CREATE POLICY "facilities_hide_reported" ON public.facilities
  AS RESTRICTIVE FOR SELECT
  USING (
    hidden_at IS NULL
    OR provider_id = auth.uid()   -- owner still sees their own hidden listing
    OR is_admin()                 -- admin sees everything, including hidden
  );

COMMIT;
RESET ROLE;

-- Verify:  SELECT count(*) FILTER (WHERE hidden_at IS NULL) AS visible, count(*) FROM facilities;  -- visible == total today
-- Rollback:
--   SET ROLE postgres;
--   BEGIN;
--   DROP POLICY IF EXISTS "facilities_hide_reported" ON public.facilities;
--   DROP TRIGGER IF EXISTS guard_facility_moderation ON public.facilities;
--   ALTER TABLE public.facilities DROP COLUMN IF EXISTS hidden_reason, DROP COLUMN IF EXISTS hidden_at;
--   ALTER TABLE public.content_reports DROP CONSTRAINT IF EXISTS content_reports_content_type_check;
--   ALTER TABLE public.content_reports ADD CONSTRAINT content_reports_content_type_check
--     CHECK (content_type IN ('review','question','answer'));
--   -- restore auto_hide_reported_content() body without the facility branch (20260712 §8);
--   COMMIT;
--   RESET ROLE;
