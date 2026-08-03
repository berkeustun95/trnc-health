-- ─── Grooming multi-category — move grooming from single `category` to service_types[] ─
--
-- Brings grooming to full parity with garages: a grooming business can now carry
-- SEVERAL categories (barber + nails + beauty …) in facilities.service_types text[],
-- the same column + shape garages already use. `category` (single) is retired for
-- grooming (backfilled into service_types, then nulled); the column stays (nullable,
-- unused) to avoid touching anything else that references it.
--
-- WHAT THIS ADDS / CHANGES
--   1. Constraints: service_types value-CHECK becomes TYPE-AWARE (garage values for
--      garage rows, grooming values for grooming rows); the presence-coupling changes
--      from "only garage" to "garage OR grooming carry service_types; nothing else may".
--      The grooming category coupling (grooming→category NOT NULL) is dropped.
--   2. Backfill: every existing grooming row gets service_types = ARRAY[its category],
--      then category is nulled.
--   3. RPCs:
--        - create_grooming_facility(… p_service_types text[] …)  — NEW multi-category path.
--        - create_grooming_facility(… p_category text …)         — KEPT as a back-compat
--          shim (remaps the single category to a 1-element array). *** REQUIRED because the
--          LIVE 1.1.0 client still calls the p_category signature; without this shim, every
--          production grooming signup breaks in the window between applying this migration
--          and the OTA shipping. ***  update_grooming_facility has NO shipped caller (it
--          shipped in 20260803, still unreleased), so its signature is changed in place.
--   4. Guard: the grooming material-field lock switches category → service_types
--      (material now = name / service_types / address, mirroring garage exactly).
--
-- ADDITIVE + idempotent. Garage + health rows are unaffected (garage keeps its own
-- value set + coupling; health keeps service_types NULL / category NULL).
--
-- EXECUTION: SET ROLE postgres (ALTER TABLE facilities needs the table owner; the SQL
-- editor runs as 'authenticated'). Apply BEFORE the OTA. Order within the txn matters —
-- drop the blocking CHECKs before the backfill, re-add the new CHECKs after. The backfill
-- also sets the app.trusted_facility_write GUC first (step 1b) so the live guard permits
-- the category-null write; without it the guard raises P0001 (grooming category lock).

SET ROLE postgres;
BEGIN;

-- ─── 1a. Drop the CHECKs that would block the backfill ───────────────────────
-- garage-only presence coupling (forbids grooming service_types):
ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_garage_service_types_check;
-- garage-only value set (rejects 'barber' etc.):
ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_service_types_values_check;
-- grooming category coupling (requires grooming→category NOT NULL):
ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_grooming_category_check;

-- ─── 1b. Backfill grooming service_types from category, then retire category ──
-- The LIVE guard (20260803) still locks grooming `category` at this point (it isn't
-- redefined until step 2), and the SQL editor's session HAS a non-admin auth.uid(), so
-- the guard's null-uid/admin bypass does NOT apply and the category-null UPDATE trips
-- P0001. Set the same transaction-local trust GUC the RPCs use so the guard early-
-- returns for these owner-less migration writes. is_local=true → scoped to this txn only.
SELECT set_config('app.trusted_facility_write', '1', true);

-- Idempotent: only rows still carrying a category with an unset service_types.
UPDATE public.facilities
   SET service_types = ARRAY[category]
 WHERE type = 'grooming'
   AND category IS NOT NULL
   AND (service_types IS NULL OR cardinality(service_types) = 0);

-- Idempotent: `AND category IS NOT NULL` so a re-run (categories already nulled) no-ops.
UPDATE public.facilities
   SET category = NULL
 WHERE type = 'grooming'
   AND category IS NOT NULL;

-- ─── 1c. Re-add CHECKs — now type-aware across garage + grooming ─────────────
-- Value CHECK: when present, non-empty AND every element valid FOR THAT TYPE. This
-- also enforces that a non-garage/non-grooming row cannot carry service_types (no
-- matching branch → only the NULL arm can be true).
ALTER TABLE public.facilities ADD CONSTRAINT facilities_service_types_values_check
  CHECK (
    service_types IS NULL
    OR (
      cardinality(service_types) >= 1
      AND (
           (type = 'garage'   AND service_types <@ ARRAY['muayene','repair','tyres','wash','parts','towing']::text[])
        OR (type = 'grooming' AND service_types <@ ARRAY['barber','hairdresser','nails','beauty']::text[])
      )
    )
  );

-- Presence coupling: garage OR grooming rows MUST carry service_types; every other
-- type MUST NOT. (Replaces the garage-only coupling dropped in 1a.)
ALTER TABLE public.facilities ADD CONSTRAINT facilities_service_types_type_check
  CHECK (
       (type IN ('garage','grooming') AND service_types IS NOT NULL)
    OR (type NOT IN ('garage','grooming') AND service_types IS NULL)
  );

-- facilities_category_check (category IS NULL OR in the 4 grooming values) is LEFT
-- as-is — still valid (all grooming categories are now NULL), harmless.

