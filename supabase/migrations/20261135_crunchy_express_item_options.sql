-- ═══════════════════════════════════════════════════════════════════════════
-- 20261135 — Crunchy Express: per-dish options ("Malzeme çıkar" removals + hidden "Ekstra ekle" extras)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- DATA ONLY: no schema, policy or grant change. Fills public.eatery_item_options (20261134) for crunchy-express, which is
-- LIVE (is_active since 20261127): anon / guests / users WILL read these rows the moment this applies (asserted below).
-- WHAT THE APP SHOWS: every 'remove' row (free, qty 1). Every 'extra' row is written with price NULL = HIDDEN (not shown,
-- refused by create_eatery_order); prices and max_qty come later, one line per price, when the owner answers.
-- Menu rows (price, name, order, photo, tags) are NOT touched: md5 of every menu row before/after.
--
-- SHAPE: one dictionary of ingredients (key -> label_i18n in the nine full-English-name languages + rm = the Turkish
-- removed form the restaurant reads, ex = the Turkish ingredient the server prints after "+ekstra "), then one list per dish
-- of removal keys and extra keys, expanded into rows; sort_order = list order within the kind. A key used for a kind the
-- dictionary has no message for aborts. Dishes are matched by (partner_id, name), exactly as in 20261122.
-- Not listed = nothing: the Kids Box and the Boxes get no removals, drinks / sides / sauces / desserts get nothing.
-- Excluded on purpose: "çıtır füme" on the BBQ Chicken Burger (unclear what it is).
--
-- Pre-state (abort otherwise): 20261134 in the ledger; the table present; crunchy-express present and ACTIVE; every dish
-- name matches exactly one menu item; the partner has NO option rows (first run) or EXACTLY this file's rows (re-run:
-- every expected row present with the same label and sort_order, no other row). A partial state aborts.
-- RE-RUNNABLE: the second run finds every row and writes nothing. (Price / max_qty / is_available are not compared on a
-- re-run, so a later price migration does not turn this file red; "every extra price NULL" is asserted on the first run.)
-- Post-state: row counts per kind and per dish derived from the literal equal the table's; removals all price NULL / qty 1;
-- no option row for any other partner changed (md5); every menu row unchanged (md5 of to_jsonb); anon reads exactly the
-- rows written, and the options the app shows (removals + priced extras) equal the removal count.
--
-- WHO CAN READ / WRITE: unchanged (20261134 policies). Live partner => anon and authenticated read the options; writes:
-- service_role / this migration only.
--
-- Apply: gh workflow run supabase-migrate -f file=20261135_crunchy_express_item_options.sql (dry), then
-- -f apply=true (Berke approves production-db).
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  c_id   constant uuid := 'bb9dad05-6bb0-4c1c-90fb-cb0a4ad68434';
  -- key -> {l: label_i18n (nine languages), rm: removed form (Turkish), ex: ingredient after "+ekstra " (Turkish)}
  v_ing constant jsonb := $t${
    "peynir": {"rm":"peynirsiz","l":{"English":"Cheese","Turkish":"Peynir","Arabic":"الجبن","Russian":"Сыр","Greek":"Τυρί","French":"Fromage","Spanish":"Queso","German":"Käse","Persian":"پنیر"}},
    "coslow": {"rm":"coslowsuz","l":{"English":"Coleslaw (cabbage salad)","Turkish":"Coslow (lahana salatası)","Arabic":"كولسلو (سلطة الكرنب)","Russian":"Коулслоу (капустный салат)","Greek":"Κόουλσλο (σαλάτα λάχανου)","French":"Coleslaw (salade de chou)","Spanish":"Coleslaw (ensalada de col)","German":"Coleslaw (Krautsalat)","Persian":"کول‌اسلا (سالاد کلم)"}},
    "tursu": {"rm":"turşusuz","l":{"English":"Pickles","Turkish":"Turşu","Arabic":"المخلل","Russian":"Маринованные огурцы","Greek":"Τουρσί","French":"Cornichons","Spanish":"Pepinillos","German":"Gewürzgurken","Persian":"ترشی"}},
    "marul": {"rm":"marulsuz","l":{"English":"Lettuce","Turkish":"Marul","Arabic":"الخس","Russian":"Листья салата","Greek":"Μαρούλι","French":"Laitue","Spanish":"Lechuga","German":"Kopfsalat","Persian":"کاهو"}},
    "ozel_sos": {"rm":"Crunchy özel sossuz","l":{"English":"Crunchy special sauce","Turkish":"Crunchy özel sos","Arabic":"صلصة كرانشي الخاصة","Russian":"Фирменный соус Crunchy","Greek":"Ειδική σάλτσα Crunchy","French":"Sauce spéciale Crunchy","Spanish":"Salsa especial Crunchy","German":"Crunchy-Spezialsauce","Persian":"سس مخصوص کرانچی"}},
    "cirtir_sogan": {"rm":"çıtır soğansız","l":{"English":"Crispy onion","Turkish":"Çıtır soğan","Arabic":"بصل مقرمش","Russian":"Хрустящий лук","Greek":"Τραγανό κρεμμύδι","French":"Oignon croustillant","Spanish":"Cebolla crujiente","German":"Knusprige Zwiebeln","Persian":"پیاز ترد"}},
    "bbq_tursu": {"rm":"barbekü soslu turşusuz","l":{"English":"Pickles in BBQ sauce","Turkish":"Barbekü soslu turşu","Arabic":"مخلل بصلصة الباربيكيو","Russian":"Маринованные огурцы в соусе барбекю","Greek":"Τουρσί με σάλτσα μπάρμπεκιου","French":"Cornichons sauce barbecue","Spanish":"Pepinillos con salsa barbacoa","German":"Gewürzgurken mit BBQ-Sauce","Persian":"ترشی با سس باربیکیو"}},
    "ananasli_hardal": {"rm":"ananaslı hardal sossuz","l":{"English":"Pineapple mustard sauce","Turkish":"Ananaslı hardal sos","Arabic":"صلصة الخردل بالأناناس","Russian":"Горчичный соус с ананасом","Greek":"Σάλτσα μουστάρδας με ανανά","French":"Sauce moutarde à l'ananas","Spanish":"Salsa de mostaza con piña","German":"Ananas-Senfsauce","Persian":"سس خردل با آناناس"}},
    "nashville_sos": {"rm":"Nashville sossuz","l":{"English":"Nashville sauce","Turkish":"Nashville sosu","Arabic":"صلصة ناشفيل","Russian":"Соус Нэшвилл","Greek":"Σάλτσα Nashville","French":"Sauce Nashville","Spanish":"Salsa Nashville","German":"Nashville-Sauce","Persian":"سس نشویل"}},
    "cirtir_ozel_sos": {"rm":"çıtır özel sossuz","l":{"English":"Crispy special sauce","Turkish":"Çıtır özel sos","Arabic":"الصلصة الخاصة المقرمشة","Russian":"Фирменный хрустящий соус","Greek":"Ειδική τραγανή σάλτσα","French":"Sauce spéciale croustillante","Spanish":"Salsa especial crujiente","German":"Knusprige Spezialsauce","Persian":"سس مخصوص ترد"}},
    "truf_sos": {"rm":"trüf sossuz","l":{"English":"Truffle sauce","Turkish":"Trüf sos","Arabic":"صلصة الكمأ","Russian":"Трюфельный соус","Greek":"Σάλτσα τρούφας","French":"Sauce truffe","Spanish":"Salsa de trufa","German":"Trüffelsauce","Persian":"سس ترافل"}},
    "parmesan": {"rm":"parmesansız","l":{"English":"Parmesan","Turkish":"Parmesan","Arabic":"بارميزان","Russian":"Пармезан","Greek":"Παρμεζάνα","French":"Parmesan","Spanish":"Parmesano","German":"Parmesan","Persian":"پارمزان"}},
    "frenk_sogani": {"rm":"frenk soğansız","l":{"English":"Chives","Turkish":"Frenk soğanı","Arabic":"الثوم المعمّر","Russian":"Шнитт-лук","Greek":"Σχοινόπρασο","French":"Ciboulette","Spanish":"Cebollino","German":"Schnittlauch","Persian":"شیو (پیازچه ریز)"}},
    "aci_sos": {"rm":"acı sossuz","l":{"English":"Hot sauce","Turkish":"Acı sos","Arabic":"صلصة حارة","Russian":"Острый соус","Greek":"Καυτερή σάλτσα","French":"Sauce piquante","Spanish":"Salsa picante","German":"Scharfe Sauce","Persian":"سس تند"}},
    "ranch": {"rm":"ranch sossuz","l":{"English":"Ranch sauce","Turkish":"Ranch sos","Arabic":"صلصة رانش","Russian":"Соус ранч","Greek":"Σάλτσα ranch","French":"Sauce ranch","Spanish":"Salsa ranch","German":"Ranch-Sauce","Persian":"سس رنچ"}},
    "chipotle_sos": {"rm":"chipotle sossuz","l":{"English":"Chipotle sauce","Turkish":"Chipotle sos","Arabic":"صلصة تشيبوتلي","Russian":"Соус чипотле","Greek":"Σάλτσα chipotle","French":"Sauce chipotle","Spanish":"Salsa chipotle","German":"Chipotle-Sauce","Persian":"سس چیپوتله"}},
    "mayonez": {"rm":"mayonezsiz","l":{"English":"Mayonnaise","Turkish":"Mayonez","Arabic":"المايونيز","Russian":"Майонез","Greek":"Μαγιονέζα","French":"Mayonnaise","Spanish":"Mayonesa","German":"Mayonnaise","Persian":"مایونز"}},
    "aci_bal_sos": {"rm":"acı bal sossuz","l":{"English":"Hot honey sauce","Turkish":"Acı bal sos","Arabic":"صلصة العسل الحار","Russian":"Острый медовый соус","Greek":"Καυτερή σάλτσα μελιού","French":"Sauce au miel pimenté","Spanish":"Salsa de miel picante","German":"Scharfe Honigsauce","Persian":"سس عسل تند"}},
    "kasar_sos": {"rm":"kaşar sossuz","l":{"English":"Kashar cheese sauce","Turkish":"Kaşar peyniri sos","Arabic":"صلصة جبن القشقوان","Russian":"Соус из сыра кашар","Greek":"Σάλτσα τυριού κασέρι","French":"Sauce au fromage kashar","Spanish":"Salsa de queso kashar","German":"Kashar-Käsesauce","Persian":"سس پنیر کشر"}},
    "sogan": {"rm":"soğansız","l":{"English":"Onion","Turkish":"Soğan","Arabic":"البصل","Russian":"Лук","Greek":"Κρεμμύδι","French":"Oignon","Spanish":"Cebolla","German":"Zwiebeln","Persian":"پیاز"}},
    "ketcap": {"rm":"ketçapsız","l":{"English":"Ketchup","Turkish":"Ketçap","Arabic":"الكاتشب","Russian":"Кетчуп","Greek":"Κέτσαπ","French":"Ketchup","Spanish":"Kétchup","German":"Ketchup","Persian":"کچاپ"}},
    "cheddar": {"rm":"cheddarsız","ex":"cheddar","l":{"English":"Cheddar","Turkish":"Cheddar","Arabic":"تشيدر","Russian":"Чеддер","Greek":"Τσένταρ","French":"Cheddar","Spanish":"Cheddar","German":"Cheddar","Persian":"چدار"}},
    "bbq_sos": {"rm":"barbekü sossuz","l":{"English":"BBQ sauce","Turkish":"Barbekü sos","Arabic":"صلصة الباربيكيو","Russian":"Соус барбекю","Greek":"Σάλτσα μπάρμπεκιου","French":"Sauce barbecue","Spanish":"Salsa barbacoa","German":"BBQ-Sauce","Persian":"سس باربیکیو"}},
    "dana_bacon": {"rm":"dana baconsız","ex":"dana bacon","l":{"English":"Beef bacon","Turkish":"Dana bacon","Arabic":"بيكون لحم البقر","Russian":"Говяжий бекон","Greek":"Μπέικον μοσχαρίσιο","French":"Bacon de bœuf","Spanish":"Bacon de ternera","German":"Rinderbacon","Persian":"بیکن گوساله"}},
    "truf_mayo": {"rm":"trüf mayonezsiz","l":{"English":"Truffle mayonnaise","Turkish":"Trüf mayonez","Arabic":"مايونيز الكمأ","Russian":"Трюфельный майонез","Greek":"Μαγιονέζα τρούφας","French":"Mayonnaise à la truffe","Spanish":"Mayonesa de trufa","German":"Trüffelmayonnaise","Persian":"مایونز ترافل"}},
    "domuz_bacon": {"rm":"domuz baconsız","ex":"domuz bacon","l":{"English":"Pork bacon","Turkish":"Domuz bacon","Arabic":"بيكون لحم الخنزير","Russian":"Свиной бекон","Greek":"Μπέικον χοιρινό","French":"Bacon de porc","Spanish":"Bacon de cerdo","German":"Schweinebacon","Persian":"بیکن گوشت خوک"}},
    "smoked_mayo": {"rm":"smoked mayosuz","l":{"English":"Smoked mayo","Turkish":"Smoked mayo","Arabic":"مايونيز مدخن","Russian":"Копчёный майонез","Greek":"Καπνιστή μαγιονέζα","French":"Mayonnaise fumée","Spanish":"Mayonesa ahumada","German":"Geräucherte Mayonnaise","Persian":"مایونز دودی"}},
    "kirmizi_sogan": {"rm":"kırmızı soğansız","l":{"English":"Red onion","Turkish":"Kırmızı soğan","Arabic":"البصل الأحمر","Russian":"Красный лук","Greek":"Κόκκινο κρεμμύδι","French":"Oignon rouge","Spanish":"Cebolla roja","German":"Rote Zwiebeln","Persian":"پیاز قرمز"}},
    "jalapeno_izgara": {"rm":"ızgara jalapeñosuz","l":{"English":"Grilled jalapeño","Turkish":"Izgara jalapeño","Arabic":"هالبينو مشوي","Russian":"Жареный халапеньо","Greek":"Ψητό χαλαπένιο","French":"Jalapeño grillé","Spanish":"Jalapeño a la parrilla","German":"Gegrillte Jalapeños","Persian":"هالوپینو کبابی"}},
    "gouda": {"rm":"goudasız","l":{"English":"Gouda","Turkish":"Gouda","Arabic":"غودا","Russian":"Гауда","Greek":"Γκούδα","French":"Gouda","Spanish":"Gouda","German":"Gouda","Persian":"گودا"}},
    "burger_sos": {"rm":"Crunchy burger sossuz","l":{"English":"Crunchy burger sauce","Turkish":"Crunchy burger sos","Arabic":"صلصة برغر كرانشي","Russian":"Соус для бургера Crunchy","Greek":"Σάλτσα μπέργκερ Crunchy","French":"Sauce burger Crunchy","Spanish":"Salsa de hamburguesa Crunchy","German":"Crunchy-Burgersauce","Persian":"سس برگر کرانچی"}},
    "jalapeno": {"rm":"jalapeñosuz","ex":"jalapeño","l":{"English":"Jalapeño","Turkish":"Jalapeño","Arabic":"هالبينو","Russian":"Халапеньо","Greek":"Χαλαπένιο","French":"Jalapeño","Spanish":"Jalapeño","German":"Jalapeño","Persian":"هالوپینو"}},
    "aci_bal": {"rm":"acı balsız","l":{"English":"Hot honey","Turkish":"Acı bal","Arabic":"عسل حار","Russian":"Острый мёд","Greek":"Καυτερό μέλι","French":"Miel pimenté","Spanish":"Miel picante","German":"Scharfer Honig","Persian":"عسل تند"}},
    "tavuk_tenders": {"ex":"tavuk tenders","l":{"English":"Chicken tenders","Turkish":"Tavuk tenders","Arabic":"تندرز الدجاج","Russian":"Куриные тендерсы","Greek":"Τέντερς κοτόπουλου","French":"Tenders de poulet","Spanish":"Tenders de pollo","German":"Chicken Tenders","Persian":"تندر مرغ"}},
    "burger_peyniri": {"ex":"burger peyniri","l":{"English":"Burger cheese","Turkish":"Burger peyniri","Arabic":"جبن البرغر","Russian":"Сыр для бургера","Greek":"Τυρί για μπέργκερ","French":"Fromage à burger","Spanish":"Queso para hamburguesa","German":"Burgerkäse","Persian":"پنیر برگر"}},
    "kofte": {"ex":"köfte","l":{"English":"Smash patty","Turkish":"Smash köfte","Arabic":"قرص لحم سماش","Russian":"Смэш-котлета","Greek":"Smash μπιφτέκι","French":"Steak smash","Spanish":"Carne smash","German":"Smash-Patty","Persian":"کوفته اسمش"}}
  }$t$::jsonb;
  -- [dish name, [removal keys in order], [extra keys in order]]
  v_dishes constant jsonb := $t$[
    ["Crunchy Burger", ["peynir","coslow","tursu","marul","ozel_sos"], ["tavuk_tenders","burger_peyniri"]],
    ["Crunchy BBQ Chicken Burger", ["peynir","cirtir_sogan","bbq_tursu"], ["tavuk_tenders","burger_peyniri"]],
    ["Pineapple Chicken Burger", ["peynir","ananasli_hardal","tursu"], ["tavuk_tenders","burger_peyniri"]],
    ["Nashville Tavuk Burger", ["nashville_sos","cirtir_ozel_sos","peynir","tursu"], ["tavuk_tenders","burger_peyniri"]],
    ["Truffle Chicken Burger", ["truf_sos","tursu","marul","parmesan","frenk_sogani"], ["tavuk_tenders"]],
    ["Buffalo Chicken Burger", ["aci_sos","peynir","ranch","tursu","marul"], ["tavuk_tenders","burger_peyniri"]],
    ["Chipotle Chicken Burger", ["chipotle_sos","marul","tursu","peynir"], ["tavuk_tenders","burger_peyniri"]],
    ["Hot Honey Glazed Chicken Burger", ["peynir","tursu","mayonez","aci_bal_sos"], ["tavuk_tenders","burger_peyniri"]],
    ["Cheeseme Chicken Burger", ["kasar_sos","tursu","marul","mayonez"], ["tavuk_tenders"]],
    ["TNT Chicken Burger", ["marul","tursu","peynir","ranch"], ["tavuk_tenders","burger_peyniri"]],
    ["Express Smash Burger", ["sogan","tursu","ketcap","mayonez","cheddar"], ["kofte","cheddar"]],
    ["BBQ Smash Burger", ["cirtir_sogan","bbq_sos","mayonez","dana_bacon","cheddar","tursu"], ["kofte","cheddar","dana_bacon"]],
    ["Trüf Smash Burger", ["dana_bacon","truf_mayo","tursu"], ["kofte","dana_bacon"]],
    ["Big Pork Smash Burger", ["domuz_bacon","smoked_mayo","tursu","peynir","kirmizi_sogan"], ["kofte","domuz_bacon"]],
    ["Jalapeño Drip Smash Burger", ["jalapeno_izgara","gouda","burger_sos"], ["kofte","jalapeno"]],
    ["Crunchy Box", [], ["tavuk_tenders"]],
    ["Crunchy Box XL", [], ["tavuk_tenders"]],
    ["Crunchy Box XXL", [], ["tavuk_tenders"]],
    ["Veggy Smash Burger", ["peynir","tursu","burger_sos"], ["burger_peyniri"]],
    ["Crunchy Classic Nachos", ["jalapeno","ozel_sos","cheddar"], ["jalapeno"]],
    ["Buffalo Nachos", ["parmesan","cheddar"], []],
    ["Hot Honey Nachos", ["aci_bal","cheddar"], []]
  ]$t$::jsonb;
  v_p public.eatery_partners%ROWTYPE;
  v_rows jsonb;
  v_total int; v_rm int; v_ex int; v_dish_n int; v_have int; v_n int; v_upd int; v_bad text; v_anon int; v_anon_shown int;
  v_exp text; v_got text; v_pg int;
  v_menu_before text; v_menu_after text; v_part_before text; v_part_after text; v_oth_before text; v_oth_after text;
