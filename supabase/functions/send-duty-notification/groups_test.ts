// deno test supabase/functions/send-duty-notification/groups_test.ts
import { GROUP_GAP_MS, GROUP_SIZE, pushOutcome, RUN_DEADLINE_MS, sendGroups } from './push.ts'

const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`) }
const msgs = (n: number) => Array.from({ length: n }, (_, i) => ({ to: `ExponentPushToken[t${i}]` }))
const okRes = (n: number) => new Response(JSON.stringify({ data: Array(n).fill({ status: 'ok', id: 'x' }) }), { status: 200 })

type Answer = 'ok' | '503' | 'timeout' | 'fetch_failed'
function rig(answers: Record<number, Answer> = {}, opts: { clock?: { t: number }; perSendMs?: number } = {}) {
  const sizes: number[] = []
  const sleeps: number[] = []
  const events: string[] = []
  const fetchFn = async (_u: string, init: RequestInit) => {
    const n = JSON.parse(String(init.body)).length
    const idx = sizes.push(n) - 1
    events.push('fetch')
    if (opts.clock) opts.clock.t += opts.perSendMs ?? 0
    const a = answers[idx] ?? 'ok'
    if (a === '503') return new Response('x', { status: 503 })
    if (a === 'timeout') throw new DOMException('t', 'TimeoutError')
    if (a === 'fetch_failed') throw new TypeError('tcp')
    return okRes(n)
  }
  const sleep = (ms: number) => { sleeps.push(ms); events.push('sleep'); return Promise.resolve() }
  return { sizes, sleeps, events, fetchFn, sleep }
}
const quiet = async <T>(f: () => Promise<T>) => { const oe = console.error; console.error = () => {}; try { return await f() } finally { console.error = oe } }

Deno.test('constants: 25, 500 ms, 90 s', () => {
  eq([GROUP_SIZE, GROUP_GAP_MS, RUN_DEADLINE_MS], [25, 500, 90_000], 'constants')
})

Deno.test('140 messages: groups [25,25,25,25,25,15], sleep exactly 5x of 500, between groups only', async () => {
  const r = rig()
  const out = await sendGroups(msgs(140), { fetchFn: r.fetchFn, sleep: r.sleep })
  eq(r.sizes, [25, 25, 25, 25, 25, 15], 'sizes')
  eq(r.sleeps, [500, 500, 500, 500, 500], 'sleeps')
  eq(r.events, ['fetch', 'sleep', 'fetch', 'sleep', 'fetch', 'sleep', 'fetch', 'sleep', 'fetch', 'sleep', 'fetch'], 'none before first, none after last')
  eq([out.ok, out.errors, out.groupsAccepted, out.groupsFailed, { ...out.kinds }], [140, 0, 6, 0, {}], 'result')
})

Deno.test('edge cases 0, 1, 25, 26 messages', async () => {
  for (const [n, sizes, sleeps] of [[0, [], 0], [1, [1], 0], [25, [25], 0], [26, [25, 1], 1]] as [number, number[], number][]) {
    const r = rig()
    const out = await sendGroups(msgs(n), { fetchFn: r.fetchFn, sleep: r.sleep })
    eq(r.sizes, sizes, `sizes for ${n}`); eq(r.sleeps.length, sleeps, `sleeps for ${n}`)
    eq([out.ok, out.groupsAccepted, out.groupsFailed], [n, sizes.length, 0], `result for ${n}`)
  }
})

Deno.test('a refused group (503 / timeout / fetch_failed) is counted, never re-sent; the other groups still go', async () => {
  for (const [bad, kind] of [['503', 'http_503'], ['timeout', 'timeout'], ['fetch_failed', 'fetch_failed']] as [Answer, string][]) {
    const r = rig({ 2: bad })
    const out = await quiet(() => sendGroups(msgs(140), { fetchFn: r.fetchFn, sleep: r.sleep }))
    eq(r.sizes, [25, 25, 25, 25, 25, 15], `fetch count == group count for ${bad}`)
    eq([out.ok, out.errors, out.groupsAccepted, out.groupsFailed, { ...out.kinds }], [115, 25, 5, 1, { [kind]: 25 }], bad)
    eq(pushOutcome(140, out.groupsAccepted, out.groupsFailed), 'partial', 'outcome')
  }
})

Deno.test('kinds are summed across groups; all groups refused is push_failed', async () => {
  const r = rig({ 0: '503', 1: 'timeout', 2: '503', 3: 'fetch_failed', 4: '503', 5: 'timeout' })
  const out = await quiet(() => sendGroups(msgs(140), { fetchFn: r.fetchFn, sleep: r.sleep }))
  eq({ ...out.kinds }, { http_503: 75, timeout: 40, fetch_failed: 25 }, 'kinds')
  eq([out.ok, out.errors, out.groupsFailed], [0, 140, 6], 'counts')
  eq(pushOutcome(140, out.groupsAccepted, out.groupsFailed), 'push_failed', 'outcome')
})

Deno.test('deadline: once 90 s have passed since the run start, no new group starts; the rest is run_deadline', async () => {
  const clock = { t: 1_000_000 }
  const r = rig({}, { clock, perSendMs: 40_000 })
  const out = await sendGroups(msgs(140), { fetchFn: r.fetchFn, sleep: r.sleep, now: () => clock.t, runStartMs: 1_000_000 })
  eq(r.sizes, [25, 25, 25], 'only groups started before 90 s: t=0, 40 s, 80 s')
  eq([out.ok, out.errors, out.groupsAccepted, out.groupsFailed, { ...out.kinds }], [75, 65, 3, 3, { run_deadline: 65 }], 'result')
  eq(pushOutcome(140, out.groupsAccepted, out.groupsFailed), 'partial', 'outcome')
})

Deno.test('deadline counts from the caller\'s run start (time spent reading profiles counts)', async () => {
  const clock = { t: 100_000 }
  const r = rig({}, { clock })
  const out = await sendGroups(msgs(60), { fetchFn: r.fetchFn, sleep: r.sleep, now: () => clock.t, runStartMs: 10_000 })
  eq(r.sizes, [], 'nothing sent: already 90 s past the run start')
  eq([out.errors, out.groupsAccepted, out.groupsFailed, { ...out.kinds }], [60, 0, 3, { run_deadline: 60 }], 'result')
  eq(pushOutcome(60, out.groupsAccepted, out.groupsFailed), 'push_failed', 'outcome')
})

Deno.test('deadline positive control: clock stays under 90 s, every group is sent', async () => {
  const clock = { t: 1_000_000 }
  const r = rig({}, { clock, perSendMs: 10_000 })
  const out = await sendGroups(msgs(140), { fetchFn: r.fetchFn, sleep: r.sleep, now: () => clock.t, runStartMs: 1_000_000 })
  eq(r.sizes, [25, 25, 25, 25, 25, 15], 'all sent')
  eq([out.ok, out.errors, out.groupsFailed, { ...out.kinds }], [140, 0, 0, {}], 'result')
})

Deno.test('diag: group index, size and job on every line; never a token', async () => {
  const lines: string[] = []
  const r = rig({ 1: '503' })
  await quiet(() => sendGroups(msgs(60), { fetchFn: r.fetchFn, sleep: r.sleep, diag: { runStartMs: Date.now(), job: 'weekend', log: (l) => { lines.push(l) } } }))
  const parsed = lines.map((l) => JSON.parse(l.slice('duty-push-diag '.length)))
  eq(parsed.map((p) => [p.g, p.size, p.job]), [[0, 25, 'weekend'], [1, 25, 'weekend'], [2, 10, 'weekend']], 'g/size/job')
  if (lines.some((l) => l.includes('ExponentPushToken'))) throw new Error('token in a diag line')
  const lines2: string[] = []
  await sendGroups(msgs(1), { fetchFn: rig().fetchFn, sleep: rig().sleep, diag: { runStartMs: Date.now(), log: (l) => { lines2.push(l) } } })
  eq('job' in JSON.parse(lines2[0].slice(15)), false, 'no job key unless set')
})

Deno.test('source: callers use sendGroups; no i += 100 left; marketplace-photo-review still sendBatch([message]', async () => {
  const rd = (p: string) => Deno.readTextFile(new URL(p, import.meta.url))
  for (const p of ['./index.ts', '../send-weekend-digest/index.ts', '../admin-push/send.ts']) {
    const s = await rd(p)
    if (!s.includes('sendGroups(')) throw new Error(p + ' does not call sendGroups')
    if (s.includes('sendBatch(')) throw new Error(p + ' still calls sendBatch')
  }
  if (!(await rd('../marketplace-photo-review/index.ts')).includes('sendBatch([message]')) throw new Error('photo review changed')
  for await (const dir of Deno.readDir(new URL('..', import.meta.url))) {
    if (!dir.isDirectory) continue
    for await (const f of Deno.readDir(new URL(`../${dir.name}/`, import.meta.url))) {
      if (!/\.(ts|mjs|js)$/.test(f.name) || /_test\./.test(f.name)) continue
      if (/i \+= 100\b/.test(await rd(`../${dir.name}/${f.name}`))) throw new Error(`i += 100 left in ${dir.name}/${f.name}`)
    }
  }
})
