-- ═══════════════════════════════════════════════════════════════════════════
-- ad_banners — direct-sold banner advertising. No ad network, no SDK, no bidder.
--
-- ▶ ONE READY-TO-PASTE BLOCK. Supabase SQL editor, Role → postgres, select the whole
--   file and run it. Everything below is inside BEGIN … COMMIT: an assertion that fires
--   half-applies nothing and the file is re-runnable the moment the cause is fixed.
--
-- ⚠ NUMBERED 20261008 BECAUSE THE LEDGER RUNS TO 20261007, NOT BECAUSE OF TODAY'S DATE
--   (2026-09-06). These names are a SEQUENCE that happens to look like dates; a
--   calendar-derived name here would sort before seven already-applied files.
--
-- ─── WHAT IT IS ─────────────────────────────────────────────────────────────
--
-- One table serving all six designed slots. Rows are added BY HAND — same posture as
-- home_strip_pin and towing_companies: no admin UI, no self-serve, an advertiser never
-- gets a login and never writes here.
--
--   home_hero  home_footer  module_landing  guide_inline  detail_footer  entry
--
-- Only `home_footer` is rendered by the app as this ships. The other five exist in the
-- vocabulary and in the component so that adding one later is a PLACEMENT, not new work.
-- A row seeded against an unrendered slot is inert and costs nothing.
--
-- ─── THE SLOT CHECK IS VOCABULARY, NOT ENFORCEMENT. READ THIS. ──────────────
--
-- The permanent exclusion list — NO ADS ON: duty pharmacy, emergency contacts, health
-- facilities, search results, push notifications, Ask Oli — CANNOT be encoded in a slot
-- id, and believing otherwise is the trap this paragraph exists to close.
-- `detail_footer` is surface-GENERIC: mounted on FacilityProfileScreen it is an ad on a
-- health surface carrying a perfectly valid slot id, and every check in this file would
-- stay green. The CHECK below constrains what an admin may TYPE. It says nothing
-- whatsoever about where the component is MOUNTED.
--
-- Enforcement is `scripts/check-ad-placement.mjs`, a mount-point allowlist that runs in
-- the pre-push hook and in the `npm run ota` chain. The excluded SURFACES are named
-- there as file paths, because a file path is the only thing that identifies a surface.
-- If you are reading this while wondering whether a new placement is allowed: the
-- answer lives in that script, and it will refuse the push rather than rely on anyone
-- remembering this comment.
--
-- The negative assertion at the foot of this file (no 'duty'/'search'/'emergency'/'oli'
-- slot id) is a second, weaker lock on the same door. It is worth having and it is not
-- the boundary.
--
-- ─── UNDER-18 USERS AND NON-PERSONALIZED ADS ────────────────────────────────
--
-- ADA has been a declared MIXED-AUDIENCE app since 2026-08-29 (target ages 13-15 /
-- 16-17 / 18+), and a user whose date_of_birth indicates under 18 must receive
-- NON-PERSONALIZED advertising.
--
-- THAT REQUIREMENT IS MET BY CONSTRUCTION HERE, not by a branch that could be got
-- wrong. There is no SDK, no ad network, no bidder, no targeting, and NOTHING in the
-- selection path reads any user attribute: the client asks for the active in-window row
-- for a slot and every user on earth gets the same one. A personalized ad is not
-- something this design can express.
--
-- ⚠ THAT IS ALSO THE TRIPWIRE. The moment anything user-derived enters selection — an
--   age branch, a region filter, a "shown to people who opened Pets" rule — the claim
--   above stops being structural and becomes a branch that has to be correct, AND
--   web/privacy.html (published, store-registered) says in terms "We do not use your
--   data for advertising." Three copies of that document would need changing, and the
--   under-18 branch would need writing, BEFORE any such column is added.
--
-- ─── AND WHY THERE IS NO AGE GATE HERE, UNLIKE THE STRIP ────────────────────
--
-- constants/homeStrip.js carries PROMO_MIN_AGE = 18 and promosAllowed(): the live
-- strip shows no sponsored promo to a guest, to a null-DOB profile, or to anyone under
-- 18. Banners deliberately DO NOT reuse that rule, and the two differing is a decision
-- rather than a drift:
--
--   • The strip's rule exists because a promo there can DISPLACE REAL CONTENT — it sits
--     in a six-rank ladder above the generic card. It was written as a stricter-than-
--     required addition to a brief, and it is about editorial displacement, not about
--     compliance.
--   • A footer banner displaces NOTHING. The slot is empty otherwise; an unsold slot
--     collapses to zero height and the screen looks exactly as it does today.
--   • Compliance holds either way, for the structural reason above.
--   • And the cost of reusing it is not small: the app signs in ANONYMOUSLY on launch,
--     so promosAllowed() is false for most sessions. Reusing it would blank the slot for
--     the majority of impressions on the only inventory being sold.
--
-- PROMO_MIN_AGE stays a strip-only rule. Do not fold the two into one number.
--
-- ─── ONE AD PER SLOT, AND THE TIE-BREAK ─────────────────────────────────────
--
-- Several rows may be live for one slot at once. The client takes the FIRST of:
--
--     ORDER BY starts_at DESC, created_at DESC, id
--
-- Newest campaign wins. Deliberately NOT a partial unique index (which is what
-- home_strip_pin uses for its one-pin-per-day rule), because the whole point is that a
-- takeover can be sold OVER a standing placement without first deactivating it — and an
-- exclusion constraint would make that a two-step edit with a gap in the middle where
-- the slot is empty. `id` is the final term so the order is TOTAL: two rows sharing a
-- start and a creation timestamp still resolve deterministically instead of by whatever
-- order the planner returned.
--
-- ─── SCHEDULING IS REQUIRED — starts_at AND ends_at ARE NOT NULL ────────────
--
-- An unbounded ad cannot exist. A month-long placement expires by itself, and it does so
-- in the POLICY (below), not only in the client: a client-side-only window means an
-- expired sponsorship is one devtools request away from being readable, and "the
-- advertiser stopped paying" is exactly the kind of state that must actually stop being
-- served. The client re-filters the window as well — defence in depth, not the boundary.
--
-- ─── COUNTING: A NUMBER ON THE ROW, ATTACHED TO NOBODY ──────────────────────
--
-- view_count and tap_count are integers on the ad row, incremented through
-- bump_ad_counter() — a SECURITY DEFINER function, because the client has no UPDATE
-- privilege on this table and must never be given one.
--
-- NO user id. NO device id. NO session id. NO IP. NO dedup key of any kind. There is
-- nothing here to attach to a person, and nothing that could let two increments be
-- recognised as having come from the same origin. This is the same anonymity contract
-- contact_events (20260910) is written against, and it is deliberate: ADA keeps usage
-- data off Supabase given EU hosting and declared 13-17 year old users.
--
-- The counters are a FLOOR, and it matters exactly what they are a floor OF.
--
-- A view fires from the banner image's onLoad — the artwork actually drew — and is counted
-- ONCE PER AD PER APP PROCESS. So a user who returns to Home five times in a session is one
-- view, not five. That dedup is the larger of the two undercounts and it is deliberate.
-- The other is the network: the write is fire-and-forget with a 4s abort and NO retry queue
-- (a queue would mean storing impressions on the device, which is a trace at rest and
-- breaks the contract above), so a load that happens offline from RN's image cache counts
-- nothing. Conditional on the image having loaded over the network at all, capture is
-- near-total — the counter write is a few hundred bytes on a connection that has just
-- carried the image.
--
-- ⚠ WHAT IT IS NOT: a count of people who LOOKED at the banner. home_footer sits at the
--   bottom of a plain, non-virtualised ScrollView, so it mounts and its image loads on
--   essentially every app open whether or not the user ever scrolls that far. This is a
--   SERVED-IMPRESSION count, deduped per app process.
--
-- ⚠ SO SAY "AT LEAST N APP OPENS ON WHICH THIS BANNER WAS SERVED". That sentence is always
--   true. "N views" invites the reading "N people looked at it", which this number cannot
--   support, and "N impressions" invites multiplying by sessions, which the dedup forbids.
--
-- ⚠ AND ONE HONEST WEAKNESS, WHICH contact_events DOES NOT HAVE. Spam on a bare counter
--   CANNOT BE PURGED — there are no rows to delete, only a number that is now wrong.
--   contact_events can be cleaned from the SQL editor because it stores events. This
--   stores a total. Accepted at this scale (direct-sold, single-digit advertisers, no
--   payout tied to the number); if it is ever abused the fix is a daily-bucket table,
--   not a policy here — an anon key that ships in the bundle makes a public increment
--   endpoint spammable by construction and no RLS rule changes that.
--
-- ─── IMAGES: 320x100, AND WHAT HAPPENS TO A WRONG ONE ───────────────────────
--
-- 320x100 (3.2:1) — a standard mobile banner size, so any designer an advertiser
-- already uses knows it. The app renders the slot at a FIXED 3.2:1 computed from screen
-- width and draws the image with resizeMode="cover".
--
-- A wrong-sized upload is therefore CENTRE-CROPPED, never letterboxed and never
-- rejected. That is the only one of the three that cannot break the layout: rejecting
-- leaves a paid slot silently empty (the worst failure — it looks identical to unsold),
-- and letterboxing puts bars of our choosing around an advertiser's artwork and makes a
-- correct render look broken. Cropping is visible, attributable and fixed by
-- re-uploading. The app warns in __DEV__ when a loaded image deviates from 3.2:1 by
-- more than 2%, which fires during the on-device spot-check — the one moment somebody
-- is looking. Nothing server-side can see image dimensions without fetching the bytes,
-- so this is checked where the bytes already are.
--
-- ─── is_active DEFAULTS TO false ────────────────────────────────────────────
--
-- The same deliberate inversion towing_companies (20260907) and home_strip_pin (1007)
-- use, and for the same reason: a banner in a seed file protects the one path somebody
-- wrote, while the DEFAULT protects every path nobody has written yet — a future admin
-- screen, a hand-typed row, an import script. An INSERT that omits the column lands
-- INVISIBLE. Going live is then an explicit UPDATE. Registered as an H-token in
-- verify_schema.sql, because a reverted DEFAULT creates no named object and is
-- otherwise undetectable.
--
-- ─── RLS IN PLAIN ENGLISH (read this and check it against the policies) ─────
--
--   READ   Anyone at all — signed out, guest, customer, provider, admin — can read a row
--          that is is_active AND inside its flight window. That is the point: a banner
--          is public content on the first screen of the app.
--          An admin additionally reads EVERY row, active or not, in or out of window, so
--          a campaign can be scheduled and previewed, and so the counters can be read
--          back for an advertiser report.
--   WRITE  Admins only, on all three of INSERT / UPDATE / DELETE. No self-serve path.
--          Rows arrive by SQL, from Berke.
--   COUNT  Anyone may call bump_ad_counter(id,'view'|'tap'). It is SECURITY DEFINER and
--          the ONLY write path a client has. It can add 1 to one of two columns on one
--          active row and can do nothing else — it cannot set a value, cannot decrement,
--          cannot touch any other column and cannot see who called it.
--   ANON   Anonymous (guest) sessions sit in the `authenticated` role with a real
--          auth.uid(), so the admin policies are NOT by themselves an anon guard. Three
--          RESTRICTIVE no_anon_* policies block guest writes outright.
--   NO USER DATA IS IN THIS TABLE. No customer can read another customer's anything
--          here, because there is nothing of any customer's in it. created_by names the
--          ADMIN who made the row and is readable only through the admin-all policy.
--
-- ─── AFTER APPLYING ────────────────────────────────────────────────────────
--   1. Run supabase/verify_schema.sql. QUERY 1's verdict row must read ALL n PASS;
--      QUERY 3 must show ad_banners with 8 policies; QUERY 4 must show four
--      ad_images_* rows.
--   2. The table is EMPTY and stays empty. Every slot is unsold, so every slot collapses
--      to zero height and Home looks exactly as it does today. Seeding an ad is a
--      separate, deliberate act — and with AD_BANNERS_LIVE false in constants/flags.js
--      nothing renders even then.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET ROLE postgres;

