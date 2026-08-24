// Verified area/neighbourhood names per TRNC region — the second level of the
// business-directory location dropdowns (city → area). Sibling to regions.js.
//
// Area names are PROPER NOUNS: identical in all 9 locales, never translated.
// facilities.area stores the SLUG (areaSlug below); the profile resolves slug→name
// via areaName(). The list stays editable here (no DB CHECK), so adding an area is a
// pure client change — no migration.
//
// 'Merkez' recurs across regions; that's fine — area is always paired with city, so
// resolution is region-scoped (areaName(slug, region)).

export const AREAS_BY_REGION = {
  nicosia: [   // Lefkoşa
    'Merkez', 'Ortaköy', 'Küçük Kaymaklı', 'Göçmenköy', 'Kumsal',
    'Yenişehir', 'Marmara', 'Hamitköy', 'Gönyeli', 'Haspolat',
    'Taşkınköy', 'Metehan', 'Dereboyu', 'Köşklüçiftlik', 'Yenikent',
    'Alayköy', 'Değirmenlik',
    // Added 2026-08-24 from the Novest feed: each is the `property_city` term on a real
    // listing whose `property_state` is Lefkoşa, so the district assignment is the
    // agency's own, not a guess.
    'Kermiya', 'Meriç', 'Balıkesir', 'Kanlıköy', 'Cihangir', 'Batıkent', 'Demirhan',
  ],
  kyrenia: [   // Girne
    'Merkez', 'Karakum', 'Zeytinlik', 'Ozanköy', 'Çatalköy',
    'Alsancak', 'Lapta', 'Karaoğlanoğlu', 'Beylerbeyi', 'Esentepe',
    'Karşıyaka', 'Karaman', 'Çamlıbel', 'Tatlısu', 'Bahçeli',
    // Added 2026-08-24 from the Novest feed. NOTE 'Boğaz': İskele has one too, and both
    // slug to 'bogaz'. That is fine and already the established pattern — 'Merkez'
    // recurs across all seven regions — because areaName() resolves slug WITHIN a region.
    // Anything reading a bare slug without its region was already wrong before this.
    'Kozan', 'Yukarı Girne', 'Boğaz', 'Dikmen', 'Ağırdağ',
  ],
  famagusta: [ // Gazimağusa
    'Merkez', 'Sakarya', 'Baykal', 'Çanakkale', 'Yeni Boğaziçi',
    'Tuzla', 'Mutluyaka', 'Geçitkale', 'Vadili', 'Beyarmudu',
    'Maraş',   // added 2026-08-24 from the Novest feed
  ],
  morphou: [   // Güzelyurt
    'Merkez', 'Bostancı', 'Kalkanlı', 'Yayla', 'Zümrütköy',
    'Aydınköy', 'Gaziveren',
  ],
  iskele: [    // İskele
    'Merkez', 'Long Beach', 'Boğaz', 'Bafra', 'Yeni İskele',
    'Ötüken', 'Kurtuluş',
  ],
  lefke: [     // Lefke
    'Merkez', 'Gemikonağı', 'Yeşilyurt', 'Cengizköy', 'Bağlıköy',
    'Yedidalga',
  ],
  karpaz: [    // Karpaz
    'Yenierenköy', 'Dipkarpaz', 'Büyükkonuk', 'Kaleburnu',
    'Sipahi', 'Kuruova', 'Avtepe',
  ],
}

// Slug: fold Turkish letters, lowercase, spaces→hyphens. Turkish capitals (İ, Ğ …) are
// folded BEFORE toLowerCase to avoid JS's dotted-i quirks.
export function areaSlug(name) {
  return name
    .replace(/İ/g, 'i').replace(/ı/g, 'i')
    .replace(/Ğ/g, 'g').replace(/ğ/g, 'g')
    .replace(/Ü/g, 'u').replace(/ü/g, 'u')
    .replace(/Ş/g, 's').replace(/ş/g, 's')
    .replace(/Ö/g, 'o').replace(/ö/g, 'o')
    .replace(/Ç/g, 'c').replace(/ç/g, 'c')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
}

// Dropdown options for a region: [{ value: slug, label: name }].
// ALPHABETICAL, WITH THE 'tr' COLLATOR. Sorted here rather than at a call site so all six
// consumers agree — AccommodationScreen's area filter, the Garage and Grooming onboarding
// pickers, and the Garages / GaragePriceCompare / Grooming filter rows. An alphabetical
// picker on one screen and a hand-ordered one on the next is worse than either alone.
//
// The SOURCE arrays above stay in their hand-written order on purpose: they are grouped
// by hand for readability, and areaName() does a lookup, not a scan.
//
// WHY 'tr' AND NOT THE DEFAULT — measured against this list, not assumed:
//   ü/ö      default: … Küçük Kaymaklı, Kumsal …   tr: … Kumsal, Küçük Kaymaklı …
//            (Turkish sorts ü AFTER u, ö after o). This is the one that bites today.
//   İ vs ı   default interleaves I and İ; tr groups all dotless first.
//   Ç        NOT a factor. ICU's default collator already treats Ç as a C-variant —
//            "Ç sorts after Z" is BYTE/ASCII sort, not JS default. Recorded because the
//            wrong reason sends the next reader hunting a bug that does not exist.
//
// Safe to sort ONLY because area names are proper nouns, identical in all 9 locales. The
// DISTRICT picker is deliberately NOT sorted: its labels are translated, so alphabetical
// order would differ per locale and Girne would move when someone switched language.
export function areaOptions(region) {
  return (AREAS_BY_REGION[region] || [])
    .map(name => ({ value: areaSlug(name), label: name }))
    .sort((a, b) => a.label.localeCompare(b.label, 'tr'))
}

// Resolve a stored slug back to its display name. Region-scoped when known (handles the
// recurring 'Merkez'); falls back to a global search, then to the slug itself.
export function areaName(slug, region) {
  if (!slug) return ''
  const names = region ? (AREAS_BY_REGION[region] || []) : Object.values(AREAS_BY_REGION).flat()
  return names.find(n => areaSlug(n) === slug) || slug
}
