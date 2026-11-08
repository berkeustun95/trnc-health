-- ═══════════════════════════════════════════════════════════
-- 20261178 — places: a 'staged' status that only ADA Preview can read (OSM free listings)
-- ═══════════════════════════════════════════════════════════
--
-- Why: Explore's eat_drink / active / services groups switch themselves on at GROUP_TILE_THRESHOLD (8)
-- ACTIVE rows, on every production build already installed. The OSM free listings (20261179, ~400
-- cafés, gyms, hair salons, print shops, laundries) must be seen on the Preview phone and approved by
-- Berke before any user sees them (Berke 2026-11-08). A client flag cannot hold that line — builds
-- already on phones have no such flag — so the gate is here, in RLS.
--
-- Plain English, what changes:
--   • places.status may now also be 'staged': imported, not published.
--   • places_select_preview_staged — SELECT only, anon + authenticated: a staged row is readable ONLY
--     when the request carries the ADA Preview key (public.is_previewer(), 20261120). Production
--     builds never send it, so for them a staged row does not exist: no pin, no count, no detail.
--   • Nothing else: places_select still opens only 'active' (plus own / owned rows, admin all);
--     explore_category_counts() still counts only 'active'; check_in() still requires 'active';
--     users still insert only 'pending'. Staged rows never enter the moderation queue ('pending').
--   • Publishing = a later migration: UPDATE places SET status = 'active' WHERE source = 'osm'
--     AND status = 'staged' — on Berke's go, after his device check.
--
-- Preview contract (20261120): every is_previewer() policy is a SELECT and is paired with the
-- unpublished condition — here status = 'staged'.
--
-- Apply: gh workflow run supabase-migrate -f file=20261178_places_staged_preview.sql (dry), then -f apply=true.

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.places DROP CONSTRAINT places_status_check;
ALTER TABLE public.places ADD CONSTRAINT places_status_check
  CHECK (status = ANY (ARRAY['pending','active','rejected','staged']::text[]));

DROP POLICY IF EXISTS "places_select_preview_staged" ON public.places;
CREATE POLICY "places_select_preview_staged" ON public.places
  FOR SELECT TO anon, authenticated
  USING (status = 'staged' AND (SELECT public.is_previewer()));

COMMENT ON COLUMN public.places.status IS
  'pending (user submission, moderation queue) | active (public) | rejected | staged (imported, not published: readable only with the ADA Preview key, 20261178).';

-- ─── Assertions: the FULL policy set on places, printed ────────────────────────
DO $$
DECLARE
  v_n int; v_names text; v_def text; v_q text;
BEGIN
  SELECT count(*), string_agg(policyname || ':' || cmd || ':' || permissive, ', ' ORDER BY policyname)
    INTO v_n, v_names FROM pg_policies WHERE schemaname = 'public' AND tablename = 'places';
  RAISE NOTICE 'places policies (%): %', v_n, v_names;

  -- The new policy: SELECT, permissive, staged AND is_previewer(), no WITH CHECK.
  SELECT qual INTO v_q FROM pg_policies WHERE schemaname = 'public' AND tablename = 'places'
     AND policyname = 'places_select_preview_staged' AND cmd = 'SELECT' AND permissive = 'PERMISSIVE' AND with_check IS NULL;
  IF v_q IS NULL OR v_q NOT LIKE '%''staged''%' OR v_q NOT LIKE '%is_previewer()%' THEN
    RAISE EXCEPTION 'places_select_preview_staged missing or wrong: %', coalesce(v_q, '(none)');
  END IF;

  -- The 20261120 contract on places: every is_previewer() policy is a SELECT paired with 'staged'.
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'places'
              AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%is_previewer%'
              AND (cmd <> 'SELECT' OR coalesce(qual, '') NOT LIKE '%''staged''%')) THEN
    RAISE EXCEPTION 'an is_previewer() policy on places breaks the preview contract';
  END IF;

  -- No OTHER policy opens staged rows (permissive-OR: mine present never proves theirs absent).
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'places'
              AND policyname <> 'places_select_preview_staged' AND coalesce(qual, '') LIKE '%staged%') THEN
    RAISE EXCEPTION 'another places policy mentions staged';
  END IF;

  -- Positive control: the public read is unchanged — still 'active' (+ own/owned/admin).
  SELECT qual INTO v_q FROM pg_policies WHERE schemaname = 'public' AND tablename = 'places' AND policyname = 'places_select';
  IF v_q IS NULL OR v_q NOT LIKE '%''active''%' THEN RAISE EXCEPTION 'places_select lost its active arm: %', coalesce(v_q, '(none)'); END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.places'::regclass AND conname = 'places_status_check';
  IF v_def NOT LIKE '%staged%' OR v_def NOT LIKE '%pending%' OR v_def NOT LIKE '%active%' OR v_def NOT LIKE '%rejected%' THEN
    RAISE EXCEPTION 'places_status_check wrong: %', v_def;
  END IF;

  RAISE NOTICE '20261178 OK: staged status + Preview-only read';
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
VALUES ('20261178_places_staged_preview.sql', 'fafb937c3f99cd5cf1d00e3e8f42839e28e60dd16a880625abf22acc0665dfa7')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;
NOTIFY pgrst, 'reload schema';
