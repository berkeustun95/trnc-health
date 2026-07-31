-- ─── Garages / Auto Services directory — Slice 1 (directory + onboarding, NO booking) ─
--
-- Garages are facilities rows (type='garage'), mirroring grooming
-- (20260725_grooming_directory.sql), so Slice 2 inherits appointments +
-- availability + dashboard for free. Multi-tag: a garage offers several services,
-- so we use service_types text[] (not the single-value grooming `category`).
--
-- WHAT THIS ADDS
--   1. 'garage' to facilities_type_check.
--   2. facilities.service_types text[] (nullable) + a value CHECK + a type-coupling
--      CHECK (garage rows MUST carry service_types; nothing else may).
--   3. A garage-scoped carve-out in facilities_guard_insert: born OWNED
--      (provider_id = auth.uid()) + pending + private, identical in shape to grooming.
--      Health + grooming branches are byte-for-byte unchanged.
--   4. create_garage_facility() — a SECURITY DEFINER RPC that is the single write
--      path for self-serve garage signup.
--
-- LIFECYCLE (identical to grooming)
--   signup (RPC) → status 'pending', is_public false, provider_id = creator
--   admin approve → status 'active',  is_public true   (directory becomes visible)
--   admin reject  → status 'suspended'                  (existing CHECK value; no
--                   change to the shared facilities_status_check)
--
-- RLS (unchanged — no policy edits). The live facilities SELECT policy is the gated
--   version: (status IN ('active','trial') AND is_public) OR provider_id = auth.uid()
--   OR admin. → a pending garage is visible ONLY to its owner + admins; the public
--   directory sees it only after approval flips active + is_public; no customer can
--   read another owner's pending row. Admin UPDATE is already permitted (approve/reject).
--
-- ADDITIVE ONLY. Every existing (health/grooming) row keeps service_types NULL and
-- passes both new CHECKs; no existing facility type changes behaviour.
--
-- EXECUTION NOTE: the Supabase SQL editor runs as current_user='authenticated'
-- (session_user='postgres'), so ALTER TABLE facilities fails with "must be owner".
-- SET ROLE postgres switches to the table owner for the migration; session_user is
-- postgres so the switch is permitted. RESET ROLE restores the session at the end.
--
-- APPLY THIS IN SUPABASE BEFORE publishing the OTA — the directory queries facilities
-- on load. Idempotent / safe to re-run (drop-then-create everywhere).

SET ROLE postgres;

BEGIN;

-- ─── 1. Facility type: append 'garage' (keep the full existing set) ───────────
ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_type_check;
ALTER TABLE public.facilities ADD CONSTRAINT facilities_type_check
  CHECK (type = ANY (ARRAY['pharmacy'::text, 'clinic'::text, 'hospital'::text,
                           'dentist'::text, 'vet'::text, 'grooming'::text,
                           'garage'::text]));

-- ─── 2. service_types[] column + CHECKs ──────────────────────────────────────
-- Nullable: every existing (health/grooming) row stays NULL and passes.
ALTER TABLE public.facilities ADD COLUMN IF NOT EXISTS service_types text[];

-- Value CHECK: when present, non-empty AND every element is an allowed category.
-- cardinality() (not array_length) so an empty array is rejected, not treated as
-- unknown/NULL (which a CHECK would let pass).
ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_service_types_values_check;
ALTER TABLE public.facilities ADD CONSTRAINT facilities_service_types_values_check
  CHECK (
    service_types IS NULL
    OR (cardinality(service_types) >= 1
        AND service_types <@ ARRAY['muayene','repair','tyres','wash','parts','towing']::text[])
  );

-- Couple service_types to type: garage rows carry service_types; nothing else may.
ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_garage_service_types_check;
ALTER TABLE public.facilities ADD CONSTRAINT facilities_garage_service_types_check
  CHECK ((type = 'garage'  AND service_types IS NOT NULL)
      OR (type <> 'garage' AND service_types IS NULL));

