// Ask Oli routing audit (constants/oliIntents.js resolveOliChat), all 9 languages:
//   1. every chat chip's label, TYPED, reaches that chip's intent
//   2. every answer screen's own title, typed ("Keşfet", "Entdecken", "Etkinlikler"…), reaches that screen
//   3. common phrases per language reach the intent where ADA has the answer (never "I don't know")
// Fails on any mismatch, so a keyword edit that steals a route shows up here before an OTA.
//   node scripts/check-oli-intents.mjs
import { resolveOliChat, OLI_CHAT_INTENTS } from '../constants/oliIntents.js'
import { t, LANGUAGES } from '../constants/i18n.js'
import { readFileSync } from 'node:fs'
import { REALISTIC_QUESTIONS } from './oli-realistic-questions.mjs'

let bad = 0, n = 0
const check = (label, text, want) => {
  n++
  const got = resolveOliChat(text).intent?.id ?? null
  // want may list several right answers: 'nearby|beaches'.
  if (!String(want).split('|').includes(String(got))) { bad++; console.log(`  ✗ ${label}: "${text}" → ${got}, want ${want}`) }
}

const CHIPS = { oliChatChipPharmacy: 'pharmacy', oliChatChipEvents: 'events', oliChatChipNearby: 'nearby',
  oliChatChipEatery: 'eatery', oliChipEmergency: 'emergency', oliChipNewcomer: 'newcomer' }
for (const { key: lang } of LANGUAGES) {
  for (const [k, id] of Object.entries(CHIPS)) check(`chip ${lang}`, t(k, lang), id)
  for (const i of OLI_CHAT_INTENTS) if (!i.gap) check(`title ${lang}`, t(i.titleKey, lang), i.id)
}

// Written as people type them (accents optional: normalize() folds them).
const PHRASES = {
  English: [
    ['i want to explore cyprus', 'nearby'], ['explore', 'nearby'], ['show me places', 'nearby'],
    ['what to do in cyprus', 'nearby'], ['things to do', 'nearby'], ['where is the castle', 'beaches'],
    ['show me events this weekend', 'events'], ['any concerts tonight', 'events'], ['beaches near me', 'nearby'],
    ['where can i eat', 'eatery'], ['i need a doctor', 'clinic'], ['call an ambulance', 'emergency'],
    ['i am looking for a job', 'jobs'], ['flat for rent', 'accommodation'], ['taxi', 'transport'],
    ['euro to lira', 'exchange'], ['i just moved here', 'newcomer'], ['vet for my dog', 'pets'],
    ['which pharmacy is open tonight', 'pharmacy'], ['what is the exchange rate', 'exchange'],
  ],
  Turkish: [
    ['keşfet', 'nearby'], ["kıbrıs'ı keşfetmek istiyorum", 'nearby'], ['bana yerleri göster', 'nearby'],
    ['gezilecek yerler', 'nearby'], ['ne yapsam', 'nearby'], ['kale nerede', 'beaches'],
    ['bu hafta sonu etkinlikler', 'events'], ['konser var mı', 'events'], ['plaj yakınımda', 'nearby'],
    ['nerede yemek yiyebilirim', 'eatery'], ['doktora gitmem lazım', 'clinic'], ['ambulans çağır', 'emergency'],
    ['iş arıyorum', 'jobs'], ['kiralık daire', 'accommodation'], ['taksi', 'transport'],
    ['euro kaç lira', 'exchange'], ['yeni taşındım', 'newcomer'], ['köpeğim için veteriner', 'pets'],
    ['nöbetçi eczane', 'pharmacy'], ['sor, ara, keşfet', 'nearby'],
  ],
  German: [
    ['Zypern erkunden', 'nearby'], ['entdecken', 'nearby'], ['zeig mir Orte', 'nearby'],
    ['was kann man machen', 'nearby'], ['Sehenswürdigkeiten', 'beaches'], ['Veranstaltungen am Wochenende', 'events'],
    ['Strand in der Nähe', 'nearby'], ['wo kann ich essen', 'eatery'], ['ich brauche einen Arzt', 'clinic'],
    ['Krankenwagen', 'emergency'], ['ich suche Arbeit', 'jobs'], ['Wohnung mieten', 'accommodation'],
    ['Taxi', 'transport'], ['Wechselkurs Euro', 'exchange'], ['Tierarzt', 'pets'], ['Apotheke', 'pharmacy'],
  ],
  French: [
    ['explorer chypre', 'nearby'], ['explorer', 'nearby'], ['montre-moi des lieux', 'nearby'],
    ['que faire à chypre', 'nearby'], ['plage près de moi', 'nearby'], ['concerts ce week-end', 'events'],
    ['où manger', 'eatery'], ["j'ai besoin d'un médecin", 'clinic'], ['urgence', 'emergency'],
    ['je cherche un emploi', 'jobs'], ['appartement à louer', 'accommodation'], ['taxi', 'transport'],
    ['taux de change', 'exchange'], ['vétérinaire', 'pets'], ['pharmacie de garde', 'pharmacy'],
  ],
  Spanish: [
    ['explorar chipre', 'nearby'], ['explorar', 'nearby'], ['muéstrame lugares', 'nearby'],
    ['qué hacer en chipre', 'nearby'], ['playa cerca de mí', 'nearby'], ['conciertos este fin de semana', 'events'],
    ['dónde comer', 'eatery'], ['necesito un médico', 'clinic'], ['ambulancia', 'emergency'],
    ['busco trabajo', 'jobs'], ['apartamento en alquiler', 'accommodation'], ['taxi', 'transport'],
    ['tipo de cambio', 'exchange'], ['veterinario', 'pets'], ['farmacia de guardia', 'pharmacy'],
  ],
  Russian: [
    ['исследовать кипр', 'nearby'], ['обзор', 'nearby'], ['покажи места', 'nearby'],
    ['что посмотреть на кипре', 'nearby'], ['чем заняться', 'nearby'], ['пляж рядом', 'nearby'],
    ['концерты на выходных', 'events'], ['где поесть', 'eatery'], ['нужен врач', 'clinic'],
    ['скорая помощь', 'emergency'], ['ищу работу', 'jobs'], ['снять квартиру', 'accommodation'],
    ['такси', 'transport'], ['курс евро', 'exchange'], ['ветеринар', 'pets'], ['дежурная аптека', 'pharmacy'],
  ],
  Greek: [
    ['εξερεύνηση', 'nearby'], ['θέλω να εξερευνήσω την κύπρο', 'nearby'], ['δείξε μου μέρη', 'nearby'],
    ['τι να κάνω στην κύπρο', 'nearby'], ['παραλία κοντά μου', 'nearby'], ['συναυλίες το σαββατοκύριακο', 'events'],
    ['πού να φάω', 'eatery'], ['χρειάζομαι γιατρό', 'clinic'], ['ασθενοφόρο', 'emergency'],
    ['ψάχνω δουλειά', 'jobs'], ['διαμέρισμα για ενοικίαση', 'accommodation'], ['ταξί', 'transport'],
    ['ισοτιμία ευρώ', 'exchange'], ['κτηνίατρος', 'pets'], ['εφημερεύον φαρμακείο', 'pharmacy'],
  ],
  Arabic: [
    ['استكشاف', 'nearby'], ['أريد استكشاف قبرص', 'nearby'], ['أرني أماكن', 'nearby'],
    ['ماذا أفعل في قبرص', 'nearby'], ['شاطئ بالقرب مني', 'nearby'], ['حفلات نهاية الأسبوع', 'events'],
    ['أين آكل', 'eatery'], ['أحتاج طبيب', 'clinic'], ['اسعاف', 'emergency'],
    ['أبحث عن عمل', 'jobs'], ['شقة للإيجار', 'accommodation'], ['تاكسي', 'transport'],
    ['سعر صرف اليورو', 'exchange'], ['طبيب بيطري', 'pets'], ['صيدلية مناوبة', 'pharmacy'],
  ],
  Persian: [
    ['کاوش', 'nearby'], ['می‌خواهم قبرس را کاوش کنم', 'nearby'], ['جاها را نشانم بده', 'nearby'],
    ['در قبرس چه کار کنم', 'nearby'], ['ساحل نزدیک من', 'nearby'], ['کنسرت آخر هفته', 'events'],
    ['کجا غذا بخورم', 'eatery'], ['دکتر لازم دارم', 'clinic'], ['اورژانس', 'emergency'],
    ['دنبال کار هستم', 'jobs'], ['آپارتمان اجاره ای', 'accommodation'], ['تاکسی', 'transport'],
    ['نرخ ارز یورو', 'exchange'], ['دامپزشک', 'pets'], ['داروخانه شبانه روزی', 'pharmacy'],
  ],
}
for (const [lang, rows] of Object.entries(PHRASES)) for (const [text, want] of rows) check(`phrase ${lang}`, text, want)

