// supabase/functions/google-places/index.ts, run for real in Deno against the PGlite fixture.
//   ~/.deno/bin/deno run -A scripts/test-google-places-edge.ts
//
// The function file is imported unchanged. Deno.serve is captured to get its handler, and
// globalThis.fetch is replaced so that:
//   • https://supa.test/auth/v1/user        → the user for a fake bearer token
//   • https://supa.test/rest/v1/rpc/<fn>    → SELECT public.<fn>(named args) AS service_role, in
//                                              PGlite with 20261092 + 20261093 applied
//   • https://supa.test/rest/v1/google_place_pins → the select / update / delete the refresh uses
//   • https://places.googleapis.com/…       → a fake Google that records every request
// Nothing leaves this machine. NOT covered: the gateway's verify_jwt (tokens here are unsigned),
// real PostgREST parsing, real Google responses, prod's profiles triggers.
import { readFileSync } from 'node:fs'
import { freshDb, applyFile } from './migration-harness.mjs'

const ROOT = new URL('..', import.meta.url).pathname
const base = readFileSync(ROOT + 'scripts/test-checkins-sql.mjs', 'utf8')
const SEED = base.match(/const SEED = `([\s\S]*?)`\.replace/)![1]
  .replace(/'u0000000[^']*'::text::uuid/, "'b0000000-0000-4000-8000-000000000009'")
const U = (n: number) => `b0000000-0000-4000-8000-00000000000${n}`
const db = await freshDb(SEED)
await db.exec(`INSERT INTO public.profiles (id, display_name, date_of_birth) VALUES
  ('${U(1)}','adult','1990-01-01'), ('${U(2)}','guest',null), ('${U(3)}','nonotice','1990-01-01');
  INSERT INTO auth.users (id, is_anonymous) SELECT id, id = '${U(2)}' FROM public.profiles;`)
for (const f of ['20261092_checkins.sql', '20261093_checkins_google_places.sql']) {
  const r = await applyFile(db, ROOT + 'supabase/migrations/' + f)
  if (!r.ok) { console.log('APPLY FAILED', f, r.msg); Deno.exit(1) }
}
await db.exec(`SELECT set_config('app.trusted_checkin_notice','on',false);
  UPDATE public.profiles SET checkins_notice_at = now(), checkins_public = true WHERE id = '${U(1)}';
  SELECT set_config('app.trusted_checkin_notice','off',false);`)

// ── tokens ──
const b64u = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
const jwt = (payload: Record<string, unknown>) => `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u(payload)}.sig`
const TOK: Record<string, { id: string; is_anonymous: boolean }> = {
  adult: { id: U(1), is_anonymous: false }, guest: { id: U(2), is_anonymous: true }, nonotice: { id: U(3), is_anonymous: false },
}
const userJwt = (k: string) => jwt({ sub: TOK[k].id, role: 'authenticated', k })
const SERVICE = jwt({ role: 'service_role' })

// ── fake Google: place id → { location, types, name } ──
const PLACES: Record<string, { lat: number; lng: number; types: string[]; name: string }> = {
  ChIJcafe000000000001: { lat: 35.1, lng: 33.1, types: ['cafe', 'food'], name: 'Kahve Evi' },
  ChIJpharmacy00000001: { lat: 35.1002, lng: 33.1, types: ['pharmacy', 'health'], name: 'Eczane' },
  ChIJroute00000000001: { lat: 35.1001, lng: 33.1, types: ['route'], name: 'Some Road' },
  ChIJfaraway000000001: { lat: 35.2, lng: 33.1, types: ['park'], name: 'Far Park' },
}
const googleLog: { url: string; mask: string | null; key: string | null; body: any }[] = []

