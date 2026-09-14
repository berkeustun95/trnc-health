-- ═══ institutions — eight new rows moved into the order (hand-applied) ═══════════
--
-- ALREADY APPLIED. Run by hand against production on 2026-09-15, Role = postgres. THIS
-- FILE IS THE RECORD, not a proposal: section 2 is the SQL that ran, byte-for-byte, and
-- the BEGIN/COMMIT around it are that run's own. Sections 0, 1, 3 and 4 were written
-- afterwards and did NOT run in production. The ledger row was inserted by hand
-- (applied_by = 'hand-applied 2026-09-15'); it attests that production is in the state
-- this file produces, not that this exact text was pasted.
--
-- One of three files, third and current. They stay three because that is what happened: 19's
-- short names were partly guesses and 20 corrected them.
--   20261018  reconcile to YÖDAK (yodak.gov.ct.tr/universiteler.html, checked 2026-09-15)
--   20261019  short_name + sort_order for the eight new rows
--   20261020  revised both: three guessed short names cleared, rows moved into the order
--
-- ─── WHAT IT DID — everything by id ─────────────────────────────────────────
-- Cleared the three guessed short names 19 set (ALÜ …0010, KBÜ …0014, KSTÜ …0015),
-- keeping ODTÜ KKK (…0016) and İTÜ-KKTC (…0011). Moved the eight rows out of 150–220
-- and into the gaps between the existing universities (10…130), none sharing a value:
--   …0016 45 · …0011 55 · …0015 85 · …0014 95 · …0012 105 · …0013 115 · …0010 125 · …000f 135
-- No existing row touched; Other (…00ff) keeps 999.
--
-- WHO READS sort_order: the profile pickers (ProfileScreen, ProfileSetupScreen —
-- .order('sort_order')). The Student Hub directory does NOT; it orders by name.
--
-- ─── RE-RUN ──────────────────────────────────────────────────────────────────
-- Unlike 18 and 19, this file's recorded SQL IS a no-op against its own end state, which
-- is production today. The guard still refuses to run it out of order: straight after
-- 18 it would leave five lowercase slugs ('adakent', 'metuncc', …) showing as short
-- names, and before 18 every UPDATE matches 0 rows and succeeds silently.
--
-- ─── TWO STATE CHECKS, DIFFERENT LIFETIMES ───────────────────────────────────
--   3. A — what reconcile established. Identical in all three files, true from 18
--      onward, self-contained: paste it alone against production any time.
--   4. B — this file's own end state, which is production as of 2026-09-15. It also
--      asserts what 20 was for: no two active rows share a sort_order, and Other sorts
--      last. Paste sections 0 and 4 together to check production against this file.
--
-- EXECUTION (only ever as a re-run): SQL editor, Role = postgres, the WHOLE FILE. No
-- NOTIFY — nothing here changes the schema.

SET ROLE postgres;

BEGIN;

