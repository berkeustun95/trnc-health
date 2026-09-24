-- ═══════════════════════════════════════════════════════════════════════════
-- 20261050 — purge soft-deleted reviews, questions and messages after 30 days
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Soft delete (20260928 reviews/questions, 20261029 messages) hides content at once and
-- keeps the row as the evidence trail if a removal is disputed. Until now NOTHING ever
-- removed those rows: a deleted review kept its text for as long as the account existed,
-- which contradicts the policy's "we will process deletion within 30 days". Decided with
-- Berke 2026-09-24: purge, not merely disclose.
--
-- ─── WHAT IS REMOVED, NIGHTLY ────────────────────────────────────────────────
--   • reviews, questions, messages whose deleted_at is more than 30 days old,
--   • EXCEPT a row that is part of an OPEN report (content_reports.status = 'pending') —
--     it waits until the report is actioned or dismissed; the next night takes it.
--   • A question takes its ANSWERS with it (answers_question_id_fkey ON DELETE CASCADE).
--     Those answers are already unreadable (read answers gates on the parent's deleted_at,
--     20260930), and a question is also held while any of ITS ANSWERS has an open report —
--     otherwise a reported answer would vanish because someone else deleted their question.
--
-- ─── WHAT IS NOT TOUCHED ─────────────────────────────────────────────────────
--   • hidden_at (moderation) is a different state and out of scope: a row that was hidden
--     but never soft-deleted stays. This is a DELETE, so the 20260928 guard's rule about
--     not touching hidden_at through an UPDATE does not arise — noted so it is not "missed".
--   • content_reports rows stay; a resolved report about purged content already reads as
--     "content no longer exists" in the admin queue.
--   • Nothing else references these rows: conversations.last_message_at is a timestamp,
--     not a key, and a soft-deleted message is already hidden from both parties.
--
-- At the time of writing (2026-09-24) the first run removes 0 rows: none of 1 review,
-- 6 questions or 2 messages is soft-deleted (measured with service_role; totals as the
-- positive control). The query to re-run before the first night is at the end of this file.
--
-- Security: the function is NOT an RPC — EXECUTE is revoked from PUBLIC, anon and
-- authenticated. pg_cron runs it as the job owner (postgres).
--
-- Apply: SQL Editor, Role = postgres, whole file ONCE, copied from disk. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.purge_soft_deleted_ugc(p_older_than interval DEFAULT interval '30 days')
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_cut timestamptz := now() - p_older_than;
  n_r int; n_q int; n_m int;
BEGIN
  DELETE FROM reviews r
   WHERE r.deleted_at < v_cut
     AND NOT EXISTS (SELECT 1 FROM content_reports cr
                      WHERE cr.status = 'pending' AND cr.content_type = 'review' AND cr.content_id = r.id);
  GET DIAGNOSTICS n_r = ROW_COUNT;

  DELETE FROM questions q
   WHERE q.deleted_at < v_cut
     AND NOT EXISTS (SELECT 1 FROM content_reports cr
                      WHERE cr.status = 'pending' AND cr.content_type = 'question' AND cr.content_id = q.id)
     AND NOT EXISTS (SELECT 1 FROM content_reports cr JOIN answers a ON a.id = cr.content_id
                      WHERE cr.status = 'pending' AND cr.content_type = 'answer' AND a.question_id = q.id);
  GET DIAGNOSTICS n_q = ROW_COUNT;

  DELETE FROM messages m
   WHERE m.deleted_at < v_cut
     AND NOT EXISTS (SELECT 1 FROM content_reports cr
                      WHERE cr.status = 'pending' AND cr.content_type = 'message' AND cr.content_id = m.id);
  GET DIAGNOSTICS n_m = ROW_COUNT;

  -- Counts only — never content, ids or authors. pg_cron keeps this in job_run_details.
  RETURN jsonb_build_object('reviews', n_r, 'questions', n_q, 'messages', n_m);
