// Every adminJobs* key exists in all 9 languages (no English fallback) with the same {placeholder} set as English.
// The key list is read from the English block of constants/i18n.js, not remembered.
import fs from 'fs'
import path from 'path'
import { LANG_CODES, hasOwnTranslation, t } from '../constants/i18n'

const src = fs.readFileSync(path.join(__dirname, '..', 'constants', 'i18n.js'), 'utf8')
const start = src.indexOf('\n  en: {')
const end = src.indexOf('\n  tr: {')
const KEYS = [...src.slice(start, end).matchAll(/^\s{4}(adminJobs\w+):/gm)].map(m => m[1])
const ph = s => (s.match(/\{\w+\}/g) || []).sort().join(',')

test('the English block defines the adminJobs keys the screen uses', () => {
  expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start)
  expect(KEYS.length).toBeGreaterThanOrEqual(31)
  expect(new Set(KEYS).size).toBe(KEYS.length)
})

describe.each(Object.keys(LANG_CODES))('%s', lang => {
  test('has every key itself, non-empty, with English placeholders', () => {
    const missing = KEYS.filter(k => !hasOwnTranslation(k, lang))
    const empty = KEYS.filter(k => !t(k, lang).trim())
    const phDiff = KEYS.filter(k => ph(t(k, lang)) !== ph(t(k, 'English'))).map(k => `${k}: en=[${ph(t(k, 'English'))}] ${lang}=[${ph(t(k, lang))}]`)
    console.log(`${lang}: ${KEYS.filter(k => hasOwnTranslation(k, lang)).length}/${KEYS.length} adminJobs keys`)
    expect({ missing, empty, phDiff }).toEqual({ missing: [], empty: [], phDiff: [] })
  })
})
