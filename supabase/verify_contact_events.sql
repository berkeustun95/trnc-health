-- ─── Verification — 20260910_contact_events.sql ──────────────────────────────
--
-- Run AFTER applying the migration. SQL editor, Role selector = postgres.
--
-- ▶ HOW TO RUN: the SQL editor shows only the LAST result set, so run the blocks
--   ONE AT A TIME — select from a `═══ BLOCK Vn ═══` banner down to the next banner.
--
-- NOTHING IS PERSISTED. Every block is BEGIN … ROLLBACK, fixtures included.
--
-- BLOCKS V4, V4b, V5, V5b, V5c, V6, V7 and V7b ARE EXPECTED TO ERROR — THE ERROR IS
-- THE PASS. If one of them SUCCEEDS, the thing it guards is missing. A green check you
-- have never watched go red is a decoration, so each of those blocks is written to fail
-- against the CURRENT schema for a NAMED reason, stated in its own header.
--
-- ⚠ AND ON FIVE OF THOSE BLOCKS (V4, V4b, V6, V7, V7b) POSTGRES ATTACHES A `HINT:` THAT
-- IS WRONG AND DANGEROUS. Each one suggests a GRANT that would destroy exactly what the
-- block proves — table-wide INSERT kills the unforgeable timestamp, SELECT to anon opens
-- the contact log to the whole internet, UPDATE/DELETE ends append-only. Postgres is
-- guessing at intent from the failed statement; it cannot know the refusal is designed.
-- Each block repeats this warning inline, because whoever hits one of these errors in a
-- year will be reading that block and not this header.
--
-- THREE BLOCKS (V3, V3b, V5d) INSERT AS anon/authenticated AND THEN READ BACK AS
-- postgres, via `SET LOCAL ROLE postgres;`. If that statement errors with "permission
-- denied to set role", the editor's session authorization has no membership in postgres
-- — swap those three lines for `RESET ROLE;` and re-run. Nothing else in the file
-- switches back.
--
-- BLOCK V10 CANNOT BE DONE IN SQL AND IS THE ONE THAT ACTUALLY MATTERS. Everything
-- above it proves the database is correct. None of it proves the app ever sends
-- anything — and the client failure mode here is completely silent. Do V10.


-- ═══ BLOCK V1 / 10 — SCHEMA SHAPE — run alone ══════════════════════════════
-- Expect: EVERY row status = 'OK'. Anything else floats to the top.
BEGIN;
WITH report AS (
SELECT 'column' AS kind, e.o AS object,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns ic
              WHERE ic.table_schema='public' AND ic.table_name='contact_events'
                AND ic.column_name=e.o) THEN 'OK' ELSE 'MISSING' END AS status
FROM (VALUES ('id'),('module'),('entity_id'),('action'),('region'),('created_at')) e(o)
UNION ALL
-- The anonymity contract is an ABSENCE, which no existence check can express — so
-- assert the absence directly. If any of these ever appears, the table has stopped
-- being a counter and become a log of individuals.
SELECT 'column-ABSENT-by-contract', e.o,
       CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns ic
              WHERE ic.table_schema='public' AND ic.table_name='contact_events'
                AND ic.column_name=e.o) THEN 'OK' ELSE 'FAIL ← identifier added, contract broken' END
FROM (VALUES ('user_id'),('device_id'),('session_id'),('install_id'),('ip'),('ip_address'),('dedup_key')) e(o)
UNION ALL
SELECT 'constraint', e.o,
       CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname=e.o) THEN 'OK' ELSE 'MISSING' END
FROM (VALUES ('contact_events_module_check'),('contact_events_action_check'),
             ('contact_events_region_check'),('contact_events_pkey')) e(o)
UNION ALL
-- NO FK on entity_id, deliberately (polymorphic). Assert the absence: an FK added later
-- would start rejecting every module except whichever table it points at.
SELECT 'fk-ABSENT-by-design', 'contact_events.entity_id',
       CASE WHEN NOT EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = to_regclass('public.contact_events') AND contype='f')
            THEN 'OK' ELSE 'FAIL ← an FK makes this table single-module' END
UNION ALL
SELECT 'index', 'idx_contact_events_module_entity_time',
       CASE WHEN to_regclass('public.idx_contact_events_module_entity_time') IS NOT NULL
            THEN 'OK' ELSE 'MISSING' END
