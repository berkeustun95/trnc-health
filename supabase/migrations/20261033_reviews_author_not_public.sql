-- ─── 20261033 — an anonymous review stops carrying its author's id ──────────
--
-- One REVOKE, one GRANT, two SECURITY DEFINER read functions.
--
-- ─── THE DEFECT ──────────────────────────────────────────────────────────────
--
-- `reviews` is the only TRULY PUBLIC table in this app that carries a person's uuid.
-- Its read policy is `deleted_at IS NULL AND hidden_at IS NULL AND (auth.uid() IS NULL
-- OR not-blocked)` — no identity required at all — and every row carries customer_id,
-- which anon and authenticated can both SELECT and FILTER on.
--
-- On its own that is a uuid, and a uuid is not a name. What changes at Student Hub
-- go-live is that a uuid becomes resolvable:
--
--     get_student_list()    RETURNS TABLE(user_id uuid, display_name text, …)
--
-- RPCs are not gated by MODULE_FLAGS. So once two people have opted in, any listed
-- student can pull the public review table, pull the student list, join on the uuid,
-- and read off which named person wrote which review. No app screen does this; a
-- hand-written PostgREST query does, and RLS — not the UI — is this app's boundary.
--
-- ─── ⚠ WHY THIS MATTERS MORE THAN "SOMEBODY LEARNS WHO REVIEWED A SHOP" ─────
--
-- These are reviews of DENTISTS, CLINICS, AND PSYCHIATRIC HOSPITALS. `facilities`
-- carries Barış Ruh ve Sinir Hastalıkları Hastanesi and six other state hospitals by
-- name. Attaching a named student to a review of one of them is not a preference leak,
-- it is A HEALTH DISCLOSURE about an identified person — inferred from data they
-- published under the reasonable belief that reviews are anonymous, which they are on
-- every screen that renders them.
--
-- The reviewer never consented to the attribution, never consented to the audience, and
-- would never find out. That is the whole argument for treating this as a go-live
-- blocker rather than a hardening task.
--
-- ─── ⚠ THE FIX THAT LOOKS RIGHT AND CLOSES NOTHING ──────────────────────────
--
-- The obvious statement is:
--
--     REVOKE SELECT (customer_id) ON reviews FROM anon, authenticated;   -- NO EFFECT
--
-- It runs, it reports success, and it changes nothing. Postgres GRANT documentation:
-- "the table-level grant is unaffected by a column-level operation." Supabase hands
-- anon and authenticated TABLE-LEVEL SELECT on every table in `public`, and a
-- table-level grant already implies every column — so revoking one column leaves
-- has_column_privilege('anon','reviews','customer_id','SELECT') TRUE and the REST
-- endpoint still answering 200 with the uuid in it.
--
-- This is the same family as every other "green check that checks nothing" in this
-- repo, and it is the more dangerous member: the mitigation itself is the thing that
-- is broken, so the vector stays open behind a migration that says it was closed.
--
-- THE SHAPE THAT WORKS IS REVOKE-THE-TABLE-THEN-GRANT-THE-COLUMNS, which is exactly
-- what 20260910 already does for contact_events on the INSERT side:
--
--     REVOKE ALL ON public.contact_events FROM anon, authenticated;
--     GRANT INSERT (module, entity_id, action, region) ON public.contact_events TO …;
--
-- created_at is unforgeable there for precisely this reason — it is not in the column
-- list. Same mechanism, different verb.
--
-- ─── THREE CONSEQUENCES, WRITTEN DOWN BECAUSE THEY WILL SURPRISE SOMEBODY ───
--
--   1. A future ADD COLUMN on reviews is INVISIBLE to the client until it is granted.
--      That is default-deny and it is the right direction — but it presents as a 42501
--      on a column that plainly exists, which is not where anyone will look first.
--   2. `select('*')` on reviews now fails permanently. No call site uses it today
--      (checked); a future one fails loudly rather than quietly re-exposing the column.
--   3. The verification below runs BEFORE COMMIT and aborts the whole migration if the
--      policy quals stop working. See section 3 for why that is not paranoia.
--
-- ─── WHAT IS DELIBERATELY NOT FIXED HERE ────────────────────────────────────
--
-- Two narrower exposures of the same SHAPE were found in the same sweep. Neither is
-- acted on; both are recorded so the next person does not have to rediscover them.
--
--   • `read questions` has a PROVIDER arm: a facility owner can read customer_id for
--     every question asked at their own facility. Questions are not publicly readable
--     at all, so this is not the public vector — but a provider who is also a listed
--     student could resolve those uuids the same way. Narrow population, consented
--     contact (they asked that business a question), not closed here.
--   • `places.submitted_by` is a CUSTOMER's uuid on an anon-readable table. Identical
--     shape to reviews. Measured 2026-09-19 through PostgREST as anon: 0 non-null rows
--     visible, so there is nothing to disclose today — but the shape is live, and the
--     first accepted community submission creates the first row.
--
-- The other owner columns on public tables (facilities.provider_id, events.organizer_id,
-- home_services.owner_id, job_postings.owner_id, places.provider_id) identify BUSINESSES,
-- where attribution is the point of the record. They are not this problem.
--
-- ─── SEQUENCING: THE CLIENT SHIPS FIRST, AND THIS IS NOT INTERCHANGEABLE ────
--
-- AdminScreen's moderation queue reads content in ONE batched select per type, and for
-- reviews that select used to include customer_id. After this migration that select
-- 42501s AS A WHOLE — not just the column — so contentByKey would hold no review rows
-- and every review report would render "Content no longer exists — the author likely
-- deleted their account". That string is a LIE an admin acts on by dismissing a real
-- report, and AdminScreen.js already carries a comment warning about exactly it.
--
-- So the OTA carrying the two-sided client MUST land before this is applied. The client
-- tries the RPC and falls back to the column, the same shape as loadBlocks() in 20261032:
-- before the apply the function is absent and the column readable, after it the reverse,
-- and one of the two always works. Applied in the wrong order, the admin queue lies.

