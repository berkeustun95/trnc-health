-- ═══════════════════════════════════════════════════════════════════════════
-- 20261065 — hotels: free-licence (Wikimedia Commons) photos with their own credit
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Berke, 2026-09-30: KITOB's guide has no real photo of Merit Lefkoşa (stock + a museum) or
-- Hamsa (a logo). Where a free-licence photo that allows commercial use exists (CC0, public
-- domain, CC BY, CC BY-SA — never NC/ND), it may be stored and shown with ITS author and
-- licence instead of the KITOB credit. Found: one, for Merit Lefkoşa (CC0). Hamsa: none.
--
--   1. hotels.photo_credit text — the credit line for a photo that is not KITOB's:
--      "<author> · <licence> · <where>". The card prints it after a localized "Photo:".
--   2. hotels_photo_source_check: 'commons' joins 'hnc'. The two-way clause with photo_url is
--      byte-identical to 20261063's (its verify_schema token still matches).
--   3. hotels_photo_credit_check: photo_credit is present EXACTLY when photo_source is
--      'commons'. Written with IS NOT DISTINCT FROM: `photo_source = 'commons'` is NULL on a
--      row with no photo, and a CHECK passes on NULL — the plain `=` form would let a credit
--      sit on a photo-less row. The probe below exercises exactly that row.
--      1..200 characters after trimming, no line breaks (it is one overlay line on the card).
--
-- Written by scripts/import-hnc-hotels.mjs from data/kitob/cover-overrides.json (committed),
-- so a KITOB re-import keeps the Commons photo.
-- No RLS or policy change. ADD COLUMN ⇒ ends with NOTIFY pgrst.
-- Apply: SQL Editor, Role = postgres, whole file ONCE, copied from disk. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.hotels ADD COLUMN IF NOT EXISTS photo_credit text;

ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_photo_source_check;
ALTER TABLE public.hotels ADD  CONSTRAINT hotels_photo_source_check
  CHECK ((photo_source IS NULL OR photo_source IN ('hnc', 'commons'))
         AND (photo_url IS NULL) = (photo_source IS NULL));

ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_photo_credit_check;
ALTER TABLE public.hotels ADD  CONSTRAINT hotels_photo_credit_check
  CHECK ((photo_source IS NOT DISTINCT FROM 'commons') = (photo_credit IS NOT NULL)
         AND (photo_credit IS NULL OR (length(btrim(photo_credit)) BETWEEN 1 AND 200
                                       AND photo_credit !~ '[\r\n]')));

COMMENT ON COLUMN public.hotels.photo_source IS
  'Where photo_url came from: hnc = hotelsofnorthcyprus.com (KITOB''s guide, KITOB-approved 2026-09-29; card credits "Fotoğraf: KITOB – hotelsofnorthcyprus.com"); commons = a free-licence photo allowing commercial use (Wikimedia Commons), credited from photo_credit. Present exactly when photo_url is (hotels_photo_source_check).';
COMMENT ON COLUMN public.hotels.photo_credit IS
  'Credit for a photo that is not KITOB''s: "<author> · <licence> · <where>", shown after a localized "Photo:". Present exactly when photo_source = commons (hotels_photo_credit_check). Written from data/kitob/cover-overrides.json by scripts/import-hnc-hotels.mjs, which re-checks the licence on Commons at every import.';

-- ─── Assertions ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_id uuid; v_hnc_before int; v_hnc_after int; v_n int;
  u text := 'https://x.supabase.co/storage/v1/object/public/hotel-images/zz/1.jpg';
  r_commons text := 'unset'; r_hnc text := 'unset'; r_google text := 'unset'; r_nocredit text := 'unset';
  r_hnccredit text := 'unset'; r_nullcredit text := 'unset'; r_blank text := 'unset'; r_nl text := 'unset';
