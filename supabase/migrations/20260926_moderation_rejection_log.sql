-- ═══ moderation — record WHICH term rejected a submission ═══════════════════
--
-- Phase A closed three evasions and, by accident, surfaced a live FALSE POSITIVE:
-- `the<ZWNJ>rapist` was being blocked as `rapist`. In a health app. It was found only
-- because the probe happened to test both directions — nothing in the product could have
-- reported it, and nothing can today: all six triggers reject with a bare
-- `RAISE EXCEPTION 'BLOCKED_TERM'`, and no record of the matched term survives anywhere.
-- A user who hits a false positive sees an unexplained failure, tells nobody, and stops
-- posting. At 54 terms that is a latent problem; at ~510 across 9 languages it is
-- undiagnosable. This ships before the import.
--
-- ─── THE CONSTRAINT THAT DICTATES THE WHOLE DESIGN ──────────────────────────
--
-- A log table written by the trigger CANNOT WORK. `RAISE EXCEPTION` aborts the
-- transaction, and the log row is rolled back with it. Not "usually", not "unless" —
-- always. It would look like a working logger and be empty forever, which is worse than
-- having none, because the emptiness reads as "no false positives".
--
-- Postgres offers exactly one rollback-surviving sink without an extension: the server
-- log. Everything else (a table, pg_net's queue, LISTEN/NOTIFY) is transactional and dies
-- with the abort. dblink would give a genuine autonomous transaction, but on Supabase it
-- needs a stored database password — rejected: CLAUDE.md forbids it, and paying that
-- price for LOGGING in a health app is the wrong trade.
--
-- So the record is written in TWO places, for two different readers:
--
--   1. RAISE LOG at the moment of rejection — survives the abort because server logging
--      is not transactional. Always fires, for every rejection, including from a client
--      we did not write. Carries the term, the surface and the user id, and DELIBERATELY
--      NOT the text: the Postgres log sits outside our RLS boundary.
--      Retention is Supabase's (1–7 days by plan), so this is a breadcrumb, not the log.
--
--   2. moderation_rejections, self-reported by the client — a SEPARATE transaction,
--      which therefore commits. This is the durable, RLS-governed, admin-readable half.
--
-- ─── WHY CLIENT SELF-REPORT IS NOT THE WEAKNESS IT LOOKS LIKE ───────────────
--
-- Self-report only records rejections from clients that choose to report. An evader will
-- not. That is fine, and is in fact the point: this log exists to find FALSE POSITIVES,
-- and false positives happen to honest users running our own client. We do not need
-- evader telemetry — we need to know when we blocked somebody's snakebite question. The
-- incentive gradient points the right way, which is rare enough to say out loud.
--
-- ─── ONE CHANGE, NOT SIX ────────────────────────────────────────────────────
--
-- The four trigger FUNCTIONS behind the six triggers (check_ugc_on_insert serves three;
-- check_facility_content, check_change_request_content, check_place_content one each) all
-- call contains_blocked_term(). So the term lookup and the RAISE LOG go into a new
-- blocked_term_hit(), and contains_blocked_term() becomes a thin wrapper over it.
-- NONE OF THE FOUR TRIGGER FUNCTIONS IS TOUCHED. All six surfaces gain logging from one
-- redefinition, which is also the only way this stays reviewable.
--
-- ─── WHAT THE CLIENT MAY AND MAY NOT SEE ────────────────────────────────────
--
-- The client never learns which term matched. It supplies the TEXT; the trigger computes
-- the TERM and overwrites whatever was sent. There is no SELECT policy for the author —
-- reading back your own rejection is the same oracle, just slower.
--
-- ⚠ Be honest about how much that buys: `blocked_terms_read_all` is `USING (true)`, so the
--   entire term list is already public — the client downloads it for the inline preview.
--   Anyone can diff their own text against it and work out what matched. Withholding the
--   term stops the server from being a turnkey oracle; it does not make evasion hard, and
--   it was never going to. It is worth doing anyway, and it is not a security boundary.
--
-- ─── RETENTION ──────────────────────────────────────────────────────────────
--
-- 30 days, then hard delete by pg_cron. ADA went EU-wide on 2026-08-29, and rejected user
-- text held under legitimate interest is far easier to defend at 30 days than at 90.
-- The durable signal is kept separately and carries no user text: blocked_terms.hit_count
-- and .last_hit_at, incremented by the same trigger, retained forever. That split is the
-- point — sorting terms by fire rate is what actually finds a false positive, and it
-- needs a counter, not a corpus.
--
-- Terms cover this: docs/terms.html and screens/LegalScreen.js §8.2 both gained the
-- retention clause in the same commit. Neither copy may carry it alone.

SET ROLE postgres;
BEGIN;

-- ─── 1. blocked_term_hit — the term, not just the boolean ────────────────────
-- STABLE, not VOLATILE: RAISE LOG writes to the server log, which is not a database
-- modification, so the STABLE promise still holds and the planner keeps its old freedom.
--
-- ORDER BY length DESC makes the answer deterministic and picks the most specific term
-- when text trips more than one. A non-deterministic pick would make the admin log
-- unreproducible, and "which term did it actually match" is the entire question.

CREATE OR REPLACE FUNCTION public.blocked_term_hit(p_text text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_term text;
BEGIN
  SELECT bt.term INTO v_term
  FROM blocked_terms bt
  WHERE normalize_for_moderation(p_text) ~ (
    '\m' || regexp_replace(normalize_for_moderation(bt.term),
                           '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '\M'
  )
  ORDER BY length(bt.term) DESC, bt.term
  LIMIT 1;

  IF v_term IS NOT NULL THEN
    -- Survives the RAISE EXCEPTION that is about to discard this transaction. No text:
    -- the server log is outside RLS. Fires twice for a reported rejection (once at the
    -- block, once when the client self-reports) — that pairing is useful, it shows the
    -- report path working.
    RAISE LOG 'ADA moderation: term=% user=%', v_term, auth.uid();
  END IF;

  RETURN v_term;
END;
$function$;

REVOKE ALL ON FUNCTION public.blocked_term_hit(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.blocked_term_hit(text) FROM anon;
REVOKE ALL ON FUNCTION public.blocked_term_hit(text) FROM authenticated;

-- ─── 2. contains_blocked_term becomes a wrapper ──────────────────────────────
-- The behaviour must be IDENTICAL to 20260925's — this is a refactor, and the DO block
-- below re-runs Phase A's whole battery against it rather than assuming so.
-- NULL in still yields false: blocked_term_hit(NULL) finds no row, returns NULL,
-- and NULL IS NOT NULL is false. Same as before.

CREATE OR REPLACE FUNCTION public.contains_blocked_term(p_text text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT blocked_term_hit(p_text) IS NOT NULL;
$function$;

-- ─── 3. The durable, text-free signal ────────────────────────────────────────
ALTER TABLE public.blocked_terms
  ADD COLUMN IF NOT EXISTS hit_count   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_hit_at timestamptz;

-- ─── 4. The log ──────────────────────────────────────────────────────────────
-- content_text is the FULL submitted text, capped. Not a window around the match: the
-- ZWNJ therapist case only READS as a false positive with the sentence around it, and a
-- window would have hidden the very bug that motivated this file.

CREATE TABLE IF NOT EXISTS public.moderation_rejections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content_type text NOT NULL CHECK (content_type IN
                 ('review','question','answer','facility','change_request','place')),
  matched_term text NOT NULL REFERENCES public.blocked_terms(term) ON UPDATE CASCADE ON DELETE CASCADE,
  content_text text NOT NULL CHECK (char_length(content_text) BETWEEN 1 AND 2000),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ON DELETE CASCADE on matched_term is deliberate: removing a term from the admin screen
-- because it was a false positive should take its rejection records with it. Those rows
-- are text we blocked BY MISTAKE — keeping them after admitting the mistake is the one
-- outcome nobody wants.

CREATE INDEX IF NOT EXISTS moderation_rejections_recent_idx
  ON public.moderation_rejections (created_at DESC);
CREATE INDEX IF NOT EXISTS moderation_rejections_term_idx
  ON public.moderation_rejections (matched_term, created_at DESC);

ALTER TABLE public.moderation_rejections ENABLE ROW LEVEL SECURITY;

-- TWO policies, and the absence of the other two is the design:
--   • admins read everything.
--   • any signed-in user may file their OWN rejection.
--   • NO author SELECT — reading back your own rejection is the oracle, slower.
--   • NO UPDATE, NO DELETE — the row is immutable; only the cron purge removes it,
--     and that runs as the table owner, which RLS does not constrain.
DROP POLICY IF EXISTS "moderation_rejections_admin_read" ON public.moderation_rejections;
CREATE POLICY "moderation_rejections_admin_read" ON public.moderation_rejections
  FOR SELECT USING (get_my_role() = 'admin');

DROP POLICY IF EXISTS "moderation_rejections_insert_own" ON public.moderation_rejections;
CREATE POLICY "moderation_rejections_insert_own" ON public.moderation_rejections
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- ─── 5. The trigger that makes the record trustworthy ────────────────────────
CREATE OR REPLACE FUNCTION public.record_moderation_rejection()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_term text;
BEGIN
  -- The client sends the TEXT. The TERM is computed here and ALWAYS overwritten. A client
  -- that could choose the term could poison the admin triage queue with whatever it liked,
  -- which is the one thing that would make this log worse than no log.
  v_term := blocked_term_hit(NEW.content_text);
  IF v_term IS NULL THEN
    -- Nothing matched, so this was not a rejection. Refusing it keeps the table a record
    -- of real events rather than a free-text drop box pointed at our database.
    RAISE EXCEPTION 'NOT_A_REJECTION';
  END IF;
  NEW.matched_term := v_term;
  NEW.user_id      := auth.uid();   -- belt and braces beside the WITH CHECK
  NEW.created_at   := now();

  -- Same shape as check_report_rate_limit (20260712). Caps a client — ours, buggy, or
  -- somebody else's — from filling the table.
  IF (SELECT count(*) FROM moderation_rejections
       WHERE user_id = NEW.user_id
         AND created_at > now() - interval '24 hours') >= 30 THEN
    RAISE EXCEPTION 'REJECTION_LOG_RATE_LIMIT';
  END IF;

  UPDATE blocked_terms
     SET hit_count = hit_count + 1, last_hit_at = now()
   WHERE term = v_term;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS record_moderation_rejection ON public.moderation_rejections;
CREATE TRIGGER record_moderation_rejection
  BEFORE INSERT ON public.moderation_rejections
  FOR EACH ROW EXECUTE FUNCTION public.record_moderation_rejection();

-- ─── 6. Assertions — this migration proves itself or rolls back ──────────────
DO $$
DECLARE
  v_fail  text := '';
  v_uid   uuid;
  v_id    uuid;
  v_hits  integer;
  v_after integer;
  v_last  timestamptz;
  v_pol   integer;
BEGIN
  -- (a) The new function answers with the TERM, and the control says the probe is alive.
  IF blocked_term_hit('fuck')              IS DISTINCT FROM 'fuck' THEN v_fail := v_fail || ' hit-term'; END IF;
  IF blocked_term_hit('hello there friend') IS NOT NULL            THEN v_fail := v_fail || ' CONTROL-clean-text-matched'; END IF;
  IF blocked_term_hit('fuck shit') NOT IN ('fuck','shit')           THEN v_fail := v_fail || ' multi-hit-nondeterministic'; END IF;
  IF v_fail <> '' THEN RAISE EXCEPTION 'blocked_term_hit is wrong:%', v_fail; END IF;

  -- (b) contains_blocked_term was REDEFINED, so Phase A's whole battery is re-run here
  -- rather than assumed. A refactor that quietly reopened an evasion would otherwise
  -- leave every other assertion in this file green.
  IF NOT contains_blocked_term('SİKİK')                  THEN v_fail := v_fail || ' capital-İ'; END IF;
  IF NOT contains_blocked_term(U&'f\200Cuck')            THEN v_fail := v_fail || ' ZWNJ';      END IF;
  IF NOT contains_blocked_term(U&'s\0640ik')             THEN v_fail := v_fail || ' tatweel';   END IF;
  IF NOT contains_blocked_term('fuck')                   THEN v_fail := v_fail || ' CONTROL-plain'; END IF;
  IF     contains_blocked_term(U&'the\200Crapist')       THEN v_fail := v_fail || ' therapist'; END IF;
  IF     contains_blocked_term('sık sık geliyorum')      THEN v_fail := v_fail || ' Turkish-sık'; END IF;
  IF     contains_blocked_term('Scunthorpe')             THEN v_fail := v_fail || ' CONTROL-substring'; END IF;
  IF EXISTS (SELECT 1 FROM blocked_terms WHERE NOT contains_blocked_term(term)) THEN
    v_fail := v_fail || ' terms-stopped-matching';
  END IF;
  IF v_fail <> '' THEN RAISE EXCEPTION 'Phase A behaviour regressed:%', v_fail; END IF;

  -- (c) DERIVED policy count, printed. Not a list of names: a check phrased as a
  -- remembered list goes green when the one thing it names is absent and stays silent
  -- about everything it forgot. If a legitimate third policy is added, bump this in the
  -- same commit and say why — that edit is the review moment a name list never creates.
  SELECT count(*) INTO v_pol FROM pg_policies
   WHERE schemaname='public' AND tablename='moderation_rejections';
  IF v_pol <> 2 THEN
    RAISE EXCEPTION 'moderation_rejections has % policies, expected 2 (admin read, insert own)', v_pol;
  END IF;

  -- (d) End to end through the trigger, using a real profile so the FK and auth.uid()
  -- are exercised for real. set_config(..., true) is transaction-local, so the identity
  -- evaporates at COMMIT. The row and the counter are both undone below — this proves
  -- the path works without leaving a fake rejection in the admin queue on day one.
  SELECT id INTO v_uid FROM profiles LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE NOTICE 'no profiles rows — skipped the end-to-end trigger assertion (probe covers it)';
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);
    SELECT hit_count, last_hit_at INTO v_hits, v_last FROM blocked_terms WHERE term = 'fuck';

    INSERT INTO moderation_rejections (user_id, content_type, content_text, matched_term)
    VALUES (v_uid, 'review', 'apply-time assertion: fuck this place', 'salak')
    RETURNING id INTO v_id;

    IF (SELECT matched_term FROM moderation_rejections WHERE id = v_id) <> 'fuck' THEN
      RAISE EXCEPTION 'the client-supplied matched_term was NOT overwritten — the log is forgeable';
    END IF;
    SELECT hit_count INTO v_after FROM blocked_terms WHERE term = 'fuck';
    IF v_after <> v_hits + 1 THEN
      RAISE EXCEPTION 'hit_count did not advance (% -> %)', v_hits, v_after;
    END IF;

    DELETE FROM moderation_rejections WHERE id = v_id;
    -- Restore BOTH, captured not assumed. Setting last_hit_at = NULL here would erase a
    -- real timestamp on any re-apply after production rejections exist.
    UPDATE blocked_terms SET hit_count = v_hits, last_hit_at = v_last WHERE term = 'fuck';
    PERFORM set_config('request.jwt.claims', '', true);
    RAISE NOTICE 'end-to-end trigger assertion passed and was rolled back by hand';
  END IF;

  RAISE NOTICE 'moderation rejection log OK';
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
VALUES ('20260926_moderation_rejection_log.sql', 'f3272ba20c48dd95750f645cdf5e2b1ab05e55623d86e5066fa1259531699a71')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- ─── 7. Retention: 30 days (outside the txn; unschedule-then-schedule) ───────
DO $$
BEGIN
  PERFORM cron.unschedule('purge-moderation-rejections');
EXCEPTION WHEN OTHERS THEN
  NULL;  -- not yet scheduled
END $$;
SELECT cron.schedule('purge-moderation-rejections', '17 3 * * *',
  $$ DELETE FROM public.moderation_rejections WHERE created_at < now() - interval '30 days' $$);

-- ADD COLUMN on blocked_terms, so this is MANDATORY: without it PostgREST keeps a stale
-- schema cache and reports 42703 "column hit_count does not exist" through the REST API
-- while the column plainly exists in Postgres. The admin screen reads hit_count.
NOTIFY pgrst, 'reload schema';

-- ─── Verify (run separately, after the COMMIT above) ────────────────────────
--
--   -- 1. the bodies that are actually installed, not the file claiming to install them:
--   SELECT pg_get_functiondef('public.contains_blocked_term(text)'::regprocedure)
--            LIKE '%blocked_term_hit%'          AS wrapper_installed,
--          pg_get_functiondef('public.blocked_term_hit(text)'::regprocedure)
--            LIKE '%RAISE LOG%'                 AS breadcrumb_installed;
--   -- expect t, t
--
--   -- 2. the four trigger functions were NOT touched — all six surfaces still route here:
--   SELECT p.proname, pg_get_functiondef(p.oid) ILIKE '%contains_blocked_term%' AS routes_here
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public' AND p.proname IN ('check_ugc_on_insert','check_facility_content',
--          'check_change_request_content','check_place_content')
--    ORDER BY 1;
--   -- expect 4 rows, all t
--
--   -- 3. policies — DERIVED count, and PRINT them so a surprise is visible, not summarised:
--   SELECT policyname, cmd, roles, qual, with_check FROM pg_policies
--    WHERE schemaname='public' AND tablename='moderation_rejections' ORDER BY policyname;
--   -- expect EXACTLY 2: admin_read (SELECT), insert_own (INSERT)
--
--   -- 3b. and the policy this whole screen depends on, which until now had only ever been
--   --     read from a migration file. A policy that exists only in a file is not a policy.
--   SELECT policyname, permissive, cmd, roles, qual, with_check FROM pg_policies
--    WHERE schemaname='public' AND tablename='blocked_terms' ORDER BY policyname;
--   -- expect 2: blocked_terms_read_all (SELECT, qual true)
--   --           blocked_terms_admin_write (ALL, PERMISSIVE, get_my_role() = 'admin')
--
--   -- 4. retention is actually scheduled — a purge nobody scheduled is a purge that
--   --    never runs, and the Terms now promise 30 days in writing:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname='purge-moderation-rejections';
--   -- expect 1 row, active = t
--
--   -- 5. then, from the repo root:
--   --      npm run moderation:check   (Phase A battery — contains_blocked_term was redefined)
--   --      npm run moderation:log     (this slice, end to end)
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   SELECT cron.unschedule('purge-moderation-rejections');
--   DROP TABLE public.moderation_rejections;              -- takes its trigger with it
--   DROP FUNCTION public.record_moderation_rejection();
--   ALTER TABLE public.blocked_terms DROP COLUMN hit_count, DROP COLUMN last_hit_at;
--   -- then re-apply contains_blocked_term from 20260925_moderation_normalization.sql
--   DROP FUNCTION public.blocked_term_hit(text);
--   NOTIFY pgrst, 'reload schema';
-- ⚠ Roll the AdminScreen Moderation tab back in the same change; it reads hit_count.
--   DELETE FROM public.schema_migrations_applied
--    WHERE filename = '20260926_moderation_rejection_log.sql';