const realFetch = globalThis.fetch
globalThis.fetch = async (input: Request | URL | string, init: RequestInit = {}) => {
  const req = new Request(input, init)
  const url = new URL(req.url)
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  if (url.host === 'places.googleapis.com') {
    const body = req.method === 'POST' ? await req.json() : null
    googleLog.push({ url: url.pathname + url.search, mask: req.headers.get('X-Goog-FieldMask'), key: req.headers.get('X-Goog-Api-Key'), body })
    if (url.pathname === '/v1/places:searchNearby') {
      return json(200, { places: Object.entries(PLACES).map(([id, p]) => ({
        id, displayName: { text: p.name }, location: { latitude: p.lat, longitude: p.lng }, types: p.types, primaryType: p.types[0] })) })
    }
    const id = url.pathname.replace('/v1/places/', '')
    const p = PLACES[id]
    if (!p) return json(404, { error: { status: 'NOT_FOUND' } })
    return json(200, { id, displayName: { text: p.name }, location: { latitude: p.lat, longitude: p.lng }, types: p.types })
  }
  if (url.host === 'supa.test') {
    if (url.pathname === '/auth/v1/user') {
      const t = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '')
      const k = (() => { try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).k } catch { return null } })()
      const u = k && TOK[k]
      return u ? json(200, { id: u.id, aud: 'authenticated', role: 'authenticated', is_anonymous: u.is_anonymous })
               : json(401, { message: 'invalid JWT' })
    }
    await db.exec('RESET ROLE; SET ROLE service_role;')
    try {
      if (url.pathname.startsWith('/rest/v1/rpc/')) {
        const fn = url.pathname.split('/').pop()!
        const args = await req.json()
        const keys = Object.keys(args)
        const sql = `SELECT * FROM public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`
        const rows = (await db.query(sql, keys.map(k => args[k]))).rows as Record<string, unknown>[]
        const scalar = rows.length === 1 && Object.keys(rows[0]).length === 1 && Object.keys(rows[0])[0] === fn
        return json(200, scalar ? rows[0][fn] : rows)
      }
      if (url.pathname === '/rest/v1/google_place_pins') {
        const p = url.searchParams
        const eqId = p.get('google_place_id')?.replace(/^eq\./, '')
        if (req.method === 'GET') {
          const lt = p.get('fetched_at')?.replace(/^lt\./, '')
          const rows = (await db.query(`SELECT google_place_id FROM public.google_place_pins WHERE fetched_at < $1 ORDER BY fetched_at LIMIT $2`,
            [lt, Number(p.get('limit') ?? 1000)])).rows
          return json(200, rows)
        }
        if (req.method === 'PATCH') {
          const b = await req.json()
          await db.query(`UPDATE public.google_place_pins SET latitude = $1, longitude = $2, fetched_at = $3 WHERE google_place_id = $4`,
            [b.latitude, b.longitude, b.fetched_at, eqId])
          return new Response(null, { status: 204 })
        }
        if (req.method === 'DELETE') {
          await db.query(`DELETE FROM public.google_place_pins WHERE google_place_id = $1`, [eqId])
          return new Response(null, { status: 204 })
        }
      }
      return json(404, { message: `fixture has no route for ${req.method} ${url.pathname}` })
    } catch (e) {
      return json(400, { message: String((e as Error).message).split('\n')[0], code: 'P0001' })
    } finally { await db.exec('RESET ROLE;') }
  }
  return realFetch(input, init)
}

// ── load the function, capture its handler ──
Deno.env.set('SUPABASE_URL', 'https://supa.test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', SERVICE)
let handler: (r: Request) => Promise<Response>
;(Deno as any).serve = (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown() {} } }
await import('../supabase/functions/google-places/index.ts')
const call = async (body: unknown, token: string | null, method = 'POST') => {
  const res = await handler(new Request('https://fn.test/google-places', {
    method, headers: token ? { Authorization: `Bearer ${token}`, 'content-type': 'application/json' } : {},
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  }))
  return { status: res.status, body: await res.json().catch(() => null) }
}

let pass = 0, fail = 0
const ok = (name: string, cond: boolean, got?: unknown) => { if (cond) pass++; else { fail++; console.log('FAIL', name, JSON.stringify(got)) } }
const q = async (sql: string) => (await db.query(sql)).rows as any[]
let x

