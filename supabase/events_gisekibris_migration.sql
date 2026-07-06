-- ─── Events: Gişe Kıbrıs upgrade (Slice 1) ───────────────────────────────────
-- Extends the existing organizer-submission `events` table with the fields
-- needed for admin-curated Gişe Kıbrıs ticketing events. No new table.
-- Run this in the Supabase SQL Editor.

-- 1. New columns (all additive, forward-compatible with Slice 2 API sync)
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS category    text DEFAULT 'other'
    CHECK (category IN ('concert', 'festival', 'nightlife', 'other')),
  ADD COLUMN IF NOT EXISTS ticket_url  text,
  ADD COLUMN IF NOT EXISTS latitude    numeric,
  ADD COLUMN IF NOT EXISTS longitude   numeric,
  ADD COLUMN IF NOT EXISTS price_from  numeric,
  ADD COLUMN IF NOT EXISTS price_text  text,
  ADD COLUMN IF NOT EXISTS source      text DEFAULT 'manual',   -- Slice 2: 'gisekibris_api'
  ADD COLUMN IF NOT EXISTS external_id text,                    -- Slice 2: API upsert dedup
  ADD COLUMN IF NOT EXISTS updated_at  timestamptz DEFAULT now();

-- external_id must be unique when present (API dedup), but nulls are allowed for
-- manual/organizer events. A partial unique index does exactly that.
CREATE UNIQUE INDEX IF NOT EXISTS events_external_id_key
  ON events (external_id) WHERE external_id IS NOT NULL;

-- 2. Admin-curated (and future API) events have no organizer user, so relax the
--    NOT NULL on organizer_id. organizer_name stays NOT NULL (holds the venue /
--    promoter label). RLS is unaffected: with organizer_id NULL the
--    "organizer manage own events" policy never matches, so only admins can
--    write these rows.
ALTER TABLE events ALTER COLUMN organizer_id DROP NOT NULL;

-- Note: the flagship placeholder events originally seeded here were removed.
-- Add real admin-curated Gişe Kıbrıs events directly in the SQL editor when ready.
