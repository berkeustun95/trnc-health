-- ═══════════════════════════════════════════════════════════════════════════
-- 20261236 — Events: re-key two Gişe Kıbrıs rows that hold a borrowed id
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Data only. No table, column, constraint, policy, grant, trigger or function is created or changed.
--
-- THE BUG: Gişe Kıbrıs repeat sessions reuse the FIRST session's banner image, and the importer took the
-- event id from the banner path instead of from the session itself. When the first session dropped out of
-- the feed, the next session took over its row: the row now carries the December session in every field
-- except external_id (and the id suffix on ticket_url), which still names the past session. Verified
-- 2026-11-25 against the live feed, the partner's event pages and a sealed read-only probe.
--
-- THE REPAIR: re-key, not restore. Each row keeps its events.id (and with it everything keyed by the row id),
-- gets the December session's own partner id, and points ticket_url at that session's page. Nothing is
-- deleted and no past session is re-created: the past sessions are over, and the fixed importer inserts the
-- still-missing future sessions itself on its next run.
--
--   old external_id                  new external_id                  start_date (UTC)        page slug
--   gk-pTvxB7NxtGCRMjLNyMc9          gk-cmwncx16f009ecxtvh9z9n1mm     2026-12-07 18:00        bir-ihtimal-kabare-7aralik
--   gk-cmwkl4z0d013qecqb8aweqe2y     gk-cmwt52g9b026ecxhtlg66sd1l     2026-12-02 18:00        i-m-not-okay-2-aralik
--
-- WHAT IS LEFT ALONE: status (never re-approved or hidden here), images (the mirrored object is the shared
-- banner, so it is the right picture; its storage path keeps the old id, which is cosmetic: nothing derives
-- a path from external_id at read time, images[1] is stored in full), source_image_url (the partner's
-- shared banner, correct for both sessions), every other column. updated_at is bumped because ticket_url
-- changes.
--
-- GUARDS, per row, inside one DO block, so any RAISE rolls back the whole file:
--   1. start_date must be timestamptz (the expected values below are UTC instants).
--   2. The new id must not exist yet. If it does, the importer has already inserted the December session
--      as a second row: a duplicate the re-key cannot resolve. STOP and decide by hand.
--   3. The old id must match exactly one row with source = 'gisekibris' AND the expected start_date.
--      A different start_date means the row moved since the probe (e.g. the unfixed importer ran again).
--   4. GET DIAGNOSTICS: each UPDATE must touch exactly one row.
--   5. End state: the new id holds exactly one gisekibris row at the expected start_date; the old id holds none.
--
-- ALREADY APPLIED (old id gone, new id present on one gisekibris row at the expected start_date): NOTICE and
-- skip that row, no error. That is the exact end state this file exists to produce, so failing on it would
-- only block the other row. The ledger refuses a second workflow run anyway; this branch covers a manual
-- fix landing first. Every other combination (both ids present, neither present, wrong date, wrong source)
-- RAISES: those are states no correct history produces.
--
-- ORDERING (operational, not enforced here): the importer that derives ids from the banner path must not run
-- after this file applies (it would insert the December session again under the old id); the fixed importer
-- must not run before it (it would insert the December session under the new id, and guard 2 then refuses).
--
-- UNIQUE: events_external_id_unique UNIQUE (external_id) is non-deferrable. Old and new ids are four distinct
-- values and the two UPDATEs run one after the other, so no intermediate state can collide.
--
-- ev_guard_write (BEFORE INSERT OR UPDATE ON events) returns NEW at once when auth.uid() IS NULL, which is the
-- case for this file (no request JWT), and it never inspects external_id or ticket_url in any case.
--
-- WHO CAN READ / WRITE WHAT: unchanged. events keeps RLS and its policies; the file runs as postgres (table
-- owner), which bypasses RLS. Customers still read only status = 'approved' rows.
--
-- No user data: the ids below are the partner's public event ids. Not reversible by itself; to undo, swap
-- the old and new ids in the same statements (ticket_url is rewritten by the importer from the feed).

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- Writers wait until COMMIT (reads still work), so no import can insert between the checks and the UPDATEs.
LOCK TABLE public.events IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  r          record;
  v_type     text;
  v_old      int;
  v_old_ok   int;
  v_new      int;
  v_new_ok   int;
  v_rows     int;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod) INTO v_type
    FROM pg_attribute a
   WHERE a.attrelid = 'public.events'::regclass AND a.attname = 'start_date' AND NOT a.attisdropped;
  IF v_type IS DISTINCT FROM 'timestamp with time zone' THEN
    RAISE EXCEPTION 'events.start_date is % — expected timestamp with time zone; the expected dates below would not compare as UTC instants', v_type;
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('gk-pTvxB7NxtGCRMjLNyMc9',      'gk-cmwncx16f009ecxtvh9z9n1mm', timestamptz '2026-12-07 18:00:00+00',
       'https://www.gisekibris.com/etkinlikler/bir-ihtimal-kabare-7aralik?code=AF1727004770915'),
      ('gk-cmwkl4z0d013qecqb8aweqe2y', 'gk-cmwt52g9b026ecxhtlg66sd1l', timestamptz '2026-12-02 18:00:00+00',
       'https://www.gisekibris.com/etkinlikler/i-m-not-okay-2-aralik?code=AF1727004770915')
    ) AS m(old_id, new_id, start_at, ticket_url)
  LOOP
    SELECT count(*),
           count(*) FILTER (WHERE source = 'gisekibris' AND start_date = r.start_at)
      INTO v_old, v_old_ok
      FROM public.events WHERE external_id = r.old_id;

    SELECT count(*),
           count(*) FILTER (WHERE source = 'gisekibris' AND start_date = r.start_at)
      INTO v_new, v_new_ok
      FROM public.events WHERE external_id = r.new_id;

    IF v_old = 0 AND v_new = 1 AND v_new_ok = 1 THEN
      RAISE NOTICE '% already re-keyed to % (start_date %): skipped', r.old_id, r.new_id, r.start_at;
      CONTINUE;
    END IF;

    IF v_new <> 0 THEN
      RAISE EXCEPTION '% already exists (old id % present: %). The December session was imported as a second row; resolve the duplicate by hand, nothing was changed',
        r.new_id, r.old_id, (v_old > 0);
    END IF;

    IF v_old <> 1 OR v_old_ok <> 1 THEN
      RAISE EXCEPTION '% does not match exactly one gisekibris row starting % (rows with that id: %, matching: %); nothing was changed',
        r.old_id, r.start_at, v_old, v_old_ok;
    END IF;

    UPDATE public.events
       SET external_id = r.new_id,
           ticket_url  = r.ticket_url,
           updated_at  = now()
     WHERE external_id = r.old_id
       AND source      = 'gisekibris'
       AND start_date  = r.start_at;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 're-key % -> % updated % row(s), expected 1', r.old_id, r.new_id, v_rows;
    END IF;

    RAISE NOTICE 're-keyed % -> % (start_date %)', r.old_id, r.new_id, r.start_at;
  END LOOP;

  -- End state, read back independently of the branch taken above.
  FOR r IN
    SELECT * FROM (VALUES
      ('gk-pTvxB7NxtGCRMjLNyMc9',      'gk-cmwncx16f009ecxtvh9z9n1mm', timestamptz '2026-12-07 18:00:00+00'),
      ('gk-cmwkl4z0d013qecqb8aweqe2y', 'gk-cmwt52g9b026ecxhtlg66sd1l', timestamptz '2026-12-02 18:00:00+00')
    ) AS m(old_id, new_id, start_at)
  LOOP
    IF EXISTS (SELECT 1 FROM public.events WHERE external_id = r.old_id) THEN
      RAISE EXCEPTION 'end state: % is still present', r.old_id;
    END IF;
    IF (SELECT count(*) FROM public.events
         WHERE external_id = r.new_id AND source = 'gisekibris' AND start_date = r.start_at) IS DISTINCT FROM 1::bigint THEN
      RAISE EXCEPTION 'end state: % is not exactly one gisekibris row starting %', r.new_id, r.start_at;
    END IF;
  END LOOP;
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
VALUES ('20261236_events_gisekibris_rekey_borrowed_banner_ids.sql', '407ae31d7a3e78ef8b48b02ca907d3f68d273aa89e4b1d1f1781323b275fea28')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;
