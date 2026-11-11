-- ═══════════════════════════════════════════════════════════════════════════
-- 20261185 — Bandabuliya (marketplace) maintenance: retention RPCs + the daily job
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Plan: vault 10-ada/2026-11-07_marketplace-plan.md, "Retention". Applied with Bandabuliya's own release, after
-- 20261183/84, and only once the marketplace-maintenance edge function is deployed (Berke's go for both): the
-- job below POSTs to it every night.
--
-- ─── WHAT A RUN DOES (marketplace-maintenance calls these, in this order) ────
--   1. marketplace_maintenance(apply):
--        a. listings expired for more than 90 days are soft-deleted;
--        b. listings soft-deleted more than 30 days ago are purged (rows only), unless a report on them is still
--           pending. Their photo rows go with them (ON DELETE CASCADE). Chats stay: 20261184 made
--           conversations.listing_id ON DELETE SET NULL, so both people keep the thread without its listing.
--           The pre-flight refuses if that link is anything else, because CASCADE would delete the chats.
--      apply = false counts the same rows and changes nothing (the function's dry mode).
--   2. marketplace_orphan_objects(limit): objects in marketplace-photos older than 24 h whose path no live photo
--      row holds (no row, or a rejected one) — purged listings' files, a row insert that failed after its upload,
--      a removal that failed after approve/reject. The FUNCTION removes them through the Storage API:
--      storage.protect_delete blocks SQL deletes (probe 42413063083). The 24 h margin covers an upload whose
--      row is a moment behind it.
-- Both are SECURITY DEFINER, EXECUTE for service_role only. Each step does at most 500 rows a run.
--
-- ─── THE JOB ────────────────────────────────────────────────────────────────
-- 'marketplace-maintenance', daily 01:23 UTC (03:23/04:23 TRNC, quiet hours). It POSTs {"apply": true}; the
-- function's default is a dry run. Key: Vault 'novest_sync_key', never inline in cron.job (as 20261177).
-- To stop it: SELECT cron.unschedule('marketplace-maintenance'); (a migration).
--
-- Apply: gh workflow run supabase-migrate -f file=20261185_marketplace_maintenance.sql (dry), then -f apply=true.
SET ROLE postgres;
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ─── Pre-flight ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.marketplace_listings') IS NULL OR to_regclass('public.marketplace_photos') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: 20261183 (marketplace_listings / marketplace_photos) is not applied. Nothing applied.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_listing_id_fkey'
                  AND conrelid = 'public.conversations'::regclass AND confdeltype = 'n') THEN
    RAISE EXCEPTION 'REFUSING: conversations_listing_id_fkey is not ON DELETE SET NULL (20261184): a purge would delete chats. Nothing applied.';
  END IF;
END $$;

-- ─── 1. Retention ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.marketplace_maintenance(p_apply boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_expired int;
  v_purged  int;
  v_held    int;
BEGIN
  SELECT count(*) INTO v_held FROM marketplace_listings l
   WHERE l.deleted_at < now() - interval '30 days'
     AND EXISTS (SELECT 1 FROM content_reports r
                  WHERE r.content_type = 'listing' AND r.content_id = l.id AND r.status = 'pending');

  IF NOT p_apply THEN
    SELECT count(*) INTO v_expired FROM (SELECT 1 FROM marketplace_listings
      WHERE deleted_at IS NULL AND expires_at < now() - interval '90 days' LIMIT 500) x;
    SELECT count(*) INTO v_purged FROM (SELECT 1 FROM marketplace_listings l
      WHERE l.deleted_at < now() - interval '30 days'
        AND NOT EXISTS (SELECT 1 FROM content_reports r
                         WHERE r.content_type = 'listing' AND r.content_id = l.id AND r.status = 'pending')
      LIMIT 500) x;
    RETURN jsonb_build_object('applied', false, 'expired_soft_deleted', v_expired, 'purged', v_purged,
                              'purge_held_by_report', v_held);
  END IF;

  -- deleted_at is server-owned: the update guard admits it only on this switch (as delete_marketplace_listing).
  PERFORM set_config('app.trusted_marketplace', 'on', true);
  WITH d AS (
    UPDATE marketplace_listings SET deleted_at = now()
     WHERE id IN (SELECT id FROM marketplace_listings
                   WHERE deleted_at IS NULL AND expires_at < now() - interval '90 days' LIMIT 500)
    RETURNING 1)
  SELECT count(*) INTO v_expired FROM d;
  PERFORM set_config('app.trusted_marketplace', 'off', true);

  WITH d AS (
    DELETE FROM marketplace_listings
     WHERE id IN (SELECT l.id FROM marketplace_listings l
                   WHERE l.deleted_at < now() - interval '30 days'
                     AND NOT EXISTS (SELECT 1 FROM content_reports r
                                      WHERE r.content_type = 'listing' AND r.content_id = l.id AND r.status = 'pending')
                   LIMIT 500)
    RETURNING 1)
  SELECT count(*) INTO v_purged FROM d;

  RETURN jsonb_build_object('applied', true, 'expired_soft_deleted', v_expired, 'purged', v_purged,
                            'purge_held_by_report', v_held);
END;
$function$;
REVOKE ALL ON FUNCTION public.marketplace_maintenance(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketplace_maintenance(boolean) TO service_role;

-- ─── 2. Orphan objects (read-only; the function removes them via the Storage API) ─
CREATE OR REPLACE FUNCTION public.marketplace_orphan_objects(p_limit int DEFAULT 500)
 RETURNS TABLE (name text)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT o.name FROM storage.objects o
   WHERE o.bucket_id = 'marketplace-photos'
     AND o.created_at < now() - interval '24 hours'
     AND NOT EXISTS (SELECT 1 FROM public.marketplace_photos p
                      WHERE p.storage_path = o.name AND p.status <> 'rejected')
   ORDER BY o.created_at
   LIMIT least(greatest(coalesce(p_limit, 500), 1), 500)
$function$;
REVOKE ALL ON FUNCTION public.marketplace_orphan_objects(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketplace_orphan_objects(int) TO service_role;

-- ─── 3. The daily job ───────────────────────────────────────────────────────
SELECT cron.unschedule('marketplace-maintenance') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'marketplace-maintenance');
SELECT cron.schedule('marketplace-maintenance', '23 1 * * *', $job$
  SELECT net.http_post(
    url     := 'https://jeihxnwqytnxtytgkzgf.supabase.co/functions/v1/marketplace-maintenance',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
                 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'novest_sync_key')),
    body    := '{"apply": true}'::jsonb)
$job$);

-- ─── Assertions ─────────────────────────────────────────────────────────────
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_function_privilege(r, 'public.marketplace_maintenance(boolean)', 'EXECUTE')
       OR has_function_privilege(r, 'public.marketplace_orphan_objects(integer)', 'EXECUTE') THEN
      RAISE EXCEPTION '% can execute a maintenance function', r;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role', 'public.marketplace_maintenance(boolean)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.marketplace_orphan_objects(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot execute the maintenance functions: the job would fail every night';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'marketplace-maintenance') THEN
    RAISE EXCEPTION 'marketplace-maintenance not scheduled';
  END IF;
  RAISE NOTICE '20261185 OK: retention RPCs (service_role only) + daily marketplace-maintenance job';
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
VALUES ('20261185_marketplace_maintenance.sql', 'fb7ea44c607aa84d998abf60530b4f36d040fa470ca28e28b00b86ad05ae8a14')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