END;
$function$;

COMMENT ON FUNCTION public.purge_soft_deleted_ugc(interval) IS
  'Nightly (cron purge-soft-deleted-ugc): permanently deletes reviews/questions/messages soft-deleted '
  'more than 30 days ago, holding any row in an open (pending) report. Not an RPC.';

REVOKE ALL ON FUNCTION public.purge_soft_deleted_ugc(interval) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-soft-deleted-ugc') THEN
    PERFORM cron.unschedule('purge-soft-deleted-ugc');
  END IF;
END $$;
-- 03:27 UTC: after purge-moderation-rejections (03:17), so the two never overlap.
SELECT cron.schedule('purge-soft-deleted-ugc', '27 3 * * *', $$ SELECT public.purge_soft_deleted_ugc() $$);

-- ─── Assertions. Each derives what it checks and prints what it read. ───────
DO $$
DECLARE
  v_fn   regprocedure := to_regprocedure('public.purge_soft_deleted_ugc(interval)');
  v_jobs int;
  v_cmd  text;
  v_r uuid; v_q1 uuid; v_q2 uuid; v_q3 uuid; v_m uuid; v_rep uuid;
  v_out  jsonb;
  k_r int := -1; k_q1 int := -1; k_q2 int := -1; k_q3 int := -1; k_m int := -1;
  v_probed boolean := false;
