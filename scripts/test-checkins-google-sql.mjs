// 20261093 Google-place check-ins, behaviour as each role, in PGlite, on top of 20261092.
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-checkins-google-sql.mjs [1093.sql]
// The optional path is for red-first runs against a deliberately broken copy. Shares the
// fixture with scripts/test-checkins-sql.mjs (read from its SEED literal). The Edge Function's
// half (JWT → uid, Google's location, pharmacy → p_pin=false) is NOT exercised here.
import { readFileSync } from 'fs'
import { fileURLToPath } from 'node:url'
import { freshDb, applyFile } from './migration-harness.mjs'
const base = readFileSync(new URL('./test-checkins-sql.mjs', import.meta.url), 'utf8')
const SEED = base.match(/const SEED = `([\s\S]*?)`\.replace/)[1].replace(/'u0000000[^']*'::text::uuid/, "'b0000000-0000-4000-8000-000000000009'")
const F1092 = fileURLToPath(new URL('../supabase/migrations/20261092_checkins.sql', import.meta.url))
const F1093 = process.argv[2] || fileURLToPath(new URL('../supabase/migrations/20261093_checkins_google_places.sql', import.meta.url))
const U = n => `b0000000-0000-4000-8000-00000000000${n}`
const P = n => `a0000000-0000-4000-8000-00000000000${n}`
const G = n => `ChIJgooglePlace00000${n}`   // valid shape
const db = await freshDb(SEED)
await db.exec(`INSERT INTO public.profiles (id, display_name, date_of_birth) VALUES
 ('${U(1)}','adult','1990-01-01'), ('${U(2)}','viewer','1990-01-01'), ('${U(3)}','minor', current_date - interval '15 years'),
 ('${U(4)}','guest', null), ('${U(5)}','nonotice','1990-01-01');
 INSERT INTO auth.users (id, is_anonymous) SELECT id, id = '${U(4)}' FROM public.profiles;`)
for (const f of [F1092, F1093]) {
  const r = await applyFile(db, f)
  if (!r.ok) { console.log('APPLY FAILED', f.split('/').pop(), r.msg); process.exit(1) }
}
await db.exec(`SELECT set_config('app.trusted_checkin_notice', 'on', false); UPDATE public.profiles SET checkins_notice_at = now(),
  checkins_public = (date_of_birth <= current_date - interval '18 years') WHERE id <> '${U(5)}'; SELECT set_config('app.trusted_checkin_notice', 'off', false);`)

let pass = 0, fail = 0
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log('FAIL', name, JSON.stringify(got)) } }
async function as(role, uid, sql) {
  await db.exec('RESET ROLE;')
  await db.query("SELECT set_config('request.jwt.claims', $1, false)", [uid ? JSON.stringify({ sub: uid, role }) : ''])
  await db.exec(`SET ROLE ${role};`)
  try { return { ok: true, rows: (await db.query(sql)).rows } }
  catch (e) { return { ok: false, msg: String(e.message).split('\n')[0] } }
  finally { await db.exec('RESET ROLE;') }
}
const svc = sql => as('service_role', null, sql)
// Google place g at (35.1, 33.1) unless given; the fix is where the phone says it is.
const cig = (u, g, lat, lng, acc = 10, pin = true, plat = 35.1, plng = 33.1) =>
  svc(`SELECT * FROM public.check_in_google('${U(u)}', '${G(g)}', ${plat}, ${plng}, ${lat}, ${lng}, ${acc}, ${pin})`)
const pins = async (u = 2) => (await as('authenticated', U(u), `SELECT google_place_id FROM public.get_google_place_pins() ORDER BY 1`)).rows?.map(r => r.google_place_id)
let x

