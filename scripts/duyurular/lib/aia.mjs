// Completing a chain the server left incomplete, the way browsers do (AIA "CA Issuers").
//
// 2026-10-13: every *.gov.ct.tr host started serving a Let's Encrypt YR1 leaf without its
// chain and 13 sources died for five days, until YR1 + Root YR(by X1) were embedded in ca.mjs.
// Those embedded certificates stay the fast path. This is the fallback for the next change
// (YR2, YR3…): read the leaf, download its issuer from the URL the leaf names, and add it only
// once the WHOLE chain verifies, signature by signature, up to a root Node already ships.
//
// Nothing here trusts a certificate for being downloaded: a downloaded certificate is only a
// candidate, and a downloaded self-signed root is rejected, never an anchor. Anchors are
// tls.getCACertificates('bundled') (Node's Mozilla store), never 'default', which also holds our
// embedded intermediates. After the pre-check, OpenSSL verifies the chain again on the real
// request, hostname included.

import tls from 'node:tls'
import { X509Certificate } from 'node:crypto'
import { RAPIDSSL_G1_PEM, LE_YR1_PEM, ISRG_ROOT_YR_BY_X1_PEM } from './ca.mjs'

export const AIA_TIMEOUT_MS = 10_000
export const AIA_MAX_BYTES = 64 * 1024        // an intermediate is ~1.5 KB
export const AIA_MAX_DEPTH = 4

export function caIssuerUrls(cert) {
  return [...(cert.infoAccess || '').matchAll(/^CA Issuers - URI:(\S+)$/gm)].map(m => m[1])
}

// DER (what AIA serves) or PEM. PKCS#7 bundles (.p7c) are refused as "not a certificate".
export async function fetchIssuer(url, { fetchImpl = fetch, timeoutMs = AIA_TIMEOUT_MS, maxBytes = AIA_MAX_BYTES } = {}) {
  let u
  try { u = new URL(url) } catch { throw new Error('AIA bad url') }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`AIA scheme ${u.protocol.replace(':', '')}`)
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(u.href, { signal: ctl.signal, redirect: 'follow' })
    if (!res.ok) throw new Error(`AIA HTTP ${res.status}`)
    if (Number(res.headers?.get?.('content-length') || 0) > maxBytes) throw new Error('AIA too large')
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.length > maxBytes) throw new Error('AIA too large')
    try { return new X509Certificate(bytes) } catch { throw new Error('AIA not a certificate') }
  } catch (e) {
    if (e.name === 'AbortError' || ctl.signal.aborted) throw new Error('AIA timeout')
    throw e
  } finally { clearTimeout(timer) }
}

const issues = (parent, child) => parent.ca && child.checkIssued(parent) && child.verify(parent.publicKey)
const inDate = (c, now) => c.validFromDate <= now && now <= c.validToDate
const selfSigned = c => c.checkIssued(c) && c.verify(c.publicKey)
const cn = c => (/(?:^|\n)CN=([^\n]+)/.exec(c.subject) || [])[1] || c.subject

// leaf → … → (a bundled anchor). Candidates for each step: what the server presented, our embedded
// intermediates, then a download from the current top's AIA. Returns the intermediates to add.
export async function buildChain(leaf, { presented = [], extras = [], anchors, download, now = new Date(), maxDepth = AIA_MAX_DEPTH }) {
  const anchorFp = new Set(anchors.map(a => a.fingerprint256))
  const chain = []
  let top = leaf
  for (let depth = 0; depth < maxDepth; depth++) {
    if (anchors.some(a => issues(a, top))) return { chain, issuer: cn(chain[0] || top) }
    let next = [...presented, ...extras].find(c => c.fingerprint256 !== top.fingerprint256 && issues(c, top) && inDate(c, now))
    if (!next) {
      const reasons = []
      for (const url of caIssuerUrls(top)) {
        try {
          const c = await download(url)
          if (!issues(c, top)) { reasons.push('AIA not the issuer'); continue }
          if (!inDate(c, now)) { reasons.push('AIA issuer expired'); continue }
          next = c; break
        } catch (e) { reasons.push(e.message) }
      }
      if (!next) throw new Error(reasons[0] || 'AIA no issuer url')
    }
    if (selfSigned(next) && !anchorFp.has(next.fingerprint256)) throw new Error('AIA untrusted root')
    chain.push(next)
    top = next
  }
  throw new Error('AIA chain too long')
}

// The certificates the server sent. The handshake runs WITHOUT verification only to read them:
// no byte of a request is written and the socket is destroyed on secureConnect. The real request
// that follows is fully verified by OpenSSL.
export function peerChain(host, { port = 443, timeoutMs = AIA_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs })
    sock.once('secureConnect', () => {
      const out = [], seen = new Set()
      for (let c = sock.getPeerCertificate(true); c?.raw && !seen.has(c.fingerprint256); c = c.issuerCertificate) {
        seen.add(c.fingerprint256); out.push(new X509Certificate(c.raw))
      }
      sock.destroy()
      out.length ? resolve(out) : reject(new Error('AIA no peer certificate'))
    })
    sock.once('timeout', () => { sock.destroy(); reject(new Error('AIA timeout')) })
    sock.once('error', e => reject(new Error(`AIA connect ${e.code || 'error'}`)))
  })
}

// Per run: one attempt per host (13 gov.ct.tr sources fail together) and one download per URL.
export const aiaEvents = []
const byHost = new Map(), byUrl = new Map()
let anchorsCache = null
const EXTRAS = [RAPIDSSL_G1_PEM, LE_YR1_PEM, ISRG_ROOT_YR_BY_X1_PEM].map(p => new X509Certificate(p))

export function completeChainFor(host) {
  if (!byHost.has(host)) byHost.set(host, (async () => {
    try {
      anchorsCache ??= tls.getCACertificates('bundled').map(p => new X509Certificate(p))
      const [leaf, ...presented] = await peerChain(host)
      const download = url => { if (!byUrl.has(url)) byUrl.set(url, fetchIssuer(url)); return byUrl.get(url) }
      const { chain, issuer } = await buildChain(leaf, { presented, extras: EXTRAS, anchors: anchorsCache, download })
      if (!chain.length) throw new Error('AIA nothing missing')
      const have = new Set(tls.getCACertificates('default').map(p => new X509Certificate(p).fingerprint256))
      const add = chain.filter(c => !have.has(c.fingerprint256)).map(c => c.toString())
      if (add.length) tls.setDefaultCACertificates([...tls.getCACertificates('default'), ...add])
      aiaEvents.push({ host, ok: true, issuer })
      return true
    } catch (e) {
      aiaEvents.push({ host, ok: false, reason: e.message.startsWith('AIA') ? e.message : 'AIA other' })
      return false
    }
  })())
  return byHost.get(host)
}
