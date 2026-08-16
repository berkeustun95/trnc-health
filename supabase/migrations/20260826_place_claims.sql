-- ─── Slice 4 (piece 2) — place_claims (owner claim, PARALLEL table) ───────────
-- A user claims ownership of a place. A PARALLEL table, NOT an extension of
-- claim_requests: claim_requests is saturated with health-registration semantics
-- (tax_registration_no, kteb_confirmed, requested_tier, provider_documents, trial,
-- membership_tier, verified) that DO NOT transfer to a café/landmark. A place claim
-- carries only free-text evidence; approve writes places.provider_id, nothing else.
-- Keeping them separate keeps the KTEB/health-verification path pristine.
--
-- New TABLE → NOTIFY pgrst at the tail so the REST API sees it (PlaceClaimsTab reads it).
-- SET ROLE postgres: CREATE TABLE / TRIGGER / POLICY need the table owner.

SET ROLE postgres;
BEGIN;

-- ─── 1. Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.place_claims (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  place_id         uuid NOT NULL,
  requester_id     uuid NOT NULL,
  status           text NOT NULL DEFAULT 'pending',
  evidence_note    text,                       -- free text; NO tax_registration_no / kteb_confirmed
  verified_by      uuid,                        -- which admin approved/rejected
  verified_at      timestamptz,
  rejection_reason text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT place_claims_pkey PRIMARY KEY (id),
  CONSTRAINT place_claims_place_id_fkey     FOREIGN KEY (place_id)     REFERENCES public.places(id)  ON DELETE CASCADE,
  CONSTRAINT place_claims_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES auth.users(id)      ON DELETE CASCADE,
  CONSTRAINT place_claims_verified_by_fkey  FOREIGN KEY (verified_by)  REFERENCES public.profiles(id),
  CONSTRAINT place_claims_status_check      CHECK (status IN ('pending','approved','rejected'))
);

CREATE INDEX IF NOT EXISTS idx_place_claims_place_id      ON public.place_claims (place_id);
CREATE INDEX IF NOT EXISTS idx_place_claims_requester_id  ON public.place_claims (requester_id);

-- ─── 2. RLS ──────────────────────────────────────────────────────────────────
-- Plain English:
--   INSERT — a user files a claim ONLY for themselves (requester_id = auth.uid());
--            anonymous sessions blocked (real account required).
--   SELECT — a requester reads their OWN claims; admin reads all; nobody else.
--   UPDATE/DELETE — admin only. There is NO requester update path → nobody self-approves.
--            (Approve is the definer RPC below; reject is an admin UPDATE.)
ALTER TABLE public.place_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "place_claims_insert" ON public.place_claims;
CREATE POLICY "place_claims_insert" ON public.place_claims
  FOR INSERT TO public
  WITH CHECK (requester_id = auth.uid());
DROP POLICY IF EXISTS "no_anon_insert_place_claims" ON public.place_claims;
CREATE POLICY "no_anon_insert_place_claims" ON public.place_claims
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT is_anonymous_session());

