-- ─── Beaches & Landmarks Migration ──────────────────────────────────────────
-- Run in Supabase SQL editor.
-- Adds beaches and landmarks tables: map-first discovery directories for TRNC.
--
-- ⚠️  BEFORE RUNNING THIS SQL:
--     1. Go to Supabase Dashboard → Storage → New bucket
--     2. Name: place-photos   Visibility: Public
--     3. Add a Storage policy: allow public SELECT on all objects in this bucket
--     (Dashboard: Storage → place-photos → Policies → "Give users access to
--     all files in a public bucket" template)
--     Only then run this SQL.
--
-- Districts: 7 (nicosia, kyrenia, famagusta, morphou, iskele, lefke, karpaz)
-- NOTE: karpaz is new to this module. Home Services uses 6 (no karpaz).
--       Accommodation uses 5 (no lefke, no karpaz). Intentional — see architecture.md.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── beaches ─────────────────────────────────────────────────────────────────

CREATE TABLE beaches (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_by     UUID REFERENCES auth.users(id),  -- NULL for admin-seeded
  name             TEXT NOT NULL,
  district         TEXT NOT NULL
                     CHECK (district IN ('nicosia', 'kyrenia', 'famagusta', 'morphou', 'iskele', 'lefke', 'karpaz')),
  latitude         DOUBLE PRECISION NOT NULL,
  longitude        DOUBLE PRECISION NOT NULL,
  description      TEXT,
  photo_urls       TEXT[] NOT NULL DEFAULT '{}',
  blue_flag        BOOLEAN NOT NULL DEFAULT false,
  access_type      TEXT NOT NULL DEFAULT 'public'
                     CHECK (access_type IN ('public', 'private')),
  facilities       TEXT[] NOT NULL DEFAULT '{}',
  -- valid values: parking, toilets, sunbeds, food_bar, lifeguard, accessible
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'active', 'rejected')),
  rejection_reason TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- ─── landmarks ───────────────────────────────────────────────────────────────

CREATE TABLE landmarks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_by     UUID REFERENCES auth.users(id),  -- NULL for admin-seeded
  name             TEXT NOT NULL,
  district         TEXT NOT NULL
                     CHECK (district IN ('nicosia', 'kyrenia', 'famagusta', 'morphou', 'iskele', 'lefke', 'karpaz')),
  latitude         DOUBLE PRECISION NOT NULL,
  longitude        DOUBLE PRECISION NOT NULL,
  description      TEXT,
  photo_urls       TEXT[] NOT NULL DEFAULT '{}',
  category         TEXT NOT NULL
                     CHECK (category IN ('castle_fortress', 'ancient_ruins', 'museum', 'religious_site', 'monument', 'nature_scenic')),
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'active', 'rejected')),
  rejection_reason TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);


-- ─── Row Level Security — beaches ────────────────────────────────────────────

ALTER TABLE beaches ENABLE ROW LEVEL SECURITY;

-- Public sees only active places; submitter always sees their own; admin sees all.
CREATE POLICY "beaches_select" ON beaches FOR SELECT
  USING (
    status = 'active'
    OR submitted_by = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Any authenticated user can submit a new place (as themselves).
CREATE POLICY "beaches_insert" ON beaches FOR INSERT
  WITH CHECK (submitted_by = auth.uid());

-- Submitter can edit their own pending/rejected listing; admin can edit anything.
CREATE POLICY "beaches_update" ON beaches FOR UPDATE
  USING (
    submitted_by = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Only admin can delete.
CREATE POLICY "beaches_delete" ON beaches FOR DELETE
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));


-- ─── Row Level Security — landmarks ──────────────────────────────────────────

ALTER TABLE landmarks ENABLE ROW LEVEL SECURITY;

-- Public sees only active places; submitter always sees their own; admin sees all.
CREATE POLICY "landmarks_select" ON landmarks FOR SELECT
  USING (
    status = 'active'
    OR submitted_by = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Any authenticated user can submit a new place (as themselves).
CREATE POLICY "landmarks_insert" ON landmarks FOR INSERT
  WITH CHECK (submitted_by = auth.uid());

-- Submitter can edit their own pending/rejected listing; admin can edit anything.
CREATE POLICY "landmarks_update" ON landmarks FOR UPDATE
  USING (
    submitted_by = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Only admin can delete.
CREATE POLICY "landmarks_delete" ON landmarks FOR DELETE
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));


