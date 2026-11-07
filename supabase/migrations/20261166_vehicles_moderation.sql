-- ═══════════════════════════════════════════════════════════════════════════
-- 20261166 — Araçlar listings join the report flow: 'vehicle' reports, 3-reporter auto-hide, hide policy
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Berke, 2026-11-07: "keep the 3-reporter rule + admin queue. Drop the `reported` status, use the existing
-- hidden flag." So vehicles reuse the whole content_reports machinery exactly as places did (20260824):
--   1. content_reports_content_type_check admits 'vehicle' (the live list must be 20261029's seven values,
--      or this file refuses: adding one must never silently drop another, the 20261029 lesson).
--   2. guard_vehicle_moderation binds the EXISTING guard_moderation_columns('vehicle'): hidden_at /
--      hidden_reason are admin-only except the visible → auto-hidden move at 3+ distinct reporters.
--      (vehicles.hidden_at / hidden_reason were created by 20261165.)
--   3. auto_hide_reported_content() gains a 'vehicle' branch. The live body must be 20260824's byte for
--      byte (md5 of prosrc) or this file refuses; afterwards the new body minus that one branch must give
--      the old md5 back.
--   4. RESTRICTIVE vehicles_hide_reported: a hidden listing disappears for everyone except its owner and
--      admins. It is ANDed onto every read policy, so it also covers ADA Preview.
-- Reporting itself is unchanged: ContentReportMenu inserts into content_reports, rate limit and admin
-- notification as for every other type; the admin Reports tab gets a 'vehicle' branch with the app slice.
--
-- Apply: part of the Araçlar S1 release run (one approval), after 20261165. No table shape change ⇒ no NOTIFY.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  v_def  text;
  v_have text[];
