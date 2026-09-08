-- ═══════════════════════════════════════════════════════════════════════════
-- ad_banners — from a flat slot id to POSITION × MODULE, plus the ad_modules lookup.
--
-- ▶ ONE READY-TO-PASTE BLOCK. Supabase SQL editor, Role → postgres, select the whole
--   file and run it. Everything below is inside BEGIN … COMMIT: an assertion that fires
--   half-applies nothing and the file is re-runnable the moment the cause is fixed.
--
-- ⚠ NUMBERED 20261009 BECAUSE THE LEDGER RUNS TO 20261008. These names are a SEQUENCE
--   that happens to look like dates.
--
-- ─── WHY THE FIRST SCHEME IS BEING REPLACED THREE DAYS IN ───────────────────
--
-- 20261008 shipped a flat vocabulary: home_hero, home_footer, module_landing,
-- guide_inline, detail_footer, entry. Only `home_footer` was ever DESIGNED — a search of
-- the whole project vault found the other five in exactly one file, the note written the
-- day they were built, and that note describes them as a vocabulary rather than a design.
-- They were names, and a name is not a placement.
--
-- Reading the actual screens killed two of them outright and reshaped the rest:
--
--   • A flat id cannot say "the same shape, on a different module" without minting a new
--     id AND a new migration. Position × module says it in two columns.
--   • `module_landing` and `detail_footer` were surface-GENERIC, which is precisely what
--     makes the exclusion list unenforceable in the database — see below.
--
-- So: ONE scheme, migrated now, no compatibility layer. `slot` is dropped in this file.
--
-- ⚠ ONCE THIS IS APPLIED, 20261008 MUST NOT BE RE-RUN. Its verification block INSERTs
--   probe rows using `slot`, which no longer exists, so it aborts inside its own
--   transaction — loudly, applying nothing, which is the safe failure. But it will look
--   like a broken migration rather than a superseded one. 20261008 is deliberately NOT
--   edited to say so: it is already applied and stamped, and changing an applied file
--   would trip the ledger's "applied, then edited" checksum alarm for a comment.
--
-- ─── POSITION IS A CHECK. MODULE IS A FOREIGN KEY. ──────────────────────────
--
-- POSITION — four values, constrained by CHECK. Changing it IS a migration, deliberately:
-- a new position is a new component shape, so it is a code change either way, and the
-- CHECK is what forces that to be reviewed rather than typed into a row.
--
-- MODULE — a FK into `ad_modules`. Adding a fifth module is an INSERT.
--
-- ⚠ AND "ADDING A MODULE IS A DATA CHANGE" IS TRUE OF THE DATABASE ONLY. An INSERT into
--   ad_modules makes the row insertable. NOTHING RENDERS until a wrapper in
--   components/ads/ is mounted on that module's screen, allowlisted in constants/ads.js,
--   and shipped by OTA. The FK removes the migration, not the code. Do not sell a
--   placement on the strength of the lookup row existing — that is the same shape as this
--   repo's "committed but never applied" failure, in a new dress.
--
-- ─── WHAT IS SEEDED, AND THE ONE DELIBERATE OMISSION ────────────────────────
--
--   home           the migrated home_footer, now (list_bottom, home)
--   accommodation  list_top · list_inline · list_bottom · detail_bottom
--   events         list_top · list_inline · list_bottom · detail_bottom
--   explore        list_top · list_inline · detail_bottom   (NO list_bottom — see below)
--
-- ⚠ `newcomerEssentials` IS NOT SEEDED, AND THAT IS THE DECISION, NOT AN OVERSIGHT.
--   The Welcome Guide has NO LIST: a 7-tile hub grid plus seven card ScrollViews. So
--   list_top/list_bottom have nothing to attach to, and list_inline ("after the 8th item")
--   can never fire against 7 tiles. Only a bottom-of-card slot is meaningful and it needs
--   seven mounts or a shared wrapper that does not exist.
--   Seeding it anyway would create a lookup row with no placeable position — which would
--   ACCEPT A PAID CAMPAIGN THAT RENDERS NOWHERE and passes every check in this repo.
--   Inert inventory that looks sold is worse than absent inventory. It is genuinely
--   valuable (newcomers land there); the one INSERT the day a buyer names it is then the
--   review moment that catches "and where exactly does it go?".
--
-- ⚠ `list_bottom` on `explore` IS NOT A PLACEMENT and the database cannot say so.
--   ExploreScreen carries a 52x52 FAB at bottom:24/right:16 floating over every branch,
--   and its listContent paddingBottom is 40 — less than the FAB's footprint. A banner
--   there renders underneath it. This is a CLIENT fact; the DB will happily accept the
--   row. scripts/check-ad-placement.mjs is what refuses it, because it knows the files.
--
-- ─── THE EXCLUSION LIST STILL CANNOT LIVE HERE, AND NOW LESS THAN EVER ──────
--
-- NO ADS ON: duty pharmacy, emergency contacts, health facilities, search results, push
-- notifications, Ask Oli.
--
-- `detail_bottom` is a POSITION. `explore` is an ALLOWED MODULE. A row saying
-- "detail_bottom on explore" is valid in every constraint below — and mounted on
-- FacilityProfileScreen it is an ad on a health surface. The database cannot see where a
-- component is mounted and never will. Only a file path identifies a surface.
--
-- Enforcement is scripts/check-ad-placement.mjs: a mount-point allowlist keyed by FILE,
-- run in .githooks/pre-push and in the `npm run ota` chain. Its load-bearing rule is that
-- an allowlisted file may not also be an excluded surface — which is what defeats the
-- tempting argument "explore is allowed, so its detail screen is fine".
--
-- For the record, established while designing this round and the reason explore's
-- detail_bottom is safe: ExploreProfileScreen CANNOT render a health facility. The Explore
-- taxonomy has 16 categories and none is health; the screen takes `place` as a prop and
-- never queries; all three feeders read `places` WHERE status='active'; HomeScreen's search
-- routes `medical` hits to FacilityProfileScreen instead; and mapSources drops any row
-- whose category has no group. The Explore→health path is ExploreMapScreen — a different
-- file, now named explicitly in AD_EXCLUDED_SURFACES rather than merely un-allowlisted.
--
-- ─── AFTER APPLYING ────────────────────────────────────────────────────────
--   1. Run supabase/verify_schema.sql. QUERY 1's verdict row must read ALL n PASS;
--      QUERY 3 must show ad_banners with 8 policies and ad_modules with 5.
--   2. Any pre-existing home_footer row is now (list_bottom, home) and keeps its counters.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET ROLE postgres;

