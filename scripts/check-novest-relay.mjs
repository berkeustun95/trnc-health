#!/usr/bin/env node
// Offline proof of the Novest relay (ops/hermes/novest-relay/relay.mjs), server half: the real request handler
// driven with fake req/res, a stubbed upstream, an injected clock and log sink, plus one local TLS 1.3 round trip.
// No network, no keys (a throwaway cert is generated with openssl into the OS temp dir).
//
//   node scripts/check-novest-relay.mjs
//   node scripts/check-novest-relay.mjs --relay <alt.mjs>   # red-first: run against a broken copy
//   node scripts/check-novest-relay.mjs --client <alt.mjs>  # red-first: client cases against a broken copy of the client
//   node scripts/check-novest-relay.mjs --policy <alt.mjs>  # red-first: retry/gap cases against a broken copy of novest-fetch-policy

import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Readable } from 'node:stream'
import https from 'node:https'
import net from 'node:net'
import dns from 'node:dns'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ri = process.argv.indexOf('--relay')
const relayPath = ri !== -1 ? resolve(process.argv[ri + 1]) : join(ROOT, 'ops/hermes/novest-relay/relay.mjs')
const R = await import(pathToFileURL(relayPath).href)
const ci = process.argv.indexOf('--client')
const clientPath = ci !== -1 ? resolve(process.argv[ci + 1]) : join(ROOT, 'scripts/lib/novest-relay-client.mjs')
const C = await import(pathToFileURL(clientPath).href)
const pi = process.argv.indexOf('--policy')
const policyPath = pi !== -1 ? resolve(process.argv[pi + 1]) : join(ROOT, 'scripts/lib/novest-fetch-policy.mjs')
const P = await import(pathToFileURL(policyPath).href).catch(e => ({ loadError: e.code ?? e.message }))
const { setNovestFetch, get, getAll } = await import(pathToFileURL(join(ROOT, 'supabase/functions/_shared/novest-feed.mjs')).href)
const { createRelay, createSafeLookup, isBlockedAddress, makeUpstreamRequest, createServer } = R

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n      got    ${JSON.stringify(got)}\n      wanted ${JSON.stringify(want)}`}`)
}

const KEY = 'k-' + 'a1b2c3d4e5f60718293a4b5c6d7e8f90'.repeat(2)
const KEY_HASH = createHash('sha256').update(KEY).digest('hex')
const UA1 = 'ADA-TRNC-Health/1.0 (+https://getadaapp.com; partner listing sync; getadaapp@gmail.com)'
const UA2 = 'ADA-TRNC-Health/1.0 (+partner image mirror)'
const MB = 1024 * 1024
const sleep = ms => new Promise(r => setTimeout(r, ms))

const resp = (status, headers = {}, body = '') => {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body)
  const o = { statusCode: status, headers, destroyed: false, destroy() { o.destroyed = true } }
  o.body = Readable.from([buf])
  return o
}
const redirect = (loc, status = 302) => resp(status, { location: loc })

function mk({ up, limits = {}, now, lookup, key = KEY_HASH } = {}) {
  const calls = []
  const logs = []
  const relay = createRelay({
    keyHash: key,
    upstreamRequest: async (url, opts) => { calls.push({ url: url.href, headers: opts.headers, at: Date.now() }); return up(url, calls.length, opts) },
    lookup, now, log: l => logs.push(l), limits: { minGapMs: 0, ...limits },
  })
  return { relay, calls, logs }
}

async function call(relay, { method = 'GET', url = '/n/wp-json/wp/v2/properties?per_page=1', headers = {}, ip = '203.0.113.7', key = KEY, noUA = false } = {}) {
  const h = noUA ? { ...headers } : { 'user-agent': UA1, ...headers }
  if (key !== null) h.authorization = `Bearer ${key}`
  const req = Object.assign(Readable.from([]), { method, url, headers: h, socket: { remoteAddress: ip } })
  return new Promise(res => {
    const out = { status: 0, headers: {}, body: Buffer.alloc(0) }
    relay.handler(req, {
      writeHead(s, hd) { out.status = s; out.headers = hd },
      end(b) { out.body = Buffer.from(b ?? ''); res(out) },
    })
  })
}

const ok200 = () => resp(200, { 'content-type': 'application/json' }, '[]')
const errOf = r => [r.status, r.headers['x-relay-error'] ?? null]

console.log('constants and source-of-truth strings')
{
  const feed = readFileSync(join(ROOT, 'supabase/functions/_shared/novest-feed.mjs'), 'utf8')
  const mirror = readFileSync(join(ROOT, 'scripts/mirror-novest-images.mjs'), 'utf8')
  const feedUa = /const UA = '([^']+)'/.exec(feed)?.[1]
  const mirrorUa = /const MIRROR_UA = '([^']+)'/.exec(mirror)?.[1]
  t('feed UA read from novest-feed.mjs is in the relay list', R.ALLOWED_USER_AGENTS.includes(feedUa), true)
  t('mirror UA read from mirror-novest-images.mjs is in the relay list', R.ALLOWED_USER_AGENTS.includes(mirrorUa), true)
  t('relay list is exactly those two, in order', [...R.ALLOWED_USER_AGENTS], [feedUa, mirrorUa])
  t('hosts', [...R.ALLOWED_HOSTS], ['coldwellbankernovest.com', 'www.coldwellbankernovest.com'])
  t('path prefixes', [...R.ALLOWED_PATH_PREFIXES], ['/wp-json/wp/v2/properties', '/wp-json/wp/v2/media', '/wp-content/uploads/'])
  t('query keys', [...R.ALLOWED_QUERY_KEYS], ['per_page', 'page', 'orderby', 'order', 'include', '_fields'])
  t('allowlists are frozen', [R.ALLOWED_HOSTS, R.ALLOWED_PATH_PREFIXES, R.ALLOWED_QUERY_KEYS, R.ALLOWED_USER_AGENTS, R.DEFAULT_LIMITS].map(Object.isFrozen), [true, true, true, true, true])
  t('production limits', R.DEFAULT_LIMITS, { maxBytes: 16 * MB, connectMs: 10000, totalMs: 60000, maxInflight: 4, minGapMs: 150, dailyCap: 3000, maxHops: 3, authFails: 10, authWindowMs: 60000, authBlockMs: 600000, unauthMax: 120, unauthWindowMs: 60000 })
  t('port', R.PORT, 8443)
  let threw = false
  try { createRelay({ keyHash: 'nothex' }) } catch { threw = true }
  t('factory refuses a keyHash that is not 64 hex', threw, true)
}

console.log('method, auth, order of checks')
{
  const { relay, calls } = mk({ up: ok200 })
  for (const m of ['POST', 'PUT', 'HEAD', 'DELETE', 'OPTIONS', 'PATCH']) t(`${m} with key`, errOf(await call(relay, { method: m })), [405, 'method_not_allowed'])
  t('POST with no key is 405, not 401 (method first)', errOf(await call(relay, { method: 'POST', key: null })), [405, 'method_not_allowed'])
  t('HEAD with wrong key is 405', errOf(await call(relay, { method: 'HEAD', key: 'wrong' })), [405, 'method_not_allowed'])
  t('no key', errOf(await call(relay, { key: null })), [401, 'unauthorized'])
  t('wrong key', errOf(await call(relay, { key: 'wrong-key' })), [401, 'unauthorized'])
  t('Basic scheme is not Bearer', errOf(await call(relay, { key: null, headers: { authorization: `Basic ${KEY}` } })), [401, 'unauthorized'])
  t('wrong key on a forbidden path is 401, not 403 (auth before path)', errOf(await call(relay, { key: 'wrong', url: '/n/wp-admin/' })), [401, 'unauthorized'])
  t('wrong key with a bad UA is 401', errOf(await call(relay, { key: 'wrong', headers: { 'user-agent': 'x' } })), [401, 'unauthorized'])
  t('no upstream call was made by any of those', calls.length, 0)
  const good = await call(relay)
  t('right key', good.status, 200)
}

console.log('global limit on requests without a valid key')
{
  let clock = Date.UTC(2026, 10, 20, 12, 0, 0)
  const { relay, calls } = mk({ up: ok200, now: () => clock })
  const flood = []
  for (let i = 0; i < 130; i++) flood.push(errOf(await call(relay, { key: `bad${i}`, ip: `198.51.${100 + (i % 100)}.${1 + Math.floor(i / 100)}` })))
  t('first 120 bad-key requests (spread over IPs, none locked) are 401', flood.slice(0, 120).every(x => x[0] === 401 && x[1] === 'unauthorized'), true)
  t('requests 121..130 are 429 rate_limited', flood.slice(120).every(x => x[0] === 429 && x[1] === 'rate_limited'), true)
  const over = await call(relay, { key: null, ip: '192.0.2.50' })
  t('a keyless request over the limit is 429 with retry-after in 1..60', [over.status, /^([1-9]|[1-5][0-9]|60)$/.test(over.headers['retry-after'])], [429, true])
  const before = calls.length
  t('a valid-key request DURING the flood still gets 200 from the upstream', [(await call(relay, { ip: '192.0.2.51' })).status, calls.length], [200, before + 1])
  for (let i = 0; i < 50; i++) await call(relay, { ip: '192.0.2.52' })
  t('after 50 more valid-key requests the counter is unchanged: a bad one is still 429', [errOf(await call(relay, { key: 'x', ip: '192.0.2.53' }))], [[429, 'rate_limited']])
  clock += 59_000
  t('still limited 59 s into the window', errOf(await call(relay, { key: 'x', ip: '192.0.2.54' })), [429, 'rate_limited'])
  clock += 2_000
  t('the window resets once now advances: 401 again (positive control)', errOf(await call(relay, { key: 'x', ip: '192.0.2.55' })), [401, 'unauthorized'])
  const small = mk({ up: ok200, limits: { unauthMax: 2 } })
  t('the cap is the limits option (unauthMax: 2)', [(await call(small.relay, { key: 'a', ip: '192.0.2.60' })).status, (await call(small.relay, { key: 'b', ip: '192.0.2.61' })).status, (await call(small.relay, { key: 'c', ip: '192.0.2.62' })).status], [401, 401, 429])
}

