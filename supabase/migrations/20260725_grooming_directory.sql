-- ─── Beauty & Grooming directory — Slice 1 (directory + onboarding, NO booking) ─
--
-- Barbers-as-facilities: grooming providers are facilities rows (type='grooming'),
-- so later slices inherit appointments + availability + dashboard for free
-- (appointments.facility_id → facilities(id); my_provider_facility_ids() keys off
-- facilities.provider_id).
--
-- WHAT THIS ADDS
--   1. 'grooming' to facilities_type_check.
--   2. facilities.category (nullable) + a value CHECK + a type-coupling CHECK
--      (grooming rows MUST have a category; every other type MUST NOT).
--   3. A grooming-scoped carve-out in facilities_guard_insert: health types keep
--      EXACTLY today's behaviour (born unclaimed, provider_id forced NULL); grooming
--      self-serve is born OWNED (provider_id = auth.uid()) + pending + private, so
--      my_provider_facility_ids() works immediately and Slice 2/3 inherit ownership.
--   4. create_grooming_facility() — a SECURITY DEFINER RPC that is the single write
--      path for self-serve grooming signup. Definer bypasses the insert RLS
--      (WITH CHECK provider_id IS NULL), exactly like create_facility_claim; the
--      guard trigger still forces the pending/private/owned shape.
--
-- LIFECYCLE
--   signup (RPC) → status 'pending', is_public false, provider_id = creator
--   admin approve → status 'active',  is_public true   (directory becomes visible)
--   admin reject  → status 'suspended'                  (already in the status CHECK;
--                   deliberately NOT adding a 'rejected' value, to avoid touching the
--                   shared facilities_status_check that health rows depend on)
--
-- RLS (unchanged — no policy edits needed). The live facilities_select_public =
--   (status IN ('active','trial') AND is_public) OR provider_id = auth.uid() OR admin.
--   → a pending grooming row is visible ONLY to its owner + admins.
--   → the public directory sees it only after approval flips active + is_public.
--   → a customer can never read another provider's pending row.
--   Admin UPDATE is already permitted (admin may edit any facility), which is how
--   approve/reject flip status + is_public. Owner self-edit is a later slice.
--
-- APPLY THIS IN SUPABASE BEFORE publishing the OTA — the directory queries
-- facilities on load. Idempotent / safe to re-run (drop-then-create everywhere).

BEGIN;

-- ─── 1. Facility type ────────────────────────────────────────────────────────
ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_type_check;
ALTER TABLE public.facilities ADD CONSTRAINT facilities_type_check
  CHECK (type = ANY (ARRAY['pharmacy'::text, 'clinic'::text, 'hospital'::text,
                           'dentist'::text, 'vet'::text, 'grooming'::text]));

-- ─── 2. Category column + CHECKs ─────────────────────────────────────────────
-- Nullable: every existing (health) row stays category IS NULL and passes.
ALTER TABLE public.facilities ADD COLUMN IF NOT EXISTS category text;

ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_category_check;
ALTER TABLE public.facilities ADD CONSTRAINT facilities_category_check
  CHECK (category IS NULL OR category = ANY (ARRAY['barber'::text, 'hairdresser'::text,
                                                   'nails'::text, 'beauty'::text]));

-- Couple category to type: grooming rows carry a category; nothing else may.
ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_grooming_category_check;
ALTER TABLE public.facilities ADD CONSTRAINT facilities_grooming_category_check
  CHECK ((type = 'grooming' AND category IS NOT NULL)
      OR (type <> 'grooming' AND category IS NULL));

-- ─── 3. Insert guard carve-out ───────────────────────────────────────────────
-- Only the grooming branch is new. The health/admin/system branches are byte-for-
-- byte identical to 20260719_facilities_insert_force_unclaimed.sql, so no existing
-- facility type changes behaviour.
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
  -- provider_id is taken from auth.uid(), never from the client.
  IF NEW.type = 'grooming' THEN
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

-- ─── 4. Self-serve create RPC ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_grooming_facility(
  p_name          text,
  p_category      text,
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
    RAISE EXCEPTION 'create_grooming_facility: authentication required';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'create_grooming_facility: name is required';
  END IF;
  IF p_category IS NULL
     OR p_category NOT IN ('barber', 'hairdresser', 'nails', 'beauty') THEN
    RAISE EXCEPTION 'create_grooming_facility: valid category is required';
  END IF;

  -- The guard trigger forces provider_id = auth.uid(), status = 'pending',
  -- is_public = false, verified = false, so those are never trusted from here.
  INSERT INTO facilities (name, type, category, address, phone, opening_hours, description)
  VALUES (
    btrim(p_name),
    'grooming',
    p_category,
    nullif(btrim(coalesce(p_address, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_opening_hours, '')), ''),
    nullif(btrim(coalesce(p_description, '')), '')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_grooming_facility(text, text, text, text, text, text)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_grooming_facility(text, text, text, text, text, text)
  TO authenticated;

COMMIT;

-- ─── Verification (run after applying) ───────────────────────────────────────
--   -- Self-serve create lands owned + pending + private regardless of intent:
--   SELECT create_grooming_facility('Test Barber', 'barber', 'Kyrenia', '+90 000', 'Mon–Sat 9–7', 'desc');
--   -- → new facilities row: type='grooming', category='barber',
--   --   provider_id = auth.uid(), status='pending', is_public=false, verified=false.
--
--   -- The creator can read their own pending row; a DIFFERENT user cannot:
--   SELECT id, name, status FROM facilities WHERE type='grooming';  -- owner: sees it
--                                                                   -- other user: 0 rows
--
--   -- A non-admin CANNOT self-approve (admin-only UPDATE of status/is_public is
--   -- governed by the existing update guard):
--   UPDATE facilities SET status='active', is_public=true WHERE provider_id = auth.uid();
--
--   -- Coupling CHECKs hold:
--   INSERT INTO facilities (name, type) VALUES ('x', 'grooming');       -- FAILS: category required
--   INSERT INTO facilities (name, type, category) VALUES ('x','clinic','barber'); -- FAILS: non-grooming category

-- ─── Rollback ────────────────────────────────────────────────────────────────
--   BEGIN;
--   DROP FUNCTION IF EXISTS public.create_grooming_facility(text,text,text,text,text,text);
--   ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_grooming_category_check;
--   ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_category_check;
--   ALTER TABLE public.facilities DROP COLUMN IF EXISTS category;
--   ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_type_check;
--   ALTER TABLE public.facilities ADD CONSTRAINT facilities_type_check
--     CHECK (type = ANY (ARRAY['pharmacy','clinic','hospital','dentist','vet']));
--   -- restore the pre-grooming facilities_guard_insert body from
--   -- 20260719_facilities_insert_force_unclaimed.sql
--   COMMIT;
