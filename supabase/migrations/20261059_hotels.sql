-- ═══════════════════════════════════════════════════════════════════════════
-- 20261059 — hotels (KITOB member list): the Oteller tab's table, DARK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Source: KITOB (Kıbrıs Türk Otelciler Birliği). The list arrives as a CSV from KITOB and
-- is loaded by scripts/import-kitob-hotels.mjs. kitob.org is never fetched or scraped.
-- Plan: ~/ObsidianVault/10-ada/2026-09-29_hotels-kitob-PLAN.md.
--
-- ─── WHO CAN READ / WRITE ───────────────────────────────────────────────────
--   • READ: anyone (anon, signed-in, guest) sees a hotel only while is_active AND
--     delisted_at IS NULL. Nobody else sees anything, admins included.
--   • WRITE: nobody but service_role (the importer) and the SQL editor. INSERT/UPDATE/
--     DELETE are REVOKED from anon and authenticated; there is no write policy at all.
--     Hotels are edited through the importer only — no in-app editing, by decision.
--
-- ─── NO is_admin() IN THE READ POLICY — deliberately, unlike 20261048 ────────
-- There is no admin UI for hotels, and an admin is never a test identity (CLAUDE.md), so
-- an admin arm would only ever be used for the thing it must not be used for. Rows are
-- checked while dark with the service role / SQL editor; the device check happens after
-- the rows are activated (go-live SOP steps 2-4). Do not "restore" the arm for symmetry.
--
-- ─── TWO SWITCHES, TWO OWNERS ───────────────────────────────────────────────
--   is_active    ADMIN's publish switch. DEFAULT false (pre-launch rule). The importer
--                NEVER writes it, so a hotel that reappears on a later list cannot
--                republish itself, and a new hotel lands dark until someone reviews it.
--   delisted_at  The IMPORTER's switch. Stamped when a hotel is absent from the latest
--                KITOB list, cleared when it comes back. Never deleted: a KITOB list that
--                drops a member by mistake must be recoverable by the next file.
--
-- ─── THE KEY ────────────────────────────────────────────────────────────────
-- external_id (UNIQUE, the upsert arbiter): 'kitob-<member no>' when KITOB supplies a
-- member number, else 'kitob-<name slug>-<region>'. content_hash is NOT a key — it only
-- lets the importer skip rows that have not changed. Keying on it would duplicate a hotel
-- every time its phone number changed.
--
-- ─── is_kitob_member ────────────────────────────────────────────────────────
-- DEFAULT false, and a CHECK forces it true for every KITOB-sourced row. So the badge is
-- structurally true of what it claims, and a future non-KITOB source cannot claim it by
-- omission. ⚠ The BADGE itself stays off until KITOB gives written permission to use its
-- name (HOTELS_LIVE in constants/flags.js).
--
-- ─── contact_events: module 'hotels' ────────────────────────────────────────
-- Call / website / maps taps on a hotel card log as module='hotels', so a per-hotel report
-- for KITOB is one GROUP BY. Actions need nothing: call, website and maps exist already.
-- Same-name DROP/ADD, so verify_schema asserts the vocabulary as an exact set (1059 token);
-- the 0910 "exactly 12 modules" count token is retired in the same commit.
--
-- ─── WHAT THE HARNESS RUN PROVES ────────────────────────────────────────────
-- scripts/migration-harness.mjs is PGlite (PostgreSQL 18). A green run there is evidence
-- about privileges, RLS and CHECK behaviour on PG 18 only; prod is an older major.
--
-- Apply: SQL Editor, Role = postgres, whole file ONCE, copied from disk. Idempotent.
-- New table ⇒ ends with NOTIFY pgrst (after COMMIT).
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.hotels (
  id                uuid             NOT NULL DEFAULT gen_random_uuid(),
  external_id       text             NOT NULL,
  kitob_member_no   text,
  name              text             NOT NULL,
  kitob_class       text             NOT NULL,
  region            text             NOT NULL,
  address           text,
  phone             text,
  email             text,
  website           text,
  lat               double precision,
  lng               double precision,
  photo_url         text,
  is_kitob_member   boolean          NOT NULL DEFAULT false,
  source            text             NOT NULL DEFAULT 'kitob',
  source_list_date  date             NOT NULL,
  content_hash      text             NOT NULL,
  last_seen_at      timestamptz      NOT NULL DEFAULT now(),
  delisted_at       timestamptz,
  is_active         boolean          NOT NULL DEFAULT false,
  created_at        timestamptz      NOT NULL DEFAULT now(),
  updated_at        timestamptz      NOT NULL DEFAULT now(),
  CONSTRAINT hotels_pkey PRIMARY KEY (id)
);

