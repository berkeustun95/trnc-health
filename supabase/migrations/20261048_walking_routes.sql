-- ═══════════════════════════════════════════════════════════════════════════
-- 20261048 — walking routes (Visit NCY, slice 2): routes + ordered stops, DARK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Visit NCY's six walking maps carry no drawn lines (recon: 0 LineStrings on four surfaces),
-- but the ORDER of each map's pins is the walk (array order within 6–8% of optimal on the
-- three big maps). So a route is an ordered list of places; the Keşfet UI (slice 3) draws
-- straight connectors between them. Rows are written by scripts/import-visitncy-routes.mjs.
--
-- ─── WHAT THE DATA IS ───────────────────────────────────────────────────────
--   walking_routes        one row per city walk. straight_line_km is the SUM OF
--                         STRAIGHT-LINE LEGS — an underestimate of the walk by design. The UI
--                         multiplies by one detour constant and shows "≈"; nothing should
--                         render this number raw, which is why it is not called distance_km.
--   walking_route_stops   (route_id, position) → place_id, plus leg_m from the previous stop.
--                         Stops reference PLACES — imported Visit NCY rows and our own
--                         matched places alike — never a copy of their coordinates.
--
-- No geometry column. Every route would carry NULL, and a PostGIS column is a dependency for
-- something nothing reads. The migration that first has a line to store adds it.
--
-- ─── WHO CAN READ / WRITE ───────────────────────────────────────────────────
--   • READ: anyone (anon, signed-in, guest) sees a route only while is_active, and its stops
--     only through an active route. Admin sees inactive ones too (review before go-live).
--   • WRITE: nobody but service_role (the importer) and the SQL editor. INSERT/UPDATE/DELETE
--     are REVOKED from anon and authenticated — RLS with no write policy would already deny
--     them; the revoke makes the table's own privileges say the same thing.
--   • is_active DEFAULTs to FALSE (CLAUDE.md pre-launch rule): an insert that forgets the
--     column lands invisible. Going live is an explicit UPDATE, done with the flag flip.
--
-- ─── place_id ON DELETE RESTRICT, not CASCADE ────────────────────────────────
-- AdminScreen has a Delete button on places. CASCADE would drop the stop silently and leave
-- a gap in position; RESTRICT makes that delete fail loudly instead. Account deletion never
-- deletes places (delete_own_account only nulls places.submitted_by), so RESTRICT cannot
-- block it — the FK failure this app has hit three times does not apply here.
--
-- Locks: lock_timeout 5 s, and places is taken FIRST in SHARE ROW EXCLUSIVE — the mode the
-- new foreign key needs (it blocks writes to places for the length of this file, not reads).
--
-- Apply: SQL Editor, Role = postgres, whole file ONCE, copied from disk. Idempotent.
-- New tables ⇒ ends with NOTIFY pgrst (after COMMIT).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '5s';
LOCK TABLE public.places IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS public.walking_routes (
  id                uuid         NOT NULL DEFAULT gen_random_uuid(),
  region            text         NOT NULL,
  name_i18n         jsonb        NOT NULL,
  straight_line_km  numeric(6,2) NOT NULL,
  sort_order        integer      NOT NULL DEFAULT 0,
  is_active         boolean      NOT NULL DEFAULT false,
  source            text,
  source_id         text,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT walking_routes_pkey               PRIMARY KEY (id),
  CONSTRAINT walking_routes_region_check       CHECK (region = ANY (ARRAY['nicosia','kyrenia','famagusta','morphou','iskele','lefke','karpaz']::text[])),
  CONSTRAINT walking_routes_name_check         CHECK (jsonb_typeof(name_i18n) = 'object' AND name_i18n ? 'en' AND name_i18n ? 'tr'),
  CONSTRAINT walking_routes_km_check           CHECK (straight_line_km >= 0),
  CONSTRAINT walking_routes_source_pair_check  CHECK ((source IS NULL) = (source_id IS NULL)),
  CONSTRAINT walking_routes_source_source_id_key UNIQUE (source, source_id)
);

CREATE TABLE IF NOT EXISTS public.walking_route_stops (
  route_id  uuid     NOT NULL,
  position  smallint NOT NULL,
  place_id  uuid     NOT NULL,
  leg_m     integer,
  CONSTRAINT walking_route_stops_pkey            PRIMARY KEY (route_id, position),
  CONSTRAINT walking_route_stops_route_place_key UNIQUE (route_id, place_id),
  CONSTRAINT walking_route_stops_route_id_fkey   FOREIGN KEY (route_id) REFERENCES public.walking_routes(id) ON DELETE CASCADE,
  CONSTRAINT walking_route_stops_place_id_fkey   FOREIGN KEY (place_id) REFERENCES public.places(id)         ON DELETE RESTRICT,
  CONSTRAINT walking_route_stops_position_check  CHECK (position > 0),
  -- The first stop has no leg; every later stop has one, never negative.
  CONSTRAINT walking_route_stops_leg_check       CHECK ((position = 1) = (leg_m IS NULL) AND (leg_m IS NULL OR leg_m >= 0))
);

