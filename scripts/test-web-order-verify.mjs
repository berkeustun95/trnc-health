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
const BROWSER = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1'
const call = (path, method = 'GET', ua, extra = {}) => worker.fetch(new Request('https://getadaapp.com' + path, { method, headers: { ...(ua ? { 'user-agent': ua } : {}), ...extra } }), env)
const plain = (path, method = 'GET') => call(path, method, BROWSER)
// the server-rendered full result (no-script fallback)
const get = path => call(path.replace(/\/?$/, '') + '?view=1', 'GET', BROWSER)
const SAME = { 'sec-fetch-site': 'same-origin' }
const check = (path, ua = BROWSER, extra = SAME) => call(path.replace(/\/?$/, '') + '/check', 'POST', ua, extra)
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

const nonceOf = res => res.headers.get('content-security-policy').match(/script-src 'nonce-([^']+)'/)?.[1]

await test('GET/HEAD never call the RPC: order no only, nonce CSP matches inline script, no form', async () => {
  rpcImpl = () => { throw new Error('RPC must not be called') }
  const res = await plain('/o/7k3q-x9mp')
  const html = await res.text()
  assert.equal(res.status, 200)
  assert.match(html, /ADA sipariş doğrulama/)
  assert.match(html, /ADA order verification/)
  assert.match(html, /7K3Q-X9MP/)
  assert.match(html, /Doğrulanıyor…/)
  assert.doesNotMatch(html.replace(/<script[\s\S]*<\/script>/, ''), /<form|<button|Siparişi doğrula|Crunchy|Bu sipariş ADA üzerinden geldi/)
  assert.match(html, /<noscript><meta http-equiv="refresh" content="1;url=\/o\/7K3QX9MP\?view=1"><\/noscript>/)
  assert.match(html, /<noscript><p><a class="a" href="\/o\/7K3QX9MP\?view=1">Sonucu göster/)
  const csp = res.headers.get('content-security-policy')
  assert.match(csp, /default-src 'none'/)
  assert.match(csp, /connect-src 'self'/)
  assert.doesNotMatch(csp, /script-src[^;]*unsafe/)
  const nonce = nonceOf(res)
  assert.ok(nonce && nonce.length >= 16)
  assert.equal([...html.matchAll(/<script nonce="([^"]+)">/g)].map(x => x[1]).join(), nonce)
  assert.equal((html.match(/<script/g) || []).length, 1)
  assert.match(html, /visibilityState/)
  assert.match(html, /,400\)/)
  assert.doesNotMatch(html, /innerHTML/)
  assert.notEqual(nonceOf(await plain('/o/7k3q-x9mp')), nonce)
  for (const r of [res, await plain('/o/7K3QX9MP', 'HEAD')]) {
    assert.equal(r.headers.get('cache-control'), 'no-store')
    assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow')
  }
  const head = await plain('/o/7K3QX9MP', 'HEAD')
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')
  // bots and no-UA requests on GET / ?view=1 get the neutral page, never the RPC
  for (const ua of ['WhatsApp/2.23', 'facebookexternalhit/1.1', undefined]) assert.equal((await call('/o/7K3QX9MP', 'GET', ua)).status, 200)
  assert.match(await (await call('/o/7K3QX9MP?view=1', 'GET', 'WhatsApp/2.23')).text(), /Doğrulanıyor/)
  const bad = await plain('/o/7K3QX9M0')
  const badHtml = await bad.text()
  assert.equal(bad.status, 404)
  assert.doesNotMatch(badHtml, /<form|<button|<script|noscript/)
  assert.doesNotMatch(bad.headers.get('content-security-policy'), /script-src/)
  assert.equal((await plain('/o/7K3QX9M0', 'HEAD')).status, 404)
  assert.equal(rpcCalls.length, 0)
})

