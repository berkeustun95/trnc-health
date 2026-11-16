// The staged beaches migration (supabase/migrations/*_beaches_staged.sql) against a Supabase-shaped Postgres (scripts/migration-harness.mjs).
// Claims under test:
//   1. it refuses before 20261178; after it, the 30 rows exist, and ONLY a request carrying the ADA Preview key can read them;
//   2. the staged cafés / shops and the 4 live beaches are byte-identical before and after; the file publishes nothing;
//   3. a second apply inserts nothing and passes, and so does a re-run AFTER the beaches are published (UPDATE ... WHERE category='beach'),
//      while the staged shops stay staged and invisible ("never the 399 shops");
//   4. the rows read back equal data/explore/beaches.json field for field;
//   5. the assertions are not decorative: each red below (a temp copy with an anchored edit) fires its own message.
// The places table is the REAL CREATE TABLE of 20260822 + the later ADD COLUMNs; the 9 policies and the 6 triggers are extracted verbatim from the
// migrations that define them (newest definition wins), and so are the word-filter functions and their seeded term list. What this does NOT cover:
// PGlite is PostgreSQL 18, prod is older; the live blocked_terms table is longer than the 20260712 seed (an admin edits it), so a live word-filter hit
// is checked separately against the public term list and, if it ever happened, would abort the apply safely; PostgREST, JWT verification, and
// is_previewer()'s real header read are stubbed (auth.jwt() reads request.jwt.claims as Supabase does, and is_anonymous_session() is the real migration function over it, so a guest is a session with is_anonymous true) (a session setting stands in for the header).
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile as applyFile0, asRole as asRole0 } from './migration-harness.mjs'
// a real migration session carries no preview header: clear the stub's session setting (left on by a `seen` question) before every apply
const applyFile = async (db, ...a) => { await db.exec("SELECT set_config('test.preview', '', false)"); return applyFile0(db, ...a) }
// asRole leaves request.jwt.claims set for the session; a migration runs as postgres with NO session (auth.uid() NULL), so clear it after every question
const asRole = async (db, ...a) => { const x = await asRole0(db, ...a); await db.exec("SELECT set_config('request.jwt.claims', '', false)"); return x }

process.on('uncaughtException', e => { console.error('FAIL:', String(e.message).slice(0, 700)); process.exit(1) })

const MIGDIR = 'supabase/migrations'
const MIGS = readdirSync(MIGDIR).filter(f => f.endsWith('.sql')).sort()
const FILE = `${MIGDIR}/${MIGS.filter(f => /^\d+_beaches_staged\.sql$/.test(f)).pop()}`
assert.ok(FILE.endsWith('_beaches_staged.sql'), 'no *_beaches_staged.sql migration')
const DATA = JSON.parse(readFileSync('data/explore/beaches.json', 'utf8'))
const ROWS = DATA.rows
assert.equal(ROWS.length, 30)
const USER = '00000000-0000-0000-0000-0000000000a1'
const LIVE_IDS = ['fa39492b-57e6-4ebd-b22c-89a9cf20ffe2', '4a29cce8-8c3a-4541-8a07-fc7ceda6a4ff', 'b52cdf3a-ce3f-4e6f-88b8-57afb95f2e67', '95b6d924-e3c0-40e4-a2bd-b55ca1a105ef']