console.log('per-IP lockout')
{
  let clock = Date.UTC(2026, 10, 20, 12, 0, 0)
  const { relay } = mk({ up: ok200, now: () => clock })
  const bads = []
  for (let i = 0; i < 10; i++) bads.push((await call(relay, { key: `bad${i}`, ip: '198.51.100.1' })).status)
  t('first 10 bad auths from one IP are 401', bads, Array(10).fill(401))
  t('11th bad auth is 429 rate_limited', errOf(await call(relay, { key: 'bad', ip: '198.51.100.1' })), [429, 'rate_limited'])
  t('a wrong key from the locked IP is still 429', errOf(await call(relay, { key: 'bad', ip: '198.51.100.1' })), [429, 'rate_limited'])
  t('no key from the locked IP is still 429', errOf(await call(relay, { key: null, ip: '198.51.100.1' })), [429, 'rate_limited'])
  t('the right key from the locked IP gets through (the key is checked before the lockout)', (await call(relay, { ip: '198.51.100.1' })).status, 200)
  t('per IP only: another IP with the right key still works (positive control)', (await call(relay, { ip: '198.51.100.2' })).status, 200)
  t('per IP only: another IP is not locked after the first IP', (await call(relay, { key: 'bad', ip: '198.51.100.3' })).status, 401)
  clock += 9 * 60_000
  t('still locked after 9 minutes (wrong key)', (await call(relay, { key: 'bad', ip: '198.51.100.1' })).status, 429)
  clock += 2 * 60_000
  t('unlocked after 10 minutes (positive control)', (await call(relay, { ip: '198.51.100.1' })).status, 200)
  const s = []
  for (let i = 0; i < 9; i++) s.push((await call(relay, { key: 'bad', ip: '198.51.100.9' })).status)
  clock += 61_000
  for (let i = 0; i < 9; i++) s.push((await call(relay, { key: 'bad', ip: '198.51.100.9' })).status)
  t('failures older than a minute do not count: 18 spread fails stay 401', s, Array(18).fill(401))
  t('IPv4-mapped IPv6 peer is the same client as the IPv4', (await call(relay, { key: 'bad', ip: '::ffff:198.51.100.9' })).status, 401)
}

console.log('path, query, user agent')
{
  const { relay, calls } = mk({ up: ok200 })
  const U = u => call(relay, { url: u })
  const forbidden = {
    'outside the allowlist': '/n/wp-admin/',
    'users endpoint': '/n/wp-json/wp/v2/users',
    'prefix lookalike': '/n/wp-json/wp/v2/propertiesX',
    'not under /n/': '/wp-json/wp/v2/properties',
    'empty path': '/n/',
    'bare uploads dir': '/n/wp-content/uploads/',
    '.. traversal': '/n/wp-content/uploads/../../wp-config.php',
    '.. at the start': '/n/../wp-admin/',
    '%2e%2e': '/n/wp-content/uploads/%2e%2e/%2e%2e/wp-config.php',
    '%2E%2E': '/n/wp-content/uploads/%2E%2E/wp-config.php',
    '%2f': '/n/wp-content/uploads/a%2fb.jpg',
    '%2F': '/n/wp-content/uploads/a%2Fb.jpg',
    '%5c': '/n/wp-content/uploads/a%5cb.jpg',
    'backslash': '/n/wp-content/uploads/a\\b.jpg',
    'dot segment': '/n/wp-content/uploads/a/./b.jpg',
    'protocol-relative host': '/n//evil.example/wp-content/uploads/x.jpg',
    'NUL byte': '/n/wp-content/uploads/a%00.jpg',
    'space': '/n/wp-content/uploads/a b.jpg',
    'fragment': '/n/wp-content/uploads/a.jpg#x',
  }
  for (const [name, u] of Object.entries(forbidden)) t(`403 ${name}`, errOf(await U(u)), [403, 'forbidden_path'])
  t('no upstream call for any refused path', calls.length, 0)
  for (const u of ['/n/wp-json/wp/v2/properties?per_page=1', '/n/wp-json/wp/v2/properties/123', '/n/wp-json/wp/v2/media?include=1,2,3&_fields=id,source_url', '/n/wp-json/wp/v2/media/77',
    '/n/wp-content/uploads/2026/11/a-b_c%20d-1536x2048.jpeg', '/n/wp-json/wp/v2/properties?per_page=100&page=2&orderby=date&order=desc']) {
    t(`200 ${u}`, (await U(u)).status, 200)
  }
  const badQ = {
    'unknown key': '/n/wp-json/wp/v2/properties?foo=1',
    'one good, one bad': '/n/wp-json/wp/v2/properties?per_page=1&evil=2',
    'key case': '/n/wp-json/wp/v2/properties?PER_PAGE=1',
    'bad value': '/n/wp-json/wp/v2/properties?include=1;2',
    'uploads take no query': '/n/wp-content/uploads/a.jpg?x=1',
    'uploads with empty query': '/n/wp-content/uploads/a.jpg?per_page=1',
  }
  for (const [name, u] of Object.entries(badQ)) t(`400 ${name}`, errOf(await U(u)), [400, 'bad_query'])
  t('wrong UA', errOf(await call(relay, { headers: { 'user-agent': 'curl/8.0' } })), [400, 'bad_user_agent'])
  t('UA with a suffix', errOf(await call(relay, { headers: { 'user-agent': UA2 + ' ' } })), [400, 'bad_user_agent'])
  t('UA lowercased', errOf(await call(relay, { headers: { 'user-agent': UA2.toLowerCase() } })), [400, 'bad_user_agent'])
  const before = calls.length
  t('UA 1 accepted', (await call(relay, { headers: { 'user-agent': UA1 } })).status, 200)
  t('UA 2 accepted', (await call(relay, { headers: { 'user-agent': UA2 } })).status, 200)
  t('no UA is refused', errOf(await call(relay, { noUA: true })), [400, 'bad_user_agent'])
  t('UA forwarded verbatim', [calls[before].headers['User-Agent'], calls[before + 1].headers['User-Agent'], calls.length - before], [UA1, UA2, 2])
  await call(relay, { headers: { accept: 'image/*', cookie: 'a=b', 'x-forwarded-for': '1.2.3.4', 'x-api-key': 'z', 'accept-language': 'tr', host: 'evil.example' } })
  t('only Accept and UA(+identity encoding) are sent upstream', Object.keys(calls.at(-1).headers).sort(), ['Accept', 'Accept-Encoding', 'User-Agent'])
  t('the upstream URL is the mapped Novest URL', (await call(relay, { url: '/n/wp-json/wp/v2/properties?page=2&per_page=1' }), calls.at(-1).url), 'https://coldwellbankernovest.com/wp-json/wp/v2/properties?page=2&per_page=1')
}

console.log('response shape')
{
  const { relay } = mk({ up: () => resp(200, {
    'content-type': 'application/json; charset=UTF-8', 'content-length': '5', 'x-wp-total': '42', 'x-wp-totalpages': '5',
    'set-cookie': 'sid=1; HttpOnly', server: 'LiteSpeed', 'cache-control': 'public, max-age=999', etag: '"x"', 'content-encoding': 'gzip', 'x-powered-by': 'PHP',
  }, 'hello') })
  const r = await call(relay)
  t('status and body pass through', [r.status, r.body.toString()], [200, 'hello'])
  t('x-wp-total / x-wp-totalpages pass through', [r.headers['x-wp-total'], r.headers['x-wp-totalpages']], ['42', '5'])
  t('content-type and content-length pass through', [r.headers['content-type'], r.headers['content-length']], ['application/json; charset=UTF-8', '5'])
  t('x-relay-bytes is the body size', r.headers['x-relay-bytes'], '5')
  t('cache-control is no-store (upstream value dropped)', r.headers['cache-control'], 'no-store')
  t('Set-Cookie dropped', Object.keys(r.headers).filter(k => /set-cookie/i.test(k)), [])
  t('only the allowed headers plus relay headers are present', Object.keys(r.headers).sort(), ['cache-control', 'content-length', 'content-type', 'x-content-type-options', 'x-relay-bytes', 'x-relay-source', 'x-wp-total', 'x-wp-totalpages'])
  const n = mk({ up: () => resp(404, { 'content-type': 'text/html', 'x-wp-total': 'abc' }, '<h1>nf</h1>') })
  const r2 = await call(n.relay)
  t('upstream 404 passes through with its body', [r2.status, r2.body.toString(), r2.headers['x-relay-error'] ?? null], [404, '<h1>nf</h1>', null])
  t('non-numeric x-wp-total dropped', r2.headers['x-wp-total'] ?? null, null)
  const e = mk({ up: () => resp(500, {}, 'boom') })
  t('upstream 500 passes through', (await call(e.relay)).status, 500)
  const big = Buffer.alloc(16 * MB, 7)
  const exact = mk({ up: () => resp(200, { 'content-type': 'image/jpeg' }, big) })
  const rx = await call(exact.relay, { url: '/n/wp-content/uploads/a.jpg' })
  t('a body of exactly 16 MB passes, x-relay-bytes correct', [rx.status, rx.headers['x-relay-bytes'], rx.body.length], [200, String(16 * MB), 16 * MB])
}