UNION ALL
SELECT 'rls-enabled', 'contact_events',
       CASE WHEN (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.contact_events'))
            THEN 'OK' ELSE 'OFF ← FIX' END
UNION ALL
SELECT 'policy', e.o,
       CASE WHEN EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
              AND tablename='contact_events' AND policyname=e.o) THEN 'OK' ELSE 'MISSING' END
FROM (VALUES ('ce_insert_public'),('ce_select_admin'),('ce_no_update'),('ce_no_delete')) e(o)
UNION ALL
-- Exactly four. A fifth policy is not automatically wrong, but on THIS table it is the
-- shape of the mistake that matters: a permissive SELECT or UPDATE added later.
SELECT 'policy-count', 'contact_events (expect 4)',
       CASE WHEN (SELECT count(*) FROM pg_policies
                  WHERE schemaname='public' AND tablename='contact_events') = 4
            THEN 'OK' ELSE 'REVIEW ← policy set changed' END
UNION ALL
SELECT 'restrictive', e.o,
       CASE WHEN EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
              AND tablename='contact_events' AND policyname=e.o AND permissive='RESTRICTIVE')
            THEN 'OK' ELSE 'FAIL ← not RESTRICTIVE, so it cannot veto' END
FROM (VALUES ('ce_no_update'),('ce_no_delete')) e(o)
UNION ALL
-- Deliberately NO no_anon veto here — this is the inverse of towing_companies and
-- guests writing is the entire point. Assert the absence so nobody "restores" it.
SELECT 'no-anon-veto-ABSENT-by-design', 'contact_events',
       CASE WHEN NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
              AND tablename='contact_events' AND policyname LIKE 'no_anon%')
            THEN 'OK' ELSE 'FAIL ← guests can no longer log a tap' END
UNION ALL
SELECT 'view', 'contact_events_monthly',
       CASE WHEN to_regclass('public.contact_events_monthly') IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL
-- security_invoker is the only thing standing between an admin-only table and every
-- signed-in customer. A view runs as its OWNER by default, and this one is owned by
-- postgres, which bypasses RLS. Static half here; behavioural half in V6d.
SELECT 'view-option', 'contact_events_monthly security_invoker',
       CASE WHEN to_regclass('public.contact_events_monthly') IS NULL THEN 'N/A ← view missing'
            WHEN (SELECT reloptions FROM pg_class WHERE oid = to_regclass('public.contact_events_monthly'))
                 @> ARRAY['security_invoker=true'] THEN 'OK'
            ELSE 'FAIL ← view BYPASSES RLS, contact log readable by any customer' END
)
-- Wrapped in a CTE so this can order on a BOOLEAN. Across a UNION, ORDER BY accepts
-- only an output column name or position — never an expression — and even in a plain
-- SELECT an ORDER BY expression resolves names against the FROM clause, not the select
-- list. Selecting from the CTE makes `status` a real input column, which is the same
-- reason verify_schema.sql QUERY 1 wraps its report. Ordering on the text instead would
-- not do the job anyway: 'OK' sorts in the MIDDLE of the failure strings
-- ('FAIL' < 'MISSING' < 'N/A' < 'OK' < 'REVIEW'), so a REVIEW row would hide below the
-- OKs, off the bottom of a long result. False first — anything not OK at the top.
SELECT * FROM report ORDER BY (status = 'OK'), kind, object;
ROLLBACK;


-- ═══ BLOCK V2 / 10 — GRANT MATRIX — run alone ══════════════════════════════
-- Expect: every row 'OK'.
--
-- Grants are load-bearing on this table, not decoration. Supabase's default privileges
-- hand anon/authenticated ALL on a new public table, so if the REVOKE in the migration
-- was skipped (a truncated paste), the column-level INSERT grants below still read as
-- present — while SELECT is silently wide open. That is why the false rows matter more
-- than the true ones here.
BEGIN;
SELECT e.label, CASE WHEN e.actual = e.expected THEN 'OK'
                     ELSE 'FAIL ← expected '||e.expected||', got '||e.actual END AS status
