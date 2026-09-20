-- ─── 20261042 — the nine dashboard-era storage policies, captured AS-IS ─────
--
-- Captured 2026-09-21 from live pg_policies. NOTHING IS NORMALISED, RENAMED OR
-- IMPROVED — including the defects listed below, which are deliberately left exactly as
-- production has them.
--
-- ─── WHY A CAPTURE AND NOT A CLEANUP ────────────────────────────────────────
--
-- 36 policies exist on storage.objects. 27 are created by migrations in this repo. NINE
-- existed ONLY in the dashboard: no file created them, so a rebuild from
-- supabase/migrations/ produced a DIFFERENT SECURITY POSTURE than production, and
-- verify_schema.sql could not drift-check an object it had never heard of.
--
-- This is not hypothetical. "Public avatar read" was one of that population and cost a
-- full debug cycle: check #2 of the hardening script stayed red against a bucket that was
-- already closed, and the cause was a policy no file in this repo mentioned. It was a
-- sample, not an outlier.
--
-- The capture's ENTIRE value is that the repo now matches production exactly, so every
-- later change is a visible diff against a known baseline. Tidying anything on the way
-- past would produce a file that LOOKS like the baseline and is not one — and every
-- future diff would be measured against a fiction. Hence: verbatim, defects included.
--
-- The statements below are the generator's output (supabase/generate_storage_policy_capture.sql),
-- rendered by Postgres from pg_policies rather than written by hand. The canonical
-- rendering — explicit ::text casts, normalised parens — is what the database actually
-- enforces, so it is what belongs here.
--
-- ─── KNOWN-OPEN DEFECTS IN THIS FILE. DELIBERATELY NOT FIXED HERE. ──────────
--
-- All three are captured exactly as they are. They belong to the place-photos slice,
-- where each becomes a visible diff against this baseline:
--
--   1. "Providers manage own facility images" — FOR ALL TO **public**, gated only on
--      facility ownership. The widest grant in the whole set: ALL commands, to the
--      `public` role rather than `authenticated`. Verbatim here; flagged loudly.
--   2. "organizer delete own event images"    — uid-pinned at segment [2], NO
--      is_anonymous_session() guard, TO authenticated. A guest is in `authenticated`
--      with a real auth.uid(), so the pin admits guests.
--   3. property_images_delete                 — uid-pinned at segment [1], NO guest
--      guard, and TO **public** rather than authenticated. Both defects at once.
--
-- Also open, but NOT in this file because they are repo-created or bucket-level:
--   • place_photos_upload — guest-guarded but NOT uid-pinned (20260823).
--   • ad-images / event-images / place-photos / property-images / towing-logos carry no
--     file_size_limit and no allowed_mime_types.
--
-- ─── ONE PROPERTY OF THE CAPTURED TEXT WORTH KNOWING ────────────────────────
--
-- ⚠ Two captured policies reference UNQUALIFIED objects: `FROM facilities f` and
--   `is_admin()`. pg_policies renders them unqualified because search_path included
--   public when they were read. They therefore resolve against whatever search_path is
--   in effect AT CREATE TIME — paste this in the SQL editor as postgres, where public is
--   on the path, and they bind as intended. NOT schema-qualified here, because that would
--   be tidying and this file's job is to be a faithful copy. Qualifying them belongs to
--   the place-photos slice, as its own visible diff.
--
-- ─── TWO CHECKS THAT PASSED, RECORDED BECAUSE THEY COULD HAVE FAILED ────────
--
--   • The six commented-out CREATE POLICY names in 20260621 ("providers read own docs",
--     "admins read all docs", …) do NOT appear in the generator output. The first
--     derivation of the known-list matched statements behind `--` and would have
--     classified six live dashboard policies as repo-created — the capture would have
--     SKIPPED them and this baseline would have been silently incomplete, which is the
--     exact failure this migration exists to end. The `^[[:space:]]*CREATE POLICY` anchor
--     held. The bug did not happen.
--   • All 36 policies name EXACTLY ONE bucket. Nothing is bucket-unscoped, so the shape
--     that reaches all ten buckets while appearing to belong to none does not exist in
--     this database today. That makes 20261041's clause 3 a check with a real red to go
--     to rather than a hypothetical.
--
-- Idempotent: DROP POLICY IF EXISTS then CREATE for each, so a rebuild lands cleanly.
-- CREATE POLICY has no IF NOT EXISTS, which is why the drop is there.
-- Policy-only, no shape change, so no `NOTIFY pgrst`.
--
-- OWNERSHIP FALLBACK: if the plain run returns
--   ERROR: must be owner of table objects
-- uncomment the SET ROLE / RESET ROLE lines; that role owns storage.objects.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- SET ROLE supabase_storage_admin;   -- ← uncomment if you hit "must be owner of table objects"

