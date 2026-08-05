-- ─── Slice 3a — Featured tier (generic, facilities table) ────────────────────
-- Paid promotion for facility listings: a featured listing is PINNED to the top
-- of its directory with a "Featured" badge. GENERIC — the mechanism lives on the
-- facilities table and works for EVERY type there (garage / grooming / health);
-- garages surface it first. home_services is a separate table → out of scope.
--
-- Mirrors job-postings "Bucket A" monetization (20260722): owner self-requests →
-- MANUAL admin activation (payment arranged entirely OFF-APP, bank transfer, no
-- in-app purchase) → time-boxed → auto-expires. No cap: anyone who pays can be
-- featured; the directory rotates featured listings fairly among themselves
-- (client-side per-load shuffle — no DB ordering needed).
--
-- AUTO-EXPIRE WITH ZERO CRON: "actively featured" is DERIVED (featured_until >
-- now()), so a featured listing drops out the moment its window passes. Unlike
-- Bucket A there is nothing to sweep — the admin "active" list and the public
-- directory both read the same live predicate.
--
-- ANTI-STEERING (iOS 3.1.1): these columns are BACKEND state. No pricing, amount,
-- bank details, or payment instruction appears in any consumer- or owner-facing
-- screen. The owner request flow says only "we'll be in touch to set it up".
--
-- BYPASS-PROOF: featured columns are admin-only in facilities_guard_update; the
-- ONLY owner write path is request_featured_facility() (SECURITY DEFINER, sets
-- the transaction-local trust GUC the guard already early-returns on). No client
-- can self-feature or self-set an expiry.
--
-- ADDITIVE + IDEMPOTENT (safe to re-run). Every existing row takes NULL for both
-- columns → not featured, no pending request → no behaviour change. ADD COLUMN
-- with no default is metadata-only (no table rewrite). Apply in Supabase with the
-- SQL-editor Role dropdown = postgres BEFORE publishing the OTA (directories read
-- facilities on load). No native build required.

SET ROLE postgres;

BEGIN;

-- ─── 1. Columns ──────────────────────────────────────────────────────────────
-- featured_until:        admin-only. Active-featured = featured_until > now().
-- featured_requested_at: owner's pending request, set only via the RPC below.
ALTER TABLE public.facilities
  ADD COLUMN IF NOT EXISTS featured_until        timestamptz,
  ADD COLUMN IF NOT EXISTS featured_requested_at timestamptz;

COMMENT ON COLUMN public.facilities.featured_until IS
  'Admin-only. Active-featured = featured_until > now(). Auto-expires, no cron. Backend state (iOS 3.1.1).';
COMMENT ON COLUMN public.facilities.featured_requested_at IS
  'Set only by request_featured_facility(). Pending featured request awaiting admin activation.';

-- ─── 2. Guard: featured columns admin-only ───────────────────────────────────
-- Body is the LIVE facilities_guard_update() (20260802) reproduced verbatim, plus
-- ONE flagged block. The trusted-GUC early-return at the top already lets
-- request_featured_facility() through; admin bypasses via is_admin_user; every
-- other path (grooming/health/garage direct updates, admin approval) is unchanged.
-- CREATE OR REPLACE keeps the existing trigger bound (no drop/create). NOT security
-- definer, no SET search_path — matches the live signature exactly.
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

  -- NEW: featured columns are admin-only. An owner sets featured_requested_at ONLY
  -- through request_featured_facility() (which sets the trusted-write GUC above and
  -- so never reaches here). featured_until is admin-only always. Without this an
  -- owner could self-feature with a single direct Supabase update.
  if new.featured_until is distinct from old.featured_until then
    raise exception 'facilities: featured_until is admin-only'; end if;
  if new.featured_requested_at is distinct from old.featured_requested_at then
    raise exception 'facilities: featured_requested_at is set via request_featured_facility'; end if;

  -- Garage material-field lock (20260802) — unchanged.
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

-- ─── 3. Owner request RPC — the only owner write path (generic) ──────────────
-- Sets featured_requested_at = now() on the owner's own live listing. Payment is
-- arranged off-app afterwards; this RPC does NOT touch featured_until (admin-only).
-- Idempotent: a repeat request while one is pending is a silent no-op.
CREATE OR REPLACE FUNCTION public.request_featured_facility(p_facility_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row facilities%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR is_anonymous_session() THEN
    RAISE EXCEPTION 'request_featured_facility: authentication required';
  END IF;

  SELECT * INTO v_row FROM facilities WHERE id = p_facility_id;
  IF NOT FOUND OR v_row.provider_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'request_featured_facility: not your listing';
  END IF;
  IF v_row.status <> 'active' OR NOT v_row.is_public THEN
    RAISE EXCEPTION 'request_featured_facility: listing must be live';
  END IF;
  IF v_row.featured_until IS NOT NULL AND v_row.featured_until > now() THEN
    RAISE EXCEPTION 'request_featured_facility: already featured';
  END IF;
  IF v_row.featured_requested_at IS NOT NULL THEN
    RETURN;  -- request already pending → no-op
  END IF;

  -- Trust THIS write only: the guard early-returns on this transaction-local GUC.
  PERFORM set_config('app.trusted_facility_write', '1', true);
  UPDATE facilities SET featured_requested_at = now() WHERE id = p_facility_id;
END;
$function$;

REVOKE ALL     ON FUNCTION public.request_featured_facility(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.request_featured_facility(uuid) TO authenticated;

COMMIT;

RESET ROLE;

-- ─── Verification (run after applying) ───────────────────────────────────────
--   -- As a non-admin garage owner, each of these must FAIL (admin-only lock):
--   UPDATE facilities SET featured_until = now() + interval '30 days'
--     WHERE provider_id = auth.uid();                       -- featured_until is admin-only
--   UPDATE facilities SET featured_requested_at = now()
--     WHERE provider_id = auth.uid();                       -- set via request_featured_facility
--
--   -- The owner RPC succeeds on their own live listing and lands a pending request:
--   SELECT request_featured_facility('<own-active-garage-id>');
--   SELECT featured_requested_at, featured_until FROM facilities WHERE id = '<own-active-garage-id>';
--     -- → featured_requested_at set, featured_until NULL.
--
--   -- Guard regression (must still hold): a direct material edit is blocked,
--   -- a minor direct edit is allowed:
--   UPDATE facilities SET name = 'x' WHERE id = '<own-garage-id>';   -- FAILS (garage material lock)
--   UPDATE facilities SET description = 'x' WHERE id = '<own-garage-id>'; -- OK
--
--   -- Admin activation (as admin, bypasses guard): pin for 30 days + clear request:
--   UPDATE facilities SET featured_until = now() + interval '30 days',
--                         featured_requested_at = NULL
--    WHERE id = '<garage-id>';

-- ─── Rollback ────────────────────────────────────────────────────────────────
--   SET ROLE postgres;
--   BEGIN;
--   DROP FUNCTION IF EXISTS public.request_featured_facility(uuid);
--   ALTER TABLE public.facilities
--     DROP COLUMN IF EXISTS featured_until,
--     DROP COLUMN IF EXISTS featured_requested_at;
--   -- then restore facilities_guard_update() body from 20260802_facilities_guard_garage_edit.sql
--   COMMIT;
--   RESET ROLE;