-- The RESTRICT check on a places delete looks stops up by place_id.
CREATE INDEX IF NOT EXISTS idx_walking_route_stops_place_id ON public.walking_route_stops (place_id);

COMMENT ON TABLE public.walking_routes IS
  'City walks (Visit NCY). Public read only while is_active (DEFAULT false); writes service_role only. '
  'straight_line_km is the sum of straight legs — an underestimate; the UI applies a detour factor.';
COMMENT ON COLUMN public.walking_routes.straight_line_km IS
  'Sum of straight-line legs between consecutive stops, from the places rows'' coordinates at import. '
  'NOT the walking distance — never render it raw.';
COMMENT ON TABLE public.walking_route_stops IS
  'Ordered stops of a walking route. place_id ON DELETE RESTRICT: a place on a route cannot be deleted silently.';
COMMENT ON COLUMN public.walking_route_stops.leg_m IS
  'Straight-line metres from the previous stop; NULL at position 1.';

ALTER TABLE public.walking_routes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.walking_route_stops ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.walking_routes, public.walking_route_stops FROM anon, authenticated;
GRANT SELECT ON TABLE public.walking_routes, public.walking_route_stops TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.walking_routes, public.walking_route_stops TO service_role;

DROP POLICY IF EXISTS walking_routes_select ON public.walking_routes;
CREATE POLICY walking_routes_select ON public.walking_routes
  FOR SELECT TO anon, authenticated
  USING (is_active OR public.is_admin());

DROP POLICY IF EXISTS walking_route_stops_select ON public.walking_route_stops;
CREATE POLICY walking_route_stops_select ON public.walking_route_stops
  FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.walking_routes r
                  WHERE r.id = walking_route_stops.route_id
                    AND (r.is_active OR public.is_admin())));

-- ─── Assertions. Each derives what it checks and prints what it read. ───────
DO $$
DECLARE
  v_r     regclass := to_regclass('public.walking_routes');
  v_s     regclass := to_regclass('public.walking_route_stops');
  v_n     int;
  v_names text;
  v_role  text;
  v_priv  text;
  v_place uuid;
  v_route uuid;
  n_r_off int := -1; n_s_off int := -1; n_r_on int := -1; n_s_on int := -1;
  v_anon_write text := 'unset';
  v_restrict   text := 'unset';