const newest = re => {
  const hit = MIGS.filter(f => re.test(readFileSync(`${MIGDIR}/${f}`, 'utf8'))).pop()
  assert.ok(hit, `no migration defines ${re}`)
  console.log(`  fixture: ${re.source.replace(/\\/g, '').slice(0, 70)} <- ${hit}`)
  return hit
}
const grab = (file, start, ends) => {
  const t = readFileSync(`${MIGDIR}/${file}`, 'utf8')
  const i = t.indexOf(start)
  assert.ok(i >= 0, `${file}: ${start} not found`)
  const hits = ends.map(e => [t.indexOf(e, i + start.length), e]).filter(([j]) => j >= 0).sort((a, b) => a[0] - b[0])
  assert.ok(hits.length, `${file}: end of ${start} not found`)
  return t.slice(i, hits[0][0] + hits[0][1].length)
}
const FN = ['$function$;', '$$;']
const fn = (name, sig = '()') => grab(newest(new RegExp(`^CREATE OR REPLACE FUNCTION public\\.${name}\\(`, 'm')), `CREATE OR REPLACE FUNCTION public.${name}${sig}`, FN)
const tg = name => {
  const re = new RegExp(`^CREATE (OR REPLACE )?TRIGGER ${name}$`, 'm')
  const f = newest(re); const t = readFileSync(`${MIGDIR}/${f}`, 'utf8'); const m = re.exec(t)
  return t.slice(m.index, t.indexOf(');', m.index) + 2)
}

// the real places table: 20260822's CREATE TABLE, then the ADD COLUMNs of 20260824 / 20260825 / 20260829 / 20260917 / 20261045 / 20261155
const TABLE = grab('20260822_places_consolidation.sql', 'CREATE TABLE IF NOT EXISTS public.places (', ['\n);'])
const POLICIES = (() => {
  const t = readFileSync(`${MIGDIR}/20260822_places_consolidation.sql`, 'utf8')
  return t.slice(t.indexOf('DROP POLICY IF EXISTS "places_select" ON public.places;'), t.indexOf('-- ─── 3. Indexes'))
})()
const HIDE = grab('20260824_place_moderation.sql', 'DROP POLICY IF EXISTS "places_hide_reported" ON public.places;', [');'])
const TERMS = (() => { const t = readFileSync(`${MIGDIR}/20260712_ugc_moderation.sql`, 'utf8'); const i = t.indexOf('INSERT INTO blocked_terms (term) VALUES'); return t.slice(i, t.indexOf(';\n', i) + 1) })()

