-- ════════════════════════════════════════════════════════════════════════════
-- 20261238 — weekend digest goes out 3 minutes past the half hour: Friday 17:03 (not 17:00), and waits 60 s for the reply
-- ════════════════════════════════════════════════════════════════════════════
--
-- WHAT. The cron job 'weekend-digest' ticks at :03 and :33 on UTC Fridays and Saturdays ('3,33 * * * 5,6') instead of :00 and :30
-- ('0,30 * * * 5,6'), and its net.http_post gains 'timeout_milliseconds := 60000' (pg_net's default is 5 s: the digest POST answered
-- at 17:00:09 on 20 Nov, so pg_net never saw the real reply). Nothing else changes: same Edge Function, same Vault key, same
-- body, same gate, same once-a-week rule. Berke gave the BUILD go on 25 Nov for exactly this (schedule + 60 s timeout).
--
-- WHY. Off the top of the hour, away from the duty push's minutes (:27 / :57) and from every other recurring job minute.
-- Both jobs run in UTC; Cyprus offsets are whole hours, so :03 / :33 UTC are :03 / :33 local all year. 17:03 local sits inside
-- weekend_digest_due()'s "Friday, hour 17, minute < 30" test; 17:33 does not; the "no 'all' run today" clause is untouched.
-- The first send under this file is the first Friday after the apply, 17:03 Asia/Famagusta (Fri 27 Nov 2026 when applied by Thu 26 Nov).
-- The gate allows FRIDAY ONLY: the cron fires on Saturdays too (5,6, as since 20261177) but the Saturday 17:03 tick is never due.
-- That is proved below with a positive control (the Saturday tick exists, and is not due).
--
-- HOW (one change, nothing else). cron.alter_job(job_id, schedule := '3,33 * * * 5,6', command := <the command below>). The jobid
-- does not change. The command is the exact text 20261187 stored, with ONE addition: ',\n    timeout_milliseconds := 60000' before the closing
-- parenthesis of net.http_post. The pre-flight REFUSES unless the live command equals the old text byte for byte, so a hand edit
-- (or a key pasted inline) stops the file instead of being overwritten.
-- weekend_digest_due(), duty-push's job and duty_push_due() are never written: their md5s / attributes / ACL are captured before and
-- asserted equal after.
--
-- WHO CAN CALL WHAT. weekend_digest_due stays executable by the owner and the cron role only: anon and authenticated hold no
-- EXECUTE (asserted by role name, owner as the positive control). No table, policy or grant is touched; nobody gains or loses
-- access to any row. The Vault key is read inside the cron command by the cron role, as before.
--
-- DEPENDS ON 20261221 (duty push at :27 / :57 with the 3-minute gate) being applied first: the sweep proves the Friday duty tick
-- (16:57) is at least 5 minutes before the digest tick (17:03). Applied without it the file REFUSES (the duty tick would be 17:00).
--
-- PROOF INSIDE THE TRANSACTION (any failure rolls the whole file back; messages carry times and booleans only, no counts of people).
--  - sweep: ticks generated from the job's NEW schedule over (i) the next two Fri/Sat pairs after today, (ii) Fri 26 + Sat 27 Mar and
--    Fri 2 + Sat 3 Apr 2027 (clocks go forward Sun 28 Mar), (iii) Fri 29 + Sat 30 Oct and Fri 5 + Sat 6 Nov 2027 (clocks go back Sun 31 Oct);
--    for the Thursday to Sunday of every pair: exactly ONE due tick on the Friday, at 17:03 Asia/Famagusta, ZERO on every other day
--    (the Saturday has a 17:03 tick that is not due). Without a run row to model "an 'all' run exists after the first send", the
--    stronger form is proved instead: the schedule itself has only one tick in [17:00, 17:30), so a second send cannot be due.
--  - no digest tick shares a minute-of-hour with a duty-push tick, and on every Friday the duty tick is >= 5 minutes before the digest tick;
--  - tolerance controls: 17:00 is not a tick; 17:33 not due; Sat 17:03 not due; a late start (up to 17:29) is still due;
--  - the pause switch: due -> paused (not due) -> resumed (due), in a sub-transaction that leaves the data_jobs row as captured;
--  - gate text, attributes, ACL, duty-push job and duty_push_due md5 unchanged; jobid unchanged; the job is still active.
--  REFUSALS (pre-flight): not exactly one weekend-digest job, not active, not '0,30 * * * 5,6', command not the exact old text,
--  weekend-digest paused (the sweep cannot prove one send), gate not the 20261210 definition, no timeout_milliseconds in net.http_post,
--  and the apply window below.
--
-- APPLY WINDOW (refusal in the pre-flight). pg_cron does not run a tick it missed, so committing close to a send could lose or
-- double the day's digest. The file REFUSES when weekend_digest_due(g) is true for ANY whole-minute instant g from 5 minutes
-- before to 20 minutes after the moment it runs: generate_series(clock_timestamp() - interval '5 minutes',
-- clock_timestamp() + interval '20 minutes', interval '1 minute'). With the gate as it stands (Friday, local hour 17, minute < 30,
-- no 'all' run yet today, not paused) that is every apply from Fri 16:40:00 up to and including Fri 17:34:59 Asia/Famagusta
-- until the day's run exists. Apply Monday to Thursday.
--
-- ROLLBACK. A SEPARATE file, 20261239_weekend_digest_shift_rollback.sql, on its own DO-NOT-MERGE branch
-- (chore/weekend-digest-1703-rollback). It restores '0,30 * * * 5,6' and the old command (no timeout). Production is main-only, so
-- it is applied only on Berke's go, after its file is landed on main by a PR, and dispatched alone. Never part of this run.
--
-- Apply: gh workflow run supabase-migrate -f file=20261238_weekend_digest_shift_3min.sql (dry), then -f apply=true
-- (Berke approves production-db). Together with 20261221: -f files="20261221_duty_push_shift_3min.sql 20261238_weekend_digest_shift_3min.sql".
-- ════════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── 1. Pre-flight: refuse on anything unexpected, capture what must not change ─
DO $$
DECLARE
  v_n      int;
  v_def    text;
  v_old    text := $old$
  SELECT net.http_post(
    url     := 'https://jeihxnwqytnxtytgkzgf.supabase.co/functions/v1/send-weekend-digest',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
                 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'novest_sync_key')),
    body    := '{}'::jsonb)
  WHERE public.weekend_digest_due();