BEGIN
  IF v_r IS NULL OR v_s IS NULL THEN
    RAISE EXCEPTION 'walking_routes/walking_route_stops not visible to this DO block (routes=%, stops=%). Nothing committed; re-run the file as one paste.', v_r, v_s;
  END IF;

  IF (SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN (v_r, v_s)) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'RLS is not enabled on both walking tables';
  END IF;

  -- The FULL policy set on each table: exactly one, SELECT, permissive. RLS is permissive-OR,
  -- so any second policy — whoever wrote it — would widen what it grants.
  FOR v_role, v_n, v_names IN
    SELECT t, count(p.policyname), coalesce(string_agg(p.policyname || ':' || p.cmd || ':' || p.permissive, ', '), '(none)')
      FROM unnest(ARRAY['walking_routes','walking_route_stops']) t
      LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = t
     GROUP BY t
  LOOP
    IF v_n IS DISTINCT FROM 1 OR v_names NOT LIKE '%:SELECT:PERMISSIVE' THEN
      RAISE EXCEPTION '% must carry exactly ONE permissive SELECT policy; found %: %', v_role, v_n, v_names;
    END IF;
  END LOOP;

  -- Privileges, both directions. has_table_privilege resolves inherited grants.
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF NOT has_table_privilege(v_role, v_r, 'SELECT') OR NOT has_table_privilege(v_role, v_s, 'SELECT') THEN
      RAISE EXCEPTION '% lost SELECT on a walking table — the public read would fail', v_role;
    END IF;
    FOREACH v_priv IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
      IF has_table_privilege(v_role, v_r, v_priv) OR has_table_privilege(v_role, v_s, v_priv) THEN
        RAISE EXCEPTION '% still holds % on a walking table', v_role, v_priv;
      END IF;
    END LOOP;
  END LOOP;
  FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
    IF NOT has_table_privilege('service_role', v_r, v_priv) OR NOT has_table_privilege('service_role', v_s, v_priv) THEN
      RAISE EXCEPTION 'service_role is missing % — the importer could not write routes', v_priv;
    END IF;
  END LOOP;

  -- Delete actions, read from the catalog: stops go with their route; a place on a route
  -- cannot be deleted. 'r' = RESTRICT, 'c' = CASCADE.
  SELECT string_agg(conname || '=' || confdeltype::text, ', ' ORDER BY conname) INTO v_names
    FROM pg_constraint WHERE conrelid = v_s AND contype = 'f';
  IF v_names IS DISTINCT FROM 'walking_route_stops_place_id_fkey=r, walking_route_stops_route_id_fkey=c' THEN
    RAISE EXCEPTION 'walking_route_stops foreign keys are not place_id RESTRICT + route_id CASCADE; found: %', coalesce(v_names, '(none)');
  END IF;

  IF (SELECT column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'walking_routes' AND column_name = 'is_active')
     IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'walking_routes.is_active must DEFAULT false (pre-launch rule)';
  END IF;

  -- ── BEHAVIOUR, as anon, rolled back by a sentinel. PL/pgSQL variables survive it; rows do not.
  SELECT id INTO v_place FROM public.places ORDER BY created_at LIMIT 1;
  IF v_place IS NULL THEN RAISE EXCEPTION 'probe: no place to attach a stop to'; END IF;
  BEGIN
    INSERT INTO public.walking_routes (region, name_i18n, straight_line_km, source, source_id)
    VALUES ('nicosia', '{"en":"zz probe","tr":"zz probe"}', 0, 'zzprobe', 'zzprobe')
    RETURNING id INTO v_route;
    INSERT INTO public.walking_route_stops (route_id, position, place_id, leg_m) VALUES (v_route, 1, v_place, NULL);

    SET LOCAL ROLE anon;
    SELECT count(*) INTO n_r_off FROM public.walking_routes      WHERE id = v_route;
    SELECT count(*) INTO n_s_off FROM public.walking_route_stops WHERE route_id = v_route;
    RESET ROLE;

    UPDATE public.walking_routes SET is_active = true WHERE id = v_route;

    SET LOCAL ROLE anon;
    SELECT count(*) INTO n_r_on FROM public.walking_routes      WHERE id = v_route;
    SELECT count(*) INTO n_s_on FROM public.walking_route_stops WHERE route_id = v_route;
    BEGIN
      INSERT INTO public.walking_routes (region, name_i18n, straight_line_km) VALUES ('nicosia', '{"en":"x","tr":"x"}', 0);
      v_anon_write := 'ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN v_anon_write := 'denied';
    END;
    RESET ROLE;

    BEGIN
      DELETE FROM public.places WHERE id = v_place;
      v_restrict := 'DELETED';
    -- ON DELETE RESTRICT raises 23001 restrict_violation, NOT 23503 foreign_key_violation.
    EXCEPTION WHEN restrict_violation THEN v_restrict := 'refused';
    END;

    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  IF v_route IS NULL THEN RAISE EXCEPTION 'probe: the route INSERT produced no row, so nothing below was tested'; END IF;
  IF n_r_off IS DISTINCT FROM 0 OR n_s_off IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'an INACTIVE route is readable by anon (route rows %, stop rows %) — dark launch is broken', n_r_off, n_s_off;
  END IF;
  IF n_r_on IS DISTINCT FROM 1 OR n_s_on IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'an ACTIVE route is not readable by anon (route rows %, stop rows %) — go-live would show nothing', n_r_on, n_s_on;
  END IF;
  IF v_anon_write IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'anon INSERT into walking_routes was %', v_anon_write; END IF;
  IF v_restrict   IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'deleting a place on a route was % — RESTRICT is not in force', v_restrict; END IF;
  IF EXISTS (SELECT 1 FROM public.walking_routes WHERE source = 'zzprobe') THEN
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
VALUES ('20261048_walking_routes.sql', '9bd81116cba72d8b72ddbeff9530d6dca4588fbdee57b987fc2371a6080d99c5')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   SELECT relname, relrowsecurity FROM pg_class WHERE oid IN
--     (to_regclass('public.walking_routes'), to_regclass('public.walking_route_stops'));   -- expect 2 rows, true
--   SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename LIKE 'walking_route%';  -- expect 2 rows, SELECT
--
-- ─── Rollback (only if the routes are abandoned) ────────────────────────────
--   DROP TABLE IF EXISTS public.walking_route_stops;
--   DROP TABLE IF EXISTS public.walking_routes;
