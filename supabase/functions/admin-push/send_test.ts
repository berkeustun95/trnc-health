// deno test supabase/functions/admin-push/send_test.ts
import { handle, parseAllowlist, parseRequest, type Deps, type Profile } from './send.ts'
import { DUTY_SWAP } from './strings.mjs'

const eq = (a: unknown, b: unknown, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }
const ok = (c: unknown, m: string) => { if (!c) throw new Error(m) }

const RID = '11111111-1111-4111-8111-111111111111'
const DID = '22222222-2222-4222-8222-222222222222'
const ADMIN = '99999999-9999-4999-8999-999999999999'
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const prof = (n: number, lang: string | null, token: string | null = `ExponentPushToken[t${n}]`): Profile => ({ id: uid(n), push_token: token, preferred_language: lang })

interface Rig { d: Deps; log: string[]; claims: unknown[]; finishes: Record<string, unknown>[]; notifs: any[]; pushes: any[][]; reads: string[]; trace: string[] }
function rig(o: {
  profiles?: Profile[]; role?: 'customer' | 'provider' | null; secret?: string | null; claim?: 'claimed' | 'duplicate' | 'error'
  duty?: { name: string; duty_date: string } | null; dutyError?: boolean; profilesError?: boolean; notifFail?: boolean
  stored?: string | null; expo?: (n: number) => Response; failBatches?: number
} = {}): Rig {
  const r: Rig = { d: null as unknown as Deps, log: [], claims: [], finishes: [], notifs: [], pushes: [], reads: [], trace: [] }
  const profiles = o.profiles ?? []
  let batch = 0
  r.d = {
    testUserIds: () => o.secret,
    async claim(row) { r.trace.push('claim'); r.claims.push(row); return o.claim ?? 'claimed' },
    async storedOutcome() { r.trace.push('stored'); return o.stored ?? null },
    async finish(_id, f) { r.trace.push('finish'); r.finishes.push(f) },
    async dutyEntry() { r.trace.push('duty'); return { data: o.duty === undefined ? { name: 'Aphrodite Eczanesi', duty_date: '2026-11-20' } : o.duty, error: o.dutyError === true } },
    profilePage: (role) => (after) => {
      r.trace.push('profiles'); r.reads.push(String(role))
      if (o.profilesError) return Promise.resolve({ data: null, error: { message: 'x' }, count: null })
      const rows = profiles.filter((p) => !after || p.id > after).slice(0, 1000)
      return Promise.resolve({ data: rows, error: null, count: profiles.length })
    },
    async insertNotifications(rows) { r.trace.push('notif'); r.notifs.push(...rows); return o.notifFail !== true },
    async getLastSignIn() { return null },
    async fetchFn(_u, init) {
      r.trace.push('push'); const b = JSON.parse(String(init.body)); r.pushes.push(b)
      if (o.expo) return o.expo(b.length)
      if (batch++ < (o.failBatches ?? 0)) return new Response('x', { status: 503 })
      return new Response(JSON.stringify({ data: b.map(() => ({ status: 'ok', id: 'x' })) }), { status: 200 })
    },
    log: (c) => r.log.push(c),
  }
  return r
}
const dutyReq = (extra: Record<string, unknown> = {}) => ({ kind: 'duty_swap', request_id: RID, duty_list_id: DID, ...extra })
const bcReq = (extra: Record<string, unknown> = {}) => ({ kind: 'broadcast', request_id: RID, target: 'all', title: ' Hello ', body: ' World ', ...extra })
const noLeak = (res: unknown, extra: string[] = []) => {
  const s = JSON.stringify(res)
  for (const needle of [ADMIN, uid(1), uid(2), 'ExponentPushToken', 'Hello', 'World', 'Aphrodite', ...extra]) ok(!s.includes(needle), `response leaks ${needle}`)
}

Deno.test('validation: every 400 case, and nothing is claimed', async () => {
  const bads: unknown[] = [
    null, 'x', [], 42, {}, { kind: 'nope', request_id: RID },
    dutyReq({ request_id: 'not-a-uuid' }), dutyReq({ request_id: 5 }), dutyReq({ request_id: undefined }),
    dutyReq({ duty_list_id: 'nope' }), dutyReq({ duty_list_id: undefined }), dutyReq({ test: 'yes' }), dutyReq({ test: 1 }), dutyReq({ extra: 1 }),
    bcReq({ target: 'admins' }), bcReq({ target: undefined }), bcReq({ title: '   ' }), bcReq({ title: 5 }), bcReq({ title: 'x'.repeat(101) }),
    bcReq({ body: '' }), bcReq({ body: ' \n ' }), bcReq({ body: 'x'.repeat(301) }), bcReq({ body: null }), bcReq({ test: null }), bcReq({ duty_list_id: DID }),
  ]
  for (const b of bads) {
    const r = rig(); const res = await handle(b, ADMIN, r.d)
    eq([res.status, res.body], [400, { ok: false, error: 'bad_request' }], JSON.stringify(b))
    eq(r.trace, [], 'nothing runs before validation: ' + JSON.stringify(b))
  }
  ok(parseRequest(bcReq({ title: 'x'.repeat(100), body: 'y'.repeat(300) })) !== null, '100 / 300 chars are allowed')
  eq((parseRequest(bcReq()) as any).title, 'Hello', 'title trimmed')
  eq((parseRequest(bcReq()) as any).body, 'World', 'body trimmed')
})

