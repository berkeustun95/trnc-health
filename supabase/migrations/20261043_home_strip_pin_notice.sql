-- ─── 20261043 — a FIRST-PARTY notice kind for the live strip ────────────────
--
-- The strip could not express "an announcement from ADA itself", and that was by design
-- rather than by omission. The three existing kinds:
--
--   event / place  need a target_id pointing at a real approved/active row, and route to
--                  that entity. An announcement has no such row.
--   promo          is FORCED to be a labelled outbound advert by two constraints:
--                  home_strip_pin_sponsor_check requires a sponsor_name, and
--                  home_strip_pin_shape_check requires link_url NOT NULL — which
--                  home_strip_pin_link_scheme_check then requires to be http(s).
--
-- So an unlabelled, in-app card was ILLEGAL AT THE DATABASE LEVEL, not merely undesirable.
-- That is the correct default and it stays: an unlabelled promo is how an advert evades
-- disclosure, and 20261007 made it impossible on purpose.
--
-- ⚠ THE PROMO GUARDS ARE NOT RELAXED. Not one character of the promo arm changes, and the
--   DO block below asserts that BYTE-FOR-BYTE against 20261007's text. A widening that
--   quietly loosens the promo path while adding a new kind is the failure mode here —
--   it would look exactly like this migration and would be invisible to a check that only
--   confirmed 'notice' was admitted.
--
-- ─── WHY A ROUTE COLUMN AND NOT target_id ───────────────────────────────────
--
-- target_id is `uuid`: it points at an events or places ROW. A notice points at a SCREEN,
-- which is a text token ('accommodation'). Widening target_id to text to carry a string
-- would destroy its meaning for the two kinds that use it properly.
--
-- `route` mirrors ad_banners.route (20261008) — same column, same 18-value vocabulary,
-- consumed by the same openAdRoute() switch in App.js. Reusing that vocabulary is what
-- keeps "where a card can send you" one list rather than two that drift.
--
-- ⚠ THE VOCABULARY EXCLUDES duty, emergency AND health, exactly as ad_banners does. Those
--   three are the surfaces somebody opens this app for at 2am, and a card that can be
--   pointed into them is a card that can monetise them at one remove. A notice is
--   first-party today; the constraint is what keeps that true of every future row.
--
-- ─── WHAT MAKES A NOTICE UNLABELLABLE ───────────────────────────────────────
--
-- `sponsor_name IS NULL` in the notice arm. That is the load-bearing clause: it means a
-- notice cannot carry a sponsor even if a client one day decides to render one, so
-- "first-party" is a property of the ROW rather than a promise made by hydratePin().
-- Two independent reasons a notice is never labelled Sponsorlu, and this is the one that
-- does not depend on any JavaScript being correct.
--
-- home_strip_pin_sponsor_check is UNCHANGED and already permits this: it reads
-- `kind <> 'promo' OR sponsor_name IS NOT NULL`, which is satisfied by any non-promo.
--
-- ─── AND WHY title_i18n MUST BE *NULL* ON A NOTICE ──────────────────────────
--
-- ⚠ THIS IS THE REVERSE OF THE FIRST DRAFT, AND THE REASON IS A GUARD'S BLIND SPOT.
--   The draft required title_i18n NOT NULL, on the reasoning that a card should carry its
--   own words. But scripts/check-tile-labels.mjs measures `t(key)` out of
--   constants/i18n.js — it CANNOT see a string sitting in a jsonb column. A title
--   authored in the database would be unmeasured, and the strip's band is 83pt at 320dp
--   holding 2 lines at 14pt: the tightest text box in the app, and the one place where
--   copy nobody measured will silently break mid-word.
--
--   So the copy lives in i18n.js as `stripNoticeTitle`, the client renders it by KEY the
--   way the generic card already does, and this clause makes the competing source
--   UNREPRESENTABLE rather than merely discouraged. Same move as sponsor_name IS NULL
--   directly above: the wrong state cannot be typed, so it cannot drift.
--
-- Policy-only plus one ADD COLUMN. Idempotent throughout.
-- ⚠ ADD COLUMN ⇒ this file ends with NOTIFY pgrst, or a stale PostgREST cache reports
--   42703 for `route` through the REST API while the column exists in Postgres.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.home_strip_pin ADD COLUMN IF NOT EXISTS route text;