const SEED = `
CREATE TABLE public.profiles (id uuid PRIMARY KEY, role text);
INSERT INTO auth.users VALUES ('${USER}');
INSERT INTO public.profiles VALUES ('${USER}', 'customer');
CREATE TABLE public.content_reports (content_type text, content_id uuid, reporter_id uuid);
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
GRANT EXECUTE ON FUNCTION auth.jwt() TO anon, authenticated, service_role;
${fn('is_anonymous_session')}
CREATE FUNCTION public.is_previewer() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('test.preview', true), '') = 'yes' $$;
CREATE TABLE public.blocked_terms (term text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), hit_count integer NOT NULL DEFAULT 0, last_hit_at timestamptz);
${TERMS}
${fn('normalize_for_moderation', '(p_text text)')}
${fn('blocked_term_hit', '(p_text text)')}
${fn('contains_blocked_term', '(p_text text)')}
${fn('contains_payment_solicitation', '(p_text text)')}
${TABLE}
ALTER TABLE public.places
  ADD COLUMN hidden_at timestamptz, ADD COLUMN hidden_reason text,
  ADD COLUMN featured_until timestamptz, ADD COLUMN featured_requested_at timestamptz,
  ADD COLUMN photo_attribution jsonb, ADD COLUMN resubmit_count integer NOT NULL DEFAULT 0,
  ADD COLUMN source text, ADD COLUMN source_id text, ADD COLUMN official_visit jsonb;
ALTER TABLE public.places ADD CONSTRAINT places_source_pair_check CHECK ((source IS NULL) = (source_id IS NULL));
ALTER TABLE public.places ADD CONSTRAINT places_source_source_id_key UNIQUE (source, source_id);
ALTER TABLE public.places ENABLE ROW LEVEL SECURITY;
${POLICIES}
${HIDE}
GRANT SELECT, INSERT, UPDATE, DELETE ON public.places TO anon, authenticated;
${grab('20260718_capture_3_functions.sql', 'CREATE OR REPLACE FUNCTION public.get_my_role()', FN)}
${grab('20260718_capture_3_functions.sql', 'CREATE OR REPLACE FUNCTION public.guard_moderation_columns()', FN)}
${fn('places_guard_insert')}
${fn('places_guard_update')}
${fn('places_guard_source')}
${fn('places_guard_official_visit')}
${fn('check_place_content')}
${tg('guard_place_moderation')}
${tg('check_place_content')}
${tg('places_guard_insert')}
${tg('places_guard_update')}
${tg('places_guard_source')}
${tg('places_guard_official_visit')}
-- production-shaped rows: the 4 live beaches (active, no source), staged OSM shops (20261179 shape), an active non-beach, a pending submission, a rejected one
INSERT INTO public.places (id, category, name, name_i18n, description_i18n, region, latitude, longitude, address, status, photos, cover_image_url, access_type, amenities, blue_flag) VALUES
 ('${LIVE_IDS[0]}', 'beach', 'Alagadi Turtle Beach', '{"en":"Alagadi Turtle Beach","tr":"Alagadı Kaplumbağa Plajı"}', '{"en":"d","tr":"d"}', 'kyrenia', 35.332504, 33.48512, NULL, 'active', ARRAY['p1.jpg'], 'c1.jpg', 'public', ARRAY['toilets'], false),
 ('${LIVE_IDS[1]}', 'beach', 'Escape Beach', '{"en":"Escape Beach","tr":"Escape Plajı"}', '{"en":"d","tr":"d"}', 'kyrenia', 35.3471, 33.2343, 'a', 'active', ARRAY['p2.jpg'], 'c2.jpg', 'public', ARRAY['sunbeds'], false),
 ('${LIVE_IDS[2]}', 'beach', 'Glapsides Beach', '{"en":"Glapsides Beach","tr":"Glapsides Plajı"}', '{"en":"d","tr":"d"}', 'famagusta', 35.1541, 33.9129, 'c', 'active', ARRAY['p3.jpg'], NULL, 'public', NULL, true),
 ('${LIVE_IDS[3]}', 'beach', 'Golden Beach (Altın Kumsal)', '{"en":"Golden Beach","tr":"Altın Kumsal"}', '{"en":"d","tr":"d"}', 'karpaz', 35.6412, 34.5423, 'b', 'active', ARRAY['p4.jpg'], NULL, 'public', NULL, false);
-- the staged OSM shops of 20261179 (born 'pending' here only because 'staged' is not in the status check until 20261178; STAGE_SHOPS flips them after it)
INSERT INTO public.places (category, name, region, latitude, longitude, status, source, source_id) VALUES
 ('cafe', 'Staged Cafe One', 'kyrenia', 35.33, 33.34, 'pending', 'osm', 'node/10020202118'),
 ('cafe', 'Staged Cafe Two', 'nicosia', 35.20, 33.31, 'pending', 'osm', 'node/10106250750'),
 ('gym', 'Staged Gym', 'morphou', 35.19, 32.99, 'pending', 'osm', 'way/489045147'),
 ('hair_salon', 'Staged Salon', 'famagusta', 35.13, 33.65, 'pending', 'osm', 'node/10211854317');
INSERT INTO public.places (category, name, region, latitude, longitude, status) VALUES
 ('religious_site', 'Bellapais Abbey', 'kyrenia', 35.3, 33.35, 'active'),
 ('cafe', 'Pending Submission', 'nicosia', 35.2, 33.3, 'pending'),
 ('cafe', 'Rejected Submission', 'nicosia', 35.2, 33.3, 'rejected');
`
const STAGE_SHOPS = "UPDATE public.places SET status = 'staged' WHERE source = 'osm'"
const undo = db => db.exec('ROLLBACK; RESET ROLE;')
const snap = async (db, where = 'TRUE') => (await db.query(`SELECT to_jsonb(p) j FROM public.places p WHERE ${where} ORDER BY id`)).rows.map(r => r.j)
const IN_FILE = `(source, source_id) IN (${ROWS.map(r => `('${r.source}','${r.source_id}')`).join(',')})`
const NOT_FILE = `NOT (COALESCE((source, source_id) IN (${ROWS.map(r => `('${r.source}','${r.source_id}')`).join(',')}), false))`
const seen = async (db, role, uid, preview, where) => {
  await db.exec(`SELECT set_config('test.preview', '${preview ? 'yes' : ''}', false)`)
  const q = await asRole(db, role, uid, `SELECT count(*)::int n FROM public.places WHERE ${where}`)
  assert.ok(q.ok, q.msg)
  return q.rows[0].n
}
const TEXT = readFileSync(FILE, 'utf8')
const tmpDir = mkdtempSync(join(tmpdir(), 'beaches-staged-'))
const variant = (name, anchor, replacement) => {
  assert.ok(TEXT.includes(anchor), `anchor present for ${name}`)
  assert.equal(TEXT.split(anchor).length, 2, `anchor unique for ${name}`)
  const p = join(tmpDir, `${name}.sql`)
  writeFileSync(p, TEXT.replace(anchor, replacement))
  return p
}
const ANCHOR_INSERT_END = 'ON CONFLICT (source, source_id) DO NOTHING;'
const out = []

