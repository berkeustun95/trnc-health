-- ─── Girne duplicate — inbound reference counts BEFORE any retire ────────────
--
-- `Girne Devlet Hastanesi` and `Girne Dr. Akçiçek Devlet Hastanesi` are the same
-- hospital. This file COUNTS what points at each. It DELETES NOTHING and UPDATES
-- NOTHING. Run it, read it, keep the numbers — then decide, later, unhurried.
--
--   91338177-85d8-4f38-8b0f-2c395638d2d4   Girne Devlet Hastanesi      ← DUPLICATE
--   7a1c598d-bc43-4b50-9f42-f94adffffe5d   Girne Dr. Akçiçek D. H.     ← CANONICAL
--
-- Role = postgres. Every block is BEGIN … ROLLBACK.
--
-- ─── THE DUPLICATE IS ALREADY NEUTRALISED. THIS IS NOT URGENT. ──────────────
-- Migration 20260911 section 6b set the duplicate to `status='draft'`: it no longer
-- renders in the directory, is not searchable, and is not claimable. THE URGENT PROBLEM
-- (two Girne hospitals showing to users) IS SOLVED WITHOUT DESTROYING ANYTHING.
--
-- What remains — merging its inbound references into the canonical row — is IRREVERSIBLE
-- and gets its own reviewed slice. Read QUERY 5's note before you plan it: most inbound
-- FKs are ON DELETE CASCADE, so a delete does not orphan this row's reviews, questions
-- and claim history — it destroys them. That decision does not belong in a migration paste.
--
-- Keyed on the full uuids above, supplied from the live DB. An earlier draft matched on
-- name; that was worse — fragile against a trailing space or `ı` vs `i`, and a silent
-- zero-row result here reads exactly like "nothing points at it".
--
-- ⚠ THREE THINGS A NAIVE `pg_constraint` SWEEP WOULD MISS. This file covers all three:
--   1. content_reports is POLYMORPHIC (content_type='facility' + content_id) with NO
--      foreign key. It is invisible to any FK-based query. A moderation report on the
--      retired row would be orphaned silently — QUERY 3.
--   2. reviews carries reviews_customer_facility_unique (customer_id, facility_id). A
--      customer who reviewed BOTH rows makes a blind repoint fail on that constraint
--      halfway through — QUERY 4 counts those collisions before you hit them.
--   3. FAVOURITES ARE NOT IN THE DATABASE AT ALL. They live in AsyncStorage on each
--      device (`ada_favorites`, App.js:398/750). Nothing server-side can repoint them.
--      A user who favourited the retired row loses that favourite, silently — the list
--      is built by `facilities.filter(f => favorites.has(f.id))` (App.js:1281), so a
--      missing id just drops out. No crash, no error, no fix. This is a cost to NAME
--      and accept, not one to solve. It is also an argument for repointing rather than
--      deleting wherever there is a choice.


-- ═══ QUERY 1 — resolve the two rows and print their REAL ids — run alone ════
BEGIN;
SELECT id, name, type, sector, tier, status, is_public, provider_id, city, latitude, longitude, created_at
  FROM public.facilities
 WHERE id IN ('91338177-85d8-4f38-8b0f-2c395638d2d4','7a1c598d-bc43-4b50-9f42-f94adffffe5d')
 ORDER BY status, name;
-- Expect 2 rows: 91338177 status='draft', 7a1c598d status='active', both sector='public',
-- both tier='secondary'. If the duplicate is NOT draft, migration 6b did not run.
--
-- Also worth a glance: any OTHER Girne-named hospital nobody has mentioned.
SELECT id, name, status FROM public.facilities
 WHERE type = 'hospital' AND name ILIKE '%girne%' ORDER BY name;
ROLLBACK;


-- ═══ QUERY 2 — inbound FK counts, per row, per table — run alone ═══════════
-- Ten FK columns: the eight from capture_1 plus provider_credentials /
-- provider_documents (20260621_provider_verification).
--
-- READ THE RESULT LIKE THIS: any non-zero on the row you intend to RETIRE is work.
-- Non-zero on the row you intend to KEEP is fine and expected.
BEGIN;
WITH ids AS (
  SELECT * FROM (VALUES
    ('91338177-85d8-4f38-8b0f-2c395638d2d4'::uuid, 'DUPLICATE (draft)'),
    ('7a1c598d-bc43-4b50-9f42-f94adffffe5d'::uuid, 'CANONICAL Akçiçek')
  ) AS v(id, name)
)
SELECT i.name, t.tbl, t.n
FROM ids i
CROSS JOIN LATERAL (VALUES
  ('appointments',            (SELECT count(*) FROM public.appointments            WHERE facility_id = i.id)),
  ('reviews',                 (SELECT count(*) FROM public.reviews                 WHERE facility_id = i.id)),
  ('questions',               (SELECT count(*) FROM public.questions               WHERE facility_id = i.id)),
  ('claim_requests',          (SELECT count(*) FROM public.claim_requests          WHERE facility_id = i.id)),
  ('facility_change_requests',(SELECT count(*) FROM public.facility_change_requests WHERE facility_id = i.id)),
  ('duty_schedule',           (SELECT count(*) FROM public.duty_schedule           WHERE facility_id = i.id)),
  ('pharmacist_scores',       (SELECT count(*) FROM public.pharmacist_scores       WHERE facility_id = i.id)),
  ('quiz_submissions',        (SELECT count(*) FROM public.quiz_submissions        WHERE assigned_facility_id = i.id)),
  ('provider_credentials',    (SELECT count(*) FROM public.provider_credentials    WHERE facility_id = i.id)),
  ('provider_documents',      (SELECT count(*) FROM public.provider_documents      WHERE facility_id = i.id)),
  ('facilities.parent_facility_id', (SELECT count(*) FROM public.facilities        WHERE parent_facility_id = i.id))
) AS t(tbl, n)
ORDER BY i.name, (t.n = 0), t.tbl;
ROLLBACK;


