-- ═══════════════════════════════════════════════════════════════════════════
-- Reviews decoupled from appointments — STEP 1 OF 2. APPLY AND VERIFY ALONE.
--
-- ▶ THE ONE LINE THAT MATTERS IS SECTION 2:
--     ALTER TABLE reviews DROP CONSTRAINT reviews_appointment_id_fkey;
--
--   reviews.appointment_id is NOT NULL and its FK is ON DELETE CASCADE
--   (20260718_capture_1:87,94). Until that constraint is gone, ANY delete of an
--   appointment row silently deletes the review attached to it — no error, no
--   warning, no row count anybody would notice. 20261004 deletes every
--   appointment. If these two files are applied in the wrong order, or merged,
--   the reviews go with them.
--
--   That is the entire reason this is a separate migration. Do not merge it
--   into 20261004 "since they're both small".
--
-- ─── WHAT THIS FILE DOES NOT DO ─────────────────────────────────────────────
--
-- It does NOT drop reviews.appointment_id. The column stays, nullable, until
-- 20261004 has removed the appointments table. That keeps this migration
-- independently revertible and gives 20261004 nothing to race with.
--
-- ─── WHY DECOUPLING SURRENDERS LESS THAN IT LOOKS LIKE ──────────────────────
--
-- The INSERT policy being replaced below is, in full:
--     "customers insert own reviews" FOR INSERT WITH CHECK (customer_id = auth.uid())
-- There was never an appointment check in it. The link to a visit was held only
-- by NOT NULL + the FK + a unique index, and the policy never verified the
-- appointment was YOURS — only that it existed and was unused. So "proof of
-- visit" was a schema artefact that read as an authorisation guarantee for
-- months and never was one. Verified against pg_policies, not this file.
--
-- ─── WHAT IS INHERITED, AND THEREFORE NOT REBUILT HERE ──────────────────────
--
-- Confirmed against pg_policies / pg_get_functiondef on the live database
-- (2026-08-31), NOT read off migration files — that distinction was wrong twice
-- on 2026-08-30 and both times the file was the thing that lied:
--   • "public read reviews" already carries the blocks subquery, deleted_at IS
--     NULL and hidden_at IS NULL, with author and admin bypass arms.
--   • check_ugc_on_insert raises UGC_BANNED on profiles.ugc_banned_until, runs
--     the blocked-term filter, AND nulls hidden_at/hidden_reason for non-admins
--     so nobody can create content that arrives pre-hidden.
-- Opening reviews up therefore does NOT open them to banned users, to blocked
-- authors' readers, or to pre-hidden content. Asserted in section 6, not
-- assumed.
--
-- ─── RATE LIMITING: DELIBERATELY NONE ───────────────────────────────────────
--
-- reviews_customer_facility_live_uniq (20260928) already bounds a customer to
-- ONE LIVE review per facility, and is partial on deleted_at IS NULL so
-- delete-and-rewrite still works. That bounds total volume by facility count,
-- which is the real abuse ceiling. A time-window throttle would only slow a
-- determined actor while adding a table nobody reads. If volume ever becomes a
-- problem, the index tells us where. Decided 2026-08-31; do not add one
-- without revisiting this paragraph.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. PRE-FLIGHT — the RED. Prove the probe can see the hazard. ───────────
-- Printed, not asserted, so the file stays re-runnable. On a first apply this
-- reports the CASCADE FK present; on a re-apply it reports it already gone.
-- If it reports NEITHER state, the probe is looking at the wrong object and
-- nothing below should be trusted.
DO $$
DECLARE
  v_fk       text;
  v_del      char;
  v_notnull  boolean;
  v_reviews  bigint;
BEGIN
  SELECT c.conname, c.confdeltype INTO v_fk, v_del
    FROM pg_constraint c
   WHERE c.conname = 'reviews_appointment_id_fkey';

  SELECT (a.attnotnull) INTO v_notnull
    FROM pg_attribute a
   WHERE a.attrelid = 'public.reviews'::regclass
     AND a.attname  = 'appointment_id' AND NOT a.attisdropped;

  SELECT count(*) INTO v_reviews FROM public.reviews;

  RAISE NOTICE '── BEFORE ────────────────────────────────────────────────';
  IF v_fk IS NULL THEN
    RAISE NOTICE '  reviews_appointment_id_fkey : ALREADY ABSENT (re-apply)';
  ELSE
    RAISE NOTICE '  reviews_appointment_id_fkey : PRESENT, on-delete=%  %',
      v_del,
      CASE WHEN v_del = 'c'
           THEN '<-- CASCADE. This is the hazard this file removes.'
           ELSE '<-- NOT cascade; expected c. Investigate before proceeding.' END;
  END IF;
  RAISE NOTICE '  appointment_id NOT NULL     : %', coalesce(v_notnull::text, '(column absent)');
  RAISE NOTICE '  reviews that would be destroyed by an appointments delete today: %', v_reviews;
  RAISE NOTICE '──────────────────────────────────────────────────────────';