// ── 0. fixture sanity: the seeded INSERT triggers bite for a signed-in non-admin (positive control), pass through for postgres ──
let db = await freshDb(SEED)
{
  assert.equal((await db.query("SELECT count(*)::int n FROM public.places WHERE category = 'beach' AND status = 'active'")).rows[0].n, 4)
  const c = await asRole(db, 'authenticated', USER, `INSERT INTO public.places (category, name, region, status, submitted_by, source, source_id, featured_until, official_visit)
      VALUES ('beach', 'Control Row', 'kyrenia', 'pending', '${USER}', 'osm', 'way/777', now(), '{"x":1}')`)
  assert.ok(c.ok, c.msg)
  const r = (await db.query("SELECT source, source_id, featured_until, official_visit, status FROM public.places WHERE name = 'Control Row'")).rows[0]
  assert.deepEqual(r, { source: null, source_id: null, featured_until: null, official_visit: null, status: 'pending' }, 'guards live: source / featured_until / official_visit stripped for a session user')
  await db.exec("DELETE FROM public.places WHERE name = 'Control Row'")
  const bad = await asRole(db, 'authenticated', USER, `INSERT INTO public.places (category, name, region, status, submitted_by) VALUES ('cafe', 'x', 'kyrenia', 'active', '${USER}')`)
  assert.ok(bad.ok, bad.msg)
  assert.equal((await db.query("SELECT status FROM public.places WHERE name = 'x'")).rows[0].status, 'pending', 'places_guard_insert forces a session user\'s row to pending')
  await db.exec("DELETE FROM public.places WHERE name = 'x'")
  const blocked = await db.query("SELECT contains_blocked_term('this is fuck') b, contains_payment_solicitation('pay me by iban') p, contains_blocked_term('Kervansaray Beach') n")
  assert.deepEqual(blocked.rows[0], { b: true, p: true, n: false }, 'word filter functions are live in the fixture')
  const fires = await asRole(db, 'authenticated', USER, `INSERT INTO public.places (category, name, region, status, submitted_by) VALUES ('cafe', 'fuck cafe', 'kyrenia', 'pending', '${USER}')`)
  assert.equal(fires.ok, false); assert.match(fires.msg, /BLOCKED_TERM/, 'check_place_content fires on a blocked term')
  out.push('fixture: guards + word filter live (positive controls)')
}

// ── 1. refuses before 20261178 ─────────────────────────────────────────────
let r = await applyFile(db, FILE); await undo(db)
assert.equal(r.ok, false); assert.match(r.msg, /20261178/, r.msg)
assert.equal((await snap(db, IN_FILE)).length, 0, 'refusal inserted nothing')
console.log('refuses before 20261178:', r.msg)
r = await applyFile(db, `${MIGDIR}/20261178_places_staged_preview.sql`)
assert.ok(r.ok, `1178: ${r.msg}`)
await db.exec(STAGE_SHOPS)

