-- ═══ institutions — reconcile to YÖDAK's list (hand-applied) ═════════════════
--
-- ALREADY APPLIED. Run by hand against production on 2026-09-15, Role = postgres. THIS
-- FILE IS THE RECORD, not a proposal: section 2 is the SQL that ran, byte-for-byte, and
-- the BEGIN/COMMIT around it are that run's own. Sections 0, 1, 3 and 4 were written
-- afterwards and did NOT run in production. The ledger row was inserted by hand
-- (applied_by = 'hand-applied 2026-09-15'); it attests that production is in the state
-- this file produces, not that this exact text was pasted.
--
-- One of three files, first. They stay three because that is what happened: 19's
-- short names were partly guesses and 20 corrected them.
--   20261018  reconcile to YÖDAK (yodak.gov.ct.tr/universiteler.html, checked 2026-09-15)
--   20261019  short_name + sort_order for the eight new rows
--   20261020  revised both: three guessed short names cleared, rows moved into the order
--
-- ─── WHAT IT DID — everything by id ─────────────────────────────────────────
--   …000e  Netkent Akdeniz Araştırma ve Bilim Üniversitesi   DELETED — not on YÖDAK's
--          list; 0 profiles referenced it (owner's count). That count matters: the FK is
--          ON DELETE SET NULL, so a delete clears a referencing profile's institution
--          without an error.
--   …0006  Kıbrıs İlim Üniversitesi   is_active = false — not on the current list, but
--          1 profile references it, so deactivated rather than deleted. The pickers
--          (ProfileScreen, ProfileSetupScreen) filter is_active, so that profile's
--          Institution field now renders the search placeholder instead of a name.
--   …0008  'Final Uluslararası Üniversitesi' renamed 'Uluslararası Final Üniversitesi'
--          (YÖDAK's wording).
--   …000f–…0016  eight universities added. city is the region slug of each branch's
--          district (lefkosa→nicosia, gazimagusa→famagusta, girne→kyrenia,
--          guzelyurt→morphou). short_name here is a lowercase slug and sort_order is
--          the column DEFAULT (100); both are replaced by 19 and again by 20.
-- No other existing row was touched. Other (…00ff) keeps 999.
--
-- HELD, not added — all three are on YÖDAK's list, pending verification: Altınbaş
-- Kıbrıs, Ankara Sosyal Bilimler, Uluslararası Alasya. Adding them moves the 22/21
-- counts; bump the verify_schema.sql token in the same commit.
--
-- ─── WHY SECTIONS 0 AND 1 EXIST: THE RECORDED SQL IS NOT SAFE TO RE-RUN ──────
-- Re-running this file after 19 or 20 is NOT a no-op. Its ON CONFLICT (id) DO UPDATE
-- rewrites short_name on all eight rows back to the slugs ('metuncc', 'itukktc', …),
-- undoing 19 and 20 — while leaving sort_order alone, so the damage is half a state
-- that matches no file. The DELETE, the deactivation and the rename are idempotent.
-- Section 1 turns that into a refusal: it reads the eight rows, decides which recorded
-- state they are in (section 0), and aborts — before any statement runs — unless they
-- are in this file's predecessor state or its own end state. From its own end state a
-- re-run changes nothing. Keyed on the TABLE, not the ledger: the ledger rows were
-- inserted by hand after the fact, and a guard that trusts them is only as good as the
-- memory of whoever typed them.
--
-- ─── TWO STATE CHECKS, DIFFERENT LIFETIMES ───────────────────────────────────
--   3. A — what reconcile established. Identical in all three files, true from 18
--      onward, self-contained: paste it alone against production any time.
--   4. B — this file's own end state. True only until the next file runs.
--
-- ─── IF NETKENT COMES BACK ───────────────────────────────────────────────────
-- 20261001's seed is ON CONFLICT (id) DO NOTHING, so re-running 20261001 re-inserts
-- Netkent at sort_order 140 (and nothing else it seeded changes). Section 3 fails on it
-- and so does the verify_schema.sql token. This whole file will refuse to run by then —
-- section 1 sees the eight rows already in 20's state — so the fix is to run section 2's
-- DELETE statement ALONE.
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

-- ─── 1. Guard — refuse a re-run that would undo 19 or 20 ────────────────────
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
  IF v_state IN ('absent', '1018') THEN
    RAISE NOTICE 'state "%" — proceeding', v_state;
    RETURN;
  END IF;
  IF v_state IN ('1019', '1020') THEN
    RAISE EXCEPTION 'REFUSING: the eight rows are already in 2026%''s state. Re-running this file would reset their short_name to the lowercase slugs and undo 20261019/20261020. Nothing applied. (If Netkent is back, run only the DELETE from section 2.)', v_state;
  END IF;
  RAISE EXCEPTION 'REFUSING: the eight rows match no recorded state ("%"). Somebody has changed them by hand since 2026-09-15 — read the rows above. Nothing applied.', v_state;
END $$;

-- ─── 2. RECORDED — as run by hand against production, 2026-09-15 (verbatim) ───
DELETE FROM institutions
WHERE id = '00000000-0000-4000-b000-00000000000e';

UPDATE institutions SET is_active = false
WHERE id = '00000000-0000-4000-b000-000000000006';

UPDATE institutions SET name = 'Uluslararası Final Üniversitesi'
WHERE id = '00000000-0000-4000-b000-000000000008';

INSERT INTO institutions (id, name, short_name, city) VALUES
  ('00000000-0000-4000-b000-00000000000f', 'Ada Kent Üniversitesi',                          'adakent', 'famagusta'),
  ('00000000-0000-4000-b000-000000000010', 'Avrupa Liderlik Üniversitesi',                   'elu',     'famagusta'),
  ('00000000-0000-4000-b000-000000000011', 'İTÜ-KKTC Eğitim Araştırma Yerleşkeleri',         'itukktc', 'famagusta'),
  ('00000000-0000-4000-b000-000000000012', 'Kıbrıs Amerikan Üniversitesi',                   'auc',     'nicosia'),
  ('00000000-0000-4000-b000-000000000013', 'Kıbrıs Aydın Üniversitesi',                      'cau',     'kyrenia'),
  ('00000000-0000-4000-b000-000000000014', 'Kıbrıs Batı Üniversitesi',                       'cwu',     'famagusta'),
  ('00000000-0000-4000-b000-000000000015', 'Kıbrıs Sağlık ve Toplum Bilimleri Üniversitesi', 'kstu',    'morphou'),
  ('00000000-0000-4000-b000-000000000016', 'ODTÜ Kuzey Kıbrıs Kampüsü',                      'metuncc', 'morphou')
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      short_name = EXCLUDED.short_name,
      city = EXCLUDED.city;
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

-- ─── 4. State check B — this file's own end state (true until 20261019 runs) ─
DO $$
DECLARE
  r record;
  v_state text := pg_temp.institutions_yodak_state();
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
  IF v_state IS DISTINCT FROM '1018' THEN
    RAISE EXCEPTION 'the eight rows are in state "%" after this file — expected "1018". The rows are printed above', v_state;
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
VALUES ('20261018_institutions_yodak_reconcile.sql', '7a891400ccd011cd44a40cfaaec1fbfebc683271b8d94d15dcb63b12fe9f05ac')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;
