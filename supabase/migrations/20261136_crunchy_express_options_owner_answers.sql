-- ═══════════════════════════════════════════════════════════════════════════
-- 20261136 — Crunchy Express options: the restaurant owner's answers (removals fixed, extras priced and visible)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- DATA ONLY: no schema, policy or grant change. Reworks the 20261135 rows of public.eatery_item_options for crunchy-express,
-- which is LIVE: anon / guests / users read these rows the moment this applies (asserted below). The owner's answers:
--   REMOVALS  BBQ Chicken Burger: "barbekü soslu turşu" becomes TWO removals, "barbekü sossuz" + "turşusuz" ("çıtır füme" was
--             never added, nothing to do). Pineapple Chicken Burger gains "marulsuz". Nashville: "çıtır özel sossuz" is now
--             "özel sossuz". Buffalo Chicken Burger: "acı sossuz" is now "buffalo sossuz". TNT gains "füme peynirsiz".
--             Crunchy Classic Nachos: "jalapeñosuz" is now "jalapeño turşusuz". Buffalo Nachos gains "buffalo sossuz".
--   EXTRAS    VISIBLE with prices: the five smash burgers (Express, BBQ, Trüf, Big Pork, Jalapeño Drip) get ekstra köfte 250,
--             ekstra dana bacon 90, ekstra hellim 85 (hellim is a new ingredient); Veggy Smash Burger gets ekstra hellim 85 only;
--             Crunchy Classic / Buffalo / Hot Honey Nachos get ekstra eritilmiş peynir sos 110.
--             DELETED (not hidden): ekstra tavuk tenders (burgers and Boxes), ekstra burger peyniri, ekstra cheddar, ekstra
--             jalapeño. Big Pork's hidden "domuz bacon" extra is replaced by "dana bacon". No sauce extras on burgers.
-- All extras are max_qty 1: the owner gave prices, not limits (one UPDATE per dish when he does).
--
-- UPDATE vs DELETE + INSERT, decided per row (the app marks a basket line whose option ids vanished as "Seçenekler değişti -
-- yeniden seçin", and orders keep a snapshot of the option, never a foreign key to its id):
--   * the SAME ingredient under a better name (Nashville, Buffalo Chicken Burger, Nachos jalapeño turşusu) and a hidden
--     extra that becomes visible (köfte, dana bacon): UPDATE in place, the option id stays, so a held basket keeps working
--     (post-state asserts every one of those ids survived).
--   * the MEANING changed (BBQ Chicken's one "barbekü soslu turşusuz" cannot honestly become either of its two successors):
--     DELETE + INSERT, so a held basket must re-choose rather than silently order something else.
--   * rows the owner said no to: DELETE (extras were hidden, so no basket can hold one).
-- Rows that stay are matched by (dish, kind, message_tr); the "rename" list below names the in-place renames, everything
-- else is derived as a set difference: old rows not in the target are deleted, target rows not in the old are inserted.
--
-- Pre-state (abort otherwise): 20261135 AND 20261134 in the ledger; table present; crunchy-express present and ACTIVE; every
-- dish name matches exactly one menu item; the partner's option rows are EXACTLY what 20261135 wrote (every row present by
-- dish / kind / message / sort_order, price NULL, qty 1, no other row) or EXACTLY this file's rows (re-run: label, message,
-- sort_order and price as written here; nothing is written). Anything else aborts, so a hand-edited table is never overwritten.
-- Every dictionary label must pass eatery_option_label_valid (nine full-English-name languages, <= 60 chars).
-- Post-state: row counts per kind and per dish derived from the literal equal the table's; every table row equals a literal
-- row; removals price NULL / qty 1; every extra priced; the kept option ids still exist; menu, partner rows and other
-- partners' options unchanged (md5); anon reads exactly the rows written and every one is shown.
--
-- WHO CAN READ / WRITE: unchanged (20261134 policies). Live partner => anon and authenticated read the options; writes:
-- service_role / this migration only.
--
-- Apply: gh workflow run supabase-migrate -f file=20261136_crunchy_express_options_owner_answers.sql (dry), then
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
    "tursu": {"rm":"turşusuz","l":{"English":"Pickles","Turkish":"Turşu","Arabic":"المخلل","Russian":"Маринованные огурцы","Greek":"Αγγουράκια τουρσί","French":"Cornichons","Spanish":"Pepinillos","German":"Gewürzgurken","Persian":"خیارشور"}},
    "marul": {"rm":"marulsuz","l":{"English":"Lettuce","Turkish":"Marul","Arabic":"الخس","Russian":"Листья салата","Greek":"Μαρούλι","French":"Laitue","Spanish":"Lechuga","German":"Kopfsalat","Persian":"کاهو"}},
    "ozel_sos": {"rm":"Crunchy özel sossuz","l":{"English":"Crunchy special sauce","Turkish":"Crunchy özel sos","Arabic":"صلصة كرانشي الخاصة","Russian":"Фирменный соус Crunchy","Greek":"Ειδική σάλτσα Crunchy","French":"Sauce spéciale Crunchy","Spanish":"Salsa especial Crunchy","German":"Crunchy-Spezialsauce","Persian":"سس مخصوص کرانچی"}},
    "cirtir_sogan": {"rm":"çıtır soğansız","l":{"English":"Crispy onion","Turkish":"Çıtır soğan","Arabic":"بصل مقرمش","Russian":"Хрустящий лук","Greek":"Τραγανό κρεμμύδι","French":"Oignon croustillant","Spanish":"Cebolla crujiente","German":"Knusprige Zwiebeln","Persian":"پیاز ترد"}},
    "ananasli_hardal": {"rm":"ananaslı hardal sossuz","l":{"English":"Pineapple mustard sauce","Turkish":"Ananaslı hardal sos","Arabic":"صلصة الخردل بالأناناس","Russian":"Горчичный соус с ананасом","Greek":"Σάλτσα μουστάρδας με ανανά","French":"Sauce moutarde à l'ananas","Spanish":"Salsa de mostaza con piña","German":"Ananas-Senfsauce","Persian":"سس خردل با آناناس"}},
    "nashville_sos": {"rm":"Nashville sossuz","l":{"English":"Nashville sauce","Turkish":"Nashville sosu","Arabic":"صلصة ناشفيل","Russian":"Соус Нэшвилл","Greek":"Σάλτσα Nashville","French":"Sauce Nashville","Spanish":"Salsa Nashville","German":"Nashville-Sauce","Persian":"سس نشویل"}},
    "truf_sos": {"rm":"trüf sossuz","l":{"English":"Truffle sauce","Turkish":"Trüf sos","Arabic":"صلصة الكمأ","Russian":"Трюфельный соус","Greek":"Σάλτσα τρούφας","French":"Sauce truffe","Spanish":"Salsa de trufa","German":"Trüffelsauce","Persian":"سس ترافل"}},
    "parmesan": {"rm":"parmesansız","l":{"English":"Parmesan","Turkish":"Parmesan","Arabic":"بارميزان","Russian":"Пармезан","Greek":"Παρμεζάνα","French":"Parmesan","Spanish":"Parmesano","German":"Parmesan","Persian":"پارمزان"}},
    "frenk_sogani": {"rm":"frenk soğansız","l":{"English":"Chives","Turkish":"Frenk soğanı","Arabic":"الثوم المعمّر","Russian":"Шнитт-лук","Greek":"Σχοινόπρασο","French":"Ciboulette","Spanish":"Cebollino","German":"Schnittlauch","Persian":"شیو (پیازچه ریز)"}},
    "ranch": {"rm":"ranch sossuz","l":{"English":"Ranch sauce","Turkish":"Ranch sos","Arabic":"صلصة رانش","Russian":"Соус ранч","Greek":"Σάλτσα ranch","French":"Sauce ranch","Spanish":"Salsa ranch","German":"Ranch-Sauce","Persian":"سس رنچ"}},
    "chipotle_sos": {"rm":"chipotle sossuz","l":{"English":"Chipotle sauce","Turkish":"Chipotle sos","Arabic":"صلصة تشيبوتلي","Russian":"Соус чипотле","Greek":"Σάλτσα chipotle","French":"Sauce chipotle","Spanish":"Salsa chipotle","German":"Chipotle-Sauce","Persian":"سس چیپوتله"}},
    "mayonez": {"rm":"mayonezsiz","l":{"English":"Mayonnaise","Turkish":"Mayonez","Arabic":"المايونيز","Russian":"Майонез","Greek":"Μαγιονέζα","French":"Mayonnaise","Spanish":"Mayonesa","German":"Mayonnaise","Persian":"مایونز"}},
    "aci_bal_sos": {"rm":"acı bal sossuz","l":{"English":"Hot honey sauce","Turkish":"Acı bal sos","Arabic":"صلصة العسل الحار","Russian":"Острый медовый соус","Greek":"Καυτερή σάλτσα μελιού","French":"Sauce au miel pimenté","Spanish":"Salsa de miel picante","German":"Scharfe Honigsauce","Persian":"سس عسل تند"}},
    "kasar_sos": {"rm":"kaşar sossuz","l":{"English":"Kashar cheese sauce","Turkish":"Kaşar peyniri sos","Arabic":"صلصة جبن القشقوان","Russian":"Соус из сыра кашар","Greek":"Σάλτσα τυριού κασέρι","French":"Sauce au fromage kashar","Spanish":"Salsa de queso kashar","German":"Kashar-Käsesauce","Persian":"سس پنیر کاشار"}},
    "sogan": {"rm":"soğansız","l":{"English":"Onion","Turkish":"Soğan","Arabic":"البصل","Russian":"Лук","Greek":"Κρεμμύδι","French":"Oignon","Spanish":"Cebolla","German":"Zwiebeln","Persian":"پیاز"}},
    "ketcap": {"rm":"ketçapsız","l":{"English":"Ketchup","Turkish":"Ketçap","Arabic":"الكاتشب","Russian":"Кетчуп","Greek":"Κέτσαπ","French":"Ketchup","Spanish":"Kétchup","German":"Ketchup","Persian":"کچاپ"}},
    "cheddar": {"rm":"cheddarsız","ex":"cheddar","l":{"English":"Cheddar","Turkish":"Cheddar","Arabic":"تشيدر","Russian":"Чеддер","Greek":"Τσένταρ","French":"Cheddar","Spanish":"Cheddar","German":"Cheddar","Persian":"چدار"}},
    "bbq_sos": {"rm":"barbekü sossuz","l":{"English":"BBQ sauce","Turkish":"Barbekü sos","Arabic":"صلصة الباربيكيو","Russian":"Соус барбекю","Greek":"Σάλτσα μπάρμπεκιου","French":"Sauce barbecue","Spanish":"Salsa barbacoa","German":"BBQ-Sauce","Persian":"سس باربیکیو"}},
    "dana_bacon": {"rm":"dana baconsız","ex":"dana bacon","l":{"English":"Beef bacon","Turkish":"Dana bacon","Arabic":"بيكون لحم البقر","Russian":"Говяжий бекон","Greek":"Μοσχαρίσιο μπέικον","French":"Bacon de bœuf","Spanish":"Bacon de ternera","German":"Rinderbacon","Persian":"بیکن گوشت گاو"}},
    "truf_mayo": {"rm":"trüf mayonezsiz","l":{"English":"Truffle mayonnaise","Turkish":"Trüf mayonez","Arabic":"مايونيز الكمأ","Russian":"Трюфельный майонез","Greek":"Μαγιονέζα τρούφας","French":"Mayonnaise à la truffe","Spanish":"Mayonesa de trufa","German":"Trüffelmayonnaise","Persian":"مایونز ترافل"}},
    "domuz_bacon": {"rm":"domuz baconsız","ex":"domuz bacon","l":{"English":"Pork bacon","Turkish":"Domuz bacon","Arabic":"بيكون لحم الخنزير","Russian":"Свиной бекон","Greek":"Χοιρινό μπέικον","French":"Bacon de porc","Spanish":"Bacon de cerdo","German":"Schweinebacon","Persian":"بیکن گوشت خوک"}},
    "smoked_mayo": {"rm":"smoked mayosuz","l":{"English":"Smoked mayo","Turkish":"Smoked mayo","Arabic":"مايونيز مدخن","Russian":"Копчёный майонез","Greek":"Καπνιστή μαγιονέζα","French":"Mayonnaise fumée","Spanish":"Mayonesa ahumada","German":"Geräucherte Mayonnaise","Persian":"مایونز دودی"}},
    "kirmizi_sogan": {"rm":"kırmızı soğansız","l":{"English":"Red onion","Turkish":"Kırmızı soğan","Arabic":"البصل الأحمر","Russian":"Красный лук","Greek":"Κόκκινο κρεμμύδι","French":"Oignon rouge","Spanish":"Cebolla roja","German":"Rote Zwiebeln","Persian":"پیاز قرمز"}},
    "jalapeno_izgara": {"rm":"ızgara jalapeñosuz","l":{"English":"Grilled jalapeño","Turkish":"Izgara jalapeño","Arabic":"هالبينو مشوي","Russian":"Жареный халапеньо","Greek":"Ψητό χαλαπένιο","French":"Jalapeño grillé","Spanish":"Jalapeño a la parrilla","German":"Gegrillte Jalapeños","Persian":"هالوپینو کبابی"}},
    "gouda": {"rm":"goudasız","l":{"English":"Gouda","Turkish":"Gouda","Arabic":"غودا","Russian":"Гауда","Greek":"Γκούδα","French":"Gouda","Spanish":"Gouda","German":"Gouda","Persian":"گودا"}},
    "burger_sos": {"rm":"Crunchy burger sossuz","l":{"English":"Crunchy burger sauce","Turkish":"Crunchy burger sos","Arabic":"صلصة برغر كرانشي","Russian":"Соус для бургера Crunchy","Greek":"Σάλτσα μπέργκερ Crunchy","French":"Sauce burger Crunchy","Spanish":"Salsa de hamburguesa Crunchy","German":"Crunchy-Burgersauce","Persian":"سس برگر کرانچی"}},
    "aci_bal": {"rm":"acı balsız","l":{"English":"Hot honey","Turkish":"Acı bal","Arabic":"عسل حار","Russian":"Острый мёд","Greek":"Καυτερό μέλι","French":"Miel pimenté","Spanish":"Miel picante","German":"Scharfer Honig","Persian":"عسل تند"}},
    "kofte": {"ex":"köfte","l":{"English":"Smash patty","Turkish":"Smash köfte","Arabic":"قرص لحم سماش","Russian":"Смэш-котлета","Greek":"Smash μπιφτέκι","French":"Steak smash","Spanish":"Carne smash","German":"Smash-Patty","Persian":"پتی اسمش"}},
    "ozel_sos_plain": {"rm":"özel sossuz","l":{"English":"Special sauce","Turkish":"Özel sos","Arabic":"الصلصة الخاصة","Russian":"Фирменный соус","Greek":"Ειδική σάλτσα","French":"Sauce spéciale","Spanish":"Salsa especial","German":"Spezialsauce","Persian":"سس مخصوص"}},
    "buffalo_sos": {"rm":"buffalo sossuz","l":{"English":"Buffalo sauce","Turkish":"Buffalo sos","Arabic":"صلصة بافلو","Russian":"Соус баффало","Greek":"Σάλτσα Buffalo","French":"Sauce buffalo","Spanish":"Salsa Buffalo","German":"Buffalo-Sauce","Persian":"سس بوفالو"}},
    "fume_peynir": {"rm":"füme peynirsiz","l":{"English":"Smoked cheese","Turkish":"Füme peynir","Arabic":"جبن مدخن","Russian":"Копчёный сыр","Greek":"Καπνιστό τυρί","French":"Fromage fumé","Spanish":"Queso ahumado","German":"Räucherkäse","Persian":"پنیر دودی"}},
    "jalapeno_tursusu": {"rm":"jalapeño turşusuz","l":{"English":"Pickled jalapeño","Turkish":"Jalapeño turşusu","Arabic":"هالبينو مخلل","Russian":"Маринованный халапеньо","Greek":"Τουρσί χαλαπένιο","French":"Jalapeño mariné","Spanish":"Jalapeño en escabeche","German":"Eingelegte Jalapeños","Persian":"هالوپینوی ترشی"}},
    "hellim": {"ex":"hellim","l":{"English":"Halloumi","Turkish":"Hellim","Arabic":"حلوم","Russian":"Халуми","Greek":"Χαλλούμι","French":"Halloumi","Spanish":"Halloumi","German":"Halloumi","Persian":"هالومی"}},
    "eritilmis_peynir_sos": {"ex":"eritilmiş peynir sos","l":{"English":"Melted cheese sauce","Turkish":"Eritilmiş peynir sos","Arabic":"صلصة الجبن الذائب","Russian":"Соус из расплавленного сыра","Greek":"Σάλτσα λιωμένου τυριού","French":"Sauce au fromage fondu","Spanish":"Salsa de queso fundido","German":"Schmelzkäsesauce","Persian":"سس پنیر ذوب‌شده"}}
  }$t$::jsonb;
  -- TARGET: [dish name, [removal keys in order], [[extra key, TL price] in order]]
  v_dishes constant jsonb := $t$[
    ["Crunchy Burger", ["peynir", "coslow", "tursu", "marul", "ozel_sos"], []],
    ["Crunchy BBQ Chicken Burger", ["peynir", "cirtir_sogan", "bbq_sos", "tursu"], []],
    ["Pineapple Chicken Burger", ["peynir", "ananasli_hardal", "tursu", "marul"], []],
    ["Nashville Tavuk Burger", ["nashville_sos", "ozel_sos_plain", "peynir", "tursu"], []],
    ["Truffle Chicken Burger", ["truf_sos", "tursu", "marul", "parmesan", "frenk_sogani"], []],
    ["Buffalo Chicken Burger", ["buffalo_sos", "peynir", "ranch", "tursu", "marul"], []],
    ["Chipotle Chicken Burger", ["chipotle_sos", "marul", "tursu", "peynir"], []],
    ["Hot Honey Glazed Chicken Burger", ["peynir", "tursu", "mayonez", "aci_bal_sos"], []],
    ["Cheeseme Chicken Burger", ["kasar_sos", "tursu", "marul", "mayonez"], []],
    ["TNT Chicken Burger", ["marul", "tursu", "peynir", "ranch", "fume_peynir"], []],
    ["Express Smash Burger", ["sogan", "tursu", "ketcap", "mayonez", "cheddar"], [["kofte", 250], ["dana_bacon", 90], ["hellim", 85]]],
    ["BBQ Smash Burger", ["cirtir_sogan", "bbq_sos", "mayonez", "dana_bacon", "cheddar", "tursu"], [["kofte", 250], ["dana_bacon", 90], ["hellim", 85]]],
    ["Trüf Smash Burger", ["dana_bacon", "truf_mayo", "tursu"], [["kofte", 250], ["dana_bacon", 90], ["hellim", 85]]],
    ["Big Pork Smash Burger", ["domuz_bacon", "smoked_mayo", "tursu", "peynir", "kirmizi_sogan"], [["kofte", 250], ["dana_bacon", 90], ["hellim", 85]]],
    ["Jalapeño Drip Smash Burger", ["jalapeno_izgara", "gouda", "burger_sos"], [["kofte", 250], ["dana_bacon", 90], ["hellim", 85]]],
    ["Crunchy Box", [], []],
    ["Crunchy Box XL", [], []],
    ["Crunchy Box XXL", [], []],
    ["Veggy Smash Burger", ["peynir", "tursu", "burger_sos"], [["hellim", 85]]],
    ["Crunchy Classic Nachos", ["jalapeno_tursusu", "ozel_sos", "cheddar"], [["eritilmis_peynir_sos", 110]]],
    ["Buffalo Nachos", ["parmesan", "cheddar", "buffalo_sos"], [["eritilmis_peynir_sos", 110]]],
    ["Hot Honey Nachos", ["aci_bal", "cheddar"], [["eritilmis_peynir_sos", 110]]]
  ]$t$::jsonb;
  -- 20261135 AS WRITTEN (its messages): [dish, [removal messages in order], [extra messages in order]]
  v_old constant jsonb := $t$[
    ["Crunchy Burger", ["peynirsiz", "coslowsuz", "turşusuz", "marulsuz", "Crunchy özel sossuz"], ["tavuk tenders", "burger peyniri"]],
    ["Crunchy BBQ Chicken Burger", ["peynirsiz", "çıtır soğansız", "barbekü soslu turşusuz"], ["tavuk tenders", "burger peyniri"]],
    ["Pineapple Chicken Burger", ["peynirsiz", "ananaslı hardal sossuz", "turşusuz"], ["tavuk tenders", "burger peyniri"]],
    ["Nashville Tavuk Burger", ["Nashville sossuz", "çıtır özel sossuz", "peynirsiz", "turşusuz"], ["tavuk tenders", "burger peyniri"]],
    ["Truffle Chicken Burger", ["trüf sossuz", "turşusuz", "marulsuz", "parmesansız", "frenk soğansız"], ["tavuk tenders"]],
    ["Buffalo Chicken Burger", ["acı sossuz", "peynirsiz", "ranch sossuz", "turşusuz", "marulsuz"], ["tavuk tenders", "burger peyniri"]],
    ["Chipotle Chicken Burger", ["chipotle sossuz", "marulsuz", "turşusuz", "peynirsiz"], ["tavuk tenders", "burger peyniri"]],
    ["Hot Honey Glazed Chicken Burger", ["peynirsiz", "turşusuz", "mayonezsiz", "acı bal sossuz"], ["tavuk tenders", "burger peyniri"]],
    ["Cheeseme Chicken Burger", ["kaşar sossuz", "turşusuz", "marulsuz", "mayonezsiz"], ["tavuk tenders"]],
    ["TNT Chicken Burger", ["marulsuz", "turşusuz", "peynirsiz", "ranch sossuz"], ["tavuk tenders", "burger peyniri"]],
    ["Express Smash Burger", ["soğansız", "turşusuz", "ketçapsız", "mayonezsiz", "cheddarsız"], ["köfte", "cheddar"]],
    ["BBQ Smash Burger", ["çıtır soğansız", "barbekü sossuz", "mayonezsiz", "dana baconsız", "cheddarsız", "turşusuz"], ["köfte", "cheddar", "dana bacon"]],
    ["Trüf Smash Burger", ["dana baconsız", "trüf mayonezsiz", "turşusuz"], ["köfte", "dana bacon"]],
    ["Big Pork Smash Burger", ["domuz baconsız", "smoked mayosuz", "turşusuz", "peynirsiz", "kırmızı soğansız"], ["köfte", "domuz bacon"]],
    ["Jalapeño Drip Smash Burger", ["ızgara jalapeñosuz", "goudasız", "Crunchy burger sossuz"], ["köfte", "jalapeño"]],
    ["Crunchy Box", [], ["tavuk tenders"]],
    ["Crunchy Box XL", [], ["tavuk tenders"]],
    ["Crunchy Box XXL", [], ["tavuk tenders"]],
    ["Veggy Smash Burger", ["peynirsiz", "turşusuz", "Crunchy burger sossuz"], ["burger peyniri"]],
    ["Crunchy Classic Nachos", ["jalapeñosuz", "Crunchy özel sossuz", "cheddarsız"], ["jalapeño"]],
    ["Buffalo Nachos", ["parmesansız", "cheddarsız"], []],
    ["Hot Honey Nachos", ["acı balsız", "cheddarsız"], []]
  ]$t$::jsonb;
  -- in-place renames: [dish, kind, message 20261135 wrote, key of the target row that keeps that row's id]
  v_ren constant jsonb := $t$[
    ["Nashville Tavuk Burger", "remove", "çıtır özel sossuz", "ozel_sos_plain"],
    ["Buffalo Chicken Burger", "remove", "acı sossuz", "buffalo_sos"],
    ["Crunchy Classic Nachos", "remove", "jalapeñosuz", "jalapeno_tursusu"]
  ]$t$::jsonb;
  v_p public.eatery_partners%ROWTYPE;
  v_rows jsonb; v_new jsonb; v_oldrows jsonb;
  v_total int; v_rm int; v_ex int; v_old_total int; v_dish_n int; v_have int; v_n int; v_bad text; v_mode text;
  v_kept bigint[]; v_exp_kept int; v_exp_del int; v_exp_ins int; v_del int; v_upd int; v_ins int;
  v_b_rm int; v_b_ex int; v_b_sec text; v_a_sec text; v_exp text; v_got text; v_pg int; v_anon int; v_anon_shown int;
  v_menu_before text; v_menu_after text; v_part_before text; v_part_after text; v_oth_before text; v_oth_after text;
BEGIN
  -- ─── The literal: expand, validate, count ────────────────────────────────
  SELECT jsonb_agg(jsonb_build_object('dish', dn.d->>0, 'kind', k.kind, 'key', k.key, 'ord', k.ord,
                                      'label', v_ing -> k.key -> 'l',
                                      'msg', v_ing -> k.key ->> (CASE k.kind WHEN 'remove' THEN 'rm' ELSE 'ex' END),
                                      'price', k.price)
                   ORDER BY dn.n, k.kind DESC, k.ord)
    INTO v_rows
    FROM jsonb_array_elements(v_dishes) WITH ORDINALITY dn(d, n)
         CROSS JOIN LATERAL (
           SELECT 'remove'::text AS kind, e.key, e.ord, NULL::numeric AS price
             FROM jsonb_array_elements_text(dn.d -> 1) WITH ORDINALITY e(key, ord)
           UNION ALL
           SELECT 'extra'::text, e.v ->> 0, e.ord, (e.v ->> 1)::numeric
             FROM jsonb_array_elements(dn.d -> 2) WITH ORDINALITY e(v, ord)
         ) k;
  IF v_rows IS NULL THEN RAISE EXCEPTION 'the literal expands to no rows'; END IF;
  -- src = the message the row has TODAY (20261135): the rename source, else its own message.
  SELECT jsonb_agg(r.r || jsonb_build_object('src', coalesce(
           (SELECT x ->> 2 FROM jsonb_array_elements(v_ren) x
             WHERE x ->> 0 = r.r ->> 'dish' AND x ->> 1 = r.r ->> 'kind' AND x ->> 3 = r.r ->> 'key'), r.r ->> 'msg')) ORDER BY r.n)
    INTO v_new FROM jsonb_array_elements(v_rows) WITH ORDINALITY r(r, n);
  v_total := jsonb_array_length(v_new);
  SELECT count(*) FILTER (WHERE r->>'kind' = 'remove'), count(*) FILTER (WHERE r->>'kind' = 'extra')
    INTO v_rm, v_ex FROM jsonb_array_elements(v_new) r;
  SELECT count(DISTINCT d->>0) INTO v_dish_n FROM jsonb_array_elements(v_dishes) d;
  IF v_dish_n IS DISTINCT FROM jsonb_array_length(v_dishes) THEN RAISE EXCEPTION 'a dish is listed twice in the literal'; END IF;
  IF v_rm + v_ex IS DISTINCT FROM v_total THEN RAISE EXCEPTION 'literal: % removals + % extras <> % rows', v_rm, v_ex, v_total; END IF;

  SELECT string_agg(format('%s: key %s has no %s', r->>'dish', r->>'key', r->>'kind'), '; ') INTO v_bad
    FROM jsonb_array_elements(v_new) r WHERE r->>'msg' IS NULL OR r->'label' IS NULL;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'literal: option without a dictionary entry or message: %. Nothing applied.', v_bad; END IF;
  SELECT string_agg(DISTINCT r->>'key', '; ') INTO v_bad
    FROM jsonb_array_elements(v_new) r WHERE NOT public.eatery_option_label_valid(r->'label');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'literal: label not nine full-English-name languages of 1..60 chars for key(s) %. Nothing applied.', v_bad; END IF;
  SELECT string_agg(x.dish || ' / ' || x.kind || ' / ' || x.msg, '; ') INTO v_bad
    FROM (SELECT r->>'dish' AS dish, r->>'kind' AS kind, r->>'msg' AS msg FROM jsonb_array_elements(v_new) r
           GROUP BY 1, 2, 3 HAVING count(*) > 1) x;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'literal: duplicate (dish, kind, message): %. Nothing applied.', v_bad; END IF;
  SELECT string_agg(r->>'dish' || ' / ' || (r->>'msg'), '; ') INTO v_bad
    FROM jsonb_array_elements(v_new) r
   WHERE (r->>'kind' = 'extra' AND (r->>'price' IS NULL OR (r->>'price')::numeric <= 0 OR (r->>'price')::numeric >= 1000000))
      OR (r->>'kind' = 'remove' AND r->>'price' IS NOT NULL);
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'literal: an extra without a positive price, or a removal with one: %. Nothing applied.', v_bad; END IF;

  SELECT jsonb_agg(jsonb_build_object('dish', dn.d->>0, 'kind', k.kind, 'msg', k.msg, 'ord', k.ord) ORDER BY dn.n, k.kind DESC, k.ord)
    INTO v_oldrows
    FROM jsonb_array_elements(v_old) WITH ORDINALITY dn(d, n)
         CROSS JOIN LATERAL (
           SELECT 'remove'::text AS kind, e.msg, e.ord FROM jsonb_array_elements_text(dn.d -> 1) WITH ORDINALITY e(msg, ord)
           UNION ALL
           SELECT 'extra'::text, e.msg, e.ord FROM jsonb_array_elements_text(dn.d -> 2) WITH ORDINALITY e(msg, ord)
         ) k;
  v_old_total := jsonb_array_length(v_oldrows);

  SELECT string_agg(x ->> 0 || ' / ' || (x ->> 2), '; ') INTO v_bad
    FROM jsonb_array_elements(v_ren) x
   WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_oldrows) o WHERE o ->> 'dish' = x ->> 0 AND o ->> 'kind' = x ->> 1 AND o ->> 'msg' = x ->> 2)
      OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_new) r WHERE r ->> 'dish' = x ->> 0 AND r ->> 'kind' = x ->> 1 AND r ->> 'key' = x ->> 3)
      OR (x ->> 2) IS NOT DISTINCT FROM (SELECT r ->> 'msg' FROM jsonb_array_elements(v_new) r WHERE r ->> 'dish' = x ->> 0 AND r ->> 'kind' = x ->> 1 AND r ->> 'key' = x ->> 3);
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'literal: a rename whose source is not a 20261135 row, whose target is not in the literal, or that renames nothing: %. Nothing applied.', v_bad; END IF;

  RAISE NOTICE 'literal: % rows = % removals on % dishes + % priced extras on % dishes (derived); 20261135 wrote % rows; % in-place renames', v_total, v_rm,
    (SELECT count(DISTINCT r->>'dish') FROM jsonb_array_elements(v_new) r WHERE r->>'kind' = 'remove'), v_ex,
    (SELECT count(DISTINCT r->>'dish') FROM jsonb_array_elements(v_new) r WHERE r->>'kind' = 'extra'), v_old_total, jsonb_array_length(v_ren);

  -- ─── Pre-state ───────────────────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM public.schema_migrations_applied WHERE filename = '20261134_eatery_item_options.sql')
     OR NOT EXISTS (SELECT 1 FROM public.schema_migrations_applied WHERE filename = '20261135_crunchy_express_item_options.sql') THEN
    RAISE EXCEPTION '20261134 / 20261135 are not both in the ledger. Nothing applied.';
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
  v_mode := NULL;
  IF v_have = v_old_total AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_oldrows) r
        WHERE NOT EXISTS (SELECT 1 FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id
                           WHERE i.partner_id = c_id AND i.name = r->>'dish' AND o.kind = r->>'kind' AND o.message_tr = r->>'msg'
                             AND o.sort_order IS NOT DISTINCT FROM (r->>'ord')::int AND o.price IS NULL AND o.max_qty = 1)) THEN
    v_mode := 'apply';
  ELSIF v_have = v_total AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_new) r
        WHERE NOT EXISTS (SELECT 1 FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id
                           WHERE i.partner_id = c_id AND i.name = r->>'dish' AND o.kind = r->>'kind' AND o.message_tr = r->>'msg'
                             AND o.label_i18n IS NOT DISTINCT FROM r->'label' AND o.sort_order IS NOT DISTINCT FROM (r->>'ord')::int
                             AND o.price IS NOT DISTINCT FROM (r->>'price')::numeric)) THEN
    v_mode := 'noop';
  END IF;
  IF v_mode IS NULL THEN
    SELECT string_agg(DISTINCT r->>'dish', '; ') INTO v_bad
      FROM jsonb_array_elements(v_oldrows) r
     WHERE NOT EXISTS (SELECT 1 FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id
                        WHERE i.partner_id = c_id AND i.name = r->>'dish' AND o.kind = r->>'kind' AND o.message_tr = r->>'msg'
                          AND o.sort_order IS NOT DISTINCT FROM (r->>'ord')::int AND o.price IS NULL AND o.max_qty = 1);
    RAISE EXCEPTION 'crunchy-express has % option rows: neither the % rows 20261135 wrote nor the % rows of this file (dishes differing from the 20261135 state: %). Nothing applied.',
      v_have, v_old_total, v_total, coalesce(v_bad, 'none');
  END IF;

  SELECT count(*) FILTER (WHERE o.kind = 'remove'), count(*) FILTER (WHERE o.kind = 'extra')
    INTO v_b_rm, v_b_ex
    FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id = c_id;
  SELECT string_agg(s.section || ' ' || s.rm || '/' || s.ex, ', ' ORDER BY s.section) INTO v_b_sec
    FROM (SELECT i.section, count(*) FILTER (WHERE o.kind = 'remove') AS rm, count(*) FILTER (WHERE o.kind = 'extra') AS ex
            FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id = c_id GROUP BY i.section) s;

  SELECT md5(coalesce(string_agg(to_jsonb(i)::text, ',' ORDER BY i.id), '')) INTO v_menu_before FROM public.eatery_menu_items i;
  SELECT md5(coalesce(string_agg(to_jsonb(p)::text, ',' ORDER BY p.id), '')) INTO v_part_before FROM public.eatery_partners p;
  SELECT md5(coalesce(string_agg(to_jsonb(o)::text, ',' ORDER BY o.id), '')) INTO v_oth_before
    FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id IS DISTINCT FROM c_id;

  -- Rows that keep their id: today's row (dish, kind, src message) that the target still has.
  SELECT coalesce(array_agg(o.id ORDER BY o.id), ARRAY[]::bigint[]) INTO v_kept
    FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id
   WHERE i.partner_id = c_id
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_new) r WHERE r->>'dish' = i.name AND r->>'kind' = o.kind AND r->>'src' = o.message_tr);
  v_exp_kept := cardinality(v_kept);
  v_exp_del := v_have - v_exp_kept;
  v_exp_ins := v_total - v_exp_kept;

  -- ─── Write (first run only) ──────────────────────────────────────────────
  v_del := 0; v_upd := 0; v_ins := 0;
  IF v_mode = 'apply' THEN
    DELETE FROM public.eatery_item_options o USING public.eatery_menu_items i
     WHERE o.item_id = i.id AND i.partner_id = c_id
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_new) r WHERE r->>'dish' = i.name AND r->>'kind' = o.kind AND r->>'src' = o.message_tr);
    GET DIAGNOSTICS v_del = ROW_COUNT;
    IF v_del IS DISTINCT FROM v_exp_del THEN RAISE EXCEPTION 'deleted % rows, expected %', v_del, v_exp_del; END IF;

    UPDATE public.eatery_item_options o
       SET label_i18n = r.r -> 'label', message_tr = r.r ->> 'msg', sort_order = (r.r ->> 'ord')::int,
           price = (r.r ->> 'price')::numeric, max_qty = 1
      FROM public.eatery_menu_items i, jsonb_array_elements(v_new) r(r)
     WHERE o.item_id = i.id AND i.partner_id = c_id AND r.r ->> 'dish' = i.name AND r.r ->> 'kind' = o.kind AND r.r ->> 'src' = o.message_tr
       AND (o.label_i18n IS DISTINCT FROM r.r -> 'label' OR o.message_tr IS DISTINCT FROM r.r ->> 'msg'
            OR o.sort_order IS DISTINCT FROM (r.r ->> 'ord')::int OR o.price IS DISTINCT FROM (r.r ->> 'price')::numeric
            OR o.max_qty IS DISTINCT FROM 1);
    GET DIAGNOSTICS v_upd = ROW_COUNT;

    INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr, price, max_qty, sort_order)
    SELECT i.id, r.r ->> 'kind', r.r -> 'label', r.r ->> 'msg', (r.r ->> 'price')::numeric, 1, (r.r ->> 'ord')::int
      FROM jsonb_array_elements(v_new) r(r)
      JOIN public.eatery_menu_items i ON i.partner_id = c_id AND i.name = r.r ->> 'dish'
     WHERE NOT EXISTS (SELECT 1 FROM public.eatery_item_options o WHERE o.item_id = i.id AND o.kind = r.r ->> 'kind' AND o.message_tr = r.r ->> 'msg');
    GET DIAGNOSTICS v_ins = ROW_COUNT;
    IF v_ins IS DISTINCT FROM v_exp_ins THEN RAISE EXCEPTION 'inserted % rows, expected %', v_ins, v_exp_ins; END IF;
  END IF;

  -- ─── Post-state ──────────────────────────────────────────────────────────
  SELECT count(*) INTO v_n FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id = c_id;
  IF v_n IS DISTINCT FROM v_total THEN RAISE EXCEPTION 'after: % option rows, expected % (from the literal)', v_n, v_total; END IF;

  SELECT count(*) INTO v_n FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id
   WHERE i.partner_id = c_id
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_new) r
                      WHERE r->>'dish' = i.name AND r->>'kind' = o.kind AND r->>'msg' = o.message_tr
                        AND o.label_i18n IS NOT DISTINCT FROM r->'label' AND o.sort_order IS NOT DISTINCT FROM (r->>'ord')::int
                        AND o.price IS NOT DISTINCT FROM (r->>'price')::numeric AND o.max_qty = 1);
  IF v_n <> 0 THEN RAISE EXCEPTION 'after: % table rows that are not a row of the literal', v_n; END IF;

  SELECT string_agg(dish || '/' || kind || '=' || n, ',' ORDER BY dish, kind) INTO v_got
    FROM (SELECT i.name AS dish, o.kind, count(*) AS n FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id
           WHERE i.partner_id = c_id GROUP BY 1, 2) x;
  SELECT string_agg(dish || '/' || kind || '=' || n, ',' ORDER BY dish, kind) INTO v_exp
    FROM (SELECT r->>'dish' AS dish, r->>'kind' AS kind, count(*) AS n FROM jsonb_array_elements(v_new) r GROUP BY 1, 2) x;
  IF v_exp IS DISTINCT FROM v_got THEN RAISE EXCEPTION 'after: per-dish counts % expected (from the literal) %', v_got, v_exp; END IF;

  SELECT count(*) INTO v_n FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id
   WHERE i.partner_id = c_id AND o.kind = 'remove';
  IF v_n IS DISTINCT FROM v_rm THEN RAISE EXCEPTION 'after: % removals, expected %', v_n, v_rm; END IF;
  SELECT count(*) INTO v_n FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id
   WHERE i.partner_id = c_id AND o.kind = 'remove' AND (o.price IS NOT NULL OR o.max_qty IS DISTINCT FROM 1 OR NOT o.is_available);
  IF v_n <> 0 THEN RAISE EXCEPTION 'after: % removals with a price, a qty other than 1 or unavailable', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id
   WHERE i.partner_id = c_id AND o.kind = 'extra' AND (o.price IS NULL OR o.price <= 0);
  IF v_n <> 0 THEN RAISE EXCEPTION 'after: % extras without a positive price (none may stay hidden)', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.eatery_item_options WHERE id = ANY (v_kept);
  IF v_n IS DISTINCT FROM v_exp_kept THEN RAISE EXCEPTION 'after: % of the % option ids that must survive exist', v_n, v_exp_kept; END IF;

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
  IF v_anon IS DISTINCT FROM v_pg OR v_anon IS DISTINCT FROM v_total OR v_anon_shown IS DISTINCT FROM v_total THEN
    RAISE EXCEPTION 'anon reads % option rows and sees % of them, postgres reads %, the literal has % (every row must be shown)', v_anon, v_anon_shown, v_pg, v_total;
  END IF;

  SELECT string_agg(s.section || ' ' || s.rm || '/' || s.ex, ', ' ORDER BY s.section) INTO v_a_sec
    FROM (SELECT i.section, count(*) FILTER (WHERE o.kind = 'remove') AS rm, count(*) FILTER (WHERE o.kind = 'extra') AS ex
            FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id = c_id GROUP BY i.section) s;
  RAISE NOTICE 'crunchy-express options (%): before % removals / % extras, after % removals / % extras (all % priced); % deleted, % updated, % inserted, % ids kept; anon sees %',
    v_mode, v_b_rm, v_b_ex, v_rm, v_ex, v_ex, v_del, v_upd, v_ins, v_exp_kept, v_anon_shown;
  RAISE NOTICE 'per section (removals/extras) before: %', v_b_sec;
  RAISE NOTICE 'per section (removals/extras) after: %', v_a_sec;
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
VALUES ('20261136_crunchy_express_options_owner_answers.sql', '0f6368e039c0b12e2bedde7c1a61bd89e47bf15d9f8a619c700d41435f8a1ef7')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: the 20261136_crunchy_express_options_owner_answers row must read OK.
--
-- ─── Rollback (restores the 20261135 rows; ids of deleted rows change) ──
--   Re-create them from 20261135's literal after DELETE FROM public.eatery_item_options WHERE item_id IN
--     (SELECT id FROM public.eatery_menu_items WHERE partner_id = 'bb9dad05-6bb0-4c1c-90fb-cb0a4ad68434');
