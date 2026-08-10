-- ─── Moderation slice, Step 1a — facilities read policy: moderation-aware gate ──
--
-- CRITICAL BUG THIS FIXES: the only server-side facilities read policy was
-- `Anyone can read facilities USING (true)`, so admin Suspend (status='suspended')
-- and Hide (hidden_at) did NOTHING on the browse surfaces — HomeScreen, MapScreen,
-- VetDirectory all read through this policy and never re-filtered, and search_content
-- (SECURITY INVOKER) inherited USING(true) too. A reported/fraudulent clinic or
-- pharmacy was unremovable from the app. This replaces the open policy with a
-- public / owner / admin split, so a suspended or hidden facility disappears from
-- every read that goes through RLS — on the ALREADY-SHIPPED app, the moment this
-- applies (no OTA required).
--
-- POLICIES (permissive SELECT, OR'd together):
--   • public (anon + authenticated): only live, non-hidden listings —
--       hidden_at IS NULL AND status IN ('active','trial')
--   • owner: a provider always sees their OWN listing, any status (their dashboard
--       + pending/suspended states must keep working)
--   • admin: UNCHANGED — the existing `admin all facilities` / `admin manage
--       facilities` FOR ALL policies already grant admin SELECT on every row.
--
-- Public status set = active + trial. A 'trial' is a LIVE membership-tier listing;
-- booking is gated separately by appointments_no_expired_trial — visibility is not.
-- 'pending' (unapproved) and 'suspended' (moderated) are hidden.
--
-- Downstream behaviour, verified in code:
--   • Customer booking history (ProfileScreen embeds facilities(name,…)) degrades to
--     '—' for a now-hidden facility — null-safe (ProfileScreen.js:117 / :674), no
--     crash, no spinner. (Deliberately NO customer-appointment read arm: that would
--     re-leak a suspended facility into the customer's browse list.)
--   • FacilityProfileScreen takes the facility as a PROP (no by-id fetch), so a
--     hidden facility is simply unreachable from the now-filtered lists — no
--     null-fetch crash.
--
-- Idempotent (DROP IF EXISTS → CREATE). Policy-only, no shape change → no NOTIFY.
-- Registered in verify_schema (H-token 0820_facilities_moderation_read_policy).
-- Apply in the SQL editor, Role = postgres.
--
-- ── PRE-APPLY CHECK — run FIRST (must return only active / trial) ─────────────
--   SELECT status, count(*) FROM facilities WHERE provider_id IS NULL GROUP BY status;
--   -- The claim flow (ProviderOnboardingScreen: `.is('provider_id', null)`) lists
--   -- UNCLAIMED facilities. Under the new policy those are visible only if
--   -- active/trial + non-hidden. If any 'pending'/'suspended' unclaimed rows exist
--   -- AND should be claimable, STOP — they'll drop from the claim list; tell me and
--   -- I'll add a claim-specific arm (or we fix their status first).

BEGIN;

DROP POLICY IF EXISTS "Anyone can read facilities"  ON public.facilities;

DROP POLICY IF EXISTS "public read live facilities" ON public.facilities;
CREATE POLICY "public read live facilities" ON public.facilities
  FOR SELECT TO anon, authenticated
  USING (hidden_at IS NULL AND status IN ('active','trial'));

DROP POLICY IF EXISTS "owner reads own facility"    ON public.facilities;
CREATE POLICY "owner reads own facility" ON public.facilities
  FOR SELECT TO authenticated
  USING (provider_id = (select auth.uid()));

COMMIT;

-- ── Who can read what after this ─────────────────────────────────────────────
--   • anon / any customer / any provider browsing → only hidden_at IS NULL AND
--     status IN ('active','trial'). Suspended / pending / hidden = invisible.
--   • a provider → additionally their OWN facility, any status (owner policy).
--   • an admin → every row (existing admin FOR ALL policies).
--   • search_content (SECURITY INVOKER) now inherits this gate automatically;
--     Step 1b (20260820_search_content_gate_facilities) adds an explicit filter too.
--
-- ── Verification (Role = postgres) ───────────────────────────────────────────
--   SELECT policyname, roles, qual FROM pg_policies
--    WHERE schemaname='public' AND tablename='facilities' AND cmd='SELECT'
--    ORDER BY policyname;
--   -- expect: "public read live facilities" (hidden_at IS NULL AND status IN
--   --         ('active','trial')), "owner reads own facility" (provider_id =
--   --         auth.uid()), plus the admin FOR ALL rows. NO "Anyone can read facilities".
--
-- ── Rollback (RE-OPENS the moderation hole — only if reverting the slice) ─────
--   BEGIN;
--   DROP POLICY IF EXISTS "public read live facilities" ON public.facilities;
--   DROP POLICY IF EXISTS "owner reads own facility"    ON public.facilities;
--   CREATE POLICY "Anyone can read facilities" ON public.facilities
--     FOR SELECT TO anon, authenticated USING (true);
--   COMMIT;
