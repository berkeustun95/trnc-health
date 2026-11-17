-- ═══════════════════════════════════════════════════════════
-- 20261216 — beaches go-live, step 2: the 7 missing locales on the 4 live beaches (data only, 4 rows, name_i18n + description_i18n)
-- ═══════════════════════════════════════════════════════════
--
-- The 4 live beaches (Alagadi, Escape, Glapsides, Golden Beach; source / source_id are NULL on them, so matched by id) carry only en + tr in
-- name_i18n and description_i18n. This file ADDS the 7 missing keys (ar, ru, el, fr, es, de, fa) to both columns, from
-- data/explore/beaches-live-translations.json (name_i18n / description_i18n; the alternatives, needs_native_check and source_discrepancies
-- blocks are not imported). el = the Turkish name (Berke, 2026-11-16, as 20261214 did for the 30 staged beaches).
-- Berke approved writing and dry-running this file 2026-11-16; it is applied later, together with 20261215, in ONE supabase-migrate run.
--
-- Safety:
--   • Compare-and-set: a row is updated only if its CURRENT name_i18n AND description_i18n are exactly equal (jsonb equality) to the
--     file's 'source' block ({en, tr}). Anything else (an edited text, an already-added key) means the row is not updated and the file
--     aborts on the count.
--   • Pre-check: all 4 ids exist as category 'beach', status 'active', with exactly those source values, else RAISE (counts only).
--   • New value = old || the 7 new keys. GET DIAGNOSTICS must report exactly 4. Afterwards each row's en and tr values are byte-identical
--     to before (the projection without the 7 keys equals the before snapshot), each carries exactly 9 keys in both columns, and el = tr in name_i18n.
--   • No other column changes (to_jsonb(p) minus the 2 columns, before/after); every other places row is hashed (md5) before and after
--     and must be identical.
--   • Before the first UPDATE the enabled UPDATE triggers on places are read and the file RAISES unless they are exactly the 5 BEFORE ROW
--     ones of 20261206. check_place_content re-scans the name and all i18n text with the word filter and the payment filter when i18n
--     changes: a hit aborts the whole file (rolled back). The 7 new texts are also checked against the repo term list in scripts/test-beaches-staged.mjs.
-- One-shot: a re-run after a successful apply raises (the current values no longer equal the source block).
--
-- Apply: gh workflow run supabase-migrate -f files="20261215_beaches_publish.sql 20261216_beaches_live4_locales.sql" (dry), then -f apply=true
-- after Berke approves production-db. Data only: no schema change, nothing to register in verify_schema.sql.

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  -- [id, expected CURRENT name_i18n, expected CURRENT description_i18n, name keys to ADD, description keys to ADD]
  v_rows jsonb := '[["fa39492b-57e6-4ebd-b22c-89a9cf20ffe2",{"en":"Alagadi Turtle Beach","tr":"Alagadı Kaplumbağa Plajı"},{"en":"A protected natural beach and one of the most important loggerhead turtle (Caretta caretta) nesting sites in the Mediterranean. Minimal development by design. Visiting at night during nesting season (Jun–Aug) requires a guide permit.","tr":"Akdeniz''deki en önemli Caretta caretta yumurtlama alanlarından biri olup doğal yapısı koruma altındadır. Gelişim kasıtlı olarak asgari düzeyde tutulmuştur. Yumurtlama sezonunda (Haz–Ağu) geceleri ziyaret için rehber izni gerekir."},{"ar":"شاطئ السلاحف في ألاغادي","ru":"Пляж черепах Алагади","el":"Alagadı Kaplumbağa Plajı","fr":"Plage des tortues d''Alagadi","es":"Playa de las tortugas de Alagadi","de":"Alagadi-Schildkrötenstrand","fa":"ساحل لاک‌پشت‌ها در آلاگادی"},{"ar":"شاطئ طبيعي محمي، وأحد أهم مواقع تعشيش السلاحف الضخمة الرأس (Caretta caretta) في البحر المتوسط. التطوير فيه محدود عمداً. تتطلب الزيارة ليلاً خلال موسم التعشيش (يونيو–أغسطس) تصريح مرشد.","ru":"Охраняемый природный пляж и одно из важнейших мест гнездования морских черепах логгерхед (Caretta caretta) в Средиземноморье. Застройка здесь сознательно минимальна. Для ночного посещения в сезон гнездования (июнь–август) требуется разрешение гида.","el":"Προστατευόμενη φυσική παραλία και ένας από τους σημαντικότερους τόπους ωοτοκίας της θαλάσσιας χελώνας καρέτα-καρέτα (Caretta caretta) στη Μεσόγειο. Η ανάπτυξη είναι εσκεμμένα ελάχιστη. Η νυχτερινή επίσκεψη κατά την περίοδο ωοτοκίας (Ιούν–Αύγ) απαιτεί άδεια ξεναγού.","fr":"Plage naturelle protégée et l''un des sites de ponte les plus importants de la tortue caouanne (Caretta caretta) en Méditerranée. L''aménagement y est volontairement minimal. Une visite de nuit pendant la saison de ponte (juin–août) nécessite un permis de guide.","es":"Playa natural protegida y uno de los lugares de anidación más importantes de la tortuga boba (Caretta caretta) en el Mediterráneo. El desarrollo es mínimo por diseño. Visitarla de noche durante la temporada de anidación (jun–ago) requiere un permiso de guía.","de":"Geschützter Naturstrand und einer der wichtigsten Nistplätze der Unechten Karettschildkröte (Caretta caretta) im Mittelmeer. Die Bebauung ist bewusst minimal gehalten. Für einen nächtlichen Besuch während der Nistzeit (Jun–Aug) ist eine Guide-Genehmigung erforderlich.","fa":"ساحلی طبیعی و حفاظت‌شده و یکی از مهم‌ترین محل‌های تخم‌گذاری لاک‌پشت سرگنده (Caretta caretta) در دریای مدیترانه. توسعه در این ساحل عمداً در کمترین حد نگه داشته شده است. بازدید شبانه در فصل تخم‌گذاری (ژوئن–اوت) نیازمند مجوز راهنما است."}],["4a29cce8-8c3a-4541-8a07-fc7ceda6a4ff",{"en":"Escape Beach","tr":"Escape Plajı"},{"en":"One of Kyrenia''s most popular beaches. Calm, clear water with a mix of fine sand and pebbles. Well-equipped with sunbeds and beachside dining. Often busy on weekends.","tr":"Girne''nin en kalabalık plajlarından biri. Sakin, berrak suyu ve ince kum-çakıl karışımı kıyısıyla tanınır. Şezlong ve sahil restoranları mevcuttur. Hafta sonları yoğun olabilir."},{"ar":"شاطئ Escape","ru":"Пляж Escape","el":"Escape Plajı","fr":"Plage Escape","es":"Playa Escape","de":"Escape-Strand","fa":"ساحل Escape"},{"ar":"من أكثر شواطئ كيرينيا شعبية. مياه هادئة وصافية وساحل من الرمل الناعم والحصى. مجهّز جيداً بكراسي الشاطئ ومطاعم على الواجهة البحرية. غالباً ما يكون مزدحماً في عطلات نهاية الأسبوع.","ru":"Один из самых популярных пляжей Кирении. Спокойная прозрачная вода, мелкий песок вперемешку с галькой. Хорошо оборудован лежаками, на берегу есть рестораны. По выходным часто многолюдно.","el":"Μία από τις δημοφιλέστερες παραλίες της Girne. Ήρεμα, καθαρά νερά και μείγμα λεπτής άμμου και βότσαλου. Καλά εξοπλισμένη με ξαπλώστρες και εστιατόρια πάνω στην παραλία. Συχνά γεμάτη κόσμο τα Σαββατοκύριακα.","fr":"L''une des plages les plus populaires de Kyrenia. Eau calme et limpide, mélange de sable fin et de galets. Bien équipée en transats, avec des restaurants en bord de plage. Souvent très fréquentée le week-end.","es":"Una de las playas más populares de Kyrenia. Aguas tranquilas y cristalinas, con una mezcla de arena fina y guijarros. Bien equipada con tumbonas y restaurantes junto a la playa. A menudo está concurrida los fines de semana.","de":"Einer der beliebtesten Strände Kyrenias. Ruhiges, klares Wasser und eine Mischung aus feinem Sand und Kieseln. Gut ausgestattet mit Sonnenliegen und Restaurants direkt am Strand. Am Wochenende oft gut besucht.","fa":"یکی از محبوب‌ترین سواحل کیرنیا. آبی آرام و زلال با ترکیبی از ماسه‌ی ریز و سنگریزه. با تخت‌های آفتاب‌گیر و رستوران‌های ساحلی به‌خوبی مجهز است. آخر هفته‌ها اغلب شلوغ است."}],["b52cdf3a-ce3f-4e6f-88b8-57afb95f2e67",{"en":"Glapsides Beach","tr":"Glapsides Plajı"},{"en":"A sandy beach just north of Famagusta with calm, shallow water — popular with families. Close to the Salamis ruins, making it a convenient stop on a day out.","tr":"Gazimagusa''nın kuzeyinde, sakin ve sığ sularıyla ailelerin gözde sahil noktası. Yakınındaki Salamis harabelerine günübirlik ziyaretle kolayca birleştirilebilir."},{"ar":"شاطئ غلابسيديس","ru":"Пляж Глапсидес","el":"Glapsides Plajı","fr":"Plage de Glapsides","es":"Playa de Glapsides","de":"Glapsides-Strand","fa":"ساحل گلاپسیدس"},{"ar":"شاطئ رملي شمال فاماغوستا مباشرة، مياهه هادئة وضحلة، ويحظى بشعبية بين العائلات. قريب من أطلال سلاميس، مما يجعله محطة مناسبة ضمن رحلة يومية.","ru":"Песчаный пляж к северу от Фамагусты со спокойной мелкой водой — любимое место семей. Рядом руины Саламина, поэтому сюда удобно заехать во время однодневной поездки.","el":"Αμμώδης παραλία ακριβώς βόρεια της Gazimağusa με ήρεμα, ρηχά νερά — δημοφιλής στις οικογένειες. Βρίσκεται κοντά στα ερείπια της Salamis, γεγονός που την κάνει βολική στάση σε μια ημερήσια εκδρομή.","fr":"Plage de sable juste au nord de Famagouste, à l''eau calme et peu profonde — appréciée des familles. Proche des ruines de Salamine, elle constitue une étape pratique lors d''une sortie d''une journée.","es":"Playa de arena justo al norte de Famagusta, de aguas tranquilas y poco profundas, muy popular entre las familias. Está cerca de las ruinas de Salamina, por lo que es una parada cómoda en una excursión de un día.","de":"Sandstrand direkt nördlich von Famagusta mit ruhigem, flachem Wasser – bei Familien beliebt. In der Nähe der Ruinen von Salamis und damit ein praktischer Halt bei einem Tagesausflug.","fa":"ساحلی ماسه‌ای درست در شمال فاماگوستا با آبی آرام و کم‌عمق که میان خانواده‌ها محبوب است. نزدیک به ویرانه‌های سالامیس است و به همین دلیل توقف‌گاه مناسبی در یک گردش یک‌روزه به شمار می‌رود."}],["95b6d924-e3c0-40e4-a2bd-b55ca1a105ef",{"en":"Golden Beach (Altın Kumsal)","tr":"Altın Kumsal"},{"en":"A long, undeveloped stretch of golden sand at the tip of the Karpaz Peninsula — widely considered the most beautiful beach in North Cyprus. Remote and unspoiled. Wild donkeys roam the area.","tr":"Karpaz Yarımadası''nın ucundaki uzun, bakir altın kumsal — Kuzey Kıbrıs''ın en güzel plajı olarak kabul edilir. Ulaşılması güç ve el değmemiş yapısıyla öne çıkar. Bölgede yabani eşekler görülür."},{"ar":"الشاطئ الذهبي","ru":"Золотой пляж (Altın Kumsal)","el":"Altın Kumsal","fr":"Golden Beach (Altın Kumsal)","es":"Golden Beach (Altın Kumsal)","de":"Golden Beach (Altın Kumsal)","fa":"ساحل طلایی"},{"ar":"امتداد طويل وغير مطوَّر من الرمال الذهبية عند طرف شبه جزيرة كارباز، ويُعدّ على نطاق واسع أجمل شاطئ في شمال قبرص. بعيد وبكر. تجوب الحمير البرية المنطقة.","ru":"Длинная неосвоенная полоса золотистого песка на оконечности полуострова Карпас — его широко считают самым красивым пляжем Северного Кипра. Отдалённый и нетронутый. В окрестностях бродят дикие ослы.","el":"Μια μακριά, αναξιοποίητη λωρίδα χρυσής άμμου στην άκρη της χερσονήσου Karpaz — θεωρείται ευρέως η ωραιότερη παραλία της Βόρειας Κύπρου. Απομονωμένη και ανέγγιχτη. Στην περιοχή τριγυρνούν άγριοι γάιδαροι.","fr":"Longue étendue de sable doré non aménagée, à la pointe de la péninsule du Karpas — largement considérée comme la plus belle plage du nord de Chypre. Isolée et préservée. Des ânes sauvages parcourent la région.","es":"Una larga franja de arena dorada sin urbanizar en el extremo de la península de Karpasia, considerada ampliamente la playa más bella del norte de Chipre. Remota y virgen. Por la zona vagan burros salvajes.","de":"Ein langer, unbebauter Streifen goldenen Sandes an der Spitze der Karpas-Halbinsel – weithin als schönster Strand Nordzyperns angesehen. Abgelegen und unberührt. In der Gegend streifen Wildesel umher.","fa":"نوار بلند و دست‌نخورده‌ای از ماسه‌ی طلایی در انتهای شبه‌جزیره‌ی کارپاز که به‌طور گسترده زیباترین ساحل شمال قبرس شناخته می‌شود. دورافتاده و بکر. الاغ‌های وحشی در این منطقه پرسه می‌زنند."}]]'::jsonb;
  c_expected constant int := 4;
  c_new_keys constant text[] := ARRAY['ar','ru','el','fr','es','de','fa'];
  v_others_before text;
  v_others_after  text;
  v_keys_before jsonb;
  v_keys_after  jsonb;
  v_nm_before jsonb;
  v_nm_after  jsonb;
  v_ds_before jsonb;
  v_ds_after  jsonb;
  v_n int;
  v_bad int;
  v_trg text;
  v_ntrg int;
  v_nbad int;
