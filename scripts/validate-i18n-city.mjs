// Coverage check for the city-welcome i18n keys.
// Run:  node scripts/validate-i18n-city.mjs
//
// t() falls back to English, which is a safety net and also a way to ship a
// half-translated locale without noticing. This asserts the real thing: every
// cw* key exists in all 9 locales, no key is silently English, and every {city}
// placeholder survived translation — a dropped placeholder means the card renders
// "Welcome to !".

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

import { tCity, LANG_CODES } from '../constants/i18n.js'
import { REGIONS } from '../constants/regions.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(ROOT, 'constants/i18n.js'), 'utf8')

const LOCALES = ['en', 'tr', 'ar', 'ru', 'el', 'fr', 'es', 'de', 'fa']
const RTL = new Set(['ar', 'fa'])
// tCity takes the language NAME ('Turkish'), not the code.
const NAME_OF = Object.fromEntries(Object.entries(LANG_CODES).map(([name, code]) => [code, name]))

// Slice each locale block out of the file and pull its cw* keys.
const bounds = []
src.split('\n').forEach((l, i) => {
  const m = l.match(/^ {2}([a-z]{2}): \{$/)
  if (m) bounds.push({ code: m[1], line: i })
})

const lines = src.split('\n')
const byLocale = {}
bounds.forEach((b, n) => {
  const end = n + 1 < bounds.length ? bounds[n + 1].line : lines.length
  const block = lines.slice(b.line, end)
  const keys = {}
  for (const l of block) {
    // Values are single-quoted, except the English ones containing an apostrophe
    // ("What's on"), which are double-quoted. Accept both.
    const m = l.match(/^ {4}(cw[A-Za-z]+):\s*(['"])(.*)\2,$/)
    if (m) keys[m[1]] = m[3]
  }
  byLocale[b.code] = keys
})

const enKeys = Object.keys(byLocale.en ?? {})
const fails = []

console.log('\n' + '-'.repeat(78))
console.log('CITY WELCOME — i18n COVERAGE')
console.log('-'.repeat(78) + '\n')
console.log(`  ${enKeys.length} cw* keys defined in English\n`)

// A key that names a city in English must still name one in every locale — but
// not necessarily via {city}. Turkish inflects the place name, so its templates
// carry {cityDat} / {cityLoc} / {cityLocCop} instead. What must never happen is a
// translation dropping the city ENTIRELY, which renders "Welcome to !".
const CITY_PLACEHOLDER = /\{city(Dat|Loc|LocCop)?\}/
const withCity = enKeys.filter(k => CITY_PLACEHOLDER.test(byLocale.en[k]))

for (const code of LOCALES) {
  const keys = byLocale[code] ?? {}
  const missing = enKeys.filter(k => !(k in keys))
  const extra = Object.keys(keys).filter(k => !enKeys.includes(k))

  // A value byte-identical to English is almost always an untranslated stub. A
  // few are legitimately identical across languages (proper nouns), so this is
  // reported, not failed — except that it must never be a whole locale.
  const identical = code === 'en' ? [] : enKeys.filter(k => keys[k] === byLocale.en[k])
  const lostCity = withCity.filter(k => keys[k] && !CITY_PLACEHOLDER.test(keys[k]))

  const ok = !missing.length && !extra.length && !lostCity.length
  if (missing.length) fails.push(`${code}: missing ${missing.join(', ')}`)
  if (extra.length) fails.push(`${code}: has keys English does not: ${extra.join(', ')}`)
  if (lostCity.length) fails.push(`${code}: {city} placeholder LOST in ${lostCity.join(', ')}`)
  if (code !== 'en' && identical.length > enKeys.length / 2) {
    fails.push(`${code}: ${identical.length}/${enKeys.length} values identical to English — locale looks untranslated`)
  }

  console.log(
    `  ${ok ? 'OK  ' : 'FAIL'} ${code}${RTL.has(code) ? ' (RTL)' : '    '}  ` +
    `${String(Object.keys(keys).length).padStart(2)}/${enKeys.length} keys` +
    `  city in ${withCity.filter(k => keys[k] && CITY_PLACEHOLDER.test(keys[k])).length}/${withCity.length}` +
    (identical.length ? `  · ${identical.length} same-as-English` : '')
  )
  if (missing.length) console.log(`       missing: ${missing.join(', ')}`)
  if (lostCity.length) console.log(`       {city} lost in: ${lostCity.join(', ')}`)
}

// --- the Turkish cityForms table --------------------------------------------
//
// tr is the one locale that inflects the place name, so it ships pre-inflected
// forms. A region missing from the table degrades to the bare label — grammatical
// nonsense that would ship silently. Assert full coverage instead.
const FORMS = ['dat', 'loc', 'locCop']
console.log('\n' + '-'.repeat(78))
console.log('\n[2] TURKISH cityForms — 7 regions x 3 inflections\n')

const trBlock = (() => {
  const b = bounds.find(x => x.code === 'tr')
  const n = bounds.indexOf(b)
  const end = n + 1 < bounds.length ? bounds[n + 1].line : lines.length
  return lines.slice(b.line, end).join('\n')
})()

for (const r of REGIONS) {
  const m = trBlock.match(new RegExp(`^\\s*${r}:\\s*\\{(.*)\\},`, 'm'))
  const missing = m ? FORMS.filter(f => !new RegExp(`\\b${f}:`).test(m[1])) : FORMS
  const ok = !!m && !missing.length
  if (!ok) fails.push(`tr.cityForms.${r}: ${m ? `missing ${missing.join(', ')}` : 'ABSENT'}`)
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${r.padEnd(10)} ${m ? m[1].trim() : 'ABSENT'}`)
}

// --- render everything ------------------------------------------------------
//
// The real check. Every cw* string, in every locale, for every region — then
// assert nothing has a leftover "{...}". An unsubstituted {cityLocCop} on a card
// is the one way this mechanism can fail visibly, so make it unshippable.
console.log('\n' + '-'.repeat(78))
console.log(`\n[3] RENDER — ${enKeys.length} keys x ${LOCALES.length} locales x ${REGIONS.length} regions\n`)

let rendered = 0
const leftovers = []
for (const code of LOCALES) {
  const lang = NAME_OF[code]
  for (const region of REGIONS) {
    for (const key of enKeys) {
      const out = tCity(key, region, lang)
      rendered++
      if (typeof out !== 'string' || /\{[a-zA-Z]+\}/.test(out)) {
        leftovers.push(`${code}/${region}/${key} -> ${out}`)
      }
    }
  }
}
for (const l of leftovers) fails.push(`unsubstituted placeholder: ${l}`)
console.log(`  ${rendered} strings rendered, ${leftovers.length} with an unsubstituted placeholder` +
  (leftovers.length ? '  <-- FAIL' : '  OK'))

// Show the Turkish flagship line for every region — this is the string the whole
// table exists for, so print it and let a human read it.
console.log('\n  Turkish, rendered:')
for (const region of REGIONS) {
  console.log(`    ${region.padEnd(10)} ${tCity('cwWelcomeTitle', region, 'Turkish')}`)
  console.log(`    ${''.padEnd(10)} ${tCity('cwNudgeTitle', region, 'Turkish')}`)
  console.log(`    ${''.padEnd(10)} ${tCity('cwEventsFiltered', region, 'Turkish')}`)
}

console.log('\n' + '-'.repeat(78))
if (fails.length) {
  console.log(`\n${fails.length} FAILURE(S)\n`)
  for (const f of fails) console.log(`  ! ${f}`)
  console.log()
  process.exit(1)
}
console.log('\nRESULT: clean — all keys present in all 9 locales, every {city} preserved.\n')
