-- ═══════════════════════════════════════════════════════════════════════════
-- 20261188 — Araçlar: private staging bucket for dealer photos (dealer-intake)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Berke, 2026-11-10: dealer car photos must not live in the public repo's git history, even stripped (a sold car's
-- photos would stay there forever). So they travel Mac → a PRIVATE staging bucket → the import job:
--
--   1. scripts/upload-dealer-photos.mjs (on Berke's Mac, signed in as an admin with a one-time e-mail code) strips each
--      photo's metadata locally and uploads it to dealer-intake/<dealer slug>/<ilan_no>/<n>.<jpg|png|webp>.
--   2. scripts/import-dealer-cars.mjs (GitHub Actions, service key) reads the staged set, strips and proves it clean
--      again, stores it in vehicle-images, writes the vehicle_images rows, then deletes the staged files.
--
-- The bucket is private (no public URL), 5 MB, jpeg / png / webp. Three policies on storage.objects, all admin-only
-- and guest-guarded: insert (path shape enforced), select (the upload command lists and reads back), delete (it
-- replaces a car's staged set). No UPDATE policy: a file is never overwritten in place. Nobody else can read, list or
-- write the bucket; service_role bypasses RLS as everywhere.
--
-- Storage policies on storage.objects: 38 → 41 (verify_schema 1042 is bumped in the same commit).
--
-- Apply: supabase-migrate, one file. No public table changes ⇒ no NOTIFY.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'dealer-intake') THEN
    RAISE EXCEPTION 'REFUSING: bucket dealer-intake already exists (was this already run?). Nothing applied.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
              AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%dealer-intake%') THEN
    RAISE EXCEPTION 'REFUSING: a storage policy already reaches dealer-intake. Nothing applied.';
  END IF;
END $$;

CREATE TEMP TABLE _storage_policies_before ON COMMIT DROP AS
  SELECT count(*) AS n FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('dealer-intake', 'dealer-intake', false, 5242880, ARRAY['image/jpeg','image/png','image/webp']);

CREATE POLICY "dealer_intake_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'dealer-intake'
    AND NOT (select public.is_anonymous_session())
    AND (select public.is_admin())
    AND name ~ '^[a-z0-9][a-z0-9-]{1,59}/[A-Za-z0-9-]{1,40}/[0-9]{1,2}\.(jpg|png|webp)$'
  );

CREATE POLICY "dealer_intake_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'dealer-intake'
    AND NOT (select public.is_anonymous_session())
    AND (select public.is_admin())
  );

CREATE POLICY "dealer_intake_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'dealer-intake'
    AND NOT (select public.is_anonymous_session())
    AND (select public.is_admin())
  );

DO $$
DECLARE v_names text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'dealer-intake' AND public = false AND file_size_limit = 5242880
                  AND allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']) THEN
    RAISE EXCEPTION 'bucket dealer-intake is not private / 5 MB / jpeg-png-webp';
  END IF;
  SELECT string_agg(policyname || ':' || cmd, ', ' ORDER BY policyname) INTO v_names FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects' AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%dealer-intake%';
  IF v_names IS DISTINCT FROM 'dealer_intake_delete:DELETE, dealer_intake_insert:INSERT, dealer_intake_select:SELECT' THEN
    RAISE EXCEPTION 'dealer-intake policies are not exactly insert + select + delete: %', v_names;
  END IF;
  -- Every one of them: signed-in role only, admin, never a guest session.
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
              AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%dealer-intake%'
              AND (roles <> ARRAY['authenticated']::name[]
                   OR coalesce(qual, '') || coalesce(with_check, '') NOT LIKE '%is_admin()%'
                   OR coalesce(qual, '') || coalesce(with_check, '') NOT LIKE '%is_anonymous_session()%')) THEN
    RAISE EXCEPTION 'a dealer-intake policy is not admin-only and guest-guarded';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects')
     IS DISTINCT FROM (SELECT n + 3 FROM _storage_policies_before) THEN
    RAISE EXCEPTION 'storage.objects should have exactly three policies more';
  END IF;
END $$;

-- ─── ledger:stamp:begin ──────────────────────────────────────────────
-- Machine-generated by scripts/migration-ledger.mjs --stamp. Do not hand-edit.
-- The checksum is of THIS FILE WITH THIS BLOCK STRIPPED, which is what lets the file
-- carry its own stamp. Everything between the markers is excluded from the checksum
-- but still runs — so it may contain NOTHING but this INSERT. See the note in the
-- generator: anything else here would execute on paste while leaving no trace in the
-- hash, and the ledger would be attesting a file it never actually verified.
--
-- This is also the LAST statement inside BEGIN/COMMIT: if a paste is truncated before
-- it, COMMIT is never reached and nothing applies.
INSERT INTO public.schema_migrations_applied (filename, checksum)
VALUES ('20261188_dealer_intake_bucket.sql', '4211d177fc44271ac4286e002098b159ff95cc1f11c3618c1b2ac9ec7566c558')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   verify_schema QUERY 1: the 1042 storage row (41) and the 20261188 row read OK.
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   Empty the bucket through the Storage API first (storage.objects refuses SQL deletes), then:
--   DROP POLICY "dealer_intake_insert" / "dealer_intake_select" / "dealer_intake_delete" ON storage.objects;
--   DELETE FROM storage.buckets WHERE id = 'dealer-intake'; revert the verify_schema bumps; delete the
--   schema_migrations_applied row.
