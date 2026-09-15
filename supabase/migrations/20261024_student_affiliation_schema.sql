-- ═══ Student Hub affiliation — Slice 1: subjects, study fields, website links ═══
--
-- PROPOSED, NOT APPLIED. Apply with Role = postgres after review.
--
-- Schema for the university directory becoming a place where students affiliate with
-- their institution. Slice 1 of 6 — schema only: no UI reads or writes anything here yet,
-- and MODULE_FLAGS.studentHub stays false. What this file adds:
--   • subjects + subject_i18n — a lookup list, built on the student_tasks pattern.
--   • profiles.study_start_year / study_end_year / subject_id / student_listing_opt_in.
--   • check_profile_study_years() — a trigger: an end year may not be in the future.
--   • profiles_institution_coupling_check REWRITTEN so a graduate keeps their institution.
--   • institutions.website_url.
--
-- ─── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
-- • NO change to profiles RLS. Nothing here makes one user's row readable by another.
--   The student list needs a new read path, and that is slice 4, designed on purpose.
--   Section 7(f) asserts the profiles policy count did not move.
-- • NO subject names. subject_i18n is left EMPTY; the content seed is hand-written.
-- • NO website_url values. Every institution stays NULL until the 23 links are verified.
-- • NO "start year not in the future" rule in the database. The start-year picker (slice 2)
--   owns that, and may offer next year to someone already admitted.
--
-- ─── ORDER: 20261022 FIRST, and THIS IS THE EDIT 20261022's GUARD WAS WRITTEN FOR ─
-- Section 0 refuses unless 20261022's null-safe coupling CHECKs are live. Section 5 then
-- rewrites one of them, profiles_institution_coupling_check, adding a third arm. From then
-- on 20261022 REFUSES to re-run — its recorded SQL would restore the two-arm form and take
-- every graduate's institution with it. That refusal is correct; do not "fix" it. The
-- other coupling (student_level requires resident_status = 'student') is left exactly as
-- 20261022 wrote it. verify_schema.sql's 1024 token owns the new definition.
--
-- ─── study_end_year MEANS GRADUATED ─────────────────────────────────────────
-- NULL = currently studying. A set end year = has finished; it is NOT an expected finish.
-- So:
--   • profiles_institution_coupling_check: an institution needs a university-level
--     student_level OR an end year. That third arm reads "has an end year" as "is a
--     graduate", which is how a graduate who is now 'working' keeps their institution,
--     their study fields and their listing opt-in.
--   • check_profile_study_years() rejects an end year after the current year. It is a
--     TRIGGER, not a CHECK, for MIN_SIGNUP_AGE's reason: current_date is STABLE and a
--     CHECK requires IMMUTABLE. The static 1950–2100 CHECK stays as a sanity bound.
--   The trigger is what makes the arm honest. Without it an expected finish year could be
--   stored, and a current student would read as a graduate. The slice-2 picker should
--   stop at the current year too, but only for UX; the trigger is the boundary.
--   The year is taken in the database's time zone (UTC on Supabase). In the first hours of
--   1 January in the TRNC, the new year is refused until UTC catches up.
--
-- ─── KNOWN LIMITS (accepted for v1; documented, not solved) ─────────────────
-- 1. ONE institution_id. "Graduated from X, now studying at Y" cannot be expressed.
-- 2. resident_status is single-select. A student who also works must pick one; picking
--    'working' with a NULL end year means they cannot hold an institution. That is a
--    limit of the status field, not of this constraint.
-- 3. The third arm does not look at student_level. Once an end year is set, any row may
--    hold an institution: a language-course student with a finished degree is ACCEPTED.
--    That is the "graduated from X" case above, and section 7(a) pins it as accepted.
--
-- ─── subjects: seeded ACTIVE, column DEFAULT false ──────────────────────────
-- The DEFAULT is false (the 20260907 rule: an INSERT that omits it lands unpublished).
-- The seed sets true on purpose, as student_tasks' seed does, and for institutions'
-- reason: the list appears in no arm of search_content, so an active row is not publicly
-- findable while the module is dark, and a picker with no rows is broken rather than safe.
-- ⚠ Until the content seed runs, every active subject has NO NAME in any language. The
--   slice-2 picker must skip a subject with no row for the user's language or English,
--   not render its slug.
--
-- ─── subject ids are permanent; slugs are not ───────────────────────────────
-- Unlike student_tasks.slug (the device-side progress key), nothing outside this database
-- stores a subject slug: profiles.subject_id and subject_i18n both reference the id. So a
-- slug can be renamed freely; an id cannot. Fixed ids so the content seed can reference a
-- subject without a lookup.
--
-- ─── ON DELETE SET NULL, and what it costs ──────────────────────────────────
-- Deleting a subject silently clears every profile's subject_id that pointed at it — the
-- Netkent hazard again. Retire a subject with is_active = false; only DELETE one nobody
-- references. Separately: once a profile holds study years, a subject or
-- student_listing_opt_in = true, deleting its institution FAILS, because institution_id's
-- ON DELETE SET NULL would break those CHECKs. That is the safe direction, and it is new.
--
-- ─── COUPLING CHECKS: every one of them is null-safe by construction ─────────
-- Each is written so no arm can evaluate to UNKNOWN: the only predicates on nullable
-- columns are IS NULL / IS NOT NULL, a comparison happens only after its operands are
-- asserted non-NULL, and the one boolean is NOT NULL. Section 7(a) proves each on the
-- INSTALLED definitions, with the NULL case that would have slipped through.
--
-- ⚠ SLICE 2 WRITERS — both must change, and it is a standing obligation.
--   Today ProfileSetupScreen.js:433 and ProfileScreen.js:338 set institution_id to NULL
--   whenever the level is not university or postgraduate. From this file on:
--   (1) STOP clearing institution_id just because the level changed. The database keeps it
--       for anyone with an end year (the third arm above).
--   (2) Whenever they DO clear institution_id, clear study_start_year, study_end_year,
--       subject_id and student_listing_opt_in (false) in the SAME patch. Otherwise the
--       write fails with 23514, and two sequential writes fail on the first.
--   Still cleared: an institution with no university-level student_level and no end year,
--   because the CHECK rejects it. Nobody can hold the new fields yet (no UI writes them), so
--   nothing breaks today. It breaks the day slice 2 ships without both changes.

