-- ═══════════════════════════════════════════════════════════════════════════
-- 20261191 — Only the server records a terms acceptance: accept_terms() + a soft guard on direct writes
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Berke (2026-11-12): until now the app wrote profiles.terms_version / terms_locale itself, straight into its own row, and
-- the database believed whatever it sent (a far-future version, a made-up language, a lower version over a newer one).
-- This file adds the ONE function the app calls to record an acceptance, and a guard that checks the direct writes the
-- older app versions still make. Functions + one trigger only: NO table, column, policy, grant-on-a-table or index change,
-- and NO existing function body is replaced (check_profile_name_content, which stamps terms_accepted_at, is untouched;
-- its md5 is read before and after and must match).
--
-- ─── WHO CAN WRITE WHAT AFTER THIS FILE ─────────────────────────────────────
--   • A signed-in (non-guest) person: calls accept_terms(version, language) for THEIR OWN row (no user id argument, it
--     acts on auth.uid() only). It writes only when the version is on the published list below, the language is one of
--     the nine full English names, a profile row exists, and the version is HIGHER than the one already recorded. The
--     time is stamped by the server (branch (g) of check_profile_name_content, as before); a second acceptance of the
--     same version, or of an older one, writes nothing and does not move the time.
--   • The same person's DIRECT update of profiles.terms_version / terms_locale (what every app already in the field does)
--     STILL WORKS, but is now checked: the version must be on the published list (or NULL), the language one of the nine
--     (or NULL), and the version may not go DOWN or be cleared. So an acceptance can no longer be made up, lowered or
--     un-recorded by the app. It is not yet REFUSED outright: that is the later migration (below).
--   • A guest (anonymous session): cannot record an acceptance, as before (accept_terms raises AUTH_REQUIRED; the
--     "no_anon_update_profiles" policy already stops a direct write).
--   • anon (no session): nothing. service_role / SQL editor / postgres (no user id): may write any PUBLISHED version and
--     valid language in any direction (data fixes, tests); an unlisted version or language is refused for them too.
--   • An admin session: same as a signed-in person for validity; exempt from "may not go down" (an admin can already update
--     any profile, "admin update all").
--   The two list helpers are internal: executable by nobody but the function owner (called from the SECURITY DEFINER
--   function and trigger function below).
--
-- ─── NEW STANDING RULE ──────────────────────────────────────────────────────
--   EVERY FUTURE LEGAL_VERSION BUMP NEEDS A MIGRATION THAT ADDS THE NEW VERSION TO is_published_terms_version(), APPLIED
--   BEFORE THE OTA (or build) THAT CARRIES THE BUMP. Otherwise the app's new acceptance is refused (TERMS_VERSION_UNKNOWN)
--   and every user is asked again on every launch. Raising the list = a new migration that re-creates that ONE function.
--   __tests__/termsVersionsPublished.test.js fails when LEGAL_VERSION, MARKETPLACE_TERMS_MIN or STUDENT_HUB_TERMS_MIN is not
--   in the newest definition of the helper, so the bump cannot be committed without it.
--
-- ─── THE PUBLISHED LIST: every LEGAL_VERSION any shipped bundle could send (git history, ALL refs, merges included) ───
--   First commit carrying each value (git log --all -m -G"LEGAL_VERSION *="):
--     2026-09      8064bfec  constants/legal moved out of LegalScreen (first value of the constant; first written to a profile
--                            by 73d76e4a, 2026-09-13)
--     2026-09-20   bc9ecbab  Student Hub privacy rewrite
--     2026-09-24   23a656dc  Visit NCY routes go-live
--     2026-09-27   359abb66  route medals
--     2026-10-02   add69d69  check-ins DRAFT (committed as the constant; may have shipped in a Preview bundle; included)
--     2026-10-08   98404126  check-ins published
--     2026-10-21   7a9271ad  WhatsApp order records (committed "NOT published"; included, a bundle could carry it)
--     2026-10-22   b8cbb229  re-dated to the publish day
--     2026-10-23   c2432213  Sepetim delivery choice
--     2026-10-24   60ef7d8b  Sepetim address book
--     2026-10-25   84fdef35  per-dish options
--     2026-10-30   88459b6a  North Houses booking requests
--     2026-11-09   fa20d2e4  Explore stage 4 (a MERGE commit: invisible to a plain git log; shipped as 59d37a73)
--     2026-11-11   0acf7a80  Bandabuliya
--   NOT in the list: '2026-08'. The constants comment says "Bumped 2026-08 -> 2026-09", but no committed constant ever held
--   2026-08 (the first LEGAL_VERSION is '2026-09'), and no client wrote terms_version before 2026-09-13 (73d76e4a), so no
--   bundle sent it. The pre-flight below refuses (nothing applied) if a live row nonetheless carries it, or any other
--   unlisted value. Limit: a branch deleted before this check is invisible to git.
--
-- ─── WHY THE GUARD CANNOT CHANGE WHAT BRANCH (g) SEES ────────────────────────
--   BEFORE row triggers fire in name order: check_profile_name_content (which stamps terms_accepted_at when terms_version
--   changes), then this file's guard_profile_terms_columns. The guard only validates: it never assigns to NEW and returns
--   NEW untouched, so whichever order the triggers ran in, (g) would see the same terms_version it sees today. A refused
--   write rolls the whole statement back, stamp included.
--   The guard is `BEFORE UPDATE OF terms_version, terms_locale`: an update that does not mention those columns (a push
--   token, a profile edit) never fires it. It acts only when one of them actually changes (IS DISTINCT FROM), so an old
--   app re-writing the SAME version (a token refresh re-fires its flush) passes untouched. UPDATE only: profiles has no
--   permissive INSERT policy for a client (only the RESTRICTIVE no_anon_insert_profiles), the one inserter is
--   handle_new_user() (id, role only, terms NULL), so there is no client INSERT path to guard.
--
-- ─── SERVER-ONLY SWITCH, ALREADY WIRED, NOT YET REQUIRED ─────────────────────
--   accept_terms() sets the transaction-local app.trusted_terms = 'on' around its UPDATE (the 20261183 pattern:
--   guard_marketplace_notice_columns / app.trusted_marketplace_notice). In THIS file the guard does not read it and the
--   switch bypasses nothing (a client able to set it would gain nothing). The LATER hard-guard migration re-creates ONLY
--   guard_profile_terms_columns() and adds, for a client session (auth.uid() NOT NULL, not admin) whose terms_version or
--   terms_locale changes: IF current_setting('app.trusted_terms', true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION
--   'TERMS_SERVER_ONLY'. Nothing else moves: not accept_terms, not the helpers, not the trigger, no app change. It can land
--   once no app version in the field writes terms directly (release/1.1, release/1.4 and the embedded store bundles are
--   the ones that still do, and stale pending acceptances live up to 7 days on a device). Its verify_schema token and test
--   follow this file's. This file records the guard's md5(prosrc) in its apply, for that file's pin.
--
-- ─── NOTES ──────────────────────────────────────────────────────────────────
--   • An old app that flushes a STALE pending acceptance (a version lower than one the account already holds, from another
--     device) is now refused TERMS_VERSION_LOWER: its flush returns null, leaves the pending entry for up to 7 days and
--     retries on the next session. Nothing blocks and no row changes; the newer acceptance stays.
--   • A client may still change terms_locale between two valid languages, or set it NULL while the version stays: not
--     blocked here (the brief covers the version); the hard guard makes every direct write refused anyway.
--   • service_role has no EXECUTE on accept_terms (it has no auth.uid(), the function would only ever answer AUTH_REQUIRED).
--     Supabase's default privileges grant EXECUTE to anon and service_role by NAME on a new function, so this file
--     revokes them explicitly; authenticated is granted.
--
-- Apply: one supabase-migrate run (Berke approves production-db). The dry run prints this file but does not execute the
-- pre-flight on live rows: before the go, read supabase/readonly/terms_reask_scope.sql (versions and languages present).
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── 0. Pre-flight: what this file stands on (no row values, counts or ids are printed) ─────────────────────
DO $pre$
BEGIN
  IF to_regclass('public.profiles') IS NULL
     OR (SELECT count(*) FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'profiles'
            AND column_name IN ('terms_version', 'terms_locale', 'terms_accepted_at')) IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'REFUSING: profiles or its terms columns are missing (20261016 first). Nothing applied.';
  END IF;
  IF to_regprocedure('public.is_anonymous_session()') IS NULL OR to_regprocedure('public.get_my_role()') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: is_anonymous_session() or get_my_role() is missing. Nothing applied.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                  WHERE t.tgrelid = 'public.profiles'::regclass AND NOT t.tgisinternal AND t.tgname = 'check_profile_name_content'
                    AND p.proname = 'check_profile_name_content' AND p.prosrc LIKE '%NEW.terms_accepted_at := now();%') THEN
    RAISE EXCEPTION 'REFUSING: the trigger check_profile_name_content that stamps terms_accepted_at is not on profiles as expected. Nothing applied.';
  END IF;
  -- Remembered for the assertions: the stamping function's body, the triggers and the policies on profiles.
  PERFORM set_config('mig1191.name_fn', (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.check_profile_name_content()')), true);
  PERFORM set_config('mig1191.triggers', (SELECT coalesce(string_agg(tgname, ', ' ORDER BY tgname), '') FROM pg_trigger
                                           WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal AND tgname <> 'guard_profile_terms_columns'), true);
  PERFORM set_config('mig1191.policies', (SELECT coalesce(string_agg(policyname || ':' || permissive || ':' || cmd, ', ' ORDER BY policyname), '')
                                           FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles'), true);
END $pre$;

-- ─── 1. The two lists: ONE place each ───────────────────────────────────────────────────────────────────────
-- The only place on the server that names the published versions / the accepted languages. Both accept_terms() and the
-- guard call these, so the RPC and the guard cannot disagree. NULL is never published / never a language.
CREATE OR REPLACE FUNCTION public.is_published_terms_version(p_version text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT p_version IS NOT NULL AND p_version = ANY (ARRAY[
    '2026-09',
    '2026-09-20',
    '2026-09-24',
    '2026-09-27',
    '2026-10-02',
    '2026-10-08',
    '2026-10-21',
    '2026-10-22',
    '2026-10-23',
    '2026-10-24',
    '2026-10-25',
    '2026-10-30',
    '2026-11-09',
    '2026-11-11'
  ]::text[]);
$function$;

-- The nine LANGUAGES keys of constants/i18n.js, as FULL ENGLISH NAMES; an ISO code ('tr', 'en') matches nothing.
CREATE OR REPLACE FUNCTION public.is_terms_locale(p_locale text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT p_locale IS NOT NULL AND p_locale = ANY (ARRAY[
    'English',
    'Turkish',
    'Arabic',
    'Russian',
    'Greek',
    'French',
    'Spanish',
    'German',
    'Persian'
  ]::text[]);
$function$;
REVOKE ALL ON FUNCTION public.is_published_terms_version(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_terms_locale(text) FROM PUBLIC, anon, authenticated, service_role;

-- ─── 2. Pre-flight on live rows: nothing already on file may be outside the lists ───────────────────────────
-- Prints nothing about the rows. Needs the helpers above, so it sits here; a refusal rolls the whole file back.
DO $pre2$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles
              WHERE (terms_version IS NOT NULL AND NOT public.is_published_terms_version(terms_version))
                 OR (terms_locale  IS NOT NULL AND NOT public.is_terms_locale(terms_locale))) THEN
    RAISE EXCEPTION 'REFUSING: at least one profiles row carries a terms_version or terms_locale outside the published lists. Read supabase/readonly/terms_reask_scope.sql, decide (extend the list or fix the rows), then re-run. Nothing applied.';
  END IF;
END $pre2$;

-- ─── 3. The one function the app calls to record an acceptance ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.accept_terms(p_version text, p_locale text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me  uuid := auth.uid();
  v_ver text;
  v_loc text;
  v_at  timestamptz;
BEGIN
  IF v_me IS NULL OR is_anonymous_session() THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF p_version IS NULL OR NOT is_published_terms_version(p_version) THEN
    RAISE EXCEPTION 'TERMS_VERSION_UNKNOWN';
  END IF;
  IF p_locale IS NULL OR NOT is_terms_locale(p_locale) THEN
    RAISE EXCEPTION 'TERMS_LOCALE_UNKNOWN';
  END IF;

  SELECT terms_version, terms_locale, terms_accepted_at INTO v_ver, v_loc, v_at
    FROM profiles WHERE id = v_me FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_MISSING';
  END IF;

  -- Never lowers, never re-stamps: an equal or newer version already on file is returned as it stands.
  IF v_ver IS NOT NULL AND v_ver COLLATE "C" >= p_version COLLATE "C" THEN
    RETURN jsonb_build_object('terms_version', v_ver, 'terms_locale', v_loc, 'terms_accepted_at', v_at);
  END IF;

  PERFORM set_config('app.trusted_terms', 'on', true);
  UPDATE profiles SET terms_version = p_version, terms_locale = p_locale
   WHERE id = v_me
   RETURNING terms_version, terms_locale, terms_accepted_at INTO v_ver, v_loc, v_at;
  PERFORM set_config('app.trusted_terms', 'off', true);

  RETURN jsonb_build_object('terms_version', v_ver, 'terms_locale', v_loc, 'terms_accepted_at', v_at);
END;
$function$;
REVOKE ALL ON FUNCTION public.accept_terms(text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.accept_terms(text, text) TO authenticated;

-- ─── 4. The soft guard on direct writes ─────────────────────────────────────────────────────────────────────
-- VALIDATE ONLY: it never assigns to NEW (see the header on firing order). SECURITY DEFINER with a pinned search_path,
-- like the two live profiles triggers, so no client role needs EXECUTE on the helpers.
CREATE OR REPLACE FUNCTION public.guard_profile_terms_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_version_moved boolean := NEW.terms_version IS DISTINCT FROM OLD.terms_version;
  v_locale_moved  boolean := NEW.terms_locale  IS DISTINCT FROM OLD.terms_locale;
BEGIN
  IF NOT (v_version_moved OR v_locale_moved) THEN
    RETURN NEW;
  END IF;
  IF v_version_moved AND NEW.terms_version IS NOT NULL AND NOT is_published_terms_version(NEW.terms_version) THEN
    RAISE EXCEPTION 'TERMS_VERSION_UNKNOWN';
  END IF;
  IF v_locale_moved AND NEW.terms_locale IS NOT NULL AND NOT is_terms_locale(NEW.terms_locale) THEN
    RAISE EXCEPTION 'TERMS_LOCALE_UNKNOWN';
  END IF;
  -- A client session (a user id, not an admin) cannot un-record or lower an acceptance. No user id = service role / SQL.
  IF v_version_moved AND OLD.terms_version IS NOT NULL
     AND auth.uid() IS NOT NULL AND coalesce(get_my_role(), '') <> 'admin'
     AND (NEW.terms_version IS NULL OR NEW.terms_version COLLATE "C" < OLD.terms_version COLLATE "C") THEN
    RAISE EXCEPTION 'TERMS_VERSION_LOWER';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_profile_terms_columns() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS guard_profile_terms_columns ON public.profiles;
CREATE TRIGGER guard_profile_terms_columns BEFORE UPDATE OF terms_version, terms_locale ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_terms_columns();

-- ─── 5. Assertions ──────────────────────────────────────────────────────────────────────────────────────────
DO $assert$
DECLARE v_names text; v_n int; v_sig text; v_role text;
BEGIN
  -- The lists behave (no rows involved): a published version / a full language name pass, the rest do not.
  IF NOT (public.is_published_terms_version('2026-11-11') AND public.is_published_terms_version('2026-09')
          AND NOT public.is_published_terms_version('2099-01-01') AND NOT public.is_published_terms_version('2026-08')
          AND public.is_published_terms_version(NULL) IS NOT DISTINCT FROM false) THEN
    RAISE EXCEPTION 'is_published_terms_version does not answer as expected';
  END IF;
  IF NOT (public.is_terms_locale('Turkish') AND public.is_terms_locale('Persian')
          AND NOT public.is_terms_locale('tr') AND NOT public.is_terms_locale('en') AND NOT public.is_terms_locale('')
          AND public.is_terms_locale(NULL) IS NOT DISTINCT FROM false) THEN
    RAISE EXCEPTION 'is_terms_locale does not answer as expected';
  END IF;

  -- accept_terms: no uuid argument, DEFINER with a pinned search_path, sets the switch; authenticated yes (positive
  -- control), anon / service_role / PUBLIC no.
  IF to_regprocedure('public.accept_terms(uuid,text,text)') IS NOT NULL OR to_regprocedure('public.accept_terms(uuid,text)') IS NOT NULL
     OR (SELECT count(*) FROM pg_proc WHERE proname = 'accept_terms' AND pronamespace = 'public'::regnamespace) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'accept_terms must be exactly one function, taking no user id';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.accept_terms(text,text)')
                  AND prosecdef AND prorettype = 'jsonb'::regtype AND proconfig @> ARRAY['search_path=public']
                  AND prosrc LIKE '%v_me  uuid := auth.uid();%' AND prosrc LIKE '%WHERE id = v_me%'
                  AND prosrc LIKE '%PERFORM set_config(''app.trusted_terms'', ''on'', true);%') THEN
    RAISE EXCEPTION 'accept_terms is not the caller-only SECURITY DEFINER function expected';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.accept_terms(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'positive control: authenticated must be able to call accept_terms';
  END IF;
  IF has_function_privilege('anon', 'public.accept_terms(text,text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.accept_terms(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon and service_role must not call accept_terms';
  END IF;
  IF EXISTS (SELECT 1 FROM aclexplode((SELECT proacl FROM pg_proc WHERE oid = to_regprocedure('public.accept_terms(text,text)'))) a
              WHERE a.grantee = 0) THEN
    RAISE EXCEPTION 'accept_terms is still executable by PUBLIC';
  END IF;

  -- The three internal functions: nobody but the owner.
  FOREACH v_sig IN ARRAY ARRAY['public.is_published_terms_version(text)', 'public.is_terms_locale(text)', 'public.guard_profile_terms_columns()'] LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF has_function_privilege(v_role, v_sig, 'EXECUTE') THEN
        RAISE EXCEPTION '% must not be executable by %', v_sig, v_role;
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM aclexplode((SELECT proacl FROM pg_proc WHERE oid = to_regprocedure(v_sig))) a WHERE a.grantee = 0) THEN
      RAISE EXCEPTION '% is executable by PUBLIC', v_sig;
    END IF;
  END LOOP;

  -- The guard: validate-only SECURITY DEFINER, asks the helpers, never assigns to NEW; the trigger is ONE BEFORE UPDATE OF.
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.guard_profile_terms_columns()')
                  AND prosecdef AND proconfig @> ARRAY['search_path=public']
                  AND prosrc LIKE '%NOT is_published_terms_version(NEW.terms_version)%'
                  AND prosrc LIKE '%NOT is_terms_locale(NEW.terms_locale)%') THEN
    RAISE EXCEPTION 'guard_profile_terms_columns is not the validating SECURITY DEFINER function expected';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.guard_profile_terms_columns()') AND prosrc ~ 'NEW\.[a-z_]+ *:=') THEN
    RAISE EXCEPTION 'guard_profile_terms_columns must not assign to NEW (it must not change what branch (g) sees)';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal AND tgname = 'guard_profile_terms_columns'
         AND tgenabled = 'O' AND tgfoid = to_regprocedure('public.guard_profile_terms_columns()')
         AND pg_get_triggerdef(oid) LIKE '%BEFORE UPDATE OF terms_version, terms_locale ON public.profiles FOR EACH ROW%') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'the guard trigger is not exactly one enabled BEFORE UPDATE OF terms_version, terms_locale on profiles';
  END IF;

  -- No live body replaced, no trigger or policy moved: the stamping function is byte-identical, and the trigger and policy
  -- sets on profiles differ from before by exactly the one trigger added here (the full sets printed).
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.check_profile_name_content()')) IS DISTINCT FROM current_setting('mig1191.name_fn') THEN
    RAISE EXCEPTION 'check_profile_name_content changed during this file';
  END IF;
  SELECT string_agg(tgname, ', ' ORDER BY tgname), count(*) INTO v_names, v_n
    FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal;
  RAISE NOTICE 'triggers on profiles (% total): %', v_n, v_names;
  IF (SELECT string_agg(tgname, ', ' ORDER BY tgname) FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal AND tgname <> 'guard_profile_terms_columns')
       IS DISTINCT FROM current_setting('mig1191.triggers')
     OR v_n IS DISTINCT FROM (SELECT count(*) FROM regexp_split_to_table(nullif(current_setting('mig1191.triggers'), ''), ', ')) + 1 THEN
    RAISE EXCEPTION 'the set of triggers on profiles differs by more than the one added here';
  END IF;
  SELECT string_agg(policyname || ':' || permissive || ':' || cmd, ', ' ORDER BY policyname), count(*) INTO v_names, v_n
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles';
  RAISE NOTICE 'policies on profiles (% total): %', v_n, v_names;
  IF coalesce(v_names, '') IS DISTINCT FROM current_setting('mig1191.policies') THEN
    RAISE EXCEPTION 'a policy on profiles changed during this file';
  END IF;
  RAISE NOTICE 'guard_profile_terms_columns md5(prosrc) = % (pin for the later hard-guard file)',
    (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.guard_profile_terms_columns()'));
END $assert$;

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
VALUES ('20261191_accept_terms_server.sql', '2279414bc73f536a60ae187054348487c8b89dc5ea27ce2684e14fe144875e86')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   verify_schema QUERY 1: the 20261191_accept_terms_server rows must read OK.
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   One BEGIN … COMMIT as postgres (nothing else of this file needs undoing; no table, policy or grant on a table moved):
--     DROP TRIGGER IF EXISTS guard_profile_terms_columns ON public.profiles;
--     DROP FUNCTION IF EXISTS public.guard_profile_terms_columns();
--     DROP FUNCTION IF EXISTS public.accept_terms(text, text);
--     DROP FUNCTION IF EXISTS public.is_terms_locale(text);
--     DROP FUNCTION IF EXISTS public.is_published_terms_version(text);
--     DELETE FROM public.schema_migrations_applied WHERE filename = '20261191_accept_terms_server.sql';
--   Older apps keep working throughout (their direct writes pass the guard, and without it).