DROP POLICY IF EXISTS "place_claims_select" ON public.place_claims;
CREATE POLICY "place_claims_select" ON public.place_claims
  FOR SELECT TO public
  USING (requester_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "place_claims_admin_update" ON public.place_claims;
CREATE POLICY "place_claims_admin_update" ON public.place_claims
  FOR UPDATE TO public
  USING (is_admin());
DROP POLICY IF EXISTS "place_claims_admin_delete" ON public.place_claims;
CREATE POLICY "place_claims_admin_delete" ON public.place_claims
  FOR DELETE TO public
  USING (is_admin());

-- ─── 3. Insert guard — unclaimed + no duplicate pending (single-purpose) ─────────
-- SECURITY DEFINER + pinned search_path (it must read places.provider_id ACROSS RLS —
-- same convention as claim_requests_guard_insert; NOT the plain-invoker piece-1 guards).
CREATE OR REPLACE FUNCTION public.place_claims_guard_insert()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  is_admin_user boolean;
  target_owner  uuid;
  dup_exists    boolean;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;                 -- service/seed
  SELECT exists(SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') INTO is_admin_user;
  IF is_admin_user THEN RETURN NEW; END IF;

  -- Place must be UNCLAIMED. Single-purpose: reads places.provider_id directly, no XOR
  -- against facilities (the whole reason this is a parallel table).
  SELECT provider_id INTO target_owner FROM places WHERE id = NEW.place_id;
  IF target_owner IS NOT NULL THEN
    RAISE EXCEPTION 'place_claims: place already claimed';
  END IF;

  -- No second pending claim by the same requester on the same place.
  SELECT exists(
    SELECT 1 FROM place_claims
     WHERE place_id = NEW.place_id AND requester_id = NEW.requester_id AND status = 'pending'
  ) INTO dup_exists;
  IF dup_exists THEN
    RAISE EXCEPTION 'place_claims: duplicate pending claim';
  END IF;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS place_claims_guard_insert ON public.place_claims;
CREATE TRIGGER place_claims_guard_insert
  BEFORE INSERT ON public.place_claims
  FOR EACH ROW EXECUTE FUNCTION public.place_claims_guard_insert();

-- ─── 4. Approve RPC — writes places.provider_id, terminates competing claims ─────
-- NO trusted-write GUC: auth.uid() inside a SECURITY DEFINER function is the CALLER's uid
-- (see request_featured_facility), so an admin caller passes places_guard_update's ADMIN
-- BYPASS — which RE-verifies admin (defense-in-depth); a GUC would blanket-bypass all four
-- locks and remove that check. auth.uid()=null (postgres SQL editor) passes via the guard's
-- service-role escape, so this is testable there too.
-- FOR UPDATE ×2 serializes concurrent approvals (competing claims / double-approve).
-- Competing-claims sweep: after approving one, reject the OTHER pending claims on the same
-- place. (facilities' ClaimsTab has the same latent flaw and leaves them dangling — do NOT
-- "fix" this asymmetry backward onto facilities.)
CREATE OR REPLACE FUNCTION public.approve_place_claim(p_claim_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_claim       place_claims%ROWTYPE;
  v_place_owner uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT is_admin() THEN
    RAISE EXCEPTION 'approve_place_claim: admin only';
  END IF;

  SELECT * INTO v_claim FROM place_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND OR v_claim.status <> 'pending' THEN
    RAISE EXCEPTION 'approve_place_claim: no pending claim';
  END IF;

  SELECT provider_id INTO v_place_owner FROM places WHERE id = v_claim.place_id FOR UPDATE;
  IF v_place_owner IS NOT NULL THEN
    RAISE EXCEPTION 'approve_place_claim: place already claimed';
  END IF;

  UPDATE places SET provider_id = v_claim.requester_id WHERE id = v_claim.place_id;

  UPDATE place_claims
     SET status = 'approved', verified_by = auth.uid(), verified_at = now()
   WHERE id = p_claim_id;

  UPDATE place_claims
     SET status = 'rejected', rejection_reason = 'Place was claimed by another requester.',
         verified_by = auth.uid(), verified_at = now()
   WHERE place_id = v_claim.place_id AND status = 'pending' AND id <> p_claim_id;
END $function$;

REVOKE ALL     ON FUNCTION public.approve_place_claim(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.approve_place_claim(uuid) TO authenticated;

COMMIT;
RESET ROLE;

-- New table + RPC → refresh PostgREST's cache.
NOTIFY pgrst, 'reload schema';

-- ── Verification (run after applying, Role = postgres) ───────────────────────
--   -- Table + 5 policies:
--   SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='place_claims';  -- 5
--   -- Seed a test claim (as a non-admin user via the app, or here as postgres for a test user):
--   INSERT INTO place_claims (place_id, requester_id, evidence_note)
--     VALUES ('<unclaimed-place-id>', '<user-id>', 'I run this café');
--   -- Guard: a 2nd pending claim by the same requester FAILS; a claim on a claimed place FAILS.
--   -- Approve (admin, or postgres here): writes provider_id + approves + rejects competing claims.
--   SELECT approve_place_claim('<claim-id>');
--   SELECT provider_id FROM places WHERE id = '<place-id>';                 -- = requester
--   SELECT status, rejection_reason FROM place_claims WHERE place_id='<place-id>'; -- one approved, rest rejected
--   -- Double-approve is a clean no-op error, not a silent reassignment (FOR UPDATE + status check).
--
-- ── Rollback ────────────────────────────────────────────────────────────────
--   SET ROLE postgres;
--   BEGIN;
--   DROP FUNCTION IF EXISTS public.approve_place_claim(uuid);
--   DROP TABLE    IF EXISTS public.place_claims;   -- drops policies/indexes/trigger/guard-binding
--   DROP FUNCTION IF EXISTS public.place_claims_guard_insert();
--   COMMIT;
--   RESET ROLE;
--   NOTIFY pgrst, 'reload schema';
