-- ─── 20261040 — avatars becomes a PRIVATE bucket ────────────────────────────
--
-- ⚠⚠ ORDERING IS PART OF THIS MIGRATION. APPLY ONLY AFTER THE OTA IS LIVE. ⚠⚠
--
--     1. OTA ships (components/Avatar.js signs paths; ProfileScreen stores a PATH)
--     2. THIS FILE, sections 1-3, in one transaction
--     3. nothing else
--
--   Applying this BEFORE the OTA breaks every avatar in the app: the rows would hold
--   storage paths that the shipped client renders straight into <Image source={{uri}}>,
--   and the bucket would be private so the old public URLs would 404 as well. Both
--   halves fail at once.
--
--   Applying it AFTER the OTA is safe in both directions, which is why this order and
--   not the other: a client on the OLD bundle reads a path, fails its
--   `startsWith('http')` test, and falls through to the INITIALS circle. A missing photo,
--   not a broken image — and it self-heals the moment that client takes the update.
--
-- ─── WHAT WAS WRONG ─────────────────────────────────────────────────────────
--
-- Measured against production 2026-09-20, with the anon key only:
--
--     POST /storage/v1/object/list/avatars  {"prefix":""}   -> 200, 4 folder names
--     …and every folder name IS A USER ID, because the upload path was
--     `${session.user.id}/avatar.${ext}`.
--     POST …/list/avatars {"prefix":"<uid>/"}               -> "avatar.jpeg"
--     GET  …/object/public/avatars/<uid>/avatar.jpeg
--          with NO apikey and NO Authorization header      -> 200 · image/jpeg · 47185 B
--
-- So anyone could enumerate every uploaded profile photo together with its owner's uuid,
-- with no account. ADA is a declared 13-17 mixed-audience app.
--
-- ⚠ A TIGHTER SELECT POLICY WOULD NOT HAVE FIXED IT, and that is why this migration
--   flips the bucket rather than rewriting a predicate. verify_schema.sql already
--   recorded the measurement (2026-08-23, against towing-logos): for a bucket with
--   public = true, Storage serves object reads WITHOUT EVALUATING RLS AT ALL. The broad
--   `USING (bucket_id = …)` SELECT policy is not what grants anon read. Only `public =
--   false` makes any SELECT policy on this bucket load-bearing.
--
-- ─── WHY THE COLUMN NOW HOLDS A PATH ────────────────────────────────────────
--
-- profiles.avatar_url held a full public URL with a `?t=` cache-buster. Every one of
-- those dies with the bucket, so the column stores `<uid>/avatar-<rand>.<ext>` and the
-- client mints a short-lived signed URL per render. A signed URL is a CREDENTIAL; storing
-- one in a table would outlive the reason it was minted and would survive the photo being
-- replaced. It is never persisted — not here, not in AsyncStorage.
--
-- Four RPCs return this column verbatim and NONE construct a URL server-side —
-- get_student_list (20261026), get_student_profile (20261028), list_conversations
-- (20261029), list_my_blocks (20261032). They therefore need NO change: they returned the
-- stored value before and they return the stored value now. Every consumer of all four
-- goes through components/Avatar.js.
--
-- ─── THE FOUR EXISTING OBJECTS ARE NOT MOVED, DELIBERATELY ──────────────────
--
-- Section 1 rewrites the ROW to point at the object that already exists; it does not
-- rename the object. Renaming would mean rewriting storage.objects.name in SQL, which
-- changes the key row WITHOUT moving the bytes behind it — a way to produce four
-- 404s and no way to undo them. Nothing is orphaned either way: every object stays
-- referenced by exactly one row.
--
-- The consequence, stated rather than left to be discovered: those four objects keep the
-- guessable filename `avatar.<ext>` until their owner next changes their photo, at which
-- point the client writes `avatar-<rand>.<ext>` and DELETES the old object. That is
-- acceptable because the bucket is private from section 3 onward — the random suffix is
-- defence-in-depth for REPLACEMENT (so a signed URL still in flight cannot resolve to a
-- photo the user believes they removed), not the thing that keeps the object unreachable.
--
-- Idempotent: section 1 only touches rows that still look like a public URL, and the
-- policies are DROP … IF EXISTS then CREATE.
--
-- OWNERSHIP FALLBACK: if the plain run returns
--   ERROR: must be owner of table objects
-- uncomment the SET ROLE / RESET ROLE lines; that role owns storage.objects.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. ROWS: public URL → storage path ─────────────────────────────────────
-- Derived from the stored value, not from a hardcoded list of four uuids: a fifth row
-- uploaded between writing this and applying it is migrated too, and a list would
-- silently skip it.
--
-- `split_part(…, '?', 1)` drops the `?t=` cache-buster; the substring takes everything
-- after the bucket segment. Only rows that actually look like this bucket's public URL
-- are touched — a preset:, an already-migrated path, or NULL is left alone.
UPDATE public.profiles
   SET avatar_url = split_part(substring(avatar_url from '/object/public/avatars/(.*)$'), '?', 1)
 WHERE avatar_url LIKE '%/object/public/avatars/%';