-- Providers manage own facility images | ALL | PERMISSIVE
DROP POLICY IF EXISTS "Providers manage own facility images" ON storage.objects;
CREATE POLICY "Providers manage own facility images" ON storage.objects
  FOR ALL TO public
  USING (((bucket_id = 'facility-images'::text) AND (EXISTS ( SELECT 1
   FROM facilities f
  WHERE (((f.id)::text = split_part(objects.name, '/'::text, 1)) AND (f.provider_id = auth.uid()))))))
  WITH CHECK (((bucket_id = 'facility-images'::text) AND (EXISTS ( SELECT 1
   FROM facilities f
  WHERE (((f.id)::text = split_part(objects.name, '/'::text, 1)) AND (f.provider_id = auth.uid()))))));

-- Public facility image read | SELECT | PERMISSIVE
DROP POLICY IF EXISTS "Public facility image read" ON storage.objects;
CREATE POLICY "Public facility image read" ON storage.objects
  FOR SELECT TO public
  USING ((bucket_id = 'facility-images'::text));

-- estate_agent_documents_admin_read | SELECT | PERMISSIVE
DROP POLICY IF EXISTS estate_agent_documents_admin_read ON storage.objects;
CREATE POLICY estate_agent_documents_admin_read ON storage.objects
  FOR SELECT TO authenticated
  USING (((bucket_id = 'estate-agent-documents'::text) AND is_admin()));

-- organizer delete own event images | DELETE | PERMISSIVE
DROP POLICY IF EXISTS "organizer delete own event images" ON storage.objects;
CREATE POLICY "organizer delete own event images" ON storage.objects
  FOR DELETE TO authenticated
  USING (((bucket_id = 'event-images'::text) AND ((storage.foldername(name))[2] = (auth.uid())::text)));

