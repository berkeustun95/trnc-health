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

-- ─── 3. Seed: a small set of flagship Gişe Kıbrıs events ─────────────────────
-- Intentionally minimal — a low-volume manual placeholder pipeline, NOT a full
-- catalogue mirror (that's Slice 2's API). Update ticket_url with the exact
-- gisekibris.com event page URLs before demoing.

INSERT INTO events
  (organizer_name, title, description, category, start_date, end_date,
   location, latitude, longitude, ticket_url, price_from, price_text,
   images, status, source)
VALUES
  ('Cage Club',
   'Cage Club — Saturday Sessions',
   'Weekend nightlife at one of Girne''s best-known clubs. Resident DJs, late-night sets.',
   'nightlife',
   '2026-07-18 22:00:00+03', '2026-07-19 04:00:00+03',
   'Cage Club, Girne', 35.3401, 33.3192,
   'https://www.gisekibris.com/', NULL, 'From ₺500',
   '{}', 'approved', 'manual'),

  ('Bottega Club',
   'Bottega Open Air',
   'Open-air summer night at Bottega Club, Girne. House & dance line-up.',
   'nightlife',
   '2026-07-25 22:30:00+03', '2026-07-26 04:00:00+03',
   'Bottega Club, Girne', 35.3388, 33.3155,
   'https://www.gisekibris.com/', 600, NULL,
   '{}', 'approved', 'manual'),

  ('Gişe Kıbrıs',
   'Mağusa Culture & Arts Festival',
   'Annual culture and arts festival in Gazimağusa — live music, performances and stalls across the old town.',
   'festival',
   '2026-08-05 18:00:00+03', '2026-08-14 23:00:00+03',
   'Gazimağusa Old Town', 35.1246, 33.9430,
   'https://www.gisekibris.com/', NULL, 'Free entry',
   '{}', 'approved', 'manual'),

  ('Coco Bongo Island',
   'Coco Bongo Summer Concert',
   'Headline summer concert at Coco Bongo Island, Girne coast.',
   'concert',
   '2026-08-09 21:00:00+03', '2026-08-10 01:00:00+03',
   'Coco Bongo Island, Girne', 35.3436, 33.3021,
   'https://www.gisekibris.com/', 750, 'From ₺750',
   '{}', 'approved', 'manual');
