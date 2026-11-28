-- ═════════════════════════════════════════════════════════════════
-- 20261243 — Döveç: forget ONE enquiry by its reference (the privacy policy's "early deletion on request")
-- ═════════════════════════════════════════════════════════════════
--
-- WHAT, IN PLAIN ENGLISH
-- The privacy policy promises that a person can ask for their Döveç enquiry to be deleted before the 90-day wipe. This adds the
-- one database function that does it for a single enquiry, found by its reference ("ADA-<number>", the number the person was
-- shown): public.dovec_lead_forget(p_reference text, p_apply boolean DEFAULT false) RETURNS jsonb.
-- It is run only by the workflow dovec-lead-forget, which waits for Berke's approval in the `production-db` environment. Berke
-- checks by hand that the requester is the person who sent the enquiry; the function takes the reference and nothing else.
--
-- WHO CAN CALL IT: the owner and service_role (the workflow, over PostgREST RPC with the service key). Not PUBLIC, not anon,
-- not authenticated (guests included). Nobody can read dovec_leads through it: it answers with seven true/false values and never a
-- name, phone, e-mail, message, id or count.
--
-- WHAT IT CHANGES (only with p_apply = true, only on a SETTLED enquiry of a real person): on that one row name, phone, email,
-- message and user_id become NULL and pii_wiped_at is stamped (kept if it was already set). The row itself stays, so counts survive,
-- exactly as the 90-day wipe (dovec_leads_wipe_pii) and the account-deletion trigger leave it.
-- WHAT IT NEVER CHANGES: status, status_changed_at, undelivered_notified_at, send_live, external_id, project, unit type, language,
-- consent columns, dates, attempts, last_http_status, next_attempt_at, sent_at. The column list of its UPDATE has no `status`, so
-- the stamp trigger (UPDATE OF status) cannot fire and the health watchdog and the undelivered-notice job see nothing new.
--
-- REFUSALS come back as true/false values, not errors, so the workflow log can print them:
--   valid_reference false : not exactly ^ADA-[0-9]+$ (or NULL). Nothing else is read. TEST-1 fails this on purpose.
--   found false           : no enquiry has that reference.
--   is_test true          : the agreed test enquiry (never a third party's data; the 90-day wipe still covers it). Always refused.
--   settled false         : status pending or retry. The send can still happen (supabase/functions/dovec-lead retry path), so
--                           wiping now would send an empty enquiry, and settling it to 'failed' would raise the watchdog's failed
--                           alert. Wait until it is sent / rejected / failed / mock, then run it again. Row untouched.
--   already_wiped true    : pii_wiped_at is set and all five fields are already NULL: no UPDATE is issued at all.
-- A row whose pii_wiped_at is set but where some field is still filled gets the remainder wiped; its original pii_wiped_at is kept.
-- A row whose user_id is already NULL (deleted account) is wiped by reference like any other.
--
-- DRY AND APPLY ARE THE SAME FUNCTION: p_apply = false runs every check and reads the row WITHOUT locking or changing it, so the dry
-- run is a faithful preview. p_apply = true locks the row (FOR UPDATE, so the retry path cannot claim it between check and wipe),
-- re-checks, then wipes. Personal fields are never loaded into the function: it reads ids, flags and the status word only.
--
-- ASSERTIONS INSIDE (one transaction): pre-flight, the function's shape (SECURITY DEFINER, search_path empty, owner-only plus
-- service_role EXECUTE, nothing for PUBLIC / anon / authenticated, with a positive control for service_role), and a behaviour
-- probe whose rows all roll back. PRINTS no user ids and no counts. The probe inserts rows under random user ids (dovec_leads.user_id
-- has no foreign key) and gives each its own explicit reference ADA-9000000201 to 208 (far beyond the sequence, so
-- public.dovec_lead_external_seq is not touched and the ADA-n numbers show no gap). Nothing is written to notifications or push_log by the function; the probe proves it by comparing counts.
--
-- ROLLBACK (by hand, as a new migration, only if ever needed): DROP FUNCTION public.dovec_lead_forget(text, boolean); delete this
-- file's schema_migrations_applied row. Data already wiped through it stays wiped (that is the point).
--
-- Apply: gh workflow run supabase-migrate -f file=20261243_dovec_lead_forget.sql (dry), then -f apply=true.
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
  IF to_regclass('public.notifications') IS NULL OR to_regclass('public.push_log') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: public.notifications / public.push_log is missing. Nothing applied.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.dovec_leads'::regclass AND tgname = 'dovec_leads_stamp_status' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'REFUSING: 20261241 (trigger dovec_leads_stamp_status) is not applied. Nothing applied.';
  END IF;
END $$;

-- ─── 1. The function ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dovec_lead_forget(p_reference text, p_apply boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_apply   boolean := COALESCE(p_apply, false);
  v_valid   boolean := false;
  v_id      bigint;
  v_test    boolean;
  v_status  text;
  v_clean   boolean;
  v_found   boolean;
  v_is_test boolean;
  v_settled boolean;
  v_already boolean;
  v_ok      boolean;
  v_wiped   boolean := false;
BEGIN
  v_valid := p_reference IS NOT NULL AND p_reference ~ '^ADA-[0-9]+$';
  IF v_valid THEN
    IF v_apply THEN
      SELECT l.id, l.is_test, l.status,
             (l.pii_wiped_at IS NOT NULL AND l.name IS NULL AND l.phone IS NULL AND l.email IS NULL AND l.message IS NULL AND l.user_id IS NULL)
        INTO v_id, v_test, v_status, v_clean
        FROM public.dovec_leads l WHERE l.external_id = p_reference FOR UPDATE;
    ELSE
      SELECT l.id, l.is_test, l.status,
             (l.pii_wiped_at IS NOT NULL AND l.name IS NULL AND l.phone IS NULL AND l.email IS NULL AND l.message IS NULL AND l.user_id IS NULL)
        INTO v_id, v_test, v_status, v_clean
        FROM public.dovec_leads l WHERE l.external_id = p_reference;
    END IF;
  END IF;

  v_found   := v_id IS NOT NULL;
  v_is_test := COALESCE(v_test, false);
  v_settled := v_found AND COALESCE(v_status = ANY (ARRAY['sent','rejected','failed','mock']::text[]), false);
  v_already := v_found AND COALESCE(v_clean, false);
  v_ok      := v_valid AND v_found AND NOT v_is_test AND v_settled;

  IF v_apply AND v_ok AND NOT v_already THEN
    UPDATE public.dovec_leads
       SET name = NULL, phone = NULL, email = NULL, message = NULL, user_id = NULL,
           pii_wiped_at = COALESCE(pii_wiped_at, now())
     WHERE id = v_id;
    v_wiped := true;
  END IF;

  RETURN jsonb_build_object(
    'valid_reference', v_valid,
    'found',           v_found,
    'is_test',         v_is_test,
    'settled',         v_settled,
    'already_wiped',   v_already,
    'wiped',           v_wiped,
    'applied',         v_apply AND v_ok
  );
END;
$function$;

COMMENT ON FUNCTION public.dovec_lead_forget(text, boolean) IS
  'Forget ONE Döveç enquiry by reference ADA-n: name, phone, email, message, user_id to NULL, pii_wiped_at stamped; nothing else changes (status never touched). p_apply false = faithful dry run (no lock, no write). Refuses malformed references, the test enquiry, and unsettled (pending/retry) rows; answers booleans only. service_role only, run by the dovec-lead-forget workflow after Berke approves. 20261243.';

REVOKE ALL ON FUNCTION public.dovec_lead_forget(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dovec_lead_forget(text, boolean) TO service_role;

-- ─── 2. The function's shape ────────────────────────────────────────────────
DO $$
DECLARE
  v_oid  oid := to_regprocedure('public.dovec_lead_forget(text,boolean)');
  v_n    int;
  v_def  text;
  v_upd  text;
BEGIN
  IF v_oid IS NULL THEN RAISE EXCEPTION 'dovec_lead_forget(text, boolean) does not exist'; END IF;
  SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'dovec_lead_forget';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'there are % overloads of dovec_lead_forget, expected exactly 1', v_n; END IF;
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
  lbl      text;
  mk       text;
  v_num    int;
  v_key    text;
BEGIN
  SELECT id INTO v_proj FROM public.dovec_projects ORDER BY id LIMIT 1;
  IF v_proj IS NULL THEN RAISE EXCEPTION 'need one dovec_projects row to run the behaviour probe with'; END IF;

  BEGIN
    SELECT count(*) INTO v_notif FROM public.notifications;
    SELECT count(*) INTO v_push  FROM public.push_log;
    SELECT l::text INTO v_t1_snap FROM public.dovec_leads l WHERE l.external_id = 'TEST-1';

    FOR lbl, mk, v_num IN SELECT * FROM (VALUES
        ('sent',    'sent',    1), ('mock',  'mock',  2), ('rejected', 'rejected', 3), ('failed', 'failed', 4),
        ('pending', 'pending', 5), ('retry', 'retry', 6), ('remainder', 'sent',    7), ('nouser', 'sent',   8)) x(l, m, n) LOOP
      INSERT INTO public.dovec_leads (external_id, client_request_id, payload_hash, project_id, name, phone, email, message, language, language_code, consent,
                                      consent_text_version, status, user_id, attempts, send_live, undelivered_notified_at,
                                      pii_wiped_at)
      VALUES ('ADA-90000002' || lpad(v_num::text, 2, '0'), gen_random_uuid(), repeat('d', 64), v_proj, 'Probe', '+441234567890', 'probe@example.invalid', 'probe message',
              'English', 'en', true, 'probe-forget', mk,
              CASE lbl WHEN 'nouser' THEN NULL ELSE gen_random_uuid() END, 2, true,
              CASE lbl WHEN 'rejected' THEN now() - interval '1 day' ELSE NULL END,
              CASE lbl WHEN 'remainder' THEN now() - interval '5 days' ELSE NULL END)
      RETURNING external_id INTO v_ref;
      v_refs := v_refs || jsonb_build_object(lbl, v_ref);
    END LOOP;
    -- a status time that is deliberately not "now" and not created_at, so a restamp would show
    UPDATE public.dovec_leads SET status_changed_at = now() - interval '3 days' WHERE consent_text_version = 'probe-forget';

    -- (a) dry run on a settled row: faithful answer, nothing changes (the whole row, compared as text, never printed)
    v_ref := v_refs ->> 'sent';
    SELECT l::text INTO v_snap FROM public.dovec_leads l WHERE l.external_id = v_ref;
    v_r := public.dovec_lead_forget(v_ref, false);
    IF v_r IS DISTINCT FROM jsonb_build_object('valid_reference', true, 'found', true, 'is_test', false, 'settled', true,
                                               'already_wiped', false, 'wiped', false, 'applied', false) THEN
      RAISE EXCEPTION 'dry run answer is wrong: %', v_r;
    END IF;
    SELECT l::text INTO v_snap2 FROM public.dovec_leads l WHERE l.external_id = v_ref;
    IF v_snap2 IS DISTINCT FROM v_snap THEN RAISE EXCEPTION 'a dry run changed the row'; END IF;
    v_r := public.dovec_lead_forget(v_ref);
    IF (v_r ->> 'wiped')::boolean OR (v_r ->> 'applied')::boolean THEN RAISE EXCEPTION 'p_apply must default to false'; END IF;
    v_r := public.dovec_lead_forget(v_ref, NULL);
    IF (v_r ->> 'wiped')::boolean OR (v_r ->> 'applied')::boolean THEN RAISE EXCEPTION 'p_apply NULL must behave as false'; END IF;

    -- (b) every key is a boolean and the key set is exactly the seven agreed names (no field value can leak)
    FOR v_key IN SELECT jsonb_object_keys(v_r) LOOP
      IF jsonb_typeof(v_r -> v_key) IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'answer key % is not a boolean', v_key; END IF;
    END LOOP;
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_r) k) IS DISTINCT FROM
       ARRAY['already_wiped','applied','found','is_test','settled','valid_reference','wiped'] THEN
      RAISE EXCEPTION 'answer keys are not the agreed seven';
    END IF;

    -- (c) apply on each settled status: the five fields go, every other column is untouched, status and its time included
    FOREACH lbl IN ARRAY ARRAY['sent','mock','rejected','failed'] LOOP
      v_ref := v_refs ->> lbl;
      SELECT to_jsonb(l) - 'name' - 'phone' - 'email' - 'message' - 'user_id' - 'pii_wiped_at' INTO v_kept FROM public.dovec_leads l WHERE l.external_id = v_ref;
      v_r := public.dovec_lead_forget(v_ref, true);
      IF v_r IS DISTINCT FROM jsonb_build_object('valid_reference', true, 'found', true, 'is_test', false, 'settled', true,
                                                 'already_wiped', false, 'wiped', true, 'applied', true) THEN
        RAISE EXCEPTION 'apply answer for a % row is wrong: %', lbl, v_r;
      END IF;
      SELECT to_jsonb(l) - 'name' - 'phone' - 'email' - 'message' - 'user_id' - 'pii_wiped_at' INTO v_kept2 FROM public.dovec_leads l WHERE l.external_id = v_ref;
      IF v_kept2 IS DISTINCT FROM v_kept THEN RAISE EXCEPTION 'apply on a % row changed a column it must never touch', lbl; END IF;
      SELECT count(*) INTO v_n FROM public.dovec_leads l WHERE l.external_id = v_ref
         AND l.name IS NULL AND l.phone IS NULL AND l.email IS NULL AND l.message IS NULL AND l.user_id IS NULL AND l.pii_wiped_at IS NOT NULL;
      IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'apply on a % row did not wipe all five fields and stamp pii_wiped_at', lbl; END IF;
      SELECT count(*) INTO v_n FROM public.dovec_leads l WHERE l.external_id = v_ref AND l.status_changed_at < now() - interval '2 days'
         AND l.status = lbl AND l.attempts = 2 AND l.send_live;
      IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'apply on a % row moved status, status_changed_at, attempts or send_live', lbl; END IF;
    END LOOP;

    -- (d) a second apply is a no-op: already_wiped, and no UPDATE at all (a new row version would move the ctid)
    v_ref := v_refs ->> 'sent';
    SELECT l.ctid, l::text INTO v_ctid, v_snap FROM public.dovec_leads l WHERE l.external_id = v_ref;
    v_r := public.dovec_lead_forget(v_ref, true);
    IF v_r IS DISTINCT FROM jsonb_build_object('valid_reference', true, 'found', true, 'is_test', false, 'settled', true,
                                               'already_wiped', true, 'wiped', false, 'applied', true) THEN
      RAISE EXCEPTION 'second apply answer is wrong: %', v_r;
    END IF;
    SELECT l.ctid, l::text INTO v_ctid2, v_snap2 FROM public.dovec_leads l WHERE l.external_id = v_ref;
    IF v_ctid2 IS DISTINCT FROM v_ctid OR v_snap2 IS DISTINCT FROM v_snap THEN RAISE EXCEPTION 'a second apply issued an UPDATE'; END IF;

    -- (e) pending and retry are refused and untouched, dry and apply
    FOREACH lbl IN ARRAY ARRAY['pending','retry'] LOOP
      v_ref := v_refs ->> lbl;
      SELECT l::text INTO v_snap FROM public.dovec_leads l WHERE l.external_id = v_ref;
      v_r := public.dovec_lead_forget(v_ref, true);
      IF v_r IS DISTINCT FROM jsonb_build_object('valid_reference', true, 'found', true, 'is_test', false, 'settled', false,
                                                 'already_wiped', false, 'wiped', false, 'applied', false) THEN
        RAISE EXCEPTION 'answer for a % row is wrong: %', lbl, v_r;
      END IF;
      v_r := public.dovec_lead_forget(v_ref, false);
      IF (v_r ->> 'settled')::boolean THEN RAISE EXCEPTION 'a % row reads as settled in the dry run', lbl; END IF;
      SELECT l::text INTO v_snap2 FROM public.dovec_leads l WHERE l.external_id = v_ref;
      IF v_snap2 IS DISTINCT FROM v_snap THEN RAISE EXCEPTION 'a % row was changed by a refused call', lbl; END IF;
    END LOOP;

    -- (f) pii_wiped_at already set but a field still filled: the remainder goes, the ORIGINAL stamp is kept
    v_ref := v_refs ->> 'remainder';
    SELECT l.pii_wiped_at::text INTO v_snap FROM public.dovec_leads l WHERE l.external_id = v_ref;
    v_r := public.dovec_lead_forget(v_ref, true);
    IF v_r IS DISTINCT FROM jsonb_build_object('valid_reference', true, 'found', true, 'is_test', false, 'settled', true,
                                               'already_wiped', false, 'wiped', true, 'applied', true) THEN
      RAISE EXCEPTION 'remainder answer is wrong: %', v_r;
    END IF;
    SELECT l.pii_wiped_at::text INTO v_snap2 FROM public.dovec_leads l WHERE l.external_id = v_ref;
    IF v_snap2 IS DISTINCT FROM v_snap THEN RAISE EXCEPTION 'the original pii_wiped_at was overwritten'; END IF;
    SELECT count(*) INTO v_n FROM public.dovec_leads l WHERE l.external_id = v_ref AND l.name IS NULL AND l.phone IS NULL AND l.email IS NULL AND l.message IS NULL;
    IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'the remainder was not wiped'; END IF;

    -- (g) a row whose user_id is already NULL (deleted account) is wiped by reference
    v_ref := v_refs ->> 'nouser';
    v_r := public.dovec_lead_forget(v_ref, true);
    IF (v_r ->> 'wiped')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'a row with no user_id was not wiped by reference: %', v_r; END IF;

    -- (h) malformed references, NULL, the test enquiry and an unknown reference: refused, nothing read or changed
    FOREACH v_ref IN ARRAY ARRAY['ADA-', 'ADA-x', 'ada-1', ' ADA-1', 'ADA-1 ', E'ADA-1\n', 'ADA-1;--', 'TEST-1', '', 'ADA--1', 'ADA-1.0'] LOOP
      v_r := public.dovec_lead_forget(v_ref, true);
      IF v_r IS DISTINCT FROM jsonb_build_object('valid_reference', false, 'found', false, 'is_test', false, 'settled', false,
                                                 'already_wiped', false, 'wiped', false, 'applied', false) THEN
        RAISE EXCEPTION 'a malformed reference was not refused outright: %', v_r;
      END IF;
    END LOOP;
    v_r := public.dovec_lead_forget(NULL, true);
    IF (v_r ->> 'valid_reference')::boolean OR (v_r ->> 'wiped')::boolean THEN RAISE EXCEPTION 'NULL reference was not refused'; END IF;
    v_r := public.dovec_lead_forget('ADA-99999999999999999999', true);
    IF v_r IS DISTINCT FROM jsonb_build_object('valid_reference', true, 'found', false, 'is_test', false, 'settled', false,
                                               'already_wiped', false, 'wiped', false, 'applied', false) THEN
      RAISE EXCEPTION 'an unknown reference was not answered found=false: %', v_r;
    END IF;
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

  SELECT count(*) INTO v_n FROM public.dovec_leads WHERE consent_text_version = 'probe-forget';
  IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'the probe left % leads behind', v_n; END IF;
  RAISE NOTICE '20261243 OK: dovec_lead_forget exists (definer, empty search_path, service_role only), behaviour probe rolled back';
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
VALUES ('20261243_dovec_lead_forget.sql', '18610ad542d8f01b9b09eb18f193601397aecb5570024b0bd16ad22cec6a9227')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

NOTIFY pgrst, 'reload schema';
