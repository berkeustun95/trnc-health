-- TRNC intercity bus & dolmuş seed data
-- Sources: pazarkibris.com, cyprus-faq.com (2025-2026)
-- Fares are TL-based and change frequently — update as needed via Admin > Bus Routes

INSERT INTO bus_routes (origin_district, destination_district, terminal, frequency, fare_note, route_note)
VALUES

  -- ── Nicosia ↔ Kyrenia ──────────────────────────────────────────────────────
  ('nicosia', 'kyrenia',
   'Atatürk Caddesi, Lefkoşa',
   'Her 30 dakikada bir (gündüz); saatte bir (akşam)',
   NULL,
   'Kombos dolmuş — yaklaşık 45–55 dakika'),

  ('kyrenia', 'nicosia',
   'Kombos, Girne şehir merkezi',
   'Her 30 dakikada bir (gündüz); saatte bir (akşam)',
   NULL,
   'Kombos dolmuş — yaklaşık 45–55 dakika'),

  -- ── Nicosia ↔ Famagusta ────────────────────────────────────────────────────
  ('nicosia', 'famagusta',
   'Atatürk Caddesi, Lefkoşa',
   'Saatte bir, 07:00–18:00',
   NULL,
   'İtimat ve Gece otobüs şirketleri'),

  ('famagusta', 'nicosia',
   'Gazimağusa şehir merkezi',
   'Saatte bir, 07:00–18:00',
   NULL,
   'İtimat ve Gece otobüs şirketleri'),

  -- ── Kyrenia ↔ Famagusta ────────────────────────────────────────────────────
  ('kyrenia', 'famagusta',
   'Kombos, Girne şehir merkezi',
   'Her 1–1.5 saatte bir, 09:00–18:00',
   '~350 TL',
   'Yaklaşık 1 saat 15 dakika'),

  ('famagusta', 'kyrenia',
   'Gazimağusa şehir merkezi',
   'Her 1–1.5 saatte bir, 09:00–18:00',
   '~350 TL',
   'Yaklaşık 1 saat 15 dakika'),

  -- ── Nicosia ↔ Morphou ──────────────────────────────────────────────────────
  ('nicosia', 'morphou',
   'Atatürk Caddesi, Lefkoşa',
   'Günde birkaç sefer',
   NULL,
   NULL),

  ('morphou', 'nicosia',
   'Güzelyurt şehir merkezi',
   'Günde birkaç sefer',
   NULL,
   NULL),

  -- ── Nicosia ↔ Lefke ────────────────────────────────────────────────────────
  ('nicosia', 'lefke',
   'Atatürk Caddesi, Lefkoşa',
   'Günde birkaç sefer',
   NULL,
   NULL),

  ('lefke', 'nicosia',
   'Lefke şehir merkezi',
   'Günde birkaç sefer',
   NULL,
   NULL),

  -- ── Nicosia ↔ Iskele ───────────────────────────────────────────────────────
  ('nicosia', 'iskele',
   'Atatürk Caddesi, Lefkoşa',
   'Günde birkaç sefer',
   NULL,
   'Gece otobüs şirketi'),

  ('iskele', 'nicosia',
   'İskele şehir merkezi',
   'Günde birkaç sefer',
   NULL,
   'Gece otobüs şirketi'),

  -- ── Famagusta ↔ Iskele ─────────────────────────────────────────────────────
  ('famagusta', 'iskele',
   'Gazimağusa şehir merkezi',
   'Günde birkaç sefer',
   NULL,
   NULL),

  ('iskele', 'famagusta',
   'İskele şehir merkezi',
   'Günde birkaç sefer',
   NULL,
   NULL),

  -- ── KIBHAS Airport Shuttles (Ercan → cities) ───────────────────────────────
  -- Ercan is in Nicosia district; these depart from the airport terminal
  ('nicosia', 'kyrenia',
   'Ercan Havalimanı (KIBHAS)',
   'Uçuş saatlerine göre',
   '300–500 TL',
   'KIBHAS servis — yaklaşık 40–45 dakika. Tel: +90 533 870 48 44'),

  ('nicosia', 'famagusta',
   'Ercan Havalimanı (KIBHAS)',
   'Uçuş saatlerine göre',
   '300–500 TL',
   'KIBHAS servis — yaklaşık 50 dakika. Tel: +90 533 870 48 44'),

  ('nicosia', 'morphou',
   'Ercan Havalimanı (KIBHAS)',
   'Uçuş saatlerine göre',
   '300–500 TL',
   'KIBHAS servis — yaklaşık 1 saat. Tel: +90 533 870 48 44'),

  ('nicosia', 'lefke',
   'Ercan Havalimanı (KIBHAS)',
   'Uçuş saatlerine göre',
   '300–500 TL',
   'KIBHAS servis — yaklaşık 1 saat 15 dakika. Tel: +90 533 870 48 44');
