// Duyurular source registry — the single definition of every source. The fetcher upserts these
// rows into announcement_sources by `key` (never touching `publish` or the health columns).
//
// Probed 2026-10-10 (vault 10-ada/2026-10-10_duyurular-plan.md, attachments/duyurular-probe-*):
//   • Dropped by decision: eul.edu.tr feed, arucad feed, Gazimağusa /kat/haberler, Başbakanlık
//     basın açıklamaları, Tatlısu (newest item 2021), KTTB.
//   • Deferred: ktmmob.org (Vue SPA), Gönyeli kesintiler (map widget), kktcmeteor.
//   • Deferred 2026-10-10 (slice c): ODTÜ KKK acadpos (one static page, not a listing); Dikmen
//     tenders (the API works, but the public site answers 500 to non-browsers and no detail URL
//     could be verified, so there is no official link to give users).
//     UKÜ kariyer (a static page with one apply link). Çatalköy-Esentepe tenders (the only date
//     column is unlabelled, items are ZIP downloads, newest item 2026-02-06).
//   • The four KHK HTML münhal pages are replaced by KHK's hidden EasyDNN category feeds.
// crawl_delay_s mirrors the measured robots.txt Crawl-delay; the fetcher also re-reads robots.txt
// every run and takes the larger value.
// region: where the notice applies. Universities and national bodies are 'all' unless the
// institution is tied to one district.

const KHK = 'https://khk.gov.ct.tr/AR%C5%9E%C4%B0V/HABERLER/rss/category/3199/'
const MEB = 'https://www.mebnet.net/taxonomy/term/'

const rss = (o) => ({ type: 'rss', parser: 'rss', filter_mode: 'keywords', region: 'all', crawl_delay_s: 2, fetch_interval_min: 180, rank: 1, ...o })
const html = (o) => ({ type: 'html', filter_mode: 'keywords', region: 'all', crawl_delay_s: 2, fetch_interval_min: 360, rank: 1, ...o })

