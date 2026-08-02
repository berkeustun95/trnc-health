-- ─── Grooming owner edit-listing — parity twin of the garage 2a edit path ─────
--
-- Gives grooming owners the SAME self-serve edit + material-re-approval lifecycle
-- garage got in 20260802 (update_garage_facility + guard trust-gate). Two additive
-- pieces, in one transaction:
--   (1) extend the LIVE facilities_guard_update() with a grooming-only material-field
--       lock (name / category / address), mirroring the garage block already live.
--   (2) create update_grooming_facility() — SECURITY DEFINER, ownership-checked,
--       sets the transaction-local trust GUC so the guard permits the owner-initiated
--       status→pending flip, and returns true when the change was material.
--
-- MATERIAL (→ back to pending + private, admin re-approval): name, category, address.
-- MINOR   (stay live):                                        phone, opening_hours, description.
-- Same split as garage (service_types ↔ category is the only field that differs).
--
-- The guard body below is the CURRENT LIVE definition reproduced verbatim (it already
-- carries the garage additions from 20260802_facilities_guard_garage_edit.sql), plus
-- ONE new grooming block. Garage/health behaviour is byte-for-byte unchanged. Plain
-- plpgsql, NOT security definer, no SET search_path — signature/security model
-- preserved; CREATE OR REPLACE keeps the existing trigger bound.
--
-- Idempotent / safe to re-run. Apply this whole file before publishing the OTA.

SET ROLE postgres;
BEGIN;

-- ─── (1) Guard: add grooming material-field lock ─────────────────────────────
CREATE OR REPLACE FUNCTION public.facilities_guard_update()
 RETURNS trigger LANGUAGE plpgsql AS $function$
declare is_admin_user boolean;
begin
  -- Trusted write from update_garage_facility()/update_grooming_facility() —
  -- transaction-local GUC, set ONLY by those RPCs. Every other path never sets it,
  -- so their behaviour is unchanged. Lets the RPC change guard-locked columns
  -- (status→pending, is_public, and the material fields below) on the owner's behalf.
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

  -- Garage material fields (LIVE, unchanged) — must go through update_garage_facility().
  if old.type = 'garage' then
    if new.name is distinct from old.name then
      raise exception 'facilities: garage name changes must go through update_garage_facility'; end if;
    if new.service_types is distinct from old.service_types then
      raise exception 'facilities: garage service_types changes must go through update_garage_facility'; end if;
    if new.address is distinct from old.address then
      raise exception 'facilities: garage address changes must go through update_garage_facility'; end if;
  end if;

  -- NEW: Grooming material fields — an owner may change name / category / address ONLY
  -- through update_grooming_facility() (which sets the trusted-write GUC above and flips
  -- the listing back to pending). Gated on old.type='grooming', so garage/health rows
  -- are unaffected. Without this, an owner could edit these directly and skip re-approval.
  if old.type = 'grooming' then
    if new.name is distinct from old.name then
      raise exception 'facilities: grooming name changes must go through update_grooming_facility'; end if;
    if new.category is distinct from old.category then
      raise exception 'facilities: grooming category changes must go through update_grooming_facility'; end if;
    if new.address is distinct from old.address then
      raise exception 'facilities: grooming address changes must go through update_grooming_facility'; end if;
  end if;

  return new;
end $function$;

-- ─── (2) Owner edit RPC ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_grooming_facility(
  p_facility_id   uuid,
  p_name          text,
  p_category      text,
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
  IF p_category IS NULL
     OR p_category NOT IN ('barber', 'hairdresser', 'nails', 'beauty') THEN
    RAISE EXCEPTION 'update_grooming_facility: valid category is required';
  END IF;

  -- MATERIAL = name, address, or category changed.
  v_material :=
       (btrim(p_name) IS DISTINCT FROM v_old.name)
    OR (nullif(btrim(coalesce(p_address, '')), '') IS DISTINCT FROM v_old.address)
    OR (p_category IS DISTINCT FROM v_old.category);

  -- Trust THIS write only: the guard early-returns on this transaction-local GUC.
  PERFORM set_config('app.trusted_facility_write', '1', true);

  UPDATE facilities SET
    name          = btrim(p_name),
    category      = p_category,
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

REVOKE ALL ON FUNCTION public.update_grooming_facility(uuid, text, text, text, text, text, text)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_grooming_facility(uuid, text, text, text, text, text, text)
  TO authenticated;

COMMIT;
RESET ROLE;

-- ─── Verification (run after applying) ───────────────────────────────────────
--   -- MINOR edit stays live (returns false; status unchanged):
--   SELECT update_grooming_facility('<id>','<same name>','<same cat>','<same addr>','+90 111','Mon–Sat','new desc');
--   -- MATERIAL edit flips to pending (returns true):
--   SELECT update_grooming_facility('<id>','New Name','barber','Kyrenia', null, null, null);
--   SELECT status, is_public FROM facilities WHERE id = '<id>';  -- expect pending / false
--   -- Direct owner update of a material field is now BLOCKED (must use the RPC):
--   UPDATE facilities SET name = 'x' WHERE id = '<id>';  -- FAILS: grooming name changes must go through update_grooming_facility
--   -- Garage lock still intact:
--   SELECT proname FROM pg_proc WHERE proname IN ('update_garage_facility','update_grooming_facility');

-- ─── Rollback ────────────────────────────────────────────────────────────────
--   SET ROLE postgres; BEGIN;
--   DROP FUNCTION IF EXISTS public.update_grooming_facility(uuid,text,text,text,text,text,text);
--   -- restore the guard to its pre-grooming body (the live garage-only version from
--   -- 20260802_facilities_guard_garage_edit.sql — drop only the grooming block).
--   COMMIT; RESET ROLE;
