-- ═══ Slice 5 UI — the student profile page's one read path ═════════════════
--
-- ─── WHY THIS IS 28 AND NOT 27 ──────────────────────────────────────────────
--
-- 20261027 IS RESERVED for the migration that absorbs straggler affiliation values and
-- then DROPS the five profiles columns. That reservation is not a preference: 20261026
-- is APPLIED, its checksum is recorded in schema_migrations_applied, and its prose names
-- 20261027 as the drop in nine places. Editing an applied file to renumber anything
-- changes its checksum and puts migration_ledger_check into L2 mismatch against a
-- database that is perfectly correct — the "known-stale row teaches the reader to skim"
-- failure, bought for nothing.
--
-- So the sequence has a deliberate gap. The drop now comes after slice 6 and the OTA.
--
-- ─── WHAT THIS ADDS ─────────────────────────────────────────────────────────
--
-- ONE function. The profile page is the second surface where one customer's data reaches
-- another, and it obeys the same architecture as the first (20260819 / 20260922 /
-- 20261002 / 20261026): a column-limited SECURITY DEFINER function, never a policy.
--
-- get_student_list answers "who is at this university". This answers "what is this
-- person's education history" — the same people, more rows each, and NOT ONE MORE FACT
-- ABOUT THEM. No phone, no date of birth, no full_name, no push_token, no email, and no
-- free-text anything: the profile page has no bio by design, so there is no field here
-- for a stranger to write into.
--
-- ─── EIGHT COLUMNS, ONE ROW PER ENROLMENT ───────────────────────────────────
--
-- display_name and avatar_url repeat on every row. That is deliberate: the alternative
-- was a single row with the enrolments packed into jsonb, and a jsonb column is a hole in
-- the one guard that matters here. pg_get_function_result pins the SHAPE, and the shape is
-- only worth pinning while the shape is the whole surface — the moment a jsonb column
-- exists, a ninth fact can be added inside it without the pin moving at all.
--
-- `level` comes back RAW ('university' / 'postgraduate'), not localised. There is no
-- level_i18n table and inventing one to render two words would be a schema for a label.
-- The client maps it through STUDENT_LEVEL_LABEL_KEY in constants/profileGate.js, which
-- already covers both values and is exported so validate-i18n-coverage can see the keys.
--
-- ─── VISIBILITY: RAISE FOR THE CALLER, SILENCE FOR THE SUBJECT ──────────────
--
-- Two gates RAISE, because they are about the CALLER and the client must tell them apart:
--   AUTH_REQUIRED  — a guest, or no uid at all.
--   NOT_LISTED     — signed in, but no opted-in enrolment of their own. Reciprocity.
--
-- EVERY OTHER REASON RETURNS ZERO ROWS, and they are deliberately indistinguishable:
-- the subject opted out between the tap and the load, one of the two has blocked the
-- other, the subject is UGC-banned, they cleared their display name, or the id is simply
-- not a person. Distinct errors here would turn this function into an oracle: a stranger
-- could learn "you have blocked me" or "you are banned" by reading which message came
-- back. One empty result, one message on screen.
--
-- ─── EXECUTION ──────────────────────────────────────────────────────────────
-- SQL editor, Role = postgres, the WHOLE FILE. Requires 20261026.

SET ROLE postgres;

BEGIN;

-- ─── 0. Requires 20261026 ───────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.student_education') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: student_education does not exist — apply 20261026 first. Nothing applied.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'can_see_student_lists') THEN
    RAISE EXCEPTION 'REFUSING: can_see_student_lists() is missing — apply 20261026 first. Nothing applied.';
  END IF;
END $$;

-- ─── 1. The profile read ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_student_profile(
  p_user_id uuid,
  p_lang    text DEFAULT 'English'
)
 RETURNS TABLE(user_id uuid, display_name text, avatar_url text,
               institution_name text, level text, subject_name text,
               study_start_year smallint, study_end_year smallint)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me   uuid := auth.uid();
  v_lang text;
