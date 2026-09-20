-- ═══════════════════════════════════════════════════════════════════════════
-- events: status vocabulary gains 'cancelled'   (draft|pending|approved|rejected
--                                                → + cancelled)
--
-- WHY NOW: the 2026-09-20 Gişe Kıbrıs drop (active-events.json, 48 events) is missing
-- 53 of prod's 72 gisekibris rows. 48 of those are past-dated and expected. The other
-- 5 are future-dated, and the partner's own pages say they are CANCELLED:
--
--     LYSISTRATA                              2026-09-23  Girne Amfi Tiyatro
--     HAYKO CEPKİN & YAŞLI AMCA               2026-09-25  Girne Bel. Batı Doğa Parkı
--     GECE YOLCULARI X MISIRLIZADE AÇIK HAVA  2026-10-02  Mısırlızade Açık Hava
--     DUMAN X DEDUBLÜMAN                      2026-10-10  Girne Bel. Batı Doğa Parkı
--     YILDIZ TİLBE                            2026-10-11  Girne Bel. Batı Doğa Parkı
--
-- ⚠ HOW THIS WAS ESTABLISHED, BECAUSE THE FIRST ANSWER WAS WRONG AND THE WAY IT WAS
--   WRONG IS WORTH KEEPING. The first probe read only the HTTP STATUS of those five
--   ticket pages. All five returned 200, and the conclusion drawn was "still published,
--   so the feed must be partial" — which would have left five cancelled concerts live
--   in the app. The status code CANNOT discriminate here: a cancelled event keeps its
--   page and still serves 200, so a healthy system and a broken one print the same
--   character. The probe was incapable of failing on the case it existed to detect.
--
--   What actually discriminates is a field in the page's own embedded payload,
--   "isCancelled". Measured 2026-09-20 over all 53 URLs:
--     • the 48 feed events   — 200, isCancelled=false on 35, field ABSENT on 13
--     • the 5 vanished ones  — 200, isCancelled=TRUE on all five
--   Zero cancelled inside the feed, five out of five outside it. The 13 absences are a
--   different page render (seat-map venues; ~285KB with a layoutID payload) and are a
--   limit of the probe, not a contrary reading.
--
-- WHAT 'cancelled' MEANS, and why it is not 'rejected': 'rejected' is a moderation
-- verdict about an event WE refused to carry. 'cancelled' is a fact about the world —
-- the event is not happening. Collapsing the two would make the admin queue's rejection
-- reasons meaningless and would tell an organizer we turned them down when we did not.
--
-- WHY NOT JUST DELETE THE ROWS: the importer reports vanished rows and never deletes
-- them, deliberately. A delete destroys the evidence that we ever carried the event and
-- makes the next feed comparison lie; a status keeps the row auditable and re-approvable
-- if the partner reinstates it.
--
-- NOTHING IN THE CLIENT NEEDS TO CHANGE, and that is a property worth stating rather
-- than assuming. All three read paths are ALLOW-LISTS on 'approved', not deny-lists:
--   • EventsScreen.js:534   .eq('status', 'approved')
--   • search_content        events arm: WHERE e.status = 'approved'
--   • RLS "read approved events"  USING (status = 'approved')
-- A new status value is therefore invisible to users the moment it exists. Section 3
-- asserts all three, because "no client change needed" is a claim about code that
-- somebody will edit later.
--
-- ev_guard_write needs no change either: it makes `status` admin-only for anyone with
-- an auth.uid(), permitting exactly one owner transition (draft → pending). Adding a
-- value to the CHECK does not hand organizers a new self-serve state. Asserted below.
--
-- The constraint keeps its NAME, so verify_schema.sql section E cannot see this — and
-- section E never listed events_status_check at all, so before the H-token shipping in
-- this commit NOTHING in the drift report could see the events status vocabulary.
--
-- This migration changes the VOCABULARY only. Retiring the five rows is a separate,
-- owner-approved data step — see PHASE B at the foot of this file.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── Before ──────────────────────────────────────────────────────────────────
DO $$
DECLARE v_def text; v_counts text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint WHERE conname = 'events_status_check'
      AND conrelid = to_regclass('public.events');
  RAISE NOTICE 'BEFORE  events_status_check = %', coalesce(v_def, '(absent)');

  SELECT string_agg(status || '=' || n, ', ' ORDER BY status) INTO v_counts
    FROM (SELECT status, count(*) n FROM public.events GROUP BY status) x;
  RAISE NOTICE 'BEFORE  status distribution = %', coalesce(v_counts, '(no rows)');
