-- ═══════════════════════════════════════════════════════════════════════════
-- 20261054 — phone + address for 9 roster names KTEB spelled differently
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 20261053 filled phone/address by EXACT name. Nineteen names in the 2026-27 roster had no
-- exact match and loaded with no phone, so their card has no call button. For nine of them
-- KTEB's new spelling differs from the one it used in earlier months, and the pharmacy is
-- the same one in the same region:
--
--   AYDIN LİFE            ← AYDIN LIFE                 (Girne)       İ vs I
--   AYDINLİFE ALSANCAK    ← AYDIN LIFE ALSANCAK        (Girne)       space, İ vs I
--   GÖKÇEN İLKTAÇ         ← GÖKCEN İLKTAÇ              (Gazimağusa)  Ç vs C
--   ILGEN                 ← İLGEN                      (Girne)       I vs İ
--   KAPTANCAN             ← KAPTAN CAN                 (Lefkoşa)     space
--   MEHMET GAZİ KÖYLÜ     ← MEHMET GAZİKÖYLÜ           (Girne)       space
--   SAKINER               ← SAKİNER                    (Karpaz)      I vs İ
--   ŞİFA BİLDİR           ← ŞİFA BILDIR                (Lefke)       İ vs I
--   ⚠ HÜSEYİN SAKALLI     ← HÜSEYİN KERİM SAKALLI      (Lefkoşa)     middle name dropped
--
-- The last one is the ONLY INFERENCE; the other eight are spelling. It rests on the same
-- first name and surname, the same region, and there being exactly one candidate. If that is
-- not good enough, delete its VALUES line and remove it from the name list near the end of the DO block too — absent is safe,
-- a wrong number is not.
--
-- THE ROWS KEEP KTEB'S SPELLING. (duty_date, name) is the natural key 20261053's re-apply
-- relies on; renaming would duplicate on the next reload. Only phone and address change.
--
-- SOURCE: the canonical name's MOST RECENT pre-2026-09-28 duty_list row carrying a phone,
-- IN THE SAME REGION as the target row — the region is what tells two same-named
-- pharmacies apart (the YUSUF TANDOĞAN precedent). Phone and address come from that one row.
--
-- ⚠ Regenerating and re-applying 20261053 (scripts/gen-duty-roster-sql.mjs) deletes and
--   reinserts the whole range, which brings these NULLs back. Re-apply this file after it.
--
-- The other ten gaps have no phone anywhere in our data and are NOT guessed here.
--
-- Apply: SQL Editor, Role = postgres, whole file ONCE. Re-runnable: it only touches rows
-- whose phone IS NULL, so a second paste updates nothing and every assertion still holds.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '5s';

-- One DO block: the assertions need the pre-update NULL count held in a variable.
DO $$
DECLARE
  v_before   int;
  v_after    int;
  v_expected int;
  v_updated  int;
  v_bad      text;
