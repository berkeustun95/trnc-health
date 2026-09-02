-- ═══ profile completion gate — Slice 1: schema, lookups, backfill ═══════════
--
-- Adds the columns the 3-step wizard writes, the two lookup tables it reads, and one
-- BEFORE INSERT OR UPDATE trigger on profiles that DID NOT EXIST BEFORE. An audit
-- confirmed the only trigger on this table was guard_profile_ban, so display_name and
-- full_name were completely unfiltered — and display_name renders publicly on reviews.
--
-- ─── ORDER INSIDE THIS FILE IS LOAD-BEARING ─────────────────────────────────
--   1 columns · 2 CHECKs · 3 institutions · 4 reserved_names · 5 BACKFILL ·
--   6 functions · 7 trigger · 8 indexes · 9 moderation_rejections · 10 assertions
--
-- The BACKFILL runs BEFORE the trigger exists. Two reasons, both real:
--   • the full_name sync must not rewrite a legacy name during its own backfill;
--   • ONE legacy full_name containing a blocked term would otherwise RAISE and take
--     the whole migration down with it.
--
-- ─── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
--
-- • NO region backfill. The City Welcome home city is DEVICE-LOCAL AsyncStorage
--   (@trnc_city_home, utils/cityWelcome.js) — SQL cannot read it, and there is no
--   server-side home city for any row. Slice 2's wizard pre-fills the region step
--   client-side from that key, falling back to resolveRegion(). `region` stays NULL for
--   every existing row and that is the correct value, not a gap.
--
-- • NO reserved words in blocked_terms. That table feeds contains_blocked_term(), which
--   ALL SIX UGC content triggers call — 'destek' or 'support' in there would reject
--   ordinary reviews, questions, answers, facility descriptions, change requests and
--   place submissions across the whole app. reserved_names is a separate table checked
--   ONLY on profiles.display_name. `npm run profile:check` asserts the separation.
--
-- • NO CHECK constraint for the 13-year minimum. CURRENT_DATE is STABLE and PostgreSQL
--   refuses a non-IMMUTABLE function in a CHECK. The rule lives in the trigger, which
--   is why section 10 and the H-token in verify_schema.sql both assert it there.
--
-- • NO expression index on normalize_for_moderation(display_name). It is declared
--   IMMUTABLE, so the next CREATE OR REPLACE of it — which the moderation work does
--   routinely — would SILENTLY CORRUPT that index: its stored keys would no longer
--   match what the expression produces, with no error at any point. A trigger-maintained
--   column produces visible STALENESS instead, which one UPDATE fixes and which you can
--   SELECT. Staleness you can see beats corruption you cannot.
--
-- ⚠ CONSEQUENCE, and it is a standing one: any future change to
--   normalize_for_moderation() also changes what normalize_display_name() produces.
--   Recompute profiles.display_name_normalized in the same migration, or the uniqueness
--   key goes stale. Recorded in CLAUDE.md.

SET ROLE postgres;
BEGIN;

-- ─── 1. Columns ──────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_name                 text,
  ADD COLUMN IF NOT EXISTS last_name                  text,
  ADD COLUMN IF NOT EXISTS display_name               text,
  -- The uniqueness key. Maintained by check_profile_name_content(), never by a client.
  ADD COLUMN IF NOT EXISTS display_name_normalized    text,
  ADD COLUMN IF NOT EXISTS date_of_birth              date,
  ADD COLUMN IF NOT EXISTS region                     text,
  ADD COLUMN IF NOT EXISTS resident_status            text,
  ADD COLUMN IF NOT EXISTS resident_status_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS student_level              text,
  ADD COLUMN IF NOT EXISTS institution_id             uuid,
  ADD COLUMN IF NOT EXISTS display_preference         text NOT NULL DEFAULT 'display_name',
  ADD COLUMN IF NOT EXISTS profile_completed_at       timestamptz,
  -- DEFAULT 0, so every existing row AND every new signup is gated until the wizard
  -- writes CURRENT_PROFILE_SCHEMA_VERSION. The gate needs no backfill because of this.
  ADD COLUMN IF NOT EXISTS profile_schema_version     integer NOT NULL DEFAULT 0,
  -- Google Play's neutral age screen: a disqualifying date of birth is NOT STORED.
  -- Only this flag is, and only in one direction (see the trigger).
  ADD COLUMN IF NOT EXISTS age_ineligible             boolean NOT NULL DEFAULT false,
  -- ISO 3166-1 alpha-2, EXCEPT 'XN' for Northern Cyprus: the TRNC has no ISO code and it
  -- is this app's single most relevant nationality. XN is inside the ISO user-assigned
  -- range XA-XZ, which exists for exactly this. Do NOT "correct" it to CY — that is the
  -- Republic of Cyprus.
  --
  -- The legacy English-label column `nationality` is KEPT and still written by the
  -- wizard, because constants/nationalityTranslations.js keys getNatLabel() on those
  -- labels and ProfileScreen renders through it.
  ADD COLUMN IF NOT EXISTS nationality_code           char(2);

-- ─── 2. CHECK constraints ────────────────────────────────────────────────────
-- DROP-then-ADD rather than ADD IF NOT EXISTS, which PostgreSQL does not support for
-- constraints. Idempotent on a re-run.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_region_check;
ALTER TABLE public.profiles ADD  CONSTRAINT profiles_region_check
  CHECK (region IS NULL OR region IN
        ('nicosia','kyrenia','famagusta','morphou','iskele','lefke','karpaz'));

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_resident_status_check;
ALTER TABLE public.profiles ADD  CONSTRAINT profiles_resident_status_check
  CHECK (resident_status IS NULL OR resident_status IN
        ('student','working','newcomer','resident','visiting'));

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_student_level_check;
ALTER TABLE public.profiles ADD  CONSTRAINT profiles_student_level_check
  CHECK (student_level IS NULL OR student_level IN
        ('university','postgraduate','high_school','language_course','vocational'));

-- student_level only means anything under resident_status='student'.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_student_level_coupling_check;
ALTER TABLE public.profiles ADD  CONSTRAINT profiles_student_level_coupling_check
  CHECK (student_level IS NULL OR resident_status = 'student');