-- ─── 0. Which recorded state are the eight rows in? ─────────────────────────
-- One classifier, identical in all three files, holding every state the rows have been
-- in: 'absent' (before 18), '1018', '1019', '1020'. Anything else is 'unrecognised'.
-- Compared per column with IS NOT DISTINCT FROM, because six of the eight short_names end
-- up NULL and `NULL = NULL` is not true. Lives in pg_temp: gone when the session ends,
-- and dropped explicitly before COMMIT.
CREATE OR REPLACE FUNCTION pg_temp.institutions_yodak_state() RETURNS text
LANGUAGE sql STABLE AS $fn$
  WITH e(state, id, name, short_name, city, sort_order) AS (VALUES
    ('1018','00000000-0000-4000-b000-00000000000f','Ada Kent Üniversitesi',                          'adakent',  'famagusta',100),
    ('1018','00000000-0000-4000-b000-000000000010','Avrupa Liderlik Üniversitesi',                   'elu',      'famagusta',100),
    ('1018','00000000-0000-4000-b000-000000000011','İTÜ-KKTC Eğitim Araştırma Yerleşkeleri',         'itukktc',  'famagusta',100),
    ('1018','00000000-0000-4000-b000-000000000012','Kıbrıs Amerikan Üniversitesi',                   'auc',      'nicosia',  100),
    ('1018','00000000-0000-4000-b000-000000000013','Kıbrıs Aydın Üniversitesi',                      'cau',      'kyrenia',  100),
    ('1018','00000000-0000-4000-b000-000000000014','Kıbrıs Batı Üniversitesi',                       'cwu',      'famagusta',100),
    ('1018','00000000-0000-4000-b000-000000000015','Kıbrıs Sağlık ve Toplum Bilimleri Üniversitesi', 'kstu',     'morphou',  100),
    ('1018','00000000-0000-4000-b000-000000000016','ODTÜ Kuzey Kıbrıs Kampüsü',                      'metuncc',  'morphou',  100),

    ('1019','00000000-0000-4000-b000-00000000000f','Ada Kent Üniversitesi',                          NULL,       'famagusta',200),
    ('1019','00000000-0000-4000-b000-000000000010','Avrupa Liderlik Üniversitesi',                   'ALÜ',      'famagusta',180),
    ('1019','00000000-0000-4000-b000-000000000011','İTÜ-KKTC Eğitim Araştırma Yerleşkeleri',         'İTÜ-KKTC', 'famagusta',160),
    ('1019','00000000-0000-4000-b000-000000000012','Kıbrıs Amerikan Üniversitesi',                   NULL,       'nicosia',  210),
    ('1019','00000000-0000-4000-b000-000000000013','Kıbrıs Aydın Üniversitesi',                      NULL,       'kyrenia',  220),
    ('1019','00000000-0000-4000-b000-000000000014','Kıbrıs Batı Üniversitesi',                       'KBÜ',      'famagusta',190),
    ('1019','00000000-0000-4000-b000-000000000015','Kıbrıs Sağlık ve Toplum Bilimleri Üniversitesi', 'KSTÜ',     'morphou',  170),
    ('1019','00000000-0000-4000-b000-000000000016','ODTÜ Kuzey Kıbrıs Kampüsü',                      'ODTÜ KKK', 'morphou',  150),

    ('1020','00000000-0000-4000-b000-00000000000f','Ada Kent Üniversitesi',                          NULL,       'famagusta',135),
    ('1020','00000000-0000-4000-b000-000000000010','Avrupa Liderlik Üniversitesi',                   NULL,       'famagusta',125),
    ('1020','00000000-0000-4000-b000-000000000011','İTÜ-KKTC Eğitim Araştırma Yerleşkeleri',         'İTÜ-KKTC', 'famagusta', 55),
    ('1020','00000000-0000-4000-b000-000000000012','Kıbrıs Amerikan Üniversitesi',                   NULL,       'nicosia',  105),
    ('1020','00000000-0000-4000-b000-000000000013','Kıbrıs Aydın Üniversitesi',                      NULL,       'kyrenia',  115),
    ('1020','00000000-0000-4000-b000-000000000014','Kıbrıs Batı Üniversitesi',                       NULL,       'famagusta', 95),
    ('1020','00000000-0000-4000-b000-000000000015','Kıbrıs Sağlık ve Toplum Bilimleri Üniversitesi', NULL,       'morphou',   85),
    ('1020','00000000-0000-4000-b000-000000000016','ODTÜ Kuzey Kıbrıs Kampüsü',                      'ODTÜ KKK', 'morphou',   45)
  ), matched AS (
    SELECT e.state,
           count(*) FILTER (WHERE i.id IS NOT NULL
             AND i.name       IS NOT DISTINCT FROM e.name
             AND i.short_name IS NOT DISTINCT FROM e.short_name
             AND i.city       IS NOT DISTINCT FROM e.city
             AND i.sort_order IS NOT DISTINCT FROM e.sort_order
             AND i.is_active  IS NOT DISTINCT FROM true) AS n
      FROM e LEFT JOIN public.institutions i ON i.id = e.id::uuid
     GROUP BY e.state
  )
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM public.institutions i JOIN e ON i.id = e.id::uuid) THEN 'absent'
    ELSE coalesce((SELECT min(state) FROM matched WHERE n = 8), 'unrecognised')
  END
$fn$;

-- ─── 1. Guard — 19 must have run ────────────────────────────────────────────
DO $$
DECLARE
  r record;
  v_state text := pg_temp.institutions_yodak_state();
