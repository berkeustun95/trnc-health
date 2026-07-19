-- ─── Facilities — RLS guards (read policy + insert/update column locks) ─────
-- FIXES three holes on the `facilities` table:
--   1. READ was `qual: true` — every row (including status='pending' and
--      is_public=false) was world-readable, so unapproved / non-public
--      facilities leaked through the public API and onto the map.
--   2. INSERT had no guard — a provider self-onboarding could have set their own
--      row live (status='active', is_public=true, verified=true) directly.
--   3. UPDATE had no guard — a provider could flip their own row's lifecycle /
--      moderation columns (verified, status, is_public, membership_tier,
--      trial_ends_at) or reassign provider_id via a direct Supabase API call,
--      bypassing admin approval entirely.
--
-- Contact fields (phone, address, opening_hours, description, languages) are
-- ALSO locked here: providers legitimately edit them only through the
-- `facility_change_requests` INSERT flow (ProviderScreen.js:427), which admin
-- approves before the live row changes. This migration makes the DB enforce
-- what the app already does.
--
-- Columns a provider MAY still self-write directly (the allow-list, from code):
--   specialty        (ProviderScreen.js:303)
--   availability     (ProviderScreen.js:309)
--   logo_url         (ProviderScreen.js:361)
--   cover_image_url  (ProviderScreen.js:361)
--   photos           (ProviderScreen.js:395, 407)
--   latitude         (ProviderScreen.js:415)
--   longitude        (ProviderScreen.js:415)
--
-- RLS policies cannot compare OLD vs NEW columns, so column immutability is
-- enforced with BEFORE INSERT / BEFORE UPDATE triggers, matching the pattern in
-- jp_guard_owner_update (20260705_job_postings_rls_lockdown.sql).
--
-- NOTE: This is the FIRST of the app's RLS rules to be captured as a migration.
-- The rest (is_admin(), the home_services policies, existing facilities
-- policies, etc.) currently live only in the Supabase project and should be
-- backfilled into migrations later.

BEGIN;

-- ─── (1) Read policy — replace the wide-open `qual: true` ────────────────────
-- Plain English:
--   • Public (anyone): sees a facility only when it is LIVE — status = 'active'
--     AND is_public = true.
--   • Owner: sees their own facilities regardless of status/is_public
--     (provider_id = auth.uid()), so they can manage a pending listing.
--   • Admin: sees everything (is_admin()).
DROP POLICY IF EXISTS "Anyone can read facilities" ON facilities;

CREATE POLICY "Facilities read access" ON facilities FOR SELECT
  USING (
    (status = 'active' AND is_public = true)
    OR provider_id = auth.uid()
    OR is_admin()
  );

-- ─── (2) Insert guard — new rows are born pending / private / unverified ─────
-- A non-admin, non-service-role insert (i.e. a provider self-onboarding) always
-- lands as status='pending', is_public=false, verified=false regardless of what
-- the client sent. Service role (auth.uid() IS NULL) and admin are trusted.
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

  -- Provider self-onboarding: force the row into the pending lifecycle.
  NEW.status    := 'pending';
  NEW.is_public := false;
  NEW.verified  := false;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS facilities_guard_insert ON facilities;
CREATE TRIGGER facilities_guard_insert
  BEFORE INSERT ON facilities
  FOR EACH ROW EXECUTE FUNCTION facilities_guard_insert();

-- ─── (3) Update guard — owners cannot touch lifecycle or contact columns ─────
-- Owner may edit only the self-write allow-list above. Any change to a
-- lifecycle/moderation column, or to a contact field (which must route through
-- facility_change_requests), is rejected. Service role and admin are trusted.
CREATE OR REPLACE FUNCTION facilities_guard_owner_update() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE is_admin boolean;
BEGIN
  -- System context (no JWT, e.g. admin-approval flow via service role): trust it.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    INTO is_admin;
  IF is_admin THEN
    RETURN NEW;                                        -- admin may change anything
  END IF;

  -- Owner path: lock the lifecycle / moderation columns.
  IF NEW.provider_id IS DISTINCT FROM OLD.provider_id THEN
    RAISE EXCEPTION 'facilities: provider_id is admin-only';
  END IF;
  IF NEW.verified IS DISTINCT FROM OLD.verified THEN
    RAISE EXCEPTION 'facilities: verified is admin-only';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'facilities: status is admin-only';
  END IF;
  IF NEW.is_public IS DISTINCT FROM OLD.is_public THEN
    RAISE EXCEPTION 'facilities: is_public is admin-only';
  END IF;
  IF NEW.membership_tier IS DISTINCT FROM OLD.membership_tier THEN
    RAISE EXCEPTION 'facilities: membership_tier is admin-only';
  END IF;
  IF NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at THEN
    RAISE EXCEPTION 'facilities: trial_ends_at is admin-only';
  END IF;

  -- Contact fields must route through facility_change_requests (Step 1 = A):
  -- the live row is never touched directly for these.
  IF NEW.phone IS DISTINCT FROM OLD.phone THEN
    RAISE EXCEPTION 'facilities: phone must be changed via facility_change_requests';
  END IF;
  IF NEW.address IS DISTINCT FROM OLD.address THEN
    RAISE EXCEPTION 'facilities: address must be changed via facility_change_requests';
  END IF;
  IF NEW.opening_hours IS DISTINCT FROM OLD.opening_hours THEN
    RAISE EXCEPTION 'facilities: opening_hours must be changed via facility_change_requests';
  END IF;
  IF NEW.description IS DISTINCT FROM OLD.description THEN
    RAISE EXCEPTION 'facilities: description must be changed via facility_change_requests';
  END IF;
  IF NEW.languages IS DISTINCT FROM OLD.languages THEN
    RAISE EXCEPTION 'facilities: languages must be changed via facility_change_requests';
  END IF;

  -- Everything else (specialty, availability, logo_url, cover_image_url, photos,
  -- latitude, longitude) is the provider's to edit directly.
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS facilities_guard_owner_update ON facilities;
CREATE TRIGGER facilities_guard_owner_update
  BEFORE UPDATE ON facilities
  FOR EACH ROW EXECUTE FUNCTION facilities_guard_owner_update();

COMMIT;

-- TODO(app): MapScreen.js:41 — the map still renders every fetched facility with
-- no status/is_public filter (second layer for the pending-visibility bug).
-- This migration closes it at the DB; add the client-side filter there too.

-- Rollback:
--   BEGIN;
--   DROP TRIGGER IF EXISTS facilities_guard_owner_update ON facilities;
--   DROP FUNCTION IF EXISTS facilities_guard_owner_update();
--   DROP TRIGGER IF EXISTS facilities_guard_insert ON facilities;
--   DROP FUNCTION IF EXISTS facilities_guard_insert();
--   DROP POLICY IF EXISTS "Facilities read access" ON facilities;
--   CREATE POLICY "Anyone can read facilities" ON facilities FOR SELECT USING (true);
--   COMMIT;