console.log('x-relay-source and retry-after')
{
  const src = async (up, opts) => (await call(mk({ up }).relay, opts)).headers
  t('upstream answer is marked x-relay-source: upstream', (await src(ok200))['x-relay-source'], 'upstream')
  t('upstream 429 is marked upstream too', (await src(() => resp(429, {}, 'slow')))['x-relay-source'], 'upstream')
  for (const [name, opts, want] of [
    ['405', { method: 'POST' }, 'method_not_allowed'], ['401', { key: 'wrong' }, 'unauthorized'], ['403', { url: '/n/wp-admin/' }, 'forbidden_path'],
    ['400 bad_query', { url: '/n/wp-json/wp/v2/properties?x=1' }, 'bad_query'], ['400 bad_user_agent', { headers: { 'user-agent': 'x' } }, 'bad_user_agent'],
  ]) { const h = await src(ok200, opts); t(`own refusal ${name} is marked relay`, [h['x-relay-source'], h['x-relay-error']], ['relay', want]) }
  t('own 502 (redirect_refused) is marked relay', (await src(() => redirect('https://evil.example/x')))['x-relay-source'], 'relay')
  t('own 500 (internal) is marked relay', (await src(() => { throw new Error('x') }))['x-relay-source'], 'relay')
  const busy = mk({ up: () => new Promise(() => {}), limits: { maxInflight: 1, totalMs: 100 } })
  const first = call(busy.relay)
  await sleep(10)
  const bh = (await call(busy.relay)).headers
  t('own busy is marked relay', [bh['x-relay-source'], bh['x-relay-error']], ['relay', 'busy'])
  await first
  const cap = mk({ up: ok200, limits: { dailyCap: 1 } })
  await call(cap.relay)
  t('own daily_cap is marked relay', (await call(cap.relay)).headers['x-relay-source'], 'relay')
  const flood = mk({ up: ok200 })
  for (let i = 0; i < 10; i++) await call(flood.relay, { key: 'wrong' })
  const rl = (await call(flood.relay, { key: 'wrong' })).headers
  t('own rate_limited is marked relay and keeps its own retry-after', [rl['x-relay-source'], rl['x-relay-error'], /^\d+$/.test(rl['retry-after'] ?? '')], ['relay', 'rate_limited', true])

  const IMF = 'Wed, 21 Oct 2026 07:28:00 GMT'
  const ra = async v => (await src(() => resp(429, { 'retry-after': v }, 'slow')))['retry-after'] ?? null
  t('retry-after seconds is forwarded', await ra('7'), '7')
  t('retry-after 0 is forwarded', await ra('0'), '0')
  t('retry-after 6 digits is forwarded', await ra('123456'), '123456')
  t('retry-after HTTP-date is forwarded', await ra(IMF), IMF)
  for (const [name, v] of [['letters', 'soon'], ['7 digits', '1234567'], ['negative', '-5'], ['decimal', '1.5'], ['padded', ' 7'], ['empty', ''],
    ['control chars', '5\r\nx-evil: 1'], ['overlong', '9'.repeat(300)], ['non-GMT date', 'Wed, 21 Oct 2026 07:28:00 PST'], ['date plus junk', `${IMF} extra`], ['overlong spaces', IMF + ' '.repeat(200)]])
    t(`retry-after ${name} is dropped`, await ra(v), null)
  const noRa = await src(ok200)
  t('no retry-after upstream -> none forwarded', noRa['retry-after'] ?? null, null)
  t('retry-after on a 200 is forwarded as well', (await src(() => resp(200, { 'retry-after': '3' }, '[]')))['retry-after'], '3')
}

console.log('relay errors never carry upstream text')
{
  const { relay } = mk({ up: () => redirect('https://evil.example/UPSTREAM-SECRET-TEXT') })
  const r = await call(relay)
  t('redirect refusal body is exactly the JSON code', r.body.toString(), '{"error":"redirect_refused"}')
  t('content-type json', r.headers['content-type'], 'application/json')
}

console.log('redirects')
{
  const H = 'https://coldwellbankernovest.com'
  const refused = [502, 'redirect_refused']
  const to = loc => mk({ up: (u, n) => (n === 1 ? redirect(loc) : ok200()) })
  const cases = {
    'to another host': 'https://evil.example/wp-content/uploads/a.jpg',
    'to a lookalike host': 'https://coldwellbankernovest.com.evil.example/wp-content/uploads/a.jpg',
    'to http': 'http://coldwellbankernovest.com/wp-content/uploads/a.jpg',
    'to an allowed host on another port': `${H}:8443/wp-content/uploads/a.jpg`,
    'with userinfo': 'https://coldwellbankernovest.com@evil.example/wp-content/uploads/a.jpg',
    'to a path outside the allowlist': `${H}/wp-admin/`,
    'to a traversal path': `${H}/wp-content/uploads/%2e%2e/wp-config.php`,
    'to a path with an encoded slash': `${H}/wp-content/uploads/a%2fb.jpg`,
    'to a bad query key': `${H}/wp-json/wp/v2/properties?evil=1`,
    'to uploads with a query': `${H}/wp-content/uploads/a.jpg?x=1`,
    'to a protocol-relative other host': '//evil.example/wp-content/uploads/a.jpg',
    'to an empty Location': '',
    'to an IP literal': 'https://127.0.0.1/wp-content/uploads/a.jpg',
  }
  for (const [name, loc] of Object.entries(cases)) {
    const m = to(loc)
    t(`${name} -> 502 redirect_refused, no second call`, [errOf(await call(m.relay)), m.calls.length], [refused, 1])
  }
  const f1 = to(`${H}/wp-content/uploads/a.jpg`)
  const r1 = await call(f1.relay)
  t('absolute in-allowlist redirect is followed', [r1.status, f1.calls.map(c => c.url)], [200, [`${H}/wp-json/wp/v2/properties?per_page=1`, `${H}/wp-content/uploads/a.jpg`]])
  const f2 = to('/wp-content/uploads/b.jpg')
  t('relative in-allowlist redirect is followed', [(await call(f2.relay)).status, f2.calls.at(-1).url], [200, `${H}/wp-content/uploads/b.jpg`])
  const f3 = to('https://www.coldwellbankernovest.com/wp-content/uploads/c.jpg')
  t('redirect to the www host is followed', [(await call(f3.relay)).status, f3.calls.at(-1).url], [200, 'https://www.coldwellbankernovest.com/wp-content/uploads/c.jpg'])
  const chain = k => mk({ up: (u, n) => (n <= k ? redirect(`${H}/wp-content/uploads/h${n}.jpg`) : ok200()) })
  const c3 = chain(3)
  t('3 redirects are followed (4 upstream calls)', [(await call(c3.relay)).status, c3.calls.length], [200, 4])
  const c4 = chain(4)
  t('the 4th redirect hop is refused', [errOf(await call(c4.relay)), c4.calls.length], [refused, 4])
  const lg = chain(2)
  await call(lg.relay)
  t('hops are logged', / hops=2 /.test(lg.logs[0]), true)
  const seen = []
  const d = mk({ up: (u, n) => { const o = n === 1 ? redirect(`${H}/wp-content/uploads/q.jpg`) : ok200(); seen.push(o); return o } })
  await call(d.relay)
  t('a redirect response is destroyed, not read', seen[0].destroyed, true)
}

