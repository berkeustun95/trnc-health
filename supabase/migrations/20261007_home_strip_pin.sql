-- ═══════════════════════════════════════════════════════════════════════════
-- home_strip_pin — the editorial + sponsored source behind "Bugün ADA'da".
--
-- ▶ ONE READY-TO-PASTE BLOCK. Supabase SQL editor, Role → postgres, select the whole
--   file and run it. Everything below is inside BEGIN … COMMIT: an assertion that fires
--   half-applies nothing and the file is re-runnable the moment the cause is fixed.
--
-- ⚠ NUMBERED 20261007 BECAUSE THE LEDGER RUNS TO 20261006, NOT BECAUSE OF TODAY'S DATE
--   (2026-09-04). These names are a SEQUENCE that happens to look like dates; a
--   calendar-derived name here would sort before six already-applied files.
--
-- ─── WHAT IT IS ─────────────────────────────────────────────────────────────
--
-- Home's live strip resolves through a six-rank ladder (utils/homeStripResolver.js).
-- This table is ranks 1 and 5, and it is ONE table doing both jobs on purpose:
--
--   pin_date = today          → RANK 1. An editorial pin. Wins outright, whatever kind
--                               it is, including a paid takeover of the top slot.
--   kind='promo', pin_date NULL → RANK 5. The standing sponsored pool, shown only when
--                               ranks 1-4 all came up empty.
--
-- The discriminator is pin_date, NOT kind. A sponsor can therefore buy either placement
-- without a second table and without a schema change, and an editor can pin a place or
-- an event for a day using the same row shape.
--
-- ─── THE KIND VOCABULARY IS DELIBERATELY NARROWER THAN THE CLIENT'S ─────────
--
-- The app's typed union is event | place | promo | tip. This CHECK permits only the
-- first three, and BOTH absences are load-bearing:
--
--   • `tip` IS NOT HERE, so the strip's fallback cannot be un-seeded, emptied by an
--     admin, or lost to an outage. It is a local constant compiled into the bundle
--     (constants/homeStrip.js), which is what makes "never renders empty" a structural
--     claim rather than a hope. A tip row would quietly move the floor into a table.
--
--   • `duty` IS NOT HERE AND MUST NEVER BE ADDED. Nöbetçi eczaneler has its own
--     permanent row directly above the strip. Anything in this table can be OUTRANKED —
--     that is what a ladder is — so a duty pin would mean that on any day an event or a
--     promo ranked higher, the one row somebody opens this app for at 2am is the row
--     that did not render. A permanent row cannot lose a ladder it is not in.
--
-- ─── is_active DEFAULTS TO false ────────────────────────────────────────────
--
-- The same deliberate inversion towing_companies uses (20260907), and for the same
-- reason: a banner in a seed file protects the one path somebody wrote, while the
-- DEFAULT protects every path nobody has written yet — a future admin screen, a
-- hand-typed row, an import script. An INSERT that omits the column lands INVISIBLE.
-- Going live is then an explicit UPDATE. Registered as an H-token in verify_schema.sql,
-- because a reverted DEFAULT creates no named object and is otherwise undetectable.
--
-- ─── RLS IN PLAIN ENGLISH (read this and check it against the policies) ─────
--
--   READ   Anyone at all — signed out, guest, customer, provider, admin — can read a row
--          that is is_active AND inside its flight window. That is the whole point: the
--          strip is public content on the first screen of the app.
--          An admin additionally reads EVERY row, active or not, in or out of window, so
--          a future admin screen can schedule and preview.
--   WRITE  Admins only, on all three of INSERT / UPDATE / DELETE. There is no self-serve
--          path: a sponsor does not get a login and does not write here. Rows arrive by
--          SQL or by a future admin screen.
--   ANON   Anonymous (guest) sessions sit in the `authenticated` role with a real
--          auth.uid(), so the admin policies above are NOT by themselves an anon guard.
--          Three RESTRICTIVE no_anon_* policies block guest writes outright.
--   NO USER DATA IS IN THIS TABLE. No customer can read another customer's anything
--          here, because there is nothing of any customer's in it. created_by names the
--          ADMIN who made the row and is readable only through the admin-all policy.
--
-- ⚠ THE FLIGHT WINDOW IS ENFORCED IN THE POLICY, not only in the client. The resolver
--   filters starts_at/ends_at as well, and that is defence in depth rather than the
--   boundary — a client-side-only window means an expired sponsorship is one devtools
--   request away from being readable, and "the sponsor stopped paying" is exactly the
--   kind of state that must actually stop being served.
--
-- ─── AFTER APPLYING ────────────────────────────────────────────────────────
--   1. Run supabase/verify_schema.sql. QUERY 1's first row must read ALL n PASS; QUERY 3
--      must show home_strip_pin with 8 policies.
--   2. The table is EMPTY and stays empty. Ranks 1 and 5 therefore never match, and the
--      strip falls through to events / places / the local tip — which is exactly what
--      the app does today with the table absent entirely. Seeding a promo is a separate,
--      deliberate act.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET ROLE postgres;

