-- ─── Garages 2a amendment — garage edit trust-gate + material-field lock ──────
-- Targets the LIVE trigger function public.facilities_guard_update() (called by
-- the BEFORE UPDATE trigger 'facilities_guard_update' on facilities). Body below
-- is the live definition reproduced verbatim, plus TWO flagged additions. The
-- function's signature and security model are preserved exactly: plain plpgsql,
-- NOT security definer, no SET search_path. CREATE OR REPLACE keeps the existing
-- trigger bound to it (no trigger drop/create). Idempotent.
--
-- NOTE: the repo file 20260718_facilities_guards.sql is STALE — it describes a
-- DIFFERENT function (facilities_guard_owner_update with contact-field locks) that
-- is NOT what is live. Live has NO contact-field locks; only verified/status/
-- is_public/provider_id/membership_tier/trial_ends_at are admin-locked. That is why
-- addition (2) adds a garage-only lock on the MATERIAL fields (name, service_types,
-- address) so a direct owner update can't skip re-approval.
--
-- APPLY THIS BEFORE 20260802_update_garage_facility.sql (the RPC's write is
-- rejected until this guard trusts the GUC).

SET ROLE postgres;
BEGIN;

CREATE OR REPLACE FUNCTION public.facilities_guard_update()
 RETURNS trigger LANGUAGE plpgsql AS $function$
declare is_admin_user boolean;
begin
  -- NEW (1/2): trusted write from update_garage_facility() — transaction-local GUC,
  -- set ONLY by that RPC. Every other path (grooming/health/garage direct updates,
  -- admin approval) never sets it, so their behaviour is byte-for-byte unchanged.
  -- Lets the RPC change guard-locked columns (status→pending, is_public, and the
  -- garage material fields below) on the owner's behalf.
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

  -- NEW (2/2): garage material fields — an owner may change name / service_types /
  -- address ONLY through update_garage_facility() (which sets the trusted-write GUC
  -- above and flips the listing back to pending). Gated on old.type='garage', so
  -- health/grooming rows are completely unaffected. Without this, an owner could
  -- edit these directly and skip re-approval, since the live guard does not lock them.
  if old.type = 'garage' then
    if new.name is distinct from old.name then
      raise exception 'facilities: garage name changes must go through update_garage_facility'; end if;
    if new.service_types is distinct from old.service_types then
      raise exception 'facilities: garage service_types changes must go through update_garage_facility'; end if;
    if new.address is distinct from old.address then
      raise exception 'facilities: garage address changes must go through update_garage_facility'; end if;
  end if;

  return new;
end $function$;

COMMIT;
RESET ROLE;

-- Rollback (restores the live pre-amendment body — drops both additions):
--   SET ROLE postgres; BEGIN;
--   CREATE OR REPLACE FUNCTION public.facilities_guard_update()
--    RETURNS trigger LANGUAGE plpgsql AS $function$
--   declare is_admin_user boolean;
--   begin
--     if auth.uid() is null then return new; end if;
--     select exists(select 1 from profiles where id = auth.uid() and role = 'admin') into is_admin_user;
--     if is_admin_user then return new; end if;
--     if new.verified is distinct from old.verified then raise exception 'facilities: verified is admin-only'; end if;
--     if new.status is distinct from old.status then raise exception 'facilities: status is admin-only'; end if;
--     if new.is_public is distinct from old.is_public then raise exception 'facilities: is_public is admin-only'; end if;
--     if new.provider_id is distinct from old.provider_id then raise exception 'facilities: provider_id is immutable'; end if;
--     if new.membership_tier is distinct from old.membership_tier then raise exception 'facilities: membership_tier is admin-only'; end if;
--     if new.trial_ends_at is distinct from old.trial_ends_at then raise exception 'facilities: trial_ends_at is admin-only'; end if;
--     return new;
--   end $function$;
--   COMMIT; RESET ROLE;