$old$;
BEGIN
  IF to_regprocedure('public.weekend_digest_due(timestamp with time zone)') IS NULL
     OR to_regprocedure('public.duty_push_due(timestamp with time zone)') IS NULL
     OR to_regprocedure('public.data_job_paused(text)') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: weekend_digest_due / duty_push_due / data_job_paused is missing. Nothing applied.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = to_regprocedure('cron.alter_job(bigint,text,text,text,text,boolean)')
                    AND p.proargnames @> ARRAY['job_id', 'schedule', 'command']) THEN
    RAISE EXCEPTION 'REFUSING: this pg_cron has no cron.alter_job(job_id, schedule, command, ...). Nothing applied.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'net' AND p.proname = 'http_post' AND 'timeout_milliseconds' = ANY (p.proargnames)) THEN
    RAISE EXCEPTION 'REFUSING: net.http_post has no timeout_milliseconds parameter on this pg_net. Nothing applied.';
  END IF;

  IF coalesce(public.data_job_paused('weekend-digest'), true) THEN
    RAISE EXCEPTION 'REFUSING: weekend-digest is paused; the sweep cannot prove one send per Friday. Resume it, then apply.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.data_jobs WHERE key = 'weekend-digest') THEN
    RAISE EXCEPTION 'REFUSING: no data_jobs row for weekend-digest to probe the pause on. Nothing applied.';
  END IF;

  SELECT count(*) INTO v_n FROM cron.job WHERE jobname = 'weekend-digest';
  IF v_n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'REFUSING: expected exactly one cron job named weekend-digest, found %. Nothing applied.', v_n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job j
                  WHERE j.jobname = 'weekend-digest' AND j.active AND j.schedule = '0,30 * * * 5,6'
                    AND j.command IS NOT DISTINCT FROM v_old) THEN
    RAISE EXCEPTION 'REFUSING: weekend-digest is not the active job at 0,30 * * * 5,6 with exactly the 20261187 command (hand-edited? read it first). Nothing applied.';
  END IF;
  SELECT count(*) INTO v_n FROM cron.job WHERE command LIKE '%public.weekend_digest_due()%';
  IF v_n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'REFUSING: expected exactly one cron job calling weekend_digest_due, found %. Nothing applied.', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM cron.job WHERE jobname = 'duty-push';
  IF v_n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'REFUSING: expected exactly one cron job named duty-push, found %. Nothing applied.', v_n;
  END IF;

  v_def := pg_get_functiondef(to_regprocedure('public.weekend_digest_due(timestamp with time zone)'));
  IF v_def NOT LIKE '%extract(isodow FROM (p_at AT TIME ZONE ''Asia/Famagusta'')) = 5%'
     OR v_def NOT LIKE '%to_char(p_at AT TIME ZONE ''Asia/Famagusta'', ''HH24'') = ''17''%'
     OR v_def NOT LIKE '%extract(minute FROM (p_at AT TIME ZONE ''Asia/Famagusta'')) < 30%'
     OR v_def NOT LIKE '%AND NOT EXISTS (SELECT 1 FROM public.weekend_digest_runs r%'
     OR v_def NOT LIKE '%r.mode = ''all''%'
     OR v_def NOT LIKE '%AND NOT public.data_job_paused(''weekend-digest'')%' THEN
    RAISE EXCEPTION 'REFUSING: weekend_digest_due is not the 20261210 definition this file relies on. Nothing applied.';
  END IF;

  -- apply window: the gate as it stands now; see APPLY WINDOW in the header
  IF EXISTS (SELECT 1 FROM generate_series(clock_timestamp() - interval '5 minutes', clock_timestamp() + interval '20 minutes', interval '1 minute') g
              WHERE public.weekend_digest_due(g)) THEN
    RAISE EXCEPTION 'REFUSING: within 20 minutes of today''s weekend digest slot (Asia/Famagusta); apply later. Nothing applied.';
  END IF;

  -- captured, compared again at the end
  PERFORM set_config('r238.old_cmd',    v_old, true);
  PERFORM set_config('r238.job_id',     (SELECT jobid::text FROM cron.job WHERE jobname = 'weekend-digest'), true);
  PERFORM set_config('r238.gate_md5',   md5(v_def), true);
  PERFORM set_config('r238.gate_attrs', (SELECT concat_ws('|', provolatile, prosecdef::text, proconfig::text, proacl::text, pg_get_userbyid(proowner), (SELECT lanname FROM pg_language l WHERE l.oid = prolang))
                                           FROM pg_proc WHERE oid = to_regprocedure('public.weekend_digest_due(timestamp with time zone)')), true);
  PERFORM set_config('r238.pause_row',  (SELECT concat_ws('|', paused::text, paused_note, paused_by::text, paused_at::text) FROM public.data_jobs WHERE key = 'weekend-digest'), true);
  PERFORM set_config('r238.duty_job',   (SELECT md5(concat_ws('|', schedule, command, active::text, username)) FROM cron.job WHERE jobname = 'duty-push'), true);
  PERFORM set_config('r238.duty_fn',    md5(pg_get_functiondef(to_regprocedure('public.duty_push_due(timestamp with time zone)'))), true);
  RAISE NOTICE '20261238 pre-flight ok: weekend-digest is active, unpaused, at 0,30 * * * 5,6 with the exact 20261187 command';