CREATE TABLE IF NOT EXISTS public.home_strip_pin (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  kind          text NOT NULL,

  -- events.id or places.id, for kind IN ('event','place'). NO FOREIGN KEY, deliberately:
  -- the reference is POLYMORPHIC across two tables and Postgres has no FK for that. The
  -- resolver reads the target through its OWN visibility filter (status='approved' /
  -- status='active') and treats a miss as a fall-through, so a pin whose target was
  -- unapproved or deleted degrades to the next rank instead of erroring. Same shape as
  -- contact_events.entity_id, and recorded there for the same reason.
  target_id     uuid,

  -- Promo destination. The ONLY outbound link on Home.
  link_url      text,
  sponsor_name  text,

  -- jsonb keyed by language code, same shape as places.name_i18n. Required for a promo
  -- (it has no row to borrow a title from); optional for event/place, where it OVERRIDES
  -- the target's own text if present.
  title_i18n    jsonb,
  subtitle_i18n jsonb,
  image_url     text,

  -- NULL = a standing row (the rank-5 pool). A date = pinned to that day (rank 1).
  pin_date      date,

  -- Flight window. NULL at either end means unbounded on that end.
  starts_at     timestamptz,
  ends_at       timestamptz,

  is_active     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- ─── Constraints ────────────────────────────────────────────────────────────
-- Named explicitly rather than inline so verify_schema.sql section E can register them;
-- an auto-named constraint is registrable only by whatever name Postgres happened to pick.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'home_strip_pin_kind_check') THEN
    ALTER TABLE public.home_strip_pin ADD CONSTRAINT home_strip_pin_kind_check
      CHECK (kind IN ('event','place','promo'));
  END IF;

  -- The two row shapes, and neither can borrow the other's columns. A promo with a
  -- target_id would be a sponsored link masquerading as editorial content; an event with
  -- a link_url would be an outbound link on a card the user reads as an ADA event.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'home_strip_pin_shape_check') THEN
    ALTER TABLE public.home_strip_pin ADD CONSTRAINT home_strip_pin_shape_check
      CHECK (
        (kind IN ('event','place')
           AND target_id IS NOT NULL
           AND link_url  IS NULL)
        OR
        (kind = 'promo'
           AND target_id  IS NULL
           AND link_url   IS NOT NULL
           AND title_i18n IS NOT NULL)
      );
  END IF;

  -- A promo must say it is one. The client labels every promo "Sponsorlu" from `kind`
  -- alone, so this is not what makes the label appear — it makes the row incomplete
  -- without an attributable sponsor, which is the thing a disclosure obligation is about.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'home_strip_pin_sponsor_check') THEN
    ALTER TABLE public.home_strip_pin ADD CONSTRAINT home_strip_pin_sponsor_check
      CHECK (kind <> 'promo' OR (sponsor_name IS NOT NULL AND length(btrim(sponsor_name)) > 0));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'home_strip_pin_window_check') THEN
    ALTER TABLE public.home_strip_pin ADD CONSTRAINT home_strip_pin_window_check
      CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at);
  END IF;

  -- link_url must be http(s). Not an anti-attacker measure — only admins write here —
  -- but Linking.openURL on a malformed or custom-scheme href is a dead tap or, worse, a
  -- deep link into another app from a card that looks like ADA's own content.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'home_strip_pin_link_scheme_check') THEN
    ALTER TABLE public.home_strip_pin ADD CONSTRAINT home_strip_pin_link_scheme_check
      CHECK (link_url IS NULL OR link_url ~ '^https?://');
  END IF;
