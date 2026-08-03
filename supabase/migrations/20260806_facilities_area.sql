-- ─── facilities.area — dependent neighbourhood/area under city ───────────────
--
-- Adds a single nullable `area` column, the second level of the location dropdowns:
-- the garage + grooming onboarding "City / Region" dropdown (→ facilities.city,
-- 20260805) plus a dependent "Area" dropdown (→ this column), populated from
-- constants/areas.js AREAS_BY_REGION[city]. Stores the area SLUG (lowercase, TR chars
-- folded, spaces→hyphens); the profile resolves slug→name via AREAS_BY_REGION.
--
-- NO CHECK constraint: area is validated client-side against AREAS_BY_REGION, which
-- stays editable in app code — a DB CHECK would force a migration every time an area
-- is added. `city` (+ its CHECK) is unchanged from 20260805.
--
-- Like `city`, `area` is NON-guard-locked → the owner writes it via a direct update
-- (RLS "Provider can update own facility"), NON-material (no re-approval). No RPC or
-- guard change.
--
-- ADDITIVE + idempotent. Every existing row keeps area NULL. SET ROLE postgres is
-- REQUIRED — ALTER TABLE facilities needs the table owner; the SQL editor's default
-- 'authenticated' role raises "must be owner of table facilities" (42501). This matches
-- 20260805 (city), which applied clean *because* it used the same wrapper. session_user
-- is postgres so the switch is permitted; RESET ROLE restores the session at the end.
-- Apply BEFORE the OTA (directory/profile read area).

SET ROLE postgres;
BEGIN;

ALTER TABLE public.facilities ADD COLUMN IF NOT EXISTS area text;

COMMIT;
RESET ROLE;

-- ─── Verification (run after applying) ───────────────────────────────────────
--   -- Column exists, all existing rows NULL:
--   SELECT count(*) FILTER (WHERE area IS NULL) AS null_area, count(*) AS total FROM facilities;
--   -- Owner can set an area directly (RLS + no guard lock, no CHECK):
--   UPDATE facilities SET area = 'ozankoy' WHERE type='grooming' AND provider_id = auth.uid();

-- ─── Rollback ────────────────────────────────────────────────────────────────
--   BEGIN;
--   ALTER TABLE public.facilities DROP COLUMN IF EXISTS area;
--   COMMIT;
