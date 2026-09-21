-- ═══════════════════════════════════════════════════════════════════════════
-- home_strip_pin — shape_check behavioural verification.
-- Supabase SQL editor, Role = postgres. Re-runnable. WRITES NOTHING, EVER.
--
-- ⚠ IT ALWAYS ENDS IN A RED ERROR. THAT IS THE REPORT, NOT A FAILURE.
--   Read the first line of the message: "ALL 11 PASS" or "n of 11 FAILED".
--   A healthy run and a broken run both show red; only the text differs.
--
-- ─── WHY IT IS ONE STATEMENT THAT CREATES NOTHING ───────────────────────────
--
-- THE SUPABASE SQL EDITOR CANNOT REFERENCE AN OBJECT CREATED EARLIER IN THE SAME
-- SCRIPT. Two incidents, and the second one killed the previous version of this file:
--
--   2026-09-15  20261024 created TEMP tables as top-level statements, used them in a DO
--               block, and died on this database with 42P01 — while applying cleanly on
--               stock PostgreSQL 15.18, 17.10 and PGlite.
--   2026-09-21  this file created an ORDINARY table inside BEGIN … ROLLBACK and died the
--               same way: `ERROR: 42P01: relation "_hsp_verify" does not exist`.
--
-- The first incident was recorded as a pg_temp problem and this file was written to
-- sidestep it with a normal table. THAT THEORY WAS WRONG, and the second incident is
-- what proves it: the schema of the object never mattered. The mechanism is still
-- unconfirmed — a pooler or the editor not keeping the script on one connection or in
-- one transaction would both explain it — and it is not worth confirming in production.
-- The RULE is what carries: a script for that editor must not reference anything it
-- created.
--
-- So: ONE statement. No CREATE of any kind. Results accumulate in a text variable and
-- come out as the exception message, which is the only channel the editor reliably
-- shows — RAISE NOTICE is invisible there, which is what made the version before last
-- a decoration ("Success. No rows returned." whether all eleven passed or all eleven
-- failed).
--
-- ⚠ AND THE ABORT IS THE ROLLBACK. Because it always raises, every row written by the
--   ACCEPT cases is undone by the same mechanism that prints the report. There is no
--   path on which this file leaves a row behind, including one where somebody runs only
--   half of it.
--
-- ─── WHY THIS EXISTS AT ALL: 20261043's VERIFICATION WAS WEAKER THAN ITS PROSE ─
--
-- That migration is APPLIED and its schema is correct. Its DO block is not:
--   • it claimed "all four promo requirements, each named" and "BYTE-FOR-BYTE", then
--     asserted the promo arm with ONE substring, `link_url IS NOT NULL`. Dropping
--     promo's `title_i18n IS NOT NULL` or `target_id IS NULL` would have passed it.
--   • it proved a promo could still be ACCEPTED, never that an invalid one is REFUSED.
--     A constraint that accepts everything passes that test.
--   • its header says the promo arm is unchanged, "not one character". It is not:
--     20261043 ADDED `route IS NULL` to it. Safe — no promo ever carried a route, the
--     column did not exist — but "unchanged" is false. The applied file is NOT edited;
--     amending an applied migration is what the ledger rule forbids.
--
-- Nine REJECT cases and two ACCEPT cases. The accepts are not decoration: without them a
-- shape_check that refuses EVERYTHING would score a perfect nine.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  n_pass  int  := 0;
  n_fail  int  := 0;
  report  text := '';
  v_id    uuid;
  -- target_id needs to be a uuid and nothing more: the column carries no foreign key,
  -- deliberately, because it is polymorphic across events and places.
  v_uuid  uuid := '00000000-0000-4000-8000-0000000000ff';

  -- Each REJECT case has the same shape: reaching the line after the INSERT means the row
  -- was ACCEPTED, which is the failure. check_violation is the ONLY exception counted as
  -- a pass — a not-null violation or a typo'd column name would otherwise read as
  -- success, which is exactly how a broken test looks like a working one. The ACCEPT
  -- cases catch `others` and report SQLERRM, because there the useful information is WHY
  -- a legitimate row was refused.
