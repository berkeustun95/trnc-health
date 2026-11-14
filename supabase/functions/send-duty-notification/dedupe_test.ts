// deno test supabase/functions/send-duty-notification/dedupe_test.ts
import { lastSignIns, MAX_SIGNIN_LOOKUPS, onePerToken, sharedTokenIds } from './push.ts'

const eq = (a: unknown, b: unknown, m: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)
}
const P = (id: string, push_token: string | null, preferred_language = 'Turkish') => ({ id, push_token, preferred_language })

Deno.test('two accounts on one token → one message (the 2026-11-13 duplicate)', () => {
  const out = onePerToken([P('a', 'T1'), P('b', 'T1'), P('c', 'T2')])
  eq(out.map((p) => p.push_token), ['T1', 'T2'], 'tokens')
  eq(out.length, 2, 'count')
})

Deno.test('the most recent sign-in wins the shared token, whatever the input order', () => {
  const rows = [P('old', 'T1', 'Turkish'), P('new', 'T1', 'English')]
  eq(onePerToken(rows, new Map([['old', 1], ['new', 2]])).map((p) => p.id), ['new'], 'new last')
  eq(onePerToken([...rows].reverse(), new Map([['old', 1], ['new', 2]])).map((p) => p.id), ['new'], 'new first')
})

Deno.test('unknown sign-in loses; full tie keeps input order; no token and empty token are skipped', () => {
  eq(onePerToken([P('x', 'T1'), P('y', 'T1')], new Map([['y', 5]])).map((p) => p.id), ['y'], 'known beats unknown')
  eq(onePerToken([P('x', 'T1'), P('y', 'T1')]).map((p) => p.id), ['x'], 'tie keeps first')
  eq(onePerToken([P('x', null), P('y', '')]).length, 0, 'no token')
})

Deno.test('three accounts on one token and unshared tokens untouched', () => {
  const rows = [P('a', 'T1'), P('b', 'T1'), P('c', 'T1'), P('d', 'T2'), P('e', 'T3')]
  eq(onePerToken(rows).length, 3, 'one per token')
  eq(sharedTokenIds(rows), ['a', 'b', 'c'], 'only the shared ids are looked up')
})

Deno.test('sign-in lookups: failures and junk never throw, and are bounded', async () => {
  const m = await lastSignIns(['ok', 'null', 'junk', 'boom'], async (id) => {
    if (id === 'boom') throw new Error('network')
    return id === 'ok' ? '2026-11-13T15:55:00Z' : id === 'junk' ? 'not a date' : null
  })
  eq([...m.keys()], ['ok'], 'only the parseable one')
  let calls = 0
  await lastSignIns(Array.from({ length: MAX_SIGNIN_LOOKUPS + 10 }, (_, i) => `u${i}`), async () => { calls++; return null })
  eq(calls, MAX_SIGNIN_LOOKUPS, 'bounded')
})

Deno.test('a hung sign-in lookup cannot stall the send: answers inside the budget count, the rest lose', async () => {
  const t0 = Date.now()
  const m = await lastSignIns(['fast', 'hang'], (id) =>
    id === 'fast' ? Promise.resolve('2026-11-13T15:55:00Z') : new Promise(() => {}), 200)
  const took = Date.now() - t0
  eq([...m.keys()], ['fast'], 'only the answered one')
  if (took > 1000) throw new Error(`waited ${took} ms, budget 200`)
})
