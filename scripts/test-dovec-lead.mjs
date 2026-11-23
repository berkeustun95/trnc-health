// dovec-lead: the pure core (supabase/functions/_shared/dovec-lead.mjs) with an in-memory store and a mocked fetch.
// No network: fetch is always a stub. The two mock locks, the allow-listed outgoing body, idempotency, consent, rate
// limits, the language map and the retry path. Fixtures are fictional (supabase/functions/sync-dovec/fixtures/).
//   node scripts/test-dovec-lead.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  validateLead, payloadHash, buildOutgoing, deliver, handleLead, retryDue, languageCode, isLive,
  LEADS_LIVE_ALLOWED, LIMITS, MAX_ATTEMPTS,
} from '../supabase/functions/_shared/dovec-lead.mjs'

const dir = new URL('../supabase/functions/sync-dovec/fixtures/', import.meta.url)
const BODY = JSON.parse(readFileSync(fileURLToPath(new URL('lead-body.json', dir)), 'utf8'))
const PROJECTS = JSON.parse(readFileSync(fileURLToPath(new URL('projects.json', dir)), 'utf8')).projects
const clone = o => JSON.parse(JSON.stringify(o))
const USER = { kind: 'user', id: 'user-a' }
const T0 = new Date('2026-11-23T10:00:00Z')

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}

const makeStore = ({ visible = true, preload = [] } = {}) => {
  const s = { leads: [...preload], seq: preload.length, updates: [] }
  s.findByRequest = async (u, c) => s.leads.find(l => l.user_id === u && l.client_request_id === c) ?? null
  s.getVisibleProject = async id => (visible ? PROJECTS.find(p => p.id === id) ?? null : null)
  s.countLeads = async ({ userId, sinceIso }) => s.leads.filter(l => (!userId || l.user_id === userId) && l.created_at >= sinceIso).length
  s.insertLead = async row => {
    if (s.leads.some(l => l.user_id === row.user_id && l.client_request_id === row.client_request_id)) throw Object.assign(new Error('dup'), { code: '23505' })
    const lead = { id: ++s.seq, external_id: `ADA-${s.seq}`, attempts: 0, created_at: T0.toISOString(), ...row }
    s.leads.push(lead); return { ...lead }
  }
  s.updateLead = async (id, patch) => { s.updates.push(patch); Object.assign(s.leads.find(l => l.id === id), patch) }
  s.dueLeads = async (limit, nowIso) => s.leads.filter(l => ['retry', 'pending'].includes(l.status) && (l.next_attempt_at ?? '') <= nowIso).slice(0, limit)
  return s
}
const stub = (status = 202, headers = {}) => { const f = async (u, o) => { f.calls.push({ u, o }); return { status, headers: { get: k => headers[k.toLowerCase()] ?? null } } }; f.calls = []; return f }
const deps = (store, { mode = undefined, live = undefined, fetchImpl = stub(), apiKey = 'test-key-not-real' } = {}) => ({
  store, fetchImpl, now: () => T0, log: () => {}, liveAllowed: live, env: { mode, apiKey, baseUrl: 'https://example.invalid' },
})
const post = (body, store, d, caller = USER) => handleLead({ caller, body, deps: d ?? deps(store) })

