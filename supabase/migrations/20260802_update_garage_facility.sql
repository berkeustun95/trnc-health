-- ─── Garages 2a amendment — owner edit-listing RPC ───────────────────────────
-- Single write-path for a garage owner to edit their listing. Mirrors
-- create_garage_facility: SECURITY DEFINER, SET search_path, ownership-checked,
-- validates service_types. Classifies MATERIAL (name/address/service_types) vs
-- MINOR (phone/hours/description); a material change flips the listing back to
-- pending + private (re-approval). Sets a transaction-local trust GUC so the
-- update guard (companion migration ..._facilities_guard_garage_edit) permits this
-- owner-initiated write to the guard-locked columns. Returns true when material.
--
-- APPLY the guard migration BEFORE this one (this RPC's write is rejected until the
-- guard trusts the GUC). Idempotent.

SET ROLE postgres;

CREATE OR REPLACE FUNCTION public.update_garage_facility(
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
    RAISE EXCEPTION 'update_garage_facility: authentication required';
  END IF;

  SELECT * INTO v_old FROM facilities WHERE id = p_facility_id;
  IF NOT FOUND OR v_old.provider_id IS DISTINCT FROM v_uid OR v_old.type <> 'garage' THEN
    RAISE EXCEPTION 'update_garage_facility: not your garage';
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'update_garage_facility: name is required';
  END IF;
  IF p_service_types IS NULL
     OR cardinality(p_service_types) < 1
     OR NOT (p_service_types <@ ARRAY['muayene','repair','tyres','wash','parts','towing']::text[]) THEN
    RAISE EXCEPTION 'update_garage_facility: at least one valid service type is required';
  END IF;

  -- MATERIAL = name, address, or service_types changed. service_types compared as
  -- a SET (order/dupes ignored) so a reorder is not treated as material.
  v_material :=
       (btrim(p_name) IS DISTINCT FROM v_old.name)
    OR (nullif(btrim(coalesce(p_address, '')), '') IS DISTINCT FROM v_old.address)
    OR NOT (p_service_types <@ coalesce(v_old.service_types, '{}') AND coalesce(v_old.service_types, '{}') <@ p_service_types);

  -- Trust THIS write only: the guard early-returns on this transaction-local GUC.
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

REVOKE ALL ON FUNCTION public.update_garage_facility(uuid, text, text[], text, text, text, text)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_garage_facility(uuid, text, text[], text, text, text, text)
  TO authenticated;

RESET ROLE;

-- Rollback:
--   SET ROLE postgres;
--   DROP FUNCTION IF EXISTS public.update_garage_facility(uuid, text, text[], text, text, text, text);
--   RESET ROLE;
