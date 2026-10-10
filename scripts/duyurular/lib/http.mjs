// Polite HTTP for the Duyurular fetcher.
//   • One serial queue per host; hosts run in parallel. Each host waits max(robots Crawl-delay,
//     the source's crawl_delay_s, MIN_DELAY_S) between requests, listing, page and PDF alike.
//   • robots.txt is read once per host per run; a disallowed URL is never requested.
//   • ETag / Last-Modified are sent when known (a 304 costs the site almost nothing).
//   • Bodies are capped and decoded by their declared charset (some sites are windows-1254).

import tls from 'node:tls'
import { RAPIDSSL_G1_PEM } from './ca.mjs'

// mtod.mebnet.net and iod.mebnet.net serve their leaf certificate without the intermediate
// (openssl: "unable to verify the first certificate", 2026-10-10). Browsers and macOS curl fetch
// it via AIA; Node does not. Adding DigiCert's public RapidSSL TLS RSA CA G1 intermediate
// (sha256 44:22:E9:63…C6:9B, chains to DigiCert Global Root G2, expires 2027-11-02) completes
// the chain. Verification stays ON; this never trusts anything the root store would not.
tls.setDefaultCACertificates([...tls.getCACertificates('default'), RAPIDSSL_G1_PEM])

export const USER_AGENT = 'ADA-Duyurular/1.0 (+https://getadaapp.com/support)'
const UA_TOKEN = 'ada-duyurular'
const MIN_DELAY_S = 2
const TIMEOUT_MS = 30_000
const MAX_HTML = 4 * 1024 * 1024
const MAX_PDF = 12 * 1024 * 1024

const hosts = new Map()      // host → { chain: Promise, last: number, delayS: number, robots: Promise }
export const stats = { requests: 0, bytes: 0, byKind: {} }

const sleep = ms => new Promise(r => setTimeout(r, ms))

function hostState(host) {
  if (!hosts.has(host)) hosts.set(host, { chain: Promise.resolve(), last: 0, delayS: MIN_DELAY_S, robots: null })
  return hosts.get(host)
}

export function declareDelay(url, seconds) {
  const h = hostState(new URL(url).host)
  h.delayS = Math.max(h.delayS, seconds || 0)
}

// ─── robots.txt ─────────────────────────────────────────────────────────────
export function parseRobots(txt) {
  const groups = []
  let cur = null, lastWasAgent = false
  for (const raw of String(txt).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i)
    if (!m) continue
    const key = m[1].toLowerCase(), val = m[2].trim()
    if (key === 'user-agent') {
      if (!lastWasAgent || !cur) { cur = { agents: [], allow: [], disallow: [], delay: null }; groups.push(cur) }
      cur.agents.push(val.toLowerCase()); lastWasAgent = true; continue
    }
    lastWasAgent = false
    if (!cur) continue
    if (key === 'disallow' && val) cur.disallow.push(val)
    else if (key === 'allow' && val) cur.allow.push(val)
    else if (key === 'crawl-delay' && /^\d+(\.\d+)?$/.test(val)) cur.delay = Number(val)
  }
  const mine = groups.find(g => g.agents.some(a => a !== '*' && UA_TOKEN.includes(a))) || groups.find(g => g.agents.includes('*'))
  return mine || { allow: [], disallow: [], delay: null }
}

