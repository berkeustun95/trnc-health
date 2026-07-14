// Canonical TRNC region set for city detection.
//
// SEVEN slugs. This is the set already enforced by the DB — see the
// `CHECK (district IN (...))` constraints on `job_postings`, `beaches` and
// `landmarks` — and the set every district chip row in the app renders. It has
// full i18n coverage via the `blDistrict*` keys (all 9 locales).
//
// KARPAZ IS OUR INVENTED 7th REGION. Officially TRNC has six districts
// (Lefkoşa, Gazimağusa, Girne, Güzelyurt, İskele, Lefke) and the Karpaz
// peninsula is part of İskele. We split it out deliberately, because people say
// "I'm going to Karpaz", not "I'm going to northern İskele". DO NOT "correct"
// this back to six — it is a product decision, not a data error.
//
// MESARYA IS NOT IN THIS SET. `duty_list.region` carries an 8th value,
// 'Mesarya', which is a pharmacists'-chamber duty-rota zone, not a district —
// the central plain, split into Üst (upper) and Alt (lower). Those coordinates
// fold into `nicosia` / `famagusta` by geography via the anchors below.

export const REGIONS = ['nicosia', 'kyrenia', 'famagusta', 'morphou', 'iskele', 'lefke', 'karpaz']

// i18n keys — these already exist in all 9 locales.
export const REGION_LABEL_KEY = {
  nicosia:   'blDistrictNicosia',
  kyrenia:   'blDistrictKyrenia',
  famagusta: 'blDistrictFamagusta',
  morphou:   'blDistrictMorphou',
  iskele:    'blDistrictIskele',
  lefke:     'blDistrictLefke',
  karpaz:    'blDistrictKarpaz',
}

// Slug -> the Turkish strings `duty_list.region` uses. Both Mesarya values are
// listed under the district that contains them, so a duty-pharmacy filter by
// slug picks up the rota zone too.
export const REGION_TO_DUTY = {
  nicosia:   ['Lefkoşa', 'Mesarya'],
  kyrenia:   ['Girne'],
  famagusta: ['Gazimağusa', 'Mesarya'],
  morphou:   ['Güzelyurt'],
  iskele:    ['İskele'],
  lefke:     ['Lefke'],
  karpaz:    ['Karpaz'],
}

// ---------------------------------------------------------------------------
// ANCHORS — the classifier's training set. [lat, lng, region]
//
// GENERATED, NOT HAND-PICKED. Every coordinate outside the karpaz block is
// lifted verbatim from `seed_pharmacies_geocoded.sql` (387 KTEB pharmacies,
// geocoded via Nominatim), deduplicated by coordinate. Each is a real populated
// place whose district we know from the pharmacy's own address. `resolveRegion`
// assigns a coordinate to the district of its NEAREST anchor.
//
// Karpaz is the one exception, and the karpaz block says why: the peninsula had
// only three pharmacy coordinates, two of them badly geocoded, so it uses
// verified town centres instead.
//
// Why anchors and not one centroid per district: Tatlısu is administratively
// Gazimağusa but sits on the north coast ~30 km from Famagusta city, and Dikmen
// is Girne district but lies south of the Beşparmak ridge, nearer Nicosia. A
// single centroid per district misfiles both. Anchoring on the towns themselves
// is what makes these long, awkward districts come out right.
//
// The near-duplicate city-centre entries are deliberate — they cost nothing and
// keep this list a faithful projection of the data rather than a curated one.
//
// EDITS applied to the raw pharmacy data, and only these:
//   1. MESARYA FOLD. `Alt Mesarya` -> famagusta; `Üst Mesarya` -> nicosia,
//      except Geçitkale and Serdarlı, which sit in Gazimağusa district.
//   2. DROPPED the single 'Yeni İskele' row. Its address is a real
//      İskele-district place but the geocoder returned YENIERENKÖY's coordinates
//      (35.5343, 34.1886) — ~75 km away, in Karpaz. Keeping it would drag all of
//      Yenierenköy into `iskele`. It is a seed-data bug, fix it in the DB.
//   3. KARPAZ REPLACED with verified town centres — see that block.
// ---------------------------------------------------------------------------

