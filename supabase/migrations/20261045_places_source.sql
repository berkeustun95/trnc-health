-- ═══════════════════════════════════════════════════════════════════════════
-- 20261045 — places.source / source_id: provenance for partner-imported places
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Visit NCY walking maps → Explore, slice 1. The importer
-- (scripts/import-visitncy-places.mjs) keys every row it owns on (source, source_id) =
-- ('visitncy', <MapHub feature id>), so a re-run finds its own rows instead of inserting
-- them twice. Slice 3 shows a Visit NCY credit on any place with source = 'visitncy'.
-- Plan + recon: vault 2026-09-23_visitncy-walking-maps-SLICE0-RECON.md.
--
-- ─── WHO CAN WRITE source / source_id: ONLY service_role AND THE SQL EDITOR ──
--
-- Customers can INSERT into places (a pending submission) and some paths UPDATE their own
-- row. Without a lock, a customer could submit source='visitncy', source_id='<a real
-- MapHub id>' and either (a) squat the importer's key, so the partner's stop never lands,
-- or (b) wear the partner credit on their own submission. Same threat that
-- properties_source_agent_xor_check (20260904) exists for.
--
-- places_guard_source() closes it: for ANY caller with a session (auth.uid() not null) —
-- customer, provider AND admin — an INSERT is born with both columns NULL and an UPDATE
-- keeps whatever was there. Admins are included on purpose: no app screen sets provenance,
-- and the only writer that should is the importer, which runs as service_role
-- (auth.uid() null). It COERCES rather than raises, matching places_guard_insert: no
-- client ever sends these columns, so an error could only confuse an app flow that
-- happens to write a whole row back unchanged.
--
-- It is a SEPARATE trigger, not a new clause in places_guard_update, for a reason that is
-- not style: places_guard_update RETURNS EARLY on its two trusted-write GUC escapes
-- (app.trusted_place_write, app.trusted_place_resubmit), so a lock placed in that body
-- would be skipped on exactly those paths. A trigger of its own runs on every write.
--
-- ─── WHY A PLAIN UNIQUE, NOT A PARTIAL INDEX ────────────────────────────────
--
-- PostgREST's upsert sends ON CONFLICT (source, source_id) with no WHERE clause, which
-- cannot infer a partial unique index — it errors. A plain UNIQUE works because NULLs are
-- distinct: every existing row is (NULL, NULL) and none of them collide.
--
-- ─── TWO COORDINATE CORRECTIONS (places AND landmarks) ──────────────────────
--
-- Recon found two of OUR pins wrong, each checked against OpenStreetMap (overpass-api.de,
-- 2026-09-23; positive control: both query boxes returned the known neighbouring sites):
--   Kyrenia Castle                          ours 438 m off → OSM way 154898919 centroid
--   İskele Icon Museum (Panagia Theotokos)  ours 1174 m off → OSM way 412174829 centroid
-- MapHub's pins agree with OSM to 17 m and 5 m. The legacy landmarks table carries both
-- rows under the SAME ids with the same wrong values (search_content reads landmarks), so
-- both tables are corrected. COMPARE-AND-SET: a row is moved only if it still holds the
-- wrong value recon measured; the assertion then requires the corrected value. Re-running
-- is a no-op, and a pin somebody has since moved to a THIRD value aborts the whole file
-- rather than being overwritten.
--
-- ─── THE FIRST APPLY DEADLOCKED (2026-09-23) ────────────────────────────────
--
--   40P01  Process 2358884 waits for AccessExclusiveLock on relation 17235; blocked by 2358883.
--          Process 2358883 waits for AccessShareLock on relation 19823; blocked by 2358884.
--
-- 17235 = storage.buckets, 19823 = places (resolved in the live database). The first
-- process named in a deadlock report is the one that received the error — this apply — so
-- it HELD ACCESS EXCLUSIVE on places and ASKED for ACCESS EXCLUSIVE on storage.buckets.
-- Nothing committed. Nothing in this file names storage; neither do the four trigger
-- functions on places nor anything they call (as defined in supabase/migrations/), and no
-- foreign key joins places to storage. So the request did not come from any statement
-- written here — see vault 2026-09-23_visitncy-SLICE1-stops-to-places.md. The Postgres
-- log entry for the deadlock carries the SQL of both sessions.
--
-- What the file does about it:
--   • lock_timeout = 5 s, and the one lock this file needs — ACCESS EXCLUSIVE on places —
--     is taken FIRST, before anything reads or writes. Any wait becomes a clean abort
--     (55P03) instead of a queue that stalls every reader of places behind this transaction.
--   • CREATE OR REPLACE TRIGGER instead of DROP TRIGGER IF EXISTS + CREATE TRIGGER. Same
--     idempotency, and the file no longer contains a DROP (Supabase's supautils extension
--     intercepts DROP TRIGGER — an untested candidate for the storage.buckets request).
--   • The assertion block ASSERTS that this transaction holds no lock in the storage schema
--     and no ACCESS EXCLUSIVE lock on anything but places. If something still takes one,
--     the apply aborts and names the relation and mode instead of committing silently.
--
-- Apply: SQL Editor, Role = postgres, paste the whole file ONCE, copied from DISK. Idempotent;
-- re-runnable. A 55P03 lock_timeout means something held places for 5 s: nothing was applied,
-- run it again. ADD COLUMN ⇒ ends with NOTIFY pgrst (after COMMIT).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- SET LOCAL is scoped to this transaction (it is ignored outside one); nothing precedes it.
-- landmarks is not locked here: its two-row UPDATE takes ROW EXCLUSIVE when it runs, which
-- blocks no reader and no writer.
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.places IN ACCESS EXCLUSIVE MODE;