// ── who may call ──
x = await as('authenticated', U(1), `SELECT * FROM public.check_in_google('${U(1)}', '${G(1)}', 35.1, 33.1, 35.1, 33.1, 10, true)`)
ok('authenticated cannot call check_in_google', !x.ok && /permission denied/.test(x.msg), x)
x = await as('authenticated', U(1), `SELECT public.claim_google_places_call('${U(1)}', 'nearby', 1)`)
ok('authenticated cannot claim quota', !x.ok && /permission denied/.test(x.msg), x)
x = await cig(4, 1, 35.1, 33.1); ok('guest user -> AUTH_REQUIRED', x.msg === 'AUTH_REQUIRED', x)
x = await cig(5, 1, 35.1, 33.1); ok('no notice -> NOTICE_REQUIRED (1092 rule via helper)', x.msg === 'NOTICE_REQUIRED', x)
x = await svc(`SELECT * FROM public.check_in_google('${U(1)}', 'bad id with spaces', 35.1, 33.1, 35.1, 33.1, 10, true)`)
ok('bad place id -> PLACE_NOT_FOUND', x.msg === 'PLACE_NOT_FOUND', x)

// ── distance / accuracy against GOOGLE's coordinates ──
x = await cig(1, 1, 35.1018, 33.1); ok('200 m from Google location -> TOO_FAR', x.msg === 'TOO_FAR', x)
x = await cig(1, 1, 35.1, 33.1, 60); ok('accuracy 60 -> LOW_ACCURACY', x.msg === 'LOW_ACCURACY', x)
x = await svc(`SELECT count(*)::int n FROM public.google_place_pins`); ok('refusals leave no pin', x.rows[0].n === 0, x)
x = await cig(1, 1, 35.1013, 33.1, 50); ok('145 m acc 50 -> checked in (positive control)', x.ok && x.rows[0].already === false, x)
x = await cig(1, 1, 35.1, 33.1); ok('same Google place same day -> already', x.ok && x.rows[0].already === true, x)
x = await svc(`SELECT count(*)::int n FROM public.checkins WHERE google_place_id = '${G(1)}'`); ok('one row only', x.rows[0].n === 1, x)

// ── pins ──
ok('viewer sees pin of adult public check-in', JSON.stringify(await pins()) === JSON.stringify([G(1)]), await pins())
x = await as('authenticated', U(2), `SELECT * FROM public.google_place_pins`); ok('table unreadable by client', !x.ok, x)
x = await as('authenticated', U(2), `SELECT * FROM public.google_places_usage`); ok('usage unreadable by client', !x.ok, x)
x = await as('anon', null, `SELECT * FROM public.get_google_place_pins()`); ok('anon cannot read pins', !x.ok, x)
x = await as('authenticated', U(4), `SELECT count(*)::int n FROM public.get_google_place_pins()`); ok('guest reads pins (map browsing)', x.ok && x.rows[0].n === 1, x)
x = await cig(3, 2, 35.2, 33.2, 10, true, 35.2, 33.2); ok('minor checks in at Google place 2', x.ok, x)
ok('minor-only (hidden) check-in makes no visible pin', !(await pins()).includes(G(2)), await pins())
x = await cig(2, 3, 35.1005, 33.1, 10, false, 35.1, 33.1); ok('pharmacy check-in allowed', x.ok && x.rows[0].already === false, x)
x = await svc(`SELECT count(*)::int n FROM public.google_place_pins WHERE google_place_id = '${G(3)}'`); ok('pharmacy -> no pin row', x.rows[0].n === 0, x)
await db.exec(`INSERT INTO public.google_place_pins VALUES ('${G(3)}', 35.1, 33.1, now())`)
x = await cig(2, 3, 35.1005, 33.1, 10, false, 35.1, 33.1); ok('pharmacy again (already) removes a stray pin', x.ok && x.rows[0].already === true, x)
x = await svc(`SELECT count(*)::int n FROM public.google_place_pins WHERE google_place_id = '${G(3)}'`); ok('stray pharmacy pin gone', x.rows[0].n === 0, x)
await db.exec(`UPDATE public.google_place_pins SET fetched_at = now() - interval '29 days 1 minute' WHERE google_place_id = '${G(1)}'`)
ok('pin older than 29 days hidden', !(await pins()).includes(G(1)), await pins())

