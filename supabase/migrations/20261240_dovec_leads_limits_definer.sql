-- ═════════════════════════════════════════════════════════════════
-- 20261240 — Döveç enquiry limits: the trigger function runs as its owner, and a repeated request is never judged by the limit
-- ═════════════════════════════════════════════════════════════════
--
-- WHAT. CREATE OR REPLACE of public.dovec_leads_enforce_limits() (BEFORE INSERT trigger on dovec_leads, 20261229 section 3b), two changes:
--   1. SECURITY DEFINER with search_path pinned to '' (every name schema-qualified; pg_catalog built-ins only), EXECUTE revoked from
--      PUBLIC, anon, authenticated AND service_role (a trigger firing does not check EXECUTE: proved below as service_role).
--      WHY: it was SECURITY INVOKER. dovec_leads has RLS on and zero policies, so a future inserter that can INSERT but not read would
--      count 0 rows and silently switch every limit off. Run as its owner, it counts the real table whoever inserts.
--   2. Right after the advisory lock, a row whose (user_id, client_request_id) already exists is let through untouched: it then hits the
--      unique constraint dovec_leads_request_key and raises 23505, the replay path of the edge function. WHY: a repeated request is not
--      a new enquiry, so the limit must not judge it (a double tap at the limit was answered 429 instead of "already received"), and the
--      outcome of two simultaneous identical sends becomes one database fact: one row and one 23505, never DV429.
-- Nothing else changes: same limits (3 an hour, 10 a day per person, 200 a day in all), same SQLSTATE DV429, same is_test exemption.
--
-- WHO CAN READ/WRITE WHAT. Unchanged for every table: dovec_leads stays RLS on, zero policies, no privilege for anon / authenticated,
-- service_role SELECT/INSERT/UPDATE only. The function is now callable by nobody directly (the owner and the trigger only).
--
-- PRINTS no user data and no counts of user rows. The behaviour block runs inside a deliberate exception: no row it writes survives.
-- Sequences are not rolled back: the behaviour block burns values of public.dovec_lead_external_seq, so the ADA-n numbers will show a gap.
BEGIN;

CREATE OR REPLACE FUNCTION public.dovec_leads_enforce_limits()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.is_test THEN RETURN NEW; END IF;   -- the one agreed test enquiry neither counts against nor is stopped by the limits
  PERFORM pg_advisory_xact_lock(hashtextextended('dovec_leads:insert', 0));
  -- A repeat of an accepted request is not a new enquiry: do not judge it by the limit. The unique constraint
  -- (user_id, client_request_id) rejects it next (23505), which the edge function answers as a replay.
  IF NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.dovec_leads WHERE user_id = NEW.user_id AND client_request_id = NEW.client_request_id) THEN
    RETURN NEW;
  END IF;
  IF (SELECT count(*) FROM public.dovec_leads WHERE NOT is_test AND created_at >= now() - interval '1 day') >= 200 THEN
    RAISE EXCEPTION 'dovec_rate_limited' USING ERRCODE = 'DV429';
  END IF;
  IF NEW.user_id IS NOT NULL THEN
    IF (SELECT count(*) FROM public.dovec_leads WHERE user_id = NEW.user_id AND NOT is_test AND created_at >= now() - interval '1 hour') >= 3
       OR (SELECT count(*) FROM public.dovec_leads WHERE user_id = NEW.user_id AND NOT is_test AND created_at >= now() - interval '1 day') >= 10 THEN
      RAISE EXCEPTION 'dovec_rate_limited' USING ERRCODE = 'DV429';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.dovec_leads_enforce_limits() FROM PUBLIC, anon, authenticated, service_role;

-- ─── Assertions ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_fn     oid := to_regprocedure('public.dovec_leads_enforce_limits()');
  v_tbl    oid := to_regclass('public.dovec_leads');
  v_owner  name;
  v_bypass boolean;
  v_super  boolean;
  v_towner name;
  v_force  boolean;
  v_rls    boolean;
  v_def    text;
  v_cfg    text[];
