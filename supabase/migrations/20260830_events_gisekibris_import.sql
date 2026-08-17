-- ─── Events — Gişe Kıbrıs import, Slice 1 (schema) ───────────────────────────
--
-- Prepares `events` for the idempotent Gişe Kıbrıs catalogue import
-- (supabase/seed/gisekibris-events-clean.json — 69 events, 19 venues,
-- 19 Aug 2026 → 17 Oct 2026). No new table; five additive changes plus one
-- data fix.
--
-- WHAT THIS DOES
--   1. events.source_image_url  — the partner's original Firebase URL, kept so a
--      mirrored image can always be re-fetched.
--   2. events.description_i18n  — ADDITIVE bilingual descriptions. The existing
--      `description text` column STAYS and keeps being written; OrganizerScreen's
--      live write path is untouched. Dropping the text column is a later slice.
--      Naming matches the existing places.description_i18n convention.
--   3. Widens events_description_check 500 → 2500. The import mirrors
--      description_tr into the legacy text column and the longest row is 2039.
--   4. Adds events_description_i18n_check — shape + size guard on the jsonb.
--   5. Replaces the partial unique INDEX on external_id with a real UNIQUE
--      CONSTRAINT, so ON CONFLICT (external_id) can infer it.
--   6. Nulls out any legacy seed row whose ticket_url points at the gisekibris.com
--      homepage, so the Buy Ticket button is consistently absent when there is no
--      real per-event ticket link.
--
-- WHY THE UNIQUE SWAP (step 5): Postgres only infers a PARTIAL unique index as an
-- ON CONFLICT arbiter when the clause repeats the index predicate. supabase-js
-- emits `ON CONFLICT (external_id)` with no WHERE, so the upsert would fail with
-- "no unique or exclusion constraint matching the ON CONFLICT specification".
-- A plain UNIQUE constraint permits unlimited NULLs in Postgres, so manual and
-- organizer-submitted events (external_id IS NULL) are completely unaffected.
--
-- WHY NO IMMUTABLE HELPER FUNCTION IN THE CHECK (step 4): two real footguns —
-- pg_dump/restore does not guarantee the function is created before the
-- constraint that calls it, and if the function body is ever changed, existing
-- rows are NOT revalidated, so the constraint silently stops meaning what it
-- enforces. The inline expression below is subquery-free and fully IMMUTABLE.
--
-- search_content needs NO change: its events arm reads only e.title and
-- e.location — `description` does not appear anywhere in the live definition
-- (20260820_search_content_gate_facilities.sql). Event descriptions have never
-- been searchable, so moving them to jsonb breaks nothing.
--
-- ADDITIVE + idempotent (ADD COLUMN IF NOT EXISTS; every constraint is
-- drop-then-create; the UPDATE matches nothing on a second pass). Every existing
-- row keeps source_image_url and description_i18n NULL.
--
-- EXECUTION: SET ROLE postgres (ALTER TABLE events needs the table owner; the SQL
-- editor's default role is not it). The editor's Role selector must be postgres so
-- the switch is permitted; RESET ROLE restores the session at the end.
--
-- RUN THE PRE-FLIGHT PROBES FIRST — see the block at the foot of this file.
-- P3 in particular must return zero rows or step 5 will fail.

SET ROLE postgres;
BEGIN;

-- 1. The partner's original image URL (Firebase Storage, carries a revocable
--    ?token=). Kept on the row so a mirrored image can be re-fetched.
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS source_image_url text;

-- 2. Bilingual descriptions, ADDITIVE — `description text` is not touched.
--    Import writes {"tr": …, "en": …}; for rows where the partner's English is
--    byte-identical to the Turkish (29 of 60 real descriptions) only the "tr" key
--    is written, so the untranslated gap stays visible rather than being papered
--    over with Turkish text sitting under an "en" key.
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS description_i18n jsonb;

-- 3. Widen the legacy text CHECK. 500 was sized for organizer-submitted UGC; the
--    curated partner rows run to 2039 characters.
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_description_check;
ALTER TABLE public.events ADD CONSTRAINT events_description_check
  CHECK (char_length(description) <= 2500);

