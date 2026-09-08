-- ─── TadilArt Cyprus — the Ev Hizmetleri launch partner row ─────────────────
--
-- DATA ONLY. No DDL. Requires 20261010 (coverage_districts) to have been applied.
--
-- TadilArt Cyprus is a renovation firm covering Lefkoşa and Girne, and the module's
-- commercial launch partner — NOT its owner. The directory stays open to self-registered
-- providers, and nothing in this file gives this row a privilege another row cannot have.
-- Sources: Instagram @tadilartcyprus, Facebook /tadilartcyprus.
-- ⚠ Not tadilart.com (an unrelated Istanbul firm), and not the similarly named Antalya
--   business. If you are re-checking the number, check it against those two accounts.
--
-- ─── THE ID IS A FIXED LITERAL, NOT gen_random_uuid() ───────────────────────
-- Phase 2 pins the featured card to this id from constants/partners.js. A generated id
-- would mean the config had to look the row up by NAME, and a lookup that returns zero
-- rows renders nothing while erroring nowhere — the card would simply be absent and the
-- module would look exactly as it does today. A literal also makes this file idempotent.
--
-- ─── status = 'pending', AND THAT IS THE POINT ──────────────────────────────
-- search_content() selects home_services rows on `hs.status = 'active'` ALONE. It does
-- not know MODULE_FLAGS exists. So an 'active' row is findable through global search the
-- moment it lands, while MODULE_FLAGS.homeServices is still false and the module still
-- renders Coming Soon — a user who searches "tadilat", finds a real firm, taps it and
-- lands on "coming soon" has learned that ADA cannot help them, which is the opposite of
-- what a pre-launch seed is for.
--
-- ⚠ pending → active IS NOT A SQL STATEMENT. hs_guard_owner_update() raises
--   'home_services: no system-context updates allowed' whenever auth.uid() IS NULL, which
--   is always true in the SQL editor. Activate through AdminScreen's Approve button,
--   signed in as an admin — that path sets exactly this column and is the only one the
--   guard permits. Do not reach for DISABLE TRIGGER to work around it: 20261010 does that
--   for a one-off backfill under review, not as a way to bypass an approval step.
--
-- ─── verified STAYS false ───────────────────────────────────────────────────
-- Verification is a manual act the project owner performs, never something a file asserts
-- on a partner's behalf. The commercial relationship is not the same fact as the badge.
--
-- ─── description STAYS NULL ─────────────────────────────────────────────────
-- `description` is a single-language text column and this app ships nine locales. The
-- partner's tagline and about paragraph live in constants/partners.js as i18n keys
-- (Phase 2), so there is one source of truth for them and it is not this row. Every
-- surface already hides an empty about block, so NULL renders as absence, not as a gap.
-- The outdoor-jacuzzi capability belongs in that about copy — it is NOT a service type.
--
-- EXECUTION: SQL editor, Role = postgres. Run the WHOLE FILE — one transaction ending in
-- COMMIT. No NOTIFY: nothing here changes the schema, so PostgREST's cache is unaffected.

SET ROLE postgres;

BEGIN;

INSERT INTO public.home_services (
  id, owner_id, name, phone, whatsapp, contact_pref,
  district, coverage_districts, service_types, description, status, verified
) VALUES (
  '0496fb4c-4e5d-4e35-a238-dd1fcb402541',
  NULL,                                    -- admin-seeded: no ADA account behind it
  'TadilArt Cyprus',                       -- capital A, exactly as the business writes it
  '+90 542 888 5505',
  '+90 542 888 5505',                      -- one number; Ara and WhatsApp both use it
  'both',
  'nicosia',                               -- base: Lefkoşa
  ARRAY['nicosia','kyrenia'],              -- Lefkoşa · Girne
  ARRAY['renovation','bathroom','kitchen','painter'],
  NULL,
  'pending',
  false
)
-- DO NOTHING, never DO UPDATE. A re-run after go-live must not reset status to 'pending'
-- and quietly un-launch the partner.
--
-- If a value here turns out to be wrong, note that there is no easy path: AdminScreen can
-- only move status and rejection_reason, and a plain UPDATE from this editor hits
-- hs_guard_owner_update's NULL-auth.uid() branch. Fixing a phone number or a coverage
-- array means a deliberate, reviewed DISABLE TRIGGER / UPDATE / ENABLE TRIGGER — the same
-- shape 20261010 uses for its backfill. That friction is the guard working, not a defect;
-- do not soften it by loosening the trigger.
ON CONFLICT (id) DO NOTHING;

