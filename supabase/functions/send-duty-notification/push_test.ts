// deno test supabase/functions/send-duty-notification/push_test.ts
import { ATTEMPT_TIMEOUT_MS, pushOutcome, sendBatch, type SendDeps } from './push.ts'

const batch = Array.from({ length: 100 }, (_, i) => ({ to: `ExponentPushToken[t${i}]` }))
const okTickets = (n: number, errs: string[] = []) =>
  new Response(JSON.stringify({ data: [...Array(n - errs.length).fill({ status: 'ok', id: 'x' }),
    ...errs.map((e) => ({ status: 'error', message: `"ExponentPushToken[secret]" is not registered`, details: { error: e } }))] }), { status: 200 })

// Scripted answers, one per fetch; a second fetch for the same batch is the bug this file guards against.
function rig(steps: Array<() => Response | Promise<Response>>) {
  let calls = 0
  const timeouts: number[] = []
  const deps: SendDeps = {
    fetchFn: async () => {
      const s = steps[calls++]
      if (s === undefined) throw new Error('unexpected extra fetch')
      return await s()
    },
    makeSignal: (ms) => { timeouts.push(ms); return new AbortController().signal },
  }
  return { deps, timeouts, calls: () => calls }
}
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`) }

Deno.test('200: one request, every ticket counted ok', async () => {
  const r = rig([() => okTickets(100)])
  const out = await sendBatch(batch, r.deps)
  eq([out.accepted, out.ok, out.errors, r.calls(), r.timeouts], [true, 100, 0, 1, [ATTEMPT_TIMEOUT_MS]], 'result')
})

Deno.test('503 and 429 are NOT re-sent (Round 5: Expo can deliver a batch it answered 503/429 for)', async () => {
  for (const res of [() => new Response('x', { status: 503 }),
                     () => new Response('x', { status: 429, headers: { 'retry-after': '1' } })]) {
    const r = rig([res, () => okTickets(100)])
    const out = await sendBatch(batch, r.deps)
    const status = Object.keys(out.kinds)[0]
    eq([out.accepted, out.ok, out.errors, r.calls(), { ...out.kinds }], [false, 0, 100, 1, { [status]: 100 }], status)
    if (status !== 'http_503' && status !== 'http_429') throw new Error('kind ' + status)
  }
})

Deno.test('every other non-200 gets exactly 1 request, counted http_<code>', async () => {
  for (const status of [400, 500, 502, 504]) {
    const r = rig([() => new Response('x', { status }), () => okTickets(100)])
    const out = await sendBatch(batch, r.deps)
    eq([status, out.accepted, r.calls(), { ...out.kinds }], [status, false, 1, { [`http_${status}`]: 100 }], 'status ' + status)
  }
})

Deno.test('200 with error tickets: accepted, 1 request', async () => {
  const r = rig([() => okTickets(100, ['DeviceNotRegistered', 'DeviceNotRegistered', 'MessageTooBig'])])
  const out = await sendBatch(batch, r.deps)
  eq([out.accepted, out.ok, out.errors, r.calls()], [true, 97, 3, 1], 'result')
  eq({ ...out.kinds }, { DeviceNotRegistered: 2, MessageTooBig: 1 }, 'kinds')
})

Deno.test('timeout, abort and a thrown fetch: 1 request each', async () => {
  const cases: Array<[() => never, string]> = [
    [() => { throw new DOMException('signal timed out', 'TimeoutError') }, 'timeout'],
    [() => { throw new DOMException('aborted', 'AbortError') }, 'timeout'],
    [() => { throw new TypeError('error sending request: tcp connect error') }, 'fetch_failed'],
  ]
  for (const [step, kind] of cases) {
    const r = rig([step, () => okTickets(100)])
    const out = await sendBatch(batch, r.deps)
    eq([out.accepted, r.calls(), { ...out.kinds }], [false, 1, { [kind]: 100 }], kind)
  }
})

Deno.test('unparseable 200 and missing tickets', async () => {
  const r = rig([() => new Response('not json', { status: 200 })])
  const c = await sendBatch(batch, r.deps)
  eq([c.accepted, r.calls(), { ...c.kinds }], [false, 1, { bad_response: 100 }], 'bad body')
  const short = await sendBatch(batch, rig([() => okTickets(90)]).deps)
  eq([short.accepted, short.ok, { ...short.kinds }], [true, 90, { no_ticket: 10 }], 'short ticket list')
})

Deno.test('outcome is batch-level: error tickets do not make a run partial', () => {
  eq(pushOutcome(110, 2, 0), 'sent', 'all batches accepted (even with dead-token tickets)')
  eq(pushOutcome(110, 1, 1), 'partial', 'one accepted, one not')
  eq(pushOutcome(110, 0, 2), 'push_failed', 'none accepted')
  eq(pushOutcome(0, 0, 0), 'sent', 'nothing to send')
})

Deno.test('console output never carries tokens or Expo messages', async () => {
  const seen: string[] = []
  const orig = console.error
  console.error = (...a: unknown[]) => { seen.push(a.join(' ')) }
  try {
    await sendBatch(batch, rig([() => okTickets(100, ['DeviceNotRegistered'])]).deps)
    await sendBatch(batch, rig([() => new Response('ExponentPushToken[secret]', { status: 503 })]).deps)
  } finally { console.error = orig }
  eq(seen.some((l) => l.includes('ExponentPushToken') || l.includes('secret')), false, 'leak')
})

Deno.test('no retry machinery is left in push.ts', async () => {
  const src = await Deno.readTextFile(new URL('./push.ts', import.meta.url))
  for (const w of ['RETRY_BASE_DELAYS_MS', 'retry-after', 'sleep', 'deadlineAt']) {
    if (src.includes(w)) throw new Error('push.ts still contains ' + w)
  }
})
