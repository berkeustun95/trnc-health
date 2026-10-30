-- ═══════════════════════════════════════════════════════════════════════════
-- 20261149 — Bidda Badadez: the owner's data (menu, prices, hours, pin, menu date, add options), STILL INACTIVE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- DATA ONLY, NO SCHEMA, NO POLICY, NO GRANT. Bidda stays is_active = false: every client role still sees NOTHING of this
-- partner, its menu or its options (asserted below as anon and as authenticated, postgres the positive control). The ADA
-- Preview key sees it through the existing eatery_*_select_preview policies (20261119/1120/1134), unchanged.
--
-- SOURCE: the owner, relayed by Berke 2026-10-30 (owner-approved data and images).
--
-- PARTNER (row b86bdaa2-…, slug bidda-badadez):
--   opening_hours  Mon–Fri 08:00–15:30, Sat 09:00–15:00, Sun closed ("sun": null, explicit).
--   lat / lng      35.19837981292723, 33.35504737423376, geocode_source 'partner' (sent by the owner; NOT the Google
--                  coords 1145 refused to store).
--   menu_verified_on 2026-10-30.
--   logo_path stays NULL here: the eatery-images workflow sets it (it needs this file's pin and menu date first).
--
-- MENU (1145's 8 rows -> the owner's 7). Sections in Turkish for every language, like Crunchy (section titles are raw
-- DB text, no i18n). The five wraps are UPDATED in place (same ids), the three Hamur İşleri rows are DELETED (no orders
-- can reference them: 20261144 refuses orders for a phone partner; they have no option rows), two rows are INSERTED.
--   "Dürümler"     Bidda Badadez Sade 400, Bidda Badadez Hellim 450 (was "Hellimli"), Bidda Badadez Şiş Köfte 500,
--                  Bidda Badadez Tavuk Köfte 500, Bidda Badadez Special 530 TL.
--   "Sac Gatmeri"  Sac Gatmeri Gaymak Yağlı 300, Sac Gatmeri Zeytinyağlı 300 TL (no description: the owner gave none).
--   Removed: Katmer, Hellim Böreği, Kıyma Böreği.
--   Descriptions: the owner's İçerik lines, with "Bidda ekmeği" first (every wrap comes in bidda bread, the owner's
--   words via Berke), and his "Eklenebilir/çıkarılabilir" list verbatim where he gave one.
--   Dish-finder tags (PROVISIONAL, Berke): wraps main / meal (Sade none, Hellim veg, Şiş beef, Tavuk chicken, Special
--   beef); both gatmers side / none / no portion (eatery_menu_items_tags_check). spicy false everywhere.
--
-- OPTIONS (eatery_item_options, 20261134), Berke 2026-10-30: description AND 3 ADD options ('extra'), nothing else. The
--   owner's "eklenebilir/çıkarılabilir" ingredients are not in the dish's İçerik, so they are additions: Sade +domates,
--   +maydanoz; Hellim +maydanoz (message_tr "domates" / "maydanoz"; the server prints "+ekstra domates"). No option on any
--   other dish. FREE at Bidda, but stored with price NULL: eatery_item_options_price_check allows only NULL or > 0, and
--   NULL means hidden (the app skips it, create_eatery_order refuses it). Berke left the call to Code 2026-10-30: no
--   schema change for rows nobody can see. INVISIBLE TODAY either way: the app shows options only inside the WhatsApp
--   basket, and Bidda's order_method is 'phone' (EateryPartnerScreen: the sheet is gated on `ordering`). If Bidda ever
--   takes basket orders, free add-ons first need a schema change (price 0 allowed and shown as free). Labels in the nine
--   languages, same form as Crunchy's (20261135).
--
-- ─── WHO CAN READ / WRITE ───────────────────────────────────────────────────
--   UNCHANGED; no policy or grant is touched. All rows here are readable by anyone ONLY once is_active = true (never set
--   here) and by the ADA Preview app's key meanwhile. Writes stay service_role / postgres only. A business's own
--   published details; no personal data.
--
-- ─── ORDER / RE-RUNNABLE ────────────────────────────────────────────────────
-- Refuses unless 20261145 is in the ledger. Two accepted states, anything else raises with the live state:
--   partner: exactly what 1145 left (no pin, hours, menu date, logo) => updated; already this file's target => no-op
--            (logo_path then free: the image upload may have set it). is_active must be false in both.
--   menu:    exactly 1145's 8 rows => transformed; exactly this file's 7 => no-op. Options: none => inserted; exactly
--            these 3 => no-op.
-- 20261145 is no longer re-runnable after this file (its menu check would refuse); the ledger never re-dispatches it.
--
-- Apply: gh workflow run supabase-migrate -f file=20261149_bidda_badadez_owner_data.sql (dry), then -f apply=true
-- (Berke approves production-db). Data only: no NOTIFY pgrst. Then: eatery-images -f slug=bidda-badadez.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  c_id     constant uuid := 'b86bdaa2-1af7-45ac-9d5f-efb9abf5413f';
  c_slug   constant text := 'bidda-badadez';
  c_lat    constant double precision := 35.19837981292723;
  c_lng    constant double precision := 33.35504737423376;
  c_hours  constant jsonb := '{"mon": {"open": "08:00", "close": "15:30"}, "tue": {"open": "08:00", "close": "15:30"}, "wed": {"open": "08:00", "close": "15:30"}, "thu": {"open": "08:00", "close": "15:30"}, "fri": {"open": "08:00", "close": "15:30"}, "sat": {"open": "09:00", "close": "15:00"}, "sun": null}';
  c_menu_date constant date := DATE '2026-10-30';
  -- 1145's menu, as that file wrote it (the only state this file transforms).
  v_old   constant jsonb := $old$
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
  $old$;
  -- The owner's menu. "was" = the 1145 name this row is updated from (null = inserted).
  v_menu  constant jsonb := $menu$
  [
  {"was": "Bidda Badadez Sade",        "section": "Dürümler",    "section_order": 1, "name": "Bidda Badadez Sade",        "sort_order": 1, "price": 400, "role": "main", "protein": "none",    "spicy": false, "portion": "meal",
   "description": "Bidda ekmeği, badadez. Eklenebilir/çıkarılabilir: domates, maydanoz"},
  {"was": "Bidda Badadez Hellimli",    "section": "Dürümler",    "section_order": 1, "name": "Bidda Badadez Hellim",      "sort_order": 2, "price": 450, "role": "main", "protein": "veg",     "spicy": false, "portion": "meal",
   "description": "Bidda ekmeği, hellim, badadez, domates. Eklenebilir/çıkarılabilir: maydanoz"},
  {"was": "Bidda Badadez Şiş Köfte",   "section": "Dürümler",    "section_order": 1, "name": "Bidda Badadez Şiş Köfte",   "sort_order": 3, "price": 500, "role": "main", "protein": "beef",    "spicy": false, "portion": "meal",
   "description": "Bidda ekmeği, köfte, badadez, domates, maydanoz"},
  {"was": "Bidda Badadez Tavuk Köfte", "section": "Dürümler",    "section_order": 1, "name": "Bidda Badadez Tavuk Köfte", "sort_order": 4, "price": 500, "role": "main", "protein": "chicken", "spicy": false, "portion": "meal",
   "description": "Bidda ekmeği, tavuk köfte, badadez, maydanoz"},
  {"was": "Bidda Badadez Special",     "section": "Dürümler",    "section_order": 1, "name": "Bidda Badadez Special",     "sort_order": 5, "price": 530, "role": "main", "protein": "beef",    "spicy": false, "portion": "meal",
   "description": "Bidda ekmeği, köfte, hellim, badadez, domates, maydanoz"},
  {"was": null,                        "section": "Sac Gatmeri", "section_order": 2, "name": "Sac Gatmeri Gaymak Yağlı",  "sort_order": 1, "price": 300, "role": "side", "protein": "none",    "spicy": false, "portion": null,
   "description": null},
  {"was": null,                        "section": "Sac Gatmeri", "section_order": 2, "name": "Sac Gatmeri Zeytinyağlı",   "sort_order": 2, "price": 300, "role": "side", "protein": "none",    "spicy": false, "portion": null,
   "description": null}
  ]
  $menu$;
  c_removed constant text[] := ARRAY['Katmer', 'Hellim Böreği', 'Kıyma Böreği'];
  v_opts  constant jsonb := $opts$
  [
  {"dish": "Bidda Badadez Sade",   "sort_order": 1, "message_tr": "domates",
   "label_i18n": {"English": "Tomato", "Turkish": "Domates", "Arabic": "الطماطم", "Russian": "Помидоры", "Greek": "Ντομάτα", "French": "Tomate", "Spanish": "Tomate", "German": "Tomate", "Persian": "گوجه‌فرنگی"}},
  {"dish": "Bidda Badadez Sade",   "sort_order": 2, "message_tr": "maydanoz",
   "label_i18n": {"English": "Parsley", "Turkish": "Maydanoz", "Arabic": "البقدونس", "Russian": "Петрушка", "Greek": "Μαϊντανός", "French": "Persil", "Spanish": "Perejil", "German": "Petersilie", "Persian": "جعفری"}},
  {"dish": "Bidda Badadez Hellim", "sort_order": 1, "message_tr": "maydanoz",
   "label_i18n": {"English": "Parsley", "Turkish": "Maydanoz", "Arabic": "البقدونس", "Russian": "Петрушка", "Greek": "Μαϊντανός", "French": "Persil", "Spanish": "Perejil", "German": "Petersilie", "Persian": "جعفری"}}
  ]
  $opts$;
  v_p     public.eatery_partners%ROWTYPE;
  v_n     int;
  v_have  jsonb;
  v_want  jsonb;
  v_have_old jsonb;
  v_want_old jsonb;
  v_e     jsonb;
  v_before text; v_after text; v_others int;
  v_ibefore text; v_iafter text;
  v_obefore text; v_oafter text;
  v_active_before text; v_active_after text;
  v_pos_p int; v_pos_i int; v_pos_o int;
  v_anon_p int; v_anon_i int; v_anon_o int; v_auth_p int; v_auth_i int; v_auth_o int;
  v_ids   bigint[];
