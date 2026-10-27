// deno test supabase/functions/send-duty-notification/push_test.ts
import { pushOutcome, RUN_DEADLINE_MS, sendBatch, type SendDeps } from './push.ts'

const batch = Array.from({ length: 100 }, (_, i) => ({ to: `ExponentPushToken[t${i}]` }))
const okTickets = (n: number, errs: string[] = []) =>
  new Response(JSON.stringify({ data: [...Array(n - errs.length).fill({ status: 'ok', id: 'x' }),
    ...errs.map((e) => ({ status: 'error', message: `"ExponentPushToken[secret]" is not registered`, details: { error: e } }))] }), { status: 200 })
const tmo = () => { throw new DOMException('signal timed out', 'TimeoutError') }

// A fake clock. A scripted step may spend time: {spend: ms} advances the clock before answering; 'hang' spends
// the full per-attempt timeout it was given (what a real hung request does) and then throws TimeoutError.
type Step = (() => Response | Promise<Response>) | { spend: number; res: () => Response } | 'hang'
function rig(steps: Step[], opts: { startAt?: number } = {}) {
  let clock = opts.startAt ?? 0
  const sleeps: number[] = []
  const timeouts: number[] = []
  let calls = 0
  let lastTimeout = 0
  const deps: SendDeps = {
    fetchFn: async () => {
      const s = steps[calls++]
      if (s === undefined) throw new Error('unexpected extra fetch')
      if (s === 'hang') { clock += lastTimeout; throw new DOMException('timed out', 'TimeoutError') }
      if (typeof s === 'function') return await s()
      clock += s.spend
      return s.res()
    },
    sleep: async (ms) => { sleeps.push(ms); clock += ms },
    now: () => clock, random: () => 0, deadlineAt: RUN_DEADLINE_MS,
    makeSignal: (ms) => { lastTimeout = ms; timeouts.push(ms); return new AbortController().signal },
  }
  return { deps, sleeps, timeouts, calls: () => calls, clock: () => clock }
}
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`) }
const r503 = () => new Response('x', { status: 503 })

Deno.test('503, 503, 200: retried twice and counted ok', async () => {
  const r = rig([r503, r503, () => okTickets(100)])
  const out = await sendBatch(batch, r.deps)
  eq([out.accepted, out.ok, out.errors, out.retries, r.calls(), r.sleeps], [true, 100, 0, 2, 3, [1000, 2000]], 'result')
})

Deno.test('200 with error tickets is NOT retried (would double-push)', async () => {
  const r = rig([() => okTickets(100, ['DeviceNotRegistered', 'DeviceNotRegistered', 'MessageTooBig'])])
  const out = await sendBatch(batch, r.deps)
  eq([out.ok, out.errors, out.retries, r.calls()], [97, 3, 0, 1], 'result')
  eq({ ...out.kinds }, { DeviceNotRegistered: 2, MessageTooBig: 1 }, 'kinds')
})

Deno.test('only 503 and 429 are retried: 500, 502, 504 and 400 get exactly 1 attempt', async () => {
  for (const status of [500, 502, 504, 400]) {
    const r = rig([() => new Response('x', { status }), () => okTickets(100)])
    const out = await sendBatch(batch, r.deps)
    eq([status, out.accepted, out.retries, r.calls(), { ...out.kinds }], [status, false, 0, 1, { [`http_${status}`]: 100 }], 'status ' + status)
  }
})

Deno.test('429 with Retry-After honoured', async () => {
  const r = rig([() => new Response('x', { status: 429, headers: { 'retry-after': '7' } }), () => okTickets(100)])
  const out = await sendBatch(batch, r.deps)
  eq([out.ok, out.retries, r.sleeps], [100, 1, [7000]], '429')
})

Deno.test('timeout and abort are NOT retried: exactly 1 attempt, counted timeout', async () => {
  const r = rig([tmo, () => okTickets(100)])
  const out = await sendBatch(batch, r.deps)
  eq([out.accepted, out.ok, out.errors, out.retries, r.calls(), { ...out.kinds }], [false, 0, 100, 0, 1, { timeout: 100 }], 'timeout')
  const ab = () => { throw new DOMException('aborted', 'AbortError') }
  const r2 = rig([ab, () => okTickets(100)])
  const o2 = await sendBatch(batch, r2.deps)
  eq([o2.retries, r2.calls(), { ...o2.kinds }], [0, 1, { timeout: 100 }], 'abort')
})

Deno.test('a thrown fetch is never retried (cannot tell pre-send from mid-request)', async () => {
  const r = rig([() => { throw new TypeError('error sending request: tcp connect error') }, () => okTickets(100)])
  const out = await sendBatch(batch, r.deps)
  eq([out.accepted, out.retries, r.calls(), { ...out.kinds }], [false, 0, 1, { fetch_failed: 100 }], 'result')
})

Deno.test('503 x4: three retries then all errors, not accepted', async () => {
  const r = rig([r503, r503, r503, r503])
  const out = await sendBatch(batch, r.deps)
  eq([out.accepted, out.errors, out.retries, r.calls(), r.sleeps, { ...out.kinds }], [false, 100, 3, 4, [1000, 2000, 4000], { http_503: 100 }], 'result')
})

Deno.test('each attempt timeout is min(10 s, deadline - now - reserve)', async () => {
  const r = rig(['hang'], { startAt: 50_000 })
  await sendBatch(batch, r.deps)
  eq(r.timeouts, [3000], '55 s deadline - 50 s - 2 s reserve')
})

Deno.test('two batches: slow 503 on batch 1 (retried within room), then batch 2 hangs: total < 60 s', async () => {
  const slow503: Step = { spend: 9_000, res: r503 }
  const r = rig([slow503, slow503, slow503, slow503, 'hang'])
  const b1 = await sendBatch(batch, r.deps, 1)
  const b2 = await sendBatch(batch, r.deps, 0)
  console.log('total ms', r.clock(), 'b1', JSON.stringify({ ...b1.kinds }), 'b2', JSON.stringify({ ...b2.kinds }))
  if (r.clock() >= 60_000) throw new Error('run exceeded 60 s: ' + r.clock())
  eq(b2.accepted, false, 'batch 2 hung')
  // batch 1 must have left room for batch 2's first attempt: it was sent, with a positive timeout
  if (b2.kinds.deadline) throw new Error('batch 2 was starved by batch 1 retries')
})

Deno.test('six batches, all hang: total < 60 s, later batches counted as deadline', async () => {
  const r = rig(['hang', 'hang', 'hang', 'hang', 'hang', 'hang'])
  const kinds: Array<Record<string, number>> = []
  for (let i = 0; i < 6; i++) kinds.push({ ...(await sendBatch(batch, r.deps, 5 - i)).kinds })
  console.log('total ms', r.clock(), JSON.stringify(kinds))
  if (r.clock() >= 60_000) throw new Error('run exceeded 60 s: ' + r.clock())
  eq(kinds.slice(0, 5).every((k) => k.timeout === 100), true, 'first five timed out')
  eq(kinds[5], { timeout: 100 }, 'sixth got a shortened timeout')
  // a seventh and eighth have no time left at all and are not sent
  const r7 = rig(['hang', 'hang', 'hang', 'hang', 'hang', 'hang'], { startAt: 0 })
  for (let i = 0; i < 6; i++) await sendBatch(batch, r7.deps, 7 - i)
  const late = await sendBatch(batch, r7.deps, 0)
  eq([{ ...late.kinds }, r7.calls()], [{ deadline: 100 }, 6], 'seventh batch not sent')
})

Deno.test('outcome is batch-level: error tickets do not make a run partial', () => {
  eq(pushOutcome(110, 2, 0), 'sent', 'all batches accepted (even with dead-token tickets)')
  eq(pushOutcome(110, 1, 1), 'partial', 'one accepted, one not')
  eq(pushOutcome(110, 0, 2), 'push_failed', 'none accepted')
  eq(pushOutcome(0, 0, 0), 'sent', 'nothing to send')
})

Deno.test('accepted flag: 200 with error tickets is accepted; 400 is not; unparseable 200 is not retried', async () => {
  const a = await sendBatch(batch, rig([() => okTickets(100, ['DeviceNotRegistered'])]).deps)
  eq([a.accepted, a.errors], [true, 1], '200 with a dead token')
  const b = await sendBatch(batch, rig([() => new Response('x', { status: 400 })]).deps)
  eq(b.accepted, false, '400')
  const r = rig([() => new Response('not json', { status: 200 })])
  const c = await sendBatch(batch, r.deps)
  eq([c.accepted, c.retries, r.calls(), { ...c.kinds }], [false, 0, 1, { bad_response: 100 }], 'bad body')
})

Deno.test('console output never carries tokens or Expo messages', async () => {
  const seen: string[] = []
  const orig = console.error
  console.error = (...a: unknown[]) => { seen.push(a.join(' ')) }
  try {
    await sendBatch(batch, rig([() => okTickets(100, ['DeviceNotRegistered'])]).deps)
    await sendBatch(batch, rig([() => new Response('ExponentPushToken[secret]', { status: 503 }), () => new Response('ExponentPushToken[secret]', { status: 400 })]).deps)
  } finally { console.error = orig }
  eq(seen.some((l) => l.includes('ExponentPushToken') || l.includes('secret')), false, 'leak')
})

Deno.test('a retry is refused when it would starve the batches still to come', async () => {
  const slow503: Step = { spend: 10_000, res: r503 }
  const alone = rig([slow503, () => okTickets(100)])
  const a = await sendBatch(batch, alone.deps, 0)
  eq([a.retries, a.accepted], [1, true], 'last batch may retry')
  const withFive = rig([slow503, () => okTickets(100)])
  const b = await sendBatch(batch, withFive.deps, 5)
  eq([b.retries, withFive.calls(), { ...b.kinds }], [0, 1, { http_503: 100 }], 'five batches still to come: no retry')
})