// Routes that worked before and must keep working.
for (const [text, want] of [
  ['eczane yakınımda', 'pharmacy'], ['yakınımda ne var', 'nearby'], ['what is near me', 'nearby'],
  ['residence permit', 'gap'], ['visa', 'embassies'], ['oturum izni', 'gap'], ['border crossing', 'borders'],
  ['iş ilanları', 'jobs'], ['etkinlik', 'events'], ['plaj', 'beaches'], ['doktor', 'clinic'], ['acil', 'emergency'],
  ['Oli, nöbetçi eczane', 'pharmacy'], ['hey oli where can i eat', 'eatery'], ['uzaya bilet var mı', null],
]) check('regression', text, want)
for (const [text, want] of [
  ['plaj yakınımda', ['beach']], ['kafe yakınımda', ['cafe']], ['müze yakınımda', ['museum']], ['yakınımda ne var', []],
  ['explore museums', ['museum']], ['keşfet', []], ['beaches to explore', ['beach']],
]) {
  n++
  const got = resolveOliChat(text).types
  if (JSON.stringify(got) !== JSON.stringify(want)) { bad++; console.log(`  ✗ types: "${text}" → ${JSON.stringify(got)}, want ${JSON.stringify(want)}`) }
}

// Realistic questions (scripts/oli-realistic-questions.mjs), 60 per language.
for (const [lang, rows] of Object.entries(REALISTIC_QUESTIONS)) for (const [text, want] of rows) check(`real ${lang}`, text, want)

// Every chat route must open something: an id without an oliNavigate case in App.js is a button that does nothing.
{
  const app = readFileSync(new URL('../App.js', import.meta.url), 'utf8')
  const from = app.indexOf('const oliNavigate = (target) => {')
  const block = app.slice(from, app.indexOf('\n  }\n', from))
  for (const i of OLI_CHAT_INTENTS) {
    if (i.gap) continue
    n++
    if (!block.includes(`case '${i.id}'`)) { bad++; console.log(`  ✗ no oliNavigate case in App.js for chat intent '${i.id}'`) }
  }
}

console.log(bad ? `oli intents: ${bad} of ${n} FAILED` : `oli intents: OK (${n} checks, 9 languages)`)
process.exit(bad ? 1 : 0)
