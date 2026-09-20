-- ─── 20261039 — property-images: pin the uploader, and shut guests out ──────
--
-- The half of 20260817 that was deferred, finally done.
--
-- ─── WHAT WAS WRONG ─────────────────────────────────────────────────────────
--
-- 20260817 tightened two storage.objects INSERT policies whose WITH CHECK
-- constrained only the BUCKET and not the PATH, "so any authenticated user could
-- write objects under ANOTHER user's prefix". It fixed estate-agent-documents and
-- event-images and deliberately left property-images for a later slice, because that
-- bucket's convention is {propId}/… rather than {uid}/… and the app path had to change
-- first. That slice never happened. As last defined (20260904):
--
--     WITH CHECK ( bucket_id = 'property-images'
--                  AND auth.role() = 'authenticated'
--                  AND (storage.foldername(name))[1] <> 'partner' )
--
-- Two defects, measured 2026-09-20:
--   1. No uid pinned to a folder segment — any authenticated user may write under any
--      non-partner prefix, including over another agent's listing photos.
--   2. `auth.role() = 'authenticated'` INCLUDES GUESTS. ADA's signInAnonymously() puts
--      anonymous users in that role with a real auth.uid(), so a guest — one tap from a
--      cold start — can upload arbitrary image bytes to this project's storage. That is
--      exactly the anon guard 20260817 added to the two buckets it fixed, missing here.
--
-- ─── WHY THE APP PATH CHANGES IN THE SAME SLICE ─────────────────────────────
--
-- A uid pin is only expressible if the uid is IN the path. PropertySubmitScreen wrote
-- `{propId}/{ts}.{ext}`, which carries no uid at all on an edit (and buries it inside a
-- `tmp-{uid}-{ts}` string on a create — a substring, not a segment, so foldername()
-- cannot see it). The screen now writes `{uid}/{propId}/{ts}.{ext}` and the uid is
-- segment [1], matching the shape estate-agent-documents already uses.
--
-- ⚠ ORDER: OTA FIRST, THEN THIS MIGRATION. A client on the old bundle writes the old
--   path; once this is applied that write is refused. Applying first would break any
--   in-flight old client. Shipping the app first cannot break anything, because the
--   OLD policy accepts the NEW path (it only forbids the `partner/` prefix).
--
-- ─── BLAST RADIUS: NONE, AND THAT IS MEASURED, NOT ASSUMED ──────────────────
--
-- Counted through PostgREST as anon, 2026-09-20:
--     properties total                 97
--     properties WITH agent_id         0      ← no agent has ever authored a listing
--     properties WITH source           97     ← all 97 are the Novest partner feed
-- So there are no existing client-uploaded objects under a {propId}/ prefix to migrate,
-- and nothing is orphaned by the path change. The partner feed writes under `partner/`
-- as service_role and is untouched by every policy here.
--
-- Self-serve agent signup is parked besides: 20260827 made signup customer-only, and
-- the "become an agent" CTA was removed in Slice 3c, so `estate_agent` can only be set
-- by hand today.
--
-- ─── SCOPE ──────────────────────────────────────────────────────────────────
--
-- INSERT and UPDATE only, on property-images. UPDATE is included because INSERT alone
-- leaves overwrite open on a bucket whose objects are addressable by path. SELECT is
-- deliberately NOT touched: this bucket is public = true, so Storage serves reads
-- without evaluating RLS at all and a tightened SELECT policy would be decoration.
-- Making property-images private is a separate decision with its own render-path work.
--
-- Idempotent (DROP … IF EXISTS then CREATE — safe to re-run). Policy-only, no shape
-- change, so no `NOTIFY pgrst` is needed.
--
-- OWNERSHIP FALLBACK: if the plain run returns
--   ERROR: must be owner of table objects
-- uncomment the SET ROLE / RESET ROLE lines below and re-run; that role owns
-- storage.objects.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- SET ROLE supabase_storage_admin;   -- ← uncomment if you hit "must be owner of table objects"

-- 1) INSERT — uploader UID is segment [1], guests refused, partner/ still reserved.
DROP POLICY IF EXISTS "property_images_upload" ON storage.objects;
CREATE POLICY "property_images_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'property-images'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
    AND (storage.foldername(name))[1] <> 'partner'
    AND NOT (select public.is_anonymous_session())
  );

-- 2) UPDATE — same predicate on both sides. USING decides which rows you may touch,
--    WITH CHECK decides what they may become; without the second half a permitted row
--    could be moved to another user's prefix, which is the hole reopened by the back
--    door.
DROP POLICY IF EXISTS "property_images_update_own" ON storage.objects;
CREATE POLICY "property_images_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'property-images'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
    AND NOT (select public.is_anonymous_session())
  )
  WITH CHECK (
    bucket_id = 'property-images'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
    AND (storage.foldername(name))[1] <> 'partner'
    AND NOT (select public.is_anonymous_session())
  );

-- RESET ROLE;   -- ← uncomment together with the SET ROLE line above

-- ─── VERIFICATION — asserts against pg_policies, not against this file ──────
DO $$
DECLARE
  v_expr text;
  v_n    int;
BEGIN
  -- Both policies exist and are PERMISSIVE. A RESTRICTIVE policy grants nothing, so a
  -- count alone would be satisfied by a pair that leaves uploads impossible.
  SELECT count(*) INTO v_n
  FROM pg_policies
  WHERE schemaname='storage' AND tablename='objects'
    AND policyname IN ('property_images_upload','property_images_update_own')
    AND permissive = 'PERMISSIVE';
  IF v_n IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'expected 2 permissive property-images write policies, found %', v_n;
  END IF;

  -- The INSERT predicate carries all three guards. Asserted on the rendered
  -- expression, with the raw value in the failure message so a red row proves itself.
  SELECT with_check INTO v_expr
  FROM pg_policies
  WHERE schemaname='storage' AND tablename='objects'
    AND policyname = 'property_images_upload';

  IF v_expr IS NULL THEN
    RAISE EXCEPTION 'property_images_upload has no WITH CHECK at all';
  END IF;
  IF position('foldername' in v_expr) = 0 OR position('uid' in v_expr) = 0 THEN
    RAISE EXCEPTION 'property_images_upload does not pin the uid to a folder segment. with_check=%', v_expr;
  END IF;
  IF position('is_anonymous_session' in v_expr) = 0 THEN
    RAISE EXCEPTION 'property_images_upload has no guest guard. with_check=%', v_expr;
  END IF;
  IF position('partner' in v_expr) = 0 THEN
    RAISE EXCEPTION 'property_images_upload lost the partner/ exclusion. with_check=%', v_expr;
  END IF;

  RAISE NOTICE 'property-images: uid pinned to segment [1], guests refused, partner/ reserved. OK';
END $$;

COMMIT;