BEGIN
  -- ── Pre-state ──
  IF NOT EXISTS (SELECT 1 FROM public.schema_migrations_applied WHERE filename = '20261145_bidda_badadez_data.sql') THEN
    RAISE EXCEPTION '20261145_bidda_badadez_data.sql is not in the ledger: apply it first. Nothing applied.';
  END IF;
  IF to_regclass('public.eatery_item_options') IS NULL THEN
    RAISE EXCEPTION 'public.eatery_item_options is missing (20261134 not live). Nothing applied.';
  END IF;

  SELECT count(*), md5(COALESCE(string_agg(to_jsonb(p)::text, ',' ORDER BY p.id), ''))
    INTO v_others, v_before FROM public.eatery_partners p WHERE p.id <> c_id;
  SELECT md5(COALESCE(string_agg(to_jsonb(i)::text, ',' ORDER BY i.id), ''))
    INTO v_ibefore FROM public.eatery_menu_items i WHERE i.partner_id <> c_id;
  SELECT md5(COALESCE(string_agg(to_jsonb(o)::text, ',' ORDER BY o.id), ''))
    INTO v_obefore FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id <> c_id;
  SELECT COALESCE(string_agg(slug, ',' ORDER BY slug), '') INTO v_active_before FROM public.eatery_partners WHERE is_active;

  -- ── Partner ──
  SELECT * INTO v_p FROM public.eatery_partners WHERE id = c_id;
  IF NOT FOUND OR v_p.slug IS DISTINCT FROM c_slug OR v_p.is_active IS DISTINCT FROM false
     OR v_p.order_method IS DISTINCT FROM 'phone' THEN
    RAISE EXCEPTION 'bidda-badadez missing, active, or not a phone partner: %. Nothing applied.', to_jsonb(v_p);
  END IF;
  IF v_p.lat IS NULL AND v_p.lng IS NULL AND v_p.geocode_source IS NULL AND v_p.opening_hours IS NULL
     AND v_p.menu_verified_on IS NULL AND v_p.logo_path IS NULL THEN
    UPDATE public.eatery_partners
       SET lat = c_lat, lng = c_lng, geocode_source = 'partner', opening_hours = c_hours, menu_verified_on = c_menu_date
     WHERE id = c_id AND is_active = false;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'partner update touched % rows. Nothing applied.', v_n; END IF;
    SELECT * INTO v_p FROM public.eatery_partners WHERE id = c_id;
  END IF;
  IF v_p.lat IS DISTINCT FROM c_lat OR v_p.lng IS DISTINCT FROM c_lng OR v_p.geocode_source IS DISTINCT FROM 'partner'
     OR v_p.opening_hours IS DISTINCT FROM c_hours OR v_p.menu_verified_on IS DISTINCT FROM c_menu_date
     OR v_p.name IS DISTINCT FROM 'Bidda Badadez' OR v_p.category IS DISTINCT FROM 'fast_food'
     OR v_p.phone IS DISTINCT FROM '+90 392 228 89 28' OR v_p.whatsapp IS NOT NULL
     OR v_p.region IS DISTINCT FROM 'nicosia' OR v_p.address IS DISTINCT FROM 'Şht. Ertuğrul Arif Sk. No:10, Kızılay, Lefkoşa 99010' THEN
    RAISE EXCEPTION 'bidda-badadez row is neither the 1145 state nor this file''s target: %. Nothing applied.', to_jsonb(v_p);
  END IF;

  -- ── Menu ──
  SELECT jsonb_agg(e ORDER BY (e->>'section_order')::int, (e->>'sort_order')::int) INTO v_want_old FROM jsonb_array_elements(v_old) e;
  SELECT jsonb_agg(e - 'was' ORDER BY (e->>'section_order')::int, (e->>'sort_order')::int) INTO v_want FROM jsonb_array_elements(v_menu) e;
  SELECT jsonb_agg(jsonb_build_object('section', i.section, 'section_order', i.section_order, 'name', i.name,
                                      'sort_order', i.sort_order, 'role', i.role, 'protein', i.protein,
                                      'spicy', i.spicy, 'portion', i.portion)
                   ORDER BY i.section_order, i.sort_order)
    INTO v_have_old FROM public.eatery_menu_items i
   WHERE i.partner_id = c_id AND i.price IS NULL AND i.description IS NULL AND i.photo_path IS NULL
     AND i.currency = 'TRY' AND i.is_available;
  IF v_have_old IS NOT DISTINCT FROM v_want_old
     AND (SELECT count(*) FROM public.eatery_menu_items WHERE partner_id = c_id) = 8 THEN
    IF EXISTS (SELECT 1 FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id = c_id) THEN
      RAISE EXCEPTION 'bidda-badadez 1145 menu already carries option rows. Nothing applied.';
    END IF;
    FOR v_e IN SELECT e FROM jsonb_array_elements(v_menu) e WHERE e->>'was' IS NOT NULL LOOP
      UPDATE public.eatery_menu_items
         SET section = v_e->>'section', section_order = (v_e->>'section_order')::int, name = v_e->>'name',
             sort_order = (v_e->>'sort_order')::int, price = (v_e->>'price')::numeric, description = v_e->>'description',
             role = v_e->>'role', protein = v_e->>'protein', spicy = (v_e->>'spicy')::boolean, portion = v_e->>'portion'
       WHERE partner_id = c_id AND name = v_e->>'was';
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'update of "%" touched % rows. Nothing applied.', v_e->>'was', v_n; END IF;
    END LOOP;
    DELETE FROM public.eatery_menu_items WHERE partner_id = c_id AND name = ANY (c_removed);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'delete of the 3 Hamur İşleri rows touched % rows. Nothing applied.', v_n; END IF;
    INSERT INTO public.eatery_menu_items (partner_id, section, section_order, name, description, price, sort_order,
                                          role, protein, spicy, portion)
    SELECT c_id, e->>'section', (e->>'section_order')::int, e->>'name', e->>'description', (e->>'price')::numeric,
           (e->>'sort_order')::int, e->>'role', e->>'protein', (e->>'spicy')::boolean, e->>'portion'
      FROM jsonb_array_elements(v_menu) e WHERE e->>'was' IS NULL;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('section', i.section, 'section_order', i.section_order, 'name', i.name,
                                      'sort_order', i.sort_order, 'price', i.price, 'role', i.role, 'protein', i.protein,
                                      'spicy', i.spicy, 'portion', i.portion, 'description', i.description)
                   ORDER BY i.section_order, i.sort_order)
    INTO v_have FROM public.eatery_menu_items i WHERE i.partner_id = c_id;
  IF v_have IS DISTINCT FROM v_want THEN
    RAISE EXCEPTION 'bidda-badadez menu is neither 1145''s 8 rows nor this file''s 7 (live: % rows). Nothing applied.', jsonb_array_length(COALESCE(v_have, '[]'));
  END IF;
  SELECT count(*) INTO v_n FROM public.eatery_menu_items
   WHERE partner_id = c_id AND (currency IS DISTINCT FROM 'TRY' OR NOT is_available);
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% bidda-badadez item(s) not TRY or not available. Nothing applied.', v_n;
  END IF;

  -- ── Options ──
  IF NOT EXISTS (SELECT 1 FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id = c_id) THEN
    INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr, price, max_qty, sort_order, is_available)
    SELECT i.id, 'extra', e->'label_i18n', e->>'message_tr', NULL, 1, (e->>'sort_order')::int, true
      FROM jsonb_array_elements(v_opts) e
      JOIN public.eatery_menu_items i ON i.partner_id = c_id AND i.name = e->>'dish';
  END IF;
  SELECT jsonb_agg(e ORDER BY e->>'dish', (e->>'sort_order')::int) INTO v_want FROM jsonb_array_elements(v_opts) e;
  SELECT jsonb_agg(jsonb_build_object('dish', i.name, 'sort_order', o.sort_order, 'message_tr', o.message_tr, 'label_i18n', o.label_i18n)
                   ORDER BY i.name, o.sort_order)
    INTO v_have FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id
   WHERE i.partner_id = c_id AND o.kind = 'extra' AND o.price IS NULL AND o.max_qty = 1 AND o.is_available;
  SELECT count(*) INTO v_n FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id = c_id;
  IF v_have IS DISTINCT FROM v_want OR v_n IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'bidda-badadez options are not exactly this file''s 3 add options (live: % rows). Nothing applied.', v_n;
  END IF;

  -- ── Post-state: nothing else moved ──
  SELECT md5(COALESCE(string_agg(to_jsonb(p)::text, ',' ORDER BY p.id), '')) INTO v_after FROM public.eatery_partners p WHERE p.id <> c_id;
  SELECT md5(COALESCE(string_agg(to_jsonb(i)::text, ',' ORDER BY i.id), '')) INTO v_iafter FROM public.eatery_menu_items i WHERE i.partner_id <> c_id;
  SELECT md5(COALESCE(string_agg(to_jsonb(o)::text, ',' ORDER BY o.id), ''))
    INTO v_oafter FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id <> c_id;
  SELECT COALESCE(string_agg(slug, ',' ORDER BY slug), '') INTO v_active_after FROM public.eatery_partners WHERE is_active;
  IF v_after IS DISTINCT FROM v_before OR v_iafter IS DISTINCT FROM v_ibefore OR v_oafter IS DISTINCT FROM v_obefore THEN
    RAISE EXCEPTION 'another partner, its menu or its options changed (% other partners). Nothing applied.', v_others;
  END IF;
  IF v_active_after IS DISTINCT FROM v_active_before OR v_active_after LIKE '%' || c_slug || '%' THEN
    RAISE EXCEPTION 'active partner set changed: {%} -> {%}. Nothing applied.', v_active_before, v_active_after;
  END IF;

  -- ── Visibility: production roles see nothing (postgres = positive control) ──
  SELECT count(*) INTO v_pos_p FROM public.eatery_partners WHERE id = c_id;
  SELECT count(*) INTO v_pos_i FROM public.eatery_menu_items WHERE partner_id = c_id;
  SELECT count(*) INTO v_pos_o FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id = c_id;
  -- item ids captured as postgres: under RLS a subquery over eatery_menu_items is already empty for these roles.
  SELECT array_agg(id) INTO v_ids FROM public.eatery_menu_items WHERE partner_id = c_id;
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.headers', '', true);
  SELECT count(*) INTO v_anon_p FROM public.eatery_partners WHERE id = c_id;
  SELECT count(*) INTO v_anon_i FROM public.eatery_menu_items WHERE partner_id = c_id;
  SELECT count(*) INTO v_anon_o FROM public.eatery_item_options WHERE item_id = ANY (v_ids);
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'is_anonymous', false)::text, true);
  SELECT count(*) INTO v_auth_p FROM public.eatery_partners WHERE id = c_id;
  SELECT count(*) INTO v_auth_i FROM public.eatery_menu_items WHERE partner_id = c_id;
  SELECT count(*) INTO v_auth_o FROM public.eatery_item_options WHERE item_id = ANY (v_ids);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  IF v_pos_p IS DISTINCT FROM 1 OR v_pos_i IS DISTINCT FROM 7 OR v_pos_o IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'positive control failed: postgres sees % partner / % items / % options', v_pos_p, v_pos_i, v_pos_o;
  END IF;
  IF v_anon_p <> 0 OR v_anon_i <> 0 OR v_anon_o <> 0 OR v_auth_p <> 0 OR v_auth_i <> 0 OR v_auth_o <> 0 THEN
    RAISE EXCEPTION 'inactive partner visible: anon % / % / %, authenticated % / % / %', v_anon_p, v_anon_i, v_anon_o, v_auth_p, v_auth_i, v_auth_o;
  END IF;

  RAISE NOTICE 'bidda-badadez INACTIVE, phone, pin partner, % menu items, % add options (hidden, price NULL); anon sees % / % / %, authenticated % / % / % (postgres % / % / %); % other partners unchanged; active set {%}',
    v_pos_i, v_pos_o, v_anon_p, v_anon_i, v_anon_o, v_auth_p, v_auth_i, v_auth_o, v_pos_p, v_pos_i, v_pos_o, v_others, v_active_after;
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
VALUES ('20261149_bidda_badadez_owner_data.sql', '5d38ce6a8fb1603cd0a7a70917a268c2261d3d80d1720f0e08f8b30519c9a9e7')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: the 20261149_bidda_badadez_owner_data row must read OK.
--
-- ─── Rollback ──
--   Not mechanical (three rows deleted). A new data migration restoring 1145's state if ever needed; while inactive,
--   nothing is visible to app users either way.