END $$;

-- ─── 2. THE LOAD-BEARING LINE ──────────────────────────────────────────────
ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_appointment_id_fkey;

-- ─── 3. Retire 20260929's index ────────────────────────────────────────────
-- reviews_appointment_live_uniq is a partial unique on (appointment_id) WHERE
-- deleted_at IS NULL. Its column is going in 20261004, so it is retired here
-- rather than left to be dropped implicitly with the column — an index that
-- disappears as a side effect is an index nobody registered a decision about.
-- Its H-token in verify_schema.sql is RETIRED in the same commit, not bumped:
-- one fact, one owner (the 0927/0928 lesson).
DROP INDEX IF EXISTS public.reviews_appointment_live_uniq;

-- ─── 4. The column becomes optional ────────────────────────────────────────
-- NOT dropped. See the header.
ALTER TABLE public.reviews ALTER COLUMN appointment_id DROP NOT NULL;

-- ─── 5. The INSERT policy gains the check it never had ─────────────────────
-- Replaces WITH CHECK (customer_id = auth.uid()) with the same rule plus a
-- facility-liveness requirement.
--
-- The facility clause is the ONE thing this migration ADDS. Without it, now
-- that any facility is reviewable, reviews accumulate on rows users cannot see
-- and admins did not publish: status='draft' (the Girne duplicate 91338177,
-- parked deliberately), status='suspended', and anything hidden by moderation.
-- A review on an invisible facility is unreachable, unmoderatable through the
-- normal surface, and still counts toward that facility's rating the moment it
-- is ever published.
--
-- Anonymous sessions stay excluded by the existing RESTRICTIVE policy
-- no_anon_insert_reviews; nothing here weakens it, and a RESTRICTIVE policy
-- ANDs with this one regardless.
DROP POLICY IF EXISTS "customers insert own reviews" ON public.reviews;
CREATE POLICY "customers insert own reviews" ON public.reviews
  FOR INSERT TO public
  WITH CHECK (
    customer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.facilities f
       WHERE f.id = facility_id
         AND f.status = 'active'
         AND f.hidden_at IS NULL
    )
  );

-- ─── 6. VERIFICATION — the GREEN ───────────────────────────────────────────
-- Asserted against pg_constraint / pg_indexes / pg_policies / pg_trigger, never
-- against this file. IS DISTINCT FROM throughout: `<>` yields NULL on a NULL
-- operand and `IF NULL THEN` does not fire, so a `<>` assertion passes on
-- exactly the broken state it exists to catch.
DO $$
DECLARE
  v_policies int;
  v_def      text;
  v_enabled  char;
  v_indexdef text;
