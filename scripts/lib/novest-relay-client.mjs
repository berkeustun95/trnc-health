// Client for the Novest GET relay on Hermes (ops/hermes/novest-relay/relay.mjs). Node only, built-ins only.
// The repo and the Actions logs are public: no error text here ever carries the relay URL, host, IP or port.

import https from 'node:https'
import net from 'node:net'

export const RELAY_RESPONSE_CAP = 16 * 1024 * 1024
const TIMEOUT_MS = 90_000
const NOVEST_HOSTS = ['coldwellbankernovest.com', 'www.coldwellbankernovest.com']
const ROUTES = ['direct', 'relay', 'relay-dispatch']
const NEEDED = ['NOVEST_RELAY_URL', 'NOVEST_RELAY_KEY', 'NOVEST_RELAY_CA']

let largest = 0
export const largestResponseBytes = () => largest

export function parseRelayUrl(raw) {
  let u
  try { u = new URL(String(raw)) } catch { throw new Error('NOVEST_RELAY_URL is not a valid URL') }
  if (u.protocol !== 'https:' || u.pathname !== '/' || u.search !== '' || u.hash !== '' || u.username !== '' || u.password !== '') {
    throw new Error('NOVEST_RELAY_URL must be https:// with no path, query or credentials')
  }
  return u
}

export function resolveNovestRoute(env = process.env) {
  const raw = env.NOVEST_ROUTE ?? ''
  if (raw === '' || raw === 'direct') return 'direct'
  if (!ROUTES.includes(raw)) throw new Error('NOVEST_ROUTE must be unset, direct, relay-dispatch or relay')
  const missing = NEEDED.filter(k => !env[k])
  if (missing.length) throw new Error(`NOVEST_ROUTE=${raw} needs ${missing.join(', ')} (missing)`)
  parseRelayUrl(env.NOVEST_RELAY_URL)
  if (raw === 'relay') return 'relay'
  return env.GITHUB_EVENT_NAME === 'workflow_dispatch' ? 'relay' : 'direct'
}

// Feed data that decides deletions must come from Novest directly, never through the relay.
export function pruneRouteRefusal({ prune, route }) {
  return prune && route === 'relay' ? 'prune runs only on the direct route (NOVEST_ROUTE is relay for this run)' : null
}

const TLS_CODE = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ALTNAME|ERR_TLS|ERR_SSL|SSL|EPROTO/
const safeCode = c => (typeof c === 'string' && /^[A-Z0-9_]{1,45}$/.test(c) ? c : 'ERROR')

function mapError(e) {
  if (e && e.relayMsg) return new Error(e.relayMsg)
  const code = safeCode(e?.code)
  if (TLS_CODE.test(code)) return new Error(`relay TLS pin rejected (${code})`)
  return new Error(`relay unreachable (${code})`)
}

export function relayFetch(url, init = {}) {
  return new Promise((resolve, reject) => {
    let target, base
    try { target = new URL(String(url)) } catch { return reject(new Error('relay: not a URL')) }
    try { base = parseRelayUrl(process.env.NOVEST_RELAY_URL) } catch (e) { return reject(e) }
    if (target.protocol !== 'https:' || !NOVEST_HOSTS.includes(target.hostname) || target.port !== '' || target.username !== '' || target.password !== '') {
      return reject(new Error('relay: only https://coldwellbankernovest.com URLs are allowed'))
    }
    const key = process.env.NOVEST_RELAY_KEY
    const ca = process.env.NOVEST_RELAY_CA
    if (!key || !ca) return reject(new Error('relay: NOVEST_RELAY_KEY / NOVEST_RELAY_CA missing'))

    const h = init.headers ?? {}
    const pick = n => { const k = Object.keys(h).find(x => x.toLowerCase() === n); return k ? String(h[k]) : undefined }
    const headers = { Authorization: `Bearer ${key}` }
    if (pick('user-agent') !== undefined) headers['User-Agent'] = pick('user-agent')
    if (pick('accept') !== undefined) headers.Accept = pick('accept')

    const opts = {
      host: base.hostname.replace(/^\[|\]$/g, ''), port: base.port ? Number(base.port) : 443, method: 'GET',
      path: `/n${target.pathname}${target.search}`, headers, ca, minVersion: 'TLSv1.3', agent: false,
    }
    if (!net.isIP(opts.host)) opts.servername = opts.host

    let settled = false
    const done = (fn, v) => { if (!settled) { settled = true; clearTimeout(timer); fn(v) } }
    const req = https.request(opts)
    const timer = setTimeout(() => { done(reject, new Error('relay timeout')); req.destroy() }, TIMEOUT_MS)
    req.on('error', e => done(reject, mapError(e)))
    req.on('response', res => {
      const chunks = []
      let total = 0
      res.on('error', e => done(reject, mapError(e)))
      res.on('data', c => {
        total += c.length
        if (total > RELAY_RESPONSE_CAP) { done(reject, new Error('relay response over the size cap')); req.destroy(); return }
        chunks.push(c)
      })
      res.on('end', () => {
        if (settled) return
        const body = Buffer.concat(chunks)
        if (body.length > largest) largest = body.length
        const status = res.statusCode
        const relayErr = res.headers['x-relay-error']
        if (relayErr !== undefined) return done(reject, new Error(`relay error ${status} ${/^[a-z_]{1,40}$/.test(String(relayErr)) ? relayErr : 'unknown'}`))
        const wp = res.headers['x-wp-totalpages']
        if (status >= 200 && status < 300 && target.pathname.startsWith('/wp-json/') && !(typeof wp === 'string' && /^\d+$/.test(wp))) {
          return done(reject, new Error('relay response lacks x-wp-totalpages (refusing to paginate blind)'))
        }
        const out = new Headers()
        for (const n of ['content-type', 'x-wp-total', 'x-wp-totalpages', 'x-relay-bytes']) {
          if (typeof res.headers[n] === 'string') out.set(n, res.headers[n])
        }
        const nullBody = status === 204 || status === 205 || status === 304
        let response
        try { response = new Response(nullBody ? null : body, { status, statusText: res.statusMessage ?? '', headers: out }) } catch { return done(reject, new Error(`relay: unusable status ${status}`)) }
        done(resolve, response)
      })
    })
    req.end()
  })
}
