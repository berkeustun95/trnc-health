-- ═══ Slice 5 schema — education history, and the student list rebuilt on it ═══
--
-- REWRITTEN IN PLACE on 2026-09-16. The first version of this file added the student-list
-- RPCs over profiles.institution_id, one university per person. It was never applied, so
-- there is nothing to undo — the same reasoning that let 20261022 section 3 be rewritten.
--
-- ─── WHY THE COLUMNS MOVE, AND WHY A "CURRENT" POINTER IS NOT THE ANSWER ────
--
-- 20261024's third arm is the proof. It permits institution_id whenever study_end_year is
-- NOT NULL, so that a graduate keeps their university — which means profiles.institution_id
-- ALREADY points at a place someone has left. The single-row shape has been conflating
-- "where I am now" with "where I was most recently" since the day it was written.
--
-- So keeping institution_id as a current/primary pointer is not the cheap option. Either
-- it inherits that conflation and is not a current pointer at all, or the third arm has to
-- be unwound and graduates moved into the table anyway. The columns do not survive as-is
-- under either answer, and keeping them buys a second source of truth for one fact.
--
-- "Current" is DERIVED, not stored: study_end_year IS NULL. That is only well-defined with
-- the partial unique index below — at most one open enrolment per person. Without it,
-- "current" is ambiguous and the argument for a pointer column comes straight back.
--
-- THE COUPLING CHECKS ARE NOT LOST, THEY BECOME UNNECESSARY. Three of the five exist only
-- because the columns are nullable on a wide table:
--   • profiles_study_fields_require_institution_check — institution_id is NOT NULL here.
--   • profiles_listing_opt_in_requires_institution_check — same row, same reason.
--   • the institution arm of profiles_institution_coupling_check — nothing to couple.
-- The two year checks move verbatim. Five CHECKs become two, and both are stronger.
--
-- What IS given up: the database can no longer enforce "a university-level student has an
-- institution" — a cross-table invariant a CHECK cannot express. That is a COMPLETENESS
-- rule, not a corruption rule. A profile with student_level='university' and no education
-- row is incomplete, not broken, and ProfileScreen.js:456 already refuses to save it.
--
-- profiles.student_level STAYS. It is the wizard's status answer and covers high_school,
-- language_course and vocational, which have no institution. profiles_student_level_
-- coupling_check is untouched by this file and by 20261027.
--
-- ─── THIS FILE DROPS NOTHING. THAT IS THE POINT. ────────────────────────────
--
-- ProfileSetupScreen.js:484 writes institution_id in the completion path with NO flag
-- check, and ProfileScreen.js:387 spreads the same patch into every save. Dropping those
-- columns before the app stops writing them breaks every profile save AND the mandatory
-- signup gate with a 42703 — for every new user, immediately.
--
-- And OTA is ON_LOAD: an update downloads on launch and applies on the NEXT one, so every
-- user has a one-launch window on old JS whenever they next open the app, including
-- someone returning after three weeks.
--
--   1. THIS FILE          creates the table, backfills it, mirrors old-client writes into
--                         it, and rebuilds the RPCs on it. profiles keeps every column.
--   2. OTA                the app reads and writes student_education. Verified across two
--                         launch cycles on the Play Store build.
--   3. 20261027           ABSORBS any straggler institution_id into the table — never
--                         asserts it is NULL — then drops the columns, their constraints,
--                         the profiles trigger and the transition trigger below.
--
-- Between 1 and 3 both places hold the data. That is the drift this design exists to end,
-- so it is deliberate, bounded, and the transition trigger is what keeps the two agreeing.
--
-- ─── EXECUTION ──────────────────────────────────────────────────────────────
-- SQL editor, Role = postgres, the WHOLE FILE. Requires 20261024 (subjects, study columns)
-- and 20260712 (blocks, content_reports, ugc_banned_until).

SET ROLE postgres;

BEGIN;

-- ─── 0. Has 20261027 already run? ───────────────────────────────────────────
-- FIRST, before anything reads those columns. Without this the backfill below is the
-- thing that fails, with `column p.student_listing_opt_in does not exist` — true, but it
-- describes a symptom and sends the reader looking for a typo instead of telling them
-- this file has been superseded.
DO $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM information_schema.columns
   WHERE table_schema='public' AND table_name='profiles'
     AND column_name IN ('institution_id','study_start_year','study_end_year','subject_id','student_listing_opt_in');
  IF v_count IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'REFUSING: profiles carries % of the 5 affiliation columns — 20261027 has already dropped them. Do not re-apply 20261026. Nothing applied.', v_count;
  END IF;
END $$;

