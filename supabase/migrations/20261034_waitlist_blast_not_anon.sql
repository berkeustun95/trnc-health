-- ─── 20261034 — anon cannot fire the go-live blast ─────────────────────────
--
-- Two REVOKEs and one re-guarded function. No schema change.
--
-- ─── THE DEFECT ──────────────────────────────────────────────────────────────
--
-- notify_module_waitlist(text) was callable by `anon` — no JWT, no account, nothing but
-- the public key that ships inside the app. Its guard read:
--
--     IF auth.uid() IS NOT NULL AND NOT is_admin() THEN RAISE 'admin only';
--
-- written so that postgres in the SQL editor (auth.uid() NULL) could run it, which is how
-- go-live step 10 works. The `anon` role has auth.uid() NULL for the same reason, so the
-- test matched two callers and only one of them was meant.
--
-- What an anonymous caller could do, for any of the 13 module keys:
--
--     POST /rest/v1/rpc/notify_module_waitlist   {"p_module":"studentHub"}
--
-- and for every module_waitlist row with notified_at IS NULL the function stamps
-- notified_at = now(), inserts a notifications row, and PERFORMs net.http_post to
-- exp.host — a real push to that person's phone.
--
-- ⚠ THE SPAM IS THE LESSER HALF. The stamp is irreversible and it is what the REAL blast
--   reads: a burnt list and an empty list are the same query result at step 10. Somebody
--   would flip a module, run the blast, see 0, and conclude the waitlist had never filled.
--
-- ─── THIS IS PREVENTIVE. IT WAS NEVER FIRED. ────────────────────────────────
--
-- Measured 2026-09-20, before writing this, because "we should fix it" and "we need to
-- tell people it happened" are different files:
--
--     select module,
--            count(*) filter (where notified_at is not null) as notified,
--            count(*) as total,
--            min(notified_at) as first_stamp,
--            max(notified_at) as last_stamp
--     from module_waitlist group by module order by module;
--
--     accommodation  7/7  2026-08-24     events   1/1  2026-08-17
--     explore        2/2  2026-08-26     pets     4/4  2026-08-23
--     studentHub     0/6  (intact)
--     checkins, grooming, homeServices, insurance, jobs, transport — all 0
--
-- Every stamped module is one that was actually launched, each with a single timestamp.
-- No scattered stamps, nothing fired on an unlaunched module, and studentHub — the next
-- one to flip — is unburnt. No user was pushed, no list was consumed, nobody to tell.
--
-- ⚠ RUN THAT QUERY BEFORE BELIEVING ANY WAITLIST COUNT. It is now in the go-live SOP
--   next to the blast, because `notified 0/6` and `notified 6/6` are the two states that
--   matter and step 10's return value cannot distinguish them on its own.
--
-- ─── WHAT IS FIXED, AND WHAT IS ONLY DEFENDED ───────────────────────────────
--
--   THE FIX          REVOKE EXECUTE FROM anon. A role cannot call what it cannot execute.
--                    `authenticated` keeps it and is unaffected: a signed-in non-admin —
--                    including signInAnonymously(), which yields a REAL auth.uid() — hits
--                    `NOT is_admin()` and is refused, as it always was.
--   THE DEFENCE      The guard is rewritten to test current_setting('role') instead of
--                    auth.uid(). That holds even if the grant comes back, which it can:
--                    ALTER DEFAULT PRIVILEGES gave anon EXECUTE on this function without
--                    anybody typing GRANT, and would do it again for a re-created one.
--
-- ─── process_featured_expiring(), SAME SHAPE, LESS BLAST RADIUS ─────────────
--
-- SECURITY DEFINER, no guard of any kind, loops facilities whose featured window is
-- closing and pushes their providers. It is a CRON BODY — 20260809 schedules it with
-- `SELECT process_featured_expiring()` and nothing else calls it, so anon has no business
-- holding EXECUTE. FEATURED_LIVE is false and no facility carries featured_until today,
-- so there is nothing to send: this is closing the door before the room has anything in
-- it, which is the cheap moment to do it.
--
-- ─── WHAT THIS FILE DELIBERATELY DOES NOT TOUCH ─────────────────────────────
--
-- Found in the same sweep of all 62 callable functions. Recorded so the next person does
-- not rediscover them, NOT fixed here, each for a stated reason.
--
--   • may_initiate_by_age(uuid, uuid) — HIGHEST PRIORITY OF THE THREE. SECURITY DEFINER,
--     anon-callable, and it reads profiles.date_of_birth for two arbitrary uuids. Call it
--     with a known-adult sender and any uuid as recipient and the boolean is a clean
--     over-18 bit on that person. On a declared mixed-audience app with 13-15 and 16-17
--     bands, that is a minor-status oracle with no authentication in front of it.
--     NOT fixed here because it is called from an RLS policy and from two other functions
--     (20261029:514, :807), and revoking EXECUTE from a role that evaluates such a policy
--     turns "zero rows" into "permission denied" on whatever path reaches it. That needs
--     its own pass over which tables carry those policies and who reads them — not a line
--     appended to a migration about something else.
--   • is_listed_student(uuid) — same family, smaller leak: a membership oracle for the
--     student list, anon-callable. Also called from an RLS policy (20261029:379).
--   • bump_ad_counter(uuid, text) — genuinely unguarded and genuinely abusable (loop it,
--     inflate any active banner's counts). anon is NOT revoked and that is deliberate:
--     utils/logAdEvent.js:41 documents the grant as load-bearing, because a render landing
--     before anonymous sign-in completes runs as true anon, and that file also says a zero
--     count reads as "nobody looks at the ads". Revoking would break a real path AND close
--     nothing — `authenticated` has the same unguarded access, one tap from cold start.
--     The fix is that the counter must stop being a trusted client increment. Before the
--     ads flag flips, not before this one.
--
-- Everything else in the sweep is either a pure function over its own arguments
-- (search_fold, search_all_tokens, search_token_hits, the *_notif_text helpers), a read
-- scoped to auth.uid() (get_my_role, is_admin, is_customer_blocked, delete_own_account —
-- whose DELETEs all match nothing when auth.uid() is NULL), guarded on a uid-null check
-- (notify_admins returns 0), guarded on is_anonymous_session (create_facility_claim,
-- create_garage_facility, update_garage_facility, the messaging writers), scoped by
-- authorship (notify_facility_owner), or idempotent and harmless (expire_job_postings
-- only expires what has already expired; explore_category_counts counts public rows).

BEGIN;

-- ─── 0. Guards ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.notify_module_waitlist(text)') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: notify_module_waitlist(text) is missing. Nothing applied.';
  END IF;
  IF to_regprocedure('public.process_featured_expiring()') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: process_featured_expiring() is missing. Nothing applied.';
  END IF;
  IF to_regprocedure('public.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: is_admin() is missing — the new guard would be created broken.';
  END IF;
END $$;

-- ─── 1. The function, with the guard that tells the two callers apart ───────
CREATE OR REPLACE FUNCTION public.notify_module_waitlist(p_module text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r     record;
  tok   text;
  plang text;
  ttl   text;
  bdy   text;
  n     integer := 0;
BEGIN
  -- ⚠ THE GUARD THAT LET THE INTERNET IN, AND WHY IT READ AS CORRECT.
  --   It used to be `IF auth.uid() IS NOT NULL AND NOT is_admin()`, with a comment saying
  --   "postgres in the SQL editor (uid null) passes". That is true, and it is also true of
  --   the `anon` role: a request with no JWT has auth.uid() NULL too. The test was written
  --   to describe ONE caller and it matched TWO, one of which is the open internet.
  --
  --   current_setting('role') is what tells them apart. PostgREST does SET ROLE per
  --   request from the validated JWT (or the anon role when there is none), and that GUC
  --   survives SECURITY DEFINER — unlike current_user, which inside this function is the
  --   OWNER and therefore says 'postgres' no matter who called. Measured in PGlite:
  --       as anon           current_user=postgres  role=anon
  --       as authenticated  current_user=postgres  role=authenticated
  --       no SET ROLE       current_user=postgres  role=none
  --
  --   Written as a DENY LIST on purpose. An allow-list of what the SQL editor reports
  --   would be a guess about somebody else's connection string, and being wrong about it
  --   breaks go-live step 10 at the moment it is needed. Denying the two roles PostgREST
  --   can possibly be in cannot break the editor, and the NOTICE below prints the real
  --   value so the next person does not have to guess either.
  --
  --   ⚠ THIS IS DEFENCE IN DEPTH, NOT THE FIX. The fix is the REVOKE below: anon cannot
  --     call what it has no EXECUTE on. This guard is what holds if that grant is ever
  --     restored by a default-privilege change or a careless GRANT ... TO anon.
  IF NOT is_admin()
     AND coalesce(current_setting('role', true), 'none') IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'notify_module_waitlist: admin only (role=%)',
      coalesce(current_setting('role', true), 'none');
  END IF;

  -- Validate against the module keys MODULE_FLAGS declares. The module_waitlist CHECK
  -- itself is only a shape guard (^[a-zA-Z]{2,40}$ since 20260814), so THIS list is the
  -- only thing that rejects a typo'd module name.
  IF p_module NOT IN ('homeServices','grooming','garages','transport',
                      'insurance','pets','events','jobs','accommodation',
                      'explore','studentHub','towing','checkins') THEN
    RAISE EXCEPTION 'notify_module_waitlist: unknown module %', p_module;
  END IF;

  FOR r IN
    SELECT user_id FROM module_waitlist
    WHERE module = p_module AND notified_at IS NULL
  LOOP
    -- Stamp first so a mid-run error / retry never double-notifies this row.
    UPDATE module_waitlist SET notified_at = now()
      WHERE user_id = r.user_id AND module = p_module;

    SELECT push_token, preferred_language INTO tok, plang
      FROM profiles WHERE id = r.user_id;
    ttl := module_notif_text('title', p_module, plang);
    bdy := module_notif_text('body',  p_module, plang);

    INSERT INTO notifications (user_id, title, body) VALUES (r.user_id, ttl, bdy);
    IF tok IS NOT NULL THEN
      PERFORM net.http_post(
        url     := 'https://exp.host/--/api/v2/push/send',
        body    := jsonb_build_object('to', tok, 'title', ttl, 'body', bdy, 'sound', 'default'),
        headers := jsonb_build_object('Content-Type', 'application/json'));
    END IF;

    n := n + 1;
  END LOOP;

  RETURN n;
END;
$function$;

-- ─── 2. The revokes, which are the actual fix ───────────────────────────────
--
-- BOTH LINES PER FUNCTION. Revoking PUBLIC alone is a no-op on Supabase — anon is in the
-- ACL by name, put there by ALTER DEFAULT PRIVILEGES at creation, never via PUBLIC. That
-- is the error 20261033 shipped and its own assertion caught; see the note headed
-- "THE SECOND FIX THAT LOOKED RIGHT" in that file.
--
-- `authenticated` is NOT revoked on notify_module_waitlist: admins hold it, and the
-- is_admin() branch is what lets them through. process_featured_expiring is revoked from
-- authenticated too — it is a cron body, no user of any kind should reach it.
REVOKE ALL ON FUNCTION public.notify_module_waitlist(text)  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_module_waitlist(text)  FROM anon;
GRANT EXECUTE ON FUNCTION public.notify_module_waitlist(text) TO authenticated;

REVOKE ALL ON FUNCTION public.process_featured_expiring()   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_featured_expiring()   FROM anon;
REVOKE ALL ON FUNCTION public.process_featured_expiring()   FROM authenticated;

-- ─── 3. Verification ────────────────────────────────────────────────────────
DO $$
DECLARE
  v_bad  text;
  v_role text := coalesce(current_setting('role', true), 'none');
BEGIN
  -- What the SQL editor actually reports, printed rather than assumed. The new guard is a
  -- DENY list over ('anon','authenticated'); if this line ever says one of those, the
  -- editor is connecting as a PostgREST role and the guard would refuse the blast.
  RAISE NOTICE '  applying as role=% — the new guard denies only anon/authenticated.', v_role;
  IF v_role IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION
      'ABORTING: this session reports role=%, which the new guard denies. Applying would '
      'leave go-live step 10 unable to run the blast. Apply as postgres.', v_role;
  END IF;

  -- The grant, read from the catalog rather than inferred from the statements above.
  SELECT string_agg(format('%s is EXECUTE-able by %s', p.proname, coalesce(r.rolname, 'PUBLIC')),
                    '; ' ORDER BY p.proname)
    INTO v_bad
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN LATERAL aclexplode(p.proacl) a ON TRUE
    LEFT JOIN pg_roles r ON r.oid = a.grantee
   WHERE n.nspname = 'public'
     AND p.proname IN ('notify_module_waitlist', 'process_featured_expiring')
     AND a.privilege_type = 'EXECUTE'
     AND (a.grantee = 0 OR r.rolname = 'anon');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ABORTING: %. The revoke did not take. Nothing applied.', v_bad;
  END IF;

  -- admins must still be able to run the blast.
  IF NOT has_function_privilege('authenticated', 'public.notify_module_waitlist(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ABORTING: authenticated lost EXECUTE on notify_module_waitlist — an admin could not blast.';
  END IF;

  -- and the guard must actually be the new one.
  IF pg_get_functiondef(to_regprocedure('public.notify_module_waitlist(text)'))
       NOT LIKE '%current_setting(''role'', true)%' THEN
    RAISE EXCEPTION 'ABORTING: notify_module_waitlist still carries the auth.uid()-only guard.';
  END IF;

  RAISE NOTICE '20261034 verified: anon cannot execute either function; authenticated keeps the blast.';
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
VALUES ('20261034_waitlist_blast_not_anon.sql', 'fae6b72fffbf3aff51034cb0715dc23329365d82aab05e0087dd0dbc8836c8bf')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

-- No ADD COLUMN, but notify_module_waitlist was replaced and PostgREST caches signatures.
NOTIFY pgrst, 'reload schema';
