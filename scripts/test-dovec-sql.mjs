// 20261229 (dovec_projects) against the PGlite harness (PostgreSQL 18; prod is older, see supabase/CLAUDE.md).
// Seeds: auth.users, profiles (cascading from auth.users, as in prod), is_admin(). Says nothing about PostgREST or the real
// profiles table's other triggers. The migration's own DO blocks are the policy assertions; this file adds what they cannot:
// account deletion through the cascade, and red-first mutants proving the assertions can fail.
// Not wired into CI, like its siblings: run by hand (`npm run dovec:test` runs it).
//
//   node scripts/test-dovec-sql.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile, asRole } from './migration-harness.mjs'

const FILE = fileURLToPath(new URL('../supabase/migrations/20261229_dovec_projects.sql', import.meta.url))
const GATE = fileURLToPath(new URL('../supabase/migrations/20261231_dovec_read_gate.sql', import.meta.url))
const SQL = readFileSync(FILE, 'utf8')
const ADMIN = '00000000-0000-4000-8000-000000000001', CUSTOMER = '00000000-0000-4000-8000-000000000002'
const SVC = '00000000-0000-4000-8000-0000000000f1'   // service_role calls carry a role claim, as PostgREST does
const OTHER = '00000000-0000-4000-8000-000000000003'
const GUEST = '00000000-0000-4000-8000-000000000004'
// A guest is an authenticated JWT with is_anonymous: true. asRole() cannot set that claim, so this sets the same claims
// string PostgREST would hand over and prints it, so the test names the claim it really ran with.
const GUEST_CLAIMS = JSON.stringify({ sub: GUEST, role: 'authenticated', is_anonymous: true })
async function asGuest(db, sql) {
  await db.exec('RESET ROLE;')
  await db.query("SELECT set_config('request.jwt.claims', $1, false)", [GUEST_CLAIMS])
  await db.exec('SET ROLE authenticated;')
  try { return { ok: true, rows: (await db.query(sql)).rows } }
  catch (e) { return { ok: false, msg: String(e.message || e).split('\n')[0] } }
  finally { await db.exec('RESET ROLE;') }
}

const MODS18 = ['accommodation','events','explore','garages','grooming','homeServices','hotels','insurance','jobs','pets','studentHub','towing','transport','ehliyet','connectivity','eatery','cars','news']
const CE = (mods = MODS18) => `
CREATE TABLE public.contact_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), module text NOT NULL, entity_id uuid NOT NULL, action text NOT NULL,
  region text, lang text, item_id text, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_events_module_check CHECK (module IN (${mods.map(m => `'${m}'`).join(',')})),
  CONSTRAINT contact_events_action_check CHECK (action IN ('call','whatsapp','call_secondary','website')));
ALTER TABLE public.contact_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contact_events FROM PUBLIC, anon, authenticated;
GRANT INSERT (id, module, entity_id, action, region, item_id, lang) ON public.contact_events TO anon, authenticated;
CREATE POLICY ce_insert_public ON public.contact_events FOR INSERT TO anon, authenticated WITH CHECK (true);
`
const FIXTURE = CE() + `
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, role text NOT NULL DEFAULT 'customer');
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $f$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$f$;
-- auth.role() is not in the shared harness: stand-in = the JWT role claim, as in Supabase.
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
$f$;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $f$;
GRANT EXECUTE ON FUNCTION auth.jwt() TO anon, authenticated, service_role;
CREATE FUNCTION public.is_anonymous_session() RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) $f$;
INSERT INTO auth.users (id) VALUES ('${ADMIN}'), ('${CUSTOMER}'), ('${OTHER}');
INSERT INTO public.profiles (id, role) VALUES ('${ADMIN}', 'admin'), ('${CUSTOMER}', 'customer'), ('${OTHER}', 'customer');
`


const LU = '00000000-0000-4000-8000-0000000000b1', LV = '00000000-0000-4000-8000-0000000000b2', LW = '00000000-0000-4000-8000-0000000000b3'
const ins = (user, extra = {}) => {
  const cols = { client_request_id: 'gen_random_uuid()', payload_hash: "repeat('d', 64)", project_id: "'p1'", name: "'Probe Person'", phone: "'+441234567890'",
    language: "'English'", language_code: "'en'", consent: 'true', consent_text_version: "'v'", status: "'sent'", user_id: user ? `'${user}'` : 'NULL', ...extra }
  return `INSERT INTO public.dovec_leads (${Object.keys(cols).join(',')}) VALUES (${Object.values(cols).join(',')})`
}
async function limitChecks(d) {
  await d.exec(`DELETE FROM public.dovec_leads`)
  const svc = sql => asRole(d, 'service_role', SVC, sql)
  const first = []
  for (let i = 0; i < 4; i++) first.push((await svc(ins(LU))).ok)
  t('limit: 3 an hour per user, the 4th insert is refused', first, [true, true, true, false])
  t('limit: the refusal is the limit trigger', /dovec_rate_limited/.test((await svc(ins(LU))).msg || ''), true)
  t('limit: nothing was stored by the refusal', (await d.query(`SELECT count(*)::int n FROM public.dovec_leads WHERE user_id = '${LU}'`)).rows[0].n, 3)
  t('limit: another user is accepted (positive control)', (await svc(ins(LV))).ok, true)
  const code = await d.query(ins(LU)).then(() => null, e => e.code ?? e.sqlState ?? null)
  t('limit: SQLSTATE is DV429 (what the edge function maps to 429)', code, 'DV429')
  t('limit: trigger function takes the advisory lock', /pg_advisory_xact_lock/.test((await d.query(`SELECT pg_get_functiondef('public.dovec_leads_enforce_limits()'::regprocedure) AS d`)).rows[0].d), true)
  t('limit: an app role cannot execute the trigger function', [(await asRole(d, 'authenticated', LU, `SELECT public.dovec_leads_enforce_limits()`)).ok, (await asRole(d, 'anon', null, `SELECT public.dovec_leads_enforce_limits()`)).ok], [false, false])
  // day limit: 10 in the last day, none in the last hour
  const old = (n, ago) => Array.from({ length: n }, () => ins(LW, { created_at: `now() - interval '${ago}'` })).join(';\n')
  await d.exec(old(10, '5 hours'))
  t('limit: 10 a day per user (older than an hour): the 11th is refused', (await svc(ins(LW))).ok, false)
  await d.exec(`DELETE FROM public.dovec_leads WHERE user_id = '${LW}'`)
  await d.exec(old(10, '2 days'))
  t('limit: rows older than a day do not count (positive control)', (await svc(ins(LW))).ok, true)
  // global: fill to 200 in the last day with wiped (user_id NULL) rows
  await d.exec(`DELETE FROM public.dovec_leads`)
  await d.exec(`INSERT INTO public.dovec_leads (client_request_id, payload_hash, project_id, name, phone, language, language_code, consent, consent_text_version, status)
    SELECT gen_random_uuid(), repeat('e', 64), 'p1', 'x', '+441234567890', 'English', 'en', true, 'v', 'sent' FROM generate_series(1, 199)`)
  t('limit: the 200th lead of the day is accepted', (await svc(ins(LU))).ok, true)
  t('limit: the 201st is refused for everyone', [(await svc(ins(LV))).ok, /dovec_rate_limited/.test((await svc(ins(LV))).msg || '')], [false, true])
  await d.exec(`DELETE FROM public.dovec_leads WHERE id = (SELECT min(id) FROM public.dovec_leads)`)
  t('limit: one slot freed, accepted again (positive control)', (await svc(ins(LV))).ok, true)

  // 7-day settle in the wipe function
  await d.exec(`DELETE FROM public.dovec_leads`)
  await d.exec([ins(LU, { status: "'retry'", created_at: "now() - interval '8 days'", next_attempt_at: "now() + interval '1 hour'" }),
    ins(LV, { status: "'pending'", created_at: "now() - interval '8 days'" }),
    ins(LW, { status: "'retry'", created_at: "now() - interval '2 days'", next_attempt_at: "now() + interval '1 hour'" }),
    ins(LU, { status: "'retry'", created_at: "now() - interval '91 days'" })].join(';\n'))
  const w = await asRole(d, 'service_role', null, `SELECT public.dovec_leads_wipe_pii() AS n`)
  t('wipe: runs as service_role and returns the wiped count', [w.ok, w.rows?.[0]?.n], [true, 1])
  t('wipe: retry/pending older than 7 days are failed, the 2-day retry is untouched',
    (await d.query(`SELECT status, next_attempt_at IS NULL AS na, name IS NULL AS wiped FROM public.dovec_leads ORDER BY created_at`)).rows,
    [{ status: 'failed', na: true, wiped: true }, { status: 'failed', na: true, wiped: false }, { status: 'failed', na: true, wiped: false }, { status: 'retry', na: false, wiped: false }])
  await d.exec(`DELETE FROM public.dovec_leads; ${ins(null)}`)   // leave one row for the admin-counts check below
}

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
const ready = async (file = FILE) => {
  const d = await freshDb(FIXTURE)
  const r = await applyFile(d, file)
  if (file === FILE && r.ok) { const g = await applyFile(d, GATE); if (!g.ok) return { d, r: g } }
  return { d, r }
}
const mutant = (from, to) => {
  if (!SQL.includes(from)) { bad++; console.log(`  ✗ mutant anchor missing: ${from.slice(0, 50)}`); return null }
  const p = join(mkdtempSync(join(tmpdir(), 'dovec-')), 'm.sql')
  writeFileSync(p, SQL.replace(from, () => to))
  return p
}