FROM (VALUES
  -- The four writable columns, for both roles. anon matters because a tap can land
  -- before signInAnonymously completes; authenticated covers every session after it.
  ('anon may INSERT module',            has_column_privilege('anon','public.contact_events','module','INSERT'), true),
  ('anon may INSERT entity_id',         has_column_privilege('anon','public.contact_events','entity_id','INSERT'), true),
  ('anon may INSERT action',            has_column_privilege('anon','public.contact_events','action','INSERT'), true),
  ('anon may INSERT region',            has_column_privilege('anon','public.contact_events','region','INSERT'), true),
  ('authenticated may INSERT module',   has_column_privilege('authenticated','public.contact_events','module','INSERT'), true),
  ('authenticated may INSERT region',   has_column_privilege('authenticated','public.contact_events','region','INSERT'), true),
  -- THE UNFORGEABLE HALF. No trigger defends created_at; this grant does. If either of
  -- these goes true, a client can backdate a tap or choose its primary key.
  ('anon may NOT INSERT created_at',    has_column_privilege('anon','public.contact_events','created_at','INSERT'), false),
  ('anon may NOT INSERT id',            has_column_privilege('anon','public.contact_events','id','INSERT'), false),
  ('authenticated may NOT INSERT created_at', has_column_privilege('authenticated','public.contact_events','created_at','INSERT'), false),
  ('authenticated may NOT INSERT id',   has_column_privilege('authenticated','public.contact_events','id','INSERT'), false),
  -- Reads. anon is cut off at the grant layer as well as the policy layer; authenticated
  -- keeps the grant so the future admin screen needs no migration, and RLS does the work.
  ('anon may NOT SELECT table',         has_table_privilege('anon','public.contact_events','SELECT'), false),
  ('authenticated MAY SELECT table',    has_table_privilege('authenticated','public.contact_events','SELECT'), true),
  ('anon may NOT SELECT view',          has_table_privilege('anon','public.contact_events_monthly','SELECT'), false),
  ('authenticated MAY SELECT view',     has_table_privilege('authenticated','public.contact_events_monthly','SELECT'), true),
  -- Append-only, at the grant layer too.
  ('anon may NOT UPDATE',               has_table_privilege('anon','public.contact_events','UPDATE'), false),
  ('anon may NOT DELETE',               has_table_privilege('anon','public.contact_events','DELETE'), false),
  ('authenticated may NOT UPDATE',      has_table_privilege('authenticated','public.contact_events','UPDATE'), false),
  ('authenticated may NOT DELETE',      has_table_privilege('authenticated','public.contact_events','DELETE'), false)
) e(label, actual, expected)
-- Ordered on e.actual = e.expected, NOT on the `status` alias: an ORDER BY EXPRESSION
-- resolves its names against the FROM clause, not the select list, so `(status = 'OK')`
-- raises 42703. A bare `ORDER BY status` would work but sorts 'OK' into the middle of
-- the failure strings. False first — failures at the top.
ORDER BY (e.actual = e.expected), e.label;
ROLLBACK;


-- ═══ BLOCK V3 / 10 — A SIGNED-OUT GUEST CAN LOG A TAP — run alone ══════════
-- Expect: 1 row, both columns 'OK'.
--
-- THIS IS THE POINT OF THE WHOLE TABLE and the exact inverse of towing_companies,
-- where the equivalent block (V8b there) is EXPECTED TO ERROR. A roadside user is very
-- often not signed in; a FAIL here means the metric only ever counts logged-in users
-- and the "47 taps" figure is silently a fraction of the truth.
BEGIN;
SET LOCAL ROLE anon;
INSERT INTO public.contact_events (module, entity_id, action, region)
VALUES ('towing','aaaaaaaa-0000-0000-0000-000000000001','call','lefke');
SET LOCAL ROLE postgres;
SELECT
  CASE WHEN EXISTS (SELECT 1 FROM public.contact_events
                    WHERE entity_id='aaaaaaaa-0000-0000-0000-000000000001')
       THEN 'OK' ELSE 'FAIL ← guests cannot log a tap' END AS anon_can_insert,
  -- The server, not the client, stamped it. now() is transaction_timestamp() and this
  -- is one transaction, so an equality test is exact here.
  CASE WHEN (SELECT created_at FROM public.contact_events
             WHERE entity_id='aaaaaaaa-0000-0000-0000-000000000001') = now()
       THEN 'OK' ELSE 'FAIL ← created_at not server-stamped' END AS server_stamped;
ROLLBACK;


