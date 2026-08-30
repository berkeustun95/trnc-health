-- ═══ Tier 1 — admins can actually remove reported content ══════════════════
--
-- `reviews`, `questions` and `answers` each carry FIVE policies and NOT ONE of them is a
-- permissive UPDATE. RLS denies by default, so every admin UPDATE on those tables has
-- been refused outright since the tables existed — and `supabase-js` `.update()` without
-- `.select()` returns `{data: null, error: null}` on zero rows, so the client saw success.
-- A silent no-op, while both Terms copies promise removal within 24 hours of a report.
--
-- ─── REPRODUCED END TO END IN PRODUCTION, 2026-08-30 ────────────────────────
--
-- Not inferred from pg_policies. Driven through the real UI:
--   1. berkeps15@gmail.com (customer) reported review d0342187-bb39-4368-87bd-497463ac6bb6.
--      content_reports fca1b681-8ae0-48de-9d37-8ad6b9f4a9ff created, status = pending.
--   2. Admin pressed Remove in Admin → Reports. The card left the queue. No error shown.
--   3. report status = 'actioned'; reviews.hidden_at = NULL; hidden_reason = NULL.
--   4. And the review was STILL SERVED to a signed-out visitor. Confirmed through the
--      anon REST surface — the actual visitor path, not a postgres query that bypasses
--      RLS and would have answered the wrong question:
--
--        GET /rest/v1/reviews?id=eq.d0342187-…&select=id,comment,hidden_at   (apikey: anon)
--        → 1 row, "Amazing service.", hidden_at: null
--
-- "actioned" meant nothing at all: the report left the queue and the content stayed live.
--
-- ─── WHY A POLICY IS THE WHOLE FIX ──────────────────────────────────────────
--
-- Everything else on the path already works and was checked, not assumed:
--   • guard_moderation_columns() opens with `IF get_my_role() = 'admin' THEN RETURN NEW`
--     — the BEFORE UPDATE trigger already lets admins set hidden_at.
--   • the `no_anon_update_*` policies are RESTRICTIVE `TO authenticated` requiring
--     `NOT is_anonymous_session()`. They AND with anything added here; an admin is
--     authenticated and not anonymous, so they pass.
--   • `public read reviews` already carries `OR get_my_role() = 'admin'`, so an admin can
--     still see a row after hiding it, and the queue does not blank out.
-- The only missing link is a permissive UPDATE. Nothing else in Phase 1.
--
-- ─── FOR UPDATE, NOT FOR ALL ────────────────────────────────────────────────
--
-- Admins already read these tables through the existing SELECT policies, and DELETE stays
-- denied on purpose: 20260712 sets out that moderation soft-hides and never hard-deletes,
-- because the evidence trail is what protects us when a removal is disputed. FOR ALL would
-- quietly hand back the delete this design gave up.
--
-- ⚠ THIS IS STILL A FULL-ROW GRANT, AND THAT IS A REAL WIDENING. Postgres RLS cannot scope
--   a policy to columns, and column GRANTs cannot help either: admin and author are both
--   the `authenticated` Postgres role, so a GRANT cannot tell them apart (20260712 records
--   the same limitation). So from here an admin can edit a customer's review text or
--   rating, not merely hide it. guard_moderation_columns() exempts admins entirely and so
--   will not catch it. Narrowing that belongs to Phase 2's trigger work — flagged here,
--   deliberately not fixed, because Phase 1 is scoped to the three policies.

SET ROLE postgres;
BEGIN;

-- ─── The three policies ──────────────────────────────────────────────────────

