-- Remove the 4 flagship placeholder events seeded during the Slice 1 migration.
-- Run in the Supabase SQL Editor. Scoped to source='manual' + the exact titles,
-- so real events (and organizer-submitted ones) are untouched.

DELETE FROM events
WHERE source = 'manual'
  AND title IN (
    'Cage Club — Saturday Sessions',
    'Bottega Open Air',
    'Mağusa Culture & Arts Festival',
    'Coco Bongo Summer Concert'
  );
