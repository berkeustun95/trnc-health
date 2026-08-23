-- ─── contact_events — anonymous contact-tap counter, app-wide from day one ────
--
-- WHAT IT ANSWERS: how many people actually tap through to contact a listed firm.
-- This is the evidence base for the featured tier. A slot cannot be sold on "we have
-- an app"; it can be sold on "at least 47 people tapped call on your listing last
-- month". Everything below is shaped by that one sentence — including the word
-- AT LEAST, which is not padding. See THE FLOOR, below.
--
-- ─── THE FLOOR — READ THIS BEFORE QUOTING A NUMBER TO AN ADVERTISER ──────────
--
-- These counts are a FLOOR, NOT A MEASUREMENT. The client fires the insert and does
-- not wait for it: on a roadside screen with one bar of signal, an analytics write
-- that hangs must never cost someone their phone call, so a failed write is dropped
-- silently and the call proceeds. There is deliberately NO offline retry queue (a
-- queue would mean storing taps on the device, which is a trace at rest and breaks
-- the anonymity contract below).
--
-- The bias is not random. It falls hardest on exactly the case this module exists
-- for: the person with no signal, at the roadside, at night. Those taps are real and
-- they are not in this table.
--
-- So: say "AT LEAST 47" and it is always true. Say "47" and it is always wrong, and
-- wrong in the direction that under-sells us. Never quote a bare figure on a rate
-- card. This paragraph is repeated in the comment on contact_events_monthly and is
-- readable from the database itself (\d+ / obj_description), because a caveat that
-- lives only in a chat log will be forgotten by the time someone signs a contract.
--
-- ─── THE ANONYMITY CONTRACT (non-negotiable) ─────────────────────────────────
--
-- NO user_id. NO device id. NO session id. NO IP. NO dedup key of any kind.
-- Someone calling a tow truck at 3am is not a data point that should be attached to
-- a person, and the metric wanted here is a COUNT, not a list.
--
-- This is why per-person dedup is IMPOSSIBLE here, by design: nothing in a row can
-- distinguish one person tapping three times from three people tapping once. The
-- replacement is minute-bucketing in contact_events_monthly — see that view.
--
-- The identifiability risk in this design lives in a RECURRING KEY, not in `region`.
-- region + timestamp with no key is a fact about a place and a moment; region +
-- timestamp + a key that recurs is a behavioural trace of a person. Do not add a key.
-- Not a hashed install id, not a per-day salt, not a "coarse" bucket. Any column that
-- lets two rows be recognised as the same origin converts this table from a counter
-- into a log of individuals, and no amount of hashing undoes that.
--
-- ─── WHY A TABLE AND NOT AN ANALYTICS SDK ────────────────────────────────────
--
-- ADA has no analytics layer: no PostHog / Amplitude / Mixpanel / Segment / Sentry in
-- package.json, and google-services.json is FCM push only. Three independent reasons
-- not to add one: the house rule against third-party SDKs; every tool in that class is
-- identity-first by default (distinct_id, device id, session replay), so the whole
-- integration would be spent fighting the contract above; and a table next to
-- towing_companies makes "taps on your listing" a single join.
--
-- ─── APP-WIDE FROM DAY ONE ───────────────────────────────────────────────────
--
-- Towing is the pilot and the only writer today. Garages, Home Services, Beauty and
-- Transportation all have call buttons and will want this. Going app-wide must be
-- ADDING CALL SITES, not a migration — hence the polymorphic (module, entity_id) key.
--
-- NO FOREIGN KEY on entity_id, deliberately. It is polymorphic by requirement —
-- towing_companies.id today, facilities.id / home_services.id later — and a FK points
-- at exactly one table. A garbage uuid joins to nothing and contributes to no report.
-- An FK would not buy trust anyway: anyone able to insert a fake id can insert a REAL
-- one just as easily.
--
-- The module and action CHECKs are NOT an anti-attacker measure. They catch typos in
-- OUR OWN call sites, which is the failure that actually happens: 'whatsApp' vs
-- 'whatsapp' silently splits one firm's count into two rows that never add up. A new
-- module always ships its own migration, so extending the CHECK rides along with it;
-- "no migration later" means no RESTRUCTURING of this table, and that holds.
--
-- DELIBERATELY ABSENT from the module list: the core facilities directory and the
-- duty-pharmacy list. Both have call buttons; neither is a MODULE_FLAGS key, and the
-- list here is pinned to those keys so it stays the same vocabulary the waitlist and
-- the go-live RPC already use. Instrumenting them is a one-line ALTER, not an oversight.
--
-- DELIBERATELY ABSENT: a was_fallback column. Whether the towing "nobody covers your
-- region" fallback fired is DERIVABLE — region IS NOT NULL AND region <> ALL(the
-- firm's coverage_regions). Derived beats stored, and no other module has a fallback.
--
-- ─── ABUSE ───────────────────────────────────────────────────────────────────
--
-- Nothing stops someone inserting 10,000 rows, and nothing at the RLS layer can: the
-- anon key ships inside the app bundle, so a public INSERT endpoint reachable with a
-- public key is spammable by construction. Rate-limiting by user is forbidden by the
-- contract above; rate-limiting by IP means storing an IP (a device-linked identifier)
-- and is useless anyway under TRNC carrier CGNAT.
--
-- So the defence is NOT to prevent the insert — it is to make spam not move the number
-- that gets sold. contact_events_monthly reports tap_minutes, which is capped at 60 per
-- firm per hour by arithmetic, and a flood leaves a taps/tap_minutes ratio so absurd it
-- flags itself. If this is ever genuinely abused, the fix is an Edge Function with an
-- IP bucket, not a policy here.
--
-- Purging spam is possible: postgres and service_role bypass RLS, so a DELETE from the
-- SQL editor works. The app cannot delete — see the RESTRICTIVE policies.
--
-- Safe to re-run: CREATE TABLE IF NOT EXISTS / drop-then-create throughout.
-- Apply with the SQL editor, Role selector = postgres.
-- Verify with supabase/verify_contact_events.sql AFTER applying.