const ruleRe = rule => new RegExp('^' + rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'))

export function robotsAllows(rules, url) {
  const u = new URL(url)
  let path = u.pathname + u.search
  try { path = decodeURI(path) } catch { /* keep encoded */ }
  const match = list => list.filter(r => ruleRe(r).test(path) || ruleRe(r).test(u.pathname + u.search)).reduce((a, r) => Math.max(a, r.length), -1)
  const allow = match(rules.allow), dis = match(rules.disallow)
  return dis < 0 || allow >= dis
}

async function robotsFor(url) {
  const u = new URL(url)
  const h = hostState(u.host)
  if (!h.robots) {
    h.robots = (async () => {
      try {
        const res = await rawFetch(`${u.protocol}//${u.host}/robots.txt`, {}, MAX_HTML)
        const rules = res.status === 200 ? parseRobots(res.text) : { allow: [], disallow: [], delay: null }
        if (rules.delay) h.delayS = Math.max(h.delayS, Math.min(rules.delay, 60))
        return rules
      } catch { return { allow: [], disallow: [], delay: null } }
    })()
  }
  return h.robots
}

// ─── fetching ───────────────────────────────────────────────────────────────
function charsetOf(contentType, bytes) {
  let cs = (contentType.match(/charset=([\w-]+)/i) || [])[1]
  if (!cs) {
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 2048))
    cs = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || head.match(/encoding=["']([\w-]+)["']/i) || [])[1]
  }
  cs = (cs || 'utf-8').toLowerCase()
  if (cs === 'iso-8859-9') cs = 'windows-1254'
  try { new TextDecoder(cs); return cs } catch { return 'utf-8' }
}

async function rawFetch(url, headers, cap) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'tr,en;q=0.5', ...headers }, redirect: 'follow', signal: ctl.signal })
    const ct = res.headers.get('content-type') || ''
    let bytes = new Uint8Array(0)
    if (res.status !== 304) {
      const len = Number(res.headers.get('content-length') || 0)
      if (len > cap) throw new Error(`too large (${len} bytes)`)
      bytes = new Uint8Array(await res.arrayBuffer())
      if (bytes.length > cap) throw new Error(`too large (${bytes.length} bytes)`)
    }
    stats.requests++; stats.bytes += bytes.length
    const isPdf = /application\/pdf/i.test(ct) || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)
    return {
      status: res.status, url: res.url || url, contentType: ct, isPdf, bytes,
      text: isPdf ? '' : new TextDecoder(charsetOf(ct, bytes)).decode(bytes),
      etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified'),
    }
  } finally { clearTimeout(timer) }
}

// kind: 'listing' | 'page' | 'pdf' (for the request counters only).
export async function politeFetch(url, { kind = 'listing', etag, lastModified, pdf = false, method, body, json } = {}) {
  const host = new URL(url).host
  const rules = await robotsFor(url)
  if (!robotsAllows(rules, url)) return { status: 0, blocked: 'robots', url }
  const h = hostState(host)
  const run = async () => {
    const wait = h.last + h.delayS * 1000 - Date.now()
    if (wait > 0) await sleep(wait)
    stats.byKind[kind] = (stats.byKind[kind] || 0) + 1
    const headers = {}
    if (etag) headers['If-None-Match'] = etag
    if (lastModified) headers['If-Modified-Since'] = lastModified
    try {
      if (method === 'POST') return await postJson(url, body, headers)
      let res
      try { res = await rawFetch(url, headers, pdf ? MAX_PDF : MAX_HTML) }
      catch (e) {
        if (/too large/.test(e.message)) throw e
        await sleep(h.delayS * 1000)
        res = await rawFetch(url, headers, pdf ? MAX_PDF : MAX_HTML)
      }
      if (json && res.status === 200) res.json = JSON.parse(res.text)
      return res
    } finally { h.last = Date.now() }
  }
  const p = h.chain.then(run, run)
  h.chain = p.catch(() => {})
  return p
}

async function postJson(url, body, headers) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { method: 'POST', signal: ctl.signal,
      headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(body) })
    const text = await res.text()
    stats.requests++; stats.bytes += text.length
    return { status: res.status, url, text, json: res.ok ? JSON.parse(text) : null }
  } finally { clearTimeout(timer) }
}

// Canonical form of an item URL: absolute, no fragment, no tracking parameters. Turkish
// characters stay as the site percent-encodes them (URL() normalises consistently).
export function canonicalUrl(href, base) {
  const u = new URL(href, base)
  u.hash = ''
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|mc_)/i.test(k)) u.searchParams.delete(k)
  return u.href
}
