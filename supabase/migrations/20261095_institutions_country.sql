-- ═══ institutions — a country per row, ready for universities outside the TRNC ═════════
--
-- Schema only; the rows come in 20261096 (TR), 20261097 (CY) and 20261098 (GB). Three parts:
--
--   1. COUNTRY. `country` holds an ISO 3166-1 alpha-2 code. The TRNC has none, so its rows
--      carry 'XN', the code this app already uses for it (constants/profileGate.js
--      TRNC_NATIONALITY_CODE: the ISO user-assigned range XA–XZ exists for exactly this, and
--      'CY' is the Republic of Cyprus). Every row has one except Other (…00ff), which is not a
--      place.
--
--   2. CITY. `city` stays what it is: a TRNC region slug, joinable to constants/regions.js
--      and checked by institutions_city_check, which is left BYTE-IDENTICAL
--      (scripts/check-profile-gate.mjs compares its vocabulary to REGIONS). A slug now also
--      requires country = 'XN'. Everywhere else the city is free text in `city_name`, as the
--      official source gives it, NULL where it gives none. One owner per row: a TRNC row
--      never carries a city_name.
--
--   3. NAMES ARE UNIQUE PER COUNTRY, not globally. YÖK's "Ankara Sosyal Bilimler
--      Üniversitesi" (Ankara) has exactly the name of our TRNC row …0017 (its Lefkoşa
--      campus), and a world list will repeat names across countries routinely.
--
--   4. THE RECIPROCITY GATE COUNTS ONLY ENROLMENTS SOMEBODY CAN SEE. is_listed_student()
--      is "visible in the Student Hub"; can_see_student_lists(), get_student_profile,
--      start_conversation, send_message and list_conversations all ask it. Until now it
--      counted ANY opted-in enrolment, while get_student_list only shows enrolments at an
--      ACTIVE institution. So an opt-in at a deactivated university (Kıbrıs İlim, …0006) or
--      at Other unlocked every list and messaging without its owner appearing in any list.
--      Both functions now require the same join: an active institution that is not Other.
--      Every such institution gets a list, whatever its country (decided 2026-10-08), so
--      "listed" and "appears in a list" are the same set. Live 2026-10-08 (readonly
--      institutions_intl_baseline): 0 opted-in rows at an inactive institution or Other, so
--      no one currently listed is de-listed.
--
-- RE-RUN: idempotent. ADD COLUMN IF NOT EXISTS, constraints dropped and re-added, the
-- backfill only fills NULLs, CREATE OR REPLACE for both functions.
--
-- EXECUTION: supabase-migrate workflow (dry, then -f apply=true). Requires 20261036.

SET ROLE postgres;

BEGIN;

-- ─── 0. Preconditions ───────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.is_listed_student(uuid)') IS NULL
     OR to_regprocedure('public.get_student_list(uuid,text,integer)') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: is_listed_student / get_student_list missing (20261029). Nothing applied.';
  END IF;
  -- This file REPLACES is_listed_student's body. Without 20261036's guest guard in the
  -- current body, replacing it would look like a tightening while it reopened the oracle.
  IF pg_get_functiondef(to_regprocedure('public.is_listed_student(uuid)')) NOT LIKE '%NOT is_anonymous_session()%' THEN
    RAISE EXCEPTION 'REFUSING: is_listed_student lacks 20261036''s guest guard. Apply 20261036 first. Nothing applied.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.institutions WHERE id = '00000000-0000-4000-b000-0000000000ff') THEN
    RAISE EXCEPTION 'REFUSING: Other (…00ff) is missing. Nothing applied.';
  END IF;
END $$;

-- ─── 1. Columns ─────────────────────────────────────────────────────────────
ALTER TABLE public.institutions ADD COLUMN IF NOT EXISTS country   text;
ALTER TABLE public.institutions ADD COLUMN IF NOT EXISTS city_name text;