-- Drop-then-add per constraint so the file stays re-runnable (house convention).
ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_external_id_key;
ALTER TABLE public.hotels ADD  CONSTRAINT hotels_external_id_key UNIQUE (external_id);

ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_external_id_check;
ALTER TABLE public.hotels ADD  CONSTRAINT hotels_external_id_check
  CHECK (external_id LIKE source || '-%' AND external_id ~ '^[a-z]+-[a-z0-9][a-z0-9-]*$');

ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_source_check;
ALTER TABLE public.hotels ADD  CONSTRAINT hotels_source_check CHECK (source IN ('kitob'));

-- KITOB's ten member classes as ASCII keys; labels live in constants/i18n.js (hotelClass*).
ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_kitob_class_check;
ALTER TABLE public.hotels ADD  CONSTRAINT hotels_kitob_class_check
  CHECK (kitob_class IN ('star5','star4','star3','star2','star1',
                         'bungalow','holiday_village','boutique','special_certified','apart'));

-- The seven canonical region keys — identical to REGIONS in constants/regions.js.
ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_region_check;
ALTER TABLE public.hotels ADD  CONSTRAINT hotels_region_check
  CHECK (region IN ('nicosia','kyrenia','famagusta','morphou','iskele','lefke','karpaz'));

ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_name_check;
ALTER TABLE public.hotels ADD  CONSTRAINT hotels_name_check
  CHECK (length(btrim(name)) BETWEEN 1 AND 200);

ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_kitob_member_check;
ALTER TABLE public.hotels ADD  CONSTRAINT hotels_kitob_member_check
  CHECK (source <> 'kitob' OR is_kitob_member);

ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_link_scheme_check;
ALTER TABLE public.hotels ADD  CONSTRAINT hotels_link_scheme_check
  CHECK ((website IS NULL OR website ~ '^https?://') AND (photo_url IS NULL OR photo_url ~ '^https://'));

-- Both or neither, and inside a box around the island: catches swapped lat/lng columns in
-- a CSV, which is the realistic defect.
ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_coords_check;
ALTER TABLE public.hotels ADD  CONSTRAINT hotels_coords_check
  CHECK ((lat IS NULL) = (lng IS NULL)
         AND (lat IS NULL OR (lat BETWEEN 34.5 AND 35.8 AND lng BETWEEN 32.2 AND 34.7)));

COMMENT ON TABLE public.hotels IS
  'KITOB member hotels, loaded from a KITOB-supplied CSV by scripts/import-kitob-hotels.mjs. '
  'Public read only while is_active (admin, DEFAULT false) AND delisted_at IS NULL (importer). '
  'Writes service_role only. See 20261059_hotels.sql.';
COMMENT ON COLUMN public.hotels.external_id IS
  'Upsert key: kitob-<member no>, else kitob-<name slug>-<region>. content_hash is NOT a key.';
COMMENT ON COLUMN public.hotels.delisted_at IS
  'Set by the importer when the hotel is absent from the latest KITOB list; cleared when it returns. Rows are never deleted.';
COMMENT ON COLUMN public.hotels.source_list_date IS
  'The date printed on the KITOB list the row came from. check-hotels-staleness.mjs reads it.';

