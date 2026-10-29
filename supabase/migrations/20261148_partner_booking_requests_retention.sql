-- ═══════════════════════════════════════════════════════════════════════════
-- 20261148 — partner_booking_requests: 12-month retention (pg_cron 03:53 UTC)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 20261143 created the table and said "no retention job". This adds one. The table holds no identifier, but it is
-- still a log of what people asked for, and it must not grow forever: rows older than 12 months are deleted.
--
-- ─── WHO CAN READ / WRITE / DELETE (unchanged by this file) ─────────────────
--   INSERT  authenticated (guests included), five columns, bounded by policy + CHECKs.
--   SELECT  admins only.   UPDATE  nobody.   DELETE  nobody from the app (RESTRICTIVE USING (false) stays).
--   The purge is the ONLY deleter: public.purge_partner_booking_requests() runs as the cron job owner (postgres, the
--   table owner, which RLS does not apply to). EXECUTE on the function is revoked from PUBLIC, anon and authenticated,
--   so no client can trigger or alter a purge. No policy or grant on the table is touched; the DO block asserts the
--   full policy set is still the same four.
--
-- SECURITY INVOKER + SET search_path = public, EXECUTE revoked: the posture of purge_app_update_events (20261051).
-- 03:53 UTC: after purge-soft-deleted-ugc (03:27), purge-app-update-events (03:33), eatery-orders-retention (:40),
-- purge-duty-push-runs (03:47).
--
-- Apply: gh workflow run supabase-migrate -f file=20261148_partner_booking_requests_retention.sql (dry), then -f apply=true.
-- No new column ⇒ no NOTIFY pgrst needed (function and comment only).
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.purge_partner_booking_requests()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_cut timestamptz := now() - interval '12 months';
  n int;
BEGIN
  DELETE FROM public.partner_booking_requests WHERE created_at < v_cut;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('deleted', n, 'cutoff', v_cut);
END;
$function$;

ALTER FUNCTION public.purge_partner_booking_requests() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.purge_partner_booking_requests() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.purge_partner_booking_requests() IS
  'Nightly retention for partner_booking_requests: deletes rows older than 12 months. Cron purge-partner-booking-requests 03:53 UTC. Not client-callable. 20261148.';

COMMENT ON TABLE public.partner_booking_requests IS
  'One row per North Houses booking-request tap: apartment, dates, guest count. NO identifier of any kind (no name, phone, email, user or device id): those go only into the WhatsApp text. Authenticated (guests included) may INSERT five columns; only admins may SELECT; nobody may UPDATE or DELETE from the app. Rows older than 12 months are deleted nightly by cron purge-partner-booking-requests (03:53 UTC). 20261143, 20261148.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-partner-booking-requests') THEN
    PERFORM cron.unschedule('purge-partner-booking-requests');
  END IF;
END $$;
SELECT cron.schedule('purge-partner-booking-requests', '53 3 * * *', $$SELECT public.purge_partner_booking_requests()$$);

-- ─── Assertions + probes (inside the transaction; a failure rolls the file back) ─
DO $$
DECLARE
  v_t      regclass := to_regclass('public.partner_booking_requests');
  v_fn     regprocedure := to_regprocedure('public.purge_partner_booking_requests()');
  v_n      int;
  v_names  text;
  v_cmd    text;
  v_sched  text;
  v_active boolean;
  v_role   text;
  v_old    uuid;
  v_edge   uuid;
  v_fresh  uuid;
  v_res    jsonb;
  v_old_left   int;
  v_edge_left  int;
  v_fresh_left int;
