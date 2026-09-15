-- ═══ institutions — the three held universities added (hand-applied) ═══════════════
--
-- ALREADY APPLIED. Run by hand against production on 2026-09-15, Role = postgres. THIS
-- FILE IS THE RECORD, not a proposal: section 2 is the SQL that ran, byte-for-byte, and
-- the BEGIN/COMMIT around it are that run's own. Sections 1 and 3 were written afterwards
-- and did NOT run in production.
--
-- 20261018 held these three back pending verification. All three were verified against
-- YÖDAK's current list on 2026-09-15 (owner's check):
--   …0017  Ankara Sosyal Bilimler Üniversitesi   a Turkish state university's campus.
--          city NULL DELIBERATELY: the district is unconfirmed, and a guessed region is
--          worse than none. Not an oversight — do not "fill it in" without a source.
--   …0018  Altınbaş Kıbrıs Üniversitesi   formerly World Peace University (hence
--          wpu.edu.tr); Şht. Kemal Ali Ömer Sk, Yenişehir, Nicosia.
--   …0019  Uluslararası Alasia Üniversitesi   founded 2019 by the Özok family; campus
--          Aşağı Dikmen, Lefkoşa. city 'nicosia' as the owner recorded it. Note that
--          constants/regions.js treats Dikmen as Girne district (south of the ridge),
--          while constants/dorms.js files the Özok family's Alasia Dorm, same address
--          area, under 'nicosia'. The repo disagrees with itself; this row follows dorms.js.
-- sort_order places them into existing gaps, sharing no value with an active row:
-- 65 (between İlim 60, inactive, and ARUCAD 70), 140 and 145 (after Ada Kent 135).
-- 140 was Netkent's slot; see supabase/recovery_institutions_netkent.sql if it returns.
-- Spelling: "Alasia", as the row holds it. 20261018's header says "Alasya" and cannot be
-- corrected without changing its checksum.
--
-- ─── THE COUNT MOVED: 20261018 / 19 / 20 NOW FAIL THEIR STATE CHECK A, CORRECTLY ───
-- Production is 25 total / 24 active. Section 3 of each of the three reconcile files pins
-- 22 / 21 and will fail from now on. That is the intended outcome — those files are
-- historical records, and each already says so above its section 3. They are NOT edited:
-- their ledger rows carry their current checksums. The live count is verify_schema.sql's
-- institutions count token, bumped in the same commit as this file.
--
-- ─── RE-RUN ──────────────────────────────────────────────────────────────────
-- Against production today, a no-op: ON CONFLICT (id) DO UPDATE rewrites four columns
-- with the values they already hold. That stops being true the moment any of these rows
-- is edited — confirming ASBÜ's district, say — because a re-run would then silently put
-- the old value back (20261018's hazard, one revision later). Section 1 refuses in that
-- case instead of relying on anyone remembering this paragraph.
--
-- EXECUTION (only ever as a re-run): SQL editor, Role = postgres, the WHOLE FILE. No
-- NOTIFY — nothing here changes the schema.

SET ROLE postgres;

BEGIN;

-- ─── 1. Guard — refuse a re-run that would undo a later edit ────────────────
-- Each of the three ids must be either absent or exactly as this file leaves it, in the
-- four columns the statement writes. IS DISTINCT FROM throughout: short_name is NULL on
-- all three and city on one, and `NULL <> NULL` would read as "no change".
DO $$
DECLARE
  v_changed text;
BEGIN
  SELECT string_agg(format('…%s name="%s" short_name=%s city=%s sort_order=%s',
                           right(i.id::text, 4), i.name, coalesce(i.short_name, 'NULL'),
                           coalesce(i.city, 'NULL'), i.sort_order), '; ' ORDER BY i.id)
    INTO v_changed
    FROM (VALUES
    ('00000000-0000-4000-b000-000000000017'::uuid, 'Ankara Sosyal Bilimler Üniversitesi', NULL::text, NULL::text,  65),
    ('00000000-0000-4000-b000-000000000018'::uuid, 'Altınbaş Kıbrıs Üniversitesi',        NULL,       'nicosia', 140),
    ('00000000-0000-4000-b000-000000000019'::uuid, 'Uluslararası Alasia Üniversitesi',    NULL,       'nicosia', 145)
  ) AS e(id, name, short_name, city, sort_order)
    JOIN public.institutions i ON i.id = e.id
   WHERE i.name       IS DISTINCT FROM e.name
      OR i.short_name IS DISTINCT FROM e.short_name
      OR i.city       IS DISTINCT FROM e.city
      OR i.sort_order IS DISTINCT FROM e.sort_order;
  IF v_changed IS NOT NULL THEN
    RAISE EXCEPTION 'REFUSING: edited since 2026-09-15 — re-running would revert: %. Nothing applied.', v_changed;
  END IF;
END $$;

-- ─── 2. RECORDED — as run by hand against production, 2026-09-15 (verbatim) ───
INSERT INTO institutions (id, name, short_name, city, sort_order) VALUES
  ('00000000-0000-4000-b000-000000000017', 'Ankara Sosyal Bilimler Üniversitesi', NULL, NULL,       65),
  ('00000000-0000-4000-b000-000000000018', 'Altınbaş Kıbrıs Üniversitesi',        NULL, 'nicosia', 140),
  ('00000000-0000-4000-b000-000000000019', 'Uluslararası Alasia Üniversitesi',    NULL, 'nicosia', 145)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, short_name = EXCLUDED.short_name,
      city = EXCLUDED.city, sort_order = EXCLUDED.sort_order;
-- ─── END RECORDED ───────────────────────────────────────────────────────────

-- ─── 3. State check — this file's end state (production, 2026-09-15) ─────────
-- The three rows, the counts, and what the sort_order values were chosen for. The counts
-- pin this block to today, exactly as 20261018's did: it will fail once institutions
-- changes again, and that is correct.
DO $$
DECLARE
  v_rows    text;
  v_match   int;
  v_total   int;
  v_active  int;
  v_netkent int;
  v_dupes   text;
  v_after   int;
BEGIN
  SELECT string_agg(format('…%s sort=%s short=%s city=%s active=%s %s',
                           right(i.id::text, 4), i.sort_order, coalesce(i.short_name, 'NULL'),
                           coalesce(i.city, 'NULL'), i.is_active, i.name), ' | ' ORDER BY i.sort_order)
    INTO v_rows
    FROM public.institutions i
   WHERE i.id BETWEEN '00000000-0000-4000-b000-000000000017' AND '00000000-0000-4000-b000-000000000019';
  RAISE NOTICE 'the three rows: %', coalesce(v_rows, '<none>');

  SELECT count(*) INTO v_match
    FROM (VALUES
    ('00000000-0000-4000-b000-000000000017'::uuid, 'Ankara Sosyal Bilimler Üniversitesi', NULL::text, NULL::text,  65),
    ('00000000-0000-4000-b000-000000000018'::uuid, 'Altınbaş Kıbrıs Üniversitesi',        NULL,       'nicosia', 140),
    ('00000000-0000-4000-b000-000000000019'::uuid, 'Uluslararası Alasia Üniversitesi',    NULL,       'nicosia', 145)
  ) AS e(id, name, short_name, city, sort_order)
    JOIN public.institutions i ON i.id = e.id
   WHERE i.name       IS NOT DISTINCT FROM e.name
     AND i.short_name IS NOT DISTINCT FROM e.short_name
     AND i.city       IS NOT DISTINCT FROM e.city
     AND i.sort_order IS NOT DISTINCT FROM e.sort_order
     AND i.is_active  IS NOT DISTINCT FROM true;
  IF v_match IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'expected all 3 rows as recorded and active, % match. Rows: %', v_match, coalesce(v_rows, '<none>');
  END IF;

  SELECT count(*) INTO v_netkent FROM public.institutions
   WHERE id = '00000000-0000-4000-b000-00000000000e';
  IF v_netkent IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Netkent (…000e) is present — was 20261001 re-run? See supabase/recovery_institutions_netkent.sql';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE is_active) INTO v_total, v_active FROM public.institutions;
  IF v_total IS DISTINCT FROM 25 OR v_active IS DISTINCT FROM 24 THEN
    RAISE EXCEPTION 'institutions holds % rows / % active — expected 25 / 24 (24 universities + Other; İlim inactive)', v_total, v_active;
  END IF;

  -- Derived, not listed: no two active rows share a sort_order, and Other sorts last.
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

  RAISE NOTICE 'held three added: % total / % active, no shared active sort_order, Other last', v_total, v_active;
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
VALUES ('20261021_institutions_held_three.sql', 'b0cbfebd7f7a1fc8030d98a634cc56d278136b6f9663306082f732dd8c82699a')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;
