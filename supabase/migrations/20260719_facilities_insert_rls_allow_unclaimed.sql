-- ─── facilities RLS — let providers insert UNCLAIMED facilities ─────────────
-- PAIRED FIX for 20260719_facilities_insert_force_unclaimed.sql.
--
-- That migration made facilities_guard_insert (a BEFORE INSERT trigger) force
-- provider_id = null for regular providers. But the INSERT policy
-- `providers_can_insert_own_facility` still requires WITH CHECK
-- (provider_id = auth.uid()). In PostgreSQL a BEFORE ROW trigger runs BEFORE the
-- RLS WITH CHECK is evaluated (ExecInsert: ExecBRInsertTriggers → then
-- ExecWithCheckOptions), so the policy now sees provider_id = null:
--     null = auth.uid()  →  NULL  →  not TRUE  →  INSERT DENIED.
--
-- Net effect on live TODAY: a regular provider creating a NEW facility gets
-- "new row violates row-level security policy for table facilities". This
-- migration repairs that AND is what unification needs: providers may create
-- only UNCLAIMED facilities; ownership is written at admin approval via the
-- claim_requests flow.
--
-- Plain English after this runs:
--   • A non-admin provider may INSERT a facility ONLY with provider_id IS NULL
--     (which the guard guarantees). They can no longer self-assign ownership.
--   • Admin / service-role insert paths are unchanged (separate admin policies,
--     and the guard's auth.uid() IS NULL / admin escapes still return NEW as-is).
-- Only the INSERT policy changes; SELECT/UPDATE/DELETE policies and every other
-- table are untouched.

BEGIN;

DROP POLICY IF EXISTS "providers_can_insert_own_facility" ON public.facilities;

CREATE POLICY "providers_can_insert_own_facility" ON public.facilities
  FOR INSERT TO public
  WITH CHECK (provider_id IS NULL);

COMMIT;

-- Rollback:
--   BEGIN;
--   DROP POLICY IF EXISTS "providers_can_insert_own_facility" ON public.facilities;
--   CREATE POLICY "providers_can_insert_own_facility" ON public.facilities
--     FOR INSERT TO public
--     WITH CHECK (provider_id = auth.uid());
--   COMMIT;
