-- ═══════════════════════════════════════════════════════════════════════════
-- 20261103 — Duty pharmacy push: Thursday 17:00, and every send on TRNC local time
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT CHANGED. Winter schedule (Oct 2026): pharmacies close at 17:30 on Thursday too, like
-- Mon/Tue/Wed/Fri. The push goes 30 minutes before closing, so Thursday moves 13:00 → 17:00.
--
-- WHY THE OLD JOBS COULD NOT JUST BE EDITED. Read live 2026-10-10 (cron.job, as
-- supabase_read_only_user; cron.timezone = GMT):
--   duty-notif-mtwf     '0 14 * * 1,2,3,5'   17:00 TRNC today
--   duty-notif-thu-sat  '0 10 * * 4,6'       13:00 TRNC today
--   duty-notif-sun      '0 5 * * 0'          08:00 TRNC today
-- All UTC with TRNC assumed UTC+3. TRNC observes EU DST (Asia/Famagusta): from 25 Oct 2026
-- it is UTC+2 and every one of them would fire an hour early (16:00 / 12:00 / 07:00).
-- Europe/Istanbul is NOT the zone: Turkey stays UTC+3 all year.
-- The three commands also carried the service key INLINE in cron.job; this file replaces
-- them with one job that reads it from Vault ('novest_sync_key', the key sync-novest and the
-- live-scores jobs use; sync-novest is verify_jwt=true like send-duty-notification, so its
-- twice-daily run is proof the key passes that gate).
--
-- THE SCHEDULE, TRNC LOCAL (Asia/Famagusta), DST-SAFE:
--   Mon/Tue/Wed/Fri  17:00   (closing 17:30)
--   Thursday         duty_thursday_closing_local() − 30 min   → 17:00 this winter
--   Saturday         13:00   (closing 13:30)   — local time unchanged, only its UTC instant moves
--   Sunday           08:00   (pharmacy open)   — local time unchanged, only its UTC instant moves
-- One job, 'duty-push', ticks every 30 minutes; duty_push_due() answers "is this tick's local
-- 30-minute slot today's send time?". An idle tick is one function call and no HTTP.
-- It compares the SLOT, not the exact minute: pg_cron starts a few seconds late.
--
-- NEXT SUMMER (Thursday back to 13:30): one line, in a new migration —
--   CREATE OR REPLACE FUNCTION public.duty_thursday_closing_local() … SELECT time '13:30' …
-- and update the H token in verify_schema.sql.
--
-- NO FIRST RUN. send-duty-notification pushes to every profile; this file never POSTs.
-- The edge function is unchanged: its "today" uses UTC+3, which after 25 Oct is an hour
-- ahead but lands on the same date for every send time above (17:00 local = 15:00Z → 18:00).
--
-- Apply: gh workflow run supabase-migrate -f file=20261103_duty_push_famagusta.sql
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF (SELECT count(*) FROM vault.secrets WHERE name = 'novest_sync_key') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Vault secret novest_sync_key is missing — the duty job would POST without a key. Nothing applied.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = 'Asia/Famagusta') THEN
    RAISE EXCEPTION 'this server has no Asia/Famagusta in its tzdata. Nothing applied.';
  END IF;
END $$;

-- The one value that changes with the season. Winter 17:30, summer 13:30.
CREATE OR REPLACE FUNCTION public.duty_thursday_closing_local()
RETURNS time LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT time '17:30'
$$;

CREATE OR REPLACE FUNCTION public.duty_push_due(p_at timestamptz DEFAULT now())
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT date_trunc('hour', l.t)
           + CASE WHEN extract(minute FROM l.t) >= 30 THEN interval '30 minutes' ELSE interval '0' END
         = l.t::date + CASE extract(isodow FROM l.t)::int
             WHEN 7 THEN time '08:00'
             WHEN 6 THEN time '13:30' - interval '30 minutes'
             WHEN 4 THEN public.duty_thursday_closing_local() - interval '30 minutes'
             ELSE        time '17:30' - interval '30 minutes'
           END
  FROM (SELECT p_at AT TIME ZONE 'Asia/Famagusta' AS t) l
$$;

-- Only the cron job (postgres) calls these.
REVOKE ALL ON FUNCTION public.duty_thursday_closing_local() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.duty_push_due(timestamptz) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE j text;
BEGIN
  FOREACH j IN ARRAY ARRAY['duty-notif-mtwf','duty-notif-thu-sat','duty-notif-sun','duty-push'] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j) THEN PERFORM cron.unschedule(j); END IF;
  END LOOP;
END $$;

SELECT cron.schedule('duty-push', '0,30 * * * *', $job$
  SELECT net.http_post(
    url     := 'https://jeihxnwqytnxtytgkzgf.supabase.co/functions/v1/send-duty-notification',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
                 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'novest_sync_key')),
    body    := '{}'::jsonb)
  WHERE public.duty_push_due();
