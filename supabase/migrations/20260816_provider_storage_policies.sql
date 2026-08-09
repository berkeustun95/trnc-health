-- ─── Slice 1 — storage.objects owner policies for the two provider buckets ────
--
-- WHY: 20260621_provider_verification.sql shipped these buckets' access policies
-- only as COMMENTED-OUT SQL ("run manually in dashboard"). The bucket half was
-- created via the dashboard (both Public = OFF); the policy half was NEVER applied.
-- Verified live state (pg_policies on storage.objects, production) is ONLY:
--   provider-documents   → provider_documents_admin_read   (SELECT, authenticated, is_admin())
--   provider-credentials → provider_credentials_admin_read (SELECT, authenticated, is_admin())
-- i.e. NO owner INSERT and NO owner SELECT on either bucket. So every provider
-- upload — ProviderOnboardingScreen.js:107 → provider-documents,
-- ProviderScreen.js:415 → provider-credentials — is RLS-rejected. The error is
-- swallowed client-side; provider verification has never worked end to end.
--
-- FIX: add owner INSERT/SELECT/UPDATE/DELETE on both buckets, scoped by the first
-- path segment = uploader UID. Path schemes (verified in code):
--   provider-documents    {uid}/{facilityId}/{doc_type}.ext   → foldername[1] = uid
--   provider-credentials  {uid}/{timestamp}.ext               → foldername[1] = uid
-- UPDATE is required because ProviderOnboardingScreen uploads with upsert:true,
-- which makes storage evaluate the UPDATE policy on re-upload; DELETE lets a
-- provider replace a rejected document. The two existing *_admin_read SELECT
-- policies are LEFT UNTOUCHED.
--
-- ANONYMOUS GUARD: ADA uses Supabase anonymous sign-in for guest access, and an
-- anonymous session sits in the `authenticated` role with a real auth.uid(). Without
-- a guard, a guest could write into {anon-uid}/… on these two most-sensitive buckets
-- (own-prefix only — not a cross-read exposure, but a write-abuse vector). The six
-- WRITE policies (INSERT/UPDATE/DELETE per bucket) therefore also require
--   NOT public.is_anonymous_session()
-- — the project's canonical anon check: the SAME STABLE helper (reading the
-- `is_anonymous` JWT claim) that every table-level no_anon_* policy uses, already
-- GRANT EXECUTE-d to `authenticated` (20260714_block_anonymous_writes.sql), and the
-- same claim lib/supabase.js `isGuest` reads. The two SELECT policies are left
-- un-guarded on purpose: a guest reading back their own uploaded file is harmless.
--
-- No anon / public policy is added on the storage layer, and NO status='approved'
-- public read on storage: the approved-credential public read stays on the
-- provider_credentials TABLE only; the file itself stays private behind 60s signed
-- URLs (AdminScreen.js:20).
--
-- PERF: auth.uid() and the anon check are wrapped as scalar subqueries
-- ((select auth.uid()), (select public.is_anonymous_session())) so the planner
-- evaluates each once per statement (initplan) rather than per row — Supabase RLS
-- performance guidance.
--
-- Idempotent (DROP … IF EXISTS then CREATE — safe to re-run). Apply in the SQL
-- editor with Role = postgres.
--
-- OWNERSHIP FALLBACK: creating a policy on storage.objects requires ownership of
-- that table. Running as `postgres` normally works (it's the same context that put
-- the live property-images / event-images policies in place). If the plain run
-- returns  ERROR: must be owner of table objects  — uncomment the two
-- `SET ROLE supabase_storage_admin;` / `RESET ROLE;` lines below and re-run; that
-- role owns storage.objects.
--
-- No `NOTIFY pgrst, 'reload schema'` — RLS policies are enforced inside Postgres,
-- not from PostgREST's cached schema, and no column/table shape changed.
--
-- verify_schema drift: Slice 5 adds a QUERY 4 that lists ALL storage.objects
-- policies (cmd/roles/qual/with_check), which surfaces these 8 automatically.

BEGIN;

-- SET ROLE supabase_storage_admin;   -- ← uncomment if you hit "must be owner of table objects"

-- ── provider-documents (national ID, medical license, registration/business cert) ──
DROP POLICY IF EXISTS "provider_documents_owner_insert" ON storage.objects;
CREATE POLICY "provider_documents_owner_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'provider-documents'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
    AND NOT (select public.is_anonymous_session())
  );

