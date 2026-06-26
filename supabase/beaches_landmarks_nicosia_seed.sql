-- ─── Nicosia (Lefkoşa) Landmarks Seed ────────────────────────────────────────
-- Run AFTER beaches_landmarks_desc_jsonb.sql (description is now JSONB).
-- Admin-seeded (submitted_by NULL, status active).
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO landmarks (submitted_by, name, district, latitude, longitude, description, category, status)
VALUES
  (NULL, 'Selimiye Mosque', 'nicosia', 35.1728, 33.3653,
   '{"en": "A magnificent Gothic cathedral built in the 14th century, converted to a mosque after the Ottoman conquest in 1571. The largest surviving medieval church in Cyprus. Twin minarets were added under Ottoman rule. Located in the heart of the old walled city, it remains an active place of worship.", "tr": "1571''deki Osmanlı fethinin ardından camiye dönüştürülen görkemli 14. yüzyıl Gotik katedrali. Kıbrıs''ta ayakta kalan en büyük ortaçağ kilisesidir. İkiz minareler Osmanlı döneminde eklenmiştir. Eski Lefkoşa''nın kalbinde, hâlâ aktif bir ibadet yeri olarak kullanılmaktadır."}'::jsonb,
   'religious_site', 'active'),

  (NULL, 'Büyük Han (Great Inn)', 'nicosia', 35.1720, 33.3647,
   '{"en": "The largest Ottoman caravanserai in Cyprus, built in 1572 shortly after the conquest. It once provided lodging and storage for merchants across 68 ground-floor rooms. Now beautifully restored as a cultural centre with galleries and craft workshops, it is a model heritage project.", "tr": "Kıbrıs''ın en büyük Osmanlı kervansarayı; adanın fethinin hemen ardından 1572''de inşa edilmiştir. Zemin kattaki 68 odada tüccarları ve mallarını barındırırdı. Galeriler ve zanaat atölyelerine ev sahipliği yapan kültür merkezine dönüştürülmüş, başarılı bir miras projesidir."}'::jsonb,
   'monument', 'active'),

  (NULL, 'Kyrenia Gate', 'nicosia', 35.1768, 33.3624,
   '{"en": "One of the three original gates in Nicosia''s 16th-century Venetian walls, facing north toward Kyrenia. Rebuilt in 1562, it once controlled access via a drawbridge over the moat. Now serves as a tourist information office and is a well-preserved example of Venetian military architecture.", "tr": "Lefkoşa''nın 16. yüzyıl Venedik surlarındaki üç özgün kapıdan biri; kuzeyinde Girne''ye yönelir. 1562''de yeniden inşa edilen kapı, eskiden hendek üzerindeki köprüyle surlu şehre geçişi denetliyordu. Şu anda turizm danışma ofisi olarak hizmet veren yapı, Venedik askeri mimarisinin güzel bir örneğidir."}'::jsonb,
   'monument', 'active');