$job$);

-- ─── Assertions ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_jobs  text;
  v_sends text;
  v_n     int;
  v_bad   text;
BEGIN
  -- (1) Exactly one duty job, the new one, keyed from Vault, no inline key anywhere.
  SELECT string_agg(jobname, ',' ORDER BY jobname), count(*) INTO v_jobs, v_n
    FROM cron.job WHERE jobname ILIKE '%duty%' OR command ILIKE '%send-duty-notification%';
  IF v_jobs IS DISTINCT FROM 'duty-push' THEN
    RAISE EXCEPTION 'duty jobs after the swap: % (expected exactly duty-push)', coalesce(v_jobs, 'NONE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'duty-push' AND active AND schedule = '0,30 * * * *'
                   AND command LIKE '%vault.decrypted_secrets%' AND command LIKE '%public.duty_push_due()%'
                   AND command NOT LIKE '%eyJ%' AND command NOT LIKE '%sb_secret%') THEN
    RAISE EXCEPTION 'duty-push is not active / not every 30 min / not Vault-keyed / not gated by duty_push_due()';
  END IF;

  -- (2) Three weeks straddling the 25 Oct clock change, every 30-minute tick in UTC:
  --     exactly one send per local day, at the expected local time for its weekday.
  WITH ticks AS (
    SELECT t FROM generate_series(timestamptz '2026-10-12 00:00+00', timestamptz '2026-11-01 23:30+00',
                                  interval '30 minutes') t
  ), sends AS (
    SELECT t, t AT TIME ZONE 'Asia/Famagusta' AS l FROM ticks WHERE public.duty_push_due(t)
  )
  SELECT count(*),
         string_agg(to_char(l, 'Dy DD Mon HH24:MI') || ' (' || to_char(t AT TIME ZONE 'UTC', 'HH24:MI') || 'Z)', ', ' ORDER BY t),
         string_agg(to_char(l, 'Dy DD Mon HH24:MI'), ', ' ORDER BY t) FILTER (WHERE to_char(l, 'HH24:MI') IS DISTINCT FROM
           CASE extract(isodow FROM l)::int WHEN 7 THEN '08:00' WHEN 6 THEN '13:00' ELSE '17:00' END)
    INTO v_n, v_sends, v_bad FROM sends;
  RAISE NOTICE 'duty sends 12 Oct – 1 Nov 2026 (TRNC local, UTC): %', v_sends;
  IF v_n IS DISTINCT FROM 21 THEN RAISE EXCEPTION 'expected 21 sends in 21 days, got %: %', v_n, v_sends; END IF;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'sends at the wrong local time: %', v_bad; END IF;
  IF (SELECT count(DISTINCT (t AT TIME ZONE 'Asia/Famagusta')::date) FROM generate_series(timestamptz '2026-10-12 00:00+00',
        timestamptz '2026-11-01 23:30+00', interval '30 minutes') t WHERE public.duty_push_due(t)) IS DISTINCT FROM 21 THEN
    RAISE EXCEPTION 'some local day has two sends';
  END IF;

  -- (3) The two Thursdays asked about, either side of the change, and the old instants now silent.
  IF NOT public.duty_push_due('2026-10-15 14:00:04+00') THEN RAISE EXCEPTION 'Thu 15 Oct 17:00 TRNC (14:00Z) is not due'; END IF;
  IF NOT public.duty_push_due('2026-10-29 15:00:04+00') THEN RAISE EXCEPTION 'Thu 29 Oct 17:00 TRNC (15:00Z) is not due'; END IF;
  IF public.duty_push_due('2026-10-15 10:00:04+00') THEN RAISE EXCEPTION 'Thu 15 Oct 13:00 TRNC still due'; END IF;
  IF public.duty_push_due('2026-10-29 14:00:04+00') THEN RAISE EXCEPTION 'Thu 29 Oct 16:00 TRNC is due (UTC+3 assumed)'; END IF;
  -- Spring 2027 (UTC+3 again): Monday 29 Mar 17:00 TRNC = 14:00Z.
  IF NOT public.duty_push_due('2027-03-29 14:00:04+00') THEN RAISE EXCEPTION 'Mon 29 Mar 2027 17:00 TRNC (14:00Z) is not due'; END IF;

  -- (4) No API role can call either function.
  IF has_function_privilege('anon', 'public.duty_push_due(timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.duty_push_due(timestamptz)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.duty_thursday_closing_local()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.duty_thursday_closing_local()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon/authenticated can EXECUTE a duty schedule function';
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
VALUES ('20261103_duty_push_famagusta.sql', 'ac4aa7094e11073202c5c610faf04976282b68836439a00a4343fe440ba4acb0')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;