-- ─── ad_modules — the lookup that makes a new module a data change ──────────
CREATE TABLE IF NOT EXISTS public.ad_modules (
  module    text PRIMARY KEY,
  note      text,
  added_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ad_modules IS
  'Modules that may carry an ad. A FK target so adding one is an INSERT rather than a '
  'migration — but the DATABASE only. Nothing renders until a wrapper in components/ads/ '
  'is mounted on that module''s screen and shipped by OTA. newcomerEssentials is '
  'deliberately absent: it has no list, so a row here would accept a paid campaign that '
  'renders nowhere. See 20261009_ad_slots_position_module.sql.';

INSERT INTO public.ad_modules (module, note) VALUES
  ('home',          'Home V2 hub. list_bottom only — the migrated home_footer slot.'),
  ('accommodation', 'AccommodationScreen list + PropertyDetailScreen. All four positions.'),
  ('events',        'EventsScreen list + EventDetailScreen (same file). All four positions.'),
  ('explore',       'ExploreScreen DRILLED-IN CATEGORY LIST only + ExploreProfileScreen. '
                    'NO list_bottom: a FAB occupies that corner. Never the group-tile '
                    'landing, never the saved list, NEVER the map.')
ON CONFLICT (module) DO UPDATE SET note = excluded.note;

-- ─── ad_banners: slot -> position + module ─────────────────────────────────
-- ⚠ `position` IS A POSTGRES KEYWORD — non-reserved, "cannot be function or type name".
--   As a COLUMN name it is legal and needs no quoting, and PostgREST filters it as
--   ?position=eq.list_top without ceremony. Named plainly anyway rather than dodged into
--   `slot_position`, because the model's word for this is "position" and a column that
--   does not use the domain's word is a column somebody mis-reads later. The one place to
--   stay awake is that `position(x in y)` is also a FUNCTION — used in this file's own
--   verification block, where no column of that name is in scope.
ALTER TABLE public.ad_banners ADD COLUMN IF NOT EXISTS position text;
ALTER TABLE public.ad_banners ADD COLUMN IF NOT EXISTS module   text;

-- Backfill BEFORE the NOT NULLs and the FK, so an existing campaign survives the change
-- with its counters intact. Written as a mapping rather than a blanket UPDATE: only
-- home_footer was ever placed, and any row carrying one of the other five ids would be a
-- row nobody could have seen — it should surface as a failure below, not be silently
-- relabelled into a placement it was never sold as.
UPDATE public.ad_banners
   SET position = 'list_bottom', module = 'home'
 WHERE position IS NULL
   AND slot = 'home_footer';

DO $mig$
DECLARE
  v_orphan int;
  v_list   text;
BEGIN
  -- Anything still unmapped carries one of the five never-placed ids. Refuse rather than
  -- guess: there is no correct position for a name that never had a design.
  SELECT count(*), string_agg(DISTINCT slot, ', ')
    INTO v_orphan, v_list
    FROM public.ad_banners WHERE position IS NULL OR module IS NULL;
  IF v_orphan > 0 THEN
    RAISE EXCEPTION 'ad_banners has % row(s) whose slot has no place in the new model '
                    '(slots: %). Only home_footer was ever placed. Decide what each row '
                    'should become and UPDATE it by hand, then re-run — this migration '
                    'will not invent a position for a name that never had a design.',
      v_orphan, coalesce(v_list, '<null>');
  END IF;
END $mig$;

ALTER TABLE public.ad_banners ALTER COLUMN position SET NOT NULL;
ALTER TABLE public.ad_banners ALTER COLUMN module   SET NOT NULL;

-- The old flat vocabulary goes with its column. Dropping the constraint first keeps the
-- DROP COLUMN from depending on it.
ALTER TABLE public.ad_banners DROP CONSTRAINT IF EXISTS ad_banners_slot_check;
ALTER TABLE public.ad_banners DROP COLUMN IF EXISTS slot;

DO $$
BEGIN
  -- POSITION: a CHECK, so a new one is a reviewed migration. See the header.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_banners_position_check') THEN
    ALTER TABLE public.ad_banners ADD CONSTRAINT ad_banners_position_check
      CHECK (position IN ('list_top','list_inline','list_bottom','detail_bottom'));
  END IF;

  -- MODULE: a FK, so a new one is an INSERT. RESTRICT rather than CASCADE — deleting a
  -- module out from under a live campaign should fail loudly, not silently delete the ad.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_banners_module_fkey') THEN
    ALTER TABLE public.ad_banners ADD CONSTRAINT ad_banners_module_fkey
      FOREIGN KEY (module) REFERENCES public.ad_modules(module)
      ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END $$;

-- The read the app makes, INCLUDING its ORDER BY. Replaces the slot-keyed index.
DROP INDEX IF EXISTS public.idx_ad_banners_slot_live;
CREATE INDEX IF NOT EXISTS idx_ad_banners_position_module_live
  ON public.ad_banners (position, module, starts_at DESC, created_at DESC)
  WHERE is_active;

-- ─── ad_modules RLS ────────────────────────────────────────────────────────
-- Public read: the client never queries this table today (AD_MODULES is compiled into the
-- bundle), but a future admin screen will, and a lookup of four public words is not
-- something to gate. Write is admin-only + anon-guarded, same posture as ad_banners.
ALTER TABLE public.ad_modules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ad_modules_select_public" ON public.ad_modules;
CREATE POLICY "ad_modules_select_public" ON public.ad_modules
  FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "ad_modules_insert_admin" ON public.ad_modules;
CREATE POLICY "ad_modules_insert_admin" ON public.ad_modules
  FOR INSERT TO authenticated WITH CHECK ((select public.is_admin()));

DROP POLICY IF EXISTS "ad_modules_update_admin" ON public.ad_modules;
CREATE POLICY "ad_modules_update_admin" ON public.ad_modules
  FOR UPDATE TO authenticated
  USING ((select public.is_admin())) WITH CHECK ((select public.is_admin()));

DROP POLICY IF EXISTS "ad_modules_delete_admin" ON public.ad_modules;
CREATE POLICY "ad_modules_delete_admin" ON public.ad_modules
  FOR DELETE TO authenticated USING ((select public.is_admin()));

DROP POLICY IF EXISTS "no_anon_insert_ad_modules" ON public.ad_modules;
CREATE POLICY "no_anon_insert_ad_modules" ON public.ad_modules
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (select public.is_anonymous_session()));