console.log('upstream address guard (DNS rebinding)')
{
  const fake = addrs => (host, opts, cb) => cb(null, addrs.map(a => ({ address: a, family: a.includes(':') ? 6 : 4 })))
  const lk = a => new Promise(res => createSafeLookup(fake(Array.isArray(a) ? a : [a]))('coldwellbankernovest.com', {}, (e, addr) => res(e ? e.code : addr)))
  for (const a of ['127.0.0.1', '127.255.255.254', '169.254.169.254', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '100.127.255.255', '0.0.0.0', '0.1.2.3',
    '224.0.0.1', '255.255.255.255', '192.0.0.8', '198.18.0.1', '::1', '::', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:169.254.169.254', '::ffff:192.168.0.1', '::ffff:100.64.0.1',
    'fc00::1', 'fd12:3456::1', 'fe80::1', 'febf::1', 'ff02::1', '::127.0.0.1', '64:ff9b::7f00:1', '2002::1', '2002:808:808::1', '2002:ffff:ffff:ffff::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '2001::1', '2001:0000:1::1', 'not-an-ip']) {
    t(`refuses ${a}`, await lk(a), 'EBLOCKED')
  }
  for (const a of ['8.8.8.8', '104.21.0.1', '100.63.255.255', '100.128.0.1', '172.15.0.1', '172.32.0.1', '2606:4700::1111', '2a00:1450:4001::1', '::ffff:8.8.8.8', '2001:4860:4860::8888', '2001:1::1', '2001:ffff::1', '2003::1', '2001:0001::1']) {
    t(`allows ${a} (positive control)`, await lk(a), a)
  }
  t('one private answer among public ones refuses the lot', await lk(['8.8.8.8', '10.0.0.1']), 'EBLOCKED')
  t('all:true mode returns the list when clean', await new Promise(res => createSafeLookup(fake(['8.8.8.8', '2606:4700::1111']))('h', { all: true }, (e, l) => res(l.map(x => x.address)))), ['8.8.8.8', '2606:4700::1111'])
  t('all:true mode still refuses', await new Promise(res => createSafeLookup(fake(['127.0.0.1']))('h', { all: true }, e => res(e.code))), 'EBLOCKED')
  t('a resolver error passes through', await new Promise(res => createSafeLookup((h, o, cb) => cb(Object.assign(new Error('x'), { code: 'ENOTFOUND' })))('h', {}, e => res(e.code))), 'ENOTFOUND')
  t('isBlockedAddress(non-string)', isBlockedAddress(undefined), true)
  const viaUp = (addr) => mk({ lookup: createSafeLookup(fake([addr])), up: (u, n, o) => new Promise((res, rej) => o.lookup(u.hostname, {}, (e) => (e ? rej(e) : res(ok200())))) })
  t('relay hands its lookup to the upstream: loopback answer -> 502 upstream_connect', errOf(await call(viaUp('127.0.0.1').relay)), [502, 'upstream_connect'])
  t('relay hands its lookup to the upstream: public answer -> 200 (positive control)', (await call(viaUp('104.21.0.1').relay)).status, 200)
}

console.log('limits')
{
  const slow = mk({ up: () => new Promise(() => {}), limits: { totalMs: 60 } })
  t('slow upstream (never answers) -> 504 upstream_timeout', errOf(await call(slow.relay)), [504, 'upstream_timeout'])
  let stalled
  const stall = mk({ up: () => { stalled = resp(200); stalled.body = new Readable({ read() {} }); return stalled }, limits: { totalMs: 60 } })
  t('upstream that stalls mid-body -> 504, stream destroyed', [errOf(await call(stall.relay)), stalled.body.destroyed], [[504, 'upstream_timeout'], true])
  const ct = mk({ up: () => { throw Object.assign(new Error('x'), { code: 'CONNECT_TIMEOUT' }) } })
  t('connect timeout -> 504 upstream_timeout', errOf(await call(ct.relay)), [504, 'upstream_timeout'])
  const cf = mk({ up: () => { throw Object.assign(new Error('boom text'), { code: 'ECONNREFUSED' }) } })
  const cfr = await call(cf.relay)
  t('connection failure -> 502 upstream_connect, no upstream text', [errOf(cfr), cfr.body.toString()], [[502, 'upstream_connect'], '{"error":"upstream_connect"}'])

  let pushed = 0
  const huge = mk({ up: () => {
    const o = resp(200); let n = 0
    o.body = new Readable({ read() { if (n++ < 40) { pushed++; this.push(Buffer.alloc(MB)) } else this.push(null) } })
    huge.o = o; return o
  } })
  t('body over 16 MB -> 502 too_large', errOf(await call(huge.relay, { url: '/n/wp-content/uploads/a.jpg' })), [502, 'too_large'])
  await sleep(20)
  t('  the stream was aborted well before the end', [huge.o.body.destroyed, pushed < 40], [true, true])
  const cl = mk({ up: () => resp(200, { 'content-length': String(16 * MB + 1) }, 'x') })
  t('Content-Length over 16 MB is refused up front', errOf(await call(cl.relay)), [502, 'too_large'])

  let release
  const gate = new Promise(r => { release = r })
  const busy = mk({ up: async () => { await gate; return ok200() } })
  const four = [1, 2, 3, 4].map(() => call(busy.relay))
  await sleep(30)
  t('5th concurrent request -> 429 busy', errOf(await call(busy.relay)), [429, 'busy'])
  t('  only 4 reached the upstream', busy.calls.length, 4)
  release()
  t('  the 4 in flight complete', (await Promise.all(four)).map(r => r.status), [200, 200, 200, 200])
  t('  a new request is accepted afterwards (positive control)', (await call(busy.relay)).status, 200)

  const gap = mk({ up: ok200, limits: { minGapMs: 120 } })
  await Promise.all([call(gap.relay), call(gap.relay), call(gap.relay)])
  const at = gap.calls.map(c => c.at)
  t('upstream calls are spaced by the minimum gap', [at[1] - at[0] >= 110, at[2] - at[1] >= 110], [true, true])
  t('queued calls all succeed', gap.calls.length, 3)

  let clock = Date.UTC(2026, 10, 20, 23, 59, 0)
  const cap = mk({ up: ok200, limits: { dailyCap: 3 }, now: () => clock })
  const rs = []
  for (let i = 0; i < 4; i++) rs.push(errOf(await call(cap.relay)))
  t('4th upstream call of the UTC day -> 429 daily_cap', rs, [[200, null], [200, null], [200, null], [429, 'daily_cap']])
  t('  no upstream call was made for the refused one', cap.calls.length, 3)
  clock += 2 * 60_000
  t('  the counter resets at UTC midnight (positive control)', (await call(cap.relay)).status, 200)
  const capRedir = mk({ up: (u, n) => (n < 3 ? redirect('https://coldwellbankernovest.com/wp-content/uploads/z.jpg') : ok200()), limits: { dailyCap: 2 } })
  t('every redirect hop counts toward the cap', errOf(await call(capRedir.relay)), [429, 'daily_cap'])
}

console.log('logging')
{
  const { relay, logs } = mk({ up: ok200 })
  const secretQ = 'per_page=1234567&_fields=secretfieldname&include=998877'
  await call(relay, { url: `/n/wp-json/wp/v2/properties?${secretQ}`, headers: { 'user-agent': UA1, cookie: 'sess=COOKIEVALUE', accept: 'application/json' } })
  await call(relay, { key: 'WRONGKEYVALUE', url: '/n/wp-json/wp/v2/properties?per_page=7' })
  await call(relay, { method: 'POST' })
  await call(relay, { url: '/n/wp-admin/?x=SECRETQ' })
  await call(relay, { url: '/n/wp-content/uploads/2026/11/a.jpg' })
  const all = logs.join('\n')
  t('one line per request', logs.length, 5)
  t('the key is never logged', all.includes(KEY) || all.includes('WRONGKEYVALUE'), false)
  t('the query string is never logged', ['per_page=', 'secretfieldname', '1234567', '998877', 'SECRETQ', '_fields'].some(s => all.includes(s)), false)
  t('headers are never logged', ['COOKIEVALUE', 'sess=', 'getadaapp', 'application/json', 'Bearer'].some(s => all.includes(s)), false)
  t('line shape: time, ip, method, path, q length, status, bytes, ms, hops, err',
    /^\d{4}-\d\d-\d\dT[\d:.]+Z 203\.0\.113\.7 GET \/n\/wp-json\/wp\/v2\/properties q=\d+ 200 2B \d+ms hops=0 err=-$/.test(logs[0]), true)
  t('query LENGTH is logged', logs[0].includes(`q=${secretQ.length} `), true)
  t('an error line carries its code', / 401 .* err=unauthorized$/.test(logs[1]) && / 405 .* err=method_not_allowed$/.test(logs[2]) && / 403 .* err=forbidden_path$/.test(logs[3]), true)
  t('unauthenticated requests log no path (nothing attacker-chosen before auth)', / GET - q=0 401 /.test(logs[1]), true)
}

console.log('real upstream function and TLS 1.3 server (local, throwaway cert)')
{
  const dir = mkdtempSync(join(tmpdir(), 'novest-relay-test-'))
  try {
    const g = spawnSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'),
      '-days', '2', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'], { encoding: 'utf8' })
    if (g.status !== 0) { console.log(g.stderr); throw new Error('openssl could not generate the throwaway cert') }
    const key = readFileSync(join(dir, 'k.pem')), cert = readFileSync(join(dir, 'c.pem'))
    const listen = s => new Promise(res => s.listen(0, '127.0.0.1', () => res(s.address().port)))

    const origin = https.createServer({ key, cert }, (req, res) => { res.writeHead(200, { 'content-type': 'text/plain', 'x-echo-ua': String(req.headers['user-agent']) }); res.end('origin-bytes') })
    const oport = await listen(origin)
    const permissive = (h, o, cb) => (o.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4))
    const up = makeUpstreamRequest({ ca: cert })
    const direct = await up(new URL(`https://localhost:${oport}/x`), { headers: { 'User-Agent': UA2 }, lookup: permissive })
    const bytes = []; for await (const c of direct.body) bytes.push(c)
    t('makeUpstreamRequest does a real GET (positive control)', [direct.statusCode, Buffer.concat(bytes).toString(), direct.headers['x-echo-ua']], [200, 'origin-bytes', UA2])
    const refusedLookup = await up(new URL(`https://localhost:${oport}/x`), { headers: {}, lookup: createSafeLookup(dns.lookup) }).then(() => 'connected', e => e.code)
    t('makeUpstreamRequest with the safe lookup refuses localhost (real DNS, no network needed)', refusedLookup, 'EBLOCKED')

    const hole = net.createServer(() => {})
    const hport = await listen(hole)
    const t0 = Date.now()
    const ctCode = await makeUpstreamRequest({ ca: cert, connectMs: 150 })(new URL(`https://127.0.0.1:${hport}/x`), { headers: {} }).then(() => 'connected', e => e.code)
    t('connect/handshake timeout -> CONNECT_TIMEOUT', [ctCode, Date.now() - t0 < 2000], ['CONNECT_TIMEOUT', true])
    hole.close(); hole.closeAllConnections?.()

    const relay = createRelay({ keyHash: KEY_HASH, upstreamRequest: async () => ok200(), log: () => {}, limits: { minGapMs: 0 } })
    const srv = createServer(relay, { key, cert })
    const sport = await listen(srv)
    const req = (extra, withKey) => new Promise(res => {
      const r = https.request({ host: '127.0.0.1', port: sport, path: '/n/wp-json/wp/v2/properties?per_page=1', ca: cert, servername: 'localhost', headers: withKey ? { authorization: `Bearer ${KEY}`, 'user-agent': UA1 } : {}, ...extra }, rs => {
        rs.resume(); rs.on('end', () => res(rs.statusCode))
      })
      r.on('error', e => res(e.code ?? e.message)); r.end()
    })
    t('TLS 1.3 without a key -> 401', await req({ minVersion: 'TLSv1.3' }, false), 401)
    t('TLS 1.3 with the key -> 200 (positive control)', await req({ minVersion: 'TLSv1.3' }, true), 200)
    const old = await req({ maxVersion: 'TLSv1.2' }, true)
    t('TLS 1.2 client is refused', typeof old === 'string' && old !== '200', true)

    // End to end, query built EXACTLY as novest-feed.mjs get() / mirror-novest-images.mjs do (URL + searchParams.set,
    // which encodes commas as %2C): client relayFetch -> real TLS relay -> stubbed upstream.
    const seenUp = []
    const relay2 = createRelay({ keyHash: KEY_HASH, log: () => {}, limits: { minGapMs: 0 },
      upstreamRequest: async url => { seenUp.push(url); return resp(200, { 'content-type': 'application/json', 'x-wp-totalpages': '1' }, '[]') } })
    const srv2 = createServer(relay2, { key, cert })
    const s2port = await listen(srv2)
    const env1 = { u: process.env.NOVEST_RELAY_URL, k: process.env.NOVEST_RELAY_KEY, c: process.env.NOVEST_RELAY_CA }
    Object.assign(process.env, { NOVEST_RELAY_URL: `https://127.0.0.1:${s2port}`, NOVEST_RELAY_KEY: KEY, NOVEST_RELAY_CA: cert.toString() })
    const clientUrl = (path, params) => {
      const u = new URL('https://coldwellbankernovest.com/wp-json/wp/v2' + path)
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v))
      return u
    }
    const viaClient = async (path, params) => {
      const n = seenUp.length
      const r = await C.relayFetch(clientUrl(path, params), { headers: { 'User-Agent': UA1, Accept: 'application/json' } }).then(x => x.status, e => e.message)
      return { r, up: seenUp.slice(n) }
    }
    const ids = n => Array.from({ length: n }, (_, i) => 20000 + i * 7)
    const mediaParams = list => ({ include: list.join(','), _fields: 'id,source_url,mime_type,media_details', per_page: 100, page: 1 })
    const batch = ids(100)
    const m100 = await viaClient('/media', mediaParams(batch))
    t('media batch of 100 five-digit ids through relayFetch -> 200', m100.r, 200)
    t('  the upstream received all 100 ids, in order, plus _fields/per_page/page',
      [m100.up.length === 1 && m100.up[0].searchParams.get('include'), m100.up[0]?.searchParams.get('_fields'), m100.up[0]?.searchParams.get('per_page'), m100.up[0]?.searchParams.get('page')],
      [batch.join(','), 'id,source_url,mime_type,media_details', '100', '1'])
    const big = ids(100).map(i => 9_000_000_000 + i)
    t('100 ten-digit ids (worst case) -> 200', (await viaClient('/media', mediaParams(big))).r, 200)
    t('101 ids -> relay error 400 bad_query', (await viaClient('/media', mediaParams(ids(101)))).r, 'relay refused: bad_query (400)')
    t('a non-digit in include -> 400', (await viaClient('/media', mediaParams(['123', '45a']))).r, 'relay refused: bad_query (400)')
    t('an empty include element (1,,2) -> 400', (await viaClient('/media', mediaParams(['1', '', '2']))).r, 'relay refused: bad_query (400)')
    t('an 11-digit id -> 400', (await viaClient('/media', mediaParams(['12345678901']))).r, 'relay refused: bad_query (400)')
    t('properties page query (orderby=modified&order=desc&per_page=100&page=2) -> 200', (await viaClient('/properties', { orderby: 'modified', order: 'desc', per_page: 100, page: 2 })).r, 200)
    t('prune probe get(/properties, per_page=1) -> 200', (await viaClient('/properties', { per_page: 1 })).r, 200)
    for (const [k, v] of [['u', 'NOVEST_RELAY_URL'], ['k', 'NOVEST_RELAY_KEY'], ['c', 'NOVEST_RELAY_CA']]) { if (env1[k] === undefined) delete process.env[v]; else process.env[v] = env1[k] }
    srv2.close(); srv2.closeAllConnections?.()
    for (const s of [origin, srv]) { s.close(); s.closeAllConnections?.() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

console.log('client: route resolution')
{
  const full = { NOVEST_RELAY_URL: 'https://203.0.113.9:8443', NOVEST_RELAY_KEY: 'k', NOVEST_RELAY_CA: 'c' }
  const r = (env) => { try { return C.resolveNovestRoute(env) } catch { return 'THROWS' } }
  const D = { GITHUB_EVENT_NAME: 'workflow_dispatch' }, S = { GITHUB_EVENT_NAME: 'schedule' }
  for (const [v, d, sch] of [[undefined, 'direct', 'direct'], ['', 'direct', 'direct'], ['direct', 'direct', 'direct'], ['relay', 'relay', 'relay'], ['relay-dispatch', 'relay', 'direct']]) {
    const base = v === undefined ? {} : { NOVEST_ROUTE: v }
    t(`NOVEST_ROUTE=${v === undefined ? '(unset)' : JSON.stringify(v)} -> dispatch ${d}, schedule ${sch}`, [r({ ...full, ...base, ...D }), r({ ...full, ...base, ...S })], [d, sch])
  }
  t('direct/unset needs no relay secrets', [r({ ...D }), r({ NOVEST_ROUTE: 'direct', ...S })], ['direct', 'direct'])
  for (const bad of ['Relay', 'relay ', 'dispatch', 'on', 'true', 'relay,direct']) t(`NOVEST_ROUTE=${JSON.stringify(bad)} throws`, r({ ...full, NOVEST_ROUTE: bad, ...D }), 'THROWS')
  for (const route of ['relay', 'relay-dispatch'])
    for (const k of ['NOVEST_RELAY_URL', 'NOVEST_RELAY_KEY', 'NOVEST_RELAY_CA'])
      for (const ev of [D, S]) { const e = { ...full, NOVEST_ROUTE: route, ...ev }; delete e[k]; t(`${route} without ${k} (${ev.GITHUB_EVENT_NAME}) throws, never silently direct`, r(e), 'THROWS') }
  for (const u of ['http://203.0.113.9:8443', 'https://203.0.113.9:8443/x', 'https://203.0.113.9:8443/?a=1', 'https://u:p@203.0.113.9:8443', 'not a url'])
    t(`relay URL ${JSON.stringify(u)} throws`, r({ ...full, NOVEST_ROUTE: 'relay', NOVEST_RELAY_URL: u, ...D }), 'THROWS')
  t('relay URL https://host:port/ is accepted', r({ ...full, NOVEST_ROUTE: 'relay', NOVEST_RELAY_URL: 'https://203.0.113.9:8443/', ...D }), 'relay')
  t('client cap equals the relay cap', [C.RELAY_RESPONSE_CAP, C.RELAY_RESPONSE_CAP === R.DEFAULT_LIMITS.maxBytes], [16 * MB, true])
}

console.log('client: relayFetch against a local TLS 1.3 stub (throwaway certs)')
{
  const dir = mkdtempSync(join(tmpdir(), 'novest-relay-client-'))
  const env0 = { ...process.env }
  try {
    const gen = n => {
      const g = spawnSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', join(dir, `${n}k.pem`), '-out', join(dir, `${n}c.pem`),
        '-days', '2', '-subj', '/CN=stub', '-addext', 'subjectAltName=IP:127.0.0.1'], { encoding: 'utf8' })
      if (g.status !== 0) throw new Error('openssl could not generate the throwaway cert')
      return { key: readFileSync(join(dir, `${n}k.pem`)), cert: readFileSync(join(dir, `${n}c.pem`)) }
    }
    const good = gen('a'), other = gen('b')
    const seen = []
    let maxSent = 0
    const photo = Buffer.alloc(5000, 7)
    const stub = https.createServer({ key: good.key, cert: good.cert, minVersion: 'TLSv1.3' }, (req, res) => {
      seen.push({ url: req.url, names: Object.keys(req.headers), auth: req.headers.authorization, ua: req.headers['user-agent'], accept: req.headers.accept })
      const send = (status, headers, body) => { const b = Buffer.from(body); maxSent = Math.max(maxSent, b.length); res.writeHead(status, headers); res.end(b) }
      const u = new URL(req.url, 'https://x')
      if (u.pathname === '/n/wp-json/wp/v2/properties') {
        const page = Number(u.searchParams.get('page') ?? 1)
        if (page === 9) return send(401, { 'x-relay-error': 'unauthorized', 'content-type': 'application/json' }, '{"error":"unauthorized"}')
        return send(200, { 'content-type': 'application/json', 'x-wp-total': '3', 'x-wp-totalpages': '2' }, JSON.stringify([{ id: page * 10 }, { id: page * 10 + 1 }]))
      }
      if (u.pathname === '/n/wp-json/wp/v2/media') return send(200, { 'content-type': 'application/json', 'x-wp-total': '1' }, '[{"id":1}]')
      if (u.pathname === '/n/wp-json/wp/v2/missing') return send(404, { 'content-type': 'application/json', 'x-wp-totalpages': '0' }, '{"code":"rest_no_route"}')
      if (u.pathname === '/n/wp-json/wp/v2/busy') return send(429, { 'x-relay-error': 'busy', 'x-relay-source': 'relay', 'content-type': 'application/json', 'retry-after': '7' }, '{"error":"busy"}')
      if (u.pathname === '/n/wp-json/wp/v2/daily') return send(429, { 'x-relay-error': 'daily_cap', 'x-relay-source': 'relay', 'content-type': 'application/json', 'retry-after': 'soon' }, '{"error":"daily_cap"}')
      if (u.pathname === '/n/wp-json/wp/v2/oldbusy') return send(429, { 'x-relay-error': 'busy', 'content-type': 'application/json' }, '{"error":"busy"}')
      if (u.pathname === '/n/wp-json/wp/v2/novest429') return send(429, { 'x-relay-source': 'upstream', 'retry-after': '12', 'content-type': 'application/json', 'x-wp-totalpages': '0' }, '{}')
      if (u.pathname === '/n/wp-json/wp/v2/oldnovest429') return send(429, { 'content-type': 'application/json', 'x-wp-totalpages': '0' }, '{}')
      if (u.pathname === '/n/wp-json/wp/v2/badra') return send(429, { 'x-relay-source': 'upstream', 'retry-after': '9999999', 'content-type': 'application/json', 'x-wp-totalpages': '0' }, '{}')
      if (u.pathname === '/n/wp-json/wp/v2/dateall') return send(503, { 'x-relay-source': 'weird', 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT', 'content-type': 'application/json', 'x-wp-totalpages': '0' }, '{}')
      if (u.pathname === '/n/wp-content/uploads/a.jpg') return send(200, { 'content-type': 'image/jpeg' }, photo)
      send(500, {}, 'x')
    })
    await new Promise(r => stub.listen(0, '127.0.0.1', r))
    const port = stub.address().port
    const hostport = `127.0.0.1:${port}`
    const set = (ca, p = port) => { Object.assign(process.env, { NOVEST_RELAY_URL: `https://127.0.0.1:${p}`, NOVEST_RELAY_KEY: 'stub-key', NOVEST_RELAY_CA: ca.toString() }) }
    const fx = (url, init) => C.relayFetch(url, init).then(r => ({ ok: r }), e => ({ err: e.message }))
    const UAx = 'ADA-TRNC-Health/1.0 (+partner image mirror)'
    set(good.cert)

    for (const u of ['http://coldwellbankernovest.com/wp-content/uploads/a.jpg', 'https://evil.example/wp-content/uploads/a.jpg', 'https://coldwellbankernovest.com.evil.example/a', 'https://coldwellbankernovest.com:444/a', 'https://user@coldwellbankernovest.com/a', 'nonsense']) {
      t(`relayFetch refuses ${u}`, (await fx(u, {})).err?.startsWith('relay: ') === true, true)
    }
    t('  nothing reached the stub for refused URLs', seen.length, 0)

    const ok = await fx('https://coldwellbankernovest.com/wp-content/uploads/a.jpg', { headers: { 'User-Agent': UAx, Accept: 'image/*', Cookie: 'leak=1', 'X-Other': '1' } })
    t('photo: a real Response, status 200, bytes intact', [ok.ok instanceof Response, ok.ok?.status, ok.ok && Buffer.from(await ok.ok.arrayBuffer()).equals(photo)], [true, 200, true])
    t('  stub saw exactly /n/<path>, the bearer, UA and Accept and no other client header',
      [seen[0].url, seen[0].auth, seen[0].ua, seen[0].accept, seen[0].names.filter(n => !['authorization', 'user-agent', 'accept', 'host', 'connection'].includes(n))],
      ['/n/wp-content/uploads/a.jpg', 'Bearer stub-key', UAx, 'image/*', []])
    const www = await fx('https://www.coldwellbankernovest.com/wp-content/uploads/a.jpg', { headers: { 'User-Agent': UAx } })
    t('www. host is accepted', www.ok?.status, 200)

    setNovestFetch(C.relayFetch)
    const g1 = await get('/properties', { per_page: 1 })
    t('x-wp-total / x-wp-totalpages reach get()', [g1.total, g1.totalPages, g1.body.length, seen.at(-1).url], [3, 2, 2, '/n/wp-json/wp/v2/properties?per_page=1'])
    const all = await getAll('/properties')
    t('getAll paginates through the relay (2 pages)', all.map(x => x.id), [10, 11, 20, 21])
    const noPages = await fx('https://coldwellbankernovest.com/wp-json/wp/v2/media?include=1', {})
    t('2xx under /wp-json without x-wp-totalpages THROWS', noPages.err ?? 'resolved', 'relay response lacks x-wp-totalpages (refusing to paginate blind)')
    t('getAll over such a response rejects instead of stopping at page 1', await getAll('/media', { include: '1' }).then(() => 'resolved', () => 'rejected'), 'rejected')
    const nf = await fx('https://coldwellbankernovest.com/wp-json/wp/v2/missing', {})
    t('an upstream 404 is passed on as a Response (get() reports it)', nf.ok?.status, 404)
    t('relay own error -> "relay refused: <code> (<status>)"', (await fx('https://coldwellbankernovest.com/wp-json/wp/v2/properties?page=9', {})).err, 'relay refused: unauthorized (401)')
    t('largestResponseBytes is the largest body seen', C.largestResponseBytes(), maxSent)

    const refused = async p => { try { await C.relayFetch(`https://coldwellbankernovest.com/wp-json/wp/v2/${p}`, {}); return null } catch (e) { return e } }
    const eb = await refused('busy')
    t('refusal message names the code and status', eb?.message, 'relay refused: busy (429)')
    t('refusal carries structured fields', [eb?.relayError, eb?.status, eb?.retryAfter], ['busy', 429, '7'])
    const ed = await refused('daily')
    t('daily_cap refusal: invalid retry-after is dropped to null', [ed?.message, ed?.relayError, ed?.status, ed?.retryAfter], ['relay refused: daily_cap (429)', 'daily_cap', 429, null])
    const eo = await refused('oldbusy')
    t('old relay (no x-relay-source): x-relay-error still the refusal signal', [eo?.message, eo?.relayError, eo?.retryAfter], ['relay refused: busy (429)', 'busy', null])
    const eu = await refused('properties?page=9')
    t('401 refusal fields', [eu?.relayError, eu?.status], ['unauthorized', 401])
    const n429 = await fx('https://coldwellbankernovest.com/wp-json/wp/v2/novest429', {})
    t('upstream 429 resolves with retry-after and x-relay-source copied', [n429.ok?.status, n429.ok?.headers.get('retry-after'), n429.ok?.headers.get('x-relay-source')], [429, '12', 'upstream'])
    t('  statusText says via relay', /\(via relay\)$/.test(n429.ok?.statusText ?? ''), true)
    const o429 = await fx('https://coldwellbankernovest.com/wp-json/wp/v2/oldnovest429', {})
    t('old relay upstream 429 (no source/retry-after) still resolves as a Response', [o429.ok?.status, o429.ok?.headers.get('retry-after'), o429.ok?.headers.get('x-relay-source')], [429, null, null])
    const b429 = await fx('https://coldwellbankernovest.com/wp-json/wp/v2/badra', {})
    t('overlong retry-after is not copied', b429.ok?.headers.get('retry-after'), null)
    const d503 = await fx('https://coldwellbankernovest.com/wp-json/wp/v2/dateall', {})
    t('HTTP-date retry-after copied, unknown x-relay-source value not copied', [d503.ok?.headers.get('retry-after'), d503.ok?.headers.get('x-relay-source')], ['Wed, 21 Oct 2026 07:28:00 GMT', null])
    t('a 200 stays free of the via-relay suffix', ok.ok?.statusText.includes('via relay'), false)

    const msgs = []
    set(other.cert)
    const pinned = await fx('https://coldwellbankernovest.com/wp-content/uploads/a.jpg', {})
    msgs.push(pinned.err)
    t('a different cert is rejected by the pin', /^relay TLS pin rejected \([A-Z0-9_]+\)$/.test(pinned.err ?? ''), true)
    stub.close(); stub.closeAllConnections?.()
    set(good.cert)
    const down = await fx('https://coldwellbankernovest.com/wp-content/uploads/a.jpg', {})
    msgs.push(down.err, eb?.message, ed?.message, eo?.message, eu?.message)
    t('a closed port -> relay unreachable (ECONNREFUSED)', down.err, 'relay unreachable (ECONNREFUSED)')
    set(good.cert, 1)
    msgs.push((await fx('https://coldwellbankernovest.com/wp-content/uploads/a.jpg', {})).err)
    t('error text never contains the relay host or port', msgs.some(m => !m || m.includes('127.0.0.1') || m.includes(hostport) || m.includes(String(port)) || m.includes('stub-key')), false)
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in env0)) delete process.env[k]
    Object.assign(process.env, env0)
    rmSync(dir, { recursive: true, force: true })
  }
}

