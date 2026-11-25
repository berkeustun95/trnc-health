-- ═══════════════════════════════════════════════════════════════════════════
-- 20261235 — Döveç: privacy notice URLs (TR / EN) for the enquiry form
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The consent checkbox on the Döveç enquiry form links to Döveç's own privacy notice. The link comes from the single
-- dovec_settings row, so it can be corrected by a migration without an app update.
--
-- Adds two nullable text columns to dovec_settings: privacy_url_tr and privacy_url_en. Each is NULL or an https:// URL
-- of at most 500 characters with no whitespace (named CHECKs dovec_settings_privacy_url_tr_check / _en_check).
-- Both are set in this file: the Döveç Group privacy-policy pages, public marketing URLs.
--
-- WHO CAN READ / WRITE WHAT after this file:
--   * anon and authenticated (guests included) may READ, by column grant, exactly: id, last_good_sync_at, privacy_url_en,
--     privacy_url_tr, published, suspended, whatsapp_e164. The two new columns are public URLs. The run columns
--     (last_run_*) stay unreadable to them. They still write NOTHING: no INSERT/UPDATE/DELETE anywhere on the table.
--   * service_role keeps its UPDATE on exactly suspended, last_good_sync_at, last_run_at, last_run_status, last_run_detail.
--     It gets NO right to change the URLs; they change only by a migration, like whatsapp_e164.
--   * No policy, function, cron, trigger or other table is touched. The one existing policy (dovec_settings_read,
--     SELECT USING true) already lets the app read the row; a column is visible only when it is granted, so the grant is
--     the whole change. The dovec_projects read gate (20261231) is not involved.
--   * `published` is not changed (the file asserts it is still false).
--
-- The URL values are not secrets and no user data is read or written. Re-runnable: ADD COLUMN IF NOT EXISTS, constraints
-- dropped and re-added, same values written; after it applies a second run is refused by the ledger.

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.dovec_settings') IS NULL THEN
    RAISE EXCEPTION '20261229 is not applied: apply it before this file';
  END IF;
END $$;

ALTER TABLE public.dovec_settings
  ADD COLUMN IF NOT EXISTS privacy_url_tr text NULL,
  ADD COLUMN IF NOT EXISTS privacy_url_en text NULL;

ALTER TABLE public.dovec_settings DROP CONSTRAINT IF EXISTS dovec_settings_privacy_url_tr_check;
ALTER TABLE public.dovec_settings ADD CONSTRAINT dovec_settings_privacy_url_tr_check
  CHECK (privacy_url_tr IS NULL OR (privacy_url_tr ~ '^https://[^[:space:]]+$' AND char_length(privacy_url_tr) <= 500));
ALTER TABLE public.dovec_settings DROP CONSTRAINT IF EXISTS dovec_settings_privacy_url_en_check;
ALTER TABLE public.dovec_settings ADD CONSTRAINT dovec_settings_privacy_url_en_check
  CHECK (privacy_url_en IS NULL OR (privacy_url_en ~ '^https://[^[:space:]]+$' AND char_length(privacy_url_en) <= 500));

COMMENT ON COLUMN public.dovec_settings.privacy_url_tr IS 'Döveç privacy notice, Turkish page (https, max 500). Public, app roles read it; changes only by migration. 20261235.';
COMMENT ON COLUMN public.dovec_settings.privacy_url_en IS 'Döveç privacy notice, English page (https, max 500). Public, app roles read it; changes only by migration. 20261235.';

GRANT SELECT (privacy_url_tr, privacy_url_en) ON public.dovec_settings TO anon, authenticated;

DO $$
DECLARE
  v_n     bigint;
  v_names text;
  v_role  text;
  v_tr    text;
  v_en    text;
BEGIN
  UPDATE public.dovec_settings
     SET privacy_url_en = 'https://www.dovecgroup.com/en/privacy-policy',
         privacy_url_tr = 'https://www.dovecgroup.com/tr/privacy-policy'
   WHERE id = 1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'dovec_settings: the privacy URL update changed % rows, expected exactly 1', v_n;
  END IF;

  -- The row holds exactly the two values, and the go-live gate is untouched.
  SELECT privacy_url_tr, privacy_url_en INTO v_tr, v_en FROM public.dovec_settings WHERE id = 1;
  RAISE NOTICE 'dovec_settings privacy_url_tr=% privacy_url_en=%', v_tr, v_en;
  IF v_tr IS DISTINCT FROM 'https://www.dovecgroup.com/tr/privacy-policy' OR v_en IS DISTINCT FROM 'https://www.dovecgroup.com/en/privacy-policy' THEN
    RAISE EXCEPTION 'dovec_settings privacy URLs are not the agreed values';
  END IF;
  IF (SELECT count(*) FROM public.dovec_settings) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'dovec_settings must hold exactly one row';
  END IF;
  IF (SELECT published FROM public.dovec_settings WHERE id = 1) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'dovec_settings.published is not false: this file must not change the go-live gate';
  END IF;

  -- Both constraints exist.
  SELECT count(*), string_agg(conname, ',' ORDER BY conname) INTO v_n, v_names FROM pg_constraint
   WHERE conrelid = 'public.dovec_settings'::regclass AND contype = 'c'
     AND conname IN ('dovec_settings_privacy_url_tr_check', 'dovec_settings_privacy_url_en_check');
  RAISE NOTICE 'privacy URL constraints (%): %', v_n, v_names;
  IF v_n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'expected both privacy URL CHECK constraints, found %', v_n; END IF;

  -- App roles: read exactly the listed columns, write none.
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.dovec_settings'::regclass AND a.attnum > 0 AND NOT a.attisdropped
                AND has_column_privilege(v_role, 'public.dovec_settings'::regclass, a.attnum, 'INSERT,UPDATE,REFERENCES')) THEN
      RAISE EXCEPTION 'a column of dovec_settings is writable by %', v_role;
    END IF;
    SELECT string_agg(a.attname, ',' ORDER BY a.attname) INTO v_names FROM pg_attribute a
     WHERE a.attrelid = 'public.dovec_settings'::regclass AND a.attnum > 0 AND NOT a.attisdropped
       AND has_column_privilege(v_role, 'public.dovec_settings'::regclass, a.attnum, 'SELECT');
    RAISE NOTICE 'dovec_settings columns readable by %: %', v_role, v_names;
    IF v_names IS DISTINCT FROM 'id,last_good_sync_at,privacy_url_en,privacy_url_tr,published,suspended,whatsapp_e164' THEN
      RAISE EXCEPTION 'dovec_settings readable columns for % are %', v_role, v_names;
    END IF;
  END LOOP;

  -- service_role: UPDATE column set unchanged.
  SELECT string_agg(a.attname, ',' ORDER BY a.attname) INTO v_names FROM pg_attribute a
   WHERE a.attrelid = 'public.dovec_settings'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND has_column_privilege('service_role', 'public.dovec_settings'::regclass, a.attnum, 'UPDATE');
  RAISE NOTICE 'dovec_settings columns updatable by service_role: %', v_names;
  IF v_names IS DISTINCT FROM 'last_good_sync_at,last_run_at,last_run_detail,last_run_status,suspended' THEN
    RAISE EXCEPTION 'dovec_settings service_role UPDATE columns are %', v_names;
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
VALUES ('20261235_dovec_privacy_url.sql', '05d04990a43db19c94974a400a2631a5199d24be23d841a08b9f12deefca3dc4')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

NOTIFY pgrst, 'reload schema';