Deno.test('test mode: secret missing / empty / bad uuid -> 503 before the claim', async () => {
  for (const secret of [undefined, null, '', '   ', 'nope', `${uid(1)},nope`, `${uid(1)},`, `,${uid(1)}`]) {
    const r = rig({ secret, profiles: [prof(1, 'English')] })
    const res = await handle(dutyReq({ test: true }), ADMIN, r.d)
    eq([res.status, res.body], [503, { ok: false, error: 'test_mode_unconfigured' }], String(secret))
    eq(r.trace, [], 'no claim, no read, no send: ' + String(secret))
  }
  eq(parseAllowlist(`${uid(1).toUpperCase()}, ${uid(2)}`)?.size, 2)
})

Deno.test('test mode: recipients = audience intersect allowlist; the client cannot widen it', async () => {
  const profiles = [prof(1, 'English'), prof(2, 'Turkish'), prof(3, 'Greek')]
  const r = rig({ profiles, secret: `${uid(1)},${uid(3)},${uid(4)}` })
  const res = await handle(dutyReq({ test: true }), ADMIN, r.d)
  eq([res.status, res.body.test, res.body.recipients], [200, true, 2])
  eq(r.notifs.map((n) => n.user_id), [uid(1), uid(3)])
  eq(r.claims[0], { request_id: RID, kind: 'duty_swap', test: true, admin_id: ADMIN })
  // a client-supplied list is a 400, never an extra recipient
  const r2 = rig({ profiles, secret: uid(1) })
  const res2 = await handle(dutyReq({ test: true, recipients: [uid(2)] }), ADMIN, r2.d)
  eq(res2.status, 400); eq(r2.trace, [])
  // allowlisted id outside the audience stays out (a provider is not a duty-swap customer)
  const r3 = rig({ profiles: [], secret: uid(9) })
  const res3 = await handle(dutyReq({ test: true }), ADMIN, r3.d)
  eq([res3.status, res3.body.outcome], [200, 'no_recipients'])
  // normal mode ignores the secret entirely
  const r4 = rig({ profiles, secret: uid(1) })
  eq((await handle(dutyReq(), ADMIN, r4.d)).body.recipients, 3)
  noLeak(res)
})

Deno.test('duplicate request_id: nothing read, written or pushed', async () => {
  const r = rig({ claim: 'duplicate', stored: 'sent', profiles: [prof(1, 'English')] })
  const res = await handle(dutyReq(), ADMIN, r.d)
  eq([res.status, res.body], [200, { ok: true, outcome: 'duplicate', test: false, previous: 'sent' }])
  eq(r.trace, ['claim', 'stored'])
  const r2 = rig({ claim: 'duplicate', stored: null })
  eq((await handle(bcReq({ test: false }), ADMIN, r2.d)).body.previous, 'running')
  eq(r2.trace, ['claim', 'stored'])
})

Deno.test('ledger insert error: nothing is sent', async () => {
  const r = rig({ claim: 'error', profiles: [prof(1, 'English')] })
  const res = await handle(bcReq(), ADMIN, r.d)
  eq([res.status, res.body], [500, { ok: false, error: 'server_error' }])
  eq(r.trace, ['claim'])
})

Deno.test('duty text per language, unknown / null -> English, {name}/{date} from the duty_list row', async () => {
  const langs = ['English', 'Turkish', 'Arabic', 'Russian', 'Greek', 'French', 'Spanish', 'German', 'Persian', 'Klingon', null, '']
  const profiles = langs.map((l, i) => prof(i + 1, l))
  const r = rig({ profiles, duty: { name: 'Aphrodite $& Eczanesi', duty_date: '2026-11-20' } })
  const res = await handle(dutyReq(), ADMIN, r.d)
  eq(res.status, 200)
  const bodyFor = (lang: string) => DUTY_SWAP[lang as keyof typeof DUTY_SWAP]
  langs.forEach((l, i) => {
    const s = bodyFor(l && l in DUTY_SWAP ? l : 'English')
    const n = r.notifs[i]
    eq(n.title, s.title, `title ${l}`)
    eq(n.body, s.body.replace('{name}', () => 'Aphrodite $& Eczanesi').replace('{date}', () => '2026-11-20'), `body ${l}`)
    ok(!n.body.includes('{name}') && !n.body.includes('{date}'), 'placeholders filled')
  })
  eq(r.pushes[0][0].title, r.notifs[0].title)
  eq(r.pushes[0][9].body, r.notifs[9].body, 'unknown language pushes English')
})

