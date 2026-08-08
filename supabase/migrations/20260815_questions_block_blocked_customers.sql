-- questions.insert — bar blocked customers from posting questions, mirroring the
-- appointments INSERT policy. Motivated by Slice 1: Q&A moved from BookingScreen
-- (which pre-empted blocked users with a dedicated block screen) to
-- FacilityProfileScreen (no such gate). The `insert questions` policy only
-- checked `customer_id = auth.uid()`, so a struck/blocked customer — previously
-- kept out of Q&A only incidentally by the booking UI — could post questions.
--
-- FIX: add the SAME guard the appointments INSERT policy uses, verbatim:
--   customer insert own appointments → WITH CHECK ((auth.uid() = customer_id) AND (NOT is_customer_blocked()))
-- Here, keeping the questions policy's own column order:
--   insert questions               → WITH CHECK ((customer_id = auth.uid()) AND (NOT is_customer_blocked()))
-- Same function (public.is_customer_blocked(), SECURITY DEFINER, search_path pinned
-- in 20260719), same semantics. The RESTRICTIVE `no_anon_insert_questions` policy
-- is untouched.
--
-- Idempotent: DROP … IF EXISTS then CREATE, no assumption about prior state.
-- The policy KEEPS its name ("insert questions"), so verify_schema registers this
-- BEHAVIOR change via an H-token (existence-by-name can't tell the old body — with
-- CHECK missing is_customer_blocked — from this one). Apply with the SQL editor
-- Role dropdown = postgres.

BEGIN;

DROP POLICY IF EXISTS "insert questions" ON public.questions;

CREATE POLICY "insert questions" ON public.questions
  FOR INSERT TO public
  WITH CHECK (((customer_id = auth.uid()) AND (NOT is_customer_blocked())));

COMMIT;

-- No shape change (RLS policy only — no table/column added, and policies are
-- enforced inside Postgres, not from PostgREST's cached schema), so a
-- `NOTIFY pgrst, 'reload schema'` is NOT required here and is intentionally omitted.
-- The policy count per table is unchanged (drop+create of the same name), so
-- QUERY 3's per-table policy tally in verify_schema needs no update either.

-- ── Verification (run after applying, Role = postgres) ───────────────────────
--   -- confirm the new definition shows the blocked guard:
--   SELECT with_check FROM pg_policies
--     WHERE schemaname='public' AND tablename='questions' AND policyname='insert questions';
--   -- expected: ((customer_id = auth.uid()) AND (NOT is_customer_blocked()))
--
--   -- functional (as a currently-blocked customer): should raise 42501 RLS violation
--   INSERT INTO questions (facility_id, customer_id, body)
--     VALUES ('<some-facility-uuid>', auth.uid(), 'test');   -- ERROR: new row violates RLS
--   -- as a non-blocked customer against their own uid: succeeds.
--
-- ── Rollback (restore the pre-Slice-1b policy) ───────────────────────────────
--   DROP POLICY IF EXISTS "insert questions" ON public.questions;
--   CREATE POLICY "insert questions" ON public.questions
--     FOR INSERT TO public
--     WITH CHECK ((customer_id = auth.uid()));