BEGIN
  IF v_t IS NULL THEN RAISE EXCEPTION 'partner_booking_requests is not visible to this block'; END IF;
  IF v_fn IS NULL THEN RAISE EXCEPTION 'purge_partner_booking_requests() was not created'; END IF;

  -- The cron row: exactly one, active, exact schedule and command. PRINTED.
  SELECT count(*), max(schedule), max(command), bool_and(active) INTO v_n, v_sched, v_cmd, v_active
    FROM cron.job WHERE jobname = 'purge-partner-booking-requests';
  RAISE NOTICE 'cron.job purge-partner-booking-requests: rows=%, schedule=%, active=%, command=%', v_n, v_sched, v_active, v_cmd;
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'expected exactly 1 cron job purge-partner-booking-requests; found %', v_n; END IF;
  IF v_sched IS DISTINCT FROM '53 3 * * *' THEN RAISE EXCEPTION 'schedule is %, expected 53 3 * * *', v_sched; END IF;
  IF btrim(v_cmd) IS DISTINCT FROM 'SELECT public.purge_partner_booking_requests()' THEN RAISE EXCEPTION 'cron command is %', v_cmd; END IF;
  IF v_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'cron job is not active'; END IF;

  -- EXECUTE: not anon, authenticated or PUBLIC. The owner (postgres) and service_role hold it (service_role via Supabase default privileges; the harness proacl shows both). has_function_privilege(...,'EXECUTE') resolves PUBLIC for each named role; PUBLIC itself
  -- is read from proacl (grantee 0). Positive control: the owner (postgres) can still execute it.
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_function_privilege(v_role, v_fn, 'EXECUTE') THEN RAISE EXCEPTION '% can EXECUTE purge_partner_booking_requests', v_role; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_fn AND a.grantee = 0) THEN
    RAISE EXCEPTION 'PUBLIC holds EXECUTE on purge_partner_booking_requests';
  END IF;
  IF NOT has_function_privilege('postgres', v_fn, 'EXECUTE') THEN RAISE EXCEPTION 'positive control: postgres cannot EXECUTE the purge'; END IF;
  RAISE NOTICE 'purge_partner_booking_requests proacl: %', (SELECT proacl::text FROM pg_proc WHERE oid = v_fn);

  -- The FULL policy set is unchanged: exactly the four from 20261143, printed.
  SELECT count(*), string_agg(policyname || ':' || cmd || ':' || permissive, ', ' ORDER BY policyname)
    INTO v_n, v_names FROM pg_policies WHERE schemaname = 'public' AND tablename = 'partner_booking_requests';
  IF v_n IS DISTINCT FROM 4 THEN RAISE EXCEPTION 'partner_booking_requests must carry exactly 4 policies; found %: %', v_n, v_names; END IF;
  IF (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'partner_booking_requests')
     IS DISTINCT FROM ARRAY['pbr_insert_authenticated','pbr_no_delete','pbr_no_update','pbr_select_admin'] THEN
    RAISE EXCEPTION 'partner_booking_requests policy names unexpected: %', v_names;
  END IF;
  RAISE NOTICE 'partner_booking_requests policies (% , unchanged): %', v_n, v_names;

  IF coalesce(obj_description(v_t, 'pg_class'), '') NOT LIKE '%12 months%' THEN RAISE EXCEPTION 'table comment does not state the 12-month retention'; END IF;

  -- BEHAVIOUR: old goes, fresh stays. Rows are inserted as postgres (owner) with a backdated created_at, which the
  -- app roles cannot do. Probe rows are told apart by id, and removed again so a re-run is safe.
  INSERT INTO public.partner_booking_requests (partner, apartment, check_in, check_out, guests, created_at)
    VALUES ('north_houses', 'yasemin-2plus1', current_date + 30, current_date + 33, 9, now() - interval '13 months') RETURNING id INTO v_old;
  INSERT INTO public.partner_booking_requests (partner, apartment, check_in, check_out, guests, created_at)
    VALUES ('north_houses', 'yasemin-2plus1', current_date + 30, current_date + 33, 9, now() - interval '11 months') RETURNING id INTO v_edge;
  INSERT INTO public.partner_booking_requests (partner, apartment, check_in, check_out, guests)
    VALUES ('north_houses', 'yasemin-2plus1', current_date + 30, current_date + 33, 9) RETURNING id INTO v_fresh;

  v_res := public.purge_partner_booking_requests();

  SELECT count(*) INTO v_old_left   FROM public.partner_booking_requests WHERE id = v_old;
  SELECT count(*) INTO v_edge_left  FROM public.partner_booking_requests WHERE id = v_edge;
  SELECT count(*) INTO v_fresh_left FROM public.partner_booking_requests WHERE id = v_fresh;
  RAISE NOTICE 'purge result %; 13-month row left=%, 11-month row left=%, fresh row left=%', v_res, v_old_left, v_edge_left, v_fresh_left;

  DELETE FROM public.partner_booking_requests WHERE id IN (v_old, v_edge, v_fresh);

  IF v_old_left   IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'a 13-month-old row survived the purge'; END IF;
  IF v_edge_left  IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'positive control: an 11-month-old row was deleted (retention too aggressive)'; END IF;
  IF v_fresh_left IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'positive control: a fresh row was deleted'; END IF;
  IF (v_res->>'deleted')::int < 1 THEN RAISE EXCEPTION 'purge reported deleted=% (want >= 1)', v_res->>'deleted'; END IF;
  IF EXISTS (SELECT 1 FROM public.partner_booking_requests WHERE id IN (v_old, v_edge, v_fresh)) THEN
    RAISE EXCEPTION 'probe rows leaked into partner_booking_requests';
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
VALUES ('20261148_partner_booking_requests_retention.sql', '2fbc5e8221f111688997f4fa1756a59c21cc265e67807a7e59127154ed79cc52')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   verify_schema QUERY 1: the 20261148_partner_booking_requests_retention rows must read OK; QUERY 2: purge-partner-booking-requests.
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   SELECT cron.unschedule('purge-partner-booking-requests'); DROP FUNCTION public.purge_partner_booking_requests();
--   (and delete its schema_migrations_applied row; restore the 20261143 table comment if wanted)
