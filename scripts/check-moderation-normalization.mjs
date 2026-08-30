#!/usr/bin/env node
// ─── Moderation matcher probe ────────────────────────────────────────────────
//
//   npm run moderation:check
//
// Asserts, against the LIVE database and against the client mirror, that
// contains_blocked_term() behaves. Written BEFORE 20260925_moderation_normalization.sql
// and confirmed RED on every evasion case first — a check nobody has watched fail is a
// decoration, not a check.
//
// WHAT IT PROVES, and why each half is needed:
//
//   1. EVASIONS are caught. Three were live on 2026-08-29, all free to type:
//        • Turkish capital İ — SİKİK and PİÇ went straight through, because
//          lower('İ') is 'i' + U+0307 and that combining mark broke the word boundary.
//          A filter defeated by the shift key.
//        • Zero-width characters — f<ZWNJ>uck, s<ZWNJ>h<ZWNJ>i<ZWNJ>t.
//        • Arabic tatweel — s<tatweel>ik. Tatweel is category Lm, i.e. a *word*
//          character, so it does not even split the token: it just makes the string
//          literally different from the term.
//
//   2. FALSE POSITIVES stay allowed. The same normalization removes one that was live:
//      the<ZWNJ>rapist tokenised as "the" + "rapist" and matched the term `rapist`.
//      The negative controls are real strings lifted from ADA's own constants/i18n.js,
//      because that is the vocabulary we know our users read.
//
//   3. THE EXISTING TERMS STILL WORK. Every row of blocked_terms is fed back through
//      the matcher and must match itself. This is the regression half: normalization
//      that quietly stopped `piç` or `şerefsiz` from matching would otherwise look like
//      a pass, since the evasion cases would still go green.
//
//   4. CLIENT AND SERVER AGREE. Every case above is run through the database AND
//      through utils/moderationNormalize.js, and the two answers must be identical.
//      If they drift, the user is told "looks fine" inline and rejected on submit —
//      the worst outcome, because the rejection then looks arbitrary.
//
// Not in pre-push: it needs the network and the live database. Run it after applying
// the migration, and whenever either side of the mirror changes.

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { matchesAnyTerm, normalizeForModeration } from '../utils/moderationNormalize.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

for (const line of readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
const URL_ = process.env.EXPO_PUBLIC_SUPABASE_URL
const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!URL_ || !KEY) {
  console.error('  missing EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY (.env)')
  process.exit(1)
}

const ZWNJ = '‌', ZWJ = '‍', SHY = '­', TATWEEL = 'ـ', SHADDA = 'ّ'

// ─── Cases ───────────────────────────────────────────────────────────────────
// `expect` is what a CORRECT matcher returns. Controls come first: if `fuck` does not
// block and `hello there friend` does, the probe itself is broken and nothing below it
// means anything.
const CASES = [
  ['fuck',                          true,  'CONTROL — a seeded term must block'],
  ['hello there friend',            false, 'CONTROL — ordinary text must not block'],

  ['SİKİK',                         true,  'EVASION Turkish capital İ'],
  ['PİÇ',                           true,  'EVASION Turkish capital İ'],
  ['Bu ne biçim hizmet, SİKTİR!',   true,  'EVASION İ in a real sentence'],
  [`f${ZWNJ}uck`,                   true,  'EVASION zero-width non-joiner'],
  [`s${ZWNJ}h${ZWNJ}i${ZWNJ}t`,     true,  'EVASION ZWNJ between every letter'],
  [`f${ZWJ}uck`,                    true,  'EVASION zero-width joiner'],
  [`s${SHY}ik`,                     true,  'EVASION soft hyphen'],
  [`s${TATWEEL}ik`,                 true,  'EVASION Arabic tatweel inside the term'],
  [`pi${SHADDA}ç`,                  true,  'EVASION Arabic shadda INSIDE the term (as in تمصّه)'],

  [`the${ZWNJ}rapist`,              false, 'FALSE POSITIVE — ZWNJ split therapist into the+rapist'],
  ['therapist',                     false, 'a therapist is not a rapist'],
  ['Scunthorpe',                    false, 'the classic substring false positive'],
  ['assessment',                    false, 'substring of a seeded term'],
  [`sik${TATWEEL}x`,                false, 'tatweel joins sik to x — normalizes to sikx, a different word'],
  ['sık sık geliyorum',             false, 'Turkish dotless ı — "often". Must NOT fold to sik'],

  // Negative controls lifted verbatim from constants/i18n.js — our own shipped copy.
  ['Bitte wählen Sie eine andere Zeit.',                       false, 'i18n de:7073 — "bitte" is German for please'],
  ['ponte en contacto con nosotros y lo revisaremos de nuevo', false, 'i18n es:6271 — "con" is Spanish for with'],
  ['لا تشقّ الجرح ولا تمصّه',                                    false, 'i18n ar:3269 — snakebite first aid, shadda inside تمصّه'],
  ['هیچ‌کس اینجا نیست',                                          false, 'Persian "nobody" — spelled with a ZWNJ'],
  ['Merhaba, randevu almak istiyorum 123',                     false, 'plain Turkish + digits'],
]

