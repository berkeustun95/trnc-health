-- ═══════════════════════════════════════════════════════════════════════════
-- 20261064 — hotels: photo gallery (up to 6) + description cap for nine languages
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Berke, 2026-09-30: the Oteller card becomes a swipeable gallery (up to 6 photos from KITOB's
-- guide, hotelsofnorthcyprus.com, KITOB-approved; same credit), and every description is shown
-- in all nine app languages.
--
--   1. hotels.gallery_urls text[] — the card's photos in display order, COVER FIRST.
--      hotels_gallery_check ties it to photo_url (20261063's two-way photo/source rule stays):
--        • present exactly when photo_url is;
--        • 1..6 elements, no NULL element, every element https;
--        • gallery_urls[1] = photo_url — one cover, stated once; nothing can drift apart.
--      BACKFILL FIRST: 98 rows carry photo_url from the first import; they get a one-photo
--      gallery of it inside this transaction, before the CHECK goes on. The importer then
--      rewrites them with the full galleries.
--   2. hotels_description_i18n_check: the byte cap 12000 → 40000. Measured 2026-09-30 with all
--      nine languages: 37 of 95 descriptions exceed 12000, the largest 33135 bytes (Cyrillic,
--      Greek, Arabic and Persian cost 2 bytes a character). 12000 was sized for English only and
--      refused the first write — it did its job. Same-name DROP/ADD; every other clause is
--      byte-identical to 20261063's.
--      The COMMENT is rewritten: "English only; the card falls back to English" is now false.
--
-- No RLS or policy change. ADD COLUMN ⇒ ends with NOTIFY pgrst.
-- Apply: SQL Editor, Role = postgres, whole file ONCE, copied from disk. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.hotels ADD COLUMN IF NOT EXISTS gallery_urls text[];

UPDATE public.hotels SET gallery_urls = ARRAY[photo_url]
 WHERE photo_url IS NOT NULL AND gallery_urls IS NULL;

DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.hotels WHERE (gallery_urls IS NULL) <> (photo_url IS NULL);
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'backfill left % hotel(s) with a photo but no gallery (or the reverse)', v_n;
  END IF;
END $$;

ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_gallery_check;
ALTER TABLE public.hotels ADD  CONSTRAINT hotels_gallery_check
  CHECK ((gallery_urls IS NULL) = (photo_url IS NULL)
         AND (gallery_urls IS NULL OR (
               cardinality(gallery_urls) BETWEEN 1 AND 6
               AND array_position(gallery_urls, NULL) IS NULL
               AND gallery_urls[1] = photo_url
               AND array_to_string(gallery_urls, E'\n') ~ '^https://[^\n]+(\nhttps://[^\n]+)*$')));

ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_description_i18n_check;
ALTER TABLE public.hotels ADD  CONSTRAINT hotels_description_i18n_check
  CHECK (description_i18n IS NULL OR (
    jsonb_typeof(description_i18n) = 'object'
    AND description_i18n <> '{}'::jsonb
    AND (description_i18n - ARRAY['English','Turkish','Arabic','Russian','Greek','French',
                                  'Spanish','German','Persian']) = '{}'::jsonb
    AND NOT jsonb_path_exists(description_i18n, '$.* ? (@.type() != "string")')
    AND octet_length(description_i18n::text) <= 40000));

COMMENT ON COLUMN public.hotels.gallery_urls IS
  'The card''s photos in display order, cover first (gallery_urls[1] = photo_url), 1..6, https, our own storage (hotel-images). Present exactly when photo_url is (hotels_gallery_check). Source: photo_source.';
COMMENT ON COLUMN public.hotels.description_i18n IS
  'Description keyed by FULL language name (English, Turkish …), never ISO codes (hotels_description_i18n_check, ≤ 40000 bytes). English is KITOB''s guide text (hotelsofnorthcyprus.com); the other eight are LLM translations of it, pinned to the English by hash in data/kitob/description-translations/ and re-applied by scripts/import-hnc-hotels.mjs.';

-- ─── Assertions ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_id uuid; v_n int;
  u text := 'https://x.supabase.co/storage/v1/object/public/hotel-images/zz/';
  r_ok text := 'unset'; r_big text := 'unset'; r_seven text := 'unset'; r_null text := 'unset';
  r_cover text := 'unset'; r_http text := 'unset'; r_nosrc text := 'unset'; r_nogal text := 'unset';
  r_huge text := 'unset';
BEGIN
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'hotels';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'hotels carries % policies, expected 1', v_n; END IF;

  BEGIN
    INSERT INTO public.hotels (external_id, name, kitob_class, region, is_kitob_member, source_list_date, content_hash)
    VALUES ('kitob-zzgal64', 'zz gallery probe', 'star3', 'kyrenia', true, DATE '2026-01-01', 'zz') RETURNING id INTO v_id;

    -- Positive control: a six-photo gallery, cover first.
    BEGIN
      UPDATE public.hotels SET photo_url = u || '1.jpg', photo_source = 'hnc',
             gallery_urls = ARRAY[u||'1.jpg', u||'2.jpg', u||'3.jpg', u||'4.jpg', u||'5.jpg', u||'6.jpg']
       WHERE id = v_id;
      r_ok := 'accepted';
    EXCEPTION WHEN check_violation THEN r_ok := 'REFUSED';
    END;
    -- Positive control: nine languages well over the old 12000-byte cap (Cyrillic = 2 bytes).
    BEGIN
      UPDATE public.hotels SET description_i18n = jsonb_build_object(
               'English', repeat('a', 3000), 'Turkish', repeat('ç', 3000), 'Russian', repeat('ж', 3000),
               'Greek', repeat('λ', 3000), 'Arabic', repeat('ع', 3000), 'Persian', repeat('پ', 2000),
               'French', repeat('é', 1000), 'Spanish', repeat('ñ', 1000), 'German', repeat('ü', 1000))
       WHERE id = v_id;
      r_big := 'accepted';
    EXCEPTION WHEN check_violation THEN r_big := 'REFUSED';
    END;
    BEGIN
      UPDATE public.hotels SET description_i18n = jsonb_build_object('English', repeat('a', 41000)) WHERE id = v_id;
      r_huge := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_huge := 'refused';
    END;
    BEGIN
      UPDATE public.hotels SET gallery_urls = gallery_urls || (u || '7.jpg') WHERE id = v_id;
      r_seven := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_seven := 'refused';
    END;
    BEGIN
      UPDATE public.hotels SET gallery_urls = ARRAY[u||'1.jpg', NULL] WHERE id = v_id;
      r_null := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_null := 'refused';
    END;
    BEGIN
      UPDATE public.hotels SET gallery_urls = ARRAY[u||'2.jpg', u||'1.jpg'] WHERE id = v_id;
      r_cover := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_cover := 'refused';
    END;
    BEGIN
      UPDATE public.hotels SET gallery_urls = ARRAY[u||'1.jpg', 'http://example.com/x.jpg'] WHERE id = v_id;
      r_http := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_http := 'refused';
    END;
    BEGIN
      UPDATE public.hotels SET photo_source = NULL WHERE id = v_id;
      r_nosrc := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_nosrc := 'refused';
    END;
    BEGIN
      UPDATE public.hotels SET gallery_urls = NULL WHERE id = v_id;
      r_nogal := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_nogal := 'refused';
    END;
    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  IF v_id IS NULL THEN RAISE EXCEPTION 'probe row was not created, nothing was tested'; END IF;
  IF r_ok    IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'a six-photo gallery, cover first, was %', r_ok; END IF;
  IF r_big   IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'a nine-language description over 12000 bytes was %', r_big; END IF;
  IF r_huge  IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'a description over 40000 bytes was %', r_huge; END IF;
  IF r_seven IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'a seven-photo gallery was %', r_seven; END IF;
  IF r_null  IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'a gallery with a NULL element was %', r_null; END IF;
  IF r_cover IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'a gallery whose first photo is not photo_url was %', r_cover; END IF;
  IF r_http  IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'a non-https gallery element was %', r_http; END IF;
  IF r_nosrc IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'CONTROL FAILED: a photo without a source was %', r_nosrc; END IF;
  IF r_nogal IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'a photo without a gallery was %', r_nogal; END IF;
  IF EXISTS (SELECT 1 FROM public.hotels WHERE external_id = 'kitob-zzgal64') THEN
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
VALUES ('20261064_hotels_gallery_and_description_cap.sql', '04a41fb55e84b5dfd17d9913544ddf38b549f9e9b0ea423548e584b81c3e453d')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: every 1064_hotels_gallery row must read OK.
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_gallery_check;
--   ALTER TABLE public.hotels DROP COLUMN IF EXISTS gallery_urls;
--   (Lowering the description cap back to 12000 fails while any nine-language row exists.)
