#!/usr/bin/env node
// Local test for worker/index.js (/o/<code>). Run: npm run web:test
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const worker = (await import(join(dirname(fileURLToPath(import.meta.url)), '..', 'worker', 'index.js'))).default

const realFetch = globalThis.fetch
let rpcCalls = []
let rpcImpl
globalThis.fetch = async (url, init) => { rpcCalls.push({ url, init }); return rpcImpl(url, init) }
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } })

const assetHits = []
const env = {
  SUPABASE_URL: 'https://x.test', SUPABASE_ANON_KEY: 'anon-key',
  ASSETS: { fetch: async req => { assetHits.push(req); return new Response('ASSET', { status: 200 }) } },
}
const get = path => worker.fetch(new Request('https://getadaapp.com' + path), env)
const okRow = (over = {}) => ({
  status: 'ok', partner_name: 'Crunchy Express', created_at: '2026-10-21T10:05:00Z', expires_at: '2026-10-21T14:05:00Z',
  lines: [{ name: 'Crunchy Burger', qty: 2, unit_price: 620 }], total: 1240, currency: 'TRY',
  first_viewed_at_before: null, view_count_before: 0, ...over,
})
let n = 0
const test = async (name, fn) => { rpcCalls = []; assetHits.length = 0; await fn(); n++; console.log('  ✓ ' + name) }

await test('ok: renders order, formats, headers, RPC request shape', async () => {
  rpcImpl = () => json(okRow())
  const res = await get('/o/7k3q-x9mp')
  const html = await res.text()
  assert.equal(res.status, 200)
  assert.match(html, /✓ Bu sipariş ADA üzerinden geldi/)
  assert.match(html, /This order came through ADA/)
  assert.match(html, /7K3Q-X9MP/)
  assert.match(html, /21\.10\.2026 13:05/) // Istanbul = UTC+3
  assert.match(html, /2 × Crunchy Burger/)
  assert.match(html, /1\.240,00 TL/)
  assert.match(html, /İlk kez görüntüleniyor/)
  assert.match(html, /Fiyatlar ADA menüsündendir\. Not satırı doğrulanmaz\./)
  assert.match(html, /getadaapp\.com\/privacy/)
  assert.match(html, /<meta name="robots" content="noindex">/)
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow')
  assert.equal(res.headers.get('cache-control'), 'no-store')
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8')
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer')
  assert.match(res.headers.get('content-security-policy'), /default-src 'none'; style-src 'unsafe-inline'; img-src data:/)
  assert.equal(rpcCalls.length, 1)
  assert.equal(rpcCalls[0].url, 'https://x.test/rest/v1/rpc/verify_eatery_order')
  assert.deepEqual(JSON.parse(rpcCalls[0].init.body), { p_code: '7K3QX9MP' })
  assert.equal(rpcCalls[0].init.headers.apikey, 'anon-key')
  assert.equal(rpcCalls[0].init.headers.Authorization, 'Bearer anon-key')
})

await test('ok with prior views: count includes this open', async () => {
  rpcImpl = () => json(okRow({ view_count_before: 2, first_viewed_at_before: '2026-10-21T10:30:00Z' }))
  const html = await (await get('/o/7K3QX9MP')).text()
  assert.match(html, /İlk görüntülenme: 21\.10\.2026 13:30 · 3 kez açıldı/)
})

await test('expired: banner, greyed, 200', async () => {
  rpcImpl = () => json(okRow({ status: 'expired' }))
  const res = await get('/o/7K3QX9MP')
  const html = await res.text()
  assert.equal(res.status, 200)
  assert.match(html, /Süresi dolmuş/)
  assert.match(html, /class="card grey"/)
  assert.doesNotMatch(html, /Bu sipariş ADA üzerinden geldi/)
})

await test('not_found: 404 and message', async () => {
  rpcImpl = () => json({ status: 'not_found' })
  const res = await get('/o/7K3QX9MP')
  assert.equal(res.status, 404)
  assert.match(await res.text(), /ADA'da böyle bir sipariş yok/)
  assert.equal(res.headers.get('cache-control'), 'no-store')
})

await test('escaping: <script> in dish and partner names', async () => {
  rpcImpl = () => json(okRow({ partner_name: '<img src=x onerror=alert(1)>', lines: [{ name: '<script>alert(1)</script>"\'', qty: 1, unit_price: 5 }] }))
  const html = await (await get('/o/7K3QX9MP')).text()
  assert.doesNotMatch(html, /<script/i)
  assert.doesNotMatch(html, /<img/i)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;&quot;&#39;/)
})

await test('malformed codes never call the RPC (404)', async () => {
  rpcImpl = () => json(okRow())
  for (const bad of ['/o/', '/o/ABC', '/o/7K3QX9M0', '/o/7K3QX9MI', '/o/7K3QX9MPP', '/o/7K3Q%2FX9MP', '/o/%E0%A4%A', "/o/7K3Q'X9M"]) {
    const res = await get(bad)
    assert.equal(res.status, 404, bad)
  }
  assert.equal(rpcCalls.length, 0)
})

await test('non-/o paths go to ASSETS untouched', async () => {
  rpcImpl = () => { throw new Error('should not be called') }
  for (const p of ['/privacy', '/support', '/delete-account', '/other', '/ox/7K3QX9MP', '/o']) {
    const req = new Request('https://getadaapp.com' + p)
    const res = await worker.fetch(req, env)
    assert.equal(await res.text(), 'ASSET', p)
    assert.equal(assetHits.at(-1), req, p)
  }
  assert.equal(rpcCalls.length, 0)
})

await test('RPC failure modes: 503 friendly, no stack', async () => {
  const cases = [() => { throw new Error('boom secret-stack') }, () => json({ message: 'x' }, 500), () => new Response('not json', { status: 200 }), () => json({ foo: 1 })]
  for (const impl of cases) {
    rpcImpl = impl
    const res = await get('/o/7K3QX9MP')
    const html = await res.text()
    assert.equal(res.status, 503)
    assert.match(html, /Şu an doğrulanamadı, biraz sonra tekrar dene/)
    assert.doesNotMatch(html, /boom|secret-stack|at /)
  }
})

await test('RPC timeout (5 s abort) gives 503', async () => {
  rpcImpl = (_u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))))
  const realSet = globalThis.setTimeout
  let ms5
  globalThis.setTimeout = (fn, ms) => { ms5 = ms; return realSet(fn, 0) }
  try { assert.equal((await get('/o/7K3QX9MP')).status, 503) } finally { globalThis.setTimeout = realSet }
  assert.equal(ms5, 5000)
})

globalThis.fetch = realFetch
console.log(`\n  ${n} tests passed`)
