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
  assert.match(html, /21\.10\.2026 13:05/) // Nicosia summer = UTC+3
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

// ─── Order status: customer timeline, restaurant PIN / status (20261193 + 20261194) ───────────────────────────────
const KEY = 'k'.repeat(64)
const envK = { ...env, ADA_WORKER_KEY: KEY }
const DEV = 'a1'.repeat(48) // 96 lowercase hex, the 20261194 token shape
const DEV2 = 'b2'.repeat(48)
const COOKIE = '__Secure-ada_rd'
const PIN = '482915'
const callE = (e, path, method, ua, extra = {}, body) => worker.fetch(new Request('https://getadaapp.com' + path, { method, headers: { ...(ua ? { 'user-agent': ua } : {}), ...extra }, ...(body != null ? { body } : {}) }), e)
const checkE = (e, extra = {}) => callE(e, '/o/7K3QX9MP/check', 'POST', BROWSER, { ...SAME, ...extra })
const JSONH = { ...SAME, 'content-type': 'application/json' }
const act = (e, what, body, extra = {}, ua = BROWSER, method = 'POST') => callE(e, '/o/7K3QX9MP/' + what, method, ua, { ...JSONH, ...extra }, method === 'POST' ? JSON.stringify(body) : undefined)
const withCookie = d => ({ cookie: `other=1; ${COOKIE}=${d}` })
const tokenFor = async (e, extra = {}) => (await (await checkE(e, extra)).json()).token
const ago = h => new Date(Date.now() - h * 3600e3).toISOString()
const stRow = (over = {}) => okRow({ created_at: ago(0.5), fulfilment: 'delivery', order_status: 'sent', status_at: null, cancel_reason: null,
  status_open: true, status_enabled: true, can_manage: false, next: [], ...over })
const keyHeader = c => c.init.headers['x-ada-worker-key']

await test('status: customer /check carries the timeline fields, never manage/next/buttons, even if the RPC said can_manage', async () => {
  rpcImpl = () => json(stRow({ can_manage: true, next: ['received', 'cancelled'] }))
  for (const e of [env, envK]) {
    const j = await (await checkE(e)).json()
    assert.equal(j.manage, false); assert.deepEqual(j.next, []); assert.equal(j.frozen, false); assert.equal(j.old2h, false)
    assert.equal(j.orderStatus, 'sent'); assert.equal(j.fulfilment, 'delivery'); assert.equal(j.statusShown, true)
    assert.deepEqual(JSON.parse(rpcCalls.at(-1).init.body), { p_code: '7K3QX9MP' }, 'no cookie: body stays { p_code }')
    assert.equal(keyHeader(rpcCalls.at(-1)), undefined, 'no cookie: the key is not sent')
  }
  rpcImpl = () => json(stRow({ status_enabled: false }))
  assert.equal((await (await checkE(envK)).json()).statusShown, false, 'switched-off partner, untouched order: no timeline')
  rpcImpl = () => json(stRow({ status_enabled: false, is_test: true }))
  assert.equal((await (await checkE(envK)).json()).statusShown, true, 'TEST order: timeline')
})

await test('status: can_manage + next only with the cookie AND the key; the key comes from env, never from a client header', async () => {
  rpcImpl = () => json(stRow({ can_manage: true, next: ['received', 'preparing', 'on_the_way', 'cancelled', 'bogus', 'sent'] }))
  const res = await checkE(envK, { ...withCookie(DEV), 'x-ada-worker-key': 'evil' })
  const j = await res.json()
  assert.equal(j.manage, true)
  assert.deepEqual(j.next, ['received', 'preparing', 'on_the_way', 'cancelled'])
  assert.deepEqual(JSON.parse(rpcCalls.at(-1).init.body), { p_code: '7K3QX9MP', p_device: DEV })
  assert.equal(keyHeader(rpcCalls.at(-1)), KEY)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  assert.match(j.token, /^[0-9a-f]{64}$/)
  // key unset: cookie ignored, client header never forwarded, no token, customer-only
  rpcCalls = []
  const u = await (await checkE(env, { ...withCookie(DEV), 'x-ada-worker-key': KEY })).json()
  assert.equal(u.manage, false); assert.equal(u.pinable, false); assert.equal(u.token, undefined); assert.deepEqual(u.next, [])
  assert.deepEqual(JSON.parse(rpcCalls[0].init.body), { p_code: '7K3QX9MP' })
  assert.equal(keyHeader(rpcCalls[0]), undefined)
  assert.ok(!JSON.stringify(rpcCalls[0].init.headers).includes(KEY))
  // a malformed cookie is no cookie
  for (const bad of ['A1'.repeat(48), 'a1'.repeat(47), DEV + '0', 'x', '']) {
    rpcCalls = []
    assert.equal((await (await checkE(envK, withCookie(bad))).json()).manage, false, bad)
    assert.deepEqual(JSON.parse(rpcCalls[0].init.body), { p_code: '7K3QX9MP' }, bad)
  }
  // too-short key counts as unset
  assert.equal((await (await checkE({ ...env, ADA_WORKER_KEY: 'short' }, withCookie(DEV))).json()).manage, false)
})

