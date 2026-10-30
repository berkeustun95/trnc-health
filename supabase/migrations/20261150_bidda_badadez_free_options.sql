-- ═══════════════════════════════════════════════════════════════════════════
-- 20261150 — Bidda Badadez: free options (+/- domates, maydanoz) as real rows; price 0 = FREE, STILL INACTIVE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ONE SCHEMA CHANGE, THEN DATA. Bidda stays is_active = false: every client role still sees NOTHING of this partner, its
-- menu or its options (asserted below as anon and as authenticated, postgres the positive control). The ADA Preview key
-- sees it through the existing eatery_*_select_preview policies (20261119/1120/1134), unchanged. No policy, no grant.
--
-- SCHEMA: eatery_item_options_price_check (20261134) was `price IS NULL OR price > 0`; it becomes
--   `price IS NULL OR price >= 0`. The meaning of an option's price after this file:
--     NULL  = hidden extra (the app skips it, create_eatery_order refuses it) — and the only legal value of a removal
--     0     = FREE extra (shown without a price, orderable, adds nothing to the total)
--     > 0   = priced extra (Crunchy's, untouched)
--   eatery_item_options_remove_shape_check is unchanged: a 'remove' row has price NULL and max_qty 1. The table comment
--   (20261134) said "own price; price NULL = hidden" and is replaced with the new wording.
--
-- DATA (Berke 2026-10-30; the owner's "eklenebilir/çıkarılabilir" ingredients become real options):
--   Bidda Badadez Sade        +domates, +maydanoz
--   Bidda Badadez Hellim      −domates, +maydanoz
--   Bidda Badadez Şiş Köfte   −domates, −maydanoz
--   Bidda Badadez Tavuk Köfte +domates, −maydanoz
--   Bidda Badadez Special     −domates, −maydanoz
--   '+' = kind 'extra', price 0, max_qty 1; '−' = kind 'remove', price NULL, max_qty 1. Exactly 10 rows; the gatmers have
--   none. 1149's three extras (Sade domates, Sade maydanoz, Hellim maydanoz; price NULL) are UPDATED to price 0 IN PLACE
--   (same ids; Hellim maydanoz moves to sort_order 2); 7 rows are inserted. Labels are 1149's nine-language
--   Domates / Maydanoz (full English language names). message_tr: an extra reads "domates" / "maydanoz" (the server
--   prints "+ekstra domates"); a removal reads "domatessiz" / "maydanozsuz" — the removed form the restaurant reads, as
--   Crunchy's "turşusuz" (20261135): create_eatery_order prints a removal's message_tr RAW.
--   Descriptions: the " Eklenebilir/çıkarılabilir: …" suffix is dropped now that the list is real options:
--     Sade   "Bidda ekmeği, badadez"
--     Hellim "Bidda ekmeği, hellim, badadez, domates"
--   Nothing else on the menu, the partner row or any other partner changes.
--   INVISIBLE TODAY either way: the app shows options only inside the WhatsApp basket, and Bidda's order_method is
--   'phone' (create_eatery_order refuses it, unchanged).
--
-- ─── WHO CAN READ / WRITE ───────────────────────────────────────────────────
--   UNCHANGED; no policy or grant is touched. These rows are readable by anyone ONLY once the partner is_active = true
--   (never set here) and by the ADA Preview app's key meanwhile. Writes stay service_role / postgres only. The CHECK is
--   the only thing that moves: it now lets a writer store a price of 0; it still refuses a negative price. A business's
--   own published details; no personal data.
--
-- ─── ORDER / RE-RUNNABLE ────────────────────────────────────────────────────
-- Refuses unless 20261149 is in the ledger. Two accepted states, anything else raises with the live state:
--   1149's end state (7 items with the suffixed descriptions + exactly its 3 option rows, price NULL) => transformed;
--   exactly this file's target (7 items with the trimmed descriptions + exactly these 10 options) => no-op (the CHECK is
--   dropped and re-added identically). The partner must be inactive, phone, pin source partner in both.
-- 20261149 is no longer re-runnable after this file (its options check wants price NULL and the suffixed descriptions);
-- the ledger never re-dispatches it. (Same as 1149 for 1145.)
--
-- Apply: gh workflow run supabase-migrate -f file=20261150_bidda_badadez_free_options.sql (dry), then -f apply=true
-- (Berke approves production-db). No column added: no NOTIFY pgrst.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.eatery_item_options DROP CONSTRAINT IF EXISTS eatery_item_options_price_check;
ALTER TABLE public.eatery_item_options ADD  CONSTRAINT eatery_item_options_price_check
  CHECK (price IS NULL OR price >= 0);

COMMENT ON TABLE public.eatery_item_options IS
  'Per-dish options: kind remove ("Malzeme çıkar", free, qty 1, price NULL) or extra ("Ekstra ekle"; price > 0 = priced, price 0 = free, price NULL = hidden and refused by create_eatery_order). label_i18n = the nine full-English-name languages (app text); message_tr = what the restaurant reads. SELECT for anon/authenticated while the restaurant is live (Preview key: also while not live); writes service_role only. 20261134, price rule 20261150.';

DO $$
DECLARE
  c_id     constant uuid := 'b86bdaa2-1af7-45ac-9d5f-efb9abf5413f';
  c_slug   constant text := 'bidda-badadez';
  c_domates  constant jsonb := '{"English": "Tomato", "Turkish": "Domates", "Arabic": "الطماطم", "Russian": "Помидоры", "Greek": "Ντομάτα", "French": "Tomate", "Spanish": "Tomate", "German": "Tomate", "Persian": "گوجه‌فرنگی"}';
  c_maydanoz constant jsonb := '{"English": "Parsley", "Turkish": "Maydanoz", "Arabic": "البقدونس", "Russian": "Петрушка", "Greek": "Μαϊντανός", "French": "Persil", "Spanish": "Perejil", "German": "Petersilie", "Persian": "جعفری"}';
  -- 1149's menu (the only menu state this file transforms): descriptions with the suffix.
  c_desc_sade_old   constant text := 'Bidda ekmeği, badadez. Eklenebilir/çıkarılabilir: domates, maydanoz';
  c_desc_hellim_old constant text := 'Bidda ekmeği, hellim, badadez, domates. Eklenebilir/çıkarılabilir: maydanoz';
  c_desc_sade_new   constant text := 'Bidda ekmeği, badadez';
  c_desc_hellim_new constant text := 'Bidda ekmeği, hellim, badadez, domates';
  v_menu_new jsonb := $menu$
  [
  {"section": "Dürümler",    "section_order": 1, "name": "Bidda Badadez Sade",        "sort_order": 1, "price": 400, "role": "main", "protein": "none",    "spicy": false, "portion": "meal", "description": "Bidda ekmeği, badadez"},
  {"section": "Dürümler",    "section_order": 1, "name": "Bidda Badadez Hellim",      "sort_order": 2, "price": 450, "role": "main", "protein": "veg",     "spicy": false, "portion": "meal", "description": "Bidda ekmeği, hellim, badadez, domates"},
  {"section": "Dürümler",    "section_order": 1, "name": "Bidda Badadez Şiş Köfte",   "sort_order": 3, "price": 500, "role": "main", "protein": "beef",    "spicy": false, "portion": "meal", "description": "Bidda ekmeği, köfte, badadez, domates, maydanoz"},
  {"section": "Dürümler",    "section_order": 1, "name": "Bidda Badadez Tavuk Köfte", "sort_order": 4, "price": 500, "role": "main", "protein": "chicken", "spicy": false, "portion": "meal", "description": "Bidda ekmeği, tavuk köfte, badadez, maydanoz"},
  {"section": "Dürümler",    "section_order": 1, "name": "Bidda Badadez Special",     "sort_order": 5, "price": 530, "role": "main", "protein": "beef",    "spicy": false, "portion": "meal", "description": "Bidda ekmeği, köfte, hellim, badadez, domates, maydanoz"},
  {"section": "Sac Gatmeri", "section_order": 2, "name": "Sac Gatmeri Gaymak Yağlı",  "sort_order": 1, "price": 300, "role": "side", "protein": "none",    "spicy": false, "portion": null,   "description": null},
  {"section": "Sac Gatmeri", "section_order": 2, "name": "Sac Gatmeri Zeytinyağlı",   "sort_order": 2, "price": 300, "role": "side", "protein": "none",    "spicy": false, "portion": null,   "description": null}
  ]
  $menu$;
  v_p     public.eatery_partners%ROWTYPE;
  v_n     int;
  v_menu_old jsonb;
  v_menu_have jsonb;
  v_opts_old jsonb;
  v_opts_new jsonb;
  v_opts_have jsonb;
  v_others int;
  v_before text; v_after text; v_ibefore text; v_iafter text; v_obefore text; v_oafter text; v_pbefore text; v_pafter text;
  v_active_before text; v_active_after text;
  v_neg text := 'not run'; v_zero text := 'not run'; v_pos text := 'not run';
  v_item bigint;
  v_pos_p int; v_pos_i int; v_pos_o int;
  v_anon_p int; v_anon_i int; v_anon_o int; v_auth_p int; v_auth_i int; v_auth_o int;
  v_ids   bigint[];
BEGIN
  -- ── Pre-state ──
  IF NOT EXISTS (SELECT 1 FROM public.schema_migrations_applied WHERE filename = '20261149_bidda_badadez_owner_data.sql') THEN
    RAISE EXCEPTION '20261149_bidda_badadez_owner_data.sql is not in the ledger: apply it first. Nothing applied.';
  END IF;

  SELECT count(*), md5(COALESCE(string_agg(to_jsonb(p)::text, ',' ORDER BY p.id), ''))
    INTO v_others, v_before FROM public.eatery_partners p WHERE p.id <> c_id;
  SELECT md5(COALESCE(string_agg(to_jsonb(i)::text, ',' ORDER BY i.id), ''))
    INTO v_ibefore FROM public.eatery_menu_items i WHERE i.partner_id <> c_id;
  SELECT md5(COALESCE(string_agg(to_jsonb(o)::text, ',' ORDER BY o.id), ''))
    INTO v_obefore FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id <> c_id;
  SELECT md5(to_jsonb(p)::text) INTO v_pbefore FROM public.eatery_partners p WHERE p.id = c_id;
  SELECT COALESCE(string_agg(slug, ',' ORDER BY slug), '') INTO v_active_before FROM public.eatery_partners WHERE is_active;

  SELECT * INTO v_p FROM public.eatery_partners WHERE id = c_id;
  IF NOT FOUND OR v_p.slug IS DISTINCT FROM c_slug OR v_p.is_active IS DISTINCT FROM false
     OR v_p.order_method IS DISTINCT FROM 'phone' OR v_p.geocode_source IS DISTINCT FROM 'partner' THEN
    RAISE EXCEPTION 'bidda-badadez missing, active, not a phone partner, or without the 1149 pin: %. Nothing applied.', to_jsonb(v_p);
  END IF;

  -- The two accepted option sets, compared whole (dish, kind, message, sort, price, max_qty, availability, labels).
  v_opts_old := $o$
  [
  {"dish": "Bidda Badadez Hellim", "kind": "extra", "message_tr": "maydanoz", "sort_order": 1, "price": null, "max_qty": 1},
  {"dish": "Bidda Badadez Sade",   "kind": "extra", "message_tr": "domates",  "sort_order": 1, "price": null, "max_qty": 1},
  {"dish": "Bidda Badadez Sade",   "kind": "extra", "message_tr": "maydanoz", "sort_order": 2, "price": null, "max_qty": 1}
  ]
  $o$;
  v_opts_new := $o$
  [
  {"dish": "Bidda Badadez Hellim",      "kind": "remove", "message_tr": "domatessiz", "sort_order": 1, "price": null, "max_qty": 1},
  {"dish": "Bidda Badadez Hellim",      "kind": "extra",  "message_tr": "maydanoz",   "sort_order": 2, "price": 0,    "max_qty": 1},
  {"dish": "Bidda Badadez Sade",        "kind": "extra",  "message_tr": "domates",    "sort_order": 1, "price": 0,    "max_qty": 1},
  {"dish": "Bidda Badadez Sade",        "kind": "extra",  "message_tr": "maydanoz",   "sort_order": 2, "price": 0,    "max_qty": 1},
  {"dish": "Bidda Badadez Special",     "kind": "remove", "message_tr": "domatessiz", "sort_order": 1, "price": null, "max_qty": 1},
  {"dish": "Bidda Badadez Special",     "kind": "remove", "message_tr": "maydanozsuz", "sort_order": 2, "price": null, "max_qty": 1},
  {"dish": "Bidda Badadez Tavuk Köfte", "kind": "extra",  "message_tr": "domates",    "sort_order": 1, "price": 0,    "max_qty": 1},
  {"dish": "Bidda Badadez Tavuk Köfte", "kind": "remove", "message_tr": "maydanozsuz", "sort_order": 2, "price": null, "max_qty": 1},
  {"dish": "Bidda Badadez Şiş Köfte",   "kind": "remove", "message_tr": "domatessiz", "sort_order": 1, "price": null, "max_qty": 1},
  {"dish": "Bidda Badadez Şiş Köfte",   "kind": "remove", "message_tr": "maydanozsuz", "sort_order": 2, "price": null, "max_qty": 1}
  ]
  $o$;

  SELECT jsonb_agg(e || jsonb_build_object('is_available', true, 'label_i18n', CASE WHEN e->>'message_tr' LIKE 'domates%' THEN c_domates ELSE c_maydanoz END)
                   ORDER BY e->>'dish', e->>'kind', e->>'message_tr')
    INTO v_opts_old FROM jsonb_array_elements(v_opts_old) e;
  SELECT jsonb_agg(e || jsonb_build_object('is_available', true, 'label_i18n', CASE WHEN e->>'message_tr' LIKE 'domates%' THEN c_domates ELSE c_maydanoz END)
                   ORDER BY e->>'dish', e->>'kind', e->>'message_tr')
    INTO v_opts_new FROM jsonb_array_elements(v_opts_new) e;
  SELECT jsonb_agg(jsonb_build_object('section', e->>'section', 'section_order', (e->>'section_order')::int, 'name', e->>'name',
                                      'sort_order', (e->>'sort_order')::int, 'price', e->'price', 'role', e->>'role', 'protein', e->>'protein',
                                      'spicy', (e->>'spicy')::boolean, 'portion', e->>'portion', 'description', e->>'description')
                   ORDER BY (e->>'section_order')::int, (e->>'sort_order')::int)
    INTO v_menu_new FROM jsonb_array_elements(v_menu_new) e;
  SELECT jsonb_agg(CASE e->>'name'
                     WHEN 'Bidda Badadez Sade'   THEN jsonb_set(e, '{description}', to_jsonb(c_desc_sade_old))
                     WHEN 'Bidda Badadez Hellim' THEN jsonb_set(e, '{description}', to_jsonb(c_desc_hellim_old))
                     ELSE e END
                   ORDER BY (e->>'section_order')::int, (e->>'sort_order')::int)
    INTO v_menu_old FROM jsonb_array_elements(v_menu_new) e;

  SELECT count(*) INTO v_n FROM public.eatery_menu_items
   WHERE partner_id = c_id AND (currency IS DISTINCT FROM 'TRY' OR NOT is_available);
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% bidda-badadez item(s) not TRY or not available. Nothing applied.', v_n;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('section', i.section, 'section_order', i.section_order, 'name', i.name,
                                      'sort_order', i.sort_order, 'price', i.price, 'role', i.role, 'protein', i.protein,
                                      'spicy', i.spicy, 'portion', i.portion, 'description', i.description)
                   ORDER BY i.section_order, i.sort_order)
    INTO v_menu_have FROM public.eatery_menu_items i WHERE i.partner_id = c_id;
  SELECT jsonb_agg(jsonb_build_object('dish', i.name, 'kind', o.kind, 'message_tr', o.message_tr, 'sort_order', o.sort_order,
                                      'price', o.price, 'max_qty', o.max_qty, 'is_available', o.is_available, 'label_i18n', o.label_i18n)
                   ORDER BY i.name, o.kind, o.message_tr)
    INTO v_opts_have FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id = c_id;

  IF v_menu_have IS NOT DISTINCT FROM v_menu_old AND v_opts_have IS NOT DISTINCT FROM v_opts_old THEN
    -- 1149's end state: transform.
    UPDATE public.eatery_menu_items SET description = c_desc_sade_new
     WHERE partner_id = c_id AND name = 'Bidda Badadez Sade' AND description IS NOT DISTINCT FROM c_desc_sade_old;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Sade description update touched % rows. Nothing applied.', v_n; END IF;
    UPDATE public.eatery_menu_items SET description = c_desc_hellim_new
     WHERE partner_id = c_id AND name = 'Bidda Badadez Hellim' AND description IS NOT DISTINCT FROM c_desc_hellim_old;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Hellim description update touched % rows. Nothing applied.', v_n; END IF;
    UPDATE public.eatery_item_options o SET price = 0, sort_order = (w->>'sort_order')::int
      FROM public.eatery_menu_items i, jsonb_array_elements(v_opts_new) w
     WHERE i.id = o.item_id AND i.partner_id = c_id AND o.price IS NULL AND o.kind = 'extra'
       AND i.name = w->>'dish' AND o.kind = w->>'kind' AND o.message_tr = w->>'message_tr' AND w->'price' = '0'::jsonb;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'the 3 existing extras: % rows moved to price 0. Nothing applied.', v_n; END IF;
    INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr, price, max_qty, sort_order, is_available)
    SELECT i.id, w->>'kind', w->'label_i18n', w->>'message_tr', (w->>'price')::numeric, (w->>'max_qty')::smallint, (w->>'sort_order')::int, true
      FROM jsonb_array_elements(v_opts_new) w
      JOIN public.eatery_menu_items i ON i.partner_id = c_id AND i.name = w->>'dish'
     WHERE NOT EXISTS (SELECT 1 FROM public.eatery_item_options x
                        WHERE x.item_id = i.id AND x.kind = w->>'kind' AND x.message_tr = w->>'message_tr');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n IS DISTINCT FROM 7 THEN RAISE EXCEPTION '% option rows inserted, expected 7. Nothing applied.', v_n; END IF;
  ELSIF NOT (v_menu_have IS NOT DISTINCT FROM v_menu_new AND v_opts_have IS NOT DISTINCT FROM v_opts_new) THEN
    SELECT count(*) INTO v_n FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id = c_id;
    RAISE EXCEPTION 'bidda-badadez is neither 1149''s end state nor this file''s target (menu % rows, % option rows; menu: %; options: %). Nothing applied.',
      jsonb_array_length(COALESCE(v_menu_have, '[]')), v_n, v_menu_have, v_opts_have;
  END IF;

  -- ── Post-state ──
  SELECT jsonb_agg(jsonb_build_object('section', i.section, 'section_order', i.section_order, 'name', i.name,
                                      'sort_order', i.sort_order, 'price', i.price, 'role', i.role, 'protein', i.protein,
                                      'spicy', i.spicy, 'portion', i.portion, 'description', i.description)
                   ORDER BY i.section_order, i.sort_order)
    INTO v_menu_have FROM public.eatery_menu_items i WHERE i.partner_id = c_id;
  SELECT jsonb_agg(jsonb_build_object('dish', i.name, 'kind', o.kind, 'message_tr', o.message_tr, 'sort_order', o.sort_order,
                                      'price', o.price, 'max_qty', o.max_qty, 'is_available', o.is_available, 'label_i18n', o.label_i18n)
                   ORDER BY i.name, o.kind, o.message_tr)
    INTO v_opts_have FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id = c_id;
  SELECT count(*) INTO v_n FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id = c_id;
  IF v_menu_have IS DISTINCT FROM v_menu_new OR v_opts_have IS DISTINCT FROM v_opts_new OR v_n IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION 'bidda-badadez is not this file''s target after the write (% option rows). Nothing applied.', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.eatery_menu_items WHERE partner_id = c_id AND description LIKE '%Eklenebilir%';
  IF v_n <> 0 THEN RAISE EXCEPTION '% bidda-badadez description(s) still carry the Eklenebilir suffix. Nothing applied.', v_n; END IF;

  -- ── The CHECK, by behaviour (no pg_get_constraintdef decoding; prod is an older major than the harness) ──
  -- Each probe row is inserted on a Bidda dish and rolled back by a P0001 raise; the variable survives the rollback.
  SELECT id INTO v_item FROM public.eatery_menu_items WHERE partner_id = c_id AND name = 'Bidda Badadez Sade';
  BEGIN
    INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr, price, max_qty, sort_order)
    VALUES (v_item, 'extra', c_domates, 'zz probe', -1, 1, 99);
    v_neg := 'accepted';
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'probe rollback';
  EXCEPTION WHEN check_violation THEN v_neg := 'refused';
            WHEN SQLSTATE 'P0001' THEN NULL;
  END;
  BEGIN
    INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr, price, max_qty, sort_order)
    VALUES (v_item, 'extra', c_domates, 'zz probe', 0, 1, 99);
    v_zero := 'accepted';
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'probe rollback';
  EXCEPTION WHEN check_violation THEN v_zero := 'refused';
            WHEN SQLSTATE 'P0001' THEN NULL;
  END;
  BEGIN
    INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr, price, max_qty, sort_order)
    VALUES (v_item, 'extra', c_domates, 'zz probe', 1.50, 1, 99);
    v_pos := 'accepted';
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'probe rollback';
  EXCEPTION WHEN check_violation THEN v_pos := 'refused';
            WHEN SQLSTATE 'P0001' THEN NULL;
  END;
  IF v_neg IS DISTINCT FROM 'refused' OR v_zero IS DISTINCT FROM 'accepted' OR v_pos IS DISTINCT FROM 'accepted' THEN
    RAISE EXCEPTION 'price CHECK behaves wrongly: price -1 %, price 0 %, price 1.50 % (want refused / accepted / accepted). Nothing applied.', v_neg, v_zero, v_pos;
  END IF;
  v_neg := 'not run';
  BEGIN
    INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr, price, max_qty, sort_order)
    VALUES (v_item, 'remove', c_domates, 'zz probe', 0, 1, 99);
    v_neg := 'accepted';
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'probe rollback';
  EXCEPTION WHEN check_violation THEN v_neg := 'refused';
            WHEN SQLSTATE 'P0001' THEN NULL;
  END;
  IF v_neg IS DISTINCT FROM 'refused' THEN
    RAISE EXCEPTION 'a removal with price 0 was %: the remove-shape CHECK is gone. Nothing applied.', v_neg;
  END IF;

  -- ── Nothing else moved ──
  SELECT md5(COALESCE(string_agg(to_jsonb(p)::text, ',' ORDER BY p.id), '')) INTO v_after FROM public.eatery_partners p WHERE p.id <> c_id;
  SELECT md5(COALESCE(string_agg(to_jsonb(i)::text, ',' ORDER BY i.id), '')) INTO v_iafter FROM public.eatery_menu_items i WHERE i.partner_id <> c_id;
  SELECT md5(COALESCE(string_agg(to_jsonb(o)::text, ',' ORDER BY o.id), ''))
    INTO v_oafter FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id <> c_id;
  SELECT md5(to_jsonb(p)::text) INTO v_pafter FROM public.eatery_partners p WHERE p.id = c_id;
  SELECT COALESCE(string_agg(slug, ',' ORDER BY slug), '') INTO v_active_after FROM public.eatery_partners WHERE is_active;
  IF v_after IS DISTINCT FROM v_before OR v_iafter IS DISTINCT FROM v_ibefore OR v_oafter IS DISTINCT FROM v_obefore THEN
    RAISE EXCEPTION 'another partner, its menu or its options changed (% other partners). Nothing applied.', v_others;
  END IF;
  IF v_pafter IS DISTINCT FROM v_pbefore THEN
    RAISE EXCEPTION 'the bidda-badadez partner row changed. Nothing applied.';
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
  IF v_pos_p IS DISTINCT FROM 1 OR v_pos_i IS DISTINCT FROM 7 OR v_pos_o IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION 'positive control failed: postgres sees % partner / % items / % options', v_pos_p, v_pos_i, v_pos_o;
  END IF;
  IF v_anon_p <> 0 OR v_anon_i <> 0 OR v_anon_o <> 0 OR v_auth_p <> 0 OR v_auth_i <> 0 OR v_auth_o <> 0 THEN
    RAISE EXCEPTION 'inactive partner visible: anon % / % / %, authenticated % / % / %', v_anon_p, v_anon_i, v_anon_o, v_auth_p, v_auth_i, v_auth_o;
  END IF;

  RAISE NOTICE 'bidda-badadez INACTIVE, phone, % menu items, % options (4 free extras price 0, 6 removals); price CHECK: -1 %, 0 %, 1.50 %; anon sees % / % / %, authenticated % / % / % (postgres % / % / %); % other partners unchanged; active set {%}',
    v_pos_i, v_pos_o, 'refused', v_zero, v_pos, v_anon_p, v_anon_i, v_anon_o, v_auth_p, v_auth_i, v_auth_o, v_pos_p, v_pos_i, v_pos_o, v_others, v_active_after;
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
VALUES ('20261150_bidda_badadez_free_options.sql', '0e1c0e0d7b5c582768e0b3d675cb602e337e58856b88c2f0c97ff131fbef7961')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: the 20261150_bidda_badadez_free_options row must read OK.
--
-- ─── Rollback ──
--   Not mechanical. A new migration restoring `price > 0` (after setting the four 0 rows to NULL) and 1149's descriptions;
--   while Bidda is inactive, nothing is visible to app users either way.