BEGIN
  IF to_regclass('public.vehicles') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'vehicles' AND column_name = 'hidden_at') THEN
    RAISE EXCEPTION 'REFUSING: vehicles.hidden_at is missing (is 20261165 applied?). Nothing applied.';
  END IF;
  IF to_regprocedure('public.guard_moderation_columns()') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: guard_moderation_columns() is missing. Nothing applied.';
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = to_regclass('public.content_reports') AND conname = 'content_reports_content_type_check';
  SELECT array_agg(m[1] ORDER BY m[1]) INTO v_have FROM regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''', 'g') m;
  IF v_have IS DISTINCT FROM ARRAY['answer','facility','message','place','profile','question','review'] THEN
    RAISE EXCEPTION 'REFUSING: content_reports_content_type_check is not the 20261029 list: %. Rebuild from the live definition. Nothing applied.', v_def;
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.auto_hide_reported_content()')) IS DISTINCT FROM '00f0c09fb12dddd30a8240b9d701285c' THEN
    RAISE EXCEPTION 'REFUSING: auto_hide_reported_content is not the 20260824 body (md5 %). Rebuild from the live definition. Nothing applied.',
      (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.auto_hide_reported_content()'));
  END IF;
END $$;

-- 1. Reports may point at a vehicle.
ALTER TABLE public.content_reports DROP CONSTRAINT IF EXISTS content_reports_content_type_check;
ALTER TABLE public.content_reports ADD CONSTRAINT content_reports_content_type_check
  CHECK (content_type IN ('answer','facility','message','place','profile','question','review','vehicle'));

-- 2. hidden_at / hidden_reason: admin-only, except the automatic hide at 3+ distinct reporters.
DROP TRIGGER IF EXISTS guard_vehicle_moderation ON public.vehicles;
CREATE TRIGGER guard_vehicle_moderation
  BEFORE UPDATE ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION guard_moderation_columns('vehicle');

-- 3. Auto-hide at 3 distinct reporters — a 'vehicle' branch; every other line is 20260824's.
CREATE OR REPLACE FUNCTION auto_hide_reported_content()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int;
BEGIN
  SELECT count(DISTINCT reporter_id) INTO v_count
  FROM content_reports
  WHERE content_type = NEW.content_type AND content_id = NEW.content_id;

  IF v_count < 3 THEN RETURN NEW; END IF;

  IF NEW.content_type = 'review' THEN
    UPDATE reviews    SET hidden_at = now(), hidden_reason = 'auto_reports' WHERE id = NEW.content_id AND hidden_at IS NULL;
  ELSIF NEW.content_type = 'question' THEN
    UPDATE questions  SET hidden_at = now(), hidden_reason = 'auto_reports' WHERE id = NEW.content_id AND hidden_at IS NULL;
  ELSIF NEW.content_type = 'answer' THEN
    UPDATE answers    SET hidden_at = now(), hidden_reason = 'auto_reports' WHERE id = NEW.content_id AND hidden_at IS NULL;
  ELSIF NEW.content_type = 'facility' THEN
    UPDATE facilities SET hidden_at = now(), hidden_reason = 'auto_reports' WHERE id = NEW.content_id AND hidden_at IS NULL;
  ELSIF NEW.content_type = 'place' THEN
    UPDATE places     SET hidden_at = now(), hidden_reason = 'auto_reports' WHERE id = NEW.content_id AND hidden_at IS NULL;
  ELSIF NEW.content_type = 'vehicle' THEN
    UPDATE vehicles   SET hidden_at = now(), hidden_reason = 'auto_reports' WHERE id = NEW.content_id AND hidden_at IS NULL;
  END IF;

  RETURN NEW;
END;
$$;
-- The auto_hide_on_report trigger on content_reports is already bound; C-O-R keeps it.

-- 4. A hidden listing is shown only to its owner and admins.
DROP POLICY IF EXISTS vehicles_hide_reported ON public.vehicles;
CREATE POLICY vehicles_hide_reported ON public.vehicles
  AS RESTRICTIVE FOR SELECT TO public
  USING (hidden_at IS NULL OR owner_id = (SELECT auth.uid()) OR (SELECT public.is_admin()));

DO $$
DECLARE
  v_new   text := (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.auto_hide_reported_content()'));
  v_def   text;
  v_n     int;
  v_names text;
BEGIN
  IF md5(replace(v_new, $q$  ELSIF NEW.content_type = 'vehicle' THEN
    UPDATE vehicles   SET hidden_at = now(), hidden_reason = 'auto_reports' WHERE id = NEW.content_id AND hidden_at IS NULL;
$q$, '')) IS DISTINCT FROM '00f0c09fb12dddd30a8240b9d701285c' THEN
    RAISE EXCEPTION 'auto_hide_reported_content differs from 20260824 by more than the vehicle branch';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('public.auto_hide_reported_content()')) THEN
    RAISE EXCEPTION 'auto_hide_reported_content lost SECURITY DEFINER (it must update tables the reporter cannot)';
  END IF;
  -- Still bound on content_reports.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.content_reports') AND NOT tgisinternal
                  AND pg_get_triggerdef(oid) LIKE '%AFTER INSERT ON public.content_reports%auto_hide_reported_content()%') THEN
    RAISE EXCEPTION 'auto_hide_on_report is no longer bound on content_reports';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = to_regclass('public.content_reports') AND conname = 'content_reports_content_type_check';
  IF (SELECT count(*) FROM regexp_matches(v_def, '''([a-z_]+)''', 'g')) IS DISTINCT FROM 8 OR v_def NOT LIKE '%''vehicle''%' THEN
    RAISE EXCEPTION 'content_reports_content_type_check: %', v_def;
  END IF;

  -- vehicles: the full policy set is now 9, two of them RESTRICTIVE.
  SELECT count(*), string_agg(policyname || ':' || cmd || ':' || permissive, ', ' ORDER BY policyname) INTO v_n, v_names
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vehicles';
  IF v_n IS DISTINCT FROM 9 THEN RAISE EXCEPTION 'vehicles has % policies (want 9): %', v_n, v_names; END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vehicles' AND permissive = 'RESTRICTIVE') IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'vehicles must carry exactly 2 RESTRICTIVE policies (photoless, reported): %', v_names;
  END IF;
  RAISE NOTICE 'vehicles policies (9): %', v_names;

  -- vehicles: exactly two user triggers now, the guard and the moderation guard.
  SELECT count(*), string_agg(tgname, ', ' ORDER BY tgname) INTO v_n, v_names FROM pg_trigger
   WHERE tgrelid = to_regclass('public.vehicles') AND NOT tgisinternal;
  IF v_names IS DISTINCT FROM 'guard_vehicle_moderation, vehicles_guard' THEN RAISE EXCEPTION 'vehicles triggers: %', v_names; END IF;
  IF (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = to_regclass('public.vehicles') AND tgname = 'guard_vehicle_moderation')
     NOT LIKE '%BEFORE UPDATE%guard_moderation_columns(''vehicle'')%' THEN
    RAISE EXCEPTION 'guard_vehicle_moderation is not BEFORE UPDATE guard_moderation_columns(''vehicle'')';
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
VALUES ('20261166_vehicles_moderation.sql', '4765f02f6f17f797267635fa64b383ec91cf96627211037b2115c25ad0a78db4')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   verify_schema QUERY 1: the 20261166_vehicles_moderation rows must read OK; QUERY 3: vehicles 9.
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   DROP POLICY vehicles_hide_reported ON public.vehicles; DROP TRIGGER guard_vehicle_moderation ON public.vehicles;
--   Re-run 20260824 §4 (auto_hide_reported_content without the vehicle branch) and 20261029's seven-value
--   content_reports_content_type_check; delete the schema_migrations_applied row.
