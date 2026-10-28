-- ═══════════════════════════════════════════════════════════════════════════
-- 20261145 — Bidda Badadez: second eatery partner + its 8-item menu, INACTIVE, phone ordering
-- ═══════════════════════════════════════════════════════════════════════════
--
-- DATA ONLY, NO SCHEMA, NO POLICY, NO GRANT. Inserts one eatery_partners row (id b86bdaa2-…, slug bidda-badadez)
-- with is_active = false and order_method = 'phone', and its 8 menu items. Every client role still sees NOTHING of
-- this partner or its menu in production (asserted below as anon and as authenticated, postgres the positive control).
-- The ADA Preview key sees it through the existing eatery_*_select_preview policies (20261119/1120), unchanged.
--
-- SOURCE (Berke, 2026-10-28): agreed partner deal; owner OK'd use of their details, photos and logo.
--   name, phone +90 392 228 89 28, website, Google Maps share link, address (Lefkoşa => region nicosia).
--   category fast_food (Berke, 2026-10-28).
--   order_method phone: no WhatsApp for this partner. 20261144 makes create_eatery_order refuse it.
--
-- Left NULL on purpose (not known, never guessed):
--   whatsapp; menu_url; logo_path (the app's placeholder until the owner sends a logo; images upload separately);
--   opening_hours (opens 08:00, closing time unknown; the owner will confirm); menu_verified_on (prices pending);
--   lat / lng / geocode_source (see PIN below); every menu price.
-- Not stored (Berke: no new columns): the tagline "Vazgeçemediğiniz Lezzet", €5–10 per person, dine-in / takeaway /
-- delivery.
--
-- PIN: Berke's coords 35.1983448, 33.354983 are NOT stored yet. eatery_partners_geocode_source_check allows only
-- 'partner' or 'osm' (no Google pins for eateries), and the source of these coords is not confirmed. A later data
-- migration sets the pin once its provenance is.
--
-- MENU: names from Berke; prices NULL until the owner sends them. Sections ('Bidda Badadez', 'Hamur İşleri') are
-- display groupings, not owner wording.
-- Dish-finder tags are PROVISIONAL, from the dish names (Berke, 2026-10-28), mapped onto the 20261123 vocabulary:
-- halloumi => protein 'veg'; "regular" and Special's "large" => portion 'meal' ('share' = for several people); sides
-- carry no portion (eatery_menu_items_tags_check). The quiz derives a price band from price, so with NULL prices
-- none of these dishes is suggested until prices exist; re-check the tags with the owner when prices arrive.
--
-- ─── WHO CAN READ / WRITE ───────────────────────────────────────────────────
--   UNCHANGED; no policy or grant is touched. The new rows are readable by anyone ONLY once is_active = true (never
--   set here) and by the ADA Preview app's key meanwhile. Writes stay service_role / postgres only. A business's own
--   published details; no personal data.
--
-- ─── ORDER ──────────────────────────────────────────────────────────────────
-- Apply AFTER 20261144_eatery_order_method.sql: this file refuses unless 1144 is in the ledger and the column exists.
-- 1144's first-apply check ("the partner set is exactly {crunchy-express}") therefore always runs before this insert.
--
-- ─── RE-RUNNABLE ────────────────────────────────────────────────────────────
-- Partner: absent => insert; present => every column must already equal its target, else raise.
-- Menu: 0 items => insert; exactly these 8 (all columns) => no-op; anything else raises with the live count.
--
-- Apply: gh workflow run supabase-migrate -f file=20261145_bidda_badadez_data.sql (dry), then -f apply=true
-- (Berke approves production-db). Data only: no NOTIFY pgrst.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  c_id    constant uuid := 'b86bdaa2-1af7-45ac-9d5f-efb9abf5413f';
  c_slug  constant text := 'bidda-badadez';
  v_menu  constant jsonb := $menu$
  [
  {"section": "Bidda Badadez", "section_order": 1, "name": "Bidda Badadez Sade",        "sort_order": 1, "role": "main", "protein": "none",    "spicy": false, "portion": "meal"},
  {"section": "Bidda Badadez", "section_order": 1, "name": "Bidda Badadez Hellimli",    "sort_order": 2, "role": "main", "protein": "veg",     "spicy": false, "portion": "meal"},
  {"section": "Bidda Badadez", "section_order": 1, "name": "Bidda Badadez Şiş Köfte",   "sort_order": 3, "role": "main", "protein": "beef",    "spicy": false, "portion": "meal"},
  {"section": "Bidda Badadez", "section_order": 1, "name": "Bidda Badadez Tavuk Köfte", "sort_order": 4, "role": "main", "protein": "chicken", "spicy": false, "portion": "meal"},
  {"section": "Bidda Badadez", "section_order": 1, "name": "Bidda Badadez Special",     "sort_order": 5, "role": "main", "protein": "beef",    "spicy": false, "portion": "meal"},
  {"section": "Hamur İşleri",  "section_order": 2, "name": "Katmer",                    "sort_order": 1, "role": "side", "protein": "none",    "spicy": false, "portion": null},
  {"section": "Hamur İşleri",  "section_order": 2, "name": "Hellim Böreği",             "sort_order": 2, "role": "side", "protein": "veg",     "spicy": false, "portion": null},
  {"section": "Hamur İşleri",  "section_order": 2, "name": "Kıyma Böreği",              "sort_order": 3, "role": "side", "protein": "beef",    "spicy": false, "portion": null}
  ]
  $menu$;
  v_want  jsonb;
  v_have  jsonb;
  v_p     public.eatery_partners%ROWTYPE;
  v_n     int;
  v_items int;
  v_before text; v_after text; v_others int;
  v_ibefore text; v_iafter text;
  v_active_before text; v_active_after text;
  v_pos_p int; v_pos_i int;
  v_anon_p int; v_anon_i int; v_auth_p int; v_auth_i int;
BEGIN
  -- ── Pre-state ──
  IF NOT EXISTS (SELECT 1 FROM public.schema_migrations_applied WHERE filename = '20261144_eatery_order_method.sql') THEN
    RAISE EXCEPTION '20261144_eatery_order_method.sql is not in the ledger: apply it first. Nothing applied.';
  END IF;
  IF NOT COALESCE((SELECT a.attnotnull FROM pg_attribute a
                    WHERE a.attrelid = 'public.eatery_partners'::regclass AND a.attname = 'order_method' AND NOT a.attisdropped), false) THEN
    RAISE EXCEPTION 'eatery_partners.order_method is missing or nullable (20261144 not live). Nothing applied.';
  END IF;
  SELECT count(*) INTO v_n FROM pg_attribute
   WHERE attrelid = 'public.eatery_menu_items'::regclass AND attname IN ('role','protein','spicy','portion') AND NOT attisdropped;
  IF v_n IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'eatery_menu_items has % of the 4 tag columns (20261123). Nothing applied.', v_n;
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
                                        region, address, opening_hours, logo_path, menu_verified_on, sort_order,
                                        is_active, order_method)
    VALUES (c_id, c_slug, 'Bidda Badadez', 'fast_food', '+90 392 228 89 28', NULL, 'https://biddabadadez.com', NULL,
            'https://g.page/bidda-badadez?share', 'nicosia', 'Şht. Ertuğrul Arif Sk. No:10, Kızılay, Lefkoşa 99010',
            NULL, NULL, NULL, 10, false, 'phone');
    SELECT * INTO v_p FROM public.eatery_partners WHERE id = c_id;
  END IF;
  IF v_p.slug IS DISTINCT FROM c_slug OR v_p.name IS DISTINCT FROM 'Bidda Badadez' OR v_p.category IS DISTINCT FROM 'fast_food'
     OR v_p.phone IS DISTINCT FROM '+90 392 228 89 28' OR v_p.whatsapp IS NOT NULL
     OR v_p.website_url IS DISTINCT FROM 'https://biddabadadez.com' OR v_p.menu_url IS NOT NULL
     OR v_p.maps_url IS DISTINCT FROM 'https://g.page/bidda-badadez?share' OR v_p.region IS DISTINCT FROM 'nicosia'
     OR v_p.address IS DISTINCT FROM 'Şht. Ertuğrul Arif Sk. No:10, Kızılay, Lefkoşa 99010'
     OR v_p.lat IS NOT NULL OR v_p.lng IS NOT NULL OR v_p.geocode_source IS NOT NULL
     OR v_p.opening_hours IS NOT NULL OR v_p.logo_path IS NOT NULL OR v_p.menu_verified_on IS NOT NULL
     OR v_p.sort_order IS DISTINCT FROM 10 OR v_p.is_active IS DISTINCT FROM false OR v_p.order_method IS DISTINCT FROM 'phone'
     OR v_p.adult_only IS DISTINCT FROM false OR v_p.order_requires_account IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'bidda-badadez row exists but differs from this file: %. Nothing applied.', to_jsonb(v_p);
  END IF;

  -- ── Menu ──
  SELECT jsonb_agg(e - 'price' ORDER BY (e->>'section_order')::int, (e->>'sort_order')::int) INTO v_want
    FROM jsonb_array_elements(v_menu) e;
  SELECT count(*) INTO v_items FROM public.eatery_menu_items WHERE partner_id = c_id;
  IF v_items = 0 THEN
    INSERT INTO public.eatery_menu_items (partner_id, section, section_order, name, description, price, sort_order,
                                          role, protein, spicy, portion)
    SELECT c_id, e->>'section', (e->>'section_order')::int, e->>'name', NULL, NULL, (e->>'sort_order')::int,
           e->>'role', e->>'protein', (e->>'spicy')::boolean, e->>'portion'
      FROM jsonb_array_elements(v_menu) e;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('section', i.section, 'section_order', i.section_order, 'name', i.name,
                                      'sort_order', i.sort_order, 'role', i.role, 'protein', i.protein,
                                      'spicy', i.spicy, 'portion', i.portion)
                   ORDER BY i.section_order, i.sort_order)
    INTO v_have FROM public.eatery_menu_items i WHERE i.partner_id = c_id;
  IF v_have IS DISTINCT FROM v_want THEN
    RAISE EXCEPTION 'bidda-badadez menu is not exactly this file''s 8 items (live: % rows). Nothing applied.', jsonb_array_length(COALESCE(v_have, '[]'));
  END IF;
  SELECT count(*) INTO v_n FROM public.eatery_menu_items
   WHERE partner_id = c_id AND (price IS NOT NULL OR description IS NOT NULL OR currency IS DISTINCT FROM 'TRY'
                                OR NOT is_available OR photo_path IS NOT NULL);
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% bidda-badadez item(s) carry a price, description, photo, non-TRY currency or is_available = false. Nothing applied.', v_n;
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
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.headers', '', true);
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
  IF v_pos_p IS DISTINCT FROM 1 OR v_pos_i IS DISTINCT FROM 8 THEN
    RAISE EXCEPTION 'positive control failed: postgres sees % partner / % items', v_pos_p, v_pos_i;
  END IF;
  IF v_anon_p <> 0 OR v_anon_i <> 0 OR v_auth_p <> 0 OR v_auth_i <> 0 THEN
    RAISE EXCEPTION 'inactive partner visible: anon % / %, authenticated % / %', v_anon_p, v_anon_i, v_auth_p, v_auth_i;
  END IF;

  RAISE NOTICE 'bidda-badadez INACTIVE, phone, % menu items (prices NULL); anon sees % / %, authenticated % / % (postgres % / %); % other partners unchanged; active set {%}',
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
VALUES ('20261145_bidda_badadez_data.sql', '387fd24195a5e0f07f097dfd203e8a5676bb69285828ad909e6d128245af8657')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: the 20261145_bidda_badadez_data row must read OK.
--
-- ─── Rollback ──
--   New migration: DELETE FROM public.eatery_partners WHERE id = 'b86bdaa2-1af7-45ac-9d5f-efb9abf5413f';
--   (menu items cascade; only while it was never activated and has no eatery_orders rows, which 20261144 guarantees.)