DROP POLICY IF EXISTS "provider_documents_owner_select" ON storage.objects;
CREATE POLICY "provider_documents_owner_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'provider-documents'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
  );

DROP POLICY IF EXISTS "provider_documents_owner_update" ON storage.objects;
CREATE POLICY "provider_documents_owner_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'provider-documents'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
    AND NOT (select public.is_anonymous_session())
  )
  WITH CHECK (
    bucket_id = 'provider-documents'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
    AND NOT (select public.is_anonymous_session())
  );

DROP POLICY IF EXISTS "provider_documents_owner_delete" ON storage.objects;
CREATE POLICY "provider_documents_owner_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'provider-documents'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
    AND NOT (select public.is_anonymous_session())
  );

-- ── provider-credentials (diplomas, certificates) ──
DROP POLICY IF EXISTS "provider_credentials_owner_insert" ON storage.objects;
CREATE POLICY "provider_credentials_owner_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'provider-credentials'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
    AND NOT (select public.is_anonymous_session())
  );

DROP POLICY IF EXISTS "provider_credentials_owner_select" ON storage.objects;
CREATE POLICY "provider_credentials_owner_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'provider-credentials'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
  );

DROP POLICY IF EXISTS "provider_credentials_owner_update" ON storage.objects;
CREATE POLICY "provider_credentials_owner_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'provider-credentials'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
    AND NOT (select public.is_anonymous_session())
  )
  WITH CHECK (
    bucket_id = 'provider-credentials'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
    AND NOT (select public.is_anonymous_session())
  );

DROP POLICY IF EXISTS "provider_credentials_owner_delete" ON storage.objects;
CREATE POLICY "provider_credentials_owner_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'provider-credentials'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
    AND NOT (select public.is_anonymous_session())
  );

-- RESET ROLE;   -- ← uncomment together with the SET ROLE line above

COMMIT;

-- ── Who can do what after this migration ─────────────────────────────────────
--   • A provider (authenticated, NON-anonymous) may INSERT/UPDATE/DELETE objects
--     ONLY under their own UID prefix in provider-documents and provider-credentials
--     (path must start `{their-uid}/…`). They cannot touch another provider's files.
--   • SELECT is owner-scoped by the same prefix but is NOT anon-guarded — a guest
--     reading back their own file is harmless.
--   • A guest (anonymous session — in the `authenticated` role with a real uid) is
--     BLOCKED from every write to both buckets by NOT public.is_anonymous_session().
--   • An admin keeps SELECT on all objects in both buckets (existing *_admin_read).
--   • The public / true anon (no JWT) get NOTHING: both buckets Public=OFF, no
--     anon/public policy. Files remain reachable only via short-lived signed URLs.
--
-- ── Verification (run after applying, Role = postgres) ───────────────────────
--   SELECT policyname, cmd, roles, qual, with_check
--     FROM pg_policies
--    WHERE schemaname = 'storage' AND tablename = 'objects'
--      AND policyname LIKE 'provider_%'
--    ORDER BY policyname;
--   -- expect 10 rows: 4 owner (insert/select/update/delete) per bucket + the 2
--   -- pre-existing *_admin_read SELECT policies. The 6 write rows carry
--   -- `NOT ( SELECT is_anonymous_session())` in qual/with_check; the 2 owner_select
--   -- rows do not. No public/anon rows.
--
-- ── Rollback (re-closes provider uploads — the feature breaks again) ──────────
--   BEGIN;
--   DROP POLICY IF EXISTS "provider_documents_owner_insert"   ON storage.objects;
--   DROP POLICY IF EXISTS "provider_documents_owner_select"   ON storage.objects;
--   DROP POLICY IF EXISTS "provider_documents_owner_update"   ON storage.objects;
--   DROP POLICY IF EXISTS "provider_documents_owner_delete"   ON storage.objects;
--   DROP POLICY IF EXISTS "provider_credentials_owner_insert" ON storage.objects;
--   DROP POLICY IF EXISTS "provider_credentials_owner_select" ON storage.objects;
--   DROP POLICY IF EXISTS "provider_credentials_owner_update" ON storage.objects;
--   DROP POLICY IF EXISTS "provider_credentials_owner_delete" ON storage.objects;
--   COMMIT;