export const ANCHORS = [
  // --- nicosia (51) ---
  [35.1779404, 33.3609118, 'nicosia'], // Atatürk Meydanı
  [35.1785584, 33.3521926, 'nicosia'], // Dereboyu
  [35.1790633, 33.3620592, 'nicosia'], // Surlariçi
  [35.1794269, 33.2518214, 'nicosia'], // Alayköy
  [35.1800110, 33.3567074, 'nicosia'], // Köşklüçiftlik
  [35.1806595, 33.2533088, 'nicosia'], // Alayköy
  [35.1830733, 33.3513439, 'nicosia'], // Köşklüçiftlik
  [35.1831436, 33.3658033, 'nicosia'], // Çağlayan
  [35.1849854, 33.3208016, 'nicosia'], // Aydemet
  [35.1853773, 33.3610135, 'nicosia'], // Lefkoşa centre / walled city
  [35.1875489, 33.3547705, 'nicosia'], // Kumsal
  [35.1885468, 33.3611666, 'nicosia'], // Yenişehir
  [35.1889917, 33.3638584, 'nicosia'], // Yenişehir
  [35.1897381, 33.3497209, 'nicosia'], // Kumsal
  [35.1903413, 33.3666023, 'nicosia'], // Yenişehir
  [35.1911454, 33.3147213, 'nicosia'], // Metehan
  [35.1912448, 33.3516394, 'nicosia'], // Kumsal
  [35.1936982, 33.3215399, 'nicosia'], // Kermiya
  [35.1951575, 33.3471481, 'nicosia'], // Kumsal
  [35.1953127, 33.3470734, 'nicosia'], // Bedreddin Demirel
  [35.1967372, 33.3643616, 'nicosia'], // Küçük Kaymaklı
  [35.1968396, 33.3678620, 'nicosia'], // Küçük Kaymaklı
  [35.1984395, 33.3542473, 'nicosia'], // Kızılbaş
  [35.1992948, 33.3475460, 'nicosia'], // Marmara Bölgesi
  [35.1998672, 33.3410044, 'nicosia'], // Ortaköy
  [35.2003174, 33.3402381, 'nicosia'], // Ortaköy
  [35.2006489, 33.3283273, 'nicosia'], // Ortaköy
  [35.2014680, 33.3505630, 'nicosia'], // Marmara Bölgesi
  [35.2019075, 33.3497840, 'nicosia'], // Marmara Bölgesi
  [35.2031147, 33.3210321, 'nicosia'], // Gönyeli
  [35.2060296, 33.3165955, 'nicosia'], // Yenikent / Gönyeli
  [35.2061773, 33.2997982, 'nicosia'], // Yenikent
  [35.2063724, 33.4200196, 'nicosia'], // Haspolat            [Üst Mesarya]
  [35.2065324, 33.3183197, 'nicosia'], // Gönyeli
  [35.2070072, 33.3457502, 'nicosia'], // Taşkınköy
  [35.2075098, 33.3352990, 'nicosia'], // Göçmenköy
  [35.2077734, 33.3365760, 'nicosia'], // Göçmenköy
  [35.2081157, 33.3090518, 'nicosia'], // Gönyeli
  [35.2083526, 33.3051820, 'nicosia'], // Gönyeli
  [35.2091164, 33.3188798, 'nicosia'], // Gönyeli
  [35.2094901, 33.3601932, 'nicosia'], // Hazar Sok.
  [35.2113211, 33.3391992, 'nicosia'], // Taşkınköy
  [35.2113587, 33.3389609, 'nicosia'], // Göçmenköy
  [35.2128347, 33.3748718, 'nicosia'], // Hamitköy
  [35.2138298, 33.2901124, 'nicosia'], // Gönyeli
  [35.2143491, 33.3784008, 'nicosia'], // Hamitköy
  [35.2164170, 33.3058171, 'nicosia'], // Gönyeli
  [35.2233822, 33.4793482, 'nicosia'], // Demirhan            [Üst Mesarya]
  [35.2236556, 33.3794849, 'nicosia'], // Hamitköy
  [35.2274826, 33.5134937, 'nicosia'], // Cihangir            [Üst Mesarya]
  [35.2476457, 33.4806933, 'nicosia'], // Değirmenlik         [Üst Mesarya]

  // --- kyrenia (26) ---
  [35.2687477, 33.3235946, 'kyrenia'], // Dikmen — Girne district, but south of the ridge
  [35.2895141, 33.2793908, 'kyrenia'], // Boğazköy
  [35.3125004, 33.0665723, 'kyrenia'], // Çamlıbel
  [35.3179721, 33.3855766, 'kyrenia'], // Ecevit Cad.
  [35.3195514, 33.3533516, 'kyrenia'], // Ozanköy
  [35.3213447, 33.3906576, 'kyrenia'], // Çatalköy
  [35.3232731, 33.3209665, 'kyrenia'], // Yukarı Girne
  [35.3256596, 33.3344148, 'kyrenia'], // Doğanköy
  [35.3318281, 33.3401011, 'kyrenia'], // Karakum
  [35.3319271, 33.3204034, 'kyrenia'], // Yukarı Girne
  [35.3326865, 33.3420667, 'kyrenia'], // Karakum
  [35.3335723, 33.2172722, 'kyrenia'], // Atatürk Cad.
  [35.3339552, 33.3220984, 'kyrenia'], // Yukarı Girne
  [35.3354384, 33.3117477, 'kyrenia'], // Yukarı Girne
  [35.3362096, 33.3078679, 'kyrenia'], // Naci Talat Cad.
  [35.3363610, 33.3103842, 'kyrenia'], // Işıl Sok.
  [35.3385205, 33.2936615, 'kyrenia'], // Dr. Salih Miroğlu Cad.
  [35.3387318, 33.1722789, 'kyrenia'], // Lapta
  [35.3394007, 33.5831724, 'kyrenia'], // Esentepe — east end of the Girne strip
  [35.3394085, 33.1960746, 'kyrenia'], // Alsancak
  [35.3396049, 33.3186667, 'kyrenia'], // Beyoğlu Sok.
  [35.3396291, 33.3205287, 'kyrenia'], // Girne centre
  [35.3415909, 33.3199542, 'kyrenia'], // Kordonboyu
  [35.3418625, 33.2760011, 'kyrenia'], // Karaoğlanoğlu
  [35.3424212, 33.2716623, 'kyrenia'], // Karaoğlanoğlu
  [35.3484462, 33.2132664, 'kyrenia'], // Karaoğlanoğlu Cad.

  // --- famagusta (41) ---
  [35.0431635, 33.7083230, 'famagusta'], // Beyarmudu — southernmost TRNC point in our data  [Alt Mesarya]
  [35.1051220, 33.7166764, 'famagusta'], // Türkmenköy       [Alt Mesarya]
  [35.1062416, 33.6822908, 'famagusta'], // Akdoğan          [Alt Mesarya]
  [35.1108692, 33.5662154, 'famagusta'], // Dilekkaya        [Alt Mesarya]
  [35.1128276, 33.9519605, 'famagusta'], // Maraş
  [35.1128721, 33.9255900, 'famagusta'], // Çanakkale
  [35.1165179, 33.9311256, 'famagusta'], // Baykal
  [35.1170826, 33.9354955, 'famagusta'], // Kocatepe Sok.
  [35.1179692, 33.9359257, 'famagusta'], // Karakız Sok.
  [35.1187265, 33.9356954, 'famagusta'], // Larnaka Yolu
  [35.1198107, 33.9364587, 'famagusta'], // Baykal
  [35.1199391, 33.9168912, 'famagusta'], // Çanakkale
  [35.1200017, 33.9382266, 'famagusta'], // 15 Ağustos Blv.
  [35.1205261, 33.9387919, 'famagusta'], // Gazimağusa centre
  [35.1239895, 33.9295735, 'famagusta'], // Mustafa Kemal Blv.
  [35.1244736, 33.9323938, 'famagusta'], // Dumlupınar
  [35.1247645, 33.9417482, 'famagusta'], // Suriçi
  [35.1251034, 33.9335236, 'famagusta'], // Dumlupınar
  [35.1284351, 33.9196349, 'famagusta'], // Kaliland
  [35.1295017, 33.9290281, 'famagusta'], // İsmet İnönü Blv.
  [35.1314592, 33.9192006, 'famagusta'], // Sakarya
  [35.1327895, 33.9215936, 'famagusta'], // Sakarya
  [35.1337935, 33.6557314, 'famagusta'], // Vadili           [Alt Mesarya]
  [35.1341882, 33.9298908, 'famagusta'], // Karakol
  [35.1382940, 33.9255657, 'famagusta'], // Karakol
  [35.1395344, 33.9143446, 'famagusta'], // Sakarya
  [35.1474433, 33.8855815, 'famagusta'], // Tuzla
  [35.1480031, 33.9093521, 'famagusta'], // İsmet İnönü Blv.
  [35.1519171, 33.9066080, 'famagusta'], // Salamis Yolu
  [35.1525429, 33.9064181, 'famagusta'], // Salamis Yolu
  [35.1550084, 33.9036594, 'famagusta'], // Devlet Hastanesi Yolu
  [35.1576104, 33.7005485, 'famagusta'], // İnönü            [Alt Mesarya]
  [35.1576931, 33.8941323, 'famagusta'], // Tuzla
  [35.1581388, 33.6090186, 'famagusta'], // Paşaköy          [Alt Mesarya]
  [35.1611026, 33.8830887, 'famagusta'], // Tuzla
  [35.1755782, 33.7568549, 'famagusta'], // Dörtyol          [Alt Mesarya]
  [35.1961975, 33.8780416, 'famagusta'], // Yeniboğaziçi
  [35.2321510, 33.8834818, 'famagusta'], // Yeniboğaziçi
  [35.2545945, 33.6022318, 'famagusta'], // Serdarlı         [Üst Mesarya -> Gazimağusa]
  [35.2605334, 33.7321988, 'famagusta'], // Geçitkale        [Üst Mesarya -> Gazimağusa]
  [35.3726129, 33.7533656, 'famagusta'], // Tatlısu — north coast, Gazimağusa district

  // --- morphou (9) ---
  [35.1677603, 33.0091397, 'morphou'], // İzzet Kombos Blv.
  [35.1685572, 33.0066204, 'morphou'], // Aşağı Bostancı
  [35.1804629, 33.0270362, 'morphou'], // Akçay
  [35.1916339, 32.9935032, 'morphou'], // Kutlu Adalı Blv.
  [35.1916564, 32.9936824, 'morphou'], // Kutlu Adalı Blv.
  [35.1926757, 32.9948156, 'morphou'], // Kutlu Adalı Blv.
  [35.1938995, 32.9976120, 'morphou'], // Piyale Paşa
  [35.1993042, 32.9928829, 'morphou'], // Güzelyurt centre
  [35.2464189, 33.0355782, 'morphou'], // Kalkanlı

  // --- iskele (5) ---
  [35.2346419, 33.8723517, 'iskele'], // Ötüken
  [35.2832589, 33.8841880, 'iskele'], // İskele
  [35.2856770, 33.8930603, 'iskele'], // İskele centre
  [35.2863782, 33.9125832, 'iskele'], // Bahçeler
  [35.3150319, 33.9505624, 'iskele'], // Boğaz

  // --- lefke (7) ---
  [35.1137814, 32.8495971, 'lefke'], // Lefke centre
  [35.1318489, 32.8651117, 'lefke'], // Cengizköy
  [35.1331227, 32.9133720, 'lefke'], // Doğancı
  [35.1407130, 32.8338857, 'lefke'], // Gemikonağı
  [35.1429608, 32.8088418, 'lefke'], // Denizli
  [35.1531147, 32.8844033, 'lefke'], // Yeşilyurt
  [35.1724843, 32.9164496, 'lefke'], // Gaziveren

  // --- karpaz (3) ---
  // The ONLY region not drawn from the pharmacy seed. The peninsula had just
  // three pharmacy coordinates and two were badly geocoded, so these are verified
  // town centres (Google Places locality centroids, checked on a map) instead.
  // Karpaz is no longer the weak spot in this file.
  //
  // All three old pharmacy pins were DROPPED:
  //   - old Yenierenköy sat 110 m from the verified pin — redundant.
  //   - the "Çayırova" row sat 650 m from Dipkarpaz — redundant, and its address
  //     was a bad geocode anyway.
  //   - the "Mehmetçik" row (35.6587, 34.5236) is nowhere near Mehmetçik. It was
  //     tempting to keep it for tip coverage, but that turned out to be a
  //     non-reason: with it gone, Golden Beach, Apostolos Andreas Monastery and
  //     Zafer Burnu still resolve to karpaz off Dipkarpaz (13.4 / 18.6 / 19.3 km,
  //     against MAX_ANCHOR_KM 25). It bought nothing, and it is a coordinate we
  //     cannot vouch for. Dropped.
  // THE RULE IS: EAST OF BOĞAZ = KARPAZ, NO EXCEPTION.
  //
  // This means the Bafra resort strip resolves to `karpaz`, not `iskele`, because
  // Kumyalı is ~9 km away and the nearest İskele anchor (Boğaz) is ~13 km. That is
  // DELIBERATE — do not "fix" it by adding a Bafra anchor. Bafra is east of Boğaz,
  // on the peninsula, and functions as the Karpaz gateway: its guests are there
  // for the peninsula. "Welcome to Karpaz" is right at the Kaya Artemis;
  // "Welcome to İskele" would not be.
  [35.4281800, 34.1308300, 'karpaz'], // Kumyalı — base of the peninsula
  [35.5353100, 34.1894100, 'karpaz'], // Yenierenköy — midway
  [35.5987500, 34.3807700, 'karpaz'], // Dipkarpaz (Rizokarpaso town, not the park)
]

