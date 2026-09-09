-- ─── Ev Hizmetleri becomes partner-only — the visibility half ───────────────
--
-- Policy change: the module stops being an open directory. Only firms ADA has an
-- agreement with are shown. This migration makes that true of the DATABASE; the app-side
-- gating of self-registration and the landing rework are separate, later changes, and
-- this file is deliberately safe to apply before either of them exists.
--
-- ─── WHAT THIS DOES, AND WHY IT IS A POLICY AND NOT A FUNCTION EDIT ─────────
--
-- The obvious move was to add `AND hs.is_partner` to search_content's home_services arm.
-- This does it in the RLS policy instead, and that is the stronger and the cheaper
-- choice at once:
--
--   * search_content is SECURITY INVOKER (prosecdef = false, confirmed against pg_proc,
--     not read off a file). So RLS on this table already filters what it returns —
--     20260912 relies on exactly that for towing_select_public. Tightening the policy
--     therefore filters global search with no function change.
--   * A CREATE OR REPLACE of search_content means restating its entire multi-arm body,
--     derived from pg_get_functiondef on the live database rather than from a migration
--     file. That is a hand-paste on the one function every global search in the app
--     depends on, to achieve something a policy does for free.
--   * And the policy is a stronger guarantee: a non-partner row becomes UNREADABLE, not
--     merely unsearchable. Search, the app's own queries, and any direct PostgREST call
--     are all covered by the one rule.
--
-- ─── is_partner IS THE VISIBILITY TRUTH ONLY ────────────────────────────────
-- It answers "may this row be seen". It does NOT answer "what do we show" — the tagline,
-- the about copy, the logo and the gallery live in constants/partners.js, and a partner
-- needs an entry there regardless. Two sources of truth for "who is a partner" is the
-- thing being avoided; do not make the app's card list query this column INSTEAD of the
-- config.
--
-- ─── DEFAULT false IS AN INVERSION, ON PURPOSE ──────────────────────────────
-- Same reasoning as towing_companies.is_active (20260907). An INSERT that omits the
-- column lands INVISIBLE rather than publishing itself. That matters more here than it
-- looks: hs_insert_self is closed below, but a future CRUD screen, an import script or a
-- hand-typed row all inherit the safe value without anyone remembering to think about it.
--
-- ⚠ THE TRIGGER COMES OFF FOR ONE STATEMENT, AGAIN. hs_guard_owner_update() raises
--   'home_services: no system-context updates allowed' whenever auth.uid() IS NULL, which
--   is always true in the SQL editor. The ADD COLUMN is fine — a column default is applied
--   without firing row triggers — but marking TadilArt as the partner is an UPDATE and
--   would abort the file. Same DISABLE/ENABLE wrap 20261010 used, and section 5 asserts
--   from pg_trigger that the guard came back on.
--
-- ─── BEFORE YOU PASTE: look at the policies you are about to replace ────────
-- This DROPs and recreates two policies. If either has drifted from what the repo thinks,
-- a recreate silently discards the drift. Run this first (read-only, no transaction) and
-- read the output — section 5 also prints the old definitions before replacing them:
--
--   SELECT policyname, cmd, permissive, qual, with_check
--   FROM pg_policies WHERE schemaname='public' AND tablename='home_services'
--   ORDER BY policyname;
--
-- EXECUTION: SQL editor, Role = postgres. Run the WHOLE FILE — one transaction ending in
-- COMMIT. A block-at-a-time paste stops before COMMIT and applies nothing.

SET ROLE postgres;

BEGIN;

-- ─── 1. The column ──────────────────────────────────────────────────────────
ALTER TABLE public.home_services
  ADD COLUMN IF NOT EXISTS is_partner boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.home_services.is_partner IS
  'VISIBILITY only: may this row be seen publicly. hs_select_public requires it, and '
  'search_content is SECURITY INVOKER so this filters global search too. What we DISPLAY '
  'for a partner (tagline, about, logo, gallery) lives in constants/partners.js. '
  'DEFAULT false is a deliberate inversion — an INSERT that omits it lands invisible.';

-- ─── 2. TadilArt is the only partner ────────────────────────────────────────
-- See the trigger note in the header. The DISABLE is scoped to the one guard, not
-- session_replication_role, and it is transactional: if anything below fails, the
-- ROLLBACK re-enables it.
ALTER TABLE public.home_services DISABLE TRIGGER hs_guard_owner_update;

UPDATE public.home_services
   SET is_partner = true
 WHERE id = '0496fb4c-4e5d-4e35-a238-dd1fcb402541';

ALTER TABLE public.home_services ENABLE TRIGGER hs_guard_owner_update;

