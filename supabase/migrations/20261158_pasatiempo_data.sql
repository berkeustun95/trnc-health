-- ═══════════════════════════════════════════════════════════════════════════
-- 20261158 — Pasatiempo Restaurant & Bar: third eatery partner + its 83-item menu, INACTIVE, website ordering
-- ═══════════════════════════════════════════════════════════════════════════
--
-- DATA ONLY, NO SCHEMA, NO POLICY, NO GRANT. Inserts one eatery_partners row (id e5fea9df-2ea4-4212-a84d-1dbb0be11c8d, slug pasatiempo) with
-- is_active = false and order_method = 'website' (20261157), and its 83 menu items. Every client role still sees NOTHING of
-- this partner or its menu in production (asserted below as anon and as authenticated, postgres the positive control).
-- The ADA Preview key sees it through the existing eatery_*_select_preview policies (20261119/1120), unchanged.
--
-- SOURCE (Berke, 2026-11-02): new partner; the owner approved ADA using any information from https://pasatiempocy.com.
-- Read 2026-11-02 from the site's own public data (the Firestore documents its SPA loads: items, config/site):
--   name / tagline "Pasatiempo" "Restaurant & Bar" (web manifest name "Pasatiempo Restaurant & Bar"); Nicosia => region
--   nicosia; phone +90 539 112 72 72 (the number the site shows and links on wa.me / tel:); delivery, table ordering, pickup.
--   PIN 35.177175, 33.362188 = the restaurant location the owner set in the site's own admin (config/site.center):
--   geocode_source 'partner'. maps_url is built from that pin in the same form the site links it.
--   opening_hours VERBATIM from config/site.hours (Sun off). The odd open minutes (11:20 / 11:24 / 11:25) are the owner's
--   entries; confirm with the owner, a correction is a one-row UPDATE. Overnight closes (01:00) are handled by the app
--   (close <= open = past midnight, utils/towingHours.js).
--   brand_color #994b17 = the site's theme_color (Berke). adult_only false (Berke, 2026-11-02, full menu incl. alcohol).
--   category restaurant. menu_verified_on 2026-11-02 = the day the live menu was read (the 30-day staleness clock starts here).
--
-- Left NULL on purpose (not published on the site, never guessed): address (the site says only "Nicosia"; the image
-- pipeline's readiness needs it, so logo and photos follow in an owner-data file once the owner sends it); whatsapp
-- (one ordering channel: the site); menu_url; logo_path / banner_path (images upload separately); socials (no column).
--
-- MENU: every item on the site, in its own order, 20 of them is_available = false exactly as the site marks them.
--   Dish names VERBATIM (the owner's spelling, typos included: reported to the owner, not corrected here). Sections and
--   descriptions in TURKISH like the rest of Yeme-İçme (precedent 20261147), translated from the owner's English; the
--   section note "Served with fries" becomes "Patates kızartması ile" ("Served with rice" is dropped: every bowl lists its rice). Rakı: the Small
--   price is the item price, both sizes in the description. Prices TRY as on the site. The lower-case "veggie burger"
--   section (last on the site, after the drinks) is shown as "Vejetaryen Burgerler" after Burgerler. Owner-data errors kept
--   as published and reported to the owner: Garlic Aioli Smash Burger's text is Caramelised Onion's (no aioli); the falafel and
--   pulled-mushroom burger texts look swapped.
--   Extras / removals / wine and rakı choices are NOT stored (eatery_item_options feed the basket; website partners have none).
-- DISH-FINDER TAGS (20261123 vocabulary), from the descriptions, 44 tagged. NOT tagged (never suggested by the quiz):
--   every alcoholic drink (the quiz is open to minors); Bacon Smash Burger (pork or beef bacon: unknown, ask the owner);
--   the three meatball dishes (meat not stated; the site also sells chicken meatballs). Mezze Platter = pork (pork şiş).
--
-- ─── WHO CAN READ / WRITE ───────────────────────────────────────────────────
--   UNCHANGED; no policy or grant is touched. The new rows are readable by anyone ONLY once is_active = true (never set
--   here) and by the ADA Preview app's key meanwhile. Writes stay service_role / postgres only. A business's own published
--   details; no personal data.
--
-- ─── RE-RUNNABLE ────────────────────────────────────────────────────────────
-- Partner: absent => insert; present => every column must already equal its target, else raise.
-- Menu: 0 items => insert; exactly these 83 (all columns) => no-op; anything else raises with the live count.
--
-- Apply AFTER 20261157_eatery_order_website.sql (refuses unless it is in the ledger).
-- Apply: gh workflow run supabase-migrate -f files="20261157_eatery_order_website.sql 20261158_pasatiempo_data.sql" (dry),
-- then -f apply=true (Berke approves production-db). Data only: no NOTIFY pgrst.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  c_id    constant uuid := 'e5fea9df-2ea4-4212-a84d-1dbb0be11c8d';
  c_slug  constant text := 'pasatiempo';
  c_hours constant jsonb := '{"mon": {"open": "11:20", "close": "01:00"}, "tue": {"open": "11:25", "close": "01:00"}, "wed": {"open": "11:25", "close": "01:00"}, "thu": {"open": "11:24", "close": "00:00"}, "fri": {"open": "11:25", "close": "01:00"}, "sat": {"open": "11:25", "close": "01:15"}, "sun": null}';
  v_menu  constant jsonb := $menu$
  [
  {"section": "Bowl'lar", "section_order": 1, "name": "Grilled Chicken Bowl", "sort_order": 1, "description": "Izgara tavuk, basmati pilavı, salata, humus", "price": 740, "is_available": true, "role": "main", "protein": "chicken", "spicy": false, "portion": "meal"},
  {"section": "Bowl'lar", "section_order": 1, "name": "Grilled Chicken Combo Bowl", "sort_order": 2, "description": "Izgara tavuk, sote sebze, hellim, basmati pilavı, salata, humus", "price": 790, "is_available": true, "role": "main", "protein": "chicken", "spicy": false, "portion": "meal"},
  {"section": "Bowl'lar", "section_order": 1, "name": "Crispy Chicken Bowl", "sort_order": 3, "description": "Çıtır tavuk, basmati pilavı, salata, coleslaw", "price": 790, "is_available": true, "role": "main", "protein": "chicken", "spicy": false, "portion": "meal"},
  {"section": "Bowl'lar", "section_order": 1, "name": "Meatball Bowl", "sort_order": 4, "description": "Köfte, basmati pilavı, salata, humus", "price": 840, "is_available": true, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Bowl'lar", "section_order": 1, "name": "Meatball Combo Bowl", "sort_order": 5, "description": "Köfte, basmati pilavı, sote sebze, hellim, salata, humus", "price": 880, "is_available": true, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Bowl'lar", "section_order": 1, "name": "Mushrooms & Falafel Bowl", "sort_order": 6, "description": "Izgara istiridye mantarı ve çıtır falafel, basmati pilavı, sote sebze, hellim, salata, humus", "price": 680, "is_available": true, "role": "main", "protein": "veg", "spicy": false, "portion": "meal"},
  {"section": "Burgerler", "section_order": 2, "name": "Smash Cheeseburger", "sort_order": 1, "description": "Çift smash dana köfte, cheddar, soğan, turşu, sos. Patates kızartması ile", "price": 790, "is_available": true, "role": "main", "protein": "beef", "spicy": false, "portion": "meal"},
  {"section": "Burgerler", "section_order": 2, "name": "Bacon Smash Burger", "sort_order": 2, "description": "Çift smash dana köfte, bacon, cheddar, soğan, turşu, sos. Patates kızartması ile", "price": 870, "is_available": true, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Burgerler", "section_order": 2, "name": "Mushroom Smash Burger", "sort_order": 3, "description": "Çift smash dana köfte, mantar, cheddar, soğan, turşu, sos. Patates kızartması ile", "price": 810, "is_available": true, "role": "main", "protein": "beef", "spicy": false, "portion": "meal"},
  {"section": "Burgerler", "section_order": 2, "name": "Caramelised Onion Smash Burger", "sort_order": 4, "description": "Çift smash dana köfte, cheddar, karamelize soğan, turşu, sos. Patates kızartması ile", "price": 790, "is_available": true, "role": "main", "protein": "beef", "spicy": false, "portion": "meal"},
  {"section": "Burgerler", "section_order": 2, "name": "Garlic Aioli Smash Burger", "sort_order": 5, "description": "Çift smash dana köfte, cheddar, karamelize soğan, turşu, sos. Patates kızartması ile", "price": 810, "is_available": true, "role": "main", "protein": "beef", "spicy": false, "portion": "meal"},
  {"section": "Burgerler", "section_order": 2, "name": "Smash Felafel& Mushroom Burger", "sort_order": 6, "description": "Marine edilmiş didiklenmiş istiridye mantarı, hellim halkası, roka. Patates kızartması ile", "price": 610, "is_available": true, "role": "main", "protein": "veg", "spicy": false, "portion": "meal"},
  {"section": "Vejetaryen Burgerler", "section_order": 3, "name": "pulled mushroom burger", "sort_order": 1, "description": "Burger ekmeğinde falafel, mantar, hellim, turşu, burger sosu", "price": 550, "is_available": true, "role": "main", "protein": "veg", "spicy": false, "portion": "meal"},
  {"section": "Tavuk Burgerler", "section_order": 4, "name": "Crispy Chicken Burger", "sort_order": 1, "description": "Çıtır tavuk, coleslaw, turşu, sos. Patates kızartması ile", "price": 650, "is_available": true, "role": "main", "protein": "chicken", "spicy": false, "portion": "meal"},
  {"section": "Tavuk Burgerler", "section_order": 4, "name": "Crispy Chicken Garlic Burger", "sort_order": 2, "description": "Çıtır tavuk, sarımsaklı aioli, coleslaw, turşu, sos. Patates kızartması ile", "price": 670, "is_available": true, "role": "main", "protein": "chicken", "spicy": false, "portion": "meal"},
  {"section": "Tavuk Burgerler", "section_order": 4, "name": "Grilled Chicken Burger", "sort_order": 3, "description": "Izgara tavuk, sarımsaklı aioli, coleslaw, turşu, sos. Patates kızartması ile", "price": 670, "is_available": true, "role": "main", "protein": "chicken", "spicy": false, "portion": "meal"},
  {"section": "Dürümler", "section_order": 5, "name": "Smash Burger Wrap", "sort_order": 1, "description": "Çift smash dana köfte, hellim, cheddar, soğan, turşu, sos. Patates kızartması ile", "price": 790, "is_available": false, "role": "main", "protein": "beef", "spicy": false, "portion": "meal"},
  {"section": "Dürümler", "section_order": 5, "name": "Grilled Chicken Wrap", "sort_order": 2, "description": "Izgara tavuk, hellim, coleslaw, turşu, sos. Patates kızartması ile", "price": 670, "is_available": true, "role": "main", "protein": "chicken", "spicy": false, "portion": "meal"},
  {"section": "Dürümler", "section_order": 5, "name": "Crispy Chicken Wrap", "sort_order": 3, "description": "Çıtır tavuk, hellim, coleslaw, turşu, sos. Patates kızartması ile", "price": 690, "is_available": true, "role": "main", "protein": "chicken", "spicy": false, "portion": "meal"},
  {"section": "Dürümler", "section_order": 5, "name": "Fajita Wrap", "sort_order": 4, "description": "Izgara tavuk, sebze, hellim, fajita baharatı. Patates kızartması ile", "price": 740, "is_available": true, "role": "main", "protein": "chicken", "spicy": false, "portion": "meal"},
  {"section": "Dürümler", "section_order": 5, "name": "Falafel Wrap", "sort_order": 5, "description": "Falafel, hellim, marul, sos. Patates kızartması ile", "price": 560, "is_available": true, "role": "main", "protein": "veg", "spicy": false, "portion": "meal"},
  {"section": "Dürümler", "section_order": 5, "name": "Mushrooms Wrap", "sort_order": 6, "description": "Izgara istiridye mantarı, hellim, marul, sos. Patates kızartması ile", "price": 610, "is_available": true, "role": "main", "protein": "veg", "spicy": false, "portion": "meal"},
  {"section": "Dürümler", "section_order": 5, "name": "Umami Wrap", "sort_order": 7, "description": "Marine edilmiş soya parçaları ve mantar, hellim, marul, sos. Patates kızartması ile", "price": 710, "is_available": true, "role": "main", "protein": "veg", "spicy": false, "portion": "meal"},
  {"section": "Kıbrıs Pitaları", "section_order": 6, "name": "Grilled Meatball Pita", "sort_order": 1, "description": "Izgara köfte, hellim, humus, cacık, turşu, patates kızartması, soğan, maydanoz. Patates kızartması ile", "price": 790, "is_available": true, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Kıbrıs Pitaları", "section_order": 6, "name": "Grilled Chicken Pita", "sort_order": 2, "description": "Izgara tavuk, hellim, humus, cacık, turşu, patates kızartması, soğan, maydanoz. Patates kızartması ile", "price": 710, "is_available": true, "role": "main", "protein": "chicken", "spicy": false, "portion": "meal"},
  {"section": "Kıbrıs Pitaları", "section_order": 6, "name": "Falafel Pita", "sort_order": 3, "description": "Falafel, hellim, humus, cacık, turşu, patates kızartması, soğan, maydanoz. Patates kızartması ile", "price": 560, "is_available": true, "role": "main", "protein": "veg", "spicy": false, "portion": "meal"},
  {"section": "Kıbrıs Pitaları", "section_order": 6, "name": "Mushroom Skewers Pita", "sort_order": 4, "description": "Izgara istiridye mantarı, hellim, humus, cacık, turşu, patates kızartması, soğan, maydanoz. Patates kızartması ile", "price": 610, "is_available": true, "role": "main", "protein": "veg", "spicy": false, "portion": "meal"},
  {"section": "Kıbrıs Pitaları", "section_order": 6, "name": "Umami Pita", "sort_order": 5, "description": "Marine edilmiş soya parçaları ve mantar, hellim, humus, cacık, turşu, patates kızartması, soğan, maydanoz. Patates kızartması ile", "price": 710, "is_available": true, "role": "main", "protein": "veg", "spicy": false, "portion": "meal"},
  {"section": "Paylaşımlık", "section_order": 7, "name": "Mezze Platter", "sort_order": 1, "description": "8 soğuk meze, 3 sıcak meze, salata, pita, patates kızartması, tavuk şiş, köfte şiş, tavuk köfte şiş, domuz şiş. En az 2 kişilik", "price": 1800, "is_available": false, "role": "main", "protein": "pork", "spicy": false, "portion": "share"},
  {"section": "Paylaşımlık", "section_order": 7, "name": "Beer Platter for 4 person", "sort_order": 2, "description": "Tavuk şerit, popcorn tavuk, kızarmış sebze, ızgara hellim, kızarmış mantar, turşu, mozzarella çubukları", "price": 1750, "is_available": true, "role": "main", "protein": "chicken", "spicy": false, "portion": "share"},
  {"section": "Paylaşımlık", "section_order": 7, "name": "Beer Platter for 3 person", "sort_order": 3, "description": "Tavuk şerit, popcorn tavuk, kızarmış sebze, ızgara hellim, kızarmış mantar, turşu, mozzarella çubukları", "price": 1500, "is_available": true, "role": "main", "protein": "chicken", "spicy": false, "portion": "share"},
  {"section": "Paylaşımlık", "section_order": 7, "name": "Beer Platter for 2 person", "sort_order": 4, "description": "2 adet tavuk şerit, 4 adet popcorn tavuk, 2 adet hellim, mantar ve patates. Soslarla servis edilir", "price": 980, "is_available": true, "role": "main", "protein": "chicken", "spicy": false, "portion": "share"},
  {"section": "Paylaşımlık", "section_order": 7, "name": "Fries", "sort_order": 5, "description": null, "price": 250, "is_available": true, "role": "side", "protein": "none", "spicy": false, "portion": null},
  {"section": "Atıştırmalıklar", "section_order": 8, "name": "Munchie Fries", "sort_order": 1, "description": "Kendi karışımını yap: patates kızartması ve dilediğin ekstralar, atıştırmalıklar ve soslar", "price": 650, "is_available": false, "role": "side", "protein": "none", "spicy": false, "portion": null},
  {"section": "Atıştırmalıklar", "section_order": 8, "name": "Chicken Tenders", "sort_order": 2, "description": "2 adet", "price": 240, "is_available": true, "role": "side", "protein": "chicken", "spicy": false, "portion": null},
  {"section": "Atıştırmalıklar", "section_order": 8, "name": "Mushroom Skewers", "sort_order": 3, "description": null, "price": 200, "is_available": true, "role": "side", "protein": "veg", "spicy": false, "portion": null},
  {"section": "Atıştırmalıklar", "section_order": 8, "name": "Onion Rings", "sort_order": 4, "description": "6 adet", "price": 190, "is_available": false, "role": "side", "protein": "veg", "spicy": false, "portion": null},
  {"section": "Atıştırmalıklar", "section_order": 8, "name": "Mozzarella Sticks", "sort_order": 5, "description": "4 adet", "price": 280, "is_available": false, "role": "side", "protein": "veg", "spicy": false, "portion": null},
  {"section": "Atıştırmalıklar", "section_order": 8, "name": "Beer plater 2 person", "sort_order": 6, "description": "Tavuk şerit, popcorn tavuk, kızarmış sebze, ızgara hellim, kızarmış mantar, turşu, mozzarella çubukları", "price": 1200, "is_available": false, "role": "main", "protein": "chicken", "spicy": false, "portion": "share"},
  {"section": "Meşrubatlar", "section_order": 9, "name": "Coca Cola", "sort_order": 1, "description": null, "price": 85, "is_available": true, "role": "drink", "protein": "none", "spicy": false, "portion": null},
  {"section": "Meşrubatlar", "section_order": 9, "name": "Coca Cola Zero", "sort_order": 2, "description": null, "price": 85, "is_available": true, "role": "drink", "protein": "none", "spicy": false, "portion": null},
  {"section": "Meşrubatlar", "section_order": 9, "name": "Sprite", "sort_order": 3, "description": null, "price": 85, "is_available": true, "role": "drink", "protein": "none", "spicy": false, "portion": null},
  {"section": "Meşrubatlar", "section_order": 9, "name": "Fanta", "sort_order": 4, "description": null, "price": 85, "is_available": true, "role": "drink", "protein": "none", "spicy": false, "portion": null},
  {"section": "Meşrubatlar", "section_order": 9, "name": "Soda", "sort_order": 5, "description": null, "price": 75, "is_available": true, "role": "drink", "protein": "none", "spicy": false, "portion": null},
  {"section": "Meşrubatlar", "section_order": 9, "name": "Lemonade", "sort_order": 6, "description": null, "price": 220, "is_available": true, "role": "drink", "protein": "none", "spicy": false, "portion": null},
  {"section": "Meşrubatlar", "section_order": 9, "name": "Water", "sort_order": 7, "description": null, "price": 55, "is_available": false, "role": "drink", "protein": "none", "spicy": false, "portion": null},
  {"section": "Meşrubatlar", "section_order": 9, "name": "Fues tea Seftali", "sort_order": 8, "description": null, "price": 85, "is_available": false, "role": "drink", "protein": "none", "spicy": false, "portion": null},
  {"section": "Meşrubatlar", "section_order": 9, "name": "Fues tea limon", "sort_order": 9, "description": null, "price": 85, "is_available": false, "role": "drink", "protein": "none", "spicy": false, "portion": null},
  {"section": "Kokteyller", "section_order": 10, "name": "Mojito", "sort_order": 1, "description": null, "price": 440, "is_available": true, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Kokteyller", "section_order": 10, "name": "Brandy Sour", "sort_order": 2, "description": null, "price": 390, "is_available": true, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Kokteyller", "section_order": 10, "name": "Whiskey Sour", "sort_order": 3, "description": null, "price": 430, "is_available": true, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Kokteyller", "section_order": 10, "name": "Negroni", "sort_order": 4, "description": null, "price": 450, "is_available": false, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Kokteyller", "section_order": 10, "name": "Old Fashioned", "sort_order": 5, "description": null, "price": 450, "is_available": false, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Kokteyller", "section_order": 10, "name": "Aperol Spritz", "sort_order": 6, "description": null, "price": 450, "is_available": true, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Kokteyller", "section_order": 10, "name": "Espresso Martini", "sort_order": 7, "description": null, "price": 490, "is_available": false, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Kokteyller", "section_order": 10, "name": "Coincidence *", "sort_order": 8, "description": null, "price": 480, "is_available": false, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Kokteyller", "section_order": 10, "name": "Cucumbeer *", "sort_order": 9, "description": null, "price": 490, "is_available": true, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Kokteyller", "section_order": 10, "name": "JIN Tonic", "sort_order": 10, "description": null, "price": 310, "is_available": true, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Kokteyller", "section_order": 10, "name": "Magrita", "sort_order": 11, "description": null, "price": 320, "is_available": true, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Kokteyller", "section_order": 10, "name": "Martini", "sort_order": 12, "description": null, "price": 380, "is_available": true, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Şaraplar", "section_order": 11, "name": "Red Wine", "sort_order": 1, "description": "Merlot veya Cabernet", "price": 310, "is_available": true, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Şaraplar", "section_order": 11, "name": "White Wine", "sort_order": 2, "description": "Pinot Grigio veya Chardonnay", "price": 310, "is_available": true, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Şaraplar", "section_order": 11, "name": "Rosé Wine", "sort_order": 3, "description": "Pinot Grigio veya Rosato", "price": 350, "is_available": true, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Rakı", "section_order": 12, "name": "Tekirdağ", "sort_order": 1, "description": "Küçük 1000 TL · Büyük 1880 TL", "price": 1000, "is_available": true, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Rakı", "section_order": 12, "name": "Beylerbeyi", "sort_order": 2, "description": "Küçük 1130 TL · Büyük 2000 TL", "price": 1130, "is_available": true, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Rakı", "section_order": 12, "name": "Efe", "sort_order": 3, "description": "Küçük 1000 TL · Büyük 1880 TL", "price": 1000, "is_available": true, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Biralar", "section_order": 13, "name": "Becks", "sort_order": 1, "description": null, "price": 230, "is_available": false, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Biralar", "section_order": 13, "name": "Belfast", "sort_order": 2, "description": null, "price": 270, "is_available": false, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Biralar", "section_order": 13, "name": "Efes Malt", "sort_order": 3, "description": null, "price": 240, "is_available": false, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Biralar", "section_order": 13, "name": "Bomonti", "sort_order": 4, "description": null, "price": 250, "is_available": true, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Biralar", "section_order": 13, "name": "Efes Özel Seri", "sort_order": 5, "description": null, "price": 230, "is_available": false, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Biralar", "section_order": 13, "name": "Corona", "sort_order": 6, "description": null, "price": 290, "is_available": true, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Biralar", "section_order": 13, "name": "Miller", "sort_order": 7, "description": null, "price": 270, "is_available": true, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Biralar", "section_order": 13, "name": "Stella", "sort_order": 8, "description": null, "price": 220, "is_available": true, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Craft Biralar", "section_order": 14, "name": "Crafters IPA", "sort_order": 1, "description": "Dry-hopped juicy IPA. Şeftali, narenciye, Hindistan cevizi ve mango", "price": 340, "is_available": true, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Craft Biralar", "section_order": 14, "name": "Double Dunkel", "sort_order": 2, "description": null, "price": 330, "is_available": false, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Craft Biralar", "section_order": 14, "name": "Nottingham Pale Ale", "sort_order": 3, "description": null, "price": 330, "is_available": true, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Craft Biralar", "section_order": 14, "name": "Nova Lager", "sort_order": 4, "description": null, "price": 310, "is_available": false, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Craft Biralar", "section_order": 14, "name": "Black Gold Porter", "sort_order": 5, "description": null, "price": 340, "is_available": false, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Craft Biralar", "section_order": 14, "name": "Cucumber Goose", "sort_order": 6, "description": null, "price": 340, "is_available": true, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Sert İçkiler", "section_order": 15, "name": "Zivania", "sort_order": 1, "description": "Portakal, üzüm ve kuruyemiş ile servis edilir", "price": 190, "is_available": true, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Sert İçkiler", "section_order": 15, "name": "Whiskey", "sort_order": 2, "description": null, "price": 380, "is_available": true, "role": null, "protein": null, "spicy": null, "portion": null},
  {"section": "Sert İçkiler", "section_order": 15, "name": "Gin (Ne istersen)", "sort_order": 3, "description": "Gin ve dilediğin mikser", "price": 310, "is_available": true, "role": null, "protein": null, "spicy": null, "portion": null}
  ]
  $menu$;
  v_want  jsonb;
  v_have  jsonb;
  v_p     public.eatery_partners%ROWTYPE;
  v_n     int;
  v_others int;
  v_before text; v_after text; v_ibefore text; v_iafter text;
  v_active_before text; v_active_after text;
  v_pos_p int; v_pos_i int;
  v_anon_p int; v_anon_i int; v_auth_p int; v_auth_i int;
  v_live int; v_anon_live int;
BEGIN
  -- ── Pre-state ──
  IF NOT EXISTS (SELECT 1 FROM public.schema_migrations_applied WHERE filename = '20261157_eatery_order_website.sql') THEN
    RAISE EXCEPTION '20261157_eatery_order_website.sql is not in the ledger: apply it first. Nothing applied.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.eatery_partners WHERE slug = c_slug AND id <> c_id) THEN
    RAISE EXCEPTION 'slug % already belongs to another id. Nothing applied.', c_slug;
  END IF;

  SELECT count(*), md5(COALESCE(string_agg(to_jsonb(p)::text, ',' ORDER BY p.id), ''))
    INTO v_others, v_before FROM public.eatery_partners p WHERE p.id <> c_id;
  SELECT md5(COALESCE(string_agg(to_jsonb(i)::text, ',' ORDER BY i.id), ''))
    INTO v_ibefore FROM public.eatery_menu_items i WHERE i.partner_id <> c_id;
  SELECT COALESCE(string_agg(slug, ',' ORDER BY slug), '') INTO v_active_before FROM public.eatery_partners WHERE is_active;

  -- ── Partner ──
  SELECT * INTO v_p FROM public.eatery_partners WHERE id = c_id;
  IF NOT FOUND THEN
    INSERT INTO public.eatery_partners (id, slug, name, category, phone, whatsapp, website_url, menu_url, maps_url,
                                        region, address, lat, lng, geocode_source, opening_hours, logo_path, menu_verified_on,
                                        sort_order, is_active, order_method, adult_only, brand_color)
    VALUES (c_id, c_slug, 'Pasatiempo Restaurant & Bar', 'restaurant', '+90 539 112 72 72', NULL, 'https://pasatiempocy.com', NULL,
            'https://www.google.com/maps?q=35.177175,33.362188', 'nicosia', NULL, 35.177175, 33.362188, 'partner', c_hours, NULL,
            DATE '2026-11-02', 20, false, 'website', false, '#994b17');
    SELECT * INTO v_p FROM public.eatery_partners WHERE id = c_id;
  END IF;
  IF v_p.slug IS DISTINCT FROM c_slug OR v_p.name IS DISTINCT FROM 'Pasatiempo Restaurant & Bar' OR v_p.category IS DISTINCT FROM 'restaurant'
     OR v_p.phone IS DISTINCT FROM '+90 539 112 72 72' OR v_p.whatsapp IS NOT NULL
     OR v_p.website_url IS DISTINCT FROM 'https://pasatiempocy.com' OR v_p.menu_url IS NOT NULL
     OR v_p.maps_url IS DISTINCT FROM 'https://www.google.com/maps?q=35.177175,33.362188' OR v_p.region IS DISTINCT FROM 'nicosia'
     OR v_p.address IS NOT NULL
     OR v_p.lat IS DISTINCT FROM 35.177175 OR v_p.lng IS DISTINCT FROM 33.362188 OR v_p.geocode_source IS DISTINCT FROM 'partner'
     OR v_p.opening_hours IS DISTINCT FROM c_hours OR v_p.logo_path IS NOT NULL OR v_p.banner_path IS NOT NULL
     OR v_p.menu_verified_on IS DISTINCT FROM DATE '2026-11-02'
     OR v_p.sort_order IS DISTINCT FROM 20 OR v_p.is_active IS DISTINCT FROM false OR v_p.order_method IS DISTINCT FROM 'website'
     OR v_p.adult_only IS DISTINCT FROM false OR v_p.order_requires_account IS DISTINCT FROM false
     OR v_p.brand_color IS DISTINCT FROM '#994b17' THEN
    RAISE EXCEPTION 'pasatiempo row exists but differs from this file: %. Nothing applied.', to_jsonb(v_p);
  END IF;

  -- ── Menu ──
  SELECT jsonb_agg(e ORDER BY (e->>'section_order')::int, (e->>'sort_order')::int) INTO v_want
    FROM jsonb_array_elements(v_menu) e;
  SELECT count(*) INTO v_n FROM public.eatery_menu_items WHERE partner_id = c_id;
  IF v_n = 0 THEN
    INSERT INTO public.eatery_menu_items (partner_id, section, section_order, name, description, price, currency, sort_order,
                                          is_available, role, protein, spicy, portion)
    SELECT c_id, e->>'section', (e->>'section_order')::int, e->>'name', e->>'description', (e->>'price')::numeric, 'TRY',
           (e->>'sort_order')::int, (e->>'is_available')::boolean, e->>'role', e->>'protein', (e->>'spicy')::boolean, e->>'portion'
      FROM jsonb_array_elements(v_menu) e;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('section', i.section, 'section_order', i.section_order, 'name', i.name,
                                      'sort_order', i.sort_order, 'description', i.description, 'price', i.price::int,
                                      'is_available', i.is_available, 'role', i.role, 'protein', i.protein,
                                      'spicy', i.spicy, 'portion', i.portion)
                   ORDER BY i.section_order, i.sort_order)
    INTO v_have FROM public.eatery_menu_items i WHERE i.partner_id = c_id;
  IF v_have IS DISTINCT FROM v_want THEN
    RAISE EXCEPTION 'pasatiempo menu is not exactly this file''s 83 items (live: % rows). Nothing applied.', jsonb_array_length(COALESCE(v_have, '[]'));
  END IF;
  SELECT count(*) INTO v_n FROM public.eatery_menu_items
   WHERE partner_id = c_id AND (currency IS DISTINCT FROM 'TRY' OR photo_path IS NOT NULL OR price IS NULL OR price <> trunc(price));
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% pasatiempo item(s) carry a photo, a non-TRY currency or a missing / fractional price. Nothing applied.', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id = c_id;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'pasatiempo has % item option(s); a website partner has none. Nothing applied.', v_n;
  END IF;

  -- ── Post-state: nothing else moved ──
  SELECT md5(COALESCE(string_agg(to_jsonb(p)::text, ',' ORDER BY p.id), '')) INTO v_after FROM public.eatery_partners p WHERE p.id <> c_id;
  SELECT md5(COALESCE(string_agg(to_jsonb(i)::text, ',' ORDER BY i.id), '')) INTO v_iafter FROM public.eatery_menu_items i WHERE i.partner_id <> c_id;
  SELECT COALESCE(string_agg(slug, ',' ORDER BY slug), '') INTO v_active_after FROM public.eatery_partners WHERE is_active;
  IF v_after IS DISTINCT FROM v_before OR v_iafter IS DISTINCT FROM v_ibefore THEN
    RAISE EXCEPTION 'another partner or its menu changed (% other partners). Nothing applied.', v_others;
  END IF;
  IF v_active_after IS DISTINCT FROM v_active_before OR v_active_after LIKE '%' || c_slug || '%' THEN
    RAISE EXCEPTION 'active partner set changed: {%} -> {%}. Nothing applied.', v_active_before, v_active_after;
  END IF;

  -- ── Visibility: production roles see nothing (postgres = positive control) ──
  SELECT count(*) INTO v_pos_p FROM public.eatery_partners WHERE id = c_id;
  SELECT count(*) INTO v_pos_i FROM public.eatery_menu_items WHERE partner_id = c_id;
  SELECT count(*) INTO v_live FROM public.eatery_partners WHERE is_active;
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.headers', '', true);
  SELECT count(*) INTO v_anon_live FROM public.eatery_partners;
  SELECT count(*) INTO v_anon_p FROM public.eatery_partners WHERE id = c_id;
  SELECT count(*) INTO v_anon_i FROM public.eatery_menu_items WHERE partner_id = c_id;
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'is_anonymous', false)::text, true);
  SELECT count(*) INTO v_auth_p FROM public.eatery_partners WHERE id = c_id;
  SELECT count(*) INTO v_auth_i FROM public.eatery_menu_items WHERE partner_id = c_id;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  IF v_pos_p IS DISTINCT FROM 1 OR v_pos_i IS DISTINCT FROM 83 THEN
    RAISE EXCEPTION 'positive control failed: postgres sees % partner / % items', v_pos_p, v_pos_i;
  END IF;
  -- Positive control through RLS: anon sees exactly the live partners (a policy that hid everything would pass the 0s below).
  IF v_anon_live IS DISTINCT FROM v_live THEN
    RAISE EXCEPTION 'positive control failed: anon sees % partners, % are active', v_anon_live, v_live;
  END IF;
  IF v_anon_p <> 0 OR v_anon_i <> 0 OR v_auth_p <> 0 OR v_auth_i <> 0 THEN
    RAISE EXCEPTION 'inactive partner visible: anon % / %, authenticated % / %', v_anon_p, v_anon_i, v_auth_p, v_auth_i;
  END IF;

  RAISE NOTICE 'pasatiempo INACTIVE, website, % menu items; anon sees % / %, authenticated % / % (postgres % / %); % other partners unchanged; active set {%}',
    v_pos_i, v_anon_p, v_anon_i, v_auth_p, v_auth_i, v_pos_p, v_pos_i, v_others, v_active_after;
END $$;

-- ─── ledger:stamp:begin ──────────────────────────────────────────────
-- Machine-generated by scripts/migration-ledger.mjs --stamp. Do not hand-edit.
-- The checksum is of THIS FILE WITH THIS BLOCK STRIPPED, which is what lets the file
-- carry its own stamp. Everything between the markers is excluded from the checksum
-- but still runs — so it may contain NOTHING but this INSERT. See the note in the
-- generator: anything else here would execute on paste while leaving no trace in the
-- hash, and the ledger would be attesting a file it never actually verified.
--
-- This is also the LAST statement inside BEGIN/COMMIT: if a paste is truncated before
-- it, COMMIT is never reached and nothing applies.
INSERT INTO public.schema_migrations_applied (filename, checksum)
VALUES ('20261158_pasatiempo_data.sql', '41af1ed40d3012b8790ffb47da94bb39bc523f90b5d73f16fbfbd7b99c7a6d53')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;
