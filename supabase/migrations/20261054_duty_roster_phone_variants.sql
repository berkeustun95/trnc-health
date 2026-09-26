-- ═══════════════════════════════════════════════════════════════════════════
-- 20261054 — phone + address for the 19 roster pharmacies 20261053 loaded without one
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 20261053 filled phone/address by EXACT name, and 19 names in the 2026-27 roster had no
-- match. SOURCE OF TRUTH HERE: the KTEB Gazette's own pharmacy list (Birinci Cetvel,
-- pp 4–17), each number checked against the scan by Berke. The raw Gazette digits are in the
-- VALUES list below, untouched; the SQL formats them to the shape duty_list already uses
-- (4,542 of 4,582 in-range phones read "(0392) 815 73 50"):
--   7 digits        → 0392 landline   8157350    → (0392) 815 73 50
--   10 digits, 3…   → 0392 landline   3923301919 → (0392) 330 19 19
--   10 digits, 5…   → mobile          5338552077 → (0533) 855 20 77
--
-- ADDRESSES. Fourteen come from the Gazette: the ten new names, HÜSEYİN SAKALLI, and the three
-- respelled names whose phone changed (below). The other five respelled names — whose earlier
-- phone matched the Gazette's — take the address of that pharmacy's most recent
-- pre-2026-09-28 duty_list row IN THE SAME REGION, under its earlier spelling (the `earlier`
-- column).
--
-- WHERE THE GAZETTE PHONE DIFFERS FROM THE EARLIER ROW, THE GAZETTE WINS:
--   AYDIN LİFE          Gazette (0392) 815 73 50   earlier (0533) 888 56 66
--   KAPTANCAN           Gazette (0392) 224 06 66   earlier (0548) 853 54 78
--   MEHMET GAZİ KÖYLÜ   Gazette (0533) 843 18 99   earlier (0392) 816 01 23
-- A changed phone means the earlier row cannot be trusted for these three, so their ADDRESS
-- is the Gazette's too.
--
-- HÜSEYİN SAKALLI is kept as HÜSEYİN KERİM SAKALLI's pharmacy because the Gazette phone
-- (228 46 00) equals the earlier row's and both addresses are Ortaköy. Its address here is
-- the Gazette's.
--
-- THE ROWS KEEP KTEB'S SPELLING. (duty_date, name) is the natural key 20261053's re-apply
-- relies on. Only phone and address change, and only where phone IS NULL.
--
-- ⚠ Regenerating and re-applying 20261053 (scripts/gen-duty-roster-sql.mjs) deletes and
--   reinserts the whole range, which brings these NULLs back. Re-apply this file after it.
--
-- Apply: SQL Editor, Role = postgres, whole file ONCE. Re-runnable: only rows whose phone
-- IS NULL are touched, so a second paste updates nothing and every assertion still holds.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '5s';

-- One DO block, one VALUES list: every precondition is checked for all 19 BEFORE the first
-- UPDATE, so a failure names every bad entry at once and changes nothing. The UPDATE then
-- writes the very values that were checked.
DO $$
DECLARE
  r         record;
  v_before  int;
  v_after   int;
  v_updated int := 0;
  v_rows    int;
  v_n       int := 0;
  v_bad     text := '';
  a_name    text[] := '{}';
  a_region  text[] := '{}';
  a_phone   text[] := '{}';
  a_address text[] := '{}';
