-- ═════════════════════════════════════════════════════════════════
-- 20261244 — Döveç forget: the e-mail the person wrote from must match the account that sent the enquiry
-- ═════════════════════════════════════════════════════════════════
--
-- WHAT, IN PLAIN ENGLISH
-- 20261243 added public.dovec_lead_forget(reference, apply): Berke checked by hand that the requester sent the enquiry. This replaces
-- it with public.dovec_lead_forget(p_reference text, p_email text, p_apply boolean DEFAULT false) RETURNS jsonb: the tool is given
-- the e-mail address the person wrote from, and answers one more yes/no: does it match the e-mail of the account that sent this
-- enquiry (the enquiry's user_id, looked up in auth.users)? Apply refuses unless the answer is yes. The two-argument function is
-- dropped, so nothing can call the old, unchecked form.
-- Still run only by the workflow dovec-lead-forget, which waits for Berke's approval in the `production-db` environment.
--
-- WHO CAN CALL IT: the owner and service_role (the workflow, over PostgREST RPC with the service key). Not PUBLIC, not anon,
-- not authenticated (guests included). Nobody can read dovec_leads or auth.users through it: it answers with ten true/false values
-- and never a name, phone, e-mail, message, id or count. THE E-MAIL IS NEVER RETURNED, RAISED, NOTICED, LOGGED OR STORED: the account's
-- address is compared inside one SELECT and only the yes/no results are kept; no message in this function mentions either address.
--
-- THE MATCH: lower-case, with spaces, tabs and line breaks trimmed from both ends, of the account's e-mail equals the same of the
-- given one. A NULL, empty or blank given address never matches; an account without an address never matches.
-- THE NEW ANSWERS: account_linked (the enquiry has a user_id AND an auth.users row with that id exists), account_has_email (that
-- account has a non-blank e-mail), email_matches_account. The answer is ok only when the existing checks hold AND the e-mail matches.
-- An enquiry whose user_id is NULL (already wiped, or the account was deleted) has no account to match: refused, nothing changes.
-- That includes a second apply on a wiped enquiry: it is now refused instead of reported as "already wiped".
-- Everything else is exactly 20261243: valid reference, found, is_test (always refused), settled (sent / rejected / failed / mock),
-- FOR UPDATE on apply, the UPDATE wipes name, phone, email, message, user_id, keeps an earlier pii_wiped_at, never names status.
--
-- ASSERTIONS INSIDE (one transaction): pre-flight, the function's shape (exactly one overload, the (text, boolean) signature gone,
-- SECURITY DEFINER, search_path empty, owner-only plus service_role EXECUTE with a positive control, body anchors, no RAISE in the
-- body), and a behaviour probe whose rows all roll back. The probe INSERTS NOTHING into auth.users (that would fire the profile
-- trigger): it borrows one existing account that has a plain-ASCII e-mail and points probe enquiries at its id; if none does it
-- stops with a plain message and nothing is applied. It PRINTS no ids, no counts, no e-mail. Probe references ADA-9000000301 to 306
-- are far beyond the sequence, so public.dovec_lead_external_seq is not touched.
--
-- ROLLBACK (by hand, as a new migration, only if ever needed): DROP FUNCTION public.dovec_lead_forget(text, text, boolean); re-create
-- the 20261243 function; delete this file's schema_migrations_applied row. Data already wiped through it stays wiped.
--
-- Apply: gh workflow run supabase-migrate -f file=20261244_dovec_lead_forget_email.sql (dry), then -f apply=true.
SET ROLE postgres;
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ─── Pre-flight ─────────────────────────────────────────────────────────────
DO $$
DECLARE v_col text;
BEGIN
  IF to_regclass('public.dovec_leads') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: 20261229 (dovec_leads) is not applied. Nothing applied.';
  END IF;
  FOREACH v_col IN ARRAY ARRAY['name','phone','email','message','user_id','pii_wiped_at','is_test','status','external_id',
                               'status_changed_at','undelivered_notified_at','send_live'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.dovec_leads'::regclass AND attname = v_col AND NOT attisdropped) THEN
      RAISE EXCEPTION 'REFUSING: dovec_leads.% is missing (20261229 / 20261241 / 20261242 not all applied). Nothing applied.', v_col;
    END IF;
  END LOOP;
  IF to_regclass('auth.users') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('auth.users') AND attname = 'email' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'REFUSING: auth.users.email is missing. Nothing applied.';
  END IF;
  IF to_regclass('public.notifications') IS NULL OR to_regclass('public.push_log') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: public.notifications / public.push_log is missing. Nothing applied.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.dovec_leads'::regclass AND tgname = 'dovec_leads_stamp_status' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'REFUSING: 20261241 (trigger dovec_leads_stamp_status) is not applied. Nothing applied.';
  END IF;
END $$;

-- ─── 1. The function ────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.dovec_lead_forget(text, boolean);

CREATE OR REPLACE FUNCTION public.dovec_lead_forget(p_reference text, p_email text, p_apply boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_apply    boolean := COALESCE(p_apply, false);
  v_ws       text := E' \t\r\n';
  v_valid    boolean := false;
  v_id       bigint;
  v_uid      uuid;
  v_test     boolean;
  v_status   text;
  v_clean    boolean;
  v_found    boolean;
  v_is_test  boolean;
  v_settled  boolean;
  v_already  boolean;
  v_linked   boolean;
  v_has_mail boolean;
  v_match    boolean;
  v_ok       boolean;
  v_wiped    boolean := false;
BEGIN
  v_valid := p_reference IS NOT NULL AND p_reference ~ '^ADA-[0-9]+$';
  IF v_valid THEN
    IF v_apply THEN
      SELECT l.id, l.user_id, l.is_test, l.status,
             (l.pii_wiped_at IS NOT NULL AND l.name IS NULL AND l.phone IS NULL AND l.email IS NULL AND l.message IS NULL AND l.user_id IS NULL)
        INTO v_id, v_uid, v_test, v_status, v_clean
        FROM public.dovec_leads l WHERE l.external_id = p_reference FOR UPDATE;
    ELSE
      SELECT l.id, l.user_id, l.is_test, l.status,
             (l.pii_wiped_at IS NOT NULL AND l.name IS NULL AND l.phone IS NULL AND l.email IS NULL AND l.message IS NULL AND l.user_id IS NULL)
        INTO v_id, v_uid, v_test, v_status, v_clean
        FROM public.dovec_leads l WHERE l.external_id = p_reference;
    END IF;
  END IF;

  v_found   := v_id IS NOT NULL;
  v_is_test := COALESCE(v_test, false);
  v_settled := v_found AND COALESCE(v_status = ANY (ARRAY['sent','rejected','failed','mock']::text[]), false);
  v_already := v_found AND COALESCE(v_clean, false);

  IF v_found AND v_uid IS NOT NULL THEN
    SELECT true,
           u.email IS NOT NULL AND btrim(u.email, v_ws) <> '',
           COALESCE(lower(btrim(u.email, v_ws)) = lower(btrim(p_email, v_ws)) AND btrim(p_email, v_ws) <> '', false)
      INTO v_linked, v_has_mail, v_match
      FROM auth.users u WHERE u.id = v_uid;
  END IF;
  v_linked   := COALESCE(v_linked, false);
  v_has_mail := COALESCE(v_has_mail, false);
  v_match    := COALESCE(v_match, false) AND v_has_mail;

  v_ok      := v_valid AND v_found AND NOT v_is_test AND v_settled AND v_match;

  IF v_apply AND v_ok AND NOT v_already THEN
    UPDATE public.dovec_leads
       SET name = NULL, phone = NULL, email = NULL, message = NULL, user_id = NULL,
           pii_wiped_at = COALESCE(pii_wiped_at, now())
     WHERE id = v_id;
    v_wiped := true;
  END IF;

  RETURN jsonb_build_object(
    'valid_reference',       v_valid,
    'found',                 v_found,
    'is_test',               v_is_test,
    'settled',               v_settled,
    'account_linked',        v_linked,
    'account_has_email',     v_has_mail,
    'email_matches_account', v_match,
    'already_wiped',         v_already,
    'wiped',                 v_wiped,
    'applied',               v_apply AND v_ok
  );
END;
$function$;

COMMENT ON FUNCTION public.dovec_lead_forget(text, text, boolean) IS
  'Forget ONE Döveç enquiry by reference ADA-n, only when the given e-mail matches (lower-cased, trimmed) the e-mail of the account that sent it: name, phone, email, message, user_id to NULL, pii_wiped_at stamped; nothing else changes (status never touched). p_apply false = faithful dry run (no lock, no write). Refuses malformed references, the test enquiry, unsettled (pending/retry) rows, an enquiry with no linked account, and a non-matching or blank e-mail; answers ten booleans only, never an e-mail. service_role only, run by the dovec-lead-forget workflow after Berke approves. 20261244 (replaces the 20261243 two-argument form).';

REVOKE ALL ON FUNCTION public.dovec_lead_forget(text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dovec_lead_forget(text, text, boolean) TO service_role;

-- ─── 2. The function's shape ────────────────────────────────────────────────
DO $$
DECLARE
  v_oid  oid := to_regprocedure('public.dovec_lead_forget(text,text,boolean)');
  v_n    int;
  v_def  text;
  v_upd  text;
BEGIN
  IF v_oid IS NULL THEN RAISE EXCEPTION 'dovec_lead_forget(text, text, boolean) does not exist'; END IF;
  SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'dovec_lead_forget';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'there are % overloads of dovec_lead_forget, expected exactly 1', v_n; END IF;
  IF to_regprocedure('public.dovec_lead_forget(text,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'the two-argument dovec_lead_forget(text, boolean) still exists';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_oid AND prosecdef AND proowner = 'postgres'::regrole AND prorettype = 'jsonb'::regtype) THEN
    RAISE EXCEPTION 'dovec_lead_forget is not a SECURITY DEFINER function owned by postgres returning jsonb';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_oid AND proconfig = ARRAY['search_path=""']) THEN
    RAISE EXCEPTION 'dovec_lead_forget does not have search_path pinned to empty (proconfig = %)', (SELECT proconfig::text FROM pg_proc WHERE oid = v_oid);
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'dovec_lead_forget is EXECUTE-able by anon or authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_oid AND a.privilege_type = 'EXECUTE' AND a.grantee = 0) THEN
    RAISE EXCEPTION 'dovec_lead_forget is EXECUTE-able by PUBLIC';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_oid AND a.privilege_type = 'EXECUTE'
                AND a.grantee IS DISTINCT FROM p.proowner AND a.grantee IS DISTINCT FROM 'service_role'::regrole::oid) THEN
    RAISE EXCEPTION 'dovec_lead_forget is EXECUTE-able by a role other than its owner and service_role';
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'positive control failed: service_role cannot execute dovec_lead_forget';
  END IF;
  v_def := pg_get_functiondef(v_oid);
  IF strpos(v_def, 'FOR UPDATE') = 0 OR strpos(v_def, 'p_reference ~ ''^ADA-[0-9]+$''') = 0
     OR strpos(v_def, 'NOT v_is_test') = 0 OR strpos(v_def, '''sent'',''rejected'',''failed'',''mock''') = 0 THEN
    RAISE EXCEPTION 'dovec_lead_forget body lost its row lock, reference check, is_test refusal or settled list';
  END IF;
  IF strpos(v_def, 'lower(btrim(p_email') = 0 OR strpos(v_def, 'AND v_settled AND v_match') = 0 THEN
    RAISE EXCEPTION 'dovec_lead_forget body lost its e-mail comparison or the requirement that it matches';
  END IF;
  IF strpos(v_def, 'RAISE') > 0 THEN
    RAISE EXCEPTION 'dovec_lead_forget body must not raise or notice anything (it holds an e-mail address)';
  END IF;
  v_upd := substr(v_def, position('UPDATE public.dovec_leads' IN v_def),
                  position('WHERE id = v_id' IN v_def) - position('UPDATE public.dovec_leads' IN v_def));
  IF v_upd = '' OR v_upd ~ 'status' OR strpos(v_upd, 'user_id = NULL') = 0 OR strpos(v_upd, 'COALESCE(pii_wiped_at, now())') = 0 THEN
    RAISE EXCEPTION 'dovec_lead_forget UPDATE is not the agreed one (it must wipe the five fields, keep pii_wiped_at, never mention status)';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'dovec_leads') IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'dovec_leads has a policy: it must stay RLS on with zero policies';
  END IF;
END $$;

-- ─── 3. Behaviour: probe rows, ALL rolled back ──────────────────────────────
DO $$
DECLARE
  v_proj   text;
  v_uid    uuid;
  v_mail   text;
  v_refs   jsonb := '{}'::jsonb;
  v_r      jsonb;
  v_ref    text;
  v_snap   text;
  v_snap2  text;
  v_kept   jsonb;
  v_kept2  jsonb;
  v_ctid   tid;
  v_ctid2  tid;
  v_notif  bigint; v_push bigint; v_notif2 bigint; v_push2 bigint;
  v_t1     text; v_t1_snap text;
  v_n      int;
  v_key    text;
  v_given  text;
  lbl      text;
  mk       text;
  v_num    int;
  v_base   jsonb := '{"valid_reference":true,"found":true,"is_test":false,"settled":true,"account_linked":true,"account_has_email":true,
                      "email_matches_account":false,"already_wiped":false,"wiped":false,"applied":false}'::jsonb;
  v_match  jsonb := '{"email_matches_account":true}'::jsonb;