-- Every row but Other is a TRNC university today (24 rows: 23 active + Kıbrıs İlim).
UPDATE public.institutions SET country = 'XN'
 WHERE country IS NULL AND id <> '00000000-0000-4000-b000-0000000000ff';

-- ─── 2. Constraints ─────────────────────────────────────────────────────────
ALTER TABLE public.institutions DROP CONSTRAINT IF EXISTS institutions_country_check;
ALTER TABLE public.institutions ADD  CONSTRAINT institutions_country_check
  CHECK (country ~ '^[A-Z]{2}$');

-- Other has no country, and nothing else may lack one.
ALTER TABLE public.institutions DROP CONSTRAINT IF EXISTS institutions_country_required_check;
ALTER TABLE public.institutions ADD  CONSTRAINT institutions_country_required_check
  CHECK (country IS NOT NULL OR id = '00000000-0000-4000-b000-0000000000ff');

-- A region slug is a TRNC fact.
ALTER TABLE public.institutions DROP CONSTRAINT IF EXISTS institutions_city_country_check;
ALTER TABLE public.institutions ADD  CONSTRAINT institutions_city_country_check
  CHECK (city IS NULL OR country = 'XN');

ALTER TABLE public.institutions DROP CONSTRAINT IF EXISTS institutions_city_name_check;
ALTER TABLE public.institutions ADD  CONSTRAINT institutions_city_name_check
  CHECK (city_name IS NULL OR (country IS DISTINCT FROM 'XN' AND btrim(city_name) <> ''));

ALTER TABLE public.institutions DROP CONSTRAINT IF EXISTS institutions_name_unique;
ALTER TABLE public.institutions DROP CONSTRAINT IF EXISTS institutions_country_name_unique;
ALTER TABLE public.institutions ADD  CONSTRAINT institutions_country_name_unique UNIQUE (country, name);

-- The app reads one country at a time (PostgREST max-rows is 1000; a world list is not).
CREATE INDEX IF NOT EXISTS institutions_country_idx ON public.institutions (country) WHERE is_active;

