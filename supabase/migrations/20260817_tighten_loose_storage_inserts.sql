-- ─── Slice 2 — tighten two path-unconstrained storage.objects INSERT policies ─
--
-- WHY: the Slice-1 audit query (pg_policies on storage.objects) surfaced two write
-- policies whose WITH CHECK constrained only the bucket, not the path — so any
-- authenticated user could write objects under ANOTHER user's prefix. Each already
-- has a sibling DELETE policy that DOES pin the uploader UID by folder segment; this
-- brings the INSERT side into line with its sibling.
--
--   1) estate_agent_documents_owner_insert  (bucket estate-agent-documents)
--        was: WITH CHECK (bucket_id = 'estate-agent-documents' [+ authenticated only])
--        code path (EstateAgentOnboardingScreen.js:140): {uid}/id_{timestamp}.ext
--        → uploader UID is folder segment [1].
--
--   2) "authenticated upload event images"   (bucket event-images)
--        was: WITH CHECK (bucket_id = 'event-images')
--        code path (OrganizerScreen.js:186):   events/{uid}/{timestamp}.ext
--        → uploader UID is folder segment [2] (matches the existing
--          "organizer delete own event images" DELETE policy, which uses [2]).
--
-- SCOPE: these two INSERT policies ONLY. property_images_upload is deliberately
-- NOT touched here (Option A) — property-images is a mixed-convention bucket
-- (listing photos are {propId}/…, not {uid}/…), so it moves to a later Slice 2b
-- that first changes the app path to be UID-prefixed. Sibling SELECT/DELETE and
-- admin policies on both buckets are left untouched.
--
-- ANONYMOUS GUARD: as in Slice 1 — ADA's guest sign-in puts anonymous users in the
-- `authenticated` role with a real auth.uid(), so both INSERTs also require
--   NOT public.is_anonymous_session()
-- (the canonical helper the table-level no_anon_* policies use; already
-- GRANT EXECUTE-d to `authenticated`). This matches the table layer: estate_agents
-- and events both carry no_anon_insert_* RESTRICTIVE policies, so a guest cannot
-- create the parent row anyway — this closes the storage side to match.
--
-- PERF: auth.uid() and the anon check are wrapped as scalar subqueries so the
-- planner evaluates each once per statement (initplan) — Supabase RLS guidance.
--
-- Idempotent (DROP … IF EXISTS then CREATE — safe to re-run). Apply in the SQL
-- editor with Role = postgres. No `NOTIFY pgrst` needed (policy-only, no shape change).
--
-- OWNERSHIP FALLBACK: if the plain run returns
--   ERROR: must be owner of table objects
-- uncomment the two `SET ROLE supabase_storage_admin;` / `RESET ROLE;` lines below
-- and re-run; that role owns storage.objects.
--
-- verify_schema drift: Slice 5's QUERY 4 lists all storage.objects policies, so
-- these tightened definitions are covered there automatically.

BEGIN;

-- SET ROLE supabase_storage_admin;   -- ← uncomment if you hit "must be owner of table objects"

-- 1) estate-agent-documents — ID/passport (private). Uploader UID = segment [1].
DROP POLICY IF EXISTS "estate_agent_documents_owner_insert" ON storage.objects;
CREATE POLICY "estate_agent_documents_owner_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'estate-agent-documents'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
    AND NOT (select public.is_anonymous_session())
  );

-- 2) event-images — public bucket, but writes owner-scoped. Uploader UID = segment [2].
DROP POLICY IF EXISTS "authenticated upload event images" ON storage.objects;
CREATE POLICY "authenticated upload event images" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'event-images'
    AND (storage.foldername(name))[2] = (select auth.uid())::text
    AND NOT (select public.is_anonymous_session())
  );

-- RESET ROLE;   -- ← uncomment together with the SET ROLE line above

COMMIT;

-- ── Who can do what after this migration ─────────────────────────────────────
--   • estate-agent-documents: an authenticated NON-anonymous user may INSERT an
--     object ONLY under their own `{uid}/…` prefix. They can no longer write under
--     someone else's prefix. (Existing admin SELECT policy unchanged; no owner
--     SELECT/UPDATE/DELETE added here — out of scope. Uploads use a unique
--     timestamped path with no upsert, so INSERT alone is sufficient.)
--   • event-images: an authenticated NON-anonymous user may INSERT an object ONLY
--     under `events/{their-uid}/…` (segment [2]). Existing "public read event images"
--     SELECT and "organizer delete own event images" DELETE policies unchanged.
--   • Guests (anonymous sessions) are blocked from both INSERTs by the anon guard.
--
-- ── Verification (run after applying, Role = postgres) ───────────────────────
--   SELECT policyname, cmd, roles, qual, with_check
--     FROM pg_policies
--    WHERE schemaname = 'storage' AND tablename = 'objects'
--      AND policyname IN ('estate_agent_documents_owner_insert',
--                         'authenticated upload event images')
--    ORDER BY policyname;
--   -- expect 2 rows, both cmd = INSERT, roles = {authenticated}. Each with_check now
--   -- contains the foldername path constraint ([1] for estate docs, [2] for event
--   -- images) AND `NOT ( SELECT is_anonymous_session())`.
--
-- ── Rollback (re-opens cross-user writes on both buckets) ─────────────────────
--   BEGIN;
--   DROP POLICY IF EXISTS "estate_agent_documents_owner_insert" ON storage.objects;
--   CREATE POLICY "estate_agent_documents_owner_insert" ON storage.objects
--     FOR INSERT TO authenticated
--     WITH CHECK (bucket_id = 'estate-agent-documents');
--   DROP POLICY IF EXISTS "authenticated upload event images" ON storage.objects;
--   CREATE POLICY "authenticated upload event images" ON storage.objects
--     FOR INSERT TO authenticated
--     WITH CHECK (bucket_id = 'event-images');
--   COMMIT;
