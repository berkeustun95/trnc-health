// ALL-CAPS event titles read as shouting (Berke 2026-11-08: convert, keep names and acronyms readable).
// Same rules as the Friday push (supabase/functions/send-weekend-digest/digest.ts readableTitle); the two
// copies are held equal by scripts/test-readable-title.mjs. Casing is per word because titles mix languages
// ("PEPPA PIG ÇOCUK TİYATROSU"): a word with a Turkish letter is Turkish (its plain I is ı); a plain-I word is
// English (PIG → Pig) unless it is a known Turkish stem (KIBRIS → Kıbrıs) — a wrong ı reads "Musıc", a wrong i
// only "Kibris", so unknown words fall to English. Mixed-case titles are the organiser's: left as written.
const TR_LETTERS = /[ÇĞİÖŞÜ]/
const TR_I_STEMS = ['KIBRIS', 'KIZ', 'KADIN', 'BALIK', 'ALTIN', 'YIL', 'SALI']
// English words that pass the back-vowel test below; in a Turkish title they stay English.
const EN_BACK = new Set(['MUSIC', 'DISCO', 'RADIO', 'STUDIO', 'AUDIO', 'FINAL', 'INDOOR', 'OUTDOOR', 'TOUR', 'ROCK', 'JAZZ', 'COMIC', 'CLASSIC', 'TROPICAL', 'LATINO', 'ACOUSTIC'])
const ACRONYMS = new Set(['ADA', 'KKTC', 'TRNC', 'EMU', 'DAÜ', 'YDÜ', 'NEU', 'GAÜ', 'LAÜ', 'UKÜ', 'ODTÜ', 'CIU', 'UKU', 'BAU', 'KSTU', 'ARUCAD', 'UEFA', 'FIFA', 'VIP', 'MMA', 'UK', 'USA', 'ABD', 'BBC', 'NYE', 'EDM', 'DJ', 'TV', 'AI'])
const SMALL = new Set(['VE', 'İLE', 'ILE', 'DE', 'DA', 'YA', 'VEYA', 'AND', 'THE', 'OF', 'IN', 'AT', 'FOR', 'WITH', 'A', 'AN', 'TO', 'ON', 'BY', 'VS.', 'VS', '&'])

// Turkish vowel harmony: a native word with a dotless ı has only back vowels (A I O U). Two or more of
// them, in a title already Turkish, reads as Turkish (KIRMIZI → Kırmızı); one vowel stays English (PIG).
function backHarmony(letters) {
  const v = letters.match(/[AEIİOÖUÜ]/g) || []
  return letters.includes('I') && v.length >= 2 && v.every(c => 'AIOU'.includes(c)) && !EN_BACK.has(letters)
}

function wordCase(w, first, trTitle) {
  const letters = w.replace(/[^\p{L}]/gu, '')
  if (!letters || /\d/.test(w)) return w
  if (!first && SMALL.has(w)) return w.toLocaleLowerCase(TR_LETTERS.test(w) ? 'tr' : 'en')
  if (ACRONYMS.has(letters) || (letters.length <= 4 && !/[AEIİOUÖÜ]/.test(letters))) return w
  const loc = TR_LETTERS.test(w) || TR_I_STEMS.some(st => letters.startsWith(st)) || (trTitle && backHarmony(letters)) ? 'tr' : 'en'
  // Capitalise after a hyphen or slash (KIDS-FEST → Kids-Fest), never after an apostrophe (LEFKOŞA'DA → Lefkoşa'da).
  return w.toLocaleLowerCase(loc).replace(/(^|[-/])(\p{L})/gu, (_, sep, ch) => sep + ch.toLocaleUpperCase(loc))
}

export function readableTitle(title) {
  if (typeof title !== 'string') return title
  const t = title.trim()
  const letters = t.replace(/[^\p{L}]/gu, '')
  const upper = letters.replace(/[^\p{Lu}]/gu, '').length
  if (letters.length < 4 || upper / letters.length < 0.8) return t
  const trTitle = TR_LETTERS.test(t) || /(^|\s)(VE|İLE|ILE)(\s|$)/.test(t)
  return t.split(/(\s+)/).map((w, i) => /\s/.test(w) ? w : wordCase(w, i === 0, trTitle)).join('')
}

export const withReadableTitle = e => (e && typeof e.title === 'string' ? { ...e, title: readableTitle(e.title) } : e)