-- ─── 3. The reciprocity gate ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_listed_student(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Visible in the Student Hub = an opted-in enrolment at an institution that HAS a list
  -- (active, not Other), a display name, and no UGC ban. The institution join is the same
  -- one get_student_list uses; if the two ever differ, somebody can see without being seen.
  SELECT auth.uid() IS NOT NULL
     AND NOT is_anonymous_session()
     AND EXISTS (
    SELECT 1
      FROM student_education e
      JOIN profiles p     ON p.id = e.user_id
      JOIN institutions i ON i.id = e.institution_id AND i.is_active
                         AND i.id <> '00000000-0000-4000-b000-0000000000ff'
     WHERE e.user_id = p_user_id
       AND e.listing_opt_in
       AND p.display_name IS NOT NULL
       AND (p.ugc_banned_until IS NULL OR p.ugc_banned_until <= now())
  );
$function$;

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
      JOIN profiles p     ON p.id = e.user_id
      JOIN institutions i ON i.id = e.institution_id AND i.is_active
                         AND i.id <> '00000000-0000-4000-b000-0000000000ff'
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

-- ─── 4. Verification (inside the transaction: a failure rolls everything back) ──
DO $$
DECLARE
  v_rows     text;
  v_n        int;
  v_set      text;
  v_fn       text;
  v_join     constant text := 'JOIN institutions i ON i.id = e.institution_id AND i.is_active
                         AND i.id <> ''00000000-0000-4000-b000-0000000000ff''';
  v_probe    uuid;
  v_listed_before int;
BEGIN
  -- Backfill: exactly the 24 TRNC rows, Other untouched. Printed, not just counted.
  SELECT string_agg(format('%s %s=%s', right(id::text, 4), coalesce(country, 'NULL'), name), ' · ' ORDER BY sort_order, name)
    INTO v_rows FROM public.institutions;
  RAISE NOTICE 'institutions after backfill: %', v_rows;
  SELECT count(*) INTO v_n FROM public.institutions WHERE country = 'XN';
  IF v_n <> 24 THEN
    RAISE EXCEPTION 'expected 24 XN rows (23 active + Kıbrıs İlim), found %. Nothing applied.', v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM public.institutions WHERE country IS DISTINCT FROM 'XN'
              AND id <> '00000000-0000-4000-b000-0000000000ff') THEN
    RAISE EXCEPTION 'a row outside the TRNC already exists before the seeds ran. Nothing applied.';
  END IF;
  IF (SELECT country FROM public.institutions WHERE id = '00000000-0000-4000-b000-0000000000ff') IS NOT NULL THEN
    RAISE EXCEPTION 'Other (…00ff) has a country. Nothing applied.';
  END IF;

  -- The full constraint set, derived and printed. contype 'n' excluded: PG 18 records
  -- NOT NULL there and PG 17 (prod) does not, and neither is what this counts.
  SELECT count(*), string_agg(conname, ', ' ORDER BY conname) INTO v_n, v_rows
    FROM pg_constraint WHERE conrelid = 'public.institutions'::regclass AND contype <> 'n';
  RAISE NOTICE 'institutions constraints (%): %', v_n, v_rows;
  IF v_n <> 8 OR v_rows LIKE '%institutions_name_unique%' THEN
    RAISE EXCEPTION 'expected 8 constraints without institutions_name_unique, found %: %. Nothing applied.', v_n, v_rows;
  END IF;
  IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'institutions_city_check'
                            AND conrelid = 'public.institutions'::regclass))
     IS DISTINCT FROM 'CHECK (((city IS NULL) OR (city = ANY (ARRAY[''nicosia''::text, ''kyrenia''::text, ''famagusta''::text, ''morphou''::text, ''iskele''::text, ''lefke''::text, ''karpaz''::text]))))' THEN
    RAISE EXCEPTION 'institutions_city_check changed; this file must leave it as it was. Nothing applied.';
  END IF;

  -- Policies on institutions: still exactly the one SELECT for authenticated.
  SELECT count(*), string_agg(policyname || ':' || cmd, ', ') INTO v_n, v_rows
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'institutions';
  IF v_n <> 1 OR v_rows <> 'institutions_read_authenticated:SELECT' THEN
    RAISE EXCEPTION 'institutions policies are %: %. Expected exactly institutions_read_authenticated. Nothing applied.', v_n, v_rows;
  END IF;

  -- Both functions carry the SAME join (the reciprocity invariant), anchored to code shape.
  FOREACH v_fn IN ARRAY ARRAY['public.is_listed_student(uuid)', 'public.get_student_list(uuid,text,integer)'] LOOP
    IF position(v_join IN pg_get_functiondef(to_regprocedure(v_fn))) = 0 THEN
      RAISE EXCEPTION '% does not carry the active-and-not-Other institution join. Nothing applied.', v_fn;
    END IF;
    IF NOT (SELECT prosecdef AND provolatile = 's' AND proconfig::text LIKE '%search_path=public%'
              FROM pg_proc WHERE oid = to_regprocedure(v_fn)) THEN
      RAISE EXCEPTION '% is not STABLE SECURITY DEFINER with search_path=public. Nothing applied.', v_fn;
    END IF;
  END LOOP;
  IF pg_get_functiondef(to_regprocedure('public.is_listed_student(uuid)')) NOT LIKE '%NOT is_anonymous_session()%' THEN
    RAISE EXCEPTION 'is_listed_student lost its guest guard. Nothing applied.';
  END IF;

  -- Grants survive CREATE OR REPLACE; prove it (20261081's set for is_listed_student,
  -- 20261026's for get_student_list: no PUBLIC, no anon).
  SELECT string_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END, ','
                    ORDER BY CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END)
    INTO v_set
    FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a LEFT JOIN pg_roles r ON r.oid = a.grantee
   WHERE p.oid = to_regprocedure('public.is_listed_student(uuid)') AND a.privilege_type = 'EXECUTE';
  IF v_set IS DISTINCT FROM 'authenticated,postgres,service_role,supabase_read_only_user' THEN
    RAISE EXCEPTION 'is_listed_student EXECUTE grantees are %. Nothing applied.', coalesce(v_set, '(none)');
  END IF;
  SELECT string_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END, ','
                    ORDER BY CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END)
    INTO v_set
    FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a LEFT JOIN pg_roles r ON r.oid = a.grantee
   WHERE p.oid = to_regprocedure('public.get_student_list(uuid,text,integer)') AND a.privilege_type = 'EXECUTE';
  IF v_set ~ '(^|,)(PUBLIC|anon)(,|$)' OR v_set NOT LIKE '%authenticated%' THEN
    RAISE EXCEPTION 'get_student_list EXECUTE grantees are %. Nothing applied.', coalesce(v_set, '(none)');
  END IF;

  -- NEGATIVE: a guest is never listed.
  PERFORM set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","is_anonymous":true}', true);
  IF public.is_listed_student('00000000-0000-4000-8000-0000000000a2'::uuid) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'is_listed_student answered a GUEST. Nothing applied.';
  END IF;

  -- POSITIVE CONTROL: a person who is listed by the new rule reads as listed from a real
  -- session. Without it, "return false" would pass every check above and kill the hub.
  SELECT e.user_id INTO v_probe
    FROM student_education e
    JOIN profiles p     ON p.id = e.user_id
    JOIN institutions i ON i.id = e.institution_id AND i.is_active
                       AND i.id <> '00000000-0000-4000-b000-0000000000ff'
   WHERE e.listing_opt_in AND p.display_name IS NOT NULL
     AND (p.ugc_banned_until IS NULL OR p.ugc_banned_until <= now())
   LIMIT 1;
  IF v_probe IS NULL THEN
    RAISE NOTICE 'CONTROL SKIPPED: nobody is opted in with a display name, so no TRUE can be shown.';
  ELSE
    PERFORM set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_probe), true);
    IF public.is_listed_student(v_probe) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'CONTROL: % should be listed and is not — the gate refuses everyone. Nothing applied.', v_probe;
    END IF;
  END IF;

  -- No one listed under the old rule is de-listed by the new one (live: 0 such rows).
  SELECT count(DISTINCT e.user_id) INTO v_listed_before
    FROM student_education e JOIN profiles p ON p.id = e.user_id
   WHERE e.listing_opt_in AND p.display_name IS NOT NULL
     AND (p.ugc_banned_until IS NULL OR p.ugc_banned_until <= now());
  SELECT count(DISTINCT e.user_id) INTO v_n
    FROM student_education e JOIN profiles p ON p.id = e.user_id
    JOIN institutions i ON i.id = e.institution_id AND i.is_active
                       AND i.id <> '00000000-0000-4000-b000-0000000000ff'
   WHERE e.listing_opt_in AND p.display_name IS NOT NULL
     AND (p.ugc_banned_until IS NULL OR p.ugc_banned_until <= now());
  RAISE NOTICE 'listed people: % under the old rule, % under the new', v_listed_before, v_n;
  IF v_n <> v_listed_before THEN
    RAISE EXCEPTION 'the new rule de-lists % person(s) (opted in only at an inactive institution or Other). '
                    'Decide that before applying. Nothing applied.', v_listed_before - v_n;
  END IF;

  PERFORM set_config('request.jwt.claims', '', true);
  RAISE NOTICE '20261095 verified: 24 XN rows, Other NULL, 8 constraints, 1 policy, both functions share the join, guest refused, control listed.';
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
VALUES ('20261095_institutions_country.sql', '5f9c37fbc18119c053a5a7c8234b6331f70c651d077300218afcafad1d62f9c5')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

NOTIFY pgrst, 'reload schema';
