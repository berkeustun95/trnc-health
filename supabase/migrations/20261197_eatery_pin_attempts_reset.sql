-- ═══════════════════════════════════════════════════════════════════════════
-- 20261197 — Yeme-İçme order status: an admin clears a PIN bucket's lock counters (and nothing else)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- DATABASE ONLY. Needs 20261194 (it refuses to run otherwise).
--
-- Why: a restaurant that hits the enrolment lock (5 / 10 / 30 failed PIN attempts) today can only be unlocked by issuing a NEW
-- PIN (admin_set_eatery_partner_pin), which also revokes every enrolled phone of that bucket. This function clears ONLY the
-- attempt counters of one bucket, so the restaurant can try its existing PIN again and its enrolled phones keep working.
--
-- public.admin_reset_eatery_pin_attempts(p_partner uuid DEFAULT NULL, p_scope text DEFAULT 'partner') RETURNS jsonb
--   • Gate (same as admin_set_eatery_partner_pin): a signed-in, non-guest ADMIN; anything else = P0001 forbidden.
--   • Validation (same as eatery_pin_issue): scope 'partner' or 'test' (else invalid_scope); test => partner NULL, partner =>
--     an existing eatery_partners row (else invalid_partner).
--   • Takes the same per-bucket advisory lock as PIN issue and enrolment, then deletes that bucket's rows from
--     private.eatery_pin_attempts. The PIN row and the enrolled devices are NOT touched; other buckets are NOT touched.
--   • Returns {status: 'ok', scope, partner_id}. No count, no PIN, no token.
--
-- ─── WHO CAN READ / WRITE WHAT ──────────────────────────────────────────────
--   • authenticated has EXECUTE, but the body refuses (P0001 forbidden) unless the caller is a non-guest admin: a customer, a
--     provider and a guest (even a guest session of an admin account) cannot clear counters. anon and PUBLIC have no EXECUTE.
--   • The function only DELETEs attempt rows of the named bucket. It reads / writes no other table, returns no row data, and
--     widens nothing: private.eatery_pin_attempts stays unreachable through the API (20261194's revokes + RLS with 0 policies).
--
-- PROOF (inside this file): pre-state (20261194 in the ledger, its objects present); post-state: one overload, SECURITY
-- DEFINER, owner postgres, search_path public, pg_temp, VOLATILE, authenticated EXECUTE, no anon / PUBLIC EXECUTE, and the
-- body deletes from the attempts table only. Behaviour (buckets, denials with positive controls) is proven in the harness:
-- scripts/test-eatery-order-status-sql.mjs. Nothing printed carries a count or an id.
--
-- Apply: gh workflow run supabase-migrate (dry), then apply=true after Berke's go. Re-runnable (CREATE OR REPLACE).
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
  DELETE FROM private.eatery_pin_attempts WHERE scope = p_scope AND partner_id IS NOT DISTINCT FROM p_partner;
  RETURN jsonb_build_object('status', 'ok', 'scope', p_scope, 'partner_id', p_partner);
END;
$fn$;
ALTER FUNCTION public.admin_reset_eatery_pin_attempts(uuid, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.admin_reset_eatery_pin_attempts(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_reset_eatery_pin_attempts(uuid, text) TO authenticated;
COMMENT ON FUNCTION public.admin_reset_eatery_pin_attempts(uuid, text) IS
  'Admin only (non-guest admin session; anything else = P0001 forbidden). Clears the enrolment lock counters (private.eatery_pin_attempts) of ONE bucket: a partner (p_scope partner, p_partner required) or the test scope (p_scope test, p_partner NULL), under the same advisory lock as PIN issue / enrolment. Does not touch the PIN or the enrolled devices. Returns {status, scope, partner_id}. 20261197.';

-- ─── Post-state ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_oid oid := to_regprocedure('public.admin_reset_eatery_pin_attempts(uuid,text)');
  v_def text;
BEGIN
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
     OR v_def LIKE '%private.eatery_partner_pins%'
     OR v_def LIKE '%private.eatery_partner_devices%'
     OR v_def LIKE '%eatery_pin_issue(%' THEN
    RAISE EXCEPTION 'admin_reset_eatery_pin_attempts body: the admin gate, the bucket lock and a bucket-scoped attempts DELETE, and no PIN / device table. Rolled back.';
  END IF;
  RAISE NOTICE 'post-state ok: admin_reset_eatery_pin_attempts (DEFINER, authenticated EXECUTE only, bucket-scoped attempts delete)';
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
VALUES ('20261197_eatery_pin_attempts_reset.sql', 'cf018dbeefc97295b8420c4b855ab12907ba73b9237b9d37e061eb505de5dd16')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: the 20261197_eatery_pin_attempts_reset rows (C, G, H) must read OK.
--
-- ─── Rollback ──
--   DROP FUNCTION IF EXISTS public.admin_reset_eatery_pin_attempts(uuid, text);
--   (admins then unlock a restaurant only by issuing a new PIN, which also revokes its phones).