-- ─── 1. student_education ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.student_education (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- RESTRICT, not SET NULL: institution_id is NOT NULL here, and an institution is
  -- deactivated rather than deleted (20261021). Deleting one must fail loudly rather
  -- than silently erase the history rows that point at it.
  institution_id  uuid NOT NULL REFERENCES public.institutions(id) ON DELETE RESTRICT,
  level           text NOT NULL,
  subject_id      uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  -- NULLABLE, deliberately. The wizard's year step is optional and skippable (slice 2),
  -- so a row with an institution and no years is legitimate and exists today. NOT NULL
  -- would fail the backfill on exactly the rows RLS stops anyone from inspecting first.
  study_start_year smallint,
  study_end_year   smallint,
  -- THE OPT-IN LIVES HERE, NOT ON THE PERSON. A student may want to appear at the
  -- university they attend now and not at the one they left; one boolean per person
  -- cannot express that. DEFAULT false is the privacy guarantee, same as 20261024's.
  listing_opt_in  boolean NOT NULL DEFAULT false,
  -- PROVENANCE, and it is load-bearing. The transition trigger below may only touch rows
  -- IT created (this flag true: the backfill, and its own inserts). A row the app created
  -- is permanently off-limits to it — never updated, never deleted.
  --
  -- The trigger is SCAFFOLDING THAT DIES IN 20261027. Letting temporary scaffolding
  -- destroy permanent user data is the wrong trade, and the echo bug proved the trigger
  -- cannot reliably tell a deliberate change from a stale one: `AFTER UPDATE OF` fires on
  -- SET-list membership, not on value change. So the rule is structural, not inferred.
  --
  -- DEFAULT false is the protection, the same inversion as towing_companies.is_active
  -- (20260907): a banner in one file protects the one path somebody wrote; the default
  -- protects every path nobody has written yet. The app never names this column, so every
  -- row it inserts is app-owned automatically. The default is registered as an H token in
  -- verify_schema.sql, because a reverted DEFAULT creates no named object.
  --
  -- NOT in EDUCATION_COLUMNS, alongside id and created_at: it is provenance, not something
  -- the user told us. Do not "fix" that. 20261027 drops it with the trigger.
  mirror_owned    boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Re-runnable: the table above is CREATE TABLE IF NOT EXISTS, so a re-apply after an
-- earlier draft needs the column added explicitly.
ALTER TABLE public.student_education
  ADD COLUMN IF NOT EXISTS mirror_owned boolean NOT NULL DEFAULT false;

ALTER TABLE public.student_education DROP CONSTRAINT IF EXISTS student_education_level_check;
ALTER TABLE public.student_education ADD  CONSTRAINT student_education_level_check
  CHECK (level IN ('university', 'postgraduate'));

-- BSc then MSc at the same university is one of the commonest shapes in the TRNC, so the
-- key carries level. Two rows for the same degree at the same place remain impossible.
ALTER TABLE public.student_education DROP CONSTRAINT IF EXISTS student_education_user_inst_level_key;
ALTER TABLE public.student_education ADD  CONSTRAINT student_education_user_inst_level_key
  UNIQUE (user_id, institution_id, level);

-- Sanity bounds only, carried over verbatim from 20261024.
ALTER TABLE public.student_education DROP CONSTRAINT IF EXISTS student_education_start_year_range_check;
ALTER TABLE public.student_education ADD  CONSTRAINT student_education_start_year_range_check
  CHECK (study_start_year IS NULL OR study_start_year BETWEEN 1950 AND 2100);

ALTER TABLE public.student_education DROP CONSTRAINT IF EXISTS student_education_end_year_range_check;
ALTER TABLE public.student_education ADD  CONSTRAINT student_education_end_year_range_check
  CHECK (study_end_year IS NULL OR study_end_year BETWEEN 1950 AND 2100);

-- An end year REQUIRES a start year. `end >= start` alone is UNKNOWN when start is NULL,
-- and a CHECK passes on UNKNOWN — the explicit IS NOT NULL arm is what makes this bite.
ALTER TABLE public.student_education DROP CONSTRAINT IF EXISTS student_education_years_order_check;
ALTER TABLE public.student_education ADD  CONSTRAINT student_education_years_order_check
  CHECK (study_end_year IS NULL
         OR (study_start_year IS NOT NULL AND study_end_year >= study_start_year));

-- ⚠ THE LOAD-BEARING ONE. "Current" is derived from study_end_year IS NULL, and that is
--   only a definition if at most one row per person can be open. A partial unique INDEX,
--   not a constraint — Postgres has no partial UNIQUE constraint.
--
--   CONSEQUENCE FOR THE UI, and it is a real product rule: adding a second university
--   forces the user to close the first one with a graduation year. The wizard and
--   ProfileScreen must collect that in the same write, the way slice 2 already makes a
--   past university atomic.
DROP INDEX IF EXISTS public.student_education_one_open_per_user;
CREATE UNIQUE INDEX student_education_one_open_per_user
  ON public.student_education (user_id) WHERE study_end_year IS NULL;

-- The student list reads by institution among opted-in rows only.
DROP INDEX IF EXISTS public.idx_student_education_listed;
CREATE INDEX idx_student_education_listed
  ON public.student_education (institution_id) WHERE listing_opt_in;

COMMENT ON TABLE public.student_education IS
  'One row per enrolment. Replaces profiles.institution_id/study_*/subject_id/'
  'student_listing_opt_in, which 20261027 drops after the app stops writing them.';

-- ─── 2. The future-end-year trigger MOVES — the same function, bound here ───
-- check_profile_study_years() reads only NEW.study_end_year and pins search_path to '',
-- so it is already generic: the columns are named identically on this table and the
-- function needs no edit at all. Its name keeps saying "profile"; renaming it would mean
-- dropping and recreating a live function and rewriting 20261024's token for no gain.
--
-- STUDY_END_YEAR_IN_FUTURE is kept byte-for-byte: ProfileScreen.js:396 and
-- ProfileSetupScreen.js:470 both match on that string, and those mappings survive
-- untouched only while it does.
DROP TRIGGER IF EXISTS check_student_education_years ON public.student_education;
CREATE TRIGGER check_student_education_years
  BEFORE INSERT OR UPDATE ON public.student_education
  FOR EACH ROW EXECUTE FUNCTION public.check_profile_study_years();

-- ─── 3. RLS — owner only, plus admin. NOTHING cross-customer. ───────────────
--
-- ⚠ THE JOIN THAT MAKES THIS DANGEROUS: reviews.customer_id is publicly readable, so
--   `reviews?select=profiles(*,student_education(*))` walks any cross-user SELECT policy
--   here and hands a stranger's study history to anyone who can read a review. The
--   student list is served by a SECURITY DEFINER function precisely so that no policy on
--   this table ever needs to be wider than the owner.
--
--   Do NOT add "authenticated read where listing_opt_in". It looks harmless and it is the
--   whole leak. And this table must never enter search_content.
ALTER TABLE public.student_education ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "student_education owner read"   ON public.student_education;
CREATE POLICY "student_education owner read" ON public.student_education
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "student_education admin read"   ON public.student_education;
CREATE POLICY "student_education admin read" ON public.student_education
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "student_education owner insert" ON public.student_education;
CREATE POLICY "student_education owner insert" ON public.student_education
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "student_education owner update" ON public.student_education;
CREATE POLICY "student_education owner update" ON public.student_education
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "student_education owner delete" ON public.student_education;
CREATE POLICY "student_education owner delete" ON public.student_education
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- The 20260714 anon blocks, which that migration's table list predates this table.
DROP POLICY IF EXISTS "no_anon_insert_student_education" ON public.student_education;
CREATE POLICY "no_anon_insert_student_education" ON public.student_education
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_anonymous_session());

