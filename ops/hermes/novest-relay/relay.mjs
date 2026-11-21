#!/usr/bin/env node
// Novest GET relay (Hermes, `<HERMES_IP>:8443`). The GitHub `novest-images` job keeps the Supabase write key and
// fetches Novest bytes through this relay, because GitHub runners are intermittently blocked by Novest.
//
// Rules: Node built-ins only. `GET /n/<path>?<query>` maps to https://coldwellbankernovest.com/<path>?<query>;
// the client never names a host. Order of checks: method, auth, path, query, User-Agent. Bearer key compared by
// sha256 + timingSafeEqual; 10 failed auths/min per IP locks that IP for 10 min; on top, a global fixed window
// (120/min, all IPs) of requests WITHOUT a valid key: over it they get 429, a valid key is never counted or refused
// by it. Upstream DNS answers in private,
// loopback, link-local, CGNAT, multicast, ULA, 6to4 (2002::/16) and Teredo (2001:0::/32) space are refused (also
// IPv4-mapped; 6to4/Teredo are refused outright, so their embedded IPv4 is never decoded). Redirects are followed by
// hand (max 3) and re-checked against every allowlist. Own errors are JSON {error:code} + x-relay-error and never
// carry upstream text. Logs: one line per request, query LENGTH only, never headers, key or bodies.
// Secrets and the cert arrive as systemd credentials ($CREDENTIALS_DIRECTORY/tls.key, tls.crt, key.sha256).

import https from 'node:https'
import crypto from 'node:crypto'
import dns from 'node:dns'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const ALLOWED_HOSTS = Object.freeze(['coldwellbankernovest.com', 'www.coldwellbankernovest.com'])
export const ALLOWED_PATH_PREFIXES = Object.freeze(['/wp-json/wp/v2/properties', '/wp-json/wp/v2/media', '/wp-content/uploads/'])
export const ALLOWED_QUERY_KEYS = Object.freeze(['per_page', 'page', 'orderby', 'order', 'include', '_fields'])
export const ALLOWED_USER_AGENTS = Object.freeze([
  'ADA-TRNC-Health/1.0 (+https://getadaapp.com; partner listing sync; getadaapp@gmail.com)',
  'ADA-TRNC-Health/1.0 (+partner image mirror)',
])
export const DEFAULT_LIMITS = Object.freeze({
  maxBytes: 16 * 1024 * 1024,
  connectMs: 10_000,
  totalMs: 60_000,
  maxInflight: 4,
  minGapMs: 150,
  dailyCap: 3000,
  maxHops: 3,
  authFails: 10,
  authWindowMs: 60_000,
  authBlockMs: 10 * 60_000,
  unauthMax: 120,
  unauthWindowMs: 60_000,
})
export const PORT = 8443
export const FIRST_HOST = ALLOWED_HOSTS[0]
const UPLOADS_PREFIX = '/wp-content/uploads/'
const FORWARD_HEADERS = ['content-type', 'content-length', 'x-wp-total', 'x-wp-totalpages']
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

class RelayError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code }
}

function v4Bytes(s) {
  const p = s.split('.')
  if (p.length !== 4) return null
  const b = p.map(x => (/^\d{1,3}$/.test(x) ? Number(x) : NaN))
  return b.every(n => n >= 0 && n <= 255) ? b : null
}

function v6Bytes(s) {
  s = s.split('%')[0].toLowerCase()
  let tail = null
  const lastColon = s.lastIndexOf(':')
  if (s.includes('.')) {
    tail = v4Bytes(s.slice(lastColon + 1))
    if (!tail) return null
    s = s.slice(0, lastColon + 1) + '0:0'
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const grp = h => (h === '' ? [] : h.split(':'))
  const head = grp(halves[0])
  const rest = halves.length === 2 ? grp(halves[1]) : []
  if (halves.length === 1 ? head.length !== 8 : head.length + rest.length > 7) return null
  const groups = halves.length === 1 ? head : [...head, ...Array(8 - head.length - rest.length).fill('0'), ...rest]
  const out = []
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null
    const n = parseInt(g, 16)
    out.push(n >> 8, n & 255)
  }
  if (tail) { out[12] = tail[0]; out[13] = tail[1]; out[14] = tail[2]; out[15] = tail[3] }
  return out
}

