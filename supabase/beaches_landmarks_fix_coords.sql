-- ─── Coordinate corrections ──────────────────────────────────────────────────
-- All coordinates verified from latitude.to, Wikipedia, getamap.net, evendo.com
-- Run in Supabase SQL editor.
-- name column is now JSONB — use ->>'en' to match by English name.
-- ─────────────────────────────────────────────────────────────────────────────

-- Beaches
UPDATE beaches SET latitude = 35.3471, longitude = 33.2343 WHERE name->>'en' = 'Escape Beach';
UPDATE beaches SET latitude = 35.3302, longitude = 33.4972 WHERE name->>'en' = 'Alagadi Turtle Beach';
UPDATE beaches SET latitude = 35.6412, longitude = 34.5423 WHERE name->>'en' = 'Golden Beach (Altın Kumsal)';
UPDATE beaches SET latitude = 35.1541, longitude = 33.9129 WHERE name->>'en' = 'Glapsides Beach';

-- Landmarks (original seed)
UPDATE landmarks SET latitude = 35.3382, longitude = 33.3200 WHERE name->>'en' = 'Kyrenia Castle';
UPDATE landmarks SET latitude = 35.3167, longitude = 33.2833 WHERE name->>'en' = 'St. Hilarion Castle';
UPDATE landmarks SET latitude = 35.1833, longitude = 33.9000 WHERE name->>'en' = 'Salamis Ancient City';
UPDATE landmarks SET latitude = 35.3083, longitude = 33.3583 WHERE name->>'en' = 'Bellapais Abbey';
UPDATE landmarks SET latitude = 35.6557, longitude = 34.5695 WHERE name->>'en' = 'Apostolos Andreas Monastery';

-- Landmarks (Nicosia seed)
UPDATE landmarks SET latitude = 35.1765, longitude = 33.3645 WHERE name->>'en' = 'Selimiye Mosque';
UPDATE landmarks SET latitude = 35.1763, longitude = 33.3625 WHERE name->>'en' = 'Büyük Han (Great Inn)';
UPDATE landmarks SET latitude = 35.1818, longitude = 33.3618 WHERE name->>'en' = 'Kyrenia Gate';