BEGIN
  RAISE NOTICE '── the eight rows, before — state: % ──', pg_temp.institutions_yodak_state();
  FOR r IN
    SELECT i.id, i.name, i.short_name, i.city, i.sort_order, i.is_active
      FROM public.institutions i
     WHERE i.id BETWEEN '00000000-0000-4000-b000-00000000000f' AND '00000000-0000-4000-b000-000000000016'
     ORDER BY i.sort_order, i.name
  LOOP
    RAISE NOTICE '  …%  sort=%  short=%  city=%  active=%  %',
      right(r.id::text, 4), r.sort_order, coalesce(r.short_name, 'NULL'), r.city, r.is_active, r.name;
  END LOOP;
  IF v_state IN ('1019', '1020') THEN
    RAISE NOTICE 'state "%" — proceeding', v_state;
    RETURN;
  END IF;
  IF v_state = 'absent' THEN
    RAISE EXCEPTION 'REFUSING: 20261018 has not run — none of the eight rows exist, so every UPDATE here would match 0 rows and succeed silently. Nothing applied.';
  END IF;
  IF v_state = '1018' THEN
    RAISE EXCEPTION 'REFUSING: 20261019 has not run. This file alone would leave five lowercase slugs as short names. Run 20261019 first. Nothing applied.';
  END IF;
  RAISE EXCEPTION 'REFUSING: the eight rows match no recorded state ("%"). Somebody has changed them by hand since 2026-09-15 — read the rows above. Nothing applied.', v_state;
END $$;

-- ─── 2. RECORDED — as run by hand against production, 2026-09-15 (verbatim) ───
UPDATE institutions SET short_name = NULL
WHERE id IN ('00000000-0000-4000-b000-000000000010',
             '00000000-0000-4000-b000-000000000014',
             '00000000-0000-4000-b000-000000000015');

UPDATE institutions SET sort_order =  45 WHERE id = '00000000-0000-4000-b000-000000000016';
UPDATE institutions SET sort_order =  55 WHERE id = '00000000-0000-4000-b000-000000000011';
UPDATE institutions SET sort_order =  85 WHERE id = '00000000-0000-4000-b000-000000000015';
UPDATE institutions SET sort_order =  95 WHERE id = '00000000-0000-4000-b000-000000000014';
UPDATE institutions SET sort_order = 105 WHERE id = '00000000-0000-4000-b000-000000000012';
UPDATE institutions SET sort_order = 115 WHERE id = '00000000-0000-4000-b000-000000000013';
UPDATE institutions SET sort_order = 125 WHERE id = '00000000-0000-4000-b000-000000000010';
UPDATE institutions SET sort_order = 135 WHERE id = '00000000-0000-4000-b000-00000000000f';
-- ─── END RECORDED ───────────────────────────────────────────────────────────

-- ─── 3. State check A — what reconcile established (identical in all three files) ─
-- True from 20261018 onward. SELF-CONTAINED: this block alone can be pasted against
-- production at any time to confirm the reconcile still holds. The total/active counts
-- pin it to 2026-09-15: once the three held universities are added this block fails,
-- correctly — the file is history. Do not edit it; the verify_schema.sql count moves.
DO $$
DECLARE
  v_netkent int;
  v_ilim    boolean;
  v_final   text;
  v_new     int;
  v_total   int;
  v_active  int;
  v_other   int;
