-- ═══════════════════════════════════════════════════════════════════════════
-- 20261057 — reconcile the 16 parked ledger gaps (bookkeeping only)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Touches ONE table, public.schema_migrations_applied. No schema, no app data.
-- Record, provenance and the Step-0 prod probe: ~/ObsidianVault/10-ada/2026-09-27_ledger-reconcile.md
--
--   L3  DELETE the orphan row 20261026_student_list_rpc.sql. It WAS applied (06:24 UTC
--       2026-09-16) and was superseded the same day by 20261026_student_education.sql
--       (12:27), which CREATE OR REPLACEd both of its functions. Deleted only if its checksum
--       is the one git recorded for it, and only while the live get_student_list is the
--       student_education body.
--   L1  INSERT the 13 applied-but-unrecorded files with their DISK checksum and
--       applied_by = 'backfill-2026-09-27' (the 'baseline' convention: the row says a
--       human reconciled it, not that these exact bytes were pasted). applied_at is the
--       backfill time, not the apply time. Each row is guarded by a catalog fact the file
--       left behind; ALL are checked before ANY is inserted.
--   L2  Re-point 20260922 and 20261016 to their disk checksums with a guarded UPDATE —
--       never a stamp re-run, whose ON CONFLICT would overwrite applied_at. The old full
--       checksum is appended to applied_by, because it is recorded nowhere else. Both applied
--       texts are unrecoverable. 20261016 is gated on the live check_profile_name_content
--       body being byte-identical to the committed one (md5 of pg_proc.prosrc).
--
-- Apply: SQL Editor, Role = postgres, WHOLE FILE, once. Re-runnable: a second paste finds
-- the orphan gone, the 13 rows present and both checksums already on disk values.
-- Then: supabase/migration_ledger_check.sql must report no L1/L2/L3 rows.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  c_orphan      constant text := '20261026_student_list_rpc.sql';
  c_orphan_ck   constant text := 'bc53a499737ec02e5ba37dc7c592cabf5d84f9630cff30ccf591dd490ca0b3d9';
  c_by          constant text := 'backfill-2026-09-27';
  c_1016_md5    constant text := '1e6afbd809f8e7d79882f2a96447e74d';
  v_def   text;
  v_ck    text;
  v_n     int;
  v_bad   text;
  r       record;