await test('inline script runs in a stub DOM: waits for visibility, POSTs /check, renders with textContent only', async () => {
  rpcImpl = () => { throw new Error('RPC must not be called') }
  const html = await (await plain('/o/7K3QX9MP')).text()
  const js = html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)[1]
  const mkEl = tag => ({ tag, children: [], className: '', set textContent(v) { this._t = v; if (v === '') this.children = [] }, get textContent() { return this._t }, appendChild(c) { this.children.push(c) }, set innerHTML(_) { throw new Error('innerHTML used') } })
  const run = async (visibility, payload) => {
    const box = mkEl('div'); const listeners = {}; const timers = []; const calls = []
    const doc = { visibilityState: visibility, readyState: 'complete', getElementById: () => box, createElement: mkEl, addEventListener: (e, f) => { listeners[e] = f } }
    const fetchStub = (u, o) => { calls.push([u, o]); return Promise.resolve({ json: async () => payload }) }
    new Function('document', 'window', 'location', 'fetch', 'setTimeout', js)(doc, { addEventListener() {} }, { pathname: '/o/7K3QX9MP' }, fetchStub, (f, ms) => timers.push([f, ms]))
    return { box, listeners, timers, calls, doc }
  }
  const payload = { status: 'ok', partner: '<b>X</b>', orderNo: '7K3Q-X9MP', time: 't', lines: [{ l: '1 × A', r: '5,00 TL', d: '<i>Soğan yok' }, { l: '1 × B', r: '1,00 TL' }], total: '5,00 TL', seenTr: 'tr', seenEn: 'en' }
  const hidden = await run('hidden', payload)
  assert.equal(hidden.timers.length, 0); assert.equal(hidden.calls.length, 0)
  hidden.doc.visibilityState = 'visible'; hidden.listeners.visibilitychange()
  assert.equal(hidden.timers[0][1], 400); assert.equal(hidden.calls.length, 0)
  const vis = await run('visible', payload)
  assert.equal(vis.timers[0][1], 400)
  vis.timers[0][0]()
  await new Promise(r => setImmediate(r))
  assert.deepEqual([vis.calls[0][0], vis.calls[0][1].method], ['/o/7K3QX9MP/check', 'POST'])
  const flat = JSON.stringify(vis.box)
  assert.match(flat, /&lt;|<b>X<\/b>/) // payload text lands as plain text node content, never parsed
  assert.match(flat, /Bu sipariş ADA üzerinden geldi/)
  assert.match(flat, /"className":"d"[^}]*<i>Soğan yok|<i>Soğan yok[^}]*"className":"d"/) // detail sub-line is a text node
  const bot = await run('visible', { status: 'bot' }); bot.timers[0][0](); await new Promise(r => setImmediate(r))
  assert.equal(bot.box.children.length, 1)
  assert.match(JSON.stringify(bot.box), /Sonucu göster/)
  assert.match(JSON.stringify(bot.box), /\?view=1/)
  const errRun = await run('visible', null); errRun.timers[0][0](); await new Promise(r => setImmediate(r))
  assert.match(JSON.stringify(errRun.box), /Tekrar dene/)
})