DROP POLICY IF EXISTS "no_anon_update_student_education" ON public.student_education;
CREATE POLICY "no_anon_update_student_education" ON public.student_education
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.is_anonymous_session())
  WITH CHECK (NOT public.is_anonymous_session());

DROP POLICY IF EXISTS "no_anon_delete_student_education" ON public.student_education;
CREATE POLICY "no_anon_delete_student_education" ON public.student_education
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.is_anonymous_session());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_education TO authenticated;

-- ─── 4. Backfill — DERIVED, asserted, printed. Never a hardcoded count. ─────
DO $$
DECLARE
  v_source   int;
  v_before   int;
  v_inserted int;
  v_after    int;
  v_guessed  int;
BEGIN
  SELECT count(*) INTO v_source FROM public.profiles WHERE institution_id IS NOT NULL;
  SELECT count(*) INTO v_before FROM public.student_education;
  RAISE NOTICE 'backfill: % profile(s) carry an institution; student_education holds % row(s) before', v_source, v_before;

  -- level: profiles.student_level is the best evidence, but 20261024's third arm permits
  -- an institution with NO university-level student_level (a graduate who now works). For
  -- those the level is genuinely unknown and 'university' is the commonest case — a
  -- structured field the owner can correct on their own profile page. The number of rows
  -- that took the fallback is PRINTED rather than buried, because it is a guess.
  SELECT count(*) INTO v_guessed FROM public.profiles
   WHERE institution_id IS NOT NULL
     AND (student_level IS NULL OR student_level NOT IN ('university', 'postgraduate'));

  -- mirror_owned = true: these rows ARE profiles.institution_id in the new shape, so the
  -- transition trigger has to be allowed to keep them in step for the rest of the window.
  -- Everything the app creates from here on defaults to false and is off-limits to it.
  INSERT INTO public.student_education
    (user_id, institution_id, level, subject_id, study_start_year, study_end_year,
     listing_opt_in, mirror_owned)
  SELECT p.id, p.institution_id,
         CASE WHEN p.student_level IN ('university', 'postgraduate') THEN p.student_level
              ELSE 'university' END,
         p.subject_id, p.study_start_year, p.study_end_year, p.student_listing_opt_in, true
    FROM public.profiles p
   WHERE p.institution_id IS NOT NULL
  ON CONFLICT (user_id, institution_id, level) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  SELECT count(*) INTO v_after FROM public.student_education;

  -- Re-runnable: on a second apply ON CONFLICT DO NOTHING inserts 0 and the totals still
  -- have to agree. What must never happen is a source row with no row here.
  IF v_after IS DISTINCT FROM v_before + v_inserted THEN
    RAISE EXCEPTION 'backfill arithmetic does not close: % before + % inserted <> % after', v_before, v_inserted, v_after;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.institution_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.student_education e
                        WHERE e.user_id = p.id AND e.institution_id = p.institution_id)
  ) THEN
    RAISE EXCEPTION 'a profile with an institution has no student_education row — the backfill missed it';
  END IF;

  RAISE NOTICE 'backfill: % inserted, % total, % row(s) took the level fallback', v_inserted, v_after, v_guessed;
END $$;