-- ─── 2. RLS on storage.objects for this bucket ──────────────────────────────

-- SET ROLE supabase_storage_admin;   -- ← uncomment if you hit "must be owner of table objects"

-- READ. Owner reads their own; any signed-in non-guest reads any avatar, because that is
-- what the student list, the profile page, the inbox and the blocked list all require —
-- an avatar is shown to other users BY DESIGN. What changes is that it is no longer shown
-- to the ENTIRE INTERNET with no account, which was the defect.
--
-- ⚠ Guests are excluded. signInAnonymously() puts a guest in the `authenticated` role
--   with a real auth.uid(), so `TO authenticated` alone would still admit the one-tap
--   anonymous session that made the original enumeration trivial to script.
DROP POLICY IF EXISTS "avatars_read_authenticated" ON storage.objects;
CREATE POLICY "avatars_read_authenticated" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'avatars'
    AND NOT (select public.is_anonymous_session())
  );

-- WRITE. The uid is folder segment [1] — the same shape 20260817 imposed on
-- estate-agent-documents and 20261039 on property-images. This is what stops one user
-- writing over another's photo, which `upsert: true` would have made a REPLACEMENT
-- rather than a rejected insert.
DROP POLICY IF EXISTS "avatars_insert_own" ON storage.objects;
CREATE POLICY "avatars_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
    AND NOT (select public.is_anonymous_session())
  );

-- UPDATE with BOTH halves. USING decides which rows you may touch; WITH CHECK decides
-- what they may become. Without the second, a row you legitimately own could be moved to
-- another user's prefix — the same hole through the back door, which is the reasoning
-- 20261039 applied to property-images.
DROP POLICY IF EXISTS "avatars_update_own" ON storage.objects;
CREATE POLICY "avatars_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
    AND NOT (select public.is_anonymous_session())
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
    AND NOT (select public.is_anonymous_session())
  );

-- DELETE, and it is REQUIRED rather than tidy — flagged because the brief listed only
-- SELECT/INSERT/UPDATE. ProfileScreen now deletes the previous object after a successful
-- replace, so that a signed URL still circulating for it 404s. Without this policy that
-- remove() is denied, the delete is swallowed (it is fire-and-forget by design, so no
-- user-visible error), and every replaced photo stays fetchable to anyone holding a live
-- signed URL — which is the precise thing the random suffix exists to prevent. Same
-- owner scoping as the others.
DROP POLICY IF EXISTS "avatars_delete_own" ON storage.objects;
CREATE POLICY "avatars_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
    AND NOT (select public.is_anonymous_session())
  );

-- ─── 3. THE FLIP. This is the line that actually closes the hole. ───────────
UPDATE storage.buckets SET public = false WHERE id = 'avatars';

-- RESET ROLE;   -- ← uncomment together with the SET ROLE line above

-- ─── VERIFICATION — against the catalog, never against this file ────────────
DO $$
DECLARE
  v_pub   boolean;
  v_n     int;
  v_left  int;
  v_expr  text;
BEGIN
  SELECT public INTO v_pub FROM storage.buckets WHERE id = 'avatars';
  IF v_pub IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'avatars bucket is still public (public=%). The policies below are decoration until this is false.', v_pub;
  END IF;

  -- No row may still hold a public URL for this bucket.
  SELECT count(*) INTO v_left FROM public.profiles
   WHERE avatar_url LIKE '%/object/public/avatars/%';
  IF v_left IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '% profiles row(s) still hold a public avatars URL — they would render as initials forever', v_left;
  END IF;

  -- Exactly four permissive policies, one per command. A fifth is the review moment.
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname='storage' AND tablename='objects'
     AND permissive='PERMISSIVE'
     AND policyname IN ('avatars_read_authenticated','avatars_insert_own',
                        'avatars_update_own','avatars_delete_own');
  IF v_n IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'expected 4 permissive avatars policies, found %', v_n;
  END IF;

  -- The write guards are really in the INSERT body. Raw value in the message so a red
  -- assertion carries its own evidence.
  SELECT with_check INTO v_expr FROM pg_policies
   WHERE schemaname='storage' AND tablename='objects' AND policyname='avatars_insert_own';
  IF v_expr IS NULL THEN
    RAISE EXCEPTION 'avatars_insert_own has no WITH CHECK at all';
  END IF;
  IF position('foldername' in v_expr) = 0 OR position('uid' in v_expr) = 0 THEN
    RAISE EXCEPTION 'avatars_insert_own does not pin the uid to a folder segment. with_check=%', v_expr;
  END IF;
  IF position('is_anonymous_session' in v_expr) = 0 THEN
    RAISE EXCEPTION 'avatars_insert_own has no guest guard. with_check=%', v_expr;
  END IF;

  RAISE NOTICE 'avatars: private, % row(s) on paths, 4 owner-scoped policies, guests excluded.',
    (SELECT count(*) FROM public.profiles WHERE avatar_url IS NOT NULL
       AND avatar_url NOT LIKE 'preset:%' AND avatar_url NOT LIKE 'http%');
END $$;

COMMIT;