await test('status: PIN link only when the key is set, the order is open and status is on (or TEST)', async () => {
  const pin = async (over, e = envK) => { rpcImpl = () => json(stRow(over)); return (await (await checkE(e)).json()).pinable }
  assert.equal(await pin({}), true)
  assert.equal(await pin({}, env), false, 'key unset')
  assert.equal(await pin({ status_enabled: false }), false, 'partner switched off')
  assert.equal(await pin({ status_enabled: false, is_test: true }), true, 'TEST order')
  assert.equal(await pin({ status_open: false }), false, 'final status')
  assert.equal(await pin({ created_at: ago(13) }), false, 'over 12 h')
})

await test('status: restaurant 2 h warning and 12 h freeze come from created_at', async () => {
  const m = async over => { rpcImpl = () => json(stRow({ can_manage: true, next: ['received', 'cancelled'], ...over })); return checkE(envK, withCookie(DEV)).then(r => r.json()) }
  let j = await m({ created_at: ago(1.5) }); assert.equal(j.old2h, false); assert.equal(j.frozen, false)
  j = await m({ created_at: ago(2.5) }); assert.equal(j.old2h, true); assert.equal(j.frozen, false); assert.deepEqual(j.next, ['received', 'cancelled'])
  j = await m({ created_at: ago(2.5), order_status: 'received' }); assert.equal(j.old2h, false, 'only while still sent')
  j = await m({ created_at: ago(12.5), status_open: false }); assert.equal(j.frozen, true); assert.equal(j.old2h, false); assert.deepEqual(j.next, [])
})

await test('/pin /status /forget /token: refuse wrong method, cross-origin, bots, non-JSON, unset key, missing/wrong action token — no RPC', async () => {
  rpcImpl = () => json({ status: 'ok', device_token: DEV })
  const tok = await tokenFor(envK)
  rpcCalls = []
  for (const what of ['pin', 'status', 'forget', 'token']) {
    const body = { pin: PIN, status: 'received', reason: null, token: tok }
    const cases = [
      ['GET', act(envK, what, body, {}, BROWSER, 'GET'), 405],
      ['cross-site', act(envK, what, body, { 'sec-fetch-site': 'cross-site' }), 403],
      ['foreign Origin', callE(envK, '/o/7K3QX9MP/' + what, 'POST', BROWSER, { origin: 'https://evil.example', 'content-type': 'application/json' }, JSON.stringify(body)), 403],
      ['no origin headers', callE(envK, '/o/7K3QX9MP/' + what, 'POST', BROWSER, { 'content-type': 'application/json' }, JSON.stringify(body)), 403],
      ['bot', act(envK, what, body, {}, 'WhatsApp/2.23'), 403],
      ['text/plain', act(envK, what, body, { 'content-type': 'text/plain' }), 415],
      ['form', act(envK, what, body, { 'content-type': 'application/x-www-form-urlencoded' }), 415],
      ['key unset', act(env, what, body), 403],
      ['bad code', callE(envK, '/o/7K3QX9M0/' + what, 'POST', BROWSER, JSONH, JSON.stringify(body)), 404],
      ['not JSON', callE(envK, '/o/7K3QX9MP/' + what, 'POST', BROWSER, JSONH, '{pin:'), 400],
      ['huge', callE(envK, '/o/7K3QX9MP/' + what, 'POST', BROWSER, JSONH, JSON.stringify({ ...body, x: 'x'.repeat(2000) })), 400],
    ]
    if (what !== 'token') cases.push(
      ['no token', act(envK, what, { ...body, token: undefined }), 403],
      ['forged token', act(envK, what, { ...body, token: 'f'.repeat(64) }), 403],
      ['token of another code', act(envK, what, { ...body, token: await (async () => { rpcImpl = () => json(stRow()); const t = (await (await callE(envK, '/o/22222222/check', 'POST', BROWSER, SAME)).json()).token; rpcCalls = []; return t })() }), 403],
      ['token for a different key', act(envK, what, { ...body, token: await tokenFor({ ...env, ADA_WORKER_KEY: 'z'.repeat(64) }).then(t => { rpcCalls = []; return t }) }), 403],
    )
    for (const [name, p, code] of cases) {
      const r = await p
      assert.equal(r.status, code, `${what}: ${name}`)
      assert.equal(r.headers.get('cache-control'), 'no-store', `${what}: ${name}`)
      assert.equal(r.headers.get('set-cookie'), null, `${what}: ${name}`)
      if (code === 403 && name.endsWith('token')) assert.equal((await r.json()).status, 'retry', `${what}: ${name}`)
    }
  }
  assert.equal(rpcCalls.length, 0)
})

