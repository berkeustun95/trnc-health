-- ─── create_facility_claim() — atomic new-facility + claim, no client read-back ─
-- FIXES the new-facility creation failure:
--   The app did `facilities.insert(...).select('id').single()`. With the row born
--   UNCLAIMED (provider_id=null, status='pending', is_public=false), it matches no
--   branch of the live SELECT policy `facilities_select_public`
--   ((status IN ('active','trial') AND is_public) OR provider_id=auth.uid()
--    OR is_admin()). `.select()` forces PostgREST to return the RETURNING row,
--   which is then subject to that SELECT policy — the row isn't visible, so the
--   write fails with "new row violates row-level security policy" and rolls back
--   (0 rows). The INSERT WITH CHECK itself is fine (already provider_id IS NULL);
--   it's the read-back that fails.
--
-- This SECURITY DEFINER RPC does the whole create server-side and returns the new
-- facility id, so the client never reads facilities back under RLS. It also makes
-- the facility insert + claim_requests insert ATOMIC (both or neither) — closing
-- the orphan-on-claim-failure gap flagged earlier.
--
-- Safety: runs as definer (owner bypasses RLS) BUT validates the caller itself and
-- never trusts the client for lifecycle columns —
--   • requires a real, non-anonymous authenticated user (auth.uid() present);
--   • forces provider_id=null, status='pending', is_public=false, verified=false;
--   • sets claim_requests.requester_id = auth.uid() (not a client value).
-- The facilities_guard_insert / claim_requests_guard_insert triggers still fire
-- (triggers run regardless of definer), so the unclaimed-pending shape and the
-- "facility already claimed" / duplicate-claim guards remain enforced.
--
-- Does NOT change the claim-existing path, the approve/reject flows, or any policy.

CREATE OR REPLACE FUNCTION public.create_facility_claim(
  p_name                text,
  p_type                text,
  p_address             text,
  p_phone               text,
  p_opening_hours       text,
  p_membership_tier     text,
  p_registration_number text,
  p_tax_registration_no text,
  p_latitude            double precision,
  p_longitude           double precision
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid         uuid := auth.uid();
  v_facility_id uuid;
BEGIN
  -- Caller must be a real, non-anonymous authenticated user.
  IF v_uid IS NULL OR is_anonymous_session() THEN
    RAISE EXCEPTION 'create_facility_claim: authentication required';
  END IF;

  -- Server-side required-field checks (app validates too; enforce here as well).
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'create_facility_claim: name is required';
  END IF;
  IF p_tax_registration_no IS NULL OR btrim(p_tax_registration_no) = '' THEN
    RAISE EXCEPTION 'create_facility_claim: tax_registration_no is required';
  END IF;

  -- Facility is born UNCLAIMED / pending / private / unverified. These four are
  -- set by the RPC, never taken from the client. Ownership is written only when
  -- an admin approves the claim (ClaimsTab.approve).
  INSERT INTO facilities (
    name, type, address, phone, opening_hours, membership_tier,
    registration_number, latitude, longitude,
    provider_id, status, is_public, verified
  ) VALUES (
    btrim(p_name),
    p_type,
    nullif(btrim(coalesce(p_address, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_opening_hours, '')), ''),
    coalesce(p_membership_tier, 'basic'),
    nullif(btrim(coalesce(p_registration_number, '')), ''),
    p_latitude,
    p_longitude,
    null, 'pending', false, false
  )
  RETURNING id INTO v_facility_id;

  -- Linked claim carries the verification evidence. Same transaction as the
  -- facility insert: if this raises (e.g. a guard), the facility insert rolls
  -- back with it — no orphaned facility.
  INSERT INTO claim_requests (
    facility_id, requester_id, requested_tier, registration_number, tax_registration_no
  ) VALUES (
    v_facility_id,
    v_uid,
    coalesce(p_membership_tier, 'basic'),
    nullif(btrim(coalesce(p_registration_number, '')), ''),
    btrim(p_tax_registration_no)
  );

  RETURN v_facility_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_facility_claim(
  text, text, text, text, text, text, text, text, double precision, double precision
) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_facility_claim(
  text, text, text, text, text, text, text, text, double precision, double precision
) TO authenticated;

-- Rollback:
--   DROP FUNCTION IF EXISTS public.create_facility_claim(
--     text, text, text, text, text, text, text, text, double precision, double precision
--   );