END $$;

-- ─── 1. Widen the vocabulary ─────────────────────────────────────────────────
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_status_check;
ALTER TABLE public.events ADD CONSTRAINT events_status_check
  CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'cancelled'));

-- ─── 2. The vocabulary is exactly the five, DERIVED ──────────────────────────
-- Not "does it contain cancelled" — that passes on a constraint that has silently lost
-- 'rejected'. The set is pulled out of the rendered definition and compared whole, so
-- an addition AND a loss both go red.
DO $$
DECLARE v_def text; v_vals text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint WHERE conname = 'events_status_check'
      AND conrelid = to_regclass('public.events');
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'ABORTING: events_status_check is absent after the ADD.';
  END IF;

  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_vals
    FROM regexp_matches(v_def, '''([a-z]+)''::text', 'g') AS m;

  IF v_vals IS DISTINCT FROM ARRAY['approved','cancelled','draft','pending','rejected'] THEN
    RAISE EXCEPTION
      'ABORTING: events_status_check vocabulary is % — expected exactly the five. Read: %',
      coalesce(v_vals::text, 'NULL'), v_def;
  END IF;
  RAISE NOTICE 'AFTER   events_status_check = %', v_def;
END $$;

-- ─── 3. The three read paths still ALLOW-LIST 'approved' ─────────────────────
-- The whole "no client change needed" claim rests on this. If any of them ever became
-- a deny-list (status <> 'rejected'), a cancelled event would become VISIBLE and this
-- migration is what made that possible.
DO $$
DECLARE v_qual text; v_src text;
BEGIN
  -- (a) RLS. Policy name confirmed against 20260718_capture_5_rls_policies.sql:294.
  SELECT qual INTO v_qual FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'events'
     AND policyname = 'read approved events';
  IF v_qual IS NULL THEN
    RAISE EXCEPTION 'ABORTING: policy "read approved events" not found on public.events.';
  END IF;
  IF v_qual !~ 'approved' THEN
    RAISE EXCEPTION 'ABORTING: the events read policy no longer mentions approved. Read: %', v_qual;
  END IF;

  -- ⚠ p.oid, NOT oid. pg_proc AND pg_namespace BOTH expose a column called `oid`, so
  --   an unqualified pg_get_functiondef(oid) across this join is 42702 "column
  --   reference is ambiguous" — and it fails at RUNTIME, on paste, not at write time.
  --   Shipped broken once (2026-09-20, first paste of this file) and caught by the
  --   editor. verify_schema.sql writes p.oid everywhere; this file deviated from the
  --   house pattern and that is the whole bug. The single-table form used in this
  --   repo's manual-verification comments — FROM pg_proc WHERE proname = … — is
  --   unambiguous and correct; it is the JOIN that creates the collision.

  -- (b) search_content's events arm.
  --     ⚠ MATCHED WITH A WHITESPACE-TOLERANT REGEX, NOT A LITERAL. The migration file
  --     aligns this predicate with padding ("e.status     = 'approved'"); pg_get_
  --     functiondef renders whatever is stored. Pinning the file's spacing would be a
  --     token written in a different frame from the value it reads — the standing
  --     hazard this repo has already shipped twice.
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'search_content' LIMIT 1;
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'ABORTING: search_content not found.';
  END IF;
  IF v_src !~ 'e\.status\s*=\s*''approved''' THEN
    RAISE EXCEPTION
      'ABORTING: search_content''s events arm no longer gates on status=approved. '
      'A cancelled event would be findable in global search.';
  END IF;

  -- (c) ev_guard_write still refuses owner status changes.
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'ev_guard_write' LIMIT 1;
  IF v_src IS NULL OR v_src !~ 'status is admin-only' THEN
    RAISE EXCEPTION
      'ABORTING: ev_guard_write no longer refuses owner status changes — adding a '
      'status value here would become self-serve.';
  END IF;

  RAISE NOTICE '20261038 verified: vocabulary is the five, all three read paths still allow-list approved.';
END $$;

-- ─── 4. The value is usable, and the near-miss spelling is not ───────────────
-- A widened CHECK that still rejected 'cancelled' would pass section 2.
-- title / organizer_name / start_date are the only NOT NULL columns without a default
-- (20260901_events_status_not_null.sql:144), so this INSERT cannot 23502.
DO $$
DECLARE v_id uuid; v_ok boolean;
BEGIN
  INSERT INTO public.events (title, organizer_name, status, start_date)
  VALUES ('zz-probe-20261038', 'zz-probe-20261038', 'draft', now() + interval '400 days')
  RETURNING id INTO v_id;

  BEGIN
    UPDATE public.events SET status = 'cancelled' WHERE id = v_id;
    v_ok := true;
  EXCEPTION WHEN check_violation THEN
    v_ok := false;
  END;
  IF v_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ABORTING: status=''cancelled'' was rejected — the widening did not take.';
  END IF;

  BEGIN
    UPDATE public.events SET status = 'canceled' WHERE id = v_id;   -- one-l spelling
    v_ok := true;
  EXCEPTION WHEN check_violation THEN
    v_ok := false;
  END;
  IF v_ok IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'ABORTING: the American spelling ''canceled'' was ACCEPTED — two spellings would '
      'split the vocabulary and every query on it.';
  END IF;

  DELETE FROM public.events WHERE id = v_id;
  IF EXISTS (SELECT 1 FROM public.events WHERE title = 'zz-probe-20261038') THEN
    RAISE EXCEPTION 'ABORTING: the probe row survived cleanup.';
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
VALUES ('20261038_events_status_cancelled.sql', '8da46fa1549e93242b2c160d25ffaef4a9bc47c9b41c8cb47704e7975ba930df')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE B — THE DATA STEP. RUN SEPARATELY, AFTER THE OWNER CONFIRMS THE LIST.
--
-- Which rows are cancelled is a judgement about the world, not a schema fact, so it
-- does not belong inside the migration that only adds the word. The five below are the
-- ones whose partner pages carry isCancelled=true (measured 2026-09-20).
--
-- It asserts its own row count: a sweep that silently moves 4 of 5, or 40 of 5, is the
-- failure worth catching, and RETURNING prints exactly what moved. Default is ROLLBACK.
--
--   BEGIN;
--   WITH target AS (
--     SELECT unnest(ARRAY[
--       'gk-vPS1v7WpgWvyHqtnJiHs',   -- LYSISTRATA                     2026-09-23
--       'gk-0qr0Sq5ZLXNgIA6dyXd6',   -- HAYKO CEPKİN & YAŞLI AMCA      2026-09-25
--       'gk-ygAWMeh5qwPNeVGoYrcW',   -- GECE YOLCULARI X MISIRLIZADE   2026-10-02
--       'gk-7TVUvUtWzGUNPoqZj5Uo',   -- DUMAN X DEDUBLÜMAN             2026-10-10
--       'gk-DxdJgTfCbbiWLP2qLTwd'    -- YILDIZ TİLBE                   2026-10-11
--     ]::text[]) AS external_id
--   )
--   UPDATE public.events e
--      SET status = 'cancelled', updated_at = now()
--     FROM target t
--    WHERE e.external_id = t.external_id
--      AND e.source = 'gisekibris'
--      AND e.status = 'approved'        -- never re-cancel, never resurrect
--    RETURNING e.external_id, e.title, e.start_date;
--   -- EXPECT EXACTLY 5 ROWS. Anything else: ROLLBACK and find out why before COMMIT.
--   ROLLBACK;   -- ← change to COMMIT only when the count is 5.
--
-- Then verify BEHAVIOURALLY, not by reading this file. ⚠ Count as postgres or anon
-- deliberately — never from inside a role that cannot see what you just wrote.
--   -- the five must be gone from the public feed:
--   SELECT count(*) FROM public.events
--    WHERE source='gisekibris' AND status='approved'
--      AND start_date >= now() - interval '1 day';
--   -- and unfindable in global search:
--   SELECT count(*) FROM public.search_content('yildiz tilbe', NULL, NULL);  -- expect 0
--   SELECT count(*) FROM public.search_content('duman', NULL, NULL);         -- expect 0
-- ═══════════════════════════════════════════════════════════════════════════