console.log('the two locks')
t('LEADS_LIVE_ALLOWED ships false', LEADS_LIVE_ALLOWED, false)
for (const [label, allowed, mode, want] of [['code false, secret unset', false, undefined, false], ['code false, secret live', false, 'live', false],
  ['code true, secret unset', true, undefined, false], ['code true, secret "mock"', true, 'mock', false], ['code true, secret "LIVE"', true, 'LIVE', false], ['code true, secret live', true, 'live', true]]) {
  t(`isLive: ${label}`, isLive(mode, allowed), want)
}
{
  const f = stub(); const store = makeStore()
  const r = await post(BODY, store, deps(store, { mode: 'live', fetchImpl: f }))   // code constant still false
  t('secret live but the code constant is false: no fetch, status mock', [f.calls.length, r.body.status, r.body.ok], [0, 'mock', true])
}
{
  const f = stub(); const store = makeStore()
  const r = await post(BODY, store, deps(store, { live: true, fetchImpl: f }))     // secret unset
  t('code true but no secret: no fetch, status mock', [f.calls.length, r.body.status], [0, 'mock'])
}
{
  const f = stub(); const store = makeStore()
  const r = await post(BODY, store, deps(store, { mode: 'live', live: true, fetchImpl: f }))
  t('both locks open: exactly one fetch', f.calls.length, 1)
  const sent = JSON.parse(f.calls[0].o.body)
  t('only the allowed keys, in the Döveç names', Object.keys(sent).sort(), ['consent', 'email', 'external_id', 'language', 'message', 'name', 'phone', 'project', 'unit_type'])
  t('values: normalised phone, de, project id, server external_id, consent true', [sent.phone, sent.language, sent.project, sent.external_id, sent.consent], ['+441234567890', 'de', 'fx-harbour-view', 'ADA-1', true])
  t('POST to /api/partner/leads with Bearer', [f.calls[0].u, f.calls[0].o.method, f.calls[0].o.headers.Authorization], ['https://example.invalid/api/partner/leads', 'POST', 'Bearer test-key-not-real'])
  t('202: stored sent, user gets ok + external id', [store.leads[0].status, r.body], ['sent', { ok: true, external_id: 'ADA-1', status: 'sent' }])
}
{
  const f = stub(); const store = makeStore()
  const noKey = await post(BODY, store, deps(store, { mode: 'live', live: true, fetchImpl: f, apiKey: null }))
  t('both locks but no partner key: still no fetch', [f.calls.length, noKey.body.status], [0, 'mock'])
}
t('buildOutgoing refuses without consent', (() => { try { buildOutgoing({ consent: false, name: 'x', phone: '+441234567', external_id: 'ADA-1', language_code: 'en' }); return 'sent' } catch { return 'refused' } })(), 'refused')
t('buildOutgoing omits empty optionals', Object.keys(buildOutgoing({ consent: true, name: 'x', phone: '+441234567', email: null, message: '', unit_type: null, project_id: 'p', external_id: 'ADA-1', language_code: 'en' })).sort(), ['consent', 'external_id', 'language', 'name', 'phone', 'project'])

console.log('validation')
for (const [label, patch, want] of [
  ['no consent', { consent: false }, [400, 'consent_required']], ['consent as string "true"', { consent: 'true' }, [400, 'consent_required']],
  ['consent missing', { consent: undefined }, [400, 'consent_required']],
  ['stale consent version', { consent_text_version: 'old' }, [400, 'invalid_request']],
  ['unknown field', { extra: 1 }, [400, 'invalid_request']], ['user_id in the body', { user_id: 'someone' }, [400, 'invalid_request']],
  ['bad request id', { client_request_id: 'abc' }, [400, 'invalid_request']],
  ['empty name', { name: '   ' }, [400, 'invalid_request']], ['name 121 chars', { name: 'x'.repeat(121) }, [400, 'invalid_request']],
  ['phone without +', { phone: '441234567890' }, [400, 'invalid_request']], ['phone too short', { phone: '+123' }, [400, 'invalid_request']],
  ['bad email', { email: 'nope' }, [400, 'invalid_request']], ['message 2001 chars', { message: 'x'.repeat(2001) }, [400, 'invalid_request']],
]) {
  const r = await post({ ...clone(BODY), ...patch }, makeStore())
  t(label, [r.status, r.body.error], want)
}
t('the 400 names the field, never the value', (await post({ ...clone(BODY), phone: 'secret-ish' }, makeStore())).body, { error: 'invalid_request', field: 'phone' })
t('name 120 chars is fine', validateLead({ ...clone(BODY), name: 'x'.repeat(120) }).ok, true)
t('optional email/message/unit_type may be empty or absent', validateLead({ ...clone(BODY), email: '', message: null, unit_type: undefined }).value.email, null)
t('unknown language falls back to English', validateLead({ ...clone(BODY), language: 'Klingon' }).value.language, 'English')
t('language map covers all nine and defaults en', ['English', 'Turkish', 'Arabic', 'Russian', 'Greek', 'French', 'Spanish', 'German', 'Persian', 'Klingon'].map(languageCode), ['en', 'tr', 'ar', 'ru', 'el', 'fr', 'es', 'de', 'fa', 'en'])
t('a non-object body is refused', (await post('hi', makeStore())).status, 400)
{
  const store = makeStore()
  t('unit type that the project does not have: 400', (await post({ ...clone(BODY), unit_type: '9+9' }, store)).body, { error: 'invalid_request', field: 'unit_type' })
  t('project not visible (unlisted / suspended / stale): 404', (await post(BODY, makeStore({ visible: false }))).body, { error: 'project_unavailable' })
  t('unknown project id: 404', (await post({ ...clone(BODY), project_id: 'nope' }, makeStore())).status, 404)
  t('nothing was stored by any of the refusals', store.leads.length, 0)
}
t('a service caller cannot create a lead', (await post(BODY, makeStore(), undefined, { kind: 'service' })).status, 403)

