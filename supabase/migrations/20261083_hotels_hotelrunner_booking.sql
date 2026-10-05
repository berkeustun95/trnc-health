-- ═══════════════════════════════════════════════════════════════════════════
-- 20261083 — hotels: HotelRunner booking link + the 'book' contact-event action
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Berke, 2026-10-04: HotelRunner (booking engine) is a partner; the agreement is done and the
-- link details are pending. The Oteller card gets a "Rezervasyon Yap" button, shown ONLY on a
-- hotel that has a HotelRunner link, so it stays invisible until real links exist.
--
--   1. hotels.hotelrunner_url text — the hotel's HotelRunner booking link, as HotelRunner gave
--      it (+ ADA's partner ID once they send one; the writer adds it). The app appends ADA's UTM
--      parameters at tap time (utils/hotelBooking.js). Written ONLY by
--      scripts/apply-hotelrunner-links.mjs from data/kitob/hotelrunner-links.json (committed),
--      which also CLEARS it on hotels no longer in the file. The KITOB importer never sends this
--      column, so a re-import cannot wipe it.
--      hotels_hotelrunner_url_check: NULL, or https, no whitespace, ≤ 2048 characters. No host
--      rule here: the link format is still pending, and the writer's allowed_hosts list can
--      change without a migration.
--   2. contact_events_action_check gains 'book' (a tap on "Rezervasyon Yap", module 'hotels').
--      Same DROP-then-ADD of the same name as 20261014 / 20261046 / 20261056, so the E-section
--      name token cannot see it; the H token asserts the definition. A pre-guard DERIVES the
--      live vocabulary and refuses unless it is exactly the six this file extends, printing the
--      live definition, so a drifted database is not silently overwritten.
--      contact_events_monthly filters only route_complete; 'book' is a tap-through like
--      call/website/maps and belongs in that figure, so the view is unchanged.
--
-- No RLS or policy change. ADD COLUMN ⇒ ends with NOTIFY pgrst.
-- Apply: gh workflow run supabase-migrate -f file=20261083_hotels_hotelrunner_booking.sql (dry,
-- then -f apply=true).
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── Pre-guard: the live action vocabulary is exactly the six this file extends ───────────
DO $$
DECLARE v_def text; v_set text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.contact_events'::regclass AND conname = 'contact_events_action_check';
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_set
    FROM regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''::text', 'g') AS m;
  IF v_set IS DISTINCT FROM ARRAY['book','call','call_secondary','maps','route_complete','website','whatsapp']
     AND v_set IS DISTINCT FROM ARRAY['call','call_secondary','maps','route_complete','website','whatsapp'] THEN
    RAISE EXCEPTION 'contact_events_action_check is not the expected six (or seven) actions; refusing to replace it. live set=% def=%',
      v_set, coalesce(v_def, '<missing>');
  END IF;
END $$;

-- ─── 1. hotels.hotelrunner_url ─────────────────────────────────────────────
ALTER TABLE public.hotels ADD COLUMN IF NOT EXISTS hotelrunner_url text;

ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_hotelrunner_url_check;
ALTER TABLE public.hotels ADD  CONSTRAINT hotels_hotelrunner_url_check
  CHECK (hotelrunner_url IS NULL OR (hotelrunner_url ~ '^https://\S+$' AND length(hotelrunner_url) <= 2048));

COMMENT ON COLUMN public.hotels.hotelrunner_url IS
  'HotelRunner booking link (partner since 2026-10-04): the "Rezervasyon Yap" button shows only when set. https, no whitespace, ≤ 2048 (hotels_hotelrunner_url_check). Written only by scripts/apply-hotelrunner-links.mjs from data/kitob/hotelrunner-links.json, which also clears it; the app adds ADA''s UTM parameters at tap time (utils/hotelBooking.js).';

-- ─── 2. contact_events: 'book' ─────────────────────────────────────────────
ALTER TABLE public.contact_events DROP CONSTRAINT IF EXISTS contact_events_action_check;
ALTER TABLE public.contact_events ADD CONSTRAINT contact_events_action_check
  CHECK (action IN ('call','whatsapp','call_secondary','website','maps','route_complete','book'));

-- ─── Assertions ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_def text; v_set text[]; v_id uuid; v_n int;
  v_probe uuid := '00000000-0000-4000-8000-0000000001b0';
  r_ok text := 'unset'; r_http text := 'unset'; r_space text := 'unset'; r_long text := 'unset';
  r_old text;
BEGIN
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'hotels';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'hotels carries % policies, expected 1', v_n; END IF;

  -- The action vocabulary is exactly the seven: the six that were there plus book.
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.contact_events'::regclass AND conname = 'contact_events_action_check';
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_set
    FROM regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''::text', 'g') AS m;
  IF v_set IS DISTINCT FROM ARRAY['book','call','call_secondary','maps','route_complete','website','whatsapp'] THEN
    RAISE EXCEPTION 'action CHECK is not the seven after the ADD. set=% def=%', v_set, v_def;
  END IF;

  -- 'book' lands for module hotels; a bogus action is refused (the negative control proves the
  -- CHECK is doing the work, not merely that something inserts).
  INSERT INTO public.contact_events (module, entity_id, action, region) VALUES ('hotels', v_probe, 'book', NULL);
  IF NOT EXISTS (SELECT 1 FROM public.contact_events WHERE entity_id = v_probe AND action = 'book' AND module = 'hotels') THEN
    RAISE EXCEPTION 'a hotels/book INSERT did not land';
  END IF;
  DELETE FROM public.contact_events WHERE entity_id = v_probe;
  BEGIN
    INSERT INTO public.contact_events (module, entity_id, action, region) VALUES ('hotels', v_probe, 'not_a_real_action', NULL);
    DELETE FROM public.contact_events WHERE entity_id = v_probe;
    RAISE EXCEPTION 'CONTROL FAILED: a bogus action was accepted — the CHECK is not enforcing';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- Every action that was already allowed still is.
  FOR r_old IN SELECT unnest(ARRAY['call','whatsapp','call_secondary','website','maps','route_complete']) LOOP
    INSERT INTO public.contact_events (module, entity_id, action, region) VALUES ('hotels', v_probe, r_old, NULL);
  END LOOP;
  DELETE FROM public.contact_events WHERE entity_id = v_probe;
  IF EXISTS (SELECT 1 FROM public.contact_events WHERE entity_id = v_probe) THEN
    RAISE EXCEPTION 'contact_events probe rows survived at entity_id %', v_probe;
  END IF;

  -- The URL CHECK, on a probe hotel inside a rollback.
  BEGIN
    INSERT INTO public.hotels (external_id, name, kitob_class, region, is_kitob_member, source_list_date, content_hash)
    VALUES ('kitob-zzhr83', 'zz hotelrunner probe', 'star3', 'kyrenia', true, DATE '2026-01-01', 'zz') RETURNING id INTO v_id;
    BEGIN
      UPDATE public.hotels SET hotelrunner_url = 'https://example.hotelrunner.com/bv3/search?a=1#x' WHERE id = v_id;
      r_ok := 'accepted';
    EXCEPTION WHEN check_violation THEN r_ok := 'REFUSED';
    END;
    BEGIN
      UPDATE public.hotels SET hotelrunner_url = 'http://example.hotelrunner.com/' WHERE id = v_id;
      r_http := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_http := 'refused';
    END;
    BEGIN
      UPDATE public.hotels SET hotelrunner_url = 'https://example.hotelrunner.com/a b' WHERE id = v_id;
      r_space := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_space := 'refused';
    END;
    BEGIN
      UPDATE public.hotels SET hotelrunner_url = 'https://x/' || repeat('a', 2050) WHERE id = v_id;
      r_long := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_long := 'refused';
    END;
    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  IF v_id IS NULL THEN RAISE EXCEPTION 'probe hotel was not created, nothing was tested'; END IF;
  IF r_ok    IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'an https HotelRunner link was %', r_ok; END IF;
  IF r_http  IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'an http link was %', r_http; END IF;
  IF r_space IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'a link with whitespace was %', r_space; END IF;
  IF r_long  IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'a link over 2048 characters was %', r_long; END IF;
  IF EXISTS (SELECT 1 FROM public.hotels WHERE external_id = 'kitob-zzhr83') THEN
    RAISE EXCEPTION 'probe hotel survived the rollback';
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
VALUES ('20261083_hotels_hotelrunner_booking.sql', '1efa1c297f76c4bc4727db8a192015d1363b575fe58a3f247ecb90c36477b6a4')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   supabase/verify_schema.sql QUERY 1: every 1083_hotels_hotelrunner row must read OK.
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   ALTER TABLE public.contact_events DROP CONSTRAINT contact_events_action_check;
--   ALTER TABLE public.contact_events ADD CONSTRAINT contact_events_action_check
--     CHECK (action IN ('call','whatsapp','call_secondary','website','maps','route_complete'));  -- fails if book rows exist: correct
--   ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_hotelrunner_url_check;
--   ALTER TABLE public.hotels DROP COLUMN IF EXISTS hotelrunner_url;