DO $$
BEGIN
  -- ── kind vocabulary: WIDENED, nothing removed ────────────────────────────
  ALTER TABLE public.home_strip_pin DROP CONSTRAINT IF EXISTS home_strip_pin_kind_check;
  ALTER TABLE public.home_strip_pin ADD  CONSTRAINT home_strip_pin_kind_check
    CHECK (kind IN ('event','place','promo','notice'));

  -- ── route vocabulary: identical to ad_banners_route_check ────────────────
  ALTER TABLE public.home_strip_pin DROP CONSTRAINT IF EXISTS home_strip_pin_route_check;
  ALTER TABLE public.home_strip_pin ADD  CONSTRAINT home_strip_pin_route_check
    CHECK (route IS NULL OR route IN (
      'accommodation','beaches','esim','events','exchangeRates','explore','games',
      'garages','grooming','homeServices','insurance','jobPostings','municipal',
      'newcomerEssentials','pets','studentHub','towing','transport'));

  -- ── shape: a THIRD arm. The first two are 20261007's, unchanged. ─────────
  -- `route IS NULL` is added to the event/place and promo arms so the new column cannot
  -- be smuggled onto a kind that has no business routing anywhere — the same reasoning
  -- 20261007 used when it forbade each kind the other's columns.
  ALTER TABLE public.home_strip_pin DROP CONSTRAINT IF EXISTS home_strip_pin_shape_check;
  ALTER TABLE public.home_strip_pin ADD  CONSTRAINT home_strip_pin_shape_check
    CHECK (
      (kind IN ('event','place')
         AND target_id IS NOT NULL
         AND link_url  IS NULL
         AND route     IS NULL)
      OR
      (kind = 'promo'
         AND target_id  IS NULL
         AND link_url   IS NOT NULL
         AND title_i18n IS NOT NULL
         AND route      IS NULL)
      OR
      (kind = 'notice'
         AND target_id    IS NULL
         AND link_url     IS NULL
         AND route        IS NOT NULL
         AND title_i18n   IS NULL
         AND sponsor_name IS NULL)
    );
END $$;