console.log('idempotency')
{
  const store = makeStore(); const d = deps(store)
  const a = await post(BODY, store, d)
  const b = await post(BODY, store, d)
  t('same request id + same payload: one row, same external id, no second send', [store.leads.length, a.body.external_id, b.body.external_id], [1, 'ADA-1', 'ADA-1'])
  t('same request id, phone edited: 409 request_changed', (await post({ ...clone(BODY), phone: '+441234567891' }, store, d)).body, { error: 'request_changed' })
  t('different spacing of the same phone is the SAME payload', (await post({ ...clone(BODY), phone: '+4412 3456 7890' }, store, d)).body.external_id, 'ADA-1')
  const c = await post({ ...clone(BODY), client_request_id: '99999999-2222-4333-8444-555555555555' }, store, d)
  t('a new request id is a new lead with a new external id', [store.leads.length, c.body.external_id], [2, 'ADA-2'])
  const other = await post(BODY, store, d, { kind: 'user', id: 'user-b' })
  t('another user with the same request id is their own lead (no cross-user collision, no leak)', [other.body.external_id, store.leads.length], ['ADA-3', 3])
  t('payload hash ignores the request id', await payloadHash(validateLead(BODY).value) === await payloadHash(validateLead({ ...clone(BODY), client_request_id: '99999999-2222-4333-8444-555555555555' }).value), true)
}
{
  const store = makeStore()
  const orig = store.findByRequest; let first = true
  store.findByRequest = async (u, c) => { if (first) { first = false; return null } return orig(u, c) }
  await store.insertLead({ user_id: USER.id, client_request_id: BODY.client_request_id.toLowerCase(), payload_hash: await payloadHash(validateLead(BODY).value), status: 'mock', consent: true })
  const r = await post(BODY, store)
  t('a double-tap race (unique violation) resolves to the existing lead', [store.leads.length, r.body.ok], [1, true])
}

console.log('rate limits')
{
  const store = makeStore(); const d = deps(store); const rid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const codes = []
  for (let i = 1; i <= 5; i++) codes.push((await post({ ...clone(BODY), client_request_id: rid(i) }, store, d)).status)
  t(`per user ${LIMITS.perUserHour} an hour: 4th and 5th refused`, codes, [200, 200, 200, 429, 429])
  t('a different user is not affected', (await post({ ...clone(BODY), client_request_id: rid(9) }, store, d, { kind: 'user', id: 'user-b' })).status, 200)
  t('a replay of an accepted request is still answered (not rate limited)', (await post({ ...clone(BODY), client_request_id: rid(1) }, store, d)).status, 200)
}
{
  const day = Array.from({ length: LIMITS.perUserDay }, (_, i) => ({ id: i + 1, user_id: 'user-a', client_request_id: `x${i}`, created_at: '2026-11-22T20:00:00.000Z', status: 'sent' }))
  t(`per user ${LIMITS.perUserDay} a day (older than an hour): refused`, (await post(BODY, makeStore({ preload: day }))).status, 429)
  const global = Array.from({ length: LIMITS.globalDay }, (_, i) => ({ id: i + 1, user_id: `u${i}`, client_request_id: `x${i}`, created_at: '2026-11-22T20:00:00.000Z', status: 'sent' }))
  t(`global ${LIMITS.globalDay} a day: refused`, (await post(BODY, makeStore({ preload: global }))).status, 429)
}

console.log('delivery outcomes (both locks open, mocked fetch)')
const live = (status, headers) => async () => { const store = makeStore(); const f = stub(status, headers); const r = await post(BODY, store, deps(store, { mode: 'live', live: true, fetchImpl: f })); return { r, l: store.leads[0], f } }
for (const [code, headers, status] of [[202, {}, 'sent'], [200, {}, 'sent'], [400, {}, 'rejected'], [422, {}, 'rejected'], [404, {}, 'rejected'], [500, {}, 'retry'], [503, {}, 'retry'], [429, { 'retry-after': '120' }, 'retry'], [401, {}, 'retry']]) {
  const { r, l } = await live(code, headers)()
  t(`HTTP ${code} -> ${status}`, [l.status, l.attempts, l.last_http_status], [status, 1, code])
  if (status === 'rejected') t('  rejected: user sees ok:false with the external id', r.body, { ok: false, error: 'rejected', external_id: 'ADA-1' })
  if (status === 'retry') t('  retry: user still sees the thank-you', [r.body.ok, r.body.status], [true, 'retry'])
}
{
  const { l } = await live(429, { 'retry-after': '120' })()
  t('429 honours Retry-After', l.next_attempt_at, '2026-11-23T10:02:00.000Z')
  const e = await (async () => { const store = makeStore(); const f = async () => { throw new Error('boom') }; await post(BODY, store, deps(store, { mode: 'live', live: true, fetchImpl: f })); return store.leads[0] })()
  t('network error -> retry, no HTTP status', [e.status, e.last_http_status], ['retry', null])
}