-- property_images_delete | DELETE | PERMISSIVE
DROP POLICY IF EXISTS property_images_delete ON storage.objects;
CREATE POLICY property_images_delete ON storage.objects
  FOR DELETE TO public
  USING (((bucket_id = 'property-images'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));

-- property_images_public | SELECT | PERMISSIVE
DROP POLICY IF EXISTS property_images_public ON storage.objects;
CREATE POLICY property_images_public ON storage.objects
  FOR SELECT TO public
  USING ((bucket_id = 'property-images'::text));

-- provider_credentials_admin_read | SELECT | PERMISSIVE
DROP POLICY IF EXISTS provider_credentials_admin_read ON storage.objects;
CREATE POLICY provider_credentials_admin_read ON storage.objects
  FOR SELECT TO authenticated
  USING (((bucket_id = 'provider-credentials'::text) AND is_admin()));

-- provider_documents_admin_read | SELECT | PERMISSIVE
DROP POLICY IF EXISTS provider_documents_admin_read ON storage.objects;
CREATE POLICY provider_documents_admin_read ON storage.objects
  FOR SELECT TO authenticated
  USING (((bucket_id = 'provider-documents'::text) AND is_admin()));

-- public read event images | SELECT | PERMISSIVE
DROP POLICY IF EXISTS "public read event images" ON storage.objects;
CREATE POLICY "public read event images" ON storage.objects
  FOR SELECT TO public
  USING ((bucket_id = 'event-images'::text));

-- RESET ROLE;   -- ← uncomment together with the SET ROLE line above

-- ─── VERIFICATION — THE EXACT TOTAL, AND ANY NAME OUTSIDE IT ────────────────
--
-- 36 is MEASURED, not rounded. An earlier draft of this work said "about 35" and the
-- real number is 36; a count written from recollection is the thing this file exists to
-- replace. 36 permissive, 0 restrictive.
--
-- The known set is 27 repo-created names (derived from the migrations, anchored so that
-- commented-out statements do not count) plus the 9 captured here. They partition the 36
-- exactly — disjoint, nothing double-counted, nothing missed — which is what makes the
-- count assertable rather than approximate.
--
-- Clause 2 is the one that survives this incident: it does not check that the nine exist,
-- it PRINTS ANY NAME NOT IN THE 36. A tenth dashboard policy created next month names
-- itself here instead of hiding in a total that happens to still add up.
DO $$
DECLARE
  v_total   int;
  v_perm    int;
  v_restr   int;
  v_unknown text;
  known     text[] := ARRAY[
    -- 27 created by migrations in this repo
    'ad_images_admin_delete','ad_images_admin_insert','ad_images_admin_update',
    'ad_images_public_read','authenticated upload event images','avatars_delete_own',
    'avatars_insert_own','avatars_read_authenticated','avatars_update_own',
    'estate_agent_documents_owner_insert','place_photos_delete','place_photos_public',
    'place_photos_upload','property_images_update_own','property_images_upload',
    'provider_credentials_owner_delete','provider_credentials_owner_insert',
    'provider_credentials_owner_select','provider_credentials_owner_update',
    'provider_documents_owner_delete','provider_documents_owner_insert',
    'provider_documents_owner_select','provider_documents_owner_update',
    'towing_logos_admin_delete','towing_logos_admin_insert','towing_logos_admin_update',
    'towing_logos_public_read',
    -- 9 captured by THIS migration
    'Providers manage own facility images','Public facility image read',
    'estate_agent_documents_admin_read','organizer delete own event images',
    'property_images_delete','property_images_public','provider_credentials_admin_read',
    'provider_documents_admin_read','public read event images'
  ];
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE permissive = 'PERMISSIVE'),
         count(*) FILTER (WHERE permissive = 'RESTRICTIVE')
    INTO v_total, v_perm, v_restr
  FROM pg_policies WHERE schemaname='storage' AND tablename='objects';

  IF v_total IS DISTINCT FROM 36 THEN
    RAISE EXCEPTION 'storage.objects has % policies, expected exactly 36 (captured 2026-09-21)', v_total;
  END IF;
  IF v_perm IS DISTINCT FROM 36 OR v_restr IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'expected 36 permissive / 0 restrictive, found % / %', v_perm, v_restr;
  END IF;

  -- Any policy whose name this file does not know about, BY NAME. A count alone would be
  -- satisfied by one policy vanishing while another appeared.
  SELECT string_agg(policyname || ' [' || cmd || ' ' || roles::text || ']', ', ' ORDER BY policyname)
    INTO v_unknown
  FROM pg_policies
  WHERE schemaname='storage' AND tablename='objects'
    AND NOT (policyname = ANY(known));
  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION 'unrecognised storage.objects policy (dashboard-made?): %', v_unknown;
  END IF;

  -- And the inverse: a known name that has gone missing. Same reasoning — the count can
  -- stay at 36 while the set changes underneath it.
  SELECT string_agg(k, ', ' ORDER BY k) INTO v_unknown
  FROM unnest(known) k
  WHERE NOT EXISTS (SELECT 1 FROM pg_policies
                     WHERE schemaname='storage' AND tablename='objects' AND policyname = k);
  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION 'expected storage.objects policy is MISSING: %', v_unknown;
  END IF;

  RAISE NOTICE 'storage.objects: 36 policies, all named, 27 repo + 9 captured. Baseline matches.';
END $$;

COMMIT;