-- ...and an institution only under a university-level student. A language course or a
-- high school is not something we hold a directory for.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_institution_coupling_check;
ALTER TABLE public.profiles ADD  CONSTRAINT profiles_institution_coupling_check
  CHECK (institution_id IS NULL OR student_level IN ('university','postgraduate'));

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_display_preference_check;
ALTER TABLE public.profiles ADD  CONSTRAINT profiles_display_preference_check
  CHECK (display_preference IN ('display_name','full_name'));

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_display_name_length_check;
ALTER TABLE public.profiles ADD  CONSTRAINT profiles_display_name_length_check
  CHECK (display_name IS NULL OR char_length(btrim(display_name)) BETWEEN 3 AND 20);

-- Sanity bound ONLY. The 13-year rule CANNOT live here — CURRENT_DATE is STABLE and a
-- CHECK requires IMMUTABLE. Do not "improve" this into an age check; it will be
-- rejected at ALTER time and, worse, someone may then delete the trigger rule believing
-- the constraint covers it.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_dob_range_check;
ALTER TABLE public.profiles ADD  CONSTRAINT profiles_dob_range_check
  CHECK (date_of_birth IS NULL OR date_of_birth >= DATE '1900-01-01');

-- An age-ineligible account must hold NO date of birth. This is the STORAGE half of the
-- Play requirement; the trigger is the WRITE half. Both, because either alone leaves a
-- path: a client that skips the flag, or an admin edit that adds the date back.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_age_ineligible_no_dob_check;
ALTER TABLE public.profiles ADD  CONSTRAINT profiles_age_ineligible_no_dob_check
  CHECK (NOT age_ineligible OR date_of_birth IS NULL);

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_nationality_code_check;
ALTER TABLE public.profiles ADD  CONSTRAINT profiles_nationality_code_check
  CHECK (nationality_code IS NULL OR nationality_code ~ '^[A-Z]{2}$');

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_schema_version_check;
ALTER TABLE public.profiles ADD  CONSTRAINT profiles_schema_version_check
  CHECK (profile_schema_version >= 0);

-- profile_completed_at MEANS something. Without this it is a flag a client can set on an
-- empty row, and the gate becomes decoration that a modified client walks past while
-- leaving a profile that reads as complete to every other query in the app.
--
-- ⚠ NULL-SAFETY IS WHAT MAKES THE LAST TWO LINES BITE. `student_level NOT IN (…)`
--   evaluates to UNKNOWN when student_level is NULL, and a CHECK PASSES on UNKNOWN — so
--   without the explicit `IS NULL` arm the constraint would admit exactly the row it
--   exists to reject. Same trap as properties_feed_precision_check (20260904).
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_completion_requires_fields_check;
ALTER TABLE public.profiles ADD  CONSTRAINT profiles_completion_requires_fields_check
  CHECK (profile_completed_at IS NULL OR (
        first_name       IS NOT NULL
    AND last_name        IS NOT NULL
    AND display_name     IS NOT NULL
    AND date_of_birth    IS NOT NULL
    AND region           IS NOT NULL
    AND resident_status  IS NOT NULL
    AND nationality_code IS NOT NULL
    AND phone            IS NOT NULL
    AND (resident_status <> 'student' OR student_level IS NOT NULL)
    AND (student_level IS NULL
         OR student_level NOT IN ('university','postgraduate')
         OR institution_id IS NOT NULL)
  ));

-- ─── 3. institutions ─────────────────────────────────────────────────────────
--
-- is_active DEFAULTs to TRUE, against the 20260907 towing precedent, and the reason is
-- that the precedent does not apply. That rule protects rows which become PUBLICLY
-- SEARCHABLE on insert, because search_content ignores MODULE_FLAGS. institutions is a
-- lookup list read only from inside a gated wizard, appears in no arm of search_content,
-- and a wizard whose dropdown is empty is broken rather than safe.
CREATE TABLE IF NOT EXISTS public.institutions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  short_name text,
  city       text,
  is_active  boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.institutions DROP CONSTRAINT IF EXISTS institutions_name_unique;
ALTER TABLE public.institutions ADD  CONSTRAINT institutions_name_unique UNIQUE (name);

-- `city` carries a CANONICAL REGION SLUG, not a free-text city name, so it stays
-- joinable to constants/regions.js REGIONS and can pre-select the wizard's region step
-- later. The column is named `city` because that is the name the spec gave it.
ALTER TABLE public.institutions DROP CONSTRAINT IF EXISTS institutions_city_check;
ALTER TABLE public.institutions ADD  CONSTRAINT institutions_city_check
  CHECK (city IS NULL OR city IN
        ('nicosia','kyrenia','famagusta','morphou','iskele','lefke','karpaz'));

ALTER TABLE public.institutions ENABLE ROW LEVEL SECURITY;

-- EXACTLY ONE POLICY, and the absence of the others is the design: read for signed-in
-- users, and NO insert/update/delete policy at all, so the only writer is
-- service_role / postgres, which RLS does not constrain.
--
-- `TO authenticated` includes anonymous (guest) sessions — deliberate and harmless here:
-- this is a public list of universities, and a guest never reaches the wizard that reads
-- it. Contrast the RPC in 20261002, where the same fact is a hazard and is guarded.
DROP POLICY IF EXISTS "institutions_read_authenticated" ON public.institutions;
CREATE POLICY "institutions_read_authenticated" ON public.institutions
  FOR SELECT TO authenticated USING (true);