// ── configuration / transport ──
x = await call({ action: 'nearby', lat: 35.1, lng: 33.1 }, userJwt('adult'))
ok('no GOOGLE_PLACES_SERVER_KEY -> 503 not_configured', x.status === 503 && x.body?.error === 'not_configured', x)
Deno.env.set('GOOGLE_PLACES_SERVER_KEY', 'TEST-KEY')
x = await call(null, userJwt('adult'), 'GET'); ok('GET -> 405', x.status === 405, x)
x = await call({ action: 'nearby', lat: 35.1, lng: 33.1 }, 'not.a.jwt'); ok('unknown token -> 401', x.status === 401, x)
x = await call({ action: 'bogus' }, userJwt('adult')); ok('unknown action -> 400', x.status === 400, x)

// ── nearby ──
x = await call({ action: 'nearby', lat: 35.1, lng: 33.1, lang: 'Turkish' }, userJwt('guest')); ok('guest nearby -> 403', x.status === 403, x)
googleLog.length = 0
x = await call({ action: 'nearby', lat: 35.123456789, lng: 33.987654321, lang: 'Turkish' }, userJwt('adult'))
const g0 = googleLog[0]
ok('nearby 200; route-type place dropped', x.status === 200 && x.body.places.length === 3 && !x.body.places.some((p: any) => p.id === 'ChIJroute00000000001'), x)
ok('nearby sends the server key in a header, never in the URL', g0?.key === 'TEST-KEY' && !g0.url.includes('TEST-KEY'), g0)
ok('nearby field mask is exactly id,displayName,location,types,primaryType',
  g0?.mask === 'places.id,places.displayName,places.location,places.types,places.primaryType', g0?.mask)
ok('nearby centre rounded to 4 decimals (policy: ~10 m), radius 100, by distance, tr',
  g0?.body?.locationRestriction?.circle?.center?.latitude === 35.1235 && g0.body.locationRestriction.circle.center.longitude === 33.9877
  && g0.body.locationRestriction.circle.radius === 100 && g0.body.rankPreference === 'DISTANCE' && g0.body.languageCode === 'tr', g0?.body)
x = await q(`SELECT n FROM public.google_places_usage WHERE user_id = '${U(1)}' AND kind = 'nearby'`); ok('nearby counted once', x[0]?.n === 1, x)
await db.exec(`UPDATE public.google_places_usage SET n = 40 WHERE user_id = '${U(1)}' AND kind = 'nearby'`)
googleLog.length = 0
x = await call({ action: 'nearby', lat: 35.1, lng: 33.1 }, userJwt('adult'))
ok('41st nearby -> 429 QUOTA and Google is NOT called', x.status === 429 && x.body?.error === 'QUOTA' && googleLog.length === 0, { x, calls: googleLog.length })

// ── details ──
googleLog.length = 0
x = await call({ action: 'details', ids: ['ChIJcafe000000000001', 'ChIJmissing000000001', 'bad id!'], lang: 'English' }, userJwt('guest'))
ok('details serves guests; bad id filtered; unknown -> null',
  x.status === 200 && x.body.names.ChIJcafe000000000001 === 'Kahve Evi' && x.body.names.ChIJmissing000000001 === null && !('bad id!' in x.body.names), x)
ok('details field mask id,displayName; 2 Google calls', googleLog.length === 2 && googleLog.every(g => g.mask === 'id,displayName'), googleLog)
x = await call({ action: 'details', ids: Array.from({ length: 21 }, (_, i) => `ChIJmany0000000000${String(i).padStart(2, '0')}`) }, userJwt('adult'))
ok('21 ids -> 400', x.status === 400, x)