console.log('prune is refused on the relay route (subprocess, no Supabase key, no network)')
{
  const env = { PATH: process.env.PATH, HOME: process.env.HOME ?? '', NOVEST_ROUTE: 'relay', NOVEST_RELAY_URL: 'https://192.0.2.1:8443', NOVEST_RELAY_KEY: 'dummy-key', NOVEST_RELAY_CA: 'dummy-ca' }
  const run = (extra, flags) => spawnSync(process.execPath, [join(ROOT, 'scripts/mirror-novest-images.mjs'), ...flags], { env: { ...env, ...extra }, encoding: 'utf8', timeout: 20000, cwd: tmpdir() })
  const r = run({}, ['--prune', '--dry'])
  t('relay + --prune exits 1 with the refusal', [r.status, r.stderr.includes('REFUSED: prune runs only on the direct route (NOVEST_ROUTE is relay for this run)'), r.stdout.includes('route:')], [1, true, false])
  const r2 = run({ NOVEST_ROUTE: 'relay-dispatch', GITHUB_EVENT_NAME: 'workflow_dispatch' }, ['--prune', '--dry'])
  t('relay-dispatch resolving to relay + --prune is refused too', [r2.status, r2.stderr.includes('REFUSED: prune runs only on the direct route')], [1, true])
}