GRANT SELECT ON public.ad_modules TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.ad_modules TO authenticated;

-- ═══ VERIFICATION — inside the transaction, so a failure applies nothing ════
--
-- ⚠ EVERY COMPARISON IS `IS DISTINCT FROM`, NEVER `<>`. ⚠ COUNTS ARE DERIVED AND PRINTED.
-- ⚠ EVERY NEGATIVE HAS A POSITIVE CONTROL. ⚠ AND THE FRAME OF REFERENCE, STATED BEFORE
--   THE RUN: this executes as `postgres` and BYPASSES RLS, so the probes prove the
--   CONSTRAINTS and the FK behave — nothing about who can read or write through the API.
--   That half is asserted from pg_policies, which is the right kind of evidence for it.
DO $$
DECLARE
  v_positions  text;
  v_modules    text;
  v_mod_rows   int;
  v_policies   int;
  v_slot_gone  boolean;
  v_idx        boolean;
  v_probe      uuid;
  v_home       int;
BEGIN
  -- ── slot is really gone. Two schemes is the thing this migration exists to prevent.
  SELECT NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='ad_banners' AND column_name='slot')
    INTO v_slot_gone;
  IF v_slot_gone IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ad_banners.slot still exists — the old flat vocabulary is still '
                    'live alongside the new one, which is exactly the two-scheme state '
                    'this migration was written to avoid.';
  END IF;

  -- ── position vocabulary, read from the constraint rather than from this file ──
  SELECT pg_get_constraintdef(oid) INTO v_positions
    FROM pg_constraint WHERE conname='ad_banners_position_check';
  IF v_positions IS NULL THEN
    RAISE EXCEPTION 'ad_banners_position_check does not exist — position is unconstrained';
  END IF;
  -- CONTROL FIRST: without it, the negatives below pass trivially on an empty definition.
  IF position('''list_top''' in v_positions) = 0 OR position('''list_inline''' in v_positions) = 0
     OR position('''list_bottom''' in v_positions) = 0 OR position('''detail_bottom''' in v_positions) = 0 THEN
    RAISE EXCEPTION 'CONTROL FAILED: the position constraint does not mention all four '
                    'positions, so anything concluded from it is meaningless. def = %', v_positions;
  END IF;
  -- The five never-designed ids must not have survived as positions.
  IF position('''home_hero''' in v_positions) > 0 OR position('''module_landing''' in v_positions) > 0
     OR position('''guide_inline''' in v_positions) > 0 OR position('''detail_footer''' in v_positions) > 0
     OR position('''entry''' in v_positions) > 0 THEN
    RAISE EXCEPTION 'the old flat slot vocabulary leaked into the position CHECK. def = %', v_positions;
  END IF;

  -- ── ad_modules seed, DERIVED and PRINTED, never compared to a remembered list ──
  SELECT count(*), string_agg(module, ', ' ORDER BY module)
    INTO v_mod_rows, v_modules FROM public.ad_modules;
  IF v_mod_rows IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'expected 4 seeded ad_modules, found % (%). If a fifth module is '
                    'genuinely being added, bump this and say why — that edit is the '
                    'review moment a name list never creates.', v_mod_rows, coalesce(v_modules,'<none>');
  END IF;
  -- ⚠ THE DELIBERATE OMISSION, ASSERTED. newcomerEssentials has no list, so a lookup row
  --   for it would accept a paid campaign that renders nowhere and passes every check.
  IF EXISTS (SELECT 1 FROM public.ad_modules WHERE module = 'newcomerEssentials') THEN
    RAISE EXCEPTION 'newcomerEssentials is seeded in ad_modules. It has NO LIST — a hub '
                    'tile grid plus seven card ScrollViews — so no position is placeable '
                    'on it, and a row here would accept a PAID campaign that renders '
                    'nowhere. Remove it, or place a real slot first and then add it.';
  END IF;

  -- ── The FK actually rejects an unknown module, and accepts a known one ──
  BEGIN
    INSERT INTO public.ad_banners (position, module, advertiser_name, image_url, link_url, starts_at, ends_at)
    VALUES ('list_top','newcomerEssentials','Probe','https://example.com/a.png',
            'https://example.com', now(), now() + interval '1 day');
    RAISE EXCEPTION 'CONTROL FAILED: a banner on an unseeded module was ACCEPTED — the '
                    'ad_banners_module_fkey is not doing its job';
  EXCEPTION WHEN foreign_key_violation THEN NULL;  -- expected
  END;

  BEGIN
    INSERT INTO public.ad_banners (position, module, advertiser_name, image_url, link_url, starts_at, ends_at)
    VALUES ('detail_footer','events','Probe','https://example.com/a.png',
            'https://example.com', now(), now() + interval '1 day');
    RAISE EXCEPTION 'CONTROL FAILED: a banner carrying an OLD slot id as its position was ACCEPTED';
  EXCEPTION WHEN check_violation THEN NULL;  -- expected
  END;

  -- POSITIVE CONTROL, without which the two probes prove only that something rejects
  -- everything. Deleted immediately; this migration adds no rows to ad_banners.
  INSERT INTO public.ad_banners (position, module, advertiser_name, image_url, link_url,
                                 starts_at, ends_at)
  VALUES ('list_inline','explore','Probe','https://example.com/a.png','https://example.com',
          now(), now() + interval '1 day')
  RETURNING id INTO v_probe;
  IF v_probe IS NULL THEN
    RAISE EXCEPTION 'CONTROL FAILED: a well-formed (list_inline, explore) banner was rejected';
  END IF;
  DELETE FROM public.ad_banners WHERE id = v_probe;

  -- ── The migration of any real home_footer row ──
  SELECT count(*) INTO v_home
    FROM public.ad_banners WHERE position='list_bottom' AND module='home';

  -- ── The index the app's ORDER BY relies on ──
  SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
                   AND indexname='idx_ad_banners_position_module_live') INTO v_idx;
  IF v_idx IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'idx_ad_banners_position_module_live is missing';
  END IF;

  SELECT count(*) INTO v_policies
    FROM pg_policies WHERE schemaname='public' AND tablename='ad_modules';
  IF v_policies IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'expected 5 policies on ad_modules, found %. Present: %', v_policies,
      (SELECT string_agg(policyname || '(' || cmd || ')', ', ' ORDER BY policyname)
         FROM pg_policies WHERE schemaname='public' AND tablename='ad_modules');
  END IF;

  RAISE NOTICE '── ad_banners: position x module ─────────────────────────';
  RAISE NOTICE '  slot column dropped · positions: %', v_positions;
  RAISE NOTICE '  ad_modules (%): %', v_mod_rows, v_modules;
  RAISE NOTICE '  newcomerEssentials deliberately ABSENT — no list, so nothing placeable';
  RAISE NOTICE '  FK rejects an unseeded module; CHECK rejects an old slot id; a valid row is accepted';
  RAISE NOTICE '  migrated home_footer rows now (list_bottom, home): %', v_home;
  RAISE NOTICE '  ad_modules policies: %', v_policies;
  RAISE NOTICE '──────────────────────────────────────────────────────────';
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
VALUES ('20261009_ad_slots_position_module.sql', 'ebfc668036b569b75c3124962e46243d67f97c0428b7e14de73091186d0736a3')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- A dropped column, two new columns and a new table all move the PostgREST schema cache.
-- Without this the REST API answers 42703 for `position` on a table that has it, and the
-- client's fall-through would render that as an unsold slot — silently correct-looking.
NOTIFY pgrst, 'reload schema';

-- ─── REVERT ────────────────────────────────────────────────────────────────
--   BEGIN;
--     SET ROLE postgres;
--     ALTER TABLE public.ad_banners ADD COLUMN IF NOT EXISTS slot text;
--     UPDATE public.ad_banners SET slot = 'home_footer'
--      WHERE position = 'list_bottom' AND module = 'home';
--     -- Any other row has no old id to go back to; decide by hand before the NOT NULL.
--     ALTER TABLE public.ad_banners DROP CONSTRAINT IF EXISTS ad_banners_module_fkey;
--     ALTER TABLE public.ad_banners DROP CONSTRAINT IF EXISTS ad_banners_position_check;
--     ALTER TABLE public.ad_banners DROP COLUMN IF EXISTS position;
--     ALTER TABLE public.ad_banners DROP COLUMN IF EXISTS module;
--     DROP TABLE IF EXISTS public.ad_modules;
--   COMMIT;
--   RESET ROLE;
--   NOTIFY pgrst, 'reload schema';