const post = (path, body) => fetch(`${URL_}/rest/v1/${path}`, {
  method: 'POST',
  headers: { apikey: KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}).then(r => r.text())

const server = async text => {
  const raw = await post('rpc/contains_blocked_term', { p_text: text })
  if (raw !== 'true' && raw !== 'false') throw new Error(`unexpected RPC response: ${raw.slice(0, 200)}`)
  return raw === 'true'
}

const show = s => JSON.stringify(s).replace(/\\u200c/gi, '<ZWNJ>').replace(/\\u200d/gi, '<ZWJ>')
  .replace(/\\u00ad/gi, '<SHY>').replace(/\\u0640/gi, '<TATWEEL>').replace(/\\u0651/gi, '<SHADDA>')

const run = async () => {
  const res = await fetch(`${URL_}/rest/v1/blocked_terms?select=term`, { headers: { apikey: KEY } })
  const terms = (await res.json()).map(r => r.term)
  if (!terms.length) throw new Error('blocked_terms came back empty — the probe cannot mean anything')
  console.log(`  blocked_terms: ${terms.length} rows\n`)

  let failed = 0

  console.log('  ── behaviour ──────────────────────────────────────────────────────────')
  for (const [text, expect, why] of CASES) {
    const [srv, cli] = [await server(text), matchesAnyTerm(text, terms)]
    const ok = srv === expect && cli === expect
    if (!ok) failed++
    const tag = srv !== expect && cli !== expect ? 'BOTH'
      : srv !== expect ? 'SERVER'
      : cli !== expect ? 'CLIENT' : ''
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${show(text).padEnd(34)} want=${String(expect).padEnd(5)} db=${String(srv).padEnd(5)} js=${String(cli).padEnd(5)} ${tag.padEnd(7)}${why}`)
  }

  console.log('\n  ── regression: every seeded term still matches itself ─────────────────')
  const broken = []
  for (const t of terms) {
    const [srv, cli] = [await server(t), matchesAnyTerm(t, terms)]
    if (!srv || !cli) broken.push(`${t} (db=${srv} js=${cli})`)
  }
  if (broken.length) {
    failed += broken.length
    console.log(`  FAIL ${broken.length} of ${terms.length} no longer match:`)
    broken.forEach(b => console.log(`         ${b}`))
  } else {
    console.log(`  ok   all ${terms.length} terms still match`)
  }

  console.log('\n  ── client cache headroom ──────────────────────────────────────────────')
  // PostgREST caps a response at max-rows and does NOT say so in the body. utils/
  // profanity.js reads the whole table, so past the cap the client preview silently
  // filters against a partial list. Ask for the exact count and compare it to what
  // arrived — that comparison works at any cap, whereas testing rows >= 1000 would be
  // a truncation guard defeated by truncation.
  const head = await fetch(`${URL_}/rest/v1/blocked_terms?select=term`,
    { headers: { apikey: KEY, Prefer: 'count=exact', Range: '0-' } })
  const total = Number((head.headers.get('content-range') || '/0').split('/')[1])
  if (terms.length < total) {
    failed++
    console.log(`  FAIL client received ${terms.length} of ${total} rows — the cache is TRUNCATED`)
  } else {
    console.log(`  ok   ${total} rows, all delivered — ${1000 - total} rows of headroom below PostgREST max-rows`)
  }

  console.log(`\n  normalizeForModeration('SİKİK') = ${JSON.stringify(normalizeForModeration('SİKİK'))}`)
  if (failed) {
    console.error(`\n  ${failed} FAILING — the matcher does not behave as specified.\n`)
    process.exit(1)
  }
  console.log('\n  PASS — evasions blocked, false positives allowed, client and server agree.\n')
}

run().catch(e => { console.error(`  probe error: ${e.message}`); process.exit(1) })