// ── 2. apply: count, scope, visibility ─────────────────────────────────────
const beforeOthers = await snap(db, NOT_FILE)
const totalBefore = (await db.query('SELECT count(*)::int n FROM public.places')).rows[0].n
r = await applyFile(db, FILE)
assert.ok(r.ok, `apply: ${r.msg}`)
const mine = await snap(db, IN_FILE)
assert.equal(mine.length, 30, 'rows in = rows out')
console.log(`apply: rows in ${ROWS.length} (generator) -> rows found for this file ${mine.length}; places ${totalBefore} -> ${(await db.query('SELECT count(*)::int n FROM public.places')).rows[0].n}`)
assert.deepEqual(await snap(db, NOT_FILE), beforeOthers, 'every row that is not this file\'s is byte-identical (staged shops, live beaches, submissions)')
assert.equal((await db.query("SELECT count(*)::int n FROM public.places WHERE status = 'staged' AND category <> 'beach'")).rows[0].n, 4, 'the staged shops are still staged')
assert.equal((await db.query("SELECT count(*)::int n FROM public.schema_migrations_applied WHERE filename = $1", [FILE.split('/').pop()])).rows[0].n, 1, 'stamps itself in the same transaction')

const FILEW = IN_FILE, LIVE = "category = 'beach' AND source IS NULL", SHOPS = "category <> 'beach' AND status = 'staged'"
for (const [label, role, uid, prev, exp] of [
  ['anon, production', 'anon', null, false, [0, 4, 0]],
  ['signed in, production', 'authenticated', USER, false, [0, 4, 0]],
  ['anon, Preview key', 'anon', null, true, [30, 4, 4]],
  ['signed in, Preview key', 'authenticated', USER, true, [30, 4, 4]],
]) {
  const got = [await seen(db, role, uid, prev, FILEW), await seen(db, role, uid, prev, LIVE), await seen(db, role, uid, prev, SHOPS)]
  assert.deepEqual(got, exp, `${label}: [this file's rows, live beaches, staged shops]`)
  console.log(`  ${label}: sees ${got[0]} of this file's 30, ${got[1]} live beaches (positive control), ${got[2]} staged shops`)
}

// ── 3. round trip: the rows read back equal beaches.json ───────────────────
const byKey = new Map(mine.map(j => [`${j.source}|${j.source_id}`, j]))
for (const x of ROWS) {
  const j = byKey.get(`${x.source}|${x.source_id}`)
  assert.ok(j, `missing ${x.source_id}`)
  const min = x.source === 'visitncy_beaches'
  const want = {
    name: x.name, name_i18n: x.name_i18n, description_i18n: min ? x.description_i18n : null, category: 'beach', region: x.region, area: x.area,
    latitude: x.latitude, longitude: x.longitude, access_type: min ? x.access_type : null, amenities: min && x.amenities.length ? x.amenities : null,
    source: x.source, source_id: x.source_id, status: 'staged',
  }
  const got = Object.fromEntries(Object.keys(want).map(k => [k, j[k]]))
  assert.deepEqual(got, want, `${x.source_id}: row read back differs from beaches.json`)
  for (const k of ['blue_flag', 'cover_image_url', 'photo_credits', 'photo_attribution', 'provider_id', 'submitted_by', 'hidden_at', 'featured_until', 'official_visit', 'address', 'phone', 'website', 'opening_hours']) assert.equal(j[k] ?? null, null, `${x.source_id}.${k} must stay NULL`)
  assert.deepEqual(j.photos, [], `${x.source_id}: photos empty`)
}
const sunas = byKey.get('osm|node/11231014679'); assert.equal(sunas.name, "Suna's Beach and Restaurant"); assert.equal(sunas.name_i18n.fa, "Suna's Beach and Restaurant")
assert.equal(ROWS.filter(x => x.source === 'osm').length, 28); assert.equal(ROWS.filter(x => x.source === 'visitncy_beaches').length, 2)
console.log('round trip: 30 of 30 rows equal beaches.json on 13 written columns; 13 never-written columns NULL; photos empty; names with quotes intact')
const kerv = byKey.get('visitncy_beaches|kervansaray-beach'), lb = byKey.get('visitncy_beaches|long-beach')
assert.deepEqual(kerv.amenities, ['sunbeds', 'food_bar', 'lifeguard']); assert.equal(kerv.access_type, 'public'); assert.equal(lb.amenities, null); assert.equal(lb.access_type, 'public')

