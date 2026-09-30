-- ═══════════════════════════════════════════════════════════════════════════
-- 20261063 — hotels: KITOB guide content (photo + description) and the hotel-images bucket
-- ═══════════════════════════════════════════════════════════════════════════
--
-- SOURCE: hotelsofnorthcyprus.com, KITOB's official hotel guide. PERMISSION (Berke,
-- 2026-09-29): KITOB approved using the site's photos and content in ADA; the written email is
-- to follow (vault: kitob-import-geocode-PLAN). Every such photo is credited on the card:
-- "Fotoğraf: KITOB – hotelsofnorthcyprus.com".
--
-- Photos are COPIED into our own storage (no hotlinking) by scripts/import-hnc-hotels.mjs,
-- running as service_role.
--
--   1. hotels.photo_source — where photo_url came from. 'hnc' today. Two-way with photo_url
--      (the 1060 provenance shape): a photo without a source cannot be credited correctly, and a
--      source without a photo is a leftover. No existing row has a photo (0 on 2026-09-29), which
--      the guard below asserts before the CHECK goes on.
--   2. hotels.description_i18n — the guide's description. KEYS ARE FULL LANGUAGE NAMES
--      ('English', 'Turkish' …), never ISO codes (CLAUDE.md: an ISO comparison matches nothing,
--      silently). The CHECK allows only the nine LANGUAGES keys and string values, and caps the
--      whole object. The guide publishes English only; the card falls back to English.
--   3. hotels.kitob_page_url — the hotel's page on the guide (provenance of 1 and 2; also the
--      candidate "Web sitesi" target for hotels whose own site is dead — Berke decides).
--   4. Bucket hotel-images: PUBLIC, 2 MB, JPEG/WebP. NO storage.objects policy: public-bucket
--      reads (/object/public/…) do not evaluate RLS, and the importer writes as service_role,
--      which bypasses it. Adding a policy would move 20261042's exact count of 36.
--
-- No RLS policy change on hotels. ADD COLUMN ⇒ ends with NOTIFY pgrst.
-- Apply: SQL Editor, Role = postgres, whole file ONCE, copied from disk. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.hotels WHERE photo_url IS NOT NULL;
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '% hotel(s) already carry photo_url with no recorded source — decide their source before the two-way CHECK goes on', v_n;
  END IF;
END $$;

ALTER TABLE public.hotels ADD COLUMN IF NOT EXISTS photo_source     text;
ALTER TABLE public.hotels ADD COLUMN IF NOT EXISTS description_i18n jsonb;
ALTER TABLE public.hotels ADD COLUMN IF NOT EXISTS kitob_page_url   text;

ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_photo_source_check;
ALTER TABLE public.hotels ADD  CONSTRAINT hotels_photo_source_check
  CHECK ((photo_source IS NULL OR photo_source IN ('hnc'))
         AND (photo_url IS NULL) = (photo_source IS NULL));

ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_description_i18n_check;
ALTER TABLE public.hotels ADD  CONSTRAINT hotels_description_i18n_check
  CHECK (description_i18n IS NULL OR (
    jsonb_typeof(description_i18n) = 'object'
    AND description_i18n <> '{}'::jsonb
    AND (description_i18n - ARRAY['English','Turkish','Arabic','Russian','Greek','French',
                                  'Spanish','German','Persian']) = '{}'::jsonb
    AND NOT jsonb_path_exists(description_i18n, '$.* ? (@.type() != "string")')
    AND octet_length(description_i18n::text) <= 12000));

ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_kitob_page_url_check;
ALTER TABLE public.hotels ADD  CONSTRAINT hotels_kitob_page_url_check
  CHECK (kitob_page_url IS NULL OR kitob_page_url ~ '^https://hotelsofnorthcyprus\.com/hotels/[a-z0-9-]+/$');

COMMENT ON COLUMN public.hotels.photo_source IS
  'Where photo_url came from: hnc = hotelsofnorthcyprus.com (KITOB''s guide, KITOB-approved 2026-09-29; card credits "Fotoğraf: KITOB – hotelsofnorthcyprus.com"). Present exactly when photo_url is (hotels_photo_source_check).';
COMMENT ON COLUMN public.hotels.description_i18n IS
  'Description keyed by FULL language name (English, Turkish …), never ISO codes (hotels_description_i18n_check). From KITOB''s guide, which is English only; the card falls back to English.';
