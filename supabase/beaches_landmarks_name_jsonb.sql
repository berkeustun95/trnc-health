-- ─── Name field: TEXT → JSONB ─────────────────────────────────────────────────
-- Run in Supabase SQL editor.
-- Same pattern as beaches_landmarks_desc_jsonb.sql.
-- Converts name from TEXT to JSONB keyed by language code: { "en": "...", "tr": "..." }
-- Display: name[userLang] ?? name.en
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE beaches
  ALTER COLUMN name TYPE JSONB
  USING jsonb_build_object('en', name);

ALTER TABLE landmarks
  ALTER COLUMN name TYPE JSONB
  USING jsonb_build_object('en', name);


-- ─── Turkish names — beaches ──────────────────────────────────────────────────

UPDATE beaches SET name = name || '{"tr": "Escape Plajı"}'::jsonb
  WHERE name->>'en' = 'Escape Beach';

UPDATE beaches SET name = name || '{"tr": "Alagadı Kaplumbağa Plajı"}'::jsonb
  WHERE name->>'en' = 'Alagadi Turtle Beach';

UPDATE beaches SET name = name || '{"tr": "Altın Kumsal"}'::jsonb
  WHERE name->>'en' = 'Golden Beach (Altın Kumsal)';

UPDATE beaches SET name = name || '{"tr": "Glapsides Plajı"}'::jsonb
  WHERE name->>'en' = 'Glapsides Beach';


-- ─── Turkish names — landmarks ────────────────────────────────────────────────

UPDATE landmarks SET name = name || '{"tr": "Girne Kalesi"}'::jsonb
  WHERE name->>'en' = 'Kyrenia Castle';

UPDATE landmarks SET name = name || '{"tr": "Aziz Hilarion Kalesi"}'::jsonb
  WHERE name->>'en' = 'St. Hilarion Castle';

UPDATE landmarks SET name = name || '{"tr": "Salamis Antik Kenti"}'::jsonb
  WHERE name->>'en' = 'Salamis Ancient City';

UPDATE landmarks SET name = name || '{"tr": "Bellapais Manastırı"}'::jsonb
  WHERE name->>'en' = 'Bellapais Abbey';

UPDATE landmarks SET name = name || '{"tr": "Apostolos Andreas Manastırı"}'::jsonb
  WHERE name->>'en' = 'Apostolos Andreas Monastery';

UPDATE landmarks SET name = name || '{"tr": "Selimiye Camii"}'::jsonb
  WHERE name->>'en' = 'Selimiye Mosque';

UPDATE landmarks SET name = name || '{"tr": "Büyük Han"}'::jsonb
  WHERE name->>'en' = 'Büyük Han (Great Inn)';

UPDATE landmarks SET name = name || '{"tr": "Girne Kapısı"}'::jsonb
  WHERE name->>'en' = 'Kyrenia Gate';