Deno.test('duty entry: not found -> 404 (ledger finished), read error -> 500; nobody is notified', async () => {
  const r = rig({ duty: null, profiles: [prof(1, 'English')] })
  const res = await handle(dutyReq(), ADMIN, r.d)
  eq([res.status, res.body], [404, { ok: false, error: 'duty_entry_not_found' }])
  eq(r.trace, ['claim', 'duty', 'finish']); eq(r.finishes[0], { outcome: 'duty_entry_not_found' })
  const r2 = rig({ dutyError: true })
  eq((await handle(dutyReq(), ADMIN, r2.d)).status, 500)
  eq(r2.notifs, [])
})

Deno.test('broadcast target -> role filter; text trimmed and identical for everyone; data {}', async () => {
  for (const [target, role] of [['all', 'null'], ['customers', 'customer'], ['providers', 'provider']] as const) {
    const r = rig({ profiles: [prof(1, 'English'), prof(2, 'Turkish')] })
    const res = await handle(bcReq({ target }), ADMIN, r.d)
    eq(res.status, 200); eq(r.reads[0], role, target)
    ok(r.notifs.every((n) => n.title === 'Hello' && n.body === 'World'), 'same text for every language')
    ok(r.pushes[0].every((m: any) => JSON.stringify(m.data) === '{}'), 'broadcast data is {}')
  }
})

Deno.test('in-app rows: type admin_message for every recipient (with or without token); one push per shared token; shapes', async () => {
  const profiles = [prof(1, 'English', 'ExponentPushToken[shared]'), prof(2, 'English', 'ExponentPushToken[shared]'), prof(3, 'English', null), prof(4, 'Turkish')]
  const r = rig({ profiles })
  const res = await handle(dutyReq(), ADMIN, r.d)
  eq(res.status, 200); eq(res.body.recipients, 4)
  eq(r.notifs.length, 4); ok(r.notifs.every((n) => n.type === 'admin_message'), 'type admin_message')
  eq(r.notifs.map((n) => n.user_id), profiles.map((p) => p.id))
  eq(r.pushes.flat().length, 2, 'shared token pushed once, no-token user not pushed')
  for (const m of r.pushes.flat()) {
    eq(Object.keys(m).sort(), ['body', 'data', 'sound', 'title', 'to'], 'no channelId')
    eq(m.data, { screen: 'duty' }); eq(m.sound, 'default')
  }
  eq(res.body.pushed, 2)
})

Deno.test('every Expo batch is sent exactly once, 100 per batch; outcomes', async () => {
  const profiles = Array.from({ length: 250 }, (_, i) => prof(i + 1, 'English'))
  const r = rig({ profiles })
  const res = await handle(bcReq(), ADMIN, r.d)
  eq(r.pushes.map((b) => b.length), [100, 100, 50]); eq([res.status, res.body.outcome, res.body.pushed], [200, 'sent', 250])
  eq(r.notifs.length, 250)
  const r2 = rig({ profiles, failBatches: 1 })
  eq((await handle(bcReq(), ADMIN, r2.d)).body.outcome, 'partial'); eq(r2.pushes.length, 3, 'a failed batch is not re-sent')
  const r3 = rig({ profiles: profiles.slice(0, 5), failBatches: 9 })
  const res3 = await handle(bcReq(), ADMIN, r3.d)
  eq([res3.status, res3.body], [502, { ok: false, error: 'push_failed', test: false, recipients: 5 }]); eq(r3.notifs.length, 5, 'in-app rows still written')
  eq(r3.finishes[0].outcome, 'push_failed')
})

Deno.test('no recipients; profiles read error; notification batch failure still pushes', async () => {
  const r = rig({ profiles: [] })
  const res = await handle(bcReq(), ADMIN, r.d)
  eq([res.status, res.body], [200, { ok: true, outcome: 'no_recipients', test: false, recipients: 0, pushed: 0 }]); eq(r.pushes, [])
  const r2 = rig({ profilesError: true })
  eq((await handle(bcReq(), ADMIN, r2.d)).status, 500); eq(r2.finishes[0], { outcome: 'profiles_query_failed' }); eq(r2.notifs, [])
  const r3 = rig({ profiles: [prof(1, 'English')], notifFail: true })
  const res3 = await handle(bcReq(), ADMIN, r3.d)
  eq(res3.status, 200); eq(r3.finishes[0].notified, 0); eq((r3.finishes[0].error_kinds as any).notif_batch_failed, 1)
})

Deno.test('a thrown dependency -> 500 server_error, ledger closed, no leak; ledger row carries counts only', async () => {
  const r = rig({ profiles: [prof(1, 'English')] })
  r.d.insertNotifications = () => { throw new Error('boom ExponentPushToken[secret]') }
  const res = await handle(bcReq(), ADMIN, r.d)
  eq([res.status, res.body], [500, { ok: false, error: 'server_error' }]); eq(r.log, ['unexpected_throw']); eq(r.finishes.at(-1), { outcome: 'server_error' })
  const r2 = rig({ profiles: [prof(1, 'English'), prof(2, 'English')] })
  const res2 = await handle(bcReq({ test: false }), ADMIN, r2.d)
  const f = JSON.stringify(r2.finishes); ok(!/Hello|World|ExponentPushToken/.test(f) && !f.includes(uid(1)), 'ledger fields hold no text, token or id')
  noLeak(res2); noLeak(res)
})