-- ─── 5. Transition trigger — old clients keep working until 20261027 ────────
--
-- Between this file and the OTA, and for the one-launch window after it, the live app
-- still writes profiles.institution_id. Without this, those writes would be invisible to
-- the student list and the two stores would drift apart — the exact failure the move is
-- meant to end. Same shape as display_name_normalized: the server maintains the derived
-- store so no client has to know it exists.
--
-- ⚠ ONE RULE ABOVE ALL OTHERS: IT NEVER DELETES, AND NEVER TOUCHES A ROW THE APP MADE.
--   It may CREATE a row, and UPDATE a row it created itself (mirror_owned). Nothing else.
--   There is no DELETE anywhere in the body, and section 10 asserts that against pg_proc
--   rather than trusting this comment.
--
--   Why the rule is absolute rather than best-effort: this trigger is SCAFFOLDING THAT
--   DIES IN 20261027. Temporary scaffolding must not be able to destroy permanent user
--   data, whatever it thinks it knows. And it cannot reliably know — `AFTER UPDATE OF`
--   fires on SET-list membership, not on value change, so a stale bundle's echo and a
--   deliberate edit arrive looking identical. Two drafts of this trigger were wrong in
--   exactly that gap (below). A structural rule holds where inference did not.
--
--   THE SAFE FAILURE IS "IGNORED". A stale device's move either lands as an extra row or
--   is dropped on the floor with a RAISE LOG breadcrumb. A lost row is permanent; a
--   duplicate is visible to its owner and fixable on their own profile page.
--
-- ⚠ AND IT MUST NEVER RAISE. Draft 1 INSERTed unconditionally, so an old client CHANGING
--   university produced a SECOND open row and hit student_education_one_open_per_user
--   with a 23505 — failing the user's profile save outright. That is precisely the outage
--   this file is sequenced to avoid, arriving through the safety net rather than through
--   the drop. Draft 2 fixed it by DELETING the row it thought it was replacing, which is
--   how it came to destroy a master's degree somebody had just added on another device.
--   Both caught by scratchpad/pg/s26e.cjs before either was applied.
--
--   The resolution is to do neither: check first, and decline the write when it cannot be
--   made without breaking something. An old client can express exactly ONE affiliation,
--   so it simply has nothing to say about a second enrolment.
--
-- REMOVE IT IN 20261027, in the same transaction that drops the columns it reads. It has
-- no purpose once the columns are gone, and it cannot outlive them: its body references
-- NEW.institution_id, so it would raise on every profile write.
CREATE OR REPLACE FUNCTION public.mirror_profile_affiliation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_level     text;
  v_id        uuid;      -- the row for THIS exact enrolment, if there is one
  v_mine      boolean;   -- …and whether this trigger is the one that made it
  v_end       smallint;
  v_open_id   uuid;      -- the person's OTHER open enrolment, if any
  v_open_mine boolean;   -- …and whether this trigger made that one
