-- ═══════════════════════════════════════════════════════════════════════════
-- events: description caps 2500 → 3000  (text column AND the jsonb per-key caps)
--
-- WHY: the 2026-09-20 Gişe Kıbrıs drop (active-events.json, 48 events) carries one
-- row that does not fit — MARILYN MONROE, a theatre synopsis stripped to 2858 chars.
-- prepare-gisekibris-feed.mjs refuses to write the seed rather than let it fail at
-- INSERT time, which is the guard working correctly. It is legitimate editorial
-- content, not spam, so the answer is a wider cap and not a truncation: cutting a
-- synopsis mid-sentence is a worse artefact than a long card.
--
-- Measured on the raw feed, 2026-09-20 — 48 rows:
--      2858  MARILYN MONROE            ← the only row over 2500
--      1306  ŞENER ŞEN - ZENGİN MUTFAĞI
--      1128  42. MISS KUZEY KIBRIS 2026
--   over 2500: 1     over 3000: 0
-- 3000 leaves ~142 characters of headroom over today's longest. The DO block below
-- PRINTS the live maximum on every run, so this comment can be checked against the
-- database rather than believed — see the CLAUDE.md note on remembered numbers.
--
-- ⚠ TWO CONSTRAINTS, NOT ONE. events_description_check bounds the legacy text
--   column; events_description_i18n_check bounds description_i18n->>'tr' and ->>'en'
--   SEPARATELY, at the same 2500. Widening only the first still rejects the row, and
--   the failure would look like the migration simply not working. 20260830 created
--   them as a pair and called it "parity with the text column above"; they move
--   together.
--
-- The 6000-byte TOTAL cap on the jsonb is deliberately NOT raised. Marilyn is tr-only
-- (the feed's "en" is byte-identical Turkish, which prepare-…mjs omits), so it
-- serialises to ~2880 bytes. A genuinely bilingual 3000+3000 row would need ~6100 and
-- would fail here — correctly, and loudly, at the point where somebody should decide
-- whether 9 locales × 3000 is the shape this column should grow into.
--
-- BOTH constraints keep their NAMES, so verify_schema.sql section E is structurally
-- blind to this change: it asserts a name exists and the name never went away. That
-- is the `facilities.area` failure class, so this migration registers an H-token for
-- the pair. The existing 0830 token asserts '%2500%' and is RETIRED in the same
-- commit — bumping it is not the fix, because one fact must have one owner, and a
-- token left to go red against a correct database teaches the reader to skim.
--
-- MUST MOVE WITH THIS FILE, IN THE SAME COMMIT: MAX_DESC in
-- scripts/prepare-gisekibris-feed.mjs (2500 → 3000). It is a client-side mirror of
-- these constraints and exists to turn a mid-import CHECK failure into a readable
-- error on a local file. If the two halves disagree the script refuses a row the
-- database would now accept — the same two-halves rule the word filter carries.
--
-- Widening a CHECK cannot invalidate an existing row, so this is safe on any data.
-- No column changes, no data changes, no rewrite; ACCESS EXCLUSIVE only briefly.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── Before ──────────────────────────────────────────────────────────────────
-- Printed, not assumed. The repo says these are 2500; the database is the authority
-- and this is the only place the two get compared. Read the NOTICE.
DO $$
DECLARE
  v_text  text;
  v_i18n  text;
  v_max   integer;
  v_title text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_text
    FROM pg_constraint WHERE conname = 'events_description_check'
      AND conrelid = to_regclass('public.events');
  SELECT pg_get_constraintdef(oid) INTO v_i18n
    FROM pg_constraint WHERE conname = 'events_description_i18n_check'
      AND conrelid = to_regclass('public.events');

  RAISE NOTICE 'BEFORE  events_description_check      = %', coalesce(v_text, '(absent)');
  RAISE NOTICE 'BEFORE  events_description_i18n_check = %', coalesce(v_i18n, '(absent)');

  -- The live maximum, so the header's measured numbers can be checked rather than
  -- trusted. Regenerated on every run by design.
  SELECT max(char_length(description)) INTO v_max FROM public.events;
  SELECT title INTO v_title FROM public.events
    WHERE char_length(description) = v_max LIMIT 1;
  RAISE NOTICE 'BEFORE  longest description in events = % chars (%)',
    coalesce(v_max, 0), coalesce(v_title, 'n/a');
END $$;

-- ─── 1. The legacy text column ───────────────────────────────────────────────
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_description_check;
ALTER TABLE public.events ADD CONSTRAINT events_description_check
  CHECK (char_length(description) <= 3000);

-- ─── 2. The jsonb, per key ───────────────────────────────────────────────────
-- Reproduced in full from 20260830 with the two per-key caps moved to 3000 and
-- everything else byte-identical. The shape guards are load-bearing and are
-- restated rather than referenced: `<> '{}'` rejects an empty object, without which
-- both char_length(NULL) comparisons are UNKNOWN and the whole expression PASSES —
-- the `<>`/NULL trap this repo has already written down once.
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_description_i18n_check;
ALTER TABLE public.events ADD CONSTRAINT events_description_i18n_check
  CHECK (
    description_i18n IS NULL
    OR (
      jsonb_typeof(description_i18n) = 'object'
      AND description_i18n <> '{}'::jsonb
      -- Total cap UNCHANGED at 6000 — see the header.
      AND length(description_i18n::text)       <= 6000
      AND char_length(description_i18n->>'tr') <= 3000
      AND char_length(description_i18n->>'en') <= 3000
    )
  );

-- ─── 3. Verify, inside the transaction ───────────────────────────────────────
-- IS DISTINCT FROM throughout: `<>` yields NULL on a missing constraint and
-- `IF NULL THEN` does not fire, so a `<>` assertion would PASS on the one failure
-- it exists to catch. Every failure message prints what it actually read.
DO $$
DECLARE
  v_text text;
  v_i18n text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_text
    FROM pg_constraint WHERE conname = 'events_description_check'
      AND conrelid = to_regclass('public.events');
  SELECT pg_get_constraintdef(oid) INTO v_i18n
    FROM pg_constraint WHERE conname = 'events_description_i18n_check'
      AND conrelid = to_regclass('public.events');

  IF v_text IS NULL THEN
    RAISE EXCEPTION 'ABORTING: events_description_check is absent after the ADD.';
  END IF;
  IF position('3000' in v_text) IS NOT DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'ABORTING: events_description_check does not mention 3000. Read: %', v_text;
  END IF;

  IF v_i18n IS NULL THEN
    RAISE EXCEPTION 'ABORTING: events_description_i18n_check is absent after the ADD.';
  END IF;
  -- Both per-key caps, and the untouched total. A rewrite that dropped a key cap
  -- would otherwise satisfy a single-substring test.
  IF position('3000' in v_i18n) IS NOT DISTINCT FROM 0
     OR position('6000' in v_i18n) IS NOT DISTINCT FROM 0
     OR position('''tr''' in v_i18n) IS NOT DISTINCT FROM 0
     OR position('''en''' in v_i18n) IS NOT DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'ABORTING: events_description_i18n_check lost a cap or a key. Read: %', v_i18n;
  END IF;
  -- The shape guard that makes the NULL arm safe.
  IF position('jsonb_typeof' in v_i18n) IS NOT DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'ABORTING: i18n check lost its jsonb_typeof shape guard. Read: %', v_i18n;
  END IF;

  RAISE NOTICE 'AFTER   events_description_check      = %', v_text;
  RAISE NOTICE 'AFTER   events_description_i18n_check = %', v_i18n;
END $$;

-- ─── 4. The caps actually bite at 3001 ───────────────────────────────────────
-- A widened cap that stopped rejecting anything would pass every assertion above.
-- Both probes must RAISE; the outer block converts "no exception" into the failure.
-- Written against a row this migration creates and removes, so it touches no real
-- data — the in-migration-probe rule (pick rows you cannot damage).
DO $$
DECLARE
  v_id  uuid;
  v_ok  boolean;
BEGIN
  -- 3000 must be ACCEPTED.
  BEGIN
    -- organizer_name is NOT NULL (events_migration.sql); organizer_id was made
    -- NULLABLE by events_gisekibris_migration.sql, which is what lets a probe row
    -- exist without inventing a profiles reference. source is left NULL so the row
    -- cannot land in any source='gisekibris' count if cleanup were ever skipped.
    INSERT INTO public.events (title, organizer_name, status, start_date, description)
    VALUES ('zz-probe-20261037', 'zz-probe-20261037', 'draft',
            now() + interval '400 days', repeat('x', 3000))
    RETURNING id INTO v_id;
    v_ok := true;
  EXCEPTION WHEN check_violation THEN
    v_ok := false;
  END;
  IF v_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ABORTING: a 3000-char description was REJECTED — the widening did not take.';
  END IF;

  -- 3001 must be REJECTED.
  BEGIN
    UPDATE public.events SET description = repeat('x', 3001) WHERE id = v_id;
    v_ok := true;
  EXCEPTION WHEN check_violation THEN
    v_ok := false;
  END;
  IF v_ok IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'ABORTING: a 3001-char description was ACCEPTED — the cap is not biting.';
  END IF;

  -- 3000 in the jsonb must be ACCEPTED. This one is load-bearing: the 3001-rejected
  -- case below passes just as happily on an UNWIDENED 2500 constraint, so on its own
  -- it cannot fail on the failure it exists to detect. The pair is what discriminates.
  BEGIN
    UPDATE public.events
       SET description = 'ok', description_i18n = jsonb_build_object('tr', repeat('x', 3000))
     WHERE id = v_id;
    v_ok := true;
  EXCEPTION WHEN check_violation THEN
    v_ok := false;
  END;
  IF v_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ABORTING: a 3000-char description_i18n->>tr was REJECTED — the jsonb cap did not move.';
  END IF;

  -- 3001 in the jsonb must be REJECTED too.
  BEGIN
    UPDATE public.events
       SET description = 'ok', description_i18n = jsonb_build_object('tr', repeat('x', 3001))
     WHERE id = v_id;
    v_ok := true;
  EXCEPTION WHEN check_violation THEN
    v_ok := false;
  END;
  IF v_ok IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'ABORTING: a 3001-char description_i18n->>tr was ACCEPTED.';
  END IF;

  DELETE FROM public.events WHERE id = v_id;
  IF EXISTS (SELECT 1 FROM public.events WHERE title = 'zz-probe-20261037') THEN
    RAISE EXCEPTION 'ABORTING: the probe row survived cleanup.';
  END IF;

  RAISE NOTICE '20261037 verified: 3000 accepted, 3001 rejected on both columns, probe removed.';
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
VALUES ('20261037_events_description_3000.sql', 'bf053d17c51768192ab8593e8ffa988ce45774625bacc650a845da1a6f7b40bb')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