-- updated_at moves only when content moves: last_seen_at is stamped on every row every run.
CREATE OR REPLACE FUNCTION public.hotels_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (to_jsonb(NEW) - 'updated_at' - 'last_seen_at')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'updated_at' - 'last_seen_at')
  THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS hotels_touch_updated_at ON public.hotels;
CREATE TRIGGER hotels_touch_updated_at
  BEFORE UPDATE ON public.hotels
  FOR EACH ROW EXECUTE FUNCTION public.hotels_touch_updated_at();

ALTER TABLE public.hotels ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.hotels FROM anon, authenticated;
GRANT SELECT ON TABLE public.hotels TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hotels TO service_role;
REVOKE ALL ON FUNCTION public.hotels_touch_updated_at() FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS hotels_select_public ON public.hotels;
CREATE POLICY hotels_select_public ON public.hotels
  FOR SELECT TO anon, authenticated
  USING (is_active AND delisted_at IS NULL);

-- ─── contact_events: permit module = 'hotels' ───────────────────────────────
ALTER TABLE public.contact_events DROP CONSTRAINT IF EXISTS contact_events_module_check;
ALTER TABLE public.contact_events ADD CONSTRAINT contact_events_module_check
  CHECK (module IN ('homeServices','grooming','garages','transport','insurance','pets',
                    'events','jobs','accommodation','studentHub','explore','towing','hotels'));

-- ─── Assertions. Each derives what it checks and prints what it read. ───────
DO $$
DECLARE
  v_h     regclass := to_regclass('public.hotels');
  v_n     int;
  v_names text;
  v_def   text;
  v_mods  text[];
  v_role  text;
  v_priv  text;
  v_id    uuid;
  v_probe uuid := '00000000-0000-4000-8000-0000000001f1';
  n_off int := -1; n_on int := -1; n_delisted int := -1;
  v_anon_write text := 'unset';
  v_bad_class  text := 'unset';
  v_bad_member text := 'unset';
  v_bad_coords text := 'unset';
  v_touch      text := 'unset';
  v_tap        text := 'unset';
  v_bad_module text := 'unset';
