-- ═══ Explore — Slice 1: `places` table + RLS + backfill from beaches/landmarks ═══
-- Consolidates the two pre-repo directories (`beaches`, `landmarks`) into ONE
-- generic, category-driven `places` table. Health `facilities` are structurally
-- excluded and UNTOUCHED. This migration CREATES + BACKFILLS only — it does NOT
-- drop beaches/landmarks (that is a separate, later migration) and it does NOT flip
-- any module flag. Explore stays admin-only-preview (MODULE_FLAGS.explore=false)
-- until Slice 5, so no public write path to `places` exists yet.
--
-- KEY MODELLING FACTS (verified against the live schema):
--   • district → region is a 1:1 IDENTITY copy. beaches_district_check /
--     landmarks_district_check enforce the SAME 7 slugs as constants/regions.js
--     REGIONS, so every legacy row maps with ZERO orphans.
--   • area has NO legacy source and NO coordinate→area classifier exists, so every
--     backfilled row gets area = NULL. RULE (must hold in the UI, Slice 2): a
--     NULL-area row appears in region-level + unfiltered views and is excluded ONLY
--     when a specific area filter is active — never silently dropped.
--   • name splits: legacy `name` (jsonb) → `name` (plain proper noun, extracted) +
--     `name_i18n` (the whole jsonb, preserving translations). `description` (jsonb)
--     → `description_i18n`.
--   • photo_urls (array) → cover_image_url (first) + photos (whole array).
--     photo_credits copied verbatim (CC BY-SA attribution is legally required).
--   • Beach-only fields SURVIVE: blue_flag, access_type, and the amenity array,
--     which is RENAMED `facilities`→`amenities` to kill the name-collision with the
--     health facilities table. All three are category-conditional in the UI.
--   • UUIDs are PRESERVED (INSERT … SELECT id) + ON CONFLICT (id) DO NOTHING, so the
--     backfill is idempotent (safe to re-run) and the parity check can join by id.
--
-- DEFERRED BY DESIGN (not in this slice):
--   • hidden_at / hidden_reason + the RESTRICTIVE hide policy + content filter → Slice 3.
--   • provider_id / status / featured admin-only GUARD trigger + featured columns +
--     place_claims → Slice 4. Safe to defer: the flag gates every user write until
--     Slice 5, and the INSERT policy below already forces user rows to status='pending'.
--
-- EXECUTION: SET ROLE postgres (CREATE TABLE + policies need the table owner; the SQL
-- editor's default 'authenticated' role raises 42501). Run with editor impersonation
-- OFF. Same wrapper as 20260805/0806/0803. NOTIFY pgrst at the tail exposes the new
-- table+columns to PostgREST immediately.

SET ROLE postgres;
BEGIN;

-- ─── 1. Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.places (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),

  -- Identity / taxonomy
  category              text NOT NULL,               -- snake_case; group derived in JS
  name                  text NOT NULL,               -- proper noun, plain text
  name_i18n             jsonb,                        -- NULLABLE (a café needs no translated name)
  description_i18n      jsonb,

  -- Location (facilities geography scheme — constants/regions.js + areas.js)
  region                text NOT NULL,               -- one of the 7 canonical slugs
  area                  text,                         -- area SLUG, nullable, validated in JS
  latitude              double precision,
  longitude             double precision,
  address               text,

  -- Contact
  phone                 text,
  website               text,
  opening_hours         jsonb,

  -- Media
  cover_image_url       text,
  photos                text[] NOT NULL DEFAULT '{}'::text[],
  photo_credits         text[],

  -- Ownership
  provider_id           uuid REFERENCES public.profiles(id) ON DELETE SET NULL,  -- admin-only (guard: Slice 4)
  submitted_by          uuid REFERENCES auth.users(id)      ON DELETE SET NULL,

  -- Lifecycle
  status                text NOT NULL DEFAULT 'pending',
  rejection_reason      text,                         -- set when an admin rejects a pending row (Slice 3 uses it)
  created_at            timestamptz NOT NULL DEFAULT now(),  -- default is for NEW rows; backfill COPIES source
  updated_at            timestamptz NOT NULL DEFAULT now(),  -- default is for NEW rows; backfill COPIES source

  -- Beach-generalizable attributes (category-conditional in the UI)
  blue_flag             boolean,                      -- EU cleanliness cert (beaches)
  access_type           text,                         -- public | private (beaches, pools, nature spots)
  amenities             text[],                       -- free-text amenity list (wifi, power, seating…)

  CONSTRAINT places_pkey PRIMARY KEY (id),
  CONSTRAINT places_category_check    CHECK (category ~ '^[a-zA-Z_]{2,40}$'),
  CONSTRAINT places_region_check      CHECK (region = ANY (ARRAY['nicosia','kyrenia','famagusta','morphou','iskele','lefke','karpaz']::text[])),
  CONSTRAINT places_status_check      CHECK (status = ANY (ARRAY['pending','active','rejected']::text[])),
  CONSTRAINT places_access_type_check CHECK (access_type IS NULL OR access_type = ANY (ARRAY['public','private']::text[]))
);

