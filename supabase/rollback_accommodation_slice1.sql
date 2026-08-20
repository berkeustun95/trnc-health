-- ─── Slice 1 ROLLBACK — 20260904_accommodation_partner_feed.sql ──────────────
--
-- SQL editor, Role selector = postgres.
--
-- ⚠ CLEAN ONLY BEFORE SLICE 2 HAS IMPORTED DATA.
--   Once the first sync has run, steps 6-7 destroy provenance: source, external_id,
--   content_hash and last_seen_at are the only record of which listings came from
--   Novest and when. Dropping them does not just lose columns — the NEXT sync then
--   matches nothing on external_id and re-INSERTS all ~200 listings as brand-new
--   rows alongside the originals. (Exactly the duplicate-set failure that
--   20260831_events_external_id_remap.sql exists to prevent for events.)
--
-- ⚠ STEPS 4 AND 5 ARE DESIGNED TO FAIL IF DATA DEPENDS ON THEM. That is the safety
--   property, not a defect — see the note at each step. Do not "fix" them by
--   deleting rows.
--
-- PARTIAL ROLLBACK IS SAFE at any numbered step boundary. If you only need to undo
-- the VISIBILITY change, run STEP 1 ALONE and stop: it restores the pre-Slice-1
-- policies without touching a single column, and is the fastest escape hatch.

SET ROLE postgres;
BEGIN;