END
$$;

-- ─── 2. The change: schedule and command, same jobid ─────────────────────────
-- The new command is the old text plus the timeout; the relation is asserted BEFORE the write.
DO $$
DECLARE
  v_job bigint := current_setting('r238.job_id')::bigint;
  v_old text   := current_setting('r238.old_cmd');
  v_new text := $new$
  SELECT net.http_post(
    url     := 'https://jeihxnwqytnxtytgkzgf.supabase.co/functions/v1/send-weekend-digest',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
                 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'novest_sync_key')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000)
  WHERE public.weekend_digest_due();
$new$;
BEGIN
  IF replace(v_new, E',\n    timeout_milliseconds := 60000)', ')') IS DISTINCT FROM v_old
     OR (length(v_new) - length(replace(v_new, 'timeout_milliseconds := 60000', ''))) / length('timeout_milliseconds := 60000') IS DISTINCT FROM 1
     OR v_new LIKE '%timeout_milliseconds := %timeout_milliseconds%' THEN
    RAISE EXCEPTION 'the new command must be the old command plus exactly one timeout_milliseconds := 60000';
  END IF;
  PERFORM set_config('r238.new_cmd', v_new, true);
  PERFORM cron.alter_job(job_id := v_job, schedule := '3,33 * * * 5,6', command := v_new);