// ---------------------------------------------------------------------------
// TRNC OUTLINE — the gate polygon. [lat, lng], one closed ring.
//
// Purpose: answer "is this coordinate in TRNC at all?" and nothing more. A
// nearest-anchor lookup alone is NOT enough — Athienou (RoC) sits ~3 km from
// our Dilekkaya anchor, and Larnaca/Ayia Napa are within ~15 km of Mesarya and
// Famagusta anchors. Without this gate they would all resolve to a TRNC region.
//
// Two rules governed how this was authored:
//   1. OFFSHORE, BE GENEROUS. Sea vertices are deliberately slack — nobody
//      opens the app in the water, so a loose coastline costs nothing and
//      protects against coarse-rounding error at harbour towns (Boğaz, Girne).
//   2. ON THE GREEN LINE, BE CAREFUL. Every vertex along the southern edge is
//      pinned between a real TRNC place that must stay IN and a real RoC place
//      that must stay OUT. The tight pairs are Beyarmudu (in) vs Deryneia (out)
//      and Dilekkaya (in) vs Athienou (out).
//
// KNOWN LIMIT — NICOSIA IS NOT SEPARABLE. The Green Line runs straight through
// the city: north Nicosia's walled centre is ~800 m from south Nicosia's. We
// coarsen coordinates to 2 dp (~1.1 km) before use, so at Nicosia this polygon
// CANNOT tell the two halves apart, and a user in the Republic's half may
// resolve to `nicosia`. That is a physical limit of coarse location, not a
// tuning problem — do not try to fix it by insetting the line north, which
// would null out the whole of north Nicosia instead.
//
// The Erenköy/Kokkina exclave (~32.61 E) is deliberately OUTSIDE this ring: it
// is a TRNC pocket surrounded by RoC territory, has no ADA content, and
// including it would mean drawing a second polygon for a handful of people.
// ---------------------------------------------------------------------------