BEGIN
  -- `authenticated` INCLUDES anonymous sessions in Supabase, so the GRANT is not the
  -- guard — this is. Same two gates as get_student_list, same two messages, and
  -- can_see_student_lists() is REUSED rather than re-derived: one reciprocity rule.
  IF v_me IS NULL OR is_anonymous_session() THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF NOT can_see_student_lists() THEN
    RAISE EXCEPTION 'NOT_LISTED';
  END IF;

  -- Validity DERIVED from the data, not from nine names typed here. Unknown language
  -- falls back to English rather than raising.
  SELECT CASE WHEN EXISTS (SELECT 1 FROM subject_i18n si WHERE si.lang = p_lang)
              THEN p_lang ELSE 'English' END
    INTO v_lang;

  RETURN QUERY
  SELECT e.user_id, p.display_name, p.avatar_url, i.name, e.level, sn.name,
         e.study_start_year, e.study_end_year
    FROM student_education e
    JOIN profiles p     ON p.id = e.user_id
    JOIN institutions i ON i.id = e.institution_id AND i.is_active
    LEFT JOIN LATERAL (
      SELECT si.name
        FROM subject_i18n si
       WHERE si.subject_id = e.subject_id
       ORDER BY (si.lang = v_lang) DESC, (si.lang = 'English') DESC, si.lang
       LIMIT 1
    ) sn ON TRUE
   WHERE e.user_id = p_user_id
     -- The same six filters as the list, because the profile must never show a person, or
     -- an enrolment, that the list would have withheld. A profile page reachable only by
     -- guessing a uuid would otherwise be the way around every one of them.
     AND e.listing_opt_in
     AND p.display_name IS NOT NULL
     AND (p.ugc_banned_until IS NULL OR p.ugc_banned_until <= now())
     AND NOT EXISTS (
       SELECT 1 FROM blocks b
        WHERE (b.blocker_id = v_me AND b.blocked_id = e.user_id)
           OR (b.blocker_id = e.user_id AND b.blocked_id = v_me)
     )
   -- Current enrolments first — somebody standing on a campus today is the headline, and
   -- an alumni row rendered above it reads as out of date. Then most recent start, then
   -- the university name so the order is total and the page does not reshuffle per load.
   ORDER BY (e.study_end_year IS NULL) DESC,
            e.study_start_year DESC NULLS LAST,
            i.name;
END;
$function$;

COMMENT ON FUNCTION public.get_student_profile(uuid, text) IS
  'Student Hub slice 5. One opted-in student''s education history, eight columns, one row '
  'per enrolment, for an opted-in caller only. Never returns phone, date_of_birth, '
  'push_token, email or full_name, and there is no free-text field to return. Every '
  'not-visible reason yields ZERO ROWS so the function cannot be used as an oracle. '
  'See 20261028.';

-- ─── 2. Grants ──────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.get_student_profile(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_student_profile(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_student_profile(uuid, text) TO authenticated;

-- ─── 3. Assertions ──────────────────────────────────────────────────────────
-- Read back from the catalogs, never from the statements above. A migration is a
-- statement of intent; between it and the database sit a manual paste and a partial
-- selection. Behaviour is proved in scratchpad/pg/s28.cjs, driven as ROLE authenticated.
DO $$
DECLARE
  v_def   text;
  v_count int;
  v_res   text;
BEGIN
  -- (a) The column list, pinned as the exact rendering. This is the whole privacy claim.
  SELECT pg_get_function_result(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_student_profile';
  IF v_def IS DISTINCT FROM
     'TABLE(user_id uuid, display_name text, avatar_url text, institution_name text, level text, subject_name text, study_start_year smallint, study_end_year smallint)' THEN
    RAISE EXCEPTION 'get_student_profile returns % — not the eight agreed columns', coalesce(v_def, '<missing>');
  END IF;

  -- (b) DEFINER, search_path pinned, guest guard in the body.
  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_student_profile'
     AND p.prosecdef
     AND p.proconfig::text ILIKE '%search_path=public%'
     AND pg_get_functiondef(p.oid) ILIKE '%is_anonymous_session%'
     AND pg_get_functiondef(p.oid) ILIKE '%can_see_student_lists%';
  IF v_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'get_student_profile is not DEFINER+pinned+guarded+reciprocity-gated (matched %)', v_count;
  END IF;

  -- (c) No EXECUTE for anon or PUBLIC. aclexplode, not has_function_privilege: the
  --     latter raises on an absent function, and absence must stay reportable.
  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN LATERAL aclexplode(p.proacl) a ON TRUE
    LEFT JOIN pg_roles r ON r.oid = a.grantee
   WHERE n.nspname = 'public' AND p.proname = 'get_student_profile'
     AND a.privilege_type = 'EXECUTE'
     AND (a.grantee = 0 OR r.rolname = 'anon');
  IF v_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '% grant(s) of EXECUTE to anon or PUBLIC on get_student_profile', v_count;
  END IF;

  -- (d) The guest gate FIRES. As postgres there is no auth.uid(), so this must raise —
  --     a positive control that the gate is reachable at all, not merely present in the
  --     body. What does a healthy system print here? An exception. A broken one returns
  --     rows, which is the whole failure this slice must not ship.
  BEGIN
    SELECT count(*)::text INTO v_res
      FROM get_student_profile('00000000-0000-4000-a000-000000000001'::uuid, 'English');
    RAISE EXCEPTION 'get_student_profile did NOT raise with no auth.uid() (got % row(s)) — guests can read a profile', v_res;
  EXCEPTION
    WHEN sqlstate 'P0001' THEN
      IF SQLERRM NOT IN ('AUTH_REQUIRED', 'NOT_LISTED') THEN RAISE; END IF;
  END;

  RAISE NOTICE '20261028 verified: 8 columns, DEFINER+pinned, guest-guarded, no anon EXECUTE';
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
VALUES ('20261028_student_profile_rpc.sql', 'ab53efc8aab9da4de3d4157f63eeeb9eb536b5d6d71ea32de9ae2bc12c2291b5')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;
