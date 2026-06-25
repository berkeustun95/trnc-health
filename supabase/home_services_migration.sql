-- ─── Home Services Module Migration ─────────────────────────────────────────
-- Run in Supabase SQL editor.
-- Adds the home_services table: a WhatsApp-first directory of local tradespeople.
-- District list: 6 districts (nicosia, kyrenia, famagusta, morphou, iskele, lefke).
-- NOTE: accommodation uses 5 districts (no lefke). Intentional — see architecture.md.

-- ─── Table ───────────────────────────────────────────────────────────────────

CREATE TABLE home_services (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID REFERENCES auth.users(id),  -- nullable for admin-seeded rows
  name             TEXT NOT NULL,
  phone            TEXT NOT NULL,
  whatsapp         TEXT,
  contact_pref     TEXT NOT NULL DEFAULT 'whatsapp'
                     CHECK (contact_pref IN ('call', 'whatsapp', 'both')),
  district         TEXT NOT NULL
                     CHECK (district IN ('nicosia', 'kyrenia', 'famagusta', 'morphou', 'iskele', 'lefke')),
  description      TEXT,
  service_types    TEXT[] NOT NULL DEFAULT '{}',
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'active', 'rejected')),
  rejection_reason TEXT,
  verified         BOOLEAN NOT NULL DEFAULT false,  -- set manually in dashboard, never in code
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- ─── Row Level Security ───────────────────────────────────────────────────────

ALTER TABLE home_services ENABLE ROW LEVEL SECURITY;

-- Public sees only approved providers; owner always sees their own; admin sees all.
CREATE POLICY "hs_select_public" ON home_services FOR SELECT
  USING (
    status = 'active'
    OR owner_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Any authenticated user can submit a new listing (as themselves).
CREATE POLICY "hs_insert_self" ON home_services FOR INSERT
  WITH CHECK (owner_id = auth.uid());

-- Owner can edit their own pending/rejected listing; admin can edit anything.
CREATE POLICY "hs_update_self" ON home_services FOR UPDATE
  USING (
    owner_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Only admin can delete.
CREATE POLICY "hs_delete_admin" ON home_services FOR DELETE
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ─── Seed Data (admin-seeded, owner_id NULL) ─────────────────────────────────
-- Replace placeholder values with real provider details before running.

INSERT INTO home_services (owner_id, name, phone, whatsapp, contact_pref, district, description, service_types, status, verified)
VALUES
  (NULL, 'Mehmet Usta Plumbing', '+90 548 000 0001', '+90 548 000 0001', 'whatsapp', 'kyrenia',
   'Experienced plumber serving the Kyrenia area. Available 7 days a week for emergency callouts.',
   ARRAY['plumber'], 'active', true),

  (NULL, 'Nicosia Electric', '+90 542 000 0002', '+90 542 000 0002', 'whatsapp', 'nicosia',
   'Licensed electricians for residential and commercial work. Fault finding, installations, rewiring.',
   ARRAY['electrician'], 'active', true),

  (NULL, 'Ali Carpenter & Painter', '+90 533 000 0003', '+90 533 000 0003', 'both', 'famagusta',
   'Custom carpentry and painting for homes and offices. Free quote available.',
   ARRAY['carpenter', 'painter'], 'active', true);
