-- ═══════════════════════════════════════════════════════════════════════════
-- 20261197 — Yeme-İçme order status: an admin clears a PIN bucket's lock counters (capped, logged; PIN + devices untouched)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- DATABASE ONLY. Needs 20261194 (it refuses to run otherwise).
--
-- Why: a restaurant that hits the enrolment lock (5 / 10 / 30 failed PIN attempts) today can only be unlocked by issuing a NEW
-- PIN (admin_set_eatery_partner_pin), which also revokes every enrolled phone of that bucket. This function clears ONLY the
-- attempt counters of one bucket, so the restaurant can try its existing PIN again and its enrolled phones keep working.
--
-- Cap (Berke, 2026-11-13, after the security review): reset-then-guess in a loop would let an admin session (or a stolen admin
-- JWT) brute-force a PIN without anyone noticing. So a bucket can be reset at most 3 times in any rolling 24 hours, and every
-- reset is logged privately (who, which bucket, when). The 4th call in the window is refused (P0001 reset_limit) and changes
-- nothing. Log rows older than 90 days are deleted by the same function, so the log stays small without a new job.
--
-- (1) private.eatery_pin_resets: one row per successful reset (scope, partner, admin id, time). No PIN, no code, no IP.
-- (2) public.admin_reset_eatery_pin_attempts(p_partner uuid DEFAULT NULL, p_scope text DEFAULT 'partner') RETURNS jsonb
--   • Gate (same as admin_set_eatery_partner_pin): a signed-in, non-guest ADMIN; anything else = P0001 forbidden.
--   • Validation (same as eatery_pin_issue): scope 'partner' or 'test' (else invalid_scope); test => partner NULL, partner =>
--     an existing eatery_partners row (else invalid_partner).
--   • Takes the same per-bucket advisory lock as PIN issue and enrolment (so the cap count cannot race), refuses with
--     reset_limit when the bucket already has 3 resets in the last 24 hours, else prunes log rows over 90 days old, deletes the
--     bucket's rows from private.eatery_pin_attempts and logs the reset. Other buckets' attempts are NOT touched.
--   • Returns {status: 'ok', scope, partner_id}. No count, no PIN, no token.
--
-- ─── WHO CAN READ / WRITE WHAT ──────────────────────────────────────────────
--   • authenticated has EXECUTE, but the body refuses (P0001 forbidden) unless the caller is a non-guest admin: a customer, a
--     provider and a guest (even a guest session of an admin account) cannot clear counters. anon and PUBLIC have no EXECUTE.
--   • An admin can clear one bucket at most 3 times per rolling 24 hours; every clear is recorded with their user id.
--   • private.eatery_pin_resets: nobody through the API. All privileges revoked from PUBLIC, anon and authenticated BY NAME
--     (table and identity sequence), RLS on with ZERO policies. Only postgres (this file and the DEFINER function) writes it;
--     reading it is a database-side (postgres) query. It holds admin user ids, so it must never gain a policy or a grant.
--   • The function writes only private.eatery_pin_attempts (delete, one bucket) and private.eatery_pin_resets (insert one row,
--     delete rows over 90 days old). It never reads or writes the PIN or device tables and returns no row data.
--
-- PROOF (inside this file): pre-state (20261194 in the ledger, its objects present); post-state: the log table (RLS on, 0
-- policies, no client privilege on table / columns / sequence, no PUBLIC, CHECKs + index), the function (one overload, DEFINER,
-- owner postgres, search_path public, pg_temp, VOLATILE, authenticated EXECUTE, no anon / PUBLIC) and its body shape (gate,
-- lock, bucket-scoped cap BEFORE the attempts delete, the log insert, the 90-day prune, no PIN / device table). Behaviour
-- (buckets, the cap and its window, the prune, denials with positive controls) is proven in the harness:
-- scripts/test-eatery-order-status-sql.mjs. Nothing printed carries a count or an id.
--
-- Apply: gh workflow run supabase-migrate (dry), then apply=true after Berke's go. Re-runnable (IF NOT EXISTS / CREATE OR REPLACE;
-- the log keeps its rows).
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── Pre-state (abort before changing anything) ─────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.schema_migrations_applied') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.schema_migrations_applied WHERE filename = '20261194_eatery_order_status_partner.sql') THEN
    RAISE EXCEPTION 'pre-state: 20261194_eatery_order_status_partner.sql is not in the ledger. Nothing applied.';
  END IF;
  IF to_regclass('private.eatery_pin_attempts') IS NULL
     OR to_regclass('public.eatery_partners') IS NULL
     OR to_regprocedure('public.eatery_pin_issue(uuid,text)') IS NULL
     OR to_regprocedure('public.admin_set_eatery_partner_pin(uuid,text)') IS NULL
     OR to_regprocedure('public.is_admin()') IS NULL
     OR to_regprocedure('public.is_anonymous_session()') IS NULL THEN
    RAISE EXCEPTION 'pre-state: 20261194 objects / eatery_partners / is_admin / is_anonymous_session missing. Nothing applied.';
  END IF;
