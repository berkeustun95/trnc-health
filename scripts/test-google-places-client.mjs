// utils/googlePlaces.js against fake supabase clients: how an Edge Function answer becomes a
// result, and the nearby-ADA distance filter.
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-google-places-client.mjs
// supabase-js shapes (functions-js): a non-2xx answer → FunctionsHttpError with `context` =
// the Response; a fetch that never reached a server → FunctionsFetchError, no Response.
import * as G from '../utils/googlePlaces.js'
let pass = 0, fail = 0
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log('FAIL', name, JSON.stringify(got)) } }
const fn = reply => ({ functions: { invoke: async (_n, { body }) => reply(body) } })
const httpErr = (status, body) => ({ data: null, error: { name: 'FunctionsHttpError', context: new Response(JSON.stringify(body), { status }) } })
const fix = { latitude: 35.1, longitude: 33.1, accuracy: 10 }
let x

x = await G.checkInGoogle(fn(() => httpErr(409, { error: 'TOO_FAR' })), 'ChIJgooglePlace000001', fix)
ok('409 TOO_FAR → code TOO_FAR', !x.ok && x.code === 'TOO_FAR', x)
x = await G.checkInGoogle(fn(() => ({ data: null, error: { name: 'FunctionsFetchError' } })), 'ChIJgooglePlace000001', fix)
ok('fetch never reached a server → NETWORK', !x.ok && x.code === 'NETWORK', x)
x = await G.checkInGoogle(fn(() => ({ data: null, error: { name: 'FunctionsHttpError', context: new Response('<html>', { status: 502 }) } })), 'ChIJgooglePlace000001', fix)
ok('non-JSON 502 → UNKNOWN, not NETWORK', !x.ok && x.code === 'UNKNOWN', x)
x = await G.checkInGoogle(fn(b => ({ data: { ok: true, already: true, id: 'c1' }, error: null, b })), 'ChIJgooglePlace000001', fix)
ok('success → already/id', x.ok && x.already === true && x.id === 'c1', x)
let sent
await G.checkInGoogle(fn(b => { sent = b; return { data: {}, error: null } }), 'ChIJgooglePlace000001', fix)
ok('body carries place id, fix and accuracy — never place coordinates', sent.placeId === 'ChIJgooglePlace000001' && sent.accuracy === 10 && !('placeLat' in sent) && Object.keys(sent).sort().join() === 'accuracy,action,lat,lng,placeId', sent)

x = await G.nearbyGoogle(fn(() => ({ data: { places: [
  { id: 'far', name: 'Far', lat: 35.1008, lng: 33.1 }, { id: 'near', name: 'Near', lat: 35.1001, lng: 33.1 }] }, error: null })), fix, 'Turkish')
ok('nearby sorted nearest first with metres', x.ok && x.places.map(p => p.id).join() === 'near,far' && x.places[0].metres === 11, x)

let calls = 0
const batches = []
x = await G.googleNames(fn(b => { calls++; batches.push(b.ids.length); return { data: { names: Object.fromEntries(b.ids.map(i => [i, 'n' + i])) }, error: null } }),
  Array.from({ length: 45 }, (_, i) => 'id' + i).concat(['id0', null]), 'English')
ok('names: 45 unique ids → 3 calls of ≤ 20', calls === 3 && batches.join() === '20,20,5' && Object.keys(x).length === 45, { calls, batches })

const q = { f: [] }
const from = () => {
  const c = { select: () => c, eq: (...a) => (q.f.push(['eq', ...a]), c), is: (...a) => (q.f.push(['is', ...a]), c),
    gte: () => c, lte: () => c, limit: async () => ({ data: [
      { id: 'in', latitude: 35.1005, longitude: 33.1 },      // ~56 m
      { id: 'corner', latitude: 35.1008, longitude: 33.1009 }, // inside the box, ~120 m
    ], error: null }) }
  return c
}
x = await G.nearbyAda({ from }, fix)
ok('ADA: box corner beyond 100 m dropped; active + unhidden asked', x.ok && x.places.map(p => p.id).join() === 'in'
  && q.f.some(f => f[0] === 'eq' && f[1] === 'status' && f[2] === 'active') && q.f.some(f => f[0] === 'is' && f[1] === 'hidden_at'), { x, q })

G.clearGoogleNames()
let asked = []
const counting = fn(b => { asked.push(...b.ids); return { data: { names: Object.fromEntries(b.ids.map(i => [i, i === 'gone' ? null : 'n' + i])) }, error: null } })
await G.googleNames(counting, ['a', 'b', 'gone'], 'Turkish')
x = await G.googleNames(counting, ['a', 'b', 'c', 'gone'], 'Turkish')
ok('session cache: second call asks only c and the unknown one', asked.join() === 'a,b,gone,c,gone' && x.a === 'na' && x.c === 'nc', { asked, x })
asked = []
await G.googleNames(counting, ['a'], 'English')
ok('cache is per language', asked.join() === 'a', asked)
G.clearGoogleNames(); asked = []
await G.googleNames(counting, ['a'], 'Turkish')
ok('cleared (app backgrounded) -> asked again', asked.join() === 'a', asked)

ok('googleWithinReach 140 m yes / 160 m no', G.googleWithinReach({ lat: 35.10126, lng: 33.1 }, fix) && !G.googleWithinReach({ lat: 35.10144, lng: 33.1 }, fix), null)
console.log(`${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