BEGIN
  -- ─── 0. Premise: the live student list is the student_education body ─────────
  --     Code shapes, not words: pg_get_functiondef returns comments too.
  v_def := pg_get_functiondef(to_regprocedure('public.get_student_list(uuid,text,integer)'));
  IF v_def IS NULL OR position('FROM student_education' in v_def) = 0
     OR position('i.id = p.institution_id' in v_def) > 0 THEN
    RAISE EXCEPTION 'REFUSING: live get_student_list is not the student_education body — fix that first. def starts: %',
      left(coalesce(v_def, '<missing>'), 300);
  END IF;

  -- ─── L1 evidence: every file, checked before anything is written ─────────────
  SELECT string_agg(f, ', ') INTO v_bad FROM (VALUES
    ('20261003_reviews_decouple_from_appointments.sql',
       NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reviews_appointment_id_fkey')),
    ('20261004_appointments_removal.sql',
       to_regclass('public.appointments') IS NULL),
    ('20261006_resident_status_drop_newcomer.sql',
       COALESCE((SELECT pg_get_constraintdef(c.oid) NOT LIKE '%newcomer%' AND pg_get_constraintdef(c.oid) LIKE '%''student''%'
                   FROM pg_constraint c WHERE c.conrelid = 'public.profiles'::regclass
                    AND c.conname = 'profiles_resident_status_check'), false)),
    ('20261007_home_strip_pin.sql',
       to_regclass('public.home_strip_pin') IS NOT NULL),
    ('20261010_home_services_coverage_districts.sql',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                AND table_name = 'home_services' AND column_name = 'coverage_districts')),
    ('20261011_seed_tadilart_cyprus.sql',
       EXISTS (SELECT 1 FROM public.home_services WHERE id = '0496fb4c-4e5d-4e35-a238-dd1fcb402541')),
    ('20261012_home_services_partner_only.sql',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                AND table_name = 'home_services' AND column_name = 'is_partner')),
    ('20261013_home_services_drop_test_rows.sql',
       NOT EXISTS (SELECT 1 FROM public.home_services WHERE id IN (
         'ecc59457-0e36-4aeb-9cd1-dea30a4f09a8','3a3f7e1a-9d17-4cf8-b8a4-fb43729ab2dc',
         '6084b642-212c-407e-9cd3-cde37fe61490','7736d6ce-2d0c-4ce6-ac80-1de082f0fe32'))),
    ('20261039_property_images_owner_scoped.sql',
       EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                AND policyname = 'property_images_upload'
                AND with_check ILIKE '%uid%' AND with_check ILIKE '%is_anonymous_session%')),
    ('20261040_avatars_private.sql',
       (SELECT b.public FROM storage.buckets b WHERE b.id = 'avatars') IS FALSE),
    ('20261041_avatars_drop_dashboard_policies.sql',
       NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                    AND policyname IN ('Public avatar read', 'Users manage own avatar'))
       AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
             AND permissive = 'PERMISSIVE' AND COALESCE(with_check, qual, '') ILIKE '%avatars%') = 4),
    ('20261042_capture_dashboard_storage_policies.sql',
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
         AND policyname IN ('Providers manage own facility images', 'estate_agent_documents_admin_read')) = 2),
    ('20261043_home_strip_pin_notice.sql',
       COALESCE((SELECT pg_get_constraintdef(c.oid) LIKE '%''notice''%' FROM pg_constraint c
                  WHERE c.conrelid = 'public.home_strip_pin'::regclass
                    AND c.conname = 'home_strip_pin_kind_check'), false))
  ) e(f, ok) WHERE ok IS DISTINCT FROM true;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'REFUSING: no catalog evidence that these ran: %. Nothing written.', v_bad;
  END IF;

  -- ─── L2 evidence ─────────────────────────────────────────────────────────────
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'profiles' AND cmd = 'SELECT';
  IF v_n IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'REFUSING 20260922: profiles has % SELECT policies (expected 3)', v_n;
  END IF;
  SELECT md5(p.prosrc) INTO v_ck FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'check_profile_name_content';
  IF v_ck IS DISTINCT FROM c_1016_md5 THEN
    RAISE EXCEPTION 'REFUSING 20261016: live check_profile_name_content body md5 % differs from the committed body (%) — the applied text changed the function', coalesce(v_ck, '<missing>'), c_1016_md5;
  END IF;
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'profiles'
     AND column_name IN ('terms_version', 'terms_accepted_at', 'terms_locale', 'marketing_opt_in_at');
  IF v_n IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'REFUSING 20261016: % of its 4 profiles columns exist', v_n;
  END IF;

  -- ─── L3: the orphan ──────────────────────────────────────────────────────────
  SELECT checksum INTO v_ck FROM public.schema_migrations_applied WHERE filename = c_orphan;
  IF v_ck IS NOT NULL THEN
    IF v_ck IS DISTINCT FROM c_orphan_ck THEN
      RAISE EXCEPTION 'REFUSING: orphan row checksum is % — not the % git recorded; record it and decide', v_ck, c_orphan_ck;
    END IF;
    DELETE FROM public.schema_migrations_applied WHERE filename = c_orphan AND checksum = c_orphan_ck;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'orphan DELETE touched % rows, expected 1', v_n; END IF;
  END IF;

  -- ─── L1: backfill ────────────────────────────────────────────────────────────
  FOR r IN SELECT * FROM (VALUES
    ('20261003_reviews_decouple_from_appointments.sql',     '83d26092769eff887ed4660a7eec29d423d3b65a52c45f4d398f8f66b543d19f'),
    ('20261004_appointments_removal.sql',                   '5b14b0f1e4d1c68661e8883d9a2b6101b4e1a46cd76f4da5dbf25687914e234b'),
    ('20261006_resident_status_drop_newcomer.sql',          '1279a66efbfba6baf17bda5109599f49bd99c80191952004dcc4b66d4b99fda2'),
    ('20261007_home_strip_pin.sql',                         '1d0ce4f28ab8b43dc6b2a8ca2bc84c8a4a4d21a141ed73edccccba6ce5f83a9e'),
    ('20261010_home_services_coverage_districts.sql',       '55c57717d45bafd21e93bc2493a1fadb9159d47f1242016472b0475a0694ed3d'),
    ('20261011_seed_tadilart_cyprus.sql',                   'db6b72232e1f092a5ee6a0bf3654115fef1e8b9b79e34eaf43a062203fc67ee9'),
    ('20261012_home_services_partner_only.sql',             'f2446ec77e289a6e198b1253d6e66b715bee1e2b32248d59b39257c628e68825'),
    ('20261013_home_services_drop_test_rows.sql',           'eccf2ce092e73b62b2b2929cf2a63f726c040036d132a6d6afde227a2d65d993'),
    ('20261039_property_images_owner_scoped.sql',           '0b318e7a922095e4f242d8244bccadce72d7ff47e24f8be1b9768797002910bb'),
    ('20261040_avatars_private.sql',                        '98ed967293d1656c0914d02f6084799341f41abe0d2ec0772450fd8a00c88981'),
    ('20261041_avatars_drop_dashboard_policies.sql',        'aa5467e7761c663f98c6ab7651312c186a1d379359cdae20232ddef098b3a6a0'),
    ('20261042_capture_dashboard_storage_policies.sql',     'd5409bcc4fa9054fb1e9cc4db9ca74b1c20f931246c15ad19e98ebc59af5de9c'),
    ('20261043_home_strip_pin_notice.sql',                  'f5b0c1263c5fbaf9bf46d54b86a10d439bf80c21faebdbedef5dfecb60f5072f')
  ) v(f, ck) LOOP
    INSERT INTO public.schema_migrations_applied (filename, checksum, applied_by)
    VALUES (r.f, r.ck, c_by)
    ON CONFLICT (filename) DO NOTHING;
    SELECT checksum INTO v_ck FROM public.schema_migrations_applied WHERE filename = r.f;
    IF v_ck IS DISTINCT FROM r.ck THEN
      RAISE EXCEPTION 'L1 %: ledger holds % after backfill, disk is % — a row appeared that this file did not write', r.f, v_ck, r.ck;
    END IF;
  END LOOP;

  -- ─── L2: re-point, keep applied_at ───────────────────────────────────────────
  FOR r IN SELECT * FROM (VALUES
    ('20260922_drop_grooming_profile_overshare.sql', 'fd915cbc37b2', 'c582a3ae15cb4ab68224ec18399d1a9416a5705a98ea2ee833f5375505c2d2a4'),
    ('20261016_profile_consent_columns.sql',         '870af4d526da', '54cfa03874246ec1ea10af9c56db1a731cd4fadcc0c4f51d94bc7717b737f59f')
  ) v(f, old12, disk) LOOP
    -- The full old value exists nowhere else (only its first 12 chars were ever written
    -- down), so it is kept IN the row: applied_by carries it, and a rollback can restore it.
    UPDATE public.schema_migrations_applied
       SET checksum   = r.disk,
           applied_by = applied_by || ' · re-pointed 2026-09-27 from ' || checksum
     WHERE filename = r.f AND left(checksum, 12) = r.old12;
    SELECT checksum INTO v_ck FROM public.schema_migrations_applied WHERE filename = r.f;
    IF v_ck IS DISTINCT FROM r.disk THEN
      RAISE EXCEPTION 'L2 %: ledger holds % — neither the expected old value (%…) nor the disk value', r.f, coalesce(v_ck, '<no row>'), r.old12;
    END IF;
  END LOOP;

  -- ─── Final state ─────────────────────────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM public.schema_migrations_applied WHERE filename = c_orphan) THEN
    RAISE EXCEPTION 'orphan row still present';
  END IF;
  SELECT count(*) INTO v_n FROM public.schema_migrations_applied WHERE applied_by = c_by;
  IF v_n IS DISTINCT FROM 13 THEN
    RAISE EXCEPTION '% backfill rows, expected 13', v_n;
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
VALUES ('20261057_ledger_reconcile.sql', '6698d155f125db86ac3a79f46961ed526bc1f1743b1e13ef9c73931a1d866872')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- ─── After applying ─────────────────────────────────────────────────────────
-- Run supabase/migration_ledger_check.sql: L1, L2 and L3 must all be empty.
--
-- ─── Rollback (bookkeeping only) ────────────────────────────────────────────
--   DELETE FROM public.schema_migrations_applied WHERE applied_by = 'backfill-2026-09-27';
--   UPDATE public.schema_migrations_applied
--      SET checksum   = split_part(applied_by, ' · re-pointed 2026-09-27 from ', 2),
--          applied_by = split_part(applied_by, ' · re-pointed 2026-09-27 from ', 1)
--    WHERE applied_by LIKE '% · re-pointed 2026-09-27 from %';
--   The orphan row's contents are in the vault note if it must be restored.