await test('action token: bound to the device cookie, lives 10–20 min, /token renews it without the RPC', async () => {
  const realNow = Date.now
  const t0 = Math.floor(realNow() / 600e3) * 600e3 + 1000 // start of a 10-min bucket: no boundary flake
  Date.now = () => t0
  try {
    rpcImpl = () => json(stRow())
    const anon = await tokenFor(envK)
    rpcCalls = []
    rpcImpl = () => json({ status: 'wrong_pin' })
    assert.equal((await act(envK, 'pin', { pin: PIN, token: anon }, withCookie(DEV))).status, 403, 'anon token with a device cookie')
    assert.equal(rpcCalls.length, 0)
    Date.now = () => t0 + 10 * 60e3
    assert.equal((await act(envK, 'pin', { pin: PIN, token: anon })).status, 200, 'previous bucket still valid')
    Date.now = () => t0 + 21 * 60e3
    rpcCalls = []
    const old = await act(envK, 'pin', { pin: PIN, token: anon })
    assert.equal(old.status, 403); assert.equal((await old.json()).status, 'retry'); assert.equal(rpcCalls.length, 0)
    const fresh = await (await act(envK, 'token', {})).json()
    assert.equal(rpcCalls.length, 0)
    assert.equal((await act(envK, 'pin', { pin: PIN, token: fresh.token })).status, 200)
  } finally { Date.now = realNow }
})

await test('/pin: PIN only in the POST body to Supabase, cookie flags exact, device token never in the JSON, statuses mapped', async () => {
  rpcImpl = () => json(stRow())
  const tok = await tokenFor(envK, { 'x-ada-worker-key': 'evil' })
  rpcCalls = []
  rpcImpl = () => json({ status: 'ok', device_token: DEV })
  const res = await act(envK, 'pin', { pin: PIN, token: tok }, { 'x-ada-worker-key': 'evil' })
  const raw = await res.text()
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('set-cookie'), `${COOKIE}=${DEV}; HttpOnly; Secure; SameSite=Strict; Path=/o/; Max-Age=15552000`)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  assert.ok(!raw.includes(DEV), 'device token must not be in the JSON body')
  assert.ok(!raw.includes(PIN))
  const j = JSON.parse(raw)
  assert.equal(j.status, 'ok'); assert.match(j.token, /^[0-9a-f]{64}$/); assert.notEqual(j.token, tok, 'new token bound to the new device')
  assert.equal(rpcCalls.length, 1)
  assert.equal(rpcCalls[0].url, 'https://x.test/rest/v1/rpc/eatery_partner_enrol')
  assert.deepEqual(JSON.parse(rpcCalls[0].init.body), { p_code: '7K3QX9MP', p_pin: PIN })
  assert.equal(keyHeader(rpcCalls[0]), KEY)
  for (const c of rpcCalls) assert.ok(!c.url.includes(PIN), 'PIN in a URL')
  for (const st of ['wrong_pin', 'locked', 'closed', 'no_pin', 'device_limit', 'not_found', 'forbidden']) {
    rpcImpl = () => json({ status: st })
    const r = await act(envK, 'pin', { pin: PIN, token: tok })
    assert.deepEqual(await r.json(), { status: st }, st); assert.equal(r.headers.get('set-cookie'), null, st)
  }
  for (const impl of [() => json({ status: 'ok' }), () => json({ status: 'ok', device_token: 'short' }), () => json({ status: 'weird' }), () => { throw new Error('x') }]) {
    rpcImpl = impl
    const r = await act(envK, 'pin', { pin: PIN, token: tok })
    assert.equal(r.status, 503); assert.equal(r.headers.get('set-cookie'), null)
  }
  rpcCalls = []
  for (const bad of ['12345', '1234567', 'abcdef', 482915, null]) assert.equal((await (await act(envK, 'pin', { pin: bad, token: tok })).json()).status, 'wrong_pin', String(bad))
  assert.equal(rpcCalls.length, 0, 'malformed PINs never reach the RPC')
})