BEGIN
  IF v_fn IS NULL OR v_tbl IS NULL THEN RAISE EXCEPTION 'dovec_leads or its limit function is missing'; END IF;
  SELECT p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner), pg_get_functiondef(p.oid) INTO v_rls, v_cfg, v_owner, v_def FROM pg_proc p WHERE p.oid = v_fn;
  IF v_rls IS DISTINCT FROM true THEN RAISE EXCEPTION 'dovec_leads_enforce_limits is not SECURITY DEFINER'; END IF;
  IF v_cfg IS NULL OR (SELECT count(*) FROM unnest(v_cfg) c WHERE c LIKE 'search_path=%') IS DISTINCT FROM 1
     OR EXISTS (SELECT 1 FROM unnest(v_cfg) c WHERE c LIKE 'search_path=%' AND c LIKE '%public%') THEN
    RAISE EXCEPTION 'dovec_leads_enforce_limits search_path is not pinned to the empty path: %', v_cfg;
  END IF;
  IF v_def NOT LIKE '%NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.dovec_leads WHERE user_id = NEW.user_id AND client_request_id = NEW.client_request_id)%'
     OR v_def NOT LIKE '%NEW.is_test%' OR v_def NOT LIKE '%AND NOT is_test%' OR v_def NOT LIKE '%pg_advisory_xact_lock%' THEN
    RAISE EXCEPTION 'dovec_leads_enforce_limits body is not the expected one';
  END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR has_function_privilege('service_role', v_fn, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = v_fn AND a.grantee = 0) THEN
    RAISE EXCEPTION 'dovec_leads_enforce_limits is executable by anon, authenticated, service_role or PUBLIC';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = v_tbl AND tgname = 'dovec_leads_rate_limit' AND NOT tgisinternal) IS DISTINCT FROM 1
     OR (SELECT count(*) FROM pg_trigger WHERE tgrelid = v_tbl AND NOT tgisinternal AND tgfoid = v_fn) IS DISTINCT FROM 1
     OR (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = v_tbl AND tgname = 'dovec_leads_rate_limit')
        NOT LIKE '%BEFORE INSERT ON public.dovec_leads FOR EACH ROW EXECUTE FUNCTION dovec_leads_enforce_limits()%' THEN
    RAISE EXCEPTION 'dovec_leads_rate_limit is not the one BEFORE INSERT row trigger on the function';
  END IF;
  -- The owner must be able to read EVERY row of dovec_leads, or an owner-run count reads 0 and the limits are off.
  SELECT c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) INTO v_rls, v_force, v_towner FROM pg_class c WHERE c.oid = v_tbl;
  SELECT r.rolbypassrls, r.rolsuper INTO v_bypass, v_super FROM pg_roles r WHERE r.rolname = v_owner;
  RAISE NOTICE 'limit function owner: %, bypassrls=%, superuser=%; dovec_leads owner: %, rls=%, force rls=%', v_owner, v_bypass, v_super, v_towner, v_rls, v_force;
  IF NOT (v_bypass OR v_super OR (v_owner IS NOT DISTINCT FROM v_towner AND v_force IS NOT DISTINCT FROM false)) THEN
    RAISE EXCEPTION 'the function owner % cannot read every dovec_leads row (no BYPASSRLS, and it is not the table owner under plain RLS): its counts would read 0', v_owner;
  END IF;
  IF v_force IS NOT DISTINCT FROM true AND NOT (v_bypass OR v_super) THEN
    RAISE EXCEPTION 'dovec_leads has FORCE ROW LEVEL SECURITY and the function owner lacks BYPASSRLS: an owner-run count could read 0';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'dovec_leads') IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'dovec_leads carries a policy';
  END IF;
END $$;

-- ─── Behaviour, as the role that matters (service_role), positive control beside every refusal ──────────────────
-- A synthetic user (no profile, user_id has no foreign key) and one probe project; the block ends in a deliberate exception.
DO $$
DECLARE
  v_user   uuid := gen_random_uuid();
  v_user2  uuid := gen_random_uuid();
  v_probe  text := 'zz-limits-probe';
  v_first  text := 'unset';
  v_fourth text := 'unset';
  v_dup    text := 'unset';
  v_fresh  text := 'unset';
  v_c1     uuid := gen_random_uuid();
  v_n      int;
