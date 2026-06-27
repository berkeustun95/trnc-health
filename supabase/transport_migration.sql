-- ─── Transport Module Migration ───────────────────────────────────────────────
-- Run in Supabase SQL editor.
-- Two tables: transport_providers (taxis, car rentals, airport transfers)
-- and bus_routes (admin-managed reference content, no live data).
-- District standard: 7 districts (adds karpaz to the hs 6-list).
-- i18n: reuses blDistrict* keys — no trDistrict* namespace created.

-- ─── transport_providers ─────────────────────────────────────────────────────

CREATE TABLE transport_providers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID REFERENCES auth.users(id),          -- nullable: admin-seeded rows
  type             TEXT NOT NULL
                     CHECK (type IN ('taxi', 'car_rental', 'airport_transfer')),
  name             TEXT NOT NULL,
  phone            TEXT NOT NULL,
  whatsapp         TEXT,
  contact_pref     TEXT NOT NULL DEFAULT 'whatsapp'
                     CHECK (contact_pref IN ('call', 'whatsapp', 'both')),
  district         TEXT NOT NULL
                     CHECK (district IN ('nicosia','kyrenia','famagusta','morphou','iskele','lefke','karpaz')),
  airport          TEXT CHECK (airport IN ('ercan', 'larnaca', 'both')),
  description      TEXT,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'active', 'rejected')),
  rejection_reason TEXT,
  verified         BOOLEAN NOT NULL DEFAULT false,           -- set manually in admin, never in code
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),

  -- airport_transfer rows must specify which airport they serve
  CHECK (type <> 'airport_transfer' OR airport IS NOT NULL)
);

-- RLS — mirrors home_services exactly.
-- Public: active listings OR own row OR admin.
-- Insert: authenticated users submitting their own listing.
-- Update: owner edits their own row OR admin edits anything.
-- Delete: admin only.

ALTER TABLE transport_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tp_select_public" ON transport_providers FOR SELECT
  USING (
    status = 'active'
    OR owner_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "tp_insert_self" ON transport_providers FOR INSERT
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "tp_update_self_or_admin" ON transport_providers FOR UPDATE
  USING (
    owner_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "tp_delete_admin" ON transport_providers FOR DELETE
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ─── bus_routes ───────────────────────────────────────────────────────────────

CREATE TABLE bus_routes (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  origin_district      TEXT NOT NULL
                         CHECK (origin_district IN ('nicosia','kyrenia','famagusta','morphou','iskele','lefke','karpaz')),
  destination_district TEXT NOT NULL
                         CHECK (destination_district IN ('nicosia','kyrenia','famagusta','morphou','iskele','lefke','karpaz')),
  terminal             TEXT,    -- e.g. "Lefkoşa Terminal, Bay 4"
  frequency            TEXT,    -- e.g. "Every 30 min, 07:00–22:00"
  fare_note            TEXT,    -- e.g. "~40 TL"
  route_note           TEXT,    -- free-text: via points, special stops, Ercan context
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);

-- RLS — reference content: anyone can read, admin-only writes.

ALTER TABLE bus_routes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "br_select_public" ON bus_routes FOR SELECT
  USING (true);

CREATE POLICY "br_insert_admin" ON bus_routes FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "br_update_admin" ON bus_routes FOR UPDATE
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "br_delete_admin" ON bus_routes FOR DELETE
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
