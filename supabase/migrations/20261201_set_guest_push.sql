-- ═══════════════════════════════════════════════════════════════════════════
-- 20261201 — set_guest_push: a guest can save its own phone's push token and app language
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Onboarding v2 (slice S1, backend only) asks a GUEST for notifications. A guest is an anonymous
-- Supabase session; it has a real profiles row but cannot write it (the RESTRICTIVE policy
-- no_anon_update_profiles refuses every guest UPDATE). This one function is the only door, and it
-- opens onto two columns of one row.
--
-- ─── WHO CAN DO WHAT ────────────────────────────────────────────────────────
--   • A GUEST (signed in anonymously) can set or clear the push token, and set the app language,
--     on ITS OWN profiles row and nothing else: the row is always auth.uid(), never a parameter.
--   • A signed-up user is refused by the function body (they already save their token the
--     normal way, through their own row's update policy). EXECUTE is granted to `authenticated`
--     because that role includes every guest; the body is what refuses non-guests.
--   • No session (anon), PUBLIC and service_role cannot EXECUTE it at all.
--   • Nobody can read anything through it: it returns nothing.
--   • The token must look like an Expo push token, 10 to 64 characters inside the brackets (or be
--     NULL, which clears it). The cap exists because an oversized token on any row can fail a whole
--     Expo batch: send-duty-notification's sendBatch counts a refused request as every message in
--     it failed. The language must
--     be one of the nine FULL English names in constants/i18n.js LANGUAGES, never an ISO code.
--     profiles.preferred_language itself has no CHECK (repo files; 20260818 made it nullable), so
--     the list lives here and matches contact_events_lang_check (20261112).
--
-- ─── TRIGGERS (read in the repo files, not the live catalogs) ───────────────
-- The four BEFORE UPDATE triggers on profiles do not block a push_token + preferred_language-only
-- update. check_profile_name_content (latest body 20261016) raises only when full_name or
-- display_name changes, when age_ineligible goes from true to false, or on UNDERAGE; its resident,
-- terms and consent arms never raise and carry the stored values forward. guard_profile_ban raises
-- only when ugc_banned_until changes; guard_checkin_notice_columns and
-- guard_marketplace_notice_columns only when their notice columns change. The one unguarded raise
-- is UNDERAGE, which fires on ANY update of a row that already stores an under-13 date of birth;
-- a guest has no date of birth, so it does not reach guests in practice.
--
-- ─── PURGE: guest tokens must not outlive the guest (Berke) ─────────────────
-- The token lives on the guest's profiles row. That row goes when the auth user goes, because
-- profiles.id references auth.users(id) ON DELETE CASCADE (repo: 20260718_capture_1 line 31).
-- The file does not trust that line: it reads the foreign key from pg_constraint at apply time
-- and refuses unless it is there and cascades.
-- What the cascade guarantees: a DELETED guest takes its token along. What it does not: nothing
-- deletes guests on a schedule. Guests are deleted only by the one-off migrations 20261162 and
-- 20261200 and by delete_own_account. A guest row abandoned by sign-in / sign-out therefore keeps
-- its token until the app slice clears it with set_guest_push(NULL, lang) before a guest session
-- ends. A guest retention policy is a separate decision, not made here.
--
-- No counts, ids or e-mails anywhere: supabase-migrate prints this file to public Actions logs.
--
-- Apply: supabase-migrate (dry), then apply=true after Berke's go. New RPC => ends with NOTIFY pgrst.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.set_guest_push(p_token text, p_lang text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_rows int;
BEGIN
  -- IS NOT TRUE, so a NULL answer refuses too.
  IF public.is_anonymous_session() IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'guest_only';
  END IF;
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'no_session';
  END IF;
  IF p_token IS NOT NULL AND p_token !~ '^ExponentPushToken\[[A-Za-z0-9_-]{10,64}\]$' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'bad_token';
  END IF;
  IF p_lang IS NULL
     OR p_lang <> ALL (ARRAY['English','Turkish','Arabic','Russian','Greek','French','Spanish','German','Persian']) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'bad_lang';
  END IF;

  UPDATE public.profiles SET push_token = p_token, preferred_language = p_lang WHERE id = auth.uid();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'no_profile';
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.set_guest_push(text, text) IS
  'Guest-only: sets (or clears, with NULL) the push token and sets the app language (full English name) '
  'on the caller''s own profiles row. Signed-up users are refused. 20261201.';

REVOKE ALL ON FUNCTION public.set_guest_push(text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_guest_push(text, text) TO authenticated;

-- ─── Assertions. Each derives what it checks and prints what it read. ───────
DO $$
DECLARE
  v_fn      regprocedure := to_regprocedure('public.set_guest_push(text,text)');
  v_prof    regclass := to_regclass('public.profiles');
  v_users   regclass := to_regclass('auth.users');
  v_n       int;
  v_cfg     text;
  v_acl     text;
  v_owner   oid;
  v_ok      boolean;
  v_fks     text;
BEGIN
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'set_guest_push(text,text) is not visible to this DO block. Nothing committed.';
  END IF;
  SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'set_guest_push';
  IF v_n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'set_guest_push must have exactly one overload; found %', v_n;
  END IF;

  SELECT array_to_string(proconfig, ','), proowner, coalesce(proacl::text, '(null = PUBLIC can execute)')
    INTO v_cfg, v_owner, v_acl FROM pg_proc WHERE oid = v_fn;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = v_fn) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'set_guest_push is not SECURITY DEFINER — a guest could not write its own row';
  END IF;
  IF v_cfg IS DISTINCT FROM 'search_path=""' THEN
    RAISE EXCEPTION 'set_guest_push must pin search_path to empty; proconfig is %', coalesce(v_cfg, '(none)');
  END IF;

  -- EXECUTE, both directions. A NULL proacl means the default ACL, i.e. PUBLIC can execute.
  IF (SELECT proacl FROM pg_proc WHERE oid = v_fn) IS NULL
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = v_fn AND a.grantee = 0) THEN
    RAISE EXCEPTION 'PUBLIC can EXECUTE set_guest_push; proacl is %', v_acl;
  END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can EXECUTE set_guest_push; proacl is %', v_acl;
  END IF;
  IF has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role can EXECUTE set_guest_push; proacl is %', v_acl;
  END IF;
  -- POSITIVE CONTROL: without it the three denials above pass on a function nobody can call.
  IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot EXECUTE set_guest_push — every guest call would fail; proacl is %', v_acl;
  END IF;

  -- The function writes profiles as its owner. Guests are refused by no_anon_update_profiles, so the
  -- owner must get past RLS: superuser, BYPASSRLS, or owner of profiles without FORCE ROW LEVEL SECURITY.
  IF v_prof IS NULL THEN
    RAISE EXCEPTION 'public.profiles is not visible to this DO block';
  END IF;
  SELECT r.rolsuper OR r.rolbypassrls
         OR (c.relowner = v_owner AND NOT c.relforcerowsecurity)
    INTO v_ok
    FROM pg_roles r, pg_class c WHERE r.oid = v_owner AND c.oid = v_prof;
  IF v_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'set_guest_push''s owner % cannot get past RLS on profiles — every guest call would update 0 rows', pg_get_userbyid(v_owner);
  END IF;

  -- PURGE GUARD. Found by shape (profiles.id -> auth.users.id, foreign key), not by name.
  IF v_users IS NULL THEN
    RAISE EXCEPTION 'auth.users is not visible to this DO block';
  END IF;
  SELECT count(*), coalesce(string_agg(c.conname || ' (on delete ' || c.confdeltype::text || ')', ', ' ORDER BY c.conname), '(none)')
    INTO v_n, v_fks
    FROM pg_constraint c
   WHERE c.contype = 'f' AND c.conrelid = v_prof AND c.confrelid = v_users
     AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = v_prof AND attname = 'id' AND NOT attisdropped)]::smallint[]
     AND c.confkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = v_users AND attname = 'id' AND NOT attisdropped)]::smallint[];
  IF v_n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'expected exactly one foreign key profiles(id) -> auth.users(id); found: %', v_fks;
  END IF;
  IF v_fks NOT LIKE '%(on delete c)' THEN
    RAISE EXCEPTION 'the foreign key profiles(id) -> auth.users(id) does not cascade (%): a deleted guest''s push token would outlive it', v_fks;
  END IF;
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
VALUES ('20261201_set_guest_push.sql', 'b21cf99afdd39f77909a3701296fab983722fbcf0c736758adf35d91d04825e9')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

NOTIFY pgrst, 'reload schema';