BEGIN
  -- ─── ECHOES ARE NO-OPS. This arm is the important one. ────────────────────
  -- `AFTER UPDATE OF <cols>` fires when a column is in the SET LIST, not when its value
  -- changes — and the live app spreads ...aff into EVERY save, echoing whatever profiles
  -- already holds. After the OTA those columns go stale, so a straggler on old JS
  -- changing their PHONE NUMBER would re-send a stale institution_id and, without this,
  -- retire the enrolment they had just added in the new app. The safety net would destroy
  -- the very thing it exists to protect, in exactly the window it exists for.
  IF TG_OP = 'UPDATE'
     AND NEW.institution_id         IS NOT DISTINCT FROM OLD.institution_id
     AND NEW.student_level          IS NOT DISTINCT FROM OLD.student_level
     AND NEW.subject_id             IS NOT DISTINCT FROM OLD.subject_id
     AND NEW.study_start_year       IS NOT DISTINCT FROM OLD.study_start_year
     AND NEW.study_end_year         IS NOT DISTINCT FROM OLD.study_end_year
     AND NEW.student_listing_opt_in IS NOT DISTINCT FROM OLD.student_listing_opt_in THEN
    RETURN NULL;
  END IF;

  IF NEW.institution_id IS NULL THEN
    IF TG_OP = 'UPDATE' AND OLD.institution_id IS NOT NULL THEN
      -- Cleared by an old client: honour the visibility intent on the enrolment that
      -- client could actually SEE — its own mirrored row — and keep the history.
      --
      -- SCOPED TO mirror_owned, and that scoping is not pedantry. affiliationPatch()
      -- clears institution_id as a SIDE EFFECT of changing resident_status to 'working',
      -- so an unscoped unlist would rip a CURRENT master's off every list because the user
      -- said on an old device that they got a job. The old client is not talking about an
      -- enrolment it has never heard of.
      UPDATE student_education SET listing_opt_in = false
       WHERE user_id = NEW.id AND mirror_owned;
    END IF;
    RETURN NULL;
  END IF;

  v_level := CASE WHEN NEW.student_level IN ('university', 'postgraduate')
                  THEN NEW.student_level ELSE 'university' END;

  SELECT e.id, e.mirror_owned, e.study_end_year INTO v_id, v_mine, v_end
    FROM student_education e
   WHERE e.user_id = NEW.id AND e.institution_id = NEW.institution_id AND e.level = v_level;

  -- ─── The row exists and the APP made it: hands off. ───────────────────────
  IF v_id IS NOT NULL AND NOT v_mine THEN
    RAISE LOG 'mirror_profile_affiliation: ignoring write for % — % is app-owned',
      NEW.id, v_id;
    RETURN NULL;
  END IF;

  -- The person's OTHER open enrolment, if they have one. At most one row can match: the
  -- partial unique index says so. Everything below turns on whether it exists and, if it
  -- does, WHO MADE IT — never on deleting it.
  SELECT e.id, e.mirror_owned INTO v_open_id, v_open_mine
    FROM student_education e
   WHERE e.user_id = NEW.id AND e.study_end_year IS NULL
     AND (v_id IS NULL OR e.id <> v_id);

  IF v_id IS NOT NULL THEN
    -- ─── The row exists and this trigger made it: update, changed fields only. ───
    -- The other values are stale copies of what profiles held; writing them back is how
    -- draft 2 reopened closed rows. Nothing here can delete or move a row.
    IF NEW.study_end_year IS NULL AND v_end IS NOT NULL AND v_open_id IS NOT NULL THEN
      -- Reopening this one would collide with another open enrolment. Decline the whole
      -- write rather than apply half of it: a partial update is harder to reason about
      -- later than a write that plainly did not happen.
      RAISE LOG 'mirror_profile_affiliation: ignoring reopen for % — another open enrolment exists',
        NEW.id;
      RETURN NULL;
    END IF;
    UPDATE student_education e
       SET subject_id       = CASE WHEN TG_OP = 'UPDATE' AND NEW.subject_id IS DISTINCT FROM OLD.subject_id
                                   THEN NEW.subject_id ELSE e.subject_id END,
           study_start_year = CASE WHEN TG_OP = 'UPDATE' AND NEW.study_start_year IS DISTINCT FROM OLD.study_start_year
                                   THEN NEW.study_start_year ELSE e.study_start_year END,
           study_end_year   = CASE WHEN TG_OP = 'UPDATE' AND NEW.study_end_year IS DISTINCT FROM OLD.study_end_year
                                   THEN NEW.study_end_year ELSE e.study_end_year END,
           listing_opt_in   = CASE WHEN TG_OP = 'UPDATE' AND NEW.student_listing_opt_in IS DISTINCT FROM OLD.student_listing_opt_in
                                   THEN NEW.student_listing_opt_in ELSE e.listing_opt_in END
     WHERE e.id = v_id;
    RETURN NULL;
  END IF;

  -- ─── No row for this enrolment. Three cases, and only the first two act. ──
  --
  -- A CLOSED result cannot collide with the one-open-per-person index, so it just lands —
  -- an old client recording a graduation at a university it has not mentioned before.
  IF NEW.study_end_year IS NOT NULL OR v_open_id IS NULL THEN
    NULL;   -- fall through to the INSERT

  ELSIF v_open_mine THEN
    -- A MOVE, as an old client expresses one: profiles.institution_id changed, and the
    -- only open enrolment on record is the one THIS TRIGGER wrote to mirror the old value.
    -- Repurpose that row in place. This is an UPDATE of a row the trigger created — no
    -- delete, and nothing the app authored is touched, because the app has never written
    -- to a mirror_owned row (it clears the flag when it does).
    --
    -- Losing the previous institution here is correct, not a compromise: profiles no
    -- longer records it either. An old bundle can hold exactly ONE affiliation, so this
    -- row has never been anything but a picture of that single value.
    UPDATE student_education
       SET institution_id   = NEW.institution_id,
           level            = v_level,
           subject_id       = NEW.subject_id,
           study_start_year = NEW.study_start_year,
           study_end_year   = NEW.study_end_year,
           listing_opt_in   = NEW.student_listing_opt_in
     WHERE id = v_open_id;
    RETURN NULL;

  ELSE
    -- The person is already current somewhere else according to a row THE APP made, which
    -- this trigger may not touch. Ignored — the safe failure. Nothing is lost: their real
    -- enrolment stands, and their own profile page will show both universities once they
    -- are on new JS, where they can correct it.
    RAISE LOG 'mirror_profile_affiliation: ignoring new open enrolment for % — an app-owned open enrolment exists (%)',
      NEW.id, v_open_id;
    RETURN NULL;
  END IF;

  -- DO NOTHING, not DO UPDATE: between the SELECT above and this INSERT another session
  -- could have created the row, and the losing side must not overwrite the winner.
  --
  -- The EXCEPTION block is the belt. ON CONFLICT can name ONE arbiter, and this INSERT has
  -- two ways to collide: the (user, institution, level) constraint named below, and
  -- student_education_one_open_per_user, which the v_others check above only closes up to
  -- the instant it ran. Same account on two devices in the same second is rare and it is
  -- the exact population this trigger exists for, so the loser must be IGNORED rather than
  -- allowed to raise — an unhandled 23505 here fails the straggler's whole profile save.
  BEGIN
    INSERT INTO student_education
      (user_id, institution_id, level, subject_id, study_start_year, study_end_year,
       listing_opt_in, mirror_owned)
    VALUES
      (NEW.id, NEW.institution_id, v_level, NEW.subject_id,
       NEW.study_start_year, NEW.study_end_year, NEW.student_listing_opt_in, true)
    ON CONFLICT (user_id, institution_id, level) DO NOTHING;
  EXCEPTION WHEN unique_violation THEN
    RAISE LOG 'mirror_profile_affiliation: ignoring new enrolment for % — lost a race (%)',
      NEW.id, SQLERRM;
  END;

  RETURN NULL;   -- AFTER trigger
END;
$function$;

DROP TRIGGER IF EXISTS mirror_profile_affiliation ON public.profiles;
CREATE TRIGGER mirror_profile_affiliation
  AFTER INSERT OR UPDATE OF institution_id, student_level, subject_id,
                            study_start_year, study_end_year, student_listing_opt_in
  ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.mirror_profile_affiliation();

-- ─── 6. The reciprocity rule ────────────────────────────────────────────────
-- Now "has at least one opted-in enrolment" rather than one boolean on the person.
-- Slices 5 and 6 reuse this rather than re-deriving it three times.
CREATE OR REPLACE FUNCTION public.can_see_student_lists()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT NOT public.is_anonymous_session()
     AND EXISTS (
       SELECT 1
         FROM student_education e
         JOIN profiles p ON p.id = e.user_id
        WHERE e.user_id = auth.uid()
          AND e.listing_opt_in
          AND p.display_name IS NOT NULL
          AND (p.ugc_banned_until IS NULL OR p.ugc_banned_until <= now())
     );
$function$;