-- ─── 2. Guard: grooming material lock category → service_types ────────────────
-- Live body reproduced verbatim (garage block + the 20260803 grooming block), with the
-- grooming block's `category` lock replaced by `service_types`. Garage/health unchanged.
CREATE OR REPLACE FUNCTION public.facilities_guard_update()
 RETURNS trigger LANGUAGE plpgsql AS $function$
declare is_admin_user boolean;
begin
  if current_setting('app.trusted_facility_write', true) = '1' then
    return new;
  end if;

  if auth.uid() is null then return new; end if;
  select exists(select 1 from profiles where id = auth.uid() and role = 'admin')
    into is_admin_user;
  if is_admin_user then return new; end if;
  if new.verified is distinct from old.verified then
    raise exception 'facilities: verified is admin-only'; end if;
  if new.status is distinct from old.status then
    raise exception 'facilities: status is admin-only'; end if;
  if new.is_public is distinct from old.is_public then
    raise exception 'facilities: is_public is admin-only'; end if;
  if new.provider_id is distinct from old.provider_id then
    raise exception 'facilities: provider_id is immutable'; end if;
  if new.membership_tier is distinct from old.membership_tier then
    raise exception 'facilities: membership_tier is admin-only'; end if;
  if new.trial_ends_at is distinct from old.trial_ends_at then
    raise exception 'facilities: trial_ends_at is admin-only'; end if;

  -- Garage material fields (unchanged) — must go through update_garage_facility().
  if old.type = 'garage' then
    if new.name is distinct from old.name then
      raise exception 'facilities: garage name changes must go through update_garage_facility'; end if;
    if new.service_types is distinct from old.service_types then
      raise exception 'facilities: garage service_types changes must go through update_garage_facility'; end if;
    if new.address is distinct from old.address then
      raise exception 'facilities: garage address changes must go through update_garage_facility'; end if;
  end if;

  -- Grooming material fields — now name / service_types / address (was category), must
  -- go through update_grooming_facility(). Mirrors garage.
  if old.type = 'grooming' then
    if new.name is distinct from old.name then
      raise exception 'facilities: grooming name changes must go through update_grooming_facility'; end if;
    if new.service_types is distinct from old.service_types then
      raise exception 'facilities: grooming service_types changes must go through update_grooming_facility'; end if;
    if new.address is distinct from old.address then
      raise exception 'facilities: grooming address changes must go through update_grooming_facility'; end if;
  end if;

  return new;
end $function$;

