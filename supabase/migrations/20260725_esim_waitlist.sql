-- eSIM waitlist — demand-capture experiment (no purchase flow).
-- Account REQUIRED to join: RLS insert keys off auth.uid(), and the RESTRICTIVE
-- no_anon veto below blocks guest (anonymous) sessions at the DB boundary,
-- mirroring 20260714_block_anonymous_writes.sql.
--
-- PLAIN ENGLISH — who can do what:
--   - Signed-up user: INSERT/UPDATE only their OWN row (user_id must = their uid);
--     can READ only their own row. UNIQUE(user_id) => one row per account, so the
--     app upserts (re-submit updates their answers).
--   - Guest (anonymous) session: cannot write at all (no_anon veto).
--   - Admin: can READ ALL rows (for demand counts). No admin write needed.
--   - Provider names are NOT stored — preferred_provider is a neutral key, kept
--     nullable and ready for a post-partnership OTA (not collected in v1 UI).
--
-- Idempotent: safe to re-run (CREATE TABLE IF NOT EXISTS + drop-then-create policies).

BEGIN;

CREATE TABLE IF NOT EXISTS public.esim_waitlist (
  user_id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email              text,
  audience           text CHECK (audience IN ('tourist', 'student')),
  preferred_provider text CHECK (preferred_provider IN ('provider_a', 'provider_b', 'no_preference')),
  created_at         timestamptz NOT NULL DEFAULT now()
);
-- user_id is PRIMARY KEY, which already gives UNIQUE(user_id) for idempotent upsert.

ALTER TABLE public.esim_waitlist ENABLE ROW LEVEL SECURITY;

-- Permissive policies (mirror quiz_submissions: insert-self, read-own; + admin read-all)
DROP POLICY IF EXISTS "esim_insert_self"    ON public.esim_waitlist;
DROP POLICY IF EXISTS "esim_update_self"    ON public.esim_waitlist;
DROP POLICY IF EXISTS "esim_read_own"       ON public.esim_waitlist;
DROP POLICY IF EXISTS "esim_admin_read_all" ON public.esim_waitlist;

CREATE POLICY "esim_insert_self" ON public.esim_waitlist
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "esim_update_self" ON public.esim_waitlist
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "esim_read_own" ON public.esim_waitlist
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "esim_admin_read_all" ON public.esim_waitlist
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles
                 WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

-- RESTRICTIVE anon-write veto (this new table is NOT in 20260714's table list,
-- so it needs its own veto or a guest could insert with the anon key).
DROP POLICY IF EXISTS "no_anon_insert_esim_waitlist" ON public.esim_waitlist;
DROP POLICY IF EXISTS "no_anon_update_esim_waitlist" ON public.esim_waitlist;
DROP POLICY IF EXISTS "no_anon_delete_esim_waitlist" ON public.esim_waitlist;

CREATE POLICY "no_anon_insert_esim_waitlist" ON public.esim_waitlist
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_anonymous_session());

CREATE POLICY "no_anon_update_esim_waitlist" ON public.esim_waitlist
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.is_anonymous_session())
  WITH CHECK (NOT public.is_anonymous_session());

CREATE POLICY "no_anon_delete_esim_waitlist" ON public.esim_waitlist
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.is_anonymous_session());

COMMIT;

-- Rollback:
--   DROP TABLE IF EXISTS public.esim_waitlist;  -- policies drop with the table