-- Fixed UUIDs so a re-run is idempotent and a row can be referenced by id.
-- Cities confirmed by the project owner 2026-08-30: the four Lefkoşa entries at the end
-- (Onbeş Kasım, Akdeniz Karpaz, Rauf Denktaş, Netkent) were verified rather than guessed.
INSERT INTO public.institutions (id, name, short_name, city, sort_order) VALUES
  ('00000000-0000-4000-b000-000000000001','Doğu Akdeniz Üniversitesi','DAÜ','famagusta',10),
  ('00000000-0000-4000-b000-000000000002','Yakın Doğu Üniversitesi','YDÜ','nicosia',20),
  ('00000000-0000-4000-b000-000000000003','Uluslararası Kıbrıs Üniversitesi','UKÜ','nicosia',30),
  ('00000000-0000-4000-b000-000000000004','Girne Amerikan Üniversitesi','GAÜ','kyrenia',40),
  ('00000000-0000-4000-b000-000000000005','Lefke Avrupa Üniversitesi','LAÜ','lefke',50),
  ('00000000-0000-4000-b000-000000000006','Kıbrıs İlim Üniversitesi',NULL,'kyrenia',60),
  ('00000000-0000-4000-b000-000000000007','Arkın Yaratıcı Sanatlar ve Tasarım Üniversitesi','ARUCAD','kyrenia',70),
  ('00000000-0000-4000-b000-000000000008','Final Uluslararası Üniversitesi',NULL,'kyrenia',80),
  ('00000000-0000-4000-b000-000000000009','Girne Üniversitesi',NULL,'kyrenia',90),
  ('00000000-0000-4000-b000-00000000000a','Bahçeşehir Kıbrıs Üniversitesi','BAU','nicosia',100),
  ('00000000-0000-4000-b000-00000000000b','Onbeş Kasım Kıbrıs Üniversitesi',NULL,'nicosia',110),
  ('00000000-0000-4000-b000-00000000000c','Akdeniz Karpaz Üniversitesi',NULL,'nicosia',120),
  ('00000000-0000-4000-b000-00000000000d','Rauf Denktaş Üniversitesi',NULL,'nicosia',130),
  ('00000000-0000-4000-b000-00000000000e','Netkent Akdeniz Araştırma ve Bilim Üniversitesi',NULL,'nicosia',140),
  -- Last, always. A student at an unlisted institution must have somewhere to land, or
  -- the wizard becomes unfinishable for them and they have no way to say so.
  ('00000000-0000-4000-b000-0000000000ff','Other / Diğer',NULL,NULL,999)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_institution_id_fkey;
ALTER TABLE public.profiles ADD  CONSTRAINT profiles_institution_id_fkey
  FOREIGN KEY (institution_id) REFERENCES public.institutions(id) ON DELETE SET NULL;