CREATE TABLE IF NOT EXISTS public.ad_banners (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- One of the six designed slots. See the vocabulary-not-enforcement note in the header
  -- before assuming this constrains WHERE an ad can appear. It does not.
  slot            text NOT NULL,

  -- For Berke's own reference and for the disclosure obligation. NOT NULL and non-blank:
  -- the app labels every banner "Sponsorlu" from its existence alone, so this is not what
  -- makes the label appear — it makes the row incomplete without an attributable
  -- advertiser, which is the thing a disclosure obligation is actually about. Same
  -- reasoning as home_strip_pin_sponsor_check.
  advertiser_name text NOT NULL,

  -- Public URL in the `ad-images` bucket created at the foot of this file. https only.
  image_url       text NOT NULL,

  -- ── DESTINATION: EXACTLY ONE OF THESE TWO ────────────────────────────────
  -- link_url  an external site (https only)
  -- route     an in-app screen, from a fixed vocabulary
  --
  -- Switching an advertiser from external to in-app later is an UPDATE on this one row —
  -- NULL one column, set the other. Nothing is hardcoded per ad, which is the whole
  -- requirement: most advertisers have no partner surface today and some will later.
  link_url        text,
  route           text,

  -- Flight window. BOTH NOT NULL — scheduling is required, see the header.
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,

  is_active       boolean NOT NULL DEFAULT false,

  -- Anonymous totals. bigint rather than int: nothing about this table's write path is
  -- rate-limited (it cannot be — see the header), so the column that a flood inflates
  -- should not also be the column that overflows.
  view_count      bigint NOT NULL DEFAULT 0,
  tap_count       bigint NOT NULL DEFAULT 0,

  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.ad_banners IS
  'Direct-sold banner ads. No network, no SDK, no targeting — every user sees the same '
  'row, so every banner is non-personalized BY CONSTRUCTION (required: declared '
  'mixed-audience app, under-18 users). view_count/tap_count are anonymous totals with '
  'NO user/device/session id and NO dedup key. A view fires from the image onLoad and is '
  'counted once per ad per app PROCESS, and the slot sits in a non-virtualised ScrollView '
  'that mounts on every app open — so this is a SERVED-IMPRESSION floor, not a count of '
  'people who looked. Quote "at least N app opens on which this banner was served"; never '
  '"N views", never "N impressions", never a bare N. '
  'Spam cannot be purged from a bare counter. See 20261008_ad_banners.sql.';

-- ─── Constraints ────────────────────────────────────────────────────────────
-- Named explicitly rather than inline so verify_schema.sql section E can register them;
-- an auto-named constraint is registrable only by whatever name Postgres happened to pick.
DO $$
BEGIN
  -- The six designed slots, and NOTHING about where they may be mounted.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_banners_slot_check') THEN
    ALTER TABLE public.ad_banners ADD CONSTRAINT ad_banners_slot_check
      CHECK (slot IN ('home_hero','home_footer','module_landing',
                      'guide_inline','detail_footer','entry'));
  END IF;

  -- EXACTLY ONE destination. num_nonnulls() rather than a boolean XOR: both forms are
  -- correct here (IS NOT NULL never returns NULL, so `<>` would not hit the NULL-swallows-
  -- the-assertion trap CLAUDE.md records), but this one states the requirement in the
  -- words the requirement is written in and cannot be misread by the next person.
  --
  -- Zero destinations is as much a defect as two: a banner that is paid for and does
  -- nothing when tapped reads to the advertiser as the app being broken.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_banners_destination_check') THEN
    ALTER TABLE public.ad_banners ADD CONSTRAINT ad_banners_destination_check
      CHECK (num_nonnulls(link_url, route) = 1);
  END IF;

  -- ── THE IN-APP ROUTE VOCABULARY ──────────────────────────────────────────
  --
  -- Mirrors AD_ROUTES in constants/ads.js, which is where the app resolves a route to a
  -- handler. Checked at INSERT so a typo fails HERE, in front of the person typing it,
  -- rather than at tap time in front of a user — an unknown route resolves to no handler
  -- and a paid banner silently does nothing, which is the failure mode that looks like a
  -- frozen app rather than like a bad row.
  --
  -- ⚠ THREE DESTINATIONS ARE DELIBERATELY ABSENT: health, emergency, duty. The exclusion
  --   list forbids ADS ON those surfaces; sending a PAID banner INTO them monetises them
  --   at one remove, which is the same thing arriving by a different door. There is no
  --   advertiser worth the sentence "we sold a banner that routes into the emergency
  --   numbers". scripts/check-ad-placement.mjs asserts these three stay absent from both
  --   halves, so re-adding one fails a push.
  --
  -- ⚠ AND `search` IS NOT A ROUTE AT ALL, in either half — there is nothing to send
  --   somebody to, and a banner that opens a search box is an ad on a search surface.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_banners_route_check') THEN
    ALTER TABLE public.ad_banners ADD CONSTRAINT ad_banners_route_check
      CHECK (route IS NULL OR route IN (
        'accommodation','beaches','esim','events','exchangeRates','explore','games',
        'garages','grooming','homeServices','insurance','jobPostings','municipal',
        'newcomerEssentials','pets','studentHub','towing','transport'));
  END IF;

  -- https ONLY, on both URLs. home_strip_pin permits http as well; this is a new surface
  -- and there is no reason to carry that forward. Cleartext is not the main point —
  -- Linking.openURL on a malformed or custom-scheme href is a dead tap or, worse, a deep
  -- link into another app from something the user reads as ADA's own surface. Only admins
  -- write here, so this is a typo guard, not an anti-attacker measure.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_banners_link_scheme_check') THEN
    ALTER TABLE public.ad_banners ADD CONSTRAINT ad_banners_link_scheme_check
      CHECK (link_url IS NULL OR link_url ~ '^https://');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_banners_image_scheme_check') THEN
    ALTER TABLE public.ad_banners ADD CONSTRAINT ad_banners_image_scheme_check
      CHECK (image_url ~ '^https://');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_banners_window_check') THEN
    ALTER TABLE public.ad_banners ADD CONSTRAINT ad_banners_window_check
      CHECK (ends_at > starts_at);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_banners_advertiser_check') THEN
    ALTER TABLE public.ad_banners ADD CONSTRAINT ad_banners_advertiser_check
      CHECK (length(btrim(advertiser_name)) > 0);
  END IF;

  -- The counters only ever go up, and bump_ad_counter is the only thing that moves them
  -- from the app. This catches the OTHER writer — a hand-typed UPDATE in the SQL editor
  -- correcting a number and getting the sign wrong.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_banners_counts_check') THEN
    ALTER TABLE public.ad_banners ADD CONSTRAINT ad_banners_counts_check
      CHECK (view_count >= 0 AND tap_count >= 0);
  END IF;
END $$;

-- ─── Index ──────────────────────────────────────────────────────────────────
-- Serves the only query the app makes, INCLUDING its ORDER BY: the live row for one slot.
-- The index also documents the tie-break, so the ordering is stated in two places that
-- cannot drift apart silently — a planner that stops using this index still returns the
-- same row, because the client's ORDER BY is what decides.
CREATE INDEX IF NOT EXISTS idx_ad_banners_slot_live
  ON public.ad_banners (slot, starts_at DESC, created_at DESC)
  WHERE is_active;

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- Postgres has no CREATE POLICY IF NOT EXISTS — drop-then-create keeps this re-runnable.
ALTER TABLE public.ad_banners ENABLE ROW LEVEL SECURITY;

-- TWO permissive SELECT policies rather than one with an OR. Permissive policies OR
-- together so the effect is identical — but this way a signed-out `anon` session NEVER
-- evaluates public.is_admin(), which is SECURITY DEFINER. Copied from towing_companies
-- (20260905) and home_strip_pin (20261007), where the reasoning is written out in full.
--
-- ⚠ THE FLIGHT WINDOW IS IN THE POLICY. An expired campaign stops being READABLE, not
--   merely stops being drawn. See the header.
DROP POLICY IF EXISTS "ad_banners_select_public" ON public.ad_banners;
CREATE POLICY "ad_banners_select_public" ON public.ad_banners
  FOR SELECT TO public
  USING (is_active = true
         AND starts_at <= now()
         AND ends_at   >= now());

DROP POLICY IF EXISTS "ad_banners_select_admin_all" ON public.ad_banners;
CREATE POLICY "ad_banners_select_admin_all" ON public.ad_banners
  FOR SELECT TO authenticated
  USING ((select public.is_admin()));

DROP POLICY IF EXISTS "ad_banners_insert_admin" ON public.ad_banners;
CREATE POLICY "ad_banners_insert_admin" ON public.ad_banners
  FOR INSERT TO authenticated
  WITH CHECK ((select public.is_admin()));

DROP POLICY IF EXISTS "ad_banners_update_admin" ON public.ad_banners;
CREATE POLICY "ad_banners_update_admin" ON public.ad_banners
  FOR UPDATE TO authenticated
  USING ((select public.is_admin())) WITH CHECK ((select public.is_admin()));

DROP POLICY IF EXISTS "ad_banners_delete_admin" ON public.ad_banners;
CREATE POLICY "ad_banners_delete_admin" ON public.ad_banners
  FOR DELETE TO authenticated
  USING ((select public.is_admin()));

-- Anonymous (guest) sessions sit in `authenticated` with a real auth.uid(), so the admin
-- policies above are not by themselves an anon guard. Same canonical helper every other
-- no_anon_* policy uses (20260714_block_anonymous_writes.sql).
DROP POLICY IF EXISTS "no_anon_insert_ad_banners" ON public.ad_banners;
CREATE POLICY "no_anon_insert_ad_banners" ON public.ad_banners
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (select public.is_anonymous_session()));
DROP POLICY IF EXISTS "no_anon_update_ad_banners" ON public.ad_banners;
CREATE POLICY "no_anon_update_ad_banners" ON public.ad_banners
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (select public.is_anonymous_session())) WITH CHECK (NOT (select public.is_anonymous_session()));
DROP POLICY IF EXISTS "no_anon_delete_ad_banners" ON public.ad_banners;
CREATE POLICY "no_anon_delete_ad_banners" ON public.ad_banners
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (select public.is_anonymous_session()));

