// Ask Oli — local intent map (pure data). No LLM, no network.
// Each intent: { id (= navigation target), keywords (multilingual), msgKey (i18n), titleKey (the
// destination's own title — its Home tile or screen header — shown on the card's button) }.
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
    id: 'pharmacy', msgKey: 'oliMsgPharmacy', titleKey: 'dutyPharmacies',
    keywords: ['pharmacy', 'pharmacies', 'chemist', 'drugstore', 'duty pharmacy', 'on duty', 'medicine', 'prescription',
      'eczane', 'nobetci eczane', 'nobetci', 'ilac', 'recete',
      'аптека', 'дежурная аптека', 'лекарство', 'apotheke', 'pharmacie', 'farmacia', 'صيدلية', 'دواء', 'داروخانه'],
  },
  {
    id: 'clinic', msgKey: 'oliMsgClinic', titleKey: 'hubMedicalTitle',
    keywords: ['doctor', 'clinic', 'hospital', 'dentist', 'physician', 'medical', 'gp', 'health',
      'doktor', 'klinik', 'hastane', 'dis', 'disci', 'hekim', 'saglik', 'muayene',
      'врач', 'больница', 'клиника', 'стоматолог', 'arzt', 'klinik', 'krankenhaus', 'zahnarzt',
      'medecin', 'clinique', 'hopital', 'dentiste', 'medico', 'clinica', 'hospital', 'dentista',
      'طبيب', 'عيادة', 'مستشفى', 'اسنان', 'پزشک', 'دکتر', 'بیمارستان', 'دندانپزشک'],
  },
  {
    id: 'emergency', msgKey: 'oliMsgEmergency', titleKey: 'menuEmergency',
    keywords: ['emergency', 'ambulance', 'police', 'fire', 'urgent', '112', '155', '199',
      'acil', 'ambulans', 'polis', 'itfaiye', 'yardim',
      'скорая', 'полиция', 'помощь', 'пожар', 'notruf', 'krankenwagen', 'polizei', 'feuerwehr',
      'urgence', 'ambulance', 'police', 'emergencia', 'ambulancia', 'policia',
      'طوارئ', 'اسعاف', 'شرطة', 'اورژانس', 'امبولانس', 'پلیس'],
  },
  {
    id: 'newcomer', msgKey: 'oliMsgNewcomer', titleKey: 'menuNewcomerEssentials',
    keywords: ['new', 'newcomer', 'guide', 'welcome', 'essentials', 'border', 'crossing', 'moving', 'settle', 'visa', 'residence', 'permit',
      'yeni', 'rehber', 'hos geldin', 'sinir', 'gecis', 'kapi', 'tasinma', 'oturum', 'vize', 'ikamet',
      'новичок', 'граница', 'гид', 'виза', 'neu', 'grenze', 'leitfaden', 'nouveau', 'frontiere', 'guide',
      'nuevo', 'frontera', 'guia', 'جديد', 'حدود', 'دليل', 'تازه وارد', 'مرز', 'راهنما'],
  },
  {
    id: 'events', msgKey: 'oliMsgEvents', titleKey: 'menuEvents',
    keywords: ['event', 'events', 'concert', 'festival', 'whats on', 'nightlife', 'party', 'gig', 'show',
      'etkinlik', 'konser', 'festival', 'gece hayati', 'parti', 'neler var', 'ne var',
      'концерт', 'событие', 'вечеринка', 'veranstaltung', 'konzert', 'evenement', 'concert',
      'evento', 'concierto', 'حفلة', 'فعالية', 'كونسير', 'کنسرت', 'رویداد', 'برنامه'],
  },
  {
    id: 'homeServices', msgKey: 'oliMsgHomeServices', titleKey: 'menuHomeServices',
    keywords: ['plumber', 'electrician', 'cleaner', 'cleaning', 'handyman', 'repair', 'home service', 'painter', 'ac repair',
      'tesisatci', 'elektrikci', 'temizlik', 'tamir', 'tamirci', 'usta', 'ustasi', 'tadilat', 'boyaci', 'ev hizmet',
      'сантехник', 'электрик', 'уборка', 'ремонт', 'klempner', 'elektriker', 'reinigung',
      'plombier', 'electricien', 'menage', 'fontanero', 'electricista', 'limpieza',
      'سباك', 'كهربائي', 'تنظيف', 'لوله', 'برق کار', 'نظافت'],
  },
  {
    id: 'jobs', msgKey: 'oliMsgJobs', titleKey: 'menuJobPostings',
    keywords: ['job', 'jobs', 'work', 'vacancy', 'hiring', 'employment', 'career', 'cv',
      'is', 'isler', 'is ilani', 'kariyer', 'eleman', 'calismak', 'ise',
      'работа', 'вакансия', 'arbeit', 'stelle', 'emploi', 'travail', 'trabajo', 'empleo',
      'وظيفة', 'عمل', 'شغل', 'کار', 'استخدام'],
  },
  {
    id: 'accommodation', msgKey: 'oliMsgAccommodation', titleKey: 'menuAccomTile',
    // ─── Vocabulary taken from the SOURCE TAXONOMY, not invented ─────────────
    // The second block below is derived from Novest's own 21 `property_type` terms
    // (Arsa, Arazi, Tarla, Dükkan, İşyeri, Depo, Mağaza, Ofis, Ticari, Villa, Müstakil
    // Ev, Penthouse, Stüdyo, Dubleks, Apartman, Zemin Kat Daire, Bungalow, İkiz Villa,
    // Konut) plus our own six property_type values. Every word here corresponds to
    // something a user can actually find.
    //
    // WHY IT MATTERED: the module is a QUARTER land — 22 of 88 listings are Arsa or
    // Arazi — and "arsa" matched nothing at all. Someone searching for the single most
    // common non-residential thing in the feed got Oli's no-match fallback.
    //
    // ⚠ 'otel' / 'hotel' / 'ξενοδοχείο' ARE DELIBERATELY ABSENT. The taxonomy has an
    // Otel term but its count is ZERO, and the coach body was rewritten in the same pass
    // to stop promising hotels. Routing a hotel search into a module with no hotels is a
    // worse answer than no match, because no match is honest.
    //
    // ⚠ normalize() folds Turkish diacritics to ASCII, so these are written naturally
    // (işyeri, dükkan, stüdyo) and matched folded. Keywords of 4 chars or fewer match
    // WHOLE WORDS ONLY — 'arsa', 'ofis', 'depo' and 'land' will not fire inside a longer
    // word, so "arsada" does not hit. That is the existing trade-off in keywordHits(),
    // not something introduced here.
    keywords: ['rent', 'house', 'apartment', 'flat', 'accommodation', 'stay', 'room', 'property', 'lodging',
      'kiralik', 'ev', 'daire', 'konaklama', 'oda', 'emlak', 'kiralamak',
      'аренда', 'квартира', 'жилье', 'снять', 'miete', 'wohnung', 'unterkunft',
      'location', 'appartement', 'logement', 'alquiler', 'apartamento', 'alojamiento',
      'ايجار', 'شقة', 'سكن', 'اجاره', 'آپارتمان', 'مسکن', 'خانه',

      // land / plot / field — 22 of 88 listings, and previously unmatchable
      'land', 'plot', 'arsa', 'arazi', 'tarla', 'satilik',
      'участок', 'земля', 'grundstuck', 'terrain', 'terreno', 'parcela',
      'أرض', 'قطعة', 'زمین', 'οικοπεδο',
      // commercial: shop, office, warehouse, business premises
      'shop', 'store', 'office', 'commercial', 'warehouse', 'premises',
      'dukkan', 'isyeri', 'ofis', 'magaza', 'ticari', 'depo',
      'магазин', 'офис', 'склад', 'laden', 'buro', 'gewerbe', 'lager',
      'bureau', 'boutique', 'commerce', 'tienda', 'oficina', 'local',
      'محل', 'مكتب', 'مستودع', 'تجاري', 'مغازه', 'دفتر', 'انبار',
      'καταστημα', 'γραφειο', 'εμπορικο',
      // residential shapes the feed actually carries
      'villa', 'studio', 'penthouse', 'duplex', 'detached', 'bungalow',
      'studyo', 'dubleks', 'mustakil', 'konut', 'apartman', 'zemin kat',
      'вилла', 'студия', 'haus', 'maison', 'casa',
      'فيلا', 'استوديو', 'ویلا', 'διαμερισμα', 'κατοικια', 'ακινητα'],
  },
  {
    id: 'pets', msgKey: 'oliMsgPets', titleKey: 'menuPets',
    keywords: ['pet', 'pets', 'dog', 'cat', 'vet', 'veterinary', 'veterinarian', 'animal', 'puppy', 'kitten',
      'evcil', 'kopek', 'kedi', 'veteriner', 'hayvan',
      'собака', 'кошка', 'ветеринар', 'животное', 'hund', 'katze', 'tierarzt', 'haustier',
      'chien', 'chat', 'veterinaire', 'animal', 'perro', 'gato', 'veterinario', 'mascota',
      'كلب', 'قطة', 'بيطري', 'حيوان', 'سگ', 'گربه', 'دامپزشک', 'حیوان'],
  },
  {
    id: 'transport', msgKey: 'oliMsgTransport', titleKey: 'menuTransportation',
    keywords: ['bus', 'taxi', 'car', 'transport', 'transportation', 'getting around', 'rental car', 'drive', 'minibus',
      'otobus', 'taksi', 'araba', 'ulasim', 'dolmus', 'kiralik araba', 'arac',
      'автобус', 'такси', 'машина', 'транспорт', 'bus', 'taxi', 'auto', 'transport',
      'voiture', 'autobus', 'coche', 'transporte', 'حافلة', 'تاكسي', 'سيارة', 'مواصلات',
      'اتوبوس', 'تاکسی', 'ماشین', 'حمل و نقل'],
  },
  {
    id: 'beaches', msgKey: 'oliMsgBeaches', titleKey: 'menuBeachesLandmarks',
    keywords: ['beach', 'beaches', 'landmark', 'landmarks', 'sightseeing', 'things to do', 'explore', 'attractions', 'sea', 'tourist',
      'plaj', 'sahil', 'gezilecek', 'gezi', 'deniz', 'tarihi yer', 'gorulecek',
      'пляж', 'достопримечательности', 'море', 'strand', 'sehenswurdigkeiten',
      'plage', 'sites', 'playa', 'lugares', 'شاطئ', 'معالم', 'بحر', 'ساحل', 'دیدنی', 'جاهای دیدنی'],
  },
  {
    id: 'exchange', msgKey: 'oliMsgExchange', titleKey: 'menuExchangeRates',
    keywords: ['exchange', 'exchange rate', 'rate', 'currency', 'money', 'convert', 'lira', 'forex', 'euro', 'dollar', 'pound',
      'kur', 'doviz', 'para', 'cevir', 'lira', 'kur cevir',
      'курс', 'валюта', 'деньги', 'обмен', 'wechselkurs', 'wahrung', 'geld',
      'change', 'devise', 'taux', 'cambio', 'moneda', 'divisa', 'صرف', 'عملة', 'نقود', 'نرخ ارز', 'ارز', 'پول'],
  },
  {
    id: 'municipal', msgKey: 'oliMsgMunicipal', titleKey: 'menuMunicipalities',
    keywords: ['municipality', 'municipalities', 'council', 'town hall', 'mayor',
      'belediye', 'muhtar', 'муниципалитет', 'gemeinde', 'rathaus', 'mairie', 'municipalite',
      'municipio', 'ayuntamiento', 'بلدية', 'شهرداری'],
  },
]

