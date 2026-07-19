-- ─── claim_requests — verification-evidence columns + unclaimed-only guard ──
-- Step 1 of 3 for the claim→approve hardening. PURELY ADDITIVE + one tightened
-- insert rule; nothing currently running breaks, so this is safe to ship AHEAD
-- of the app changes:
--   • Change 1 adds three nullable evidence columns (a pending claim has none of
--     them set yet — no backfill needed).
--   • Change 2 adds a BEFORE INSERT guard that rejects a claim on a facility
--     that is ALREADY claimed. Today the "unclaimed only" rule is client-side
--     only (ProviderOnboardingScreen.js:69) — RLS ("providers insert own claims")
--     lets any authed user insert a claim for any facility_id. Worst case today
--     is queue spam, not a hijack (approval stays admin-gated), so this is
--     defence-in-depth.
--
-- This migration does NOT touch the approve/reject logic, any RLS policy, or the
-- verification/trial/visibility bundling in the approve write. Behaviour of the
-- existing flow is unchanged.

BEGIN;

-- ─── Change 1 — evidence columns ────────────────────────────────────────────
-- verified_by matches the house "which admin did X" pattern
-- (content_reports.resolved_by → profiles(id), 20260712_ugc_moderation.sql:73).
ALTER TABLE public.claim_requests
  ADD COLUMN IF NOT EXISTS verified_by    uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS verified_at    timestamptz,
  ADD COLUMN IF NOT EXISTS kteb_confirmed boolean NOT NULL DEFAULT false;

-- ─── Change 2 — unclaimed-only insert guard ─────────────────────────────────
-- Plain English: on INSERT of a claim_request by a non-admin authed user, if the
-- target facility already has an owner (facilities.provider_id IS NOT NULL) the
-- insert is rejected. Also blocks a duplicate pending claim by the same requester
-- for the same facility (queue-spam guard — FLAGGED: added beyond the core ask).
-- Service role (auth.uid() IS NULL, e.g. SQL editor / seed) and admin are trusted
-- and skip the check. Shaped like facilities_guard_insert
-- (20260718_facilities_guards.sql): SECURITY DEFINER, search_path pinned,
-- auth.uid() null escape, admin bypass, RAISE EXCEPTION 'claim_requests: <reason>'.
CREATE OR REPLACE FUNCTION claim_requests_guard_insert() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_admin        boolean;
  target_owner    uuid;
  dup_exists      boolean;
BEGIN
  -- System context (no JWT, e.g. seed / service-role writes): trust it.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    INTO is_admin;
  IF is_admin THEN
    RETURN NEW;                                        -- admin may file anything
  END IF;

  -- Unclaimed-only: the facility must not already have an owner.
  SELECT provider_id INTO target_owner
    FROM facilities WHERE id = NEW.facility_id;
  IF target_owner IS NOT NULL THEN
    RAISE EXCEPTION 'claim_requests: facility already claimed';
  END IF;

  -- Queue-spam guard: no second pending claim by the same requester on the same
  -- facility while one is still awaiting review.
  SELECT EXISTS(
    SELECT 1 FROM claim_requests
     WHERE facility_id  = NEW.facility_id
       AND requester_id = NEW.requester_id
       AND status       = 'pending'
  ) INTO dup_exists;
  IF dup_exists THEN
    RAISE EXCEPTION 'claim_requests: duplicate pending claim';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS claim_requests_guard_insert ON claim_requests;
CREATE TRIGGER claim_requests_guard_insert
  BEFORE INSERT ON claim_requests
  FOR EACH ROW EXECUTE FUNCTION claim_requests_guard_insert();

COMMIT;

-- Rollback:
--   BEGIN;
--   DROP TRIGGER IF EXISTS claim_requests_guard_insert ON claim_requests;
--   DROP FUNCTION IF EXISTS claim_requests_guard_insert();
--   ALTER TABLE public.claim_requests
--     DROP COLUMN IF EXISTS kteb_confirmed,
--     DROP COLUMN IF EXISTS verified_at,
--     DROP COLUMN IF EXISTS verified_by;
--   COMMIT;