SET ROLE postgres;
BEGIN;

-- ─── 0. Pre-flight ──────────────────────────────────────────────────────────
DO $$
DECLARE
  v_def  text;
  c      record;
BEGIN
  -- Each CHECK must carry ITS OWN operand's null guard, as pg_get_constraintdef renders it.
  FOR c IN SELECT * FROM (VALUES
    ('profiles_institution_coupling_check',   'student_level'),
    ('profiles_student_level_coupling_check', 'resident_status')) AS t(conname, guarded) LOOP
    SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
     WHERE conrelid = 'public.profiles'::regclass AND conname = c.conname;
    IF v_def IS NULL OR v_def NOT LIKE '%(' || c.guarded || ' IS NOT NULL)%' THEN
      RAISE EXCEPTION 'REFUSING: 20261022 is not applied — % is %. Apply the coupling fix first. Nothing changed.',
        c.conname, coalesce(v_def, '<missing>');
    END IF;
  END LOOP;

  -- Captured so section 7(f) can prove this file changed no profiles policy.
  PERFORM set_config('ada.profiles_policies_before',
    coalesce((SELECT string_agg(policyname || ':' || cmd, ',' ORDER BY policyname)
                FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles'), ''), true);
END $$;

-- ─── 1. subjects ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subjects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text NOT NULL,
  sort_order integer NOT NULL,
  is_active  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.subjects DROP CONSTRAINT IF EXISTS subjects_slug_unique;
ALTER TABLE public.subjects ADD  CONSTRAINT subjects_slug_unique UNIQUE (slug);

ALTER TABLE public.subjects DROP CONSTRAINT IF EXISTS subjects_slug_check;
ALTER TABLE public.subjects ADD  CONSTRAINT subjects_slug_check
  CHECK (slug ~ '^[a-z][a-z0-9_]{1,39}$');

-- ─── 2. subject_i18n ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subject_i18n (
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  lang       text NOT NULL,
  name       text NOT NULL,
  PRIMARY KEY (subject_id, lang)
);

-- Full English names, never ISO codes — see the CLAUDE.md convention. An ISO comparison
-- never errors, it just matches nothing, so the CHECK makes a mis-keyed seed fail loudly.
ALTER TABLE public.subject_i18n DROP CONSTRAINT IF EXISTS subject_i18n_lang_check;
ALTER TABLE public.subject_i18n ADD  CONSTRAINT subject_i18n_lang_check
  CHECK (lang IN ('English','Turkish','Arabic','Russian','Greek','French','Spanish','German','Persian'));

ALTER TABLE public.subject_i18n DROP CONSTRAINT IF EXISTS subject_i18n_name_check;
ALTER TABLE public.subject_i18n ADD  CONSTRAINT subject_i18n_name_check
  CHECK (btrim(name) <> '');

COMMENT ON COLUMN public.subject_i18n.lang IS
  'Full English language name as the app stores it (''Turkish''), never an ISO code.';

-- ─── 3. RLS — one read policy each, no write policy ─────────────────────────
-- Plain English: any signed-in session, guests included (anonymous sessions are role
-- `authenticated`), can READ every row of both tables. Nobody using the app can insert,
-- update or delete; the only writer is postgres / service_role. The bare anon key reads
-- nothing. Identical to student_tasks.
ALTER TABLE public.subjects     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subject_i18n ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "subjects_read_authenticated" ON public.subjects;
CREATE POLICY "subjects_read_authenticated" ON public.subjects
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "subject_i18n_read_authenticated" ON public.subject_i18n;
CREATE POLICY "subject_i18n_read_authenticated" ON public.subject_i18n
  FOR SELECT TO authenticated USING (true);

-- ─── 4. Seed — slugs only ───────────────────────────────────────────────────
-- Programme families, not faculties and not per-university programme names. Grouped by
-- field in blocks of 100 with a step of 5, so a subject can be inserted without
-- renumbering; the picker may still sort by the name in the user's language.
INSERT INTO public.subjects (id, slug, sort_order, is_active) VALUES
  -- Health
  ('00000000-0000-4000-d000-000000000001', 'medicine',                            100, true),
  ('00000000-0000-4000-d000-000000000002', 'dentistry',                           105, true),
  ('00000000-0000-4000-d000-000000000003', 'pharmacy',                            110, true),
  ('00000000-0000-4000-d000-000000000004', 'nursing',                             115, true),
  ('00000000-0000-4000-d000-000000000005', 'midwifery',                           120, true),
  ('00000000-0000-4000-d000-000000000006', 'physiotherapy',                       125, true),
  ('00000000-0000-4000-d000-000000000007', 'nutrition_dietetics',                 130, true),
  ('00000000-0000-4000-d000-000000000008', 'veterinary_medicine',                 135, true),
  ('00000000-0000-4000-d000-000000000009', 'health_management',                   140, true),
  -- Engineering and computing
  ('00000000-0000-4000-d000-00000000000a', 'computer_engineering',                200, true),
  ('00000000-0000-4000-d000-00000000000b', 'software_engineering',                205, true),
  ('00000000-0000-4000-d000-00000000000c', 'artificial_intelligence_engineering', 210, true),
  ('00000000-0000-4000-d000-00000000000d', 'information_systems',                 215, true),
  ('00000000-0000-4000-d000-00000000000e', 'civil_engineering',                   220, true),
  ('00000000-0000-4000-d000-00000000000f', 'electrical_electronic_engineering',   225, true),
  ('00000000-0000-4000-d000-000000000010', 'mechanical_engineering',              230, true),
  ('00000000-0000-4000-d000-000000000011', 'mechatronics_engineering',            235, true),
  ('00000000-0000-4000-d000-000000000012', 'industrial_engineering',              240, true),
  ('00000000-0000-4000-d000-000000000013', 'biomedical_engineering',              245, true),
  ('00000000-0000-4000-d000-000000000014', 'energy_systems_engineering',          250, true),
  ('00000000-0000-4000-d000-000000000015', 'petroleum_natural_gas_engineering',   255, true),
  -- Architecture, design and arts
  ('00000000-0000-4000-d000-000000000016', 'architecture',                        300, true),
  ('00000000-0000-4000-d000-000000000017', 'interior_architecture',               305, true),
  ('00000000-0000-4000-d000-000000000018', 'graphic_design',                      310, true),
  ('00000000-0000-4000-d000-000000000019', 'fashion_textile_design',              315, true),
  ('00000000-0000-4000-d000-00000000001a', 'fine_arts',                           320, true),
  ('00000000-0000-4000-d000-00000000001b', 'music',                               325, true),
  -- Business and economics
  ('00000000-0000-4000-d000-00000000001c', 'business_administration',             400, true),
  ('00000000-0000-4000-d000-00000000001d', 'economics',                           405, true),
  ('00000000-0000-4000-d000-00000000001e', 'accounting_finance',                  410, true),
  ('00000000-0000-4000-d000-00000000001f', 'marketing',                           415, true),
  ('00000000-0000-4000-d000-000000000020', 'international_trade_logistics',       420, true),
  -- Law and social sciences
  ('00000000-0000-4000-d000-000000000021', 'law',                                 500, true),
  ('00000000-0000-4000-d000-000000000022', 'international_relations',             505, true),
  ('00000000-0000-4000-d000-000000000023', 'political_science_public_admin',      510, true),
  ('00000000-0000-4000-d000-000000000024', 'psychology',                          515, true),
  ('00000000-0000-4000-d000-000000000025', 'sociology',                           520, true),
  -- Communication
  ('00000000-0000-4000-d000-000000000026', 'journalism',                          600, true),
  ('00000000-0000-4000-d000-000000000027', 'public_relations_advertising',        605, true),
  ('00000000-0000-4000-d000-000000000028', 'radio_tv_cinema',                     610, true),
  -- Education and languages
  ('00000000-0000-4000-d000-000000000029', 'english_language_teaching',           700, true),
  ('00000000-0000-4000-d000-00000000002a', 'preschool_teaching',                  705, true),
  ('00000000-0000-4000-d000-00000000002b', 'primary_teaching',                    710, true),
  ('00000000-0000-4000-d000-00000000002c', 'special_education',                   715, true),
  ('00000000-0000-4000-d000-00000000002d', 'guidance_counselling',                720, true),
  ('00000000-0000-4000-d000-00000000002e', 'english_language_literature',         725, true),
  ('00000000-0000-4000-d000-00000000002f', 'turkish_language_literature',         730, true),
  ('00000000-0000-4000-d000-000000000030', 'translation_interpreting',            735, true),
  -- Tourism, sport and transport
  ('00000000-0000-4000-d000-000000000031', 'tourism_hospitality',                 800, true),
  ('00000000-0000-4000-d000-000000000032', 'gastronomy_culinary_arts',            805, true),
  ('00000000-0000-4000-d000-000000000033', 'sports_sciences',                     810, true),
  ('00000000-0000-4000-d000-000000000034', 'aviation',                            815, true),
  ('00000000-0000-4000-d000-000000000035', 'maritime',                            820, true),
  -- Sciences
  ('00000000-0000-4000-d000-000000000036', 'mathematics',                         900, true),
  ('00000000-0000-4000-d000-000000000037', 'physics',                             905, true),
  ('00000000-0000-4000-d000-000000000038', 'chemistry',                           910, true),
  ('00000000-0000-4000-d000-000000000039', 'molecular_biology_genetics',          915, true),
  -- Last, always. A student whose programme is not listed must have somewhere to land.
  ('00000000-0000-4000-d000-0000000000ff', 'other',                               999, true)
ON CONFLICT (id) DO NOTHING;

-- ─── 5. profiles — study fields and listing opt-in ──────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS study_start_year       smallint,
  -- NULL = currently studying.
  ADD COLUMN IF NOT EXISTS study_end_year         smallint,
  ADD COLUMN IF NOT EXISTS subject_id             uuid,
  -- DEFAULT FALSE IS THE PRIVACY GUARANTEE. Every existing row and every write that omits
  -- the column lands unlisted; appearing in a student list must always be an explicit act.
  -- verify_schema.sql carries an H-token on this default, because a reverted DEFAULT
  -- creates no named object and nothing else could see it.
  ADD COLUMN IF NOT EXISTS student_listing_opt_in boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_subject_id_fkey;
ALTER TABLE public.profiles ADD  CONSTRAINT profiles_subject_id_fkey
  FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE SET NULL;

-- Sanity bounds only, not policy: 1950 predates every TRNC university, and 2100 is far
-- enough out that the literal never needs bumping. They exist to reject 1823 and 2199.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_study_start_year_range_check;
ALTER TABLE public.profiles ADD  CONSTRAINT profiles_study_start_year_range_check
  CHECK (study_start_year IS NULL OR study_start_year BETWEEN 1950 AND 2100);

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_study_end_year_range_check;
ALTER TABLE public.profiles ADD  CONSTRAINT profiles_study_end_year_range_check
  CHECK (study_end_year IS NULL OR study_end_year BETWEEN 1950 AND 2100);

-- An end year REQUIRES a start year. `study_end_year >= study_start_year` alone is UNKNOWN
-- when the start is NULL — and a CHECK passes on UNKNOWN, so it would admit an end year
-- with nothing to compare it to. The explicit IS NOT NULL arm is what makes this bite.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_study_years_order_check;
ALTER TABLE public.profiles ADD  CONSTRAINT profiles_study_years_order_check
  CHECK (study_end_year IS NULL
         OR (study_start_year IS NOT NULL AND study_end_year >= study_start_year));

-- Study years and subject only alongside an institution — not a student_level, so a record
-- of where someone studied does not depend on their still being a student. Only IS [NOT]
-- NULL tests, so no arm can be UNKNOWN.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_study_fields_require_institution_check;
ALTER TABLE public.profiles ADD  CONSTRAINT profiles_study_fields_require_institution_check
  CHECK ((study_start_year IS NULL AND study_end_year IS NULL AND subject_id IS NULL)
         OR institution_id IS NOT NULL);

-- student_listing_opt_in is NOT NULL, so `NOT student_listing_opt_in` is never UNKNOWN.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_listing_opt_in_requires_institution_check;
ALTER TABLE public.profiles ADD  CONSTRAINT profiles_listing_opt_in_requires_institution_check
  CHECK (NOT student_listing_opt_in OR institution_id IS NOT NULL);

-- 20261022's definition plus a third arm: a graduate (end year set) keeps an institution.
-- Here and not in a later file, because the arm needs study_end_year, added above. The new
-- arm is an IS NOT NULL test, so no arm can be UNKNOWN. See the header on 20261022's guard.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_institution_coupling_check;
ALTER TABLE public.profiles ADD  CONSTRAINT profiles_institution_coupling_check
  CHECK (institution_id IS NULL
         OR (student_level IS NOT NULL AND student_level IN ('university','postgraduate'))
         OR study_end_year IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_profiles_subject_id ON public.profiles (subject_id);

-- An end year means GRADUATED, so it cannot be in the future. A trigger because
-- current_date is STABLE (see the header). It is not a CREATE OR REPLACE of
-- check_profile_name_content(): that function carries the display-name key, and a re-run of
-- this file would revert any later change to it. It fires on every insert and update; a
-- stored end year can never become future, because years only go up. It reads no table,
-- so it runs as the caller with an empty search_path.
CREATE OR REPLACE FUNCTION public.check_profile_study_years()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.study_end_year IS NOT NULL
     AND NEW.study_end_year > extract(year FROM current_date) THEN
    RAISE EXCEPTION 'STUDY_END_YEAR_IN_FUTURE';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS check_profile_study_years ON public.profiles;
CREATE TRIGGER check_profile_study_years
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.check_profile_study_years();

-- ─── 6. institutions.website_url ────────────────────────────────────────────
ALTER TABLE public.institutions ADD COLUMN IF NOT EXISTS website_url text;

ALTER TABLE public.institutions DROP CONSTRAINT IF EXISTS institutions_website_url_scheme_check;
ALTER TABLE public.institutions ADD  CONSTRAINT institutions_website_url_scheme_check
  CHECK (website_url IS NULL OR website_url ~ '^https://');

-- ─── 7. Assertions ──────────────────────────────────────────────────────────
-- Re-runnable: nothing assumes subject_i18n is empty, the links are NULL, or no student
-- has filled in the new fields, because all three will be false by the next re-apply.
--
-- The CHECK probes run against the INSTALLED definitions, read back with
-- pg_get_constraintdef and attached to a TEMP table shaped like profiles. No real profile
-- row is written, read for a probe, or restored — the 20261001 lesson about probes that
-- borrow real rows does not arise. The temp tables die with the transaction.
CREATE TEMP TABLE tmp_study_probe    AS SELECT * FROM public.profiles WITH NO DATA;
CREATE TEMP TABLE tmp_end_year_probe AS SELECT * FROM public.profiles WITH NO DATA;
CREATE TEMP TABLE tmp_inst_probe     AS SELECT * FROM public.institutions WITH NO DATA;

-- The trigger gets its OWN probe table. On tmp_study_probe it would reject "end 2199"
-- before the range CHECK could, and that CHECK would then go untested.
CREATE TRIGGER check_profile_study_years
  BEFORE INSERT OR UPDATE ON pg_temp.tmp_end_year_probe
  FOR EACH ROW EXECUTE FUNCTION public.check_profile_study_years();

DO $$
DECLARE
  c        record;
  v_def    text;
  v_valid  boolean;
  v_got    boolean;
  v_rows   text;
  v_count  int;
  v_probe  uuid;
  v_year   int;
BEGIN
  -- Attach each new CHECK to the probe table exactly as the database holds it, after
  -- proving it is on profiles and VALIDATED (a NOT VALID CHECK would skip existing rows).
  FOR c IN SELECT * FROM (VALUES
    ('profiles', 'tmp_study_probe', 'profiles_study_start_year_range_check'),
    ('profiles', 'tmp_study_probe', 'profiles_study_end_year_range_check'),
    ('profiles', 'tmp_study_probe', 'profiles_study_years_order_check'),
    ('profiles', 'tmp_study_probe', 'profiles_study_fields_require_institution_check'),
    ('profiles', 'tmp_study_probe', 'profiles_listing_opt_in_requires_institution_check'),
    ('profiles', 'tmp_study_probe', 'profiles_institution_coupling_check'),
    ('institutions', 'tmp_inst_probe', 'institutions_website_url_scheme_check')
  ) AS t(tbl, probe, conname) LOOP
    SELECT pg_get_constraintdef(oid), convalidated INTO v_def, v_valid FROM pg_constraint
     WHERE conrelid = format('public.%I', c.tbl)::regclass AND conname = c.conname AND contype = 'c';
    IF v_def IS NULL OR v_valid IS DISTINCT FROM true THEN
      RAISE EXCEPTION '% on % is % (validated=%)', c.conname, c.tbl, coalesce(v_def, '<missing>'), v_valid;
    END IF;
    EXECUTE format('ALTER TABLE pg_temp.%I ADD CONSTRAINT %I %s', c.probe, c.conname, v_def);
  END LOOP;

  -- (a) The case table. Each "false" row is a NULL case some naive form would admit on
  --     UNKNOWN; each "true" row is a control, so a CHECK that rejects everything fails.
  --     This file's CHECKs are attached, including the rewritten institution coupling.
  --     20261022's student_level coupling is not, but every row satisfies it anyway.
  --     The trigger is tested separately, in (a2).
  FOR c IN SELECT * FROM (VALUES
    (NULL::text, NULL::text,        NULL::smallint, NULL::smallint, NULL::uuid,        false, NULL::uuid,        true,  'all empty (every existing row)'),
    ('student',  'university',      2024,           NULL,           NULL,              false, gen_random_uuid(), true,  'current student, institution, start year'),
    ('student',  'university',      2020,           2024,           gen_random_uuid(), false, gen_random_uuid(), true,  'university, both years, a subject'),
    ('student',  'university',      2024,           2024,           NULL,              false, gen_random_uuid(), true,  'end year = start year'),
    ('student',  'university',      NULL,           NULL,           NULL,              true,  gen_random_uuid(), true,  'opted in with an institution'),
    ('working',  NULL,              2018,           2022,           gen_random_uuid(), true,  gen_random_uuid(), true,  'GRADUATE: working, end year, institution, opted in'),
    ('student',  'language_course', 2018,           2022,           NULL,              false, gen_random_uuid(), true,  'LIMIT 3: language course with an end year holds an institution'),
    ('working',  NULL,              2018,           NULL,           NULL,              false, gen_random_uuid(), false, 'LIMIT 2: working, institution, no end year'),
    ('student',  'language_course', NULL,           NULL,           NULL,              false, gen_random_uuid(), false, 'institution under language_course, no end year'),
    (NULL,       NULL,              NULL,           NULL,           NULL,              false, gen_random_uuid(), false, 'UNKNOWN: institution, student_level and end year NULL'),
    ('student',  'university',      2024,           NULL,           NULL,              false, NULL,              false, 'start year, institution_id NULL'),
    (NULL,       NULL,              NULL,           NULL,           gen_random_uuid(), false, NULL,              false, 'subject, institution_id NULL'),
    ('student',  'university',      2020,           2024,           NULL,              false, NULL,              false, 'both years, institution_id NULL'),
    ('student',  'university',      NULL,           2025,           NULL,              false, gen_random_uuid(), false, 'end year, start year NULL'),
    ('student',  'university',      2024,           2023,           NULL,              false, gen_random_uuid(), false, 'end before start'),
    ('student',  'university',      1823,           NULL,           NULL,              false, gen_random_uuid(), false, 'start 1823'),
    ('student',  'university',      2024,           2199,           NULL,              false, gen_random_uuid(), false, 'end 2199'),
    (NULL,       NULL,              NULL,           NULL,           NULL,              true,  NULL,              false, 'opted in, institution_id NULL')
  ) AS t(resident, level, start_y, end_y, subject, opt_in, inst, expected, label) LOOP
    BEGIN
      INSERT INTO pg_temp.tmp_study_probe
        (id, resident_status, student_level, study_start_year, study_end_year, subject_id, student_listing_opt_in, institution_id)
      VALUES (gen_random_uuid(), c.resident, c.level, c.start_y, c.end_y, c.subject, c.opt_in, c.inst);
      v_got := true;
    EXCEPTION WHEN check_violation THEN
      v_got := false;
    END;
    IF v_got IS DISTINCT FROM c.expected THEN
      RAISE EXCEPTION 'CHECK case [%] was %, expected % — the installed coupling CHECKs are wrong',
        c.label, CASE WHEN v_got THEN 'ACCEPTED' ELSE 'REJECTED' END,
        CASE WHEN c.expected THEN 'accepted' ELSE 'rejected' END;
    END IF;
  END LOOP;

  -- (a2) The end-year trigger: attached to public.profiles, enabled, calling this function,
  --      and behaving that way on its own probe table. The current year is derived here and
  --      printed, never written as a literal that would go stale on 1 January.
  SELECT pg_get_triggerdef(t.oid), t.tgenabled::text INTO v_def, v_rows FROM pg_trigger t
   WHERE t.tgrelid = 'public.profiles'::regclass AND t.tgname = 'check_profile_study_years'
     AND t.tgfoid = 'public.check_profile_study_years()'::regprocedure AND NOT t.tgisinternal;
  IF v_def IS NULL OR v_def NOT LIKE '%BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW%'
     OR v_rows IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION 'check_profile_study_years trigger on profiles is % (tgenabled=%)', coalesce(v_def, '<missing>'), v_rows;
  END IF;

  v_year := extract(year FROM current_date)::int;
  INSERT INTO pg_temp.tmp_end_year_probe (id, study_end_year) VALUES (gen_random_uuid(), v_year);   -- control
  INSERT INTO pg_temp.tmp_end_year_probe (id, study_end_year) VALUES (gen_random_uuid(), NULL);     -- control
  BEGIN
    INSERT INTO pg_temp.tmp_end_year_probe (id, study_end_year) VALUES (gen_random_uuid(), v_year + 1);
    RAISE EXCEPTION 'ASSERT: study_end_year % (next year) was ACCEPTED on INSERT', v_year + 1;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'STUDY_END_YEAR_IN_FUTURE' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE pg_temp.tmp_end_year_probe SET study_end_year = v_year + 1 WHERE study_end_year IS NULL;
    RAISE EXCEPTION 'ASSERT: study_end_year % (next year) was ACCEPTED on UPDATE', v_year + 1;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'STUDY_END_YEAR_IN_FUTURE' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'end-year trigger: % accepted, % rejected on insert and update', v_year, v_year + 1;

  -- website_url, same shape: control first.
  INSERT INTO pg_temp.tmp_inst_probe (id, name, website_url) VALUES (gen_random_uuid(), 'zz https', 'https://example.com');
  BEGIN
    INSERT INTO pg_temp.tmp_inst_probe (id, name, website_url) VALUES (gen_random_uuid(), 'zz http', 'http://example.com');
    RAISE EXCEPTION 'ASSERT: an http:// institutions.website_url was ACCEPTED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- (b) The privacy default, read from the catalog, and the column cannot be NULL.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'profiles'
                    AND column_name = 'student_listing_opt_in'
                    AND column_default = 'false' AND is_nullable = 'NO') THEN
    RAISE EXCEPTION 'profiles.student_listing_opt_in is not NOT NULL DEFAULT false';
  END IF;

  SELECT count(*) INTO v_count FROM public.profiles WHERE student_listing_opt_in;
  RAISE NOTICE 'profiles opted in to the student list: % (0 on first apply; no UI writes it yet)', v_count;

  -- (c) The seed. Derived count, printed; Other present and last.
  SELECT count(*), string_agg(slug, ',' ORDER BY sort_order) INTO v_count, v_rows FROM public.subjects;
  RAISE NOTICE 'subjects: % rows', v_count;
  IF (SELECT sort_order FROM public.subjects WHERE slug = 'other') IS DISTINCT FROM
     (SELECT max(sort_order) FROM public.subjects) THEN
    RAISE EXCEPTION 'subjects: ''other'' is missing or does not sort last';
  END IF;

  -- (d) subject_i18n constraints, on a probe subject that never commits.
  BEGIN
    INSERT INTO public.subjects (slug, sort_order) VALUES ('zz_probe', 9999) RETURNING id INTO v_probe;
    SELECT is_active INTO v_got FROM public.subjects WHERE id = v_probe;
    IF v_got IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'subjects.is_active DEFAULT is %, expected false', coalesce(v_got::text, '<NULL>');
    END IF;

    INSERT INTO public.subject_i18n (subject_id, lang, name) VALUES (v_probe, 'Turkish', 'zz probe');   -- control

    BEGIN
      INSERT INTO public.subject_i18n (subject_id, lang, name) VALUES (v_probe, 'tr', 'zz probe');
      RAISE EXCEPTION 'ASSERT: lang ''tr'' was ACCEPTED — the column must reject ISO codes';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
      INSERT INTO public.subject_i18n (subject_id, lang, name) VALUES (v_probe, 'en', 'zz probe');
      RAISE EXCEPTION 'ASSERT: lang ''en'' was ACCEPTED — the column must reject ISO codes';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
      INSERT INTO public.subject_i18n (subject_id, lang, name) VALUES (v_probe, 'English', '   ');
      RAISE EXCEPTION 'ASSERT: a blank subject name was ACCEPTED';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    RAISE EXCEPTION 'zz_probe_rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'zz_probe_rollback' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM public.subjects WHERE slug = 'zz_probe') THEN
    RAISE EXCEPTION 'probe subject survived the rollback';
  END IF;

  -- (e) RLS on, and DERIVED policy counts — printed, not remembered.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.subjects'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.subject_i18n'::regclass) THEN
    RAISE EXCEPTION 'RLS is not enabled on both subject tables';
  END IF;
  SELECT string_agg(format('%s.%s [%s → %s]', tablename, policyname, cmd, roles::text), '; ' ORDER BY tablename, policyname)
    INTO v_rows
    FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('subjects','subject_i18n');
  RAISE NOTICE 'subject policies: %', v_rows;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'subjects') <> 1
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'subject_i18n') <> 1
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename IN ('subjects','subject_i18n')
                  AND (cmd <> 'SELECT' OR roles <> '{authenticated}'::name[])) THEN
    RAISE EXCEPTION 'expected exactly one SELECT-to-authenticated policy per subject table, found: %', v_rows;
  END IF;

  -- (f) profiles RLS untouched: the policy set is identical to what section 0 captured.
  --     Compared against itself-before, not against a remembered list.
  SELECT coalesce(string_agg(policyname || ':' || cmd, ',' ORDER BY policyname), '') INTO v_rows
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles';
  IF v_rows IS DISTINCT FROM current_setting('ada.profiles_policies_before') THEN
    RAISE EXCEPTION 'profiles policies changed inside this file: before [%] after [%]',
      current_setting('ada.profiles_policies_before'), v_rows;
  END IF;
  RAISE NOTICE 'profiles policies unchanged: %', v_rows;