-- ═══ BLOCK V3b — A SIGNED-IN (incl. ANONYMOUS-SESSION) USER CAN TOO — run alone ══
-- Expect: 'OK'. The app calls signInAnonymously on launch, so this is the role MOST
-- taps actually run as. A no_anon veto copy-pasted from another table would fail here
-- and nowhere else.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated","is_anonymous":true}';
INSERT INTO public.contact_events (module, entity_id, action)
VALUES ('towing','aaaaaaaa-0000-0000-0000-000000000002','whatsapp');
SET LOCAL ROLE postgres;
SELECT CASE WHEN EXISTS (SELECT 1 FROM public.contact_events
                         WHERE entity_id='aaaaaaaa-0000-0000-0000-000000000002')
            THEN 'OK' ELSE 'FAIL ← anonymous session blocked from logging' END AS guest_session_can_insert;
ROLLBACK;


-- ═══ BLOCK V4 / 10 — FORGING created_at MUST FAIL — run alone ══════════════
-- EXPECTED TO ERROR: 42501 permission denied for table contact_events.
-- THE ERROR IS THE PASS. Success here means a client can backdate taps — i.e. can
-- move them into last month's invoice period.
--
-- NOTE THE WORDING: Postgres reports a COLUMN-grant refusal as "permission denied for
-- TABLE contact_events" and never names the column. Do not read that as "anon has no
-- INSERT at all" — V3 proves anon inserts the four permitted columns happily. The only
-- difference between that statement and this one is `created_at` in the column list.
--
-- ⚠ IGNORE THE HINT POSTGRES ATTACHES TO THIS ERROR. It will suggest something like
--   `GRANT INSERT ON public.contact_events TO anon`
-- and following it DESTROYS THE THING THIS BLOCK EXISTS TO PROVE. The HINT is Postgres
-- guessing at intent from the failed statement alone; it has no idea the refusal is the
-- designed behaviour. It is a message that looks authoritative and is not — the same
-- class of trap as a green check nobody has watched go red. The grant in the migration
-- is CORRECT AS WRITTEN. Do not widen it.
BEGIN;
SET LOCAL ROLE anon;
INSERT INTO public.contact_events (module, entity_id, action, created_at)
VALUES ('towing','aaaaaaaa-0000-0000-0000-000000000003','call','2020-01-01T00:00:00Z');
ROLLBACK;


-- ═══ BLOCK V4b — CHOOSING id MUST FAIL — run alone ═════════════════════════
-- EXPECTED TO ERROR: 42501 permission denied for table contact_events (the column is
-- not named — see the note in V4). THE ERROR IS THE PASS.
--
-- ⚠ IGNORE THE HINT POSTGRES ATTACHES TO THIS ERROR. It will suggest something like
--   `GRANT INSERT ON public.contact_events TO anon`
-- and following it DESTROYS THE THING THIS BLOCK EXISTS TO PROVE. The HINT is Postgres
-- guessing at intent from the failed statement alone; it has no idea the refusal is the
-- designed behaviour. It is a message that looks authoritative and is not — the same
-- class of trap as a green check nobody has watched go red. The grant in the migration
-- is CORRECT AS WRITTEN. Do not widen it.
BEGIN;
SET LOCAL ROLE anon;
INSERT INTO public.contact_events (id, module, entity_id, action)
VALUES ('dddddddd-0000-0000-0000-000000000001','towing','aaaaaaaa-0000-0000-0000-000000000004','call');
ROLLBACK;


-- ═══ BLOCK V5 / 10 — UNKNOWN module MUST FAIL — run alone ══════════════════
-- EXPECTED TO ERROR: contact_events_module_check. THE ERROR IS THE PASS.
BEGIN;
INSERT INTO public.contact_events (module, entity_id, action)
VALUES ('towingg','aaaaaaaa-0000-0000-0000-000000000005','call');
ROLLBACK;


-- ═══ BLOCK V5b — MIS-CASED action MUST FAIL — run alone ════════════════════
-- EXPECTED TO ERROR: contact_events_action_check. THE ERROR IS THE PASS.
--
-- 'whatsApp' is not a hypothetical. It is the exact typo this constraint exists for:
-- without it the row inserts happily and one firm's contacts split across two values
-- that never add up, so the number quoted to that firm is quietly too low forever.
BEGIN;
INSERT INTO public.contact_events (module, entity_id, action)
VALUES ('towing','aaaaaaaa-0000-0000-0000-000000000006','whatsApp');
ROLLBACK;


-- ═══ BLOCK V5c — UNKNOWN region MUST FAIL — run alone ══════════════════════
-- EXPECTED TO ERROR: contact_events_region_check. THE ERROR IS THE PASS.
-- 'girne' is the Turkish name for the region whose canonical key is 'kyrenia' — the
-- most likely wrong value anyone will ever pass, and it would land in no report.
BEGIN;
INSERT INTO public.contact_events (module, entity_id, action, region)
VALUES ('towing','aaaaaaaa-0000-0000-0000-000000000007','call','girne');
ROLLBACK;

