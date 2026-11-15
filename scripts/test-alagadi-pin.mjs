// 20261206 (Alagadi pin) against a Supabase-shaped Postgres (scripts/migration-harness.mjs).
// The claim under test: ONE places row changes, and only latitude/longitude. Re-run = no-op;
// a row at a third value aborts and keeps that value; a widened UPDATE or an extra trigger that
// touches another column makes the file abort. The five real UPDATE triggers on places are
// seeded VERBATIM from their migrations (extracted at run time), so "nothing else changed" is
// measured through them. PGlite is PG 18; prod is older (see the version note at the end).
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile, asRole } from './migration-harness.mjs'

const FILE = 'supabase/migrations/20261206_alagadi_pin.sql'
const ID = 'fa39492b-57e6-4ebd-b22c-89a9cf20ffe2'
const SUBMITTER = '11111111-2222-3333-4444-555555555555'

const grab = (file, start, ends) => {
  const t = readFileSync(`supabase/migrations/${file}`, 'utf8')
  const i = t.indexOf(start)
  assert.ok(i >= 0, `${file}: ${start} not found`)
  const hits = ends.map(e => [t.indexOf(e, i + start.length), e]).filter(([j]) => j >= 0).sort((a, b) => a[0] - b[0])
  assert.ok(hits.length, `${file}: end of ${start} not found`)
  return t.slice(i, hits[0][0] + hits[0][1].length)
}
const FN = ['$function$;', '$$;']
const trig = (file, start) => grab(file, start, [');'])

const SEED = `
CREATE TABLE public.profiles (id uuid PRIMARY KEY, role text);
CREATE TABLE public.content_reports (content_type text, content_id uuid, reporter_id uuid);
CREATE FUNCTION public.contains_blocked_term(t text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.contains_payment_solicitation(t text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE TABLE public.places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), category text NOT NULL, name text NOT NULL,
  name_i18n jsonb, description_i18n jsonb, region text NOT NULL,
  latitude double precision, longitude double precision, address text,
  status text NOT NULL DEFAULT 'pending', submitted_by uuid, provider_id uuid,
  hidden_at timestamptz, hidden_reason text, featured_until timestamptz, featured_requested_at timestamptz,
  source text, source_id text, official_visit jsonb, photos text[],
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
${grab('20260718_capture_3_functions.sql', 'CREATE OR REPLACE FUNCTION public.get_my_role()', FN)}
${grab('20260718_capture_3_functions.sql', 'CREATE OR REPLACE FUNCTION public.guard_moderation_columns()', FN)}
${grab('20260825_places_column_guards.sql', 'CREATE OR REPLACE FUNCTION public.places_guard_update()', FN)}
${grab('20261045_places_source.sql', 'CREATE OR REPLACE FUNCTION public.places_guard_source()', FN)}
${grab('20261155_places_official_visit.sql', 'CREATE OR REPLACE FUNCTION public.places_guard_official_visit()', FN)}
${grab('20260824_place_moderation.sql', 'CREATE OR REPLACE FUNCTION public.check_place_content()', FN)}
${trig('20260824_place_moderation.sql', 'CREATE TRIGGER guard_place_moderation')}
${trig('20260824_place_moderation.sql', 'CREATE TRIGGER check_place_content')}
${trig('20260825_places_column_guards.sql', 'CREATE TRIGGER places_guard_update')}
${trig('20261045_places_source.sql', 'CREATE OR REPLACE TRIGGER places_guard_source')}
${trig('20261155_places_official_visit.sql', 'CREATE OR REPLACE TRIGGER places_guard_official_visit')}
INSERT INTO public.places (id, category, name, name_i18n, description_i18n, region, latitude, longitude, address, status,
                           submitted_by, hidden_reason, source, source_id, official_visit, photos, created_at, updated_at) VALUES
 ('${ID}', 'beach', 'Alagadi Turtle Beach', '{"en":"Alagadi Turtle Beach","tr":"Alagadı Kaplumbağa Plajı"}', '{"en":"d"}', 'kyrenia',
   35.3302, 33.4972, NULL, 'active', '${SUBMITTER}', NULL, NULL, NULL, NULL, ARRAY['p1.jpg'], '2026-06-25T19:06:08Z', '2026-06-25T19:06:08Z'),
 ('00000000-0000-0000-0000-0000000000b1', 'beach', 'Escape Beach', NULL, NULL, 'kyrenia', 35.3471, 33.2343, 'a', 'active', NULL, NULL, NULL, NULL, NULL, NULL, now(), now()),
 ('00000000-0000-0000-0000-0000000000b2', 'beach', 'Golden Beach', NULL, NULL, 'karpaz', 35.6412, 34.5423, 'b', 'active', NULL, NULL, NULL, NULL, NULL, NULL, now(), now()),
 ('00000000-0000-0000-0000-0000000000b3', 'beach', 'Glapsides Beach', NULL, NULL, 'famagusta', 35.1541, 33.9129, 'c', 'active', NULL, NULL, NULL, NULL, NULL, NULL, now(), now());
`
const snap = async (db, where = '') => (await db.query(`SELECT to_jsonb(p) j FROM public.places p ${where} ORDER BY id`)).rows.map(r => r.j)
const pin = async db => (await db.query(`SELECT latitude, longitude FROM public.places WHERE id='${ID}'`)).rows[0]
const undo = db => db.exec('ROLLBACK; RESET ROLE;')   // a refusal aborts inside BEGIN, as on the real database
const strip = o => { const { latitude, longitude, ...rest } = o; return rest }