BEGIN
  -- ─── The literal: expand, validate, count ────────────────────────────────
  SELECT jsonb_agg(jsonb_build_object('dish', dn.d->>0, 'kind', k.kind, 'key', k.key, 'ord', k.ord,
                                      'label', v_ing -> k.key -> 'l',
                                      'msg', v_ing -> k.key ->> (CASE k.kind WHEN 'remove' THEN 'rm' ELSE 'ex' END))
                   ORDER BY dn.n, k.kind DESC, k.ord)
    INTO v_rows
    FROM jsonb_array_elements(v_dishes) WITH ORDINALITY dn(d, n)
         CROSS JOIN LATERAL (
           SELECT 'remove'::text AS kind, e.key, e.ord FROM jsonb_array_elements_text(dn.d -> 1) WITH ORDINALITY e(key, ord)
           UNION ALL
           SELECT 'extra'::text, e.key, e.ord FROM jsonb_array_elements_text(dn.d -> 2) WITH ORDINALITY e(key, ord)
         ) k;
  IF v_rows IS NULL THEN RAISE EXCEPTION 'the literal expands to no rows'; END IF;
  v_total := jsonb_array_length(v_rows);
  SELECT count(*) FILTER (WHERE r->>'kind' = 'remove'), count(*) FILTER (WHERE r->>'kind' = 'extra')
    INTO v_rm, v_ex FROM jsonb_array_elements(v_rows) r;
  SELECT count(DISTINCT d->>0) INTO v_dish_n FROM jsonb_array_elements(v_dishes) d;
  IF v_dish_n IS DISTINCT FROM jsonb_array_length(v_dishes) THEN RAISE EXCEPTION 'a dish is listed twice in the literal'; END IF;
  IF v_rm + v_ex IS DISTINCT FROM v_total THEN RAISE EXCEPTION 'literal: % removals + % extras <> % rows', v_rm, v_ex, v_total; END IF;

  SELECT string_agg(format('%s: key %s has no %s', r->>'dish', r->>'key', r->>'kind'), '; ') INTO v_bad
    FROM jsonb_array_elements(v_rows) r WHERE r->>'msg' IS NULL OR r->'label' IS NULL;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'literal: option without a dictionary entry or message: %. Nothing applied.', v_bad; END IF;
  SELECT string_agg(x.dish || ' / ' || x.kind || ' / ' || x.msg, '; ') INTO v_bad
    FROM (SELECT r->>'dish' AS dish, r->>'kind' AS kind, r->>'msg' AS msg FROM jsonb_array_elements(v_rows) r
           GROUP BY 1, 2, 3 HAVING count(*) > 1) x;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'literal: duplicate (dish, kind, message): %. Nothing applied.', v_bad; END IF;

  RAISE NOTICE 'literal: % rows = % removals on % dishes + % extras (derived)', v_total, v_rm,
    (SELECT count(DISTINCT r->>'dish') FROM jsonb_array_elements(v_rows) r WHERE r->>'kind' = 'remove'), v_ex;

  -- ─── Pre-state ───────────────────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM public.schema_migrations_applied WHERE filename = '20261134_eatery_item_options.sql') THEN
    RAISE EXCEPTION '20261134_eatery_item_options.sql is not in the ledger. Nothing applied.';
  END IF;
  IF to_regclass('public.eatery_item_options') IS NULL THEN RAISE EXCEPTION 'public.eatery_item_options is missing. Nothing applied.'; END IF;

  SELECT * INTO v_p FROM public.eatery_partners WHERE id = c_id;
  IF NOT FOUND OR v_p.slug IS DISTINCT FROM 'crunchy-express' OR v_p.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'crunchy-express missing or not active (slug %, is_active %). Nothing applied.', v_p.slug, v_p.is_active;
  END IF;

  SELECT string_agg(format('%s (%s matches)', d->>0, (SELECT count(*) FROM public.eatery_menu_items i WHERE i.partner_id = c_id AND i.name = d->>0)), '; ')
    INTO v_bad
    FROM jsonb_array_elements(v_dishes) d
   WHERE (SELECT count(*) FROM public.eatery_menu_items i WHERE i.partner_id = c_id AND i.name = d->>0) IS DISTINCT FROM 1;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'dish names not matching exactly one menu item: %. Nothing applied.', v_bad; END IF;

  SELECT count(*) INTO v_have FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id = c_id;
  IF v_have NOT IN (0, v_total) THEN
    RAISE EXCEPTION 'partial state: crunchy-express has % option rows, expected 0 (first run) or % (re-run). Nothing applied.', v_have, v_total;
  END IF;
  IF v_have = v_total THEN
    SELECT string_agg(r->>'dish' || ' / ' || (r->>'kind') || ' / ' || (r->>'msg'), '; ') INTO v_bad
      FROM jsonb_array_elements(v_rows) r
     WHERE NOT EXISTS (SELECT 1 FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id
                        WHERE i.partner_id = c_id AND i.name = r->>'dish' AND o.kind = r->>'kind' AND o.message_tr = r->>'msg'
                          AND o.label_i18n IS NOT DISTINCT FROM r->'label' AND o.sort_order IS NOT DISTINCT FROM (r->>'ord')::int);
    IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'crunchy-express has % option rows but they are not this file''s rows (differ: %). Nothing applied.', v_have, v_bad; END IF;
  END IF;

  SELECT md5(coalesce(string_agg(to_jsonb(i)::text, ',' ORDER BY i.id), '')) INTO v_menu_before FROM public.eatery_menu_items i;
  SELECT md5(coalesce(string_agg(to_jsonb(p)::text, ',' ORDER BY p.id), '')) INTO v_part_before FROM public.eatery_partners p;
  SELECT md5(coalesce(string_agg(to_jsonb(o)::text, ',' ORDER BY o.id), '')) INTO v_oth_before
    FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id IS DISTINCT FROM c_id;

  -- ─── Write (first run only) ──────────────────────────────────────────────
  v_upd := 0;
  IF v_have = 0 THEN
    INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr, price, max_qty, sort_order)
    SELECT i.id, r->>'kind', r->'label', r->>'msg', NULL, 1, (r->>'ord')::int
      FROM jsonb_array_elements(v_rows) r
      JOIN public.eatery_menu_items i ON i.partner_id = c_id AND i.name = r->>'dish';
    GET DIAGNOSTICS v_upd = ROW_COUNT;
    IF v_upd IS DISTINCT FROM v_total THEN RAISE EXCEPTION 'inserted % rows, expected %', v_upd, v_total; END IF;
  END IF;

  -- ─── Post-state ──────────────────────────────────────────────────────────
  SELECT count(*) INTO v_n FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id = c_id;
  IF v_n IS DISTINCT FROM v_total THEN RAISE EXCEPTION 'after: % option rows, expected % (from the literal)', v_n, v_total; END IF;

  SELECT string_agg(dish || '/' || kind || '=' || n, ',' ORDER BY dish, kind) INTO v_got
    FROM (SELECT i.name AS dish, o.kind, count(*) AS n FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id
           WHERE i.partner_id = c_id GROUP BY 1, 2) x;
  SELECT string_agg(dish || '/' || kind || '=' || n, ',' ORDER BY dish, kind) INTO v_exp
    FROM (SELECT r->>'dish' AS dish, r->>'kind' AS kind, count(*) AS n FROM jsonb_array_elements(v_rows) r GROUP BY 1, 2) x;
  IF v_exp IS DISTINCT FROM v_got THEN RAISE EXCEPTION 'after: per-dish counts % expected (from the literal) %', v_got, v_exp; END IF;

  SELECT count(*) INTO v_n FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id
   WHERE i.partner_id = c_id AND o.kind = 'remove';
  IF v_n IS DISTINCT FROM v_rm THEN RAISE EXCEPTION 'after: % removals, expected %', v_n, v_rm; END IF;
  SELECT count(*) INTO v_n FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id
   WHERE i.partner_id = c_id AND o.kind = 'remove' AND (o.price IS NOT NULL OR o.max_qty IS DISTINCT FROM 1 OR NOT o.is_available);
  IF v_n <> 0 THEN RAISE EXCEPTION 'after: % removals with a price, a qty other than 1 or unavailable', v_n; END IF;
  IF v_have = 0 THEN
    SELECT count(*) INTO v_n FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id
     WHERE i.partner_id = c_id AND o.kind = 'extra' AND (o.price IS NOT NULL OR o.max_qty IS DISTINCT FROM 1);
    IF v_n <> 0 THEN RAISE EXCEPTION 'after: % extras with a price or a qty other than 1 (all must be hidden)', v_n; END IF;
  END IF;

  -- Nothing else moved.
  SELECT md5(coalesce(string_agg(to_jsonb(i)::text, ',' ORDER BY i.id), '')) INTO v_menu_after FROM public.eatery_menu_items i;
  IF v_menu_after IS DISTINCT FROM v_menu_before THEN RAISE EXCEPTION 'after: a menu row changed (% -> %)', v_menu_before, v_menu_after; END IF;
  SELECT md5(coalesce(string_agg(to_jsonb(p)::text, ',' ORDER BY p.id), '')) INTO v_part_after FROM public.eatery_partners p;
  IF v_part_after IS DISTINCT FROM v_part_before THEN RAISE EXCEPTION 'after: a partner row changed (% -> %)', v_part_before, v_part_after; END IF;
  SELECT md5(coalesce(string_agg(to_jsonb(o)::text, ',' ORDER BY o.id), '')) INTO v_oth_after
    FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id IS DISTINCT FROM c_id;
  IF v_oth_after IS DISTINCT FROM v_oth_before THEN RAISE EXCEPTION 'after: another partner''s option rows changed'; END IF;

  -- Anon reads them now (the partner is live). Positive control: postgres sees the same total.
  SELECT count(*) INTO v_pg FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id = c_id;
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.headers', '', true);
  SELECT count(*), count(*) FILTER (WHERE o.kind = 'remove' OR o.price IS NOT NULL)
    INTO v_anon, v_anon_shown
    FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id = c_id;
  RESET ROLE;
  IF v_anon IS DISTINCT FROM v_pg OR v_anon IS DISTINCT FROM v_total THEN
    RAISE EXCEPTION 'anon reads % option rows, postgres reads %, the literal has %', v_anon, v_pg, v_total;
  END IF;
  IF v_have = 0 AND v_anon_shown IS DISTINCT FROM v_rm THEN
    RAISE EXCEPTION 'anon sees % shown options (removals + priced extras), expected % removals', v_anon_shown, v_rm;
  END IF;

  RAISE NOTICE 'crunchy-express options: % rows written (% removals on % dishes, % hidden extras); anon reads %, app shows %; menu, partners and other partners'' options unchanged',
    v_upd, v_rm, (SELECT count(DISTINCT r->>'dish') FROM jsonb_array_elements(v_rows) r WHERE r->>'kind' = 'remove'), v_ex, v_anon, v_anon_shown;
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
VALUES ('20261135_crunchy_express_item_options.sql', '8abd1945f93dbf5b47bbd5f6846d127f2e3561cc83634b8943f677cb7e976d05')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: the 20261135_crunchy_express_item_options row must read OK.
--
-- ─── Rollback (removes only Crunchy's options; the menu is untouched) ──
--   DELETE FROM public.eatery_item_options WHERE item_id IN
--     (SELECT id FROM public.eatery_menu_items WHERE partner_id = 'bb9dad05-6bb0-4c1c-90fb-cb0a4ad68434');
