// utils/checkins.js (the shipped client module) against 20261069 in PGlite, through a fake
// supabase client that turns each call into the SQL PostgREST would run, as the caller's role.
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-checkins-client.mjs
// Shares the fixture with scripts/test-checkins-sql.mjs (read from its SEED literal).
import { readFileSync } from 'fs'
import { fileURLToPath } from 'node:url'
import { freshDb, applyFile } from './migration-harness.mjs'
import * as C from '../utils/checkins.js'
const test = readFileSync(new URL('./test-checkins-sql.mjs', import.meta.url), 'utf8')
const seed = test.match(/const SEED = `([\s\S]*?)`\.replace/)[1].replace(/'u0000000[^']*'::text::uuid/, "'b0000000-0000-4000-8000-000000000009'")
const U = n => `b0000000-0000-4000-8000-00000000000${n}`, P = n => `a0000000-0000-4000-8000-00000000000${n}`
const db = await freshDb(seed)
await db.exec(`INSERT INTO public.profiles (id, display_name, date_of_birth) VALUES
 ('${U(1)}','adult','1990-01-01'), ('${U(2)}','viewer','1990-01-01'), ('${U(3)}', null, current_date - interval '15 years');
 GRANT SELECT ON public.places TO authenticated; GRANT SELECT, UPDATE ON public.profiles TO authenticated;`)
const r = await applyFile(db, fileURLToPath(new URL('../supabase/migrations/20261069_checkins.sql', import.meta.url)))
if (!r.ok) { console.log('apply', r.msg); process.exit(1) }