await test('/pin: per-IP rate-limit binding refuses before the RPC; absent binding = no-op', async () => {
  rpcImpl = () => json(stRow())
  const tok = await tokenFor(envK)
  const keys = []
  const limited = { ...envK, PIN_RATE_LIMITER: { limit: async o => { keys.push(o.key); return { success: false } } } }
  rpcCalls = []
  const r = await act(limited, 'pin', { pin: PIN, token: tok }, { 'cf-connecting-ip': '203.0.113.9' })
  assert.equal(r.status, 429); assert.deepEqual(await r.json(), { status: 'rate_limited' }); assert.equal(rpcCalls.length, 0)
  assert.deepEqual(keys, ['pin:203.0.113.9'])
  rpcImpl = () => json({ status: 'wrong_pin' })
  const allowed = { ...envK, PIN_RATE_LIMITER: { limit: async () => ({ success: true }) } }
  assert.equal((await (await act(allowed, 'pin', { pin: PIN, token: tok })).json()).status, 'wrong_pin')
  assert.equal((await (await act(envK, 'pin', { pin: PIN, token: tok })).json()).status, 'wrong_pin')
})

await test('/status: needs the device cookie, validates status/reason locally, sends device + key, maps results', async () => {
  rpcImpl = () => json(stRow({ can_manage: true }))
  const tok = await tokenFor(envK, withCookie(DEV))
  rpcCalls = []
  assert.equal((await act(envK, 'status', { status: 'received', token: tok })).status, 403, 'no cookie (and token bound to DEV)')
  assert.equal((await act(envK, 'status', { status: 'received', token: tok }, withCookie(DEV2))).status, 403, 'other device')
  const bad = [[{ status: 'sent' }, 'invalid_transition'], [{ status: 'delivered' }, 'invalid_transition'], [{ status: null }, 'invalid_transition'],
    [{ status: 'cancelled' }, 'invalid_reason'], [{ status: 'cancelled', reason: 'rude' }, 'invalid_reason'], [{ status: 'cancelled', reason: 'toString' }, 'invalid_reason'], [{ status: 'preparing', reason: 'busy' }, 'invalid_reason']]
  for (const [b, want] of bad) assert.equal((await (await act(envK, 'status', { ...b, token: tok }, withCookie(DEV))).json()).status, want, JSON.stringify(b))
  assert.equal(rpcCalls.length, 0)
  rpcImpl = () => json({ status: 'ok', changed: true, order_status: 'cancelled', next: [] })
  const res = await act(envK, 'status', { status: 'cancelled', reason: 'item_out', token: tok }, { ...withCookie(DEV), 'x-ada-worker-key': 'evil' })
  const j = await res.json()
  assert.equal(res.headers.get('cache-control'), 'no-store')
  assert.equal(j.status, 'ok'); assert.equal(j.orderStatus, 'cancelled'); assert.deepEqual(j.next, []); assert.match(j.statusAt, /^\d\d\.\d\d\.\d{4} \d\d:\d\d$/)
  assert.equal(rpcCalls[0].url, 'https://x.test/rest/v1/rpc/eatery_order_set_status')
  assert.deepEqual(JSON.parse(rpcCalls[0].init.body), { p_code: '7K3QX9MP', p_status: 'cancelled', p_reason: 'item_out', p_device: DEV })
  assert.equal(keyHeader(rpcCalls[0]), KEY)
  assert.ok(!rpcCalls[0].url.includes(DEV))
  rpcImpl = () => json({ status: 'ok', changed: true, order_status: 'received', next: ['preparing', 'on_the_way', 'cancelled'] })
  assert.deepEqual((await (await act(envK, 'status', { status: 'received', token: tok }, withCookie(DEV))).json()).next, ['preparing', 'on_the_way', 'cancelled'])
  assert.equal(JSON.parse(rpcCalls.at(-1).init.body).p_reason, null)
  for (const st of ['forbidden', 'not_found', 'disabled', 'frozen', 'invalid_transition', 'invalid_reason']) {
    rpcImpl = () => json({ status: st })
    assert.deepEqual(await (await act(envK, 'status', { status: 'received', token: tok }, withCookie(DEV))).json(), { status: st })
  }
  rpcImpl = () => { throw new Error('x') }
  assert.equal((await act(envK, 'status', { status: 'received', token: tok }, withCookie(DEV))).status, 503)
})

