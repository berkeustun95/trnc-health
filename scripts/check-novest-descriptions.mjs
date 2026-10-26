#!/usr/bin/env node
// ─── Novest listing text: no contact data stored — daily-health ──────────────
//
//   node scripts/check-novest-descriptions.mjs          # needs the service key: run in CI (daily-health)
//   node scripts/check-novest-descriptions.mjs --self   # offline: planted fixtures through the same scanner
//
// Read-only. The import strips a partner's phone / e-mail / WhatsApp from listing text
// BEFORE storing and refuses a row that still carries one (novest-feed.mjs). This is the
// check on the STORED result: it reads every source='novest' row, in ALL statuses (a
// delisted row is still a stored row), and applies the exact detectors the importer uses.
//
//   RED (exit 1)      phone, e-mail, WhatsApp link, or a name:value contact line in a stored column
//   ::warning::       a contact MARKER (İletişim, Bilgi için, Detaylı bilgi) and nothing else:
//                     can be an ordinary sentence, but it is where the old strip cut
//
// Columns scanned: title, description, amenities (text[], joined), source_url. Those are
// every column the importer fills from the partner's free text or URL.
//
// The Actions log of this public repo is public: output is KIND + external_id + column +
// length. Never the matched text, never a title.
//
// A runtime positive control runs before prod is read: planted literals of every kind must
// be flagged, or the run exits 1 — a scanner that finds nothing must not read as clean.
// Paged with count:'exact' compared to rows received (PostgREST max-rows).

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { contactKinds, CONTACT_MARKER } from '../supabase/functions/_shared/novest-feed.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const COLUMNS = ['title', 'description', 'amenities', 'source_url']
const KINDS = ['phone', 'email', 'whatsapp', 'contact-line']

const asText = v => Array.isArray(v) ? v.join('\n') : String(v ?? '')

// [{ kind, id, column, length }] — no matched text anywhere in the result.
export function scanRow(row) {
  const out = []
  for (const column of COLUMNS) {
    const text = asText(row[column])
    for (const kind of contactKinds(text)) out.push({ kind, id: row.external_id, column, length: text.length })
    if (CONTACT_MARKER.test(text)) out.push({ kind: 'marker', id: row.external_id, column, length: text.length })
  }
  return out
}

const PLANTED = {
  phone: 'Hemen arayın 0500 000 00 01 numaradan',
  email: 'yazın ad.soyad@example.com adresinden',
  whatsapp: 'yazın wa.me/message/ABCDEF şimdi',
  'contact-line': 'Güzel daire\nAd Soyad : 0500 000 00 01',
}

// Every contact kind must be seen in its planted literal, and clean text must stay clean.
export function positiveControl() {
  const bad = []
  for (const k of KINDS) {
    if (!scanRow({ external_id: 'plant', description: PLANTED[k] }).some(f => f.kind === k)) bad.push(`${k} not flagged`)
  }
  if (!scanRow({ external_id: 'plant', description: 'Bilgi için ofisimiz açık.' }).some(f => f.kind === 'marker')) bad.push('marker not flagged')
  if (scanRow({ external_id: 'plant', title: 'Girne 2+1 Daire', description: 'Banyo Sayısı : 2\nSite Fasiliteleri :\n£250.000', amenities: ['Havuz'], source_url: 'https://example.com/x' }).length) bad.push('clean text flagged')
  return bad
}

if (process.argv.includes('--self')) {
  let bad = 0
  const t = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) bad++; console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(44)} ${JSON.stringify(got)}${ok ? '' : `  wanted ${JSON.stringify(want)}`}`) }
  const kinds = row => scanRow({ external_id: 'novest-1', ...row }).map(f => `${f.kind}:${f.column}`)
  t('phone in description', kinds({ description: PLANTED.phone }), ['phone:description'])
  t('phone in title', kinds({ title: PLANTED.phone }), ['phone:title'])
  t('e-mail in description', kinds({ description: PLANTED.email }), ['email:description'])
  t('whatsapp in description', kinds({ description: PLANTED.whatsapp }), ['whatsapp:description'])
  t('contact line in description', kinds({ description: PLANTED['contact-line'] }), ['phone:description', 'contact-line:description'])
  t('phone in an amenity', kinds({ amenities: ['Havuz', PLANTED.phone] }), ['phone:amenities'])
  t('whatsapp in source_url', kinds({ source_url: 'https://wa.me/message/ABCDEF' }), ['whatsapp:source_url'])
  t('marker only', kinds({ description: 'Bilgi için ofisimiz açık.' }), ['marker:description'])
  t('feature labels stay clean', kinds({ description: 'Banyo Sayısı : 2\nMutfak Dolapları :\nSite Fasiliteleri :' }), [])
  t('null columns stay clean', kinds({ title: null, description: null, amenities: null }), [])
  t('report carries no matched text', JSON.stringify(scanRow({ external_id: 'novest-1', description: PLANTED.phone })).includes('0500'), false)
  t('positive control passes', positiveControl(), [])
  console.log(bad ? `\n  ${bad} self-test failure(s).` : '\n  Self-test clean.')
  process.exit(bad ? 1 : 0)
}

const control = positiveControl()
if (control.length) { console.error(`✗ positive control failed (${control.join('; ')}) — the scanner cannot see what it must; not reading prod.`); process.exit(1) }
console.log(`positive control: all ${KINDS.length} contact kinds + marker flagged on planted literals, clean text stays clean`)

if (existsSync(resolve(ROOT, '.env'))) {
  for (const line of readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}
const { serviceRoleKey } = await import('./lib/prod-write-guard.mjs')
const { createClient } = await import('@supabase/supabase-js')
const sb = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, serviceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } })

const rows = []
let total = null
for (let from = 0; ; from += 500) {
  const { data, error, count } = await sb.from('properties').select(['external_id', 'status', ...COLUMNS].join(','), { count: 'exact' })
    .eq('source', 'novest').order('id').range(from, from + 499)
  if (error) { console.error(`read properties failed: ${error.message}`); process.exit(2) }
  total = count
  rows.push(...data)
  if (data.length < 500) break
}
if (rows.length !== total) { console.error(`read ${rows.length} of ${total} novest rows — refusing to judge a partial set`); process.exit(2) }
if (rows.length === 0) { console.error('0 novest rows — this table cannot legitimately be empty; refusing to call it clean'); process.exit(2) }

const byStatus = {}
for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1
console.log(`Novest text: scanned ${rows.length} of ${total} row(s) (${Object.entries(byStatus).map(([s, n]) => `${s} ${n}`).join(', ')}) x ${COLUMNS.length} column(s): ${COLUMNS.join(', ')}`)

const findings = rows.flatMap(scanRow)
const red = findings.filter(f => f.kind !== 'marker')
const markers = findings.filter(f => f.kind === 'marker')
for (const f of findings) console.log(`  · ${f.kind.padEnd(12)} ${f.id}  ${f.column} (length ${f.length})`)
if (markers.length) console.log(`::warning title=Novest contact marker in stored text::${markers.length} stored column(s) contain a contact marker word with no contact data (ids in the log above)`)
if (red.length) {
  console.error(`\n✗ ${red.length} stored column(s) carry contact data (kinds: ${[...new Set(red.map(f => f.kind))].join(', ')}). See the ids above; fix in the importer, then re-sync the listing.`)
  process.exit(1)
}
console.log(markers.length ? '✓ no contact data stored (marker words only).' : '✓ no contact data stored.')
