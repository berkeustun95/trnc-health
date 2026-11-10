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
    // Arabic and Persian marks (shadda, madda, harakat) go like Latin accents: "صرّف" is "صرف", "آمبولانس" is "امبولانس".
    .replace(/[\u064b-\u065f\u0670]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export const OLI_INTENTS = [
  {
    id: 'pharmacy', msgKey: 'oliMsgPharmacy', titleKey: 'dutyPharmacies',
    keywords: ['pharmacy', 'pharmacies', 'chemist', 'drugstore', 'duty pharmacy', 'on duty', 'medicine', 'prescription',
      'eczane', 'nobetci eczane', 'nobetci', 'ilac', 'recete',
      'аптека', 'дежурная аптека', 'лекарство', 'apotheke', 'pharmacie', 'farmacia', 'صيدلية', 'دواء', 'داروخانه',
      'pharmacie de garde', 'bereitschaftsapotheke', 'аптеки', 'дежурные аптеки', 'φαρμακειο', 'φαρμακεια', 'εφημερευον', 'εφημερευοντα', 'مناوبة', 'نوبت دار', 'صيدليات',
      'داروخونه', 'صيدلية مناوبة'],
  },
  {
    id: 'clinic', msgKey: 'oliMsgClinic', titleKey: 'hubMedicalTitle',
    keywords: ['doctor', 'clinic', 'hospital', 'dentist', 'physician', 'medical', 'gp', 'health',
      'doktor', 'klinik', 'hastane', 'dis', 'disci', 'hekim', 'saglik', 'muayene',
      'врач', 'больница', 'клиника', 'стоматолог', 'arzt', 'klinik', 'krankenhaus', 'zahnarzt',
      'medecin', 'clinique', 'hopital', 'dentiste', 'medico', 'clinica', 'hospital', 'dentista',
      'طبيب', 'عيادة', 'مستشفى', 'اسنان', 'پزشک', 'دکتر', 'بیمارستان', 'دندانپزشک',
      'sante', 'медицина', 'γιατρο', 'γιατρος', 'ιατρικ', 'νοσοκομειο', 'οδοντιατρ', 'κλινικη', 'پزشکی', 'طبي', 'طبية', 'مرافق طبية',
      'دكتور', 'دندونپزشک', 'دندون', 'دندان'],
  },
  {
    id: 'emergency', msgKey: 'oliMsgEmergency', titleKey: 'menuEmergency',
    keywords: ['emergency', 'ambulance', 'police', 'fire', 'urgent', '112', '155', '199',
      'acil', 'ambulans', 'polis', 'itfaiye', 'yardim',
      'скорая', 'полиция', 'помощь', 'пожар', 'notruf', 'krankenwagen', 'polizei', 'feuerwehr',
      'urgence', 'ambulance', 'police', 'emergencia', 'ambulancia', 'policia',
      'طوارئ', 'اسعاف', 'شرطة', 'اورژانس', 'امبولانس', 'پلیس',
      'urgences', 'экстренн', 'службы спасения', 'εκτακτη αναγκη', 'εκτακτης αναγκης', 'ασθενοφορο', 'αστυνομια', 'πυροσβεστικη', 'اضطراری', 'آتش نشانی',
      'скорой', 'скорую', 'полици', 'رقم الطوارئ'],
  },
  {
    id: 'newcomer', msgKey: 'oliMsgNewcomer', titleKey: 'menuNewcomerEssentials',
    keywords: ['new', 'newcomer', 'guide', 'welcome', 'essentials', 'border', 'crossing', 'moving', 'settle', 'visa', 'residence', 'permit',
      'yeni', 'rehber', 'hos geldin', 'sinir', 'gecis', 'kapi', 'tasinma', 'oturum', 'vize', 'ikamet',
      'новичок', 'граница', 'гид', 'виза', 'neu', 'grenze', 'leitfaden', 'nouveau', 'frontiere', 'guide',
      'nuevo', 'frontera', 'guia', 'جديد', 'حدود', 'دليل', 'تازه وارد', 'مرز', 'راهنما',
      'new here', 'just moved', 'moved here', 'yeni geldim', 'tasindim', 'erste schritte', 'willkommen', 'nouvel arrivant', 'recien llegado', 'переехал', 'οδηγος', 'καλωσορισμα', 'νεος στην κυπρο',
      'emmenager', 'mudarme', 'me mude', 'hergezogen', 'umgezogen', 'neu hier', 'μετακομισ', 'تازه اومدم', 'تازه رسیدم'],
  },
  {
    id: 'events', msgKey: 'oliMsgEvents', titleKey: 'menuEvents',
    keywords: ['event', 'events', 'concert', 'festival', 'whats on', 'nightlife', 'party', 'gig', 'shows', 'live music',
      'etkinlik', 'konser', 'festival', 'gece hayati', 'parti', 'neler var', 'ne var',
      'концерт', 'событие', 'вечеринка', 'veranstaltung', 'konzert', 'evenement', 'concert',
      'evento', 'concierto', 'حفلة', 'فعالية', 'كونسير', 'کنسرت', 'رویداد', 'برنامه',
      'concerts', 'событи', 'фестиваль', 'εκδηλωσ', 'συναυλ', 'φεστιβαλ', 'حفلات', 'فعاليات',
      'this weekend', 'weekend', 'hafta sonu', 'week end', 'fin de semana', 'was ist los', 'wochenende', 'мероприят', 'на выходных', 'выходных', 'σαββατοκυριακο'],
  },
  {
    id: 'homeServices', msgKey: 'oliMsgHomeServices', titleKey: 'menuHomeServices',
    keywords: ['plumber', 'electrician', 'cleaner', 'cleaning', 'handyman', 'repair', 'home service', 'painter', 'ac repair',
      'tesisatci', 'elektrikci', 'temizlik', 'tamir', 'tamirci', 'usta', 'ustasi', 'tadilat', 'boyaci', 'ev hizmet',
      'сантехник', 'электрик', 'уборка', 'ремонт', 'klempner', 'elektriker', 'reinigung',
      'plombier', 'electricien', 'menage', 'fontanero', 'electricista', 'limpieza',
      'سباك', 'كهربائي', 'تنظيف', 'لوله', 'برق کار', 'نظافت',
      'renovation', 'reforma', 'umbau', 'handwerker', 'artisan', 'отделка', 'ανακαινιση', 'υδραυλικ', 'ηλεκτρολογ', 'بازسازی', 'تجديد',
      'electricien', 'electricista', 'كهربجي', 'برقکار', 'لوله کش'],
  },
  {
    id: 'jobs', msgKey: 'oliMsgJobs', titleKey: 'menuJobPostings',
    keywords: ['job', 'jobs', 'work', 'vacancy', 'hiring', 'employment', 'career', 'cv',
      'isler', 'is ilani', 'is ilanlari', 'is ariyorum', 'is bul', 'is var mi', 'kariyer', 'eleman', 'calismak', 'ise',
      'работа', 'вакансия', 'arbeit', 'stelle', 'emploi', 'travail', 'trabajo', 'empleo',
      'وظيفة', 'عمل', 'شغل', 'کار', 'استخدام',
      'работ', 'ваканси', 'δουλεια', 'εργασια', 'θεσεις εργασιας', 'شغلی', 'وظائف'],
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
      'فيلا', 'استوديو', 'ویلا', 'διαμερισμα', 'κατοικια', 'ακινητα',
      'residences', 'immobilier', 'inmuebles', 'residencias', 'wohnheim', 'immobilien', 'общежити', 'недвижимост', 'ενοικιαση', 'ενοικιο', 'φοιτητικες εστιες', 'خوابگاه', 'املاک', 'للإيجار', 'إيجار',
      'dorm', 'dorms', 'dormitory', 'dormitories', 'yurt', 'yurdu', 'yurtlar', 'studentenwohnheim', 'residence etudiante', 'residencia de estudiantes', 'appart', 'квартир', 'аренд', 'φοιτητικη εστια', 'εστια', 'سكن طلاب', 'خوابگاه'],
  },
  {
    id: 'pets', msgKey: 'oliMsgPets', titleKey: 'menuPets',
    keywords: ['pet', 'pets', 'dog', 'cat', 'vet', 'veterinary', 'veterinarian', 'animal', 'puppy', 'kitten',
      'evcil', 'kopek', 'kedi', 'veteriner', 'hayvan',
      'собака', 'кошка', 'ветеринар', 'животное', 'hund', 'katze', 'tierarzt', 'haustier',
      'chien', 'chat', 'veterinaire', 'animal', 'perro', 'gato', 'veterinario', 'mascota',
      'كلب', 'قطة', 'بيطري', 'حيوان', 'سگ', 'گربه', 'دامپزشک', 'حیوان',
      'animaux', 'haustiere', 'питомц', 'κατοικιδια', 'κτηνιατρ', 'σκυλος', 'γατα', 'حیوانات خانگی'],
  },
  {
    id: 'transport', msgKey: 'oliMsgTransport', titleKey: 'menuTransportation',
    keywords: ['bus', 'taxi', 'car', 'transport', 'transportation', 'getting around', 'rental car', 'drive', 'minibus',
      'otobus', 'taksi', 'araba', 'ulasim', 'dolmus', 'kiralik araba', 'arac',
      'автобус', 'такси', 'машина', 'транспорт', 'bus', 'taxi', 'auto', 'transport',
      'voiture', 'autobus', 'coche', 'transporte', 'حافلة', 'تاكسي', 'سيارة', 'مواصلات',
      'اتوبوس', 'تاکسی', 'ماشین', 'حمل و نقل',
      'ταξι', 'λεωφορειο', 'μεταφορες', 'حمل ونقل',
      'taxis', 'taksiler', 'تكسي', 'باص', 'الباص'],
  },
  {
    id: 'beaches', msgKey: 'oliMsgBeaches', titleKey: 'menuBeachesLandmarks',
    keywords: ['beach', 'beaches', 'landmark', 'landmarks', 'sightseeing', 'things to do', 'explore', 'attractions', 'sea', 'tourist',
      'plaj', 'sahil', 'gezilecek', 'gezi', 'deniz', 'tarihi yer', 'gorulecek',
      'пляж', 'достопримечательности', 'море', 'strand', 'sehenswurdigkeiten',
      'plage', 'sites', 'playa', 'lugares', 'شاطئ', 'معالم', 'بحر', 'ساحل', 'دیدنی', 'جاهای دیدنی',
      'castle', 'castles', 'kale', 'kalesi', 'museum', 'muze', 'sehenswurdigkeit', 'достопримечательност', 'παραλια', 'παραλιες', 'αξιοθεατα', 'الشواطئ', 'سواحل', 'جاذبه',
      'plajlar', 'plaja', 'plajda', 'plaji', 'plajlari', 'пляжи', 'пляжей', 'пляжа'],
  },
  {
    id: 'exchange', msgKey: 'oliMsgExchange', titleKey: 'menuExchangeRates',
    keywords: ['exchange', 'exchange rate', 'rate', 'currency', 'money', 'convert', 'lira', 'forex', 'euro', 'dollar', 'pound',
      'kur', 'doviz', 'para', 'cevir', 'lira', 'kur cevir',
      'курс', 'валюта', 'деньги', 'обмен', 'wechselkurs', 'wahrung', 'geld',
      'change', 'devise', 'taux', 'cambio', 'moneda', 'divisa', 'صرف', 'عملة', 'نقود', 'نرخ ارز', 'ارز', 'پول',
      'ισοτιμια', 'ισοτιμιες', 'συναλλαγμα', 'الصرف', 'أسعار الصرف', 'курсы', 'валют',
      'para bozdur', 'para cevir', 'para degis', 'cambiar dinero', 'casa de cambio', 'dinero', 'يورو', 'ليرة', 'مصاري', 'یورو', 'لیر', 'نرخ یورو'],
  },
  {
    id: 'municipal', msgKey: 'oliMsgMunicipal', titleKey: 'menuMunicipalities',
    keywords: ['municipality', 'municipalities', 'council', 'town hall', 'mayor',
      'belediye', 'muhtar', 'муниципалитет', 'gemeinde', 'rathaus', 'mairie', 'municipalite',
      'municipio', 'ayuntamiento', 'بلدية', 'شهرداری',
      'δημος', 'δημοι', 'δημαρχειο', 'мэрия', 'мэрии', 'البلديات', 'بلديات'],
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
    'بالقرب', 'قريب مني', 'قريبة', 'نزدیک', 'نزدیک من', 'κοντα μου', 'εδω κοντα',
    // Explore: the tab's own name in every language (t('menuExplore')), its verbs, and "show me places" / "what to do".
    'explore', 'exploring', 'things to do', 'what to do', 'show me places', 'places to visit', 'sightseeing',
    'kesfet', 'kesfetmek', 'kesfedin', 'gezilecek yerler', 'yerleri goster', 'ne yapsam', 'ne yapilir', 'nereye gidilir',
    'entdecken', 'entdecke', 'erkunden', 'was kann man', 'was tun', 'zeig mir orte',
    'explorer', 'que faire', 'montre moi des lieux', 'lieux a visiter',
    'explorar', 'que hacer', 'muestrame lugares', 'lugares para visitar',
    'обзор', 'исследовать', 'что посмотреть', 'чем заняться', 'покажи места',
    'εξερευν', 'δειξε μου μερη', 'τι να κανω', 'τι να δω',
    'استكشاف', 'استكشف', 'أرني أماكن', 'ماذا أفعل', 'کاوش', 'نشانم بده', 'چه کار کنم',
      'what can i do', 'ne yapabilirim', 'peut faire', 'puede hacer', 'cerca', 'dans le coin', 'pres d ici', 'a cote', 'куда сходить', 'исторические места', 'ιστορικα μερη', 'επισκεφ', 'اماكن تاريخية', 'بتستاهل زيارة', 'شو فيني اعمل', 'جاهای تاریخی', 'چیکار میشه کرد', 'چیکار کنم'],
}
const CHAT_EATERY = {
  id: 'eatery', msgKey: 'oliChatEatery', titleKey: 'menuEatery',
  keywords: ['restaurant', 'restaurants', 'food', 'eat', 'eating', 'dinner', 'lunch', 'breakfast', 'cafe', 'takeaway', 'pizza', 'burger',
    'yemek', 'restoran', 'kafe', 'lokanta', 'kahvalti', 'aksam yemegi', 'ogle yemegi', 'paket servis', 'yeme icme', 'yesem', 'yiyelim',
    'ресторан', 'еда', 'кафе', 'поесть', 'essen', 'restaurants', 'manger', 'nourriture', 'comida', 'restaurante', 'comer',
    'مطعم', 'طعام', 'مقهى', 'رستوران', 'غذا', 'کافه', 'εστιατοριο', 'φαγητο', 'καφε',
    'φαω', 'να φαω', 'آكل', 'مأكولات', 'مشروبات', 'خوردن', 'نوشیدن'],
}
// Chat-only routes to the exact page that answers the question. The Welcome Guide sections open that card
// (NewcomerEssentialsScreen initialCard); the others open their module. They share one lead-in (oliChatRouteSection)
// and the button reads the page's own title. Every id here needs an oliNavigate case in App.js
// (scripts/check-oli-intents.mjs asserts it).
const SECTION = { msgKey: 'oliChatRouteSection' }
const CHAT_ROUTES = [
  { ...SECTION, id: 'borders', titleKey: 'essCardBorders',
    keywords: ['border', 'borders', 'border crossing', 'crossing', 'checkpoint', 'green line', 'go to the south', 'south cyprus',
      'sinir kapisi', 'sinir kapilari', 'sinir', 'gecis noktasi', 'guneye', 'guney kibris', 'guney tarafina', 'yesil hat',
      'граница', 'границу', 'кпп', 'пропускной пункт', 'на юг', 'южный кипр',
      'grenzubergang', 'grenze', 'in den suden', 'frontiere', 'point de passage', 'points de passage', 'passer au sud',
      'frontera', 'paso fronterizo', 'cruce', 'al sur', 'معبر', 'المعابر', 'الحدود', 'مرز', 'گذرگاه',
      'συνορα', 'οδοφραγμα', 'σημειο διελευσης', 'στο νοτο',
      'to the south', 'cross to the south', 'go south', 'south side', 'kapilar', 'au sud', 'fronteriz', 'νοτο', 'جنوب', 'معابر', 'حدودية', 'جنوبی'] },
  { ...SECTION, id: 'ports', titleKey: 'essCardPorts',
    keywords: ['airport', 'airports', 'flight', 'flights', 'ferry', 'ferries', 'seaport', 'ercan', 'larnaca', 'paphos',
      'havalimani', 'havaalani', 'ucak', 'ucus', 'feribot', 'liman', 'аэропорт', 'паром', 'рейс', 'flughafen', 'flug',
      'aeroport', 'ferry', 'aeropuerto', 'vuelo', 'ferri', 'مطار', 'رحلة', 'عبارة', 'فرودگاه', 'پرواز', 'καραβι',
      'αεροδρομιο', 'πτηση', 'πτησεις', 'φεριμποτ', 'λιμανι',
      'مطارات', 'موانئ', 'faehre', 'fahre nach', 'die fahre',
      'eine fahre', 'φερι', 'ارجان', 'أرجان', 'إركان', 'کشتی'] },
  { ...SECTION, id: 'embassies', titleKey: 'essCardEmbassies',
    keywords: ['embassy', 'embassies', 'consulate', 'visa', 'passport', 'elcilik', 'buyukelcilik', 'konsolosluk', 'vize',
      'pasaport', 'посольство', 'консульство', 'виза', 'визу', 'паспорт', 'botschaft', 'konsulat', 'visum', 'reisepass',
      'ambassade', 'consulat', 'passeport', 'embajada', 'consulado', 'visado', 'pasaporte', 'سفارة', 'قنصلية', 'تأشيرة',
      'جواز سفر', 'سفارت', 'کنسولگری', 'ویزا', 'گذرنامه', 'πρεσβεια', 'προξενειο', 'βιζα', 'διαβατηριο',
      'سفارات', 'посольства', 'πρεσβειες',
      'buyukelcili', 'elcili', 'فيزا'] },
  { ...SECTION, id: 'holidays', titleKey: 'essCardHolidays',
    keywords: ['public holiday', 'public holidays', 'bank holiday', 'national holiday', 'bayram', 'bayrami', 'resmi tatil',
      'tatil gunu', 'праздник', 'праздники', 'выходные дни', 'feiertag', 'feiertage', 'jour ferie', 'jours feries',
      'dia festivo', 'festivos', 'عطلة رسمية', 'عطلات', 'تعطیلات رسمی', 'تعطیل رسمی', 'αργια', 'αργιες',
      'العطل الرسمية', 'العطل', 'عطل'] },
  { ...SECTION, id: 'driving', titleKey: 'essCardDriving',
    keywords: ['speed limit', 'speed limits', 'traffic rules', 'road rules', 'drive on the left', 'driving rules', 'drink driving',
      'alcohol limit', 'seatbelt', 'number plate', 'hiz limiti', 'hiz siniri', 'trafik kurallari', 'soldan', 'alkol siniri',
      'emniyet kemeri', 'ограничение скорости', 'правила дорожного движения', 'левостороннее', 'tempolimit',
      'verkehrsregeln', 'linksverkehr', 'limitation de vitesse', 'code de la route', 'limite de velocidad', 'normas de trafico',
      'حد السرعة', 'قواعد المرور', 'محدودیت سرعت', 'قوانین رانندگی', 'οριο ταχυτητας', 'κωδικας οδικης κυκλοφοριας',
      'traffic', 'traffic and driving', 'trafik', 'surus', 'القيادة', 'السير والقيادة', 'пдд', 'вождение', 'οδηγηση', 'conduite', 'conduccion', 'fahren', 'رانندگی',
      'hiz sinir', 'hiz limit', 'vitesse', 'limitation', 'roule a gauche', 'velocidad', 'por la izquierda', 'geschwindigkeit', 'hier links', 'links fahren', 'скорост', 'ταχυτητ', 'αριστερα', 'السرعة', 'عاليسار', 'اليسار', 'سرعت مجاز', 'سرعت'] },
  { ...SECTION, id: 'living', titleKey: 'essCardLiving',
    keywords: ['tap water', 'drinking water', 'jellyfish', 'snake', 'snakes', 'viper', 'summer hours', 'musluk suyu', 'icme suyu',
      'damacana', 'denizanasi', 'yilan', 'engerek', 'yaz mesaisi', 'вода из под крана', 'питьевая вода', 'медуз', 'змея', 'змеи',
      'leitungswasser', 'trinkwasser', 'qualle', 'quallen', 'schlange', 'eau du robinet', 'eau potable', 'meduse', 'serpent',
      'agua del grifo', 'agua potable', 'medusa', 'medusas', 'serpiente', 'ماء الحنفية', 'مياه الشرب', 'قنديل البحر', 'ثعبان',
      'آب لوله کشی', 'آب آشامیدنی', 'عروس دریایی', 'مار', 'νερο βρυσης', 'ποσιμο νερο', 'μεδουσα', 'μεδουσες', 'φιδι',
      'living here', 'life here', 'burada yasam', 'yasam', 'الحياة هنا', 'жизнь здесь', 'η ζωη εδω', 'vivre ici', 'vivir aqui', 'leben vor ort', 'زندگی در اینجا',
      'из под крана', 'βρυσης', 'φιδια', 'الحنفية', 'حنفية', 'افاعي', 'أفاعي'] },
  { ...SECTION, id: 'towing', titleKey: 'menuTowing',
    keywords: ['tow truck', 'towing', 'roadside', 'breakdown', 'broke down', 'flat tyre', 'flat tire', 'cekici', 'yol yardim',
      'bozuldu', 'lastik patladi', 'эвакуатор', 'сломалась машина', 'abschleppdienst', 'abschleppwagen', 'pannenhilfe',
      'depanneuse', 'depannage', 'grua', 'asistencia en carretera', 'سحب السيارات', 'ونش', 'یدک کش', 'امداد خودرو',
      'γερανος', 'οδικη βοηθεια',
      'سحب', 'سحب ومساعدة',
      'γεραν', 'χαλασε', 'سطحة', 'تعطلت'] },
  { ...SECTION, id: 'ehliyet', titleKey: 'menuEhliyet',
    keywords: ['driving school', 'driving licence', 'driving license', 'drivers license', 'driver s license', 'driving test',
      'learn to drive', 'ehliyet', 'surucu kursu', 'sofor okulu', 'surucu belgesi', 'direksiyon', 'водительские права',
      'водительское удостоверение', 'автошкола', 'fuhrerschein', 'fahrschule', 'permis de conduire', 'auto ecole',
      'carnet de conducir', 'autoescuela', 'رخصة قيادة', 'رخصة القيادة', 'مدرسة تعليم القيادة', 'گواهینامه',
      'آموزشگاه رانندگی', 'διπλωμα οδηγησης', 'σχολη οδηγων',
      'carne de conducir',
      'driving schools', 'автошкол', 'σχολες οδηγων', 'رخصة سواقة', 'سواقة', 'تعليم سواقة'] },
  { ...SECTION, id: 'esim', titleKey: 'menuEsim',
    keywords: ['sim', 'sim card', 'esim', 'e sim', 'mobile line', 'phone line', 'mobile data', 'data plan', 'internet package',
      'kktcell', 'telsim', 'turkcell', 'vodafone', 'hat', 'telefon hatti', 'sim kart', 'mobil hat', 'internet paketi', 'faturali',
      'faturasiz', 'симка', 'сим карта', 'сим карту', 'мобильный интернет', 'sim karte', 'simkarte', 'handyvertrag',
      'carte sim', 'forfait', 'tarjeta sim', 'linea movil', 'شريحة', 'خط موبايل', 'سیم کارت', 'سیمکارت', 'خط موبایل',
      'καρτα sim', 'κινητη τηλεφωνια',
      'الجوال', 'خط الجوال', 'мобильная связь', 'ligne mobile',
      'симку', 'симки', 'сим карт', 'оператор', 'operadora', 'operateur', 'operator', 'mobilfunk', 'κινητης', 'πακετο ιντερνετ', 'شركة اتصالات', 'باقة نت', 'باقة', 'اپراتور', 'بسته اینترنت'] },
  { ...SECTION, id: 'hotels', titleKey: 'accomTabHotels',
    keywords: ['hotel', 'hotels', 'otel', 'oteller', 'гостиница', 'гостиницу', 'отель', 'отели',
      'فندق', 'فنادق', 'هتل', 'ξενοδοχειο', 'ξενοδοχεια'] },
  { ...SECTION, id: 'studentHub', titleKey: 'menuStudentHub',
    keywords: ['student', 'students', 'university', 'campus', 'ogrenci', 'universite', 'kampus', 'студент', 'студенты',
      'университет', 'universitat', 'etudiant', 'universite', 'estudiante', 'universidad', 'طالب', 'طلاب', 'جامعة',
      'دانشجو', 'دانشگاه', 'φοιτητης', 'φοιτητες', 'πανεπιστημιο',
      'φοιτητικα', 'estudiantil',
      'universitari'] },
  { ...SECTION, id: 'duyurular', titleKey: 'menuDuyurular',
    keywords: ['announcement', 'announcements', 'scholarship', 'tender', 'outage', 'outages', 'power cut', 'water cut',
      'electricity cut', 'duyuru', 'duyurular', 'munhal', 'burs', 'ihale', 'kesinti', 'elektrik kesintisi', 'su kesintisi',
      'elektrikler', 'объявлени', 'стипенди', 'отключени', 'ankundigung', 'stipendium', 'stromausfall', 'annonce', 'bourse',
      'coupure', 'anuncio', 'beca', 'corte de luz', 'corte de agua', 'إعلان', 'إعلانات', 'منحة', 'انقطاع', 'اطلاعیه',
      'بورسیه', 'قطعی', 'ανακοινωση', 'ανακοινωσεις', 'υποτροφια', 'διακοπη',
      'mitteilungen',
      'отключ', 'منح', 'منح دراسية', 'برق قطع', 'قطع برق'] },
]
// Modules that are switched off in production: the question is understood, the answer says "not open yet"
// (utils/oliAnswers.js) instead of a button to a Coming Soon page.
const CHAT_DARK = [
  { ...SECTION, id: 'insurance', titleKey: 'menuInsurance',
    keywords: ['insurance', 'sigorta', 'страховка', 'страхование', 'versicherung', 'assurance', 'seguro', 'تأمين', 'بیمه', 'ασφαλεια',
      'ασφαλιση', 'versichern',
      'autoversicherung', 'kfz versicherung'] },
]
// Topics ADA has NO content on yet: answered with the honest "I don't know", never with a nearby card or a
// search hit that only shares a word. The list of gaps lives in the vault (Oli build log).
const CHAT_GAP = {
  id: 'gap', gap: true, msgKey: 'oliChatNoMatch', titleKey: 'essHubTitle',
  keywords: ['residence permit', 'work permit', 'oturum izni', 'oturma izni', 'ikamet izni', 'ikamet', 'calisma izni',
    'вид на жительство', 'внж', 'разрешение на работу', 'aufenthaltserlaubnis', 'aufenthaltstitel', 'arbeitserlaubnis',
    'titre de sejour', 'permis de sejour', 'permis de travail', 'permiso de residencia', 'permiso de trabajo',
    'إقامة', 'الإقامة', 'تصريح عمل', 'اجازه اقامت', 'اقامت', 'مجوز کار', 'αδεια διαμονης', 'αδεια εργασιας',
    'bank account', 'open an account', 'banka hesabi', 'hesap acmak', 'банковский счет', 'счет в банке', 'bankkonto', 'konto eroffnen',
    'compte bancaire', 'cuenta bancaria', 'حساب بنكي', 'حساب بانکی', 'τραπεζικος λογαριασμος',
    'school', 'schools', 'kindergarten', 'okul', 'okullar', 'kres', 'anaokulu', 'школа', 'школы', 'детский сад', 'schule', 'kindergarten',
    'ecole', 'creche', 'escuela', 'colegio', 'guarderia', 'مدرسة', 'مدارس', 'روضة', 'مدرسه', 'مهدکودک', 'σχολειο', 'νηπιαγωγειο',
      'supermarket', 'supermarkets', 'grocery', 'groceries', 'market', 'supermarche', 'supermercado', 'el super', 'supermarkt', 'супермаркет', 'σουπερ μαρκετ', 'سوبرماركت', 'سوپرمارکت', 'weather', 'hava durumu', 'hava nasil', 'meteo', 'temps fera', 'que tiempo', 'clima', 'wetter', 'погода', 'погоду', 'καιρο', 'الطقس', 'طقس', 'هوا فردا', 'آب و هوا', 'هوا چطور', 'home internet', 'ev interneti', 'eve internet', 'evde internet', 'fiber internet', 'wifi', 'internet a la maison', 'internet en casa', 'internet fur zu hause', 'internet zu hause', 'домашний интернет', 'ιντερνετ στο σπιτι', 'انترنت للبيت', 'انترنت منزلي', 'اینترنت خونه', 'اینترنت خانگی', 'electricity bill', 'elektrik faturasi', 'fatura', 'facture', 'factura', 'stromrechnung', 'rechnung', 'счет за', 'λογαριασμο του ρευματος', 'فاتورة', 'قبض برق', 'قبض', 'maternelle', 'τραπεζικ', 'حساب بنك'],
}
// Chat priority. Differs from OLI_INTENTS: pets before clinic (Arabic "طبيب بيطري", a vet, contains "doctor");
// accommodation before newcomer (French "Résidences" prefix-matches newcomer's 'residence'); the specific routes
// before the broad ones (towing before emergency: "yol yardım" is not "yardım"; driving schools before the driving
// rules card); content gaps before newcomer, so "oturum izni" is not answered with the Welcome Guide.
const CHAT_ORDER = ['pharmacy', 'pets', 'clinic', 'living', 'homeServices', 'towing', 'emergency', 'ehliyet', 'gap', 'driving', 'borders',
  'ports', 'embassies', 'holidays', 'esim', 'hotels', 'accommodation', 'studentHub', 'newcomer', 'events', 'duyurular', 'jobs',
  'insurance', 'transport', 'nearby', 'beaches', 'exchange', 'municipal', 'eatery']
