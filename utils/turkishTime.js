// "00.00'a kadar" — the Turkish dative suffix on a clock time.
//
// The suffix follows the SPOKEN time, not the digits: the last number word read aloud. With
// non-zero minutes that is the minute word ("19.30" → "on dokuz otuz" → otuz → 'a); on the
// hour it is the hour word ("20.00" → "yirmi" → 'ye; "00.00" → "sıfır" → 'a).
//
// Dative: back vowel (a ı o u) → a, front (e i ö ü) → e; a word ending in a vowel takes the
// buffer y (yirmi → 'ye, altı → 'ya). Tested for every hour 00–23 on :00 and :30 by
// scripts/test-turkish-time.mjs (npm run trtime:test).
const UNITS = ['sıfır', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz']
const TENS  = { 1: 'on', 2: 'yirmi', 3: 'otuz', 4: 'kırk', 5: 'elli' }

// The last word read aloud for 0–59.
export function lastNumberWord(n) {
  if (n === 0) return UNITS[0]
  if (n % 10 !== 0) return UNITS[n % 10]
  return TENS[n / 10]
}

const BACK = 'aıou', FRONT = 'eiöü', VOWELS = BACK + FRONT

export function dativeSuffix(word) {
  const letters = [...word]
  const lastVowel = [...letters].reverse().find(c => VOWELS.includes(c))
  const v = BACK.includes(lastVowel) ? 'a' : 'e'
  return VOWELS.includes(letters[letters.length - 1]) ? `y${v}` : v
}

// "20:00" | "20:00:00" | "20.00" → "20.00'ye kadar". Null for anything unparseable.
export function untilTr(time) {
  const m = /^(\d{1,2})[:.](\d{2})/.exec(String(time ?? ''))
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  if (h > 23 || min > 59) return null
  const clock = `${String(h).padStart(2, '0')}.${m[2]}`
  const word = lastNumberWord(min !== 0 ? min : h)
  return `${clock}'${dativeSuffix(word)} kadar`
}
