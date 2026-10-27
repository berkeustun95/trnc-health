// deno test supabase/functions/send-duty-notification/push_test.ts
import { sendBatch, type SendDeps } from './push.ts'

const batch = Array.from({ length: 100 }, (_, i) => ({ to: `ExponentPushToken[t${i}]` }))
const okTickets = (n: number, errs: string[] = []) =>
  new Response(JSON.stringify({ data: [...Array(n - errs.length).fill({ status: 'ok', id: 'x' }),
    ...errs.map((e) => ({ status: 'error', message: `"ExponentPushToken[secret]" is not registered`, details: { error: e } }))] }), { status: 200 })

function rig(responses: Array<() => Response | Promise<Response>>, opts: { startAt?: number; budgetMs?: number } = {}) {
  let clock = opts.startAt ?? 0
  const sleeps: number[] = []
  let calls = 0
  const deps: SendDeps = {
    fetchFn: async () => { const f = responses[calls++]; if (!f) throw new Error('unexpected extra fetch'); return await f() },
    sleep: async (ms) => { sleeps.push(ms); clock += ms },
    now: () => clock, random: () => 0, runStartedAt: 0, budgetMs: opts.budgetMs,
  }
  return { deps, sleeps, calls: () => calls }
}
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`) }

Deno.test('503, 503, 200: retried twice and counted ok', async () => {
  const r = rig([() => new Response('x', { status: 503 }), () => new Response('x', { status: 503 }), () => okTickets(100)])
  const out = await sendBatch(batch, r.deps)
  eq([out.ok, out.errors, out.retries, r.calls(), r.sleeps], [100, 0, 2, 3, [1000, 2000]], 'result')
})

Deno.test('200 with error tickets is NOT retried (would double-push)', async () => {
  const r = rig([() => okTickets(100, ['DeviceNotRegistered', 'DeviceNotRegistered', 'MessageTooBig'])])
  const out = await sendBatch(batch, r.deps)
  eq([out.ok, out.errors, out.retries, r.calls()], [97, 3, 0, 1], 'result')
  eq({ ...out.kinds }, { DeviceNotRegistered: 2, MessageTooBig: 1 }, 'kinds')
})

Deno.test('429 with Retry-After honoured; a 4xx other than 429 is not retried', async () => {
  const r = rig([() => new Response('x', { status: 429, headers: { 'retry-after': '7' } }), () => okTickets(100)])
  const out = await sendBatch(batch, r.deps)
  eq([out.ok, out.retries, r.sleeps], [100, 1, [7000]], '429')
  const r2 = rig([() => new Response('x', { status: 400 })])
  const o2 = await sendBatch(batch, r2.deps)
  eq([o2.errors, o2.retries, r2.calls(), { ...o2.kinds }], [100, 0, 1, { http_400: 100 }], '400')
})

Deno.test('thrown fetch is retried; three retries max, then all counted as errors', async () => {
  const boom = () => { throw new TypeError('network down') }
  const r = rig([boom, boom, boom, boom])
  const out = await sendBatch(batch, r.deps)
  eq([out.ok, out.errors, out.retries, r.calls(), r.sleeps, { ...out.kinds }], [0, 100, 3, 4, [1000, 2000, 4000], { fetch_failed: 100 }], 'result')
})

Deno.test('budget exhausted: remaining retries skipped and counted as errors', async () => {
  const r = rig([() => new Response('x', { status: 503 })], { startAt: 44_500 })
  const out = await sendBatch(batch, r.deps)
  eq([out.ok, out.errors, out.retries, r.calls(), r.sleeps], [0, 100, 0, 1, []], 'result')
  // Retry-After longer than the budget is capped by it, not obeyed
  const r2 = rig([() => new Response('x', { status: 429, headers: { 'retry-after': '120' } })])
  const o2 = await sendBatch(batch, r2.deps)
  eq([o2.errors, o2.retries, r2.calls()], [100, 0, 1], 'retry-after beyond budget')
})

Deno.test('unparseable 200 is not retried', async () => {
  const r = rig([() => new Response('not json', { status: 200 })])
  const out = await sendBatch(batch, r.deps)
  eq([out.errors, out.retries, r.calls(), { ...out.kinds }], [100, 0, 1, { bad_response: 100 }], 'result')
})

Deno.test('console output never carries tokens or Expo messages', async () => {
  const seen: string[] = []
  const orig = console.error
  console.error = (...a: unknown[]) => { seen.push(a.join(' ')) }
  try {
    await sendBatch(batch, rig([() => okTickets(100, ['DeviceNotRegistered']), ]).deps)
    await sendBatch(batch, rig([() => new Response('ExponentPushToken[secret]', { status: 503 }), () => new Response('ExponentPushToken[secret]', { status: 400 })]).deps)
  } finally { console.error = orig }
  eq(seen.some((l) => l.includes('ExponentPushToken') || l.includes('secret')), false, 'leak')
})