END
$$;

-- ─── 3. What the file did, asserted ──────────────────────────────────────────
DO $$
DECLARE
  v_cmd   text;
  v_n     int;
  v_f     regprocedure := to_regprocedure('public.weekend_digest_due(timestamp with time zone)');
BEGIN
  SELECT count(*) INTO v_n FROM cron.job WHERE jobname = 'weekend-digest';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'expected exactly one weekend-digest job, found %', v_n; END IF;
  SELECT command INTO v_cmd FROM cron.job WHERE jobname = 'weekend-digest' AND active AND schedule = '3,33 * * * 5,6';
  IF v_cmd IS NULL THEN RAISE EXCEPTION 'weekend-digest is not the active job at 3,33 * * * 5,6'; END IF;
  IF v_cmd IS DISTINCT FROM current_setting('r238.new_cmd') THEN RAISE EXCEPTION 'the weekend-digest command is not the expected new text'; END IF;
  IF replace(v_cmd, E',\n    timeout_milliseconds := 60000)', ')') IS DISTINCT FROM current_setting('r238.old_cmd') THEN
    RAISE EXCEPTION 'the weekend-digest command differs from the old one by more than the timeout';
  END IF;
  IF v_cmd NOT LIKE '%WHERE public.weekend_digest_due()%' OR v_cmd NOT LIKE '%vault.decrypted_secrets%'
     OR (length(v_cmd) - length(replace(v_cmd, 'timeout_milliseconds := 60000', ''))) / length('timeout_milliseconds := 60000') IS DISTINCT FROM 1
     OR v_cmd LIKE '%eyJ%' OR v_cmd LIKE '%sb_secret%' THEN
    RAISE EXCEPTION 'the weekend-digest command lost its gate, its Vault lookup or its single 60 s timeout (or carries a key)';
  END IF;
  IF (SELECT jobid::text FROM cron.job WHERE jobname = 'weekend-digest') IS DISTINCT FROM current_setting('r238.job_id') THEN RAISE EXCEPTION 'the weekend-digest jobid changed'; END IF;
  SELECT count(*) INTO v_n FROM cron.job WHERE command LIKE '%public.weekend_digest_due()%';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'expected exactly one job calling weekend_digest_due, found %', v_n; END IF;

  IF md5(pg_get_functiondef(v_f)) IS DISTINCT FROM current_setting('r238.gate_md5') THEN RAISE EXCEPTION 'weekend_digest_due changed'; END IF;
  IF (SELECT concat_ws('|', provolatile, prosecdef::text, proconfig::text, proacl::text, pg_get_userbyid(proowner), (SELECT lanname FROM pg_language l WHERE l.oid = prolang)) FROM pg_proc WHERE oid = v_f)
       IS DISTINCT FROM current_setting('r238.gate_attrs') THEN
    RAISE EXCEPTION 'weekend_digest_due changed volatility / security / search_path / ACL / owner / language';
  END IF;
  IF has_function_privilege('anon', v_f, 'EXECUTE') OR has_function_privilege('authenticated', v_f, 'EXECUTE') THEN
    RAISE EXCEPTION 'weekend_digest_due must not be executable by anon or authenticated';
  END IF;
  IF NOT has_function_privilege('postgres', v_f, 'EXECUTE') THEN
    RAISE EXCEPTION 'positive control failed: the owner cannot execute weekend_digest_due';
  END IF;

  IF (SELECT md5(concat_ws('|', schedule, command, active::text, username)) FROM cron.job WHERE jobname = 'duty-push') IS DISTINCT FROM current_setting('r238.duty_job') THEN
    RAISE EXCEPTION 'the duty-push job changed';
  END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.duty_push_due(timestamp with time zone)'))) IS DISTINCT FROM current_setting('r238.duty_fn') THEN
    RAISE EXCEPTION 'duty_push_due changed';
  END IF;
  RAISE NOTICE '20261238 job + gate: weekend-digest at 3,33 * * * 5,6, old command + one 60 s timeout, jobid, gate, duty-push job and duty gate unchanged';
