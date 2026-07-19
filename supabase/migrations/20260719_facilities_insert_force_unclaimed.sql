-- ─── facilities_guard_insert — force provider_id NULL for regular providers ──
-- WHAT: the BEFORE INSERT guard already forces status='pending', is_public=false,
-- verified=false for a non-admin, non-service-role insert, but it TRUSTED the
-- client's provider_id. This adds `NEW.provider_id := null;` to that same
-- non-admin branch, so a regular provider's insert always lands UNCLAIMED.
--
-- WHY:
--   1. Closes a small self-assign hole — a provider self-onboarding could set
--      NEW.provider_id = themselves at insert (the update guard locks provider_id
--      afterward, but the initial insert set it directly).
--   2. Unblocks unification — new facilities and claim-existing must converge on
--      the same shape: born unclaimed, ownership written only at approval. Our
--      claim-insert guard (claim_requests_guard_insert) rejects a claim on any
--      facility with provider_id IS NOT NULL, so a facility self-created with an
--      owner could never get a claim row. Forcing provider_id null at creation
--      lets both paths flow through claim_requests.
--
-- Both trusted escapes are preserved unchanged, so they may still set provider_id:
--   • auth.uid() IS NULL (service role / SQL editor / seed) → RETURN NEW as-is
--   • admin                                                 → RETURN NEW as-is
-- Only the non-admin provider branch is affected.
--
-- Only facilities_guard_insert changes. The update guard, the claim guard, RLS,
-- and app code are untouched. Additive-in-safety (tightening) only.

CREATE OR REPLACE FUNCTION facilities_guard_insert() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE is_admin boolean;
BEGIN
  -- System context (no JWT, e.g. seed / service-role writes): trust it.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    INTO is_admin;
  IF is_admin THEN
    RETURN NEW;                                        -- admin may set anything
  END IF;

  -- Provider self-onboarding: force the row into the pending, UNCLAIMED lifecycle.
  -- provider_id is assigned only at admin approval (claim_requests flow), never
  -- by the provider's own insert.
  NEW.provider_id := null;
  NEW.status      := 'pending';
  NEW.is_public   := false;
  NEW.verified    := false;
  RETURN NEW;
END $$;

-- Rollback (restore the previous body — without `NEW.provider_id := null`):
--   CREATE OR REPLACE FUNCTION facilities_guard_insert() RETURNS trigger
--     LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
--   DECLARE is_admin boolean;
--   BEGIN
--     IF auth.uid() IS NULL THEN
--       RETURN NEW;
--     END IF;
--     SELECT EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
--       INTO is_admin;
--     IF is_admin THEN
--       RETURN NEW;
--     END IF;
--     NEW.status    := 'pending';
--     NEW.is_public := false;
--     NEW.verified  := false;
--     RETURN NEW;
--   END $$;