-- ═══ BLOCK V5d — NULL region MUST SUCCEED — run alone ══════════════════════
-- Expect: 'OK'. The mirror of V5c, and not a formality: unknown location is a REAL and
-- common state on the towing screen (permission never granted, revoked, no fix, outside
-- the TRNC outline). If a NOT NULL ever creeps onto region, every tap from exactly
-- those users is dropped — and they are the users most likely to be stranded.
BEGIN;
SET LOCAL ROLE anon;
INSERT INTO public.contact_events (module, entity_id, action, region)
VALUES ('towing','aaaaaaaa-0000-0000-0000-000000000008','call', NULL);
SET LOCAL ROLE postgres;
SELECT CASE WHEN EXISTS (SELECT 1 FROM public.contact_events
                         WHERE entity_id='aaaaaaaa-0000-0000-0000-000000000008' AND region IS NULL)
            THEN 'OK' ELSE 'FAIL ← unknown-location taps are being dropped' END AS null_region_ok;
ROLLBACK;


-- ═══ BLOCK V6 / 10 — A GUEST CANNOT READ THE LOG — run alone ═══════════════
-- EXPECTED TO ERROR: 42501 permission denied for table contact_events.
-- THE ERROR IS THE PASS. Note this fails at the GRANT layer, before RLS is consulted —
-- which is the intent: two independent layers, either one sufficient.
--
-- ⚠ IGNORE THE HINT POSTGRES ATTACHES TO THIS ERROR. It will suggest something like
--   `GRANT SELECT ON public.contact_events TO anon`
-- and following it DESTROYS THE THING THIS BLOCK EXISTS TO PROVE — here, specifically,
-- it would hand the entire contact log to every signed-out visitor on the internet.
-- The HINT is Postgres guessing at intent from the failed statement alone; it has no
-- idea the refusal is the designed behaviour. It is a message that looks authoritative
-- and is not — the same class of trap as a green check nobody has watched go red. The grant in the migration
-- is CORRECT AS WRITTEN. Do not widen it.
BEGIN;
SET LOCAL ROLE anon;
SELECT count(*) FROM public.contact_events;
ROLLBACK;


-- ═══ BLOCK V6b — A SIGNED-IN NON-ADMIN READS ZERO ROWS — run alone ═════════
-- Expect: 'OK'. Here the grant EXISTS (so no error) and RLS is the only thing doing the
-- work — this block is the one that actually tests ce_select_admin.
BEGIN;
INSERT INTO public.contact_events (module, entity_id, action)
VALUES ('towing','aaaaaaaa-0000-0000-0000-000000000009','call');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}';
SELECT CASE WHEN (SELECT count(*) FROM public.contact_events) = 0
            THEN 'OK' ELSE 'FAIL ← contact log readable by a normal customer' END AS customer_blind;
ROLLBACK;


-- ═══ BLOCK V6c — AN ADMIN CAN READ — run alone ═════════════════════════════
-- Expect: admin_fixture_found = 'OK' AND admin_can_read = 'OK'.
--
-- Uses a REAL admin from profiles rather than a synthetic one: profiles.id is FK'd to
-- auth.users, so a fabricated admin cannot be inserted here without also fabricating an
-- auth user. If admin_fixture_found says NONE, this block proved nothing — the claims
-- were never set — and admin_can_read must be ignored, not read as a failure.
BEGIN;
INSERT INTO public.contact_events (module, entity_id, action)
VALUES ('towing','aaaaaaaa-0000-0000-0000-00000000000a','call');
SELECT set_config('verify.admin_found',
                  (SELECT (count(*) > 0)::text FROM public.profiles WHERE role='admin'), true);
SELECT set_config('request.jwt.claims',
                  (SELECT json_build_object('sub', id, 'role', 'authenticated')::text
                   FROM public.profiles WHERE role='admin' LIMIT 1), true);
SET LOCAL ROLE authenticated;
SELECT
  CASE WHEN current_setting('verify.admin_found', true) = 'true'
       THEN 'OK' ELSE 'NONE ← no admin profile; this block proved nothing' END AS admin_fixture_found,
  CASE WHEN EXISTS (SELECT 1 FROM public.contact_events
                    WHERE entity_id='aaaaaaaa-0000-0000-0000-00000000000a')
       THEN 'OK' ELSE 'FAIL ← admin cannot read the data they are meant to query' END AS admin_can_read;
