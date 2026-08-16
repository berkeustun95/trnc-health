-- ─── place-photos storage policies — public directory-photo bucket ────────────
-- Slice 3 (piece 1). Fixes a launch-day latent bug: the `place-photos` bucket had
-- ZERO storage.objects policies (verified live via pg_policies). With RLS
-- default-deny, EVERY client-side INSERT was rejected — so BOTH the Explore submit
-- (path `places/…`) AND the frozen beaches/landmarks submit (`beaches/…`,
-- `landmarks/…`) have been broken since launch. The only photos present were
-- dashboard / service-role uploads (admin-seeded), which bypass RLS — which is why
-- it was never noticed. This adds the three missing policies.
--
-- MODEL — property-images (public LISTING photos, the same content class):
--   INSERT bucket-scoped + SELECT public + DELETE uid-owner — PLUS the
--   `NOT public.is_anonymous_session()` guard property-images predates
--   (20260816/0817 convention). NOT uid-folder-scoped like provider-* — those are
--   PRIVATE documents (admin-read only); a public directory-photo bucket gains
--   little from uid INSERT scoping, and it would force a freeze-exception on the
--   frozen beaches path. A bucket-scoped INSERT is PATH-AGNOSTIC, so it repairs the
--   frozen submit with no code change. Explore's upload path moves to
--   `{uid}/{timestamp}/…` (JS/OTA) so the uid-owner DELETE lets a submitter clean up
--   their own uploads (incl. photo-first orphans).
--
-- BEFORE RUNNING — optional hardening (dashboard, NOT required for the fix):
--   place-photos is now authed-writable. Consider setting the bucket's
--   `allowed_mime_types = image/*` and a file-size cap to narrow the arbitrary-file
--   hosting vector that comes with bucket-scoping. (Backlog item filed.)
--
-- Idempotent (DROP … IF EXISTS then CREATE — safe to re-run). Apply with the SQL
-- editor Role = postgres. If it returns  ERROR: must be owner of table objects
-- uncomment the two `SET ROLE supabase_storage_admin;` / `RESET ROLE;` lines below;
-- that role owns storage.objects. No `NOTIFY pgrst` (policy-only, no shape change).
-- auth.uid() / the helpers are wrapped as scalar subqueries so the planner evaluates
-- each once per statement (Supabase RLS perf guidance), exactly as 20260816/0817 do.

BEGIN;

-- SET ROLE supabase_storage_admin;   -- ← uncomment if you hit "must be owner of table objects"

-- 1) Public read — public directory photos (mirrors property_images_public).
DROP POLICY IF EXISTS "place_photos_public" ON storage.objects;
CREATE POLICY "place_photos_public" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'place-photos');

-- 2) INSERT — any authenticated NON-anonymous user, bucket-scoped (path-agnostic, so
--    it repairs the frozen `beaches/…`/`landmarks/…` path too). Guests (anon session
--    in the `authenticated` role) are blocked.
DROP POLICY IF EXISTS "place_photos_upload" ON storage.objects;
CREATE POLICY "place_photos_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'place-photos'
    AND NOT (select public.is_anonymous_session())
  );

-- 3) DELETE — the submitter may delete their own uploads (uid = first path segment,
--    the Explore `{uid}/…` scheme), OR an admin (moderation; also covers frozen
--    `beaches/…` uploads, which have no uid segment). Anon-guarded for audit
--    consistency (redundant — an anon can't have created a folder — but every write
--    policy carries the guard, 20260816).
DROP POLICY IF EXISTS "place_photos_delete" ON storage.objects;
CREATE POLICY "place_photos_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'place-photos'
    AND NOT (select public.is_anonymous_session())
    AND (
      (storage.foldername(name))[1] = (select auth.uid())::text
      OR (select public.is_admin())
    )
  );

-- RESET ROLE;   -- ← uncomment together with the SET ROLE line above

COMMIT;

-- ── Who can do what after this migration ─────────────────────────────────────
--   • Anyone (incl. logged-out) may READ any object in place-photos (public directory).
--   • Any authenticated NON-anonymous user may INSERT to any path in place-photos.
--     Guests are blocked. (Both submit screens require a real account via the
--     requireAccount gate, so no legitimate user is anon here.)
--   • A user may DELETE objects under their own `{uid}/…` prefix; an admin may DELETE
--     any object. Guests blocked.
--   • Admin dashboard / service role bypasses RLS entirely (unchanged).
--
-- ── Verification (run after applying, Role = postgres) ───────────────────────
--   SELECT policyname, cmd, roles, qual, with_check
--     FROM pg_policies
--    WHERE schemaname='storage' AND tablename='objects' AND policyname LIKE 'place_photos_%'
--    ORDER BY policyname;
--   -- expect 3 rows: place_photos_public (SELECT), place_photos_upload (INSERT,
--   -- {authenticated}, with_check has NOT is_anonymous_session()), place_photos_delete
--   -- (DELETE, {authenticated}, qual has foldername[1]=uid OR is_admin() + anon guard).
--
--   -- End-to-end (as a NON-admin authenticated user via the app): submitting a place
--   -- with a photo should now succeed; the object lands under {your-uid}/{ts}/0.jpg.
--
-- ── Rollback (re-closes place-photos writes — both submit paths break again) ──
--   BEGIN;
--   DROP POLICY IF EXISTS "place_photos_public" ON storage.objects;
--   DROP POLICY IF EXISTS "place_photos_upload" ON storage.objects;
--   DROP POLICY IF EXISTS "place_photos_delete" ON storage.objects;
--   COMMIT;
