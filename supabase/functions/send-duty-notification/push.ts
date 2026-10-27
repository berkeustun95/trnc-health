// Expo push sending with a bounded retry, kept free of remote imports so `deno test` runs it offline.
//
// RETRY RULE (the whole point): retry a batch ONLY when Expo explicitly did not process it:
//   - HTTP 503 or 429.
// NEVER retry (Berke: "only retry batches Expo didn't accept, so nobody gets a double push"):
//   - HTTP 200, even when some tickets are errors (DeviceNotRegistered...): accepted, a retry would double-push.
//     A 200 whose body cannot be parsed is likewise not retried.
//   - HTTP 500 / 502 / 504 and other 5xx/4xx: a gateway or server error can come AFTER Expo accepted the batch.
//     Counted `http_<code>`.
//   - a timeout / abort: the request was sent, Expo may have accepted it. Counted `timeout`.
//   - ANY other thrown fetch: Deno gives no stable way to tell "DNS failure / refused before anything was sent"
//     from "reset mid-request" (only free-text TypeError messages). Counted `fetch_failed`.
//
// TIME: one hard run deadline (deadlineAt). Every attempt's timeout is min(10 s, deadline - now - reserve). A retry
// is allowed only if its delay + its attempt timeout still leave room for one full first attempt per REMAINING batch.
// Once the deadline is reached, batches are not sent at all: counted `deadline` (better than a timed-out half-send).
// Nothing here logs or returns Expo's body or messages (for DeviceNotRegistered they embed the push token).

export const PUSH_URL = 'https://exp.host/--/api/v2/push/send'
export const RETRY_BASE_DELAYS_MS = [1000, 2000, 4000]
export const ATTEMPT_TIMEOUT_MS = 10_000
// One hard run deadline (index.ts passes runStart + RUN_DEADLINE_MS) leaves room for finishRun and the response
// under the platform's 60 s limit; RESERVE_MS is that room. Below MIN_ATTEMPT_MS an attempt is not worth sending.
export const RUN_DEADLINE_MS = 55_000
export const RESERVE_MS = 2_000
export const MIN_ATTEMPT_MS = 1_000

const KIND_RE = /^[A-Za-z0-9_]{1,64}$/
export function errorKind(k: unknown): string {
  return typeof k === 'string' && KIND_RE.test(k) ? k : 'other'
}

export interface BatchResult {
  // true only for HTTP 200 with a parseable body: Expo took the batch (its tickets may still be errors).
  accepted: boolean
  ok: number
  errors: number
  retries: number
  kinds: Record<string, number>
}

// Run outcome is BATCH-level: error tickets inside an accepted batch (dead tokens) are not delivery failures.
//   push_failed = something was attempted and no batch was accepted
//   partial     = at least one batch accepted AND at least one not accepted after retries
export function pushOutcome(messages: number, batchesAccepted: number, batchesFailed: number): 'sent' | 'partial' | 'push_failed' {
  if (messages > 0 && batchesAccepted === 0) return 'push_failed'
  if (batchesAccepted > 0 && batchesFailed > 0) return 'partial'
  return 'sent'
}

export interface SendDeps {
  fetchFn: (url: string, init: RequestInit) => Promise<Response>
  sleep: (ms: number) => Promise<void>
  now: () => number
  random: () => number
  deadlineAt: number
  makeSignal?: (ms: number) => AbortSignal
}

function retryAfterMs(res: Response): number {
  const h = res.headers?.get?.('retry-after')
  if (!h) return 0
  const secs = Number(h)
  return Number.isFinite(secs) && secs > 0 ? secs * 1000 : 0
}

export async function sendBatch(batch: unknown[], d: SendDeps, remainingBatches = 0): Promise<BatchResult> {
  const out: BatchResult = { accepted: false, ok: 0, errors: 0, retries: 0, kinds: Object.create(null) }
  const fail = (kind: string, n: number) => {
    out.errors += n
    out.kinds[kind] = (out.kinds[kind] ?? 0) + n
  }
  const timeoutLeft = () => Math.min(ATTEMPT_TIMEOUT_MS, d.deadlineAt - d.now() - RESERVE_MS)
  const makeSignal = d.makeSignal ?? ((ms: number) => AbortSignal.timeout(ms))

  for (let attempt = 0; ; attempt++) {
    const timeout = timeoutLeft()
    if (timeout < MIN_ATTEMPT_MS) {
      console.error('Expo push batch not sent: run deadline')
      fail('deadline', batch.length)
      return out
    }
    let kind: string
    let wait = 0
    try {
      const res = await d.fetchFn(PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Accept-Encoding': 'gzip, deflate' },
        body: JSON.stringify(batch),
        signal: makeSignal(timeout),
      })
      if (res.ok) {
        try {
          const json = await res.json()
          const tickets: any[] = Array.isArray(json.data) ? json.data : []
          for (const r of tickets) {
            if (r.status === 'ok') out.ok++
            else fail(errorKind(r.details?.error ?? 'unknown'), 1)
          }
          if (tickets.length < batch.length) fail('no_ticket', batch.length - tickets.length)
          out.accepted = true
        } catch {
          fail('bad_response', batch.length)
        }
        return out
      }
      try { await res.body?.cancel() } catch { /* body not needed */ }
      kind = `http_${res.status}`
      if (res.status !== 503 && res.status !== 429) {
        console.error('Expo push batch failed: HTTP', res.status)
        fail(kind, batch.length)
        return out
      }
      wait = retryAfterMs(res)
    } catch (e) {
      const name = e instanceof Error ? e.name : 'unknown'
      console.error('Expo push batch threw:', name)
      fail(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'fetch_failed', batch.length)
      return out
    }

    if (attempt >= RETRY_BASE_DELAYS_MS.length) {
      fail(kind, batch.length)
      return out
    }
    const delay = Math.max(RETRY_BASE_DELAYS_MS[attempt] * (1 + 0.25 * d.random()), wait)
    // after sleeping: this retry's own timeout, plus one full first attempt for every batch still to come
    const nextTimeout = Math.min(ATTEMPT_TIMEOUT_MS, d.deadlineAt - (d.now() + delay) - RESERVE_MS)
    if (nextTimeout < MIN_ATTEMPT_MS || (d.now() + delay) + nextTimeout + remainingBatches * ATTEMPT_TIMEOUT_MS > d.deadlineAt - RESERVE_MS) {
      console.error('Expo push retry skipped: run deadline')
      fail(kind, batch.length)
      return out
    }
    console.error('Expo push batch will retry:', kind, 'attempt', attempt + 1)
    await d.sleep(delay)
    out.retries++
  }
}