function blockedV4([a, b, c]) {
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && c === 0)
    || (a === 198 && (b === 18 || b === 19))
}

export function isBlockedAddress(addr) {
  if (typeof addr !== 'string') return true
  if (net.isIPv4(addr)) return blockedV4(v4Bytes(addr))
  if (!net.isIPv6(addr)) return true
  const b = v6Bytes(addr)
  if (!b) return true
  if (b.slice(0, 12).every(x => x === 0)) return true
  if (b.slice(0, 10).every(x => x === 0) && b[10] === 0xff && b[11] === 0xff) return blockedV4(b.slice(12))
  if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every(x => x === 0)) return blockedV4(b.slice(12))
  if ((b[0] & 0xfe) === 0xfc) return true
  if (b[0] === 0x20 && b[1] === 0x02) return true
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0 && b[3] === 0) return true
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) return true
  if (b[0] === 0xff) return true
  return false
}

export function createSafeLookup(resolve = dns.lookup) {
  return (hostname, options, cb) => {
    if (typeof options === 'function') { cb = options; options = {} }
    resolve(hostname, { ...options, all: true }, (err, addrs) => {
      if (err) return cb(err)
      if (!Array.isArray(addrs) || addrs.length === 0) return cb(Object.assign(new Error('no address'), { code: 'ENOTFOUND' }))
      if (addrs.some(a => isBlockedAddress(a.address))) return cb(Object.assign(new Error('address refused'), { code: 'EBLOCKED' }))
      if (options.all) return cb(null, addrs)
      cb(null, addrs[0].address, addrs[0].family)
    })
  }
}

export function makeUpstreamRequest({ ca, connectMs = DEFAULT_LIMITS.connectMs } = {}) {
  return (url, { headers, lookup }) => new Promise((resolve, reject) => {
    const opts = {
      host: url.hostname, port: url.port ? Number(url.port) : 443, path: url.pathname + url.search, method: 'GET',
      headers, lookup, agent: false, minVersion: 'TLSv1.2',
    }
    if (!net.isIP(url.hostname)) opts.servername = url.hostname
    if (ca) opts.ca = ca
    const req = https.request(opts)
    let settled = false
    const fail = e => { if (!settled) { settled = true; reject(e) } req.destroy() }
    const timer = setTimeout(() => fail(Object.assign(new Error('connect timeout'), { code: 'CONNECT_TIMEOUT' })), connectMs)
    req.on('socket', s => { s.once(s.encrypted ? 'secureConnect' : 'connect', () => clearTimeout(timer)) })
    req.on('error', e => { clearTimeout(timer); fail(e) })
    req.on('response', res => {
      clearTimeout(timer)
      settled = true
      resolve({ statusCode: res.statusCode, headers: res.headers, body: res, destroy: () => req.destroy() })
    })
    req.end()
  })
}