END $$;

-- ─── ONE PIN PER DAY, BY CONSTRUCTION ───────────────────────────────────────
-- Rank 1 asks "the pinned item for today" — singular. Without this, two active rows on
-- one date make that question ambiguous and the answer depends on row order, which is a
-- bug that only appears on the one day somebody double-books. The resolver still iterates
-- defensively rather than assuming exactly one; belt and braces, cheap on both counts.
CREATE UNIQUE INDEX IF NOT EXISTS home_strip_pin_one_per_day
  ON public.home_strip_pin (pin_date)
  WHERE is_active AND pin_date IS NOT NULL;

-- The rank-5 pool read: active standing promos. Small table, but the index also documents
-- the query the resolver actually makes.
CREATE INDEX IF NOT EXISTS idx_home_strip_pin_active_pool
  ON public.home_strip_pin (kind, pin_date)
  WHERE is_active;

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- Postgres has no CREATE POLICY IF NOT EXISTS — drop-then-create keeps this re-runnable.
ALTER TABLE public.home_strip_pin ENABLE ROW LEVEL SECURITY;

-- TWO permissive SELECT policies rather than one with an OR. Permissive policies OR
-- together so the effect is identical — but this way a signed-out `anon` session NEVER
-- evaluates public.is_admin(), which is SECURITY DEFINER. Copied from towing_companies
-- (20260905), where the reasoning is written out in full.
DROP POLICY IF EXISTS "home_strip_pin_select_public" ON public.home_strip_pin;
CREATE POLICY "home_strip_pin_select_public" ON public.home_strip_pin
  FOR SELECT TO public
  USING (is_active = true
         AND (starts_at IS NULL OR starts_at <= now())
         AND (ends_at   IS NULL OR ends_at   >= now()));

DROP POLICY IF EXISTS "home_strip_pin_select_admin_all" ON public.home_strip_pin;
CREATE POLICY "home_strip_pin_select_admin_all" ON public.home_strip_pin
  FOR SELECT TO authenticated
  USING ((select public.is_admin()));

DROP POLICY IF EXISTS "home_strip_pin_insert_admin" ON public.home_strip_pin;
CREATE POLICY "home_strip_pin_insert_admin" ON public.home_strip_pin
  FOR INSERT TO authenticated
  WITH CHECK ((select public.is_admin()));

DROP POLICY IF EXISTS "home_strip_pin_update_admin" ON public.home_strip_pin;
CREATE POLICY "home_strip_pin_update_admin" ON public.home_strip_pin
  FOR UPDATE TO authenticated
  USING ((select public.is_admin())) WITH CHECK ((select public.is_admin()));

DROP POLICY IF EXISTS "home_strip_pin_delete_admin" ON public.home_strip_pin;
CREATE POLICY "home_strip_pin_delete_admin" ON public.home_strip_pin
  FOR DELETE TO authenticated
  USING ((select public.is_admin()));

-- Anonymous (guest) sessions sit in `authenticated` with a real auth.uid(), so the admin
-- policies above are not by themselves an anon guard. Same canonical helper every other
-- no_anon_* policy uses (20260714_block_anonymous_writes.sql).
DROP POLICY IF EXISTS "no_anon_insert_home_strip_pin" ON public.home_strip_pin;
CREATE POLICY "no_anon_insert_home_strip_pin" ON public.home_strip_pin
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (select public.is_anonymous_session()));
DROP POLICY IF EXISTS "no_anon_update_home_strip_pin" ON public.home_strip_pin;
CREATE POLICY "no_anon_update_home_strip_pin" ON public.home_strip_pin
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (select public.is_anonymous_session())) WITH CHECK (NOT (select public.is_anonymous_session()));
DROP POLICY IF EXISTS "no_anon_delete_home_strip_pin" ON public.home_strip_pin;
CREATE POLICY "no_anon_delete_home_strip_pin" ON public.home_strip_pin
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (select public.is_anonymous_session()));