BEGIN;

-- ─── 0. Guards ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.reviews') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: public.reviews does not exist. Nothing applied.';
  END IF;
  -- admin_content_author leans on both. If either is missing this is not the database
  -- this file was written against, and the functions below would be created broken.
  IF to_regprocedure('public.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: is_admin() is missing. Nothing applied.';
  END IF;
  IF to_regclass('public.content_reports') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: public.content_reports is missing. Nothing applied.';
  END IF;
  -- The column list in section 1 is EXHAUSTIVE and hand-written, so it has to be checked
  -- against the live table: a column added since this file was written would be silently
  -- left ungranted and vanish from every client read. 9 = the 8 granted + customer_id.
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'reviews') <> 9 THEN
    RAISE EXCEPTION
      'REFUSING: public.reviews has % columns, expected 9. The GRANT list in section 1 is '
      'stale — reconcile it before applying, or a real column becomes unreadable.',
      (SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'reviews');
  END IF;
END $$;

-- ─── 1. The revoke, then the grant ──────────────────────────────────────────
--
-- Order matters and is not stylistic: the REVOKE removes the table-level grant that
-- makes a column-level one meaningless, and the GRANT then re-opens exactly the eight
-- columns the app actually renders. customer_id is the ninth and is not among them.
--
-- PUBLIC is revoked as well. Supabase does not grant reviews to PUBLIC today, but
-- anon and authenticated INHERIT anything PUBLIC holds, so a grant there would defeat
-- both statements below without appearing in either of them.
REVOKE SELECT ON public.reviews FROM anon, authenticated, PUBLIC;