BEGIN
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'hotels';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'hotels carries % policies, expected 1', v_n; END IF;
  SELECT count(*) INTO v_hnc_before FROM public.hotels WHERE photo_source = 'hnc';

  BEGIN
    INSERT INTO public.hotels (external_id, name, kitob_class, region, is_kitob_member, source_list_date, content_hash)
    VALUES ('kitob-zzcredit65', 'zz credit probe', 'star3', 'kyrenia', true, DATE '2026-01-01', 'zz') RETURNING id INTO v_id;

    -- Positive controls.
    BEGIN
      UPDATE public.hotels SET photo_url = u, gallery_urls = ARRAY[u], photo_source = 'commons',
             photo_credit = 'Someone · CC0 · Wikimedia Commons' WHERE id = v_id;
      r_commons := 'accepted';
    EXCEPTION WHEN check_violation THEN r_commons := 'REFUSED';
    END;
    BEGIN
      UPDATE public.hotels SET photo_source = 'hnc', photo_credit = NULL WHERE id = v_id;
      r_hnc := 'accepted';
    EXCEPTION WHEN check_violation THEN r_hnc := 'REFUSED';
    END;
    -- Refusals.
    BEGIN
      UPDATE public.hotels SET photo_source = 'google' WHERE id = v_id;
      r_google := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_google := 'refused';
    END;
    BEGIN
      UPDATE public.hotels SET photo_source = 'commons', photo_credit = NULL WHERE id = v_id;
      r_nocredit := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_nocredit := 'refused';
    END;
    BEGIN
      UPDATE public.hotels SET photo_source = 'hnc', photo_credit = 'Someone · CC0' WHERE id = v_id;
      r_hnccredit := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_hnccredit := 'refused';
    END;
    -- The NULL row: no photo at all, but a credit. The `=` form of the CHECK passes this.
    BEGIN
      UPDATE public.hotels SET photo_url = NULL, gallery_urls = NULL, photo_source = NULL,
             photo_credit = 'Someone · CC0' WHERE id = v_id;
      r_nullcredit := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_nullcredit := 'refused';
    END;
    BEGIN
      UPDATE public.hotels SET photo_url = u, gallery_urls = ARRAY[u], photo_source = 'commons',
             photo_credit = '   ' WHERE id = v_id;
      r_blank := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_blank := 'refused';
    END;
    BEGIN
      UPDATE public.hotels SET photo_url = u, gallery_urls = ARRAY[u], photo_source = 'commons',
             photo_credit = 'Someone' || E'\n' || 'CC0' WHERE id = v_id;
      r_nl := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_nl := 'refused';
    END;
    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  SELECT count(*) INTO v_hnc_after FROM public.hotels WHERE photo_source = 'hnc';
  IF v_id IS NULL THEN RAISE EXCEPTION 'probe row was not created, nothing was tested'; END IF;
  IF r_commons    IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'a commons photo with a credit was %', r_commons; END IF;
  IF r_hnc        IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'CONTROL FAILED: an hnc photo with no credit was %', r_hnc; END IF;
  IF r_google     IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'photo_source google was %', r_google; END IF;
  IF r_nocredit   IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'a commons photo without a credit was %', r_nocredit; END IF;
  IF r_hnccredit  IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'an hnc photo carrying a credit was %', r_hnccredit; END IF;
  IF r_nullcredit IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'a credit on a row with no photo was %', r_nullcredit; END IF;
  IF r_blank      IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'a blank credit was %', r_blank; END IF;
  IF r_nl         IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'a credit with a line break was %', r_nl; END IF;
  IF v_hnc_after IS DISTINCT FROM v_hnc_before THEN
    RAISE EXCEPTION 'hnc rows changed: % before, % after', v_hnc_before, v_hnc_after;
  END IF;
  IF EXISTS (SELECT 1 FROM public.hotels WHERE external_id = 'kitob-zzcredit65') THEN
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
VALUES ('20261065_hotels_commons_photo_credit.sql', '6c1f6e172fff3c22c683bc3c45bc0eb7ded17e4fd0cfa289398e89153f4a2a0d')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: every 1065_hotels_commons_credit row must read OK.
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   UPDATE public.hotels SET photo_url = NULL, gallery_urls = NULL, photo_source = NULL,
--          photo_credit = NULL WHERE photo_source = 'commons';
--   ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_photo_credit_check;
--   ALTER TABLE public.hotels DROP COLUMN IF EXISTS photo_credit;
--   then re-add hotels_photo_source_check with IN ('hnc') as in 20261063.
