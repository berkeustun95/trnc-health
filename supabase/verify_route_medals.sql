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
  v_temp  boolean := false;   -- true when the viewer was made listed by THIS script
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

  -- No second listed student in prod yet: make one, TEMPORARILY. A real, named, unbanned,
  -- non-guest account with no block either way with the holder gets a copy of the holder's
  -- own listed enrolment (so every CHECK and the years trigger are already satisfied).
  -- It lives only inside this transaction, which the final RAISE always aborts — as does
  -- any failure before it. Nothing touches the viewer's profiles row.
  IF v_v IS NULL AND is_listed_student(v_u) THEN
    SELECT p.id INTO v_v FROM profiles p JOIN auth.users u ON u.id = p.id
     WHERE NOT coalesce(u.is_anonymous, false) AND p.id <> v_u
       AND p.display_name IS NOT NULL
       AND (p.ugc_banned_until IS NULL OR p.ugc_banned_until <= now())
       AND NOT EXISTS (SELECT 1 FROM blocks b
                        WHERE (b.blocker_id = p.id AND b.blocked_id = v_u)
                           OR (b.blocker_id = v_u AND b.blocked_id = p.id))
     ORDER BY p.id LIMIT 1;
    IF v_v IS NOT NULL THEN
      INSERT INTO student_education (user_id, institution_id, level, subject_id,
                                     study_start_year, study_end_year, listing_opt_in)
      SELECT v_v, e.institution_id, e.level, e.subject_id, e.study_start_year, e.study_end_year, true
        FROM student_education e WHERE e.user_id = v_u AND e.listing_opt_in
       ORDER BY e.id LIMIT 1;
      IF NOT is_listed_student(v_v) THEN
        RAISE EXCEPTION 'VERIFY FAILED: temporary viewer % is not listed after the insert%', v_v, rep;
      END IF;
      v_temp := true;
      rep := rep || format(E'\ntemporary listed viewer %s (rolled back; triggers on student_education: %s)', v_v,
        (SELECT coalesce(string_agg(tgname, ', ' ORDER BY tgname), 'none') FROM pg_trigger
          WHERE tgrelid = 'public.student_education'::regclass AND NOT tgisinternal));
    END IF;
  END IF;
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
      -- A holder listed before 20261056 starts with badges OFF (option b); turn it on here,
      -- inside the transaction this script always rolls back, to test the visible path.
      UPDATE profiles SET route_badges_public = true WHERE id = v_u;
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_v, 'role', 'authenticated', 'is_anonymous', false)::text, true);
      SET LOCAL ROLE authenticated;
      SELECT count(*) INTO v_n FROM get_student_profile(v_u);
      RESET ROLE;
      -- Positive control first: the viewer must see the PROFILE, or 0 badges proves nothing.
      IF v_n = 0 THEN
        RAISE EXCEPTION 'VERIFY FAILED: viewer cannot see the holder''s profile at all — badge checks would be vacuous%', rep;
      END IF;
      SET LOCAL ROLE authenticated;
      SELECT count(*) INTO v_n FROM get_profile_route_badges(v_u) b WHERE b.route_id = v_route;
      RESET ROLE;
      IF v_n IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'VERIFY FAILED: switch ON, viewer sees % badge rows for the route (expected 1)%', v_n, rep;
      END IF;
      rep := rep || E'\n4a profile visible, switch on -> 1 badge row, route id only ✓';
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
    rep := rep || E'\n3-4 SKIPPED: no second listed student, and none could be made (holder not listed, or no eligible account)';
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