-- ─── 4. reserved_names ───────────────────────────────────────────────────────
--
-- TWO MATCH MODES, AND THE SPLIT IS THE WHOLE DESIGN.
--
--   exact    — refused only as the WHOLE normalized display name. `ada`, `oli` and
--              `maki` are REAL GIVEN NAMES; Ada is a common Turkish woman's name (it
--              means "island"). Refusing every occurrence would reject "Ada Yılmaz"
--              inside a gate she cannot skip — a false positive aimed squarely at the
--              user we are trying to onboard.
--   contains — refused ANYWHERE in the name. Role words and partner brands only: none is
--              a plausible personal name, and "ADA Destek" is precisely the impersonation
--              this list exists to stop.
--
-- Read-all so utils/reservedNames.js can mirror the check inline before submit — the
-- same precedent as blocked_terms_read_all. The list is brand and role words; there is
-- nothing in it worth hiding, and hiding it would not make evasion harder.
--
-- ⚠ NO ACCENT FOLDING anywhere in ADA's normalization (20260925 explains why: folding
--   ö→o makes the Turkish term `göt` match the English "got"), so the Turkish and the
--   ASCII spellings of a brand are SEPARATE ROWS. Same precedent as blocked_terms
--   carrying both `piç` and `pic`.
CREATE TABLE IF NOT EXISTS public.reserved_names (
  term       text PRIMARY KEY,
  match_mode text NOT NULL CHECK (match_mode IN ('exact','contains')),
  reason     text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reserved_names ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reserved_names_read_all" ON public.reserved_names;
CREATE POLICY "reserved_names_read_all" ON public.reserved_names
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "reserved_names_admin_write" ON public.reserved_names;
CREATE POLICY "reserved_names_admin_write" ON public.reserved_names
  FOR ALL USING (get_my_role() = 'admin') WITH CHECK (get_my_role() = 'admin');

INSERT INTO public.reserved_names (term, match_mode, reason) VALUES
  ('ada',             'exact',    'app name; also a common Turkish given name — exact only'),
  ('oli',             'exact',    'ADA mascot; also a given name — exact only'),
  ('maki',            'exact',    'ADA mascot; also a given name — exact only'),
  ('admin',           'contains', 'role impersonation'),
  ('moderator',       'contains', 'role impersonation'),
  ('official',        'contains', 'role impersonation'),
  ('resmi',           'contains', 'role impersonation (TR)'),
  ('destek',          'contains', 'support impersonation (TR)'),
  ('support',         'contains', 'support impersonation'),
  ('novest',          'contains', 'partner brand'),
  ('coldwell banker', 'contains', 'partner brand'),
  ('coldwell',        'contains', 'partner brand'),
  ('101evler',        'contains', 'partner brand'),
  ('gişe kıbrıs',     'contains', 'partner brand (TR spelling)'),
  ('gise kibris',     'contains', 'partner brand (ASCII spelling — no accent folding)')
ON CONFLICT (term) DO NOTHING;

-- ─── 5. BACKFILL — before any trigger exists ─────────────────────────────────
--
-- Split on the LAST space, so "Ali Rıza Yılmaz" becomes "Ali Rıza" + "Yılmaz" rather
-- than "Ali" + "Rıza Yılmaz". Single-token names become first_name only.
UPDATE public.profiles
   SET first_name = CASE
         WHEN position(' ' in btrim(full_name)) = 0 THEN btrim(full_name)
         ELSE btrim(left(btrim(full_name),
                    length(btrim(full_name)) - position(' ' in reverse(btrim(full_name)))))
       END,
       last_name = CASE
         WHEN position(' ' in btrim(full_name)) = 0 THEN NULL
         ELSE btrim(right(btrim(full_name), position(' ' in reverse(btrim(full_name))) - 1))
       END
 WHERE full_name IS NOT NULL
   AND btrim(full_name) <> ''
   AND first_name IS NULL
   AND last_name  IS NULL;

-- Legacy English nationality labels -> ISO alpha-2, XN for the TRNC. Exactly the 80
-- entries constants/nationalityTranslations.js carries and nothing else: an unrecognised
-- label stays NULL rather than being guessed at, and the assertion block PRINTS how many
-- were left behind so a gap is visible rather than silent.
UPDATE public.profiles p
   SET nationality_code = m.code
  FROM (VALUES
    ('Afghanistan','AF'),('Albania','AL'),('Algeria','DZ'),('Argentina','AR'),
    ('Armenia','AM'),('Australia','AU'),('Austria','AT'),('Azerbaijan','AZ'),
    ('Bahrain','BH'),('Bangladesh','BD'),('Belarus','BY'),('Belgium','BE'),
    ('Bosnia & Herzegovina','BA'),('Brazil','BR'),('Bulgaria','BG'),('Canada','CA'),
    ('China','CN'),('Croatia','HR'),('Cuba','CU'),('Czech Republic','CZ'),
    ('Denmark','DK'),('Egypt','EG'),('Finland','FI'),('France','FR'),
    ('Georgia','GE'),('Germany','DE'),('Ghana','GH'),('Greece','GR'),
    ('Hungary','HU'),('India','IN'),('Indonesia','ID'),('Iran','IR'),
    ('Iraq','IQ'),('Ireland','IE'),('Israel','IL'),('Italy','IT'),
    ('Jordan','JO'),('Kazakhstan','KZ'),('Kenya','KE'),('Kuwait','KW'),
    ('Lebanon','LB'),('Libya','LY'),('Malaysia','MY'),('Malta','MT'),
    ('Mexico','MX'),('Morocco','MA'),('Netherlands','NL'),('Nigeria','NG'),
    ('Norway','NO'),('Pakistan','PK'),('Palestine','PS'),('Philippines','PH'),
    ('Poland','PL'),('Portugal','PT'),('Qatar','QA'),('Romania','RO'),
    ('Russia','RU'),('Saudi Arabia','SA'),('Serbia','RS'),('Singapore','SG'),
    ('South Africa','ZA'),('South Korea','KR'),('Spain','ES'),('Sri Lanka','LK'),
    ('Sweden','SE'),('Switzerland','CH'),('Syria','SY'),('Thailand','TH'),
    ('Tunisia','TN'),('Turkey','TR'),
    -- The TRNC has no ISO 3166-1 code. XN is in the user-assigned XA-XZ range. NOT CY.
    ('Northern Cyprus','XN'),
    ('Ukraine','UA'),('United Arab Emirates','AE'),('United Kingdom','GB'),
    ('United States','US'),('Uzbekistan','UZ'),('Venezuela','VE'),('Vietnam','VN'),
    ('Yemen','YE'),('Zimbabwe','ZW')
  ) AS m(label, code)
 WHERE p.nationality = m.label
   AND p.nationality_code IS NULL;

-- profile_completed_at and profile_schema_version are deliberately NOT written here:
-- ADD COLUMN already gave every existing row NULL and 0, which IS "everyone is forced
-- through the wizard". Section 10 ASSERTS that rather than restating it as an UPDATE
-- nobody ever checks.

-- ─── 6. normalize_display_name — the uniqueness key ──────────────────────────
--
-- The moderation normalizer (İ, zero-width, tatweel, NFC, NO accent folding) plus a
-- whitespace fold, so "Berke  Ustun" and "Berke Ustun" are one name.
--
-- THE SPACE CLASS IS ENUMERATED, NOT [[:space:]], AND THAT IS DELIBERATE. JavaScript's
-- \s covers the Unicode space separators; PostgreSQL's [[:space:]] does not, or does so
-- depending on the database ctype. Using one on the client and the other here would make
-- the two disagree about a name containing a NO-BREAK SPACE — and NBSP is
-- indistinguishable from a space on screen, so that disagreement is also an
-- impersonation vector. Both halves fold the same enumerated list, then collapse the
-- same ASCII run, then btrim (which strips SPACES ONLY).
--
-- Built from U&'' literals rather than the characters themselves: every one of them
-- looks exactly like a space in a diff, and this file is APPLIED BY PASTING IT INTO THE
-- SUPABASE SQL EDITOR, where a literal U+2009 may not survive the clipboard. Escapes do.
-- Same reasoning as the character class in 20260925.
--
-- Not an RPC: REVOKEd below. The standing constraint on this work is that no new RPC
-- appears except the one in 20261002, and every public function is an RPC in PostgREST
-- unless EXECUTE is revoked.
CREATE OR REPLACE FUNCTION public.normalize_display_name(p_name text)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path TO 'public'
AS $function$
  SELECT nullif(btrim(
    regexp_replace(
      regexp_replace(
        public.normalize_for_moderation(p_name),
        '[' ||
        U&'\00A0'        ||   -- NO-BREAK SPACE
        U&'\2000-\200A'  ||   -- EN QUAD … HAIR SPACE
        U&'\202F'        ||   -- NARROW NO-BREAK SPACE
        U&'\205F'        ||   -- MEDIUM MATHEMATICAL SPACE
        U&'\3000'        ||   -- IDEOGRAPHIC SPACE
        ']', ' ', 'g'),
      '[ \t\n\r\v\f]+', ' ', 'g')
  ), '');
$function$;

REVOKE ALL ON FUNCTION public.normalize_display_name(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.normalize_display_name(text) FROM anon;
REVOKE ALL ON FUNCTION public.normalize_display_name(text) FROM authenticated;

-- ─── 7. is_reserved_display_name ─────────────────────────────────────────────
-- position(), not LIKE: a term containing % or _ would otherwise become a wildcard and
-- silently reserve half the namespace. Terms are curated today; the function must not
-- depend on that staying true.
CREATE OR REPLACE FUNCTION public.is_reserved_display_name(p_norm text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM reserved_names r
    WHERE (r.match_mode = 'exact'
             AND p_norm = normalize_display_name(r.term))
       OR (r.match_mode = 'contains'
             AND position(normalize_display_name(r.term) in p_norm) > 0)
  );
$function$;

REVOKE ALL ON FUNCTION public.is_reserved_display_name(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_reserved_display_name(text) FROM anon;
REVOKE ALL ON FUNCTION public.is_reserved_display_name(text) FROM authenticated;

-- ─── 8. The profiles content-filter trigger ──────────────────────────────────
--
-- Modelled on check_ugc_on_insert() (20260712:316) and routing through the SAME
-- contains_blocked_term(), so it inherits 20260925's normalization and 20260926's
-- RAISE LOG breadcrumb and hit_count for free. One matcher, now seven surfaces.
--
-- ⚠ EVERY CONTENT CHECK IS GUARDED BY `IS DISTINCT FROM OLD`, and that is not tidiness.
--   An unconditional check means any user whose STORED full_name contains a blocked term
--   can never update their profile row again — including App.js:737's push_token write
--   and App.js:409's preferred_language write, neither of which touches a name and both
--   of which sit in bare .then()s with no error surface. It would present as "this user
--   silently stopped getting notifications" and point nowhere near here. Section 10
--   proves the guard by planting exactly that row.
--
-- OLD is never referenced on INSERT: the branches are split on TG_OP rather than relying
-- on OLD being a null record, which is implementation detail rather than contract.
CREATE OR REPLACE FUNCTION public.check_profile_name_content()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_norm       text;
  v_name_moved boolean;
BEGIN
  -- (a) full_name FOLLOWS first+last, but only when one of those actually changed.
  -- ProfileScreen still edits full_name directly until Slice 3; that edit touches
  -- neither name part, so it passes through untouched instead of being clobbered by a
  -- derivation the user cannot see.
  IF TG_OP = 'INSERT' THEN
    IF NEW.first_name IS NOT NULL OR NEW.last_name IS NOT NULL THEN
      NEW.full_name := nullif(btrim(concat_ws(' ', NEW.first_name, NEW.last_name)), '');
    END IF;
    v_name_moved := NEW.full_name IS NOT NULL;
  ELSE
    IF NEW.first_name IS DISTINCT FROM OLD.first_name
       OR NEW.last_name IS DISTINCT FROM OLD.last_name THEN
      NEW.full_name := nullif(btrim(concat_ws(' ', NEW.first_name, NEW.last_name)), '');
    END IF;
    v_name_moved := NEW.full_name IS DISTINCT FROM OLD.full_name;
  END IF;

  -- (b) full_name content — checked AFTER derivation, so a first_name of 'fuck' cannot
  -- reach full_name through a column the check never looked at.
  IF v_name_moved AND NEW.full_name IS NOT NULL
     AND contains_blocked_term(NEW.full_name) THEN
    RAISE EXCEPTION 'BLOCKED_TERM';
  END IF;

  -- (c) display_name — content filter, reserved list, and the normalized key.
  IF TG_OP = 'INSERT' OR NEW.display_name IS DISTINCT FROM OLD.display_name THEN
    IF NEW.display_name IS NULL THEN
      NEW.display_name_normalized := NULL;
    ELSE
      IF contains_blocked_term(NEW.display_name) THEN
        RAISE EXCEPTION 'BLOCKED_TERM';
      END IF;
      v_norm := normalize_display_name(NEW.display_name);
      IF v_norm IS NULL THEN
        -- Nothing left after normalization: the name was made entirely of invisible
        -- characters. NULL here would silently opt the row out of the unique index.
        RAISE EXCEPTION 'DISPLAY_NAME_INVALID';
      END IF;
      IF is_reserved_display_name(v_norm) THEN
        RAISE EXCEPTION 'DISPLAY_NAME_RESERVED';
      END IF;
      NEW.display_name_normalized := v_norm;
    END IF;
  ELSE
    -- display_name is not part of this UPDATE: carry the stored key forward, so a client
    -- that echoes the column back cannot desync the key from the name it indexes.
    NEW.display_name_normalized := OLD.display_name_normalized;
  END IF;

  -- (d) resident_status_updated_at is stamped by the SERVER, never accepted from a
  -- client. It is the only evidence of when someone stopped being a student.
  IF TG_OP = 'INSERT' THEN
    IF NEW.resident_status IS NOT NULL THEN
      NEW.resident_status_updated_at := now();
    END IF;
  ELSIF NEW.resident_status IS DISTINCT FROM OLD.resident_status THEN
    NEW.resident_status_updated_at := now();
  ELSE
    NEW.resident_status_updated_at := OLD.resident_status_updated_at;
  END IF;

  -- (e) MIN_SIGNUP_AGE = 13. THE ONLY OTHER PLACE THIS NUMBER APPEARS IS
  -- constants/profileGate.js; scripts/check-profile-gate.mjs reads both and fails if
  -- they disagree. It is a trigger and not a CHECK because CURRENT_DATE is STABLE.
  -- Matches the Google Play target-age declaration of 2026-08-29 (13-15 / 16-17 / 18+).
  IF NEW.date_of_birth IS NOT NULL
     AND NEW.date_of_birth > (current_date - interval '13 years')::date THEN
    RAISE EXCEPTION 'UNDERAGE';
  END IF;

  -- (f) age_ineligible is ONE-WAY for anyone but an admin. Without this, the neutral
  -- age screen is a formality: the client sets the flag, and the same client clears it.
  IF TG_OP = 'UPDATE'
     AND coalesce(get_my_role(), '') <> 'admin'
     AND OLD.age_ineligible AND NOT NEW.age_ineligible THEN
    RAISE EXCEPTION 'age_ineligible is admin-only once set';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS check_profile_name_content ON public.profiles;
CREATE TRIGGER check_profile_name_content
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.check_profile_name_content();

-- ─── 9. Indexes ──────────────────────────────────────────────────────────────
--
-- UNIQUE: CORRECTNESS. display_name renders publicly on every review, so a duplicate is
-- an impersonation vector and also simply looks broken. Enforced on the NORMALIZED form
-- — raw-string uniqueness is theatre, defeated by the shift key or one zero-width
-- character, which is exactly the evasion class 20260925 closed.
--
-- PARTIAL because every row is NULL until its owner finishes the wizard. It is NOT
-- partial for soft-delete reasons: there is no soft delete on profiles.
-- delete_own_account() (20260718_capture_3_functions.sql:186) hard-deletes the profiles
-- row AND the auth.users row, so no dead account can hold a name.
--
-- A BANNED account (ugc_banned_until / blocked_until) does keep its name, deliberately:
-- releasing it lets someone else claim a banned user's identity and inherit the apparent
-- authorship of their history, and it would collide if the ban were ever lifted.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_display_name_norm_uniq
  ON public.profiles (display_name_normalized)
  WHERE display_name_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_institution_id
  ON public.profiles (institution_id);

-- ─── 10. moderation_rejections admits the profile surfaces ───────────────────
-- So utils/profanity.js reportModerationRejection() works from the wizard.
--
-- HONEST LIMIT: a RESERVED-name refusal can never be self-reported here, because
-- moderation_rejections.matched_term has an FK to blocked_terms(term) and reserved names
-- are not in that table (see section 4 for why they must not be). That is acceptable —
-- this log exists to find PROFANITY false positives, and a reserved-name refusal already
-- tells the user exactly what is wrong instead of failing mysteriously.
ALTER TABLE public.moderation_rejections
  DROP CONSTRAINT IF EXISTS moderation_rejections_content_type_check;
ALTER TABLE public.moderation_rejections
  ADD  CONSTRAINT moderation_rejections_content_type_check
  CHECK (content_type IN ('review','question','answer','facility','change_request',
                          'place','display_name','full_name'));

-- ─── 11. Assertions — this migration proves itself or rolls back ─────────────
--
-- Everything DERIVED and PRINTED. No remembered counts, and every positive assertion is
-- paired with a control that answers "what would this print if the thing under test were
-- PERFECT / DEAD?" — because a zero from a working instrument and a zero from a dead one
-- are the same character on the screen.
--
-- ⚠ EVERY COMPARISON IS `IS DISTINCT FROM`, NEVER `<>`. `NULL <> 'x'` evaluates to NULL
--   and an IF on NULL does not fire — so a `<>` assertion PASSES on precisely the
--   failure it exists to detect: a normalizer returning NULL, or a trigger that never
--   filled display_name_normalized. The first draft of this block used `<>` throughout
--   and was green against a function that returned nothing at all.
DO $$
DECLARE
  v_total     int;
  v_named     int;
  v_split     int;
  v_completed int;
  v_versioned int;
  v_natlabel  int;
  v_natcode   int;
  v_a         uuid;
  v_b         uuid;
  v_orig_a    text;
  v_orig_dob  date;
  v_bad       boolean;
BEGIN
  ---------------------------------------------------------------- backfill, measured
  SELECT count(*) INTO v_total     FROM profiles;
  SELECT count(*) INTO v_named     FROM profiles WHERE btrim(coalesce(full_name,'')) <> '';
  SELECT count(*) INTO v_split     FROM profiles WHERE first_name IS NOT NULL;
  SELECT count(*) INTO v_completed FROM profiles WHERE profile_completed_at IS NOT NULL;
  SELECT count(*) INTO v_versioned FROM profiles WHERE profile_schema_version <> 0;
  SELECT count(*) INTO v_natlabel  FROM profiles WHERE nationality IS NOT NULL;
  SELECT count(*) INTO v_natcode   FROM profiles WHERE nationality_code IS NOT NULL;

  RAISE NOTICE 'profiles: % rows | % named | % split into first/last | nationality: % labels -> % codes',
    v_total, v_named, v_split, v_natlabel, v_natcode;

  IF v_split <> v_named THEN
    RAISE EXCEPTION 'name split covered % of % named rows', v_split, v_named;
  END IF;
  IF v_completed <> 0 OR v_versioned <> 0 THEN
    RAISE EXCEPTION 'the gate would not fire: % rows completed, % rows on a non-zero version',
      v_completed, v_versioned;
  END IF;
  IF v_natcode < v_natlabel THEN
    RAISE NOTICE '  % nationality labels had no ISO mapping and were left NULL',
      v_natlabel - v_natcode;
  END IF;

  ------------------------------------------------------------------- the normalizer
  -- The FIRST assertion is the control that says the U&'' escapes are being
  -- interpreted at all: if they were not, the character class would contain U,&,\,0,A,
  -- digits and letters, and would eat them out of ordinary text. Same trap 20260925
  -- documents. A migration that installed a mangler here would corrupt every name.
  IF normalize_display_name('Merhaba 123') IS DISTINCT FROM 'merhaba 123' THEN
    RAISE EXCEPTION 'normalization mangles ordinary text (got %) — the U&'''' escapes in '
                    'the space class are not being interpreted; check '
                    'standard_conforming_strings and that the literals survived the paste',
                    normalize_display_name('Merhaba 123');
  END IF;
  IF normalize_display_name('  BERKE   Ustun ') IS DISTINCT FROM 'berke ustun' THEN
    RAISE EXCEPTION 'case fold / whitespace collapse is wrong: %',
      normalize_display_name('  BERKE   Ustun ');
  END IF;
  IF normalize_display_name(U&'Berke\00A0Ustun') IS DISTINCT FROM 'berke ustun' THEN
    RAISE EXCEPTION 'NO-BREAK SPACE was not folded — the client and server now disagree '
                    'about a name that looks identical on screen';
  END IF;
  IF normalize_display_name('sık') IS DISTINCT FROM 'sık' THEN
    RAISE EXCEPTION 'dotless ı was folded — `sık sık` would start matching `sik`';
  END IF;
  IF normalize_display_name('göt') IS DISTINCT FROM 'göt' THEN
    RAISE EXCEPTION 'an accent was folded — `göt` would start matching the English "got"';
  END IF;
  IF normalize_display_name(U&'\200B\200B') IS NOT NULL THEN
    RAISE EXCEPTION 'an all-invisible name did not normalize to NULL';
  END IF;
  -- CONTROL: two genuinely different names must NOT collapse together. Without this,
  -- every assertion above is satisfied by a function that returns a constant.
  IF normalize_display_name('Berke') IS NOT DISTINCT FROM normalize_display_name('Berkee') THEN
    RAISE EXCEPTION 'CONTROL FAILED — two different names normalize to the same key';
  END IF;

  ---------------------------------------------------------------- reserved matching
  v_bad := false;
  IF NOT is_reserved_display_name(normalize_display_name('Ada'))          THEN v_bad := true; END IF;
  IF NOT is_reserved_display_name(normalize_display_name('ADA Destek'))   THEN v_bad := true; END IF;
  IF NOT is_reserved_display_name(normalize_display_name('Novest Team'))  THEN v_bad := true; END IF;
  IF NOT is_reserved_display_name(normalize_display_name('Gişe Kıbrıs'))  THEN v_bad := true; END IF;
  IF v_bad THEN RAISE EXCEPTION 'a reserved name was NOT caught'; END IF;
  -- The false positives that must NOT fire. These are the whole reason for two modes.
  IF is_reserved_display_name(normalize_display_name('Ada Yılmaz'))  THEN v_bad := true; END IF;
  IF is_reserved_display_name(normalize_display_name('Adana Kebap')) THEN v_bad := true; END IF;
  IF is_reserved_display_name(normalize_display_name('Oliver'))      THEN v_bad := true; END IF;
  IF is_reserved_display_name(normalize_display_name('Berke'))       THEN v_bad := true; END IF;
  IF v_bad THEN
    RAISE EXCEPTION 'a REAL NAME was refused as reserved — exact/contains modes are wrong';
  END IF;

  -- And the separation from blocked_terms, which is the failure that would land on six
  -- unrelated surfaces rather than on this one.
  IF EXISTS (SELECT 1 FROM blocked_terms
              WHERE term IN ('ada','oli','maki','destek','support','admin',
                             'moderator','official','resmi')) THEN
    RAISE EXCEPTION 'a reserved role word is in blocked_terms — ordinary reviews are '
                    'now being rejected app-wide';
  END IF;

  ------------------------------------------------------- END TO END, on real rows
  -- Two real rows, because UPDATE avoids the profiles->auth.users FK entirely: an
  -- INSERT probe with a fake uuid could trip the FK before the unique index fires and
  -- report a pass it never measured.
  --
  -- ⚠ ONLY rows that currently hold NO display_name, so a RE-APPLY cannot overwrite a
  --   real user's name. On first apply that is every row; once the wizard is live it is
  --   whoever has not finished it. If there are not two, the probe SKIPS and says so
  --   rather than borrowing somebody's identity for an assertion. date_of_birth is
  --   captured and restored for the same reason.
  SELECT id INTO v_a FROM profiles WHERE display_name IS NULL ORDER BY id LIMIT 1;
  SELECT id INTO v_b FROM profiles
   WHERE display_name IS NULL AND id <> v_a ORDER BY id LIMIT 1;

  IF v_a IS NULL OR v_b IS NULL THEN
    RAISE NOTICE 'fewer than 2 nameless profiles rows — SKIPPED the end-to-end assertions. '
                 'The uniqueness and push_token guarantees are UNVERIFIED on this database.';
  ELSE
    SELECT full_name INTO v_orig_a FROM profiles WHERE id = v_a;
    SELECT date_of_birth INTO v_orig_dob FROM profiles WHERE id = v_b;

    -- the key is computed by the trigger, not by the client
    UPDATE profiles SET display_name = 'ZZProbeName' WHERE id = v_a;
    IF (SELECT display_name_normalized FROM profiles WHERE id = v_a) IS DISTINCT FROM 'zzprobename' THEN
      RAISE EXCEPTION 'the trigger did not compute display_name_normalized';
    END IF;

    -- THE assertion for this slice: a CASE VARIANT must collide. A raw-string unique
    -- index passes every other check in this file and fails right here.
    v_bad := false;
    BEGIN
      UPDATE profiles SET display_name = 'ZZPROBENAME' WHERE id = v_b;
      v_bad := true;                      -- reached only if the duplicate was ACCEPTED
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
    IF v_bad THEN
      RAISE EXCEPTION 'CASE-VARIANT DUPLICATE ACCEPTED — the unique index is on the raw '
                      'string, not on display_name_normalized';
    END IF;

    -- CONTROL: a genuinely different name must still be accepted. Without this, the
    -- assertion above is satisfied by an index that rejects EVERY name.
    UPDATE profiles SET display_name = 'ZZProbeName2' WHERE id = v_b;
    IF (SELECT display_name_normalized FROM profiles WHERE id = v_b) IS DISTINCT FROM 'zzprobename2' THEN
      RAISE EXCEPTION 'CONTROL FAILED — a distinct name was not stored';
    END IF;

    -- reserved and blocked, through the trigger the app actually hits
    v_bad := false;
    BEGIN
      UPDATE profiles SET display_name = 'ADA Destek' WHERE id = v_b;
      v_bad := true;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'DISPLAY_NAME_RESERVED' THEN RAISE; END IF;
    END;
    IF v_bad THEN RAISE EXCEPTION 'a reserved display_name was accepted'; END IF;

    v_bad := false;
    BEGIN
      UPDATE profiles SET display_name = 'fuck' WHERE id = v_b;
      v_bad := true;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'BLOCKED_TERM' THEN RAISE; END IF;
    END;
    IF v_bad THEN RAISE EXCEPTION 'a blocked term was accepted as a display_name'; END IF;

    -- the age rule, and its control
    v_bad := false;
    BEGIN
      UPDATE profiles SET date_of_birth = (current_date - interval '5 years')::date
       WHERE id = v_b;
      v_bad := true;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'UNDERAGE' THEN RAISE; END IF;
    END;
    IF v_bad THEN RAISE EXCEPTION 'an under-13 date of birth was STORED'; END IF;

    UPDATE profiles SET date_of_birth = (current_date - interval '30 years')::date
     WHERE id = v_b;
    IF (SELECT date_of_birth FROM profiles WHERE id = v_b) IS NULL THEN
      RAISE EXCEPTION 'CONTROL FAILED — an adult date of birth was not stored';
    END IF;

    -- ─── THE PUSH_TOKEN GUARANTEE ───────────────────────────────────────────
    -- Plant the exact row that an unconditional filter would brick: one whose STORED
    -- full_name contains a blocked term. The trigger is disabled to plant it, because
    -- there is no other way to create that state — and it is precisely the state a
    -- pre-existing row can already be in.
    ALTER TABLE profiles DISABLE TRIGGER check_profile_name_content;
    UPDATE profiles SET full_name = 'fuck' WHERE id = v_a;
    ALTER TABLE profiles ENABLE TRIGGER check_profile_name_content;

    -- An unrelated write must still SUCCEED. If this raises, every such user has
    -- silently stopped receiving push notifications and nothing points here.
    BEGIN
      UPDATE profiles SET push_token = push_token WHERE id = v_a;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'THE IS-DISTINCT-FROM GUARD IS GONE: an unrelated write to a row '
                      'with a flagged stored full_name was rejected (%). Every such '
                      'user just lost push notifications.', SQLERRM;
    END;

    -- ...while a write that CHANGES the name is still rejected.
    v_bad := false;
    BEGIN
      UPDATE profiles SET full_name = 'fucker' WHERE id = v_a;
      v_bad := true;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'BLOCKED_TERM' THEN RAISE; END IF;
    END;
    IF v_bad THEN
      RAISE EXCEPTION 'CONTROL FAILED — a CHANGED full_name carrying a blocked term was accepted';
    END IF;

    -- Undo everything, CAPTURED not assumed. Restoring date_of_birth to NULL rather
    -- than to v_orig_dob would erase a real date on any re-apply after the wizard ships
    -- — the same mistake 20260926 avoided when it restored last_hit_at.
    ALTER TABLE profiles DISABLE TRIGGER check_profile_name_content;
    UPDATE profiles SET full_name = v_orig_a WHERE id = v_a;
    ALTER TABLE profiles ENABLE TRIGGER check_profile_name_content;
    UPDATE profiles SET display_name = NULL WHERE id IN (v_a, v_b);
    UPDATE profiles SET date_of_birth = v_orig_dob WHERE id = v_b;

    -- Scoped to the probe's OWN names, not to "any display name anywhere" — the latter
    -- reads as a leak the first time this file is re-applied on a database where real
    -- users have finished the wizard.
    IF EXISTS (SELECT 1 FROM profiles
                WHERE display_name_normalized IN ('zzprobename','zzprobename2')) THEN
      RAISE EXCEPTION 'the probe left a display name behind';
    END IF;
    RAISE NOTICE 'end-to-end assertions passed and were undone';
  END IF;

  RAISE NOTICE 'profile completion schema OK';
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
VALUES ('20261001_profile_completion_schema.sql', '6584b8acd688efb434ae2174b44727a1f9865936aa7cf6bbd4799ed0b763f55b')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- ADD COLUMN, so this is MANDATORY: without it PostgREST keeps a stale schema cache and
-- reports 42703 "column display_name does not exist" through the REST API while the
-- column plainly exists in Postgres. The wizard writes every one of these columns, and
-- two new TABLES also have to enter the cache before anything can read them.
NOTIFY pgrst, 'reload schema';

-- ─── Verify (run separately, after the COMMIT above) ────────────────────────
--
--   -- 1. the trigger that is actually installed, not the file claiming to install it:
--   SELECT pg_get_functiondef('public.check_profile_name_content()'::regprocedure)
--            ILIKE '%contains_blocked_term%'  AS routes_through_the_matcher,
--          pg_get_functiondef('public.check_profile_name_content()'::regprocedure)
--            ILIKE '%IS DISTINCT FROM OLD.full_name%' AS fires_only_on_change;
--   -- expect t, t
--
--   -- 2. uniqueness is on the NORMALIZED column, and it is UNIQUE:
--   SELECT indexname, indexdef FROM pg_indexes
--    WHERE schemaname='public' AND tablename='profiles'
--      AND indexname='profiles_display_name_norm_uniq';
--   -- expect one row whose indexdef contains UNIQUE and display_name_normalized
--
--   -- 3. policies — DERIVED counts, and PRINT them so a surprise is visible:
--   SELECT tablename, policyname, cmd, roles, qual, with_check FROM pg_policies
--    WHERE schemaname='public' AND tablename IN ('institutions','reserved_names')
--    ORDER BY tablename, policyname;
--   -- expect institutions: exactly 1 (SELECT, authenticated)
--   --        reserved_names: exactly 2 (read_all SELECT, admin_write ALL)
--
--   -- 3b. and the one this whole slice depends on NOT changing:
--   SELECT count(*) FROM pg_policies
--    WHERE schemaname='public' AND tablename='profiles' AND cmd='SELECT';
--   -- expect 3. If this is 4, something re-opened the over-share and the availability
--   -- RPC's entire justification has changed.
--
--   -- 4. then, from the repo root:
--   --      npm run profile:check
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   DROP TRIGGER check_profile_name_content ON public.profiles;
--   DROP FUNCTION public.check_profile_name_content();
--   DROP INDEX public.profiles_display_name_norm_uniq;
--   DROP INDEX public.idx_profiles_institution_id;
--   ALTER TABLE public.profiles
--     DROP CONSTRAINT profiles_institution_id_fkey,
--     DROP COLUMN first_name, DROP COLUMN last_name, DROP COLUMN display_name,
--     DROP COLUMN display_name_normalized, DROP COLUMN date_of_birth,
--     DROP COLUMN region, DROP COLUMN resident_status,
--     DROP COLUMN resident_status_updated_at, DROP COLUMN student_level,
--     DROP COLUMN institution_id, DROP COLUMN display_preference,
--     DROP COLUMN profile_completed_at, DROP COLUMN profile_schema_version,
--     DROP COLUMN age_ineligible, DROP COLUMN nationality_code;
--   DROP FUNCTION public.is_reserved_display_name(text);
--   DROP FUNCTION public.normalize_display_name(text);
--   DROP TABLE public.reserved_names;
--   DROP TABLE public.institutions;
--   -- and restore the narrower content_type CHECK from 20260926.
--   NOTIFY pgrst, 'reload schema';
-- ⚠ DROPPING first_name/last_name does NOT restore full_name for anyone whose row the
--   sync trigger rewrote. Take a backup of profiles(id, full_name) before rolling back.
--   DELETE FROM public.schema_migrations_applied
--    WHERE filename = '20261001_profile_completion_schema.sql';