x = (await db.query(`SELECT public.purge_google_places_cache() AS r`)).rows[0].r
ok('purge deletes the stale pin only (the minor pin still has a check-in)', x.pins === 1, x)
x = await svc(`SELECT google_place_id FROM public.google_place_pins ORDER BY 1`)
ok('after purge: only the minor place row remains (kept, never shown)', JSON.stringify(x.rows.map(r => r.google_place_id)) === JSON.stringify([G(2)]), x)
await db.exec(`DELETE FROM public.checkins WHERE google_place_id = '${G(2)}'`)
x = (await db.query(`SELECT public.purge_google_places_cache() AS r`)).rows[0].r
ok('purge removes a pin with no check-in left', x.pins === 1, x)

// ── feed ──
x = await as('authenticated', U(2), `SELECT display_name, place_name, google_place_id FROM public.get_checkin_feed(p_google_place_id => '${G(1)}')`)
ok('feed by Google place: adult row, no place name, id set', x.ok && x.rows.length === 1 && x.rows[0].display_name === 'adult' && x.rows[0].place_name === null && x.rows[0].google_place_id === G(1), x)
x = await as('authenticated', U(2), `SELECT google_place_id FROM public.get_checkin_feed()`)
ok('all-places feed includes Google rows', x.ok && x.rows.some(r => r.google_place_id === G(1)), x)
x = await as('authenticated', U(2), `SELECT checkin_id FROM public.get_checkin_feed(null, null, null, 1)`)
ok('1092 positional call still works', x.ok && x.rows.length === 1, x)

// ── impossible travel across kinds ──
await db.exec(`INSERT INTO public.google_place_pins VALUES ('${G(1)}', 35.1, 33.1, now()) ON CONFLICT (google_place_id) DO UPDATE SET fetched_at = now()`)
x = await as('authenticated', U(1), `SELECT * FROM public.check_in('${P(2)}', 35.27, 33.0, 10)`)
ok('Google check-in then ADA place 20 km away -> TOO_FAST', x.msg === 'TOO_FAST', x)
x = await as('authenticated', U(1), `SELECT * FROM public.check_in('${P(1)}', 35.0, 33.0, 10)`)
ok('…and 14 km away too (from the pin, not an older row)', x.msg === 'TOO_FAST', x)

// ── shape ──

try { await db.exec(`INSERT INTO public.checkins (user_id, place_id, google_place_id, checked_in_on, display_name_snapshot) VALUES ('${U(1)}', '${P(5)}', '${G(9)}', current_date, 'x')`); ok('both ids refused', false, 'inserted') }
catch (e) { ok('both ids refused', /checkins_one_place/.test(e.message), e.message) }
try { await db.exec(`INSERT INTO public.checkins (user_id, checked_in_on, display_name_snapshot) VALUES ('${U(1)}', current_date, 'x')`); ok('neither id refused', false, 'inserted') }
catch (e) { ok('neither id refused', /checkins_one_place/.test(e.message), e.message) }

// ── quota ──
let last
for (let i = 0; i < 41; i++) last = await svc(`SELECT public.claim_google_places_call('${U(1)}', 'nearby', 1) AS ok`)
ok('41st nearby call for one user refused', last.rows[0].ok === false, last)
x = await svc(`SELECT public.claim_google_places_call('${U(2)}', 'nearby', 1) AS ok`); ok('another user still allowed', x.rows[0].ok === true, x)
x = await svc(`SELECT n FROM public.google_places_usage WHERE user_id = '${U(1)}' AND kind = 'nearby'`); ok('refused call not counted', x.rows[0].n === 40, x)
x = await svc(`SELECT public.claim_google_places_call('${U(1)}', 'bogus', 1) AS ok`); ok('unknown kind raises', x.msg === 'BAD_KIND', x)

console.log(`${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