END
$$;

-- ─── 4. The sweep: one due tick per Friday at 17:03 local, none on any other day ─
-- Ticks come from the job's own schedule (minute list, UTC day-of-week list, every hour, UTC). The expected time is written out here
-- (Friday, 17:03), NOT read from the function under test.
DO $$
DECLARE
  v_sched   text;
  v_mins    int[];
  v_dows    int[];
  d_mins    int[];
  d_sched   text;
  w         record;
  v_bad     text;
  v_lo      timestamptz;
  v_hi      timestamptz;
  v_fri1    date;
  v_today   date := (clock_timestamp() AT TIME ZONE 'Asia/Famagusta')::date;
  v_duty_t  time;
BEGIN
  SELECT schedule INTO v_sched FROM cron.job WHERE jobname = 'weekend-digest';
  IF v_sched !~ '^[0-9]+(,[0-9]+)* \* \* \* [0-7](,[0-7])*$' THEN
    RAISE EXCEPTION 'weekend-digest schedule is not a plain minute list with a day list: %', v_sched;
  END IF;
  v_mins := string_to_array(split_part(v_sched, ' ', 1), ',')::int[];
  v_dows := string_to_array(split_part(v_sched, ' ', 5), ',')::int[];
  v_dows := ARRAY(SELECT DISTINCT CASE WHEN x = 7 THEN 0 ELSE x END FROM unnest(v_dows) x);

  SELECT schedule INTO d_sched FROM cron.job WHERE jobname = 'duty-push';
  IF d_sched !~ '^[0-9]+(,[0-9]+)* \* \* \* \*$' THEN
    RAISE EXCEPTION 'duty-push schedule is not a plain minute list: %', d_sched;
  END IF;
  d_mins := string_to_array(split_part(d_sched, ' ', 1), ',')::int[];
  IF d_mins && v_mins THEN
    RAISE EXCEPTION 'a digest tick minute % shares a minute-of-hour with duty-push minutes %', v_mins, d_mins;
  END IF;

  v_fri1 := v_today + ((5 - extract(isodow FROM v_today)::int + 7) % 7 + CASE WHEN (5 - extract(isodow FROM v_today)::int + 7) % 7 = 0 THEN 7 ELSE 0 END);

  FOR w IN SELECT * FROM (VALUES
      ('next Friday + Saturday',          v_fri1),
      ('the Friday after + Saturday',     v_fri1 + 7),
      ('Fri 26 + Sat 27 Mar 2027 (clocks forward Sun 28 Mar)', date '2027-03-26'),
      ('Fri 2 + Sat 3 Apr 2027',          date '2027-04-02'),
      ('Fri 29 + Sat 30 Oct 2027 (clocks back Sun 31 Oct)',    date '2027-10-29'),
      ('Fri 5 + Sat 6 Nov 2027',          date '2027-11-05')
    ) v(label, fri)
  LOOP
    IF extract(isodow FROM w.fri) IS DISTINCT FROM 5 THEN RAISE EXCEPTION '% is not a Friday: %', w.label, w.fri; END IF;
    -- days Thursday .. Sunday around the pair
    v_lo := ((w.fri - 1)::timestamp AT TIME ZONE 'Asia/Famagusta') - interval '12 hours';
    v_hi := ((w.fri + 3)::timestamp AT TIME ZONE 'Asia/Famagusta') + interval '12 hours';

    WITH ticks AS MATERIALIZED (
           SELECT h.h + make_interval(mins => m.m) AS ts
             FROM generate_series(date_trunc('hour', v_lo), v_hi, interval '1 hour') h(h), unnest(v_mins) m(m)
            WHERE extract(dow FROM h.h AT TIME ZONE 'UTC')::int = ANY (v_dows)),
         t AS MATERIALIZED (
           SELECT ts, (ts AT TIME ZONE 'Asia/Famagusta')::date AS d, (ts AT TIME ZONE 'Asia/Famagusta')::time AS lt,
                  public.weekend_digest_due(ts) AS due
             FROM ticks),
         days AS (
           SELECT g::date AS d, (extract(isodow FROM g)::int = 5) AS is_fri
             FROM generate_series((w.fri - 1)::timestamp, (w.fri + 2)::timestamp, interval '1 day') g),
         per AS (
           SELECT days.d, days.is_fri,
                  (SELECT count(*) FROM t WHERE t.d = days.d AND t.due) AS n_due,
                  (SELECT min(t.lt) FROM t WHERE t.d = days.d AND t.due) AS due_at,
                  (SELECT count(*) FROM t WHERE t.d = days.d AND t.lt = time '17:03') AS n_1703_ticks
             FROM days)
    SELECT string_agg(to_char(per.d, 'Dy YYYY-MM-DD') || ' due ticks ' || per.n_due || ' at ' || coalesce(to_char(per.due_at, 'HH24:MI'), '-')
                      || ' 17:03-ticks ' || per.n_1703_ticks, '; ' ORDER BY per.d)
      INTO v_bad
      FROM per
     WHERE CASE WHEN per.is_fri THEN (per.n_due IS DISTINCT FROM 1 OR per.due_at IS DISTINCT FROM time '17:03')
                ELSE per.n_due IS DISTINCT FROM 0 END
        OR (extract(isodow FROM per.d)::int IN (5, 6) AND per.n_1703_ticks IS DISTINCT FROM 1);
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'sweep % failed: %', w.label, v_bad;
    END IF;

    -- the Friday duty tick (the tick the duty gate says yes to) is at least 5 minutes before the digest tick
    SELECT min((x.ts AT TIME ZONE 'Asia/Famagusta')::time) INTO v_duty_t
      FROM (SELECT h2.h + make_interval(mins => m2.m) AS ts
              FROM generate_series(date_trunc('hour', v_lo), v_hi, interval '1 hour') h2(h), unnest(d_mins) m2(m)) x
     WHERE (x.ts AT TIME ZONE 'Asia/Famagusta')::date = w.fri AND public.duty_push_due(x.ts);
    IF v_duty_t IS NULL OR time '17:03' - v_duty_t < interval '5 minutes' THEN
      RAISE EXCEPTION 'sweep %: the Friday duty tick (%) must be at least 5 minutes before 17:03 (apply 20261221 first)', w.label, coalesce(v_duty_t::text, 'none');
    END IF;

    RAISE NOTICE '20261238 % (Fri % + Sat %, Asia/Famagusta): Thu-Sun checked, one due tick on the Friday at 17:03, none on any other day; Sat 17:03 tick exists and is not due',
      w.label, w.fri, w.fri + 1;
  END LOOP;