COMMENT ON TABLE  public.places IS
  'Explore directory. Consolidates pre-repo beaches+landmarks. Category is a shape-guarded plain text column (no lookup table); the group→category taxonomy lives in constants/exploreCategories.js. Health facility types are structurally excluded.';
COMMENT ON COLUMN public.places.category IS
  'snake_case leaf category. Shape-guarded only; the valid-value list lives in JS (adding a category = JS edit + OTA, no migration).';
COMMENT ON COLUMN public.places.name_i18n IS
  'Nullable. Translated names for landmarks/beaches; NULL for places whose proper noun is not translated (cafés).';
COMMENT ON COLUMN public.places.area IS
  'Area slug under region (constants/areas.js). NULL for all backfilled rows. A NULL-area row must appear in region-level + unfiltered views; excluded only under an active area filter.';
COMMENT ON COLUMN public.places.provider_id IS
  'Admin-only owner link, written only by the place_claims approve flow (Slice 4). NULL = unclaimed.';
COMMENT ON COLUMN public.places.amenities IS
  'Free-text amenity list (renamed from the legacy beaches.facilities column to avoid collision with the health facilities table). May be constrained to an enum later.';

-- ─── 2. RLS ──────────────────────────────────────────────────────────────────
-- Plain English:
--   SELECT — anyone reads a place once it is 'active'; the submitter and the owner
--            always see their own row (any status); admin sees everything.
--   INSERT — admins may create any row; a normal user may create ONLY a row
--            attributed to themselves AND born 'pending' (cannot self-publish an
--            active listing — every user suggestion lands in the moderation queue).
--            (This intentionally hardens the legacy beaches insert policy, which
--            did not pin status.) Anonymous sessions are blocked (restrictive).
--   UPDATE — submitter, owner, or admin may edit their row. Column-level locks
--            (status/provider_id/featured admin-only) arrive with the Slice 4 guard
--            trigger; until then the module is flag-gated, so no user reaches this.
--   DELETE — admin only.
ALTER TABLE public.places ENABLE ROW LEVEL SECURITY;

-- DROP-before-CREATE on every policy so the whole migration is RE-RUNNABLE — re-running
-- the backfill is the drift-sync mechanism before the Slice 5 flip (house precedent: 20260803).
DROP POLICY IF EXISTS "places_select" ON public.places;
CREATE POLICY "places_select" ON public.places
  FOR SELECT TO public
  USING (
    status = 'active'
    OR submitted_by = auth.uid()
    OR provider_id  = auth.uid()
    OR is_admin()
  );

DROP POLICY IF EXISTS "places_insert" ON public.places;
CREATE POLICY "places_insert" ON public.places
  FOR INSERT TO public
  WITH CHECK (
    is_admin()
    OR (submitted_by = auth.uid() AND status = 'pending')
  );
DROP POLICY IF EXISTS "no_anon_insert_places" ON public.places;
CREATE POLICY "no_anon_insert_places" ON public.places
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT is_anonymous_session());