-- ─── Seed Data ────────────────────────────────────────────────────────────────
-- Admin-seeded (submitted_by NULL). photo_urls empty — upload to place-photos
-- bucket first, then UPDATE these rows with the resulting public URLs.
-- Coordinates are accurate; descriptions are original (not copied from any source).

INSERT INTO beaches (submitted_by, name, district, latitude, longitude, description, blue_flag, access_type, facilities, status)
VALUES
  (NULL, 'Escape Beach', 'kyrenia', 35.3393, 33.3167,
   'One of Kyrenia''s most popular beaches. Calm, clear water with a mix of fine sand and pebbles. Well-equipped with sunbeds and beachside dining. Often busy on weekends.',
   true, 'public', ARRAY['parking', 'toilets', 'sunbeds', 'food_bar', 'lifeguard'], 'active'),

  (NULL, 'Alagadi Turtle Beach', 'kyrenia', 35.3602, 33.5074,
   'A protected natural beach and one of the most important loggerhead turtle (Caretta caretta) nesting sites in the Mediterranean. Minimal development by design. Visiting at night during nesting season (Jun–Aug) requires a guide permit.',
   false, 'public', ARRAY['toilets'], 'active'),

  (NULL, 'Golden Beach (Altın Kumsal)', 'karpaz', 35.5890, 34.5283,
   'A long, undeveloped stretch of golden sand at the tip of the Karpaz Peninsula — widely considered the most beautiful beach in North Cyprus. Remote and unspoiled. Wild donkeys roam the area.',
   false, 'public', ARRAY['parking'], 'active'),

  (NULL, 'Glapsides Beach', 'famagusta', 35.1570, 33.8967,
   'A sandy beach just north of Famagusta with calm, shallow water — popular with families. Close to the Salamis ruins, making it a convenient stop on a day out.',
   false, 'public', ARRAY['parking', 'toilets', 'sunbeds', 'food_bar'], 'active');


INSERT INTO landmarks (submitted_by, name, district, latitude, longitude, description, category, status)
VALUES
  (NULL, 'Kyrenia Castle', 'kyrenia', 35.3413, 33.3175,
   'A Byzantine-era castle rebuilt and expanded by the Venetians and Ottomans, sitting at the entrance to Kyrenia Harbour. Houses the Shipwreck Museum, home to a 2,400-year-old merchant vessel recovered from the seabed. The harbour views from the battlements are excellent.',
   'castle_fortress', 'active'),

  (NULL, 'St. Hilarion Castle', 'kyrenia', 35.3082, 33.2490,
   'A medieval castle perched on a mountain peak above Kyrenia at 732 m. Built by the Byzantines, it saw its peak use under the Lusignans. The upper ward offers sweeping views over both the north coast and the Mesaoria plain. Said to have inspired Disney''s Snow White castle.',
   'castle_fortress', 'active'),

  (NULL, 'Salamis Ancient City', 'famagusta', 35.1727, 33.9238,
   'One of the most significant ancient sites in Cyprus. Founded in the 11th century BC, Salamis was one of the most important city-kingdoms of the ancient world. The site includes a large gymnasium, Roman baths, an amphitheatre, and extensive mosaics — all set in open pine woodland near the sea.',
   'ancient_ruins', 'active'),

  (NULL, 'Bellapais Abbey', 'kyrenia', 35.3124, 33.3649,
   'A 13th-century Gothic monastery in the hillside village of Bellapais, considered the finest example of Gothic architecture in Cyprus. The refectory and cloister are well preserved. Lawrence Durrell lived in the village and wrote about it in "Bitter Lemons of Cyprus".',
   'religious_site', 'active'),

  (NULL, 'Apostolos Andreas Monastery', 'karpaz', 35.6172, 34.5857,
   'A pilgrimage monastery at the very tip of the Karpaz Peninsula, one of the most sacred sites for both Greek Cypriots and Maronites. Extensively restored with joint UN backing. The surrounding coastline is among the most remote and dramatic in the island.',
   'religious_site', 'active');
1