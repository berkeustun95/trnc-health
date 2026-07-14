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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(ROOT, 'constants/i18n.js'), 'utf8')

const LOCALES = ['en', 'tr', 'ar', 'ru', 'el', 'fr', 'es', 'de', 'fa']
const RTL = new Set(['ar', 'fa'])

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

// Keys that carry a {city} placeholder in English must carry it everywhere.
const withCity = enKeys.filter(k => byLocale.en[k].includes('{city}'))

for (const code of LOCALES) {
  const keys = byLocale[code] ?? {}
  const missing = enKeys.filter(k => !(k in keys))
  const extra = Object.keys(keys).filter(k => !enKeys.includes(k))

  // A value byte-identical to English is almost always an untranslated stub. A
  // few are legitimately identical across languages (proper nouns), so this is
  // reported, not failed — except that it must never be a whole locale.
  const identical = code === 'en' ? [] : enKeys.filter(k => keys[k] === byLocale.en[k])
  const lostCity = withCity.filter(k => keys[k] && !keys[k].includes('{city}'))

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
    `  {city} in ${withCity.filter(k => keys[k]?.includes('{city}')).length}/${withCity.length}` +
    (identical.length ? `  · ${identical.length} same-as-English` : '')
  )
  if (missing.length) console.log(`       missing: ${missing.join(', ')}`)
  if (lostCity.length) console.log(`       {city} lost in: ${lostCity.join(', ')}`)
}

console.log('\n' + '-'.repeat(78))
if (fails.length) {
  console.log(`\n${fails.length} FAILURE(S)\n`)
  for (const f of fails) console.log(`  ! ${f}`)
  console.log()
  process.exit(1)
}
console.log('\nRESULT: clean — all keys present in all 9 locales, every {city} preserved.\n')
