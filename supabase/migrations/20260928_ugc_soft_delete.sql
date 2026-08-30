-- ═══ Soft delete for reviews and questions ═════════════════════════════════
--
-- Authors have never been able to remove their own review or question. There is no
-- DELETE affordance and there never was a permissive UPDATE policy, so the only route
-- was to ask an admin — who, until 20260927, could not do it either.
--
-- Soft, not hard, for the reason 20260712 already sets out for moderation: the row is
-- the evidence trail if a removal is ever disputed. `deleted_at` mirrors `hidden_at`;
-- the two are independent, and admins keep seeing both.
--
-- ─── THE COMPOSITION TRAP THIS FILE HAD TO AVOID ────────────────────────────
--
-- The obvious guard — "a non-admin may change deleted_at and NOTHING else" — silently
-- breaks reporting. `auto_hide_reported_content()` (20260712:360) fires AFTER INSERT on
-- content_reports and UPDATEs reviews/questions/answers to set hidden_at once three
-- distinct users have reported a row. It is SECURITY DEFINER, but `get_my_role()` reads
-- the JWT of the CALLER — a customer. So that UPDATE arrives at this trigger as a
-- non-admin write touching hidden_at, and a naive guard would RAISE.
--
-- And the failure would not look like a moderation bug. The trigger is AFTER INSERT on
-- content_reports, so the exception aborts THE REPORT ITSELF: the third person to report
-- a piece of content would get an error and their report would never be recorded. The
-- auto-hide threshold would become unreachable, quietly.
--
-- Hence the division of labour below. `guard_moderation_columns` already owns hidden_at
-- and hidden_reason and has precise rules for them (admin, or the 3-reporter auto-hide,
-- and nothing else). This trigger therefore IGNORES those two columns entirely and
-- adjudicates only `deleted_at`. Both fire BEFORE UPDATE and both must pass; name order
-- puts `guard_*_moderation` first, but neither depends on running first.

SET ROLE postgres;
BEGIN;

-- ─── 1. The column ───────────────────────────────────────────────────────────
ALTER TABLE public.reviews   ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- ─── 2. The guard ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_owner_soft_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  -- Columns this trigger must NOT classify on, removed from BOTH sides BEFORE the
  -- comparison decides what kind of update this is. Stripping AFTER classifying would
  -- read a legitimate soft delete as an edit, because deleted_at itself has moved — the
  -- classification would be answering a question about its own side effect.
  --
  --   • deleted_at            — the column under adjudication; checked separately below.
  --   • hidden_at/hidden_reason — owned by guard_moderation_columns. Leaving them in
  --     would break the 3-reporter auto-hide, and with it every third report.
  --
  -- Complete as of 20260928: reviews and questions carry no updated_at and no other
  -- machine-written column (20260718_capture_1:83 and :102 are the full definitions).
  -- Anything added later that a DEFAULT or a trigger writes must be added here in the
  -- same commit, or the first soft delete after it lands starts failing as an "edit".
  k_ignored text[] := ARRAY['deleted_at', 'hidden_at', 'hidden_reason'];