COMMENT ON FUNCTION public.can_see_student_lists() IS
  'Reciprocity gate for the Student Hub: true only for a non-anonymous, non-UGC-banned '
  'caller with at least one opted-in enrolment. Slices 4-6 share it.';

-- ─── 7. The list ────────────────────────────────────────────────────────────
-- SIX columns, unchanged from the single-university version — study_start_year,
-- study_end_year and subject_name simply source from the enrolment row now. The
-- verify_schema token pinning pg_get_function_result therefore still reads true, and it
-- remains the only thing watching this surface: a policy count cannot see a DEFINER
-- function.
--
-- ─── ONE ENTRY PER PERSON PER UNIVERSITY, AND WHICH ROW REPRESENTS THEM ─────
--
-- BSc and MSc at the same university are two rows by design. Rendered as two cards with
-- the same name and face, they read as a bug, so the collapse happens here.
--
-- The pick, in order:
--   1. AN OPEN ENROLMENT WINS (study_end_year IS NULL). This is the one that matters: a
--      graduate of 2018 who is on a master's there now must not be shown as alumni. The
--      card's whole claim is "current or alumni", and getting that backwards is the one
--      error a viewer would actually act on.
--   2. Then the LATEST start year. Not the highest level: level is not on the card, and
--      for the common BSc→MSc path the two agree anyway. Where they disagree — a second
--      bachelor's after a master's — the later enrolment is still the truer answer to
--      "what are they doing here".
--   3. Then id, so the result is deterministic rather than whatever the plan returns.
--
-- The filter runs BEFORE the collapse: only opted-in rows are candidates. Someone listed
-- for their BSc but not their MSc is shown as the BSc, which is exactly what they asked
-- for.
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
  IF v_me IS NULL OR is_anonymous_session() THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF NOT can_see_student_lists() THEN
    RAISE EXCEPTION 'NOT_LISTED';
  END IF;

  -- Validity DERIVED from the data, not from nine names typed here: a second copy of that
  -- list is a second thing to drift. An unknown language falls back to English rather
  -- than raising, so a locale added before its subject rows exist shows English names.
  SELECT CASE WHEN EXISTS (SELECT 1 FROM subject_i18n si WHERE si.lang = p_lang)
              THEN p_lang ELSE 'English' END
    INTO v_lang;

  RETURN QUERY
  WITH one_per_person AS (
    SELECT DISTINCT ON (e.user_id)
           e.user_id, e.subject_id, e.study_start_year, e.study_end_year
      FROM student_education e
      JOIN profiles p      ON p.id = e.user_id
      JOIN institutions i  ON i.id = e.institution_id AND i.is_active
     WHERE e.institution_id = p_institution_id
       AND e.listing_opt_in
       AND p.display_name IS NOT NULL
       AND (p.ugc_banned_until IS NULL OR p.ugc_banned_until <= now())
       AND NOT EXISTS (
         SELECT 1 FROM blocks b
          WHERE (b.blocker_id = v_me AND b.blocked_id = e.user_id)
             OR (b.blocker_id = e.user_id AND b.blocked_id = v_me)
       )
     ORDER BY e.user_id,
              (e.study_end_year IS NULL) DESC,
              e.study_start_year DESC NULLS LAST,
              e.id
  )
  SELECT o.user_id, p.display_name, p.avatar_url, sn.name,
         o.study_start_year, o.study_end_year
    FROM one_per_person o
    JOIN profiles p ON p.id = o.user_id
    LEFT JOIN LATERAL (
      SELECT si.name
        FROM subject_i18n si
       WHERE si.subject_id = o.subject_id
       ORDER BY (si.lang = v_lang) DESC, (si.lang = 'English') DESC, si.lang
       LIMIT 1
    ) sn ON TRUE
   ORDER BY (o.user_id = v_me) DESC, p.display_name
   LIMIT v_limit;
END;
$function$;

COMMENT ON FUNCTION public.get_student_list(uuid, text, integer) IS
  'Student Hub slice 4/5. Six columns of an opted-in student, for an opted-in caller only, '
  'one entry per person per university. Never returns phone, date_of_birth, push_token, '
  'email or full_name. See 20261026.';

-- ─── 8. Grants ──────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.can_see_student_lists() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_see_student_lists() FROM anon;
GRANT EXECUTE ON FUNCTION public.can_see_student_lists() TO authenticated;

