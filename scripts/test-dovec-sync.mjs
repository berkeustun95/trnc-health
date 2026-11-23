// sync-dovec: the pure core (supabase/functions/_shared/dovec-feed.mjs) with a fake store and a mocked fetch.
// No network: fetch is always an injected stub, never Döveç. Fixtures are fictional (supabase/functions/sync-dovec/fixtures/).
//   node scripts/test-dovec-sync.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { mapProject, mapFeed, planRun, fetchProjects, runSync } from '../supabase/functions/_shared/dovec-feed.mjs'

const FX = JSON.parse(readFileSync(fileURLToPath(new URL('../supabase/functions/sync-dovec/fixtures/projects.json', import.meta.url)), 'utf8'))
const clone = o => JSON.parse(JSON.stringify(o))
const feedOf = projects => ({ ...clone(FX), count: projects.length, projects: clone(projects) })

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
const reply = (status, body, headers = {}) => async () => ({
  status, headers: { get: k => headers[k.toLowerCase()] ?? null },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
})
const fakeStore = (listed = [], { failUpsert = false } = {}) => {
  const s = { listed: [...listed], upserts: [], delists: [], states: [], writes: 0 }
  s.listedIds = async () => s.listed
  s.upsert = async rows => { if (failUpsert) throw new Error('x'); s.writes++; s.upserts.push(...rows) }
  s.delist = async ids => { s.writes++; s.delists.push(...ids) }
  s.setState = async p => { s.states.push(p) }
  return s
}
const run = (fetchImpl, store) => runSync({ apiKey: 'test-key-not-real', fetchImpl, store, now: () => new Date('2026-11-23T10:00:00Z') })
const IDS = FX.projects.map(p => p.id)

console.log('mapping (real shape, fictional data)')
{
  const m = mapFeed(FX)
  t('all four fixture projects map', [m.ok, m.rows.length, m.skipped.length], [true, 4, 0])
  const [a, b, c] = m.rows
  t('delivery month becomes the first of the month', a.planned_delivery_month, '2027-06-01')
  t('empty area is stored as NULL', b.area, null)
  t('null price / units / delivery / cover stay NULL (partner rule: empty is on purpose)', [b.from_price, b.available_units, b.planned_delivery_month, b.cover_url], [null, null, null, null])
  t('a null unit-type price stays NULL, the unit type is kept', b.unit_types, [{ type: 'Villa', from_price: null }])
  t('zero units and zero unit types are valid', [c.available_units, c.unit_types], [0, []])
  t('every row has the same keys (no ragged upsert)', new Set(m.rows.map(r => Object.keys(r).sort().join())).size, 1)
}

console.log('per-project validation: invalid is skipped, named, never fixed')
for (const [label, patch, field] of [
  ['unknown status', { status: 'sold_out' }, 'status'],
  ['currency not GBP', { currency: 'EUR' }, 'currency'],
  ['http (not https) website', { website_url: 'http://example.com/x' }, 'website_url'],
  ['website missing', { website_url: undefined }, 'website_url'],
  ['http cover', { cover_image_url: 'http://example.com/c.jpg' }, 'cover_image_url'],
  ['month 13', { planned_delivery_month: '2027-13' }, 'planned_delivery_month'],
  ['month wrong shape', { planned_delivery_month: '06/2027' }, 'planned_delivery_month'],
  ['price as a string', { from_price: '185000' }, 'from_price'],
  ['negative price', { from_price: -1 }, 'from_price'],
  ['fractional units', { available_units: 1.5 }, 'available_units'],
  ['unit_types not an array', { unit_types: 'Villa' }, 'unit_types'],
  ['unit type with a bad price', { unit_types: [{ type: '1+1', from_price: 'x' }] }, 'unit_types'],
  ['no name', { name: '  ' }, 'name'],
  ['no city', { city: undefined }, 'city'],
]) {
  const r = mapProject({ ...clone(FX.projects[0]), ...patch })
  t(`${label}`, [r.ok, r.reason, r.id], [false, field, 'fx-harbour-view'])
}
t('no id is skipped with no id to report', mapProject({ ...clone(FX.projects[0]), id: '' }), { ok: false, id: null, reason: 'id' })
t('a non-object entry is skipped', mapProject(null).reason, 'not_an_object')
{
  const p = clone(FX.projects); p[1].status = 'bogus'; p[2].id = p[0].id
  const m = mapFeed(feedOf(p))
  t('one invalid + one duplicate id: two valid rows, both reported', [m.rows.length, m.skipped.map(s => s.reason)], [2, ['status', 'duplicate_id']])
  t('the invalid project is still SEEN (so it is not delisted)', m.seenIds.has('fx-pine-court'), true)
}