-- ─── 3a. NEW multi-category create RPC (text[] path) ─────────────────────────
CREATE OR REPLACE FUNCTION public.create_grooming_facility(
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
  IF v_uid IS NULL OR is_anonymous_session() THEN
    RAISE EXCEPTION 'create_grooming_facility: authentication required';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'create_grooming_facility: name is required';
  END IF;
  IF p_service_types IS NULL
     OR cardinality(p_service_types) < 1
     OR NOT (p_service_types <@ ARRAY['barber','hairdresser','nails','beauty']::text[]) THEN
    RAISE EXCEPTION 'create_grooming_facility: at least one valid category is required';
  END IF;

  INSERT INTO facilities (name, type, service_types, address, phone, opening_hours, description)
  VALUES (
    btrim(p_name),
    'grooming',
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

-- ─── 3b. Back-compat shim: OLD single-category signature → array ─────────────
-- The LIVE 1.1.0 client calls this (p_category text). Remaps to the array path so old
-- signups keep producing valid rows (service_types = {category}, category NULL) until
-- the OTA lands. Disambiguated from the new overload by the p_category arg NAME.
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
BEGIN
  IF p_category IS NULL
     OR p_category NOT IN ('barber','hairdresser','nails','beauty') THEN
    RAISE EXCEPTION 'create_grooming_facility: valid category is required';
  END IF;
  RETURN create_grooming_facility(
    p_name, ARRAY[p_category], p_address, p_phone, p_opening_hours, p_description);
END;
$function$;

-- ─── 3c. Owner edit RPC: single category → text[] (safe to change — no shipped caller) ─
DROP FUNCTION IF EXISTS public.update_grooming_facility(uuid, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.update_grooming_facility(
  p_facility_id   uuid,
  p_name          text,
  p_service_types text[],
  p_address       text,
  p_phone         text,
  p_opening_hours text,
  p_description   text
)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid      uuid := auth.uid();
  v_old      facilities%ROWTYPE;
  v_material boolean;
BEGIN
  IF v_uid IS NULL OR is_anonymous_session() THEN
    RAISE EXCEPTION 'update_grooming_facility: authentication required';
  END IF;

  SELECT * INTO v_old FROM facilities WHERE id = p_facility_id;
  IF NOT FOUND OR v_old.provider_id IS DISTINCT FROM v_uid OR v_old.type <> 'grooming' THEN
    RAISE EXCEPTION 'update_grooming_facility: not your listing';
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'update_grooming_facility: name is required';
  END IF;
  IF p_service_types IS NULL
     OR cardinality(p_service_types) < 1
     OR NOT (p_service_types <@ ARRAY['barber','hairdresser','nails','beauty']::text[]) THEN
    RAISE EXCEPTION 'update_grooming_facility: at least one valid category is required';
  END IF;

  -- MATERIAL = name, address, or service_types changed (service_types as a SET).
  v_material :=
       (btrim(p_name) IS DISTINCT FROM v_old.name)
    OR (nullif(btrim(coalesce(p_address, '')), '') IS DISTINCT FROM v_old.address)
    OR NOT (p_service_types <@ coalesce(v_old.service_types, '{}') AND coalesce(v_old.service_types, '{}') <@ p_service_types);

  PERFORM set_config('app.trusted_facility_write', '1', true);

  UPDATE facilities SET
    name          = btrim(p_name),
    service_types = p_service_types,
    address       = nullif(btrim(coalesce(p_address, '')), ''),
    phone         = nullif(btrim(coalesce(p_phone, '')), ''),
    opening_hours = nullif(btrim(coalesce(p_opening_hours, '')), ''),
    description   = nullif(btrim(coalesce(p_description, '')), ''),
    status        = CASE WHEN v_material THEN 'pending' ELSE status    END,
    is_public     = CASE WHEN v_material THEN false     ELSE is_public END
  WHERE id = p_facility_id;

  RETURN v_material;
END;
$function$;

-- ─── Grants ──────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.create_grooming_facility(text, text[], text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_grooming_facility(text, text[], text, text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.create_grooming_facility(text, text, text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_grooming_facility(text, text, text, text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.update_grooming_facility(uuid, text, text[], text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_grooming_facility(uuid, text, text[], text, text, text, text) TO authenticated;

COMMIT;
RESET ROLE;

-- ─── Verification (run after applying) ───────────────────────────────────────
--   -- Existing grooming rows migrated (service_types set, category null):
--   SELECT id, name, service_types, category FROM facilities WHERE type='grooming';
--   -- New multi-category create (array path):
--   SELECT create_grooming_facility('Multi Salon', ARRAY['barber','nails'], 'Kyrenia', null, null, null);
--   -- Back-compat single-category create (old 1.1.0 client path) still works:
--   SELECT create_grooming_facility('Old Salon', 'barber', 'Girne', null, null, null);
--   SELECT service_types, category FROM facilities WHERE name='Old Salon';  -- {barber}, null
--   -- Value CHECK is type-aware:
--   INSERT INTO facilities (name,type,service_types) VALUES ('x','grooming','{repair}'); -- FAILS (garage value)
--   INSERT INTO facilities (name,type,service_types) VALUES ('x','garage','{barber}');   -- FAILS (grooming value)
--   -- Guard: direct owner service_types change blocked (must use the RPC):
--   UPDATE facilities SET service_types='{beauty}' WHERE type='grooming' AND provider_id=auth.uid();
--     -- FAILS: grooming service_types changes must go through update_grooming_facility

-- ─── Rollback ────────────────────────────────────────────────────────────────
--   -- (Only if reverting BEFORE the OTA. Note: re-deriving a single category from a
--   -- multi-value service_types is lossy — pick element 1.)
--   SET ROLE postgres; BEGIN;
--   DROP FUNCTION IF EXISTS public.create_grooming_facility(text, text[], text, text, text, text);
--   DROP FUNCTION IF EXISTS public.update_grooming_facility(uuid, text, text[], text, text, text, text);
--   -- recreate the pre-migration create_grooming_facility(p_category) + update_grooming_facility(p_category)
--   -- bodies from 20260725_grooming_directory.sql and 20260803_grooming_owner_edit.sql;
--   UPDATE facilities SET category = service_types[1] WHERE type='grooming' AND service_types IS NOT NULL;
--   UPDATE facilities SET service_types = NULL WHERE type='grooming';
--   ALTER TABLE facilities DROP CONSTRAINT IF EXISTS facilities_service_types_values_check;
--   ALTER TABLE facilities DROP CONSTRAINT IF EXISTS facilities_service_types_type_check;
--   ALTER TABLE facilities ADD CONSTRAINT facilities_service_types_values_check
--     CHECK (service_types IS NULL OR (cardinality(service_types)>=1 AND service_types <@ ARRAY['muayene','repair','tyres','wash','parts','towing']::text[]));
--   ALTER TABLE facilities ADD CONSTRAINT facilities_garage_service_types_check
--     CHECK ((type='garage' AND service_types IS NOT NULL) OR (type<>'garage' AND service_types IS NULL));
--   ALTER TABLE facilities ADD CONSTRAINT facilities_grooming_category_check
--     CHECK ((type='grooming' AND category IS NOT NULL) OR (type<>'grooming' AND category IS NULL));
--   -- restore the 20260803 guard body (grooming block locking category);
--   COMMIT; RESET ROLE;