BEGIN
  IF v_fn IS NULL THEN RAISE EXCEPTION 'purge_soft_deleted_ugc(interval) is not installed'; END IF;

  -- Not callable by any client role (aclexplode — has_function_privilege raises on a missing fn).
  IF EXISTS (SELECT 1 FROM pg_proc p LEFT JOIN LATERAL aclexplode(p.proacl) a ON TRUE
              LEFT JOIN pg_roles r ON r.oid = a.grantee
              WHERE p.oid = v_fn AND a.privilege_type = 'EXECUTE'
                AND (a.grantee = 0 OR r.rolname IN ('anon', 'authenticated')))
     OR (SELECT proacl FROM pg_proc WHERE oid = v_fn) IS NULL THEN
    RAISE EXCEPTION 'purge_soft_deleted_ugc is executable by a client role (or still has default PUBLIC execute)';
  END IF;

  SELECT count(*), max(command) INTO v_jobs, v_cmd FROM cron.job WHERE jobname = 'purge-soft-deleted-ugc' AND active;
  IF v_jobs IS DISTINCT FROM 1 OR v_cmd NOT LIKE '%purge_soft_deleted_ugc()%' THEN
    RAISE EXCEPTION 'cron job purge-soft-deleted-ugc: % active row(s), command %', v_jobs, coalesce(v_cmd, '(none)');
  END IF;

  -- ── BEHAVIOUR on real rows, rolled back by a sentinel. Needs 1 review, 3 questions,
  --    1 message and 1 existing report to repurpose; none of them is changed for real.
  SELECT id INTO v_r  FROM reviews   WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1;
  SELECT id INTO v_q1 FROM questions WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1;
  SELECT id INTO v_q2 FROM questions WHERE deleted_at IS NULL AND id <> v_q1 ORDER BY created_at LIMIT 1;
  SELECT id INTO v_q3 FROM questions WHERE deleted_at IS NULL AND id NOT IN (v_q1, v_q2) ORDER BY created_at LIMIT 1;
  SELECT id INTO v_m  FROM messages  WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1;
  SELECT id INTO v_rep FROM content_reports ORDER BY created_at LIMIT 1;
  IF v_r IS NULL OR v_q1 IS NULL OR v_q2 IS NULL OR v_q3 IS NULL OR v_m IS NULL OR v_rep IS NULL THEN
    RAISE EXCEPTION 'probe: not enough rows to test on (review %, questions % % %, message %, report %)', v_r, v_q1, v_q2, v_q3, v_m, v_rep;
  END IF;

  BEGIN
    UPDATE reviews   SET deleted_at = now() - interval '40 days' WHERE id = v_r;
    UPDATE questions SET deleted_at = now() - interval '40 days' WHERE id IN (v_q1, v_q2);
    UPDATE questions SET deleted_at = now() - interval '5 days'  WHERE id = v_q3;   -- too recent
    UPDATE messages  SET deleted_at = now() - interval '40 days' WHERE id = v_m;
    -- Q2 is under an OPEN report → must be held.
    UPDATE content_reports SET status = 'pending', content_type = 'question', content_id = v_q2 WHERE id = v_rep;
    v_probed := true;

    v_out := public.purge_soft_deleted_ugc();

    SELECT count(*) INTO k_r  FROM reviews   WHERE id = v_r;
    SELECT count(*) INTO k_q1 FROM questions WHERE id = v_q1;
    SELECT count(*) INTO k_q2 FROM questions WHERE id = v_q2;
    SELECT count(*) INTO k_q3 FROM questions WHERE id = v_q3;
    SELECT count(*) INTO k_m  FROM messages  WHERE id = v_m;
    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  IF NOT v_probed THEN RAISE EXCEPTION 'probe: the setup did not run, so nothing was tested'; END IF;
  IF k_r  IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'a review deleted 40 days ago survived the purge (%)', v_out; END IF;
  IF k_q1 IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'a question deleted 40 days ago survived the purge (%)', v_out; END IF;
  IF k_m  IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'a message deleted 40 days ago survived the purge (%)', v_out; END IF;
  IF k_q2 IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'a question under an OPEN report was purged — the hold is broken (%)', v_out; END IF;
  IF k_q3 IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'a question deleted 5 days ago was purged — the 30-day window is broken (%)', v_out; END IF;
  IF (v_out->>'reviews')::int < 1 OR (v_out->>'questions')::int < 1 OR (v_out->>'messages')::int < 1 THEN
    RAISE EXCEPTION 'the purge did not report its counts (%)', v_out;
  END IF;
  IF EXISTS (SELECT 1 FROM reviews WHERE id = v_r AND deleted_at IS NOT NULL)
     OR NOT EXISTS (SELECT 1 FROM reviews WHERE id = v_r)
     OR NOT EXISTS (SELECT 1 FROM messages WHERE id = v_m AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'probe changes survived the rollback';
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
VALUES ('20261050_purge_soft_deleted_ugc.sql', '51cfacbc105537ecfe057431637aa76407978fe278a18b7c9cb50f1e8411719d')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

-- ─── Before the first night (read-only, run alone): what the purge would remove now ─
--   SELECT
--     (SELECT count(*) FROM reviews   r WHERE r.deleted_at < now() - interval '30 days'
--        AND NOT EXISTS (SELECT 1 FROM content_reports c WHERE c.status='pending' AND c.content_type='review' AND c.content_id=r.id)) AS reviews,
--     (SELECT count(*) FROM questions q WHERE q.deleted_at < now() - interval '30 days'
--        AND NOT EXISTS (SELECT 1 FROM content_reports c WHERE c.status='pending' AND c.content_type='question' AND c.content_id=q.id)) AS questions,
--     (SELECT count(*) FROM messages  m WHERE m.deleted_at < now() - interval '30 days'
--        AND NOT EXISTS (SELECT 1 FROM content_reports c WHERE c.status='pending' AND c.content_type='message' AND c.content_id=m.id)) AS messages;
--
-- ─── After the first night: did it run? ─────────────────────────────────────
--   SELECT status, return_message, start_time FROM cron.job_run_details
--    WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'purge-soft-deleted-ugc')
--    ORDER BY start_time DESC LIMIT 3;
--
-- ─── Rollback ────────────────────────────────────────────────────────────────
--   SELECT cron.unschedule('purge-soft-deleted-ugc');
--   DROP FUNCTION IF EXISTS public.purge_soft_deleted_ugc(interval);