BEGIN
  -- (a) the hazard is gone
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reviews_appointment_id_fkey') THEN
    RAISE EXCEPTION 'FAIL: reviews_appointment_id_fkey still exists — 20261004 would CASCADE-delete reviews';
  END IF;

  -- (b) column nullable, and STILL PRESENT (dropping it here would be wrong)
  IF (SELECT a.attnotnull FROM pg_attribute a
       WHERE a.attrelid='public.reviews'::regclass AND a.attname='appointment_id'
         AND NOT a.attisdropped) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FAIL: reviews.appointment_id is not nullable (or is gone — it must survive until 20261004)';
  END IF;

  -- (c) the surviving uniqueness rule is present AND PARTIAL. A plain unique
  --     index passes an existence check while permanently barring anyone who
  --     deletes a review from ever reviewing that facility again.
  SELECT indexdef INTO v_indexdef FROM pg_indexes
   WHERE schemaname='public' AND indexname='reviews_customer_facility_live_uniq';
  IF v_indexdef IS NULL THEN
    RAISE EXCEPTION 'FAIL: reviews_customer_facility_live_uniq is missing — nothing bounds review volume';
  END IF;
  IF v_indexdef NOT ILIKE '%deleted_at IS NULL%' THEN
    RAISE EXCEPTION 'FAIL: reviews_customer_facility_live_uniq is not partial: %', v_indexdef;
  END IF;

  -- (d) 20260929's index is gone
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
              AND indexname='reviews_appointment_live_uniq') THEN
    RAISE EXCEPTION 'FAIL: reviews_appointment_live_uniq still exists';
  END IF;

  -- (e) DERIVED policy count, not a name list. 7 before, 7 after — this file
  --     REPLACES a policy, it does not add one. A different number means
  --     something else moved and must be looked at, not bumped.
  SELECT count(*) INTO v_policies FROM pg_policies
   WHERE schemaname='public' AND tablename='reviews';
  IF v_policies IS DISTINCT FROM 7 THEN
    RAISE EXCEPTION 'FAIL: reviews has % policies, expected 7', v_policies;
  END IF;

  -- (f) the new policy really carries the facility clause
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='reviews'
       AND policyname='customers insert own reviews'
       AND with_check ILIKE '%active%' AND with_check ILIKE '%hidden_at%'
  ) THEN
    RAISE EXCEPTION 'FAIL: the INSERT policy does not gate on facility liveness';
  END IF;

  -- (g) THE CONTENT FILTER STILL FIRES, AND STILL SCANS THE RIGHT COLUMN.
  --     check_ugc_on_insert picks its column from TG_ARGV[0]; a trigger recreated
  --     without 'comment' would scan NOTHING and silently pass every blocked term,
  --     while still existing under the right name — invisible to section D of
  --     verify_schema.sql, which only checks that a trigger of that name exists.
  --
  --     ⚠ READ IT VIA pg_get_triggerdef, NOT pg_trigger.tgargs.
  --     The first version of this assertion did `position('comment' in tgargs::text)`
  --     and FAILED on a completely correct trigger, aborting the migration. tgargs is
  --     BYTEA holding null-terminated arguments, so ::text renders the hex literal
  --     \x636f6d6d656e7400 — which is 'comment' plus a \x00 terminator, and can never
  --     contain the plain substring 'comment'. The check and the checked value were in
  --     different encodings.
  --
  --     pg_get_triggerdef renders the canonical SQL instead, so there is no encoding
  --     step to get wrong — the same form a human reads and the same form the trigger
  --     was confirmed in originally. Decoding the bytea (encode(...,'escape') then
  --     stripping the terminator) was the alternative and was rejected: it adds more
  --     encoding handling in precisely the layer that just failed.
  --
  --     Anchored on the whole call, not the bare word, so a future WHEN clause that
  --     mentions a column named `comment` cannot satisfy it. LIKE, not ILIKE: 'Comment'
  --     is a DIFFERENT TG_ARGV value and must fail.
  SELECT pg_get_triggerdef(t.oid), t.tgenabled INTO v_def, v_enabled
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.reviews'::regclass
     AND t.tgname  = 'check_review_content' AND NOT t.tgisinternal;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'FAIL: check_review_content is missing from reviews — the blocked-term filter is off';
  END IF;
  -- The raw value goes in the message ON PURPOSE. The bytea version of this assertion
  -- was wrong, and it was diagnosable in seconds only because it printed what it had
  -- actually read. An assertion that fails without showing its input is a dead end.
  IF v_def NOT LIKE '%check_ugc_on_insert(''comment'')%' THEN
    RAISE EXCEPTION 'FAIL: check_review_content does not pass ''comment'' — it would scan nothing. def=%', v_def;
  END IF;
  IF v_enabled IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION 'FAIL: check_review_content is not enabled (tgenabled=%)', v_enabled;
  END IF;

  RAISE NOTICE '── AFTER ─────────────────────────────────────────────────';
  RAISE NOTICE '  FK gone · appointment_id nullable · live-uniq partial · 7 policies';
  RAISE NOTICE '  INSERT gates on facility liveness · check_review_content(comment) enabled';
  RAISE NOTICE '──────────────────────────────────────────────────────────';
END $$;

-- ─── 7. LIVE BEHAVIOUR — writes nothing ────────────────────────────────────
-- Sections 1-6 assert SHAPE. This asserts BEHAVIOUR, because a policy can be
-- present and still not do what its text suggests.
--
-- Each attempt runs in a subtransaction that is FORCED to roll back by raising
-- a sentinel after a successful insert, so no row survives either outcome.
--
-- ⚠ RESET ROLE before any count. Never verify a write from inside the role that
--   is not allowed to read it — a count pinned to 0 by RLS looks identical to a
--   write that never happened.
DO $$
DECLARE
  v_cust     uuid;
  v_live     uuid;
  v_dead     uuid;
  v_ok_live  boolean := false;
  v_ok_dead  boolean := false;
  v_err      text;
  v_leftover bigint;