SET ROLE postgres;
BEGIN;

-- ─── Table ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.contact_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module     text NOT NULL,          -- MODULE_FLAGS key; 'towing' is the only writer today
  entity_id  uuid NOT NULL,          -- towing_companies.id today. NO FK — see the header.
  action     text NOT NULL,          -- 'call' | 'whatsapp' | 'call_secondary'
  region     text,                   -- region filter active at tap time; NULL = unknown
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.contact_events IS
  'Anonymous contact-tap counter. NO user_id / device id / session id / IP / dedup key '
  'of any kind, deliberately — see 20260910_contact_events.sql. Counts are a FLOOR, not '
  'a measurement: the client fires and forgets so the phone call is never blocked, and '
  'there is no retry queue, so taps made with no signal are simply absent. Quote "at '
  'least N", never a bare N. Read contact_events_monthly, not this table.';

-- ─── Constraints ─────────────────────────────────────────────────────────────
-- Drop-then-add per constraint so the file stays re-runnable (house convention).

-- The MODULE_FLAGS keys from constants/flags.js, verbatim. Same vocabulary as
-- module_waitlist.module and notify_module_waitlist().
ALTER TABLE public.contact_events DROP CONSTRAINT IF EXISTS contact_events_module_check;
ALTER TABLE public.contact_events ADD CONSTRAINT contact_events_module_check
  CHECK (module IN ('homeServices','grooming','garages','transport','insurance','pets',
                    'events','jobs','accommodation','studentHub','explore','towing'));

ALTER TABLE public.contact_events DROP CONSTRAINT IF EXISTS contact_events_action_check;
ALTER TABLE public.contact_events ADD CONSTRAINT contact_events_action_check
  CHECK (action IN ('call','whatsapp','call_secondary'));