await test('/check: refuses bot UAs without the RPC', async () => {
  rpcImpl = () => json(okRow())
  const bots = ['WhatsApp/2.23.20 A', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', 'Facebot', 'TelegramBot (like TwitterBot)',
    'Twitterbot/1.0', 'Slackbot-LinkExpanding 1.0', 'Mozilla/5.0 (compatible; Discordbot/2.0)', 'LinkedInBot/1.0', 'Mozilla/5.0 SkypeUriPreview Preview/0.5',
    'Mozilla/5.0 (compatible; Googlebot/2.1)', 'Mozilla/5.0 (compatible; bingbot/2.0)', 'Mozilla/5.0 (Applebot/0.1)', 'redditbot/1.0',
    'Mozilla/5.0 (compatible; Embedly/0.2)', 'WhatsApp', 'vkShare; +http://vk.com/dev/Share', 'Iframely/1.3.1', 'ZoominfoBot']
  for (const ua of bots) {
    const res = await check('/o/7K3QX9MP', ua)
    assert.deepEqual(await res.json(), { status: 'bot' }, ua)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow')
  }
  assert.equal(rpcCalls.length, 0)
  const inApp = ['Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/118 Mobile Safari/537.36 Viber/21.0', 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 Line/13.0.0',
    'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 Snapchat/12.0', 'Mozilla/5.0 (Linux; Android 13) Chrome/118 Mobile Safari/537.36 [Pinterest/Android]',
    'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0 FBAN/FBIOS', 'Mozilla/5.0 (Linux; Android 13; wv) Chrome/118 Mobile Safari/537.36 Telegram-Android/10.0']
  for (const ua of [BROWSER, 'curl/8.4.0', undefined, ...inApp]) {
    rpcCalls.length = 0
    const res = await check('/o/7K3QX9MP', ua)
    assert.equal(res.status, 200)
    assert.equal((await res.json()).status, 'ok')
    assert.equal(rpcCalls.length, 1, String(ua))
  }
})

await test('/check: same-origin only (Sec-Fetch-Site, else Origin), otherwise 403 without the RPC', async () => {
  rpcImpl = () => json(okRow())
  for (const [name, extra] of [['cross-site', { 'sec-fetch-site': 'cross-site' }], ['same-site', { 'sec-fetch-site': 'same-site' }], ['none', { 'sec-fetch-site': 'none' }],
    ['no headers', {}], ['foreign Origin', { origin: 'https://evil.example' }], ['Origin wins nothing over bad SFS', { 'sec-fetch-site': 'cross-site', origin: 'https://getadaapp.com' }]]) {
    const res = await check('/o/7K3QX9MP', BROWSER, extra)
    assert.equal(res.status, 403, name)
    assert.deepEqual(await res.json(), { status: 'forbidden' }, name)
  }
  assert.equal(rpcCalls.length, 0)
  assert.equal((await check('/o/7K3QX9MP', BROWSER, { origin: 'https://getadaapp.com' })).status, 200)
  assert.equal((await check('/o/7K3QX9MP', BROWSER, SAME)).status, 200)
  assert.equal(rpcCalls.length, 2)
})

await test('every /o/* response variant carries the privacy headers and a CSP', async () => {
  rpcImpl = () => json(okRow())
  const variants = [
    plain('/o/7K3QX9MP'), plain('/o/7K3QX9MP', 'HEAD'), plain('/o/7K3QX9M0'), plain('/o/7K3QX9MP?view=1'), plain('/o/7K3QX9MP', 'DELETE'),
    call('/o/7K3QX9MP', 'DELETE', BROWSER), call('/o/7K3QX9MP/check', 'GET', BROWSER), check('/o/7K3QX9MP'), check('/o/7K3QX9M0'),
    check('/o/7K3QX9MP', 'WhatsApp/2'), check('/o/7K3QX9MP', BROWSER, {}),
  ]
  rpcImpl = () => { throw new Error('x') }
  variants.push(plain('/o/7K3QX9MP?view=1'), check('/o/7K3QX9MP'))
  for (const [i, p] of variants.entries()) {
    const r = await p
    assert.equal(r.headers.get('cache-control'), 'no-store', 'variant ' + i + ' status ' + r.status)
    assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow', 'variant ' + i)
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff', 'variant ' + i)
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer', 'variant ' + i)
    assert.match(r.headers.get('content-security-policy') || '', /default-src 'none'.*frame-ancestors 'none'/, 'variant ' + i)
  }
  assert.equal((await check('/o/7K3QX9MP')).headers.get('content-security-policy'), "default-src 'none'; frame-ancestors 'none'")
})