export const SOURCES = [
  // ─── Kamu ve sınavlar ────────────────────────────────────────────────────
  rss({ key: 'khk-disa-acik-munhal', name: 'KHK — Dışa açık münhal ilanları', institution: 'Kamu Hizmeti Komisyonu', url: KHK + 'd%C4%B1%C5%9Fa-a%C3%A7%C4%B1k-m%C3%BCnhal-%C4%B0lanlar%C4%B1', category: 'kamu', filter_mode: 'all', crawl_delay_s: 5, fetch_interval_min: 30, rank: 3 }),
  rss({ key: 'khk-yukselme-munhal', name: 'KHK — Yükselme münhal ilanları', institution: 'Kamu Hizmeti Komisyonu', url: KHK + 'y%C3%BCkselme-m%C3%BCnhal-%C4%B0lanlar%C4%B1', category: 'kamu', filter_mode: 'all', crawl_delay_s: 5, fetch_interval_min: 60, rank: 3 }),
  rss({ key: 'khk-yazili-sinav-cagrilari', name: 'KHK — Yazılı sınav çağrıları', institution: 'Kamu Hizmeti Komisyonu', url: KHK + 'yaz%C4%B1l%C4%B1-s%C4%B1nav-%C3%A7a%C4%9Fr%C4%B1lar%C4%B1', category: 'kamu', filter_mode: 'all', crawl_delay_s: 5, fetch_interval_min: 60, rank: 3 }),
  rss({ key: 'khk-sozlu-sinav-cagrilari', name: 'KHK — Sözlü sınav çağrıları', institution: 'Kamu Hizmeti Komisyonu', url: KHK + 's%C3%B6zl%C3%BC-s%C4%B1nav-%C3%A7a%C4%9Fr%C4%B1lar%C4%B1', category: 'kamu', filter_mode: 'all', crawl_delay_s: 5, fetch_interval_min: 60, rank: 3 }),
  rss({ key: 'khk-yazili-sinav-sonuclari', name: 'KHK — Yazılı sınav sonuçları', institution: 'Kamu Hizmeti Komisyonu', url: KHK + 'yaz%C4%B1l%C4%B1-s%C4%B1nav-sonu%C3%A7lar%C4%B1', category: 'kamu', filter_mode: 'all', crawl_delay_s: 5, fetch_interval_min: 120, rank: 3 }),
  rss({ key: 'khk-sozlu-sinav-sonuclari', name: 'KHK — Sözlü sınav sonuçları', institution: 'Kamu Hizmeti Komisyonu', url: KHK + 's%C3%B6zl%C3%BC-s%C4%B1nav-sonu%C3%A7lar%C4%B1', category: 'kamu', filter_mode: 'all', crawl_delay_s: 5, fetch_interval_min: 120, rank: 3 }),
  rss({ key: 'vergi', name: 'Gelir ve Vergi Dairesi', institution: 'Gelir ve Vergi Dairesi', url: 'https://vergi.gov.ct.tr/?q=rss.xml', category: 'kamu', crawl_delay_s: 10, rank: 3 }),
  rss({ key: 'merkez-bankasi', name: 'KKTC Merkez Bankası', institution: 'KKTC Merkez Bankası', url: 'https://www.kktcmerkezbankasi.org/tr/rss.xml', category: 'kamu', rank: 3,
    drop: /dibs|borçlanma senedi|merkez bankası senedi|^\d{1,2} \S+ \d{4}$/ }),
  rss({ key: 'mahkemeler', name: 'KKTC Mahkemeleri — Duyurular', institution: 'KKTC Mahkemeleri', url: 'https://www.mahkemeler.net/?cat=46&feed=rss2', category: 'kamu', rank: 3 }),
  rss({ key: 'saglik-duyurular', name: 'Sağlık Bakanlığı — Duyurular', institution: 'Sağlık Bakanlığı', url: 'https://saglik.gov.ct.tr/DUYURULAR/rss/category/1012/duyurular', category: 'kamu', crawl_delay_s: 5, rank: 3 }),
  rss({ key: 'ysk', name: 'Yüksek Seçim Kurulu', institution: 'Yüksek Seçim Kurulu', url: 'https://ysk.gov.ct.tr/feed/', category: 'kamu', filter_mode: 'all', fetch_interval_min: 120, rank: 3 }),
  html({ key: 'polis-duyurular', name: 'Polis Genel Müdürlüğü — Duyurular', institution: 'Polis Genel Müdürlüğü', url: 'https://polis.gov.ct.tr/website/duyurular/1.html', parser: 'polis', category: 'kamu', rank: 3 }),
  html({ key: 'sosyal-sigortalar', name: 'Sosyal Sigortalar Dairesi', institution: 'Sosyal Sigortalar Dairesi', url: 'https://ssd.gov.ct.tr/', parser: 'ssd', category: 'kamu', rank: 3 }),

  // ─── Eğitim ve burslar ───────────────────────────────────────────────────
  rss({ key: 'meb-term-5', name: 'Milli Eğitim Bakanlığı — Duyurular', institution: 'Milli Eğitim Bakanlığı', url: MEB + '5/feed', category: 'egitim', filter_mode: 'all', rank: 2 }),
  rss({ key: 'meb-term-13', name: 'Milli Eğitim Bakanlığı — Sınavlar', institution: 'Milli Eğitim Bakanlığı', url: MEB + '13/feed', category: 'egitim', filter_mode: 'all', rank: 2 }),
  rss({ key: 'meb-term-29', name: 'Milli Eğitim Bakanlığı — Kılavuzlar', institution: 'Milli Eğitim Bakanlığı', url: MEB + '29/feed', category: 'egitim', filter_mode: 'all', rank: 2 }),
  rss({ key: 'meb-term-15', name: 'Milli Eğitim Bakanlığı — Akademik takvim', institution: 'Milli Eğitim Bakanlığı', url: MEB + '15/feed', category: 'egitim', filter_mode: 'all', fetch_interval_min: 1440, rank: 2 }),
  rss({ key: 'meb-mtod', name: 'Mesleki Teknik Öğretim Dairesi', institution: 'Mesleki Teknik Öğretim Dairesi', url: 'https://mtod.mebnet.net/?q=rss.xml', category: 'egitim', crawl_delay_s: 10, rank: 2 }),
  rss({ key: 'meb-iod', name: 'İlköğretim Dairesi', institution: 'İlköğretim Dairesi', url: 'https://iod.mebnet.net/feed/', category: 'egitim', rank: 2 }),
  html({ key: 'meb-yobis', name: 'YOBİS — Yükseköğrenim duyuruları', institution: 'Milli Eğitim Bakanlığı', url: 'https://yobis.mebnet.net/', parser: 'yobis', category: 'egitim', rank: 2 }),
  rss({ key: 'yodak', name: 'YÖDAK — Duyurular', institution: 'YÖDAK', url: 'https://yodak.gov.ct.tr/haberler/duyurular.html?format=feed&type=rss', category: 'egitim', crawl_delay_s: 15, rank: 3 }),
  html({ key: 'genclik', name: 'Gençlik Dairesi', institution: 'Gençlik Dairesi', url: 'http://genclik.gov.ct.tr/HABERLER', parser: 'easydnn', category: 'egitim', crawl_delay_s: 5, rank: 3 }),
  html({ key: 'euburs', name: 'AB Burs Programı', institution: 'AB Burs Programı', url: 'https://www.euburs.eu/announcements', parser: 'euburs', category: 'egitim' }),
  rss({ key: 'akun-munhal', name: 'Akdeniz Karpaz Üniversitesi — Münhal', institution: 'Akdeniz Karpaz Üniversitesi', url: 'https://akun.edu.tr/category/munhal/feed/', category: 'egitim', filter_mode: 'all', region: 'lefkosa' }),
  rss({ key: 'akun-duyurular', name: 'Akdeniz Karpaz Üniversitesi — Duyurular', institution: 'Akdeniz Karpaz Üniversitesi', url: 'https://akun.edu.tr/category/duyurular/feed/', category: 'egitim', region: 'lefkosa' }),
  rss({ key: 'adakent', name: 'Ada Kent Üniversitesi — Duyurular', institution: 'Ada Kent Üniversitesi', url: 'https://adakent.edu.tr/category/duyurular/feed/', category: 'egitim', filter_mode: 'all', region: 'gazimagusa' }),
  rss({ key: 'aoa', name: 'Atatürk Öğretmen Akademisi — Duyurular', institution: 'Atatürk Öğretmen Akademisi', url: 'https://aoa.edu.tr/category/aoa-duyurular/feed/', category: 'egitim', region: 'lefkosa' }),
  rss({ key: 'ktezo', name: 'Esnaf ve Zanaatkârlar Odası — Duyurular', institution: 'Kıbrıs Türk Esnaf ve Zanaatkârlar Odası', url: 'https://ktezo.org/category/duyurular/feed/', category: 'egitim' }),
  rss({ key: 'itu-kktc', name: 'İTÜ-KKTC — Duyurular', institution: 'İTÜ-KKTC', url: 'https://kktc.itu.edu.tr/index.php/tr/announcementss?format=feed&type=rss', category: 'egitim' }),
  rss({ key: 'itu-kktc-oim', name: 'İTÜ-KKTC — Öğrenci İşleri', institution: 'İTÜ-KKTC', url: 'https://oim.kktc.itu.edu.tr/index.php/en/announcements?format=feed&type=rss', category: 'egitim' }),
  html({ key: 'asbu-kktc', name: 'ASBÜ KKTC — Duyurular', institution: 'Ankara Sosyal Bilimler Üniversitesi KKTC', url: 'https://kktc.asbu.edu.tr/tr/duyurular', parser: 'asbu', category: 'egitim' }),
  html({ key: 'emu-duyurular', name: 'DAÜ — Duyurular', institution: 'Doğu Akdeniz Üniversitesi', url: 'https://www.emu.edu.tr/duyurular', parser: 'emu', category: 'egitim', crawl_delay_s: 5, region: 'gazimagusa' }),
  html({ key: 'gau-duyurular', name: 'GAÜ — Duyurular', institution: 'Girne Amerikan Üniversitesi', url: 'https://www.gau.edu.tr/servisler/duyurular', parser: 'gau', category: 'egitim', region: 'girne' }),

  // ─── İhaleler ────────────────────────────────────────────────────────────
  { key: 'ted-tcc', name: 'TED — AB Kıbrıs Türk Toplumu Yardım Programı', institution: 'Avrupa Birliği', url: 'https://api.ted.europa.eu/v3/notices/search',
    type: 'ted', parser: 'ted', category: 'ihale', kind: 'open', region: 'all', filter_mode: 'all', crawl_delay_s: 2, fetch_interval_min: 720, rank: 3 },
  rss({ key: 'gazimagusa-ihaleler', name: 'Gazimağusa Belediyesi — İhaleler', institution: 'Gazimağusa Belediyesi', url: 'https://www.gazimagusabelediyesi.org/kat/ihaleler/feed/', category: 'ihale', filter_mode: 'all', region: 'gazimagusa', rank: 2 }),
  rss({ key: 'girne-ihaleler', name: 'Girne Belediyesi — İhaleler', institution: 'Girne Belediyesi', url: 'https://www.girnebelediyesi.com/ihaleler/feed/', category: 'ihale', filter_mode: 'all', region: 'girne', rank: 2 }),
  rss({ key: 'maliye', name: 'Maliye Bakanlığı — Duyurular', institution: 'Maliye Bakanlığı', url: 'https://maliye.gov.ct.tr/tr/duyurular/index.xml', category: 'ihale', rank: 3 }),
  rss({ key: 'meb-ihaleler', name: 'Milli Eğitim Bakanlığı — İhaleler', institution: 'Milli Eğitim Bakanlığı', url: MEB + '16/feed', category: 'ihale', filter_mode: 'all', rank: 2 }),
  rss({ key: 'kibtek', name: 'KIB-TEK — İhale ve ilanlar', institution: 'Kıbrıs Türk Elektrik Kurumu', url: 'https://www.kibtek.com/feed/', category: 'ihale', rank: 2 }),
  html({ key: 'emu-ihale-portal', name: 'DAÜ — İhale portalı', institution: 'Doğu Akdeniz Üniversitesi', url: 'http://ihaleportal.emu.edu.tr/sartnamelisteleme.aspx', parser: 'emuihale', category: 'ihale', filter_mode: 'all', region: 'gazimagusa' }),
  html({ key: 'degirmenlik-ihaleler', name: 'Değirmenlik-Akıncılar Belediyesi — İhaleler', institution: 'Değirmenlik-Akıncılar Belediyesi', url: 'https://www.degirmenlikakincilar.org/ihaleler/', parser: 'degirmenlik', category: 'ihale', filter_mode: 'all', region: 'lefkosa', rank: 2 }),
  html({ key: 'erenkoy-karpaz-ihaleler', name: 'Erenköy-Karpaz Belediyesi — İhaleler', institution: 'Erenköy-Karpaz Belediyesi', url: 'https://erenkoykarpazbelediyesi.com/kurumsal/ihale-duyurulari.html', parser: 'joomlaihale', category: 'ihale', filter_mode: 'all', region: 'iskele', crawl_delay_s: 15, rank: 2 }),
  html({ key: 'gecitkale-ihaleler', name: 'Geçitkale-Serdarlı Belediyesi — İhaleler', institution: 'Geçitkale-Serdarlı Belediyesi', url: 'https://www.gecitkaleserdarlibelediyesi.com/kurumsal/ihale-duyurulari.html', parser: 'joomlaihale', category: 'ihale', filter_mode: 'all', region: 'gazimagusa', crawl_delay_s: 15, rank: 2 }),
  html({ key: 'yenibogazici-ihaleler', name: 'Yeniboğaziçi Belediyesi — İhaleler', institution: 'Yeniboğaziçi Belediyesi', url: 'https://www.yenibogazicibelediyesi.com/kurumsal/ihale-duyurular%C4%B1.html', parser: 'joomlaihale', category: 'ihale', filter_mode: 'all', region: 'gazimagusa', crawl_delay_s: 15, rank: 2 }),
  html({ key: 'guzelyurt-ihaleler', name: 'Güzelyurt Belediyesi — İhaleler', institution: 'Güzelyurt Belediyesi', url: 'https://www.guzelyurtbelediyesi.com/kurumsal/ihale-duyurular%C4%B1.html', parser: 'joomlaihale', category: 'ihale', filter_mode: 'all', region: 'guzelyurt', crawl_delay_s: 10, rank: 2 }),
  html({ key: 'gonyeli-ihaleler', name: 'Gönyeli-Alayköy Belediyesi — İhaleler', institution: 'Gönyeli-Alayköy Belediyesi', url: 'https://gonyelibelediyesi.org/sayfa/ihaleler', parser: 'gonyeli', category: 'ihale', filter_mode: 'all', region: 'lefkosa', rank: 2 }),
  html({ key: 'mucahitler-ihaleler', name: 'Mücahitler Dairesi — İhale duyuruları', institution: 'Mücahitler Dairesi', url: 'https://mucahit.gov.ct.tr/Sayfa/IhaleDuyuru', parser: 'mucahit', category: 'ihale', filter_mode: 'all', rank: 3 }),
  html({ key: 'evkaf-ihaleler', name: 'Kıbrıs Vakıflar İdaresi — İhaleler', institution: 'Kıbrıs Vakıflar İdaresi', url: 'https://evkaf.org/ihaleler/', parser: 'evkaf', category: 'ihale', filter_mode: 'all', rank: 2 }),
  html({ key: 'lapta-alsancak-ihaleler', name: 'Lapta-Alsancak-Çamlıbel Belediyesi — İhaleler', institution: 'Lapta-Alsancak-Çamlıbel Belediyesi', url: 'https://lacbelediyesi.org/ihaleler', parser: 'lac', category: 'ihale', filter_mode: 'all', region: 'girne', rank: 2 }),
  html({ key: 'lefke-ihaleler', name: 'Lefke Belediyesi — İhale duyuruları', institution: 'Lefke Belediyesi', url: 'https://lefkebelediyesi.com/ihale-duyurulari/', parser: 'lefkeihale', category: 'ihale', filter_mode: 'all', region: 'lefke', rank: 2 }),
  html({ key: 'rkmmd-duyurular', name: 'Ruhsat ve Kamu Mal Müdürlüğü — Duyurular', institution: 'Ruhsat ve Kamu Mal Müdürlüğü', url: 'https://rkmmd.gov.ct.tr/DUYURULAR', parser: 'easydnn', category: 'ihale', crawl_delay_s: 5, rank: 3 }),
  html({ key: 'ticaret', name: 'Ticaret Dairesi', institution: 'Ticaret Dairesi', url: 'https://ticaret.gov.ct.tr/HABERLER', parser: 'easydnn', category: 'ihale', crawl_delay_s: 5, rank: 3 }),

  // ─── Belediyeler ─────────────────────────────────────────────────────────
  rss({ key: 'gazimagusa-duyurular', name: 'Gazimağusa Belediyesi — Duyurular', institution: 'Gazimağusa Belediyesi', url: 'https://www.gazimagusabelediyesi.org/kat/duyurular/feed/', category: 'belediye', filter_mode: 'all', region: 'gazimagusa', fetch_interval_min: 60, rank: 2 }),
  rss({ key: 'ktbb', name: 'Belediyeler Birliği — Üye haberleri', institution: 'Kıbrıs Türk Belediyeler Birliği', url: 'https://ktbb.org/category/uyelerimizin-haberleri/feed/', category: 'belediye', rank: 2 }),
  rss({ key: 'lefke-belediye', name: 'Lefke Belediyesi', institution: 'Lefke Belediyesi', url: 'https://lefkebelediyesi.com/feed/', category: 'belediye', region: 'lefke', rank: 2 }),

  // ─── Destek ve hibeler ───────────────────────────────────────────────────
  rss({ key: 'civicspace', name: 'Civic Space', institution: 'Civic Space (AB destekli)', url: 'https://civicspace.eu/feed/', category: 'destek' }),
  rss({ key: 'kobigem', name: 'KOBİGEM — Duyurular', institution: 'KOBİ Geliştirme Merkezi', url: 'https://kobigem.gov.ct.tr/DUYURULAR/rss/3345', category: 'destek', filter_mode: 'all', crawl_delay_s: 5, rank: 3 }),
  rss({ key: 'csgb', name: 'Çalışma ve Sosyal Güvenlik Bakanlığı', institution: 'Çalışma ve Sosyal Güvenlik Bakanlığı', url: 'https://csgb.gov.ct.tr/HABERLER/rss/3101', category: 'destek', crawl_delay_s: 5, rank: 3 }),
  html({ key: 'sanayi', name: 'Sanayi Dairesi', institution: 'Sanayi Dairesi', url: 'https://sanayi.gov.ct.tr/HABERLER', parser: 'easydnn', category: 'destek', crawl_delay_s: 5, rank: 3 }),
  html({ key: 'kei', name: 'T.C. Kalkınma ve Ekonomik İşbirliği (KEİ) Ofisi', institution: 'T.C. Kalkınma ve Ekonomik İşbirliği Ofisi', url: 'https://kei.gov.tr/haberler', parser: 'kei', category: 'destek', rank: 2 }),

  // ─── Araç ve ulaşım ──────────────────────────────────────────────────────
  rss({ key: 'trafik-dairesi', name: 'Bayındırlık ve Ulaştırma Bakanlığı — Trafik Dairesi', institution: 'Bayındırlık ve Ulaştırma Bakanlığı', url: 'https://bub.gov.ct.tr/DA%C4%B0RE-VE-KURUMLAR/TRAF%C4%B0K-DA%C4%B0RES%C4%B0/rss/4558', category: 'ulasim', crawl_delay_s: 5, rank: 3 }),
]

// Categories whose new items also get the linked PDF read for a deadline (approved 2026-10-10).
export const PDF_CATEGORIES = new Set(['ihale', 'kamu'])