BEGIN
  -- Netkent gone. This is also the guard against a 20261001 re-run: that seed is
  -- ON CONFLICT (id) DO NOTHING, so re-running it silently puts Netkent back at 140.
  SELECT count(*) INTO v_netkent FROM public.institutions
   WHERE id = '00000000-0000-4000-b000-00000000000e';
  IF v_netkent IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Netkent (…000e) is present (% row) — was 20261001 re-run? Its seed re-inserts it', v_netkent;
  END IF;

  -- Kıbrıs İlim deactivated, NOT deleted: a profile references it, and the FK is
  -- ON DELETE SET NULL, so a delete would have silently cleared that profile's choice.
  -- A missing row reads NULL here and fails, which is the point.
  SELECT is_active INTO v_ilim FROM public.institutions
   WHERE id = '00000000-0000-4000-b000-000000000006';
  IF v_ilim IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Kıbrıs İlim (…0006) is_active = % — expected false, row present', coalesce(v_ilim::text, '<row missing>');
  END IF;

  SELECT name INTO v_final FROM public.institutions
   WHERE id = '00000000-0000-4000-b000-000000000008';
  IF v_final IS DISTINCT FROM 'Uluslararası Final Üniversitesi' THEN
    RAISE EXCEPTION 'Final (…0008) name = "%" — expected Uluslararası Final Üniversitesi', coalesce(v_final, '<row missing>');
  END IF;

  SELECT count(*) INTO v_new FROM public.institutions
   WHERE id BETWEEN '00000000-0000-4000-b000-00000000000f' AND '00000000-0000-4000-b000-000000000016';
  IF v_new IS DISTINCT FROM 8 THEN
    RAISE EXCEPTION 'expected the 8 ids …000f–…0016, found %', v_new;
  END IF;

  SELECT count(*), count(*) FILTER (WHERE is_active) INTO v_total, v_active FROM public.institutions;
  IF v_total IS DISTINCT FROM 22 OR v_active IS DISTINCT FROM 21 THEN
    RAISE EXCEPTION 'institutions holds % rows / % active — expected 22 / 21 (20 universities + Other, one inactive)', v_total, v_active;
  END IF;

  SELECT sort_order INTO v_other FROM public.institutions
   WHERE id = '00000000-0000-4000-b000-0000000000ff';
  IF v_other IS DISTINCT FROM 999 THEN
    RAISE EXCEPTION 'Other (…00ff) sort_order = % — expected 999', coalesce(v_other::text, '<row missing>');
  END IF;

  RAISE NOTICE 'reconcile holds: Netkent gone, İlim inactive, Final renamed, 8 added, % total / % active, Other at 999',
    v_total, v_active;
END $$;

-- ─── 4. State check B — this file's own end state (production, 2026-09-15) ───
DO $$
DECLARE
  r record;
  v_state text := pg_temp.institutions_yodak_state();
  v_dupes text;
  v_after int;
BEGIN
  RAISE NOTICE '── the eight rows, after — state: % ──', pg_temp.institutions_yodak_state();
  FOR r IN
    SELECT i.id, i.name, i.short_name, i.city, i.sort_order, i.is_active
      FROM public.institutions i
     WHERE i.id BETWEEN '00000000-0000-4000-b000-00000000000f' AND '00000000-0000-4000-b000-000000000016'
     ORDER BY i.sort_order, i.name
  LOOP
    RAISE NOTICE '  …%  sort=%  short=%  city=%  active=%  %',
      right(r.id::text, 4), r.sort_order, coalesce(r.short_name, 'NULL'), r.city, r.is_active, r.name;
  END LOOP;
  IF v_state IS DISTINCT FROM '1020' THEN
    RAISE EXCEPTION 'the eight rows are in state "%" after this file — expected "1020". The rows are printed above', v_state;
  END IF;

  -- What 20 was for: the eight rows moved INTO the existing order instead of under it.
  -- Derived, not listed. No two active rows share a sort_order (the picker order would
  -- then depend on name tie-breaks), and Other still sorts strictly last.
  SELECT string_agg(sort_order || '×' || n, ', ') INTO v_dupes
    FROM (SELECT sort_order, count(*) n FROM public.institutions
           WHERE is_active GROUP BY sort_order HAVING count(*) > 1) d;
  IF v_dupes IS NOT NULL THEN
    RAISE EXCEPTION 'active rows share a sort_order: %', v_dupes;
  END IF;

  SELECT count(*) INTO v_after FROM public.institutions
   WHERE is_active AND id <> '00000000-0000-4000-b000-0000000000ff'
     AND sort_order >= (SELECT sort_order FROM public.institutions
                         WHERE id = '00000000-0000-4000-b000-0000000000ff');
  IF v_after IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '% active row(s) sort at or after Other', v_after;
  END IF;
END $$;

DROP FUNCTION pg_temp.institutions_yodak_state();

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
VALUES ('20261020_institutions_sort_prominence.sql', '7ec72341e1110c6a27f25dfee63a9a9ff94b77b35f172b762a059c9401f98004')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;