await test('/check: POST only, JSON shape, escaped-safe, error/not_found/malformed', async () => {
  rpcImpl = () => json(okRow({ partner_name: '</script><b>', view_count_before: 1, first_viewed_at_before: '2026-10-21T10:30:00Z' }))
  assert.equal((await call('/o/7K3QX9MP/check', 'GET', BROWSER)).status, 405)
  assert.equal((await call('/o/7K3QX9MP/check', 'HEAD', BROWSER)).status, 405)
  assert.equal(rpcCalls.length, 0)
  const res = await check('/o/7k3q-x9mp')
  const raw = await res.text()
  assert.doesNotMatch(raw, /[<>]/)
  const j = JSON.parse(raw)
  assert.equal(j.partner, '</script><b>')
  assert.equal(j.orderNo, '7K3Q-X9MP')
  assert.equal(j.time, '21.10.2026 13:05')
  assert.deepEqual(j.lines, [{ l: '2 × Crunchy Burger', r: '1.240,00 TL' }])
  assert.equal(j.total, '1.240,00 TL')
  assert.equal(j.seenTr, 'İlk görüntülenme: 21.10.2026 13:30 · 2 kez açıldı')
  assert.match(res.headers.get('content-type'), /application\/json/)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow')
  rpcImpl = () => json({ status: 'expired', ...okRow() , status: 'expired' })
  assert.equal((await (await check('/o/7K3QX9MP')).json()).status, 'expired')
  rpcImpl = () => json({ status: 'not_found' })
  const nf = await check('/o/7K3QX9MP')
  assert.equal(nf.status, 404)
  assert.deepEqual(await nf.json(), { status: 'not_found' })
  rpcImpl = () => { throw new Error('boom') }
  const er = await check('/o/7K3QX9MP')
  assert.equal(er.status, 503)
  assert.deepEqual(await er.json(), { status: 'error' })
  rpcCalls.length = 0
  rpcImpl = () => json(okRow())
  const mal = await check('/o/7K3QX9M0')
  assert.equal(mal.status, 404)
  assert.equal(rpcCalls.length, 0)
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

await test('is_test: test banner wins (server HTML, /check JSON, client script); green banner absent', async () => {
  const TEST_TR = /TEST SİPARİŞİ — hazırlamayın/, TEST_EN = /TEST ORDER — do not prepare/, GREEN = /Bu sipariş ADA üzerinden geldi/
  for (const status of ['ok', 'expired']) {
    rpcImpl = () => json(okRow({ status, is_test: true }))
    const html = await (await get('/o/7K3QX9MP')).text()
    assert.match(html, TEST_TR, status); assert.match(html, TEST_EN, status)
    assert.match(html, /<div class="banner bad"><b>TEST SİPARİŞİ/, status)
    assert.doesNotMatch(html, GREEN, status)
    assert.doesNotMatch(html, /<b>Süresi dolmuş/, status)
    assert.equal((await (await check('/o/7K3QX9MP')).json()).isTest, true, status)
    assert.match(html, /class="card grey"/, status)
  }
  rpcImpl = () => json(okRow())
  assert.doesNotMatch(await (await get('/o/7K3QX9MP')).text(), /class="card grey"/)
  const js = (await (await plain('/o/7K3QX9MP')).text()).match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)[1]
  assert.match(js, /j\.isTest===true\?banner\('TEST SİPARİŞİ — hazırlamayın','TEST ORDER — do not prepare',true\)/)
  const mkEl = tag => ({ tag, children: [], className: '', set textContent(v) { this._t = v; if (v === '') this.children = [] }, get textContent() { return this._t }, appendChild(c) { this.children.push(c) } })
  const render = async payload => {
    const box = mkEl('div'); const timers = []
    const doc = { visibilityState: 'visible', readyState: 'complete', getElementById: () => box, createElement: mkEl, addEventListener() {} }
    new Function('document', 'window', 'location', 'fetch', 'setTimeout', js)(doc, { addEventListener() {} }, { pathname: '/o/7K3QX9MP' }, () => Promise.resolve({ json: async () => payload }), (f, ms) => timers.push([f, ms]))
    timers[0][0](); await new Promise(r => setImmediate(r))
    return JSON.stringify(box)
  }
  const base = { status: 'ok', partner: 'P', orderNo: '7K3Q-X9MP', time: 't', lines: [], total: '0', seenTr: 'tr', seenEn: 'en' }
  const t = await render({ ...base, isTest: true })
  assert.match(t, TEST_TR); assert.match(t, TEST_EN); assert.match(t, /banner bad/); assert.doesNotMatch(t, GREEN)
  const te = await render({ ...base, status: 'expired', isTest: true })
  assert.match(te, TEST_TR); assert.doesNotMatch(te, /Süresi dolmuş/)
  assert.match(t, /"className":"card grey"/)
  assert.match(te, /"className":"card grey"/)
  const ok = await render(base)
  assert.match(ok, /"className":"card"/); assert.doesNotMatch(ok, /card grey/)
  assert.match(await render({ ...base, isTest: 'true' }), GREEN)
})

await test('is_test false / absent / truthy non-booleans: green banner unchanged, never a test banner', async () => {
  for (const over of [{ is_test: false }, {}, { is_test: null }, { is_test: 'true' }, { is_test: 1 }, { is_test: 'false' }]) {
    rpcImpl = () => json(okRow(over))
    const html = await (await get('/o/7K3QX9MP')).text()
    const label = JSON.stringify(over)
    assert.match(html, /✓ Bu sipariş ADA üzerinden geldi/, label)
    assert.doesNotMatch(html, /TEST SİPARİŞİ|TEST ORDER/, label)
    assert.equal((await (await check('/o/7K3QX9MP')).json()).isTest, false, label)
  }
  rpcImpl = () => json(okRow({ status: 'expired', is_test: false }))
  const html = await (await get('/o/7K3QX9MP')).text()
  assert.match(html, /Süresi dolmuş/); assert.doesNotMatch(html, /TEST SİPARİŞİ/)
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

await test('line detail: sub-line escaped in page, textContent in client, carried by /check; plain line unchanged', async () => {
  const D = '<b>&"'
  rpcImpl = () => json(okRow({ lines: [{ name: 'Burger', qty: 1, unit_price: 5, detail: D }, { name: 'Fries', qty: 2, unit_price: 3, detail: null }, { name: 'Cola', qty: 1, unit_price: 1 }] }))
  const html = await (await get('/o/7K3QX9MP')).text()
  assert.ok(html.includes('<li><span>1 × Burger<span class="d">&lt;b&gt;&amp;&quot;</span></span><span>5,00 TL</span></li>'), 'detail sub-line escaped')
  assert.ok(html.includes('<li><span>2 × Fries</span><span>6,00 TL</span></li>'), 'null detail: plain line byte-identical')
  assert.ok(html.includes('<li><span>1 × Cola</span><span>1,00 TL</span></li>'), 'absent detail: plain line byte-identical')
  assert.doesNotMatch(html, /<b>&"/)
  const j = await (await check('/o/7K3QX9MP')).json()
  assert.deepEqual(j.lines, [{ l: '1 × Burger', r: '5,00 TL', d: D }, { l: '2 × Fries', r: '6,00 TL' }, { l: '1 × Cola', r: '1,00 TL' }])
  const src = await (await get('/o/7K3QX9MP')).text()
  assert.ok(!/class="d"[^>]*style=/.test(src), 'no inline style')
})

await test('malformed codes never call the RPC (404, any method)', async () => {
  rpcImpl = () => json(okRow())
  for (const bad of ['/o/', '/o/ABC', '/o/7K3QX9M0', '/o/7K3QX9MI', '/o/7K3QX9MPP', '/o/7K3Q%2FX9MP', '/o/%E0%A4%A', "/o/7K3Q'X9M"]) {
    assert.equal((await call(bad, 'GET', BROWSER)).status, 404, bad)
    assert.equal((await call(bad + '?view=1', 'GET', BROWSER)).status, 404, bad)
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