ALTER TABLE public.places ADD COLUMN IF NOT EXISTS source    text;
ALTER TABLE public.places ADD COLUMN IF NOT EXISTS source_id text;

COMMENT ON COLUMN public.places.source IS
  'Partner that supplied this row (e.g. ''visitncy''), NULL for our own. Written only by '
  'service_role — places_guard_source nulls it for any caller with a session.';
COMMENT ON COLUMN public.places.source_id IS
  'The partner''s id for this row (Visit NCY: MapHub feature id). Unique with source; '
  'both NULL or both set (places_source_pair_check).';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.places'::regclass AND conname = 'places_source_pair_check') THEN
    ALTER TABLE public.places ADD CONSTRAINT places_source_pair_check
      CHECK ((source IS NULL) = (source_id IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.places'::regclass AND conname = 'places_source_source_id_key') THEN
    ALTER TABLE public.places ADD CONSTRAINT places_source_source_id_key UNIQUE (source, source_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.places_guard_source()
 RETURNS trigger LANGUAGE plpgsql AS $function$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    new.source    := null;
    new.source_id := null;
  else
    new.source    := old.source;
    new.source_id := old.source_id;
  end if;
  return new;
end $function$;

CREATE OR REPLACE TRIGGER places_guard_source
  BEFORE INSERT OR UPDATE ON public.places
  FOR EACH ROW EXECUTE FUNCTION public.places_guard_source();

-- ─── Coordinate corrections (compare-and-set; see header) ───────────────────
UPDATE public.places    SET latitude = 35.341635, longitude = 33.322362
 WHERE id = '7ecf2c84-2192-45c9-b075-a2ce115f842c' AND latitude = 35.3382  AND longitude = 33.32;
UPDATE public.landmarks SET latitude = 35.341635, longitude = 33.322362
 WHERE id = '7ecf2c84-2192-45c9-b075-a2ce115f842c' AND latitude = 35.3382  AND longitude = 33.32;
UPDATE public.places    SET latitude = 35.283387, longitude = 33.889256
 WHERE id = '2c20f82e-1ee1-4c9b-9fdc-f59be72da470' AND latitude = 35.29392 AND longitude = 33.88844;
UPDATE public.landmarks SET latitude = 35.283387, longitude = 33.889256
 WHERE id = '2c20f82e-1ee1-4c9b-9fdc-f59be72da470' AND latitude = 35.29392 AND longitude = 33.88844;

-- ─── Assertions. Each derives what it checks and prints what it read. ───────
-- Columns and constraints are found through the catalogs, never a bare name: if the
-- ALTERs above did not land in this session this fails in words, not with 42703.
DO $$
DECLARE
  v_cols     text;
  v_def      text;
  v_uid      uuid := gen_random_uuid();   -- a session that is nobody: not an admin, owns nothing
  v_id       uuid;
  v_ins_src  text := 'unset';
  v_ins_sid  text := 'unset';
  v_upd_src  text := 'unset';
  v_upd_name text;
  v_svc_src  text;
  v_pair_ok  boolean := false;
  v_uniq_ok  boolean := false;
  v_upsert   boolean := false;
  v_foreign  text;
  v_own_ae   int;
  r          record;
BEGIN
  SELECT string_agg(column_name || ':' || data_type, ', ' ORDER BY column_name) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'places' AND column_name IN ('source','source_id');
  IF v_cols IS DISTINCT FROM 'source:text, source_id:text' THEN
    RAISE EXCEPTION 'places provenance columns did not land as expected; found: %', coalesce(v_cols,'(none)');
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.places'::regclass AND conname = 'places_source_source_id_key';
  IF v_def IS DISTINCT FROM 'UNIQUE (source, source_id)' THEN
    RAISE EXCEPTION 'places_source_source_id_key is not a plain UNIQUE (source, source_id); found: %', coalesce(v_def,'(missing)');
  END IF;

  SELECT pg_get_triggerdef(t.oid) INTO v_def FROM pg_trigger t
   WHERE t.tgrelid = 'public.places'::regclass AND t.tgname = 'places_guard_source' AND NOT t.tgisinternal;
  -- Both names are wildcarded at the front: pg_get_triggerdef schema-qualifies the table and
  -- the function only when they are not on search_path, so a literal 'public.' would fail a
  -- correct trigger in one editor session and pass it in another.
  IF v_def IS NULL OR v_def NOT LIKE '%BEFORE INSERT OR UPDATE ON %places FOR EACH ROW EXECUTE FUNCTION %places_guard_source()%' THEN
    RAISE EXCEPTION 'places_guard_source trigger missing or wrong shape; found: %', coalesce(v_def,'(missing)');
  END IF;

  -- ── BEHAVIOUR. A probe that ends in a sentinel exception, so every row it writes is
  -- rolled back to the savepoint. PL/pgSQL variables survive that rollback; rows do not.
  BEGIN
    -- As a client session (RLS is not in play — role stays postgres — so this isolates
    -- the TRIGGER: if it were absent, source would come back 'visitncy').
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

    INSERT INTO public.places (category, name, region, source, source_id)
    VALUES ('monument', 'zz provenance probe', 'kyrenia', 'visitncy', 'zz-probe-1')
    RETURNING id, source, source_id INTO v_id, v_ins_src, v_ins_sid;

    UPDATE public.places SET source = 'visitncy', source_id = 'zz-probe-2' WHERE id = v_id
    RETURNING source INTO v_upd_src;

    -- Positive control: an ordinary edit by the same session still goes through.
    UPDATE public.places SET name = 'zz provenance probe renamed' WHERE id = v_id
    RETURNING name INTO v_upd_name;

    -- As service_role / the importer (no session): provenance is written.
    PERFORM set_config('request.jwt.claims', '', true);
    INSERT INTO public.places (category, name, region, source, source_id)
    VALUES ('monument', 'zz provenance probe svc', 'kyrenia', 'visitncy', 'zz-probe-3')
    RETURNING source INTO v_svc_src;

    -- Half a pair is refused.
    BEGIN
      INSERT INTO public.places (category, name, region, source)
      VALUES ('monument', 'zz provenance probe half', 'kyrenia', 'visitncy');
    EXCEPTION WHEN check_violation THEN v_pair_ok := true;
    END;

    -- A second row on the same key is refused…
    BEGIN
      INSERT INTO public.places (category, name, region, source, source_id)
      VALUES ('monument', 'zz provenance probe dup', 'kyrenia', 'visitncy', 'zz-probe-3');
    EXCEPTION WHEN unique_violation THEN v_uniq_ok := true;
    END;

    -- …and the importer's exact statement shape infers the constraint instead of erroring.
    INSERT INTO public.places (category, name, region, source, source_id)
    VALUES ('monument', 'zz provenance probe dup', 'kyrenia', 'visitncy', 'zz-probe-3')
    ON CONFLICT (source, source_id) DO NOTHING;
    v_upsert := true;

    -- Every relation lock this transaction holds, read HERE — at its widest point — because
    -- the rollback below releases whatever the probe's triggers took. Allowed: nothing in the
    -- storage schema, and ACCESS EXCLUSIVE on places and the index this file creates only.
    -- The first apply asked for ACCESS EXCLUSIVE on storage.buckets; this names such a lock.
    SELECT string_agg(format('%I.%I %s', n.nspname, c.relname, l.mode), ', ' ORDER BY n.nspname, c.relname)
      INTO v_foreign
      FROM pg_locks l
      JOIN pg_class c     ON c.oid = l.relation
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE l.locktype = 'relation' AND l.pid = pg_backend_pid()
       AND (n.nspname = 'storage'
            OR (l.mode = 'AccessExclusiveLock'
                AND c.oid <> 'public.places'::regclass
                AND c.oid IS DISTINCT FROM to_regclass('public.places_source_source_id_key')));
    -- Control: the same read must see the one lock this file certainly holds. A read that
    -- finds nothing at all would pass the check above on every input.
    SELECT count(*) INTO v_own_ae FROM pg_locks l
     WHERE l.locktype = 'relation' AND l.pid = pg_backend_pid()
       AND l.relation = 'public.places'::regclass AND l.mode = 'AccessExclusiveLock';

    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claims', '', true);

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'probe: the client-session INSERT produced no row, so nothing below was tested';
  END IF;
  IF v_ins_src IS NOT NULL OR v_ins_sid IS NOT NULL THEN
    RAISE EXCEPTION 'probe: a client INSERT kept provenance (source=%, source_id=%) — the lock is open', v_ins_src, v_ins_sid;
  END IF;
  IF v_upd_src IS NOT NULL THEN
    RAISE EXCEPTION 'probe: a client UPDATE set source=% — the lock is open', v_upd_src;
  END IF;
  IF v_upd_name IS DISTINCT FROM 'zz provenance probe renamed' THEN
    RAISE EXCEPTION 'probe: an ordinary client edit was blocked or altered (name=%)', v_upd_name;
  END IF;
  IF v_svc_src IS DISTINCT FROM 'visitncy' THEN
    RAISE EXCEPTION 'probe: the service_role path could not write provenance (source=%) — the importer would fail', v_svc_src;
  END IF;
  IF NOT v_pair_ok THEN RAISE EXCEPTION 'probe: a row with source but no source_id was accepted'; END IF;
  IF NOT v_uniq_ok THEN RAISE EXCEPTION 'probe: a duplicate (source, source_id) was accepted'; END IF;
  IF NOT v_upsert  THEN RAISE EXCEPTION 'probe: ON CONFLICT (source, source_id) did not run'; END IF;

  IF v_own_ae IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'lock check: pg_locks shows % ACCESS EXCLUSIVE lock(s) on places for this session, expected 1 — the lock read is broken, so the check below would prove nothing', v_own_ae;
  END IF;
  IF v_foreign IS NOT NULL THEN
    RAISE EXCEPTION 'this migration holds locks it must not take: % — Slice 1 touches no storage and needs ACCESS EXCLUSIVE on places only. Nothing was applied.', v_foreign;
  END IF;

  IF EXISTS (SELECT 1 FROM public.places WHERE name LIKE 'zz provenance probe%') THEN
    RAISE EXCEPTION 'probe rows survived the rollback';
  END IF;

  -- The corrections: every one of the four rows must now hold the OSM value.
  FOR r IN
    SELECT 'places' AS t, id, latitude, longitude FROM public.places
     WHERE id IN ('7ecf2c84-2192-45c9-b075-a2ce115f842c','2c20f82e-1ee1-4c9b-9fdc-f59be72da470')
    UNION ALL
    SELECT 'landmarks', id, latitude, longitude FROM public.landmarks
     WHERE id IN ('7ecf2c84-2192-45c9-b075-a2ce115f842c','2c20f82e-1ee1-4c9b-9fdc-f59be72da470')
  LOOP
    IF (r.id = '7ecf2c84-2192-45c9-b075-a2ce115f842c'
          AND (r.latitude, r.longitude) IS DISTINCT FROM (35.341635::float8, 33.322362::float8))
    OR (r.id = '2c20f82e-1ee1-4c9b-9fdc-f59be72da470'
          AND (r.latitude, r.longitude) IS DISTINCT FROM (35.283387::float8, 33.889256::float8)) THEN
      RAISE EXCEPTION '%.% holds %,% — neither the wrong value recon measured nor the OSM correction. Look before re-running.',
        r.t, r.id, r.latitude, r.longitude;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.places
       WHERE id IN ('7ecf2c84-2192-45c9-b075-a2ce115f842c','2c20f82e-1ee1-4c9b-9fdc-f59be72da470')) IS DISTINCT FROM 2::bigint
  OR (SELECT count(*) FROM public.landmarks
       WHERE id IN ('7ecf2c84-2192-45c9-b075-a2ce115f842c','2c20f82e-1ee1-4c9b-9fdc-f59be72da470')) IS DISTINCT FROM 2::bigint THEN
    RAISE EXCEPTION 'expected both corrected rows in places AND landmarks; one is missing';
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
VALUES ('20261045_places_source.sql', '6078688d67661955f6721edd620f71fb2e7cd52e8cbde917eba67b8a1b4fb545')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='places' AND column_name IN ('source','source_id');
--   -- expect 2 rows
--   SELECT name, latitude, longitude FROM public.places
--    WHERE id IN ('7ecf2c84-2192-45c9-b075-a2ce115f842c','2c20f82e-1ee1-4c9b-9fdc-f59be72da470');
--   -- expect 35.341635,33.322362 and 35.283387,33.889256

-- ─── Rollback (only if the Visit NCY import is abandoned, and only after deleting its rows) ─
--   DELETE FROM public.places WHERE source = 'visitncy';
--   DROP TRIGGER IF EXISTS places_guard_source ON public.places;
--   DROP FUNCTION IF EXISTS public.places_guard_source();
--   ALTER TABLE public.places DROP CONSTRAINT IF EXISTS places_source_source_id_key,
--                             DROP CONSTRAINT IF EXISTS places_source_pair_check,
--                             DROP COLUMN IF EXISTS source_id, DROP COLUMN IF EXISTS source;
--   (The two coordinate corrections are NOT rolled back: the old values were wrong.)