-- ─── Verification — reads the row back, and prints what it read ─────────────
DO $$
DECLARE
  r               public.home_services%ROWTYPE;
  v_named         int;
  v_vocab         text[] := ARRAY['plumber','electrician','carpenter','painter','renovation',
                                  'bathroom','kitchen','sewer','ac_tech','locksmith',
                                  'tiler','handyman'];
  v_unknown       text[];
  v_searchable    int;
BEGIN
  SELECT * INTO r FROM public.home_services
   WHERE id = '0496fb4c-4e5d-4e35-a238-dd1fcb402541';

  IF r.id IS NULL THEN
    RAISE EXCEPTION 'the TadilArt row is absent — the INSERT did not land';
  END IF;

  -- IS DISTINCT FROM throughout: `<>` evaluates to NULL against a NULL column and
  -- IF NULL THEN does not fire, so every one of these would PASS on the exact failure
  -- it exists to catch.
  IF r.name IS DISTINCT FROM 'TadilArt Cyprus' THEN
    RAISE EXCEPTION 'name is %, expected TadilArt Cyprus', coalesce(r.name,'<null>');
  END IF;
  IF r.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'status is % — if this says active the row is already live in global search', coalesce(r.status,'<null>');
  END IF;
  IF r.verified IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'verified is % — verification is a manual step, not a seeded value', r.verified;
  END IF;
  IF r.phone IS DISTINCT FROM '+90 542 888 5505' OR r.whatsapp IS DISTINCT FROM '+90 542 888 5505' THEN
    RAISE EXCEPTION 'number mismatch: phone=% whatsapp=%', coalesce(r.phone,'<null>'), coalesce(r.whatsapp,'<null>');
  END IF;
  IF NOT (r.coverage_districts @> ARRAY['nicosia','kyrenia']
          AND cardinality(r.coverage_districts) = 2) THEN
    RAISE EXCEPTION 'coverage is %, expected exactly {nicosia,kyrenia}', r.coverage_districts::text;
  END IF;
  IF cardinality(r.service_types) IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'service_types has % entries, expected 4: %',
      coalesce(cardinality(r.service_types), -1), r.service_types::text;
  END IF;

  -- home_services.service_types has NO CHECK constraint — constants/homeServices.js is
  -- the only vocabulary that exists. So this asserts the seed against that list rather
  -- than against the database, and says so. A key here that the app has never heard of
  -- is a provider whose chips render as raw slugs and who no category tile can reach.
  SELECT array_agg(x) INTO v_unknown
    FROM unnest(r.service_types) AS x
   WHERE NOT (x = ANY (v_vocab));
  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION 'service_types not in constants/homeServices.js: %', v_unknown::text;
  END IF;

  -- Exactly one row carries this name. A second, hand-typed TadilArt would be pinned by
  -- neither the config nor this file, and would sit in the ordinary list as a duplicate.
  SELECT count(*) INTO v_named FROM public.home_services WHERE name = 'TadilArt Cyprus';
  IF v_named IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'expected exactly 1 row named TadilArt Cyprus, found %', v_named;
  END IF;

  -- What a perfect system prints here is ZERO. This is the search-exposure question
  -- asked of the database rather than assumed from the status column above.
  SELECT count(*) INTO v_searchable FROM public.home_services
   WHERE status = 'active' AND id = '0496fb4c-4e5d-4e35-a238-dd1fcb402541';
  IF v_searchable IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'the partner row is ACTIVE and therefore already in global search';
  END IF;

  RAISE NOTICE '── TadilArt Cyprus ───────────────────────────────────────';
  RAISE NOTICE '  id:        %', r.id;
  RAISE NOTICE '  name:      %', r.name;
  RAISE NOTICE '  contact:   % / % (contact_pref=%)', r.phone, r.whatsapp, r.contact_pref;
  RAISE NOTICE '  base:      %  coverage: %', r.district, r.coverage_districts::text;
  RAISE NOTICE '  services:  %', r.service_types::text;
  RAISE NOTICE '  status:    %   verified: %', r.status, r.verified;
  RAISE NOTICE '  searchable right now: % row(s) — must be 0 until go-live', v_searchable;
  RAISE NOTICE '  NEXT: activate via AdminScreen Approve, never from this editor.';
  RAISE NOTICE '──────────────────────────────────────────────────────────';
END $$;

COMMIT;
RESET ROLE;

-- ─── REVERT ────────────────────────────────────────────────────────────────
--   BEGIN;
--     SET ROLE postgres;
--     DELETE FROM public.home_services WHERE id = '0496fb4c-4e5d-4e35-a238-dd1fcb402541';
--   COMMIT;
--   RESET ROLE;
-- Safe at any time BEFORE go-live. After go-live this deletes a live partner listing;
-- set status back to 'rejected' through AdminScreen instead.
