-- ─── verify_route_medals.sql — behavioural pass for 20261056, against prod ──
--
-- ONE statement that creates nothing (CLAUDE.md: SQL editor scripts). It impersonates real
-- users inside the transaction and ENDS WITH RAISE EXCEPTION, which is both the output
-- channel (RAISE NOTICE is invisible in the editor) and the rollback: no medal, no event,
-- no switch change survives on any path. A healthy run shows RED with "VERIFY OK" on the
-- first line; anything else on the first line is a failure.
--
-- Run: SQL Editor, Role = postgres, whole file, after 20261056.
--
-- What each check would print if the system were PERFECT is written beside it.
DO $$
DECLARE
  v_route uuid;
  v_u     uuid;   -- the medal holder: a real, non-guest profile, preferably a listed student
  v_v     uuid;   -- the viewer: a different real listed student (NULL if there is not one)
  v_day   date;
  v_n     int;
  v_err   text;
  rep     text := '';
BEGIN
  SELECT id INTO v_route FROM walking_routes WHERE is_active ORDER BY sort_order LIMIT 1;
  IF v_route IS NULL THEN RAISE EXCEPTION 'VERIFY FAILED: no active walking route'; END IF;

  SELECT p.id INTO v_u FROM profiles p JOIN auth.users u ON u.id = p.id
   WHERE NOT coalesce(u.is_anonymous, false) AND is_listed_student(p.id)
   ORDER BY p.id LIMIT 1;
  IF v_u IS NULL THEN
    SELECT p.id INTO v_u FROM profiles p JOIN auth.users u ON u.id = p.id
     WHERE NOT coalesce(u.is_anonymous, false) ORDER BY p.id LIMIT 1;
  END IF;
  SELECT p.id INTO v_v FROM profiles p JOIN auth.users u ON u.id = p.id
   WHERE NOT coalesce(u.is_anonymous, false) AND is_listed_student(p.id) AND p.id <> v_u
   ORDER BY p.id LIMIT 1;
  rep := rep || format(E'\nroute=%s holder=%s (listed=%s) viewer=%s', v_route, v_u, is_listed_student(v_u), coalesce(v_v::text, 'none'));

  -- 1. The holder earns. Perfect: today's TRNC date.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  SET LOCAL ROLE authenticated;
  v_day := award_route_medal(v_route);
  SELECT count(*) INTO v_n FROM route_medals WHERE route_id = v_route;   -- as the holder, under RLS
  RESET ROLE;
  IF v_day IS DISTINCT FROM (now() AT TIME ZONE 'Europe/Istanbul')::date THEN
    RAISE EXCEPTION 'VERIFY FAILED: award returned % (expected TRNC today %)%', v_day, (now() AT TIME ZONE 'Europe/Istanbul')::date, rep;
  END IF;
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'VERIFY FAILED: holder reads % own medal rows (expected 1)%', v_n, rep; END IF;
  -- Counted as postgres too: never verify a write from inside a role that might not see it.
  SELECT count(*) INTO v_n FROM route_medals WHERE user_id = v_u AND route_id = v_route;
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'VERIFY FAILED: postgres sees % rows for the holder (expected 1)%', v_n, rep; END IF;
  rep := rep || format(E'\n1 award -> %s, holder reads 1 ✓', v_day);

  -- 2. A client cannot write directly. Perfect: insufficient_privilege.
  v_err := NULL;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO route_medals VALUES (v_u, v_route, '2000-01-01');
    v_err := 'ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN v_err := 'denied';
  END;
  RESET ROLE;
  IF v_err IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'VERIFY FAILED: direct INSERT % %', v_err, rep; END IF;
  rep := rep || E'\n2 direct INSERT denied ✓';

  -- 3. Another user reads none of the table. Perfect: 0.
  IF v_v IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_v, 'role', 'authenticated', 'is_anonymous', false)::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM route_medals WHERE user_id = v_u;
    RESET ROLE;
    IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'VERIFY FAILED: viewer reads % of the holder''s medal rows%', v_n, rep; END IF;
    rep := rep || E'\n3 viewer reads 0 medal rows ✓';

    -- 4. Through the profile path: route id only while the switch is on, zero when off.
    IF is_listed_student(v_u) THEN
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_v, 'role', 'authenticated', 'is_anonymous', false)::text, true);
      SET LOCAL ROLE authenticated;
      SELECT count(*) INTO v_n FROM get_profile_route_badges(v_u) b WHERE b.route_id = v_route;
      RESET ROLE;
      -- Blocked pair or hidden profile would legitimately give 0: say so rather than fail.
      rep := rep || format(E'\n4a viewer sees holder''s badge rows = %s (expect 1 unless blocked/unnamed/banned)', v_n);
      UPDATE profiles SET route_badges_public = false WHERE id = v_u;
      SET LOCAL ROLE authenticated;
      SELECT count(*) INTO v_n FROM get_profile_route_badges(v_u);
      RESET ROLE;
      IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'VERIFY FAILED: switch OFF still shows % badge rows%', v_n, rep; END IF;
      rep := rep || E'\n4b switch off -> 0 ✓';
    ELSE
      rep := rep || E'\n4 SKIPPED: holder is not a listed student';
    END IF;
  ELSE
    rep := rep || E'\n3-4 SKIPPED: no second listed student';
  END IF;

  -- 5. A guest cannot earn. Perfect: AUTH_REQUIRED.
  v_err := NULL;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated', 'is_anonymous', true)::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM award_route_medal(v_route);
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  RESET ROLE;
  IF v_err IS DISTINCT FROM 'AUTH_REQUIRED' THEN RAISE EXCEPTION 'VERIFY FAILED: guest award gave % %', coalesce(v_err, 'NO EXCEPTION'), rep; END IF;
  rep := rep || E'\n5 guest award -> AUTH_REQUIRED ✓';

  -- 6. The anonymous completion event lands and the report suppresses it. Perfect: 1 row
  --    accepted as anon; this route this month is suppressed unless 5+ real ones exist.
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;
  INSERT INTO contact_events (module, entity_id, action, region)
  SELECT 'explore', v_route, 'route_complete', region FROM walking_routes WHERE id = v_route;
  RESET ROLE;
  SELECT count(*) INTO v_n FROM route_completions_monthly
   WHERE route_id = v_route AND month = date_trunc('month', now() AT TIME ZONE 'Europe/Istanbul')::date;
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'VERIFY FAILED: report has % rows for this route/month%', v_n, rep; END IF;
  rep := rep || format(E'\n6 anon event accepted; report row = %s',
    (SELECT format('completions=%s suppressed=%s', coalesce(completions::text, 'NULL'), suppressed)
       FROM route_completions_monthly WHERE route_id = v_route
        AND month = date_trunc('month', now() AT TIME ZONE 'Europe/Istanbul')::date));

  RAISE EXCEPTION 'VERIFY OK (everything above rolled back)%', rep;
END $$;
