-- ═══════════════════════════════════════════════════════════════════════════
-- 20261049 — walking legs: the real walking path between two places (openrouteservice)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- One row per DIRECTED leg between two places: the path an OSM-based pedestrian router
-- (openrouteservice, foot-walking) found from `from_place_id` to `to_place_id`. Routes draw
-- these instead of straight connectors, and take distance and time from them.
--
-- ─── WHY ITS OWN TABLE, NOT COLUMNS ON walking_route_stops (Berke, 2026-09-24) ─────
--   • LICENCE SEPARATION. ORS results are CC-BY-SA 4.0 and derive from OpenStreetMap
--     (ODbL). Visit NCY's route ORDER is theirs. Keeping the share-alike geometry in its own
--     table keeps the two regimes apart in the data, not only in a README.
--   • REUSE. A leg belongs to a place pair, not to a route: any route (or a future
--     "walk me to" feature) that passes Büyük Han → Selimiye uses the same row.
--   Stops find their leg by the pair (their place_id and the previous stop's place_id).
--
-- DIRECTED: A→B and B→A are separate rows. Stairs and one-way passages make them differ,
-- and the batch only routes the direction the walks go.
--
-- STALE LEGS: a leg does not store the pin it was routed from. The client compares the
-- path's first/last point with the places' CURRENT coordinates; a pin moved by more than
-- the router's snap distance (≤ 22 m on the old-town test legs) makes that leg fall back to
-- a dashed straight line until the batch re-routes it.
--
-- ─── WHO CAN READ / WRITE ───────────────────────────────────────────────────
--   • READ: a leg is readable exactly when BOTH of its places are — the policy re-runs the
--     places visibility rule (active, or admin). Before go-live the Visit NCY stops are
--     pending, so their legs are invisible to everyone but admins; they appear with the
--     stops, in the same step, with no second switch to forget. (Written as the places rule
--     itself, not as "the caller can SELECT that place": places_select also admits a row's
--     own submitter and provider, and a leg is public reference data, not someone's own.)
--   • WRITE: service_role only (scripts/import-walking-legs.mjs). INSERT/UPDATE/DELETE are
--     REVOKED from anon and authenticated; there is no write policy.
--
-- ─── BOTH FOREIGN KEYS ON DELETE CASCADE ─────────────────────────────────────
-- A leg without one of its places is meaningless, unlike a route stop (which is RESTRICT in
-- 20261048 so a place on a route cannot vanish silently — that guard still stands, and it
-- fires first for any place that is on a route).
--
-- Locks: lock_timeout 5 s; places taken FIRST in SHARE ROW EXCLUSIVE (the mode the new
-- foreign keys need — blocks writes to places for the length of this file, not reads).
--
-- Apply: SQL Editor, Role = postgres, whole file ONCE, copied from disk. Idempotent.
-- New table ⇒ ends with NOTIFY pgrst (after COMMIT).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '5s';
LOCK TABLE public.places IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS public.walking_legs (
  from_place_id uuid        NOT NULL,
  to_place_id   uuid        NOT NULL,
  path          jsonb       NOT NULL,
  metres        integer     NOT NULL,
  seconds       integer     NOT NULL,
  source        text        NOT NULL,
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT walking_legs_pkey               PRIMARY KEY (from_place_id, to_place_id),
  CONSTRAINT walking_legs_from_place_id_fkey FOREIGN KEY (from_place_id) REFERENCES public.places(id) ON DELETE CASCADE,
  CONSTRAINT walking_legs_to_place_id_fkey   FOREIGN KEY (to_place_id)   REFERENCES public.places(id) ON DELETE CASCADE,
  CONSTRAINT walking_legs_not_self_check     CHECK (from_place_id <> to_place_id),
  -- GeoJSON order, [[lng, lat], …]: at least a start and an end.
  CONSTRAINT walking_legs_path_check         CHECK (jsonb_typeof(path) = 'array' AND jsonb_array_length(path) >= 2),
  CONSTRAINT walking_legs_metres_check       CHECK (metres > 0),
  CONSTRAINT walking_legs_seconds_check      CHECK (seconds > 0),
  -- One source today. A second router is a decision (licence, attribution), made by
  -- widening this CHECK on purpose.
  CONSTRAINT walking_legs_source_check       CHECK (source = 'ors')
);

-- The PK covers lookups by from_place_id; the CASCADE on a places delete also looks legs
-- up by to_place_id.
CREATE INDEX IF NOT EXISTS idx_walking_legs_to_place_id ON public.walking_legs (to_place_id);

COMMENT ON TABLE public.walking_legs IS
  'Walking path between two places (openrouteservice foot-walking; © openrouteservice by HeiGIT, '
  'data © OpenStreetMap contributors, CC-BY-SA 4.0 / ODbL). Directed. Readable when both places are. '
  'Writes service_role only.';
COMMENT ON COLUMN public.walking_legs.path IS
  'GeoJSON-order coordinates [[lng, lat], …] as routed, rounded to 5 decimals.';

ALTER TABLE public.walking_legs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.walking_legs FROM anon, authenticated;
GRANT SELECT ON TABLE public.walking_legs TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.walking_legs TO service_role;

DROP POLICY IF EXISTS walking_legs_select ON public.walking_legs;
CREATE POLICY walking_legs_select ON public.walking_legs
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (SELECT 1 FROM public.places p WHERE p.id = walking_legs.from_place_id AND (p.status = 'active' OR public.is_admin()))
    AND
    EXISTS (SELECT 1 FROM public.places p WHERE p.id = walking_legs.to_place_id   AND (p.status = 'active' OR public.is_admin()))
  );

-- ─── Assertions. Each derives what it checks and prints what it read. ───────
DO $$
DECLARE
  v_t      regclass := to_regclass('public.walking_legs');
  v_n      int;
  v_names  text;
  v_role   text;
  v_priv   text;
  v_a      uuid;
  v_b      uuid;
  n_both_active  int := -1;
  n_one_pending  int := -1;
  n_after_delete int := -1;
  v_anon_write   text := 'unset';
  v_dup          text := 'unset';
  v_probed       boolean := false;
BEGIN
  IF v_t IS NULL THEN
    RAISE EXCEPTION 'walking_legs not visible to this DO block. Nothing committed; re-run the file as one paste.';
  END IF;
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = v_t) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'RLS is not enabled on walking_legs';
  END IF;

  -- The FULL policy set: exactly one, SELECT, permissive. RLS is permissive-OR.
  SELECT count(*), coalesce(string_agg(policyname || ':' || cmd || ':' || permissive, ', '), '(none)')
    INTO v_n, v_names FROM pg_policies WHERE schemaname = 'public' AND tablename = 'walking_legs';
  IF v_n IS DISTINCT FROM 1 OR v_names NOT LIKE '%:SELECT:PERMISSIVE' THEN
    RAISE EXCEPTION 'walking_legs must carry exactly ONE permissive SELECT policy; found %: %', v_n, v_names;
  END IF;

  -- Privileges, both directions (has_table_privilege resolves inherited grants).
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF NOT has_table_privilege(v_role, v_t, 'SELECT') THEN
      RAISE EXCEPTION '% lost SELECT on walking_legs — the public read would fail', v_role;
    END IF;
    FOREACH v_priv IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
      IF has_table_privilege(v_role, v_t, v_priv) THEN
        RAISE EXCEPTION '% still holds % on walking_legs', v_role, v_priv;
      END IF;
    END LOOP;
  END LOOP;
  FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
    IF NOT has_table_privilege('service_role', v_t, v_priv) THEN
      RAISE EXCEPTION 'service_role is missing % on walking_legs — the batch could not write', v_priv;
    END IF;
  END LOOP;

  -- Delete actions, from the catalog: both CASCADE ('c').
  SELECT string_agg(conname || '=' || confdeltype::text, ', ' ORDER BY conname) INTO v_names
    FROM pg_constraint WHERE conrelid = v_t AND contype = 'f';
  IF v_names IS DISTINCT FROM 'walking_legs_from_place_id_fkey=c, walking_legs_to_place_id_fkey=c' THEN
    RAISE EXCEPTION 'walking_legs foreign keys are not both ON DELETE CASCADE; found: %', coalesce(v_names, '(none)');
  END IF;

  -- ── BEHAVIOUR, as anon, rolled back by a sentinel. Two ACTIVE places that are on no route
  --    (so 20261048's RESTRICT cannot interfere with the delete step).
  SELECT p.id INTO v_a FROM public.places p
   WHERE p.status = 'active' AND NOT EXISTS (SELECT 1 FROM public.walking_route_stops s WHERE s.place_id = p.id)
   ORDER BY p.created_at LIMIT 1;
  SELECT p.id INTO v_b FROM public.places p
   WHERE p.status = 'active' AND p.id IS DISTINCT FROM v_a
     AND NOT EXISTS (SELECT 1 FROM public.walking_route_stops s WHERE s.place_id = p.id)
   ORDER BY p.created_at LIMIT 1;
  IF v_a IS NULL OR v_b IS NULL THEN
    RAISE EXCEPTION 'probe: need two active places on no route (found %, %)', v_a, v_b;
  END IF;

  BEGIN
    INSERT INTO public.walking_legs (from_place_id, to_place_id, path, metres, seconds, source)
    VALUES (v_a, v_b, '[[33.36,35.17],[33.37,35.18]]', 100, 80, 'ors');
    v_probed := true;

    BEGIN
      INSERT INTO public.walking_legs (from_place_id, to_place_id, path, metres, seconds, source)
      VALUES (v_a, v_b, '[[33.36,35.17],[33.37,35.18]]', 100, 80, 'ors');
      v_dup := 'ACCEPTED';
    EXCEPTION WHEN unique_violation THEN v_dup := 'refused';
    END;

    SET LOCAL ROLE anon;
    SELECT count(*) INTO n_both_active FROM public.walking_legs WHERE from_place_id = v_a AND to_place_id = v_b;
    BEGIN
      INSERT INTO public.walking_legs (from_place_id, to_place_id, path, metres, seconds, source)
      VALUES (v_b, v_a, '[[33.37,35.18],[33.36,35.17]]', 100, 80, 'ors');
      v_anon_write := 'ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN v_anon_write := 'denied';
    END;
    RESET ROLE;

    -- One endpoint not public (as the Visit NCY stops are before go-live) → the leg hides.
    UPDATE public.places SET status = 'pending' WHERE id = v_b;
    SET LOCAL ROLE anon;
    SELECT count(*) INTO n_one_pending FROM public.walking_legs WHERE from_place_id = v_a AND to_place_id = v_b;
    RESET ROLE;

    DELETE FROM public.places WHERE id = v_b;
    SELECT count(*) INTO n_after_delete FROM public.walking_legs WHERE from_place_id = v_a AND to_place_id = v_b;

    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  IF NOT v_probed THEN RAISE EXCEPTION 'probe: the leg INSERT did not run, so nothing below was tested'; END IF;
  IF v_dup           IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'a duplicate (from, to) pair was %', v_dup; END IF;
  IF n_both_active   IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'a leg between two ACTIVE places is not readable by anon (rows %) — go-live would draw no paths', n_both_active; END IF;
  IF n_one_pending   IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'a leg touching a PENDING place is readable by anon (rows %) — dark stops would leak', n_one_pending; END IF;
  IF v_anon_write    IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'anon INSERT into walking_legs was %', v_anon_write; END IF;
  IF n_after_delete  IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'deleting a place left % leg(s) behind — CASCADE is not in force', n_after_delete; END IF;
  IF EXISTS (SELECT 1 FROM public.walking_legs WHERE from_place_id = v_a AND to_place_id = v_b)
     OR (SELECT status FROM public.places WHERE id = v_b) IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'probe changes survived the rollback';
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
VALUES ('20261049_walking_legs.sql', 'c5da9f99041e73f3a03fc4fd3058efe0585bd097d02eb9d2dcab36c45b4cced0')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.walking_legs');   -- true
--   SELECT policyname, cmd FROM pg_policies WHERE tablename = 'walking_legs';             -- 1 row, SELECT
--
-- ─── Rollback (only if real paths are abandoned) ─────────────────────────────
--   DROP TABLE IF EXISTS public.walking_legs;