// Generic words that misroute in the chat now that specific routes exist: newcomer's permit / border words go to
// the gap and borders routes above, and 'kapi' ("door") matched "Girne Kapısı". Turkish 'para' (money) is Spanish
// "for"; Arabic 'حدود' is also "limits" (حدود السرعة); Persian 'لوله' (pipe) is also tap water (آب لوله کشی).
const CHAT_DROP = {
  newcomer: new Set(['residence', 'permit', 'oturum', 'ikamet', 'kapi', 'visa', 'vize', 'حدود']),
  exchange: new Set(['para']),
  homeServices: new Set(['لوله']),
}
const ALL_CHAT = [...OLI_INTENTS, CHAT_NEARBY, CHAT_EATERY, ...CHAT_ROUTES, ...CHAT_DARK, CHAT_GAP]
  .map(i => (CHAT_DROP[i.id] ? { ...i, keywords: i.keywords.filter(k => !CHAT_DROP[i.id].has(k)) } : i))
export const OLI_CHAT_INTENTS = CHAT_ORDER.map(id => ALL_CHAT.find(i => i.id === id))

const BY_ID = OLI_CHAT_INTENTS.reduce((m, i) => { m[i.id] = i; return m }, {})
// Chat-only ids resolve too; the search sheet only ever asks for ids from OLI_INTENTS (its CHIPS).
export const getIntent = (id) => BY_ID[id]