console.log('retry mode')
{
  const store = makeStore(); const f = stub(500)
  await post(BODY, store, deps(store, { mode: 'live', live: true, fetchImpl: f }))
  const lead = store.leads[0]
  const ok = stub(202)
  const later = { ...deps(store, { mode: 'live', live: true, fetchImpl: ok }), now: () => new Date('2026-11-23T10:06:00Z') }
  const res = await handleLead({ caller: { kind: 'service' }, body: { mode: 'retry' }, deps: later })
  t('retry resends the SAME external id and stored payload', [JSON.parse(ok.calls[0].o.body).external_id, JSON.parse(ok.calls[0].o.body).phone], ['ADA-1', '+441234567890'])
  t('retry result is counts only', [res.body.ok, res.body.processed, res.body.sent, lead.status], [true, 1, 1, 'sent'])
  t('a sent lead is not picked up again', (await retryDue(later)).body.processed, 0)
}
{
  const store = makeStore(); const f = stub(500)
  const d = deps(store, { mode: 'live', live: true, fetchImpl: f })
  await post(BODY, store, d)
  for (let i = 1; i < MAX_ATTEMPTS; i++) { store.leads[0].next_attempt_at = '2026-11-23T00:00:00.000Z'; await retryDue(d) }
  t(`after ${MAX_ATTEMPTS} failed attempts the lead is failed`, [store.leads[0].status, store.leads[0].attempts], ['failed', MAX_ATTEMPTS])
}
{
  const store = makeStore(); const f = stub(500)
  await post(BODY, store, deps(store, { mode: 'live', live: true, fetchImpl: f }))
  const wiped = stub(202)
  store.leads[0].name = null; store.leads[0].phone = null; store.leads[0].next_attempt_at = '2026-11-23T00:00:00.000Z'
  await retryDue(deps(store, { mode: 'live', live: true, fetchImpl: wiped }))
  t('a lead whose PII was wiped is failed, never sent', [store.leads[0].status, wiped.calls.length], ['failed', 0])
}
{
  const store = makeStore(); const f = stub(500)
  await post(BODY, store, deps(store, { mode: 'live', live: true, fetchImpl: f }))
  store.leads[0].next_attempt_at = '2026-11-23T00:00:00.000Z'
  const nofetch = stub(202)
  const r = await retryDue(deps(store, { fetchImpl: nofetch }))
  t('retry while NOT live leaves a retry lead alone and calls nothing', [r.body.processed, store.leads[0].status, nofetch.calls.length], [0, 'retry', 0])
  store.leads.push({ id: 99, external_id: 'ADA-99', status: 'pending', next_attempt_at: '2026-11-23T00:00:00.000Z', consent: true, attempts: 0 })
  await retryDue(deps(store, { fetchImpl: nofetch }))
  t('retry while NOT live settles a stuck pending lead as mock', [store.leads.find(l => l.id === 99).status, nofetch.calls.length], ['mock', 0])
}
t('a user cannot trigger retry mode', (await post({ mode: 'retry' }, makeStore())).status, 403)
t('a service caller with another mode is refused', (await post({ mode: 'send' }, makeStore(), undefined, { kind: 'service' })).status, 403)

console.log('logs carry no personal data')
{
  const lines = []; const store = makeStore(); const d = { ...deps(store, { mode: 'live', live: true, fetchImpl: stub(202) }), log: s => lines.push(s) }
  await post(BODY, store, d)
  t('one log line: external id, status, http code', lines, ['dovec-lead ADA-1 sent http=202'])
  t('no name, phone, e-mail or user id in it', lines.some(l => /Test Person|441234|example\.com|user-a/.test(l)), false)
}

console.log(bad ? `\n${bad} FAILED` : '\nall passed')
process.exit(bad ? 1 : 0)
