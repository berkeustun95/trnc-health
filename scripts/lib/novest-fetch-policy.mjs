// Retry and rate-limit policy for the Novest image mirror (scripts/mirror-novest-images.mjs only). Node built-ins only.
// The repo and the Actions logs are public: nothing here logs or throws a query string, relay URL, key or CA.

const RETRY_AFTER_SECONDS = /^\d{1,6}$/
const RETRY_AFTER_DATE = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/
const MAX_RETRIES = 3
const BACKOFF_MS = [10_000, 20_000, 40_000]
const DOWNLOAD_PATH = '/wp-content/uploads/'

export function sanitizeRetryAfter(v) {
  return typeof v === 'string' && v.length <= 40 && (RETRY_AFTER_SECONDS.test(v) || RETRY_AFTER_DATE.test(v)) ? v : null
}

const intSetting = (env, name, min, max, def) => {
  const raw = env[name]
  if (raw === undefined || raw === '') return { v: def, env: false }
  if (!/^[1-9]\d{0,3}$/.test(raw) || Number(raw) < min || Number(raw) > max) throw new Error(`${name} must be an integer from ${min} to ${max}`)
  return { v: Number(raw), env: true }
}

// Novest answers 429 once 5 calls reach it within a rolling 60 s (measured from Hermes, 2026-11-21). Relay route only:
// at most `calls` calls in any `windowMs`, counting every attempt (retries too) and, unless switched off, photo downloads.
export function resolveRateLimit(env, route) {
  if (route !== 'relay') return null
  const calls = intSetting(env, 'NOVEST_RATE_CALLS', 1, 10, 4)
  const win = intSetting(env, 'NOVEST_RATE_WINDOW_S', 10, 600, 65)
  const cd = env.NOVEST_RATE_COUNT_DOWNLOADS
  if (cd !== undefined && cd !== '' && cd !== 'true' && cd !== 'false') throw new Error('NOVEST_RATE_COUNT_DOWNLOADS must be true or false')
  return { calls: calls.v, windowMs: win.v * 1000, countDownloads: cd !== 'false', source: calls.env || win.env || (cd ?? '') !== '' ? 'env' : 'default' }
}

export function createRetryingFetch({ fetch: base, route, rate = null, sleep = ms => new Promise(r => setTimeout(r, ms)), now = Date.now, log = l => console.log(l) }) {
  let used = 0
  const starts = []
  let gate = Promise.resolve()
  const st = { api: 0, downloads: 0, waitedMs: 0, api429: 0, download429: 0, busy: 0 }

  // Serialised so concurrent download workers queue one at a time and waitedMs is wall-clock, not a sum of overlaps.
  const take = async () => {
    for (;;) {
      const t = now()
      while (starts.length && starts[0] <= t - rate.windowMs) starts.shift()
      if (starts.length < rate.calls) { starts.push(t); return }
      const w = starts[0] + rate.windowMs - t
      st.waitedMs += w
      await sleep(w)
    }
  }
  const acquire = () => { const p = gate.then(take); gate = p.catch(() => {}); return p }

  const waitMs = retryAfter => {
    if (retryAfter !== null) {
      const secs = /^\d+$/.test(retryAfter) ? Number(retryAfter) : (Date.parse(retryAfter) - now()) / 1000
      if (Number.isFinite(secs)) return Math.min(60, Math.max(1, Math.ceil(secs))) * 1000
    }
    return BACKOFF_MS[used - 1]
  }

  async function attempt(url, init) {
    try {
      return { res: await base(url, init) }
    } catch (e) {
      if (e?.relayError === 'busy') return { busy: e }
      throw e
    }
  }

  async function retryingFetch(url, init) {
    const path = new URL(String(url)).pathname
    const isDownload = path.startsWith(DOWNLOAD_PATH)
    for (;;) {
      if (rate && (rate.countDownloads || !isDownload)) await acquire()
      if (isDownload) st.downloads++; else st.api++
      const { res, busy } = await attempt(url, init)
      if (!busy && res.status !== 429) return res
      if (busy) st.busy++; else if (isDownload) st.download429++; else st.api429++
      const retryAfter = sanitizeRetryAfter(busy ? busy.retryAfter : res.headers.get('retry-after'))
      const raText = `Retry-After: ${retryAfter ?? 'none'}`
      const what = busy ? 'relay refused: busy (429)' : `Novest answered 429 ${route === 'relay' ? 'via relay' : '(direct)'}`
      if (used >= MAX_RETRIES) {
        log(`novest ${busy ? 'relay refused busy' : '429'} route=${route} path=${path} ${raText} retry budget exhausted ${used}/${MAX_RETRIES}`)
        throw new Error(`${what} on ${path} (${raText}); retry budget used ${used}/${MAX_RETRIES}`)
      }
      used++
      const ms = waitMs(retryAfter)
      if (res) res.body?.cancel?.().catch(() => {})
      log(`novest ${busy ? 'relay refused busy' : '429'} route=${route} path=${path} ${raText} wait=${ms / 1000}s retries ${used}/${MAX_RETRIES}`)
      await sleep(ms)
    }
  }

  // The one per-run line that answers "do photo downloads count towards Novest's limit".
  retryingFetch.summary = () => {
    const lim = rate ? `${rate.calls}/${rate.windowMs / 1000}s downloads ${rate.countDownloads ? 'counted' : 'NOT counted'}` : 'off'
    const dl = st.downloads === 0 ? 'no downloads this run (no evidence)'
      : st.download429 > 0 ? `${st.download429} of ${st.downloads} got a Novest 429 (downloads DO count)`
      : rate?.countDownloads ? `${st.downloads}, no 429 (paced by the limiter, so no evidence either way)`
      : `${st.downloads}, no 429 (unpaced: downloads do not seem to count)`
    return `novest calls: route=${route} limiter=${lim} calls=${st.api + st.downloads} (api ${st.api}, downloads ${st.downloads}) limiter-wait=${Math.round(st.waitedMs / 1000)}s ` +
      `429s: api ${st.api429}, downloads ${st.download429}, relay-busy ${st.busy} retries ${used}/${MAX_RETRIES} | downloads: ${dl}`
  }
  return retryingFetch
}
