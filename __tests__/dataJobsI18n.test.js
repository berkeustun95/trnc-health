// The admin area is English-only (constants/adminLang.js): every adminJobs* key needs a non-empty English value.
// A locale that still has the key (kept, unused) must keep the same {placeholder} set as English.
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

test('English has every key, non-empty', () => {
  expect(KEYS.filter(k => !hasOwnTranslation(k, 'English') || !t(k, 'English').trim())).toEqual([])
})

describe.each(Object.keys(LANG_CODES))('%s', lang => {
  test('keeps English placeholders on the keys it has', () => {
    const own = KEYS.filter(k => hasOwnTranslation(k, lang))
    const phDiff = own.filter(k => ph(t(k, lang)) !== ph(t(k, 'English'))).map(k => `${k}: en=[${ph(t(k, 'English'))}] ${lang}=[${ph(t(k, lang))}]`)
    expect(phDiff).toEqual([])
  })
})