END $$;

-- ─── (1) the reset log ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS private.eatery_pin_resets (
  id         bigint      GENERATED ALWAYS AS IDENTITY,
  scope      text        NOT NULL,
  partner_id uuid,
  admin_id   uuid        NOT NULL,
  at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT eatery_pin_resets_pkey PRIMARY KEY (id),
  CONSTRAINT eatery_pin_resets_scope_check CHECK (scope IN ('partner','test')),
  CONSTRAINT eatery_pin_resets_scope_partner_check CHECK ((scope = 'partner') = (partner_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS eatery_pin_resets_bucket_idx ON private.eatery_pin_resets (scope, partner_id, at);

DO $$
DECLARE sq text;
BEGIN
  ALTER TABLE private.eatery_pin_resets ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE private.eatery_pin_resets FROM PUBLIC, anon, authenticated;
  sq := pg_get_serial_sequence('private.eatery_pin_resets', 'id');
  IF sq IS NOT NULL THEN EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated', sq); END IF;
END $$;
COMMENT ON TABLE private.eatery_pin_resets IS 'One row per admin reset of a PIN bucket''s lock counters (scope, partner, admin user id, time), for the 3-per-24-hours cap and the audit trail. No PIN, no code, no IP. Rows over 90 days old are deleted by admin_reset_eatery_pin_attempts. No API access. 20261197.';

-- ─── (2) the admin function ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_reset_eatery_pin_attempts(p_partner uuid DEFAULT NULL, p_scope text DEFAULT 'partner')
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF auth.uid() IS NULL OR public.is_anonymous_session() OR NOT public.is_admin() THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'forbidden';
  END IF;
  IF p_scope IS DISTINCT FROM 'partner' AND p_scope IS DISTINCT FROM 'test' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_scope';
  END IF;
  IF p_scope = 'test' AND p_partner IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_partner';
  END IF;
  IF p_scope = 'partner' AND (p_partner IS NULL OR NOT EXISTS (SELECT 1 FROM public.eatery_partners WHERE id = p_partner)) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_partner';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('eatery_enrol:' || p_scope || ':' || COALESCE(p_partner::text, '')));
  IF (SELECT count(*) FROM private.eatery_pin_resets r
       WHERE r.scope = p_scope AND r.partner_id IS NOT DISTINCT FROM p_partner AND r.at > now() - interval '24 hours') >= 3 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'reset_limit';
  END IF;
  DELETE FROM private.eatery_pin_resets WHERE at < now() - interval '90 days';
  DELETE FROM private.eatery_pin_attempts WHERE scope = p_scope AND partner_id IS NOT DISTINCT FROM p_partner;
  INSERT INTO private.eatery_pin_resets (scope, partner_id, admin_id) VALUES (p_scope, p_partner, auth.uid());
  RETURN jsonb_build_object('status', 'ok', 'scope', p_scope, 'partner_id', p_partner);
END;
$fn$;
ALTER FUNCTION public.admin_reset_eatery_pin_attempts(uuid, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.admin_reset_eatery_pin_attempts(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_reset_eatery_pin_attempts(uuid, text) TO authenticated;
COMMENT ON FUNCTION public.admin_reset_eatery_pin_attempts(uuid, text) IS
  'Admin only (non-guest admin session; anything else = P0001 forbidden). Clears the enrolment lock counters (private.eatery_pin_attempts) of ONE bucket: a partner (p_scope partner, p_partner required) or the test scope (p_scope test, p_partner NULL), under the same advisory lock as PIN issue / enrolment. At most 3 resets per bucket per rolling 24 hours (else P0001 reset_limit, nothing changed); each reset is logged in private.eatery_pin_resets (log rows over 90 days old are deleted here). Does not touch the PIN or the enrolled devices. Returns {status, scope, partner_id}. 20261197.';

-- ─── Post-state ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_oid oid := to_regprocedure('public.admin_reset_eatery_pin_attempts(uuid,text)');
  v_def text;
  v_seq text;
BEGIN
  -- The log table: RLS on, zero policies, no client privilege (table, columns, sequence), nothing for PUBLIC.
  IF to_regclass('private.eatery_pin_resets') IS NULL
     OR NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass('private.eatery_pin_resets')) THEN
    RAISE EXCEPTION 'post-state: private.eatery_pin_resets missing or RLS off. Rolled back.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'private' AND tablename = 'eatery_pin_resets') THEN
    RAISE EXCEPTION 'post-state: private.eatery_pin_resets has a policy (want none). Rolled back.';
  END IF;
  IF has_table_privilege('anon', 'private.eatery_pin_resets', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('authenticated', 'private.eatery_pin_resets', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_any_column_privilege('anon', 'private.eatery_pin_resets', 'SELECT,INSERT,UPDATE,REFERENCES')
     OR has_any_column_privilege('authenticated', 'private.eatery_pin_resets', 'SELECT,INSERT,UPDATE,REFERENCES')
     OR EXISTS (SELECT 1 FROM pg_class c, LATERAL aclexplode(c.relacl) a WHERE c.oid = to_regclass('private.eatery_pin_resets') AND a.grantee = 0) THEN
    RAISE EXCEPTION 'post-state: private.eatery_pin_resets is reachable by anon / authenticated / PUBLIC. Rolled back.';
  END IF;
  v_seq := pg_get_serial_sequence('private.eatery_pin_resets', 'id');
  IF v_seq IS NULL
     OR has_sequence_privilege('anon', v_seq, 'USAGE,SELECT,UPDATE') OR has_sequence_privilege('authenticated', v_seq, 'USAGE,SELECT,UPDATE') THEN
    RAISE EXCEPTION 'post-state: the private.eatery_pin_resets id sequence is missing or reachable by anon / authenticated. Rolled back.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass('private.eatery_pin_resets') AND c.conname = 'eatery_pin_resets_scope_check')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass('private.eatery_pin_resets') AND c.conname = 'eatery_pin_resets_scope_partner_check')
     OR NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('private.eatery_pin_resets') AND a.attname = 'admin_id' AND a.attnotnull)
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'private' AND indexname = 'eatery_pin_resets_bucket_idx') THEN
    RAISE EXCEPTION 'post-state: private.eatery_pin_resets CHECKs / admin_id NOT NULL / bucket index missing. Rolled back.';
  END IF;

  -- The function.
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'post-state: admin_reset_eatery_pin_attempts(uuid,text) missing. Rolled back.';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'admin_reset_eatery_pin_attempts') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'post-state: admin_reset_eatery_pin_attempts has more than one overload. Rolled back.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_oid AND p.prosecdef AND p.provolatile = 'v'
                   AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND p.proconfig @> ARRAY['search_path=public, pg_temp']) THEN
    RAISE EXCEPTION 'admin_reset_eatery_pin_attempts: must be SECURITY DEFINER, VOLATILE, owner postgres, search_path public, pg_temp. Rolled back.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a JOIN pg_roles r ON r.oid = a.grantee
                  WHERE p.oid = v_oid AND a.privilege_type = 'EXECUTE' AND r.rolname = 'authenticated')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a LEFT JOIN pg_roles r ON r.oid = a.grantee
                 WHERE p.oid = v_oid AND a.privilege_type = 'EXECUTE' AND (a.grantee = 0 OR r.rolname = 'anon')) THEN
    RAISE EXCEPTION 'admin_reset_eatery_pin_attempts grants: authenticated must hold EXECUTE; anon and PUBLIC must not. Rolled back.';
  END IF;
  v_def := pg_get_functiondef(v_oid);
  IF v_def NOT LIKE '%IF auth.uid() IS NULL OR public.is_anonymous_session() OR NOT public.is_admin() THEN%'
     OR v_def NOT LIKE '%MESSAGE = ''forbidden''%'
     OR v_def NOT LIKE '%DELETE FROM private.eatery_pin_attempts WHERE scope = p_scope AND partner_id IS NOT DISTINCT FROM p_partner;%'
     OR v_def NOT LIKE '%pg_advisory_xact_lock(hashtext(''eatery_enrol:'' || p_scope || '':'' || COALESCE(p_partner::text, '''')))%'
     OR v_def NOT LIKE '%WHERE r.scope = p_scope AND r.partner_id IS NOT DISTINCT FROM p_partner AND r.at > now() - interval ''24 hours'') >= 3 THEN%'
     OR v_def NOT LIKE '%MESSAGE = ''reset_limit''%'
     OR v_def NOT LIKE '%INSERT INTO private.eatery_pin_resets (scope, partner_id, admin_id) VALUES (p_scope, p_partner, auth.uid());%'
     OR v_def NOT LIKE '%DELETE FROM private.eatery_pin_resets WHERE at < now() - interval ''90 days'';%'
     OR position('pg_advisory_xact_lock' IN v_def) > position('''reset_limit''' IN v_def)
     OR position('''reset_limit''' IN v_def) > position('DELETE FROM private.eatery_pin_attempts' IN v_def)
     OR position('''reset_limit''' IN v_def) > position('INSERT INTO private.eatery_pin_resets' IN v_def)
     OR v_def LIKE '%private.eatery_partner_pins%'
     OR v_def LIKE '%private.eatery_partner_devices%'
     OR v_def LIKE '%eatery_pin_issue(%' THEN
    RAISE EXCEPTION 'admin_reset_eatery_pin_attempts body: the admin gate, the bucket lock, the bucket-scoped 3-per-24-hours cap before any write, a bucket-scoped attempts DELETE, the log INSERT and 90-day prune, and no PIN / device table. Rolled back.';
  END IF;
  RAISE NOTICE 'post-state ok: private.eatery_pin_resets (RLS on, no policy, no client privilege); admin_reset_eatery_pin_attempts (DEFINER, authenticated EXECUTE only, capped + logged bucket-scoped attempts delete)';
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
VALUES ('20261197_eatery_pin_attempts_reset.sql', '4ae1718f128fb06f26c9354fab5eb9ed49c667b34ec3ae3ac50b9498d4d76708')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: the 20261197_eatery_pin_attempts_reset rows (C, E, G, H) must read OK.
--
-- ─── Rollback ──
--   DROP FUNCTION IF EXISTS public.admin_reset_eatery_pin_attempts(uuid, text);
--   DROP TABLE IF EXISTS private.eatery_pin_resets;   (drops the reset audit trail too)
--   (admins then unlock a restaurant only by issuing a new PIN, which also revokes its phones).