await test('/forget: clears the cookie (Max-Age=0), no RPC, returns an anon token', async () => {
  rpcImpl = () => json(stRow({ can_manage: true }))
  const tok = await tokenFor(envK, withCookie(DEV))
  rpcCalls = []
  const res = await act(envK, 'forget', { token: tok }, withCookie(DEV))
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('set-cookie'), `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/o/; Max-Age=0`)
  const j = await res.json()
  assert.equal(j.status, 'ok'); assert.notEqual(j.token, tok)
  assert.equal(rpcCalls.length, 0)
})

await test('timeline: Europe/Nicosia times (winter UTC+2), server page timeline, cancelled reason text, view=1 never manages', async () => {
  rpcImpl = () => json(okRow({ created_at: '2026-11-13T10:05:00Z', status_at: '2026-11-13T10:20:00Z', order_status: 'preparing', fulfilment: 'pickup', status_enabled: true, can_manage: true, next: ['ready', 'cancelled'] }))
  const j = await (await checkE(envK)).json()
  assert.equal(j.time, '13.11.2026 12:05'); assert.equal(j.statusAt, '13.11.2026 12:20')
  rpcCalls = []
  const html = await (await callE(envK, '/o/7K3QX9MP?view=1', 'GET', BROWSER, withCookie(DEV))).text()
  assert.deepEqual(JSON.parse(rpcCalls[0].init.body), { p_code: '7K3QX9MP' }, '?view=1 never sends the device')
  assert.equal(keyHeader(rpcCalls[0]), undefined)
  assert.match(html, /Sipariş durumu/)
  assert.match(html, /<div class="step done cur"><span class="dot"><\/span><div><span>Hazırlanıyor<\/span><span class="tm"> · 13\.11\.2026 12:20<\/span>/)
  assert.match(html, /Hazır, gelip alabilirsiniz/); assert.doesNotMatch(html, /Yolda/)
  assert.doesNotMatch(html, /<button|PIN ile giriş|İptal et/)
  rpcImpl = () => json(okRow({ order_status: 'cancelled', cancel_reason: 'no_delivery_there', status_at: '2026-11-13T10:20:00Z', status_enabled: true }))
  const c = await (await get('/o/7K3QX9MP')).text()
  assert.match(c, /İptal edildi · 13\.11\.2026 12:20/); assert.match(c, /Bu adrese teslimat yok/); assert.match(c, /No delivery to this address/)
  rpcImpl = () => json(okRow({ order_status: 'sent', fulfilment: null, status_enabled: true }))
  assert.match(await (await get('/o/7K3QX9MP')).text(), /Yolda \/ Hazır, gelip alabilirsiniz/)
  rpcImpl = () => json(okRow({ order_status: 'cancelled', cancel_reason: '<b>x</b>', status_enabled: true }))
  const e = await (await get('/o/7K3QX9MP')).text()
  assert.doesNotMatch(e, /<b>x<\/b>/)
})

