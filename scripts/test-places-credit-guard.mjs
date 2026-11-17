// 20261209_places_credit_guard.sql against a Supabase-shaped Postgres (scripts/migration-harness.mjs).
// Claims: (1) the migration applies on the real places table + the real triggers/policies of the repo (newest definition wins);
// (2) END TO END through RLS as roles: an owner (customer), an ADMIN and a guest cannot write photo_attribution / photo_credits on
//     INSERT or UPDATE (coerced, not raised), while an ordinary edit still lands; a no-session writer (postgres / service_role) can;
// (3) the same suite is RED against the pre-fix function (20261045's body), and the migration's own assertions go red when the new lines are cut.
// Limits: PGlite is PostgreSQL 18, prod is older; PostgREST/JWT verification are stubbed (auth.uid() reads request.jwt.claims as Supabase does);
// triggers/policies are extracted from the migrations, not read from prod (verify_schema.sql + the live catalogs are the authority).
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile as applyFile0, asRole as asRole0 } from './migration-harness.mjs'
const applyFile = (db, ...a) => applyFile0(db, ...a)
const asRole = async (db, ...a) => { const x = await asRole0(db, ...a); await db.exec("SELECT set_config('request.jwt.claims', '', false)"); return x }
process.on('uncaughtException', e => { console.error('FAIL:', String(e.message).slice(0, 900)); process.exit(1) })

const MIGDIR = 'supabase/migrations'
const MIGS = readdirSync(MIGDIR).filter(f => f.endsWith('.sql')).sort()
const FILE = `${MIGDIR}/${MIGS.filter(f => /^\d+_places_credit_guard\.sql$/.test(f)).pop()}`
const USER = '00000000-0000-0000-0000-0000000000a1'
const ADMIN = '00000000-0000-0000-0000-0000000000a2'
const GUEST = '00000000-0000-0000-0000-0000000000a3'

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
INSERT INTO auth.users VALUES ('${ADMIN}');
INSERT INTO public.profiles VALUES ('${ADMIN}', 'admin');
CREATE TABLE public.content_reports (content_type text, content_id uuid, reporter_id uuid);
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') $$;
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
-- a place owned by USER, seeded by the no-session path with starting credits
INSERT INTO public.places (id, category, name, region, status, submitted_by, photo_attribution, photo_credits)
 VALUES ('00000000-0000-0000-0000-00000000b001', 'monument', 'Owned', 'kyrenia', 'pending', '${USER}', '{"u0":{"credit":"seed"}}', ARRAY['seed']);