-- ─── 3. Insert guard carve-out ───────────────────────────────────────────────
-- Whole function reproduced from the live grooming version; ONLY the garage branch
-- is new. System / admin / grooming / health branches are byte-for-byte unchanged.
CREATE OR REPLACE FUNCTION public.facilities_guard_insert() RETURNS trigger
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

  -- Grooming self-serve: born OWNED by the creator, pending, private, unverified.
  IF NEW.type = 'grooming' THEN
    NEW.provider_id := auth.uid();
    NEW.status      := 'pending';
    NEW.is_public   := false;
    NEW.verified    := false;
    RETURN NEW;
  END IF;

  -- Garage self-serve: identical shape to grooming (born owned + pending + private).
  IF NEW.type = 'garage' THEN
    NEW.provider_id := auth.uid();
    NEW.status      := 'pending';
    NEW.is_public   := false;
    NEW.verified    := false;
    RETURN NEW;
  END IF;

  -- Health facilities: UNCHANGED — born unclaimed; ownership is written only at
  -- admin claim approval (claim_requests flow).
  NEW.provider_id := null;
  NEW.status      := 'pending';
  NEW.is_public   := false;
  NEW.verified    := false;
  RETURN NEW;
END $$;

-- ─── 4. Self-serve create RPC (single write path) ────────────────────────────
CREATE OR REPLACE FUNCTION public.create_garage_facility(
  p_name          text,
  p_service_types text[],
  p_address       text,
  p_phone         text,
  p_opening_hours text,
  p_description   text
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
BEGIN
  -- Caller must be a real, non-anonymous authenticated user.
  IF v_uid IS NULL OR is_anonymous_session() THEN
    RAISE EXCEPTION 'create_garage_facility: authentication required';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'create_garage_facility: name is required';
  END IF;
  IF p_service_types IS NULL
     OR cardinality(p_service_types) < 1
     OR NOT (p_service_types <@ ARRAY['muayene','repair','tyres','wash','parts','towing']::text[]) THEN
    RAISE EXCEPTION 'create_garage_facility: at least one valid service type is required';
  END IF;

  -- The guard trigger forces provider_id = auth.uid(), status = 'pending',
  -- is_public = false, verified = false, so those are never trusted from here.
  INSERT INTO facilities (name, type, service_types, address, phone, opening_hours, description)
  VALUES (
    btrim(p_name),
    'garage',
    p_service_types,
    nullif(btrim(coalesce(p_address, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_opening_hours, '')), ''),
    nullif(btrim(coalesce(p_description, '')), '')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_garage_facility(text, text[], text, text, text, text)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_garage_facility(text, text[], text, text, text, text)
  TO authenticated;

COMMIT;

RESET ROLE;

-- ─── Verification (run after applying) ───────────────────────────────────────
--   -- Self-serve create lands owned + pending + private regardless of intent:
--   SELECT create_garage_facility('Test Garage', ARRAY['muayene','tyres'], 'Kyrenia', '+90 000', 'Mon–Sat 9–6', 'desc');
--   -- → new facilities row: type='garage', service_types={muayene,tyres},
--   --   provider_id = auth.uid(), status='pending', is_public=false, verified=false.
--
--   -- The creator can read their own pending row; a DIFFERENT user cannot:
--   SELECT id, name, status FROM facilities WHERE type='garage';  -- owner: sees it
--                                                                 -- other user: 0 rows
--
--   -- A non-admin CANNOT self-approve (admin-only UPDATE governed by the update guard):
--   UPDATE facilities SET status='active', is_public=true WHERE provider_id = auth.uid();
--
--   -- CHECKs hold:
--   INSERT INTO facilities (name, type) VALUES ('x', 'garage');                      -- FAILS: service_types required
--   INSERT INTO facilities (name, type, service_types) VALUES ('x','garage','{}');   -- FAILS: empty array
--   INSERT INTO facilities (name, type, service_types) VALUES ('x','garage','{foo}');-- FAILS: bad category
--   INSERT INTO facilities (name, type, service_types) VALUES ('x','clinic','{repair}'); -- FAILS: non-garage carries service_types

-- ─── Rollback ────────────────────────────────────────────────────────────────
--   SET ROLE postgres;
--   BEGIN;
--   DROP FUNCTION IF EXISTS public.create_garage_facility(text,text[],text,text,text,text);
--   ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_garage_service_types_check;
--   ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_service_types_values_check;
--   ALTER TABLE public.facilities DROP COLUMN IF EXISTS service_types;
--   ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_type_check;
--   ALTER TABLE public.facilities ADD CONSTRAINT facilities_type_check
--     CHECK (type = ANY (ARRAY['pharmacy','clinic','hospital','dentist','vet','grooming']));
--   -- restore the pre-garage facilities_guard_insert body from 20260725_grooming_directory.sql
--   COMMIT;
--   RESET ROLE;
