#!/usr/bin/env node
// ─── Google calls stay anonymous (Berke, 2026-10-08) ─────────────────────────
//
//   node scripts/check-google-calls-anonymous.mjs          # pre-push
//   node scripts/check-google-calls-anonymous.mjs --self   # prove both rules can fail
//
// Closing the Maps ToS §4.4(c)(ii) question rests on two facts about what reaches Google from
// supabase/functions/google-places/index.ts (vault: store-privacy-forms file, "§4.4 CLOSED"):
//   1. NO USER IDENTIFIER in any Google request — no uid, token, email, name or profile field.
//   2. The nearby centre is ROUNDED to 4 decimals (~10 m), the precision the policy states.
// Reads the function as TEXT: every argument passed to the one `google(` helper, and the helper
// itself, must not mention an identifier; the nearby body must centre on r4(...) with r4 = 1e4.
// The behaviour is tested too (scripts/test-google-places-edge.ts scans every captured request);
// this is the guard that runs on every push.
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../supabase/functions/google-places/index.ts')
const IDENT = /\b(user|uid|user_id|userId|jwt|token|email|display_?name|full_?name|profile|session|auth)\b/i

function balanced(src, open) {            // the text between `open`'s '(' and its matching ')'
  let d = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') d++
    else if (src[i] === ')' && --d === 0) return src.slice(open + 1, i)
  }
  return null
}
// Literal text is Google's vocabulary (field masks say 'displayName'); only CODE can carry a
// user's data. So quoted strings are blanked, and a template literal keeps only its ${...} parts.
function codeOnly(s) {
  return s.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, "''")
          .replace(/`(?:[^`\\]|\\.)*`/g, m => (m.match(/\$\{[^}]*\}/g) || []).join(' '))
}
export function check(src) {
  const code = src.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
  const bad = []
  const def = code.match(/async function google\(([^)]*)\)\s*\{([\s\S]*?)\n\}/)
  if (!def) bad.push('the google() helper was not found — this guard would be checking nothing')
  else if (IDENT.test(codeOnly(def[1] + def[2]))) bad.push(`google() helper mentions an identifier: ${codeOnly(def[1] + def[2]).match(IDENT)[0]}`)
  const calls = [...code.matchAll(/\bgoogle\(/g)].map(m => m.index).filter(i => !/function $/.test(code.slice(i - 9, i)))
  if (calls.length < 3) bad.push(`expected >= 3 google(...) calls (nearby, details, checkin, refresh), found ${calls.length}`)
  for (const i of calls) {
    const args = balanced(code, i + 'google'.length) ?? ''
    const hit = codeOnly(args).match(IDENT)
    if (hit) bad.push(`a google(...) call passes "${hit[0]}": ${args.replace(/\s+/g, ' ').slice(0, 120)}`)
  }
  if (!/const r4 = \(n: number\) => Math\.round\(n \* 1e4\) \/ 1e4/.test(code)) bad.push('r4 is not Math.round(n * 1e4) / 1e4')
  if (!/center: \{ latitude: r4\(lat\), longitude: r4\(lng\) \}/.test(code)) bad.push('the nearby centre is not r4(lat), r4(lng)')
  return bad
}

if (process.argv.includes('--self')) {
  const src = readFileSync(FILE, 'utf8')
  const cases = [
    ['user id in the nearby body', src.replace("rankPreference: 'DISTANCE',", "rankPreference: 'DISTANCE', note: user.id,")],
    ['email in a details URL', src.replace('`/places/${id}?languageCode=${languageCode}`', '`/places/${id}?languageCode=${languageCode}&e=${user.email}`')],
    ['unrounded centre', src.replace('latitude: r4(lat), longitude: r4(lng)', 'latitude: lat, longitude: lng')],
    ['coarser constant changed to 1e6', src.replace('Math.round(n * 1e4) / 1e4', 'Math.round(n * 1e6) / 1e6')],
  ]
  let ok = check(src).length === 0
  console.log(`  ${ok ? '✓' : '✗'} the real file passes`)
  for (const [name, mutated] of cases) {
    const landed = mutated !== src, red = check(mutated).length > 0
    console.log(`  ${landed && red ? '✓' : '✗'} ${name}: mutation ${landed ? 'landed' : 'DID NOT LAND'}, guard ${red ? 'red' : 'GREEN'}`)
    ok = ok && landed && red
  }
  process.exit(ok ? 0 : 1)
}
const bad = check(readFileSync(FILE, 'utf8'))
if (bad.length) { console.error('google-places: a Google call is not anonymous / not rounded:\n  ' + bad.join('\n  ')); process.exit(1) }
console.log('google-places: Google calls carry no user identifier; nearby centre rounded to 4 dp')