console.log('systemd unit hardening (static)')
{
  const unit = readFileSync(join(ROOT, 'ops/hermes/novest-relay/novest-relay.service'), 'utf8')
  const lineOf = d => unit.split('\n').filter(l => l.trim() === d)
  for (const d of ['ProtectKernelTunables=yes', 'ProtectKernelModules=yes', 'ProtectKernelLogs=yes', 'ProtectControlGroups=yes', 'ProtectClock=yes', 'ProtectHostname=yes', 'RestrictNamespaces=yes', 'RestrictRealtime=yes', 'RestrictSUIDSGID=yes',
    'LockPersonality=yes', 'SystemCallArchitectures=native', 'UMask=0077', 'ProtectProc=invisible', 'NoNewPrivileges=yes', 'ProtectSystem=strict', 'PrivateDevices=yes', 'CapabilityBoundingSet='])
    t(`unit has exactly one ${d}`, lineOf(d).length, 1)
  t('unit has no MemoryDenyWriteExecute (V8 JIT needs W+X)', /MemoryDenyWriteExecute/.test(unit), false)
  t('unit has no ProcSubset (Node/libuv read /proc/meminfo, /proc/stat; unverified under pid)', /ProcSubset/.test(unit), false)
}

console.log('fetch policy: media gap resolution')
if (P.loadError) t('novest-fetch-policy.mjs loads', P.loadError, 'loaded')
else {
  const g = (v, route) => { try { return P.resolveMediaGapMs(v === undefined ? {} : { NOVEST_MEDIA_GAP_MS: v }, route) } catch { return 'THROWS' } }
  t('unset on relay -> 10000 default', g(undefined, 'relay'), { ms: 10000, source: 'default' })
  t('empty on relay -> 10000 default', g('', 'relay'), { ms: 10000, source: 'default' })
  t('unset on direct -> 0 default', g(undefined, 'direct'), { ms: 0, source: 'default' })
  t('empty on direct -> 0 default', g('', 'direct'), { ms: 0, source: 'default' })
  t('5000 ok on relay', g('5000', 'relay'), { ms: 5000, source: 'env' })
  t('0 ok on relay (explicit no gap)', g('0', 'relay'), { ms: 0, source: 'env' })
  t('60000 ok on direct', g('60000', 'direct'), { ms: 60000, source: 'env' })
  for (const bad of ['-1', '60001', '1.5', 'abc', ' 5', '5 ', '1e3', '0x10', '007', '+5', '100000']) t(`NOVEST_MEDIA_GAP_MS=${JSON.stringify(bad)} throws`, g(bad, 'relay'), 'THROWS')
}

