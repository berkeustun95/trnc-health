// Expo push sending with a bounded retry, kept free of remote imports so `deno test` runs it offline.
//
// RETRY RULE (the whole point): retry a batch ONLY when Expo cannot have accepted it:
//   - HTTP 5xx or 429: Expo answered that it did not take the batch.
// NEVER retry (Berke: "only retry batches Expo didn't accept, so nobody gets a double push"):
//   - HTTP 200, even when some tickets are errors (DeviceNotRegistered...): accepted, a retry would double-push.
//     A 200 whose body cannot be parsed is likewise not retried.
//   - a timeout / abort (our 10 s AbortSignal.timeout): the request was sent, Expo may have accepted it. Counted 'timeout'.
//   - ANY other thrown fetch. Deno gives no stable, documented way to tell "DNS failure / connection refused before
//     anything was sent" from "connection reset mid-request" (only free-text TypeError messages), so a thrown fetch
//     is never retried; counted 'fetch_failed'.
// Nothing here logs or returns Expo's body or messages (for DeviceNotRegistered they embed the push token).

export const PUSH_URL = 'https://exp.host/--/api/v2/push/send'
export const RETRY_BASE_DELAYS_MS = [1000, 2000, 4000]
export const RETRY_BUDGET_MS = 45_000
export const ATTEMPT_TIMEOUT_MS = 10_000

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
  runStartedAt: number
  budgetMs?: number
}

function retryAfterMs(res: Response): number {
  const h = res.headers?.get?.('retry-after')
  if (!h) return 0
  const secs = Number(h)
  return Number.isFinite(secs) && secs > 0 ? secs * 1000 : 0
}

export async function sendBatch(batch: unknown[], d: SendDeps): Promise<BatchResult> {
  const budget = d.budgetMs ?? RETRY_BUDGET_MS
  const out: BatchResult = { accepted: false, ok: 0, errors: 0, retries: 0, kinds: Object.create(null) }
  const fail = (kind: string, n: number) => {
    out.errors += n
    out.kinds[kind] = (out.kinds[kind] ?? 0) + n
  }

  for (let attempt = 0; ; attempt++) {
    let kind: string
    let wait = 0
    try {
      const res = await d.fetchFn(PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Accept-Encoding': 'gzip, deflate' },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
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
      if (!(res.status >= 500 || res.status === 429)) {
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
    const base = RETRY_BASE_DELAYS_MS[attempt]
    const delay = Math.max(base * (1 + 0.25 * d.random()), wait)
    if (d.now() - d.runStartedAt + delay > budget) {
      console.error('Expo push retry skipped: time budget')
      fail(kind, batch.length)
      return out
    }
    console.error('Expo push batch will retry:', kind, 'attempt', attempt + 1)
    await d.sleep(delay)
    out.retries++
  }
}