BEGIN
  SELECT count(*) INTO v_before FROM public.duty_list
   WHERE duty_date BETWEEN '2026-09-28' AND '2027-09-26' AND phone IS NULL;

  FOR r IN
    WITH g(name, region, raw, address, earlier) AS (VALUES
      -- respelled by KTEB. Phone from the Gazette. Address from the earlier-spelling row where
      -- the phone matched it; from the Gazette for the three whose phone changed.
      ('AYDIN LİFE ECZANESİ',          'Girne',       '8157350',    'Kurtuluş Cad., Minimal Plaza No:6, Bellapais yolu, Starling Market ve Camii karşısı, Doğanköy, Girne', NULL),
      ('AYDINLİFE ALSANCAK ECZANESİ',  'Girne',       '8213361',    NULL, 'AYDIN LIFE ALSANCAK ECZANESİ'),
      ('GÖKÇEN İLKTAÇ ECZANESİ',       'Gazimağusa',  '3656820',    NULL, 'GÖKCEN İLKTAÇ ECZANESİ'),
      ('ILGEN ECZANESİ',               'Girne',       '8158118',    NULL, 'İLGEN ECZANESİ'),
      ('KAPTANCAN ECZANESİ',           'Lefkoşa',     '2240666',    'Yavuz Konnolu Sok., Dış Kapı No:11B, Ortaköy, Lefkoşa', NULL),
      ('MEHMET GAZİ KÖYLÜ ECZANESİ',   'Girne',       '5338431899', 'Uğur Mumcu Cad., Karakum, Girne', NULL),
      ('SAKINER ECZANESİ',             'Karpaz',      '3744356',    NULL, 'SAKİNER ECZANESİ'),
      ('ŞİFA BİLDİR ECZANESİ',         'Lefke',       '5338419578', NULL, 'ŞİFA BILDIR ECZANESİ'),
      -- Gazette phone AND address
      ('HÜSEYİN SAKALLI ECZANESİ',     'Lefkoşa',     '2284600',    'Şht. Yzb. Tekin Yurdabak Cad., Mardo Göçmenköy Yolu, Yeniyüzyıl anaokulu yanı, Ortaköy, Lefkoşa', NULL),
      ('ERENKÖY ECZANESİ',             'Karpaz',      '5338552077', 'Yeni Erenköy, Şht. Ali Hasip Sokak No:1, Erenköy', NULL),
      ('SÜNMEZ ECZANESİ',              'İskele',      '5428765276', 'Larnaka Bulvarı, Bahçeler No:75, İskele', NULL),
      ('DOĞAN BAŞAK ECZANESİ',         'Girne',       '8153620',    'Ziya Rızkı Cad. No:31, 31 Ocak Klübü karşısı, Barbaraslar Market yanı, Girne', NULL),
      ('HAMİTKÖY ECZANESİ',            'Lefkoşa',     '3923301919', 'Atatürk Caddesi, Hamitköy NGH Apt. No:4, Lefkoşa', NULL),
      ('SUDE UZUN ECZANESİ',           'Lefkoşa',     '5338380264', 'Şht. Kemal Ünal Caddesi, Taşkınköy No:45, Mertopol Yolu, Lefkoşa', NULL),
      ('NELİN ECZANESİ',               'Lefkoşa',     '2281008',    'Gazeteci Kemal Aşık Caddesi, Küçük Kaymaklı No:60, Lefkoşa', NULL),
      ('ÖZVOL ECZANESİ',               'Lefkoşa',     '2232131',    'Şaziye Hacı Maltızlar Cad. No:2/4, Özel Etik Hastanesi yanı, Ortaköy, Lefkoşa', NULL),
      ('İSFENDİYAROĞLU ECZANESİ',      'Lefkoşa',     '5338575354', 'Şht. Hüseyin Amca Caddesi, Gönyeli Mahallesi, Mar 101 No:3, Gönyeli', NULL),
      ('MISRA ÖZBAY ECZANESİ',         'Gazimağusa',  '5488444575', 'Hasan Barbaçolli Sokak, Uzun Apt. No:1, Gazimağusa', NULL),
      ('MEHMET TUT ECZANESİ',          'Alt Mesarya', '5488227670', 'Şht. Ulus Ülfet Sokak No:33, Akdoğan', NULL)
    ),
    norm AS (
      SELECT g.*,
             CASE WHEN raw ~ '^[0-9]{7}$'     THEN '0392' || raw
                  WHEN raw ~ '^[35][0-9]{9}$' THEN '0' || raw END AS digits
        FROM g
    )
    SELECT n.name, n.region, n.raw,
           CASE WHEN n.digits IS NOT NULL THEN
             '(' || substr(n.digits,1,4) || ') ' || substr(n.digits,5,3) || ' '
                 || substr(n.digits,8,2) || ' ' || substr(n.digits,10,2) END AS phone,
           coalesce(n.address,
             (SELECT s.address FROM public.duty_list s
               WHERE s.name = n.earlier AND s.region = n.region
                 AND s.duty_date < '2026-09-28' AND s.phone IS NOT NULL
               ORDER BY s.duty_date DESC LIMIT 1)) AS address,
           (SELECT count(*) FROM public.duty_list d
             WHERE d.name = n.name AND d.duty_date BETWEEN '2026-09-28' AND '2027-09-26') AS rows_in_range,
           (SELECT array_agg(DISTINCT d.region) FROM public.duty_list d
             WHERE d.name = n.name AND d.duty_date BETWEEN '2026-09-28' AND '2027-09-26') AS regions
      FROM norm n
  LOOP
    v_n := v_n + 1;
    a_name := a_name || r.name;       a_region  := a_region  || r.region;
    a_phone := a_phone || r.phone;    a_address := a_address || r.address;
    IF r.phone IS NULL OR r.rows_in_range = 0 OR r.regions IS DISTINCT FROM ARRAY[r.region]
       OR r.address IS NULL THEN
      v_bad := v_bad || format('[%s raw=%s phone=%s rows=%s regions=%s want=%s addr=%s] ',
                               r.name, r.raw, coalesce(r.phone,'?'), r.rows_in_range,
                               coalesce(r.regions::text,'{}'), r.region, coalesce(r.address,'(none)'));
    END IF;
  END LOOP;

  IF v_n IS DISTINCT FROM 19 THEN
    RAISE EXCEPTION 'expected 19 Gazette entries, read %', v_n;
  END IF;
  IF v_bad <> '' THEN
    RAISE EXCEPTION 'precondition failed, nothing changed: %', v_bad;
  END IF;

  -- Preconditions hold for all 19; write exactly the values that were checked.
  FOR i IN 1 .. v_n LOOP
    UPDATE public.duty_list
       SET phone = a_phone[i], address = a_address[i]
     WHERE name = a_name[i] AND region = a_region[i]
       AND duty_date BETWEEN '2026-09-28' AND '2027-09-26'
       AND phone IS NULL;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_updated := v_updated + v_rows;
  END LOOP;

  SELECT count(*) INTO v_after FROM public.duty_list
   WHERE duty_date BETWEEN '2026-09-28' AND '2027-09-26' AND phone IS NULL;

  -- Nothing outside the 19 was touched: the drop in NULLs equals the rows updated.
  IF v_before - v_after IS DISTINCT FROM v_updated THEN
    RAISE EXCEPTION 'NULL-phone count moved by % (% → %) but % rows were updated',
      v_before - v_after, v_before, v_after, v_updated;
  END IF;
  -- And the whole range now has a phone on every row.
  IF v_after IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'still % in-range row(s) without a phone after updating % (was %)', v_after, v_updated, v_before;
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
VALUES ('20261054_duty_roster_phone_variants.sql', '21829c4bf3a296388c7ddda6ed60b03d217968e47e0de73757be8370beae8b5f')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

-- ─── Verification after applying (read-only, run alone) ────────────────────
--   SELECT duty_date, region, name FROM public.duty_list
--    WHERE duty_date BETWEEN '2026-09-28' AND '2027-09-26' AND phone IS NULL
--    ORDER BY 1, 2, 3;
--   -- expect 0 rows
