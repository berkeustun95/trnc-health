-- ═══════════════════════════════════════════════════════════════════════════
-- 20261209 — places: photo credits become provenance (only a no-session writer sets them)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Security finding: RLS places_update (20260822) lets a place's submitter, its provider and
-- admins UPDATE the row, and places_guard_update (20260825) is a deny-list that never named
-- photo_attribution (jsonb, 20260917) or photo_credits (text[], 20260822). So a signed-in owner
-- could write any licence / credit text onto their own place through PostgREST — a forged
-- "Photo: <someone> / CC BY-SA" line, or a wiped one. places_insert (submitted_by = auth.uid()
-- AND status = 'pending') let them do the same on INSERT, with any value in these two columns.
--
-- ─── WHO CAN WRITE photo_attribution / photo_credits AFTER THIS FILE ────────
--
-- ONLY a writer with no session (auth.uid() is null): service_role (the explore-photos
-- workflow running scripts/seed-explore-photos.mjs), migrations and the SQL editor as postgres.
-- Every caller WITH a session — customer, provider, guest AND admin — gets the same treatment
-- as source / source_id in 20261045: an INSERT is born with both columns NULL, and an UPDATE
-- keeps whatever the row already held. Reads are unchanged (the app selects both columns).
--
-- Admins are included on purpose, exactly as 20261045 explains for provenance: no app screen
-- writes these columns (ExploreSubmitScreen sends neither on its INSERT, resubmit_place does
-- not touch them, AdminScreen only reads places), and the only writers that should are scripts
-- and migrations, which run with no session.
--
-- It COERCES rather than raises, like places_guard_source and places_guard_insert: no client
-- sends these columns, so an error could only break an app flow that writes a whole row back
-- unchanged. The write is silently kept at its old value.
--
-- ─── WHY THE EXISTING places_guard_source, NOT A NEW TRIGGER OR places_guard_update ──
--
-- places_guard_update RETURNS EARLY on its trusted-write GUCs (app.trusted_place_write,
-- app.trusted_place_resubmit), so a lock inside it would be skipped on those paths;
-- places_guard_source has no GUC escape, so even resubmit_place (SECURITY DEFINER, but
-- auth.uid() is still the caller) cannot touch credits. The trigger places_guard_source
-- (BEFORE INSERT OR UPDATE, FOR EACH ROW) already exists and is NOT recreated: only the function
-- body changes (CREATE OR REPLACE), and the source / source_id lines are byte-identical to
-- 20261045. No new trigger also keeps 20261207's count of INSERT-firing triggers on places true.
--
-- No ADD COLUMN here, so no NOTIFY pgrst is needed.
-- Apply: via supabase-migrate. Idempotent; re-runnable. Nothing in this file reads or writes
-- a real row: every probe row is rolled back by a sentinel exception.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.places_guard_source()
 RETURNS trigger LANGUAGE plpgsql AS $function$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    new.source    := null;
    new.source_id := null;
    new.photo_attribution := null;
    new.photo_credits := null;
  else
    new.source    := old.source;
    new.source_id := old.source_id;
    new.photo_attribution := old.photo_attribution;
    new.photo_credits := old.photo_credits;
  end if;
  return new;
end $function$;

-- ─── Assertions. Each derives what it checks and prints what it read. ───────
DO $$
DECLARE
  v_cols     text;
  v_def      text;
  v_fn       text;
  v_uid      uuid := gen_random_uuid();   -- a session that is nobody: owns nothing
  v_id       uuid;
  v_attr0    jsonb := '{"zz-url-0":{"credit":"zz seed credit"}}'::jsonb;
  v_attr1    jsonb := '{"zz-url-1":{"credit":"zz forged credit"}}'::jsonb;
  v_cred0    text[] := ARRAY['zz seed credit'];
  v_cred1    text[] := ARRAY['zz forged credit'];
  -- reads, one pair per step ('unset' / NULL are both reachable, so each has its own flag)
  v_seed_a   jsonb;  v_seed_c   text[];
  v_ins_a    jsonb;  v_ins_c    text[];  v_ins_src text := 'unset';  v_ins_sid text := 'unset';
  v_upd_a    jsonb;  v_upd_c    text[];
  v_clr_a    jsonb;  v_clr_c    text[];
  v_clrt_a   jsonb;  v_clrt_c   text[];
  v_name     text;
  v_svc_a    jsonb;  v_svc_c    text[];
  v_svcins_a jsonb;  v_svcins_c text[];
  v_ins_id   uuid;
  v_seed_ok  boolean := false;
