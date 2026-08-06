-- ─── facilities.service_prices — per-service price ranges (garage Slice 4a) ──
--
-- Adds a single nullable jsonb column holding an owner's per-service price
-- ranges, keyed by service key → { from: number, to: number }, e.g.
--   {"muayene":{"from":400,"to":600},"tyres":{"from":1500,"to":3000}}
-- Numeric values only (validated + coerced client-side). These are PHYSICAL-
-- service prices (muayene, oil, tyres, repair) = real-world commerce, fully
-- allowed to display under Apple 3.1.1. This is UNRELATED to ADA's own
-- featured/subscription monetization, which stays price-free.
--
-- Currency v1: a single assumed currency (TL) shown as "TL" in the client. No
-- per-price currency field, no conversion — multi-currency is a deferred v2.
--
-- Like `city`/`area` (20260805/06), service_prices is NON-guard-locked and
-- NON-material: the owner writes it via a direct update (RLS "Provider can
-- update own facility"), and a price change does NOT flip the listing back to
-- pending. No RPC change, no guard change, no SECURITY DEFINER fn (so no
-- search_path concern). The garage material lock (name/service_types/address in
-- 20260802_facilities_guard_garage_edit) is untouched.
--
-- Keyed by service key so it's generic: grooming/other directories could reuse
-- the same column later. Not built this slice.
--
-- ADDITIVE + idempotent. Every existing row keeps service_prices NULL. SET ROLE
-- postgres is REQUIRED — ALTER TABLE facilities needs the table owner; the SQL
-- editor's default 'authenticated' role raises "must be owner of table
-- facilities" (42501). Matches 20260805/06. Apply BEFORE the OTA (directory +
-- profile read service_prices).

SET ROLE postgres;
BEGIN;

ALTER TABLE public.facilities ADD COLUMN IF NOT EXISTS service_prices jsonb;

COMMIT;
RESET ROLE;

-- PostgREST schema-cache refresh so service_prices is queryable via the REST API
-- immediately (a stale cache raises 42703 "column ... does not exist" through
-- PostgREST even though the column exists). MANDATORY tail on every ADD COLUMN
-- migration — see supabase/verify_schema.sql and CLAUDE.md.
NOTIFY pgrst, 'reload schema';

-- ─── Verification (run after applying) ───────────────────────────────────────
--   -- Column exists, all existing rows NULL:
--   SELECT count(*) FILTER (WHERE service_prices IS NULL) AS null_prices, count(*) AS total FROM facilities;
--   -- Owner can set prices directly (RLS + no guard lock, non-material → stays active):
--   UPDATE facilities SET service_prices = '{"muayene":{"from":400,"to":600}}'
--     WHERE type='garage' AND provider_id = auth.uid();

-- ─── Rollback ────────────────────────────────────────────────────────────────
--   BEGIN;
--   ALTER TABLE public.facilities DROP COLUMN IF EXISTS service_prices;
--   COMMIT;
