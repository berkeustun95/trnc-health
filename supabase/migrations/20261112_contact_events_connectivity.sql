-- ═══════════════════════════════════════════════════════════════════════════
-- 20261112 — contact_events: module 'connectivity' + nullable `lang` column (Berke 2026-10-14)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ADA's own count of KKTCELL handoff taps, so the lead number does not depend on KKTCELL's.
-- The tap goes through the existing anonymous counter (utils/logContactEvent.js), like the
-- HotelRunner 'book' button: module 'connectivity', entity_id = the package id (operator by join),
-- action 'website' (a web page opens; already in the action CHECK, so that CHECK is untouched).
--
-- `lang` is the app language at tap time, stored as the FULL ENGLISH NAME (LANGUAGES keys in
-- constants/i18n.js); the CHECK refuses ISO codes ('tr'), which would otherwise match nothing,
-- silently. NULLABLE: every existing caller sends no lang, and queued outbox taps from before this
-- file carry none.
--
-- ANONYMITY (20260910's contract): the risk is a RECURRING KEY. `lang` is nine values and is not a
-- key: same class as `region`. This is the first non-region attribute on the counter; it was asked
-- for (Berke, 2026-10-14).
--
-- Who can do what (unchanged except one column): anon and authenticated may INSERT module,
-- entity_id, action, region, id and now lang; nobody but admin reads (RLS, 20260910); nobody updates
-- or deletes. created_at stays unwritable.
--
-- Static on purpose: scripts/audit-schema-drift.mjs reads CHECK literals from this file.
--
-- Undo:
--   REVOKE INSERT (lang) ON public.contact_events FROM anon, authenticated;
--   ALTER TABLE public.contact_events DROP COLUMN lang;
--   ALTER TABLE public.contact_events DROP CONSTRAINT contact_events_module_check;
--   ALTER TABLE public.contact_events ADD CONSTRAINT contact_events_module_check
--     CHECK (module IN ('accommodation','events','explore','garages','grooming','homeServices','hotels',
--                       'insurance','jobs','pets','studentHub','towing','transport','ehliyet'));
--
-- Apply: gh workflow run supabase-migrate -f file=20261112_contact_events_connectivity.sql (dry),
-- then -f apply=true. Then supabase/verify_schema.sql QUERY 1: the 1112 rows must read OK.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- Pre-state: abort unless the live module CHECK is exactly the 14-module set 20261109 left.
DO $$
DECLARE
  v_def  text;
  v_set  text[];
  v_want constant text[] := ARRAY['accommodation','events','explore','garages','grooming','homeServices',
                                  'hotels','insurance','jobs','pets','studentHub','towing','transport','ehliyet'];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.contact_events'::regclass AND conname = 'contact_events_module_check';
  SELECT array_agg(DISTINCT m[1]) INTO v_set
    FROM regexp_matches(coalesce(v_def, ''), '''([a-zA-Z]+)''::text', 'g') AS m;
  IF v_set IS NULL OR NOT (v_set @> v_want AND v_set <@ v_want) THEN
    RAISE EXCEPTION 'contact_events_module_check drifted from the 14-module set (20261109). live def=%', coalesce(v_def, '<missing>');
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'contact_events' AND column_name = 'lang') THEN
    RAISE EXCEPTION 'contact_events.lang already exists';
  END IF;
END $$;

ALTER TABLE public.contact_events DROP CONSTRAINT contact_events_module_check;
ALTER TABLE public.contact_events ADD CONSTRAINT contact_events_module_check
  CHECK (module IN ('accommodation','events','explore','garages','grooming','homeServices','hotels',
                    'insurance','jobs','pets','studentHub','towing','transport','ehliyet','connectivity'));

ALTER TABLE public.contact_events ADD COLUMN lang text;
ALTER TABLE public.contact_events ADD CONSTRAINT contact_events_lang_check
  CHECK (lang IS NULL OR lang IN ('English','Turkish','Arabic','Russian','Greek','French','Spanish','German','Persian'));

GRANT INSERT (lang) ON public.contact_events TO anon, authenticated;

COMMENT ON COLUMN public.contact_events.lang IS
  'App language at tap time, full English name (constants/i18n.js LANGUAGES). Nine values, never a key. NULL = not recorded (every module but connectivity). 20261112.';

DO $$
DECLARE
  v_def   text;
  v_set   text[];
  v_want  constant text[] := ARRAY['accommodation','events','explore','garages','grooming','homeServices',
                                   'hotels','insurance','jobs','pets','studentHub','towing','transport','ehliyet','connectivity'];
  v_probe uuid := gen_random_uuid();
  v_conn     text := 'not run';
  v_bad_mod  text := 'not run';
  v_lang_ok  text := 'not run';
  v_lang_iso text := 'not run';
  v_lang_nul text := 'not run';
  v_anon     text := 'not run';
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.contact_events'::regclass AND conname = 'contact_events_module_check';
  SELECT array_agg(DISTINCT m[1]) INTO v_set
    FROM regexp_matches(coalesce(v_def, ''), '''([a-zA-Z]+)''::text', 'g') AS m;
  IF v_set IS NULL OR NOT (v_set @> v_want AND v_set <@ v_want) THEN
    RAISE EXCEPTION 'contact_events_module_check post-state is not old + connectivity. def=%', coalesce(v_def, '<missing>');
  END IF;

  -- Grants from the catalog: lang writable by both client roles; created_at still by neither,
  -- and anon still cannot read (positive control beside the new grant).
  IF NOT (has_column_privilege('anon', 'public.contact_events', 'lang', 'INSERT')
      AND has_column_privilege('authenticated', 'public.contact_events', 'lang', 'INSERT')) THEN
    RAISE EXCEPTION 'lang is not insertable by anon and authenticated';
  END IF;
  IF has_column_privilege('anon', 'public.contact_events', 'created_at', 'INSERT')
     OR has_column_privilege('authenticated', 'public.contact_events', 'created_at', 'INSERT')
     OR has_table_privilege('anon', 'public.contact_events', 'SELECT') THEN
    RAISE EXCEPTION 'contact_events grants widened: created_at insertable or anon can read';
  END IF;

  -- Probes in a sub-block that always rolls back, so no row survives. The tap insert runs AS ANON,
  -- the role the app holds, with exactly the columns the app sends.
  BEGIN
    BEGIN
      SET LOCAL ROLE anon;
      INSERT INTO public.contact_events (id, module, entity_id, action, region, lang)
      VALUES (gen_random_uuid(), 'connectivity', v_probe, 'website', NULL, 'Turkish');
      SET LOCAL ROLE postgres;
      v_anon := 'accepted';
    EXCEPTION WHEN OTHERS THEN SET LOCAL ROLE postgres; v_anon := 'REFUSED: ' || SQLERRM;
    END;
    BEGIN
      INSERT INTO public.contact_events (module, entity_id, action) VALUES ('connectivity', v_probe, 'website');
      v_conn := 'accepted';
    EXCEPTION WHEN check_violation THEN v_conn := 'REFUSED';
    END;
    BEGIN
      INSERT INTO public.contact_events (module, entity_id, action) VALUES ('zzmodule', v_probe, 'website');
      v_bad_mod := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_mod := 'refused';
    END;
    BEGIN
      INSERT INTO public.contact_events (module, entity_id, action, lang) VALUES ('connectivity', v_probe, 'website', 'Persian');
      v_lang_ok := 'accepted';
    EXCEPTION WHEN check_violation THEN v_lang_ok := 'REFUSED';
    END;
    BEGIN
      INSERT INTO public.contact_events (module, entity_id, action, lang) VALUES ('connectivity', v_probe, 'website', 'tr');
      v_lang_iso := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_lang_iso := 'refused';
    END;
    BEGIN
      INSERT INTO public.contact_events (module, entity_id, action, lang) VALUES ('hotels', v_probe, 'book', NULL);
      v_lang_nul := 'accepted';
    EXCEPTION WHEN check_violation THEN v_lang_nul := 'REFUSED';
    END;
    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  IF v_anon     IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'anon connectivity tap with lang was %', v_anon; END IF;
  IF v_conn     IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'module connectivity was %', v_conn; END IF;
  IF v_bad_mod  IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'CONTROL FAILED: unknown module was %', v_bad_mod; END IF;
  IF v_lang_ok  IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'lang Persian was %', v_lang_ok; END IF;
  IF v_lang_iso IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'CONTROL FAILED: ISO lang tr was %', v_lang_iso; END IF;
  IF v_lang_nul IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'NULL lang (every other module) was %', v_lang_nul; END IF;
  IF EXISTS (SELECT 1 FROM public.contact_events WHERE entity_id = v_probe) THEN
    RAISE EXCEPTION 'probe rows survived';
  END IF;

  RAISE NOTICE 'contact_events_module_check now: %', v_def;
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
VALUES ('20261112_contact_events_connectivity.sql', '9037a1c56e4751e007464475f19ae399c7e3436194a4542c72f293dd0926f5b4')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;
NOTIFY pgrst, 'reload schema';