-- The seven canonical region keys — identical to REGIONS in constants/regions.js and
-- to towing_base_region_check. NULLABLE: location may be unknown (permission never
-- granted, revoked, no fix, outside the TRNC outline), and that is a real, common
-- state on this screen, not an error.
ALTER TABLE public.contact_events DROP CONSTRAINT IF EXISTS contact_events_region_check;
ALTER TABLE public.contact_events ADD CONSTRAINT contact_events_region_check
  CHECK (region IS NULL OR region = ANY (ARRAY['nicosia'::text,'kyrenia'::text,'famagusta'::text,
                                               'morphou'::text,'iskele'::text,'lefke'::text,'karpaz'::text]));

-- ─── Index ───────────────────────────────────────────────────────────────────
-- Serves the only query that matters: taps for one firm over a date range, which is
-- also what contact_events_monthly groups by. Leading `module` keeps each module's
-- rows contiguous once this table is app-wide.
CREATE INDEX IF NOT EXISTS idx_contact_events_module_entity_time
  ON public.contact_events (module, entity_id, created_at);

-- ─── Grants ──────────────────────────────────────────────────────────────────
--
-- GRANTS ARE LOAD-BEARING HERE, NOT DECORATION. Supabase's default privileges hand
-- anon and authenticated ALL on a newly created table in `public`, so this REVOKE is
-- what makes the rest of the section mean anything.
--
-- COLUMN-LEVEL INSERT is what makes the timestamp UNFORGEABLE. A client may set only
-- module / entity_id / action / region; `id` and `created_at` are not grantable to it,
-- so no caller can backdate a row or pick its primary key — no trigger required.
--
-- anon AND authenticated both need INSERT: the app signs in anonymously on launch, so
-- most sessions are `authenticated` with is_anonymous=true, but a tap that lands before
-- that completes runs as true `anon`.
--
-- SELECT stays granted to `authenticated` (RLS gates it to admin, below). Revoking it
-- at the grant layer would mean the eventual admin screen needs a migration to read its
-- own data, and RLS — not the grant table — is this project's security boundary.
REVOKE ALL ON public.contact_events FROM anon, authenticated;
GRANT INSERT (module, entity_id, action, region) ON public.contact_events TO anon, authenticated;
GRANT SELECT ON public.contact_events TO authenticated;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
--
-- IN PLAIN ENGLISH — who can do what:
--
--   INSERT  ANYONE. A signed-out guest, an anonymous session, a signed-in customer, a
--           provider, an admin — all identical, all writing a row that names nobody.
--           This is the exact INVERSE of towing_companies, where write is admin-only.
--           There is deliberately NO no_anon_insert veto: guests writing is the point.
--           The columns they may set are fixed by the grant above, not by a policy.
--
--   SELECT  ADMINS ONLY (profiles.role = 'admin'). A guest, a customer or a provider
--           selecting from this table gets zero rows. There is NO public SELECT policy
--           at all, which also means an `anon` session never evaluates is_admin() —
--           the same reasoning that split the two SELECT policies on towing_companies.
--
--   UPDATE  NOBODY, including admin. No permissive policy exists, so both are already
--   DELETE  denied; the RESTRICTIVE vetoes below are the belt to that braces.
--
--   PURGE   postgres and service_role bypass RLS entirely. Deleting spam from the SQL
--           editor works. Nothing reachable from the app can mutate a row.
--
-- ON "THE RESTRICTIVE GUEST-WRITE PATTERN, INVERTED": module_waitlist's restrictive
-- layer confines every write to the caller's OWN row (user_id = auth.uid()). Here there
-- IS no own row — there is no user column, by contract — so that job does not exist and
-- the restrictive layer's purpose flips to enforcing APPEND-ONLY. A future permissive
-- policy added in haste cannot make these rows mutable, because RESTRICTIVE is AND-ed
-- with everything else and can only ever subtract.
--
-- Postgres has no CREATE POLICY IF NOT EXISTS — drop-then-create keeps this re-runnable.