GRANT SELECT (
  id,              -- the row key; ContentReportMenu and the delete path both need it
  facility_id,     -- every read is scoped by it
  rating,          -- rendered, and averaged by App.js across all facilities
  comment,         -- rendered
  created_at,      -- rendered, and the list order
  hidden_at,       -- moderation state, read by the admin queue
  hidden_reason,   -- moderation state, read by the admin queue
  deleted_at       -- soft delete; the author's own read distinguishes it
) ON public.reviews TO anon, authenticated;

-- ─── 2. The two reads the client loses, given back deliberately ─────────────
--
-- Both are SECURITY DEFINER, which is what lets them see a column their caller cannot.
-- Both pin search_path: a DEFINER function with a mutable search_path is a privilege-
-- escalation surface, and these two run as the table owner.

-- (a) THE AUTHOR'S OWN REVIEW.
--
-- FacilityProfileScreen switches its composer to a read-only card when the viewer has
-- already reviewed this facility. It used to find that row with
-- `.eq('customer_id', session.user.id)` — and Postgres requires SELECT privilege on any
-- column read in a WHERE clause, not only on one that is projected, so the revoke above
-- breaks the FILTER as surely as it breaks the SELECT. That is the point (it is what
-- stops an attacker asking "give me the reviews written by THIS uuid"), and it is why
-- this function has to exist.
--
-- NO is_anonymous_session() GUARD, unlike get_student_list / get_student_profile, and the
-- absence is deliberate rather than forgotten: those return OTHER people's data and the
-- guest guard is a privacy control there. This returns the caller's OWN row and nothing
-- else, so for a guest the honest answer is simply zero rows. Raising instead would make
-- every guest's visit to a facility page produce an error the screen has to swallow.
CREATE OR REPLACE FUNCTION public.get_my_review(p_facility_id uuid)
 RETURNS TABLE(id uuid, rating smallint, comment text)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT r.id, r.rating, r.comment
    FROM reviews r
   WHERE r.facility_id = p_facility_id
     AND r.customer_id = v_me
     AND r.deleted_at IS NULL;
END;
$function$;