BEGIN
  SELECT id INTO v_proj FROM public.dovec_projects ORDER BY id LIMIT 1;
  IF v_proj IS NULL THEN RAISE EXCEPTION 'need one dovec_projects row to run the behaviour probe with'; END IF;
  SELECT u.id, u.email INTO v_uid, v_mail FROM auth.users u WHERE u.email IS NOT NULL AND u.email ~ '^[!-~]+$' ORDER BY u.id LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'REFUSING: no account has a plain-ASCII e-mail yet, so the e-mail match cannot be probed against a real account (the probe borrows one and inserts nothing into auth.users). Nothing applied.';
  END IF;

  BEGIN
    SELECT count(*) INTO v_notif FROM public.notifications;
    SELECT count(*) INTO v_push  FROM public.push_log;
    SELECT l::text INTO v_t1_snap FROM public.dovec_leads l WHERE l.external_id = 'TEST-1';

    FOR lbl, mk, v_num IN SELECT * FROM (VALUES
        ('m1', 'sent', 1), ('m2', 'mock', 2), ('pending', 'pending', 3), ('nouser', 'sent', 4), ('ghost', 'sent', 5), ('m6', 'failed', 6)) x(l, m, n) LOOP
      INSERT INTO public.dovec_leads (external_id, client_request_id, payload_hash, project_id, name, phone, email, message, language, language_code, consent,
                                      consent_text_version, status, user_id, attempts, send_live)
      VALUES ('ADA-90000003' || lpad(v_num::text, 2, '0'), gen_random_uuid(), repeat('d', 64), v_proj, 'Probe', '+441234567890', 'probe@example.invalid', 'probe message',
              'English', 'en', true, 'probe-forget-email', mk,
              CASE lbl WHEN 'nouser' THEN NULL ELSE gen_random_uuid() END, 2, true)
      RETURNING external_id INTO v_ref;
      v_refs := v_refs || jsonb_build_object(lbl, v_ref);
    END LOOP;
    -- inserted under random ids (the per-person send limit counts a real account's earlier enquiries), then pointed at the borrowed account
    UPDATE public.dovec_leads SET user_id = v_uid WHERE consent_text_version = 'probe-forget-email' AND external_id IN (SELECT value FROM jsonb_each_text(v_refs - 'nouser' - 'ghost'));
    UPDATE public.dovec_leads SET status_changed_at = now() - interval '3 days' WHERE consent_text_version = 'probe-forget-email';

    -- (a) the right address, dry: faithful answer, nothing changes (whole row compared as text, never printed)
    v_ref := v_refs ->> 'm1';
    SELECT l::text INTO v_snap FROM public.dovec_leads l WHERE l.external_id = v_ref;
    v_r := public.dovec_lead_forget(v_ref, v_mail, false);
    IF v_r IS DISTINCT FROM v_base || v_match THEN RAISE EXCEPTION 'dry run with the right e-mail: answer is wrong: %', v_r; END IF;
    IF v_r::text ~* '@' THEN RAISE EXCEPTION 'an answer carries an e-mail address'; END IF;
    FOR v_key IN SELECT jsonb_object_keys(v_r) LOOP
      IF jsonb_typeof(v_r -> v_key) IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'answer key % is not a boolean', v_key; END IF;
    END LOOP;
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_r) k) IS DISTINCT FROM
       ARRAY['account_has_email','account_linked','already_wiped','applied','email_matches_account','found','is_test','settled','valid_reference','wiped'] THEN
      RAISE EXCEPTION 'answer keys are not the agreed ten';
    END IF;
    -- (b) upper-cased, with spaces and tabs around it
    v_r := public.dovec_lead_forget(v_ref, E' \t ' || upper(v_mail) || E'\t  ', false);
    IF v_r IS DISTINCT FROM v_base || v_match THEN RAISE EXCEPTION 'upper-cased, padded e-mail does not match: %', v_r; END IF;
    -- (c) a different address, NULL, empty, blank: no match, dry and apply, the row unchanged
    FOREACH v_given IN ARRAY ARRAY['x' || v_mail, v_mail || '.uk', '%', '', '   ', E'\t\t'] LOOP
      v_r := public.dovec_lead_forget(v_ref, v_given, true);
      IF v_r IS DISTINCT FROM v_base THEN RAISE EXCEPTION 'a non-matching e-mail was not refused: %', v_r; END IF;
    END LOOP;
    v_r := public.dovec_lead_forget(v_ref, NULL, true);
    IF v_r IS DISTINCT FROM v_base THEN RAISE EXCEPTION 'a NULL e-mail was not refused: %', v_r; END IF;
    v_r := public.dovec_lead_forget(v_ref, NULL, false);
    IF v_r IS DISTINCT FROM v_base THEN RAISE EXCEPTION 'a NULL e-mail was not refused in the dry run: %', v_r; END IF;
    SELECT l::text INTO v_snap2 FROM public.dovec_leads l WHERE l.external_id = v_ref;
    IF v_snap2 IS DISTINCT FROM v_snap THEN RAISE EXCEPTION 'a refused or dry call changed the row'; END IF;
    v_r := public.dovec_lead_forget(v_ref, v_mail);
    IF (v_r ->> 'wiped')::boolean OR (v_r ->> 'applied')::boolean THEN RAISE EXCEPTION 'p_apply must default to false'; END IF;
    v_r := public.dovec_lead_forget(v_ref, v_mail, NULL);
    IF (v_r ->> 'wiped')::boolean OR (v_r ->> 'applied')::boolean THEN RAISE EXCEPTION 'p_apply NULL must behave as false'; END IF;

    -- (d) apply on a match: the five fields go, every other column is untouched
    v_ref := v_refs ->> 'm2';
    SELECT to_jsonb(l) - 'name' - 'phone' - 'email' - 'message' - 'user_id' - 'pii_wiped_at' INTO v_kept FROM public.dovec_leads l WHERE l.external_id = v_ref;
    v_r := public.dovec_lead_forget(v_ref, upper(v_mail), true);
    IF v_r IS DISTINCT FROM v_base || v_match || '{"wiped":true,"applied":true}'::jsonb THEN RAISE EXCEPTION 'apply with a matching e-mail: answer is wrong: %', v_r; END IF;
    SELECT to_jsonb(l) - 'name' - 'phone' - 'email' - 'message' - 'user_id' - 'pii_wiped_at' INTO v_kept2 FROM public.dovec_leads l WHERE l.external_id = v_ref;
    IF v_kept2 IS DISTINCT FROM v_kept THEN RAISE EXCEPTION 'apply changed a column it must never touch'; END IF;
    SELECT count(*) INTO v_n FROM public.dovec_leads l WHERE l.external_id = v_ref
       AND l.name IS NULL AND l.phone IS NULL AND l.email IS NULL AND l.message IS NULL AND l.user_id IS NULL AND l.pii_wiped_at IS NOT NULL;
    IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'apply did not wipe all five fields and stamp pii_wiped_at'; END IF;
    SELECT count(*) INTO v_n FROM public.dovec_leads l WHERE l.external_id = v_ref AND l.status_changed_at < now() - interval '2 days'
       AND l.status = 'mock' AND l.attempts = 2 AND l.send_live;
    IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'apply moved status, status_changed_at, attempts or send_live'; END IF;

    -- (e) a second apply on the wiped row: refused (no account any more), and no UPDATE at all
    SELECT l.ctid, l::text INTO v_ctid, v_snap FROM public.dovec_leads l WHERE l.external_id = v_ref;
    v_r := public.dovec_lead_forget(v_ref, v_mail, true);
    IF v_r IS DISTINCT FROM '{"valid_reference":true,"found":true,"is_test":false,"settled":true,"account_linked":false,"account_has_email":false,
                              "email_matches_account":false,"already_wiped":true,"wiped":false,"applied":false}'::jsonb THEN
      RAISE EXCEPTION 'second apply answer is wrong: %', v_r;
    END IF;
    SELECT l.ctid, l::text INTO v_ctid2, v_snap2 FROM public.dovec_leads l WHERE l.external_id = v_ref;
    IF v_ctid2 IS DISTINCT FROM v_ctid OR v_snap2 IS DISTINCT FROM v_snap THEN RAISE EXCEPTION 'a refused second apply issued an UPDATE'; END IF;

    -- (f) user_id NULL, and a user id with no account: refused, untouched
    FOREACH lbl IN ARRAY ARRAY['nouser', 'ghost'] LOOP
      v_ref := v_refs ->> lbl;
      SELECT l::text INTO v_snap FROM public.dovec_leads l WHERE l.external_id = v_ref;
      v_r := public.dovec_lead_forget(v_ref, v_mail, true);
      IF v_r IS DISTINCT FROM '{"valid_reference":true,"found":true,"is_test":false,"settled":true,"account_linked":false,"account_has_email":false,
                                "email_matches_account":false,"already_wiped":false,"wiped":false,"applied":false}'::jsonb THEN
        RAISE EXCEPTION 'a % enquiry was not refused as unlinked: %', lbl, v_r;
      END IF;
      SELECT l::text INTO v_snap2 FROM public.dovec_leads l WHERE l.external_id = v_ref;
      IF v_snap2 IS DISTINCT FROM v_snap THEN RAISE EXCEPTION 'a % enquiry was changed by a refused call', lbl; END IF;
    END LOOP;

    -- (g) pending with the right address: refused as unsettled, untouched
    v_ref := v_refs ->> 'pending';
    SELECT l::text INTO v_snap FROM public.dovec_leads l WHERE l.external_id = v_ref;
    v_r := public.dovec_lead_forget(v_ref, v_mail, true);
    IF (v_r ->> 'settled')::boolean OR (v_r ->> 'applied')::boolean OR (v_r ->> 'wiped')::boolean THEN RAISE EXCEPTION 'a pending enquiry was not refused: %', v_r; END IF;
    SELECT l::text INTO v_snap2 FROM public.dovec_leads l WHERE l.external_id = v_ref;
    IF v_snap2 IS DISTINCT FROM v_snap THEN RAISE EXCEPTION 'a pending enquiry was changed by a refused call'; END IF;

    -- (h) malformed references, NULL, the test enquiry and an unknown reference: refused, nothing read or changed
    FOREACH v_ref IN ARRAY ARRAY['ADA-', 'ADA-x', 'ada-1', ' ADA-1', E'ADA-1\n', 'ADA-1;--', 'TEST-1', '', 'ADA--1'] LOOP
      v_r := public.dovec_lead_forget(v_ref, v_mail, true);
      IF v_r IS DISTINCT FROM '{"valid_reference":false,"found":false,"is_test":false,"settled":false,"account_linked":false,"account_has_email":false,
                                "email_matches_account":false,"already_wiped":false,"wiped":false,"applied":false}'::jsonb THEN
        RAISE EXCEPTION 'a malformed reference was not refused outright: %', v_r;
      END IF;
    END LOOP;
    v_r := public.dovec_lead_forget(NULL, v_mail, true);
    IF (v_r ->> 'valid_reference')::boolean OR (v_r ->> 'wiped')::boolean THEN RAISE EXCEPTION 'NULL reference was not refused'; END IF;
    v_r := public.dovec_lead_forget('ADA-99999999999999999999', v_mail, true);
    IF (v_r ->> 'found')::boolean OR (v_r ->> 'wiped')::boolean THEN RAISE EXCEPTION 'an unknown reference was not answered found=false: %', v_r; END IF;
    SELECT l::text INTO v_t1 FROM public.dovec_leads l WHERE l.external_id = 'TEST-1';
    IF v_t1 IS DISTINCT FROM v_t1_snap THEN RAISE EXCEPTION 'the test enquiry row was changed'; END IF;

    -- (i) the function writes no notification and no push_log row
    SELECT count(*) INTO v_notif2 FROM public.notifications;
    SELECT count(*) INTO v_push2  FROM public.push_log;
    IF v_notif2 IS DISTINCT FROM v_notif OR v_push2 IS DISTINCT FROM v_push THEN
      RAISE EXCEPTION 'dovec_lead_forget wrote to notifications or push_log';
    END IF;

    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  SELECT count(*) INTO v_n FROM public.dovec_leads WHERE consent_text_version = 'probe-forget-email';
  IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'the probe left % leads behind', v_n; END IF;
  RAISE NOTICE '20261244 OK: dovec_lead_forget(reference, e-mail, apply) exists (definer, empty search_path, service_role only, two-argument form gone), behaviour probe rolled back';
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
VALUES ('20261244_dovec_lead_forget_email.sql', 'd843b59d21a71a27dbae1b5c302c1c850d2263216237f71426e4b1fc62f6eceb')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

NOTIFY pgrst, 'reload schema';
