// deno test supabase/functions/_shared/data-jobs_test.ts
import { dataJobGate, recordDataJobRun } from './data-jobs.mjs'

const assert = (ok: boolean, msg: string) => { if (!ok) throw new Error(msg) }
type Call = { url: string; body: any; auth: string | null }

function rig(reply: (n: number) => Response | Promise<Response>) {
  const calls: Call[] = []
  const logs: string[] = []
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).Authorization })
    return reply(calls.length)
  }
  return { calls, logs, cfg: { url: 'https://x.supabase.co/', key: 'KEY', fetchImpl, log: (c: string) => logs.push(c) } }
}
const jsonRes = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })

Deno.test('gate: paused only on an explicit "paused"', async () => {
  const r = rig(() => jsonRes('paused'))
  assert(await dataJobGate(r.cfg, 'sync-novest') === 'paused', 'paused answer must pause')
  assert(r.calls[0].url === 'https://x.supabase.co/rest/v1/rpc/data_job_gate', 'rpc url')
  assert(r.calls[0].body.p_source === 'edge' && r.calls[0].body.p_run_ref === null && r.calls[0].body.p_job === 'sync-novest', 'args')
  assert(r.calls[0].auth === 'Bearer KEY', 'service key as bearer')
})

Deno.test('gate: "run" runs (positive control for the fail-open cases)', async () => {
  assert(await dataJobGate(rig(() => jsonRes('run')).cfg, 'sync-novest') === 'run', 'run')
})

Deno.test('gate fails open: 404 (RPC not applied yet), 500, garbage, odd bodies, throw, timeout, no config', async () => {
  for (const mk of [
    () => jsonRes({ code: 'PGRST202' }, 404),
    () => jsonRes({ message: 'UNKNOWN_JOB' }, 400),
    () => jsonRes('x', 500),
    () => new Response('not json', { status: 200 }),
    () => jsonRes({ paused: true }),
    () => jsonRes(null),
    () => jsonRes('PAUSED'),
  ]) assert(await dataJobGate(rig(mk).cfg, 'sync-novest') === 'run', 'must run')
  const t = rig(() => { throw new Error('net') })
  assert(await dataJobGate(t.cfg, 'sync-novest') === 'run', 'throw must run')
  const slow = rig(() => new Promise<Response>(() => {}))
  const t0 = Date.now()
  assert(await dataJobGate({ ...slow.cfg, timeoutMs: 30, fetchImpl: (_u: string, i: RequestInit) =>
    new Promise<Response>((_, rej) => (i.signal as AbortSignal).addEventListener('abort', () => rej(new Error('abort')))) }, 'sync-novest') === 'run', 'timeout must run')
  assert(Date.now() - t0 < 2000, 'timeout is short')
  assert(await dataJobGate({ url: undefined, key: undefined }, 'sync-novest') === 'run', 'unconfigured must run')
})

Deno.test('gate never logs a body, URL or key', async () => {
  const r = rig(() => jsonRes({ message: 'secret-detail KEY' }, 400))
  await dataJobGate(r.cfg, 'sync-novest')
  assert(r.logs.length === 1 && r.logs[0] === 'data_jobs_data_job_gate_status_400', `log was ${r.logs}`)
})

Deno.test('record: ok sends no error class; failed keeps a clean class; a bad class becomes unknown', async () => {
  const r = rig(() => jsonRes(1))
  await recordDataJobRun(r.cfg, 'sync-novest', 'ok', 'ignored', 1_700_000_000_000)
  await recordDataJobRun(r.cfg, 'sync-novest', 'failed', 'write_failed', 1_700_000_000_000)
  await recordDataJobRun(r.cfg, 'sync-novest', 'failed', 'upsert: 12 rows https://x', 1_700_000_000_000)
  await recordDataJobRun(r.cfg, 'sync-novest', 'failed', null, NaN)
  const [a, b, c, d] = r.calls.map(c => c.body)
  assert(a.p_outcome === 'ok' && a.p_error_class === null && a.p_started_at === '2023-11-14T22:13:20.000Z', 'ok row')
  assert(b.p_outcome === 'failed' && b.p_error_class === 'write_failed', 'failed row')
  assert(c.p_error_class === 'unknown', 'free text must not pass')
  assert(d.p_error_class === 'unknown' && d.p_started_at === null && d.p_source === 'edge' && d.p_run_ref === null, 'null class, bad start')
})

Deno.test('record never throws: 404, 500, throw, no config', async () => {
  await recordDataJobRun(rig(() => jsonRes({}, 404)).cfg, 'sync-novest', 'ok', null, Date.now())
  await recordDataJobRun(rig(() => jsonRes({}, 500)).cfg, 'sync-novest', 'ok', null, Date.now())
  await recordDataJobRun(rig(() => { throw new Error('x') }).cfg, 'sync-novest', 'ok', null, Date.now())
  await recordDataJobRun({}, 'sync-novest', 'ok', null, Date.now())
})