// ── 4. the word filter over the real text, field by field (booleans only) ──
let hits = 0, scanned = 0
for (const x of ROWS) {
  for (const v of [x.name, ...Object.values(x.name_i18n), ...(x.description_i18n ? Object.values(x.description_i18n) : [])]) {
    const q = (await db.query('SELECT contains_blocked_term($1) b, contains_payment_solicitation($1) p', [v])).rows[0]
    scanned++; if (q.b || q.p) hits++
  }
}
assert.equal(hits, 0)
console.log(`word filter (seeded 20260712 terms + real normalize / matcher / payment functions): ${scanned} strings scanned, ${hits} hits`)

// ── 5. second apply: no-op ──────────────────────────────────────────────────
const snap2 = await snap(db)
r = await applyFile(db, FILE)
assert.ok(r.ok, `rerun: ${r.msg}`)
assert.deepEqual(await snap(db), snap2, 'second apply changes nothing')
console.log('second apply: ok, table byte-identical')

// ── 6. publish the beaches (scoped), re-run still passes, the shops stay staged ──
const pub = await db.query("UPDATE public.places SET status = 'active' WHERE category = 'beach' AND status = 'staged'")
assert.equal(pub.affectedRows, 30, 'the scoped publish touches exactly the 30 beaches')
r = await applyFile(db, FILE)
assert.ok(r.ok, `re-run after publish: ${r.msg}`)
assert.equal((await db.query("SELECT count(*)::int n FROM public.places WHERE status = 'staged'")).rows[0].n, 4, 'only the 4 shops are still staged')
assert.equal(await seen(db, 'anon', null, false, SHOPS), 0, 'after the beaches are published an ordinary anon still sees none of the shops')
assert.equal(await seen(db, 'anon', null, false, FILEW), 30, 'and sees the 30 published beaches')
assert.equal(await seen(db, 'anon', null, false, LIVE), 4)
{
  const ren = await db.query("UPDATE public.places SET name = 'Renamed By Admin' WHERE source = 'osm' AND source_id = 'way/225386412'")
  assert.equal(ren.affectedRows, 1)
  r = await applyFile(db, FILE)
  assert.ok(r.ok, `re-run after an admin renamed a published beach: ${r.msg}`)
  assert.equal((await db.query("SELECT name FROM public.places WHERE source_id = 'way/225386412'")).rows[0].name, 'Renamed By Admin', 'the re-run left the rename alone')
  console.log('N1: re-run after an admin renamed a published beach passes (name compared only while staged)')
}
console.log('publish simulation: re-run after publish passes; anon sees 30 beaches + 4 live, 0 shops; 4 shops still staged')