REVOKE ALL ON FUNCTION public.get_student_list(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_student_list(uuid, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_student_list(uuid, text, integer) TO authenticated;

-- ─── 9. content_reports admits 'profile' ────────────────────────────────────
-- The report path behind slice 5's profile page. auto_hide_reported_content is NOT
-- touched: its branch chain has no ELSE, so a profile report already auto-hides nothing,
-- and auto-hiding a PERSON at three reports is a brigading weapon rather than a safeguard.
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

  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_have
    FROM regexp_matches(v_def, '''([a-z_]+)''::text', 'g') AS m;

  IF v_have IS NOT DISTINCT FROM v_after THEN
    RAISE NOTICE 'content_reports_content_type_check already admits profile — no-op';
  ELSIF v_have IS NOT DISTINCT FROM v_before THEN
    ALTER TABLE public.content_reports DROP CONSTRAINT content_reports_content_type_check;
    ALTER TABLE public.content_reports ADD  CONSTRAINT content_reports_content_type_check
      CHECK (content_type IN ('review', 'question', 'answer', 'facility', 'place', 'profile'));
    RAISE NOTICE 'content_reports_content_type_check: 5 types → 6 (profile added)';
  ELSE
    RAISE EXCEPTION 'REFUSING: content_reports admits % — expected % (or % on a re-run). Live definition: %. Nothing applied.',
      coalesce(array_to_string(v_have, ','), '<none>'),
      array_to_string(v_before, ','), array_to_string(v_after, ','), v_def;
  END IF;
END $$;

-- ─── 10. Assertions ─────────────────────────────────────────────────────────
-- IS DISTINCT FROM throughout: `<>` against NULL is NULL, IF NULL does not fire, and the
-- assertion would pass on exactly the failure it exists to catch.
--
-- Behaviour is asserted in scratchpad tests, not here: profiles.id references
-- auth.users(id), so this file cannot create a probe user, and writing to a REAL row to
-- test a trigger is the destructive-probe mistake 20261001 nearly shipped.
DO $$
DECLARE
  v_ok    boolean := false;
  v_res   text;
  v_count int;
  v_def   text;
  v_have  text[];
BEGIN
  -- (a) The guest guard is really in the installed body. This block runs as postgres,
  -- where auth.uid() is NULL: a return instead of a raise means every guest can call it.
  BEGIN
    PERFORM * FROM get_student_list('00000000-0000-4000-b000-000000000001'::uuid, 'English', 10);
    v_res := 'returned rows';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'AUTH_REQUIRED' THEN v_ok := true; ELSE RAISE; END IF;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'get_student_list did NOT raise AUTH_REQUIRED with no auth.uid() (got %) — guests can call it', coalesce(v_res, '<null>');
  END IF;

  IF can_see_student_lists() IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'can_see_student_lists() returned % as postgres — expected false', coalesce(can_see_student_lists()::text, '<null>');
  END IF;

  -- (b) The six columns, read from the catalog. The privacy claim of the whole slice.
  SELECT pg_get_function_result(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_student_list';
  IF v_def IS DISTINCT FROM 'TABLE(user_id uuid, display_name text, avatar_url text, subject_name text, study_start_year smallint, study_end_year smallint)' THEN
    RAISE EXCEPTION 'get_student_list returns % — not the six agreed columns', coalesce(v_def, '<missing>');
  END IF;

  -- (c) No anon / PUBLIC EXECUTE. aclexplode, not has_function_privilege(), which raises
  -- on a missing function and turns a reportable problem into an unreadable one.
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
    RAISE EXCEPTION '% grant(s) of EXECUTE to anon or PUBLIC on the slice-4/5 functions', v_count;
  END IF;

  -- (d) RLS is ON and NOTHING reads across customers. Derived counts, printed by name
  -- below, because a policy this table must never have is one somebody adds later.
  IF NOT COALESCE((SELECT c.relrowsecurity FROM pg_class c
                    WHERE c.oid = to_regclass('public.student_education')), false) THEN
    RAISE EXCEPTION 'student_education does not have RLS enabled';
  END IF;
  SELECT count(*) INTO v_count FROM pg_policies
   WHERE schemaname='public' AND tablename='student_education'
     AND permissive='PERMISSIVE' AND cmd IN ('SELECT','ALL');
  IF v_count IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'student_education has % permissive SELECT/ALL policies, expected 2 (owner read, admin read)', v_count;
  END IF;
  SELECT string_agg(policyname, ', ' ORDER BY policyname) INTO v_res FROM pg_policies
   WHERE schemaname='public' AND tablename='student_education'
     AND permissive='PERMISSIVE' AND cmd IN ('SELECT','ALL')
     AND qual NOT ILIKE '%auth.uid()%' AND qual NOT ILIKE '%is_admin%';
  IF v_res IS NOT NULL THEN
    RAISE EXCEPTION 'student_education has a SELECT policy that is neither owner-scoped nor admin: %', v_res;
  END IF;
  SELECT count(*) INTO v_count FROM pg_policies
   WHERE schemaname='public' AND tablename='student_education' AND permissive='RESTRICTIVE';
  IF v_count IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'student_education has % restrictive policies, expected 3 anon blocks', v_count;
  END IF;

  -- (e) profiles is UNCHANGED by this file. It is exactly the moment a policy would be
  -- added "just to make the join work", and the header is the argument against it.
  SELECT count(*) INTO v_count FROM pg_policies
   WHERE schemaname='public' AND tablename='profiles'
     AND permissive='PERMISSIVE' AND cmd IN ('SELECT','ALL');
  IF v_count IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'profiles now has % permissive SELECT/ALL policies, expected 3', v_count;
  END IF;

  -- (f) The one-open-enrolment index, which is what makes "current" a definition.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
                  AND indexname='student_education_one_open_per_user'
                  AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%study_end_year IS NULL%') THEN
    RAISE EXCEPTION 'student_education_one_open_per_user is missing or is not the partial unique index';
  END IF;

  -- (g) Both triggers: the moved year check, and the transition mirror.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.student_education')
                  AND tgname = 'check_student_education_years' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'check_student_education_years is not bound to student_education';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.profiles')
                  AND tgname = 'mirror_profile_affiliation' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'mirror_profile_affiliation is not bound to profiles — old-client writes would not reach the table';
  END IF;
  -- The echo guard, read back from pg_proc rather than trusted from this file. `AFTER
  -- UPDATE OF <cols>` fires on ASSIGNMENT, not on change, and the live app spreads the
  -- whole affiliation patch into every save — so without this arm a straggler editing an
  -- unrelated field re-sends a stale institution_id and retires an enrolment the new app
  -- had just written. Behaviour is proved in the scratchpad suite; this only proves the
  -- deployed body still contains the comparison.
  v_def := pg_get_functiondef('public.mirror_profile_affiliation()'::regprocedure);
  IF v_def NOT ILIKE '%IS NOT DISTINCT FROM OLD.institution\_id%'
     OR v_def NOT ILIKE '%IS NOT DISTINCT FROM OLD.student\_listing\_opt\_in%' THEN
    RAISE EXCEPTION 'mirror_profile_affiliation has no echo guard — an unchanged write would be treated as a move. Body: %', left(v_def, 600);
  END IF;
  -- THE RULE, asserted against the deployed body rather than trusted from the comment.
  -- Scaffolding does not get to delete permanent data. Anchored on the code shape
  -- 'DELETE FROM student_education', which no comment in that body contains, and paired
  -- with positives so an empty or renamed body cannot satisfy the negative by vanishing.
  IF v_def ILIKE '%DELETE FROM student\_education%'
     OR v_def NOT ILIKE '%mirror\_owned%'
     OR v_def NOT ILIKE '%INSERT INTO student\_education%' THEN
    RAISE EXCEPTION 'mirror_profile_affiliation must never DELETE and must respect mirror_owned. Body: %', left(v_def, 900);
  END IF;

  -- (h) content_reports, read back.
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.content_reports'::regclass
     AND conname = 'content_reports_content_type_check';
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_have
    FROM regexp_matches(v_def, '''([a-z_]+)''::text', 'g') AS m;
  IF v_have IS DISTINCT FROM ARRAY['answer','facility','place','profile','question','review'] THEN
    RAISE EXCEPTION 'content_reports admits % — expected the 5 old types plus profile. Live: %',
      coalesce(array_to_string(v_have, ','), '<none>'), coalesce(v_def, '<missing>');
  END IF;

  -- (i) auto_hide still has no profile branch, and still has its five. Anchored on
  -- `UPDATE profiles` — a code SHAPE, never the word "profile", which appears in prose
  -- and would make this token forbid its own explanation.
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='auto_hide_reported_content';
  IF v_def IS NULL THEN RAISE EXCEPTION 'auto_hide_reported_content() is missing'; END IF;
  IF v_def ILIKE '%UPDATE profiles%' THEN
    RAISE EXCEPTION 'auto_hide_reported_content() now writes profiles — a person must not be auto-hidden at 3 reports';
  END IF;
  IF NOT (v_def ILIKE '%UPDATE reviews%' AND v_def ILIKE '%UPDATE questions%'
          AND v_def ILIKE '%UPDATE answers%' AND v_def ILIKE '%UPDATE facilities%'
          AND v_def ILIKE '%UPDATE places%') THEN
    RAISE EXCEPTION 'auto_hide_reported_content() has lost one of its five branches: %', left(v_def, 400);
  END IF;

  -- (j) profiles still has every column this file reads. 20261027 drops them; if that has
  -- already run, THIS file must not be re-applied over it.
  SELECT count(*) INTO v_count FROM information_schema.columns
   WHERE table_schema='public' AND table_name='profiles'
     AND column_name IN ('institution_id','study_start_year','study_end_year','subject_id','student_listing_opt_in');
  IF v_count IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'profiles carries % of the 5 affiliation columns — 20261027 has already dropped them; do not re-apply 20261026', v_count;
  END IF;

  SELECT string_agg(policyname, ', ' ORDER BY policyname) INTO v_res
    FROM pg_policies WHERE schemaname='public' AND tablename='student_education';
  RAISE NOTICE 'slice 5 schema OK — student_education policies: %', v_res;
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
VALUES ('20261026_student_education.sql', 'dc31bd5023ed5fee5651209cd3e17d27dcb94738f717d163bb76c72241ba3d20')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- PostgREST enumerates TABLES and FUNCTIONS into the same cache. Without this the new
-- table and the rebuilt RPCs can be missing from the API until an unrelated reload.
NOTIFY pgrst, 'reload schema';

-- ─── Who can read what ──────────────────────────────────────────────────────
--   • A user reads and writes ONLY their own student_education rows. An admin reads all.
--   • NOBODY reads another customer's rows through RLS — the student list is served by a
--     SECURITY DEFINER function returning six columns, and that is the only cross-user path.
--   • A guest (anonymous session) gets AUTH_REQUIRED; signed-out anon has no EXECUTE.
--
-- ─── Verify (run separately, after the COMMIT) ──────────────────────────────
--   SELECT policyname, cmd, permissive, qual FROM pg_policies
--    WHERE tablename='student_education' ORDER BY permissive, cmd, policyname;   -- 5 + 3
--   SELECT count(*) FROM student_education;                                      -- = profiles with an institution
--   SELECT indexdef FROM pg_indexes WHERE indexname='student_education_one_open_per_user';
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   SET ROLE postgres;
--   DROP TRIGGER IF EXISTS mirror_profile_affiliation ON public.profiles;
--   DROP FUNCTION IF EXISTS public.mirror_profile_affiliation();
--   DROP FUNCTION IF EXISTS public.get_student_list(uuid, text, integer);
--   DROP FUNCTION IF EXISTS public.can_see_student_lists();
--   DROP TABLE IF EXISTS public.student_education;   -- nothing else references it
--   -- The CHECK only widens; reverting it FAILS if a profile report exists. Check first:
--   --   SELECT count(*) FROM content_reports WHERE content_type = 'profile';
--   DELETE FROM public.schema_migrations_applied WHERE filename = '20261026_student_education.sql';
--   RESET ROLE;
--   NOTIFY pgrst, 'reload schema';
