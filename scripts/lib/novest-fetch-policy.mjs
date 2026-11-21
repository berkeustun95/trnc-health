// Retry and pacing policy for the Novest image mirror (scripts/mirror-novest-images.mjs only). Node built-ins only.
// The repo and the Actions logs are public: nothing here logs or throws a query string, relay URL, key or CA.

const RETRY_AFTER_SECONDS = /^\d{1,6}$/
const RETRY_AFTER_DATE = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/
const MAX_RETRIES = 3
const BACKOFF_MS = [10_000, 20_000, 40_000]
const MEDIA_PATH = '/wp-json/wp/v2/media'

export function sanitizeRetryAfter(v) {
  return typeof v === 'string' && v.length <= 40 && (RETRY_AFTER_SECONDS.test(v) || RETRY_AFTER_DATE.test(v)) ? v : null
}

export function resolveMediaGapMs(env, route) {
  const raw = env.NOVEST_MEDIA_GAP_MS
  if (raw === undefined || raw === '') return { ms: route === 'relay' ? 10_000 : 0, source: 'default' }
  if (!/^(0|[1-9]\d{0,4})$/.test(raw) || Number(raw) > 60_000) throw new Error('NOVEST_MEDIA_GAP_MS must be an integer from 0 to 60000 (milliseconds)')
  return { ms: Number(raw), source: 'env' }
}

export function createRetryingFetch({ fetch: base, route, mediaGapMs = 0, sleep = ms => new Promise(r => setTimeout(r, ms)), now = Date.now, log = l => console.log(l) }) {
  let used = 0
  let lastMediaEnd = null

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

  return async function retryingFetch(url, init) {
    const path = new URL(String(url)).pathname
    const isMedia = path.startsWith(MEDIA_PATH)
    if (isMedia && mediaGapMs > 0 && lastMediaEnd !== null) {
      const wait = mediaGapMs - (now() - lastMediaEnd)
      if (wait > 0) await sleep(wait)
    }
    try {
      for (;;) {
        const { res, busy } = await attempt(url, init)
        if (!busy && res.status !== 429) return res
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
    } finally {
      if (isMedia) lastMediaEnd = now()
    }
  }
}
