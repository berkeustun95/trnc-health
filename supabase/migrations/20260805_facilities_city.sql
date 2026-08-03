-- ─── facilities.city — region-level location for the business directory ──────
--
-- Adds a single nullable `city` column holding one of the 7 canonical TRNC region
-- slugs (constants/regions.js REGIONS). Used by the garage + grooming onboarding
-- "City / Region" dropdown (reuses CityPicker) and shown on the profile. Region level
-- ONLY — a finer `area`/neighbourhood level is deliberately deferred (no data source
-- yet); a future `area text` column can be added alongside this without touching it.
--
-- WHY COLUMN-ONLY (no RPC / guard change): `city` is NOT guard-locked, and the live
-- "Provider can update own facility" RLS policy already lets an owner write their own
-- row, so the client persists city via a direct update — exactly like the Slice A map
-- pin (latitude/longitude). This keeps `city` NON-MATERIAL (a region change does NOT
-- force admin re-approval) and, critically, avoids changing the signature of the LIVE
-- create_grooming_facility RPC (which the shipped 1.1.0 client still calls). If region
-- should instead be material (re-approval on change), that's a different migration
-- (p_city into the update RPCs + a guard lock) — not this one.
--
-- ADDITIVE + idempotent. Every existing row (health/garage/grooming) keeps city NULL
-- and passes the CHECK. The value CHECK spans ALL types (the 7 regions are universal),
-- so it is intentionally NOT type-coupled — a future health city dropdown could reuse it.
--
-- EXECUTION: SET ROLE postgres (ALTER TABLE facilities needs the table owner; the SQL
-- editor runs as 'authenticated'). Apply BEFORE the OTA — the directory/profile read city.

SET ROLE postgres;
BEGIN;

ALTER TABLE public.facilities ADD COLUMN IF NOT EXISTS city text;

-- Value CHECK: NULL, or exactly one of the 7 canonical region slugs (REGIONS).
ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_city_check;
ALTER TABLE public.facilities ADD CONSTRAINT facilities_city_check
  CHECK (
    city IS NULL
    OR city = ANY (ARRAY['nicosia','kyrenia','famagusta','morphou','iskele','lefke','karpaz']::text[])
  );

COMMIT;
RESET ROLE;

-- ─── Verification (run after applying) ───────────────────────────────────────
--   -- Column exists, all existing rows NULL:
--   SELECT count(*) FILTER (WHERE city IS NULL) AS null_city, count(*) AS total FROM facilities;
--   -- Owner can set a valid region directly (RLS + no guard lock):
--   UPDATE facilities SET city = 'kyrenia' WHERE type='grooming' AND provider_id = auth.uid();
--   -- Bad value rejected:
--   UPDATE facilities SET city = 'london' WHERE id = '<id>';   -- FAILS facilities_city_check

-- ─── Rollback ────────────────────────────────────────────────────────────────
--   SET ROLE postgres; BEGIN;
--   ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_city_check;
--   ALTER TABLE public.facilities DROP COLUMN IF EXISTS city;
--   COMMIT; RESET ROLE;
