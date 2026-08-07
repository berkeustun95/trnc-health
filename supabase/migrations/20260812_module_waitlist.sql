-- module_waitlist — one-tap "Notify me" capture for the dark-launched marketplace
-- modules behind the Coming Soon gate (Slice 2). Mirrors esim_waitlist's shape but
-- DELIBERATELY DIVERGES in one way: GUESTS MUST be able to join. The app signs
-- users in anonymously on launch (signInAnonymously), and the whole point of Coming
-- Soon is to capture demand from everyone — so there is NO no_anon veto here.
-- Anonymous sessions still carry role=authenticated + a real auth.uid(), so the
-- `user_id = auth.uid()` scoping below confines each session to its own row.
--
-- PLAIN ENGLISH — who can do what:
--   - Any signed-in session incl. GUEST: INSERT only their OWN row (user_id must =
--     their uid); READ only their own rows. Composite PK (user_id, module) => one
--     row per (user, module): a user can join several modules, and a second tap on
--     the same module is a no-op (client sends INSERT ... ON CONFLICT DO NOTHING).
--   - No user UPDATE/DELETE: joining is one-way in v1 (no un-join UI). notified_at
--     is written only by the Slice 3 go-live RPC (SECURITY DEFINER, bypasses RLS).
--   - Admin: READ ALL rows (demand counts). No admin write needed.
--
-- Idempotent: safe to re-run (CREATE TABLE IF NOT EXISTS + drop-then-create
-- policies). Apply with the SQL editor Role dropdown = postgres, like every other
-- migration.

BEGIN;

CREATE TABLE IF NOT EXISTS public.module_waitlist (
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module      text        NOT NULL CONSTRAINT module_waitlist_module_check
                CHECK (module IN ('homeServices','grooming','garages','transport',
                                  'insurance','pets','events','jobs','accommodation')),
  notified_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, module)
);
-- Composite PK already gives the UNIQUE(user_id, module) the client upsert conflicts on.

ALTER TABLE public.module_waitlist ENABLE ROW LEVEL SECURITY;

-- ── Permissive (grant): who can perform the action at all ────────────────────
DROP POLICY IF EXISTS "mw_insert_self"    ON public.module_waitlist;
DROP POLICY IF EXISTS "mw_read_own"       ON public.module_waitlist;
DROP POLICY IF EXISTS "mw_admin_read_all" ON public.module_waitlist;

CREATE POLICY "mw_insert_self" ON public.module_waitlist
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "mw_read_own" ON public.module_waitlist
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "mw_admin_read_all" ON public.module_waitlist
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles
                 WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

-- ── Restrictive (veto): confine every WRITE to the caller's own row. AND-ed with
--    the permissive layer; the hard guarantee that no session writes another
--    user's row even if a broader permissive policy is added later. Deliberately
--    NOT a no_anon veto — guests are allowed to join. ──────────────────────────
DROP POLICY IF EXISTS "mw_self_only_insert" ON public.module_waitlist;
DROP POLICY IF EXISTS "mw_self_only_update" ON public.module_waitlist;
DROP POLICY IF EXISTS "mw_self_only_delete" ON public.module_waitlist;

CREATE POLICY "mw_self_only_insert" ON public.module_waitlist
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "mw_self_only_update" ON public.module_waitlist
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "mw_self_only_delete" ON public.module_waitlist
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (user_id = auth.uid());

COMMIT;

-- The new table must be visible to PostgREST immediately, else the app's
-- .from('module_waitlist') insert 404s on a stale schema cache (PGRST205).
-- Same class of gap as the ADD COLUMN reload rule in CLAUDE.md.
NOTIFY pgrst, 'reload schema';

-- ── Verification (run after applying) ────────────────────────────────────────
--   SELECT to_regclass('public.module_waitlist');                              -- not null
--   SELECT relrowsecurity FROM pg_class WHERE relname='module_waitlist';       -- t
--   -- as a GUEST (anon) session this must SUCCEED (own row):
--   INSERT INTO module_waitlist (user_id, module) VALUES (auth.uid(), 'events');
--   -- second tap, same module, is a no-op (no error, no dup):
--   INSERT INTO module_waitlist (user_id, module) VALUES (auth.uid(), 'events') ON CONFLICT DO NOTHING;
--   -- writing SOMEONE ELSE's row must FAIL (restrictive veto):
--   INSERT INTO module_waitlist (user_id, module)
--     VALUES ('00000000-0000-0000-0000-000000000000', 'events');
--   -- unknown module must FAIL (CHECK):
--   INSERT INTO module_waitlist (user_id, module) VALUES (auth.uid(), 'nope');

-- ── Rollback ─────────────────────────────────────────────────────────────────
--   DROP TABLE IF EXISTS public.module_waitlist;  -- policies drop with the table
--   NOTIFY pgrst, 'reload schema';