// Client script in a stub DOM with buttons/inputs.
const clientRun = async (payload, responses = {}) => {
  const html = await (await plain('/o/7K3QX9MP')).text()
  const js = html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)[1]
  const mkEl = tag => ({ tag, children: [], className: '', set textContent(v) { this._t = v; this.children = [] }, get textContent() { return this._t }, appendChild(c) { this.children.push(c) }, set innerHTML(_) { throw new Error('innerHTML used') } })
  const box = mkEl('div'); const timers = []; const calls = []
  const doc = { visibilityState: 'visible', readyState: 'complete', getElementById: () => box, createElement: mkEl, addEventListener() {} }
  const fetchStub = (u, o) => { calls.push([u, o]); const k = u.split('/').pop(); const r = responses[k]; return Promise.resolve({ json: async () => (typeof r === 'function' ? r(o) : r ?? payload) }) }
  new Function('document', 'window', 'location', 'fetch', 'setTimeout', js)(doc, { addEventListener() {} }, { pathname: '/o/7K3QX9MP' }, fetchStub, (f, ms) => timers.push([f, ms]))
  timers[0][0](); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r))
  return { box, calls }
}
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)) }
const all = (n, out = []) => { out.push(n); for (const c of n.children || []) all(c, out); return out }
const texts = n => all(n).map(x => x._t).filter(Boolean)
const buttons = n => all(n).filter(x => x.tag === 'button')
const label = b => texts(b).join(' ')
const base = { status: 'ok', partner: 'P', orderNo: '7K3Q-X9MP', time: '13.11.2026 12:05', lines: [], total: '0', seenTr: 'tr', seenEn: 'en', isTest: false,
  orderStatus: 'sent', fulfilment: 'delivery', statusAt: '', cancelReason: null, statusShown: true, manage: false, pinable: false, next: [], frozen: false, old2h: false }

await test('client: customer view never has buttons; PIN link only with pinable AND a token; fetches use credentials same-origin', async () => {
  for (const p of [base, { ...base, next: ['received', 'cancelled'] }, { ...base, manage: 'true', next: ['received'] }, { ...base, pinable: true }, { ...base, pinable: true, token: undefined }]) {
    const { box, calls } = await clientRun(p)
    assert.equal(buttons(box).length, 0, JSON.stringify(p))
    assert.equal(calls[0][1].credentials, 'same-origin')
    assert.ok(texts(box).includes('Gönderildi'))
  }
  const { box } = await clientRun({ ...base, pinable: true, token: 'f'.repeat(64) })
  const b = buttons(box)
  assert.equal(b.length, 1); assert.equal(label(b[0]), 'Restoran mısınız? PIN ile giriş')
  const off = await clientRun({ ...base, statusShown: false })
  assert.ok(!texts(off.box).includes('Gönderildi'), 'no timeline when status is not in use')
})

await test('client: PIN flow posts the PIN in the JSON body only, then re-checks; errors shown; seen line kept', async () => {
  const tok = 'f'.repeat(64)
  let checks = 0
  const { box, calls } = await clientRun(null, {
    check: () => (++checks === 1 ? { ...base, pinable: true, token: tok } : { ...base, seenTr: 'tr2', manage: true, next: ['received', 'cancelled'], token: 'e'.repeat(64) }),
    pin: o => (JSON.parse(o.body).pin === PIN ? { status: 'ok', token: 'd'.repeat(64) } : { status: 'locked' }),
  })
  buttons(box)[0].onclick()
  const input = all(box).find(x => x.tag === 'input')
  assert.equal(input.inputMode, 'numeric'); assert.equal(input.autocomplete, 'one-time-code'); assert.equal(input.maxLength, 6)
  const signIn = buttons(box).find(b => label(b).startsWith('Giriş yap'))
  input.value = '12'; signIn.onclick(); await flush()
  assert.ok(texts(box).includes('6 haneli PIN girin'))
  input.value = '000000'; signIn.onclick(); await flush()
  assert.ok(texts(box).some(t => t.startsWith('Çok fazla hatalı deneme')))
  input.value = PIN; signIn.onclick(); await flush()
  for (const [u, o] of calls) { assert.ok(!u.includes(PIN), 'PIN in URL ' + u); assert.equal(o.credentials, 'same-origin') }
  const pinCalls = calls.filter(c => c[0] === '/o/7K3QX9MP/pin')
  assert.equal(pinCalls.length, 2)
  assert.deepEqual(JSON.parse(pinCalls[1][1].body), { pin: PIN, token: tok })
  assert.equal(pinCalls[1][1].headers['Content-Type'], 'application/json')
  assert.equal(checks, 2)
  assert.ok(texts(box).includes('tr'), 'first seen line kept after sign-in'); assert.ok(!texts(box).includes('tr2'))
  assert.deepEqual(buttons(box).map(label), ['Siparişi aldık Order received', 'İptal et Cancel', 'Bu cihazı unut · Forget this device'])
})