BEGIN
  IF jsonb_array_length(v_rows) <> c_expected THEN
    RAISE EXCEPTION 'file lists % rows, expected %', jsonb_array_length(v_rows), c_expected;
  END IF;
  IF (SELECT count(DISTINCT e->>0) FROM jsonb_array_elements(v_rows) e) <> c_expected THEN
    RAISE EXCEPTION 'the % ids of this file are not all distinct', c_expected;
  END IF;
  -- each block to add holds exactly the 7 keys and none of en / tr
  SELECT count(*) INTO v_bad FROM jsonb_array_elements(v_rows) AS e(v)
   WHERE (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(e.v->3) k) IS DISTINCT FROM (SELECT array_agg(k ORDER BY k) FROM unnest(c_new_keys) k)
      OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(e.v->4) k) IS DISTINCT FROM (SELECT array_agg(k ORDER BY k) FROM unnest(c_new_keys) k);
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '% rows of this file do not carry exactly the 7 new locale keys', v_bad;
  END IF;

  -- 5 = places_guard_update, places_guard_source, places_guard_official_visit, guard_place_moderation, check_place_content (as 20261206 / 20261214).
  SELECT count(*),
         string_agg(t.tgname || CASE WHEN (t.tgtype & 3) = 3 THEN ' (before row)' ELSE ' (NOT before row)' END, ', ' ORDER BY t.tgname),
         count(*) FILTER (WHERE (t.tgtype & 3) <> 3)
    INTO v_ntrg, v_trg, v_nbad
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.places'::regclass AND NOT t.tgisinternal AND t.tgenabled <> 'D'
     AND (t.tgtype & 16) = 16;
  IF v_nbad <> 0 OR v_ntrg <> 5 THEN
    RAISE EXCEPTION 'places has % enabled UPDATE triggers (% not before-row), expected exactly 5 before-row ones: %',
      v_ntrg, v_nbad, coalesce(v_trg, '(none)');
  END IF;

  -- pre-check: each id is an active beach whose two columns equal the file's source block
  SELECT count(*) INTO v_bad
    FROM jsonb_array_elements(v_rows) AS e(v)
   WHERE (SELECT count(*) FROM public.places p
           WHERE p.id::text = e.v->>0 AND p.category IS NOT DISTINCT FROM 'beach' AND p.status IS NOT DISTINCT FROM 'active'
             AND p.name_i18n IS NOT DISTINCT FROM e.v->1 AND p.description_i18n IS NOT DISTINCT FROM e.v->2) <> 1;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '% of the % live beaches are missing, not active beaches, or no longer equal the source en/tr values', v_bad, c_expected;
  END IF;

  SELECT md5(coalesce(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), '')) INTO v_others_before
    FROM public.places p WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) e WHERE e->>0 = p.id::text);

  SELECT jsonb_object_agg(p.id::text, to_jsonb(p) - 'name_i18n' - 'description_i18n') INTO v_keys_before
    FROM public.places p WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) e WHERE e->>0 = p.id::text);
  SELECT jsonb_object_agg(p.id::text, p.name_i18n) INTO v_nm_before
    FROM public.places p WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) e WHERE e->>0 = p.id::text);
  SELECT jsonb_object_agg(p.id::text, p.description_i18n) INTO v_ds_before
    FROM public.places p WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) e WHERE e->>0 = p.id::text);

  UPDATE public.places p
     SET name_i18n = p.name_i18n || (e.v->3),
         description_i18n = p.description_i18n || (e.v->4)
    FROM jsonb_array_elements(v_rows) AS e(v)
   WHERE p.id::text = e.v->>0 AND p.category = 'beach' AND p.status = 'active'
     AND p.name_i18n IS NOT DISTINCT FROM e.v->1 AND p.description_i18n IS NOT DISTINCT FROM e.v->2;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> c_expected THEN
    RAISE EXCEPTION 'expected to update exactly % live beach rows, updated %', c_expected, v_n;
  END IF;

  SELECT md5(coalesce(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), '')) INTO v_others_after
    FROM public.places p WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) e WHERE e->>0 = p.id::text);
  IF v_others_after IS DISTINCT FROM v_others_before THEN
    RAISE EXCEPTION 'a places row outside the 4 changed; aborting';
  END IF;

  SELECT jsonb_object_agg(p.id::text, to_jsonb(p) - 'name_i18n' - 'description_i18n') INTO v_keys_after
    FROM public.places p WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) e WHERE e->>0 = p.id::text);
  IF v_keys_after IS DISTINCT FROM v_keys_before THEN
    RAISE EXCEPTION 'a column other than name_i18n / description_i18n changed on one of the 4 rows; aborting';
  END IF;

  SELECT jsonb_object_agg(p.id::text, p.name_i18n - c_new_keys) INTO v_nm_after
    FROM public.places p WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) e WHERE e->>0 = p.id::text);
  SELECT jsonb_object_agg(p.id::text, p.description_i18n - c_new_keys) INTO v_ds_after
    FROM public.places p WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) e WHERE e->>0 = p.id::text);
  IF v_nm_after IS DISTINCT FROM v_nm_before OR v_ds_after IS DISTINCT FROM v_ds_before THEN
    RAISE EXCEPTION 'an en / tr value changed on one of the 4 rows; aborting';
  END IF;

  SELECT count(*) INTO v_bad FROM public.places p
   WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) e WHERE e->>0 = p.id::text)
     AND ((SELECT count(*) FROM jsonb_object_keys(p.name_i18n)) <> 9 OR (SELECT count(*) FROM jsonb_object_keys(p.description_i18n)) <> 9
          OR p.name_i18n->>'el' IS DISTINCT FROM p.name_i18n->>'tr');
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '% of the 4 rows do not carry 9 keys in both columns and el = tr in the name after the update', v_bad;
  END IF;

  RAISE NOTICE '20261216 OK: % live beach rows got the 7 new locales, en/tr untouched, all other rows byte-identical, no other column changed', v_n;
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
VALUES ('20261216_beaches_live4_locales.sql', 'f4d9fad2527d24fecf22dafd3a92570d6eecab000c0a59a1153537791bcd3044')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;