ALTER TABLE public.contact_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ce_insert_public" ON public.contact_events;
CREATE POLICY "ce_insert_public" ON public.contact_events
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "ce_select_admin" ON public.contact_events;
CREATE POLICY "ce_select_admin" ON public.contact_events
  FOR SELECT TO authenticated
  USING ((select public.is_admin()));

DROP POLICY IF EXISTS "ce_no_update" ON public.contact_events;
CREATE POLICY "ce_no_update" ON public.contact_events
  AS RESTRICTIVE FOR UPDATE TO public
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "ce_no_delete" ON public.contact_events;
CREATE POLICY "ce_no_delete" ON public.contact_events
  AS RESTRICTIVE FOR DELETE TO public
  USING (false);

-- ─── Reporting view ──────────────────────────────────────────────────────────
--
-- READ THIS VIEW, NOT THE TABLE. It ships in the same migration as the table on
-- purpose: the deduped, spam-resistant number should be the one that exists from day
-- one, so nobody ever reaches for a raw count(*) because the view was not written yet.
--
-- ─── WHY tap_minutes IS THE NUMBER YOU SELL ──────────────────────────────────
--
-- Per-person dedup is impossible here (no identifier — see the table header), so
-- "distinct people" cannot be computed and must not be claimed. tap_minutes counts
-- DISTINCT MINUTES in which a firm was tapped at all. It is not per-person dedup; it is
-- per-minute-per-firm collapse, and its errors run in the safe direction:
--
--   • over-collapse — two different people tapping the same firm in the same minute
--     count as one. Rare at this volume, and it UNDERCOUNTS, which is the safe way to
--     be wrong about a number on a rate card.
--   • under-collapse — one person retrying at 10:00:59 and 10:01:01 counts as two.
--
-- It also does the abuse job. tap_minutes is capped at 60 per firm per hour by
-- arithmetic, so a script inserting 10,000 rows moves the sellable figure by at most
-- 60/hour and leaves a taps/tap_minutes ratio that is visibly absurd.
--
-- ─── THE GAP BETWEEN taps AND tap_minutes IS ITSELF A SIGNAL ─────────────────
--
-- A firm with 90 taps and 31 tap_minutes is a firm whose phone is not being answered:
-- people tapped, nothing connected, they tapped again. That is a directory-quality
-- signal worth watching on its own, and it is the reason raw events are stored rather
-- than pre-aggregated. Do not "clean up" this view by dropping `taps`.
--
-- ─── AND IT IS STILL A FLOOR ─────────────────────────────────────────────────
--
-- Fire-and-forget with no retry queue means taps made with no signal never arrive, and
-- that bias falls hardest on the roadside-at-night case this module exists for. Quote
-- "AT LEAST 47", never "47". The first is always true; the second is always wrong, and
-- wrong in the direction that under-sells us.
--
-- TIMEZONE: bucketed in Europe/Istanbul (= TRNC local, no DST), because "last month"
-- means the local month to the person being invoiced. Minute boundaries are
-- offset-invariant, so the conversion changes nothing for tap_minutes — it is applied
-- once, to both, so the two columns can never drift apart.
--
-- security_invoker = true IS LOAD-BEARING (PG15+). A Postgres view runs as its OWNER by
-- default, and this one is owned by postgres — which bypasses the admin-only RLS on the
-- table underneath. Without this option, granting the view to `authenticated` would
-- hand every customer the full contact log. Verify block V6d asserts it behaviourally.
-- If CREATE VIEW rejects the option, the project predates PG15: do NOT drop the option
-- to make it apply — drop the GRANT to authenticated instead and query it as postgres.
DROP VIEW IF EXISTS public.contact_events_monthly;
CREATE VIEW public.contact_events_monthly
  WITH (security_invoker = true) AS
