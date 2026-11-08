-- ═══════════════════════════════════════════════════════════════════════════
-- 20261181 — admin_content_author() answers for 'vehicle' (Araçlar S3)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- vehicles.owner_id is readable by no client (20261165 column grant), so the admin app cannot select it. Two
-- S3 admin paths need the owner, and both go through this existing, admin-gated RPC (20261033):
--   • Reports tab: Ban needs the author of a reported listing ('vehicle' joins AUTHOR_VIA_RPC).
--   • Cars tab: approve / reject notify the seller in their own language.
-- One added CASE branch; every other line is 20261033's. The live body must be 20261033's byte for byte (md5 of
-- prosrc, read by probe supabase/readonly/araclar_s3_preflight.sql) or this file refuses; afterwards the new body
-- minus the one branch must give the old md5 back. SECURITY DEFINER, search_path, owner and ACL are unchanged
-- (C-O-R keeps the ACL; asserted below).
--
-- This makes admin_content_author the sixth SECURITY DEFINER function whose source names vehicles: the
-- verify_schema pin "the SECURITY DEFINER functions that touch vehicles" is bumped in the same commit.
--
-- Apply: supabase-migrate, one file. No table shape change ⇒ no NOTIFY.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TEMP TABLE _acl_before ON COMMIT DROP AS
  SELECT proacl::text AS acl FROM pg_proc WHERE oid = to_regprocedure('public.admin_content_author(text,uuid)');

DO $$
BEGIN
  IF to_regclass('public.vehicles') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: public.vehicles is missing (is 20261165 applied?). Nothing applied.';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.admin_content_author(text,uuid)')) IS DISTINCT FROM 'f56c16c6f66adc78f46ff695dca1aec7' THEN
    RAISE EXCEPTION 'REFUSING: admin_content_author is not the 20261033 body (md5 %). Rebuild from the live definition. Nothing applied.',
      (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.admin_content_author(text,uuid)'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.admin_content_author(
  p_content_type text,
  p_content_id   uuid
)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_author uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'ADMIN_ONLY';
  END IF;

  CASE p_content_type
    WHEN 'review'   THEN SELECT customer_id  INTO v_author FROM reviews    WHERE id = p_content_id;
    WHEN 'question' THEN SELECT customer_id  INTO v_author FROM questions  WHERE id = p_content_id;
    WHEN 'answer'   THEN SELECT provider_id  INTO v_author FROM answers    WHERE id = p_content_id;
    WHEN 'facility' THEN SELECT provider_id  INTO v_author FROM facilities WHERE id = p_content_id;
    WHEN 'place'    THEN SELECT submitted_by INTO v_author FROM places     WHERE id = p_content_id;
    WHEN 'profile'  THEN SELECT id           INTO v_author FROM profiles   WHERE id = p_content_id;
    -- messages.sender_id is ON DELETE SET NULL, so a deleted author yields NULL here and
    -- AdminScreen's confirmBan already refuses on a null author. Not an error.
    WHEN 'message'  THEN SELECT sender_id    INTO v_author FROM messages   WHERE id = p_content_id;
    -- vehicles.owner_id: NULL for dealer and imported listings (nobody to ban). 20261181.
    WHEN 'vehicle'  THEN SELECT owner_id     INTO v_author FROM vehicles   WHERE id = p_content_id;
    ELSE RAISE EXCEPTION 'UNSUPPORTED_CONTENT_TYPE: %', p_content_type;
  END CASE;

  RETURN v_author;
END;
$function$;

DO $$
DECLARE
  v_new text := (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.admin_content_author(text,uuid)'));
BEGIN
  IF md5(replace(v_new, $q$    -- vehicles.owner_id: NULL for dealer and imported listings (nobody to ban). 20261181.
    WHEN 'vehicle'  THEN SELECT owner_id     INTO v_author FROM vehicles   WHERE id = p_content_id;
$q$, '')) IS DISTINCT FROM 'f56c16c6f66adc78f46ff695dca1aec7' THEN
    RAISE EXCEPTION 'admin_content_author differs from 20261033 by more than the vehicle branch';
  END IF;
  IF NOT (SELECT prosecdef AND array_to_string(proconfig, ',') = 'search_path=public' FROM pg_proc
           WHERE oid = to_regprocedure('public.admin_content_author(text,uuid)')) THEN
    RAISE EXCEPTION 'admin_content_author lost SECURITY DEFINER or its pinned search_path';
  END IF;
  IF (SELECT proacl::text FROM pg_proc WHERE oid = to_regprocedure('public.admin_content_author(text,uuid)'))
     IS DISTINCT FROM (SELECT acl FROM _acl_before) THEN
    RAISE EXCEPTION 'admin_content_author ACL changed';
  END IF;
  IF has_function_privilege('anon', 'public.admin_content_author(text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can EXECUTE admin_content_author';
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
VALUES ('20261181_vehicle_admin_author.sql', '8781667c15b1a48042d45070edf90f9a2db783a55737a11bc5160a9f49c4895f')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   verify_schema QUERY 1: the 20261181_vehicle_admin_author row and the 20261165 DEFINER-set row must read OK.
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   Re-run 20261033's CREATE OR REPLACE FUNCTION public.admin_content_author (without the vehicle branch), revert the
--   verify_schema DEFINER-set pin to five, and delete the schema_migrations_applied row.