-- 4. Shape + size guard on the jsonb.
--    • jsonb_typeof pins it to an object (not an array or a bare scalar).
--    • `<> '{}'` rejects an empty object: with no keys, both char_length(NULL)
--      comparisons evaluate to UNKNOWN and the whole expression would pass.
--    • The total length cap bounds ANY key, including one nobody planned for.
--    • The per-key caps hold parity with the text column above.
--    char_length(NULL) is UNKNOWN and a CHECK passes on UNKNOWN, so a row carrying
--    only "tr" (no "en") is accepted — exactly the intent.
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_description_i18n_check;
ALTER TABLE public.events ADD CONSTRAINT events_description_i18n_check
  CHECK (
    description_i18n IS NULL
    OR (
      jsonb_typeof(description_i18n) = 'object'
      AND description_i18n <> '{}'::jsonb
      -- Total cap sized for tr+en only. Raise before adding further locales
      -- (the app ships 9; 9 × 2500 would need ~22500).
      AND length(description_i18n::text)       <= 6000
      AND char_length(description_i18n->>'tr') <= 2500
      AND char_length(description_i18n->>'en') <= 2500
    )
  );

-- 5. Partial unique index → real UNIQUE constraint (see header for why).
--    The DROP CONSTRAINT line is belt-and-braces: it makes the migration idempotent
--    whether the object exists as a bare index (how 20260704 created it) or as a
--    constraint-backed one.
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_external_id_key;
DROP INDEX IF EXISTS public.events_external_id_key;
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_external_id_unique;
ALTER TABLE public.events ADD CONSTRAINT events_external_id_unique UNIQUE (external_id);

-- 6. No Buy Ticket button may point at a homepage. The app-side guard already
--    hides the button when ticket_url IS NULL (EventsScreen.js:315); this makes the
--    data match. Scoped to source='manual' so partner and organizer rows are never
--    touched. Idempotent, and correct whether or not events_delete_seed.sql was run.
UPDATE public.events SET ticket_url = NULL
WHERE source = 'manual' AND ticket_url ILIKE '%gisekibris.com%';

COMMIT;
RESET ROLE;

-- PostgREST schema-cache refresh: makes the new columns queryable through the REST
-- API immediately. Without it a stale cache raises 42703 "column ... does not exist"
-- via PostgREST even though the column exists in Postgres. MANDATORY tail on every
-- ADD COLUMN migration — see supabase/verify_schema.sql and CLAUDE.md.
NOTIFY pgrst, 'reload schema';

-- ─── Who can do what after this migration ────────────────────────────────────
-- Unchanged. This migration adds no policy and alters no RLS. events keeps its
-- existing five policies (read approved events / organizer manage own events /
-- admin manage all events / the three no_anon_* RESTRICTIVE guards) and the
-- ev_guard_write trigger.
--   • Customers still read only status='approved' rows.
--   • Organizers still write only their own rows and still cannot self-approve.
--   • The import runs as service_role, which bypasses RLS, and ev_guard_write
--     returns early when auth.uid() IS NULL — so the two new columns and the
--     status='approved' insert are reachable from the script and from nobody else.
--   • The widened description limit applies to organizer submissions too: an
--     organizer can now submit up to 2500 characters instead of 500. That is the
--     intended consequence, not a side effect.

