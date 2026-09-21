-- ═══════════════════════════════════════════════════════════════════════════
-- home_strip_pin — shape_check behavioural verification.
-- Supabase SQL editor, Role = postgres. Re-runnable. WRITES NOTHING.
--
-- Wrapped in BEGIN … ROLLBACK, and every row is deleted inside its own block besides,
-- so this can be run against production any day without leaving a trace.
--
-- ─── WHY THIS EXISTS: 20261043's OWN VERIFICATION WAS WEAKER THAN ITS PROSE ─
--
-- That migration is APPLIED and its schema is correct. Its DO block is not, and the gap
-- is the one this repo keeps re-learning:
--
--   • It claimed "all four promo requirements, each named" and "BYTE-FOR-BYTE", and then
--     asserted the promo arm with ONE substring: `link_url IS NOT NULL`. Dropping promo's
--     `title_i18n IS NOT NULL` or `target_id IS NULL` would have passed it silently. A
--     claim in a comment is not a check, and a header that overstates its own check is
--     worse than one that says nothing — it tells the next reader not to look.
--   • It proved promo could still be ACCEPTED and never that an invalid one is REFUSED.
--     A constraint that accepts everything passes that test.
--
-- ⚠ AND THE HEADER IS FACTUALLY WRONG ABOUT ONE THING. It says the promo arm is
--   unchanged, "not one character". It is not: 20261043 ADDED `route IS NULL` to it, so
--   the promo arm was TIGHTENED. Behaviourally that is safe — no promo ever carried a
--   route, the column did not exist — but "unchanged" is false and the applied file is
--   not edited to fix it (amending an applied migration is what the ledger rule forbids).
--   The correction lives here, in verify_schema.sql, and in the journal.
--
-- ─── WHAT A HEALTHY RUN SHOWS ──────────────────────────────────────────────
--   A GRID: one row per case (case / expected / result) plus a VERDICT row at the top.
--   12 rows, verdict "ALL 11 PASS". Nine REJECT cases and two ACCEPT cases, and the two
--   accepts are not decoration: without them a shape_check that refuses EVERYTHING would
--   score a perfect nine.
--
-- ⚠ IT RETURNS A RESULT SET RATHER THAN RAISE NOTICE, AND THAT IS THE WHOLE POINT OF THIS
--   REVISION. The first version printed every result with RAISE NOTICE. The Supabase SQL
--   editor DOES NOT SHOW NOTICES — it reported "Success. No rows returned." So a run with
--   eleven passes and a run with eleven failures looked IDENTICAL. The verdict was
--   invisible, which made the whole file a decoration: the exact failure this repo
--   records over and over, arrived at from a new direction — not a check that cannot go
--   red, but a check whose red nobody can see.
--
--   On failure it ALSO raises after the grid is built, so the editor goes red instead of
--   green. Both, because either alone has a hole: a grid can be skimmed, and an exception
--   alone loses the per-case detail.
--
-- ⚠ NO TEMP TABLE, DELIBERATELY. The obvious shape is CREATE TEMP TABLE … then SELECT
--   from it. That is EXACTLY what killed 20261024 on this database on 2026-09-15: 42P01
--   naming a temp table that had been created moments earlier, on a file that applied
--   cleanly on stock PostgreSQL 15.18 and 17.10 and in PGlite. The cause was never
--   confirmed, which is precisely why it is not worth re-testing in production.
--
--   So the results land in an ORDINARY table created inside the transaction and undone by
--   the ROLLBACK. DDL is transactional in Postgres, so nothing survives; and because no
--   object lives in pg_temp, the failure mode that bit 20261024 cannot apply here at all.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- An ordinary table, created and destroyed inside this transaction. See the note above on
-- why this is not CREATE TEMP TABLE.
CREATE TABLE _hsp_verify (
  seq      int,
  case_    text,
  expected text,
  result   text
);

DO $$
DECLARE
  n_pass int := 0;
  n_fail int := 0;
  v_id   uuid;
  -- A target_id needs to be a uuid and nothing more: the column carries no foreign key,
  -- deliberately, because it is polymorphic across events and places.
  v_uuid uuid := '00000000-0000-4000-8000-0000000000ff';

