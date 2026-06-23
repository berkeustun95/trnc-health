-- ─── Dummy accommodation listing for testing ────────────────────────────────
-- Run in Supabase SQL editor.
-- Uses the admin account (berke.ustun95@gmail.com) as the agent owner.

DO $$
DECLARE
  v_user_id   UUID;
  v_agency_id UUID;
  v_agent_id  UUID;
  v_prop1_id  UUID;
  v_prop2_id  UUID;
BEGIN
  -- Get admin user id
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'berke.ustun95@gmail.com' LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Admin user not found';
  END IF;

  -- Create agency
  INSERT INTO estate_agencies (owner_id, name, address, phone, email, website, description, status)
  VALUES (
    v_user_id,
    'ADA Premium Properties',
    '14 Harbour View Road, Kyrenia',
    '+90 548 000 0001',
    'info@adaproperties.com',
    'https://adaproperties.com',
    'North Cyprus''s most trusted property agency. Specialising in sea-view villas, luxury apartments, and holiday rentals across TRNC.',
    'active'
  )
  RETURNING id INTO v_agency_id;

  -- Create agent (linked to agency)
  INSERT INTO estate_agents (user_id, full_name, phone, email, agency_id, status)
  VALUES (
    v_user_id,
    'Berke Üstün',
    '+90 548 000 0002',
    'berke.ustun95@gmail.com',
    v_agency_id,
    'active'
  )
  RETURNING id INTO v_agent_id;

  -- ── Property 1: Sea-view villa for rent ──────────────────────────────────
  INSERT INTO properties (
    agent_id, agency_id, title, description,
    intent, property_type, price, currency, price_period,
    bedrooms, bathrooms, area_sqm, furnished,
    district, address, latitude, longitude, status
  ) VALUES (
    v_agent_id, v_agency_id,
    'Stunning Sea View Villa — Kyrenia Harbour',
    'A beautifully furnished 3-bedroom villa with panoramic sea views, private pool, and direct access to the historic Kyrenia harbour area. Fully air-conditioned, modern kitchen, and spacious terrace. Ideal for long-term rental or professional couples relocating to TRNC.',
    'rent', 'villa', 2500, 'GBP', 'monthly',
    3, 2, 180, true,
    'kyrenia', '28 Harbour View Road, Kyrenia', 35.3408, 33.3186, 'active'
  )
  RETURNING id INTO v_prop1_id;

  INSERT INTO property_images (property_id, url, sort_order) VALUES
    (v_prop1_id, 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=900&q=80', 0),
    (v_prop1_id, 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=900&q=80', 1),
    (v_prop1_id, 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=900&q=80', 2),
    (v_prop1_id, 'https://images.unsplash.com/photo-1502005229762-cf1b2da7c5d6?w=900&q=80', 3);

  -- ── Property 2: City apartment for sale ─────────────────────────────────
  INSERT INTO properties (
    agent_id, agency_id, title, description,
    intent, property_type, price, currency, price_period,
    bedrooms, bathrooms, area_sqm, furnished,
    district, address, latitude, longitude, status
  ) VALUES (
    v_agent_id, v_agency_id,
    'Modern 2BR Apartment in Central Nicosia',
    'Bright and modern 2-bedroom apartment in the heart of Nicosia. Walking distance to universities, hospitals, and shopping centres. Ideal for investment or permanent residence. New building, high-spec finishes, allocated parking.',
    'sale', 'apartment', 185000, 'GBP', 'total',
    2, 1, 95, false,
    'nicosia', 'Atatürk Avenue, Central Nicosia', 35.1856, 33.3823, 'active'
  )
  RETURNING id INTO v_prop2_id;

  INSERT INTO property_images (property_id, url, sort_order) VALUES
    (v_prop2_id, 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=900&q=80', 0),
    (v_prop2_id, 'https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=900&q=80', 1),
    (v_prop2_id, 'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=900&q=80', 2);

END $$;