-- ─── Pre-flight probes (RUN BEFORE APPLYING) ─────────────────────────────────
--   -- P1. Do the columns actually exist? (the `facilities.area` class of drift)
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='events' ORDER BY ordinal_position;
--
--   -- P2. Is the partial index really live? It was never registered in
--   --     verify_schema.sql, so the repo cannot answer this.
--   SELECT indexname, indexdef FROM pg_indexes
--   WHERE schemaname='public' AND tablename='events';
--
--   -- P3. Duplicate external_id check. MUST return zero rows — step 5 fails otherwise.
--   SELECT external_id, count(*) FROM public.events
--   WHERE external_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
--
--   -- P4. What step 6 will hit.
--   SELECT id, title, source, ticket_url FROM public.events
--   WHERE ticket_url ILIKE '%gisekibris%';
--
--   -- P5. Category census — report only, no fix in this slice. NULL-category rows
--   --     are reachable under the "All" chip only and render with no badge
--   --     (EventsScreen.js:162). 'concert'/'festival' rows are NOT stranded: the
--   --     Music chip matches them via LEGACY_MUSIC (EventsScreen.js:39).
--   SELECT category, source, status, count(*) FROM public.events
--   GROUP BY 1,2,3 ORDER BY 4 DESC;

-- ─── Verification (run after applying) ───────────────────────────────────────
--   -- Both columns exist, all existing rows NULL:
--   SELECT count(*) FILTER (WHERE source_image_url IS NULL) AS null_src_img,
--          count(*) FILTER (WHERE description_i18n IS NULL) AS null_desc_i18n,
--          count(*) AS total
--   FROM public.events;
--
--   -- Constraints have the intended bodies (name is unchanged on the widened one,
--   -- so an existence check cannot see the 500 → 2500 change):
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid='public.events'::regclass AND contype='c' ORDER BY conname;
--   -- expect events_description_check ... <= 2500
--   --        events_description_i18n_check ... object / <> '{}' / 6000 / 2500 / 2500
--
--   -- UNIQUE swapped, partial index gone:
--   SELECT indexname, indexdef FROM pg_indexes
--   WHERE schemaname='public' AND tablename='events' AND indexdef ILIKE '%external_id%';
--   -- expect ONE row: events_external_id_unique, UNIQUE, with NO WHERE clause.
--
--   -- The jsonb guard actually bites. Each block must ERROR; the ROLLBACK means
--   -- nothing is kept either way. A CHECK is only evaluated on rows that are
--   -- actually written, so these MUST touch a real row — a `WHERE false` variant
--   -- reports UPDATE 0 and proves nothing.
--   BEGIN; UPDATE public.events SET description_i18n = '[]'::jsonb
--     WHERE id = (SELECT id FROM public.events LIMIT 1); ROLLBACK;   -- not an object
--   BEGIN; UPDATE public.events SET description_i18n = '{}'::jsonb
--     WHERE id = (SELECT id FROM public.events LIMIT 1); ROLLBACK;   -- empty object
--   BEGIN; UPDATE public.events SET description_i18n = jsonb_build_object('tr', repeat('x', 2501))
--     WHERE id = (SELECT id FROM public.events LIMIT 1); ROLLBACK;   -- per-key cap
--   -- And the accepted shape (must SUCCEED, then roll back):
--   BEGIN; UPDATE public.events SET description_i18n = jsonb_build_object('tr', 'test')
--     WHERE id = (SELECT id FROM public.events LIMIT 1); ROLLBACK;   -- tr-only is valid
--
--   -- Step 6 landed:
--   SELECT count(*) FROM public.events WHERE ticket_url ILIKE '%gisekibris.com%';
--   -- expect 0

-- ─── Rollback ────────────────────────────────────────────────────────────────
--   -- NOTE: step 6 is NOT reversible — the original homepage ticket_urls are gone.
--   -- They were placeholders pointing at gisekibris.com/ with no per-event path.
--   SET ROLE postgres;
--   BEGIN;
--   ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_description_i18n_check;
--   ALTER TABLE public.events DROP COLUMN IF EXISTS description_i18n;
--   ALTER TABLE public.events DROP COLUMN IF EXISTS source_image_url;
--   ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_description_check;
--   ALTER TABLE public.events ADD CONSTRAINT events_description_check
--     CHECK (char_length(description) <= 500);   -- fails if a >500 row was imported
--   ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_external_id_unique;
--   CREATE UNIQUE INDEX IF NOT EXISTS events_external_id_key
--     ON public.events (external_id) WHERE external_id IS NOT NULL;
--   COMMIT;
--   RESET ROLE;
--   NOTIFY pgrst, 'reload schema';