DROP POLICY IF EXISTS "places_update" ON public.places;
CREATE POLICY "places_update" ON public.places
  FOR UPDATE TO public
  USING (submitted_by = auth.uid() OR provider_id = auth.uid() OR is_admin());
DROP POLICY IF EXISTS "no_anon_update_places" ON public.places;
CREATE POLICY "no_anon_update_places" ON public.places
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT is_anonymous_session());

DROP POLICY IF EXISTS "places_delete" ON public.places;
CREATE POLICY "places_delete" ON public.places
  FOR DELETE TO public
  USING (is_admin());
DROP POLICY IF EXISTS "no_anon_delete_places" ON public.places;
CREATE POLICY "no_anon_delete_places" ON public.places
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT is_anonymous_session());

-- ─── 3. Indexes ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_places_status       ON public.places (status);
CREATE INDEX IF NOT EXISTS idx_places_region       ON public.places (region);
CREATE INDEX IF NOT EXISTS idx_places_category     ON public.places (category);
CREATE INDEX IF NOT EXISTS idx_places_provider     ON public.places (provider_id);
CREATE INDEX IF NOT EXISTS idx_places_submitted_by ON public.places (submitted_by);

-- ─── 4. Backfill — beaches ───────────────────────────────────────────────────
-- category = literal 'beach'. amenities = legacy beaches.facilities (text[]).
-- NOTE: `facilities` here is the beaches AMENITY column (rendered in the old
-- profile's "Facilities" section), NOT the health facilities table. If your DB does
-- not have beaches.facilities, remove the `b.facilities` line below before running.
INSERT INTO public.places (
  id, category, name, name_i18n, description_i18n,
  region, latitude, longitude,
  cover_image_url, photos, photo_credits,
  submitted_by, status, created_at, updated_at,
  blue_flag, access_type, amenities
)
SELECT
  b.id,
  'beach',
  coalesce(
    b.name->>'en', b.name->>'tr',
    CASE WHEN jsonb_typeof(b.name) = 'object'      -- typeof guard: jsonb_each_text
         THEN (SELECT v FROM jsonb_each_text(b.name) AS kv(k, v) LIMIT 1)  -- errors on a scalar
         ELSE b.name #>> '{}' END,                 -- scalar string → its text
    b.name::text),                                 -- non-null safety net (surfaced by A1)
  b.name,
  b.description,
  b.district,                              -- identity → region
  b.latitude, b.longitude,
  b.photo_urls[1],                         -- first photo → cover (NULL on empty array)
  coalesce(b.photo_urls, '{}'::text[]),
  b.photo_credits,
  b.submitted_by,
  b.status,
  coalesce(b.created_at, now()),                -- COPY source timestamps (not now()); coalesce = null-safety only
  coalesce(b.updated_at, b.created_at, now()),
  b.blue_flag, b.access_type, b.facilities
FROM public.beaches b
ON CONFLICT (id) DO NOTHING;

-- ─── 5. Backfill — landmarks ─────────────────────────────────────────────────
-- category = legacy landmarks.category verbatim (all 6 values live in the taxonomy).
-- No blue_flag / access_type / amenities (default NULL).
INSERT INTO public.places (
  id, category, name, name_i18n, description_i18n,
  region, latitude, longitude,
  cover_image_url, photos, photo_credits,
  submitted_by, status, created_at, updated_at
)
SELECT
  l.id,
  l.category,
  coalesce(
    l.name->>'en', l.name->>'tr',
    CASE WHEN jsonb_typeof(l.name) = 'object'
         THEN (SELECT v FROM jsonb_each_text(l.name) AS kv(k, v) LIMIT 1)
         ELSE l.name #>> '{}' END,
    l.name::text),
  l.name,
  l.description,
  l.district,
  l.latitude, l.longitude,
  l.photo_urls[1],
  coalesce(l.photo_urls, '{}'::text[]),
  l.photo_credits,
  l.submitted_by,
  l.status,
  coalesce(l.created_at, now()),
  coalesce(l.updated_at, l.created_at, now())
FROM public.landmarks l
ON CONFLICT (id) DO NOTHING;

COMMIT;
RESET ROLE;

-- New table + columns → refresh the PostgREST cache so the REST API sees them
-- immediately (else a stale cache raises 42703/PGRST205 on the first query).
NOTIFY pgrst, 'reload schema';

-- ═══ PARITY CHECK — run each block (Role = postgres) and report the output ═══
-- Run IMMEDIATELY after backfill, BEFORE any admin seeds new places (once new rows
-- exist, `places` ≠ legacy and the simple totals below no longer line up — filter
-- by the backfilled categories if you run it later).
--
-- (P1) THE INVARIANT YOU ASKED FOR — PINNED BASELINE, do not live re-count.
--      Confirmed 2026-08-13: beaches active = 4, landmarks active = 38, combined = 42,
--      and EVERY legacy row is 'active' (no pending/rejected) → total = active = 42.
--      After backfill, BOTH of these MUST return exactly 42:
--   SELECT count(*) FROM places;                       -- MUST equal 42  (total)
--   SELECT count(*) FROM places WHERE status='active'; -- MUST equal 42  (active)
--
-- (P3) NULL-area rule — every backfilled row is area IS NULL and still counted:
--   SELECT count(*) FILTER (WHERE area IS NULL) AS null_area, count(*) AS total FROM places;
--     -- null_area == total (right after backfill).
--
-- (P4) Per-region breakdown (eyeball beaches+landmarks vs places side by side):
--   SELECT 'legacy' src, district region, count(*) FROM (
--     SELECT district FROM beaches UNION ALL SELECT district FROM landmarks) u GROUP BY district
--   UNION ALL
--   SELECT 'places', region, count(*) FROM places GROUP BY region
--   ORDER BY 2, 1;
--
-- (A1) ANOMALY — empty extracted name (investigate any row returned):
--   SELECT id, category, region, name_i18n FROM places WHERE btrim(coalesce(name,'')) = '';
-- (A2) ANOMALY — category outside the taxonomy (MUST be zero):
--   SELECT id, category FROM places WHERE category NOT IN
--     ('beach','castle_fortress','ancient_ruins','museum','religious_site','monument','nature_scenic');
-- (A3) ANOMALY — region outside the 7 (MUST be zero; CHECK guarantees it):
--   SELECT id, region FROM places WHERE region NOT IN
--     ('nicosia','kyrenia','famagusta','morphou','iskele','lefke','karpaz');

-- ═══ PRE-FLIP CATCH-UP (Slice 5, immediately before the flag flip) ═══════════
-- Production keeps writing to beaches/landmarks until the flip OTA ships (the live
-- FAB inserts there). New legacy rows therefore accumulate AFTER this first backfill:
--   • Re-run the two INSERT…SELECT blocks above just before the flip to pull in NEW
--     rows (ON CONFLICT DO NOTHING makes the re-run safe — that is why this whole
--     migration is idempotent).
--   • EDITS to already-copied rows are NOT propagated by ON CONFLICT DO NOTHING.
--     Because updated_at is copied, drift is free to detect (then fix by hand):
--       SELECT b.id FROM beaches   b JOIN places p USING (id) WHERE b.updated_at > p.updated_at;
--       SELECT l.id FROM landmarks l JOIN places p USING (id) WHERE l.updated_at > p.updated_at;
--   • After catch-up the pinned "42" no longer holds — expected; 42 is the assertion
--     for THIS first apply only.
--   • If an INSERT throws an FK violation on submitted_by, it is a stale legacy uuid
--     for a deleted auth user: NULL that row's submitted_by in the source and re-run.

-- ═══ ROLLBACK ════════════════════════════════════════════════════════════════
--   SET ROLE postgres;
--   BEGIN;
--   DROP TABLE IF EXISTS public.places;   -- drops policies + indexes with it
--   COMMIT;
--   RESET ROLE;
--   NOTIFY pgrst, 'reload schema';