await test('client: restaurant buttons = next only; cancel needs a reason + confirm; 2 h warning; 12 h freeze; TEST label', async () => {
  const tok = 'f'.repeat(64)
  let posted = null
  const r1 = await clientRun({ ...base, manage: true, next: ['preparing', 'on_the_way', 'cancelled'], token: tok, old2h: true }, {
    status: o => { posted = JSON.parse(o.body); return { status: 'ok', changed: true, orderStatus: 'cancelled', next: [], statusAt: '13.11.2026 12:30', token: tok } },
  })
  assert.ok(texts(r1.box).includes('2 saatten eski sipariş — müşteriyle teyit edin'))
  assert.deepEqual(buttons(r1.box).map(label), ['Hazırlanıyor Preparing', 'Yolda On the way', 'İptal et Cancel', 'Bu cihazı unut · Forget this device'])
  buttons(r1.box)[2].onclick()
  const bs = buttons(r1.box)
  assert.deepEqual(bs.slice(0, 6).map(b => texts(b)[0]), ['Şu an kapalıyız', 'Çok yoğunuz', 'Ürün kalmadı', 'Bu adrese teslimat yok', 'Müşteriye ulaşılamadı', 'Diğer'])
  const confirm = bs.find(b => texts(b)[0] === 'Siparişi iptal et')
  assert.equal(confirm.disabled, true)
  confirm.onclick(); await flush(); assert.equal(posted, null, 'no reason picked: nothing sent')
  bs[1].onclick(); assert.equal(confirm.disabled, false)
  confirm.onclick(); await flush()
  assert.deepEqual(posted, { status: 'cancelled', reason: 'busy', token: tok })
  assert.ok(texts(r1.box).includes('İptal edildi · 13.11.2026 12:30')); assert.ok(texts(r1.box).includes('Çok yoğunuz'))
  assert.deepEqual(buttons(r1.box).map(label), ['Bu cihazı unut · Forget this device'], 'no undo')
  const fr = await clientRun({ ...base, manage: true, frozen: true, next: [], token: tok })
  assert.ok(texts(fr.box).includes('Durum artık değiştirilemez'))
  assert.deepEqual(buttons(fr.box).map(label), ['Bu cihazı unut · Forget this device'])
  const t = await clientRun({ ...base, isTest: true, manage: true, next: ['received'], token: tok })
  assert.ok(texts(t.box).includes('TEST SİPARİŞİ — hazırlamayın')); assert.ok(texts(t.box).includes('Sipariş durumu · TEST'))
  // retry: expired action token renewed via /token, then the action is re-sent once
  let n2 = 0
  const rr = await clientRun({ ...base, manage: true, next: ['received'], token: tok }, {
    status: () => (++n2 === 1 ? { status: 'retry' } : { status: 'ok', changed: true, orderStatus: 'received', next: ['cancelled'], statusAt: 'x', token: tok }),
    token: { status: 'ok', token: 'c'.repeat(64) },
  })
  buttons(rr.box)[0].onclick(); await flush()
  assert.deepEqual(rr.calls.map(c => c[0].split('/').pop()), ['check', 'status', 'token', 'status'])
  assert.equal(JSON.parse(rr.calls[3][1].body).token, 'c'.repeat(64))
  assert.deepEqual(buttons(rr.box).map(label), ['İptal et Cancel', 'Bu cihazı unut · Forget this device'])
  // already in that status (another phone, or a retried write that had committed): re-sync from /check, never a blank panel
  let nc = 0
  const same = await clientRun(null, {
    check: () => (++nc === 1 ? { ...base, manage: true, next: ['received', 'cancelled'], token: tok } : { ...base, orderStatus: 'received', manage: true, next: ['preparing', 'cancelled'], token: tok }),
    status: { status: 'ok', changed: false, orderStatus: 'received', next: [], statusAt: 'x', token: tok },
  })
  buttons(same.box)[0].onclick(); await flush()
  assert.equal(nc, 2)
  assert.deepEqual(buttons(same.box).map(label), ['Hazırlanıyor Preparing', 'İptal et Cancel', 'Bu cihazı unut · Forget this device'])
  // forget: panel gone, sign-in link back while the order is still open
  const fg = await clientRun({ ...base, manage: true, next: ['received'], token: tok }, { forget: { status: 'ok', token: 'b'.repeat(64) } })
  buttons(fg.box).at(-1).onclick(); await flush()
  assert.deepEqual(JSON.parse(fg.calls.at(-1)[1].body), { token: tok })
  assert.deepEqual(buttons(fg.box).map(label), ['Restoran mısınız? PIN ile giriş'])
})

globalThis.fetch = realFetch
console.log(`\n  ${n} tests passed`)
