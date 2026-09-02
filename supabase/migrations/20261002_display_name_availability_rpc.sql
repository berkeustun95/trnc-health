-- ═══ display_name availability — the ONE new RPC, and why it has to exist ═══
--
-- ─── THE PROOF THAT NO CLIENT-SIDE FORM OF THIS CHECK EXISTS ────────────────
--
-- profiles has EXACTLY THREE SELECT policies — owner read / admin read all / admin read
-- profiles — and verify_schema.sql asserts that count (the 20260922 token, added after
-- the 20260821 drop shipped a comment naming three when there were four). None of them
-- lets a customer see another customer's row.
--
-- So a client-side
--     supabase.from('profiles').select('id').eq('display_name', x)
-- returns ZERO ROWS FOR EVERY INPUT, taken or not. It would report "available ✓" for
-- every name already in the database and then collide with 23505 on submit — inside a
-- mandatory gate, on the step users are most likely to abandon on. A probe pinned to one
-- answer regardless of the truth is the failure class CLAUDE.md exists to prevent:
-- *before trusting a probe, ask what it would return if the thing under test were
-- PERFECT. If the answer is the same, it is not a probe.*
--
-- ─── THE ALTERNATIVES, AND WHY THEY ARE WORSE ───────────────────────────────
--
-- • A SELECT policy exposing other users' display_name. That is the exact class of
--   over-share 20260821 and 20260922 each REMOVED, and it would take the derived
--   count(*) = 3 token red — correctly.
-- • A public display_names mirror table with USING (true). Strictly worse: a DUMPABLE
--   LIST of every name in the app. This function is not dumpable — you must already
--   have guessed a name to learn anything about it.
--
-- ─── WHAT IT REVEALS, HONESTLY ──────────────────────────────────────────────
--
-- Whether a name is in use. display_name renders publicly on every review the moment its
-- owner posts one, so that is already knowable by reading the app. What it never reveals
-- is WHO holds a name, and it cannot be walked to produce the set.
--
-- ─── NOT RATE LIMITED, DELIBERATELY ─────────────────────────────────────────
--
-- A counter needs a write, which forces the function VOLATILE and adds a table of
-- per-user request timestamps — i.e. it would CREATE a privacy surface in order to
-- protect one that is already public. The trade is the wrong way round.
--
-- ⚠ `authenticated` INCLUDES ANONYMOUS SESSIONS in Supabase. The GRANT below does not
--   exclude guests; the in-body is_anonymous_session() guard is what does, and it is
--   mandatory rather than belt-and-braces. The assertion at the bottom proves the guard
--   is really in the installed body by calling the function from a role that has no
--   auth.uid() at all and requiring it to raise.

SET ROLE postgres;
BEGIN;

