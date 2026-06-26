-- ─── Description field: TEXT → JSONB ─────────────────────────────────────────
-- Run in Supabase SQL editor BEFORE beaches_landmarks_nicosia_seed.sql.
-- Converts description from a single TEXT to a JSONB map keyed by language code
-- e.g. { "en": "...", "tr": "..." }
-- Display logic: description[userLang] ?? description.en ?? first value
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE beaches
  ALTER COLUMN description TYPE JSONB
  USING CASE WHEN description IS NULL THEN NULL
             ELSE jsonb_build_object('en', description) END;

ALTER TABLE landmarks
  ALTER COLUMN description TYPE JSONB
  USING CASE WHEN description IS NULL THEN NULL
             ELSE jsonb_build_object('en', description) END;


-- ─── Turkish translations for existing seed entries ───────────────────────────

UPDATE beaches SET description = description || '{"tr": "Girne''nin en kalabalık plajlarından biri. Sakin, berrak suyu ve ince kum-çakıl karışımı kıyısıyla tanınır. Şezlong ve sahil restoranları mevcuttur. Hafta sonları yoğun olabilir."}'::jsonb
WHERE name = 'Escape Beach';

UPDATE beaches SET description = description || '{"tr": "Akdeniz''deki en önemli Caretta caretta yumurtlama alanlarından biri olup doğal yapısı koruma altındadır. Gelişim kasıtlı olarak asgari düzeyde tutulmuştur. Yumurtlama sezonunda (Haz–Ağu) geceleri ziyaret için rehber izni gerekir."}'::jsonb
WHERE name = 'Alagadi Turtle Beach';

UPDATE beaches SET description = description || '{"tr": "Karpaz Yarımadası''nın ucundaki uzun, bakir altın kumsal — Kuzey Kıbrıs''ın en güzel plajı olarak kabul edilir. Ulaşılması güç ve el değmemiş yapısıyla öne çıkar. Bölgede yabani eşekler görülür."}'::jsonb
WHERE name = 'Golden Beach (Altın Kumsal)';

UPDATE beaches SET description = description || '{"tr": "Gazimagusa''nın kuzeyinde, sakin ve sığ sularıyla ailelerin gözde sahil noktası. Yakınındaki Salamis harabelerine günübirlik ziyaretle kolayca birleştirilebilir."}'::jsonb
WHERE name = 'Glapsides Beach';

UPDATE landmarks SET description = description || '{"tr": "Venedikliler ve Osmanlılar tarafından yeniden inşa edilip genişletilen Bizans dönemi kalesi, Girne Limanı girişinde yer almaktadır. Deniz tabanından çıkarılan 2.400 yıllık bir ticaret gemisine ev sahipliği yapan Batık Gemi Müzesi burada bulunur. Burçlardan liman manzarası nefes kesicidir."}'::jsonb
WHERE name = 'Kyrenia Castle';

UPDATE landmarks SET description = description || '{"tr": "Girne''nin 732 metre yüksekliğindeki dağ zirvesine kurulu ortaçağ kalesi. Bizanslılar tarafından inşa edilen yapı, Lüzinyanlı döneminde en yoğun kullanımını yaşadı. Üst avludan hem kuzey kıyısı hem de Mesarya Ovası görülebilir. Disney''in Pamuk Prenses kalesi için ilham kaynağı olduğu söylenir."}'::jsonb
WHERE name = 'St. Hilarion Castle';

UPDATE landmarks SET description = description || '{"tr": "Kıbrıs''ın en önemli antik kentlerinden biri. MÖ 11. yüzyılda kurulan Salamis, antik dünyanın büyük şehir krallıklarından biriydi. Denize yakın çam ormanlığında büyük bir jimnasyon, Roma hamamları, amfitiyatro ve geniş mozaikler yer almaktadır."}'::jsonb
WHERE name = 'Salamis Ancient City';

UPDATE landmarks SET description = description || '{"tr": "Bellapais köyünün yamacına kurulmuş 13. yüzyıl Gotik manastırı; Kıbrıs''taki en güzel Gotik mimari örneği olarak kabul edilir. Yemekhane ve avlu iyi korunmuş durumdadır. Lawrence Durrell köyde yaşamış ve ''Kıbrıs''ın Acı Limonları'' kitabında burayı anlatmıştır."}'::jsonb
WHERE name = 'Bellapais Abbey';

UPDATE landmarks SET description = description || '{"tr": "Karpaz Yarımadası''nın en ucundaki bu hac mekânı, hem Rum Kıbrıslılar hem de Maruniler için kutsal sayılan önemli yerlerden biridir. BM ortak desteğiyle kapsamlı biçimde restore edilmiştir. Çevresi adanın en ücra ve etkileyici kıyı şeridine sahiptir."}'::jsonb
WHERE name = 'Apostolos Andreas Monastery';