-- (b) THE AUTHOR OF REPORTED CONTENT, FOR MODERATION ONLY.
--
-- AdminScreen needs the author uuid to write profiles.ugc_banned_until and to notify
-- them. Admins hold the `authenticated` role like everybody else, so the revoke above
-- takes the column from them too — there is no way to grant it to admins at the column
-- level, and a DEFINER function is the only place the distinction can live.
--
-- is_admin() is the ONLY gate, and that is a deliberate choice rather than an oversight.
-- The messages policy in 20261029 additionally requires a pending content_reports row,
-- because a private message must not be readable merely because an admin wants to read
-- it. Reviews are the opposite: they are world-readable already, so scoping this to a
-- report would buy nothing and would break the admin's ability to act on content they
-- found any other way.
--
-- Every type is handled, not just 'review'. The five whose author columns are still
-- directly readable cost one line each and mean the next table to get this treatment
-- needs no second function — but the client only routes 'review' through here today,
-- because changing a working moderation path further than necessary is its own risk.
CREATE OR REPLACE FUNCTION public.admin_content_author(
  p_content_type text,
  p_content_id   uuid
)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_author uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'ADMIN_ONLY';
  END IF;

  CASE p_content_type
    WHEN 'review'   THEN SELECT customer_id  INTO v_author FROM reviews    WHERE id = p_content_id;
    WHEN 'question' THEN SELECT customer_id  INTO v_author FROM questions  WHERE id = p_content_id;
    WHEN 'answer'   THEN SELECT provider_id  INTO v_author FROM answers    WHERE id = p_content_id;
    WHEN 'facility' THEN SELECT provider_id  INTO v_author FROM facilities WHERE id = p_content_id;
    WHEN 'place'    THEN SELECT submitted_by INTO v_author FROM places     WHERE id = p_content_id;
    WHEN 'profile'  THEN SELECT id           INTO v_author FROM profiles   WHERE id = p_content_id;
    -- messages.sender_id is ON DELETE SET NULL, so a deleted author yields NULL here and
    -- AdminScreen's confirmBan already refuses on a null author. Not an error.
    WHEN 'message'  THEN SELECT sender_id    INTO v_author FROM messages   WHERE id = p_content_id;
    ELSE RAISE EXCEPTION 'UNSUPPORTED_CONTENT_TYPE: %', p_content_type;
  END CASE;

  RETURN v_author;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_review(uuid)              FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_content_author(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_review(uuid)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_content_author(text, uuid) TO authenticated;

-- ─── 3. VERIFICATION — and the assertion that can abort this migration ──────
--
-- ⚠ THE OPEN QUESTION THIS BLOCK EXISTS TO SETTLE.
--
-- The `public read reviews` policy references reviews.customer_id in three places
-- (the blocks subquery, the author arm, and the admin arm). If a policy's qual were
-- subject to the INVOKING role's column privileges, then revoking customer_id would
-- make EVERY read of reviews fail with 42501 — for every user, signed in or not, on
-- the facility page and in the app's rating averages.
--
-- The expectation is that it does not: a policy expression is a stored tree spliced in
-- as a security qual, and its Vars never pass through the parser's privilege marking.
-- But "the expectation is" is not evidence, and the cost of being wrong is the whole
-- reviews surface dying in production. So it is MEASURED here, as the roles PostgREST
-- actually uses, against the real policy — and if the expectation is wrong the
-- transaction aborts and nothing applies.
--
-- This works on an EMPTY TABLE, which matters because prod currently has zero live
-- reviews: column privileges are checked at executor start from the range-table entry,
-- not per row, so `count(customer_id)` raises whether or not anything would be returned.
--
-- ⚠ THE TWO ROLES ARE TESTED IN DIFFERENT STATES, AND THE DIFFERENCE IS NOT COSMETIC.
--
-- `anon` is tested with NO jwt claims, because that is the only state it ever occurs in:
-- a signed-out visitor has auth.uid() NULL, which short-circuits the policy's blocks
-- subquery. Handing `anon` a fabricated `sub` would force that subquery to run as a role
-- that never runs it in production, and a permission failure there would abort this
-- migration over a state that cannot happen. (The app's "anonymous" sessions are not this
-- role — signInAnonymously() yields a real JWT and the `authenticated` role.)
--
-- `authenticated` IS given a sub, because that is its only real state, and it is what
-- makes the blocks subquery actually execute. The uuid belongs to nobody on purpose.
-- The claim is set AFTER the anon pass so the anon pass cannot see it.
DO $$
DECLARE
  v_reads_ok  boolean;
  v_blocked   boolean;
  v_role      text;
BEGIN
  FOR v_role IN SELECT unnest(ARRAY['anon', 'authenticated']) LOOP
    EXECUTE format('SET LOCAL ROLE %I', v_role);

    IF v_role = 'authenticated' THEN
      PERFORM set_config('request.jwt.claims',
                         '{"sub":"00000000-0000-4000-8000-0000000000aa","role":"authenticated"}',
                         true);
    END IF;

    -- (1) THE POLICY QUALS MUST STILL WORK.
    --     Valid on an empty table: column privileges are checked at executor start from
    --     the range-table entry, so if quals were privilege-checked this would raise with
    --     zero rows just as it would with a million.
    BEGIN
      PERFORM count(*) FROM public.reviews;
      v_reads_ok := true;
    EXCEPTION WHEN insufficient_privilege THEN
      v_reads_ok := false;
    END;

    -- (2) …AND customer_id MUST NOT BE REACHABLE.
    BEGIN
      PERFORM count(customer_id) FROM public.reviews;
      v_blocked := false;
    EXCEPTION WHEN insufficient_privilege THEN
      v_blocked := true;
    END;

    -- RESET before raising: the messages below run as postgres, and so does the ledger
    -- INSERT at the end of this transaction.
    RESET ROLE;

    IF NOT v_reads_ok THEN
      RAISE EXCEPTION
        'ABORTING as %: reading reviews now fails. RLS policy quals ARE column-privilege '
        'checked against the invoker, so this whole approach is wrong and the public '
        'review list would have broken in production. Nothing applied.', v_role;
    END IF;

    IF NOT v_blocked THEN
      RAISE EXCEPTION
        'ABORTING as %: reviews.customer_id is STILL readable after the revoke. Most '
        'likely a surviving table-level or PUBLIC grant — the exact failure this file '
        'documents. Nothing applied.', v_role;
    END IF;

    RAISE NOTICE '  % : reviews readable, customer_id denied.', v_role;
  END LOOP;

  -- The privilege catalog, read directly rather than inferred from the statements above.
  IF has_column_privilege('anon', 'public.reviews', 'customer_id', 'SELECT')
     OR has_column_privilege('authenticated', 'public.reviews', 'customer_id', 'SELECT') THEN
    RAISE EXCEPTION 'ABORTING: has_column_privilege still reports customer_id as SELECTable.';
  END IF;

  -- 8 columns x 2 roles. DERIVED, never a list of the eight names: if a future ADD COLUMN
  -- is granted this reads 18 and somebody has to look, which a name list never forces.
  IF (SELECT count(*) FROM information_schema.column_privileges
       WHERE table_schema = 'public' AND table_name = 'reviews'
         AND privilege_type = 'SELECT' AND grantee IN ('anon', 'authenticated')) <> 16 THEN
    RAISE EXCEPTION 'ABORTING: expected 16 column SELECT grants (8 columns x 2 roles), found %.',
      (SELECT count(*) FROM information_schema.column_privileges
        WHERE table_schema = 'public' AND table_name = 'reviews'
          AND privilege_type = 'SELECT' AND grantee IN ('anon', 'authenticated'));
  END IF;

  -- Both functions exist, are DEFINER, and have a pinned search_path.
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('get_my_review', 'admin_content_author')
         AND p.prosecdef
         AND p.proconfig::text ILIKE '%search_path=public%') <> 2 THEN
    RAISE EXCEPTION 'ABORTING: the two new functions are not both DEFINER with a pinned search_path.';
  END IF;

  -- admin_content_author must be gated. A DEFINER function that reads any author uuid and
  -- forgets is_admin() is a deanonymiser with a friendly name — strictly worse than the
  -- column this migration just took away, because it would resolve EVERY content type.
  IF pg_get_functiondef(to_regprocedure('public.admin_content_author(text,uuid)'))
       NOT LIKE '%is_admin()%' THEN
    RAISE EXCEPTION 'ABORTING: admin_content_author is not gated on is_admin().';
  END IF;

  -- Neither function may be callable by anon. `authenticated` includes anonymous sessions
  -- in Supabase, so this is not the whole guard — it is the half that a stray GRANT breaks.
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             LEFT JOIN LATERAL aclexplode(p.proacl) a ON TRUE
             LEFT JOIN pg_roles r ON r.oid = a.grantee
             WHERE n.nspname = 'public'
               AND p.proname IN ('get_my_review', 'admin_content_author')
               AND a.privilege_type = 'EXECUTE'
               AND (a.grantee = 0 OR r.rolname = 'anon')) THEN
    RAISE EXCEPTION 'ABORTING: one of the new functions is EXECUTE-able by anon or PUBLIC.';
  END IF;

  RAISE NOTICE '20261033 verified: reviews readable without customer_id, both roles; 2 DEFINER reads in place.';
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
VALUES ('20261033_reviews_author_not_public.sql', '01ffcd249b0bd612649f307943eb90ead399375e55053a9a41761cef7fb54f76')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

-- No ADD COLUMN here, but the GRANT changes what PostgREST is allowed to project and it
-- caches privileges alongside the schema. Without this reload the API keeps answering
-- from the old picture — which on THIS migration means it keeps serving customer_id.
NOTIFY pgrst, 'reload schema';