END
$$;

-- ─── 5. Tolerance controls: a late start still lands, a wrong minute does not ─
DO $$
DECLARE
  r        record;
  v_got    boolean;
  v_bad    text := '';
  v_mins   int[] := string_to_array(split_part((SELECT schedule FROM cron.job WHERE jobname = 'weekend-digest'), ' ', 1), ',')::int[];
  v_fri    date := date '2027-03-26';
BEGIN
  IF 0 = ANY (v_mins) OR 30 = ANY (v_mins) THEN RAISE EXCEPTION 'tolerance: 17:00 / 17:30 must not be ticks, minutes are %', v_mins; END IF;
  IF NOT (3 = ANY (v_mins) AND 33 = ANY (v_mins)) OR array_length(v_mins, 1) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'tolerance: ticks must be :03 and :33, minutes are %', v_mins; END IF;
  FOR r IN SELECT * FROM (VALUES
      ('Fri 17:03 (the tick)',             (v_fri + time '17:03'), true),
      ('Fri 17:29 (cron starts late)',     (v_fri + time '17:29'), true),
      ('Fri 17:00 (not a tick, gate yes)', (v_fri + time '17:00'), true),
      ('Fri 17:33 (the :33 tick)',         (v_fri + time '17:33'), false),
      ('Fri 17:30 (old :30 tick)',         (v_fri + time '17:30'), false),
      ('Fri 16:33 (the hour before)',      (v_fri + time '16:33'), false),
      ('Fri 18:03 (the hour after)',       (v_fri + time '18:03'), false),
      ('Sat 17:03 (the Saturday tick)',    (v_fri + 1 + time '17:03'), false),
      ('Sat 17:00',                        (v_fri + 1 + time '17:00'), false),
      ('Thu 17:03',                        (v_fri - 1 + time '17:03'), false),
      ('Sun 17:03',                        (v_fri + 2 + time '17:03'), false)
    ) v(label, lt, want)
  LOOP
    v_got := public.weekend_digest_due(r.lt AT TIME ZONE 'Asia/Famagusta');
    IF v_got IS DISTINCT FROM r.want THEN v_bad := v_bad || r.label || ' got ' || v_got::text || ' want ' || r.want::text || '; '; END IF;
  END LOOP;
  IF v_bad <> '' THEN RAISE EXCEPTION 'tolerance controls failed: %', v_bad; END IF;
  RAISE NOTICE '20261238 tolerance: ticks :03 and :33 only (17:00 and 17:30 are not ticks); 17:03 and 17:29 due; 17:33, 17:30, other hours, Thu / Sat / Sun not due';