SELECT
  e.module,
  e.entity_id,
  date_trunc('month', l.local_ts)                  AS month,
  count(*)                                         AS taps,
  count(DISTINCT date_trunc('minute', l.local_ts)) AS tap_minutes,
  count(*) FILTER (WHERE e.action = 'call')           AS calls,
  count(*) FILTER (WHERE e.action = 'whatsapp')       AS whatsapps,
  count(*) FILTER (WHERE e.action = 'call_secondary') AS calls_secondary,
  -- Coverage-gap evidence: which regions the taps came from, and how many had no
  -- region at all. array_agg over the DISTINCT set keeps this one row per firm-month.
  array_agg(DISTINCT e.region ORDER BY e.region) FILTER (WHERE e.region IS NOT NULL) AS regions,
  count(*) FILTER (WHERE e.region IS NULL)            AS taps_region_unknown
FROM public.contact_events e
CROSS JOIN LATERAL (SELECT e.created_at AT TIME ZONE 'Europe/Istanbul' AS local_ts) l
GROUP BY e.module, e.entity_id, date_trunc('month', l.local_ts);

COMMENT ON VIEW public.contact_events_monthly IS
  'THESE COUNTS ARE A FLOOR, NOT A MEASUREMENT. The client fires the contact-tap insert '
  'and does not wait for it, so that an analytics write can never block a phone call on '
  'a roadside with one bar of signal, and there is deliberately no offline retry queue. '
  'Taps made with no signal are therefore simply absent, and that bias falls hardest on '
  'exactly the roadside-at-night case the towing module exists for. Say "AT LEAST 47" '
  'and it is always true; say "47" and it is always wrong, in the direction that '
  'under-sells us. Never put a bare figure on a rate card. '
  'tap_minutes, not taps, is the sellable number: per-person dedup is impossible here '
  '(the table carries no identifier, by design), so this collapses each firm-minute to '
  'one, which also caps spam at 60/firm/hour arithmetically. The GAP between taps and '
  'tap_minutes is its own signal — 90 taps over 31 tap_minutes is a firm not answering '
  'its phone.';

REVOKE ALL ON public.contact_events_monthly FROM anon, authenticated;
GRANT SELECT ON public.contact_events_monthly TO authenticated;

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
VALUES ('20260910_contact_events.sql', '6943b7a33ca0d2f732e7b6376a05fdcd89be031345f7360e731a079f89ce2b59')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- PostgREST schema-cache refresh. MANDATORY for a NEW table: without it the app's
-- .from('contact_events') insert 404s (PGRST205) against a table that demonstrably
-- exists in Postgres, because PostgREST is still serving its cached schema. And since
-- the client swallows every error by design, that 404 would be completely silent —
-- zero rows, no complaint, and the natural conclusion "nobody taps call".
NOTIFY pgrst, 'reload schema';

-- ─── Verification ────────────────────────────────────────────────────────────
-- Run supabase/verify_contact_events.sql after applying. It covers the grant matrix,
-- the RLS matrix, the CHECK vocabulary, the append-only vetoes, the minute-bucketing
-- and the view's security_invoker — each as a case that has been watched go red.
--
-- The client half CANNOT be proved from SQL. supabase-js query builders are lazy
-- thenables: `supabase.from(...).insert(...)` with no .then()/.catch() never sends a
-- request at all, and fire-and-forget hides that completely. The only proof is tapping
-- all eight surfaces on device and counting rows here as postgres.

-- ─── Rollback ────────────────────────────────────────────────────────────────
--   SET ROLE postgres;
--   BEGIN;
--   DROP VIEW IF EXISTS public.contact_events_monthly;
--   DROP TABLE IF EXISTS public.contact_events;   -- policies and grants drop with it
--   DELETE FROM public.schema_migrations_applied WHERE filename = '20260910_contact_events.sql';
--   COMMIT;
--   RESET ROLE;
--   NOTIFY pgrst, 'reload schema';
