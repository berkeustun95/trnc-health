-- ═══════════════════════════════════════════════════════════════════════════
-- 20261084 — contact_events: the app may write a random per-tap id (exact counts)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Berke, 2026-10-05 (option B): contact taps (call / website / maps / book / whatsapp …) are
-- the counter partners are measured by — the cross-check against HotelRunner's UTM data and the
-- main figure for every other partner. utils/logContactEvent.js becomes an OUTBOX: a tap is
-- queued on the phone, sent at once, kept when the send fails or times out, and re-sent when the
-- app returns to the foreground or starts. A re-sent tap must not be counted twice, so each tap
-- carries a RANDOM id made on the phone when it is tapped, and the existing PRIMARY KEY does the
-- dedupe: a second insert of the same id fails with unique_violation (PostgREST 409), which the
-- outbox treats as "already delivered". A plain INSERT — no ON CONFLICT, no new privilege beyond
-- this one column.
--
-- This narrows one sentence of 20260910 ("no caller can … pick its primary key"): a caller may
-- now pick the id of ITS OWN new row. That cannot touch an existing row (no UPDATE grant, the
-- ce_no_update / ce_no_delete restrictive policies), and choosing an id that exists only makes the
-- chooser's own insert fail. created_at stays unwritable (server-stamped, unforgeable).
--
-- 20260910 RULE TWO (no identifier) is respected: the id is a fresh random UUID per TAP, never
-- derived from the device, the user or a previous tap, so no two rows can be linked by it.
-- Old clients that send no id keep getting the DEFAULT gen_random_uuid().
--
-- No RLS or policy change; no new column (no NOTIFY needed).
-- Apply: gh workflow run supabase-migrate -f file=20261084_contact_events_client_id.sql (dry, then -f apply=true).
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

GRANT INSERT (id) ON public.contact_events TO anon, authenticated;

COMMENT ON COLUMN public.contact_events.id IS
  'Random per-tap UUID. Old clients get the DEFAULT; the app outbox (utils/logContactEvent.js, 20261084) sends its own so a re-sent tap hits the PRIMARY KEY (409) and is counted once. Never derived from a device or user (20260910 RULE TWO).';

-- ─── Assertions, as the real client roles ───────────────────────────────────
DO $$
DECLARE
  v_id uuid := '00000000-0000-4000-8000-0000000108a4';
  v_n int; r_dup text := 'unset'; r_ts text := 'unset'; r_role text;
BEGIN
  -- Grants, from the catalog: id writable by both client roles, created_at by neither.
  IF NOT (has_column_privilege('anon', 'public.contact_events', 'id', 'INSERT')
      AND has_column_privilege('authenticated', 'public.contact_events', 'id', 'INSERT')) THEN
    RAISE EXCEPTION 'contact_events.id is not INSERT-able by anon and authenticated';
  END IF;
  IF has_column_privilege('anon', 'public.contact_events', 'created_at', 'INSERT')
     OR has_column_privilege('authenticated', 'public.contact_events', 'created_at', 'INSERT') THEN
    RAISE EXCEPTION 'created_at became client-writable';
  END IF;

  SET LOCAL ROLE anon;
  r_role := current_user;
  -- An explicit id is accepted …
  INSERT INTO public.contact_events (id, module, entity_id, action, region) VALUES (v_id, 'hotels', v_id, 'call', NULL);
  -- … the same id again is refused by the primary key (the outbox's "already delivered") …
  BEGIN
    INSERT INTO public.contact_events (id, module, entity_id, action, region) VALUES (v_id, 'hotels', v_id, 'call', NULL);
    r_dup := 'ACCEPTED';
  EXCEPTION WHEN unique_violation THEN r_dup := 'refused';
  END;
  -- … an insert WITHOUT an id still works (old clients) …
  INSERT INTO public.contact_events (module, entity_id, action, region) VALUES ('hotels', v_id, 'website', NULL);
  -- … and created_at is still not writable (positive control beside the grant).
  BEGIN
    INSERT INTO public.contact_events (module, entity_id, action, region, created_at)
    VALUES ('hotels', v_id, 'maps', NULL, now() - interval '30 days');
    r_ts := 'ACCEPTED';
  EXCEPTION WHEN insufficient_privilege THEN r_ts := 'refused';
  END;
  RESET ROLE;

  IF r_role IS DISTINCT FROM 'anon' THEN RAISE EXCEPTION 'probe did not run as anon (ran as %)', r_role; END IF;
  IF r_dup IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'a duplicate id was %', r_dup; END IF;
  IF r_ts  IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'an explicit created_at was %', r_ts; END IF;
  SELECT count(*) INTO v_n FROM public.contact_events WHERE entity_id = v_id;
  IF v_n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'expected 2 probe rows (one with the explicit id, one default), found %', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.contact_events WHERE id = v_id;
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'the explicit id is stored % times, expected exactly 1', v_n; END IF;
  -- Clean up as postgres (ce_no_delete is RESTRICTIVE for client roles; postgres bypasses RLS).
  DELETE FROM public.contact_events WHERE entity_id = v_id;
  IF EXISTS (SELECT 1 FROM public.contact_events WHERE entity_id = v_id) THEN
    RAISE EXCEPTION 'probe rows survived the cleanup';
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
VALUES ('20261084_contact_events_client_id.sql', 'ff46e3176b1ede99c5a052afbd15127866e9a145c08a3df35cb0a8242f9f7015')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- ─── Verification after applying ────────────────────────────────────────────
--   supabase/verify_schema.sql QUERY 1: the 1084_contact_events_client_id row must read OK.
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   REVOKE INSERT (id) ON public.contact_events FROM anon, authenticated;
--   (the app outbox then keeps every tap queued with 42501 → it drops them as un-sendable; ship the
--    client rollback first.)
