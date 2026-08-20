-- ─── Accommodation — partner feed schema (Slice 1 of 3) ──────────────────────
--
-- Prepares `properties` / `property_images` / `estate_agencies` for the one-way
-- Coldwell Banker Novest import. SCHEMA AND DATA LAYER ONLY — no import script
-- (Slice 2), no UI (Slice 3). MODULE_FLAGS.accommodation stays false: nothing
-- in this migration is reachable by a user.
--
-- Current-state audit this is built on:
--   ~/ObsidianVault/10-ada/2026-08-19_accommodation-current-state.md
--
-- ─── THE ONE THING TO UNDERSTAND BEFORE READING THE SQL ─────────────────────
--
-- The visibility rule gains a bypass: a listing with `source IS NOT NULL` is
-- publicly visible WITHOUT the agent-subscription check, because a feed listing
-- has no agent to hold a subscription.
--
-- That bypass is only safe because `properties_source_agent_xor_check` makes it
-- impossible for an agent-owned row to carry a `source`. WITHOUT that constraint,
-- any agent whose subscription had expired could simply
--
--     UPDATE properties SET source = 'novest' WHERE id = <their own row>;
--
-- and buy themselves permanent free visibility. `props_update_agent` permits the
-- statement (it is still their row) and there is NO trigger on `properties` to
-- catch it. The CHECK is the only thing standing there.
--
-- => The XOR constraint and the RLS rewrite are ONE change. Never apply one
--    without the other, and never drop the XOR while the RLS rule stands.
--
-- ─── WHY agent_id BECOMES NULLABLE (and not a "system agent" row) ────────────
-- A partner listing has no agent and must never surface one (product decision).
-- The alternative — one hidden estate_agents row for Novest — is worse on every
-- axis: estate_agents.user_id is NOT NULL FK to auth.users, so it needs a FAKE
-- AUTH ACCOUNT; and `agents_select_public` exposes status='active' agents to
-- anon, so that fake agent's name and phone would be PUBLICLY READABLE, which is
-- exactly what the product decision forbids.
--
-- ─── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
--   • 'sold' / 'reserved' statuses — the 101evler recon was blocked by Cloudflare
--     before any listing page could be read, so there is NO verified evidence the
--     feed exposes them. Adding a status later is a one-line CHECK swap; removing
--     one after Slice 3 renders it is not. Slice 2 decides against the real feed.
--   • A GIN index on amenities — the repo has none anywhere and at 200-2000 rows a
--     containment filter scans fine. Add in Slice 3 IF the amenity filter ships.
--   • The Novest estate_agencies row itself — that is DATA, not schema. Slice 2.
--     NB estate_agencies.owner_id is NOT NULL: use the admin account, as
--     supabase/dummy_listing.sql does.
--
-- ─── EXECUTION ──────────────────────────────────────────────────────────────
-- SQL editor, Role selector = postgres. ALTER TABLE needs the table owner.
--
-- ⚠ IF THIS FAILS WITH  "ERROR: must be owner of table objects"  (42501) it is the
--   storage policy in section 9. Uncomment the two SET ROLE supabase_storage_admin
--   / RESET ROLE lines marked there and re-run the whole thing. The transaction is
--   atomic, so a failure leaves the database completely untouched.

SET ROLE postgres;
BEGIN;

-- ─── 0. PRE-FLIGHT GUARD ────────────────────────────────────────────────────
-- Aborts rather than half-applying against a database that is not in the shape
-- this migration was written for.
DO $$
DECLARE
  problem  text   := '';
  n_orphan bigint := 0;