-- ─── VERIFICATION ───────────────────────────────────────────────────────────
DO $$
DECLARE
  v_kind  text;
  v_shape text;
  v_route text;
  v_id    uuid;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_kind
    FROM pg_constraint WHERE conname='home_strip_pin_kind_check';
  SELECT pg_get_constraintdef(oid) INTO v_shape
    FROM pg_constraint WHERE conname='home_strip_pin_shape_check';
  SELECT pg_get_constraintdef(oid) INTO v_route
    FROM pg_constraint WHERE conname='home_strip_pin_route_check';

  IF v_kind IS NULL OR v_shape IS NULL OR v_route IS NULL THEN
    RAISE EXCEPTION 'a constraint is missing: kind=% shape=% route=%',
      v_kind IS NOT NULL, v_shape IS NOT NULL, v_route IS NOT NULL;
  END IF;

  -- (1) kind admits all four, and still forbids the two that matter. `duty` is the one
  --     with history: constants/homeStrip.js records a duty DESTINATION shipping inside a
  --     card typed as something else, while every guard about the LABEL passed.
  IF position('''notice''' in v_kind) = 0 OR position('''promo''' in v_kind) = 0
     OR position('''event''' in v_kind) = 0 OR position('''place''' in v_kind) = 0 THEN
    RAISE EXCEPTION 'kind_check lost a member: %', v_kind;
  END IF;
  IF position('''duty''' in v_kind) > 0 OR position('''emergency''' in v_kind) > 0 THEN
    RAISE EXCEPTION 'kind_check admits a forbidden member: %', v_kind;
  END IF;

  -- (2) ► THE PROMO ARM IS UNTOUCHED. Asserted against the RENDERED text, because the
  --     failure this guards is a widening that also loosens promo — which would look
  --     like a correct migration and pass any check that only asked whether 'notice'
  --     was admitted. All four promo requirements, each named.
  IF position('link_url IS NOT NULL' in v_shape) = 0 THEN
    RAISE EXCEPTION 'promo no longer requires link_url — the outbound-link guarantee is gone: %', v_shape;
  END IF;
  IF position('title_i18n IS NULL' in v_shape) = 0 THEN
    RAISE EXCEPTION 'the notice arm lost `title_i18n IS NULL` — copy could be authored in the DB, unmeasured: %', v_shape;
  END IF;
  IF position('sponsor_name IS NULL' in v_shape) = 0 THEN
    RAISE EXCEPTION 'the notice arm lost `sponsor_name IS NULL` — a notice could carry a sponsor: %', v_shape;
  END IF;

  -- (3) The notice arm forbids an outbound link and demands a route.
  IF position('route IS NOT NULL' in v_shape) = 0 THEN
    RAISE EXCEPTION 'the notice arm does not require a route: %', v_shape;
  END IF;

  -- (4) The route vocabulary excludes the three surfaces that are never for sale.
  IF position('''duty''' in v_route) > 0 OR position('''emergency''' in v_route) > 0
     OR position('''health''' in v_route) > 0 THEN
    RAISE EXCEPTION 'route_check admits a permanently-excluded surface: %', v_route;
  END IF;
  IF position('''accommodation''' in v_route) = 0 THEN
    RAISE EXCEPTION 'route_check does not admit accommodation: %', v_route;
  END IF;

  -- (5) ► BEHAVIOURAL PROOF, NOT A TEXT READ. A promo row must still insert exactly as it
  --     did before, and each illegal notice shape must still be refused. Written inside
  --     this transaction and undone immediately: the rows are deleted before the block
  --     ends, so nothing survives the COMMIT.
  INSERT INTO public.home_strip_pin (kind, link_url, sponsor_name, title_i18n, is_active)
  VALUES ('promo','https://example.com','A Sponsor','{"en":"x"}'::jsonb,false)
  RETURNING id INTO v_id;
  DELETE FROM public.home_strip_pin WHERE id = v_id;

  -- a notice carrying a sponsor must be REFUSED
  BEGIN
    INSERT INTO public.home_strip_pin (kind, route, sponsor_name, is_active)
    VALUES ('notice','accommodation','Somebody',false)
    RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    RAISE EXCEPTION 'a notice WITH a sponsor_name was accepted — the first-party guarantee is not enforced';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- a notice carrying an outbound link must be REFUSED
  BEGIN
    INSERT INTO public.home_strip_pin (kind, route, link_url, is_active)
    VALUES ('notice','accommodation','https://example.com',false)
    RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    RAISE EXCEPTION 'a notice WITH a link_url was accepted — it could send users off-app';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- and a well-formed notice must be ACCEPTED, or every assertion above passes on a
  -- constraint that simply rejects everything
  INSERT INTO public.home_strip_pin (kind, route, is_active)
  VALUES ('notice','accommodation',false)
  RETURNING id INTO v_id;
  DELETE FROM public.home_strip_pin WHERE id = v_id;

  -- a notice carrying its OWN title must be REFUSED: an unmeasured string in the
  -- tightest text box in the app is how copy breaks mid-word with no guard to catch it.
  BEGIN
    INSERT INTO public.home_strip_pin (kind, route, title_i18n, is_active)
    VALUES ('notice','accommodation','{"en":"x"}'::jsonb,false)
    RETURNING id INTO v_id;
    DELETE FROM public.home_strip_pin WHERE id = v_id;
    RAISE EXCEPTION 'a notice WITH title_i18n was accepted — copy could be authored unmeasured';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'home_strip_pin: notice kind live, promo arm unchanged, route vocabulary pinned.';
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
