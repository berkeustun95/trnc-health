-- ═══════════════════════════════════════════════════════════════════════════
-- STORAGE POLICY AUDIT — every bucket, every policy, dashboard-era included.
-- Supabase SQL editor, Role = postgres. Read-only. Run all three blocks.
--
-- WHY: avatars carried TWO policies no migration had ever heard of, and 20261040's
-- verification could not see them because it asserted only that its OWN four existed.
-- RLS is PERMISSIVE-OR. Presence-of-mine never proves absence-of-theirs.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── A. EVERY BUCKET, and whether RLS can even bite on it ──────────────────
-- `public = true` means object READS bypass RLS entirely, so every SELECT policy on
-- such a bucket is decoration. Read this column first — it changes what B and C mean.
SELECT b.id AS bucket,
       b.public,
       count(p.policyname) FILTER (WHERE p.permissive = 'PERMISSIVE') AS permissive_policies,
       count(p.policyname) FILTER (WHERE p.permissive = 'RESTRICTIVE') AS restrictive_policies
FROM storage.buckets b
LEFT JOIN pg_policies p
       ON p.schemaname = 'storage' AND p.tablename = 'objects'
      AND coalesce(p.with_check, p.qual, '') LIKE '%' || b.id || '%'
GROUP BY b.id, b.public
ORDER BY b.public DESC, b.id;

-- ─── B. EVERY POLICY, classified. THE `origin` COLUMN IS THE POINT. ────────
-- A policy this repo created is named in a migration; a dashboard-made one is not.
-- The names the repo knows about are listed below — they come from
-- 20260816/0817/0823/0904/0905/1008/1039/1040, and anything NOT in that list was made
-- by hand and is invisible to every drift check in supabase/verify_schema.sql.
--
-- ⚠ `guest_guarded` is not cosmetic. signInAnonymously() puts a guest in the
--   `authenticated` role WITH a real auth.uid(), so `TO authenticated` alone does not
--   exclude them — only NOT is_anonymous_session() does. A policy that is
--   uid_pinned but NOT guest_guarded grants guests their own prefix.
SELECT
  policyname,
  cmd,
  roles::text                                                  AS roles,
  permissive,
  CASE WHEN policyname IN (
    'provider_documents_owner_insert','provider_documents_owner_select',
    'provider_documents_owner_update','provider_documents_owner_delete',
    'estate_agent_documents_owner_insert','authenticated upload event images',
    'place_photos_public','place_photos_upload','place_photos_delete',
    'towing_logos_public_read','towing_logos_admin_insert',
    'towing_logos_admin_update','towing_logos_admin_delete',
    'property_images_upload','property_images_update_own',
    'avatars_read_authenticated','avatars_insert_own',
    'avatars_update_own','avatars_delete_own'
  ) THEN 'migration' ELSE '*** DASHBOARD — no migration knows about this ***' END AS origin,
  (coalesce(with_check, qual, '') NOT ILIKE '%bucket_id%')      AS bucket_unscoped,
  (coalesce(with_check, qual, '') ILIKE '%foldername%')         AS uid_pinned,
  (coalesce(with_check, qual, '') ILIKE '%is_anonymous_session%') AS guest_guarded,
  coalesce(with_check, qual, '')                                AS raw_expression
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY (CASE WHEN policyname IN (
    'provider_documents_owner_insert','provider_documents_owner_select',
    'provider_documents_owner_update','provider_documents_owner_delete',
    'estate_agent_documents_owner_insert','authenticated upload event images',
    'place_photos_public','place_photos_upload','place_photos_delete',
    'towing_logos_public_read','towing_logos_admin_insert',
    'towing_logos_admin_update','towing_logos_admin_delete',
    'property_images_upload','property_images_update_own',
    'avatars_read_authenticated','avatars_insert_own',
    'avatars_update_own','avatars_delete_own'
  ) THEN 1 ELSE 0 END), policyname;

-- ─── C. THE TWO SHAPES THAT ARE ALWAYS WRONG ───────────────────────────────
-- Zero rows is the passing state. Anything here reaches buckets it does not name, or
-- admits guests to a prefix it pins.
SELECT 'BUCKET-UNSCOPED — applies to EVERY bucket' AS finding,
       policyname, cmd, roles::text AS roles, coalesce(with_check, qual, '') AS raw_expression
FROM pg_policies
WHERE schemaname='storage' AND tablename='objects' AND permissive='PERMISSIVE'
  AND coalesce(with_check, qual, '') NOT ILIKE '%bucket_id%'
UNION ALL
SELECT 'WRITE, uid-pinned, NO GUEST GUARD — a guest gets their own prefix',
       policyname, cmd, roles::text, coalesce(with_check, qual, '')
FROM pg_policies
WHERE schemaname='storage' AND tablename='objects' AND permissive='PERMISSIVE'
  AND cmd IN ('INSERT','UPDATE','DELETE','ALL')
  AND coalesce(with_check, qual, '') ILIKE '%foldername%'
  AND coalesce(with_check, qual, '') NOT ILIKE '%is_anonymous_session%'
ORDER BY 1, 2;