BEGIN
  IF to_regclass('public.properties') IS NULL THEN
    problem := problem || ' table properties is absent;';
  END IF;
  -- The RLS rewrite in section 10 reads this column. It comes from the root file
  -- supabase/subscription_migration.sql, which is NOT in the migration ledger, so
  -- nothing else can attest that it was ever applied.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='estate_agents'
                   AND column_name='subscription_expires_at') THEN
    problem := problem || ' estate_agents.subscription_expires_at is absent'
                       || ' (apply supabase/subscription_migration.sql first);';
  END IF;
  -- A row already NULL here means a partial apply of THIS migration. Re-running is
  -- otherwise safe (everything below is idempotent), but the XOR constraint added in
  -- section 7 would fail on such a row and the error would point at the constraint
  -- rather than at the real cause.
  --
  -- NOTE THE NESTED IF + EXECUTE. It cannot be flattened into one AND-ed condition:
  -- plpgsql plans the WHOLE expression before evaluating it, so a direct reference to
  -- `source` would raise 42703 "column does not exist" on the FIRST run — the very run
  -- where the column legitimately does not exist yet. EXECUTE defers planning until we
  -- already know it is there.
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='properties' AND column_name='source') THEN
    EXECUTE 'SELECT count(*) FROM public.properties WHERE agent_id IS NULL AND source IS NULL'
      INTO n_orphan;
    IF n_orphan > 0 THEN
      problem := problem || ' ' || n_orphan || ' properties row(s) have agent_id NULL and'
                         || ' source NULL (partial apply — fix those rows before re-running);';
    END IF;
  END IF;
  IF problem <> '' THEN
    RAISE EXCEPTION 'Pre-flight failed:%', problem;
  END IF;
END $$;

-- ─── 1. PROVENANCE / SYNC COLUMNS ───────────────────────────────────────────
-- source is intentionally UNCONSTRAINED (no CHECK), matching events.source: a
-- CHECK would force a migration per partner.
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS source        text;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS external_id   text;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS source_url    text;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS last_seen_at  timestamptz;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS content_hash  text;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS published_at  timestamptz;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS updated_at    timestamptz;