END $$;

DROP TABLE pg_temp.tmp_study_probe;
DROP TABLE pg_temp.tmp_end_year_probe;
DROP TABLE pg_temp.tmp_inst_probe;

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
VALUES ('20261024_student_affiliation_schema.sql', '5e5238418a71821f25664f79c2a7eea0d8568030e0b051d2e458d0f09b06d175')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- ADD COLUMN on profiles and institutions, and two new tables: MANDATORY.
NOTIFY pgrst, 'reload schema';

-- ─── After the content seed (Role = postgres) ───────────────────────────────
--   -- 1. every active subject has all 9 languages (derived: lists what is missing)
--   SELECT s.slug, l.lang AS missing
--   FROM subjects s
--   CROSS JOIN unnest(ARRAY['English','Turkish','Arabic','Russian','Greek','French',
--                           'Spanish','German','Persian']) AS l(lang)
--   LEFT JOIN subject_i18n i ON i.subject_id = s.id AND i.lang = l.lang
--   WHERE s.is_active AND i.subject_id IS NULL
--   ORDER BY s.sort_order, l.lang;                                   -- expect 0 rows
--
--   -- 2. retire rather than delete (DELETE would silently clear students' subject_id)
--   UPDATE public.subjects SET is_active = false WHERE slug = '…';
--   SELECT count(*) FROM profiles WHERE subject_id = (SELECT id FROM subjects WHERE slug = '…');
--
-- ─── website_url template (fill once each link is verified) ─────────────────
--   UPDATE public.institutions SET website_url = 'https://…' WHERE id = '00000000-0000-4000-b000-0000000000NN';
--   SELECT id, name FROM institutions WHERE is_active AND website_url IS NULL
--    AND id <> '00000000-0000-4000-b000-0000000000ff' ORDER BY sort_order;   -- what is left
--
-- ─── REVERT ─────────────────────────────────────────────────────────────────
--   BEGIN;
--     SET ROLE postgres;
--     -- ⚠ Restoring 20261022's institution coupling FAILS while any graduate holds an
--     --   institution without a university-level student_level. Decide those rows first:
--     --   SELECT id FROM profiles WHERE institution_id IS NOT NULL
--     --     AND (student_level IS NULL OR student_level NOT IN ('university','postgraduate'));
--     ALTER TABLE public.profiles DROP CONSTRAINT profiles_institution_coupling_check;
--     ALTER TABLE public.profiles ADD  CONSTRAINT profiles_institution_coupling_check
--       CHECK (institution_id IS NULL
--              OR (student_level IS NOT NULL AND student_level IN ('university','postgraduate')));
--     DROP TRIGGER IF EXISTS check_profile_study_years ON public.profiles;
--     DROP FUNCTION IF EXISTS public.check_profile_study_years();
--     ALTER TABLE public.profiles
--       DROP CONSTRAINT IF EXISTS profiles_listing_opt_in_requires_institution_check,
--       DROP CONSTRAINT IF EXISTS profiles_study_fields_require_institution_check,
--       DROP CONSTRAINT IF EXISTS profiles_study_years_order_check,
--       DROP CONSTRAINT IF EXISTS profiles_study_end_year_range_check,
--       DROP CONSTRAINT IF EXISTS profiles_study_start_year_range_check,
--       DROP CONSTRAINT IF EXISTS profiles_subject_id_fkey,
--       DROP COLUMN IF EXISTS student_listing_opt_in,
--       DROP COLUMN IF EXISTS subject_id,
--       DROP COLUMN IF EXISTS study_end_year,
--       DROP COLUMN IF EXISTS study_start_year;
--     ALTER TABLE public.institutions
--       DROP CONSTRAINT IF EXISTS institutions_website_url_scheme_check,
--       DROP COLUMN IF EXISTS website_url;
--     DROP TABLE IF EXISTS public.subject_i18n;
--     DROP TABLE IF EXISTS public.subjects;
--     DELETE FROM public.schema_migrations_applied WHERE filename = '20261024_student_affiliation_schema.sql';
--   COMMIT;
--   RESET ROLE;
--   NOTIFY pgrst, 'reload schema';
--   -- ⚠ Dropping the columns discards what students entered. Back up
--   --   profiles(id, study_start_year, study_end_year, subject_id, student_listing_opt_in) first.