export const TRNC_OUTLINE = [
  // West coast, north from the Green Line
  [35.190, 32.720],
  [35.245, 32.755],
  [35.300, 32.820],
  [35.355, 32.875],
  [35.4025, 32.9186], // Cape Kormakitis (Koruçam Burnu)
  // North coast, east toward Girne
  [35.390, 33.000],
  [35.368, 33.080],
  [35.358, 33.170],
  [35.352, 33.260],
  [35.350, 33.320],
  [35.356, 33.400],
  [35.366, 33.470],
  [35.372, 33.510],
  [35.384, 33.600],
  [35.396, 33.700],
  [35.404, 33.790], // keeps Tatlısu inside
  [35.424, 33.880],
  [35.454, 33.960],
  [35.494, 34.060],
  [35.545, 34.150],
  [35.585, 34.250],
  [35.620, 34.360],
  [35.655, 34.470],
  [35.6893, 34.5865], // Cape Apostolos Andreas (Zafer Burnu)
  // Back down the SOUTH side of the Karpaz peninsula. The coast here runs almost
  // due north-south below the cape, so these vertices have to swing east before
  // heading west — a straight cut from the cape slices off Apostolos Andreas
  // Monastery and Golden Beach, both of which are real, seeded content.
  [35.650, 34.620],
  [35.605, 34.600],
  [35.570, 34.545],
  [35.535, 34.470],
  [35.500, 34.390],
  [35.465, 34.310],
  [35.430, 34.230],
  [35.400, 34.140],
  [35.370, 34.050],
  // East coast, south past Boğaz and Famagusta
  [35.345, 33.975],
  [35.295, 33.965],
  [35.230, 33.960],
  [35.180, 33.965],
  [35.140, 33.975],
  [35.100, 33.970],
  [35.075, 33.958], // south end of Varosha — Green Line meets the sea
  // GREEN LINE, west. Every vertex below is load-bearing.
  [35.062, 33.900], // Deryneia (35.0575, 33.9550) stays OUT
  [35.050, 33.820],
  [35.030, 33.740],
  [35.025, 33.700], // Beyarmudu (35.0432, 33.7083) stays IN
  [35.045, 33.640],
  [35.075, 33.580],
  [35.095, 33.520], // Athienou (35.0625, 33.5400) stays OUT; Dilekkaya stays IN
  [35.110, 33.470],
  [35.130, 33.430],
  [35.155, 33.395],
  [35.172, 33.370], // through Nicosia — see the KNOWN LIMIT note above
  [35.176, 33.340],
  [35.178, 33.310], // Metehan
  [35.170, 33.270],
  [35.160, 33.230], // Alayköy stays IN
  [35.145, 33.180],
  [35.135, 33.120],
  [35.130, 33.060],
  [35.128, 33.000],
  [35.120, 32.940],
  [35.075, 32.880], // Lefke (35.1138, 32.8496) stays IN
  [35.070, 32.820],
  [35.080, 32.770],
  [35.110, 32.730],
  [35.150, 32.715], // Kato Pyrgos (RoC, 32.639) stays OUT
]

// If the nearest anchor is further than this, we are somewhere inside the ring
// with no populated place near it (open sea inside a slack coastline, the
// Beşparmak ridge, the buffer zone). Better to say nothing than to guess.
export const MAX_ANCHOR_KM = 25
