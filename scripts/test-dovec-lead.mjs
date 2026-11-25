// dovec-lead: the pure core (supabase/functions/_shared/dovec-lead.mjs) with an in-memory store and a mocked fetch.
// No network: fetch is always a stub. The two mock locks, the allow-listed outgoing body, idempotency, consent, rate
// limits, the language map and the retry path. Fixtures are fictional (supabase/functions/sync-dovec/fixtures/).
//   node scripts/test-dovec-lead.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  validateLead, payloadHash, buildOutgoing, deliver, handleLead, retryDue, languageCode, isLive,
  TEST_LEAD_ALLOWED, TEST_LEAD, isTestOpen, handleTestLead, TEST_PROJECT_SEED,
  LEADS_LIVE_ALLOWED, LIMITS, MAX_ATTEMPTS, isUnder18, DEFAULT_BASE_URL,
} from '../supabase/functions/_shared/dovec-lead.mjs'
import { secretKeyCaller } from '../supabase/functions/_shared/caller-auth.mjs'
import { readdirSync } from 'node:fs'

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

const DPOINT = { id: 'dp-fixture-1', name: 'D-Point' }
const makeStore = ({ visible = true, preload = [], dob = null, dbLimits = false, published = true, admin = false, testProject = DPOINT } = {}) => {
  const s = { leads: [...preload], seq: preload.length, updates: [], calls: { isPublished: 0, isAdmin: 0, getVisibleProject: 0, insertLead: 0 } }
  s.isPublished = async () => { s.calls.isPublished++; return published }
  s.isAdmin = async () => { s.calls.isAdmin++; return admin }
  s.getDateOfBirth = async () => dob
  s.findByRequest = async (u, c) => s.leads.find(l => l.user_id === u && l.client_request_id === c) ?? null
  s.getVisibleProject = async id => (s.calls.getVisibleProject++, visible ? PROJECTS.find(p => p.id === id) ?? null : null)
  s.countLeads = async ({ userId, sinceIso }) => s.leads.filter(l => (!userId || l.user_id === userId) && l.created_at >= sinceIso).length
  s.insertLead = async row => {
    s.calls.insertLead++
    if (dbLimits) {   // what the BEFORE INSERT trigger does, serialised
      const n = f => s.leads.filter(f).length
      if (n(() => true) >= LIMITS.globalDay || n(l => l.user_id === row.user_id) >= LIMITS.perUserHour) throw Object.assign(new Error('dovec_rate_limited'), { code: 'DV429' })
    }
    if (row.is_test && s.leads.some(l => l.is_test)) throw Object.assign(new Error('one test row'), { code: '23505' })
    if (s.leads.some(l => l.user_id === row.user_id && l.client_request_id === row.client_request_id)) throw Object.assign(new Error('dup'), { code: '23505' })
    const lead = { id: ++s.seq, external_id: `ADA-${s.seq}`, attempts: 0, created_at: T0.toISOString(), ...row }
    s.leads.push(lead); return { ...lead }
  }
  s.updateLead = async (id, patch) => { s.updates.push(patch); Object.assign(s.leads.find(l => l.id === id), patch) }
  s.getTestProject = async () => testProject
  s.findTestLead = async () => { const l = s.leads.find(x => x.is_test); return l ? { ...l } : null }
  s.dueLeads = async (limit, nowIso, statuses) => s.leads.filter(l => !l.is_test && statuses.includes(l.status) && (l.next_attempt_at ?? '') <= nowIso).slice(0, limit)
  s.claims = 0
  s.claimLead = async (id, nowIso, untilIso) => {
    const l = s.leads.find(x => x.id === id)
    if (!l || !['retry', 'pending'].includes(l.status) || (l.next_attempt_at ?? '') > nowIso) return null
    s.claims++; l.next_attempt_at = untilIso; return { ...l }
  }
  return s
}
const stub = (status = 202, headers = {}, text = undefined) => { const f = async (u, o) => { f.calls.push({ u, o }); return { status, headers: { get: k => headers[k.toLowerCase()] ?? null }, ...(text === undefined ? {} : { text: async () => text }) } }; f.calls = []; return f }
const deps = (store, { mode = undefined, live = undefined, fetchImpl = stub(), apiKey = 'test-key-not-real', testAllowed = undefined, testPhone = undefined } = {}) => ({
  store, fetchImpl, now: () => T0, log: () => {}, liveAllowed: live, testAllowed, env: { mode, apiKey, testPhone },
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
  t('POST to /api/partner/leads with Bearer', [f.calls[0].u, f.calls[0].o.method, f.calls[0].o.headers.Authorization], ['https://atlas.dovecgroup.com/api/partner/leads', 'POST', 'Bearer test-key-not-real'])
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

console.log('atomic limits (the DB trigger raises DV429)')
{
  const store = makeStore({ dbLimits: true }); const d = deps(store); const rid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const pre = store.countLeads; store.countLeads = async () => 0   // the JS pre-check sees nothing: the race
  const codes = await Promise.all([1, 2, 3, 4, 5].map(i => post({ ...clone(BODY), client_request_id: rid(i) }, store, d).then(r => r.status)))
  t('pre-check blind, DB limit still holds: 3 accepted, 2 refused 429', [codes.filter(c => c === 200).length, codes.filter(c => c === 429).length, store.leads.length], [3, 2, 3])
  store.countLeads = pre
  t('429 body is rate_limited, nothing saved for the refused', (await post({ ...clone(BODY), client_request_id: rid(7) }, store, d)).body, { error: 'rate_limited' })
  t('another user is accepted (positive control)', (await post({ ...clone(BODY), client_request_id: rid(8) }, store, d, { kind: 'user', id: 'user-b' })).status, 200)
}

console.log('outgoing host is fixed')
{
  const f = stub(); const store = makeStore()
  const d = { ...deps(store, { mode: 'live', live: true, fetchImpl: f }), env: { mode: 'live', apiKey: 'k', baseUrl: 'https://evil.example', DOVEC_API_BASE_URL: 'https://evil.example' } }
  await post(BODY, store, d)
  t('an env/base override cannot redirect the key', [f.calls.length, new URL(f.calls[0].u).origin, f.calls[0].u], [1, 'https://atlas.dovecgroup.com', 'https://atlas.dovecgroup.com/api/partner/leads'])
  t('the constant is the Döveç origin', new URL(DEFAULT_BASE_URL).origin, 'https://atlas.dovecgroup.com')
}

console.log('under 18 (profile date of birth)')
{
  const d = new Date('2026-11-23T10:00:00Z')   // Nicosia day 2026-11-23
  t('born 2008-11-24: 17 until tomorrow -> under', isUnder18('2008-11-24', d), true)
  t('born 2008-11-23: 18th birthday today -> allowed', isUnder18('2008-11-23', d), false)
  t('born 2008-11-22 -> allowed', isUnder18('2008-11-22', d), false)
  t('no date on file -> not blocked here', [isUnder18(null, d), isUnder18(undefined, d)], [false, false])
  t('Nicosia day, not UTC: 22:30 UTC on 11-22 is already 11-23 locally', isUnder18('2008-11-23', new Date('2026-11-22T22:30:00Z')), false)
  const rid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const minor = makeStore({ dob: '2008-11-24' })
  t('a minor: 403 under_18, nothing saved, nothing sent', [(await post(BODY, minor, deps(minor, { mode: 'live', live: true }))).body, minor.leads.length], [{ error: 'under_18' }, 0])
  const turning = makeStore({ dob: '2008-11-23' })
  t('18 today: accepted (positive control)', [(await post(BODY, turning)).status, turning.leads.length], [200, 1])
  const none = makeStore({ dob: null })
  t('no DOB: accepted on the tick', (await post({ ...clone(BODY), client_request_id: rid(3) }, none)).status, 200)
}

console.log('prototype keys in language')
for (const k of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
  const v = validateLead({ ...clone(BODY), language: k })
  t(`${k}: validates as English, code en`, [v.ok, v.value.language, languageCode(v.value.language), languageCode(k)], [true, 'English', 'en', 'en'])
}
{
  const store = makeStore(); const r = await post({ ...clone(BODY), language: 'constructor' }, store)
  t('end to end: 200 and stored English/en, no 500', [r.status, store.leads[0].language, store.leads[0].language_code], [200, 'English', 'en'])
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
  await post(BODY, store, deps(store, { mode: 'live', live: true, fetchImpl: f }))
  const ok = stub(202); const at = new Date('2026-11-23T10:06:00Z')
  const run = () => retryDue({ ...deps(store, { mode: 'live', live: true, fetchImpl: ok }), now: () => at })
  const [a, b] = await Promise.all([run(), run()])
  t('two overlapping runs send the lead exactly once', [ok.calls.length, a.body.processed + b.body.processed, store.claims], [1, 1, 1])
  const store2 = makeStore(); await post(BODY, store2, deps(store2, { mode: 'live', live: true, fetchImpl: stub(500) }))
  store2.leads[0].status = 'retry'; store2.leads[0].next_attempt_at = '2026-11-23T10:00:00.000Z'
  const claimed = await store2.claimLead(1, '2026-11-23T10:06:00.000Z', '2026-11-23T10:21:00.000Z')
  t('a claimed lead is not due again for 15 minutes', [claimed.next_attempt_at, (await store2.dueLeads(20, '2026-11-23T10:10:00.000Z', ['retry'])).length, (await store2.dueLeads(20, '2026-11-23T10:21:00.000Z', ['retry'])).length], ['2026-11-23T10:21:00.000Z', 0, 1])
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
{
  // a store that IGNORES the statuses argument (as the edge function's did): retry rows still come back
  const store = makeStore(); const f = stub(500)
  await post(BODY, store, deps(store, { mode: 'live', live: true, fetchImpl: f }))
  store.leads[0].next_attempt_at = '2026-11-23T00:00:00.000Z'
  store.dueLeads = async (limit, nowIso) => store.leads.filter(l => ['retry', 'pending'].includes(l.status) && (l.next_attempt_at ?? '') <= nowIso).slice(0, limit)
  const before = JSON.stringify(store.leads[0]); const nofetch = stub(202); const upd = store.updates.length
  const r = await retryDue(deps(store, { fetchImpl: nofetch }))
  t('a store ignoring statuses: a retry lead is untouched (not claimed, not mock) while not live', [r.body.processed, r.body.mock, JSON.stringify(store.leads[0]), store.claims, store.updates.length, nofetch.calls.length], [0, 0, before, 0, upd, 0])
  t('deliver never finishes a retry lead as mock', [await deliver({ ...store.leads[0] }, deps(store, { fetchImpl: nofetch })), store.updates.length], ['retry', upd])
  store.leads.push({ id: 98, external_id: 'ADA-98', status: 'pending', next_attempt_at: '2026-11-23T00:00:00.000Z', consent: true, attempts: 0 })
  await retryDue(deps(store, { fetchImpl: nofetch }))
  t('mock is written only to the pending lead, never the retry one', [store.updates.filter(p => p.status === 'mock').length, store.leads[0].status, store.leads.find(l => l.id === 98).status], [1, 'retry', 'mock'])
}
t('a user cannot trigger retry mode', (await post({ mode: 'retry' }, makeStore())).status, 403)
t('a service caller with another mode is refused', (await post({ mode: 'send' }, makeStore(), undefined, { kind: 'service' })).status, 403)


console.log('the test enquiry: its own locks')
const TP = '+441234567899'
const SVC = { kind: 'service' }
const tl = (store, o = {}, body = { mode: 'test_lead', dry: false }) => handleLead({ caller: SVC, body, deps: deps(store, { mode: 'test_once', testAllowed: true, testPhone: TP, ...o }) })
t('TEST_LEAD_ALLOWED is open for the agreed test; LEADS_LIVE_ALLOWED stays false', [TEST_LEAD_ALLOWED, LEADS_LIVE_ALLOWED], [true, false])
t('the test project is the D-Point seed', TEST_PROJECT_SEED, 'D-Point')
for (const [label, allowed, mode, want] of [['code false, secret test_once', false, 'test_once', false], ['code true, secret unset', true, undefined, false],
  ['code true, secret live', true, 'live', false], ['code true, secret TEST_ONCE', true, 'TEST_ONCE', false], ['code true, secret test_once', true, 'test_once', true]]) {
  t(`isTestOpen: ${label}`, isTestOpen(mode, allowed), want)
}
t('test_once does not open user-lead sending (both flags true)', [isLive('test_once', true), isLive('live', true)], [false, true])
for (const [label, mode] of [['unset', undefined], ['live', 'live'], ['TEST_ONCE', 'TEST_ONCE'], ['empty', '']]) {
  t(`shipped constants, secret ${label}: apply refused as locked, nothing written or sent`, await (async () => {
    const store = makeStore(); const f = stub()
    const r = await handleLead({ caller: SVC, body: { mode: 'test_lead', dry: false }, deps: { store, fetchImpl: f, now: () => T0, log: () => {}, env: { mode, apiKey: 'k', testPhone: TP } } })
    return [r.status, r.body.error, store.leads.length, f.calls.length]
  })(), [403, 'locked', 0, 0])
}
t('constant open but secret live: refused as locked', await (async () => { const store = makeStore(); const r = await tl(store, { mode: 'live' }); return [r.status, r.body.error, store.leads.length] })(), [403, 'locked', 0])

console.log('the test enquiry: user leads stay mock under test_once')
{
  const store = makeStore(); const f = stub()
  const r = await post(BODY, store, deps(store, { mode: 'test_once', testAllowed: true, testPhone: TP, fetchImpl: f }))
  t('a user lead under test_once is stored mock and nothing is sent', [r.body.status, store.leads[0].status, f.calls.length], ['mock', 'mock', 0])
  const sL = makeStore(); const fL = stub()
  const rL = await post(BODY, sL, deps(sL, { mode: 'test_once', live: true, testAllowed: true, testPhone: TP, fetchImpl: fL }))
  t('... even with the user-lead constant open, test_once never sends a user lead', [rL.body.status, fL.calls.length], ['mock', 0])
  const st2 = makeStore({ preload: [
    { id: 97, user_id: 'user-b', client_request_id: 'c1', status: 'pending', consent: true, name: 'A', phone: '+441234567890', language_code: 'en', external_id: 'ADA-97', attempts: 0, created_at: T0.toISOString() },
    { id: 98, user_id: 'user-c', client_request_id: 'c2', status: 'retry', consent: true, name: 'B', phone: '+441234567891', language_code: 'en', external_id: 'ADA-98', attempts: 1, created_at: T0.toISOString(), next_attempt_at: new Date(T0.getTime() - 60000).toISOString() }] })
  const f2 = stub()
  const rr = await handleLead({ caller: SVC, body: { mode: 'retry' }, deps: deps(st2, { mode: 'test_once', testAllowed: true, testPhone: TP, fetchImpl: f2 }) })
  t('the retry path under test_once sends nothing for user leads (pending settles mock, retry is left alone)', [rr.body.mock, f2.calls.length, st2.leads.map(l => l.status)], [1, 0, ['mock', 'retry']])
}

console.log('the test enquiry: dry run (the default)')
{
  const store = makeStore(); const f = stub()
  const r1 = await tl(store, { fetchImpl: f }, { mode: 'test_lead' })
  const r2 = await tl(store, { fetchImpl: f }, { mode: 'test_lead', dry: true })
  t('dry is the default when "dry" is omitted', [r1.body.dry, r2.body.dry], [true, true])
  t('dry writes nothing and sends nothing', [store.leads.length, f.calls.length], [0, 0])
  t('dry reports locks, phone state, project, existing and what it would do', [r2.body.locks, r2.body.phone, r2.body.project, r2.body.existing, r2.body.would], [{ code: true, secret: true }, 'set', 'resolved', 'none', 'insert_and_send'])
  t('dry output shows the fixed payload and never the phone or the project id', [JSON.stringify(r2.body).includes('4412'), JSON.stringify(r2.body).includes(DPOINT.id), r2.body.payload], [false, false, { name: 'ADA TEST', message: 'Test talebidir, işlem yapmayın', consent: true, language: 'tr', external_id: 'TEST-1', phone: '<secret>', project: '<D-Point id>' }])
  const r3 = await tl(makeStore(), {}, { mode: 'test_lead', dry: true })
  t('dry with the shipped constant and the secret unset reports locked', (await handleLead({ caller: SVC, body: { mode: 'test_lead', dry: true }, deps: { store: makeStore(), now: () => T0, log: () => {}, env: { mode: undefined, apiKey: 'k', testPhone: TP } } })).body.would, 'refuse:locked')
  const nk = await handleLead({ caller: SVC, body: { mode: 'test_lead', dry: true }, deps: { store: makeStore(), now: () => T0, log: () => {}, env: { mode: 'test_once', apiKey: '', testPhone: TP } } })
  t('dry with the partner key missing reports key missing and refuses', [nk.body.key, nk.body.would], ['missing', 'refuse:key_missing'])
  const nkStore = makeStore(); const nkF = stub()
  const nka = await handleLead({ caller: SVC, body: { mode: 'test_lead', dry: false }, deps: { store: nkStore, fetchImpl: nkF, now: () => T0, log: () => {}, env: { mode: 'test_once', apiKey: undefined, testPhone: TP } } })
  t('apply with the partner key missing refuses: no row, nothing sent', [nka.status, nka.body.error, nkStore.leads.length, nkF.calls.length], [403, 'key_missing', 0, 0])
  t('dry with the shipped constant and the secret test_once would send', (await handleLead({ caller: SVC, body: { mode: 'test_lead', dry: true }, deps: { store: makeStore(), now: () => T0, log: () => {}, env: { mode: 'test_once', apiKey: 'k', testPhone: TP } } })).body.would, 'insert_and_send')
  t('dry with no phone says phone_missing', (await tl(makeStore(), { testPhone: undefined }, { mode: 'test_lead' })).body.would, 'refuse:phone_missing')
}

console.log('the test enquiry: the exact payload, exactly once')
{
  const store = makeStore(); const f = stub(202)
  const r = await tl(store, { fetchImpl: f })
  t('apply: stored first, then sent, status sent', [r.status, r.body.status, store.leads.length, store.leads[0].is_test, store.leads[0].external_id], [200, 'sent', 1, true, 'TEST-1'])
  const sent = JSON.parse(f.calls[0].o.body)
  t('the outgoing body is exactly the agreed JSON, in this key order', f.calls[0].o.body, JSON.stringify({ name: 'ADA TEST', phone: TP, consent: true, message: 'Test talebidir, işlem yapmayın', project: DPOINT.id, language: 'tr', external_id: 'TEST-1' }))
  t('with the fixed values, the phone from the secret and the D-Point id', [sent.name, sent.external_id, sent.message, sent.consent, sent.language, sent.phone, sent.project], [TEST_LEAD.name, 'TEST-1', 'Test talebidir, işlem yapmayın', true, 'tr', TP, DPOINT.id])
  t('it goes to the fixed host only, with the partner key', [f.calls.length, f.calls[0].u, f.calls[0].o.headers.Authorization], [1, `${DEFAULT_BASE_URL}/api/partner/leads`, 'Bearer test-key-not-real'])
  t('the stored row has no user, the D-Point project, language Turkish', [store.leads[0].user_id, store.leads[0].project_id, store.leads[0].project_name, store.leads[0].language, store.leads[0].language_code], [null, DPOINT.id, 'D-Point', 'Turkish', 'tr'])
  const again = await tl(store, { fetchImpl: f })
  t('a second run is refused and sends nothing', [again.status, again.body.error, f.calls.length, store.leads.length], [409, 'already_used', 1, 1])
  t('the dry run after a send says so', (await tl(store, { fetchImpl: f }, { mode: 'test_lead', dry: true })).body.would, 'refuse:already_used')
}
for (const st of ['rejected', 'failed', 'mock']) {
  const store = makeStore({ preload: [{ id: 5, is_test: true, external_id: 'TEST-1', status: st, user_id: null, consent: true, name: 'ADA TEST', phone: TP, language_code: 'tr', attempts: 1, created_at: T0.toISOString() }] })
  const f = stub(); const r = await tl(store, { fetchImpl: f })
  t(`an earlier TEST-1 in "${st}" refuses a new send`, [r.status, r.body.error, f.calls.length, store.leads.length], [409, 'already_used', 0, 1])
  t(`... and its dry run says refuse:already_used`, (await tl(store, { fetchImpl: f }, { mode: 'test_lead' })).body.would, 'refuse:already_used')
}
for (const [label, ph] of [['missing', undefined], ['empty', '  '], ['not E.164', '0533 888 0000'], ['no plus', '441234567899']]) {
  const store = makeStore(); const f = stub(); const r = await tl(store, { fetchImpl: f, testPhone: ph })
  t(`phone ${label}: refused, no row, nothing sent`, [r.status, /^phone_/.test(r.body.error), store.leads.length, f.calls.length], [403, true, 0, 0])
}
for (const [label, tp] of [['no D-Point seed attached', null], ['a project without an id', { name: 'D-Point' }]]) {
  const store = makeStore({ testProject: tp }); const f = stub(); const r = await tl(store, { fetchImpl: f })
  t(`${label}: refused project_missing, no row, nothing sent`, [r.status, r.body.error, store.leads.length, f.calls.length], [403, 'project_missing', 0, 0])
  t(`... and its dry run says so`, [(await tl(store, {}, { mode: 'test_lead' })).body.project, (await tl(store, {}, { mode: 'test_lead' })).body.would], ['missing', 'refuse:project_missing'])
}
t('a request body cannot carry a phone', (await tl(makeStore(), {}, { mode: 'test_lead', dry: false, phone: '+441234567000' })).status, 400)
t('dry must be a boolean', (await tl(makeStore(), {}, { mode: 'test_lead', dry: 'false' })).status, 400)
t('a user cannot trigger the test enquiry', (await handleLead({ caller: USER, body: { mode: 'test_lead', dry: false }, deps: deps(makeStore(), { mode: 'test_once', testAllowed: true, testPhone: TP }) })).status, 403)
{
  const store = makeStore(); const f = stub(500)
  const r = await tl(store, { fetchImpl: f })
  t('a failing send leaves the row in retry (not mock, not deleted)', [r.body.status, store.leads[0].status, store.leads[0].attempts], ['retry', 'retry', 1])
  const due = new Date(T0.getTime() + 6 * 60000)
  const f2 = stub(202)
  const d2 = { ...deps(store, { mode: 'test_once', testAllowed: true, testPhone: TP, fetchImpl: f2 }), now: () => due }
  const r2 = await handleLead({ caller: SVC, body: { mode: 'test_lead', dry: false }, deps: d2 })
  t('retry: the same stored payload goes out again through the claimed path (claim taken once)', [r2.body.status, store.claims, f2.calls.length, JSON.parse(f2.calls[0].o.body).phone, store.leads.length], ['sent', 1, 1, TP, 1])
  const r3 = await handleLead({ caller: SVC, body: { mode: 'test_lead', dry: false }, deps: d2 })
  t('and then it is final: no third send', [r3.body.error, f2.calls.length], ['already_used', 1])
  const st = makeStore(); await tl(st, { fetchImpl: stub(500) })
  const f4 = stub(202); const r4 = await tl(st, { fetchImpl: f4 })
  t('a retry that is not yet due is not resent', [r4.body.error, f4.calls.length], ['not_due', 0])
}
{
  const store = makeStore({ preload: [{ id: 5, is_test: true, external_id: 'TEST-1', status: 'pending', user_id: null, consent: true, name: 'ADA TEST', phone: TP, language_code: 'tr', attempts: 0, created_at: T0.toISOString() }] })
  const f = stub()
  const closed = await deliver({ ...store.leads[0] }, deps(store, { mode: 'live', live: true, testAllowed: false, fetchImpl: f }))
  t('a test row whose lock is closed is NOT settled as mock (that would burn the one send)', [closed, store.updates.length, f.calls.length], ['pending', 0, 0])
  const rr = await handleLead({ caller: SVC, body: { mode: 'retry' }, deps: deps(store, { mode: 'live', live: true, testAllowed: true, fetchImpl: f }) })
  t('the cron retry path never picks up the test row, even with every lock open', [rr.body.processed, f.calls.length, store.leads[0].status], [0, 0, 'pending'])
  const leaky = makeStore({ preload: [{ ...store.leads[0], status: 'pending', attempts: 0, next_attempt_at: null }] })
  leaky.dueLeads = async () => leaky.leads.map(l => ({ ...l }))   // as if the SQL is_test filter were lost
  const f5 = stub(); const r5 = await handleLead({ caller: SVC, body: { mode: 'retry' }, deps: deps(leaky, { mode: 'test_once', testAllowed: true, live: true, fetchImpl: f5 }) })
  t('... and retryDue itself skips a test row even if the query returned one', [r5.body.processed, f5.calls.length, leaky.claims], [0, 0, 0])
  const src = readFileSync(new URL('../supabase/functions/dovec-lead/index.ts', import.meta.url), 'utf8')
  const dueSrc = src.slice(src.indexOf('async dueLeads('), src.indexOf('async findTestLead('))
  t("index.ts dueLeads filters is_test = false", dueSrc.includes(".eq('is_test', false)"), true)
}
{
  const lines = []; const store = makeStore()
  await tl(store, { fetchImpl: stub(202) })
  const d = { ...deps(store, { mode: 'test_once', testAllowed: true, testPhone: TP }), log: s => lines.push(s) }
  await deliver({ id: 1, is_test: true, external_id: 'TEST-1', status: 'pending', name: 'ADA TEST', phone: TP, consent: true, language_code: 'tr', attempts: 0 }, { ...d, fetchImpl: stub(202) })
  t('the log line holds the external id, status and http code, never the phone', [lines, lines.some(l => l.includes('4412'))], [['dovec-lead TEST-1 response http=202 body=""', 'dovec-lead TEST-1 sent http=202'], false])
  const l2 = []; const d2 = { ...d, log: s => l2.push(s), fetchImpl: stub(202, {}, `{"ok":true,"status":"received","echo":"${TP}"}`) }
  await deliver({ id: 1, is_test: true, external_id: 'TEST-1', status: 'pending', name: 'ADA TEST', phone: TP, consent: true, language_code: 'tr', attempts: 0 }, d2)
  t("Döveç's raw answer to the test is logged (private function log), the phone masked", l2[0], 'dovec-lead TEST-1 response http=202 body="{\\"ok\\":true,\\"status\\":\\"received\\",\\"echo\\":\\"<masked>\\"}"')
  const d9 = TP.replace(/^\+/, '')
  const echoes = [d9, `00${d9}`, `${d9.slice(0, 2)} ${d9.slice(2, 5)} ${d9.slice(5, 8)} ${d9.slice(8)}`, `${d9.slice(0, 5)}-${d9.slice(5)}`, JSON.stringify(TP).slice(1, -1).replace('+', '\\u002b')]
  const l4 = []
  for (const echo of echoes) await deliver({ id: 1, is_test: true, external_id: 'TEST-1', status: 'pending', name: 'ADA TEST', phone: TP, consent: true, language_code: 'tr', attempts: 0 },
    { ...d, log: s => l4.push(s), fetchImpl: stub(202, {}, `{"phone":"${echo}","key":"test-key-not-real","lead":"L-42"}`) })
  const bodies = l4.filter(l => l.includes(' response '))
  t('the phone in any echoed format (no +, 00, spaced, dashed, escaped) never reaches the log', [bodies.length, bodies.some(l => /\d(?:[\s.-]?\d){6,}/.test(l))], [echoes.length, false])
  t('the partner key echoed back is masked too, a short lead reference kept', [bodies.some(l => l.includes('test-key-not-real')), bodies.every(l => l.includes('L-42'))], [false, true])
  const l3 = []; const boom = async () => { throw Object.assign(new Error('x'), { name: 'TimeoutError' }) }
  await deliver({ id: 1, is_test: true, external_id: 'TEST-1', status: 'pending', name: 'ADA TEST', phone: TP, consent: true, language_code: 'tr', attempts: 0 }, { ...d, log: s => l3.push(s), fetchImpl: boom })
  t('a network error on the test is logged by name only', l3, ['dovec-lead TEST-1 network_error TimeoutError', 'dovec-lead TEST-1 retry'])
}
t('the two function sources never print the phone secret', ['../supabase/functions/dovec-lead/index.ts', '../supabase/functions/_shared/dovec-lead.mjs'].map(f =>
  /console\.(log|error|warn)\([^)]*testPhone|log\([^)]*testPhone/.test(readFileSync(new URL(f, import.meta.url), 'utf8'))), [false, false])

console.log('logs carry no personal data')
{
  const lines = []; const store = makeStore(); const d = { ...deps(store, { mode: 'live', live: true, fetchImpl: stub(202) }), log: s => lines.push(s) }
  await post(BODY, store, d)
  t('one log line: external id, status, http code', lines, ['dovec-lead ADA-1 sent http=202'])
  t('no name, phone, e-mail or user id in it', lines.some(l => /Test Person|441234|example\.com|user-a/.test(l)), false)
}

console.log('B1: no enquiry while the module is unpublished (admins excepted)')
{
  const store = makeStore({ published: false })
  const r = await post(BODY, store)
  t('customer + unpublished: 404 project_unavailable, same as not-found', [r.status, r.body], [404, { error: 'project_unavailable' }])
  t('  ... insertLead 0 calls, getVisibleProject 0 calls, isAdmin asked once', [store.calls.insertLead, store.calls.getVisibleProject, store.calls.isAdmin, store.leads.length], [0, 0, 1, 0])
  t('  ... identical to the answer for an unknown project', (await post({ ...clone(BODY), project_id: 'nope' }, makeStore())).body, r.body)
  const g = makeStore({ published: false }); const f = stub()
  await post(BODY, g, deps(g, { mode: 'live', live: true, fetchImpl: f }))
  t('  ... even with both lead locks open nothing is sent or saved', [f.calls.length, g.leads.length], [0, 0])
}
{
  const store = makeStore({ published: false, admin: true })
  const r = await post(BODY, store)
  t('admin + unpublished: proceeds, exactly one insert, status mock', [r.status, r.body.status, store.calls.insertLead, store.leads.length], [200, 'mock', 1, 1])
  const stale = makeStore({ published: false, admin: true, visible: false })
  t('admin + unpublished + stale/suspended feed: still 404 (freshness applies to everyone)', [(await post(BODY, stale)).status, stale.calls.insertLead], [404, 0])
}
{
  const store = makeStore({ published: true })
  const r = await post(BODY, store)
  t('customer + published: proceeds (positive control), one insert, isAdmin not asked', [r.status, r.body.status, store.calls.insertLead, store.calls.isAdmin], [200, 'mock', 1, 0])
}

console.log('T9: lead locks as shipped')
{
  t('LEADS_LIVE_ALLOWED is false (imported constant)', LEADS_LIVE_ALLOWED, false)
  const store = makeStore(); const f = stub()
  const lead = { id: 1, external_id: 'ADA-1', status: 'pending', name: 'A', phone: '+441234567890', consent: true, language_code: 'en', attempts: 0 }
  store.leads.push(lead)
  const st = await deliver(lead, { store, env: { mode: 'live', apiKey: 'k' }, fetchImpl: f, now: () => T0, log: () => {} })   // no liveAllowed override
  t('deliver with env live + a key and NO override: mock, 0 fetch calls', [st, f.calls.length], ['mock', 0])
  const store2 = makeStore(); const f2 = stub()
  store2.leads.push({ id: 1, external_id: 'ADA-1', status: 'retry', name: 'A', phone: '+441234567890', consent: true, language_code: 'en', attempts: 1, next_attempt_at: '2026-11-23T09:00:00.000Z' })
  const rr = await retryDue({ store: store2, env: { mode: 'live', apiKey: 'k' }, fetchImpl: f2, now: () => T0, log: () => {} })
  t('retryDue with env live + a key and NO override: 0 fetch calls, retry lead untouched', [f2.calls.length, rr.body.processed, store2.leads[0].status], [0, 0, 'retry'])
  const store3 = makeStore(); const f3 = stub()
  const ap = await handleTestLead({ body: { mode: 'test_lead', dry: false }, deps: { store: store3, env: { mode: undefined, apiKey: 'k', testPhone: '+441234567899' }, fetchImpl: f3, now: () => T0, log: () => {} } })
  t('handleTestLead apply with the shipped constants and the secret unset: 403 locked, nothing written or sent', [ap.status, ap.body.error, store3.leads.length, f3.calls.length], [403, 'locked', 0, 0])
  for (const mode of ['test_once', 'live']) {
    const st4 = makeStore(); const f4 = stub()
    const r4 = await post(BODY, st4, { store: st4, env: { mode, apiKey: 'k', testPhone: '+441234567899' }, fetchImpl: f4, now: () => T0, log: () => {} })
    t(`a user lead with the SHIPPED constants and the secret ${mode}: mock, 0 fetch calls`, [r4.body.status, st4.leads[0].status, f4.calls.length], ['mock', 'mock', 0])
  }
}

console.log('T10: who may call which mode')
{
  const svcNoMode = await post({ ...clone(BODY) }, makeStore(), undefined, { kind: 'service' })
  t('a service caller whose body has no mode is 403', [svcNoMode.status, svcNoMode.body], [403, { error: 'forbidden' }])
  const ur = await post({ mode: 'retry' }, makeStore()); const ut = await post({ mode: 'test_lead', dry: true }, makeStore())
  t('a user caller with mode retry / test_lead is 403', [ur.status, ut.status, ur.body, ut.body], [403, 403, { error: 'forbidden' }, { error: 'forbidden' }])
  const src = readFileSync(new URL('../supabase/functions/dovec-lead/index.ts', import.meta.url), 'utf8')
  const guest = src.indexOf("user.is_anonymous === true) return json(403"), parse = src.indexOf('req.json()')
  console.log(`    index.ts: is_anonymous 403 at ${guest}, req.json() at ${parse}`)
  t('index.ts refuses a guest (403) before it reads the body', [guest > 0, parse > 0, guest < parse], [true, true, true])
}

console.log('T11: secret-key service caller')
{
  const mk = (ret) => { const p = async (k) => { p.calls++; p.keys.push(k); if (ret === 'throw') throw new Error('net'); return ret }; p.calls = 0; p.keys = []; return p }
  const H = 'Bearer sb_secret_abc_DEF-1'
  const ok = mk(true)
  t('secret header + probe true: secret, probe got exactly the key', [await secretKeyCaller(H, ok), ok.calls, ok.keys], ['secret', 1, ['sb_secret_abc_DEF-1']])
  for (const [label, ret] of [['false', false], ['throws', 'throw'], ['"yes"', 'yes'], ['1', 1], ['{}', {}], ['undefined', undefined]]) {
    const p = mk(ret)
    t(`secret header + probe ${label}: null`, await secretKeyCaller(H, p), null)
  }
  const JWT = 'Bearer ' + Buffer.from('{"alg":"HS256"}').toString('base64url') + '.' + Buffer.from('{"role":"service_role"}').toString('base64url') + '.sig'
  const never = [null, undefined, '', 'Bearer ', 'Bearer sb_secret_', JWT, 'Bearer sb_publishable_abc', 'bearer sb_secret_abc',
    'Bearer  sb_secret_abc', 'Bearer sb_secret_abc ', 'Bearer sb_secret_a.b.c', 'Bearer sb_secret_abc, Bearer sb_secret_def',
    'sb_secret_abc', 'Bearer xsb_secret_abc']
  for (const h of never) {
    const p = mk(true)
    t(`probe never called, null: ${JSON.stringify(h)}`, [await secretKeyCaller(h, p), p.calls], [null, 0])
  }
  const src = readFileSync(new URL('../supabase/functions/dovec-lead/index.ts', import.meta.url), 'utf8')
  const body = src.slice(src.indexOf('const holdsServiceKey'), src.indexOf('let caller'))
  const gate = src.indexOf('if (await serviceCaller(authz, key) || await secretKeyCaller(authz, holdsServiceKey)) {')
  t('gate line is the combined serviceCaller || secretKeyCaller form', gate > 0, true)
  t('gate comes before req.json()', gate < src.indexOf('req.json()'), true)
  t('serviceCaller occurs exactly twice (import + call)', src.split('serviceCaller').length - 1, 2)
  t('probe URL is dovec_leads select=id&limit=0', body.includes('`${url}/rest/v1/dovec_leads?select=id&limit=0`'), true)
  t('probe headers are { apikey: k } with no Authorization', [body.includes('headers: { apikey: k }'), /authorization/i.test(body)], [true, false])
  t('probe returns r.status === 200 (not r.ok)', [body.includes('return r.status === 200'), body.includes('r.ok')], [true, false])
  const mdir = new URL('../supabase/migrations/', import.meta.url)
  const files = readdirSync(mdir).filter(f => f.endsWith('.sql'))
  const sqls = files.map(f => [f, readFileSync(new URL(f, mdir), 'utf8')])
  console.log(`    scanned ${files.length} migrations`)
  const m29 = sqls.find(([f]) => f === '20261229_dovec_projects.sql')?.[1] ?? ''
  t('20261229: RLS on dovec_leads', m29.includes('ALTER TABLE public.dovec_leads ENABLE ROW LEVEL SECURITY;'), true)
  t('20261229: REVOKE ALL incl. service_role', m29.includes('REVOKE ALL ON TABLE public.dovec_leads FROM PUBLIC, anon, authenticated, service_role;'), true)
  const grants = sqls.flatMap(([f, x]) => [...x.matchAll(/\bGRANT\b[^;]*?\bON\s+(?:TABLE\s+)?public\.dovec_leads\s+TO\s+([^;]*);/gi)].filter(g => /\b(anon|authenticated|public)\b/i.test(g[1])).map(g => f + ': ' + g[0]))
  t('no GRANT on dovec_leads to anon/authenticated/public in any migration', grants, [])
  const pols = sqls.filter(([, x]) => /CREATE\s+POLICY[^;]*ON\s+(?:ONLY\s+)?(?:public\.)?dovec_leads\b/i.test(x)).map(([f]) => f)
  t('no CREATE POLICY on dovec_leads in any migration', pols, [])
}

console.log(bad ? `\n${bad} FAILED` : '\nall passed')
process.exit(bad ? 1 : 0)