-- ═══ QUERY 3 — content_reports: the POLYMORPHIC one, no FK — run alone ═════
-- content_reports.content_type='facility' + content_id, added by
-- 20260803_facility_report_moderation. NO foreign key exists, so QUERY 5's completeness
-- sweep will NOT list it and a dynamic FK walk would report zero.
--
-- A moderation report is not decoration: 3 distinct reporters auto-hide the facility.
-- Orphan those and the moderation history of a real hospital silently disappears.
BEGIN;
SELECT f.name, cr.status, count(*) AS reports
  FROM public.content_reports cr
  JOIN public.facilities f ON f.id = cr.content_id
 WHERE cr.content_type = 'facility'
   AND cr.content_id IN ('91338177-85d8-4f38-8b0f-2c395638d2d4','7a1c598d-bc43-4b50-9f42-f94adffffe5d')
 GROUP BY f.name, cr.status
 ORDER BY f.name;
-- Zero rows here is a PASS, not an empty result — it means nothing to repoint.
ROLLBACK;


-- ═══ QUERY 4 — reviews UNIQUE collision — run alone, run BEFORE repointing ══
-- reviews_customer_facility_unique is (customer_id, facility_id)
-- (20260701_security_fixes). A customer who reviewed BOTH Girne rows cannot have their
-- review repointed — the UPDATE fails on the unique index partway through, leaving a
-- half-migrated state inside whatever transaction you were running.
--
-- Expect 0. If it is not 0, those specific reviews need a decision (keep the newer?
-- keep the longer? merge?) BEFORE any bulk repoint runs.
BEGIN;
SELECT r.customer_id, count(DISTINCT r.facility_id) AS reviewed_both
  FROM public.reviews r
 WHERE r.facility_id IN ('91338177-85d8-4f38-8b0f-2c395638d2d4','7a1c598d-bc43-4b50-9f42-f94adffffe5d')
 GROUP BY r.customer_id
HAVING count(DISTINCT r.facility_id) > 1;
ROLLBACK;

-- Same shape, for questions — questions has no equivalent UNIQUE today, so this is
-- informational rather than blocking. Included because "no constraint today" is not
-- the same as "safe to double up".
BEGIN;
SELECT q.customer_id, count(*) AS questions_across_both
  FROM public.questions q
 WHERE q.facility_id IN ('91338177-85d8-4f38-8b0f-2c395638d2d4','7a1c598d-bc43-4b50-9f42-f94adffffe5d')
 GROUP BY q.customer_id
HAVING count(*) > 1;
ROLLBACK;


-- ═══ QUERY 5 — COMPLETENESS SWEEP — did the list above miss an FK? ═════════
-- QUERY 2 is hand-written from the repo. The repo is not the database — that is the
-- entire lesson of this exercise. This asks Postgres directly which tables carry a
-- foreign key to facilities, so a column added live and never committed still shows up.
--
-- Compare the output against QUERY 2's eleven entries. Anything listed here and absent
-- there is a reference nobody has counted yet.
BEGIN;
SELECT c.conrelid::regclass::text AS referencing_table,
       a.attname                  AS referencing_column,
       c.confdeltype              AS on_delete   -- a=NO ACTION c=CASCADE n=SET NULL r=RESTRICT
  FROM pg_constraint c
  JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
 WHERE c.contype = 'f'
   AND c.confrelid = 'public.facilities'::regclass
 ORDER BY 1, 2;
ROLLBACK;

-- ⚠ NOTE THE on_delete COLUMN. Most of these are 'c' (CASCADE). That means DELETING the
-- retired row does not orphan those rows — IT DESTROYS THEM. Reviews, questions,
-- claim_requests, facility_change_requests and both provider_* tables all cascade.
-- So the choice is not "repoint or orphan", it is "repoint or DELETE THE HISTORY".
-- appointments and quiz_submissions are NO ACTION and will BLOCK the delete instead —
-- which is the safer failure, and the one that will actually tell you something is there.


-- ═══ NEXT STEP — A SEPARATE SLICE, NOT A FOLLOW-UP TO THIS PASTE ═══════════
-- Nothing above changes anything, and nothing needs to happen today: the duplicate is
-- already draft, so no user sees it and no provider can claim it. When the merge is
-- actually scheduled, it is a separate reviewed script that, in ONE transaction:
--   1. repoints every non-zero reference from the retired id to the canonical id
--      (handling any QUERY 4 collisions by the decision made there),
--   2. re-checks that all counts on the retired id are zero,
--   3. only then deletes.
-- Do not fold that into this file. A file that counts and a file that destroys should
-- never be the same paste.