ROLLBACK;


-- ═══ BLOCK V6d — THE VIEW DOES NOT LEAK — run alone ════════════════════════
-- Expect: 'OK'. THE MOST IMPORTANT READ CHECK IN THIS FILE.
--
-- A Postgres view runs as its OWNER unless security_invoker is set, and this one is
-- owned by postgres — which bypasses RLS. Without the option, granting the view to
-- `authenticated` hands every customer the entire contact log through the view even
-- though V6b proves the table itself is locked. V1 inspects the option statically;
-- this proves the behaviour, which is the half that would actually have leaked.
BEGIN;
INSERT INTO public.contact_events (module, entity_id, action)
VALUES ('towing','aaaaaaaa-0000-0000-0000-00000000000b','call');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}';
SELECT CASE WHEN (SELECT count(*) FROM public.contact_events_monthly) = 0
            THEN 'OK' ELSE 'FAIL ← view bypasses RLS; every customer can read the contact log' END
       AS customer_blind_through_view;
ROLLBACK;


-- ═══ BLOCK V7 / 10 — AN ADMIN CANNOT UPDATE — run alone ════════════════════
-- EXPECTED TO ERROR: 42501 permission denied for table contact_events (the grant layer
-- refuses first; ce_no_update is the second layer behind it). THE ERROR IS THE PASS.
--
-- Append-only is the point: a number sold to an advertiser must not be editable from
-- anything the app can reach. Purging spam is still possible — postgres and service_role
-- bypass RLS and are not covered by this block.
--
-- ⚠ IGNORE THE HINT POSTGRES ATTACHES TO THIS ERROR. It will suggest something like
--   `GRANT UPDATE ON public.contact_events TO authenticated`
-- and following it DESTROYS THE THING THIS BLOCK EXISTS TO PROVE — here, specifically,
-- it would end append-only and make the invoiced figure editable from the app.
-- The HINT is Postgres guessing at intent from the failed statement alone; it has no
-- idea the refusal is the designed behaviour. It is a message that looks authoritative
-- and is not — the same class of trap as a green check nobody has watched go red. The grant in the migration
-- is CORRECT AS WRITTEN. Do not widen it.
BEGIN;
INSERT INTO public.contact_events (module, entity_id, action)
VALUES ('towing','aaaaaaaa-0000-0000-0000-00000000000c','call');
SELECT set_config('request.jwt.claims',
                  (SELECT json_build_object('sub', id, 'role', 'authenticated')::text
                   FROM public.profiles WHERE role='admin' LIMIT 1), true);
SET LOCAL ROLE authenticated;
UPDATE public.contact_events SET action='whatsapp'
 WHERE entity_id='aaaaaaaa-0000-0000-0000-00000000000c';
ROLLBACK;


-- ═══ BLOCK V7b — AN ADMIN CANNOT DELETE — run alone ════════════════════════
-- EXPECTED TO ERROR: 42501. THE ERROR IS THE PASS.
--
-- ⚠ IGNORE THE HINT POSTGRES ATTACHES TO THIS ERROR. It will suggest something like
--   `GRANT DELETE ON public.contact_events TO authenticated`
-- and following it DESTROYS THE THING THIS BLOCK EXISTS TO PROVE — here, specifically,
-- it would end append-only. Purge spam as postgres, which bypasses RLS; never by
-- widening this grant.
-- The HINT is Postgres guessing at intent from the failed statement alone; it has no
-- idea the refusal is the designed behaviour. It is a message that looks authoritative
-- and is not — the same class of trap as a green check nobody has watched go red. The grant in the migration
-- is CORRECT AS WRITTEN. Do not widen it.
BEGIN;
INSERT INTO public.contact_events (module, entity_id, action)
VALUES ('towing','aaaaaaaa-0000-0000-0000-00000000000d','call');
SELECT set_config('request.jwt.claims',
                  (SELECT json_build_object('sub', id, 'role', 'authenticated')::text
                   FROM public.profiles WHERE role='admin' LIMIT 1), true);
SET LOCAL ROLE authenticated;
DELETE FROM public.contact_events WHERE entity_id='aaaaaaaa-0000-0000-0000-00000000000d';
ROLLBACK;