END
$$;

-- ─── 6. The pause switch still stops the send (sub-transaction, rolled back) ──
DO $$
DECLARE
  v_res   text[] := ARRAY[]::text[];
  v_fri   date := ((clock_timestamp() AT TIME ZONE 'Asia/Famagusta')::date
                    + ((5 - extract(isodow FROM (clock_timestamp() AT TIME ZONE 'Asia/Famagusta'))::int + 7) % 7 + 7));
  v_at    timestamptz;
BEGIN
  v_at := (v_fri + time '17:03') AT TIME ZONE 'Asia/Famagusta';
  BEGIN
    v_res := v_res || ('due=' || public.weekend_digest_due(v_at)::text);
    UPDATE public.data_jobs SET paused = true, paused_note = 'probe', paused_by = NULL, paused_at = now() WHERE key = 'weekend-digest';
    IF NOT FOUND THEN RAISE EXCEPTION 'no data_jobs row for weekend-digest to probe the pause on'; END IF;
    v_res := v_res || ('paused=' || public.weekend_digest_due(v_at)::text);
    UPDATE public.data_jobs SET paused = false, paused_note = NULL, paused_by = NULL, paused_at = NULL WHERE key = 'weekend-digest';
    v_res := v_res || ('resumed=' || public.weekend_digest_due(v_at)::text);
    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  IF v_res IS DISTINCT FROM ARRAY['due=true', 'paused=false', 'resumed=true'] THEN
    RAISE EXCEPTION 'pause probe on a Friday 17:03: got %, wanted due=true, paused=false, resumed=true', v_res;
  END IF;
  IF (SELECT concat_ws('|', paused::text, paused_note, paused_by::text, paused_at::text) FROM public.data_jobs WHERE key = 'weekend-digest')
       IS DISTINCT FROM current_setting('r238.pause_row') THEN
    RAISE EXCEPTION 'the pause probe left the weekend-digest data_jobs row changed';
  END IF;
  RAISE NOTICE '20261238 pause probe at Fri % 17:03 Asia/Famagusta: %', v_fri, v_res;
  RAISE NOTICE '20261238 OK: weekend-digest at 3,33 * * * 5,6 with a 60 s timeout; Friday 17:03 Asia/Famagusta once, never Saturday; no shared minute with duty-push, Friday duty tick >= 5 min earlier; pause stops the send (true, false, true)';
END
$$;

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
VALUES ('20261238_weekend_digest_shift_3min.sql', 'af30ea25c2bea3d0be24118b7debb1f4fe0016cfe6fcfa90e59d532a67709195')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: the 20261238_weekend_digest_shift_3min tokens must read OK (H section) and
--   QUERY 2 / Q2: the 20261238 cron token. Then, after the first Friday, supabase/readonly/weekend_digest_runs_watch.sql.
