-- ─── Fix translations for beaches & landmarks ────────────────────────────────
-- Corrects issues from desc_jsonb.sql running after name was already JSONB,
-- which caused WHERE name='text' comparisons to silently match nothing.
-- All statements are idempotent (use ? 'tr' check so re-running is safe).
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── Turkish descriptions — beaches ──────────────────────────────────────────

UPDATE beaches
SET description = description || '{"tr": "Girne''nin en kalabalık plajlarından biri. Sakin, berrak suyu ve ince kum-çakıl karışımı kıyısıyla tanınır. Şezlong ve sahil restoranları mevcuttur. Hafta sonları yoğun olabilir."}'::jsonb
WHERE name->>'en' = 'Escape Beach' AND NOT (description ? 'tr');

UPDATE beaches
SET description = description || '{"tr": "Akdeniz''deki en önemli Caretta caretta yumurtlama alanlarından biri olup doğal yapısı koruma altındadır. Gelişim kasıtlı olarak asgari düzeyde tutulmuştur. Yumurtlama sezonunda (Haz–Ağu) geceleri ziyaret için rehber izni gerekir."}'::jsonb
WHERE name->>'en' = 'Alagadi Turtle Beach' AND NOT (description ? 'tr');

UPDATE beaches
SET description = description || '{"tr": "Karpaz Yarımadası''nın ucundaki uzun, bakir altın kumsal — Kuzey Kıbrıs''ın en güzel plajı olarak kabul edilir. Ulaşılması güç ve el değmemiş yapısıyla öne çıkar. Bölgede yabani eşekler görülür."}'::jsonb
WHERE name->>'en' = 'Golden Beach (Altın Kumsal)' AND NOT (description ? 'tr');

UPDATE beaches
SET description = description || '{"tr": "Gazimagusa''nın kuzeyinde, sakin ve sığ sularıyla ailelerin gözde sahil noktası. Yakınındaki Salamis harabelerine günübirlik ziyaretle kolayca birleştirilebilir."}'::jsonb
WHERE name->>'en' = 'Glapsides Beach' AND NOT (description ? 'tr');


-- ─── Turkish descriptions — original landmarks ───────────────────────────────

UPDATE landmarks
SET description = description || '{"tr": "Venedikliler ve Osmanlılar tarafından yeniden inşa edilip genişletilen Bizans dönemi kalesi, Girne Limanı girişinde yer almaktadır. Deniz tabanından çıkarılan 2.400 yıllık bir ticaret gemisine ev sahipliği yapan Batık Gemi Müzesi burada bulunur. Burçlardan liman manzarası nefes kesicidir."}'::jsonb
WHERE name->>'en' = 'Kyrenia Castle' AND NOT (description ? 'tr');

UPDATE landmarks
SET description = description || '{"tr": "Girne''nin 732 metre yüksekliğindeki dağ zirvesine kurulu ortaçağ kalesi. Bizanslılar tarafından inşa edilen yapı, Lüzinyanlı döneminde en yoğun kullanımını yaşadı. Üst avludan hem kuzey kıyısı hem de Mesarya Ovası görülebilir. Disney''in Pamuk Prenses kalesi için ilham kaynağı olduğu söylenir."}'::jsonb
WHERE name->>'en' = 'St. Hilarion Castle' AND NOT (description ? 'tr');

UPDATE landmarks
SET description = description || '{"tr": "Kıbrıs''ın en önemli antik kentlerinden biri. MÖ 11. yüzyılda kurulan Salamis, antik dünyanın büyük şehir krallıklarından biriydi. Denize yakın çam ormanlığında büyük bir jimnasyon, Roma hamamları, amfitiyatro ve geniş mozaikler yer almaktadır."}'::jsonb
WHERE name->>'en' = 'Salamis Ancient City' AND NOT (description ? 'tr');

UPDATE landmarks
SET description = description || '{"tr": "Bellapais köyünün yamacına kurulmuş 13. yüzyıl Gotik manastırı; Kıbrıs''taki en güzel Gotik mimari örneği olarak kabul edilir. Yemekhane ve avlu iyi korunmuş durumdadır. Lawrence Durrell köyde yaşamış ve ''Kıbrıs''ın Acı Limonları'' kitabında burayı anlatmıştır."}'::jsonb
WHERE name->>'en' = 'Bellapais Abbey' AND NOT (description ? 'tr');

UPDATE landmarks
SET description = description || '{"tr": "Karpaz Yarımadası''nın en ucundaki bu hac mekânı, hem Rum Kıbrıslılar hem de Maruniler için kutsal sayılan önemli yerlerden biridir. BM ortak desteğiyle kapsamlı biçimde restore edilmiştir. Çevresi adanın en ücra ve etkileyici kıyı şeridine sahiptir."}'::jsonb
WHERE name->>'en' = 'Apostolos Andreas Monastery' AND NOT (description ? 'tr');


-- ─── Fix Nicosia landmark descriptions ───────────────────────────────────────
-- These were inserted before desc_jsonb.sql ran, so they're doubly-wrapped.
-- Replace them directly with correct {en, tr} JSONB.

