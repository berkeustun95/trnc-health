-- ─── Migration 2 — drop the profiles over-share policy (column-limiting complete) ─
--
-- The "providers read customer push token" SELECT policy on profiles is ROW-level,
-- so despite its name it exposed a customer's ENTIRE profile row (full_name, phone,
-- nationality, push_token, strikes, blocked_until, ugc_banned_until) to any provider
-- they'd booked with. 20260819_get_customer_contacts_rpc replaced that access with a
-- SECURITY DEFINER RPC returning ONLY {id, full_name, push_token, preferred_language}
-- for the caller's own booking-customers, and the app was repointed to it
-- (commit 3a254c3, OTAs 23a9d41c / fcc0b2de). This drops the now-unused broad policy.
--
-- SAFE TO DROP NOW — provider-activity check (auth.sessions / last_sign_in_at) showed
-- the ONLY provider account with any session activity is the owner's own, already on
-- an RPC-bearing build; the other provider accounts are dormant since June. No live
-- provider reads customer profiles through the old direct-select code path. (Even an
-- un-updated provider degrades gracefully: nameless bookings, push skipped, the
-- appointment status update still succeeds, recovers on next launch — no crash.)
--
-- After this, a provider can reach a customer's data ONLY through
-- get_customer_contacts (their own customers, 4 safe columns). Owner-reads-own and
-- admin-reads-all on profiles are UNTOUCHED.
--
-- Idempotent (DROP IF EXISTS). Policy-only, no shape change → no NOTIFY.
-- Registered in verify_schema (H-token 0821_drop_providers_read_customer).
-- Apply in the SQL editor, Role = postgres.

BEGIN;

DROP POLICY IF EXISTS "providers read customer push token" ON public.profiles;

COMMIT;

-- ── Verification (Role = postgres) ───────────────────────────────────────────
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname='public' AND tablename='profiles' AND cmd='SELECT'
--    ORDER BY policyname;
--   -- expect NO "providers read customer push token". Remaining SELECT policies:
--   -- owner read, admin read all, admin read profiles. (QUERY 3's profiles policy
--   -- count drops by 1.)
--
--   -- functional: as a provider, a direct select of a customer's profile row now
--   -- returns 0 rows; get_customer_contacts still returns the 4 safe columns.
--
-- ── Rollback (RE-OPENS the full-row over-share — only if reverting) ───────────
--   BEGIN;
--   CREATE POLICY "providers read customer push token" ON public.profiles
--     FOR SELECT TO public
--     USING (((get_my_role() = 'provider'::text) AND (EXISTS ( SELECT 1
--        FROM (appointments a JOIN facilities f ON ((a.facility_id = f.id)))
--       WHERE ((a.customer_id = profiles.id) AND (f.provider_id = auth.uid()))))));
--   COMMIT;
