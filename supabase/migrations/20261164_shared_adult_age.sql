-- ═══════════════════════════════════════════════════════════════════════════
-- 20261164 — one home for the adult age: private.is_adult_on(dob, today); messaging switched to it
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Araçlar (car listings) needs "the poster is 18+" on the server. The only SQL copy of ADULT_AGE that
-- constants/profileGate.js pins is inside may_initiate_by_age(sender, recipient), which answers a
-- question about a PAIR and cannot be reused for one person. Instead of a third copy of `18`, the rule
-- moves into one pure helper and messaging calls it (Berke, 2026-11-07: "move the age rule into one
-- shared database function and switch the messaging check to it").
--
--   private.is_adult_on(p_dob date, p_today date) → boolean
--     true  = the 18th birthday is on or before p_today
--     false = younger, OR either argument is NULL (fail closed: an unknown age is never "adult")
--     IMMUTABLE (the caller passes "today"), no table access, not callable by any client role.
--
-- ─── MESSAGING BEHAVIOUR IS UNCHANGED — PROVEN HERE, NOT CLAIMED ─────────────
-- may_initiate_by_age keeps its 20261036 body except three edits: the v_cutoff declaration goes, and
-- the two comparisons call the helper with current_date (the same "today" as before):
--     v_sender > v_cutoff            ⇔  NOT private.is_adult_on(v_sender, current_date)      (v_sender NOT NULL)
--     v_recipient <= v_cutoff        ⇔  private.is_adult_on(v_recipient, current_date)       (v_recipient NOT NULL)
-- The guest/no-uid guard, the fail-closed `RETURN false` ending, SECURITY DEFINER, search_path and the
-- ACL (CREATE OR REPLACE keeps it, incl. 20261081's supabase_read_only_user grant; asserted equal) are untouched.
-- The DO blocks:
--   (1) REFUSE unless the live body is byte-for-byte 20261036's (md5 of prosrc), so this file can never
--       revert a change made after it was written;
--   (2) prove the new body is the old one with exactly the three edits (undo them → same md5);
--   (3) run the old body (as a pg_temp copy) and the new one side by side over a sample of real
--       profiles, every ordered pair, as a real non-guest session: zero disagreements allowed;
--   (4) pin the helper's boundaries (18th birthday today, one day short, Feb 29, NULLs).
-- Nothing printed is a user id or a user count.
--
-- ─── NOT MOVED (flagged to Berke, out of this slice) ────────────────────────
-- eatery_order_age_gate() (20261125) and the check-ins default (20261092) carry their own 18 already.
-- They keep it; switching them is a separate change with its own tests.
--
-- Apply: part of the Araçlar S1 release run (one approval):
--   gh workflow run supabase-migrate -f files="20261164_shared_adult_age.sql 20261165_vehicles.sql 20261166_vehicles_moderation.sql 20261167_cars_waitlist_notify.sql"
-- No table shape change ⇒ no NOTIFY pgrst.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- (1) The live body must be exactly 20261036's.
DO $$
DECLARE
  v_fn regprocedure := to_regprocedure('public.may_initiate_by_age(uuid,uuid)');
BEGIN
  IF v_fn IS NULL THEN RAISE EXCEPTION 'REFUSING: may_initiate_by_age(uuid,uuid) does not exist. Nothing applied.'; END IF;
  IF to_regnamespace('private') IS NULL THEN RAISE EXCEPTION 'REFUSING: schema private is missing (20261068). Nothing applied.'; END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_fn) IS DISTINCT FROM '4ba8dd5b6f6fb8410870084a27ad8d8b' THEN
    RAISE EXCEPTION 'REFUSING: may_initiate_by_age is not the 20261036 body (md5 %). Rebuild this file from the live definition. Nothing applied.',
      (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_fn);
  END IF;
  -- Keep the ACL, to prove CREATE OR REPLACE left it alone, and the old body for the side-by-side run in (3).
  PERFORM set_config('mig1164.acl', coalesce((SELECT proacl::text FROM pg_proc WHERE oid = v_fn), '<default>'), true);
  EXECUTE format('CREATE FUNCTION pg_temp.may_initiate_by_age_20261036(p_sender uuid, p_recipient uuid) RETURNS boolean '
                 'LANGUAGE plpgsql STABLE SET search_path TO ''public'' AS %L',
                 (SELECT prosrc FROM pg_proc WHERE oid = v_fn));
END $$;

CREATE OR REPLACE FUNCTION private.is_adult_on(p_dob date, p_today date)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT p_dob IS NOT NULL AND p_today IS NOT NULL
     AND p_dob <= (p_today - interval '18 years')::date  -- ADULT_AGE
$function$;

ALTER FUNCTION private.is_adult_on(date, date) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.is_adult_on(date, date) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION private.is_adult_on(date, date) IS
  'The one SQL home of ADULT_AGE (constants/profileGate.js): true when the 18th birthday is on or before p_today; false when younger or either argument is NULL (fail closed). Pure. Used by may_initiate_by_age and the vehicles listing guard. No client EXECUTE. 20261164.';

CREATE OR REPLACE FUNCTION public.may_initiate_by_age(p_sender uuid, p_recipient uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sender    date;
  v_recipient date;
BEGIN
  -- ⚠ TWO CLAUSES, AND THE SECOND ONE IS 20261036. Without it a guest — one tap from a
  --   cold start, no credentials — gets a minor/adult bit on any uuid they name. The
  --   first clause alone reads like "a real user is asking"; in this app it only means
  --   "a session exists", and signInAnonymously() makes one.
  IF auth.uid() IS NULL OR is_anonymous_session() THEN
    RETURN false;
  END IF;

  SELECT date_of_birth INTO v_sender    FROM profiles WHERE id = p_sender;
  SELECT date_of_birth INTO v_recipient FROM profiles WHERE id = p_recipient;

  -- The age itself lives in private.is_adult_on() (ADULT_AGE, 20261164).
  IF v_sender IS NOT NULL AND NOT private.is_adult_on(v_sender, current_date) THEN
    RETURN true;   -- the sender is a known minor
  END IF;
  IF v_recipient IS NOT NULL AND private.is_adult_on(v_recipient, current_date) THEN
    RETURN true;   -- the recipient is a known adult
  END IF;

  RETURN false;
END;
$function$;

DO $$
DECLARE
  v_fn     regprocedure := to_regprocedure('public.may_initiate_by_age(uuid,uuid)');
  v_helper regprocedure := to_regprocedure('private.is_adult_on(date,date)');
  v_new    text;
  v_back   text;
  v_ids    uuid[];
  v_caller uuid;
  v_bad    int := 0;
  v_pairs  int := 0;
  a uuid; b uuid;
  d date := date '2026-11-07';
BEGIN
  -- (2) Exactly the three edits. Undo them and the old md5 must come back.
  SELECT prosrc INTO v_new FROM pg_proc WHERE oid = v_fn;
  v_back := replace(v_new, $q$
  v_recipient date;
BEGIN
$q$, $q$
  v_recipient date;
  v_cutoff    date := (current_date - interval '18 years')::date;  -- ADULT_AGE
BEGIN
$q$);
  v_back := replace(v_back, $q$  -- The age itself lives in private.is_adult_on() (ADULT_AGE, 20261164).
  IF v_sender IS NOT NULL AND NOT private.is_adult_on(v_sender, current_date) THEN$q$,
                            $q$  -- Born AFTER the cutoff = younger than 18 = a minor.
  IF v_sender IS NOT NULL AND v_sender > v_cutoff THEN$q$);
  v_back := replace(v_back, $q$IF v_recipient IS NOT NULL AND private.is_adult_on(v_recipient, current_date) THEN$q$,
                            $q$IF v_recipient IS NOT NULL AND v_recipient <= v_cutoff THEN$q$);
  IF md5(v_back) IS DISTINCT FROM '4ba8dd5b6f6fb8410870084a27ad8d8b' THEN
    RAISE EXCEPTION 'may_initiate_by_age differs from 20261036 by more than the three age edits';
  END IF;

  -- Security posture unchanged.
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_fn) THEN RAISE EXCEPTION 'may_initiate_by_age lost SECURITY DEFINER'; END IF;
  IF (SELECT proconfig::text FROM pg_proc WHERE oid = v_fn) NOT ILIKE '%search_path=public%' THEN
    RAISE EXCEPTION 'may_initiate_by_age lost search_path=public';
  END IF;
  IF coalesce((SELECT proacl::text FROM pg_proc WHERE oid = v_fn), '<default>') IS DISTINCT FROM current_setting('mig1164.acl') THEN
    RAISE EXCEPTION 'may_initiate_by_age ACL changed: % → %', current_setting('mig1164.acl'), (SELECT proacl::text FROM pg_proc WHERE oid = v_fn);
  END IF;

  -- The helper: no client may call it, postgres can, and nothing in public carries the literal any more
  -- except the two functions that are knowingly out of scope (eatery_order_age_gate, the check-ins default).
  IF has_function_privilege('anon', v_helper, 'EXECUTE') OR has_function_privilege('authenticated', v_helper, 'EXECUTE') THEN
    RAISE EXCEPTION 'a client role can EXECUTE private.is_adult_on';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x WHERE p.oid = v_helper AND x.grantee = 0) THEN
    RAISE EXCEPTION 'PUBLIC holds EXECUTE on private.is_adult_on';
  END IF;
  IF (SELECT provolatile FROM pg_proc WHERE oid = v_helper) IS DISTINCT FROM 'i' THEN RAISE EXCEPTION 'private.is_adult_on is not IMMUTABLE'; END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = v_fn) LIKE '%18 years%' THEN RAISE EXCEPTION 'may_initiate_by_age still carries its own 18'; END IF;

  -- (4) Boundaries, with today pinned.
  IF private.is_adult_on(date '2008-11-07', d) IS DISTINCT FROM true  THEN RAISE EXCEPTION 'the 18th birthday itself is not adult'; END IF;
  IF private.is_adult_on(date '2008-11-08', d) IS DISTINCT FROM false THEN RAISE EXCEPTION 'one day short of 18 counts as adult'; END IF;
  IF private.is_adult_on(date '1980-01-01', d) IS DISTINCT FROM true  THEN RAISE EXCEPTION 'positive control: a 46-year-old is not adult'; END IF;
  IF private.is_adult_on(date '2010-01-01', d) IS DISTINCT FROM false THEN RAISE EXCEPTION 'a 16-year-old counts as adult'; END IF;
  IF private.is_adult_on(NULL, d)              IS DISTINCT FROM false THEN RAISE EXCEPTION 'a NULL date of birth is not false'; END IF;
  IF private.is_adult_on(date '1980-01-01', NULL) IS DISTINCT FROM false THEN RAISE EXCEPTION 'a NULL today is not false'; END IF;
  IF private.is_adult_on(date '2008-02-29', date '2026-02-28') IS DISTINCT FROM false THEN RAISE EXCEPTION 'Feb 29 birth is adult on Feb 28'; END IF;
  IF private.is_adult_on(date '2008-02-29', date '2026-03-01') IS DISTINCT FROM true  THEN RAISE EXCEPTION 'Feb 29 birth is not adult on Mar 1'; END IF;

  -- (3) Old vs new on real data, as a real (non-guest) session. Sample: up to 40 profiles with a date of
  -- birth (both sides of 18 when they exist) plus up to 5 without; every ordered pair, both functions.
  SELECT array_agg(id) INTO v_ids FROM (
    (SELECT id FROM profiles WHERE date_of_birth IS NOT NULL AND private.is_adult_on(date_of_birth, current_date) ORDER BY id LIMIT 20)
    UNION ALL
    (SELECT id FROM profiles WHERE date_of_birth IS NOT NULL AND NOT private.is_adult_on(date_of_birth, current_date) ORDER BY id LIMIT 20)
    UNION ALL
    (SELECT id FROM profiles WHERE date_of_birth IS NULL ORDER BY id LIMIT 5)
  ) s;
  IF coalesce(array_length(v_ids, 1), 0) < 2 THEN
    RAISE NOTICE 'side-by-side SKIPPED: fewer than 2 profiles to pair (structure and boundaries asserted above)';
  ELSE
    v_caller := v_ids[1];
    PERFORM set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_caller), true);
    IF is_anonymous_session() OR auth.uid() IS DISTINCT FROM v_caller THEN
      RAISE EXCEPTION 'the probe session did not read as a real non-guest caller; the comparison would prove nothing';
    END IF;
    FOREACH a IN ARRAY v_ids LOOP
      FOREACH b IN ARRAY v_ids LOOP
        v_pairs := v_pairs + 1;
        IF public.may_initiate_by_age(a, b) IS DISTINCT FROM pg_temp.may_initiate_by_age_20261036(a, b) THEN
          v_bad := v_bad + 1;
        END IF;
      END LOOP;
    END LOOP;
    -- Guest: both refuse.
    PERFORM set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated","is_anonymous":true}', v_caller), true);
    IF public.may_initiate_by_age(v_caller, v_caller) IS DISTINCT FROM false THEN v_bad := v_bad + 1; END IF;
    PERFORM set_config('request.jwt.claims', '', true);
    IF v_bad > 0 THEN RAISE EXCEPTION 'may_initiate_by_age: % disagreement(s) between the 20261036 body and the new one', v_bad; END IF;
    RAISE NOTICE 'side-by-side: 0 disagreements (sample capped at 45 profiles; size not printed)';
  END IF;

  DROP FUNCTION pg_temp.may_initiate_by_age_20261036(uuid, uuid);
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
VALUES ('20261164_shared_adult_age.sql', '9293a3de69b2eb43748d74d3be4fae4df6c37a4d1a8addd496c9622619744b8f')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   verify_schema QUERY 1: the 20261164_shared_adult_age rows and the 1029 may_initiate_by_age token must read OK.
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   Re-run the CREATE OR REPLACE of may_initiate_by_age from 20261036, then
--   DROP FUNCTION private.is_adult_on(date, date); (and delete its schema_migrations_applied row)
