// Expo push sending, kept free of remote imports so `deno test` runs it offline.
//
// SEND ONCE (Round 5, 2026-11-16): every batch gets exactly ONE request, whatever the answer. Until then a batch was
// re-sent on HTTP 503/429; duty_push_runs showed push_retries = 1 on 11, 12, 13 and 16 Nov, and real users (no shared
// token, no second app) got the duty push twice on 16 Nov: Expo can deliver a batch it answered 503/429 for. A batch
// that is not accepted is counted (`http_<code>`, `timeout`, `fetch_failed`, `bad_response`) and that day's push is
// missed for its phones; the in-app row still lands. A missed push is recoverable, a double push to everyone is not.
// Nothing here logs or returns Expo's body or messages (for DeviceNotRegistered they embed the push token). The one
// exception is opt-in `diag` (push-diag.ts): a NOT-accepted answer's body, redacted and capped, never an accepted one.

import { type DiagDeps, startDiag } from './push-diag.ts'

export const PUSH_URL = 'https://exp.host/--/api/v2/push/send'
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

// ONE PUSH PER TOKEN (2026-11-13: one phone holding the same Expo token on two accounts got every broadcast twice).
// The in-app row still goes to every account; only the push is collapsed. For a shared token the account that signed
// in most recently wins (its language is the one on the phone now); an unknown sign-in loses, and a full tie keeps the
// first in input order. Order of the result = first appearance of each token, so batching stays deterministic.
export function onePerToken<T extends { id: string; push_token: string | null }>(
  profiles: T[], lastSignIn: Map<string, number> = new Map(),
): T[] {
  const best = new Map<string, T>()
  for (const p of profiles) {
    if (!p.push_token) continue
    const cur = best.get(p.push_token)
    if (!cur || (lastSignIn.get(p.id) ?? -Infinity) > (lastSignIn.get(cur.id) ?? -Infinity)) best.set(p.push_token, p)
  }
  return [...best.values()]
}

// Ids of the profiles whose token is on more than one profile: the only ones whose sign-in time is looked up.
export function sharedTokenIds(profiles: { id: string; push_token: string | null }[]): string[] {
  const n = new Map<string, number>()
  for (const p of profiles) if (p.push_token) n.set(p.push_token, (n.get(p.push_token) ?? 0) + 1)
  return profiles.filter((p) => p.push_token && (n.get(p.push_token) ?? 0) > 1).map((p) => p.id)
}

// Best effort and bounded in COUNT and TIME: the lookups run in parallel under one budget, and whatever has not answered
// by then simply cannot win the tie (security review #405: auth admin calls have no timeout, and before this the
// broadcasts never depended on the Auth service). Never throws, never waits longer than budgetMs.
export const MAX_SIGNIN_LOOKUPS = 50
export const SIGNIN_LOOKUP_BUDGET_MS = 3_000
export async function lastSignIns(
  ids: string[], getLastSignIn: (id: string) => Promise<string | null | undefined>,
  budgetMs = SIGNIN_LOOKUP_BUDGET_MS,
): Promise<Map<string, number>> {
  const found = new Map<string, number>()
  const all = Promise.allSettled(ids.slice(0, MAX_SIGNIN_LOOKUPS).map(async (id) => {
    const ms = Date.parse((await getLastSignIn(id)) ?? '')
    if (Number.isFinite(ms)) found.set(id, ms)
  }))
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([all, new Promise<void>((res) => { timer = setTimeout(res, budgetMs) })])
  clearTimeout(timer)
  return new Map(found)   // a snapshot: an answer arriving after the budget changes nothing
}

export interface SendDeps {
  fetchFn: (url: string, init: RequestInit) => Promise<Response>
  makeSignal?: (ms: number) => AbortSignal
  diag?: DiagDeps
}

export async function sendBatch(batch: unknown[], d: SendDeps): Promise<BatchResult> {
  const out: BatchResult = { accepted: false, ok: 0, errors: 0, kinds: Object.create(null) }
  const fail = (kind: string, n: number) => {
    out.errors += n
    out.kinds[kind] = (out.kinds[kind] ?? 0) + n
  }
  const makeSignal = d.makeSignal ?? ((ms: number) => AbortSignal.timeout(ms))

  const dx = startDiag(d.diag)
  let res: Response
  try {
    res = await d.fetchFn(PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Accept-Encoding': 'gzip, deflate' },
      body: JSON.stringify(batch),
      signal: makeSignal(ATTEMPT_TIMEOUT_MS),
    })
  } catch (e) {
    dx?.thrown(e, batch.length)
    const name = e instanceof Error ? e.name : 'unknown'
    console.error('Expo push batch threw:', name)
    fail(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'fetch_failed', batch.length)
    return out
  }
  dx?.headers()
  if (!res.ok) {
    if (dx) await dx.nonAccepted(res, batch.length)
    else try { await res.body?.cancel() } catch { /* body not needed */ }
    console.error('Expo push batch failed: HTTP', res.status)
    fail(`http_${res.status}`, batch.length)
    return out
  }
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
  dx?.accepted(res)
  return out
}