console.log('20261229 — real file')
{
  const { d, r } = await ready()
  t('applies, including its own assertions', r, { ok: true, msg: null })
  if (!r.ok) { console.log(r.msg); process.exit(1) }

  // contact_events 'dovec' + entity_uuid
  {
    const dd = (await d.query(`SELECT column_default AS def, is_nullable AS nul, data_type AS ty FROM information_schema.columns WHERE table_name = 'dovec_projects' AND column_name = 'entity_uuid'`)).rows
    t('entity_uuid: uuid, NOT NULL, default gen_random_uuid()', dd, [{ def: 'gen_random_uuid()', nul: 'NO', ty: 'uuid' }])
    t('entity_uuid is UNIQUE (named constraint)', (await d.query(`SELECT contype FROM pg_constraint WHERE conname = 'dovec_projects_entity_uuid_key'`)).rows, [{ contype: 'u' }])
    await d.exec(`INSERT INTO public.dovec_projects (id, name, city, status, website_url) VALUES ('e1', 'E One', 'Town', 'on_sale', 'https://example.com/e1'), ('e2', 'E Two', 'Town', 'on_sale', 'https://example.com/e2')`)
    const u1 = (await d.query(`SELECT id, entity_uuid FROM public.dovec_projects WHERE id IN ('e1','e2') ORDER BY id`)).rows
    t('two projects get two different uuids', [u1.length, u1[0].entity_uuid !== u1[1].entity_uuid], [2, true])
    const upsert = `INSERT INTO public.dovec_projects (id, name, city, status, website_url, listed, delisted_at, last_seen_at, updated_at)
      VALUES ('e1', 'E One v2', 'Town', 'on_sale', 'https://example.com/e1', true, NULL, now(), now()), ('e2', 'E Two v2', 'Town', 'on_sale', 'https://example.com/e2', true, NULL, now(), now())
      ON CONFLICT (id) DO UPDATE SET name = excluded.name, city = excluded.city, status = excluded.status, website_url = excluded.website_url,
        listed = excluded.listed, delisted_at = excluded.delisted_at, last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at`
    for (let i = 0; i < 2; i++) { const r = await asRole(d, 'service_role', null, upsert); if (!r.ok) t('service_role upsert runs', r.msg, 'ok') }
    t('sync-style upsert (run twice) keeps entity_uuid stable and does update the row',
      (await d.query(`SELECT id, name, entity_uuid FROM public.dovec_projects WHERE id IN ('e1','e2') ORDER BY id`)).rows,
      u1.map((r, i) => ({ id: r.id, name: i ? 'E Two v2' : 'E One v2', entity_uuid: r.entity_uuid })))
    t('the sync sources never name entity_uuid',
      ['../supabase/functions/sync-dovec/index.ts', '../supabase/functions/_shared/dovec-feed.mjs'].map(f => /entity_uuid/.test(readFileSync(new URL(f, import.meta.url), 'utf8'))), [false, false])
    await d.exec(`UPDATE public.dovec_settings SET published = true`)
    t('anon sees no project before the first good sync', (await asRole(d, 'anon', null, `SELECT entity_uuid FROM public.dovec_projects WHERE id = 'e1'`)).rows.length, 0)
    await d.exec(`UPDATE public.dovec_settings SET last_good_sync_at = now()`)
    t('anon reads entity_uuid once the feed is fresh', (await asRole(d, 'anon', null, `SELECT entity_uuid FROM public.dovec_projects WHERE id = 'e1'`)).rows, [{ entity_uuid: u1[0].entity_uuid }])
    const tap = (m, who = 'anon') => asRole(d, who, who === 'anon' ? null : OTHER, `INSERT INTO public.contact_events (module, entity_id, action, lang) VALUES ('${m}', '${u1[0].entity_uuid}', 'whatsapp', 'Turkish')`)
    t("contact_events accepts module 'dovec' / whatsapp as anon", (await tap('dovec')).ok, true)
    t("... and as an authenticated user", (await tap('dovec', 'authenticated')).ok, true)
    t('an unknown module is still refused (negative control)', (await tap('not_a_real_module')).ok, false)
    t("an existing module is still accepted (positive control)", (await tap('news')).ok, true)
    t('anon cannot read contact_events back', (await asRole(d, 'anon', null, `SELECT 1 FROM public.contact_events`)).ok, false)
    t('the taps are stored for that project', (await d.query(`SELECT count(*)::int n FROM public.contact_events WHERE module = 'dovec' AND entity_id = '${u1[0].entity_uuid}'`)).rows[0].n, 2)
    const def = (await d.query(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'contact_events_module_check'`)).rows[0].d
    t('module CHECK now lists 19 modules', [...new Set([...def.matchAll(/'([A-Za-z]+)'::text/g)].map(m => m[1]))].length, 19)
    await d.exec(`DELETE FROM public.contact_events; DELETE FROM public.dovec_projects WHERE id IN ('e1','e2'); UPDATE public.dovec_settings SET last_good_sync_at = NULL, published = false`)
    t('re-applying the file is clean (re-runnable pre-state, now 19 modules)', (await applyFile(d, FILE)).ok, true)
    t('re-applying the read gate is clean', (await applyFile(d, GATE)).ok, true)
    await d.exec('RESET ROLE;')
  }

  const proj = await d.query(`SELECT count(*)::int AS n FROM public.dovec_projects`)
  t('probe left no project behind', proj.rows[0].n, 0)
  t('settings: one row, published false, never synced',
    (await d.query(`SELECT count(*)::int n, bool_or(published) p, bool_or(last_good_sync_at IS NOT NULL) s FROM public.dovec_settings`)).rows[0], { n: 1, p: false, s: false })
  t('a second settings row is refused', (await d.query(`INSERT INTO public.dovec_settings (id) VALUES (2)`).catch(e => ({ err: /dovec_settings_single_row/.test(e.message) }))).err, true)

  // verify_schema.sql registrations: every name registered for this migration exists in the applied catalogs, and the H tokens hold.
  {
    const vs = readFileSync(new URL('../supabase/verify_schema.sql', import.meta.url), 'utf8')
    const two = [...vs.matchAll(/\('20261229_dovec_projects','([a-z0-9_]+)'\)/g)].map(m => m[1])
    const three = [...vs.matchAll(/\('20261229_dovec_projects','([a-z0-9_]+)','([a-z0-9_]+)'\)/g)].map(m => [m[1], m[2]])
    const names = (await d.query(`
      SELECT relname AS n FROM pg_class WHERE relnamespace = 'public'::regnamespace
      UNION SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace
      UNION SELECT tgname FROM pg_trigger WHERE NOT tgisinternal
      UNION SELECT conname FROM pg_constraint WHERE connamespace = 'public'::regnamespace`)).rows.map(r => r.n)
    t('registered A/C/D/E/F/G names found', two.filter(n => !names.includes(n)), [])
    t('registered names are a real list', two.length >= 40, true)
    const cols = new Set((await d.query(`SELECT table_name || '.' || column_name AS c FROM information_schema.columns WHERE table_schema = 'public'`)).rows.map(r => r.c))
    t('registered B columns found', three.filter(([tb, c]) => !cols.has(`${tb}.${c}`)), [])
    t('every real column is registered (no unregistered column)',
      [...cols].filter(c => c.startsWith('dovec_') && !three.some(([tb, col]) => `${tb}.${col}` === c)), [])
    const h = vs.slice(vs.indexOf('-- 1229-BEGIN'), vs.indexOf('-- 1229-END'))
    const tok = await d.query(`SELECT 'x'::text AS m, 'x'::text AS o, true AS ok WHERE false ${h}`).then(r => r.rows, e => ({ err: e.message }))
    t('H tokens run and are all true', Array.isArray(tok) ? [tok.length, tok.every(r => r.ok === true)] : tok, [6, true])
    const bad2 = await d.query(`GRANT DELETE ON public.dovec_leads TO service_role`).then(async () =>
      (await d.query(`SELECT 'x'::text AS m, 'x'::text AS o, true AS ok WHERE false ${h}`)).rows.filter(r => r.ok !== true).length)
    t('red-first: a DELETE grant on leads turns an H token red', bad2, 1)
    await d.query(`REVOKE DELETE ON public.dovec_leads FROM service_role`)
  }

  // Account deletion: the whole point of "no FK + AFTER DELETE trigger".
  await d.exec(`
    INSERT INTO public.dovec_settings AS s (id) VALUES (1) ON CONFLICT (id) DO UPDATE SET last_good_sync_at = now();
    INSERT INTO public.dovec_projects (id, name, city, status, website_url) VALUES ('p1', 'Fictional Heights', 'Testville', 'on_sale', 'https://example.com/p1');
    INSERT INTO public.dovec_leads (user_id, client_request_id, payload_hash, project_id, name, phone, email, message, language, language_code, consent, consent_text_version, status) VALUES
      ('${CUSTOMER}', '00000000-0000-4000-8000-0000000000a1', repeat('a', 64), 'p1', 'Alice Test', '+441234567890', 'a@example.com', 'hello', 'English', 'en', true, 'v', 'sent'),
      ('${CUSTOMER}', '00000000-0000-4000-8000-0000000000a2', repeat('b', 64), 'p1', 'Alice Test', '+441234567890', NULL, NULL, 'English', 'en', true, 'v', 'pending'),
      ('${OTHER}',    '00000000-0000-4000-8000-0000000000a3', repeat('c', 64), 'p1', 'Bob Test',   '+441234567891', NULL, NULL, 'English', 'en', true, 'v', 'sent');
  `)
  const del = await d.query(`DELETE FROM auth.users WHERE id = '${CUSTOMER}'`).then(() => 'deleted', e => e.message)
  t('deleting the auth user succeeds (cascade to profiles, trigger runs)', del, 'deleted')
  const rows = (await d.query(`SELECT status, user_id IS NULL AS uid_null, name IS NULL AS name_null, phone IS NULL AS phone_null, email IS NULL AS email_null, message IS NULL AS msg_null, pii_wiped_at IS NOT NULL AS wiped FROM public.dovec_leads WHERE project_id = 'p1' AND name IS NULL ORDER BY client_request_id`)).rows
  t('the deleted user keeps two rows, wiped; the pending one is failed',
    rows, [
      { status: 'sent', uid_null: true, name_null: true, phone_null: true, email_null: true, msg_null: true, wiped: true },
      { status: 'failed', uid_null: true, name_null: true, phone_null: true, email_null: true, msg_null: true, wiped: true }])
  t("another user's lead is untouched",
    (await d.query(`SELECT name, user_id FROM public.dovec_leads WHERE client_request_id = '00000000-0000-4000-8000-0000000000a3'`)).rows, [{ name: 'Bob Test', user_id: OTHER }])
  t('delete_own_account-style delete of the profile alone also succeeds',
    await d.query(`DELETE FROM public.profiles WHERE id = '${OTHER}'`).then(() => 'deleted', e => e.message), 'deleted')
  t('and wipes that user too', (await d.query(`SELECT count(*)::int n FROM public.dovec_leads WHERE name IS NOT NULL`)).rows[0].n, 0)

  // Atomic enquiry limits (BEFORE INSERT trigger) and the 7-day settle in the wipe function.
  await limitChecks(d)

  // Reads as the app roles, with controls.
  const ALL = `SELECT count(*)::int n FROM public.dovec_projects`
  const nOf = async (who, uid) => (await asRole(d, who, uid, ALL)).rows[0].n
  await d.exec(`UPDATE public.dovec_settings SET published = false, suspended = false`)
  t('unpublished + fresh: anon / guest / customer read 0 rows, admin reads the row',
    [await nOf('anon', null), (await asGuest(d, ALL)).rows[0].n, await nOf('authenticated', CUSTOMER), await nOf('authenticated', ADMIN)], [0, 0, 0, 1])
  await d.exec(`UPDATE public.dovec_settings SET published = true`)
  t('published + fresh: anon / customer / admin read the row (positive control)',
    [await nOf('anon', null), await nOf('authenticated', CUSTOMER), await nOf('authenticated', ADMIN)], [1, 1, 1])
  await d.exec(`UPDATE public.dovec_settings SET suspended = true`)
  t('published + suspended: anon / customer read 0, admin still reads', [await nOf('anon', null), await nOf('authenticated', CUSTOMER), await nOf('authenticated', ADMIN)], [0, 0, 1])
  await d.exec(`UPDATE public.dovec_settings SET suspended = false, last_good_sync_at = now() - interval '25 hours'`)
  t('published + stale: anon / customer read 0, admin still reads', [await nOf('anon', null), await nOf('authenticated', CUSTOMER), await nOf('authenticated', ADMIN)], [0, 0, 1])
  await d.exec(`UPDATE public.dovec_settings SET last_good_sync_at = now()`)
  t('fresh again: anon reads the row (positive control)', await nOf('anon', null), 1)
  await d.exec(`UPDATE public.dovec_settings SET published = false`)
  t('guest/customer reads settings: only the five columns',
    (await asRole(d, 'authenticated', OTHER, `SELECT published, suspended, whatsapp_e164, last_good_sync_at IS NOT NULL AS synced FROM public.dovec_settings`)).rows,
    [{ published: false, suspended: false, whatsapp_e164: '+905338880515', synced: true }])
  t('run-status columns are not readable by an app role',
    (await asRole(d, 'authenticated', OTHER, `SELECT last_run_detail FROM public.dovec_settings`)).ok, false)
  t('leads are unreadable to anon', (await asRole(d, 'anon', null, `SELECT 1 FROM public.dovec_leads`)).ok, false)
  t('leads are unreadable to a signed-in user', (await asRole(d, 'authenticated', ADMIN, `SELECT 1 FROM public.dovec_leads`)).ok, false)
  t('leads are readable to service_role (positive control)', (await asRole(d, 'service_role', null, `SELECT count(*)::int n FROM public.dovec_leads`)).ok, true)
  {
    const claims = (await asGuest(d, `SELECT current_setting('request.jwt.claims') AS c, public.is_anonymous_session() AS g`)).rows[0]
    t('the guest helper really runs with the is_anonymous claim', [JSON.parse(claims.c).is_anonymous, claims.g], [true, true])
    console.log(`    guest claims: ${claims.c}`)
    const plain = (await asRole(d, 'authenticated', CUSTOMER, `SELECT public.is_anonymous_session() AS g`)).rows[0].g
    t('positive control: a plain customer JWT is NOT a guest', plain, false)
    const sel = `SELECT 1 FROM public.dovec_leads`
    const denies = { anon: await asRole(d, 'anon', null, sel), guest: await asGuest(d, sel), customer: await asRole(d, 'authenticated', CUSTOMER, sel) }
    t('dovec_leads SELECT: anon, guest and customer are all denied', Object.values(denies).map(r => [r.ok, /permission denied/.test(r.msg || '')]), [[false, true], [false, true], [false, true]])
    console.log(`    SELECT denied with: ${Object.entries(denies).map(([k, r]) => `${k}="${r.msg}"`).join(' | ')}`)
    const insDenies = { anon: await asRole(d, 'anon', null, ins(null)), guest: await asGuest(d, ins(GUEST)), customer: await asRole(d, 'authenticated', CUSTOMER, ins(CUSTOMER)) }
    t('dovec_leads INSERT: anon, guest and customer are all denied', Object.values(insDenies).map(r => [r.ok, /permission denied/.test(r.msg || '')]), [[false, true], [false, true], [false, true]])
    console.log(`    INSERT denied with: ${Object.entries(insDenies).map(([k, r]) => `${k}="${r.msg}"`).join(' | ')}`)
    const pos = await asRole(d, 'service_role', SVC, ins(null, { name: "'T11 Probe'" }))
    t('positive control: service_role can INSERT, then SELECT the row', [pos.ok, (await asRole(d, 'service_role', SVC, `SELECT count(*)::int n FROM public.dovec_leads WHERE name = 'T11 Probe'`)).rows[0].n], [true, 1])
    await d.exec(`DELETE FROM public.dovec_leads WHERE name = 'T11 Probe'`)
  }
  await d.exec(`UPDATE public.dovec_settings SET last_good_sync_at = now() - interval '25 hours'`)
  t('25 h after the last good sync the project is gone for anon', (await asRole(d, 'anon', null, `SELECT count(*)::int n FROM public.dovec_projects`)).rows[0].n, 0)
  t('counts: a customer is refused', (await asRole(d, 'authenticated', OTHER, `SELECT * FROM public.dovec_lead_counts()`)).msg, 'ADMIN_ONLY')
  t('counts: anon has no EXECUTE', /permission denied/.test((await asRole(d, 'anon', null, `SELECT * FROM public.dovec_lead_counts()`)).msg), true)
  const c = await asRole(d, 'authenticated', ADMIN, `SELECT * FROM public.dovec_lead_counts()`)
  t('counts: admin gets counts and no personal column', [c.ok, Object.keys(c.rows[0] || {}).sort()], [true, ['month', 'n', 'project_id', 'project_name', 'status']])
}


console.log('20261229 — map pins (dovec_project_coords) and the single test enquiry')
const PIN = { 'D-Point': [35.2695453, 33.901635], Natulux: [35.3632832, 33.6722565] }
const svcq = (d, sql) => asRole(d, 'service_role', SVC, sql)
const addP = (id, name, extra = '') => `INSERT INTO public.dovec_projects (id, name, city, status, website_url${extra ? ', ' + extra.split('=')[0] : ''}) VALUES ('${id}', '${name}', 'Testville', 'on_sale', 'https://example.com/${id}'${extra ? ', ' + extra.split('=')[1] : ''})`
const stat = async (d) => Object.fromEntries((await d.query(`SELECT seed_name, last_status, project_id FROM public.dovec_project_coords ORDER BY 1`)).rows.map(r => [r.seed_name, [r.last_status, r.project_id]]))
const pinOf = async (d, id) => (await d.query(`SELECT latitude::float8 la, longitude::float8 lo FROM public.dovec_projects WHERE id = '${id}'`)).rows[0]
{
  const { d, r } = await ready()
  if (!r.ok) { console.log(r.msg); process.exit(1) }
  const seeds = (await d.query(`SELECT seed_name, latitude::float8 la, longitude::float8 lo FROM public.dovec_project_coords ORDER BY 1`)).rows
  t('seeds: exactly the five agreed pins', seeds.map(x => [x.seed_name, x.la, x.lo]), [
    ['Courtyard Platinum', 35.3261494, 33.9589785], ['D-Point', 35.2695453, 33.901635], ['Long Beach Panorama', 35.2572, 33.8945],
    ['Natulux', 35.3632832, 33.6722565], ['Querencia Long Beach', 35.2656637, 33.9091918]])
  t('settings: the WhatsApp line is the agreed one', (await d.query(`SELECT whatsapp_e164 w FROM public.dovec_settings`)).rows[0].w, '+905338880515')

  // near-misses never attach (no trim, no case folding)
  await d.exec([addP('n1', 'D-point'), addP('n2', 'D-Point '), addP('n3', ' D-Point'), addP('n4', 'natulux')].join(';\n'))
  let c = await svcq(d, `SELECT public.dovec_sync_coords() AS s`)
  t('near-miss (D-point / trailing space / leading space / natulux): service_role runs it', c.ok, true)
  const st0 = await stat(d)
  t('near-misses stay unmatched and report no_match', [st0['D-Point'], st0['Natulux']], [['no_match', null], ['no_match', null]])
  t('near-miss projects carry no pin', [await pinOf(d, 'n1'), await pinOf(d, 'n2'), await pinOf(d, 'n3'), await pinOf(d, 'n4')], Array(4).fill({ la: null, lo: null }))
  t('the status lists them as live without coordinates (reported, not hidden)',
    c.rows[0].s.live_without_coords.map(x => x.id).sort(), ['n1', 'n2', 'n3', 'n4'])
  t('the status lists the five seeds as unmatched, reason no_match',
    [c.rows[0].s.unmatched.length, [...new Set(c.rows[0].s.unmatched.map(x => x.reason))]], [5, ['no_match']])

  // exact match (positive control for the above)
  await d.exec(addP('x1', 'D-Point'))
  c = await svcq(d, `SELECT public.dovec_sync_coords() AS s`)
  t('exact byte match attaches (positive control)', [(await stat(d))['D-Point'], await pinOf(d, 'x1')], [['matched', 'x1'], { la: PIN['D-Point'][0], lo: PIN['D-Point'][1] }])
  t('the near-misses still carry nothing after an exact match exists', (await pinOf(d, 'n1')).la, null)
  t('status: D-Point no longer unmatched', c.rows[0].s.unmatched.some(x => x.seed === 'D-Point'), false)

  // duplicates: two live projects with the same exact name -> none attached
  await d.exec([addP('d1', 'Natulux'), addP('d2', 'Natulux')].join(';\n'))
  c = await svcq(d, `SELECT public.dovec_sync_coords() AS s`)
  t('two exact matches: not attached, status ambiguous', [(await stat(d)).Natulux, await pinOf(d, 'd1'), await pinOf(d, 'd2')], [['ambiguous', null], { la: null, lo: null }, { la: null, lo: null }])
  t('ambiguity is reported', c.rows[0].s.unmatched.filter(x => x.seed === 'Natulux'), [{ seed: 'Natulux', reason: 'ambiguous' }])
  await d.exec(`UPDATE public.dovec_projects SET listed = false, delisted_at = now() WHERE id = 'd2'`)
  await svcq(d, `SELECT public.dovec_sync_coords()`)
  t('once the duplicate is delisted the one live match attaches', [(await stat(d)).Natulux, await pinOf(d, 'd1')], [['matched', 'd1'], { la: PIN.Natulux[0], lo: PIN.Natulux[1] }])

  // rename keeps the pin and reports it; a new project with the old name is NOT attached to the seed
  await d.exec(`UPDATE public.dovec_projects SET name = 'D-Point Residences' WHERE id = 'x1'`)
  c = await svcq(d, `SELECT public.dovec_sync_coords() AS s`)
  t('rename: the pin stays with the project id and the status becomes renamed', [(await stat(d))['D-Point'], await pinOf(d, 'x1')], [['renamed', 'x1'], { la: PIN['D-Point'][0], lo: PIN['D-Point'][1] }])
  t('rename is reported with the new name', c.rows[0].s.renamed.filter(x => x.seed === 'D-Point'), [{ name: 'D-Point Residences', seed: 'D-Point', project_id: 'x1' }])
  await d.exec(addP('x2', 'D-Point'))
  await svcq(d, `SELECT public.dovec_sync_coords()`)
  t('a different project that takes the old name does not steal the pin', [(await stat(d))['D-Point'], await pinOf(d, 'x2')], [['renamed', 'x1'], { la: null, lo: null }])

  // the sync upsert never clears a pin (it does not name latitude/longitude)
  const upsert = `INSERT INTO public.dovec_projects (id, name, city, status, website_url, listed, delisted_at, last_seen_at, updated_at)
    VALUES ('x1', 'D-Point Residences', 'Testville', 'on_sale', 'https://example.com/x1', true, NULL, now(), now())
    ON CONFLICT (id) DO UPDATE SET name = excluded.name, city = excluded.city, status = excluded.status, website_url = excluded.website_url,
      listed = excluded.listed, delisted_at = excluded.delisted_at, last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at`
  t('sync upsert runs as service_role', (await svcq(d, upsert)).ok, true)
  t('the upsert did not clear the pin', await pinOf(d, 'x1'), { la: PIN['D-Point'][0], lo: PIN['D-Point'][1] })
  await d.exec(`UPDATE public.dovec_projects SET listed = false, delisted_at = now() WHERE id = 'x1'`)
  await svcq(d, `SELECT public.dovec_sync_coords()`)
  t('a delisted project keeps its pin and its attachment', [await pinOf(d, 'x1'), (await stat(d))['D-Point'][1]], [{ la: PIN['D-Point'][0], lo: PIN['D-Point'][1] }, 'x1'])
  t('sync source: the feed mapping never names latitude/longitude',
    ['../supabase/functions/sync-dovec/index.ts', '../supabase/functions/_shared/dovec-feed.mjs'].map(f => /\b(latitude|longitude)\b/.test(readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\/.*$/gm, ''))), [false, false])

  // who may call what (every denial beside a positive control)
  t('anon cannot run the pin sync', (await asRole(d, 'anon', null, `SELECT public.dovec_sync_coords()`)).ok, false)
  t('a signed-in user cannot run the pin sync', (await asRole(d, 'authenticated', OTHER, `SELECT public.dovec_sync_coords()`)).ok, false)
  t('anon / signed-in cannot read the pin table', [(await asRole(d, 'anon', null, `SELECT 1 FROM public.dovec_project_coords`)).ok, (await asRole(d, 'authenticated', OTHER, `SELECT 1 FROM public.dovec_project_coords`)).ok], [false, false])
  {
    const a = await asRole(d, 'anon', null, `SELECT public.dovec_coord_status() AS s`)
    const u = await asRole(d, 'authenticated', OTHER, `SELECT public.dovec_coord_status() AS s`)
    const ad = await asRole(d, 'authenticated', ADMIN, `SELECT public.dovec_coord_status() AS s`)
    t('anon / signed-in non-admin cannot run the pin status; an admin can (positive control)', [a.ok, u.ok, ad.ok], [false, false, true])
    const gu = await asGuest(d, `SELECT public.dovec_coord_status() AS s`)
    t('dovec_coord_status: a customer and a guest are refused with DOVEC_NOT_PUBLIC; an admin gets the report (positive control)',
      [u.msg, gu.msg, ad.ok, Object.keys(ad.rows?.[0]?.s ?? {}).length], ['DOVEC_NOT_PUBLIC', 'DOVEC_NOT_PUBLIC', true, 3])
    const s = ad.rows?.[0]?.s
    t('the status has exactly the three lists and nothing else', s && Object.keys(s).sort(), ['live_without_coords', 'renamed', 'unmatched'])
    t('every status entry carries only names, ids and a status word', s && Object.values(s).flat().every(e => Object.keys(e).every(k => ['seed', 'reason', 'project_id', 'name', 'id'].includes(k))), true)
  }
  t('service_role can read both (positive control)', [(await svcq(d, `SELECT public.dovec_coord_status()`)).ok, (await svcq(d, `SELECT 1 FROM public.dovec_project_coords`)).ok], [true, true])
  t('service_role cannot write the table directly', (await svcq(d, `UPDATE public.dovec_project_coords SET latitude = 1`)).ok, false)
  t('anon reads the pin through the project row once the feed is fresh (positive control)', await (async () => {
    await d.exec(`UPDATE public.dovec_settings SET last_good_sync_at = now(), published = true; UPDATE public.dovec_projects SET listed = true, delisted_at = NULL WHERE id = 'x1'`)
    const r = (await asRole(d, 'anon', null, `SELECT latitude::float8 la FROM public.dovec_projects WHERE id = 'x1'`)).rows
    await d.exec(`UPDATE public.dovec_settings SET published = false`)
    return r
  })(), [{ la: PIN['D-Point'][0] }])

  // the test enquiry: exactly one, fixed shape, outside every count and limit
  await d.exec(`DELETE FROM public.dovec_leads; UPDATE public.dovec_settings SET last_good_sync_at = now()`)
  const tl = (extra = {}) => ins(null, { project_id: 'NULL', name: "'ADA TEST'", message: "'Test talebidir, işlem yapmayın'", external_id: "'TEST-1'", is_test: 'true', language: "'Turkish'", language_code: "'tr'", status: "'pending'", ...extra })
  t('test enquiry: the agreed shape is accepted (positive control)', (await svcq(d, tl())).ok, true)
  t('test enquiry: a second one is refused (unique)', [(await svcq(d, tl({ client_request_id: 'gen_random_uuid()' }))).ok], [false])
  await d.exec(`DELETE FROM public.dovec_leads WHERE is_test`)
  t('test enquiry: after removal the single slot is free again', (await svcq(d, tl())).ok, true)
  t('CHECK: external id TEST-2 is refused', /dovec_leads_external_id_check/.test((await svcq(d, tl({ external_id: "'TEST-2'" }))).msg || ''), true)
  t('CHECK: TEST-1 on a row that is not is_test is refused', /dovec_leads_external_id_check/.test((await svcq(d, ins(null, { external_id: "'TEST-1'", project_id: "'p1'" }))).msg || ''), true)
  t('CHECK: a real enquiry without a project is refused', /dovec_leads_project_check/.test((await svcq(d, ins(null, { project_id: 'NULL' }))).msg || ''), true)
  t('CHECK: an is_test row with an ADA- id is refused', /dovec_leads_external_id_check/.test((await svcq(d, tl({ external_id: "'ADA-77'", client_request_id: 'gen_random_uuid()' }))).msg || ''), true)
  t('is_test defaults to false and is NOT NULL', (await d.query(`SELECT is_nullable n, column_default df FROM information_schema.columns WHERE table_name = 'dovec_leads' AND column_name = 'is_test'`)).rows, [{ n: 'NO', df: 'false' }])
  await d.exec(`INSERT INTO public.dovec_projects (id, name, city, status, website_url) VALUES ('p1', 'Fictional Heights', 'Testville', 'on_sale', 'https://example.com/p1') ON CONFLICT DO NOTHING`)
  const cn = async who => (await asRole(d, 'authenticated', ADMIN, `SELECT project_id, n FROM public.dovec_lead_counts()`)).rows
  t('counts: the test enquiry is not counted', await cn(), [])
  await d.exec(ins(LU))
  t('counts: a real enquiry is counted (positive control)', await cn(), [{ project_id: 'p1', n: 1 }])
  // limits: a user at the hourly limit is not blocked by, and the day total is not moved by, the test row
  await d.exec(`DELETE FROM public.dovec_leads WHERE NOT is_test`)
  await d.exec(`INSERT INTO public.dovec_leads (client_request_id, payload_hash, project_id, name, phone, language, language_code, consent, consent_text_version, status)
    SELECT gen_random_uuid(), repeat('e', 64), 'p1', 'x', '+441234567890', 'English', 'en', true, 'v', 'sent' FROM generate_series(1, 200)`)
  t('limits: 200 real enquiries today refuse the next real one (positive control)', /dovec_rate_limited/.test((await svcq(d, ins(LV))).msg || ''), true)
  await d.exec(`DELETE FROM public.dovec_leads`)
  await d.exec(`INSERT INTO public.dovec_leads (client_request_id, payload_hash, project_id, name, phone, language, language_code, consent, consent_text_version, status)
    SELECT gen_random_uuid(), repeat('e', 64), 'p1', 'x', '+441234567890', 'English', 'en', true, 'v', 'sent' FROM generate_series(1, 199)`)
  t('limits: 199 real + the test enquiry is accepted (the test row is outside the day count)', (await svcq(d, tl())).ok, true)
  t('limits: and the 200th real one is still accepted', (await svcq(d, ins(LU))).ok, true)
  await d.exec(`DELETE FROM public.dovec_leads`)
}

console.log('20261229 — red-first mutants (each must be refused by the migration itself)')
for (const [name, from, to, re] of [
  ['a policy on dovec_leads', `ALTER TABLE public.dovec_leads ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE public.dovec_leads ENABLE ROW LEVEL SECURITY;\nCREATE POLICY leak ON public.dovec_leads FOR SELECT TO authenticated USING (true);`, /carries 1 policies/],
  ['SELECT on leads for authenticated', `GRANT SELECT, INSERT, UPDATE ON TABLE public.dovec_leads TO service_role;`,
    `GRANT SELECT ON TABLE public.dovec_leads TO service_role, authenticated;\nGRANT INSERT, UPDATE ON TABLE public.dovec_leads TO service_role;`, /holds SELECT on dovec_leads/],
  ['staleness dropped from the read policy', `USING (listed AND public.dovec_feed_is_fresh())`, `USING (listed)`, /stayed readable 25 hours/],
  ['suspended ignored by the helper', `SELECT NOT s.suspended\n       AND s.last_good_sync_at`, `SELECT s.last_good_sync_at`, /stayed readable while suspended/],
  ['dovec_leads user_id gets an FK', `user_id             uuid,`, `user_id             uuid REFERENCES auth.users(id) ON DELETE SET NULL,`, /foreign keys are/],
  ['published defaults to true', `published         boolean     NOT NULL DEFAULT false`, `published         boolean     NOT NULL DEFAULT true`, /published is not false/],
  ['app role may update projects', `GRANT SELECT ON TABLE public.dovec_projects TO anon, authenticated;`, `GRANT SELECT, UPDATE ON TABLE public.dovec_projects TO anon, authenticated;`, /holds UPDATE on dovec_projects/],
  ['limit trigger not created', `CREATE TRIGGER dovec_leads_rate_limit BEFORE INSERT ON public.dovec_leads
  FOR EACH ROW EXECUTE FUNCTION public.dovec_leads_enforce_limits();`, `SELECT 1;`, /dovec_leads_rate_limit trigger missing or wrong/],
  ['limit function executable by an app role', `REVOKE ALL ON FUNCTION public.dovec_leads_enforce_limits() FROM PUBLIC, anon, authenticated;`, `GRANT EXECUTE ON FUNCTION public.dovec_leads_enforce_limits() TO authenticated;`, /dovec_leads_enforce_limits is executable/],
  ['counts open to non-admins', `IF NOT is_admin() THEN`, `IF false THEN`, /not refused with ADMIN_ONLY/],
  ['pin match folds case and trims', `WHERE p.listed AND p.name COLLATE "C" = s.seed_name COLLATE "C"`, `WHERE p.listed AND lower(btrim(p.name)) = lower(s.seed_name)`, /near-miss was attached or mis-reported/],
  ['pins readable by anon', `GRANT SELECT ON TABLE public.dovec_project_coords TO service_role;`, `GRANT SELECT ON TABLE public.dovec_project_coords TO service_role, anon;`, /holds a privilege on dovec_project_coords/],
  ['pin status closed to anon again', `GRANT EXECUTE ON FUNCTION public.dovec_coord_status() TO anon, authenticated, service_role;`, `GRANT EXECUTE ON FUNCTION public.dovec_coord_status() TO service_role;`, /dovec_coord_status\(\) must be executable/],
  ['pin sync executable by anon', `GRANT EXECUTE ON FUNCTION public.dovec_sync_coords() TO service_role;`, `GRANT EXECUTE ON FUNCTION public.dovec_sync_coords() TO service_role, anon;`, /dovec_sync_coords\(\) is executable by an app role/],
  ['a policy appears on the pins table', `ALTER TABLE public.dovec_project_coords ENABLE ROW LEVEL SECURITY;`, `ALTER TABLE public.dovec_project_coords ENABLE ROW LEVEL SECURITY;\nCREATE POLICY leak ON public.dovec_project_coords FOR SELECT TO anon USING (true);`, /carries 1 policies/],
  ['a sixth pin is seeded', `('Long Beach Panorama', 35.2572000, 33.8945000)\nON CONFLICT`, `('Long Beach Panorama', 35.2572000, 33.8945000), ('Extra', 35.0, 33.0)\nON CONFLICT`, /not exactly the five agreed pins|seeds: 6/],
  ['a seeded coordinate is off by one digit', `('D-Point',            35.2695453,`, `('D-Point',            35.2695454,`, /not exactly the five agreed pins/],
  ['the sales line is wrong', `VALUES (1, '+905338880515')`, `VALUES (1, '+905338880516')`, /whatsapp_e164 is not the agreed sales line/],
  ['external id TEST-2 allowed', `OR (is_test AND external_id = 'TEST-1')`, `OR (is_test)`, /external id TEST-2 was accepted/],
  ['TEST-1 allowed on a real row', `(NOT is_test AND external_id ~ '^ADA-[0-9]+$')`, `(external_id ~ '^ADA-[0-9]+$' OR external_id = 'TEST-1')`, /TEST-1 was accepted on a row that is not is_test/],
  ['a real enquiry may have no project', `CHECK (project_id IS NOT NULL OR is_test)`, `CHECK (true)`, /non-test enquiry without a project was accepted/],
]) {
  const p = mutant(from, to)
  if (!p) continue
  const d = await freshDb(FIXTURE)
  const r = await applyFile(d, p)
  t(`${name}: refused`, [r.ok, re.test(r.msg || '')], [false, true])
  if (r.ok === false && !re.test(r.msg || '')) console.log('    refused for a different reason:', r.msg)
}

console.log('20261229 — red-first: counts and limits that include the test enquiry turn the H token red')
{
  const vs = readFileSync(new URL('../supabase/verify_schema.sql', import.meta.url), 'utf8')
  const h = vs.slice(vs.indexOf('-- 1229-BEGIN'), vs.indexOf('-- 1229-END'))
  const q = `SELECT 'x'::text AS m, 'x'::text AS o, true AS ok WHERE false ${h}`
  for (const [name, from, to] of [
    ['counts include the test row', `WHERE NOT l.is_test`, `WHERE true`],
    ['the limit trigger does not skip the test row', `IF NEW.is_test THEN RETURN NEW; END IF;`, `NULL;`],
    ['the test index is not unique', `CREATE UNIQUE INDEX IF NOT EXISTS dovec_leads_one_test_idx`, `CREATE INDEX IF NOT EXISTS dovec_leads_one_test_idx`],
  ]) {
    const p = mutant(from, to)
    if (!p) continue
    const d = await freshDb(FIXTURE)
    const r = await applyFile(d, p)
    const red = r.ok ? (await d.query(q)).rows.filter(x => x.ok !== true).length : -1
    t(`${name}: the migration applies and the H token is red`, [r.ok, red], [true, 1])
  }
}

console.log('20261229 — red-first: a weakened limit lets the 4th lead through')
{
  const p = mutant(`>= 3\n       OR`, `>= 30\n       OR`)
  if (p) {
    const d = await freshDb(FIXTURE)
    t('mutant applies', (await applyFile(d, p)).ok, true)
    await d.exec(`INSERT INTO public.dovec_projects (id, name, city, status, website_url) VALUES ('p1', 'Fictional Heights', 'Testville', 'on_sale', 'https://example.com/p1')`)
    const r = []
    for (let i = 0; i < 4; i++) r.push((await asRole(d, 'service_role', null, ins(LU))).ok)
    t('with >= 30 the 4th insert is NOT refused (the test above can fail)', r, [true, true, true, true])
  }
}

console.log('20261229 — contact_events pre-state and post-state guards')
{
  const bare = m => m.map(x => `'${x}'`).join(',')
  for (const [name, mods, re] of [
    ['live list lacks a module the file re-adds (cars)', MODS18.filter(m => m !== 'cars'), /lacks modules this file re-adds: \{cars\}/],
    ['live list holds a module the file would drop', [...MODS18, 'surprise'], /would drop: \{surprise\}/],
  ]) {
    const d = await freshDb(CE(mods) + FIXTURE.slice(CE().length))
    const r = await applyFile(d, FILE)
    t(`${name}: refused`, [r.ok, re.test(r.msg || '')], [false, true])
    if (r.ok === false && !re.test(r.msg || '')) console.log('    refused for a different reason:', r.msg)
  }
  {
    const d = await freshDb(CE().replace("('call','whatsapp','call_secondary','website')", "('call','call_secondary','website')") + FIXTURE.slice(CE().length))
    const r = await applyFile(d, FILE)
    t('action CHECK without whatsapp: refused', [r.ok, /does not accept whatsapp/.test(r.msg || '')], [false, true])
  }
  const p = mutant(`'cars','news','dovec'));`, `'cars','news'));`)
  if (p) {
    const d = await freshDb(FIXTURE)
    const r = await applyFile(d, p)
    t("ADD without 'dovec': refused by the post-state check", [r.ok, /post-state is not the 18 \+ dovec/.test(r.msg || '')], [false, true])
  }
}

console.log('20261232 — cron file, on top of 20261229 + 20261231')
{
  const FILE_B = fileURLToPath(new URL('../supabase/migrations/20261232_dovec_cron.sql', import.meta.url))
  const SEED_B = `
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid serial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, username text DEFAULT 'postgres', active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job (jobname, schedule, command) VALUES (n, s, c) ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING jobid::bigint $$;
CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = n RETURNING true $$;
CREATE SCHEMA net;
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', headers jsonb DEFAULT '{}', timeout_milliseconds int DEFAULT 5000) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
CREATE SCHEMA vault;
CREATE TABLE vault.secrets (id serial PRIMARY KEY, name text UNIQUE, secret text);
CREATE VIEW vault.decrypted_secrets AS SELECT id, name, secret AS decrypted_secret FROM vault.secrets;
CREATE TABLE public.data_jobs (key text PRIMARY KEY, runner text NOT NULL, kind text NOT NULL, cron_jobnames text[] NOT NULL DEFAULT '{}', schedule_note text, expected_every interval, sort int NOT NULL DEFAULT 0);
`
  const build = async (withSecret) => {
    const d = await freshDb(FIXTURE + SEED_B)
    if (withSecret) await d.exec(`INSERT INTO vault.secrets (name, secret) VALUES ('novest_sync_key', 'test-not-a-real-key')`)
    return d
  }
  {
    const d = await build(false)
    t('A applies', [(await applyFile(d, FILE)).ok, (await applyFile(d, GATE)).ok], [true, true])
    const r = await applyFile(d, FILE_B)
    t('B refuses without the Vault secret', [r.ok, /novest_sync_key is missing/.test(r.msg || '')], [false, true])
    await d.exec('ROLLBACK; RESET ROLE;')
    t('and leaves no job behind', (await d.query(`SELECT count(*)::int n FROM cron.job`)).rows[0].n, 0)
  }
  {
    const d = await build(true)
    const r0 = await applyFile(d, FILE_B)
    t('B refuses before A', [r0.ok, /20261229 is not applied/.test(r0.msg || '')], [false, true])
    await d.exec('ROLLBACK; RESET ROLE;')
    await applyFile(d, FILE)
    await applyFile(d, GATE)
    t('B applies with the secret', await applyFile(d, FILE_B), { ok: true, msg: null })
    t('three jobs, one registry row each', (await d.query(`SELECT j.jobname, (SELECT count(*)::int FROM public.data_jobs x WHERE j.jobname = ANY (x.cron_jobnames)) AS rows FROM cron.job j ORDER BY 1`)).rows,
      [{ jobname: 'dovec-lead-retry', rows: 1 }, { jobname: 'dovec-leads-wipe', rows: 1 }, { jobname: 'dovec-sync', rows: 1 }])
    t('the retry job ignores leads older than 7 days (they are settled by the wipe job)', (await d.query(`SELECT command LIKE '%l.created_at > now() - interval ''7 days''%' AS ok FROM cron.job WHERE jobname = 'dovec-lead-retry'`)).rows, [{ ok: true }])
    t('re-applying B is idempotent', [(await applyFile(d, FILE_B)).ok, (await d.query(`SELECT count(*)::int n FROM cron.job`)).rows[0].n, (await d.query(`SELECT count(*)::int n FROM public.data_jobs`)).rows[0].n], [true, 3, 3])
  }
}

console.log(bad ? `\n${bad} FAILED` : '\nall passed')
process.exit(bad ? 1 : 0)
