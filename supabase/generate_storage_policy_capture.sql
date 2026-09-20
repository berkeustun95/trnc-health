-- ═══════════════════════════════════════════════════════════════════════════
-- GENERATOR — emits CREATE POLICY statements for the dashboard-era
-- storage.objects policies, rendered FROM pg_policies.
--
-- Supabase SQL editor, Role = postgres. READ-ONLY — it creates nothing, it only
-- prints text. Paste all three blocks' output back.
--
-- WHY A GENERATOR AND NOT A HAND-WRITTEN MIGRATION: the capture's whole value is that
-- the repo matches production EXACTLY, so that every later change is a visible diff
-- against a known baseline. An expression retyped from memory — or "tidied" on the way
-- past — produces a file that looks like the baseline and is not one, which is worse
-- than no baseline at all: later diffs would be measured against a fiction.
--
-- Postgres renders `qual` and `with_check` canonically (casts made explicit, parens
-- normalised), so the emitted text will not look character-for-character like whatever
-- was typed into the dashboard. That is correct and is the point — the canonical
-- rendering is what the database actually enforces.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── BLOCK 1. THE STATEMENTS. Paste this output back verbatim. ─────────────
--
-- `known` is the set of policy names this repo's migrations ACTUALLY create. Anything NOT
-- in it was made by hand.
--
-- ⚠ DERIVED FROM THE MIGRATION FILES, NOT FROM MEMORY — and the first derivation was
--   WRONG in the dangerous direction. A grep for `CREATE POLICY "x" ON storage.objects`
--   matches COMMENTED-OUT statements too, and 20260621 carries six of them behind `--`.
--   Including those would have marked six live dashboard policies as repo-created, so
--   the capture would have SKIPPED them and the baseline would have been silently
--   incomplete — the exact failure this migration exists to end. Anchored on
--   `^[[:space:]]*CREATE POLICY` instead. 27 names, 2026-09-21.
WITH known(policyname) AS (
  VALUES
    ('ad_images_admin_delete'), ('ad_images_admin_insert'),
    ('ad_images_admin_update'), ('ad_images_public_read'),
    ('authenticated upload event images'), ('avatars_delete_own'),
    ('avatars_insert_own'), ('avatars_read_authenticated'),
    ('avatars_update_own'), ('estate_agent_documents_owner_insert'),
    ('place_photos_delete'), ('place_photos_public'),
    ('place_photos_upload'), ('property_images_update_own'),
    ('property_images_upload'), ('provider_credentials_owner_delete'),
    ('provider_credentials_owner_insert'), ('provider_credentials_owner_select'),
    ('provider_credentials_owner_update'), ('provider_documents_owner_delete'),
    ('provider_documents_owner_insert'), ('provider_documents_owner_select'),
    ('provider_documents_owner_update'), ('towing_logos_admin_delete'),
    ('towing_logos_admin_insert'), ('towing_logos_admin_update'),
    ('towing_logos_public_read')
)
SELECT
  format(
    E'-- %s | %s | %s\nDROP POLICY IF EXISTS %I ON storage.objects;\nCREATE POLICY %I ON storage.objects%s\n  FOR %s TO %s%s%s;\n',
    p.policyname,
    p.cmd,
    p.permissive,
    p.policyname,
    p.policyname,
    CASE WHEN p.permissive = 'RESTRICTIVE' THEN E'\n  AS RESTRICTIVE' ELSE '' END,
    p.cmd,
    array_to_string(p.roles, ', '),
    CASE WHEN p.qual       IS NOT NULL THEN E'\n  USING (' || p.qual || ')'            ELSE '' END,
    CASE WHEN p.with_check IS NOT NULL THEN E'\n  WITH CHECK (' || p.with_check || ')' ELSE '' END
  ) AS statement
FROM pg_policies p
WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
  AND p.policyname NOT IN (SELECT policyname FROM known)
ORDER BY p.policyname;

-- ─── BLOCK 2. WHICH BUCKET EACH ONE REACHES, for the migration's comments. ─
-- Derived by asking which bucket id appears in the expression rather than by reading
-- the policy's name — a dashboard policy's name is prose and may not mention its bucket
-- at all, and one that mentions NO bucket reaches every one of them.
SELECT
  p.policyname,
  p.cmd,
  COALESCE(
    (SELECT string_agg(b.id, ', ' ORDER BY b.id)
       FROM storage.buckets b
      WHERE COALESCE(p.with_check, p.qual, '') LIKE '%' || b.id || '%'),
    '*** NO BUCKET NAMED — reaches EVERY bucket ***'
  ) AS reaches_buckets,
  (COALESCE(p.with_check, p.qual, '') ILIKE '%foldername%')           AS uid_pinned,
  (COALESCE(p.with_check, p.qual, '') ILIKE '%is_anonymous_session%') AS guest_guarded
FROM pg_policies p
WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
ORDER BY 3, p.policyname;

-- ─── BLOCK 3. THE NUMBERS THE DO BLOCK WILL ASSERT. ────────────────────────
-- The capture migration asserts an EXACT total, so it has to come from here and not
-- from anybody's recollection of "about 35".
SELECT count(*)                                                        AS total_policies,
       count(*) FILTER (WHERE permissive = 'PERMISSIVE')               AS permissive,
       count(*) FILTER (WHERE permissive = 'RESTRICTIVE')              AS restrictive
FROM pg_policies WHERE schemaname='storage' AND tablename='objects';

-- Every name, in one string, so the DO block's "unrecognised name" list can be built
-- from the real set rather than assembled by hand.
SELECT string_agg(policyname, E'\n' ORDER BY policyname) AS all_policy_names
FROM pg_policies WHERE schemaname='storage' AND tablename='objects';
