#!/usr/bin/env node
// admin-push duty-swap text: supabase/functions/admin-push/strings.mjs must equal notifDutySwapTitle / notifDutySwapBody
// in constants/i18n.js, character for character, for every language in LANGUAGES. t() falls back to English silently,
// so a language the dictionary lacks is read with hasOwnTranslation and fails loudly here.
//   node scripts/check-admin-push-strings.mjs [--root <dir>]    (--root: a copy of the repo layout, for the red-first proof)
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const rootArg = process.argv.indexOf('--root')
const root = rootArg > -1 ? resolve(process.argv[rootArg + 1]) : resolve(new URL('..', import.meta.url).pathname)
const { LANGUAGES, t, hasOwnTranslation } = await import(pathToFileURL(resolve(root, 'constants/i18n.js')).href + `?v=${Date.now()}`)
const { DUTY_SWAP, dutySwapText } = await import(pathToFileURL(resolve(root, 'supabase/functions/admin-push/strings.mjs')).href + `?v=${Date.now()}`)

const problems = []
const langs = LANGUAGES.map(l => l.key)
for (const lang of langs) {
  for (const [field, key] of [['title', 'notifDutySwapTitle'], ['body', 'notifDutySwapBody']]) {
    if (!hasOwnTranslation(key, lang)) { problems.push(`${lang}: constants/i18n.js has no own ${key}`); continue }
    const want = t(key, lang), got = DUTY_SWAP[lang]?.[field]
    if (got !== want) problems.push(`${lang} ${field}: strings.mjs ${JSON.stringify(got)} differs from i18n ${JSON.stringify(want)}`)
  }
}
for (const extra of Object.keys(DUTY_SWAP)) if (!langs.includes(extra)) problems.push(`strings.mjs has ${extra}, which is not a LANGUAGES key`)
if (dutySwapText('Klingon') !== DUTY_SWAP.English || dutySwapText(null) !== DUTY_SWAP.English || dutySwapText(undefined) !== DUTY_SWAP.English) {
  problems.push('an unknown or null language must fall back to English')
}
if (problems.length) {
  console.error('admin-push strings check FAILED:')
  for (const p of problems) console.error('  ✗ ' + p)
  process.exit(1)
}
console.log(`admin-push strings check: OK (${langs.length} languages x title+body identical to constants/i18n.js, unknown language falls back to English)`)