-- ═══ BLOCK V8 / 10 — MINUTE-BUCKETING ACTUALLY COLLAPSES — run alone ═══════
-- Expect: all six columns 'OK'.
--
-- ⚠ THE FIXTURES CARRY EXPLICIT TIMESTAMPS AND THAT IS NOT COSMETIC. now() in Postgres
-- is transaction_timestamp() — FIXED for the whole transaction. Seven rows inserted
-- here without explicit stamps would all share one created_at, so tap_minutes would be
-- 1 and the assertion would pass while proving nothing at all: it would be measuring
-- the transaction clock, not the bucketing. (Same trap as BLOCK V7 in
-- verify_towing_slice1.sql.) Explicit stamps are what make this test able to fail.
--
-- Fixture: 5 calls inside 10:00 local, 2 WhatsApps inside 10:01 local, one of them with
-- no region. 7 taps, 2 tap_minutes. If tap_minutes came back 7 the collapse is not
-- happening and every sellable figure is a raw, spammable count.
--
-- Stamps are written with an explicit +03 offset (Europe/Istanbul, no DST) so the block
-- asserts the same thing regardless of the SQL editor's session TimeZone.
BEGIN;
INSERT INTO public.contact_events (module, entity_id, action, region, created_at) VALUES
  ('towing','bbbbbbbb-0000-0000-0000-000000000001','call','lefke','2026-09-15 10:00:03+03'),
  ('towing','bbbbbbbb-0000-0000-0000-000000000001','call','lefke','2026-09-15 10:00:19+03'),
  ('towing','bbbbbbbb-0000-0000-0000-000000000001','call','lefke','2026-09-15 10:00:41+03'),
  ('towing','bbbbbbbb-0000-0000-0000-000000000001','call','morphou','2026-09-15 10:00:52+03'),
  ('towing','bbbbbbbb-0000-0000-0000-000000000001','call','lefke','2026-09-15 10:00:58+03'),
  ('towing','bbbbbbbb-0000-0000-0000-000000000001','whatsapp','lefke','2026-09-15 10:01:04+03'),
  ('towing','bbbbbbbb-0000-0000-0000-000000000001','whatsapp',NULL,'2026-09-15 10:01:30+03');
SELECT
  CASE WHEN taps = 7 THEN 'OK' ELSE 'FAIL ← raw count wrong: '||taps END AS taps_7,
  CASE WHEN tap_minutes = 2 THEN 'OK'
       ELSE 'FAIL ← expected 2, got '||tap_minutes||' — minute-bucketing not collapsing' END AS tap_minutes_2,
  CASE WHEN calls = 5 AND whatsapps = 2 AND calls_secondary = 0
       THEN 'OK' ELSE 'FAIL ← action breakdown wrong' END AS action_split,
  CASE WHEN month = '2026-09-01 00:00:00'::timestamp
       THEN 'OK' ELSE 'FAIL ← month bucket is '||month||', not local September' END AS month_local,
  -- The coverage-gap half: both regions present, in a stable order.
  CASE WHEN regions @> ARRAY['lefke','morphou'] AND cardinality(regions) = 2
       THEN 'OK' ELSE 'FAIL ← region rollup wrong: '||regions::text END AS regions_rolled_up,
  CASE WHEN taps_region_unknown = 1
       THEN 'OK' ELSE 'FAIL ← NULL-region taps miscounted' END AS unknown_region_counted
FROM public.contact_events_monthly
WHERE entity_id='bbbbbbbb-0000-0000-0000-000000000001';
ROLLBACK;


-- ═══ BLOCK V9 / 10 — SPAM DOES NOT MOVE THE SELLABLE NUMBER — run alone ════
-- Expect: both columns 'OK'.
--
-- This is the whole abuse answer, made concrete. Nothing at the RLS layer can stop a
-- flood — the anon key ships inside the app bundle, so a public INSERT endpoint reached
-- with a public key is spammable by construction. What CAN be guaranteed is that the
-- flood does not move the figure anyone is invoiced against.
--
-- 500 rows in one minute. taps = 500; tap_minutes = 1. The ratio (500:1 against a
-- plausible 3:1) is itself the detector — no threshold to tune, no false positives.
BEGIN;
INSERT INTO public.contact_events (module, entity_id, action, region, created_at)
SELECT 'towing','cccccccc-0000-0000-0000-000000000001','call','nicosia',
       '2026-09-15 11:00:00+03'::timestamptz + (g % 60) * interval '1 millisecond'