// ── checkin ──
x = await call({ action: 'checkin', placeId: 'ChIJcafe000000000001', lat: 35.1, lng: 33.1, accuracy: 10 }, userJwt('guest'))
ok('guest checkin -> 403', x.status === 403, x)
x = await call({ action: 'checkin', placeId: 'ChIJcafe000000000001', lat: 35.1, lng: 33.1, accuracy: 10 }, userJwt('nonotice'))
ok('no notice -> 409 NOTICE_REQUIRED', x.status === 409 && x.body?.error === 'NOTICE_REQUIRED', x)
googleLog.length = 0
x = await call({ action: 'checkin', placeId: 'ChIJfaraway000000001', lat: 35.1, lng: 33.1, accuracy: 10 }, userJwt('adult'))
ok('11 km from Google location -> 409 TOO_FAR', x.status === 409 && x.body?.error === 'TOO_FAR', x)
ok('checkin field mask id,location,types (Essentials)', googleLog[0]?.mask === 'id,location,types', googleLog)
x = await call({ action: 'checkin', placeId: 'ChIJcafe000000000001', lat: 35.1005, lng: 33.1, accuracy: 10, placeLat: 35.1005, placeLng: 33.1 }, userJwt('adult'))
ok('56 m, acc 10 -> checked in', x.status === 200 && x.body.ok && x.body.already === false, x)
x = await q(`SELECT latitude, longitude FROM public.google_place_pins WHERE google_place_id = 'ChIJcafe000000000001'`)
ok('pin stores GOOGLE\'s position (35.1), not the phone\'s or any body field', x.length === 1 && x[0].latitude === 35.1, x)
x = await q(`SELECT count(*)::int n FROM public.checkins WHERE google_place_id = 'ChIJcafe000000000001' AND user_id = '${U(1)}'`)
ok('one check-in row, keyed by place id', x[0].n === 1, x)
x = await call({ action: 'checkin', placeId: 'ChIJpharmacy00000001', lat: 35.1003, lng: 33.1, accuracy: 10 }, userJwt('adult'))
ok('pharmacy check-in allowed', x.status === 200 && x.body.ok, x)
x = await q(`SELECT count(*)::int n FROM public.google_place_pins WHERE google_place_id = 'ChIJpharmacy00000001'`)
ok('pharmacy -> no pin', x[0].n === 0, x)
x = await call({ action: 'checkin', placeId: 'ChIJmissing000000001', lat: 35.1, lng: 33.1, accuracy: 10 }, userJwt('adult'))
ok('Google 404 -> 404 PLACE_NOT_FOUND', x.status === 404 && x.body?.error === 'PLACE_NOT_FOUND', x)
x = await call({ action: 'checkin', placeId: 'ChIJcafe000000000001', lat: 'NaN', lng: 33.1, accuracy: 10 }, userJwt('adult'))
ok('NaN fix -> 400 BAD_FIX', x.status === 400 && x.body?.error === 'BAD_FIX', x)

// ── refresh ──
x = await call({ action: 'refresh' }, userJwt('adult')); ok('refresh with a user token -> 403', x.status === 403, x)
await db.exec(`INSERT INTO public.checkins (user_id, google_place_id, checked_in_on, display_name_snapshot) VALUES
  ('${U(1)}', 'ChIJmissing000000001', current_date - 1, 'adult'), ('${U(1)}', 'ChIJpharmacy00000001', current_date - 1, 'adult');
  INSERT INTO public.google_place_pins VALUES
   ('ChIJmissing000000001', 35.3, 33.3, now() - interval '21 days'),
   ('ChIJpharmacy00000001', 35.3, 33.3, now() - interval '21 days');
  UPDATE public.google_place_pins SET latitude = 1, fetched_at = now() - interval '21 days' WHERE google_place_id = 'ChIJcafe000000000001';
  INSERT INTO public.google_place_pins VALUES ('ChIJfaraway000000001', 9, 9, now() - interval '2 days');`)
googleLog.length = 0
x = await call({ action: 'refresh' }, SERVICE)
ok('refresh: 1 refreshed, 2 removed (Google 404 + now a pharmacy)', x.status === 200 && x.body.refreshed === 1 && x.body.removed === 2, x)
x = await q(`SELECT google_place_id, latitude, fetched_at > now() - interval '1 minute' AS fresh FROM public.google_place_pins ORDER BY 1`)
ok('cafe pin re-read from Google (lat 35.1) and re-dated; young pin untouched; others gone',
  JSON.stringify(x.map(r => [r.google_place_id, r.latitude, r.fresh])) === JSON.stringify([['ChIJcafe000000000001', 35.1, true], ['ChIJfaraway000000001', 9, false]]), x)
ok('refresh mask id,location,types; only the 3 due pins asked', googleLog.length === 3 && googleLog.every(g => g.mask === 'id,location,types'), googleLog)

console.log(`${pass} pass, ${fail} fail`)
Deno.exit(fail ? 1 : 0)