-- ⚠ THE CLIENT IS NEVER GRANTED UPDATE, and that is what forces counting through the
--   function below. Grant UPDATE here and a client could set view_count to anything,
--   edit an advertiser's destination, or activate a scheduled campaign early.
GRANT SELECT ON public.ad_banners TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.ad_banners TO authenticated;

-- ─── bump_ad_counter — the only write path a client has ─────────────────────
--
-- SECURITY DEFINER because the caller has no UPDATE privilege and must not get one. The
-- function's whole surface is: add 1 to ONE of two columns, on ONE active row.
--
-- ⚠ `SET search_path` IS NOT OPTIONAL ON A SECURITY DEFINER FUNCTION. Without it a
--   caller who can create objects in a schema earlier on the search path can shadow
--   `ad_banners` and have this run against their own table as the owner. Asserted from
--   pg_proc.proconfig in the verification block — a comment saying it is set is not
--   evidence that it is.
--
-- IT TAKES NO USER, NO DEVICE, NO SESSION AND RECORDS NONE. auth.uid() is deliberately
-- not called: there is nothing here to attach it to, and a function that looked it up
-- would be one edit away from storing it.
--
-- An unknown p_kind is a silent no-op rather than an exception. The caller is
-- fire-and-forget by design (see utils/logAdEvent.js) and would swallow the error
-- anyway, so raising would achieve nothing except an entry in the Postgres log; the
-- verification block asserts the no-op rather than trusting it.
--
-- `AND is_active` means an ad that was deactivated mid-session stops counting. The
-- flight WINDOW is deliberately not re-checked: a tap that lands a few seconds after
-- ends_at is a real tap by a real person on an ad they really saw, and dropping it would
-- undercount the last moments of every campaign.
CREATE OR REPLACE FUNCTION public.bump_ad_counter(p_ad_id uuid, p_kind text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF p_kind = 'view' THEN
    UPDATE public.ad_banners SET view_count = view_count + 1
     WHERE id = p_ad_id AND is_active;
  ELSIF p_kind = 'tap' THEN
    UPDATE public.ad_banners SET tap_count = tap_count + 1
     WHERE id = p_ad_id AND is_active;
  END IF;
END;
$fn$;

COMMENT ON FUNCTION public.bump_ad_counter(uuid, text) IS
  'Adds 1 to ad_banners.view_count or .tap_count for one active row. The only write path '
  'the app has on that table. Takes and records NO user, device or session identifier — '
  'see the anonymity contract in 20261008_ad_banners.sql. Unknown p_kind is a no-op.';

REVOKE ALL ON FUNCTION public.bump_ad_counter(uuid, text) FROM PUBLIC;
-- BOTH roles: the app signs in anonymously on launch, so most sessions are
-- `authenticated` with is_anonymous=true, but a render that lands before that completes
-- runs as true `anon`. Identical treatment — the function names nobody either way.
GRANT EXECUTE ON FUNCTION public.bump_ad_counter(uuid, text) TO anon, authenticated;

-- ─── Storage: ad-images bucket ──────────────────────────────────────────────
--
-- Created HERE IN SQL, not in the dashboard, and that is the direct lesson of
-- 20260823_place_photos_storage_policies.sql. `place-photos` was made in the dashboard
-- and shipped with ZERO storage.objects policies; RLS is default-deny, so every
-- client-side upload was rejected from launch day. Nobody noticed for months because the
-- only photos present came from dashboard and service_role uploads, which bypass RLS —
-- the bucket looked fine precisely because the only writer was the one writer the broken
-- policy could not stop. A bucket whose creation and ACL live in a migration is covered
-- by the ledger and by verify_schema QUERY 4. Do not create this one by hand.
--
-- PUBLIC bucket: a banner is a public brand image shown on the first screen of the app,
-- and a public URL is what image_url stores. Same posture as towing-logos.
-- WRITE is admin-only + anon-guarded. There is no self-serve upload and there will not
-- be one — an advertiser sends artwork, Berke uploads it.
--
-- ⚠ IF THIS SECTION ERRORS WITH `must be owner of table objects`: some projects have
--   supabase_storage_admin own storage.objects. Run everything ABOVE this banner as
--   postgres, then run this section alone under `SET ROLE supabase_storage_admin;`.
--   That role owns storage.objects but CANNOT create the public table, which is why it
--   cannot wrap the whole file. Same fallback 20260816 and 20260905 document.
--
--   ⚠ IF YOU SPLIT, THE VERIFICATION BLOCK AND THE LEDGER STAMP BELONG TO THE POSTGRES
--     HALF, NOT THE STORAGE HALF — and this is not obvious from where they sit in the
--     file. The DO block INSERTs probe rows into public.ad_banners and calls
--     bump_ad_counter; supabase_storage_admin can do neither, so running it in the second
--     half fails against a perfectly correct database and reads as a real defect.
--
--     Split as: [everything down to this banner, then the DO block, then the ledger stamp,
--     then COMMIT] as postgres — and comment out the DO block's two STORAGE assertions for
--     that run, because the bucket does not exist yet. Then [the four storage statements
--     below] alone as supabase_storage_admin. Then un-comment those two assertions and run
--     the DO block on its own; it is idempotent, its probes clean up after themselves, and
--     it leaves the table empty either way.
--
-- HARDENING WORTH DOING IN THE DASHBOARD (not required, and deliberately not asserted
-- here because it is bucket metadata rather than a named object): set allowed_mime_types
-- to image/* and a file-size cap. Write is admin-only, so the arbitrary-file-hosting
-- vector place-photos has does not exist here — this is belt to that braces.

INSERT INTO storage.buckets (id, name, public)
VALUES ('ad-images', 'ad-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "ad_images_public_read" ON storage.objects;
CREATE POLICY "ad_images_public_read" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'ad-images');

DROP POLICY IF EXISTS "ad_images_admin_insert" ON storage.objects;
CREATE POLICY "ad_images_admin_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'ad-images'
    AND (select public.is_admin())
    AND NOT (select public.is_anonymous_session())
  );

DROP POLICY IF EXISTS "ad_images_admin_update" ON storage.objects;
CREATE POLICY "ad_images_admin_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'ad-images'
    AND (select public.is_admin())
    AND NOT (select public.is_anonymous_session())
  )
  WITH CHECK (
    bucket_id = 'ad-images'
    AND (select public.is_admin())
    AND NOT (select public.is_anonymous_session())
  );

DROP POLICY IF EXISTS "ad_images_admin_delete" ON storage.objects;
CREATE POLICY "ad_images_admin_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'ad-images'
    AND (select public.is_admin())
    AND NOT (select public.is_anonymous_session())
  );

-- ═══ VERIFICATION — inside the transaction, so a failure applies nothing ════
--
-- ⚠ EVERY COMPARISON IS `IS DISTINCT FROM`, NEVER `<>`. `NULL <> 'x'` evaluates to NULL
--   and `IF NULL THEN` does not fire, so a `<>` assertion PASSES on precisely the failure
--   it exists to catch — a column that is missing, a function that returned nothing.
--
-- ⚠ COUNTS ARE DERIVED AND PRINTED, never compared against a remembered list of names.
--   If a legitimate new policy takes the count to 9, bump it here and say why; that edit
--   is the review moment a name list never creates.
--
-- ⚠ EVERY NEGATIVE ASSERTION HAS A POSITIVE CONTROL BESIDE IT. A test that a constraint
--   REJECTS something proves nothing on its own — a constraint that rejects everything
--   would pass it. Each rejection probe below is paired with an acceptance.
--
-- ⚠ AND ONE FRAME-OF-REFERENCE WARNING, STATED BEFORE THE RUN RATHER THAN AFTER A
--   SURPRISE: this block executes as `postgres`, which BYPASSES RLS. The probes below
--   therefore prove that the CONSTRAINTS and the FUNCTION behave; they prove NOTHING
--   about who can read or write through the API. That half is asserted by reading
--   pg_policies and the grant catalogue, which is a different kind of evidence and is
--   the right kind for that question.
DO $$
DECLARE
  v_policies    int;
  v_restrictive int;
  v_storage_pol int;
  v_default     text;
  v_rls         boolean;
  v_slots       text;
  v_routes      text;
  v_cfg         text[];
  v_grants      text;
  v_bucket_pub  boolean;
  v_probe       uuid;
  v_v           bigint;
  v_t           bigint;
BEGIN
  -- ── Policy shape ──────────────────────────────────────────────────────────
  SELECT count(*) INTO v_policies
    FROM pg_policies WHERE schemaname='public' AND tablename='ad_banners';
  IF v_policies IS DISTINCT FROM 8 THEN
    RAISE EXCEPTION 'expected 8 policies on ad_banners, found %. Policies present: %',
      v_policies,
      (SELECT string_agg(policyname || '(' || cmd || ')', ', ' ORDER BY policyname)
         FROM pg_policies WHERE schemaname='public' AND tablename='ad_banners');
  END IF;

  SELECT count(*) INTO v_restrictive
    FROM pg_policies WHERE schemaname='public' AND tablename='ad_banners'
      AND permissive = 'RESTRICTIVE';
  IF v_restrictive IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'expected 3 RESTRICTIVE no_anon policies, found %. A no_anon_* policy '
                    'created PERMISSIVE does not block anything — it GRANTS. Rows: %',
      v_restrictive,
      (SELECT string_agg(policyname || '=' || permissive, ', ' ORDER BY policyname)
         FROM pg_policies WHERE schemaname='public' AND tablename='ad_banners');
  END IF;

  SELECT c.relrowsecurity INTO v_rls
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname='ad_banners';
  IF v_rls IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'RLS is not enabled on ad_banners (relrowsecurity = %). Every policy '
                    'above is inert without it.', v_rls;
  END IF;

  -- ── THE PUBLIC READ POLICY MUST CARRY THE WINDOW ─────────────────────────
  -- Read from pg_policies, not from this file. A public SELECT policy that forgot the
  -- window would serve an expired campaign forever and look completely correct on screen
  -- for as long as the campaign was current — the failure surfaces only on the day
  -- somebody stops paying, which is the worst day to discover it.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='ad_banners'
       AND policyname='ad_banners_select_public'
       AND position('starts_at' in qual) > 0
       AND position('ends_at'   in qual) > 0
       AND position('is_active' in qual) > 0
  ) THEN
    RAISE EXCEPTION 'ad_banners_select_public does not filter on is_active + the flight '
                    'window. qual = %',
      coalesce((SELECT qual FROM pg_policies WHERE schemaname='public'
                 AND tablename='ad_banners' AND policyname='ad_banners_select_public'),
               '<policy absent>');
  END IF;

  -- ── The is_active DEFAULT, which is the whole pre-launch safety property ──
  SELECT column_default INTO v_default
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='ad_banners' AND column_name='is_active';
  IF v_default IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'ad_banners.is_active DEFAULT is % — expected false. With any other '
                    'default an INSERT that omits the column PUBLISHES itself.',
      coalesce(v_default,'<null>');
  END IF;

  -- ── Slot vocabulary, read from the constraint rather than from this file ──
  SELECT pg_get_constraintdef(oid) INTO v_slots
    FROM pg_constraint WHERE conname='ad_banners_slot_check';
  IF v_slots IS NULL THEN
    RAISE EXCEPTION 'ad_banners_slot_check does not exist — the slot vocabulary is unconstrained';
  END IF;
  -- CONTROL FIRST. Without it the negative below is an instrument that cannot fail: if
  -- pg_get_constraintdef returned something mentioning no slots at all, every "must not
  -- contain" test passes trivially.
  --
  -- ⚠ ANCHORED ON THE QUOTED LITERAL, NOT THE BARE WORD, because a bare `entry` is a
  --   substring of plenty of things. pg_get_constraintdef renders the expression only —
  --   no comments, unlike pg_get_functiondef — so the frame of reference is right.
  IF position('''home_footer''' in v_slots) = 0 OR position('''home_hero''' in v_slots) = 0
     OR position('''module_landing''' in v_slots) = 0 OR position('''guide_inline''' in v_slots) = 0
     OR position('''detail_footer''' in v_slots) = 0 OR position('''entry''' in v_slots) = 0 THEN
    RAISE EXCEPTION 'CONTROL FAILED: the slot constraint does not mention all six designed '
                    'slots, so the exclusion checks below tested nothing. def = %', v_slots;
  END IF;
  -- The weaker of the two locks on the exclusion list — the real one is
  -- scripts/check-ad-placement.mjs. See the header before adding a slot id here.
  IF position('''duty''' in v_slots) > 0 OR position('''search''' in v_slots) > 0
     OR position('''emergency''' in v_slots) > 0 OR position('''oli''' in v_slots) > 0 THEN
    RAISE EXCEPTION 'ad_banners_slot_check admits a slot id on the permanent exclusion '
                    'list (duty / search / emergency / oli). def = %', v_slots;
  END IF;

  -- ── Route vocabulary — the same shape, and the same three absences ───────
  SELECT pg_get_constraintdef(oid) INTO v_routes
    FROM pg_constraint WHERE conname='ad_banners_route_check';
  IF v_routes IS NULL THEN
    RAISE EXCEPTION 'ad_banners_route_check does not exist — any string is an in-app route';
  END IF;
  IF position('''towing''' in v_routes) = 0 OR position('''events''' in v_routes) = 0
     OR position('''accommodation''' in v_routes) = 0 THEN
    RAISE EXCEPTION 'CONTROL FAILED: the route constraint does not mention the routes it '
                    'is supposed to permit, so the exclusion check below tested nothing. '
                    'def = %', v_routes;
  END IF;
  IF position('''health''' in v_routes) > 0 OR position('''emergency''' in v_routes) > 0
     OR position('''duty''' in v_routes) > 0 OR position('''search''' in v_routes) > 0 THEN
    RAISE EXCEPTION 'ad_banners_route_check admits an excluded destination — a paid banner '
                    'must not route INTO duty / emergency / health / search. def = %', v_routes;
  END IF;

  -- ── bump_ad_counter: SECURITY DEFINER needs a pinned search_path ─────────
  SELECT p.proconfig INTO v_cfg
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='bump_ad_counter';
  IF v_cfg IS NULL OR NOT EXISTS (
       SELECT 1 FROM unnest(v_cfg) c WHERE c LIKE 'search_path=%') THEN
    RAISE EXCEPTION 'bump_ad_counter is SECURITY DEFINER with no pinned search_path '
                    '(proconfig = %). A caller who can create objects in an earlier schema '
                    'could shadow ad_banners and have it run as the owner.',
      coalesce(array_to_string(v_cfg, ', '), '<null>');
  END IF;

  -- EXECUTE must reach both roles, or every count is silently zero forever — a state
  -- indistinguishable from "nobody looks at the ads", which is the conclusion somebody
  -- would draw from it.
  --
  -- ⚠ ASKED OF has_function_privilege AND pg_proc.proacl, NOT information_schema.
  --   information_schema.routine_privileges lists only privileges granted TO or BY a
  --   CURRENTLY ENABLED role — superuser does not enable every role — so it can report
  --   a perfectly correct grant as absent. That is the frame-of-reference failure this
  --   file's own header warns about, arriving inside the check that was supposed to
  --   catch one. The catalogue answers regardless of who is asking.
  SELECT coalesce(array_to_string(p.proacl, ', '), '<default: PUBLIC EXECUTE>')
    INTO v_grants
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='bump_ad_counter';
  IF NOT has_function_privilege('anon', 'public.bump_ad_counter(uuid, text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.bump_ad_counter(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'bump_ad_counter EXECUTE does not reach both anon and authenticated. '
                    'proacl = %. Counting would fail silently for those sessions — and a '
                    'silent zero reads as "nobody looks at the ads".', v_grants;
  END IF;

  -- ── The destination shape actually rejects the shapes it names ───────────
  -- A CHECK is the one object whose correctness cannot be read off its definition with
  -- confidence, so these exercise it. Every probe is deleted before this block ends.
  BEGIN
    INSERT INTO public.ad_banners (slot, advertiser_name, image_url, starts_at, ends_at)
    VALUES ('home_footer','Probe','https://example.com/a.png', now(), now() + interval '1 day');
    RAISE EXCEPTION 'CONTROL FAILED: a banner with NO destination was ACCEPTED — '
                    'ad_banners_destination_check is not doing its job';
  EXCEPTION WHEN check_violation THEN NULL;  -- expected
  END;

  BEGIN
    INSERT INTO public.ad_banners (slot, advertiser_name, image_url, link_url, route, starts_at, ends_at)
    VALUES ('home_footer','Probe','https://example.com/a.png','https://example.com','events',
            now(), now() + interval '1 day');
    RAISE EXCEPTION 'CONTROL FAILED: a banner with BOTH a link_url and a route was ACCEPTED';
  EXCEPTION WHEN check_violation THEN NULL;  -- expected
  END;

  BEGIN
    INSERT INTO public.ad_banners (slot, advertiser_name, image_url, route, starts_at, ends_at)
    VALUES ('home_footer','Probe','https://example.com/a.png','healthh',
            now(), now() + interval '1 day');
    RAISE EXCEPTION 'CONTROL FAILED: an unknown in-app route was ACCEPTED — a typo would '
                    'reach production as a paid banner that does nothing when tapped';
  EXCEPTION WHEN check_violation THEN NULL;  -- expected
  END;

  BEGIN
    INSERT INTO public.ad_banners (slot, advertiser_name, image_url, link_url, starts_at, ends_at)
    VALUES ('home_footer','Probe','https://example.com/a.png','http://example.com',
            now(), now() + interval '1 day');
    RAISE EXCEPTION 'CONTROL FAILED: a cleartext http:// destination was ACCEPTED';
  EXCEPTION WHEN check_violation THEN NULL;  -- expected
  END;

  BEGIN
    INSERT INTO public.ad_banners (slot, advertiser_name, image_url, link_url, starts_at, ends_at)
    VALUES ('home_footer','Probe','https://example.com/a.png','https://example.com',
            now() + interval '1 day', now());
    RAISE EXCEPTION 'CONTROL FAILED: a campaign ending BEFORE it starts was ACCEPTED';
  EXCEPTION WHEN check_violation THEN NULL;  -- expected
  END;

  -- ── POSITIVE CONTROL, without which every probe above proves only that SOMETHING
  --    rejects everything. A well-formed row must be accepted.
  INSERT INTO public.ad_banners (slot, advertiser_name, image_url, link_url,
                                 starts_at, ends_at, is_active)
  VALUES ('home_footer','Probe','https://example.com/a.png','https://example.com',
          now() - interval '1 hour', now() + interval '1 day', true)
  RETURNING id INTO v_probe;
  IF v_probe IS NULL THEN
    RAISE EXCEPTION 'CONTROL FAILED: a well-formed banner did not return an id';
  END IF;

  -- ── bump_ad_counter actually counts, and only what it should ─────────────
  -- Frame of reference, restated because it is the thing that goes wrong: this runs as
  -- postgres and bypasses RLS, so it measures ARITHMETIC AND THE KIND GUARD, not access.
  PERFORM public.bump_ad_counter(v_probe, 'view');
  PERFORM public.bump_ad_counter(v_probe, 'view');
  PERFORM public.bump_ad_counter(v_probe, 'tap');
  PERFORM public.bump_ad_counter(v_probe, 'sideways');     -- unknown kind: must be a no-op
  PERFORM public.bump_ad_counter(gen_random_uuid(), 'view'); -- unknown row: must be a no-op

  SELECT view_count, tap_count INTO v_v, v_t FROM public.ad_banners WHERE id = v_probe;
  IF v_v IS DISTINCT FROM 2 OR v_t IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'bump_ad_counter did not count as specified: after 2 views, 1 tap, one '
                    'unknown kind and one unknown row the counters read view=% tap=% '
                    '(expected 2 and 1).', coalesce(v_v,-1), coalesce(v_t,-1);
  END IF;

  -- An INACTIVE row must not count. This is what stops a paused campaign accruing views
  -- from clients that still hold it in memory.
  UPDATE public.ad_banners SET is_active = false WHERE id = v_probe;
  PERFORM public.bump_ad_counter(v_probe, 'view');
  SELECT view_count INTO v_v FROM public.ad_banners WHERE id = v_probe;
  IF v_v IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'bump_ad_counter incremented an INACTIVE ad (view_count = %, expected 2)', v_v;
  END IF;

  DELETE FROM public.ad_banners WHERE id = v_probe;

  IF (SELECT count(*) FROM public.ad_banners) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'the probe rows were not cleaned up — table should be empty, has %',
      (SELECT count(*) FROM public.ad_banners);
  END IF;

  -- ── Storage ──────────────────────────────────────────────────────────────
  SELECT public INTO v_bucket_pub FROM storage.buckets WHERE id = 'ad-images';
  IF v_bucket_pub IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'the ad-images bucket is missing or not public (public = %). image_url '
                    'stores a public URL; a private bucket serves a broken image to every '
                    'user with no error anywhere.', coalesce(v_bucket_pub::text,'<absent>');
  END IF;

  SELECT count(*) INTO v_storage_pol
    FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
      AND policyname LIKE 'ad_images_%';
  IF v_storage_pol IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'expected 4 ad_images_* policies on storage.objects, found %. ZERO is '
                    'the place-photos failure repeating: RLS is default-deny, so the bucket '
                    'looks healthy while every non-service_role upload is rejected. Rows: %',
      v_storage_pol,
      coalesce((SELECT string_agg(policyname || '(' || cmd || ')', ', ' ORDER BY policyname)
                  FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
                    AND policyname LIKE 'ad_images_%'), '<none>');
  END IF;

  RAISE NOTICE '── ad_banners ────────────────────────────────────────────';
  RAISE NOTICE '  policies: % (% restrictive) · RLS on · is_active DEFAULT %',
    v_policies, v_restrictive, v_default;
  RAISE NOTICE '  slots:  %', v_slots;
  RAISE NOTICE '  routes: %', v_routes;
  RAISE NOTICE '  bump_ad_counter: search_path pinned (%), EXECUTE to %',
    array_to_string(v_cfg, ' '), v_grants;
  RAISE NOTICE '  counter verified: 2 views + 1 tap counted; unknown kind, unknown row and';
  RAISE NOTICE '    inactive ad all no-ops. Constraints reject 5 malformed shapes, accept 1.';
  RAISE NOTICE '  storage: ad-images public, % policies', v_storage_pol;
  RAISE NOTICE '  rows: 0 — every slot unsold, every slot zero-height, Home unchanged';
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
VALUES ('20261008_ad_banners.sql', '4c42b895479724fccd20b4329afb727933aafbbce1d0584dc79290299355e50a')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- A NEW TABLE needs the PostgREST reload as much as a new column does — and so does a new
-- RPC, which is reached through the same schema cache. Without it the REST API answers
-- 42P01 / PGRST202 for objects that exist in Postgres, and the client's fall-through would
-- hide both: the slot would stay collapsed and the counters would stay zero, which is
-- exactly what an unsold slot looks like.
NOTIFY pgrst, 'reload schema';

-- ─── REVERT ────────────────────────────────────────────────────────────────
--   BEGIN;
--     SET ROLE postgres;
--     DROP FUNCTION IF EXISTS public.bump_ad_counter(uuid, text);
--     DROP TABLE IF EXISTS public.ad_banners;          -- policies and indexes go with it
--     DROP POLICY IF EXISTS "ad_images_public_read"   ON storage.objects;
--     DROP POLICY IF EXISTS "ad_images_admin_insert"  ON storage.objects;
--     DROP POLICY IF EXISTS "ad_images_admin_update"  ON storage.objects;
--     DROP POLICY IF EXISTS "ad_images_admin_delete"  ON storage.objects;
--     -- The bucket itself is left alone: dropping it would delete uploaded artwork, and
--     -- an empty bucket costs nothing. Delete it by hand if that is really what you want.
--   COMMIT;
--   RESET ROLE;
--   NOTIFY pgrst, 'reload schema';
-- The client needs no change: every read already treats a missing table as an unsold
-- slot, which is the state it ships in.
