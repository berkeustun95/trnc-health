#!/usr/bin/env node
// ─── Live Novest listings with zero photos — daily-health ────────────────────
//
//   node scripts/check-novest-photos.mjs          # needs the service key: run in CI (daily-health)
//   node scripts/check-novest-photos.mjs --self   # offline: the threshold rule only
//
// Read-only. A live listing (source='novest', status='active') with no property_images
// row is HIDDEN from users by the RESTRICTIVE policy props_hide_photoless_novest (20261068)
// and comes back on its own once a photo row exists. This check lists the hidden ones and
// ALSO proves the policy is still doing it: an anon client must see exactly live − hidden.
// If the policy is ever dropped, photo-less cards reappear and this goes red. Some can never have one — the partner's own
// media 404 (novest-20111: all six references dead) — so a FEW are expected and are
// listed as a ::warning::, not a failure. The run FAILS only when more than 10% of live
// listings have none: that is a mirror pass that stopped running (novest-images is
// manual; sync-novest adds listings without images), not a partner gap.
//
// Paged with count:'exact' compared to rows received: property_images is ~850 rows and
// PostgREST's max-rows (1000) would truncate a single read silently.

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serviceRoleKey } from './lib/prod-write-guard.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const MAX_SHARE = 0.10
export const verdict = (without, live) => live > 0 && without / live > MAX_SHARE ? 'fail' : without ? 'warn' : 'ok'

if (process.argv.includes('--self')) {
  let bad = 0
  const t = (label, got, want) => { const ok = got === want; if (!ok) bad++; console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(36)} ${got}${ok ? '' : `  wanted ${want}`}`) }
  t('0 of 87 → ok', verdict(0, 87), 'ok')
  t('1 of 87 (the known 404) → warn', verdict(1, 87), 'warn')
  t('8 of 87 (9.2%) → warn', verdict(8, 87), 'warn')
  t('9 of 87 (10.3%) → fail', verdict(9, 87), 'fail')
  t('19 of 87 (a stalled mirror) → fail', verdict(19, 87), 'fail')
  t('10 of 100 (exactly 10%) → warn', verdict(10, 100), 'warn')
  t('0 live → ok, no division by zero', verdict(0, 0), 'ok')
  console.log(bad ? `\n  ${bad} self-test failure(s).` : '\n  Self-test clean.')
  process.exit(bad ? 1 : 0)
}

if (existsSync(resolve(ROOT, '.env'))) {
  for (const line of readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}
const { createClient } = await import('@supabase/supabase-js')
const sb = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, serviceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } })

async function all(table, select, filter = q => q) {
  const out = []
  let total = null
  for (let from = 0; ; from += 500) {
    const { data, error, count } = await filter(sb.from(table).select(select, { count: 'exact' })).order('id').range(from, from + 499)
    if (error) { console.error(`read ${table} failed: ${error.message}`); process.exit(2) }
    total = count
    out.push(...data)
    if (data.length < 500) break
  }
  if (out.length !== total) { console.error(`read ${out.length} of ${total} ${table} rows — refusing to judge a partial set`); process.exit(2) }
  return out
}

const live = await all('properties', 'id,external_id,title', q => q.eq('source', 'novest').eq('status', 'active'))
const ids = new Set((await all('property_images', 'property_id')).map(r => r.property_id))
const without = live.filter(p => !ids.has(p.id))
// The rule, observed from outside: what an app user (anon key, RLS applies) can see.
const anon = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const { count: visible, error: ve } = await anon.from('properties').select('id', { count: 'exact', head: true }).eq('source', 'novest').eq('status', 'active')
if (ve) { console.error(`anon read failed: ${ve.message}`); process.exit(2) }
const v = verdict(without.length, live.length)
const pct = live.length ? (100 * without.length / live.length).toFixed(1) : '0.0'

console.log(`Novest photos: ${live.length} live listing(s), ${without.length} with no photo (${pct}%, fail above ${MAX_SHARE * 100}%)`)
console.log(`  app users see ${visible} — expected ${live.length - without.length} (the ${without.length} without a photo are hidden)`)
for (const p of without) console.log(`  · ${p.external_id}  ${p.title}`)
if (without.length) {
  const esc = s => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
  console.log(`::warning title=Novest listings hidden (no photo)::` + esc(`${without.length} of ${live.length} live listing(s) have no photo and are HIDDEN from users until one is mirrored: ` +
    without.map(p => `${p.external_id} (${p.title})`).join('; ')))
}
if (visible !== live.length - without.length) {
  console.error(`\n✗ app users see ${visible} live Novest listings, expected ${live.length - without.length}: the hide rule (props_hide_photoless_novest) is not in effect.`)
  process.exit(1)
}
if (v === 'fail') {
  console.error(`\n✗ ${pct}% of live Novest listings have no photo — more than ${MAX_SHARE * 100}%. Run: gh workflow run novest-images -f apply=true`)
  process.exit(1)
}
console.log(v === 'ok' ? '✓ every live listing has a photo.' : '✓ within tolerance (the partner\'s own dead media).')
