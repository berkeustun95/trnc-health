-- ═══ Slice 4 — the student list. The first time one user's data reaches another ═══
--
-- Two functions and one widened CHECK. No new table, no new column, NO NEW POLICY.
--
-- ─── WHY THIS IS NOT AN RLS POLICY ──────────────────────────────────────────
--
-- RLS is ROW-level. A SELECT policy on profiles that let students see each other would
-- expose the WHOLE ROW — phone, date_of_birth (including minors'), push_token, strikes,
-- blocked_until, ugc_banned_until — to anyone who could reach it. And it would be
-- reachable: reviews.customer_id is publicly readable, so `reviews?select=profiles(*)`
-- would walk straight through the new policy and hand those columns to any reader.
--
-- That is the exact defect 20260821 and 20260922 each REMOVED, six weeks apart, and the
-- second one was still live when it was found. Postgres cannot limit a policy to columns,
-- and column GRANTs cannot help either: customers, providers and students all share the
-- `authenticated` role and are separated only by policy predicates.
--
-- So the read is a column-limited SECURITY DEFINER function, the precedent set by
-- 20260819 (get_customer_contacts) and 20261002 (display_name_available). SIX columns
-- leave this function and nothing else can be asked for:
--
--     user_id · display_name · avatar_url · subject_name · study_start_year · study_end_year
--
-- NOT phone, date_of_birth, region, resident_status, email, push_token, role, nationality,
-- student_level, institution_id, the moderation columns, or full_name.
--
-- ⚠ profiles.display_preference ('display_name' | 'full_name', 20261001) IS DELIBERATELY
--   NOT READ. Honouring it here would send first + last name to strangers on the strength
--   of a column no screen has ever written. If that column is ever to mean something it
--   gets its own decision and its own privacy copy — not a side effect of this list.
--
-- verify_schema.sql pins pg_get_function_result() to the exact string, so adding a column
-- to the RETURNS TABLE goes red rather than shipping. A policy count cannot see a DEFINER
-- function; that token is the only thing watching this surface.
--
-- ─── WHAT THE FUNCTION ENFORCES ITSELF ──────────────────────────────────────
--
--   1. NOT an anonymous session. `authenticated` INCLUDES guests in Supabase, so the
--      GRANT does not exclude them — the in-body check is what does. Every other table
--      this module touches (institutions, subjects, student_tasks) is readable by any
--      authenticated caller, guests included. This one must not be, and that difference
--      lives here.
--   2. RECIPROCITY: the caller has student_listing_opt_in = true. No lurking.
--   3. The listed user has student_listing_opt_in = true.
--   4. The listed user is at the requested institution, and that institution is active.
--
-- Cross-university viewing is ALLOWED by design: an opted-in student sees any university's
-- list, not only their own. Alumni see current students — that is the point of recording
-- graduation years, and slice 6's age rule (not visibility) is what governs contact.
--
-- auth.uid() and auth.jwt() resolve to the ORIGINAL CALLER inside a SECURITY DEFINER
-- function, so every check above binds to the real caller and not to the definer.
--
-- ─── THREE PREDICATES THAT ARE NOT IN THE SPEC, AND WHY THEY ARE HERE ───────
--
-- • blocks, BOTH DIRECTIONS. 20260712's block list is private to the blocker and already
--   carries rows from the review flow. If A blocked B, neither appears to the other — a
--   one-directional check would let the blocked party keep watching the blocker.
--   No client could do this itself: blocks_read_own returns only your own rows, so the
--   reciprocal half is invisible outside a DEFINER function.
--
-- • ugc_banned_until. THIS IS THE ANSWER TO "what would hidden mean for a profile", and
--   it is a recommendation, not an instruction received — it is one predicate in each
--   function and removable in one line. profiles has no hidden_at and does not need one:
--   the proportionate remedy for an abusive listing is removal from the list, and a
--   UGC ban already means "this person may not put content in front of other users."
--   A list entry IS content in front of other users. Delisting via student_listing_opt_in
--   alone would be no remedy at all — the user can switch it back on.
--
-- • display_name IS NOT NULL. A listed row with no name renders as a blank card. It also
--   makes the second half of the moderation remedy work: clearing an abusive display_name
--   removes that person from every list until they pick a new one.
--
-- ─── content_reports GAINS 'profile' ────────────────────────────────────────
--
-- The first surface in the app that shows a stranger's name must have a report path
-- behind it, or the name is unreportable. The CHECK is widened to admit it.
--
-- auto_hide_reported_content() IS NOT TOUCHED, and that is deliberate. Its branch chain
-- has no ELSE, so a 'profile' report already falls through and auto-hides nothing.
-- Auto-hiding a PERSON at three reports is a brigading weapon, not a safeguard: three
-- coordinated accounts could erase anyone from every list in the app. Admin triage only.
-- verify_schema asserts the absence of a profile branch, anchored on `UPDATE profiles`
-- (a code shape no comment contains — see the 0924 note about a token that forbade a
-- WORD and could only be made green by deleting the comment that explained it).
--
-- ─── EXECUTION ──────────────────────────────────────────────────────────────
-- SQL editor, Role = postgres, the WHOLE FILE. Requires 20261024 (study columns) and
-- 20260712 (blocks, content_reports, ugc_banned_until). NOTIFY at the end: no column is
-- added, but PostgREST enumerates FUNCTIONS into the same cache, so without it the two
-- new RPCs can be missing from the API until some unrelated reload.

SET ROLE postgres;

BEGIN;

-- ─── 1. The reciprocity rule, in ONE place ──────────────────────────────────
-- Slices 5 (profile pages) and 6 (messaging) need this same question answered. Written
-- three times it becomes three subtly different rules, which is the remembered-list
-- failure in another costume.
--
-- NOT because a direct check would recurse — that hazard belongs to POLICIES, and this
-- slice writes none. profiles.relforcerowsecurity is false, so RLS is not applied to a
-- DEFINER function owned by postgres, and a direct read here would be correct. It is one
-- function because the RULE should have one home.
--
-- Returns false, never NULL: EXISTS is never NULL, and auth.uid() being NULL (postgres,
-- or an unauthenticated caller) makes it false rather than erroring.
CREATE OR REPLACE FUNCTION public.can_see_student_lists()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT NOT public.is_anonymous_session()
     AND EXISTS (
       SELECT 1 FROM profiles p
        WHERE p.id = auth.uid()
          AND p.student_listing_opt_in
          AND p.display_name IS NOT NULL
          AND (p.ugc_banned_until IS NULL OR p.ugc_banned_until <= now())
     );
$function$;

COMMENT ON FUNCTION public.can_see_student_lists() IS
  'Reciprocity gate for the Student Hub: true only for a non-anonymous, non-UGC-banned '
  'caller who has opted into their own university student list. Slices 4-6 share it.';

-- ─── 2. The list ────────────────────────────────────────────────────────────
-- p_lang is a PARAMETER, not profiles.preferred_language: that column is NULL for ~190
-- of the 208 profiles while the app still has a working language from the device, so
-- reading it would un-localise the subject for almost everyone.
--
-- It takes a FULL ENGLISH NAME ('Turkish'), never an ISO code ('tr') — the repo
-- convention, and subject_i18n_lang_check rejects ISO codes for exactly this reason.
-- Validity is DERIVED from subject_i18n rather than compared against a list of nine
-- names typed here, which would be a second place for the set to drift.
--
-- An unknown language falls back to English rather than raising: a locale added to the
-- app before its subject rows exist should show English subjects, not an error. The
-- fallback chain is requested → English → any, matching utils/studyFields.js so the
-- list and the profile picker never disagree about a subject's name.
--
-- FIXED LIMIT, NO OFFSET. Three profiles carry an institution today, so pagination is a
-- parameter that cannot be tested against real data. When a list outgrows the cap, add
-- keyset pagination then — with rows to prove it works.
CREATE OR REPLACE FUNCTION public.get_student_list(
  p_institution_id uuid,
  p_lang           text    DEFAULT 'English',
  p_limit          integer DEFAULT 100
)
 RETURNS TABLE(user_id uuid, display_name text, avatar_url text,
               subject_name text, study_start_year smallint, study_end_year smallint)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me    uuid    := auth.uid();
  v_lang  text;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
BEGIN
  -- Distinct errors, because the client shows DIFFERENT copy for each: a guest sees no
  -- student list at all, while a signed-up user who has not opted in sees the
  -- reciprocity explanation and a route to the toggle.
  IF v_me IS NULL OR is_anonymous_session() THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF NOT can_see_student_lists() THEN
    RAISE EXCEPTION 'NOT_LISTED';
  END IF;

  SELECT CASE WHEN EXISTS (SELECT 1 FROM subject_i18n si WHERE si.lang = p_lang)
              THEN p_lang ELSE 'English' END
    INTO v_lang;

  RETURN QUERY
  SELECT p.id, p.display_name, p.avatar_url, sn.name,
         p.study_start_year, p.study_end_year
    FROM profiles p
    JOIN institutions i ON i.id = p.institution_id AND i.is_active
    -- LEFT JOIN: a subject is optional. An entry with no subject still belongs in the list.
    LEFT JOIN LATERAL (
      SELECT si.name
        FROM subject_i18n si
       WHERE si.subject_id = p.subject_id
       ORDER BY (si.lang = v_lang) DESC, (si.lang = 'English') DESC, si.lang
       LIMIT 1
    ) sn ON TRUE
   WHERE p.institution_id = p_institution_id
     AND p.student_listing_opt_in
     AND p.display_name IS NOT NULL
     AND (p.ugc_banned_until IS NULL OR p.ugc_banned_until <= now())
     AND NOT EXISTS (
       SELECT 1 FROM blocks b
        WHERE (b.blocker_id = v_me AND b.blocked_id = p.id)
           OR (b.blocker_id = p.id AND b.blocked_id = v_me)
     )
   -- The caller first, so they can see how they appear to everyone else; then by name.
   ORDER BY (p.id = v_me) DESC, p.display_name
   LIMIT v_limit;
END;
$function$;

COMMENT ON FUNCTION public.get_student_list(uuid, text, integer) IS
  'Student Hub slice 4. Six columns of an opted-in student, for an opted-in caller only. '
  'Never returns phone, date_of_birth, push_token, email or full_name. See 20261026.';

-- ─── 3. Grants ──────────────────────────────────────────────────────────────
-- REVOKE FROM PUBLIC is not belt-and-braces: a function is EXECUTE-able by PUBLIC by
-- default, which includes anon.
REVOKE ALL ON FUNCTION public.can_see_student_lists() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_see_student_lists() FROM anon;
GRANT EXECUTE ON FUNCTION public.can_see_student_lists() TO authenticated;

REVOKE ALL ON FUNCTION public.get_student_list(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_student_list(uuid, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_student_list(uuid, text, integer) TO authenticated;

-- ─── 4. content_reports admits 'profile' ────────────────────────────────────
DO $$
DECLARE
  v_def    text;
  v_have   text[];
  v_before text[] := ARRAY['answer', 'facility', 'place', 'question', 'review'];
  v_after  text[] := ARRAY['answer', 'facility', 'place', 'profile', 'question', 'review'];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.content_reports'::regclass
     AND conname  = 'content_reports_content_type_check';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'REFUSING: content_reports_content_type_check does not exist. Nothing applied.';
  END IF;

  -- DERIVED from the constraint text, not compared against a remembered rendering.
  -- `IN (...)` and `= ANY (ARRAY[...])` are the same constraint printed two ways, and
  -- pinning either spelling would fail on a database that is perfectly correct.
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_have
    FROM regexp_matches(v_def, '''([a-z_]+)''::text', 'g') AS m;

  -- Re-runnable: the already-widened set is a NO-OP, not a refusal. Anything else is
  -- drift and stops the file, because a CHECK that admits an unexpected set is either
  -- a type this slice does not know about or a hand edit nobody recorded.
  IF v_have IS NOT DISTINCT FROM v_after THEN
    RAISE NOTICE 'content_reports_content_type_check already admits profile — no-op';
  ELSIF v_have IS NOT DISTINCT FROM v_before THEN
    ALTER TABLE public.content_reports DROP CONSTRAINT content_reports_content_type_check;
    ALTER TABLE public.content_reports ADD  CONSTRAINT content_reports_content_type_check
      CHECK (content_type IN ('review', 'question', 'answer', 'facility', 'place', 'profile'));
    RAISE NOTICE 'content_reports_content_type_check: 5 types → 6 (profile added)';
  ELSE
    RAISE EXCEPTION 'REFUSING: content_reports admits % — expected % (or % on a re-run). The live definition is: %. Nothing applied.',
      coalesce(array_to_string(v_have, ','), '<none>'),
      array_to_string(v_before, ','), array_to_string(v_after, ','), v_def;
  END IF;
END $$;

-- ─── 5. Assertions ──────────────────────────────────────────────────────────
-- Inside the transaction, so a failure rolls the whole file back and applies nothing.
-- IS DISTINCT FROM throughout: `<>` against a NULL is NULL, and IF NULL does not fire —
-- which would make every assertion below pass on precisely the failure it exists to catch.
DO $$
DECLARE
  v_res     text;
  v_ok      boolean := false;
  v_count   int;
  v_def     text;
  v_have    text[];
BEGIN
  -- (a) THE GUARD IS REALLY IN THE INSTALLED BODY. This block runs as postgres, where
  -- auth.uid() is NULL. If get_student_list returns instead of raising, the auth check is
  -- not in the function that was actually created and every guest can call it.
  BEGIN
    PERFORM * FROM get_student_list('00000000-0000-4000-b000-000000000001'::uuid, 'English', 10);
    v_res := 'returned rows';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'AUTH_REQUIRED' THEN v_ok := true; ELSE RAISE; END IF;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'get_student_list did NOT raise AUTH_REQUIRED with no auth.uid() (got: %) — the guard is missing and guests can call it', coalesce(v_res, '<null>');
  END IF;

  -- (b) The reciprocity helper is false for a caller who is nobody, not NULL and not true.
  IF can_see_student_lists() IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'can_see_student_lists() returned % as postgres — expected false', coalesce(can_see_student_lists()::text, '<null>');
  END IF;

  -- (c) The column list, read from the catalog. This is the whole privacy claim of the
  -- slice: six columns leave this function. Pinned here AND in verify_schema.sql.
  SELECT pg_get_function_result(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_student_list';
  IF v_def IS DISTINCT FROM 'TABLE(user_id uuid, display_name text, avatar_url text, subject_name text, study_start_year smallint, study_end_year smallint)' THEN
    RAISE EXCEPTION 'get_student_list returns % — not the six agreed columns', coalesce(v_def, '<missing>');
  END IF;

  -- (d) Neither function is callable by anon or PUBLIC. aclexplode rather than
  -- has_function_privilege(), which RAISES on a missing function and would turn a
  -- reportable problem into an unreadable one.
  SELECT count(*) INTO v_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN LATERAL aclexplode(p.proacl) a ON TRUE
    LEFT JOIN pg_roles r ON r.oid = a.grantee
   WHERE n.nspname = 'public'
     AND p.proname IN ('get_student_list', 'can_see_student_lists')
     AND a.privilege_type = 'EXECUTE'
     AND (a.grantee = 0 OR r.rolname = 'anon');
  IF v_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '% grant(s) of EXECUTE to anon or PUBLIC on the slice-4 functions', v_count;
  END IF;

  -- (e) Both are SECURITY DEFINER with a pinned search_path. A DEFINER function with a
  -- mutable search_path is a privilege-escalation surface, not a privacy one.
  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('get_student_list', 'can_see_student_lists')
     AND p.prosecdef
     AND p.proconfig::text ILIKE '%search_path=public%';
  IF v_count IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'expected 2 SECURITY DEFINER functions with search_path=public, found %', v_count;
  END IF;

  -- (f) NO NEW POLICY ON profiles. This slice is exactly when one would be added "just to
  -- make the join work", and the whole design above is the argument against it. Derived
  -- count, permissive only, SELECT and ALL — a FOR ALL policy grants SELECT while leaving
  -- a cmd='SELECT' count untouched.
  SELECT count(*) INTO v_count
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'profiles'
     AND permissive = 'PERMISSIVE' AND cmd IN ('SELECT', 'ALL');
  IF v_count IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'profiles now has % permissive SELECT/ALL policies, expected 3 (owner read, admin read all, admin read profiles)', v_count;
  END IF;

  -- (g) The widened CHECK, read back from the catalog.
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.content_reports'::regclass
     AND conname = 'content_reports_content_type_check';
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_have
    FROM regexp_matches(v_def, '''([a-z_]+)''::text', 'g') AS m;
  IF v_have IS DISTINCT FROM ARRAY['answer', 'facility', 'place', 'profile', 'question', 'review'] THEN
    RAISE EXCEPTION 'content_reports admits % after the widening — expected the 5 old types plus profile. Live definition: %',
      coalesce(array_to_string(v_have, ','), '<none>'), coalesce(v_def, '<missing>');
  END IF;

  -- (h) auto_hide_reported_content() STILL HAS NO PROFILE BRANCH, and still has the five
  -- it should. Anchored on `UPDATE profiles` — a code shape, not the word "profile",
  -- which appears in prose and would make this token forbid its own explanation.
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'auto_hide_reported_content';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'auto_hide_reported_content() is missing';
  END IF;
  IF v_def ILIKE '%UPDATE profiles%' THEN
    RAISE EXCEPTION 'auto_hide_reported_content() now writes profiles — a person must not be auto-hidden at 3 reports';
  END IF;
  IF NOT (v_def ILIKE '%UPDATE reviews%' AND v_def ILIKE '%UPDATE questions%'
          AND v_def ILIKE '%UPDATE answers%' AND v_def ILIKE '%UPDATE facilities%'
          AND v_def ILIKE '%UPDATE places%') THEN
    RAISE EXCEPTION 'auto_hide_reported_content() has lost one of its five branches: %', left(v_def, 400);
  END IF;

  RAISE NOTICE 'slice 4 OK — AUTH_REQUIRED fires, 6 columns pinned, anon has no EXECUTE, profiles still has 3 read policies, no profile auto-hide';
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
VALUES ('20261026_student_list_rpc.sql', 'bc53a499737ec02e5ba37dc7c592cabf5d84f9630cff30ccf591dd490ca0b3d9')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- No ADD COLUMN, but PostgREST enumerates FUNCTIONS into the same cache: without this the
-- two new RPCs can be missing from the API surface until the next unrelated reload.
NOTIFY pgrst, 'reload schema';

-- ─── Who can call / see what ────────────────────────────────────────────────
--   • An opted-in, non-anonymous, non-banned user calling get_student_list(<uni>) gets
--     six columns for each opted-in, non-banned, non-blocked student at that ACTIVE
--     university, themselves first. Any university, not only their own.
--   • A signed-up user who has NOT opted in → NOT_LISTED. No rows, no count, nothing.
--   • A guest / anonymous session → AUTH_REQUIRED.
--   • anon (signed out) → no EXECUTE at all; the call fails at the permission layer.
--   • Nobody, at any level, can obtain phone, date_of_birth, push_token, email, role,
--     nationality, region, resident_status or full_name through this function.
--
-- ─── Verify (run separately, after the COMMIT) ──────────────────────────────
--   SELECT p.proname, p.prosecdef, p.provolatile, p.proconfig,
--          pg_get_function_result(p.oid) AS returns
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public' AND p.proname IN ('get_student_list','can_see_student_lists');
--   -- expect prosecdef = t, provolatile = s, proconfig = {search_path=public}
--
--   SELECT r.rolname, a.privilege_type
--     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
--          LATERAL aclexplode(p.proacl) a LEFT JOIN pg_roles r ON r.oid=a.grantee
--    WHERE n.nspname='public' AND p.proname IN ('get_student_list','can_see_student_lists');
--   -- expect authenticated + postgres only; NO anon, NO PUBLIC (grantee 0)
--
--   SELECT policyname, cmd, permissive FROM pg_policies
--    WHERE schemaname='public' AND tablename='profiles' ORDER BY cmd, policyname;
--   -- expect the SAME set as before this file: 3 permissive SELECT, no ALL.
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   SET ROLE postgres;
--   DROP FUNCTION IF EXISTS public.get_student_list(uuid, text, integer);
--   DROP FUNCTION IF EXISTS public.can_see_student_lists();
--   -- The CHECK only widens, so reverting it is optional and FAILS if a profile report
--   -- has been filed. Check first:
--   --   SELECT count(*) FROM content_reports WHERE content_type = 'profile';
--   ALTER TABLE public.content_reports DROP CONSTRAINT content_reports_content_type_check;
--   ALTER TABLE public.content_reports ADD  CONSTRAINT content_reports_content_type_check
--     CHECK (content_type IN ('review','question','answer','facility','place'));
--   DELETE FROM public.schema_migrations_applied WHERE filename = '20261026_student_list_rpc.sql';
--   RESET ROLE;
--   NOTIFY pgrst, 'reload schema';