FROM generate_series(1, 500) g;
SELECT
  CASE WHEN taps = 500 THEN 'OK' ELSE 'FAIL ← raw rows not stored: '||taps END AS raw_taps_stored,
  CASE WHEN tap_minutes = 1
       THEN 'OK' ELSE 'FAIL ← 500 spam rows moved the sellable number by '||tap_minutes END AS sellable_unmoved
FROM public.contact_events_monthly
WHERE entity_id='cccccccc-0000-0000-0000-000000000001';
ROLLBACK;


-- ═══ BLOCK V10 / 10 — THE DEVICE PASS — CANNOT BE DONE IN SQL ══════════════
--
-- EVERYTHING ABOVE PROVES THE DATABASE IS CORRECT. NONE OF IT PROVES THE APP EVER
-- SENDS ANYTHING. Do this one; it is the only thing that can catch the failure below.
--
-- WHY IT CANNOT BE SKIPPED: supabase-js query builders are LAZY THENABLES. A bare
--   supabase.from('contact_events').insert({…})
-- with no .then() / .catch() NEVER SENDS A REQUEST. Combined with fire-and-forget —
-- which swallows errors on purpose, so that a hanging analytics write can never cost
-- someone their phone call — the symptom is: zero rows, no error anywhere, no crash,
-- and the natural conclusion "nobody taps call". The same silence hides a stale
-- PostgREST cache (PGRST205) and an accidental .select() chained onto the insert
-- (which needs SELECT privilege the client does not have). Rows in this table are the
-- only evidence that distinguishes "instrumented and quiet" from "never wired up".
--
-- ─── FIXTURE PRECONDITIONS — set these up before tapping ────────────────────
--
--   • Use a firm that has BOTH `whatsapp` AND `phone_secondary` non-null. All eight
--     surfaces only EXIST on such a firm — the card and the detail screen each hide
--     their WhatsApp and second-number buttons when the column is null, so on a
--     one-number firm the maximum possible score is 4 and a correct build looks
--     half-broken. Pick the firm first:
--
--       SELECT name, phone, whatsapp, phone_secondary FROM public.towing_companies
--        WHERE is_active AND whatsapp IS NOT NULL AND phone_secondary IS NOT NULL;
--
--   • PICK A REGION on the filter bar before tapping anything. This is not optional:
--     `region` is legitimately NULL when no filter is active, so without this the
--     NULL check below cannot tell "the prop was never threaded to the detail screen"
--     from "the user never chose a region" — and the whole point of that check is to
--     tell those two apart.
--
-- ─── AFTER the OTA, on the PLAY STORE BUILD ────────────────────────────────
-- (a preview APK has no production channel and never receives OTA), tap ALL EIGHT:
--
--   TowingScreen.js      card: call · WhatsApp · second number                    (3)
--   TowingDetailScreen.js  phone row · WhatsApp row · second-number row
--                          · sticky call button · sticky WhatsApp button          (5)
--
-- Note the detail screen is FIVE of the eight. Instrumenting only the card would
-- silently undercount everyone who opened a firm before dialling — probably the
-- majority — and the shortfall would look exactly like low demand.
--
-- Then, HERE, as postgres:
--
--   SELECT action, region, created_at
--     FROM public.contact_events
--    WHERE created_at > now() - interval '30 minutes'
--    ORDER BY created_at;
--
-- EXPECT 8 ROWS: call ×3, whatsapp ×3, call_secondary ×2.
--   card   → call, whatsapp, call_secondary
--   detail → call (phone row), whatsapp (row), call_secondary (row),
--            call (sticky), whatsapp (sticky)
-- Both call buttons on the detail screen log 'call', and both WhatsApp buttons log
-- 'whatsapp' — the surfaces are not distinguished, deliberately: the metric is intent
-- to contact a firm, not which pixel was pressed.
--
-- READING THE RESULT:
--   0 rows      → the client never fired. Lazy thenable, stale PostgREST cache, or a
--                 .select() chained onto the insert. NOT low demand.
--   3 rows      → only the card is instrumented.
--   5 rows      → only the detail screen is instrumented.
--   4 rows      → you tapped a firm with no whatsapp / no phone_secondary. Re-run
--                 against a firm that has both; this is a fixture problem, not a bug.
--   8 rows, region NULL on the 5 detail rows → the region prop was never passed to
--                 TowingDetailScreen, so every detail tap has lost its coverage-gap
--                 signal. (Only diagnosable because you picked a region first.)