UPDATE landmarks
SET description = '{"en": "A magnificent Gothic cathedral built in the 14th century, converted to a mosque after the Ottoman conquest in 1571. The largest surviving medieval church in Cyprus. Twin minarets were added under Ottoman rule. Located in the heart of the old walled city, it remains an active place of worship.", "tr": "1571''deki Osmanlı fethinin ardından camiye dönüştürülen görkemli 14. yüzyıl Gotik katedrali. Kıbrıs''ta ayakta kalan en büyük ortaçağ kilisesidir. İkiz minareler Osmanlı döneminde eklenmiştir. Eski Lefkoşa''nın kalbinde, hâlâ aktif bir ibadet yeri olarak kullanılmaktadır."}'::jsonb
WHERE name->>'en' = 'Selimiye Mosque';

UPDATE landmarks
SET description = '{"en": "The largest Ottoman caravanserai in Cyprus, built in 1572 shortly after the conquest. It once provided lodging and storage for merchants across 68 ground-floor rooms. Now beautifully restored as a cultural centre with galleries and craft workshops, it is a model heritage project.", "tr": "Kıbrıs''ın en büyük Osmanlı kervansarayı; adanın fethinin hemen ardından 1572''de inşa edilmiştir. Zemin kattaki 68 odada tüccarları ve mallarını barındırırdı. Galeriler ve zanaat atölyelerine ev sahipliği yapan kültür merkezine dönüştürülmüş, başarılı bir miras projesidir."}'::jsonb
WHERE name->>'en' = 'Büyük Han (Great Inn)';

UPDATE landmarks
SET description = '{"en": "One of the three original gates in Nicosia''s 16th-century Venetian walls, facing north toward Kyrenia. Rebuilt in 1562, it once controlled access via a drawbridge over the moat. Now serves as a tourist information office and is a well-preserved example of Venetian military architecture.", "tr": "Lefkoşa''nın 16. yüzyıl Venedik surlarındaki üç özgün kapıdan biri; kuzeyinde Girne''ye yönelir. 1562''de yeniden inşa edilen kapı, eskiden hendek üzerindeki köprüyle surlu şehre geçişi denetliyordu. Şu anda turizm danışma ofisi olarak hizmet veren yapı, Venedik askeri mimarisinin güzel bir örneğidir."}'::jsonb
WHERE name->>'en' = 'Kyrenia Gate';


-- ─── Turkish names safety net ─────────────────────────────────────────────────
-- Re-apply Turkish names for any entry that lost them (idempotent).

UPDATE beaches SET name = name || '{"tr": "Escape Plajı"}'::jsonb
WHERE name->>'en' = 'Escape Beach' AND NOT (name ? 'tr');

UPDATE beaches SET name = name || '{"tr": "Alagadı Kaplumbağa Plajı"}'::jsonb
WHERE name->>'en' = 'Alagadi Turtle Beach' AND NOT (name ? 'tr');

UPDATE beaches SET name = name || '{"tr": "Altın Kumsal"}'::jsonb
WHERE name->>'en' = 'Golden Beach (Altın Kumsal)' AND NOT (name ? 'tr');

UPDATE beaches SET name = name || '{"tr": "Glapsides Plajı"}'::jsonb
WHERE name->>'en' = 'Glapsides Beach' AND NOT (name ? 'tr');

UPDATE landmarks SET name = name || '{"tr": "Girne Kalesi"}'::jsonb
WHERE name->>'en' = 'Kyrenia Castle' AND NOT (name ? 'tr');

UPDATE landmarks SET name = name || '{"tr": "Aziz Hilarion Kalesi"}'::jsonb
WHERE name->>'en' = 'St. Hilarion Castle' AND NOT (name ? 'tr');

UPDATE landmarks SET name = name || '{"tr": "Salamis Antik Kenti"}'::jsonb
WHERE name->>'en' = 'Salamis Ancient City' AND NOT (name ? 'tr');

UPDATE landmarks SET name = name || '{"tr": "Bellapais Manastırı"}'::jsonb
WHERE name->>'en' = 'Bellapais Abbey' AND NOT (name ? 'tr');

UPDATE landmarks SET name = name || '{"tr": "Apostolos Andreas Manastırı"}'::jsonb
WHERE name->>'en' = 'Apostolos Andreas Monastery' AND NOT (name ? 'tr');

UPDATE landmarks SET name = name || '{"tr": "Selimiye Camii"}'::jsonb
WHERE name->>'en' = 'Selimiye Mosque' AND NOT (name ? 'tr');

UPDATE landmarks SET name = name || '{"tr": "Büyük Han"}'::jsonb
WHERE name->>'en' = 'Büyük Han (Great Inn)' AND NOT (name ? 'tr');

UPDATE landmarks SET name = name || '{"tr": "Girne Kapısı"}'::jsonb
WHERE name->>'en' = 'Kyrenia Gate' AND NOT (name ? 'tr');
