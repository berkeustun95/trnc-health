-- ─── 20261041 — the two dashboard-era avatars policies ──────────────────────
--
-- 20261040 added four owner-scoped, guest-guarded policies and made the bucket private.
-- It ASSERTED ITS OWN FOUR EXISTED and stopped there, and that was the defect: RLS is
-- PERMISSIVE-OR, so presence-of-mine can never prove absence-of-theirs. Two policies
-- created through the dashboard, which no migration has ever known about, were still
-- granting what the new four were written to deny.
--
--   "Public avatar read"        — dropped BY HAND before this file existed. Carried here
--                                 so a rebuild from migrations reaches the same state;
--                                 without it the repo describes a database nobody has.
--   "Users manage own avatar"   | ALL | {authenticated}
--                                 USING (bucket_id = 'avatars'
--                                        AND (storage.foldername(name))[1] = auth.uid())
--                                 NO is_anonymous_session() GUARD.
--
-- ─── WHY THE SECOND ONE MATTERS, AND WHY DROPPING IT COSTS NOTHING ──────────
--
-- signInAnonymously() puts a guest in the `authenticated` role with a REAL auth.uid(), so
-- that policy grants a guest full read/write over `avatars/<their-uid>/…`. All four of
-- 20261040's policies carry `NOT is_anonymous_session()`; permissive-OR means this one
-- hands back exactly what they withhold.
--
-- Coverage was checked BEFORE writing the drop, command by command, for a legitimate
-- (non-guest) authenticated user:
--
--   SELECT  old: own folder only     new: avatars_read_authenticated, WHOLE BUCKET,
--                                         non-guest — broader, and required, because the
--                                         student list renders other people's avatars
--   INSERT  old: own folder          new: avatars_insert_own, own folder + non-guest
--   UPDATE  old: own folder          new: avatars_update_own, own folder + non-guest,
--                                         with BOTH USING and WITH CHECK (stricter: the
--                                         old policy had no WITH CHECK at all)
--   DELETE  old: own folder          new: avatars_delete_own, own folder + non-guest
--
-- So nothing a real user can do is removed. The only loss is guest WRITE — and a guest
-- has never been able to have an avatar at all: the upload writes bytes and then does
-- `UPDATE profiles SET avatar_url = …`, which the RESTRICTIVE `no_anon_update_profiles`
-- (20260718: FOR UPDATE TO authenticated USING NOT is_anonymous_session()) denies. A
-- guest's upload could only ever produce ORPHANED BYTES that render nowhere. This closes
-- a storage-abuse surface, not a feature.
--
-- ─── WHY A NEW FILE AND NOT AN AMENDMENT TO 20261040 ────────────────────────
--
-- 20261040 IS APPLIED — established from schema state (the four policies are in
-- pg_policies and the bucket is private), which is the only way "applied" is ever
-- established in this project: migrations are pasted by hand and there is no
-- supabase_migrations.schema_migrations to consult. Editing an applied migration would
-- leave every database that already ran it unchanged while the repo claimed otherwise,
-- which is the exact drift this whole audit exists to catch.
--
-- Policy-only, no shape change, so no `NOTIFY pgrst`. Idempotent.
--
-- OWNERSHIP FALLBACK: if the plain run returns
--   ERROR: must be owner of table objects
-- uncomment the SET ROLE / RESET ROLE lines; that role owns storage.objects.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- SET ROLE supabase_storage_admin;   -- ← uncomment if you hit "must be owner of table objects"

DROP POLICY IF EXISTS "Public avatar read"      ON storage.objects;
DROP POLICY IF EXISTS "Users manage own avatar" ON storage.objects;

-- RESET ROLE;   -- ← uncomment together with the SET ROLE line above

-- ─── VERIFICATION — THE EXACT SET, NOT THE PRESENCE OF MINE ─────────────────
--
-- This is the shape every DO block that touches a bucket uses from now on. The lesson
-- 20261040 paid for: asserting your own objects exist is compatible with an older, wider
-- policy still granting everything you meant to deny.
--
-- Three clauses, and the third is the one that would have caught the original defect:
--   1. the four expected policies exist, one per command, all guest-guarded;
--   2. the COUNT of avatars-reaching policies is exactly four — so a fifth, whatever it
--      is called and whoever made it, goes red;
--   3. NO permissive policy on storage.objects is BUCKET-UNSCOPED. A policy whose
--      expression never mentions bucket_id reaches avatars while naming no bucket, so
--      clause 2 — which has to find candidates by looking for 'avatars' — is blind to it
--      by construction. This is the catch-all blind spot, asserted rather than assumed.
DO $$
DECLARE
  v_n        int;
  v_guarded  int;
  v_wild     text;
  v_names    text;
BEGIN
  -- (1) the four, by name and command, each carrying the guest guard
  SELECT count(*) INTO v_guarded
  FROM pg_policies
  WHERE schemaname='storage' AND tablename='objects' AND permissive='PERMISSIVE'
    AND policyname IN ('avatars_read_authenticated','avatars_insert_own',
                       'avatars_update_own','avatars_delete_own')
    AND coalesce(with_check, qual, '') ILIKE '%is_anonymous_session%';
  IF v_guarded IS DISTINCT FROM 4 THEN
    SELECT string_agg(policyname || '=' || cmd, ', ' ORDER BY policyname) INTO v_names
      FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
        AND policyname LIKE 'avatars\_%';
    RAISE EXCEPTION 'expected 4 guest-guarded avatars policies, found %. present: %',
      v_guarded, coalesce(v_names, '(none)');
  END IF;

  -- (2) EXACTLY four policies reach this bucket by name. A fifth — dashboard-made,
  --     differently named, whatever — fails here and names itself in the message.
  SELECT count(*),
         string_agg(policyname || ' [' || cmd || ' ' || roles::text || ']', ', ' ORDER BY policyname)
    INTO v_n, v_names
  FROM pg_policies
  WHERE schemaname='storage' AND tablename='objects'
    AND permissive='PERMISSIVE'
    AND coalesce(with_check, qual, '') ILIKE '%avatars%';
  IF v_n IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'expected exactly 4 permissive policies naming avatars, found %: %',
      v_n, coalesce(v_names, '(none)');
  END IF;

  -- (3) THE CATCH-ALL CHECK. A permissive policy that never mentions bucket_id applies to
  --     EVERY bucket including this one, and clause (2) cannot see it.
  SELECT string_agg(policyname || ' [' || cmd || ']: ' || coalesce(with_check, qual, ''), ' | '
                    ORDER BY policyname)
    INTO v_wild
  FROM pg_policies
  WHERE schemaname='storage' AND tablename='objects'
    AND permissive='PERMISSIVE'
    AND coalesce(with_check, qual, '') NOT ILIKE '%bucket_id%';
  IF v_wild IS NOT NULL THEN
    RAISE EXCEPTION 'bucket-unscoped permissive policy on storage.objects reaches avatars: %', v_wild;
  END IF;

  -- (4) and the two that had to go are gone
  IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
              AND policyname IN ('Public avatar read','Users manage own avatar')) THEN
    RAISE EXCEPTION 'a dashboard-era avatars policy survived the drop';
  END IF;

  RAISE NOTICE 'avatars: exactly 4 guest-guarded policies, no bucket-unscoped policy, dashboard pair gone.';
END $$;

COMMIT;