BEGIN
  IF v_h IS NULL THEN
    RAISE EXCEPTION 'public.hotels not visible to this DO block. Nothing committed; re-run the file as one paste.';
  END IF;

  IF (SELECT relrowsecurity FROM pg_class WHERE oid = v_h) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'RLS is not enabled on hotels';
  END IF;

  -- The FULL policy set: exactly one, SELECT, permissive. Permissive-OR means any second
  -- policy, whoever wrote it, would widen what it grants.
  SELECT count(*), coalesce(string_agg(policyname || ':' || cmd || ':' || permissive, ', '), '(none)')
    INTO v_n, v_names
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'hotels';
  IF v_n IS DISTINCT FROM 1 OR v_names IS DISTINCT FROM 'hotels_select_public:SELECT:PERMISSIVE' THEN
    RAISE EXCEPTION 'hotels must carry exactly ONE permissive SELECT policy; found %: %', v_n, v_names;
  END IF;

  -- Privileges, both directions. has_table_privilege resolves inherited grants.
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF NOT has_table_privilege(v_role, v_h, 'SELECT') THEN
      RAISE EXCEPTION '% lost SELECT on hotels — the public read would fail', v_role;
    END IF;
    FOREACH v_priv IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
      IF has_table_privilege(v_role, v_h, v_priv) THEN
        RAISE EXCEPTION '% still holds % on hotels', v_role, v_priv;
      END IF;
    END LOOP;
  END LOOP;
  FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
    IF NOT has_table_privilege('service_role', v_h, v_priv) THEN
      RAISE EXCEPTION 'service_role is missing % on hotels — the importer could not write', v_priv;
    END IF;
  END LOOP;

  IF (SELECT column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'hotels' AND column_name = 'is_active')
     IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'hotels.is_active must DEFAULT false (pre-launch rule)';
  END IF;

  -- The module vocabulary as an exact SET: a count would pass with a module swapped out.
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.contact_events'::regclass AND conname = 'contact_events_module_check';
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_mods
    FROM regexp_matches(coalesce(v_def, ''), '''([a-zA-Z]+)''::text', 'g') AS m;
  IF v_mods IS DISTINCT FROM ARRAY['accommodation','events','explore','garages','grooming','homeServices',
                                   'hotels','insurance','jobs','pets','studentHub','towing','transport'] THEN
    RAISE EXCEPTION 'contact_events_module_check is not the 13-module set incl. hotels. def=%', coalesce(v_def, '<missing>');
  END IF;

  -- ── BEHAVIOUR, rolled back by a sentinel. PL/pgSQL variables survive it; rows do not.
  BEGIN
    INSERT INTO public.hotels (external_id, name, kitob_class, region, is_kitob_member,
                               source_list_date, content_hash, updated_at)
    VALUES ('kitob-zzprobe', 'zz probe', 'star3', 'kyrenia', true,
            DATE '2026-01-01', 'zz', TIMESTAMPTZ '2000-01-01')
    RETURNING id INTO v_id;

    SET LOCAL ROLE anon;
    SELECT count(*) INTO n_off FROM public.hotels WHERE id = v_id;
    RESET ROLE;

    UPDATE public.hotels SET is_active = true WHERE id = v_id;
    SET LOCAL ROLE anon;
    SELECT count(*) INTO n_on FROM public.hotels WHERE id = v_id;
    RESET ROLE;

    -- A last_seen_at-only write must not move updated_at; the is_active write above did.
    UPDATE public.hotels SET updated_at = TIMESTAMPTZ '2000-01-01' WHERE id = v_id;
    -- NOT now(): that is the transaction timestamp, equal to the INSERT's DEFAULT, so the
    -- write would change nothing and the probe could not fail.
    UPDATE public.hotels SET last_seen_at = last_seen_at + interval '1 hour' WHERE id = v_id;
    SELECT CASE WHEN updated_at = TIMESTAMPTZ '2000-01-01' THEN 'still' ELSE 'moved' END INTO v_touch
      FROM public.hotels WHERE id = v_id;
    UPDATE public.hotels SET phone = '+90 548 000 00 00' WHERE id = v_id;
    SELECT v_touch || '/' || CASE WHEN updated_at = TIMESTAMPTZ '2000-01-01' THEN 'still' ELSE 'moved' END INTO v_touch
      FROM public.hotels WHERE id = v_id;

    UPDATE public.hotels SET delisted_at = now() WHERE id = v_id;
    SET LOCAL ROLE anon;
    SELECT count(*) INTO n_delisted FROM public.hotels WHERE id = v_id;
    BEGIN
      INSERT INTO public.hotels (external_id, name, kitob_class, region, is_kitob_member, source_list_date, content_hash)
      VALUES ('kitob-zzanon', 'x', 'star3', 'kyrenia', true, DATE '2026-01-01', 'x');
      v_anon_write := 'ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN v_anon_write := 'denied';
    END;
    -- The app's tap, as the app sends it (anon may INSERT contact_events).
    INSERT INTO public.contact_events (module, entity_id, action, region)
    VALUES ('hotels', v_probe, 'call', 'kyrenia');
    RESET ROLE;
    SELECT CASE WHEN EXISTS (SELECT 1 FROM public.contact_events
                              WHERE entity_id = v_probe AND module = 'hotels') THEN 'landed' ELSE 'missing' END
      INTO v_tap;

    -- Negative controls: each CHECK must refuse.
    BEGIN
      INSERT INTO public.hotels (external_id, name, kitob_class, region, is_kitob_member, source_list_date, content_hash)
      VALUES ('kitob-zzclass', 'x', 'six_star', 'kyrenia', true, DATE '2026-01-01', 'x');
      v_bad_class := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_class := 'refused';
    END;
    BEGIN
      INSERT INTO public.hotels (external_id, name, kitob_class, region, is_kitob_member, source_list_date, content_hash)
      VALUES ('kitob-zzmember', 'x', 'star3', 'kyrenia', false, DATE '2026-01-01', 'x');
      v_bad_member := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_member := 'refused';
    END;
    BEGIN
      -- lat/lng swapped, the realistic CSV defect.
      INSERT INTO public.hotels (external_id, name, kitob_class, region, is_kitob_member, source_list_date, content_hash, lat, lng)
      VALUES ('kitob-zzcoords', 'x', 'star3', 'kyrenia', true, DATE '2026-01-01', 'x', 33.3, 35.3);
      v_bad_coords := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_coords := 'refused';
    END;
    BEGIN
      INSERT INTO public.contact_events (module, entity_id, action, region)
      VALUES ('not_a_module', v_probe, 'call', NULL);
      v_bad_module := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_module := 'refused';
    END;

    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  IF v_id IS NULL THEN RAISE EXCEPTION 'probe: the hotel INSERT produced no row, so nothing below was tested'; END IF;
  IF n_off      IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'an INACTIVE hotel is readable by anon (% rows) — dark launch is broken', n_off; END IF;
  IF n_on       IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'an ACTIVE hotel is not readable by anon (% rows) — go-live would show nothing', n_on; END IF;
  IF n_delisted IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'a DELISTED hotel is readable by anon (% rows)', n_delisted; END IF;
  IF v_anon_write IS DISTINCT FROM 'denied'  THEN RAISE EXCEPTION 'anon INSERT into hotels was %', v_anon_write; END IF;
  IF v_touch      IS DISTINCT FROM 'still/moved' THEN RAISE EXCEPTION 'hotels_touch_updated_at: last_seen_at-only/content write gave % (expect still/moved)', v_touch; END IF;
  IF v_tap        IS DISTINCT FROM 'landed'  THEN RAISE EXCEPTION 'an anon hotels/call tap was %', v_tap; END IF;
  IF v_bad_class  IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'CONTROL FAILED: kitob_class six_star was %', v_bad_class; END IF;
  IF v_bad_member IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'CONTROL FAILED: a kitob row with is_kitob_member=false was %', v_bad_member; END IF;
  IF v_bad_coords IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'CONTROL FAILED: swapped lat/lng was %', v_bad_coords; END IF;
  IF v_bad_module IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'CONTROL FAILED: contact_events module not_a_module was %', v_bad_module; END IF;
  IF EXISTS (SELECT 1 FROM public.hotels WHERE external_id LIKE 'kitob-zz%')
     OR EXISTS (SELECT 1 FROM public.contact_events WHERE entity_id = v_probe) THEN
    RAISE EXCEPTION 'probe rows survived the rollback';
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
VALUES ('20261059_hotels.sql', '993f876277b90f8bbf71d448544e718180e866b6162b467d3fb13f75db1a0600')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: every 1059_hotels row must read OK.
--   SELECT policyname, cmd, roles, qual FROM pg_policies WHERE tablename = 'hotels';
--   -- expect 1 row: hotels_select_public | SELECT | {anon,authenticated} | (is_active AND (delisted_at IS NULL))
--
-- ─── Rollback (only if hotels are abandoned, and only with no 'hotels' taps logged) ──
--   DROP TABLE IF EXISTS public.hotels;
--   DROP FUNCTION IF EXISTS public.hotels_touch_updated_at();
--   ALTER TABLE public.contact_events DROP CONSTRAINT contact_events_module_check;
--   ALTER TABLE public.contact_events ADD CONSTRAINT contact_events_module_check
--     CHECK (module IN ('homeServices','grooming','garages','transport','insurance','pets',
--                       'events','jobs','accommodation','studentHub','explore','towing'));