// ── the happy path ──────────────────────────────────────────────────────────
let db = await freshDb(SEED)
const before = await snap(db)
assert.equal(before.length, 4)
// positive control: the seeded guards are live (a signed-in non-admin cannot change status)
await db.exec(`INSERT INTO public.profiles VALUES ('${SUBMITTER}', 'customer')`)
let c = await asRole(db, 'authenticated', SUBMITTER, `UPDATE public.places SET status='pending' WHERE id='${ID}'`)
assert.equal(c.ok, false); assert.match(c.msg, /status is admin-only/, 'guards are live in the fixture')
assert.deepEqual(await snap(db), before, 'positive control changed nothing')

let r = await applyFile(db, FILE)
assert.ok(r.ok, `apply: ${r.msg}`)
assert.deepEqual(await pin(db), { latitude: 35.332504, longitude: 33.48512 })
const after = await snap(db)
for (let i = 0; i < 4; i++) {
  if (before[i].id === ID) assert.deepEqual(strip(after[i]), strip(before[i]), 'every other column of the Alagadi row identical')
  else assert.deepEqual(after[i], before[i], 'other beach rows byte-identical')
}
assert.equal((await db.query("SELECT count(*)::int n FROM public.schema_migrations_applied WHERE filename = '20261206_alagadi_pin.sql'")).rows[0].n, 1, 'the file stamps itself in the same transaction')

// ── re-run: no-op ───────────────────────────────────────────────────────────
r = await applyFile(db, FILE)
assert.ok(r.ok, `rerun: ${r.msg}`)
assert.deepEqual(await snap(db), after, 're-run changes nothing')

// ── third value: aborts, row keeps it ───────────────────────────────────────
await db.exec(`UPDATE public.places SET latitude = 35.1, longitude = 33.1 WHERE id='${ID}'`)
const third = await snap(db)
r = await applyFile(db, FILE); await undo(db)
assert.equal(r.ok, false); assert.match(r.msg, /neither the old .* nor the new/, r.msg)
assert.match(r.msg, /35\.1 , 33\.1/, 'names what it found')
assert.deepEqual(await snap(db), third, 'third value kept, nothing else touched')

// ── RED 1: a trigger that touches another column (updated_at) → abort naming the KEY only ──
db = await freshDb(SEED + `
CREATE FUNCTION public.t_touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now() + interval '1 second'; NEW.address := 'x${SUBMITTER}'; RETURN NEW; END $$;
CREATE TRIGGER t_touch BEFORE UPDATE ON public.places FOR EACH ROW EXECUTE FUNCTION public.t_touch();`)
const b2 = await snap(db)
r = await applyFile(db, FILE); await undo(db)
console.log('RED 1 (hostile trigger):', r.msg)
assert.equal(r.ok, false); assert.match(r.msg, /another column .* changed \(keys: address, updated_at\)/)
assert.ok(!r.msg.includes(SUBMITTER), 'failure message never prints a row value')
assert.deepEqual(await snap(db), b2, 'aborted: nothing applied')

// ── RED 2: a widened UPDATE (temp copy; the anchor must exist) → ROW_COUNT assertion fires ──
const text = readFileSync(FILE, 'utf8')
const anchor = 'WHERE id = c_id AND latitude = c_old_lat AND longitude = c_old_lng;'
assert.ok(text.includes(anchor), 'anchor present in the migration')
const tmp = join(mkdtempSync(join(tmpdir(), 'alagadi-')), 'widened.sql')
writeFileSync(tmp, text.replace(anchor, 'WHERE category = \'beach\';'))
db = await freshDb(SEED)
const b3 = await snap(db)
r = await applyFile(db, tmp); await undo(db)
console.log('RED 2 (widened WHERE):', r.msg)
assert.equal(r.ok, false); assert.match(r.msg, /exactly 1 places row, updated 4/)
assert.deepEqual(await snap(db), b3, 'aborted: nothing applied')

// ── RED 3: a wrong seeded "old" value is not silently overwritten ───────────
db = await freshDb(SEED)
await db.exec(`UPDATE public.places SET latitude = 35.3303 WHERE id='${ID}'`)
const b4 = await snap(db)
r = await applyFile(db, FILE); await undo(db)
console.log('RED 3 (wrong old value):', r.msg)
assert.equal(r.ok, false); assert.deepEqual(await snap(db), b4)

console.log('alagadi pin: OK (moves 1 row / 2 columns through the 5 real UPDATE triggers; re-run no-op; third value aborts; widened WHERE and a column-touching trigger both abort)')
