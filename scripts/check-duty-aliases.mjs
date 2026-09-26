#!/usr/bin/env node
// ─── Duty roster name aliases ────────────────────────────────────────────────
//
//   node scripts/check-duty-aliases.mjs          # the REAL matcher against fixtures; no network
//   node scripts/check-duty-aliases.mjs --live   # …and every alias target exists in live facilities
//
// KTEB respelled nine pharmacies in the 2026-27 roster. utils/dutyFacilityMatch.js maps each
// back to its facilities row so the card can show a distance. This asserts, through the
// module the screen imports rather than a copy:
//   1. each respelled name, in its own region, resolves to its facilities name;
//   2. the same name in ANY OTHER region resolves to nothing — the region gate is what stops
//      a same-named pharmacy elsewhere borrowing a pin, and a pin in the wrong town is the
//      one failure worse than no distance at all;
//   3. an exact name still matches directly (the aliases did not break the ordinary path).
// --live adds: 4. every alias target is a real pharmacy row today, and prints whether it
// carries coordinates (a matched row without them still shows no distance).

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFacilityIndex, matchDutyRow } from '../utils/dutyFacilityMatch.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const EXPECTED = [
  ['AYDIN LİFE ECZANESİ',         'Girne',      'AYDIN LIFE ECZANESİ'],
  ['AYDINLİFE ALSANCAK ECZANESİ', 'Girne',      'AYDIN LIFE ALSANCAK ECZANESİ'],
  ['GÖKÇEN İLKTAÇ ECZANESİ',      'Gazimağusa', 'GÖKCEN İLKTAÇ ECZANESİ'],
  ['ILGEN ECZANESİ',              'Girne',      'İLGEN ECZANESİ'],
  ['KAPTANCAN ECZANESİ',          'Lefkoşa',    'KAPTAN CAN ECZANESİ'],
  ['MEHMET GAZİ KÖYLÜ ECZANESİ',  'Girne',      'MEHMET GAZİKÖYLÜ ECZANESİ'],
  ['SAKINER ECZANESİ',            'Karpaz',     'SAKİNER ECZANESİ'],
  ['ŞİFA BİLDİR ECZANESİ',        'Lefke',      'ŞİFA BILDIR ECZANESİ'],
  ['HÜSEYİN SAKALLI ECZANESİ',    'Lefkoşa',    'HÜSEYİN KERİM SAKALLI ECZANESİ'],
]
const REGIONS = ['Lefkoşa', 'Gazimağusa', 'Girne', 'Güzelyurt', 'İskele', 'Lefke', 'Karpaz', 'Üst Mesarya', 'Alt Mesarya']

const red = s => `\x1b[31m${s}\x1b[0m`, green = s => `\x1b[32m${s}\x1b[0m`
const fails = []

const index = buildFacilityIndex(EXPECTED.map(([, , to]) => ({ name: to, latitude: 35, longitude: 33 })))
for (const [from, region, to] of EXPECTED) {
  const hit = matchDutyRow({ name: from, region }, index)
  if (hit?.name !== to) fails.push(`${from} (${region}) → ${hit?.name ?? 'null'}, expected ${to}`)
  for (const other of REGIONS.filter(r => r !== region)) {
    const wrong = matchDutyRow({ name: from, region: other }, index)
    if (wrong) fails.push(`${from} in ${other} resolved to ${wrong.name} — the region gate is open`)
  }
  const direct = matchDutyRow({ name: to, region }, index)
  if (direct?.name !== to) fails.push(`exact name ${to} no longer matches directly (got ${direct?.name ?? 'null'})`)
}

if (process.argv.includes('--live')) {
  if (existsSync(resolve(ROOT, '.env'))) {
    for (const line of readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/)
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
  }
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } })
  const { error: authErr } = await sb.auth.signInWithPassword({
    email: process.env.ADA_TEST_EMAIL, password: process.env.ADA_TEST_PASSWORD })
  if (authErr) { console.error(red(`sign-in failed: ${authErr.message}`)); process.exit(1) }
  const { data, error } = await sb.from('facilities').select('name, latitude, longitude')
    .eq('type', 'pharmacy').in('name', EXPECTED.map(([, , to]) => to))
  if (error) { console.error(red(`facilities read failed: ${error.message}`)); process.exit(1) }
  const live = buildFacilityIndex(data)
  for (const [from, region, to] of EXPECTED) {
    const hit = matchDutyRow({ name: from, region }, live)
    if (!hit) { fails.push(`LIVE: ${from} → no facilities row named ${to}`); continue }
    console.log(`  ${from.padEnd(30)} → ${to.padEnd(32)} ${hit.latitude != null ? 'coords' : 'NO COORDS (no distance)'}`)
  }
}

if (fails.length) {
  console.error(red(`duty aliases: ${fails.length} failure(s)`))
  for (const f of fails) console.error(red(`  ✗ ${f}`))
  process.exit(1)
}
console.log(green(`duty aliases: OK — ${EXPECTED.length} aliases resolve in their region and nowhere else`))
