-- ─── Events — status NOT NULL ────────────────────────────────────────────────
--
-- Closes the hole that hid a 69-row production outage.
--
-- WHAT HAPPENED: the Gişe Kıbrıs import sent one PostgREST bulk upsert containing
-- both inserts (which carry status='approved') and updates (which omit status by
-- design, so a deliberately hidden row is never re-approved). PostgREST derives ONE
-- column list from the union of keys across the array and writes NULL wherever an
-- object omits a key, so `status` entered the column list and all 69 updated rows
-- got status=NULL through DO UPDATE SET status = EXCLUDED.status. The read policy is
-- `status = 'approved'`, so those 69 events vanished from the app while still looking
-- present in every admin query that does not filter on status.
--
-- WHY NOTHING CAUGHT IT — every existing defence has a hole it fit through:
--   • DEFAULT 'draft'  applies only to an OMITTED value. The upsert wrote an
--                      EXPLICIT NULL, so the default never fired.
--   • CHECK (status IN (…))  evaluates to UNKNOWN on NULL, and a CHECK PASSES on
--                      UNKNOWN. This constraint has never rejected a NULL status.
--   • ev_guard_write   returns early when auth.uid() IS NULL, so service_role — the
--                      only role that can write these rows — never reaches it.
-- NOT NULL is the only one of the four that rejects an explicit NULL from
-- service_role. It would have turned a silent outage into a failed import.
--
-- The script-side fixes shipped separately (two homogeneous upserts, a ragged-payload
-- guard that runs in --dry, and a post-write status invariant). This migration is the
-- database-side half: the app must not be the only thing standing between a bad write
-- and 69 invisible events.
--
-- DEFAULT STAYS 'draft'. It is NOT changed to 'pending': ev_guard_write raises
-- 'events: new rows must be draft' for any non-admin INSERT whose status is not
-- 'draft', so a default of 'pending' would reject organizer submissions that omit the
-- column. Step 2 ASSERTS the default is still 'draft' rather than setting it, so this
-- migration cannot silently change insert behaviour.
--
-- SAFE TO APPLY — verified before writing this file:
--   • Zero NULL status rows table-wide (not just source='gisekibris').
--   • Every insert path sets status explicitly:
--       OrganizerScreen.js:251        .insert({ …fields, status: 'draft' })
--       import-gisekibris-events.mjs  insert batch carries status: 'approved'
--     and every update path sets an explicit valid value (AdminScreen approve/reject,
--     OrganizerScreen draft/pending). Nothing relies on omission.
--
-- ADDITIVE + idempotent: step 1 matches zero rows on a second pass, SET NOT NULL is a
-- no-op when already set, and the assertions pass.
--
-- EXECUTION: SET ROLE postgres (ALTER TABLE events needs the table owner). The SQL
-- editor's Role selector must be postgres so the switch is permitted.
--
-- RUN THE PRE-FLIGHT PROBES FIRST — see the block at the foot of this file.
-- P1 must return zero rows, or step 3 will fail.

SET ROLE postgres;
BEGIN;

-- 1. Repair, kept in the repo so the incident is recorded even though it was already
--    applied by hand on 19 Aug 2026. Every one of those 69 rows was status='approved'
--    before the import (pre-flight recorded 69/69), so this restores the exact prior
--    state. Scoped to IS NULL, so a row that is legitimately draft/pending/rejected is
--    never touched. Matches nothing on a second run.
UPDATE public.events SET status = 'approved'
WHERE source = 'gisekibris' AND status IS NULL;

-- 2. Assert the default is still 'draft' before adding NOT NULL. If someone has
--    changed it, stop: NOT NULL plus the wrong default is how you break the organizer
--    submit flow, and it would fail at ev_guard_write rather than here.
DO $$
DECLARE
  d text;
BEGIN
  SELECT column_default INTO d
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'status';
  IF d IS NULL OR d NOT LIKE '%draft%' THEN
    RAISE EXCEPTION
      'events.status default is % — expected ''draft''::text. ev_guard_write rejects '
      'any non-admin INSERT whose status is not draft, so adding NOT NULL against a '
      'different default would break organizer submissions. Fix the default first.', d;
  END IF;