const PATH_CHARS = /^[A-Za-z0-9\-._~%!$&'()*+,;=:@/]+$/
const BAD_RAW = /\.\.|%2e|%2f|%5c|%00|\\/i
const QUERY_VALUE = /^[A-Za-z0-9_.,-]{0,200}$/
// `include` is the media-id batch the image mirror sends (100 ids = WP per_page ceiling): digits only, no empty element.
const INCLUDE_VALUE = /^\d{1,10}(,\d{1,10}){0,99}$/
// Raw cap: the client's URL.searchParams encodes commas as %2C. Worst case 100 ten-digit ids = 1000 + 99*3 = 1297,
// + 'include=' 8 = 1305; other params (_fields ~60, per_page, page, orderby, order, separators) stay under ~150. 2000 leaves headroom.
const MAX_RAW_QUERY = 2000

function pathnameAllowed(p) {
  if (typeof p !== 'string' || !p.startsWith('/') || p.startsWith('//')) return false
  if (!PATH_CHARS.test(p) || BAD_RAW.test(p)) return false
  return ALLOWED_PATH_PREFIXES.some(x => (x.endsWith('/') ? p.startsWith(x) && p.length > x.length : p === x || p.startsWith(x + '/')))
}

function canonicalQuery(pathname, rawQuery) {
  if (rawQuery === '') return ''
  if (pathname.startsWith(UPLOADS_PREFIX) || rawQuery.length > MAX_RAW_QUERY) return null
  let sp
  try { sp = new URLSearchParams(rawQuery) } catch { return null }
  let n = 0
  for (const [k, v] of sp) {
    if (++n > 12 || !ALLOWED_QUERY_KEYS.includes(k) || !(k === 'include' ? INCLUDE_VALUE : QUERY_VALUE).test(v)) return null
  }
  return sp.toString()
}

function checkRedirectTarget(url) {
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return false
  if (url.port !== '' || !ALLOWED_HOSTS.includes(url.hostname)) return false
  if (!pathnameAllowed(url.pathname)) return false
  return canonicalQuery(url.pathname, url.search.slice(1)) !== null
}

function cleanIp(ip) {
  const s = String(ip ?? '?').replace(/^::ffff:/i, '')
  return /^[0-9a-fA-F:.]{1,45}$/.test(s) ? s : '?'
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

export function createRelay({ keyHash, upstreamRequest = makeUpstreamRequest(), lookup = createSafeLookup(), now = Date.now, log = line => console.log(line), limits = {} } = {}) {
  if (typeof keyHash !== 'string' || !/^[0-9a-f]{64}$/.test(keyHash)) throw new Error('keyHash must be 64 hex chars')
  const L = { ...DEFAULT_LIMITS, ...limits }
  const stored = Buffer.from(keyHash, 'hex')
  const authState = new Map()
  let inflight = 0
  let nextSlot = 0
  let day = ''
  let dayCalls = 0
  let unauthStart = 0
  let unauthCount = 0

  function pruneAuth(t) {
    for (const [ip, e] of authState) if (e.until <= t && !e.fails.some(x => t - x < L.authWindowMs)) authState.delete(ip)
    if (authState.size > 50_000) {
      let drop = authState.size - 25_000
      for (const ip of authState.keys()) { if (drop-- <= 0) break; authState.delete(ip) }
    }
  }

  function recordFail(ip, t) {
    const e = authState.get(ip) ?? { fails: [], until: 0 }
    e.fails = e.fails.filter(x => t - x < L.authWindowMs)
    e.fails.push(t)
    if (e.fails.length >= L.authFails) { e.until = t + L.authBlockMs; e.fails = [] }
    authState.set(ip, e)
    if (authState.size > 5000) pruneAuth(t)
  }

  function takeCall() {
    const d = new Date(now()).toISOString().slice(0, 10)
    if (d !== day) { day = d; dayCalls = 0 }
    if (dayCalls >= L.dailyCap) throw new RelayError(429, 'daily_cap')
    dayCalls++
  }

  async function gate(ctx) {
    const t = Date.now()
    const at = Math.max(t, nextSlot)
    nextSlot = at + L.minGapMs
    if (at > t) await sleep(at - t)
    if (ctx.aborted) throw new RelayError(504, 'upstream_timeout')
  }

  async function fetchChain(first, headers, ctx, rec) {
    let url = first
    for (let hop = 0; ; hop++) {
      await gate(ctx)
      takeCall()
      rec.hops = hop
      let up
      try {
        up = await upstreamRequest(url, { headers, lookup, connectMs: L.connectMs })
      } catch (e) {
        if (ctx.aborted || e?.code === 'CONNECT_TIMEOUT') throw new RelayError(504, 'upstream_timeout')
        throw new RelayError(502, 'upstream_connect')
      }
      const kill = () => { try { up.destroy?.() } catch {} try { up.body?.destroy?.() } catch {} }
      ctx.destroyers.add(kill)
      try {
        if (ctx.aborted) throw new RelayError(504, 'upstream_timeout')
        if (REDIRECT_STATUSES.has(up.statusCode)) {
          kill()
          if (hop >= L.maxHops) throw new RelayError(502, 'redirect_refused')
          let next
          const loc = up.headers.location
          if (typeof loc !== 'string' || loc === '') throw new RelayError(502, 'redirect_refused')
          try { next = new URL(loc, url) } catch { throw new RelayError(502, 'redirect_refused') }
          if (!checkRedirectTarget(next)) throw new RelayError(502, 'redirect_refused')
          url = next
          continue
        }
        const cl = up.headers['content-length']
        if (cl !== undefined && Number(cl) > L.maxBytes) throw new RelayError(502, 'too_large')
        const chunks = []
        let total = 0
        try {
          for await (const c of up.body) {
            total += c.length
            if (total > L.maxBytes) throw new RelayError(502, 'too_large')
            chunks.push(c)
          }
        } catch (e) {
          if (e instanceof RelayError) throw e
          throw new RelayError(ctx.aborted ? 504 : 502, ctx.aborted ? 'upstream_timeout' : 'upstream_connect')
        }
        return { status: up.statusCode, headers: up.headers, body: Buffer.concat(chunks) }
      } finally {
        kill()
        ctx.destroyers.delete(kill)
      }
    }
  }

  async function handler(req, res) {
    const t0 = Date.now()
    const ip = cleanIp(req.socket?.remoteAddress)
    const rec = { path: '-', qlen: 0, status: 0, bytes: 0, hops: 0, err: '-' }
    const method = /^[A-Za-z]{1,10}$/.test(req.method ?? '') ? req.method : '?'
    let counted = false
    const reply = (status, headers, body, err) => {
      rec.status = status
      rec.bytes = body.length
      rec.err = err ?? '-'
      res.writeHead(status, { ...headers, 'x-relay-bytes': String(body.length), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
      res.end(body)
    }
    const fail = (status, code, extra = {}) => reply(status, { 'content-type': 'application/json', 'x-relay-error': code, ...extra }, Buffer.from(JSON.stringify({ error: code })), code)
    const ctx = { aborted: false, destroyers: new Set() }
    let deadline
    try {
      req.resume?.()
      if (req.method !== 'GET') return fail(405, 'method_not_allowed', { allow: 'GET' })

      const t = now()
      const st = authState.get(ip)
      if (st && st.until > t) return fail(429, 'rate_limited', { 'retry-after': String(Math.ceil((st.until - t) / 1000)) })
      const m = /^Bearer (\S+)$/.exec(String(req.headers.authorization ?? ''))
      const presented = crypto.createHash('sha256').update(m ? m[1] : '').digest()
      const ok = crypto.timingSafeEqual(presented, stored) && m !== null
      if (!ok) {
        recordFail(ip, t)
        if (t - unauthStart >= L.unauthWindowMs || t < unauthStart) { unauthStart = t; unauthCount = 0 }
        if (unauthCount >= L.unauthMax) return fail(429, 'rate_limited', { 'retry-after': String(Math.max(1, Math.ceil((unauthStart + L.unauthWindowMs - t) / 1000))) })
        unauthCount++
        return fail(401, 'unauthorized')
      }

      const rawUrl = String(req.url ?? '')
      const qi = rawUrl.indexOf('?')
      const rawPath = qi === -1 ? rawUrl : rawUrl.slice(0, qi)
      const rawQuery = qi === -1 ? '' : rawUrl.slice(qi + 1)
      rec.path = rawPath.slice(0, 200).replace(/[^\x21-\x7e]/g, '?')
      rec.qlen = rawQuery.length
      if (!rawPath.startsWith('/n/')) return fail(403, 'forbidden_path')
      const mapped = rawPath.slice(2)
      let target
      try { target = new URL(mapped, `https://${FIRST_HOST}`) } catch { return fail(403, 'forbidden_path') }
      if (target.pathname !== mapped || !pathnameAllowed(mapped)) return fail(403, 'forbidden_path')
      const query = canonicalQuery(mapped, rawQuery)
      if (query === null) return fail(400, 'bad_query')
      const ua = req.headers['user-agent']
      if (typeof ua !== 'string' || !ALLOWED_USER_AGENTS.includes(ua)) return fail(400, 'bad_user_agent')

      const headers = { 'Accept-Encoding': 'identity' }
      const accept = req.headers.accept
      if (typeof accept === 'string' && accept.length <= 200 && /^[\x20-\x7e]*$/.test(accept)) headers.Accept = accept
      headers['User-Agent'] = ua
      const first = new URL(`https://${FIRST_HOST}${mapped}${query ? `?${query}` : ''}`)

      if (inflight >= L.maxInflight) return fail(429, 'busy')
      inflight++
      counted = true
      const timeout = new Promise((_, rej) => {
        deadline = setTimeout(() => {
          ctx.aborted = true
          for (const k of ctx.destroyers) k()
          rej(new RelayError(504, 'upstream_timeout'))
        }, L.totalMs)
      })
      const run = fetchChain(first, headers, ctx, rec)
      run.catch(() => {})
      const out = await Promise.race([run, timeout])

      const fwd = {}
      for (const name of FORWARD_HEADERS) {
        const v = out.headers[name]
        if (typeof v !== 'string' || v.length > 200 || !/^[\x20-\x7e]*$/.test(v)) continue
        if (name.startsWith('x-wp-') && !/^\d+$/.test(v)) continue
        fwd[name] = v
      }
      fwd['content-length'] = String(out.body.length)
      return reply(out.status, fwd, out.body)
    } catch (e) {
      if (e instanceof RelayError) return fail(e.status, e.code)
      return fail(500, 'internal')
    } finally {
      clearTimeout(deadline)
      if (counted) inflight--
      log(`${new Date(now()).toISOString()} ${ip} ${method} ${rec.path} q=${rec.qlen} ${rec.status} ${rec.bytes}B ${Date.now() - t0}ms hops=${rec.hops} err=${rec.err}`)
    }
  }

  return { handler }
}

export function createServer(relay, { key, cert }) {
  const server = https.createServer({ key, cert, minVersion: 'TLSv1.3', maxHeaderSize: 8192 }, relay.handler)
  server.headersTimeout = 15_000
  server.requestTimeout = 30_000
  server.keepAliveTimeout = 5_000
  server.maxConnections = 256
  server.on('tlsClientError', () => {})
  server.on('clientError', (_e, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); else socket.destroy() })
  return server
}

function main() {
  const dir = process.env.CREDENTIALS_DIRECTORY
  if (!dir) { console.error('CREDENTIALS_DIRECTORY is not set'); process.exit(1) }
  const read = n => {
    try { return fs.readFileSync(path.join(dir, n)) } catch { console.error(`credential ${n} is missing`); process.exit(1) }
  }
  const key = read('tls.key')
  const cert = read('tls.crt')
  const keyHash = read('key.sha256').toString('utf8').trim()
  if (!/^[0-9a-f]{64}$/.test(keyHash)) { console.error('key.sha256 is not 64 hex chars'); process.exit(1) }
  process.on('uncaughtException', e => { console.error(`fatal ${e?.code ?? e?.name}`); process.exit(1) })
  process.on('unhandledRejection', () => { console.error('fatal unhandled rejection'); process.exit(1) })
  const server = createServer(createRelay({ keyHash }), { key, cert })
  server.listen(PORT, '0.0.0.0', () => console.log(`novest-relay listening on :${PORT}`))
}

const self = process.argv[1] ? (() => { try { return pathToFileURL(fs.realpathSync(process.argv[1])).href } catch { return '' } })() : ''
if (import.meta.url === self) main()