`
const PID = '00000000-0000-0000-0000-00000000b001'
const FORGED_A = `'{"u1":{"credit":"forged"}}'::jsonb`
const read = async (db, id = PID) => (await db.query('SELECT name, photo_attribution a, photo_credits c, source FROM public.places WHERE id = $1', [id])).rows[0]
const SEED_A = { u0: { credit: 'seed' } }
let n = 0
const ok = (cond, msg) => { assert.ok(cond, msg); n++; console.log('  ok  ' + msg) }

async function suite(db, label) {
  const fails = []
  const check = (cond, msg) => { if (!cond) fails.push(msg) }
  // session UPDATE: set, clear, ordinary edit — as owner, admin
  for (const [who, uid] of [['owner', USER], ['admin', ADMIN]]) {
    await db.exec(`UPDATE public.places SET photo_attribution = '{"u0":{"credit":"seed"}}', photo_credits = ARRAY['seed'] WHERE id = '${PID}'`)
    let r = await asRole(db, 'authenticated', uid, `UPDATE public.places SET photo_attribution = ${FORGED_A}, photo_credits = ARRAY['forged'] WHERE id = '${PID}'`)
    check(r.ok, `${who} set: statement raised (${r.msg}); must be coerced`)
    let row = await read(db)
    check(JSON.stringify(row.a) === JSON.stringify(SEED_A) && JSON.stringify(row.c) === '["seed"]', `${who} UPDATE set: read a=${JSON.stringify(row.a)} c=${JSON.stringify(row.c)}, expected the seed`)
    r = await asRole(db, 'authenticated', uid, `UPDATE public.places SET photo_attribution = NULL, photo_credits = NULL WHERE id = '${PID}'`)
    row = await read(db)
    check(JSON.stringify(row.a) === JSON.stringify(SEED_A) && JSON.stringify(row.c) === '["seed"]', `${who} UPDATE clear: read a=${JSON.stringify(row.a)} c=${JSON.stringify(row.c)}, expected the seed`)
    r = await asRole(db, 'authenticated', uid, `UPDATE public.places SET name = 'Renamed ${who}' WHERE id = '${PID}'`)
    row = await read(db)
    check(r.ok && row.name === `Renamed ${who}`, `${who} ordinary edit (positive control): ok=${r.ok} ${r.msg ?? ''} name=${row.name}`)
  }
  // session INSERT as owner, admin, guest
  for (const [who, uid] of [['owner', USER], ['admin', ADMIN]]) {
    const id = `00000000-0000-0000-0000-0000000c000${who === 'owner' ? 1 : 2}`
    const r = await asRole(db, 'authenticated', uid, `INSERT INTO public.places (id, category, name, region, submitted_by, status, photo_attribution, photo_credits, source, source_id) VALUES ('${id}', 'monument', 'Ins ${who}', 'kyrenia', '${uid}', 'pending', ${FORGED_A}, ARRAY['forged'], 'visitncy', 'zz-${who}')`)
    check(r.ok, `${who} INSERT raised (${r.msg})`)
    const row = await read(db, id)
    check(row && row.a === null && row.c === null && row.source === null, `${who} INSERT: read a=${JSON.stringify(row?.a)} c=${JSON.stringify(row?.c)} source=${row?.source}, expected null/null/null`)
  }
  // positive control: no-session (postgres) INSERT + UPDATE write both
  await db.exec("SELECT set_config('request.jwt.claims', '', false)")
  await db.exec(`INSERT INTO public.places (id, category, name, region, photo_attribution, photo_credits) VALUES ('00000000-0000-0000-0000-0000000c0009', 'monument', 'Svc', 'kyrenia', ${FORGED_A}, ARRAY['svc'])`)
  let row = await read(db, '00000000-0000-0000-0000-0000000c0009')
  check(JSON.stringify(row.c) === '["svc"]' && row.a?.u1?.credit === 'forged', `no-session INSERT (positive control): read ${JSON.stringify(row)}`)
  await db.exec(`UPDATE public.places SET photo_credits = ARRAY['svc2'], photo_attribution = '{"u2":{"credit":"x"}}' WHERE id = '00000000-0000-0000-0000-0000000c0009'`)
  row = await read(db, '00000000-0000-0000-0000-0000000c0009')
  check(JSON.stringify(row.c) === '["svc2"]' && row.a?.u2?.credit === 'x', `no-session UPDATE (positive control): read ${JSON.stringify(row)}`)
  // service_role role (BYPASSRLS), no session
  const sr = await asRole(db, 'service_role', null, `UPDATE public.places SET photo_credits = ARRAY['svc3'] WHERE id = '00000000-0000-0000-0000-0000000c0009' RETURNING photo_credits c`)
  check(sr.ok && JSON.stringify(sr.rows[0]?.c) === '["svc3"]', `service_role UPDATE (positive control): ${JSON.stringify(sr)}`)
  await db.exec("DELETE FROM public.places WHERE id::text LIKE '00000000-0000-0000-0000-0000000c%'")
  console.log(`  [${label}] ${fails.length} failure(s)`)
  return fails
}

// A. pre-fix: the function as of 20261045 must FAIL the suite (the break is real, the suite notices)
{
  const OLD_FN = grab('20261045_places_source.sql', 'CREATE OR REPLACE FUNCTION public.places_guard_source()', FN)
  const NEW_FN = fn('places_guard_source')
  assert.ok(SEED.includes(NEW_FN) && NEW_FN.includes('photo_credits') && !OLD_FN.includes('photo_credits'), 'fixture swap anchors')
  const db = await freshDb(SEED.replace(NEW_FN, OLD_FN))
  const fails = await suite(db, 'pre-fix')
  ok(fails.some(f => /UPDATE set/.test(f)) && fails.some(f => /INSERT:/.test(f)) && fails.some(f => /UPDATE clear/.test(f)), `pre-fix function is vulnerable: ${fails.length} failures incl. set, clear and insert`)
  ok(!fails.some(f => /positive control/.test(f)), 'pre-fix: the positive controls are green (denials are what fail)')
}
// B. the migration applies, then the suite is green
{
  const db = await freshDb(SEED)
  const r = await applyFile(db, FILE)
  ok(r.ok, `migration applies (${r.msg ?? 'in-migration assertions pass'})`)
  const fails = await suite(db, 'post-fix')
  assert.deepEqual(fails, [], fails.join('\n'))
  ok(true, 'post-fix: set / clear / insert denied for owner and admin; ordinary edit + no-session + service_role writes land')
  const trg = (await db.query("SELECT count(*)::int n FROM pg_trigger WHERE tgrelid='public.places'::regclass AND NOT tgisinternal AND (tgtype & 4) = 4")).rows[0].n
  ok(trg === 4, `INSERT-firing triggers on places unchanged by this file: ${trg} (20261207 asserts the count; no trigger added)`)
  const again = await applyFile(db, FILE)
  ok(again.ok === false && /schema_migrations_applied|duplicate|already/i.test(again.msg ?? '') || again.ok, `re-apply result: ${again.ok ? 'ok (idempotent)' : again.msg}`)
}
// C. the migration's own assertions go red when a new line is cut
{
  const text = readFileSync(FILE, 'utf8')
  const tmp = mkdtempSync(join(tmpdir(), 'credit-guard-'))
  for (const [name, anchor, rep] of [
    ['insert credits not nulled', "    new.photo_credits := null;\n", ''],
    ['update attribution not kept', "    new.photo_attribution := old.photo_attribution;\n", ''],
    ['update credits not kept', "    new.photo_credits := old.photo_credits;\n", ''],
  ]) {
    assert.equal(text.split(anchor).length, 2, `anchor unique: ${name}`)
    const f = join(tmp, 'v.sql'); writeFileSync(f, text.replace(anchor, rep))
    const db = await freshDb(SEED)
    const r = await applyFile(db, f)
    ok(r.ok === false && /places_guard_source body|lock is open/.test(r.msg ?? ''), `red variant "${name}" refused: ${r.msg}`)
  }
}
console.log(`\nALL ${n} CHECKS PASSED`)