-- ─── 2b. Snapshot what we are about to replace ──────────────────────────────
--
-- The count is CAPTURED, not remembered. An earlier draft of this file asserted
-- "home_services has 4 policies" from reading home_services_migration.sql — and it has
-- SEVEN: the four named there plus no_anon_insert/update/delete_home_services, added in
-- bulk by 20260714's loop over twenty-two tables. That assertion would have aborted this
-- migration against a database that was entirely correct, which is the file-is-not-the-
-- database failure this repo keeps meeting.
--
-- Comparing before with after is also the better assertion on its own terms: this file
-- REPLACES two policies in place, so the only correct outcome is an unchanged count,
-- whatever that count happens to be. It catches a DROP whose CREATE did not land without
-- anyone having to know the number.
--
-- The old definitions are printed as well, so a policy that had drifted from the repo is
-- visible in the output of the run that discarded it, rather than being lost silently.
DO $$
DECLARE n int; q text; w text;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='home_services';
  PERFORM set_config('ada.hs_policy_count', n::text, true);

  SELECT qual INTO q FROM pg_policies
   WHERE schemaname='public' AND tablename='home_services' AND policyname='hs_select_public';
  SELECT with_check INTO w FROM pg_policies
   WHERE schemaname='public' AND tablename='home_services' AND policyname='hs_insert_self';

  IF q IS NULL THEN RAISE EXCEPTION 'hs_select_public does not exist — nothing to replace'; END IF;
  IF w IS NULL THEN RAISE EXCEPTION 'hs_insert_self does not exist — nothing to replace'; END IF;

  RAISE NOTICE '── replacing, from a database with % policies on home_services ──', n;
  RAISE NOTICE '  OLD hs_select_public USING:     %', q;
  RAISE NOTICE '  OLD hs_insert_self WITH CHECK:  %', w;
END $$;

