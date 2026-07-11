// Ask Oli — local intent map (pure data). No LLM, no network.
// Each intent: { id (= navigation target), keywords (multilingual), msgKey (i18n) }.
// App.js owns oliNavigate(id) → the matching navigation state setter.
// resolveOliQuery() is the single resolver seam: [] ⇒ no-match fallback. A future
// LLM path slots in only where this returns [] — nothing else needs to change.

// Fold Turkish dotless-i + diacritics so matching is case/accent-insensitive across
// all scripts. Turkish ı/İ don't decompose under NFD, so fold them explicitly first.
export function normalize(str = '') {
  return String(str)
    .replace(/İ/g, 'i').replace(/I/g, 'i').replace(/ı/g, 'i')
    .replace(/Ş/g, 's').replace(/ş/g, 's')
    .replace(/Ğ/g, 'g').replace(/ğ/g, 'g')
    .replace(/Ç/g, 'c').replace(/ç/g, 'c')
    .replace(/Ö/g, 'o').replace(/ö/g, 'o')
    .replace(/Ü/g, 'u').replace(/ü/g, 'u')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export const OLI_INTENTS = [
  {
    id: 'pharmacy', msgKey: 'oliMsgPharmacy',
    keywords: ['pharmacy', 'pharmacies', 'chemist', 'drugstore', 'duty pharmacy', 'on duty', 'medicine', 'prescription',
      'eczane', 'nobetci eczane', 'nobetci', 'ilac', 'recete',
      'аптека', 'дежурная аптека', 'лекарство', 'apotheke', 'pharmacie', 'farmacia', 'صيدلية', 'دواء', 'داروخانه'],
  },
  {
    id: 'clinic', msgKey: 'oliMsgClinic',
    keywords: ['doctor', 'clinic', 'hospital', 'dentist', 'physician', 'medical', 'gp', 'health',
      'doktor', 'klinik', 'hastane', 'dis', 'disci', 'hekim', 'saglik', 'muayene',
      'врач', 'больница', 'клиника', 'стоматолог', 'arzt', 'klinik', 'krankenhaus', 'zahnarzt',
      'medecin', 'clinique', 'hopital', 'dentiste', 'medico', 'clinica', 'hospital', 'dentista',
      'طبيب', 'عيادة', 'مستشفى', 'اسنان', 'پزشک', 'دکتر', 'بیمارستان', 'دندانپزشک'],
  },
  {
    id: 'emergency', msgKey: 'oliMsgEmergency',
    keywords: ['emergency', 'ambulance', 'police', 'fire', 'urgent', '112', '155', '199',
      'acil', 'ambulans', 'polis', 'itfaiye', 'yardim',
      'скорая', 'полиция', 'помощь', 'пожар', 'notruf', 'krankenwagen', 'polizei', 'feuerwehr',
      'urgence', 'ambulance', 'police', 'emergencia', 'ambulancia', 'policia',
      'طوارئ', 'اسعاف', 'شرطة', 'اورژانس', 'امبولانس', 'پلیس'],
  },
  {
    id: 'newcomer', msgKey: 'oliMsgNewcomer',
    keywords: ['new', 'newcomer', 'guide', 'welcome', 'essentials', 'border', 'crossing', 'moving', 'settle', 'visa', 'residence', 'permit',
      'yeni', 'rehber', 'hos geldin', 'sinir', 'gecis', 'kapi', 'tasinma', 'oturum', 'vize', 'ikamet',
      'новичок', 'граница', 'гид', 'виза', 'neu', 'grenze', 'leitfaden', 'nouveau', 'frontiere', 'guide',
      'nuevo', 'frontera', 'guia', 'جديد', 'حدود', 'دليل', 'تازه وارد', 'مرز', 'راهنما'],
  },
  {
    id: 'events', msgKey: 'oliMsgEvents',
    keywords: ['event', 'events', 'concert', 'festival', 'whats on', 'nightlife', 'party', 'gig', 'show',
      'etkinlik', 'konser', 'festival', 'gece hayati', 'parti', 'neler var', 'ne var',
      'концерт', 'событие', 'вечеринка', 'veranstaltung', 'konzert', 'evenement', 'concert',
      'evento', 'concierto', 'حفلة', 'فعالية', 'كونسير', 'کنسرت', 'رویداد', 'برنامه'],
  },
  {
    id: 'homeServices', msgKey: 'oliMsgHomeServices',
    keywords: ['plumber', 'electrician', 'cleaner', 'cleaning', 'handyman', 'repair', 'home service', 'painter', 'ac repair',
      'tesisatci', 'elektrikci', 'temizlik', 'tamir', 'tamirci', 'usta', 'ustasi', 'tadilat', 'boyaci', 'ev hizmet',
      'сантехник', 'электрик', 'уборка', 'ремонт', 'klempner', 'elektriker', 'reinigung',
      'plombier', 'electricien', 'menage', 'fontanero', 'electricista', 'limpieza',
      'سباك', 'كهربائي', 'تنظيف', 'لوله', 'برق کار', 'نظافت'],
  },
  {
    id: 'jobs', msgKey: 'oliMsgJobs',
    keywords: ['job', 'jobs', 'work', 'vacancy', 'hiring', 'employment', 'career', 'cv',
      'is', 'isler', 'is ilani', 'kariyer', 'eleman', 'calismak', 'ise',
      'работа', 'вакансия', 'arbeit', 'stelle', 'emploi', 'travail', 'trabajo', 'empleo',
      'وظيفة', 'عمل', 'شغل', 'کار', 'استخدام'],
  },
  {
    id: 'accommodation', msgKey: 'oliMsgAccommodation',
    keywords: ['rent', 'house', 'apartment', 'flat', 'accommodation', 'stay', 'room', 'property', 'lodging',
      'kiralik', 'ev', 'daire', 'konaklama', 'oda', 'emlak', 'kiralamak',
      'аренда', 'квартира', 'жилье', 'снять', 'miete', 'wohnung', 'unterkunft',
      'location', 'appartement', 'logement', 'alquiler', 'apartamento', 'alojamiento',
      'ايجار', 'شقة', 'سكن', 'اجاره', 'آپارتمان', 'مسکن', 'خانه'],
  },
  {
    id: 'pets', msgKey: 'oliMsgPets',
    keywords: ['pet', 'pets', 'dog', 'cat', 'vet', 'veterinary', 'veterinarian', 'animal', 'puppy', 'kitten',
      'evcil', 'kopek', 'kedi', 'veteriner', 'hayvan',
      'собака', 'кошка', 'ветеринар', 'животное', 'hund', 'katze', 'tierarzt', 'haustier',
      'chien', 'chat', 'veterinaire', 'animal', 'perro', 'gato', 'veterinario', 'mascota',
      'كلب', 'قطة', 'بيطري', 'حيوان', 'سگ', 'گربه', 'دامپزشک', 'حیوان'],
  },
  {
    id: 'transport', msgKey: 'oliMsgTransport',
    keywords: ['bus', 'taxi', 'car', 'transport', 'transportation', 'getting around', 'rental car', 'drive', 'minibus',
      'otobus', 'taksi', 'araba', 'ulasim', 'dolmus', 'kiralik araba', 'arac',
      'автобус', 'такси', 'машина', 'транспорт', 'bus', 'taxi', 'auto', 'transport',
      'voiture', 'autobus', 'coche', 'transporte', 'حافلة', 'تاكسي', 'سيارة', 'مواصلات',
      'اتوبوس', 'تاکسی', 'ماشین', 'حمل و نقل'],
  },
  {
    id: 'beaches', msgKey: 'oliMsgBeaches',
    keywords: ['beach', 'beaches', 'landmark', 'landmarks', 'sightseeing', 'things to do', 'explore', 'attractions', 'sea', 'tourist',
      'plaj', 'sahil', 'gezilecek', 'gezi', 'deniz', 'tarihi yer', 'gorulecek',
      'пляж', 'достопримечательности', 'море', 'strand', 'sehenswurdigkeiten',
      'plage', 'sites', 'playa', 'lugares', 'شاطئ', 'معالم', 'بحر', 'ساحل', 'دیدنی', 'جاهای دیدنی'],
  },
  {
    id: 'exchange', msgKey: 'oliMsgExchange',
    keywords: ['exchange', 'exchange rate', 'rate', 'currency', 'money', 'convert', 'lira', 'forex', 'euro', 'dollar', 'pound',
      'kur', 'doviz', 'para', 'cevir', 'lira', 'kur cevir',
      'курс', 'валюта', 'деньги', 'обмен', 'wechselkurs', 'wahrung', 'geld',
      'change', 'devise', 'taux', 'cambio', 'moneda', 'divisa', 'صرف', 'عملة', 'نقود', 'نرخ ارز', 'ارز', 'پول'],
  },
  {
    id: 'municipal', msgKey: 'oliMsgMunicipal',
    keywords: ['municipality', 'municipalities', 'council', 'town hall', 'mayor',
      'belediye', 'muhtar', 'муниципалитет', 'gemeinde', 'rathaus', 'mairie', 'municipalite',
      'municipio', 'ayuntamiento', 'بلدية', 'شهرداری'],
  },
]

const BY_ID = OLI_INTENTS.reduce((m, i) => { m[i.id] = i; return m }, {})
export const getIntent = (id) => BY_ID[id]

// Match a keyword against the normalized query. Short keywords (<=4 chars, e.g.
// "is" = Turkish "iş", "geld" = German money) match whole words only, so they don't
// fire inside longer words across languages ("geld" ⊄ Turkish "geldim"). Keywords of
// 5+ chars allow prefix matching, so Turkish suffixes ("eczaneye", "doktora") still hit.
function keywordHits(kw, q, words) {
  const nkw = normalize(kw)
  if (!nkw) return false
  if (nkw.includes(' ')) return q.includes(nkw)
  if (nkw.length <= 4) return words.includes(nkw)
  return words.some(w => w === nkw || w.startsWith(nkw) || (w.length >= 5 && nkw.startsWith(w)))
}

// The single resolver boundary. Returns matched intents (most-relevant order =
// array order), capped. Empty array ⇒ caller shows the no-match fallback.
export function resolveOliQuery(text, { limit = 3 } = {}) {
  const q = normalize(text)
  if (!q) return []
  const words = q.split(' ').filter(Boolean)
  const matches = []
  for (const intent of OLI_INTENTS) {
    if (intent.keywords.some(kw => keywordHits(kw, q, words))) matches.push(intent)
    if (matches.length >= limit) break
  }
  return matches
}