DROP POLICY IF EXISTS "admin update reviews" ON public.reviews;
CREATE POLICY "admin update reviews" ON public.reviews
  FOR UPDATE TO authenticated
  USING (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');

DROP POLICY IF EXISTS "admin update questions" ON public.questions;
CREATE POLICY "admin update questions" ON public.questions
  FOR UPDATE TO authenticated
  USING (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');

DROP POLICY IF EXISTS "admin update answers" ON public.answers;
CREATE POLICY "admin update answers" ON public.answers
  FOR UPDATE TO authenticated
  USING (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');

-- ─── Assertions — this migration proves itself or rolls back ─────────────────
--
-- The count is DERIVED and the names are PRINTED. A check phrased as a remembered list
-- goes green when the one thing it names is absent and stays silent about everything it
-- forgot — which is how a fourth SELECT policy sat on `profiles` for six weeks leaking
-- full rows. If a table does not read 6 here, the exception firing is the CORRECT outcome:
-- investigate what the extra or missing policy is, do not bump the number.

DO $$
DECLARE
  v_tbl      text;
  v_count    int;
  v_names    text;
  v_admin    uuid;
  v_review   uuid;
  v_was_at   timestamptz;
  v_was_why  text;
  v_now_at   timestamptz;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY['reviews','questions','answers'] LOOP
    SELECT count(*), string_agg(policyname || ' [' || cmd || ']', ', ' ORDER BY policyname)
      INTO v_count, v_names
      FROM pg_policies WHERE schemaname = 'public' AND tablename = v_tbl;
    RAISE NOTICE '% : % policies — %', rpad(v_tbl, 10), v_count, v_names;
    IF v_count <> 6 THEN
      RAISE EXCEPTION '% has % policies, expected 6 (5 pre-existing + 1 admin UPDATE)', v_tbl, v_count;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname='public' AND tablename=v_tbl
         AND cmd='UPDATE' AND permissive='PERMISSIVE'
    ) THEN
      RAISE EXCEPTION '% still has no PERMISSIVE UPDATE policy', v_tbl;
    END IF;
  END LOOP;

  -- Behavioural half. A policy that exists is not a policy that works — that is the whole
  -- lesson of this file — so the write is driven AS an admin, through RLS and through the
  -- guard trigger, rather than as postgres (which bypasses both and would prove nothing).
  SELECT id INTO v_admin  FROM profiles WHERE role = 'admin' LIMIT 1;
  SELECT id INTO v_review FROM reviews  LIMIT 1;

  IF v_admin IS NULL OR v_review IS NULL THEN
    RAISE NOTICE 'no admin profile or no reviews row — behavioural assertion skipped (the live green run covers it)';
  ELSE
    SELECT hidden_at, hidden_reason INTO v_was_at, v_was_why FROM reviews WHERE id = v_review;

    -- is_anonymous MUST be present and false: is_anonymous_session() feeds the RESTRICTIVE
    -- no_anon_update_reviews policy, and a missing claim could fail the UPDATE for a reason
    -- that has nothing to do with what is being tested — a false red on the whole apply.
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_admin, 'role', 'authenticated', 'is_anonymous', false)::text, true);
    SET LOCAL ROLE authenticated;

    UPDATE reviews SET hidden_at = now(), hidden_reason = 'admin_removed' WHERE id = v_review;

    SET LOCAL ROLE postgres;   -- SET ROLE is checked against the SESSION user, so this returns
    SELECT hidden_at INTO v_now_at FROM reviews WHERE id = v_review;
    IF v_now_at IS NULL THEN
      RAISE EXCEPTION 'an admin UPDATE still did not set hidden_at — the policy is present but not effective';
    END IF;

    -- Restore BOTH, captured not assumed. Writing NULL here would erase a genuine
    -- moderation timestamp if this is ever re-applied after real removals exist.
    UPDATE reviews SET hidden_at = v_was_at, hidden_reason = v_was_why WHERE id = v_review;
    PERFORM set_config('request.jwt.claims', '', true);
    RAISE NOTICE 'behavioural assertion passed as admin % and was rolled back by hand', v_admin;
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
VALUES ('20260927_admin_ugc_update_policies.sql', '7b2cd64f952c7ba1705aeb815bc7a3e0525e3eb790d4053cf725ad4d1539e705')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- No ADD COLUMN, so no PostgREST schema-cache reload is required: the cache holds tables,
-- columns and functions, and a policy change is invisible to it.

-- ─── Verify (run separately, after the COMMIT above) ────────────────────────
--
--   -- 1. six per table, and READ THE NAMES — a count alone cannot tell you that the
--   --    sixth is the one you meant:
--   SELECT tablename, count(*) AS policies,
--          string_agg(policyname || ' [' || cmd || ']', ', ' ORDER BY policyname) AS names
--     FROM pg_policies
--    WHERE schemaname='public' AND tablename IN ('reviews','questions','answers')
--    GROUP BY tablename ORDER BY tablename;
--   -- expect 6 each, including "admin update <table>" [UPDATE]
--
--   -- 2. the permissive UPDATE is really permissive, not restrictive:
--   SELECT tablename, policyname, permissive, roles, qual, with_check
--     FROM pg_policies
--    WHERE schemaname='public' AND cmd='UPDATE' AND permissive='PERMISSIVE'
--      AND tablename IN ('reviews','questions','answers')
--    ORDER BY tablename;
--   -- expect 3 rows, roles {authenticated}, both clauses (get_my_role() = 'admin')
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   DROP POLICY "admin update reviews"   ON public.reviews;
--   DROP POLICY "admin update questions" ON public.questions;
--   DROP POLICY "admin update answers"   ON public.answers;
-- ⚠ Rolling this back re-breaks a commitment published in BOTH terms copies. If admin
--   removal is being withdrawn, the 24-hour sentence has to come out of docs/terms.html
--   and screens/LegalScreen.js in the same change — that is what check-terms-commitment.mjs
--   exists to force.
--   DELETE FROM public.schema_migrations_applied
--    WHERE filename = '20260927_admin_ugc_update_policies.sql';