COMMENT ON COLUMN public.properties.source IS
  'NULL = agent-submitted (self-serve marketplace). Non-NULL = partner feed, e.g. '
  '''novest''. Enforced mutually exclusive with agent_id by '
  'properties_source_agent_xor_check, which the public visibility rule depends on.';
COMMENT ON COLUMN public.properties.last_seen_at IS
  'Stamped on EVERY sync run, whether or not anything changed. Absence from a run is '
  'what marks a listing delisted. Deliberately excluded from the updated_at trigger.';
COMMENT ON COLUMN public.properties.content_hash IS
  'Hash of the normalised source payload. Lets the import skip unchanged listings '
  'without diffing every column.';

-- updated_at BACKFILL — order matters. The column is added with NO default so that
-- existing rows land NULL rather than being stamped with today's date, which would
-- falsify their history. Backfill to created_at, and only THEN set the default.
UPDATE public.properties SET updated_at = COALESCE(created_at, now()) WHERE updated_at IS NULL;
ALTER TABLE public.properties ALTER COLUMN updated_at SET DEFAULT now();

-- ─── 2. TRNC DEED TYPE ──────────────────────────────────────────────────────
-- CHECK, not a native enum: this schema has ZERO native enum types — every
-- enumerated value is a text column with a CHECK. Native enums are also worse here
-- (ALTER TYPE ... ADD VALUE is not transactional-rollback-safe, reordering means
-- recreating the type, PostgREST surfaces them differently).
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS deed_type text;

ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_deed_type_check;
ALTER TABLE public.properties ADD CONSTRAINT properties_deed_type_check
  CHECK (deed_type IS NULL OR deed_type = ANY (ARRAY[
    'turkish',      -- Turkish title  (Türk koçanı)
    'exchange',     -- Exchange       (Eşdeğer)
    'foreign',      -- Foreign title  (Yabancı koçan)
    'allocation',   -- Allocation     (Tahsis)
    'tmd'           -- TMD
  ]::text[]));

COMMENT ON COLUMN public.properties.deed_type IS
  'KNOWN SPARSE — expect mostly NULL. 101evler does NOT expose deed type as a '
  'structured field; it appears only inside the free-text title and description. Any '
  'Slice 2 attempt to parse it is heuristic and unreliable, so NULL means "not known", '
  'never "no deed". Nullable with no NOT NULL implication anywhere.';

-- ─── 3. AREA AND STRUCTURE ──────────────────────────────────────────────────
-- area_sqm is KEPT, not renamed: AccommodationScreen.js and PropertyDetailScreen.js
-- both read `area_sqm`, and the parked marketplace screens must not break. A COMMENT
-- carries the meaning instead, at zero risk.
COMMENT ON COLUMN public.properties.area_sqm IS
  'GROSS internal area in m² (brüt). Net is net_area_sqm; plot is plot_sqm. Kept under '
  'this name rather than renamed because the parked marketplace screens read it.';

ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS net_area_sqm     numeric;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS plot_sqm         numeric;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS covered_area_sqm numeric;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS floor            int;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS total_floors     int;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS building_age_band     text;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS living_rooms     int;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS ensuite_count    int;

COMMENT ON COLUMN public.properties.living_rooms IS
  'Salon count, for the Turkish "2+1" convention: bedrooms=2, living_rooms=1.';
COMMENT ON COLUMN public.properties.building_age_band IS
  'A BAND, verbatim from the source — e.g. "6 - 10". NOT a number: 101evler exposes '
  'this as a dropdown of ranges, so there is no integer to store. Deliberately NOT '
  'parsed to a midpoint, which would invent precision the source does not have. No '
  'CHECK: only one band has been observed and a CHECK would reject the rest. Also '
  'drifts — interpret it relative to last_seen_at, not to today. The _band suffix is '
  'deliberate: a column named building_age holding "6 - 10" invites a ::int cast.';
COMMENT ON COLUMN public.properties.covered_area_sqm IS
  'Covered/enclosed area (kapalı alan). For apartments this is often the same number '
  'as area_sqm; Slice 2 decides the mapping against the real feed rather than guessing.';

-- ─── 4. RENT-ONLY FIELDS ────────────────────────────────────────────────────
-- bills_included is TEXT with no CHECK on purpose: a boolean loses information TRNC
-- rentals actually carry ("water included, electricity not"), and the feed's
-- vocabulary is unverified. Same reasoning as facilities.area. Slice 2 normalises.
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS deposit          numeric;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS deposit_currency text;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS min_term_months  int;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS bills_included   text;

-- ─── 5. AMENITIES ───────────────────────────────────────────────────────────
-- text[] rather than a join table, because the decisive constraint is UNKNOWN VALUES
-- ARRIVING FROM THE FEED: a join table with an FK to a lookup either rejects them or
-- forces auto-creating lookup rows mid-import. Shape for the array follows
-- facilities.service_types; the absence of a VALUES check follows facilities.area.
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS amenities text[];

-- Bounds size WITHOUT constraining vocabulary. Subquery-free and fully IMMUTABLE by
-- construction — a CHECK may contain neither a subquery nor a set-returning function,
-- so per-element length via unnest() is unavailable; the serialised-length bound is
-- the subquery-free equivalent. cardinality() (not array_length) so an EMPTY array is
-- rejected rather than passing as unknown — see 20260731_garages_directory.sql.
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_amenities_shape_check;
ALTER TABLE public.properties ADD CONSTRAINT properties_amenities_shape_check
  CHECK (
    amenities IS NULL
    OR (cardinality(amenities) BETWEEN 1 AND 60
        AND char_length(array_to_string(amenities, ',')) <= 2000)
  );

-- ─── 6. LOCATION ────────────────────────────────────────────────────────────
-- `area` gets NO CHECK, exactly like facilities.area (20260806): the vocabulary lives
-- in constants/areas.js AREAS_BY_REGION and stays editable in app code, so adding an
-- area is a pure client change with no migration. Stores the SLUG.
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS area             text;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS development_name text;

COMMENT ON COLUMN public.properties.area IS
  'Neighbourhood slug below district. No CHECK by design — validated client-side '
  'against constants/areas.js AREAS_BY_REGION, mirroring facilities.area.';

-- ─── 6b. SOURCE-OBSERVED FIELDS (from the live Novest listing #554769) ───────
-- swap_available is TEXT, not boolean. The observed value is the string "Not
-- Available"; the rest of the vocabulary is unseen, and "Available"/"Not Available"
-- may well have a third state. A boolean would force a guess at import time and
-- silently collapse anything unexpected into false. Same reasoning as bills_included.
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS swap_available  text;

-- gated_community IS boolean: the source exposes a clean Yes/No.
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS gated_community boolean;

-- ─── 6c. LOCATION PRECISION — coordinate honesty ────────────────────────────
-- The source states outright: "The exact location will be notified to you by the
-- advertiser." Its map is area-level. Storing an area centroid in latitude/longitude
-- with nothing to mark it approximate would make every consumer treat it as the
-- property's real position — PropertyDetailScreen already does exactly that
-- (`if (prop.latitude && prop.longitude) onOpenMap(...)`).
--
-- This column makes the approximation MACHINE-READABLE rather than a UI convention,
-- so an export, an admin screen or a future partner API cannot get it wrong either.
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS location_precision text;

COMMENT ON COLUMN public.properties.location_precision IS
  '''exact'' = a real pin (agent listings, dropped via MapPinPicker). ''area'' = an '
  'approximate area centroid; the true position is NOT known. Feed listings are '
  '''area'' — 101evler withholds exact coordinates by design. Any UI rendering a pin '
  'MUST read this and label an ''area'' pin as approximate.';

ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_location_precision_check;
ALTER TABLE public.properties ADD CONSTRAINT properties_location_precision_check
  CHECK (location_precision IS NULL OR location_precision = ANY (ARRAY['exact','area']::text[]));

-- BACKFILL BEFORE THE COUPLING CONSTRAINT — order matters, the constraint would
-- otherwise reject every existing pinned row. Existing rows are all agent-submitted
-- with a hand-dropped pin, so 'exact' is the truthful value.
UPDATE public.properties SET location_precision = 'exact'
WHERE (latitude IS NOT NULL OR longitude IS NOT NULL) AND location_precision IS NULL;

-- DEFAULT 'exact' — set AFTER the backfill so it applies only to future inserts.
--
-- WHY 'exact' AND NOT 'area': the default exists to serve the LEGACY path. The parked
-- PropertySubmitScreen inserts latitude/longitude (from MapPinPicker) and knows nothing
-- about this column; without a default its INSERT would violate the coupling constraint
-- below and the screen would break. A hand-dropped pin IS exact, so the default is
-- truthful for every insert that can actually reach it today.
--
-- A DEFAULT CANNOT express the real rule. Postgres forbids column references in a
-- DEFAULT expression, so `CASE WHEN source IS NOT NULL THEN 'area' ELSE 'exact' END` is
-- not available — the rule is enforced by properties_feed_precision_check instead.
ALTER TABLE public.properties ALTER COLUMN location_precision SET DEFAULT 'exact';

-- THE COUPLING. Coordinates may not exist without a declared precision. This is what
-- makes 'area' centroids safe to store later: a row can never carry coordinates whose
-- trustworthiness is unstated. Rows with no coordinates are unconstrained.
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_coords_precision_check;
ALTER TABLE public.properties ADD CONSTRAINT properties_coords_precision_check
  CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR location_precision IS NOT NULL
  );

-- FEED ROWS MUST DECLARE 'area'. This is what stops a partner row inheriting the
-- 'exact' default and silently claiming a precision it does not have: an import that
-- omits location_precision gets 'exact' and is REJECTED here with 23514, loudly, rather
-- than landing as trustworthy. Slice 2 therefore cannot forget this column.
--
-- ⚠ WRITTEN NULL-SAFELY, AND IT MATTERS. The obvious form
--       CHECK (source IS NULL OR location_precision = 'area')
--   is BROKEN: for a feed row with location_precision NULL, `NULL = 'area'` is UNKNOWN,
--   `false OR UNKNOWN` is UNKNOWN, and A CHECK CONSTRAINT PASSES ON UNKNOWN. That form
--   would admit exactly the row this constraint exists to reject. The explicit
--   IS NOT NULL guard forces the expression to true/false. Same trap as the
--   char_length(NULL) note in 20260830_events_gisekibris_import.sql.
--
-- If a future partner ever supplies genuinely exact coordinates, this constraint must
-- be relaxed deliberately, in its own migration. That friction is intentional.
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_feed_precision_check;
ALTER TABLE public.properties ADD CONSTRAINT properties_feed_precision_check
  CHECK (
    source IS NULL                                   -- agent listing: unconstrained
    OR (location_precision IS NOT NULL
        AND location_precision = 'area')             -- feed listing: MUST say 'area'
  );

-- ─── 7. agent_id NULLABLE + THE XOR CONSTRAINT ──────────────────────────────
ALTER TABLE public.properties ALTER COLUMN agent_id DROP NOT NULL;

-- THE SECURITY CONTROL. See the header. Every existing row satisfies branch 1
-- (agent_id NOT NULL, source NULL), so this applies with no backfill.
-- Compact equivalent: CHECK ((source IS NULL) <> (agent_id IS NULL))
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_source_agent_xor_check;
ALTER TABLE public.properties ADD CONSTRAINT properties_source_agent_xor_check
  CHECK (
    (source IS NULL     AND agent_id IS NOT NULL)   -- agent-submitted listing
    OR
    (source IS NOT NULL AND agent_id IS NULL)       -- partner feed listing
  );

COMMENT ON CONSTRAINT properties_source_agent_xor_check ON public.properties IS
  'SECURITY, not hygiene. props_select_public treats source IS NOT NULL as a bypass of '
  'the agent-subscription paywall. This constraint is what stops an agent setting '
  'source on their own row to buy permanent free visibility. Do not drop it while that '
  'policy stands.';

-- ─── 8. WIDENED CHECKS ──────────────────────────────────────────────────────
-- All four keep their existing NAMES, so verify_schema.sql's E-section (existence by
-- name) CANNOT see these changes. Each has an H-section behaviour token instead.

-- status: + delisted. Gone from the feed => delisted, row KEPT. Never deleted.
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_status_check;
ALTER TABLE public.properties ADD CONSTRAINT properties_status_check
  CHECK (status = ANY (ARRAY['pending','active','rejected','archived','delisted']::text[]));

-- currency: + USD. Four currencies actually transacted in North Cyprus. Deliberately
-- NOT opened to full ISO — the CHECK is this field's only validation, and a feed typo
-- must not pass. ⚠ Slice 3 must add '$' to the hardcoded symbol maps in
-- AccommodationScreen.js:19 and PropertyDetailScreen.js:17, or USD renders "USD185,000".
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_currency_check;
ALTER TABLE public.properties ADD CONSTRAINT properties_currency_check
  CHECK (currency = ANY (ARRAY['GBP','TRY','EUR','USD']::text[]));

-- district: + lefke, karpaz. This was a LIVE BUG, not a new requirement — the CHECK
-- allowed 5 regions while constants/regions.js REGIONS defines 7 and calls them "the
-- set already enforced by the DB" (job_postings, beaches, landmarks, facilities.city
-- all carry all 7). A Novest listing in Lefke or Karpaz failed on INSERT.
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_district_check;
ALTER TABLE public.properties ADD CONSTRAINT properties_district_check
  CHECK (district = ANY (ARRAY['nicosia','kyrenia','famagusta','morphou','iskele',
                               'lefke','karpaz']::text[]));

-- price_period: + weekly, yearly. monthly|nightly|total did NOT cover rent — annual
-- lets (yıllık kira) are standard in TRNC and student lets are quoted per academic
-- year. ⚠ Slice 3: priceDisplay() suffixes only /mo and /night; weekly and yearly
-- currently render with no period at all.
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_price_period_check;
ALTER TABLE public.properties ADD CONSTRAINT properties_price_period_check
  CHECK (price_period = ANY (ARRAY['monthly','nightly','weekly','yearly','total']::text[]));

-- deposit_currency: value list kept TEXTUALLY IDENTICAL to properties_currency_check
-- so a drift token matching one matches the other.
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_deposit_currency_check;
ALTER TABLE public.properties ADD CONSTRAINT properties_deposit_currency_check
  CHECK (deposit_currency IS NULL
         OR deposit_currency = ANY (ARRAY['GBP','TRY','EUR','USD']::text[]));

-- Numeric sanity — one constraint for all six, to catch feed garbage rather than to
-- model anything. floor allows negatives (basement / garden floor).
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_structure_range_check;
ALTER TABLE public.properties ADD CONSTRAINT properties_structure_range_check
  CHECK (
        (floor           IS NULL OR floor           BETWEEN  -5 AND 200)
    AND (total_floors    IS NULL OR total_floors    BETWEEN   1 AND 200)
    -- building_age_band is NOT here: it is a text band ("6 - 10"), not a number.
    AND (living_rooms    IS NULL OR living_rooms    BETWEEN   0 AND  20)
    AND (ensuite_count   IS NULL OR ensuite_count   BETWEEN   0 AND  20)
    AND (min_term_months IS NULL OR min_term_months BETWEEN   0 AND 120)
  );

-- ─── 9. property_images + estate_agencies COLUMNS ───────────────────────────
ALTER TABLE public.property_images ADD COLUMN IF NOT EXISTS source_url   text;
ALTER TABLE public.property_images ADD COLUMN IF NOT EXISTS content_hash text;
ALTER TABLE public.property_images ADD COLUMN IF NOT EXISTS is_primary   boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.property_images.source_url IS
  'The partner''s ORIGINAL image URL, kept untouched so a mirrored image can always be '
  're-fetched. Mirrors events.source_image_url — see import-gisekibris-events.mjs.';

-- Partner contact. Three columns on the EXISTING agency row rather than a new
-- partner_contacts table (a whole table + RLS + index for one row) or app config
-- (changing a phone number would need an OTA).
-- ⚠ SIGNED OFF KNOWINGLY: agencies_select_public exposes status='active' agencies to
--   anon, INCLUDING LOGGED-OUT USERS. These three columns are therefore public. That
--   is intended — it is a public business contact — but it is a real widening of
--   publicly-readable data.
ALTER TABLE public.estate_agencies ADD COLUMN IF NOT EXISTS contact_name     text;
ALTER TABLE public.estate_agencies ADD COLUMN IF NOT EXISTS contact_phone    text;
ALTER TABLE public.estate_agencies ADD COLUMN IF NOT EXISTS contact_whatsapp text;

-- ─── 10. updated_at TRIGGER ─────────────────────────────────────────────────
-- Created AFTER the section-1 backfill so that UPDATE cannot fire it.
--
-- CONDITIONAL on purpose. The sync stamps last_seen_at on all ~200 rows twice daily
-- and PropertyDetailScreen bumps view_count on every open; an unconditional
-- `NEW.updated_at := now()` would fire on both and updated_at would stop meaning
-- "the content changed" — which is the only thing it is for.
CREATE OR REPLACE FUNCTION public.properties_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (to_jsonb(NEW) - 'updated_at' - 'last_seen_at' - 'view_count')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'updated_at' - 'last_seen_at' - 'view_count')
  THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS properties_touch_updated_at ON public.properties;
CREATE TRIGGER properties_touch_updated_at
  BEFORE UPDATE ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.properties_touch_updated_at();

-- ─── 11. INDEXES ────────────────────────────────────────────────────────────
-- Four only. Every other column named in the Slice 3 filter set was argued down for
-- lack of evidence of use, the same discipline as 20260719_add_missing_indexes.sql:
--   source      2 values ('novest' + NULL) — no selectivity
--   agency_id   one agency — no selectivity by construction
--   district / area / intent / property_type   low cardinality (3-15 values); on a few
--               thousand rows Postgres picks a seq scan anyway, and properties_browse_idx
--               already covers the leading `status` predicate they all combine with
--   price       range scans on a small table do not benefit
--   published_at  only earns an index once Slice 3 actually sorts by it. It does not.
-- Revisit in Slice 3 against real EXPLAIN output, not guesses.

-- CORRECTNESS, not performance: the ON CONFLICT arbiter for the idempotent upsert.
-- A REAL UNIQUE CONSTRAINT, never a partial unique index — 20260830 learned this the
-- hard way: PostgREST emits `ON CONFLICT (external_id)` with no WHERE, and Postgres
-- will not infer a partial index as an arbiter unless the clause repeats the
-- predicate. A plain UNIQUE permits unlimited NULLs, so agent rows are unaffected.
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_external_id_unique;
ALTER TABLE public.properties ADD CONSTRAINT properties_external_id_unique UNIQUE (external_id);

-- The Slice 3 default list is exactly status='active' + ORDER BY created_at DESC +
-- LIMIT/OFFSET. Serves filter, sort and pagination in one.
CREATE INDEX IF NOT EXISTS properties_browse_idx
  ON public.properties (status, created_at DESC);

-- The nested property_images(...) select runs on EVERY list render. At ~200 properties
-- x ~15 images this is the lookup that actually bites. 20260719 listed it as a genuine
-- candidate and skipped it only for being low-traffic; that changes now.
CREATE INDEX IF NOT EXISTS property_images_property_id_idx
  ON public.property_images (property_id);

-- CORRECTNESS: at most one primary image per property.
CREATE UNIQUE INDEX IF NOT EXISTS property_images_primary_unique
  ON public.property_images (property_id) WHERE is_primary;

-- ─── 12. RLS — THE VISIBILITY REWRITE ───────────────────────────────────────
-- Postgres has no CREATE POLICY IF NOT EXISTS, so each is drop-then-create.

-- properties: adds ONLY the `source IS NOT NULL` branch, INSIDE the status='active'
-- test. Owner and admin branches are unchanged from subscription_migration.sql.
DROP POLICY IF EXISTS "props_select_public" ON public.properties;
CREATE POLICY "props_select_public" ON public.properties
  FOR SELECT TO public
  USING (
    (
      status = 'active'
      AND (
        source IS NOT NULL                        -- partner feed: no agent, no subscription
        OR EXISTS (
          SELECT 1 FROM estate_agents ea
          WHERE ea.id = properties.agent_id
            AND ea.subscription_expires_at IS NOT NULL
            AND ea.subscription_expires_at > now()
        )
      )
    )
    OR agent_id IN (SELECT id FROM estate_agents WHERE user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- property_images: the LEFT JOIN is the load-bearing detail. The previous policy used
-- an INNER JOIN to estate_agents, which discards every feed row (agent_id IS NULL)
-- BEFORE the source test can run — mirroring the condition alone would have produced
-- zero visible images for all 200 listings, with the gallery silently empty.
DROP POLICY IF EXISTS "images_select_public" ON public.property_images;
CREATE POLICY "images_select_public" ON public.property_images
  FOR SELECT TO public
  USING (
    property_id IN (
      SELECT p.id
      FROM properties p
      LEFT JOIN estate_agents ea ON ea.id = p.agent_id
      WHERE p.status = 'active'
        AND (
          p.source IS NOT NULL
          OR (ea.subscription_expires_at IS NOT NULL AND ea.subscription_expires_at > now())
        )
    )
    OR property_id IN (
      SELECT p.id FROM properties p
      JOIN estate_agents ea ON ea.id = p.agent_id
      WHERE ea.user_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- props_update_agent: BEHAVIOUR IS UNCHANGED. The WITH CHECK below is textually
-- identical to the USING clause, which is precisely what Postgres was already
-- applying to the new row implicitly (an UPDATE policy with USING and no WITH CHECK
-- uses USING for both). Made EXPLICIT so that the protection stops depending on an
-- implicit rule: without it, anyone later adding a WITH CHECK here for an unrelated
-- reason would silently remove the guard that stops an agent rewriting their own row
-- into a partner row.
DROP POLICY IF EXISTS "props_update_agent" ON public.properties;
CREATE POLICY "props_update_agent" ON public.properties
  FOR UPDATE TO public
  USING (
    agent_id IN (SELECT id FROM estate_agents WHERE user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    agent_id IN (SELECT id FROM estate_agents WHERE user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

COMMENT ON POLICY "props_update_agent" ON public.properties IS
  'WITH CHECK is deliberately identical to USING. Postgres already applied USING to the '
  'new row (UPDATE policy with no WITH CHECK), so this changes NO behaviour — it stops '
  'that protection being implicit. It is what rejects an agent setting agent_id=NULL to '
  'turn their own listing into a partner listing.';

-- ─── 13. STORAGE ────────────────────────────────────────────────────────────
-- Feed images mirror to the EXISTING public property-images bucket under
--   partner/novest/{external_id}/{n}.{ext}
--
-- The events precedent (events/gisekibris/… unreachable to any authenticated user)
-- works because the event-images INSERT policy pins foldername[2] = auth.uid(), which
-- a literal can never satisfy. property-images has NO such pin — its INSERT policy is
-- `auth.role() = 'authenticated'` and nothing else, so ANY authenticated user could
-- write under partner/. 20260817 deliberately left it loose because the bucket carries
-- two path conventions ({property_id}/… and {user_id}/…).
--
-- Minimal fix that respects that: exclude the literal prefix. Both existing conventions
-- put a UUID in segment 1, which can never equal 'partner', so neither breaks.
-- service_role bypasses RLS entirely and remains the only writer under partner/.
--
-- ⚠ IF THIS SECTION RAISES  "must be owner of table objects"  (42501): uncomment the
--   next line AND the RESET ROLE line below it, then re-run the whole migration.
-- SET ROLE supabase_storage_admin;

DROP POLICY IF EXISTS "property_images_upload" ON storage.objects;
CREATE POLICY "property_images_upload" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'property-images'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] <> 'partner'
  );

-- RESET ROLE;   -- ← uncomment together with the SET ROLE line above

COMMIT;
RESET ROLE;

-- PostgREST schema-cache refresh. MANDATORY tail on every ADD COLUMN migration —
-- without it a stale cache raises 42703 "column ... does not exist" through the REST
-- API even though the column exists in Postgres.
NOTIFY pgrst, 'reload schema';

-- ─── WHO CAN DO WHAT AFTER THIS MIGRATION ───────────────────────────────────
-- properties SELECT:
--   • anon / logged-out   — active PARTNER listings (source NOT NULL); active agent
--                           listings ONLY while that agent's subscription is unexpired.
--                           Nothing else. delisted/pending/rejected/archived are hidden.
--   • guest (anonymous)   — identical to anon for reads. All writes still blocked by the
--                           RESTRICTIVE no_anon_* policies.
--   • an estate agent     — the above, PLUS every one of their own rows at any status.
--   • admin               — everything, at any status.
--   • service_role        — everything (bypasses RLS). The import runs here.
-- properties INSERT/UPDATE/DELETE: UNCHANGED. An authenticated user still cannot create
--   a partner row (props_insert_agent requires agent_id to be their own active agent,
--   and NULL IN (…) is not TRUE), and cannot convert their own row into one (the XOR
--   constraint rejects source+agent_id together; RLS rejects agent_id=NULL).
-- property_images: mirrors properties exactly, including the partner branch.
-- estate_agencies: unchanged policies. The three new contact_* columns are readable by
--   anyone who can already read the agency row — which for an active agency is everyone.
-- storage.objects: authenticated users may no longer write under property-images/partner/.
--   Every other path they could write before, they still can.