// Match a keyword against the normalized query. Short keywords (<=4 chars, e.g.
// "is" = Turkish "iş", "geld" = German money) match whole words only, so they don't
// fire inside longer words across languages ("geld" ⊄ Turkish "geldim"). Keywords of
// 5+ chars allow prefix matching, so Turkish suffixes ("eczaneye", "doktora") still hit.
// partial: a typed word may be the START of a keyword too ("eczan" → 'eczane'), for the search sheet's as-you-type
// results. The chat gets whole questions, where that rule misroutes ("Essen" → newcomer's 'essentials').
function keywordHits(kw, q, words, partial = true) {
  const nkw = normalize(kw)
  if (!nkw) return false
  if (nkw.includes(' ')) return q.includes(nkw)
  if (nkw.length <= 4) return words.includes(nkw)
  return words.some(w => w === nkw || w.startsWith(nkw) || (partial && w.length >= 5 && nkw.startsWith(w)))
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
// The chat matches whole questions: punctuation and the Persian zero-width joiner split words ("kıbrıs'ı",
// "d’urgence", "montre-moi", "حمل‌ونقل"), and a word must not match as the start of a longer keyword (partial false).
const chatQuery = text => {
  const q = stripWakeWord(normalize(String(text)
    .replace(/[\u200c'’`´\-–—,.!?;:()·&/"«»¿¡؟،]+/g, ' ')))
  // Arabic writes the article and short prepositions on the word ("الطوارئ", "عالجنوب", "بكيرينيا", "للبيت"): each such
  // word also counts without them.
  const words = q.split(' ').filter(Boolean).flatMap(w => {
    const out = [w]
    const pre = ['بال', 'وال', 'عال', 'فال', 'كال', 'لل', 'ال'].find(p => w.length > p.length + 2 && w.startsWith(p))
    if (pre) out.push(w.slice(pre.length))
    else if (w.length > 4 && /^[بلو]/.test(w)) out.push(w.slice(1))
    return out
  })
  return { q, words }
}
const hits = (kw, { q, words }) => keywordHits(kw, q, words, false)

// "plaj yakınımda" → ['beach']; [] when the text asks for no type, or does not say "near me" at all.
export function nearbyPlaceTypes(text) {
  const cq = chatQuery(text)
  if (!cq.q || !asksNearby(cq)) return []
  const found = OLI_PLACE_TYPES.filter(p => !p.group && p.keywords.some(kw => hits(kw, cq)))
  if (found.length) return found.map(p => p.id)
  const group = OLI_PLACE_TYPES.find(p => p.group && p.keywords.some(kw => hits(kw, cq)))
  return group ? [group.id] : []
}

// A "near me" / explore question is about places: "yakınımda ne var" is not "what's on" (events: 'ne var'), and
// Persian "در قبرس چه کار کنم" (what to do) is not a job (jobs: 'کار'). Only those generic words step aside, so
// "eczane yakınımda" still answers with the duty pharmacies.
const NEAR_ME_GENERIC = new Set(['ne var', 'neler var', 'کار'])
const OLI_CHAT_NEAR_INTENTS = OLI_CHAT_INTENTS.map(i => ({ ...i, keywords: i.keywords.filter(k => !NEAR_ME_GENERIC.has(k)) }))
const asksNearby = cq => NEARBY.keywords.some(kw => hits(kw, cq))

// The chat's resolver: the best intent, and the place types for a nearby answer.
export function resolveOliChat(text) {
  const cq = chatQuery(text)
  const resolve = intents => intents.find(i => i.keywords.some(kw => hits(kw, cq)))
  if (!cq.q || !asksNearby(cq)) return { intent: resolve(OLI_CHAT_INTENTS), types: [] }
  const types = nearbyPlaceTypes(text)
  return { intent: types.length ? NEARBY : resolve(OLI_CHAT_NEAR_INTENTS), types }
}
