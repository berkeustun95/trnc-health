-- ═══════════════════════════════════════════════════════════════════════════
-- 20261154 — contact_events: module 'dovec'
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The Döveç partner page logs every Call / WhatsApp tap as an anonymous contact event, one per
-- project: module = 'dovec', entity_id = property_projects.id, action = 'call' | 'whatsapp'.
-- The per-project numbers we report to Döveç come from contact_events_monthly (WHERE module =
-- 'dovec'): a COUNT of taps, never a person. No identifier is added (20260910 rule two).
--
-- ─── WHO CAN READ / WRITE ───────────────────────────────────────────────────
-- Unchanged. contact_events stays insert-only for anon + authenticated (column-limited grant),
-- readable only by admins. This file only widens the module vocabulary by one value.
--
-- Pre-state asserted equal to the 16-module set 20261115 left; post-state that set + 'dovec'.
-- Independent of 20261153 (entity_id has no foreign key by design, 20260910).
--
-- Apply: gh workflow run supabase-migrate -f file=20261154_contact_events_dovec.sql (dry), then
-- -f apply=true. Then verify_schema.sql QUERY 1: the 1154 row must read OK.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  v_def  text;
  v_old  text[];
  v_want_old constant text[] := ARRAY['accommodation','events','explore','garages','grooming','homeServices','hotels',
                                      'insurance','jobs','pets','studentHub','towing','transport','ehliyet','connectivity','eatery'];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.contact_events'::regclass AND conname = 'contact_events_module_check';
  SELECT array_agg(DISTINCT m[1]) INTO v_old
    FROM regexp_matches(coalesce(v_def, ''), '''([a-zA-Z]+)''::text', 'g') AS m;
  IF v_old IS NULL OR NOT (v_old @> v_want_old AND v_old <@ v_want_old) THEN
    RAISE EXCEPTION 'contact_events_module_check drifted from the 16-module set (20261115). live def=%', coalesce(v_def, '<missing>');
  END IF;
END $$;

-- Static on purpose: scripts/audit-schema-drift.mjs reads CHECK literals from this file.
ALTER TABLE public.contact_events DROP CONSTRAINT contact_events_module_check;
ALTER TABLE public.contact_events ADD CONSTRAINT contact_events_module_check
  CHECK (module IN ('accommodation','events','explore','garages','grooming','homeServices','hotels',
                    'insurance','jobs','pets','studentHub','towing','transport','ehliyet','connectivity','eatery','dovec'));

DO $$
DECLARE
  v_def  text;
  v_new  text[];
  v_want_new constant text[] := ARRAY['accommodation','events','explore','garages','grooming','homeServices','hotels',
                                      'insurance','jobs','pets','studentHub','towing','transport','ehliyet','connectivity','eatery','dovec'];
  v_probe  uuid := gen_random_uuid();
  v_call   text := 'not run';
  v_wa     text := 'not run';
  v_bad    text := 'not run';
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.contact_events'::regclass AND conname = 'contact_events_module_check';
  SELECT array_agg(DISTINCT m[1]) INTO v_new
    FROM regexp_matches(coalesce(v_def, ''), '''([a-zA-Z]+)''::text', 'g') AS m;
  IF v_new IS NULL OR NOT (v_new @> v_want_new AND v_new <@ v_want_new) THEN
    RAISE EXCEPTION 'contact_events_module_check post-state is not old + dovec. def=%', coalesce(v_def, '<missing>');
  END IF;

  -- Probes in a sub-block that always rolls back. Positive: both actions the page sends are
  -- accepted for 'dovec'. Control: a made-up module is still refused.
  BEGIN
    BEGIN
      INSERT INTO public.contact_events (module, entity_id, action) VALUES ('dovec', v_probe, 'call');
      v_call := 'accepted';
    EXCEPTION WHEN check_violation THEN v_call := 'REFUSED';
    END;
    BEGIN
      INSERT INTO public.contact_events (module, entity_id, action) VALUES ('dovec', v_probe, 'whatsapp');
      v_wa := 'accepted';
    EXCEPTION WHEN check_violation THEN v_wa := 'REFUSED';
    END;
    BEGIN
      INSERT INTO public.contact_events (module, entity_id, action) VALUES ('zzmodule', v_probe, 'call');
      v_bad := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad := 'refused';
    END;
    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;
  IF v_call IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'contact_events dovec/call was %', v_call; END IF;
  IF v_wa   IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'contact_events dovec/whatsapp was %', v_wa; END IF;
  IF v_bad  IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'CONTROL FAILED: unknown contact_events module was %', v_bad; END IF;
  IF EXISTS (SELECT 1 FROM public.contact_events WHERE entity_id = v_probe) THEN
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
VALUES ('20261154_contact_events_dovec.sql', '8926e044311e07e4dd2d28d48e55f431817aa79d24c7257e9fa42f2cb0efb431')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- ─── Rollback (only with no 'dovec' taps logged) ────────────────────────────
--   ALTER TABLE public.contact_events DROP CONSTRAINT contact_events_module_check;
--   ALTER TABLE public.contact_events ADD CONSTRAINT contact_events_module_check
--     CHECK (module IN ('accommodation','events','explore','garages','grooming','homeServices','hotels',
--                       'insurance','jobs','pets','studentHub','towing','transport','ehliyet','connectivity','eatery'));