console.log('fetch policy: retry rules, budget, waits, log')
if (P.loadError) t('novest-fetch-policy.mjs loads', P.loadError, 'loaded')
else {
  const SECRET_URL = 'https://203.0.113.9:8443/'
  const mkPolicy = (script, { route = 'relay', gap = 0 } = {}) => {
    const st = { calls: [], sleeps: [], logs: [], clock: Date.UTC(2026, 10, 21, 12, 0, 0) }
    let i = 0
    const base = async (url, init) => {
      st.calls.push({ url: String(url), at: st.clock })
      const step = typeof script === 'function' ? script(st.calls.length, String(url)) : script[Math.min(i++, script.length - 1)]
      if (step instanceof Error) throw step
      if (step instanceof Response) return step
      return new Response('x', { status: step })
    }
    const f = P.createRetryingFetch({ fetch: base, route, mediaGapMs: gap, sleep: async ms => { st.sleeps.push(ms); st.clock += ms }, now: () => st.clock, log: l => st.logs.push(l) })
    return { f, st }
  }
  const r429 = (h = {}) => new Response('x', { status: 429, headers: h })
  const refusal = (code, status = 429, retryAfter = null) => Object.assign(new Error(`relay refused: ${code} (${status})`), { relayError: code, status, retryAfter })
  const outcome = async p => p.then(r => r.status, e => e.message)
  const MEDIA = 'https://coldwellbankernovest.com/wp-json/wp/v2/media?include=1,2&_fields=id'
  const PROPS = 'https://coldwellbankernovest.com/wp-json/wp/v2/properties?per_page=100&page=1'
  const IMG = 'https://coldwellbankernovest.com/wp-content/uploads/a.jpg'

  const a = mkPolicy([429, 200])
  t('Novest 429 (relay route) then 200 -> resolves 200, 2 base calls', [await outcome(a.f(PROPS, {})), a.st.calls.length], [200, 2])
  const d = mkPolicy([429, 200], { route: 'direct' })
  t('Novest 429 (direct route) is retried too', [await outcome(d.f(PROPS, {})), d.st.calls.length], [200, 2])
  const b = mkPolicy([refusal('busy'), 200])
  t('relay refusal busy IS retried', [await outcome(b.f(PROPS, {})), b.st.calls.length], [200, 2])
  const ok1 = mkPolicy([200]); await ok1.f(PROPS, {})
  t('200 -> one call, no sleep, no log', [ok1.st.calls.length, ok1.st.sleeps, ok1.st.logs], [1, [], []])

  for (const [name, step] of [['daily_cap', refusal('daily_cap')], ['rate_limited', refusal('rate_limited', 429, '30')], ['unauthorized', refusal('unauthorized', 401)], ['bad_user_agent', refusal('bad_user_agent', 400)],
    ['upstream_timeout', refusal('upstream_timeout', 504)], ['unknown refusal code', refusal('unknown')], ['network error', Object.assign(new Error('relay unreachable (ECONNREFUSED)'), { code: 'ECONNREFUSED' })]]) {
    const x = mkPolicy([step, 200])
    const r = await outcome(x.f(PROPS, {}))
    t(`${name}: not retried, base called once, error passes through unchanged`, [typeof r === 'string' && r === step.message, x.st.calls.length, x.st.sleeps], [true, 1, []])
  }
  for (const code of [500, 502, 503, 404, 401, 403]) {
    const x = mkPolicy([code, 200])
    t(`HTTP ${code} resolved: returned as is, base called once`, [await outcome(x.f(PROPS, {})), x.st.calls.length, x.st.sleeps], [code, 1, []])
  }

  const bu = mkPolicy([429, 200, 429, 200, 429, 200, 429, 429])
  const res = []
  for (const u of [PROPS, MEDIA, IMG]) res.push(await outcome(bu.f(u, {})))
  t('budget: 3 retries succeed across 3 different requests', [res, bu.st.calls.length], [[200, 200, 200], 6])
  t('  waits follow the shared count: 10 s, 20 s, 40 s', bu.st.sleeps, [10000, 20000, 40000])
  const four = await outcome(bu.f(PROPS, {}))
  t('4th 429 in the run fails with the budget message (relay)', four, 'Novest answered 429 via relay on /wp-json/wp/v2/properties (Retry-After: none); retry budget used 3/3')
  t('  total base calls = 7, no sleep for the failing one', [bu.st.calls.length, bu.st.sleeps.length], [7, 3])
  const after = await outcome(bu.f(IMG, {}))
  t('  after exhaustion even a later 429 fails at once (no new budget)', after.startsWith?.('Novest answered 429 via relay on /wp-content/uploads/a.jpg'), true)

  const bd = mkPolicy([429, 429, 429, 429], { route: 'direct' })
  t('direct route exhaustion names the source', await outcome(bd.f(MEDIA, {})), 'Novest answered 429 (direct) on /wp-json/wp/v2/media (Retry-After: none); retry budget used 3/3')
  t('  one request used 4 calls and slept 10/20/40', [bd.st.calls.length, bd.st.sleeps], [4, [10000, 20000, 40000]])
  const bb = mkPolicy([refusal('busy', 429, '2'), refusal('busy'), refusal('busy'), refusal('busy')])
  t('busy exhaustion says relay refused: busy and the budget', await outcome(bb.f(PROPS, {})), 'relay refused: busy (429) on /wp-json/wp/v2/properties (Retry-After: none); retry budget used 3/3')
  t('  busy waits: Retry-After 2 honoured, then 20 s and 40 s backoff by shared count', bb.st.sleeps, [2000, 20000, 40000])

  const conc = mkPolicy(n => (n <= 4 ? 429 : 200), { route: 'relay' })
  const rs = await Promise.all([1, 2, 3, 4].map(i => outcome(conc.f(`https://coldwellbankernovest.com/wp-content/uploads/${i}.jpg`, {}))))
  t('4 concurrent workers share one counter: at most 3 retries in total', [rs.filter(r => r === 200).length, rs.filter(r => typeof r === 'string' && r.includes('retry budget used 3/3')).length], [3, 1])
  t('  concurrent retry sleeps used distinct counts 10/20/40', [...conc.st.sleeps].sort((x, y) => x - y), [10000, 20000, 40000])

  const clamp = async (h, route = 'relay') => { const x = mkPolicy([r429(h), 200], { route }); await x.f(PROPS, {}); return x.st.sleeps[0] }
  t('Retry-After 0 -> clamped up to 1 s', await clamp({ 'retry-after': '0' }), 1000)
  t('Retry-After 7 -> 7 s', await clamp({ 'retry-after': '7' }), 7000)
  t('Retry-After 999 -> clamped to 60 s', await clamp({ 'retry-after': '999' }), 60000)
  t('Retry-After HTTP-date 25 s ahead -> 25 s', await clamp({ 'retry-after': new Date(Date.UTC(2026, 10, 21, 12, 0, 25)).toUTCString() }), 25000)
  t('Retry-After HTTP-date in the past -> 1 s', await clamp({ 'retry-after': new Date(Date.UTC(2026, 10, 21, 11, 0, 0)).toUTCString() }), 1000)
  t('Retry-After HTTP-date far ahead -> 60 s', await clamp({ 'retry-after': new Date(Date.UTC(2026, 10, 21, 18, 0, 0)).toUTCString() }), 60000)
  t('invalid Retry-After (soon) -> 10 s backoff', await clamp({ 'retry-after': 'soon' }), 10000)
  t('unparseable HTTP-date Retry-After -> 10 s backoff', await clamp({ 'retry-after': 'Mon, 99 Jan 2026 99:99:99 GMT' }), 10000)
  t('overlong Retry-After -> 10 s backoff', await clamp({ 'retry-after': '9999999' }), 10000)
  t('direct route honours Retry-After too', await clamp({ 'retry-after': '5' }, 'direct'), 5000)
  const bk = mkPolicy([429, 429, 429, 200], { route: 'direct' })
  await bk.f(PROPS, {})
  t('missing Retry-After backoff 10/20/40 s', bk.st.sleeps, [10000, 20000, 40000])
  const mixed = mkPolicy([r429({ 'retry-after': '3' }), 429, 200])
  await mixed.f(PROPS, {})
  t('backoff index is the shared retry count, not the attempt without a header', mixed.st.sleeps, [3000, 20000])

  const lg = mkPolicy([r429({ 'retry-after': '7', 'x-relay-source': 'upstream' }), 429, 200])
  await lg.f(MEDIA, {})
  t('log line on each 429, before waiting: route, path only, Retry-After, wait, retries', lg.st.logs, [
    'novest 429 route=relay path=/wp-json/wp/v2/media Retry-After: 7 wait=7s retries 1/3',
    'novest 429 route=relay path=/wp-json/wp/v2/media Retry-After: none wait=20s retries 2/3'])
  const lb = mkPolicy([refusal('busy'), 200])
  await lb.f(PROPS, {})
  t('log line for a relay busy refusal', lb.st.logs, ['novest relay refused busy route=relay path=/wp-json/wp/v2/properties Retry-After: none wait=10s retries 1/3'])
  const all = [...lg.st.logs, ...lb.st.logs, ...bu.st.logs, ...four.split('\n')].join('\n')
  t('logs and errors carry no query string, relay URL, key or CA', [/[?&]include|_fields|per_page|203\.0\.113|8443|stub-key|BEGIN CERT/.test(all), all.includes(SECRET_URL)], [false, false])
  const ev = mkPolicy([r429(), 429, 429, 429])
  const ee = await ev.f(MEDIA, {}).then(() => null, e => e)
  t('budget error carries no query either', [ee?.message.includes('include'), ee?.message.includes('?')], [false, false])

  const gp = mkPolicy([200, 200, 200, 200, 200], { gap: 10000 })
  await gp.f(MEDIA, {})
  t('gap: the first /media request does not wait', gp.st.sleeps, [])
  await gp.f(MEDIA, {})
  t('gap: a second /media request right after waits the full gap', gp.st.sleeps, [10000])
  gp.st.clock += 4000
  await gp.f(MEDIA, {})
  t('gap: only the remaining time is waited (4 s already passed)', gp.st.sleeps, [10000, 6000])
  gp.st.clock += 15000
  await gp.f(MEDIA, {})
  t('gap: nothing to wait once the gap has passed', gp.st.sleeps, [10000, 6000])
  await gp.f(PROPS, {}); await gp.f(IMG, {})
  t('gap: /properties and image downloads never wait', gp.st.sleeps, [10000, 6000])
  const g0 = mkPolicy([200, 200, 200], { gap: 0 })
  await g0.f(MEDIA, {}); await g0.f(MEDIA, {})
  t('gap 0 -> no wait at all (direct today)', g0.st.sleeps, [])

  const wired = readFileSync(policyPath, 'utf8')
  t('policy lib uses Node built-ins only', /^\s*import\b(?![^\n]*node:)/m.test(wired), false)
}