// Guided chat only (OLI_CHAT, components/OliChatSheet.js). Kept out of OLI_INTENTS on purpose: the search sheet reads
// that list in production, so an entry there would change live Oli cards while the chat is still dark. Array order is
// priority, as above: 'nearby' sits before 'beaches' so "beaches near me" asks for places near you; 'eatery' goes last.
const CHAT_NEARBY = {
  id: 'nearby', msgKey: 'oliChatNearby', titleKey: 'menuExplore',
  keywords: ['near me', 'nearby', 'around me', 'close to me', 'near here',
    'yakin', 'yakinimda', 'yakinlarda', 'civarda', 'etrafimda', 'cevrede',
    'рядом', 'поблизости', 'in der nahe', 'in meiner nahe', 'pres de moi', 'a proximite', 'cerca de mi', 'por aqui',
    'بالقرب', 'قريب مني', 'نزدیک', 'نزدیک من', 'κοντα μου', 'εδω κοντα'],
}
const CHAT_EATERY = {
  id: 'eatery', msgKey: 'oliChatEatery', titleKey: 'menuEatery',
  keywords: ['restaurant', 'restaurants', 'food', 'eat', 'eating', 'dinner', 'lunch', 'breakfast', 'cafe', 'takeaway', 'pizza', 'burger',
    'yemek', 'restoran', 'kafe', 'lokanta', 'kahvalti', 'aksam yemegi', 'ogle yemegi', 'paket servis', 'yeme icme', 'yesem', 'yiyelim',
    'ресторан', 'еда', 'кафе', 'поесть', 'essen', 'restaurants', 'manger', 'nourriture', 'comida', 'restaurante', 'comer',
    'مطعم', 'طعام', 'مقهى', 'رستوران', 'غذا', 'کافه', 'εστιατοριο', 'φαγητο', 'καφε'],
}
export const OLI_CHAT_INTENTS = [
  ...OLI_INTENTS.slice(0, OLI_INTENTS.findIndex(i => i.id === 'beaches')),
  CHAT_NEARBY,
  ...OLI_INTENTS.slice(OLI_INTENTS.findIndex(i => i.id === 'beaches')),
  CHAT_EATERY,
]