BEGIN
  -- An active, unhidden facility this customer has NOT already reviewed, so a
  -- failure cannot be blamed on reviews_customer_facility_live_uniq.
  SELECT p.id INTO v_cust FROM public.profiles p
   WHERE p.role = 'customer' ORDER BY p.id LIMIT 1;

  SELECT f.id INTO v_live FROM public.facilities f
   WHERE f.status = 'active' AND f.hidden_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.reviews r
                      WHERE r.facility_id = f.id AND r.customer_id = v_cust
                        AND r.deleted_at IS NULL)
   ORDER BY f.id LIMIT 1;

  SELECT f.id INTO v_dead FROM public.facilities f
   WHERE (f.status <> 'active' OR f.hidden_at IS NOT NULL)
   ORDER BY f.id LIMIT 1;

  IF v_cust IS NULL OR v_live IS NULL THEN
    RAISE NOTICE 'SKIP live probe: no customer (%) or no eligible active facility (%)', v_cust, v_live;
    RETURN;
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cust)::text, true);
  SET LOCAL role authenticated;

  -- (a) MUST SUCCEED: a review with NO appointment_id. This is the whole point.
  BEGIN
    INSERT INTO public.reviews (customer_id, facility_id, appointment_id, rating, comment)
    VALUES (v_cust, v_live, NULL, 5, 'zz decouple probe');
    RAISE EXCEPTION 'ROLLBACK_PROBE_OK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ROLLBACK_PROBE_OK' THEN v_ok_live := true;
    ELSE v_ok_live := false; v_err := SQLERRM; END IF;
  END;

  -- (b) MUST FAIL: the same review on a non-live facility.
  IF v_dead IS NOT NULL THEN
    BEGIN
      INSERT INTO public.reviews (customer_id, facility_id, appointment_id, rating, comment)
      VALUES (v_cust, v_dead, NULL, 5, 'zz decouple probe (should be refused)');
      v_ok_dead := true;                      -- got in: the gate does NOT work
      RAISE EXCEPTION 'ROLLBACK_PROBE_LEAK';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM = 'ROLLBACK_PROBE_LEAK' THEN v_ok_dead := true; ELSE v_ok_dead := false; END IF;
    END;
  END IF;

  RESET ROLE;                                  -- ← before any count, always
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF NOT v_ok_live THEN
    RAISE EXCEPTION 'FAIL: a review with appointment_id NULL was REFUSED: %', v_err;
  END IF;
  IF v_ok_dead THEN
    RAISE EXCEPTION 'FAIL: a review was accepted on a non-live facility — the liveness gate does not bite';
  END IF;

  -- Counted as postgres, after RESET ROLE. Belt and braces: both inserts were
  -- rolled back, so this must be 0 regardless.
  SELECT count(*) INTO v_leftover FROM public.reviews WHERE comment LIKE 'zz decouple probe%';
  IF v_leftover IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FAIL: % probe row(s) survived — they must not', v_leftover;
  END IF;

  RAISE NOTICE '  live probe: appointment-less review ACCEPTED on an active facility,';
  RAISE NOTICE '              REFUSED on a non-live one, 0 rows left behind.';
END $$;

COMMIT;

-- ─── AFTER APPLYING ────────────────────────────────────────────────────────
--   1. Every NOTICE above should read as described; any EXCEPTION aborts the
--      whole file and nothing is applied.
--   2. Run supabase/verify_schema.sql — QUERY 1's first row must say ALL n PASS.
--   3. ONLY THEN apply 20261004_appointments_removal.sql.
--
-- Reverting this file (before 20261004 runs) restores the old shape:
--   ALTER TABLE public.reviews ALTER COLUMN appointment_id SET NOT NULL;
--   ALTER TABLE public.reviews ADD CONSTRAINT reviews_appointment_id_fkey
--     FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE;
--   CREATE UNIQUE INDEX reviews_appointment_live_uniq ON public.reviews (appointment_id)
--     WHERE deleted_at IS NULL;
--   DROP POLICY "customers insert own reviews" ON public.reviews;
--   CREATE POLICY "customers insert own reviews" ON public.reviews
--     FOR INSERT TO public WITH CHECK (customer_id = auth.uid());
-- After 20261004 there is nothing to point the FK at and this is one-way.
