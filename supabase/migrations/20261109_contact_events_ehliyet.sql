-- ═══════════════════════════════════════════════════════════════════════════
-- 20261109 — contact_events: module 'ehliyet' + actions 'instagram','facebook','email'   (OPTIONAL, standalone)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- TO DROP THIS CHANGE (Berke has not decided whether to keep it):
--   1. Delete this file and scripts/test-contact-events-ehliyet-sql.mjs; in supabase/verify_schema.sql delete
--      the block between "EHLIYET-CONTACT-EVENTS:BEGIN" and ":END" and the one line tagged ":supersede".
--      That restores BOTH checks to what 20261083 left: contact_events_module_check = the 13 modules and
--      contact_events_action_check = call, whatsapp, call_secondary, website, maps, route_complete, book.
--   2. Regenerate: node scripts/migration-ledger.mjs && npm run drift:regen
--   3. App side: set EHLIYET_LOGS_CONTACTS = false in constants/ehliyet.js.
--
-- Depends on NOTHING from 20261108 (driving_schools): its probes use a random uuid for entity_id
-- (contact_events.entity_id has no foreign key by design, 20260910).
--
-- ─── WHO CAN READ / WRITE ───────────────────────────────────────────────────
-- Unchanged. contact_events stays insert-only for anon + authenticated (column-limited grant,
-- no identifier column), readable only by admin; this file only widens two vocabularies so the app can
-- log a driving school's taps: module gains 'ehliyet'; action gains 'instagram', 'facebook' and 'email'
-- (one value per channel, so partner reports can count each channel separately; Instagram does not
-- share 'website').
--
-- Both CHECKs are re-added as static literal lists. contact_events_module_check: pre-state (live def)
-- asserted equal to the 13-module set 20261059 left, post-state that set + 'ehliyet'.
-- contact_events_action_check: pre-state asserted equal to the seven 20261083 left (call, whatsapp,
-- call_secondary, website, maps, route_complete, book), post-state those + instagram, facebook, email.
--
-- contact_events_monthly (20261056) is unchanged: it excludes only 'route_complete' and has dedicated
-- columns for call / whatsapp / call_secondary only, so the new actions count in `taps` exactly as
-- website / maps / book already do.
--
-- Apply: gh workflow run supabase-migrate -f file=20261109_contact_events_ehliyet.sql (dry), then
-- -f apply=true.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- Pre-state: abort unless the live CHECK is exactly the 13-module set 20261059 left.
DO $$
DECLARE
  v_def  text;
  v_old  text[];
  v_want_old constant text[] := ARRAY['accommodation','events','explore','garages','grooming','homeServices',
                                      'hotels','insurance','jobs','pets','studentHub','towing','transport'];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.contact_events'::regclass AND conname = 'contact_events_module_check';
  SELECT array_agg(DISTINCT m[1]) INTO v_old
    FROM regexp_matches(coalesce(v_def, ''), '''([a-zA-Z]+)''::text', 'g') AS m;
  IF v_old IS NULL OR NOT (v_old @> v_want_old AND v_old <@ v_want_old) THEN
    RAISE EXCEPTION 'contact_events_module_check drifted from the 13-module set (20261059). live def=%', coalesce(v_def, '<missing>');
  END IF;
END $$;

-- Pre-state: abort unless the live action CHECK is exactly the seven 20261083 left.
DO $$
DECLARE
  v_def  text;
  v_set  text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.contact_events'::regclass AND conname = 'contact_events_action_check';
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_set
    FROM regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''::text', 'g') AS m;
  IF v_set IS DISTINCT FROM ARRAY['book','call','call_secondary','maps','route_complete','website','whatsapp'] THEN
    RAISE EXCEPTION 'contact_events_action_check drifted from the seven actions (20261083). live set=% def=%', v_set, coalesce(v_def, '<missing>');
  END IF;
END $$;

-- Static on purpose: scripts/audit-schema-drift.mjs reads CHECK literals from this file.
ALTER TABLE public.contact_events DROP CONSTRAINT contact_events_module_check;
ALTER TABLE public.contact_events ADD CONSTRAINT contact_events_module_check
  CHECK (module IN ('accommodation','events','explore','garages','grooming','homeServices','hotels',
                    'insurance','jobs','pets','studentHub','towing','transport','ehliyet'));

ALTER TABLE public.contact_events DROP CONSTRAINT contact_events_action_check;
ALTER TABLE public.contact_events ADD CONSTRAINT contact_events_action_check
  CHECK (action IN ('call','whatsapp','call_secondary','website','maps','route_complete','book',
                    'instagram','facebook','email'));

DO $$
DECLARE
  v_def  text;
  v_new  text[];
  v_want_new constant text[] := ARRAY['accommodation','events','explore','garages','grooming','homeServices',
                                      'hotels','insurance','jobs','pets','studentHub','towing','transport','ehliyet'];
  v_adef   text;
  v_aset   text[];
  v_probe  uuid := gen_random_uuid();
  v_ce_ok  text := 'not run';
  v_ce_bad text := 'not run';
  v_ig     text := 'not run';
  v_fb     text := 'not run';
  v_em     text := 'not run';
  v_act_bad text := 'not run';
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.contact_events'::regclass AND conname = 'contact_events_module_check';
  SELECT array_agg(DISTINCT m[1]) INTO v_new
    FROM regexp_matches(coalesce(v_def, ''), '''([a-zA-Z]+)''::text', 'g') AS m;
  IF v_new IS NULL OR NOT (v_new @> v_want_new AND v_new <@ v_want_new) THEN
    RAISE EXCEPTION 'contact_events_module_check post-state is not old + ehliyet. def=%', coalesce(v_def, '<missing>');
  END IF;
  RAISE NOTICE 'contact_events_module_check now: %', v_def;

  SELECT pg_get_constraintdef(oid) INTO v_adef FROM pg_constraint
   WHERE conrelid = 'public.contact_events'::regclass AND conname = 'contact_events_action_check';
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_aset
    FROM regexp_matches(coalesce(v_adef, ''), '''([a-z_]+)''::text', 'g') AS m;
  IF v_aset IS DISTINCT FROM ARRAY['book','call','call_secondary','email','facebook','instagram','maps','route_complete','website','whatsapp'] THEN
    RAISE EXCEPTION 'contact_events_action_check post-state is not the seven + instagram/facebook/email. set=% def=%', v_aset, coalesce(v_adef, '<missing>');
  END IF;
  RAISE NOTICE 'contact_events_action_check now: %', v_adef;

  -- Probes run in a sub-block that always rolls back, so no row survives. Positive: ehliyet is
  -- accepted. Control: a made-up module is still refused (the CHECK was not simply dropped).
  BEGIN
    BEGIN
      INSERT INTO public.contact_events (module, entity_id, action) VALUES ('ehliyet', v_probe, 'call');
      v_ce_ok := 'accepted';
    EXCEPTION WHEN check_violation THEN v_ce_ok := 'REFUSED';
    END;
    BEGIN
      INSERT INTO public.contact_events (module, entity_id, action) VALUES ('zzmodule', v_probe, 'call');
      v_ce_bad := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_ce_bad := 'refused';
    END;
    BEGIN
      INSERT INTO public.contact_events (module, entity_id, action) VALUES ('ehliyet', v_probe, 'instagram');
      v_ig := 'accepted';
    EXCEPTION WHEN check_violation THEN v_ig := 'REFUSED';
    END;
    BEGIN
      INSERT INTO public.contact_events (module, entity_id, action) VALUES ('ehliyet', v_probe, 'facebook');
      v_fb := 'accepted';
    EXCEPTION WHEN check_violation THEN v_fb := 'REFUSED';
    END;
    BEGIN
      INSERT INTO public.contact_events (module, entity_id, action) VALUES ('ehliyet', v_probe, 'email');
      v_em := 'accepted';
    EXCEPTION WHEN check_violation THEN v_em := 'REFUSED';
    END;
    BEGIN
      INSERT INTO public.contact_events (module, entity_id, action) VALUES ('ehliyet', v_probe, 'zzaction');
      v_act_bad := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_act_bad := 'refused';
    END;
    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  IF v_ce_ok  IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'contact_events module ehliyet was %', v_ce_ok; END IF;
  IF v_ce_bad IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'CONTROL FAILED: unknown contact_events module was %', v_ce_bad; END IF;
  IF v_ig IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'contact_events action instagram was %', v_ig; END IF;
  IF v_fb IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'contact_events action facebook was %', v_fb; END IF;
  IF v_em IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'contact_events action email was %', v_em; END IF;
  IF v_act_bad IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'CONTROL FAILED: unknown contact_events action was %', v_act_bad; END IF;
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
VALUES ('20261109_contact_events_ehliyet.sql', 'abf95c2aef0777dc9a88c6fefd1413e71162361dc2c3545bdc78cb1b66039836')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: the 1109_contact_events_ehliyet rows (module set, action set) must read OK.
--
-- ─── Rollback (only with no 'ehliyet' / instagram / facebook / email taps logged) ───
--   ALTER TABLE public.contact_events DROP CONSTRAINT contact_events_action_check;
--   ALTER TABLE public.contact_events ADD CONSTRAINT contact_events_action_check
--     CHECK (action IN ('call','whatsapp','call_secondary','website','maps','route_complete','book'));
--   ALTER TABLE public.contact_events DROP CONSTRAINT contact_events_module_check;
--   ALTER TABLE public.contact_events ADD CONSTRAINT contact_events_module_check
--     CHECK (module IN ('homeServices','grooming','garages','transport','insurance','pets',
--                       'events','jobs','accommodation','studentHub','explore','towing','hotels'));