BEGIN
  -- Each REJECT case is the same shape: run it, and reaching the line after the INSERT
  -- means the row was accepted, which is the failure. check_violation is the ONLY
  -- exception treated as a pass — a not-null violation or a typo'd column name would
  -- otherwise read as success, which is exactly how a broken test looks like a working
  -- one. The ACCEPT cases below catch `others` instead, and print SQLERRM, because there
  -- the interesting information is WHY a legitimate row was refused.

  -- 1. promo WITHOUT sponsor_name
  BEGIN
    INSERT INTO public.home_strip_pin (kind, link_url, title_i18n)
    VALUES ('promo','https://example.com','{"en":"x"}'::jsonb) RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    n_fail := n_fail + 1;
    INSERT INTO _hsp_verify VALUES (1, 'promo without sponsor_name', 'REFUSE', 'FAIL — accepted');
  EXCEPTION WHEN check_violation THEN
    n_pass := n_pass + 1;
    INSERT INTO _hsp_verify VALUES (1, 'promo without sponsor_name', 'REFUSE', 'PASS');
  END;

  -- 2. promo WITHOUT link_url
  BEGIN
    INSERT INTO public.home_strip_pin (kind, sponsor_name, title_i18n)
    VALUES ('promo','A Sponsor','{"en":"x"}'::jsonb) RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    n_fail := n_fail + 1;
    INSERT INTO _hsp_verify VALUES (2, 'promo without link_url', 'REFUSE', 'FAIL — accepted');
  EXCEPTION WHEN check_violation THEN
    n_pass := n_pass + 1;
    INSERT INTO _hsp_verify VALUES (2, 'promo without link_url', 'REFUSE', 'PASS');
  END;

  -- 3. promo WITHOUT title_i18n  ← 20261043's own block could not see this one
  BEGIN
    INSERT INTO public.home_strip_pin (kind, link_url, sponsor_name)
    VALUES ('promo','https://example.com','A Sponsor') RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    n_fail := n_fail + 1;
    INSERT INTO _hsp_verify VALUES (3, 'promo without title_i18n', 'REFUSE', 'FAIL — accepted');
  EXCEPTION WHEN check_violation THEN
    n_pass := n_pass + 1;
    INSERT INTO _hsp_verify VALUES (3, 'promo without title_i18n', 'REFUSE', 'PASS');
  END;

  -- 4. promo WITH a target_id  ← nor this one. A promo with a target row is a sponsored
  --    link wearing editorial clothes, which is 20261007's stated reason for the arm.
  BEGIN
    INSERT INTO public.home_strip_pin (kind, link_url, sponsor_name, title_i18n, target_id)
    VALUES ('promo','https://example.com','A Sponsor','{"en":"x"}'::jsonb, v_uuid)
    RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    n_fail := n_fail + 1;
    INSERT INTO _hsp_verify VALUES (4, 'promo with target_id', 'REFUSE', 'FAIL — accepted');
  EXCEPTION WHEN check_violation THEN
    n_pass := n_pass + 1;
    INSERT INTO _hsp_verify VALUES (4, 'promo with target_id', 'REFUSE', 'PASS');
  END;

  -- 5. promo WITH a route — the clause 20261043 added, which its header calls "unchanged"
  BEGIN
    INSERT INTO public.home_strip_pin (kind, link_url, sponsor_name, title_i18n, route)
    VALUES ('promo','https://example.com','A Sponsor','{"en":"x"}'::jsonb,'accommodation')
    RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    n_fail := n_fail + 1;
    INSERT INTO _hsp_verify VALUES (5, 'promo with route', 'REFUSE', 'FAIL — accepted');
  EXCEPTION WHEN check_violation THEN
    n_pass := n_pass + 1;
    INSERT INTO _hsp_verify VALUES (5, 'promo with route', 'REFUSE', 'PASS');
  END;

  -- 6. event WITH a route
  BEGIN
    INSERT INTO public.home_strip_pin (kind, target_id, route)
    VALUES ('event', v_uuid, 'accommodation') RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    n_fail := n_fail + 1;
    INSERT INTO _hsp_verify VALUES (6, 'event with route', 'REFUSE', 'FAIL — accepted');
  EXCEPTION WHEN check_violation THEN
    n_pass := n_pass + 1;
    INSERT INTO _hsp_verify VALUES (6, 'event with route', 'REFUSE', 'PASS');
  END;

  -- 7. notice WITH sponsor_name — the first-party guarantee
  BEGIN
    INSERT INTO public.home_strip_pin (kind, route, sponsor_name)
    VALUES ('notice','accommodation','Somebody') RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    n_fail := n_fail + 1;
    INSERT INTO _hsp_verify VALUES (7, 'notice with sponsor_name', 'REFUSE', 'FAIL — accepted');
  EXCEPTION WHEN check_violation THEN
    n_pass := n_pass + 1;
    INSERT INTO _hsp_verify VALUES (7, 'notice with sponsor_name', 'REFUSE', 'PASS');
  END;

  -- 8. notice WITH link_url — cannot send a user off-app
  BEGIN
    INSERT INTO public.home_strip_pin (kind, route, link_url)
    VALUES ('notice','accommodation','https://example.com') RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    n_fail := n_fail + 1;
    INSERT INTO _hsp_verify VALUES (8, 'notice with link_url', 'REFUSE', 'FAIL — accepted');
  EXCEPTION WHEN check_violation THEN
    n_pass := n_pass + 1;
    INSERT INTO _hsp_verify VALUES (8, 'notice with link_url', 'REFUSE', 'PASS');
  END;

  -- 9. notice WITH title_i18n — copy must stay in i18n.js where labels:check can see it
  BEGIN
    INSERT INTO public.home_strip_pin (kind, route, title_i18n)
    VALUES ('notice','accommodation','{"en":"x"}'::jsonb) RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    n_fail := n_fail + 1;
    INSERT INTO _hsp_verify VALUES (9, 'notice with title_i18n', 'REFUSE', 'FAIL — accepted');
  EXCEPTION WHEN check_violation THEN
    n_pass := n_pass + 1;
    INSERT INTO _hsp_verify VALUES (9, 'notice with title_i18n', 'REFUSE', 'PASS');
  END;


  -- 10. a well-formed promo still inserts exactly as it did before 20261043
  BEGIN
    INSERT INTO public.home_strip_pin (kind, link_url, sponsor_name, title_i18n)
    VALUES ('promo','https://example.com','A Sponsor','{"en":"x"}'::jsonb)
    RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    n_pass := n_pass + 1;
    INSERT INTO _hsp_verify VALUES (10, 'valid promo', 'ACCEPT', 'PASS');
  EXCEPTION WHEN others THEN
    n_fail := n_fail + 1;
    INSERT INTO _hsp_verify VALUES (10, 'valid promo', 'ACCEPT', 'FAIL — refused: ' || SQLERRM);
  END;

  -- 11. a well-formed notice
  BEGIN
    INSERT INTO public.home_strip_pin (kind, route) VALUES ('notice','accommodation')
    RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    n_pass := n_pass + 1;
    INSERT INTO _hsp_verify VALUES (11, 'valid notice', 'ACCEPT', 'PASS');
  EXCEPTION WHEN others THEN
    n_fail := n_fail + 1;
    INSERT INTO _hsp_verify VALUES (11, 'valid notice', 'ACCEPT', 'FAIL — refused: ' || SQLERRM);
  END;

  -- THE VERDICT ROW, derived from the counters rather than eyeballed off the grid —
  -- seq 0 so it sorts to the top. Same rule as verify_schema.sql QUERY 1: read the top
  -- row, do not count anything by hand.
  INSERT INTO _hsp_verify VALUES (
    0, '════ VERDICT ════', n_pass + n_fail || ' cases',
    CASE WHEN n_fail = 0 THEN 'ALL ' || n_pass || ' PASS'
         ELSE n_fail || ' of ' || (n_pass + n_fail) || ' FAILED ← see rows below' END);
END $$;

-- ─── THE GRID. This is what the editor renders. ─────────────────────────────
SELECT case_ AS "case", expected, result FROM _hsp_verify ORDER BY seq;

-- ─── AND THE RED. ───────────────────────────────────────────────────────────
-- Runs AFTER the grid is built, so a failing run shows an error rather than the green
-- "Success" that made the first version of this file useless. The grid carries the
-- per-case detail; this carries the fact that somebody has to look at it.
DO $$
DECLARE n_bad int;
BEGIN
  SELECT count(*) INTO n_bad FROM _hsp_verify WHERE result LIKE 'FAIL%';
  IF n_bad > 0 THEN
    RAISE EXCEPTION '% of 11 home_strip_pin shape_check cases FAILED — see the grid above', n_bad;
  END IF;
END $$;

DROP TABLE _hsp_verify;
ROLLBACK;