END $$;

-- 3. The actual hardening. Fails loudly if any NULL survives step 1 — which would mean
--    a NULL outside source='gisekibris' that this migration is not entitled to guess a
--    value for.
ALTER TABLE public.events ALTER COLUMN status SET NOT NULL;

COMMIT;
RESET ROLE;

-- No ADD COLUMN and no new column, so no NOTIFY pgrst is required — PostgREST's cache
-- holds column names, which are unchanged. Nullability is enforced by Postgres on
-- write regardless of what the REST layer has cached.

-- ─── Who can do what after this migration ────────────────────────────────────
-- Unchanged. This migration adds no policy, alters no RLS, and touches no trigger.
-- events keeps its existing five policies (read approved events / organizer manage own
-- events / admin manage all events / the three no_anon_* RESTRICTIVE guards) and the
-- ev_guard_write trigger.
--   • Customers (and guest/anonymous sessions) still read only status='approved' rows.
--   • Organizers still write only their own rows, still insert as 'draft', and still
--     cannot self-approve.
--   • Admins still set any of the four statuses.
--   • What changed for NOBODY is permission; what changed is that ANY writer —
--     including service_role, which bypasses RLS and the trigger — can no longer
--     write a NULL status. A script that tries now gets an error instead of silently
--     hiding rows from every user.

-- ─── Pre-flight probes (RUN BEFORE APPLYING) ─────────────────────────────────
--   -- P1. MUST return zero rows. Table-wide, NOT scoped to one source — SET NOT NULL
--   --     fails if a single row anywhere is NULL.
--   SELECT id, source, status, organizer_id, title FROM public.events
--   WHERE status IS NULL;
--
--   -- P2. Current nullability + default. Expect is_nullable=YES (before) and
--   --     column_default='draft'::text.
--   SELECT column_name, is_nullable, column_default FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='events' AND column_name='status';
--
--   -- P3. Status census, so the after-picture is comparable.
--   SELECT status, count(*) FROM public.events GROUP BY 1 ORDER BY 2 DESC;
--
--   -- P4. Confirm the CHECK is the reason a NULL was ever accepted: this returns
--   --     NULL (not true/false), and a CHECK passes on anything that is not false.
--   SELECT (NULL::text IN ('draft','pending','approved','rejected')) AS check_verdict;

-- ─── Verification (run after applying) ───────────────────────────────────────
--   -- Nullability flipped, default untouched:
--   SELECT column_name, is_nullable, column_default FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='events' AND column_name='status';
--   -- expect is_nullable = NO,  column_default = 'draft'::text
--
--   -- No row was harmed:
--   SELECT status, count(*) FROM public.events GROUP BY 1 ORDER BY 2 DESC;
--   -- expect the same census as P3
--
--   -- The guard actually bites. This MUST ERROR (23502 not_null_violation); the
--   --   ROLLBACK means nothing is kept either way. It must touch a REAL row — a
--   --   `WHERE false` variant reports UPDATE 0 and proves nothing.
--   BEGIN; UPDATE public.events SET status = NULL
--     WHERE id = (SELECT id FROM public.events LIMIT 1); ROLLBACK;
--
--   -- And an omitted status still lands as 'draft' rather than failing, so the
--   --   organizer insert path is intact (admin/postgres bypasses ev_guard_write,
--   --   which is why this can be tested here at all). The three columns supplied are
--   --   the only remaining NOT NULL ones without a default; organizer_id was made
--   --   nullable for admin/import rows, so omitting it here is correct, not a gap.
--   BEGIN;
--   INSERT INTO public.events (title, organizer_name, start_date)
--     VALUES ('__notnull probe__', '__probe__', now())
--     RETURNING id, status;   -- expect status = 'draft'
--   ROLLBACK;

-- ─── Rollback ────────────────────────────────────────────────────────────────
--   Step 3 only. Step 1 is a data repair and is not reversible — the 69 rows'
--   pre-repair value was NULL, which is the bug, not a state worth restoring.
--   SET ROLE postgres;
--   ALTER TABLE public.events ALTER COLUMN status DROP NOT NULL;
--   RESET ROLE;