-- ─── STEP 1. RLS + storage (the fastest escape hatch — safe to run alone) ────
-- Restores props_select_public and images_select_public exactly as
-- supabase/subscription_migration.sql left them: no source branch, INNER JOIN.
DROP POLICY IF EXISTS "props_select_public" ON public.properties;
CREATE POLICY "props_select_public" ON public.properties
  FOR SELECT TO public
  USING (
    (
      status = 'active'
      AND EXISTS (
        SELECT 1 FROM estate_agents ea
        WHERE ea.id = properties.agent_id
          AND ea.subscription_expires_at IS NOT NULL
          AND ea.subscription_expires_at > now()
      )
    )
    OR agent_id IN (SELECT id FROM estate_agents WHERE user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "images_select_public" ON public.property_images;
CREATE POLICY "images_select_public" ON public.property_images
  FOR SELECT TO public
  USING (
    property_id IN (
      SELECT p.id FROM properties p
      JOIN estate_agents ea ON ea.id = p.agent_id
      WHERE p.status = 'active'
        AND ea.subscription_expires_at IS NOT NULL
        AND ea.subscription_expires_at > now()
    )
    OR property_id IN (
      SELECT p.id FROM properties p
      JOIN estate_agents ea ON ea.id = p.agent_id
      WHERE ea.user_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- props_update_agent back to USING-only (no explicit WITH CHECK). Behaviour is
-- identical either way — Postgres applies USING to the new row when WITH CHECK is
-- absent — so this line is cosmetic restoration, not a behaviour change.
DROP POLICY IF EXISTS "props_update_agent" ON public.properties;
CREATE POLICY "props_update_agent" ON public.properties
  FOR UPDATE TO public
  USING (
    agent_id IN (SELECT id FROM estate_agents WHERE user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ⚠ If this raises "must be owner of table objects" (42501), uncomment the SET ROLE
--   line and the matching RESET ROLE below.
-- SET ROLE supabase_storage_admin;
DROP POLICY IF EXISTS "property_images_upload" ON storage.objects;
CREATE POLICY "property_images_upload" ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'property-images' AND auth.role() = 'authenticated');
-- RESET ROLE;   -- ← uncomment together with the SET ROLE line above

-- ─── STEP 2. Trigger + function ─────────────────────────────────────────────
DROP TRIGGER  IF EXISTS properties_touch_updated_at ON public.properties;
DROP FUNCTION IF EXISTS public.properties_touch_updated_at();

-- ─── STEP 3. Indexes ────────────────────────────────────────────────────────
DROP INDEX IF EXISTS public.properties_browse_idx;
DROP INDEX IF EXISTS public.property_images_property_id_idx;
DROP INDEX IF EXISTS public.property_images_primary_unique;

-- ─── STEP 4. agent_id back to NOT NULL ──────────────────────────────────────
-- ⚠ FAILS (23502) if ANY partner row exists — every feed listing has agent_id NULL.
--   That failure is correct: it is telling you imported data would be orphaned.
--   To proceed you must first decide what happens to those listings.
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_source_agent_xor_check;
ALTER TABLE public.properties ALTER COLUMN agent_id SET NOT NULL;

-- ─── STEP 5. Narrow the four widened CHECKs ─────────────────────────────────
-- ⚠ EACH FAILS (23514) if any row uses a value being removed — 'delisted', 'USD',
--   'lefke', 'karpaz', 'weekly', 'yearly'. Reclassify those rows first, or leave the
--   widened CHECK in place: a widened CHECK is harmless on its own.
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_status_check;
ALTER TABLE public.properties ADD CONSTRAINT properties_status_check
  CHECK (status = ANY (ARRAY['pending','active','rejected','archived']::text[]));

ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_currency_check;
ALTER TABLE public.properties ADD CONSTRAINT properties_currency_check
  CHECK (currency = ANY (ARRAY['GBP','TRY','EUR']::text[]));

-- NB: restoring this one REINSTATES THE LIVE BUG that a Lefke or Karpaz listing
-- cannot be inserted. Only do it if you are reverting the whole slice.
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_district_check;
ALTER TABLE public.properties ADD CONSTRAINT properties_district_check
  CHECK (district = ANY (ARRAY['nicosia','kyrenia','famagusta','morphou','iskele']::text[]));

ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_price_period_check;
ALTER TABLE public.properties ADD CONSTRAINT properties_price_period_check
  CHECK (price_period = ANY (ARRAY['monthly','nightly','total']::text[]));

-- ─── STEP 6. New constraints ────────────────────────────────────────────────
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_external_id_unique;
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_deed_type_check;
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_deposit_currency_check;
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_amenities_shape_check;
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_structure_range_check;
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_location_precision_check;
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_coords_precision_check;
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_feed_precision_check;

-- ─── STEP 7. Columns — IRREVERSIBLE DATA LOSS ───────────────────────────────
ALTER TABLE public.properties DROP COLUMN IF EXISTS source;
ALTER TABLE public.properties DROP COLUMN IF EXISTS external_id;
ALTER TABLE public.properties DROP COLUMN IF EXISTS source_url;
ALTER TABLE public.properties DROP COLUMN IF EXISTS last_seen_at;
ALTER TABLE public.properties DROP COLUMN IF EXISTS content_hash;
ALTER TABLE public.properties DROP COLUMN IF EXISTS updated_at;
ALTER TABLE public.properties DROP COLUMN IF EXISTS published_at;
ALTER TABLE public.properties DROP COLUMN IF EXISTS deed_type;
ALTER TABLE public.properties DROP COLUMN IF EXISTS net_area_sqm;
ALTER TABLE public.properties DROP COLUMN IF EXISTS plot_sqm;
ALTER TABLE public.properties DROP COLUMN IF EXISTS covered_area_sqm;
ALTER TABLE public.properties DROP COLUMN IF EXISTS floor;
ALTER TABLE public.properties DROP COLUMN IF EXISTS total_floors;
ALTER TABLE public.properties DROP COLUMN IF EXISTS building_age_band;
ALTER TABLE public.properties DROP COLUMN IF EXISTS living_rooms;
ALTER TABLE public.properties DROP COLUMN IF EXISTS ensuite_count;
ALTER TABLE public.properties DROP COLUMN IF EXISTS deposit;
ALTER TABLE public.properties DROP COLUMN IF EXISTS deposit_currency;
ALTER TABLE public.properties DROP COLUMN IF EXISTS min_term_months;
ALTER TABLE public.properties DROP COLUMN IF EXISTS bills_included;
ALTER TABLE public.properties DROP COLUMN IF EXISTS amenities;
ALTER TABLE public.properties DROP COLUMN IF EXISTS area;
ALTER TABLE public.properties DROP COLUMN IF EXISTS development_name;
ALTER TABLE public.properties DROP COLUMN IF EXISTS swap_available;
ALTER TABLE public.properties DROP COLUMN IF EXISTS gated_community;
-- location_precision: dropping this DESTROYS the exact/approximate distinction for
-- every pinned row. Harmless while feed rows have no coordinates; if Slice 2 has
-- backfilled area centroids, the remaining latitude/longitude become unlabelled and
-- indistinguishable from real pins. Clear those coordinates first, or keep this column.
ALTER TABLE public.properties DROP COLUMN IF EXISTS location_precision;
COMMENT ON COLUMN public.properties.area_sqm IS NULL;

ALTER TABLE public.property_images DROP COLUMN IF EXISTS source_url;
ALTER TABLE public.property_images DROP COLUMN IF EXISTS content_hash;
ALTER TABLE public.property_images DROP COLUMN IF EXISTS is_primary;

ALTER TABLE public.estate_agencies DROP COLUMN IF EXISTS contact_name;
ALTER TABLE public.estate_agencies DROP COLUMN IF EXISTS contact_phone;
ALTER TABLE public.estate_agencies DROP COLUMN IF EXISTS contact_whatsapp;

-- ─── STEP 8. Ledger ─────────────────────────────────────────────────────────
DELETE FROM public.schema_migrations_applied
WHERE filename = '20260904_accommodation_partner_feed.sql';

COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── WHAT CANNOT BE UNDONE ──────────────────────────────────────────────────
--   • updated_at's backfill. The column's original all-NULL state is gone. It
--     carried no information (the column did not exist), so this costs nothing.
--   • Everything in step 7, if Slice 2 has already run — see the header.
-- Also remove the Slice 1 entries from supabase/verify_schema.sql (sections B, C,
-- D, E, F, H) and re-run node scripts/migration-ledger.mjs, or the drift check will
-- report the objects you just dropped as MISSING.
