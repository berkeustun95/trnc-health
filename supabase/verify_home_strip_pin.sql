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
-- ─── WHAT A HEALTHY RUN PRINTS ─────────────────────────────────────────────
--   11 cases, "ALL 11 PASS". Nine REJECT cases and two ACCEPT cases, and the two accepts
--   are not decoration: without them a shape_check that refuses EVERYTHING would score a
--   perfect nine.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

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
  RAISE NOTICE '── REJECT cases (each must raise check_violation) ──';

  -- 1. promo WITHOUT sponsor_name
  BEGIN
    INSERT INTO public.home_strip_pin (kind, link_url, title_i18n)
    VALUES ('promo','https://example.com','{"en":"x"}'::jsonb) RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    n_fail := n_fail + 1; RAISE NOTICE 'FAIL  promo without sponsor_name — ACCEPTED';
  EXCEPTION WHEN check_violation THEN
    n_pass := n_pass + 1; RAISE NOTICE 'PASS  promo without sponsor_name — refused';
  END;

  -- 2. promo WITHOUT link_url
  BEGIN
    INSERT INTO public.home_strip_pin (kind, sponsor_name, title_i18n)
    VALUES ('promo','A Sponsor','{"en":"x"}'::jsonb) RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    n_fail := n_fail + 1; RAISE NOTICE 'FAIL  promo without link_url — ACCEPTED';
  EXCEPTION WHEN check_violation THEN
    n_pass := n_pass + 1; RAISE NOTICE 'PASS  promo without link_url — refused';
  END;

  -- 3. promo WITHOUT title_i18n  ← 20261043's own block could not see this one
  BEGIN
    INSERT INTO public.home_strip_pin (kind, link_url, sponsor_name)
    VALUES ('promo','https://example.com','A Sponsor') RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    n_fail := n_fail + 1; RAISE NOTICE 'FAIL  promo without title_i18n — ACCEPTED';
  EXCEPTION WHEN check_violation THEN
    n_pass := n_pass + 1; RAISE NOTICE 'PASS  promo without title_i18n — refused';
  END;

  -- 4. promo WITH a target_id  ← nor this one. A promo with a target row is a sponsored
  --    link wearing editorial clothes, which is 20261007's stated reason for the arm.
  BEGIN
    INSERT INTO public.home_strip_pin (kind, link_url, sponsor_name, title_i18n, target_id)
    VALUES ('promo','https://example.com','A Sponsor','{"en":"x"}'::jsonb, v_uuid)
    RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    n_fail := n_fail + 1; RAISE NOTICE 'FAIL  promo with target_id — ACCEPTED';
  EXCEPTION WHEN check_violation THEN
    n_pass := n_pass + 1; RAISE NOTICE 'PASS  promo with target_id — refused';
  END;

  -- 5. promo WITH a route — the clause 20261043 added, which its header calls "unchanged"
  BEGIN
    INSERT INTO public.home_strip_pin (kind, link_url, sponsor_name, title_i18n, route)
    VALUES ('promo','https://example.com','A Sponsor','{"en":"x"}'::jsonb,'accommodation')
    RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    n_fail := n_fail + 1; RAISE NOTICE 'FAIL  promo with route — ACCEPTED';
  EXCEPTION WHEN check_violation THEN
    n_pass := n_pass + 1; RAISE NOTICE 'PASS  promo with route — refused';
  END;

  -- 6. event WITH a route
  BEGIN
    INSERT INTO public.home_strip_pin (kind, target_id, route)
    VALUES ('event', v_uuid, 'accommodation') RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    n_fail := n_fail + 1; RAISE NOTICE 'FAIL  event with route — ACCEPTED';
  EXCEPTION WHEN check_violation THEN
    n_pass := n_pass + 1; RAISE NOTICE 'PASS  event with route — refused';
  END;

  -- 7. notice WITH sponsor_name — the first-party guarantee
  BEGIN
    INSERT INTO public.home_strip_pin (kind, route, sponsor_name)
    VALUES ('notice','accommodation','Somebody') RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    n_fail := n_fail + 1; RAISE NOTICE 'FAIL  notice with sponsor_name — ACCEPTED';
  EXCEPTION WHEN check_violation THEN
    n_pass := n_pass + 1; RAISE NOTICE 'PASS  notice with sponsor_name — refused';
  END;

  -- 8. notice WITH link_url — cannot send a user off-app
  BEGIN
    INSERT INTO public.home_strip_pin (kind, route, link_url)
    VALUES ('notice','accommodation','https://example.com') RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    n_fail := n_fail + 1; RAISE NOTICE 'FAIL  notice with link_url — ACCEPTED';
  EXCEPTION WHEN check_violation THEN
    n_pass := n_pass + 1; RAISE NOTICE 'PASS  notice with link_url — refused';
  END;

  -- 9. notice WITH title_i18n — copy must stay in i18n.js where labels:check can see it
  BEGIN
    INSERT INTO public.home_strip_pin (kind, route, title_i18n)
    VALUES ('notice','accommodation','{"en":"x"}'::jsonb) RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    n_fail := n_fail + 1; RAISE NOTICE 'FAIL  notice with title_i18n — ACCEPTED';
  EXCEPTION WHEN check_violation THEN
    n_pass := n_pass + 1; RAISE NOTICE 'PASS  notice with title_i18n — refused';
  END;

  RAISE NOTICE '';
  RAISE NOTICE '── ACCEPT cases (without these, a constraint that refuses EVERYTHING scores 9/9) ──';

  -- 10. a well-formed promo still inserts exactly as it did before 20261043
  BEGIN
    INSERT INTO public.home_strip_pin (kind, link_url, sponsor_name, title_i18n)
    VALUES ('promo','https://example.com','A Sponsor','{"en":"x"}'::jsonb)
    RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    n_pass := n_pass + 1; RAISE NOTICE 'PASS  valid promo — accepted';
  EXCEPTION WHEN others THEN
    n_fail := n_fail + 1; RAISE NOTICE 'FAIL  valid promo — REFUSED: %', SQLERRM;
  END;

  -- 11. a well-formed notice
  BEGIN
    INSERT INTO public.home_strip_pin (kind, route) VALUES ('notice','accommodation')
    RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    n_pass := n_pass + 1; RAISE NOTICE 'PASS  valid notice — accepted';
  EXCEPTION WHEN others THEN
    n_fail := n_fail + 1; RAISE NOTICE 'FAIL  valid notice — REFUSED: %', SQLERRM;
  END;

  RAISE NOTICE '';
  IF n_fail = 0 THEN
    RAISE NOTICE '════ ALL % PASS ════', n_pass;
  ELSE
    RAISE EXCEPTION '════ % of % FAILED — see the FAIL lines above ════', n_fail, n_pass + n_fail;
  END IF;
END $$;

ROLLBACK;