GRANT SELECT ON public.home_strip_pin TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.home_strip_pin TO authenticated;

-- ═══ VERIFICATION — inside the transaction, so a failure applies nothing ════
--
-- ⚠ EVERY COMPARISON IS `IS DISTINCT FROM`, NEVER `<>`. `NULL <> 'x'` evaluates to NULL
--   and `IF NULL THEN` does not fire, so a `<>` assertion PASSES on precisely the failure
--   it exists to catch — a column that is missing, a function that returned nothing.
--   Recorded in CLAUDE.md after 20261001 shipped four of them green on first draft.
--
-- ⚠ AND THE COUNTS ARE DERIVED AND PRINTED, never compared against a remembered list of
--   names. A check phrased as "the one I remember is absent" goes green while staying
--   silent about everything it forgot to name — which is how a live full-row profiles
--   over-share survived six weeks. If a legitimate new policy takes the count to 9, bump
--   it here and say why; that edit is the review moment a name list never creates.
DO $$
DECLARE
  v_policies int;
  v_restrictive int;
  v_default text;
  v_rls boolean;
  v_probe uuid;
  v_kinds text;
BEGIN
  SELECT count(*) INTO v_policies
    FROM pg_policies WHERE schemaname='public' AND tablename='home_strip_pin';
  IF v_policies IS DISTINCT FROM 8 THEN
    RAISE EXCEPTION 'expected 8 policies on home_strip_pin, found %. Policies present: %',
      v_policies,
      (SELECT string_agg(policyname || '(' || cmd || ')', ', ' ORDER BY policyname)
         FROM pg_policies WHERE schemaname='public' AND tablename='home_strip_pin');
  END IF;

  SELECT count(*) INTO v_restrictive
    FROM pg_policies WHERE schemaname='public' AND tablename='home_strip_pin'
      AND permissive = 'RESTRICTIVE';
  IF v_restrictive IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'expected 3 RESTRICTIVE no_anon policies, found %. A no_anon_* policy '
                    'created PERMISSIVE does not block anything — it GRANTS. Rows: %',
      v_restrictive,
      (SELECT string_agg(policyname || '=' || permissive, ', ' ORDER BY policyname)
         FROM pg_policies WHERE schemaname='public' AND tablename='home_strip_pin');
  END IF;

  SELECT c.relrowsecurity INTO v_rls
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname='home_strip_pin';
  IF v_rls IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'RLS is not enabled on home_strip_pin (relrowsecurity = %). Every '
                    'policy above is inert without it.', v_rls;
  END IF;

  -- The DEFAULT is the whole pre-launch safety property. Read it from the catalogue and
  -- PRINT it, so a failure shows what was actually found rather than only that it differed.
  SELECT column_default INTO v_default
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='home_strip_pin' AND column_name='is_active';
  IF v_default IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'home_strip_pin.is_active DEFAULT is % — expected false. With any other '
                    'default an INSERT that omits the column PUBLISHES itself.', coalesce(v_default,'<null>');
  END IF;

  -- ── The kind vocabulary, read from the constraint rather than from this file ──
  SELECT pg_get_constraintdef(oid) INTO v_kinds
    FROM pg_constraint WHERE conname='home_strip_pin_kind_check';
  IF v_kinds IS NULL THEN
    RAISE EXCEPTION 'home_strip_pin_kind_check does not exist — the kind vocabulary is unconstrained';
  END IF;
  -- The two forbidden members. `duty` is the one that matters: see the header.
  --
  -- ⚠ ANCHORED ON THE QUOTED LITERAL, NOT THE BARE WORD. pg_get_constraintdef renders
  --   the expression only — no comments, unlike pg_get_functiondef, which is the trap
  --   CLAUDE.md records — so the frame of reference is right. But a bare `tip` would
  --   still match as a substring of some future kind, and a check that fires on a
  --   correct system is worse than none. 'duty' with its quotes is what an admitted
  --   value actually looks like here.
  IF position('''duty''' in v_kinds) > 0 OR position('''tip''' in v_kinds) > 0 THEN
    RAISE EXCEPTION 'home_strip_pin_kind_check admits duty or tip. def = %', v_kinds;
  END IF;
  -- ⚠ CONTROL. The two tests above pass trivially if pg_get_constraintdef returned
  --   something that mentions no kinds at all, so assert the vocabulary that MUST be
  --   there. Without this the negative checks are an instrument that cannot fail.
  IF position('''promo''' in v_kinds) = 0 OR position('''event''' in v_kinds) = 0
     OR position('''place''' in v_kinds) = 0 THEN
    RAISE EXCEPTION 'CONTROL FAILED: the kind constraint does not mention the three kinds '
                    'it is supposed to permit, so the duty/tip checks above tested nothing. def = %', v_kinds;
  END IF;

  -- ── The shape constraint actually rejects the shapes it names ──────────────
  -- A CHECK is the one object whose correctness cannot be read off its definition with
  -- confidence, so this exercises it. Both probes are rolled back by the savepoint, and
  -- the table is empty either way.
  BEGIN
    INSERT INTO public.home_strip_pin (kind, target_id, link_url, sponsor_name, title_i18n)
    VALUES ('promo', gen_random_uuid(), 'https://example.com', 'Probe', '{"en":"x"}'::jsonb)
    RETURNING id INTO v_probe;
    RAISE EXCEPTION 'CONTROL FAILED: a promo carrying a target_id was ACCEPTED — '
                    'home_strip_pin_shape_check is not doing its job';
  EXCEPTION WHEN check_violation THEN
    NULL;  -- expected
  END;

  BEGIN
    INSERT INTO public.home_strip_pin (kind, target_id)
    VALUES ('place', NULL)
    RETURNING id INTO v_probe;
    RAISE EXCEPTION 'CONTROL FAILED: a place pin with no target_id was ACCEPTED';
  EXCEPTION WHEN check_violation THEN
    NULL;  -- expected
  END;

  -- ⚠ AND THE POSITIVE CONTROL, without which the two above prove only that SOMETHING
  --   rejects everything. A well-formed row must be accepted. Deleted immediately —
  --   this migration leaves the table empty, which is what the header promises.
  INSERT INTO public.home_strip_pin (kind, link_url, sponsor_name, title_i18n)
  VALUES ('promo', 'https://example.com', 'Probe', '{"en":"x"}'::jsonb)
  RETURNING id INTO v_probe;
  IF v_probe IS NULL THEN
    RAISE EXCEPTION 'CONTROL FAILED: a well-formed promo did not return an id';
  END IF;
  DELETE FROM public.home_strip_pin WHERE id = v_probe;

  IF (SELECT count(*) FROM public.home_strip_pin) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'the probe rows were not cleaned up — table should be empty, has %',
      (SELECT count(*) FROM public.home_strip_pin);
  END IF;

  RAISE NOTICE '── home_strip_pin ────────────────────────────────────────';
  RAISE NOTICE '  policies: % (% restrictive) · RLS on · is_active DEFAULT %',
    v_policies, v_restrictive, v_default;
  RAISE NOTICE '  kinds: %', v_kinds;
  RAISE NOTICE '  shape CHECK rejects both malformed probes and accepts a valid row';
  RAISE NOTICE '  rows: 0 — the strip falls through to ranks 2-6 until something is seeded';
  RAISE NOTICE '──────────────────────────────────────────────────────────';
END $$;

COMMIT;
RESET ROLE;

-- A NEW TABLE needs the PostgREST reload as much as a new column does: without it the
-- REST API answers 42P01 for a table that exists in Postgres, and the client's
-- fall-through would hide it — the strip would silently never show rank 1 or 5 and look
-- entirely healthy while doing so.
NOTIFY pgrst, 'reload schema';

-- ─── REVERT ────────────────────────────────────────────────────────────────
--   BEGIN;
--     SET ROLE postgres;
--     DROP TABLE IF EXISTS public.home_strip_pin;   -- policies and indexes go with it
--   COMMIT;
--   RESET ROLE;
--   NOTIFY pgrst, 'reload schema';
-- The client needs no change: ranks 1 and 5 already treat a missing table as a
-- fall-through, which is the state they ship in.