console.log('planRun: the refusals')
{
  const m = mapFeed(FX)
  t('count mismatch is refused', mapFeed({ ...clone(FX), count: 9 }).status, 'refused_count_mismatch')
  t('envelope without projects is a parse error', mapFeed({ count: 1 }).status, 'parse_error')
  t('empty list while rows are listed: refused', planRun(mapFeed(feedOf([])), IDS).refuse, 'refused_empty')
  t('empty list with nothing listed: nothing to do, not a refusal', planRun(mapFeed(feedOf([])), []), { rows: [], delist: [] })
  const allBad = clone(FX.projects).map(p => ({ ...p, status: 'x' }))
  t('every project unreadable: refused as parse_error', planRun(mapFeed(feedOf(allBad)), IDS).refuse, 'parse_error')
  t('would delist 3 of 4 (more than half): refused', planRun(mapFeed(feedOf(FX.projects.slice(0, 1))), IDS).refuse, 'refused_mass_delist')
  t('would delist exactly half (2 of 4): allowed', planRun(mapFeed(feedOf(FX.projects.slice(0, 2))), IDS).delist, ['fx-sun-terraces', 'fx-lake-lofts'])
  t('a listed id missing from the feed is delisted; a new id is just upserted', planRun(m, [...IDS, 'fx-gone']).delist, ['fx-gone'])
}

console.log('runSync end to end (mocked fetch, fake store)')
{
  const store = fakeStore(IDS)
  const r = await run(reply(200, FX), store)
  t('good run: ok, 4 valid, nothing skipped or delisted', [r.status, r.valid, r.skipped, r.delisted], ['ok', 4, 0, 0])
  const st = store.states.at(-1)
  t('good run advances the stamp, clears suspended, records ok', [st.last_run_status, st.last_good_sync_at, st.suspended], ['ok', '2026-11-23T10:00:00.000Z', false])
  t('the upsert carries every project', store.upserts.map(u => u.id), IDS)
}
{
  const store = fakeStore(IDS)
  const p = clone(FX.projects); p[1].website_url = 'ftp://nope'
  const r = await run(reply(200, feedOf(p)), store)
  t('an invalid project is skipped and reported; run still ok', [r.status, r.valid, r.skipped], ['ok', 3, 1])
  t('the invalid project is NOT delisted', store.delists, [])
  t('the report names the id and the field, nothing else', /fx-pine-court:website_url/.test(store.states.at(-1).last_run_detail), true)
}
{
  const store = fakeStore([...IDS, 'fx-gone'])
  const r = await run(reply(200, FX), store)
  t('a project that left the feed is delisted (1 of 5 listed)', [r.status, store.delists], ['ok', ['fx-gone']])
}
{
  const store = fakeStore(IDS)
  const relist = fakeStore(IDS.slice(0, 2))
  await run(reply(200, FX), relist)
  t('a project that comes back is upserted (the upsert sets listed = true)', relist.upserts.map(u => u.id).sort(), [...IDS].sort())
  void store
}
for (const [label, resp, status] of [
  ['count mismatch', reply(200, { ...clone(FX), count: 99 }), 'refused_count_mismatch'],
  ['empty list while rows are listed', reply(200, feedOf([])), 'refused_empty'],
  ['mass delist', reply(200, feedOf(FX.projects.slice(0, 1))), 'refused_mass_delist'],
  ['unparsable body', reply(200, 'not json'), 'parse_error'],
  ['HTTP 500', reply(500, 'boom'), 'http_error'],
  ['HTTP 429', reply(429, '', { 'retry-after': '30' }), 'http_429'],
  ['503 not provisioned', reply(503, { error: 'not_provisioned' }), 'not_provisioned'],
  ['503 something else', reply(503, 'down'), 'http_error'],
  ['network error', async () => { throw new Error('ECONNRESET') }, 'network_error'],
]) {
  const store = fakeStore(IDS)
  const r = await run(resp, store)
  const st = store.states.at(-1)
  t(`${label}: ${status}, nothing written, stamp not advanced, suspended untouched`,
    [r.status, store.writes, 'last_good_sync_at' in st, 'suspended' in st], [status, 0, false, false])
}
{
  const store = fakeStore(IDS)
  const r = await run(reply(401, 'unauthorized'), store)
  t('401: suspended = true at once, stamp not advanced, nothing written', [r.status, store.states.at(-1).suspended, 'last_good_sync_at' in store.states.at(-1), store.writes], ['http_401', true, false, 0])
  const again = await run(reply(200, FX), store)
  t('a later good 200 clears the suspension', [again.status, store.states.at(-1).suspended], ['ok', false])
}
{
  const store = fakeStore(IDS, { failUpsert: true })
  const r = await run(reply(200, FX), store)
  t('a failed write is write_error and the stamp is not advanced', [r.status, 'last_good_sync_at' in store.states.at(-1)], ['write_error', false])
}

console.log('request shape (mocked fetch records it)')
{
  let seen
  await fetchProjects({ baseUrl: 'https://evil.example/', apiKey: 'k-test', fetchImpl: async (u, o) => { seen = { u, o }; return reply(200, FX)() } })
  t('GET to /api/partner/projects, Bearer, no body; a passed baseUrl is ignored (fixed Döveç origin)', [seen.u, seen.o.method, seen.o.headers.Authorization, seen.o.body], ['https://atlas.dovecgroup.com/api/partner/projects', 'GET', 'Bearer k-test', undefined])
  t('no key: no request at all', (await fetchProjects({ apiKey: undefined, fetchImpl: async () => { throw new Error('called') } })).kind, 'http_error')
}

console.log(bad ? `\n${bad} FAILED` : '\nall passed')
process.exit(bad ? 1 : 0)
