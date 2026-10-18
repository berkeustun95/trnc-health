#!/usr/bin/env node
// ─── Proofs for `check-eatery-partners.mjs --daily` against a local mock PostgREST ──
//
//   node scripts/test-eatery-daily.mjs
//
// The mock plays the anon key's view: RLS (eatery_partners_select_active) means it returns ONLY active
// rows, so an inactive stale partner is simply absent from the mock's reply. Offline; no real project.

import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), 'check-eatery-partners.mjs')
const day = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)

let reply = { status: 200, rows: [], range: null }
const seen = []
const srv = createServer((req, res) => {
  seen.push(req.url)
  if (reply.status !== 200) { res.writeHead(reply.status, { 'content-type': 'application/json' }); res.end('{"message":"boom"}'); return }
  const total = reply.rangeTotal ?? reply.rows.length
  res.writeHead(200, { 'content-type': 'application/json', 'content-range': reply.noRange ? '' : `${reply.rows.length ? '0-' + (reply.rows.length - 1) : '*'}/${total}` })
  res.end(JSON.stringify(reply.rows))
})
await new Promise(r => srv.listen(0, '127.0.0.1', r))
const url = `http://127.0.0.1:${srv.address().port}`

const run = (env, extra = []) => new Promise(res => {
  const p = spawn(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', SCRIPT, '--daily', ...extra], { env: { ...process.env, EXPO_PUBLIC_SUPABASE_URL: url, EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon-test', ...env } })
  let o = '', e = ''
  p.stdout.on('data', d => (o += d)); p.stderr.on('data', d => (e += d))
  p.on('close', code => res({ code, o, e }))
})

let n = 0, bad = 0
const expect = async (label, setup, want, env = {}) => {
  reply = { status: 200, rows: [], range: null, ...setup }
  const r = await run(env)
  n++
  const ok = want === 'green' ? r.code === 0 : r.code !== 0
  if (!ok) { bad++; console.log(`  ✗ ${label}: wanted ${want}, exit ${r.code}\n${r.o}${r.e}`) }
  else console.log(`  ✓ ${label.padEnd(58)} exit ${r.code}`)
}

await expect('active partner 31 days stale -> RED', { rows: [{ slug: 'crunchy-express', menu_verified_on: day(31) }] }, 'red')
await expect('active partner 30 days old -> green', { rows: [{ slug: 'crunchy-express', menu_verified_on: day(30) }] }, 'green')
await expect('active partner fresh (3 days) -> green', { rows: [{ slug: 'crunchy-express', menu_verified_on: day(3) }] }, 'green')
await expect('active partner with NO date -> RED', { rows: [{ slug: 'crunchy-express', menu_verified_on: null }] }, 'red')
await expect('one fresh + one stale active -> RED', { rows: [{ slug: 'a', menu_verified_on: day(1) }, { slug: 'b', menu_verified_on: day(40) }] }, 'red')
await expect('inactive stale partner (RLS hides it: not returned) -> green', { rows: [] }, 'green')
await expect('HTTP 500 -> RED (fails closed)', { status: 500 }, 'red')
await expect('truncated reply (count 2, 1 row) -> RED', { rows: [{ slug: 'a', menu_verified_on: day(1) }], rangeTotal: 2 }, 'red')
await expect('unreadable content-range -> RED', { rows: [{ slug: 'a', menu_verified_on: day(1) }], noRange: true }, 'red')
await expect('missing anon key -> RED', { rows: [] }, 'red', { EXPO_PUBLIC_SUPABASE_ANON_KEY: '' })
await expect('server down (connection refused) -> RED', { rows: [] }, 'red', { EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:1' })

// flags are ignored: both are false in flags.js and the mock is still asked
seen.length = 0
reply = { status: 200, rows: [], range: null }
const r = await run({})
n++
if (!seen.length || !/eatery_partners/.test(seen[0])) { bad++; console.log('  ✗ --daily must query even while both flags are false') } else console.log(`  ✓ queried the partners table although both flags are false (${seen.length} request)`)
n++
if (!/0 active partners/.test(r.o)) { bad++; console.log('  ✗ zero partners should print the explicit OK line') } else console.log('  ✓ zero active partners prints the explicit OK line')
srv.close()
console.log(bad ? `\n✗ ${bad} of ${n} failed` : `\n✓ eatery --daily: ${n} checks passed`)
process.exit(bad ? 1 : 0)