COMMENT ON COLUMN public.hotels.kitob_page_url IS
  'The hotel''s page on hotelsofnorthcyprus.com — provenance of photo_url/description_i18n.';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('hotel-images', 'hotel-images', true, 2097152, ARRAY['image/jpeg','image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = true, file_size_limit = 2097152, allowed_mime_types = ARRAY['image/jpeg','image/webp'];

-- ─── Assertions ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_id uuid; v_n int;
  r_ok text := 'unset'; r_iso text := 'unset'; r_nonstr text := 'unset'; r_nosrc text := 'unset';
  r_srconly text := 'unset'; r_badsrc text := 'unset'; r_badurl text := 'unset'; r_empty text := 'unset';
BEGIN
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'hotels';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'hotels carries % policies, expected 1', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
     AND COALESCE(qual, '') || COALESCE(with_check, '') LIKE '%hotel-images%';
  IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION '% storage policies name hotel-images, expected 0', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'hotel-images' AND public
                   AND file_size_limit = 2097152 AND allowed_mime_types = ARRAY['image/jpeg','image/webp']) THEN
    RAISE EXCEPTION 'bucket hotel-images is missing, private, or has the wrong limits';
  END IF;

  BEGIN
    INSERT INTO public.hotels (external_id, name, kitob_class, region, is_kitob_member, source_list_date, content_hash)
    VALUES ('kitob-zzhnc63', 'zz hnc probe', 'star3', 'kyrenia', true, DATE '2026-01-01', 'zz') RETURNING id INTO v_id;

    -- Positive control: a credited photo, an English description, the guide page.
    BEGIN
      UPDATE public.hotels SET photo_url = 'https://x.supabase.co/storage/v1/object/public/hotel-images/zz.jpg',
             photo_source = 'hnc', description_i18n = '{"English":"A hotel."}'::jsonb,
             kitob_page_url = 'https://hotelsofnorthcyprus.com/hotels/zz-probe/' WHERE id = v_id;
      r_ok := 'accepted';
    EXCEPTION WHEN check_violation THEN r_ok := 'REFUSED';
    END;
    BEGIN
      UPDATE public.hotels SET description_i18n = '{"en":"A hotel."}'::jsonb WHERE id = v_id;
      r_iso := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_iso := 'refused';
    END;
    BEGIN
      UPDATE public.hotels SET description_i18n = '{"English":5}'::jsonb WHERE id = v_id;
      r_nonstr := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_nonstr := 'refused';
    END;
    BEGIN
      UPDATE public.hotels SET description_i18n = '{}'::jsonb WHERE id = v_id;
      r_empty := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_empty := 'refused';
    END;
    BEGIN
      UPDATE public.hotels SET photo_source = NULL WHERE id = v_id;
      r_nosrc := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_nosrc := 'refused';
    END;
    BEGIN
      UPDATE public.hotels SET photo_url = NULL WHERE id = v_id;
      r_srconly := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_srconly := 'refused';
    END;
    BEGIN
      UPDATE public.hotels SET photo_source = 'google' WHERE id = v_id;
      r_badsrc := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_badsrc := 'refused';
    END;
    BEGIN
      UPDATE public.hotels SET kitob_page_url = 'https://evil.example/hotels/x/' WHERE id = v_id;
      r_badurl := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_badurl := 'refused';
    END;
    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  IF v_id IS NULL THEN RAISE EXCEPTION 'probe row was not created, nothing was tested'; END IF;
  IF r_ok      IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'a credited photo + English description was %', r_ok; END IF;
  IF r_iso     IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'an ISO-keyed description was %', r_iso; END IF;
  IF r_nonstr  IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'a non-string description value was %', r_nonstr; END IF;
  IF r_empty   IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'an empty description object was %', r_empty; END IF;
  IF r_nosrc   IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'a photo without a source was %', r_nosrc; END IF;
  IF r_srconly IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'a source without a photo was %', r_srconly; END IF;
  IF r_badsrc  IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'CONTROL FAILED: photo_source google was %', r_badsrc; END IF;
  IF r_badurl  IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'a non-guide kitob_page_url was %', r_badurl; END IF;
  IF EXISTS (SELECT 1 FROM public.hotels WHERE external_id = 'kitob-zzhnc63') THEN
    RAISE EXCEPTION 'probe row survived the rollback';
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
VALUES ('20261063_hotels_kitob_guide_content.sql', '9e18a23510aeadb0f397adff47c20d967641d7c1615f43ac7fb31ac93aa890ab')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: every 1063_hotels_kitob_guide row must read OK.
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   UPDATE public.hotels SET photo_url = NULL, photo_source = NULL, description_i18n = NULL, kitob_page_url = NULL;
--   ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_photo_source_check,
--     DROP CONSTRAINT IF EXISTS hotels_description_i18n_check, DROP CONSTRAINT IF EXISTS hotels_kitob_page_url_check;
--   ALTER TABLE public.hotels DROP COLUMN IF EXISTS photo_source, DROP COLUMN IF EXISTS description_i18n,
--     DROP COLUMN IF EXISTS kitob_page_url;
--   (Empty the bucket through the Storage API first, then: DELETE FROM storage.buckets WHERE id = 'hotel-images';)