BEGIN
  BEGIN
    INSERT INTO public.dovec_projects (id, name, city, status, website_url) VALUES (v_probe, 'Probe', 'Probe city', 'on_sale', 'https://example.com/p');
    SET LOCAL ROLE service_role;
    BEGIN
      INSERT INTO public.dovec_leads (user_id, client_request_id, payload_hash, project_id, name, phone, language, language_code, consent, consent_text_version, status)
      VALUES (v_user, v_c1, repeat('a', 64), v_probe, 'Probe Person', '+441234567890', 'English', 'en', true, 'probe', 'sent');
      INSERT INTO public.dovec_leads (user_id, client_request_id, payload_hash, project_id, name, phone, language, language_code, consent, consent_text_version, status)
      SELECT v_user, gen_random_uuid(), repeat('a', 64), v_probe, 'Probe Person', '+441234567890', 'English', 'en', true, 'probe', 'sent' FROM generate_series(1, 2);
      v_first := 'three_in';
    EXCEPTION WHEN OTHERS THEN v_first := 'refused:' || SQLSTATE; END;
    BEGIN   -- the 4th in the hour: refused with DV429 (the limit still counts the table, and fires with EXECUTE revoked)
      INSERT INTO public.dovec_leads (user_id, client_request_id, payload_hash, project_id, name, phone, language, language_code, consent, consent_text_version, status)
      VALUES (v_user, gen_random_uuid(), repeat('b', 64), v_probe, 'Probe Person', '+441234567890', 'English', 'en', true, 'probe', 'sent');
      v_fourth := 'ACCEPTED';
    EXCEPTION WHEN OTHERS THEN v_fourth := SQLSTATE; END;
    BEGIN   -- the SAME request again, at the limit: a unique violation (replay), never a rate limit
      INSERT INTO public.dovec_leads (user_id, client_request_id, payload_hash, project_id, name, phone, language, language_code, consent, consent_text_version, status)
      VALUES (v_user, v_c1, repeat('a', 64), v_probe, 'Probe Person', '+441234567890', 'English', 'en', true, 'probe', 'sent');
      v_dup := 'ACCEPTED';
    EXCEPTION WHEN OTHERS THEN v_dup := SQLSTATE; END;
    BEGIN   -- positive control: another person is still accepted
      INSERT INTO public.dovec_leads (user_id, client_request_id, payload_hash, project_id, name, phone, language, language_code, consent, consent_text_version, status)
      VALUES (v_user2, gen_random_uuid(), repeat('c', 64), v_probe, 'Probe Person', '+441234567890', 'English', 'en', true, 'probe', 'sent');
      v_fresh := 'accepted';
    EXCEPTION WHEN OTHERS THEN v_fresh := SQLSTATE; END;
    RESET ROLE;
    SELECT count(*) INTO v_n FROM public.dovec_leads WHERE user_id = v_user;
    RAISE EXCEPTION 'probe_rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'probe_rollback' THEN RAISE; END IF;
  END;
  RESET ROLE;
  RAISE NOTICE 'limit behaviour as service_role: first three=%, 4th=%, same request again=%, another person=%', v_first, v_fourth, v_dup, v_fresh;
  IF v_first IS DISTINCT FROM 'three_in' THEN RAISE EXCEPTION 'the first three enquiries were not accepted: %', v_first; END IF;
  IF v_fourth IS DISTINCT FROM 'DV429' THEN RAISE EXCEPTION 'the 4th enquiry in an hour was not refused with DV429 (%)', v_fourth; END IF;
  IF v_dup IS DISTINCT FROM '23505' THEN RAISE EXCEPTION 'a repeated request at the limit was not a unique violation (%)', v_dup; END IF;
  IF v_fresh IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'positive control failed: another person was refused (%)', v_fresh; END IF;
  IF v_n IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'the synthetic person ended with % stored enquiries, expected 3', v_n; END IF;
  IF (SELECT count(*) FROM public.dovec_projects WHERE id = v_probe) IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'the probe left rows behind'; END IF;
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
VALUES ('20261240_dovec_leads_limits_definer.sql', '5a61bac582fb357d3219271cde39c7afb09435bdcc4043c5ef41ead293e1fde0')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;