BEGIN
  -- 1. promo WITHOUT sponsor_name
  BEGIN
    INSERT INTO public.home_strip_pin (kind, link_url, title_i18n)
    VALUES ('promo','https://example.com','{"en":"x"}'::jsonb) RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    n_fail := n_fail + 1; report := report || E'\n  FAIL  1  promo without sponsor_name — ACCEPTED';
  EXCEPTION WHEN check_violation THEN
    n_pass := n_pass + 1; report := report || E'\n  pass  1  promo without sponsor_name';
  END;

  -- 2. promo WITHOUT link_url
  BEGIN
    INSERT INTO public.home_strip_pin (kind, sponsor_name, title_i18n)
    VALUES ('promo','A Sponsor','{"en":"x"}'::jsonb) RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    n_fail := n_fail + 1; report := report || E'\n  FAIL  2  promo without link_url — ACCEPTED';
  EXCEPTION WHEN check_violation THEN
    n_pass := n_pass + 1; report := report || E'\n  pass  2  promo without link_url';
  END;

  -- 3. promo WITHOUT title_i18n  ← 20261043's own block could not see this one
  BEGIN
    INSERT INTO public.home_strip_pin (kind, link_url, sponsor_name)
    VALUES ('promo','https://example.com','A Sponsor') RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    n_fail := n_fail + 1; report := report || E'\n  FAIL  3  promo without title_i18n — ACCEPTED';
  EXCEPTION WHEN check_violation THEN
    n_pass := n_pass + 1; report := report || E'\n  pass  3  promo without title_i18n';
  END;

  -- 4. promo WITH a target_id  ← nor this one
  BEGIN
    INSERT INTO public.home_strip_pin (kind, link_url, sponsor_name, title_i18n, target_id)
    VALUES ('promo','https://example.com','A Sponsor','{"en":"x"}'::jsonb, v_uuid)
    RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    n_fail := n_fail + 1; report := report || E'\n  FAIL  4  promo with target_id — ACCEPTED';
  EXCEPTION WHEN check_violation THEN
    n_pass := n_pass + 1; report := report || E'\n  pass  4  promo with target_id';
  END;

  -- 5. promo WITH a route — the clause 20261043 added while calling the arm "unchanged"
  BEGIN
    INSERT INTO public.home_strip_pin (kind, link_url, sponsor_name, title_i18n, route)
    VALUES ('promo','https://example.com','A Sponsor','{"en":"x"}'::jsonb,'accommodation')
    RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    n_fail := n_fail + 1; report := report || E'\n  FAIL  5  promo with route — ACCEPTED';
  EXCEPTION WHEN check_violation THEN
    n_pass := n_pass + 1; report := report || E'\n  pass  5  promo with route';
  END;

  -- 6. event WITH a route
  BEGIN
    INSERT INTO public.home_strip_pin (kind, target_id, route)
    VALUES ('event', v_uuid, 'accommodation') RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    n_fail := n_fail + 1; report := report || E'\n  FAIL  6  event with route — ACCEPTED';
  EXCEPTION WHEN check_violation THEN
    n_pass := n_pass + 1; report := report || E'\n  pass  6  event with route';
  END;

  -- 7. notice WITH sponsor_name — the first-party guarantee
  BEGIN
    INSERT INTO public.home_strip_pin (kind, route, sponsor_name)
    VALUES ('notice','accommodation','Somebody') RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    n_fail := n_fail + 1; report := report || E'\n  FAIL  7  notice with sponsor_name — ACCEPTED';
  EXCEPTION WHEN check_violation THEN
    n_pass := n_pass + 1; report := report || E'\n  pass  7  notice with sponsor_name';
  END;

  -- 8. notice WITH link_url — cannot send a user off-app
  BEGIN
    INSERT INTO public.home_strip_pin (kind, route, link_url)
    VALUES ('notice','accommodation','https://example.com') RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    n_fail := n_fail + 1; report := report || E'\n  FAIL  8  notice with link_url — ACCEPTED';
  EXCEPTION WHEN check_violation THEN
    n_pass := n_pass + 1; report := report || E'\n  pass  8  notice with link_url';
  END;

  -- 9. notice WITH title_i18n — copy stays in i18n.js where labels:check can see it
  BEGIN
    INSERT INTO public.home_strip_pin (kind, route, title_i18n)
    VALUES ('notice','accommodation','{"en":"x"}'::jsonb) RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    n_fail := n_fail + 1; report := report || E'\n  FAIL  9  notice with title_i18n — ACCEPTED';
  EXCEPTION WHEN check_violation THEN
    n_pass := n_pass + 1; report := report || E'\n  pass  9  notice with title_i18n';
  END;

  -- 10. a well-formed promo still inserts exactly as it did before 20261043
  BEGIN
    INSERT INTO public.home_strip_pin (kind, link_url, sponsor_name, title_i18n)
    VALUES ('promo','https://example.com','A Sponsor','{"en":"x"}'::jsonb)
    RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    n_pass := n_pass + 1; report := report || E'\n  pass 10  valid promo accepted';
  EXCEPTION WHEN others THEN
    n_fail := n_fail + 1; report := report || E'\n  FAIL 10  valid promo REFUSED: ' || SQLERRM;
  END;

  -- 11. a well-formed notice
  BEGIN
    INSERT INTO public.home_strip_pin (kind, route) VALUES ('notice','accommodation')
    RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    n_pass := n_pass + 1; report := report || E'\n  pass 11  valid notice accepted';
  EXCEPTION WHEN others THEN
    n_fail := n_fail + 1; report := report || E'\n  FAIL 11  valid notice REFUSED: ' || SQLERRM;
  END;

  -- THE VERDICT IS THE FIRST LINE, derived from the counters rather than counted off the
  -- list by eye. Same rule as verify_schema.sql QUERY 1: read the top line.
  IF n_fail = 0 THEN
    RAISE EXCEPTION E'ALL % PASS — this error IS the report, the schema is healthy.%',
      n_pass, report;
  ELSE
    RAISE EXCEPTION E'% of % FAILED ← look at the FAIL lines.%',
      n_fail, n_pass + n_fail, report;
  END IF;
END $$;