BEGIN
  SELECT count(*) INTO v_before FROM public.duty_list
   WHERE duty_date BETWEEN '2026-09-28' AND '2027-09-26' AND phone IS NULL;

  -- Every variant must have ONE target region in range, and a source row in THAT region.
  WITH m(variant, canonical) AS (VALUES
    ('AYDIN LİFE ECZANESİ',          'AYDIN LIFE ECZANESİ'),
    ('AYDINLİFE ALSANCAK ECZANESİ',  'AYDIN LIFE ALSANCAK ECZANESİ'),
    ('GÖKÇEN İLKTAÇ ECZANESİ',       'GÖKCEN İLKTAÇ ECZANESİ'),
    ('ILGEN ECZANESİ',               'İLGEN ECZANESİ'),
    ('KAPTANCAN ECZANESİ',           'KAPTAN CAN ECZANESİ'),
    ('MEHMET GAZİ KÖYLÜ ECZANESİ',   'MEHMET GAZİKÖYLÜ ECZANESİ'),
    ('SAKINER ECZANESİ',             'SAKİNER ECZANESİ'),
    ('ŞİFA BİLDİR ECZANESİ',         'ŞİFA BILDIR ECZANESİ'),
    ('HÜSEYİN SAKALLI ECZANESİ',     'HÜSEYİN KERİM SAKALLI ECZANESİ')
  ),
  tgt AS (
    SELECT m.variant, m.canonical,
           (SELECT array_agg(DISTINCT d.region) FROM public.duty_list d
             WHERE d.name = m.variant AND d.duty_date BETWEEN '2026-09-28' AND '2027-09-26') AS regions
      FROM m
  )
  SELECT string_agg(format('%s regions=%s source=%s', t.variant, coalesce(t.regions::text, '{}'),
           (SELECT count(*) FROM public.duty_list s
             WHERE s.name = t.canonical AND s.duty_date < '2026-09-28'
               AND s.phone IS NOT NULL AND s.region = t.regions[1])), '; ')
    INTO v_bad
    FROM tgt t
   WHERE cardinality(coalesce(t.regions, '{}')) IS DISTINCT FROM 1
      OR NOT EXISTS (SELECT 1 FROM public.duty_list s
                      WHERE s.name = t.canonical AND s.duty_date < '2026-09-28'
                        AND s.phone IS NOT NULL AND s.region = t.regions[1]);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'unresolvable variant(s), nothing changed: %', v_bad;
  END IF;

  WITH m(variant, canonical) AS (VALUES
    ('AYDIN LİFE ECZANESİ',          'AYDIN LIFE ECZANESİ'),
    ('AYDINLİFE ALSANCAK ECZANESİ',  'AYDIN LIFE ALSANCAK ECZANESİ'),
    ('GÖKÇEN İLKTAÇ ECZANESİ',       'GÖKCEN İLKTAÇ ECZANESİ'),
    ('ILGEN ECZANESİ',               'İLGEN ECZANESİ'),
    ('KAPTANCAN ECZANESİ',           'KAPTAN CAN ECZANESİ'),
    ('MEHMET GAZİ KÖYLÜ ECZANESİ',   'MEHMET GAZİKÖYLÜ ECZANESİ'),
    ('SAKINER ECZANESİ',             'SAKİNER ECZANESİ'),
    ('ŞİFA BİLDİR ECZANESİ',         'ŞİFA BILDIR ECZANESİ'),
    ('HÜSEYİN SAKALLI ECZANESİ',     'HÜSEYİN KERİM SAKALLI ECZANESİ')
  ),
  src AS (
    SELECT DISTINCT ON (s.name, s.region) s.name, s.region, s.phone, s.address
      FROM public.duty_list s
     WHERE s.duty_date < '2026-09-28' AND s.phone IS NOT NULL
       AND s.name IN (SELECT canonical FROM m)
     ORDER BY s.name, s.region, s.duty_date DESC
  )
  UPDATE public.duty_list d
     SET phone = src.phone, address = src.address
    FROM m JOIN src ON src.name = m.canonical
   WHERE d.name = m.variant AND d.region = src.region
     AND d.duty_date BETWEEN '2026-09-28' AND '2027-09-26'
     AND d.phone IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  SELECT count(*) INTO v_after FROM public.duty_list
   WHERE duty_date BETWEEN '2026-09-28' AND '2027-09-26' AND phone IS NULL;

  -- Nothing outside the nine was touched: the drop in NULLs equals the rows updated.
  IF v_before - v_after IS DISTINCT FROM v_updated THEN
    RAISE EXCEPTION 'NULL-phone count moved by % but % rows were updated', v_before - v_after, v_updated;
  END IF;

  -- None of the nine is left without a phone in range.
  SELECT string_agg(DISTINCT name, ', ') INTO v_bad FROM public.duty_list
   WHERE duty_date BETWEEN '2026-09-28' AND '2027-09-26' AND phone IS NULL
     AND name IN ('AYDIN LİFE ECZANESİ','AYDINLİFE ALSANCAK ECZANESİ','GÖKÇEN İLKTAÇ ECZANESİ',
                  'ILGEN ECZANESİ','KAPTANCAN ECZANESİ','MEHMET GAZİ KÖYLÜ ECZANESİ',
                  'SAKINER ECZANESİ','ŞİFA BİLDİR ECZANESİ','HÜSEYİN SAKALLI ECZANESİ');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'still no phone after update: % (updated %, NULL %→%)', v_bad, v_updated, v_before, v_after;
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
VALUES ('20261054_duty_roster_phone_variants.sql', 'f4c94d6221d46876e0574f600758b2eb66c5b866676091d44e925c60d44a7882')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

-- ─── Verification after applying (read-only, run alone) ────────────────────
--   SELECT DISTINCT name, region FROM public.duty_list
--    WHERE duty_date BETWEEN '2026-09-28' AND '2027-09-26' AND phone IS NULL ORDER BY 2, 1;
--   -- expect exactly the ten with no source: DOĞAN BAŞAK, ERENKÖY, HAMİTKÖY, İSFENDİYAROĞLU,
--   -- MEHMET TUT, MISRA ÖZBAY, NELİN, ÖZVOL, SUDE UZUN, SÜNMEZ