console.log('sync-novest default fetch is untouched')
{
  const feedPath = join(ROOT, 'supabase/functions/_shared/novest-feed.mjs')
  const fresh = await import(`${pathToFileURL(feedPath).href}?bust=${Date.now()}`)
  const realFetch = globalThis.fetch
  let n = 0
  globalThis.fetch = async () => { n++; return new Response('{}', { status: 429, statusText: 'Too Many Requests', headers: { 'retry-after': '1' } }) }
  let msg
  try { await fresh.get('/properties', { per_page: 1 }) } catch (e) { msg = e.message } finally { globalThis.fetch = realFetch }
  t('fresh feed module, default fetch, 429 -> get() throws "-> 429" after exactly one call', [/-> 429 Too Many Requests$/.test(msg ?? ''), n], [true, 1])
  const src = readFileSync(feedPath, 'utf8')
  t('feed source: default hook is the plain global fetch and mentions no retry/policy', [src.includes('let fetchImpl = (u, i) => fetch(u, i)'), /retry|novest-fetch-policy|x-relay-source/i.test(src)], [true, false])
}

console.log('client wiring in the sources')
{
  const read = f => readFileSync(join(ROOT, f), 'utf8')
  const mirror = read('scripts/mirror-novest-images.mjs'), feedSrc = read('supabase/functions/_shared/novest-feed.mjs'), setup = read('ops/hermes/novest-relay/provision.sh')
  t('mirror: empty-feed guard right after the feed read', /await getAll\('\/properties'[^\n]*\nif \(feed\.length === 0\) fail\('feed returned 0 listings: refusing to report clean'\)/.test(mirror), true)
  t('mirror: route resolved, printed, relay installed and size line on exit', [/resolveNovestRoute\(process\.env\)/.test(mirror), mirror.includes('console.log(`route: ${route}`)'), mirror.includes('setNovestFetch(novestFetch)'), /process\.on\('exit'[^\n]*largest relay response: \$\{largestResponseBytes\(\)\} bytes \(cap \$\{RELAY_RESPONSE_CAP\}\)/.test(mirror)], [true, true, true, true])
  t('mirror: images use the routed fetch with the unchanged User-Agent', [mirror.includes(`const MIRROR_UA = '${UA2}'`), mirror.includes('await novestFetch(url, { headers: { \'User-Agent\': MIRROR_UA } })')], [true, true])
  t('mirror: ONE retrying instance over the route fetch serves feed, media and images; gap resolved after the route and printed',
    [mirror.includes("const baseFetch = route === 'relay' ? relayFetch : (u, i) => fetch(u, i)"), (mirror.match(/createRetryingFetch\(/g) ?? []).length, /resolveNovestRoute\(process\.env\)[\s\S]*?resolveMediaGapMs\(process\.env, route\)/.test(mirror), mirror.includes('media lookup gap: ${gap.ms} ms (${gap.source})'), /resolveMediaGapMs\(process\.env, route\)[^\n]*::error::/.test(mirror), mirror.includes('imageFetch')],
    [true, 1, true, true, true, false])
  t('shared feed: UA unchanged, hook defaults to global fetch, no node: import', [feedSrc.includes(`const UA = '${UA1}'`), feedSrc.includes('let fetchImpl = (u, i) => fetch(u, i)'), /^\s*import .*node:/m.test(feedSrc)], [true, true, false])
  t('mirror: prune refused on the relay route, after pruneRefusal and before prodWriteGuard', /pruneRefusal\(\{ prune, env: process\.env \}\)[\s\S]*?pruneRouteRefusal\(\{ prune, route \}\)[\s\S]*?prodWriteGuard\(\{/.test(mirror), true)
  t('provision.sh sends both User-Agents and expects 400 for curl default', [setup.includes(`FEED_UA='${UA1}'`), setup.includes(`IMG_UA='${UA2}'`), /curl's default User-Agent with key" 400/.test(setup)], [true, true, true])
}

console.log(bad ? `\n${bad} check(s) FAILED` : '\nall checks passed')
process.exit(bad ? 1 : 0)
