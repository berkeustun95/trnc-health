#!/usr/bin/env node
// Offline proof of the Novest relay (ops/hermes/novest-relay/relay.mjs), server half: the real request handler
// driven with fake req/res, a stubbed upstream, an injected clock and log sink, plus one local TLS 1.3 round trip.
// No network, no keys (a throwaway cert is generated with openssl into the OS temp dir).
//
//   node scripts/check-novest-relay.mjs
//   node scripts/check-novest-relay.mjs --relay <alt.mjs>   # red-first: run against a broken copy
//   node scripts/check-novest-relay.mjs --client <alt.mjs>  # red-first: client cases against a broken copy of the client

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
  t('production limits', R.DEFAULT_LIMITS, { maxBytes: 16 * MB, connectMs: 10000, totalMs: 60000, maxInflight: 4, minGapMs: 150, dailyCap: 3000, maxHops: 3, authFails: 10, authWindowMs: 60000, authBlockMs: 600000 })
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

console.log('per-IP lockout')
{
  let clock = Date.UTC(2026, 10, 20, 12, 0, 0)
  const { relay } = mk({ up: ok200, now: () => clock })
  const bads = []
  for (let i = 0; i < 10; i++) bads.push((await call(relay, { key: `bad${i}`, ip: '198.51.100.1' })).status)
  t('first 10 bad auths from one IP are 401', bads, Array(10).fill(401))
  t('11th bad auth is 429 rate_limited', errOf(await call(relay, { key: 'bad', ip: '198.51.100.1' })), [429, 'rate_limited'])
  t('the right key from the locked IP is also 429', errOf(await call(relay, { ip: '198.51.100.1' })), [429, 'rate_limited'])
  t('per IP only: another IP with the right key still works (positive control)', (await call(relay, { ip: '198.51.100.2' })).status, 200)
  t('per IP only: another IP is not locked after the first IP', (await call(relay, { key: 'bad', ip: '198.51.100.3' })).status, 401)
  clock += 9 * 60_000
  t('still locked after 9 minutes', (await call(relay, { ip: '198.51.100.1' })).status, 429)
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
  t('only the allowed headers plus relay headers are present', Object.keys(r.headers).sort(), ['cache-control', 'content-length', 'content-type', 'x-content-type-options', 'x-relay-bytes', 'x-wp-total', 'x-wp-totalpages'])
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
    'fc00::1', 'fd12:3456::1', 'fe80::1', 'febf::1', 'ff02::1', '::127.0.0.1', '64:ff9b::7f00:1', 'not-an-ip']) {
    t(`refuses ${a}`, await lk(a), 'EBLOCKED')
  }
  for (const a of ['8.8.8.8', '104.21.0.1', '100.63.255.255', '100.128.0.1', '172.15.0.1', '172.32.0.1', '2606:4700::1111', '2a00:1450:4001::1', '::ffff:8.8.8.8']) {
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
    t('101 ids -> relay error 400 bad_query', (await viaClient('/media', mediaParams(ids(101)))).r, 'relay error 400 bad_query')
    t('a non-digit in include -> 400', (await viaClient('/media', mediaParams(['123', '45a']))).r, 'relay error 400 bad_query')
    t('an empty include element (1,,2) -> 400', (await viaClient('/media', mediaParams(['1', '', '2']))).r, 'relay error 400 bad_query')
    t('an 11-digit id -> 400', (await viaClient('/media', mediaParams(['12345678901']))).r, 'relay error 400 bad_query')
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
    t('relay own error -> "relay error <status> <code>"', (await fx('https://coldwellbankernovest.com/wp-json/wp/v2/properties?page=9', {})).err, 'relay error 401 unauthorized')
    t('largestResponseBytes is the largest body seen', C.largestResponseBytes(), maxSent)

    const msgs = []
    set(other.cert)
    const pinned = await fx('https://coldwellbankernovest.com/wp-content/uploads/a.jpg', {})
    msgs.push(pinned.err)
    t('a different cert is rejected by the pin', /^relay TLS pin rejected \([A-Z0-9_]+\)$/.test(pinned.err ?? ''), true)
    stub.close(); stub.closeAllConnections?.()
    set(good.cert)
    const down = await fx('https://coldwellbankernovest.com/wp-content/uploads/a.jpg', {})
    msgs.push(down.err)
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

console.log('client wiring in the sources')
{
  const read = f => readFileSync(join(ROOT, f), 'utf8')
  const mirror = read('scripts/mirror-novest-images.mjs'), feedSrc = read('supabase/functions/_shared/novest-feed.mjs'), setup = read('ops/hermes/novest-relay/setup.sh')
  t('mirror: empty-feed guard right after the feed read', /await getAll\('\/properties'[^\n]*\nif \(feed\.length === 0\) fail\('feed returned 0 listings: refusing to report clean'\)/.test(mirror), true)
  t('mirror: route resolved, printed, relay installed and size line on exit', [/resolveNovestRoute\(process\.env\)/.test(mirror), mirror.includes('console.log(`route: ${route}`)'), mirror.includes('setNovestFetch(relayFetch)'), /process\.on\('exit'[^\n]*largest relay response: \$\{largestResponseBytes\(\)\} bytes \(cap \$\{RELAY_RESPONSE_CAP\}\)/.test(mirror)], [true, true, true, true])
  t('mirror: images use the routed fetch with the unchanged User-Agent', [mirror.includes(`const MIRROR_UA = '${UA2}'`), mirror.includes('await imageFetch(url, { headers: { \'User-Agent\': MIRROR_UA } })')], [true, true])
  t('shared feed: UA unchanged, hook defaults to global fetch, no node: import', [feedSrc.includes(`const UA = '${UA1}'`), feedSrc.includes('let fetchImpl = (u, i) => fetch(u, i)'), /^\s*import .*node:/m.test(feedSrc)], [true, true, false])
  t('mirror: prune refused on the relay route, after pruneRefusal and before prodWriteGuard', /pruneRefusal\(\{ prune, env: process\.env \}\)[\s\S]*?pruneRouteRefusal\(\{ prune, route \}\)[\s\S]*?prodWriteGuard\(\{/.test(mirror), true)
  t('setup.sh sends both User-Agents and expects 400 for curl default', [setup.includes(`FEED_UA='${UA1}'`), setup.includes(`IMG_UA='${UA2}'`), setup.includes('bad_user_agent')], [true, true, true])
}

console.log(bad ? `\n${bad} check(s) FAILED` : '\nall checks passed')
process.exit(bad ? 1 : 0)
