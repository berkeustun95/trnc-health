#!/usr/bin/env node
// HotelRunner booking links → hotels.hotelrunner_url (20261083), from the committed
// data/kitob/hotelrunner-links.json. The file is the source of truth: a hotel listed there gets
// its link (+ ADA's partner ID once HotelRunner sends one), and a hotel NOT listed has its link
// CLEARED, so removing a line removes the "Rezervasyon Yap" button. The KITOB importer never
// sends this column, so a re-import cannot wipe it.
//
//   node scripts/apply-hotelrunner-links.mjs --check   # the file alone: shape, hosts, URLs (no network)
//   node scripts/apply-hotelrunner-links.mjs --dry     # + reads prod, prints set / clear / unchanged
//   node scripts/apply-hotelrunner-links.mjs --apply   # writes (CI only): gh workflow run hotelrunner-links -f mode=--apply
//
// Refuses the whole run on: a name that matches no hotel, a host not in allowed_hosts, a link
// the database CHECK would refuse (https, no whitespace, ≤ 2048), or a partner id without a param.
import { readFileSync, existsSync } from 'node:fs'
import { prodWriteGuard, serviceRoleKey } from './lib/prod-write-guard.mjs'
import { withParams } from '../utils/hotelBooking.js'
process.chdir(new URL('..', import.meta.url).pathname)
const mode = process.argv[2]
if (!['--check', '--dry', '--apply'].includes(mode) || process.argv.length > 3) throw new Error('exactly one of --check | --dry | --apply')
prodWriteGuard({ wouldWrite: mode === '--apply', workflow: 'hotelrunner-links', dryHint: 'node scripts/apply-hotelrunner-links.mjs --check' })

const FILE = 'data/kitob/hotelrunner-links.json'
const cfg = JSON.parse(readFileSync(FILE, 'utf8'))
const fail = m => { console.error(`REFUSED: ${m}`); process.exit(1) }
const { partner = {}, allowed_hosts: hosts = [], links = {} } = cfg
if (typeof links !== 'object' || Array.isArray(links)) fail(`${FILE}: "links" must be an object keyed by hotel name`)
if (partner.id && !partner.param) fail(`${FILE}: partner.id is set but partner.param (the query parameter) is not`)
const names = Object.keys(links)
if (names.length && !hosts.length) fail(`${FILE}: links are listed but allowed_hosts is empty — add HotelRunner's host(s) first`)
const CHECK = /^https:\/\/\S+$/
const want = new Map()
for (const n of names) {
  const raw = typeof links[n] === 'string' ? links[n] : links[n]?.url
  if (!raw || !CHECK.test(raw)) fail(`${n}: "${raw}" is not an https link without whitespace`)
  const host = raw.replace(/^https:\/\//, '').split(/[/?#]/)[0].toLowerCase()
  if (!hosts.some(h => host === h || host.endsWith(`.${h}`))) fail(`${n}: host ${host} is not in allowed_hosts (${hosts.join(', ')})`)
  const url = partner.id ? withParams(raw, { [partner.param]: partner.id }) : raw
  if (url.length > 2048) fail(`${n}: link is ${url.length} characters (limit 2048)`)
  want.set(n, url)
}
console.log(`${FILE}: ${names.length} link(s) · allowed_hosts [${hosts.join(', ')}] · partner ${partner.id ? `${partner.param}=${partner.id}` : 'none yet'}`)
if (mode === '--check') { console.log('check: OK (file only; no database read)'); process.exit(0) }

const env = { ...(existsSync('.env') ? Object.fromEntries(readFileSync('.env','utf8').split('\n').map(l=>l.match(/^\s*([\w.-]+)\s*=\s*(.*)$/)).filter(Boolean).map(m=>[m[1],m[2].trim().replace(/^["']|["']$/g,'')])) : {}), ...process.env }
const { createClient } = await import('@supabase/supabase-js')
const svc = createClient(env.EXPO_PUBLIC_SUPABASE_URL, serviceRoleKey(), { auth: { persistSession: false } })
const { data: rows, error, count } = await svc.from('hotels').select('id,name,hotelrunner_url', { count: 'exact' })
if (error) fail(error.message)
if (rows.length !== count) fail(`read ${rows.length} of ${count} hotels`)
const byName = new Map(rows.map(r => [r.name, r]))
const unknown = names.filter(n => !byName.has(n))
if (unknown.length) fail(`name(s) match no hotel: ${unknown.join(' · ')}`)

const set = [], clear = [], same = []
for (const r of rows) {
  const to = want.get(r.name) ?? null
  if (to === r.hotelrunner_url) same.push(r)
  else if (to) set.push({ r, to })
  else clear.push(r)
}
console.log(`hotels ${rows.length} · set ${set.length} · clear ${clear.length} · unchanged ${same.length}`)
for (const { r, to } of set) console.log(`  set    ${r.name}: ${to}`)
for (const r of clear) console.log(`  clear  ${r.name} (was ${r.hotelrunner_url})`)
if (mode === '--dry') { console.log('DRY RUN — nothing written.'); process.exit(0) }

for (const { r, to } of set) {
  const { data, error: e } = await svc.from('hotels').update({ hotelrunner_url: to }).eq('id', r.id).select('id')
  if (e || data.length !== 1) fail(`set ${r.name}: ${e?.message ?? `${data.length} rows`}`)
}
if (clear.length) {
  const { data, error: e } = await svc.from('hotels').update({ hotelrunner_url: null }).in('id', clear.map(r => r.id)).select('id')
  if (e || data.length !== clear.length) fail(`clear: ${e?.message ?? `${data.length} of ${clear.length} rows`}`)
}
const { data: after, error: e2 } = await svc.from('hotels').select('name,hotelrunner_url').not('hotelrunner_url', 'is', null)
if (e2) fail(e2.message)
const drift = after.filter(h => want.get(h.name) !== h.hotelrunner_url).length + [...want.keys()].filter(n => !after.some(h => h.name === n)).length
console.log(`APPLIED: ${set.length} set, ${clear.length} cleared · read-back: ${after.length} hotel(s) carry a link, ${drift} mismatch(es)`)
if (drift) process.exit(1)
