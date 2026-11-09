// deno test supabase/functions/marketplace-maintenance/run_test.ts
import { run, jwtRole, REMOVE_CHUNK, type Deps } from './run.ts'

const token = (role: string) => `x.${btoa(JSON.stringify({ role })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.sig`
const SERVICE = token('service_role')
const COUNTS = { expired_soft_deleted: 2, purged: 1, purge_held_by_report: 1 }
const assert = (ok: boolean, msg: string) => { if (!ok) throw new Error(msg) }

function rig(o: { orphans?: number; failChunk?: number; retentionFails?: boolean } = {}) {
  const calls = { applied: [] as boolean[], removed: [] as string[][], logs: [] as string[] }
  let chunk = 0
  const deps: Deps = {
    retention: async apply => { if (o.retentionFails) throw new Error('x'); calls.applied.push(apply); return COUNTS },
    orphans: async limit => Array.from({ length: Math.min(o.orphans ?? 0, limit) }, (_, i) => `pending/u/l/${i}.jpg`),
    remove: async paths => { if (chunk++ === o.failChunk) throw new Error('x'); calls.removed.push(paths) },
    log: c => calls.logs.push(c),
  }
  return { deps, calls }
}

Deno.test('only the service_role key may run it', async () => {
  for (const jwt of ['', 'garbage', token('authenticated'), token('anon')]) {
    const { deps, calls } = rig({ orphans: 3 })
    const r = await run(jwt, { apply: true }, deps)
    assert(r.status === 403 && calls.applied.length === 0 && calls.removed.length === 0, `${jwt} was let in`)
  }
  assert(jwtRole(SERVICE) === 'service_role', 'positive control')
})

Deno.test('no body / no apply = dry: counts, removes nothing', async () => {
  for (const body of [null, {}, { apply: 'true' }, { apply: 1 }]) {
    const { deps, calls } = rig({ orphans: 3 })
    const r = await run(SERVICE, body, deps)
    assert(r.status === 200 && r.body.applied === false && calls.applied[0] === false, 'not dry')
    assert(calls.removed.length === 0 && r.body.orphans_found === 3 && r.body.orphans_removed === 0, 'removed in a dry run')
  }
})

Deno.test('apply: retention runs, orphans removed in chunks of 100', async () => {
  const { deps, calls } = rig({ orphans: 250 })
  const r = await run(SERVICE, { apply: true }, deps)
  assert(r.status === 200 && r.body.applied === true && calls.applied[0] === true, 'not applied')
  assert(calls.removed.map(c => c.length).join() === `${REMOVE_CHUNK},${REMOVE_CHUNK},50`, 'chunks wrong')
  assert(r.body.orphans_removed === 250 && r.body.purged === 1, 'counts wrong')
})

Deno.test('a failing chunk is counted and the rest still go', async () => {
  const { deps, calls } = rig({ orphans: 250, failChunk: 1 })
  const r = await run(SERVICE, { apply: true }, deps)
  assert(r.body.orphans_removed === 150 && r.body.orphans_remove_failed === 100 && calls.logs.includes('remove_failed'), JSON.stringify(r.body))
})

Deno.test('retention failure → 500 and no sweep', async () => {
  const { deps, calls } = rig({ orphans: 5, retentionFails: true })
  const r = await run(SERVICE, { apply: true }, deps)
  assert(r.status === 500 && calls.removed.length === 0, 'swept after a failed retention')
})

Deno.test('the response carries counts only', async () => {
  const { deps } = rig({ orphans: 3 })
  const r = await run(SERVICE, { apply: true }, deps)
  assert(Object.values(r.body).every(v => typeof v === 'number' || typeof v === 'boolean'), JSON.stringify(r.body))
})