BEGIN
  IF get_my_role() = 'admin' THEN
    RETURN NEW;
  END IF;

  IF (to_jsonb(OLD) - k_ignored) IS DISTINCT FROM (to_jsonb(NEW) - k_ignored) THEN
    RAISE EXCEPTION 'OWNER_MAY_ONLY_SOFT_DELETE';
  END IF;

  -- Only adjudicate deleted_at when it actually moved, so the auto-hide UPDATE (which
  -- touches hidden_at alone) passes straight through.
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
     AND NOT (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
    -- One-way. There is no un-delete affordance, and resurrecting a row would collide
    -- with the partial unique indexes below if the author has since written a new review.
    RAISE EXCEPTION 'SOFT_DELETE_IS_ONE_WAY';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_review_soft_delete ON public.reviews;
CREATE TRIGGER guard_review_soft_delete
  BEFORE UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.guard_owner_soft_delete();

DROP TRIGGER IF EXISTS guard_question_soft_delete ON public.questions;
CREATE TRIGGER guard_question_soft_delete
  BEFORE UPDATE ON public.questions
  FOR EACH ROW EXECUTE FUNCTION public.guard_owner_soft_delete();

-- ─── 3. The owner UPDATE policies ────────────────────────────────────────────
-- The policy grants a full-row UPDATE to the author; the trigger above narrows it to
-- "set deleted_at once, change nothing else". Net effect: authors may soft-delete and
-- may NOT edit — which is not a regression, because they could never edit before.
DROP POLICY IF EXISTS "owner soft delete reviews" ON public.reviews;
CREATE POLICY "owner soft delete reviews" ON public.reviews
  FOR UPDATE TO authenticated
  USING (customer_id = auth.uid())
  WITH CHECK (customer_id = auth.uid());

DROP POLICY IF EXISTS "owner soft delete questions" ON public.questions;
CREATE POLICY "owner soft delete questions" ON public.questions
  FOR UPDATE TO authenticated
  USING (customer_id = auth.uid())
  WITH CHECK (customer_id = auth.uid());

-- ─── 4. Read policies — a deleted row is gone, including for its author ──────
-- The author arm keeps `deleted_at IS NULL`: they asked for it to go, so it goes. The
-- admin arm keeps seeing everything, which is the evidence trail.
-- Otherwise these are the previous bodies verbatim (capture_5:708 and :663).
DROP POLICY IF EXISTS "public read reviews" ON public.reviews;
CREATE POLICY "public read reviews" ON public.reviews
  FOR SELECT TO public
  USING (
    (deleted_at IS NULL AND hidden_at IS NULL
      AND (auth.uid() IS NULL
           OR NOT EXISTS (SELECT 1 FROM blocks b
                           WHERE b.blocker_id = auth.uid()
                             AND b.blocked_id = reviews.customer_id)))
    OR (deleted_at IS NULL AND customer_id = auth.uid())
    OR get_my_role() = 'admin'
  );

DROP POLICY IF EXISTS "read questions" ON public.questions;
CREATE POLICY "read questions" ON public.questions
  FOR SELECT TO public
  USING (
    (deleted_at IS NULL AND hidden_at IS NULL
      AND (customer_id = auth.uid()
           OR (get_my_role() = 'provider'
               AND EXISTS (SELECT 1 FROM facilities f
                            WHERE f.id = questions.facility_id
                              AND f.provider_id = auth.uid()))))
    OR (deleted_at IS NULL AND customer_id = auth.uid())
    OR get_my_role() = 'admin'
  );

-- ─── 5. The unique constraint becomes a PARTIAL unique index ─────────────────
-- reviews_customer_facility_unique (20260701:51) is a CONSTRAINT, and a constraint
-- cannot be partial — so it must be dropped and replaced by an index, not altered.
-- Dropping the constraint drops its backing index with it.
--
-- Without this, deleting a review permanently bars that customer from ever reviewing
-- that facility again: the soft-deleted row still occupies the unique slot. The delete
-- affordance would create a trap disguised as a feature.
ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_customer_facility_unique;
CREATE UNIQUE INDEX IF NOT EXISTS reviews_customer_facility_live_uniq
  ON public.reviews (customer_id, facility_id)
  WHERE deleted_at IS NULL;

-- ─── 6. Assertions ───────────────────────────────────────────────────────────
DO $$
DECLARE
  v_tbl text;
  v_cnt int;
  v_names text;
BEGIN
  -- Policy counts move 6 -> 7 on reviews and questions (20260927 took them 5 -> 6);
  -- answers is untouched here and stays at 6. Bumped in the same commit that causes the
  -- change, with the reason stated — which is the review moment a name list never creates.
  FOREACH v_tbl IN ARRAY ARRAY['reviews','questions','answers'] LOOP
    SELECT count(*), string_agg(policyname || ' [' || cmd || ']', ', ' ORDER BY policyname)
      INTO v_cnt, v_names
      FROM pg_policies WHERE schemaname='public' AND tablename=v_tbl;
    RAISE NOTICE '% : % policies — %', rpad(v_tbl,10), v_cnt, v_names;
  END LOOP;

  IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='reviews')   <> 7
  OR (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='questions') <> 7
  OR (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='answers')   <> 6 THEN
    RAISE EXCEPTION 'policy counts are not 7/7/6 — investigate the difference, do not bump the number';
  END IF;

  -- The index must exist AND be partial. A plain unique index would satisfy an existence
  -- check while re-breaking re-reviews for every customer who ever deletes one.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='public' AND indexname='reviews_customer_facility_live_uniq'
                    AND indexdef ILIKE '%deleted_at IS NULL%') THEN
    RAISE EXCEPTION 'reviews_customer_facility_live_uniq is missing or is not partial';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='reviews_customer_facility_unique') THEN
    RAISE EXCEPTION 'the old non-partial constraint is still present';
  END IF;

  RAISE NOTICE 'soft delete OK';
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
VALUES ('20260928_ugc_soft_delete.sql', '23a9cace46d7e7bae843132067621b5ca0056640bd12c9dd0ba3b44588e3c20a')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- ADD COLUMN, so this is MANDATORY: without it PostgREST serves a stale schema cache and
-- reports 42703 "column deleted_at does not exist" while the column plainly exists.
NOTIFY pgrst, 'reload schema';

-- ─── Verify (run separately, after the COMMIT above) ────────────────────────
--   SELECT tablename, count(*) FROM pg_policies WHERE schemaname='public'
--    AND tablename IN ('reviews','questions','answers') GROUP BY 1 ORDER BY 1;   -- 7/7/6
--   SELECT indexname, indexdef FROM pg_indexes
--    WHERE schemaname='public' AND tablename='reviews';   -- partial, WHERE deleted_at IS NULL
--
--   -- the composition test that matters, as a REPORTER (not as postgres):
--   -- report a 3rd time on some content and confirm the report row is created AND the
--   -- content auto-hides. If guard_owner_soft_delete were wrong, the report INSERT itself
--   -- would fail — the symptom would look nothing like a soft-delete bug.
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   DROP TRIGGER guard_review_soft_delete   ON public.reviews;
--   DROP TRIGGER guard_question_soft_delete ON public.questions;
--   DROP FUNCTION public.guard_owner_soft_delete();
--   DROP POLICY "owner soft delete reviews"   ON public.reviews;
--   DROP POLICY "owner soft delete questions" ON public.questions;
--   -- restore the two read policies from 20260718_capture_5_rls_policies.sql (:708, :663)
--   DROP INDEX public.reviews_customer_facility_live_uniq;
--   ALTER TABLE public.reviews ADD CONSTRAINT reviews_customer_facility_unique
--     UNIQUE (customer_id, facility_id);   -- ⚠ fails if any customer now has 2+ rows
--   ALTER TABLE public.reviews DROP COLUMN deleted_at;
--   ALTER TABLE public.questions DROP COLUMN deleted_at;
--   NOTIFY pgrst, 'reload schema';
--   DELETE FROM public.schema_migrations_applied WHERE filename = '20260928_ugc_soft_delete.sql';