CREATE OR REPLACE FUNCTION public.display_name_available(p_name text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_norm  text;
  v_base  text;
  v_taken boolean;
  v_sugg  text[];
BEGIN
  IF auth.uid() IS NULL OR is_anonymous_session() THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 3 AND 20 THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  v_norm := normalize_display_name(p_name);
  IF v_norm IS NULL THEN
    -- Nothing left after normalization: the name was made entirely of invisible
    -- characters. Reported as invalid rather than available, because storing it would
    -- opt the row out of the unique index.
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  -- Order matters for the COPY the user sees: a reserved name is not an obscenity and
  -- must not be told it is one. Blocked first only because a name that is both is more
  -- honestly described as blocked.
  IF contains_blocked_term(p_name) THEN
    RETURN jsonb_build_object('status', 'blocked');
  END IF;
  IF is_reserved_display_name(v_norm) THEN
    RETURN jsonb_build_object('status', 'reserved');
  END IF;

  -- `id <> auth.uid()` so re-submitting YOUR OWN current name is not reported as taken.
  -- Without it, a user editing their profile later is told their own name is unavailable.
  SELECT EXISTS (SELECT 1 FROM profiles
                  WHERE display_name_normalized = v_norm
                    AND id <> auth.uid())
    INTO v_taken;

  IF NOT v_taken THEN
    RETURN jsonb_build_object('status', 'available');
  END IF;

  -- ─── Suggestions, in the SAME call ──────────────────────────────────────
  -- A debounced keystroke burst is then ONE round trip, not four. A collision
  -- discovered on submit inside a mandatory gate is the main risk of making this field
  -- unique, and "taken" with nothing to tap is barely better.
  --
  -- DETERMINISTIC (1, 2, 3 … not random) for two reasons: random() would make the
  -- STABLE declaration a lie, and a list that reshuffles while the user is looking at it
  -- is worse than no list. Two users racing get the same suggestion; the unique index
  -- catches that, and the client re-asks.
  v_base := left(btrim(p_name), 18);
  SELECT array_agg(c ORDER BY ord) INTO v_sugg FROM (
    SELECT v_base || g::text AS c, g AS ord
      FROM generate_series(1, 99) g
     WHERE char_length(v_base || g::text) BETWEEN 3 AND 20
       AND NOT EXISTS (SELECT 1 FROM profiles p
                        WHERE p.display_name_normalized
                              = normalize_display_name(v_base || g::text))
       AND NOT is_reserved_display_name(normalize_display_name(v_base || g::text))
     ORDER BY g
     LIMIT 3
  ) s;

  RETURN jsonb_build_object('status', 'taken',
                            'suggestions', to_jsonb(coalesce(v_sugg, '{}'::text[])));
END;
$function$;

REVOKE ALL ON FUNCTION public.display_name_available(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.display_name_available(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.display_name_available(text) TO authenticated;

-- ─── Assertions ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_res jsonb;
  v_ok  boolean := false;
BEGIN
  -- This block runs as postgres, where auth.uid() is NULL — so the guard MUST fire.
  -- That is the test: if the call returns a status instead of raising, the guard is not
  -- in the installed body and every guest session can call this.
  BEGIN
    v_res := display_name_available('ZZUnlikelyProbeName');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'AUTH_REQUIRED' THEN v_ok := true; ELSE RAISE; END IF;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'the AUTH_REQUIRED guard did NOT fire (returned %) — anonymous '
                    'sessions can call this RPC', v_res;
  END IF;

  -- And that anon holds no EXECUTE. aclexplode, not has_function_privilege(): the
  -- latter RAISES on a function that does not exist, and this has to be reportable
  -- rather than fatal on a database where the paste was truncated.
  IF EXISTS (SELECT 1 FROM pg_proc p
               JOIN pg_namespace n ON n.oid = p.pronamespace
               LEFT JOIN LATERAL aclexplode(p.proacl) a ON TRUE
               LEFT JOIN pg_roles r ON r.oid = a.grantee
              WHERE n.nspname = 'public' AND p.proname = 'display_name_available'
                AND a.privilege_type = 'EXECUTE'
                AND (a.grantee = 0 OR r.rolname = 'anon')) THEN
    RAISE EXCEPTION 'display_name_available is EXECUTE-able by anon or PUBLIC';
  END IF;

  RAISE NOTICE 'display_name_available OK — auth guard fires, anon has no EXECUTE';
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
VALUES ('20261002_display_name_availability_rpc.sql', '2fd15ce7bc48777128cfbcbb5cede8b39f6428413ef28fef9be5b647c3718dad')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- No ADD COLUMN here, but PostgREST enumerates FUNCTIONS into the same cache, so without
-- this the new RPC can be missing from the API surface until the next unrelated reload.
NOTIFY pgrst, 'reload schema';

-- ─── Verify (run separately, after the COMMIT above) ────────────────────────
--
--   -- 1. the signature and the guard, read from the DATABASE not this file:
--   SELECT pg_get_function_arguments(p.oid) AS args,
--          pg_get_functiondef(p.oid) ILIKE '%is_anonymous_session%' AS guards_guests,
--          p.provolatile, p.prosecdef
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public' AND p.proname='display_name_available';
--   -- expect: args = p_name text · guards_guests = t · provolatile = s · prosecdef = t
--
--   -- 2. who can call it:
--   SELECT r.rolname, a.privilege_type
--     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
--          LATERAL aclexplode(p.proacl) a LEFT JOIN pg_roles r ON r.oid=a.grantee
--    WHERE n.nspname='public' AND p.proname='display_name_available';
--   -- expect authenticated EXECUTE and postgres; NO anon, NO PUBLIC (grantee 0)
--
--   -- 3. and the fact the whole justification rests on, re-read rather than remembered:
--   SELECT policyname, qual FROM pg_policies
--    WHERE schemaname='public' AND tablename='profiles' AND cmd='SELECT'
--    ORDER BY policyname;
--   -- expect exactly 3: admin read all · admin read profiles · owner read.
--   -- If a fourth has appeared, re-read it before trusting anything above.
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   DROP FUNCTION public.display_name_available(text);
--   NOTIFY pgrst, 'reload schema';
-- ⚠ Slice 2's Step 1 loses its inline availability check without this. The unique index
--   still holds — the failure moves from "told before submit" to "23505 on submit".
--   DELETE FROM public.schema_migrations_applied
--    WHERE filename = '20261002_display_name_availability_rpc.sql';