// ── REDS (temp copies, anchored edits; each must fail with ITS message and leave the database as it was) ──
let reds = 0
const red = async (label, file, expect, seed = SEED, prep) => {
  reds++
  const d = await freshDb(seed)
  await applyFile(d, `${MIGDIR}/20261178_places_staged_preview.sql`)
  await d.exec(STAGE_SHOPS)
  if (prep) await prep(d)
  const before = await snap(d)
  const x = await applyFile(d, file); await undo(d)
  console.log(`RED ${label}:\n     ${x.msg}`)
  assert.equal(x.ok, false, `${label}: must abort`); assert.match(x.msg, expect, `${label}: wrong message`)
  assert.deepEqual(await snap(d), before, `${label}: aborted, nothing applied`)
}
const longBeachTuple = ", 'visitncy_beaches', 'long-beach', 'staged')"
await red('1 a row inserted as active', variant('active', longBeachTuple, ", 'visitncy_beaches', 'long-beach', 'active')"), /must publish nothing/)
await red('2 a non-beach row smuggled into the VALUES', variant('smuggle', "VALUES\n", "VALUES\n  ('Smuggled Cafe', NULL, NULL, 'cafe', 'kyrenia', NULL, 35.3, 33.3, NULL, NULL, 'osm', 'node/999', 'staged'),\n"), /scope: non-beach places changed/)
await red('2b an extra BEACH row smuggled in (not this file\'s pair)', variant('smuggle2', "VALUES\n", "VALUES\n  ('Smuggled Beach', '{\"en\":\"a\",\"tr\":\"b\",\"ar\":\"c\",\"ru\":\"d\",\"el\":\"e\",\"fr\":\"f\",\"es\":\"g\",\"de\":\"h\",\"fa\":\"i\"}'::jsonb, NULL, 'beach', 'kyrenia', NULL, 35.3, 33.3, NULL, NULL, 'osm', 'way/999', 'staged'),\n"), /scope: other beaches changed/)
await red('3 a café\'s status changed inside the transaction', variant('cafe', ANCHOR_INSERT_END, `${ANCHOR_INSERT_END}\nUPDATE public.places SET status = 'active' WHERE category = 'cafe' AND source = 'osm';`), /scope: non-beach places changed/)
await red('3b a live beach edited inside the transaction', variant('live', ANCHOR_INSERT_END, `${ANCHOR_INSERT_END}\nUPDATE public.places SET name = 'Renamed' WHERE category = 'beach' AND source IS NULL;`), /scope: other beaches changed/)
await red('4 a photo written onto a row of this file', variant('photo', ANCHOR_INSERT_END, `${ANCHOR_INSERT_END}\nUPDATE public.places SET cover_image_url = 'x.jpg' WHERE source_id = 'way/225386412';`), /carry a field this file never writes/)
await red('4b an OSM row given an access_type (the private_resort leak)', variant('access', ANCHOR_INSERT_END, `${ANCHOR_INSERT_END}\nUPDATE public.places SET access_type = 'private' WHERE source = 'osm' AND source_id = 'way/1484271058';`), /carry a field this file never writes/)
await red('5 a pair already taken by a non-beach row', FILE, /first apply found 1 of this file's pairs already taken/, SEED, d => d.exec("INSERT INTO public.places (category, name, region, status, source, source_id) VALUES ('cafe', 'Squatter', 'kyrenia', 'staged', 'osm', 'way/225386412')"))
const SQUAT = (status, name, cat = 'beach') => d => d.exec(`INSERT INTO public.places (category, name, region, status, source, source_id) VALUES ('${cat}', '${name}', 'kyrenia', '${status}', 'osm', 'way/225386412')`)
const LEDGER = f => d => d.exec(`INSERT INTO public.schema_migrations_applied (filename, checksum) VALUES ('${FILE.split('/').pop()}', 'x')`).then(() => f(d))
await red('5b first apply: an ACTIVE beach squats a pair under a wrong name', FILE, /first apply found 1 of this file's pairs already taken/, SEED, SQUAT('active', 'Somebody Else'))
await red('5c first apply: a STAGED beach squats a pair', FILE, /first apply found 1 of this file's pairs already taken/, SEED, SQUAT('staged', 'Bamboo Beach'))
await red('5d re-run (ledger row exists): a STAGED beach holding a pair under a wrong name', FILE, /1 of the 1 rows that held this file's pairs before are not this file's rows \(not a beach, or a staged row under another name\)/, SEED, LEDGER(SQUAT('staged', 'Somebody Else')))
await red('5e re-run (ledger row exists): a pair held by a non-beach row', FILE, /^.*1 of 30 rows are not category beach with status staged or active$/, SEED, LEDGER(SQUAT('staged', 'Bamboo Beach', 'cafe')))
await red('6 a policy that opens staged rows to everyone (still 9 policies, 5 + 4)', FILE, /another places policy mentions staged/, SEED, d => d.exec("DROP POLICY places_delete ON public.places; CREATE POLICY places_open_staged ON public.places FOR SELECT TO anon USING (status = 'staged')"))
await red('6a a policy added: count is wrong', FILE, /places has 10 policies/, SEED, d => d.exec("CREATE POLICY places_open_staged ON public.places FOR SELECT TO anon USING (status = 'staged')"))
await red('6b a tenth, unrelated policy', FILE, /places has 10 policies/, SEED, d => d.exec("CREATE POLICY places_extra ON public.places AS RESTRICTIVE FOR SELECT USING (true)"))
await red('7 a fifth INSERT trigger', FILE, /5 enabled INSERT triggers/, SEED, d => d.exec("CREATE FUNCTION public.t_ins() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$; CREATE TRIGGER t_ins BEFORE INSERT ON public.places FOR EACH ROW EXECUTE FUNCTION public.t_ins();"))
await red('7b an AFTER INSERT trigger that writes elsewhere', FILE, /5 enabled INSERT triggers \(1 not BEFORE ROW\)/, SEED, d => d.exec("CREATE FUNCTION public.t_after() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.content_reports VALUES ('x', gen_random_uuid(), NULL); RETURN NULL; END $$; CREATE TRIGGER t_after AFTER INSERT ON public.places FOR EACH ROW EXECUTE FUNCTION public.t_after();"))
await red('9 places_select rewritten to status <> pending (9 policies kept, no literal staged)', FILE, /anon can read \d+ of this file's staged rows/, SEED, d => d.exec(`DROP POLICY places_select ON public.places; CREATE POLICY places_select ON public.places FOR SELECT USING (status = 'active' OR status <> 'pending' OR submitted_by = auth.uid())`))
await red('9d places_select widened: any signed-in user (auth.uid() IS NOT NULL) reads non-pending rows', FILE, /signed-in user can read \d+ of this file's staged rows/, SEED, d => d.exec(`DROP POLICY places_select ON public.places; CREATE POLICY places_select ON public.places FOR SELECT USING (status = 'active' OR (auth.uid() IS NOT NULL AND status <> 'pending') OR submitted_by = auth.uid())`))
await red('9e places_select widened: only a guest (is_anonymous_session()) reads non-pending rows', FILE, /guest can read \d+ of this file's staged rows/, SEED, d => d.exec(`DROP POLICY places_select ON public.places; CREATE POLICY places_select ON public.places FOR SELECT USING (status = 'active' OR (is_anonymous_session() AND status <> 'pending') OR submitted_by = auth.uid())`))
await red('9f places_select widened: authenticated with no claims', FILE, /authenticated without claims can read \d+ of this file's staged rows/, SEED, d => d.exec(`DROP POLICY places_select ON public.places; CREATE POLICY places_select ON public.places FOR SELECT USING (status = 'active' OR (current_user = 'authenticated' AND status <> 'pending') OR submitted_by = auth.uid())`))
await red('9b is_previewer() replaced by SELECT true', FILE, /anon can read \d+ of this file's staged rows/, SEED, d => d.exec('CREATE OR REPLACE FUNCTION public.is_previewer() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$'))
await red('9c positive control: nobody can read active beaches', FILE, /positive control failed/, SEED, d => d.exec("DROP POLICY places_select ON public.places; CREATE POLICY places_select ON public.places FOR SELECT USING (status = 'active' AND false)"))
await red('8 a blocked term that matches a beach name (the word filter is live in the apply)', FILE, /BLOCKED_TERM/, SEED, d => d.exec("INSERT INTO public.blocked_terms (term) VALUES ('bamboo')"))

const all = await snap(db)
console.log(`beaches staged: OK (${ROWS.length} rows = 2 Ministry + 28 OSM; production anon/authenticated see 0 of them, Preview sees all 30; live beaches and staged shops byte-identical; second apply and a post-publish re-run pass; ${all.length} rows at the end; ${reds} reds fired)`)