const BY_ID = OLI_CHAT_INTENTS.reduce((m, i) => { m[i.id] = i; return m }, {})
// Chat-only ids resolve too; the search sheet only ever asks for ids from OLI_INTENTS (its CHIPS).
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

// "Oli" said at the START of a query is a wake word, not part of it — and speech recognisers
// often hear it as something else. It is stripped before matching so it can never select an
// intent, whatever keywords are added later. Only the first word (after an optional greeting:
// "Hey Oli"), so "Ali" inside a real query is untouched. Turkish "Oli'ye/ya" and trailing
// punctuation count. Search (search_content) still receives the text as typed or spoken.
const WAKE_WORDS = new Set(['oli', 'olli', 'oly', 'olie', 'ollie', 'olly', 'holy', 'holi', 'ali', 'alli',
  'όλι', 'ολι', 'оли', 'олли', 'али', 'оля', 'أولي', 'اولي', 'علي', 'اولی', 'علی'].map(normalize))
const GREETINGS = new Set(['hey', 'hi', 'hello', 'merhaba', 'selam', 'hallo', 'hola', 'salut', 'bonjour',
  'привет', 'γεια', 'مرحبا', 'سلام'].map(normalize))
const bare = w => w.replace(/['’](ye|ya)$/, '').replace(/[,.!?:;،]+$/, '')
// Voice only (OliMic): the recogniser writes "Ali"/"Holy"/… where the user said "Oli". The
// FIRST spoken word (after an optional greeting) is shown as "Oli", keeping a Turkish 'ye/'ya
// suffix and trailing punctuation. Typed text and later words are never touched. `name` is how
// the UI spells Oli in that language (hrOliField: Оли, أولي, اولی).
const WAKE_TOKEN = /^(.*?)((?:['’](?:ye|ya))?[,.!?:;،]*)$/
export function showWakeWordAsOli(text, name = 'Oli') {
  const words = text.split(' ')
  const at = words.length > 1 && GREETINGS.has(bare(normalize(words[0]))) ? 1 : 0
  const m = (words[at] ?? '').match(WAKE_TOKEN)
  if (!m || !m[1] || !WAKE_WORDS.has(normalize(m[1]))) return text
  words[at] = name + m[2]
  return words.join(' ')
}
export function stripWakeWord(q) {
  const words = q.split(' ')
  if (words.length > 1 && GREETINGS.has(bare(words[0])) && WAKE_WORDS.has(bare(words[1]))) return words.slice(2).join(' ')
  if (WAKE_WORDS.has(bare(words[0]))) return words.slice(1).join(' ')
  return q
}

// The single resolver boundary. Returns matched intents (most-relevant order =
// array order), capped. Empty array ⇒ caller shows the no-match fallback.
export function resolveOliQuery(text, { limit = 3, intents = OLI_INTENTS } = {}) {
  const q = stripWakeWord(normalize(text))
  if (!q) return []
  const words = q.split(' ').filter(Boolean)
  const matches = []
  for (const intent of intents) {
    if (intent.keywords.some(kw => keywordHits(kw, q, words))) matches.push(intent)
    if (matches.length >= limit) break
  }
  return matches
}

// Place types for a typed "near me" in the chat ("plaj yakınımda" → beaches only). Read ONLY when the question
// also hits a nearby keyword; with no type it stays "every place near you". Specific types come before the
// groups, and every hit counts ("müze ve kale yakınımda" → both). cats are places.category (constants/
// exploreCategories.js); eatery are eatery_partners.category, which have coordinates too. Short stems
// (<=4 chars) match whole words only, so their Turkish/Russian suffixed forms are listed out.
export const OLI_PLACE_TYPES = [
  { id: 'beach', cats: ['beach'], labelKey: 'blFilterBeaches',
    keywords: ['beach', 'beaches', 'sea', 'plaj', 'plaja', 'plajda', 'plajlar', 'plaji', 'kumsal', 'sahil', 'deniz',
      'пляж', 'пляжи', 'пляжа', 'пляже', 'пляжей', 'море', 'strand', 'meer', 'plage', 'mer', 'playa', 'mar',
      'شاطئ', 'الشاطئ', 'شواطئ', 'بحر', 'ساحل', 'دریا', 'παραλια', 'παραλιες', 'θαλασσα'] },
  { id: 'nature_scenic', cats: ['nature_scenic'], labelKey: 'blCatNatureScenic',
    keywords: ['nature', 'park', 'parks', 'viewpoint', 'scenic', 'hiking', 'picnic', 'doga', 'manzara', 'seyir', 'piknik',
      'природа', 'парк', 'парки', 'natur', 'aussicht', 'wandern', 'parc', 'randonnee', 'naturaleza', 'parque', 'mirador',
      'senderismo', 'طبيعة', 'حديقة', 'طبیعت', 'پارک', 'φυση', 'παρκο', 'πεζοπορια'] },
  { id: 'castle_fortress', cats: ['castle_fortress'], labelKey: 'blCatCastleFortress',
    keywords: ['castle', 'castles', 'fortress', 'fort', 'kale', 'kaleye', 'kalede', 'kaleler', 'kalesi',
      'замок', 'замки', 'крепость', 'burg', 'burgen', 'festung', 'schloss', 'chateau', 'forteresse', 'castillo',
      'fortaleza', 'قلعة', 'القلعة', 'قلعه', 'καστρο', 'καστρα', 'φρουριο'] },
  { id: 'ancient_ruins', cats: ['ancient_ruins'], labelKey: 'blCatAncientRuins',
    keywords: ['ruins', 'ruin', 'ancient', 'archaeological', 'oren', 'harabe', 'antik', 'руины', 'развалины', 'античн',
      'ruine', 'ruinen', 'antike', 'ausgrabung', 'ruines', 'antique', 'archeolog', 'ruinas', 'antiguo', 'arqueolog',
      'آثار', 'أطلال', 'خرابه', 'باستانی', 'αρχαια', 'ερειπια'] },
  { id: 'museum', cats: ['museum'], labelKey: 'blCatMuseum',
    keywords: ['museum', 'museums', 'muze', 'muzeye', 'muzede', 'muzeler', 'muzesi', 'музей', 'музея', 'музеев',
      'museen', 'musee', 'museo', 'متحف', 'المتحف', 'متاحف', 'موزه', 'μουσειο', 'μουσεια'] },
  { id: 'religious_site', cats: ['religious_site'], labelKey: 'blCatReligiousSite',
    keywords: ['mosque', 'mosques', 'church', 'churches', 'monastery', 'temple', 'cami', 'camii', 'camiye', 'camide',
      'camiler', 'kilise', 'manastir', 'мечеть', 'мечети', 'церковь', 'церкви', 'храм', 'монастырь', 'moschee',
      'kirche', 'kirchen', 'kloster', 'mosquee', 'eglise', 'monastere', 'mezquita', 'iglesia', 'monasterio',
      'مسجد', 'جامع', 'كنيسة', 'دير', 'کلیسا', 'τζαμι', 'εκκλησια', 'μοναστηρι'] },
  { id: 'monument', cats: ['monument'], labelKey: 'blCatMonument',
    keywords: ['monument', 'monuments', 'memorial', 'statue', 'anit', 'aniti', 'anitlar', 'heykel', 'памятник',
      'монумент', 'denkmal', 'monumento', 'نصب', 'تمثال', 'یادبود', 'مجسمه', 'μνημειο', 'αγαλμα'] },
  { id: 'cafe', cats: ['cafe'], eatery: ['cafe'], labelKey: 'exploreCatCafe',
    keywords: ['cafe', 'cafes', 'coffee', 'kafe', 'kafeye', 'kafede', 'kafeler', 'kahve', 'kahveci', 'кафе', 'кофейня',
      'кофе', 'kaffee', 'cafeteria', 'مقهى', 'قهوة', 'كافيه', 'کافه', 'قهوه', 'καφε', 'καφετερια'] },
  { id: 'restaurant', cats: ['restaurant'], eatery: ['restaurant', 'fast_food'], labelKey: 'exploreCatRestaurant',
    keywords: ['restaurant', 'restaurants', 'restoran', 'lokanta', 'ресторан', 'рестораны', 'restaurante',
      'مطعم', 'مطاعم', 'رستوران', 'εστιατοριο'] },
  { id: 'bakery', cats: ['bakery'], eatery: ['bakery', 'dessert'], labelKey: 'exploreCatBakery',
    keywords: ['bakery', 'bakeries', 'bread', 'firin', 'firinci', 'pastane', 'пекарня', 'булочная', 'backerei',
      'boulangerie', 'panaderia', 'مخبز', 'مخابز', 'نانوایی', 'φουρνος', 'αρτοποιειο'] },
  { id: 'gym', cats: ['gym'], labelKey: 'exploreCatGym',
    keywords: ['gym', 'fitness', 'workout', 'spor salonu', 'спортзал', 'фитнес', 'тренажерн', 'fitnessstudio',
      'salle de sport', 'gimnasio', 'صالة رياضية', 'جيم', 'باشگاه', 'γυμναστηριο'] },
  { id: 'sports_facility', cats: ['sports_facility'], labelKey: 'exploreCatSportsFacility',
    keywords: ['stadium', 'sports', 'tennis', 'spor tesisi', 'stadyum', 'hali saha', 'стадион', 'спорткомплекс',
      'sportanlage', 'stadion', 'sportplatz', 'stade', 'complexe sportif', 'estadio', 'polideportivo', 'ملعب',
      'ورزشگاه', 'γηπεδο'] },
  { id: 'pool', cats: ['pool'], labelKey: 'exploreCatPool',
    keywords: ['pool', 'pools', 'swimming', 'havuz', 'yuzme', 'бассейн', 'schwimmbad', 'freibad', 'piscine', 'piscina',
      'مسبح', 'استخر', 'πισινα'] },
  { id: 'barber', cats: ['barber'], labelKey: 'exploreCatBarber',
    keywords: ['barber', 'barbershop', 'haircut', 'berber', 'kuafor', 'барбершоп', 'парикмахерская', 'friseur',
      'barbier', 'coiffeur', 'barberia', 'peluqueria', 'حلاق', 'آرایشگاه', 'κουρειο'] },
  { id: 'laundry', cats: ['laundry'], labelKey: 'exploreCatLaundry',
    keywords: ['laundry', 'laundromat', 'dry cleaning', 'camasirhane', 'kuru temizleme', 'прачечная', 'химчистка',
      'wascherei', 'waschsalon', 'laverie', 'pressing', 'lavanderia', 'مغسلة', 'خشکشویی', 'لباسشویی', 'πλυντηριο'] },
  { id: 'print_shop', cats: ['print_shop'], labelKey: 'exploreCatPrintShop',
    keywords: ['print', 'printing', 'photocopy', 'copy shop', 'fotokopi', 'baski', 'matbaa', 'kirtasiye', 'печать',
      'копицентр', 'типография', 'druckerei', 'copyshop', 'imprimerie', 'photocopie', 'imprenta', 'fotocopia',
      'مطبعة', 'طباعة', 'چاپخانه', 'کپی', 'τυπογραφειο', 'φωτοτυπ'] },
  // Groups: only when no specific type matched.
  { id: 'heritage', group: true, cats: ['castle_fortress', 'ancient_ruins', 'museum', 'religious_site', 'monument'],
    labelKey: 'exploreGroupHeritage',
    keywords: ['historic', 'historical', 'history', 'heritage', 'sightseeing', 'landmark', 'landmarks', 'tarihi', 'tarih',
      'gezilecek', 'исторические', 'история', 'достопримечательност', 'historisch', 'geschichte', 'sehenswurdigkeit',
      'historique', 'patrimoine', 'historico', 'patrimonio', 'تاريخي', 'معالم', 'تاریخی', 'ιστορικ', 'αξιοθεατα'] },
  { id: 'eat_drink', group: true, cats: ['cafe', 'restaurant', 'bakery'],
    eatery: ['cafe', 'restaurant', 'fast_food', 'bakery', 'dessert'], labelKey: 'exploreGroupEatDrink',
    keywords: ['food', 'eat', 'eating', 'yemek', 'yeme icme', 'yiyecek', 'еда', 'поесть', 'essen', 'manger', 'comida',
      'comer', 'طعام', 'أكل', 'غذا', 'φαγητο'] },
  { id: 'active', group: true, cats: ['gym', 'sports_facility', 'pool'], labelKey: 'exploreGroupActive',
    keywords: ['sport', 'spor', 'спорт', 'deporte', 'رياضة', 'ورزش', 'αθλητισμος'] },
]
const PLACE_TYPE_BY_ID = OLI_PLACE_TYPES.reduce((m, p) => { m[p.id] = p; return m }, {})
export const getPlaceType = (id) => PLACE_TYPE_BY_ID[id]
const NEARBY = OLI_CHAT_INTENTS.find(i => i.id === 'nearby')

// "plaj yakınımda" → ['beach']; [] when the text asks for no type, or does not say "near me" at all.
export function nearbyPlaceTypes(text) {
  const q = stripWakeWord(normalize(text))
  if (!q) return []
  const words = q.split(' ').filter(Boolean)
  if (!asksNearby(q, words)) return []
  const hits = OLI_PLACE_TYPES.filter(p => !p.group && p.keywords.some(kw => keywordHits(kw, q, words)))
  if (hits.length) return hits.map(p => p.id)
  const group = OLI_PLACE_TYPES.find(p => p.group && p.keywords.some(kw => keywordHits(kw, q, words)))
  return group ? [group.id] : []
}

// A "near me" question is about places: "yakınımda ne var" is not "what's on" (events: 'ne var'), and English
// "what is near me" is not Turkish "iş" (jobs: 'is'). Only those generic words step aside, so "eczane yakınımda"
// still answers with the duty pharmacies.
const NEAR_ME_GENERIC = new Set(['ne var', 'neler var', 'is'])
const OLI_CHAT_NEAR_INTENTS = OLI_CHAT_INTENTS.map(i => ({ ...i, keywords: i.keywords.filter(k => !NEAR_ME_GENERIC.has(k)) }))
const asksNearby = (q, words) => NEARBY.keywords.some(kw => keywordHits(kw, q, words))

// The chat's resolver: the best intent, and the place types for a nearby answer.
export function resolveOliChat(text) {
  const q = stripWakeWord(normalize(text))
  const words = q.split(' ').filter(Boolean)
  if (!q || !asksNearby(q, words)) return { intent: resolveOliQuery(text, { limit: 1, intents: OLI_CHAT_INTENTS })[0], types: [] }
  const types = nearbyPlaceTypes(text)
  return { intent: types.length ? NEARBY : resolveOliQuery(text, { limit: 1, intents: OLI_CHAT_NEAR_INTENTS })[0], types }
}
