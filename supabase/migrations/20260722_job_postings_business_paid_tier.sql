-- ─── Monetization Bucket A — business paid job postings ─────────────────────
--
-- Businesses pay for job postings; individuals post free. Payment is entirely
-- OFF-APP: bank transfer, manual admin activation. There is no payment SDK and
-- no in-app purchase.
--
-- CRITICAL: payment_status is a BACKEND/ADMIN concept. It is never rendered in
-- the consumer app — the poster-facing dashboard collapses both 'pending
-- content review' and 'awaiting_payment' into a single "Under review" label.
-- This is an App Store anti-steering requirement (iOS 3.1.1), not a UX choice.
-- Do not add pricing, payment or bank-transfer text to any consumer screen.
--
-- This builds on the pipeline that already exists:
--   • status pending→active + expires_at        [20260702_job_postings]
--   • hourly auto-expire cron                   [20260705_job_postings_auto_expire]
--   • jp_guard_insert / jp_guard_owner_update   [20260705_job_postings_rls_lockdown,
--                                                20260718_capture_3/4]
--
-- NO RLS CHANGE IS NEEDED. jp_select already requires
-- (status='active' AND expires_at IS NOT NULL AND expires_at > now()) for public
-- reads, so an unpaid business post is invisible to the public for free.
--
-- Backfill: existing rows take the column defaults ('individual'/'not_required'),
-- so no live listing changes behaviour. ADD COLUMN with a non-volatile default is
-- metadata-only in PG11+ — no table rewrite, no meaningful lock.
--
-- Two axes, deliberately separate: `status` is content moderation, and
-- `payment_status` is money. There is intentionally NO "content approved but
-- unpaid" state — admin reviews content at activation time, and rejection stays
-- available independent of payment as the safety valve.

BEGIN;

-- ─── Columns ─────────────────────────────────────────────────────────────────

ALTER TABLE public.job_postings
  ADD COLUMN IF NOT EXISTS poster_type    TEXT NOT NULL DEFAULT 'individual'
                             CHECK (poster_type IN ('individual', 'business')),
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'not_required'
                             CHECK (payment_status IN ('not_required', 'awaiting_payment', 'paid')),
  ADD COLUMN IF NOT EXISTS paid_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_ref    TEXT;   -- bank transfer reference, admin-entered

COMMENT ON COLUMN public.job_postings.payment_status IS
  'Backend-only. Never rendered in the consumer app (iOS 3.1.1 anti-steering).';

-- ─── INSERT guard ────────────────────────────────────────────────────────────
-- Extends the existing jp_guard_insert(). The payment columns are DERIVED
-- server-side from poster_type and never accepted from the client: a poster who
-- sends payment_status='paid' has it silently overwritten. poster_type is the
-- only new field a client may legitimately supply.

CREATE OR REPLACE FUNCTION public.jp_guard_insert() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE is_admin boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;  -- service role / SQL editor
  END IF;

  SELECT EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    INTO is_admin;
  IF is_admin THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'job_postings: new rows must be pending';
  END IF;

  IF NEW.rejection_reason IS NOT NULL THEN
    RAISE EXCEPTION 'job_postings: rejection_reason is admin-only';
  END IF;

  IF NEW.expires_at IS NOT NULL THEN
    RAISE EXCEPTION 'job_postings: expires_at is admin-only';
  END IF;

  -- Monetization columns: derived, not accepted.
  IF NEW.poster_type IS DISTINCT FROM 'business' THEN
    NEW.poster_type := 'individual';
  END IF;
  NEW.payment_status := CASE WHEN NEW.poster_type = 'business'
                             THEN 'awaiting_payment'
                             ELSE 'not_required' END;
  NEW.paid_at     := NULL;
  NEW.payment_ref := NULL;

  RETURN NEW;
END $$;

-- ─── UPDATE guard ────────────────────────────────────────────────────────────
-- Extends the existing jp_guard_owner_update() with the four monetization
-- columns. Without this an owner could flip their own post to payment_status
-- ='paid' with a single direct Supabase API call. Admin retains full rights; the
-- system-context (cron) branch is unchanged.

CREATE OR REPLACE FUNCTION public.jp_guard_owner_update() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE is_admin boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    IF OLD.status = 'active' AND NEW.status = 'expired' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'job_postings: only active->expired allowed in system context';
  END IF;

  SELECT EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    INTO is_admin;
  IF is_admin THEN
    RETURN NEW;  -- admin may change anything
  END IF;

  -- Owner path: lock the moderation columns.
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'job_postings: owner_id is immutable';
  END IF;
  IF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'job_postings: expires_at is admin-only';
  END IF;
  IF NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason THEN
    RAISE EXCEPTION 'job_postings: rejection_reason is admin-only';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'active' AND NEW.status = 'filled') THEN
    RAISE EXCEPTION 'job_postings: owner may only set status active->filled';
  END IF;

  -- Owner path: lock the monetization columns.
  IF NEW.poster_type IS DISTINCT FROM OLD.poster_type THEN
    RAISE EXCEPTION 'job_postings: poster_type is immutable';
  END IF;
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    RAISE EXCEPTION 'job_postings: payment_status is admin-only';
  END IF;
  IF NEW.paid_at IS DISTINCT FROM OLD.paid_at THEN
    RAISE EXCEPTION 'job_postings: paid_at is admin-only';
  END IF;
  IF NEW.payment_ref IS DISTINCT FROM OLD.payment_ref THEN
    RAISE EXCEPTION 'job_postings: payment_ref is admin-only';
  END IF;

  RETURN NEW;
END $$;

COMMIT;

-- ─── Verification (run after applying) ───────────────────────────────────────
--   -- As a non-admin owner, each of these must FAIL:
--   UPDATE job_postings SET payment_status = 'paid' WHERE owner_id = auth.uid();
--   UPDATE job_postings SET poster_type    = 'individual' WHERE owner_id = auth.uid();
--   -- And a business insert must land as awaiting_payment regardless of input:
--   INSERT INTO job_postings (owner_id, job_title, employer_name, category,
--     district, poster_type, payment_status)
--   VALUES (auth.uid(), 'x', 'y', 'other', 'nicosia', 'business', 'paid');
--   -- → row should read poster_type='business', payment_status='awaiting_payment'.

-- ─── Rollback ────────────────────────────────────────────────────────────────
--   BEGIN;
--   ALTER TABLE public.job_postings
--     DROP COLUMN IF EXISTS poster_type,
--     DROP COLUMN IF EXISTS payment_status,
--     DROP COLUMN IF EXISTS paid_at,
--     DROP COLUMN IF EXISTS payment_ref;
--   -- then restore jp_guard_insert / jp_guard_owner_update from
--   -- 20260718_capture_3_functions.sql
--   COMMIT;
