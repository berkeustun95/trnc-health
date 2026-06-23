-- ─── Accommodation Module Migration ────────────────────────────────────────
-- Run this in the Supabase SQL editor.
-- Storage: manually create a public bucket named "property-images" in Storage.

-- ─── Tables ─────────────────────────────────────────────────────────────────

CREATE TABLE estate_agencies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        UUID NOT NULL REFERENCES auth.users(id),
  name            TEXT NOT NULL,
  logo_url        TEXT,
  address         TEXT,
  phone           TEXT,
  email           TEXT,
  website         TEXT,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'active', 'rejected')),
  rejection_reason TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE estate_agents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL UNIQUE REFERENCES auth.users(id),
  full_name       TEXT NOT NULL,
  phone           TEXT NOT NULL,
  email           TEXT,
  photo_url       TEXT,
  id_document_url TEXT,
  agency_id       UUID REFERENCES estate_agencies(id),
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'active', 'rejected')),
  rejection_reason TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE properties (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        UUID NOT NULL REFERENCES estate_agents(id),
  agency_id       UUID REFERENCES estate_agencies(id),
  title           TEXT NOT NULL,
  description     TEXT,
  intent          TEXT NOT NULL
                    CHECK (intent IN ('rent', 'sale', 'short_term')),
  property_type   TEXT NOT NULL
                    CHECK (property_type IN ('apartment','villa','studio','house','land','commercial')),
  price           NUMERIC NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'GBP'
                    CHECK (currency IN ('GBP','TRY','EUR')),
  price_period    TEXT CHECK (price_period IN ('monthly','nightly','total')),
  bedrooms        INT,
  bathrooms       INT,
  area_sqm        NUMERIC,
  furnished       BOOLEAN,
  district        TEXT CHECK (district IN ('nicosia','kyrenia','famagusta','morphou','iskele')),
  address         TEXT,
  latitude        NUMERIC,
  longitude       NUMERIC,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','active','rejected','archived')),
  rejection_reason TEXT,
  view_count      INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE property_images (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  sort_order  INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ─── Row Level Security ──────────────────────────────────────────────────────

ALTER TABLE estate_agencies   ENABLE ROW LEVEL SECURITY;
ALTER TABLE estate_agents     ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties        ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_images   ENABLE ROW LEVEL SECURITY;

-- Helper: is the current user an admin?
-- (reuses the existing profiles table pattern)

-- estate_agencies
-- Public sees active agencies; owner sees their own; admin sees all.
CREATE POLICY "agencies_select_public"  ON estate_agencies FOR SELECT
  USING (status = 'active' OR owner_id = auth.uid()
         OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "agencies_insert_owner"   ON estate_agencies FOR INSERT
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "agencies_update_owner"   ON estate_agencies FOR UPDATE
  USING (owner_id = auth.uid()
         OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "agencies_all_admin"      ON estate_agencies FOR DELETE
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- estate_agents
-- Active agents visible publicly; own record always visible; admin sees all.
CREATE POLICY "agents_select_public"    ON estate_agents FOR SELECT
  USING (status = 'active' OR user_id = auth.uid()
         OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "agents_insert_self"      ON estate_agents FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "agents_update_self"      ON estate_agents FOR UPDATE
  USING (user_id = auth.uid()
         OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "agents_delete_admin"     ON estate_agents FOR DELETE
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- properties
-- Active listings visible to all; own listings (any status) visible to agent; admin sees all.
CREATE POLICY "props_select_public"     ON properties FOR SELECT
  USING (
    status = 'active'
    OR agent_id IN (SELECT id FROM estate_agents WHERE user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "props_insert_agent"      ON properties FOR INSERT
  WITH CHECK (
    agent_id IN (SELECT id FROM estate_agents WHERE user_id = auth.uid() AND status = 'active')
  );

CREATE POLICY "props_update_agent"      ON properties FOR UPDATE
  USING (
    agent_id IN (SELECT id FROM estate_agents WHERE user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "props_delete_admin"      ON properties FOR DELETE
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- property_images
-- Images follow their property's visibility rules.
CREATE POLICY "images_select_public"    ON property_images FOR SELECT
  USING (
    property_id IN (SELECT id FROM properties WHERE status = 'active')
    OR property_id IN (
      SELECT p.id FROM properties p
      JOIN estate_agents ea ON ea.id = p.agent_id
      WHERE ea.user_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "images_insert_agent"     ON property_images FOR INSERT
  WITH CHECK (
    property_id IN (
      SELECT p.id FROM properties p
      JOIN estate_agents ea ON ea.id = p.agent_id
      WHERE ea.user_id = auth.uid()
    )
  );

CREATE POLICY "images_delete_agent"     ON property_images FOR DELETE
  USING (
    property_id IN (
      SELECT p.id FROM properties p
      JOIN estate_agents ea ON ea.id = p.agent_id
      WHERE ea.user_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ─── Storage ─────────────────────────────────────────────────────────────────
-- Manually create a public bucket named "property-images" in the Supabase dashboard.
-- Storage policies (run after creating the bucket):

INSERT INTO storage.buckets (id, name, public) VALUES ('property-images', 'property-images', true)
  ON CONFLICT DO NOTHING;

CREATE POLICY "property_images_upload"  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'property-images' AND auth.role() = 'authenticated');

CREATE POLICY "property_images_public"  ON storage.objects FOR SELECT
  USING (bucket_id = 'property-images');

CREATE POLICY "property_images_delete"  ON storage.objects FOR DELETE
  USING (bucket_id = 'property-images' AND auth.uid()::text = (storage.foldername(name))[1]);