async function as(uid, sql, params = []) {
  await db.exec('RESET ROLE;')
  await db.query("SELECT set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  await db.exec('SET ROLE authenticated;')
  try { return { data: (await db.query(sql, params)).rows, error: null } }
  catch (e) { return { data: null, error: { message: String(e.message).split('\n')[0] } } }
  finally { await db.exec('RESET ROLE;') }
}
const lit = v => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`
function client(uid) {
  return {
    rpc: async (fn, params) => {
      const args = Object.entries(params).map(([k, v]) => `${k} => ${lit(v)}`).join(', ')
      const res = await as(uid, `SELECT * FROM public.${fn}(${args})`)
      if (res.error) return res
      // A scalar RPC comes back as the bare value, as PostgREST returns it.
      const rows = res.data
      if (rows.length === 1 && Object.keys(rows[0]).length === 1 && Object.keys(rows[0])[0] === fn) return { data: rows[0][fn], error: null }
      return { data: rows.map(x => ({ ...x, created_at: x.created_at instanceof Date ? x.created_at.toISOString() : x.created_at })), error: null }
    },
    from: table => {
      const q = { table, op: 'select', cols: '*', where: [], order: null, limit: null, upd: null, single: false }
      const b = {
        select(c) { if (q.op === 'select') q.cols = c; else q.ret = c; return b },
        update(o) { q.op = 'update'; q.upd = o; return b },
        delete() { q.op = 'delete'; return b },
        eq(c, v) { q.where.push(`${c} = ${lit(v)}`); return b },
        order(c, o) { q.order = `${c} ${o?.ascending === false ? 'DESC' : 'ASC'}`; return b },
        limit(n) { q.limit = n; return b },
        maybeSingle() { q.single = 'maybe'; return b },
        single() { q.single = 'one'; return b },
        then(ok, bad) { return run().then(ok, bad) },
      }
      async function run() {
        const w = q.where.length ? ' WHERE ' + q.where.map(x => `t.${x}`).join(' AND ') : ''
        let sql
        if (q.op === 'select') {
          const emb = q.cols.match(/places\(([^)]*)\)/)
          const plain = q.cols.replace(/,?\s*places\([^)]*\)/, '').split(',').map(c => `t.${c.trim()}`).join(', ')
          sql = `SELECT ${plain}${emb ? `, (SELECT row_to_json(x) FROM (SELECT ${emb[1]} FROM public.places p WHERE p.id = t.place_id) x) AS places` : ''} FROM public.${table} t${w}`
            + (q.order ? ` ORDER BY t.${q.order}` : '') + (q.limit ? ` LIMIT ${q.limit}` : '')
        } else if (q.op === 'update') {
          sql = `UPDATE public.${table} t SET ${Object.entries(q.upd).map(([k, v]) => `${k} = ${lit(v)}`).join(', ')}${w} RETURNING ${q.ret ?? '*'}`
        } else {
          sql = `DELETE FROM public.${table} t${w} RETURNING ${q.ret ?? '*'}`
        }
        const res = await as(uid, sql)
        if (res.error || !q.single) return res
        if (q.single === 'one' && res.data.length !== 1) return { data: null, error: { message: 'PGRST116' } }
        return { data: res.data[0] ?? null, error: null }
      }
      return b
    },
  }
}
let pass = 0, fail = 0
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL', n, JSON.stringify(got)) } }
const A = client(U(1)), V = client(U(2)), M = client(U(3))
const at = { latitude: 35.0004, longitude: 33, accuracy: 12 }
const place = { id: P(1), latitude: 35, longitude: 33 }

ok('precheck at place -> null', C.precheck(place, at) === null, C.precheck(place, at))
ok('precheck 200 m -> TOO_FAR', C.precheck(place, { ...at, latitude: 35.0018 }) === 'TOO_FAR')
ok('precheck acc 60 -> LOW_ACCURACY', C.precheck(place, { ...at, accuracy: 60 }) === 'LOW_ACCURACY')
ok('client 150 m agrees with server: 145 m passes precheck', C.precheck(place, { ...at, latitude: 35.0013 }) === null)

let p = await C.loadCheckinPrefs(A, U(1)); ok('prefs before notice', p.ok && p.prefs.checkins_notice_at === null && p.prefs.checkins_public === null, p)
let x = await C.checkIn(A, P(1), at); ok('checkIn before notice -> NOTICE_REQUIRED', !x.ok && x.code === 'NOTICE_REQUIRED', x)
x = await C.acceptNotice(A); ok('adult notice -> public', x.ok && x.isPublic === true, x)
x = await C.checkIn(A, P(1), at); ok('adult check-in', x.ok && !x.already && x.id, x)
x = await C.checkIn(A, P(1), at); ok('again -> already', x.ok && x.already, x)
x = await C.checkIn(A, P(5), { ...at, latitude: 35.0018 }); ok('server TOO_FAR code mapped', !x.ok && x.code === 'TOO_FAR', x)
x = await C.checkIn(M, P(1), at); ok('minor without name -> NAME_REQUIRED', !x.ok && x.code === 'NAME_REQUIRED', x)
x = await M.from('profiles').update({ display_name: 'kid' }).eq('id', U(3)); ok('name save', !x.error, x)
x = await C.acceptNotice(M); ok('minor notice -> hidden', x.ok && x.isPublic === false, x)
x = await C.checkIn(M, P(1), at); ok('minor check-in', x.ok, x)
x = await C.acceptNotice(V); await C.checkIn(V, P(5), at)
let f = await C.loadFeed(V, {}); ok('viewer feed: adult + own, minor hidden', f.ok && f.rows.map(r => r.display_name).sort().join() === 'adult,viewer', f)
f = await C.loadFeed(V, { placeId: P(1) }); ok('place feed: adult only', f.ok && f.rows.length === 1 && f.rows[0].display_name === 'adult', f)
let f1 = await C.loadFeed(V, { limit: 1 }); ok('page 1 full -> more', f1.ok && f1.rows.length === 1 && f1.more, f1)
let f2 = await C.loadFeed(V, { before: f1.rows[0], limit: 1 }); ok('page 2 is a different row', f2.ok && f2.rows.length === 1 && f2.rows[0].checkin_id !== f1.rows[0].checkin_id, f2)
let f3 = await C.loadFeed(V, { before: f2.rows[0], limit: 1 }); ok('page 3 empty -> no more', f3.ok && f3.rows.length === 0 && !f3.more, f3)
x = await C.setCheckinsPublic(M, U(3), true); ok('minor switches visible', x === true, x)
f = await C.loadFeed(V, { placeId: P(1) }); ok('minor now in place feed', f.rows.some(r => r.display_name === 'kid'), f)
x = await C.setCheckinsPublic(A, U(1), false); ok('adult hides', x === false, x)
f = await C.loadFeed(V, {}); ok('hidden adult gone from feed', !f.rows.some(r => r.display_name === 'adult'), f)
f = await C.loadFeed(A, {}); ok('hidden adult still sees own (is_mine)', f.rows.some(r => r.display_name === 'adult' && r.is_mine), f)
let mine = await C.loadMine(A, U(1)); ok('loadMine: own row with place name', mine?.length === 1 && mine[0].places?.name === 'A', mine)
ok('cannot delete another user\'s', (await C.deleteCheckin(V, mine[0].id)) === false)
ok('owner deletes own', (await C.deleteCheckin(A, mine[0].id)) === true)
mine = await C.loadMine(A, U(1)); ok('gone after delete', mine?.length === 0, mine)
// Ties: every remaining row gets ONE created_at; paging 1 at a time must still visit each once.
await db.exec(`RESET ROLE; UPDATE public.checkins SET created_at = '2026-10-01T10:00:00Z'`)
const all = await C.loadFeed(V, { limit: 50 })
const seen = []; let cur = null
for (let i = 0; i < 10; i++) { const pg = await C.loadFeed(V, { before: cur, limit: 1 }); if (!pg.rows.length) break; seen.push(pg.rows[0].checkin_id); cur = pg.rows[0] }
ok(`tied timestamps: paging visits all ${all.rows.length} rows once`, all.rows.length >= 2 && seen.length === all.rows.length && new Set(seen).size === seen.length, { all: all.rows.length, seen })
const now = Date.parse('2026-10-02T12:00:00Z')
ok('ago now', C.agoParts('2026-10-02T11:59:30Z', now).key === 'checkinAgoNow')
ok('ago 5 min', JSON.stringify(C.agoParts('2026-10-02T11:55:00Z', now)) === '{"key":"checkinAgoMin","n":5}')
ok('ago 3 h', JSON.stringify(C.agoParts('2026-10-02T09:00:00Z', now)) === '{"key":"checkinAgoHour","n":3}')
ok('ago 2 d', JSON.stringify(C.agoParts('2026-09-30T12:00:00Z', now)) === '{"key":"checkinAgoDay","n":2}')
ok('ago 9 d -> date', C.agoParts('2026-09-23T12:00:00Z', now).key === 'date')
ok('missing fn -> UNKNOWN', C.checkinErrorCode({ message: 'Could not find the function public.check_in' }) === 'UNKNOWN')
// "Check your connection" only for a request that never reached a server (postgrest-js: status 0).
// The two clients below return exactly what postgrest-js 2.x returns in each case.
const offline = { rpc: async () => ({ data: null, error: { message: 'TypeError: Network request failed', details: '', hint: '', code: '' }, status: 0 }),
  from: () => ({ select() { return this }, eq() { return this }, maybeSingle: async () => ({ data: null, error: { message: 'TypeError: Network request failed', code: '' }, status: 0 }) }) }
const server404 = { rpc: async () => ({ data: null, error: { message: 'Could not find the function public.check_in(p_accuracy, p_lat, p_lng, p_place_id) in the schema cache', code: 'PGRST202' }, status: 404 }) }
const server500 = { rpc: async () => ({ data: null, error: { message: 'internal error', code: 'XX000' }, status: 500 }) }
x = await C.checkIn(offline, P(1), at); ok('offline check-in -> NETWORK', x.code === 'NETWORK', x)
x = await C.loadFeed(offline, {}); ok('offline feed -> NETWORK', x.code === 'NETWORK', x)
x = await C.acceptNotice(offline); ok('offline notice -> NETWORK', x.code === 'NETWORK', x)
x = await C.loadCheckinPrefs(offline, U(1)); ok('offline prefs -> NETWORK', !x.ok && x.code === 'NETWORK', x)
x = await C.checkIn(server404, P(1), at); ok('missing RPC (404) -> UNKNOWN, not NETWORK', x.code === 'UNKNOWN', x)
x = await C.loadFeed(server404, {}); ok('missing RPC feed (404) -> UNKNOWN', x.code === 'UNKNOWN', x)
x = await C.checkIn(server500, P(1), at); ok('server 500 -> UNKNOWN, not NETWORK', x.code === 'UNKNOWN', x)
ok('a refusal wins even at status 400', C.checkinErrorCode({ message: 'TOO_FAR' }, 400) === 'TOO_FAR')
console.log(`${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0)