-- ─── 3. The public read arm now requires is_partner ─────────────────────────
--
-- ONLY the public arm changes. The owner arm stays so a provider can still see their own
-- row, and the admin arm stays so the approval queue still works — both matter for the
-- app-side gating that follows, and removing either here would be a second change
-- smuggled into this one.
--
-- No NULL-safety clause is needed: is_partner is NOT NULL, so `AND is_partner` cannot
-- evaluate to NULL and let a row through the way a nullable column would.
DROP POLICY IF EXISTS "hs_select_public" ON public.home_services;
CREATE POLICY "hs_select_public" ON public.home_services FOR SELECT
  USING (
    (status = 'active' AND is_partner)
    OR owner_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ─── 4. Self-registration is closed at the API, not only in the UI ──────────
--
-- WITH CHECK (false) rejects every INSERT, for every role this policy applies to. The app
-- gating that follows hides the form; this closes the door the form went through. Without
-- it, rows would keep arriving through PostgREST into an approval queue that is also
-- about to be hidden — accumulating where nobody looks, which is worse than either
-- accepting them or refusing them.
--
-- REVERSIBLE IN ONE STATEMENT: the revert block at the bottom restores the original
-- predicate verbatim.
DROP POLICY IF EXISTS "hs_insert_self" ON public.home_services;
CREATE POLICY "hs_insert_self" ON public.home_services FOR INSERT
  WITH CHECK (false);

-- ─── 5. Verification — derived, printed, and with a before/after control ────
DO $$
DECLARE
  v_null      text;
  v_type      text;
  v_default   text;
  v_partners  int;
  v_name      text;
  v_policies  int;
  v_names     text;
  v_select    text;
  v_insert    text;
  v_anon_before int;
  v_anon_after  int;
  v_tg        "char";
  v_rejected  boolean := false;
BEGIN
  -- Shape, from information_schema and not from the ALTER above it.
  SELECT is_nullable, data_type, column_default
    INTO v_null, v_type, v_default
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='home_services' AND column_name='is_partner';

  IF v_null IS DISTINCT FROM 'NO' THEN
    RAISE EXCEPTION 'is_partner is_nullable=% (expected NO)', coalesce(v_null,'<column absent>');
  END IF;
  IF v_type IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'is_partner data_type=% (expected boolean)', coalesce(v_type,'<null>');
  END IF;
  IF v_default IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'is_partner default is % — the safe inversion is gone', coalesce(v_default,'<none>');
  END IF;

  -- EXACTLY ONE partner, and it is the one we named. A count, not a name check: if a
  -- second partner is ever added legitimately this goes red, and that is the review
  -- moment a name check would never create.
  SELECT count(*) INTO v_partners FROM public.home_services WHERE is_partner;
  IF v_partners IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'expected exactly 1 partner row, found %', v_partners;
  END IF;
  SELECT name INTO v_name FROM public.home_services WHERE is_partner;
  IF v_name IS DISTINCT FROM 'TadilArt Cyprus' THEN
    RAISE EXCEPTION 'the single partner row is "%", expected TadilArt Cyprus', coalesce(v_name,'<null>');
  END IF;

  -- Policy set: compared against the count CAPTURED in section 2b, not against a number
  -- typed here. Replacing two policies in place must leave the count unchanged.
  SELECT count(*), string_agg(policyname, ', ' ORDER BY policyname)
    INTO v_policies, v_names
    FROM pg_policies WHERE schemaname='public' AND tablename='home_services';
  IF v_policies IS DISTINCT FROM current_setting('ada.hs_policy_count')::int THEN
    RAISE EXCEPTION 'policy count moved from % to % — a DROP landed without its CREATE: %',
      current_setting('ada.hs_policy_count'), v_policies, v_names;
  END IF;

  SELECT qual       INTO v_select FROM pg_policies
   WHERE schemaname='public' AND tablename='home_services' AND policyname='hs_select_public';
  SELECT with_check INTO v_insert FROM pg_policies
   WHERE schemaname='public' AND tablename='home_services' AND policyname='hs_insert_self';

  IF v_select IS NULL OR position('is_partner' in v_select) = 0 THEN
    RAISE EXCEPTION 'hs_select_public does not mention is_partner: %', coalesce(v_select,'<null>');
  END IF;
  IF v_insert IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'hs_insert_self WITH CHECK is %, expected false', coalesce(v_insert,'<null>');
  END IF;

  -- ── THE CONTROL THAT MATTERS: read it as anon, which is what a user is ────
  --
  -- Counting as postgres proves nothing — the table owner bypasses RLS. So impersonate,
  -- count, and RESET ROLE before doing anything else. What a healthy system prints here
  -- was decided before the run: the four test rows are active but not partners, and
  -- TadilArt is a partner but not active, so anon must see ZERO rows.
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_anon_after FROM public.home_services;
  RESET ROLE;

  -- And the before-figure, so the zero above is evidence rather than a coincidence: the
  -- same query against the same rows under the OLD predicate. If this is also 0 then
  -- nothing was hidden by this migration and the after-count means nothing.
  SELECT count(*) INTO v_anon_before FROM public.home_services WHERE status = 'active';

  IF v_anon_before = 0 THEN
    RAISE EXCEPTION 'CONTROL FAILED: no active rows existed, so hiding them proves nothing';
  END IF;
  IF v_anon_after IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'anon can still read % row(s) — the public arm is not doing its job', v_anon_after;
  END IF;

  -- ── And the INSERT really is refused, not just declared refused ───────────
  BEGIN
    SET LOCAL ROLE authenticated;
    SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111"}';
    INSERT INTO public.home_services (owner_id, name, phone, district, coverage_districts, service_types)
    VALUES ('11111111-1111-4111-8111-111111111111'::uuid, 'ZZ probe', '+90 000 000 0000',
            'nicosia', ARRAY['nicosia'], ARRAY['handyman']);
    RESET ROLE;
    RAISE EXCEPTION 'CONTROL FAILED: a self-registration INSERT was ACCEPTED';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    v_rejected := true;
  END;
  RESET ROLE;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'CONTROL FAILED: the INSERT was not rejected by RLS';
  END IF;

  SELECT tgenabled INTO v_tg FROM pg_trigger
   WHERE tgrelid = 'public.home_services'::regclass AND tgname = 'hs_guard_owner_update';
  IF v_tg IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION 'hs_guard_owner_update did NOT come back on: tgenabled=%',
      coalesce(v_tg::text,'<trigger absent>');
  END IF;

  RAISE NOTICE '── home_services: partner-only ───────────────────────────';
  RAISE NOTICE '  is_partner: NOT NULL boolean DEFAULT %', v_default;
  RAISE NOTICE '  partner rows: % (%)', v_partners, v_name;
  RAISE NOTICE '  policies: % (unchanged) → %', v_policies, v_names;
  RAISE NOTICE '  hs_select_public USING: %', v_select;
  RAISE NOTICE '  hs_insert_self WITH CHECK: %', v_insert;
  RAISE NOTICE '  rows anon could read BEFORE: %   AFTER: %', v_anon_before, v_anon_after;
  RAISE NOTICE '  self-registration INSERT: REJECTED by RLS';
  RAISE NOTICE '  hs_guard_owner_update tgenabled: % (O = on)', v_tg;
  RAISE NOTICE '  NB the 4 test rows are now invisible, NOT deleted — that is Phase D.';
  RAISE NOTICE '──────────────────────────────────────────────────────────';
END $$;

COMMIT;
RESET ROLE;

-- Without this, PostgREST answers 42703 for is_partner through the REST API even though
-- Postgres has it.
NOTIFY pgrst, 'reload schema';

-- ─── REVERT ────────────────────────────────────────────────────────────────
--   BEGIN;
--     SET ROLE postgres;
--     DROP POLICY IF EXISTS "hs_select_public" ON public.home_services;
--     CREATE POLICY "hs_select_public" ON public.home_services FOR SELECT
--       USING (
--         status = 'active'
--         OR owner_id = auth.uid()
--         OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
--       );
--     DROP POLICY IF EXISTS "hs_insert_self" ON public.home_services;
--     CREATE POLICY "hs_insert_self" ON public.home_services FOR INSERT
--       WITH CHECK (owner_id = auth.uid());
--     ALTER TABLE public.home_services DROP COLUMN IF EXISTS is_partner;
--   COMMIT;
--   RESET ROLE;
--   NOTIFY pgrst, 'reload schema';
-- Reverting the COLUMN requires reverting the SELECT policy first — the policy depends
-- on it and the DROP COLUMN would otherwise fail. Order above is correct as written.