BEGIN
  SELECT string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '-'),
                    ', ' ORDER BY column_name) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'places' AND column_name IN ('photo_attribution','photo_credits');
  IF v_cols IS DISTINCT FROM 'photo_attribution:jsonb:YES:-, photo_credits:ARRAY:YES:-' THEN
    RAISE EXCEPTION 'places photo columns are not nullable with no default as this file assumes (the guard NULLs them on INSERT); found: %', coalesce(v_cols,'(none)');
  END IF;

  SELECT pg_get_triggerdef(t.oid) INTO v_def FROM pg_trigger t
   WHERE t.tgrelid = 'public.places'::regclass AND t.tgname = 'places_guard_source' AND NOT t.tgisinternal;
  IF v_def IS NULL OR v_def NOT LIKE '%BEFORE INSERT OR UPDATE ON %places FOR EACH ROW EXECUTE FUNCTION %places_guard_source()%' THEN
    RAISE EXCEPTION 'places_guard_source trigger missing or wrong shape; found: %', coalesce(v_def,'(missing)');
  END IF;

  v_fn := pg_get_functiondef('public.places_guard_source()'::regprocedure);
  IF v_fn NOT LIKE '%new.source    := null;%' OR v_fn NOT LIKE '%new.source_id := old.source_id;%'
     OR v_fn NOT LIKE '%new.photo_attribution := old.photo_attribution;%'
     OR v_fn NOT LIKE '%new.photo_credits := null;%' THEN
    RAISE EXCEPTION 'places_guard_source body is not the extended shape; found: %', v_fn;
  END IF;

  -- ── BEHAVIOUR. A probe that ends in a sentinel exception: every row it writes is rolled
  -- back to the savepoint. PL/pgSQL variables survive that rollback; rows do not.
  -- Role stays postgres, so RLS is not in play: this isolates the TRIGGER. If the new lines
  -- were absent, the session reads below would show the forged values.
  BEGIN
    -- No session (service_role / importer / editor): seed the row's starting values.
    PERFORM set_config('request.jwt.claims', '', true);
    INSERT INTO public.places (category, name, region, photo_attribution, photo_credits)
    VALUES ('monument', 'zz credit probe', 'kyrenia', v_attr0, v_cred0)
    RETURNING id, photo_attribution, photo_credits INTO v_id, v_svcins_a, v_svcins_c;

    -- Read the seeded row back from the table (not RETURNING): what is stored, before any session acts.
    SELECT photo_attribution, photo_credits INTO v_seed_a, v_seed_c FROM public.places WHERE id = v_id;

    -- Session: an INSERT carrying credits and source comes back NULL / NULL.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    INSERT INTO public.places (category, name, region, source, source_id, photo_attribution, photo_credits)
    VALUES ('monument', 'zz credit probe session', 'kyrenia', 'visitncy', 'zz-credit-probe-1', v_attr1, v_cred1)
    RETURNING id, photo_attribution, photo_credits, source, source_id
         INTO v_ins_id, v_ins_a, v_ins_c, v_ins_src, v_ins_sid;

    -- Session: an UPDATE that sets both leaves the seeded values.
    UPDATE public.places SET photo_attribution = v_attr1, photo_credits = v_cred1 WHERE id = v_id
    RETURNING photo_attribution, photo_credits INTO v_upd_a, v_upd_c;

    -- Session: an UPDATE that tries to CLEAR both also leaves the seeded values.
    UPDATE public.places SET photo_attribution = NULL, photo_credits = NULL WHERE id = v_id
    RETURNING photo_attribution, photo_credits INTO v_clr_a, v_clr_c;

    -- Read the stored row again after the session clear attempt: the old values are in the table, not only in RETURNING.
    SELECT photo_attribution, photo_credits INTO v_clrt_a, v_clrt_c FROM public.places WHERE id = v_id;

    -- Positive control: the same session's ordinary edit still lands.
    UPDATE public.places SET name = 'zz credit probe renamed' WHERE id = v_id
    RETURNING name INTO v_name;

    -- No session again: UPDATE of both columns lands (the importer path).
    PERFORM set_config('request.jwt.claims', '', true);
    UPDATE public.places SET photo_attribution = v_attr1, photo_credits = v_cred1 WHERE id = v_id
    RETURNING photo_attribution, photo_credits INTO v_svc_a, v_svc_c;

    -- Marks that the probe ran to its last statement before the rollback sentinel.
    v_seed_ok := true;

    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claims', '', true);

  IF v_id IS NULL OR v_ins_id IS NULL THEN
    RAISE EXCEPTION 'probe: an INSERT produced no row, so nothing below was tested (seed id set: %, session id set: %)', v_id IS NOT NULL, v_ins_id IS NOT NULL;
  END IF;

  -- positive control for the denials: the no-session path writes both columns, INSERT and UPDATE
  IF v_svcins_a IS DISTINCT FROM v_attr0 OR v_svcins_c IS DISTINCT FROM v_cred0 THEN
    RAISE EXCEPTION 'probe: the no-session INSERT could not write credits (attribution=%, credits=%) — the seed script would fail', v_svcins_a, v_svcins_c;
  END IF;
  IF v_svc_a IS DISTINCT FROM v_attr1 OR v_svc_c IS DISTINCT FROM v_cred1 THEN
    RAISE EXCEPTION 'probe: the no-session UPDATE could not write credits (attribution=%, credits=%) — the seed script would fail', v_svc_a, v_svc_c;
  END IF;
  IF v_name IS DISTINCT FROM 'zz credit probe renamed' THEN
    RAISE EXCEPTION 'probe: an ordinary session edit was blocked or altered (name=%)', v_name;
  END IF;

  -- denials
  IF v_ins_a IS NOT NULL OR v_ins_c IS NOT NULL THEN
    RAISE EXCEPTION 'probe: a session INSERT kept credits (attribution=%, credits=%) — the lock is open', v_ins_a, v_ins_c;
  END IF;
  IF v_ins_src IS NOT NULL OR v_ins_sid IS NOT NULL THEN
    RAISE EXCEPTION 'probe: a session INSERT kept provenance (source=%, source_id=%) — 20261045 behaviour regressed', v_ins_src, v_ins_sid;
  END IF;
  IF v_upd_a IS DISTINCT FROM v_attr0 OR v_upd_c IS DISTINCT FROM v_cred0 THEN
    RAISE EXCEPTION 'probe: a session UPDATE changed credits (attribution=%, credits=%, expected the seeded values) — the lock is open', v_upd_a, v_upd_c;
  END IF;
  IF v_clr_a IS DISTINCT FROM v_attr0 OR v_clr_c IS DISTINCT FROM v_cred0 THEN
    RAISE EXCEPTION 'probe: a session UPDATE cleared credits (attribution=%, credits=%, expected the seeded values) — the lock is open', v_clr_a, v_clr_c;
  END IF;
  IF v_seed_a IS DISTINCT FROM v_attr0 OR v_seed_c IS DISTINCT FROM v_cred0 THEN
    RAISE EXCEPTION 'probe: the seeded row read back from the table is not the seed (attribution=%, credits=%)', v_seed_a, v_seed_c;
  END IF;
  IF v_clrt_a IS DISTINCT FROM v_attr0 OR v_clrt_c IS DISTINCT FROM v_cred0 THEN
    RAISE EXCEPTION 'probe: the stored row after a session clear is not the seed (attribution=%, credits=%) — the lock is open', v_clrt_a, v_clrt_c;
  END IF;
  IF v_seed_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'probe: the probe did not reach its end';
  END IF;

  IF EXISTS (SELECT 1 FROM public.places WHERE name LIKE 'zz credit probe%') THEN
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
VALUES ('20261209_places_credit_guard.sql', '27c69fc4ac2af28a60a3e3f730eef76ba5c52cb8bffdec48de333e1a65f9134b')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
