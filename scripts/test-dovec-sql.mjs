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
const SQL = readFileSync(FILE, 'utf8')
const ADMIN = '00000000-0000-4000-8000-000000000001', CUSTOMER = '00000000-0000-4000-8000-000000000002'
const OTHER = '00000000-0000-4000-8000-000000000003'

const FIXTURE = `
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, role text NOT NULL DEFAULT 'customer');
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $f$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$f$;
INSERT INTO auth.users (id) VALUES ('${ADMIN}'), ('${CUSTOMER}'), ('${OTHER}');
INSERT INTO public.profiles (id, role) VALUES ('${ADMIN}', 'admin'), ('${CUSTOMER}', 'customer'), ('${OTHER}', 'customer');
`

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
const ready = async (file = FILE) => {
  const d = await freshDb(FIXTURE)
  return { d, r: await applyFile(d, file) }
}
const mutant = (from, to) => {
  if (!SQL.includes(from)) { bad++; console.log(`  ✗ mutant anchor missing: ${from.slice(0, 50)}`); return null }
  const p = join(mkdtempSync(join(tmpdir(), 'dovec-')), 'm.sql')
  writeFileSync(p, SQL.replace(from, to))
  return p
}

console.log('20261229 — real file')
{
  const { d, r } = await ready()
  t('applies, including its own assertions', r, { ok: true, msg: null })
  if (!r.ok) { console.log(r.msg); process.exit(1) }

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
    t('H tokens run and are all true', Array.isArray(tok) ? [tok.length, tok.every(r => r.ok === true)] : tok, [4, true])
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

  // Reads as the app roles, with controls.
  t('anon reads the project while fresh (positive control)', (await asRole(d, 'anon', null, `SELECT count(*)::int n FROM public.dovec_projects`)).rows[0].n, 1)
  t('guest/customer reads settings: only the five columns',
    (await asRole(d, 'authenticated', OTHER, `SELECT published, suspended, whatsapp_e164, last_good_sync_at IS NOT NULL AS synced FROM public.dovec_settings`)).rows,
    [{ published: false, suspended: false, whatsapp_e164: null, synced: true }])
  t('run-status columns are not readable by an app role',
    (await asRole(d, 'authenticated', OTHER, `SELECT last_run_detail FROM public.dovec_settings`)).ok, false)
  t('leads are unreadable to anon', (await asRole(d, 'anon', null, `SELECT 1 FROM public.dovec_leads`)).ok, false)
  t('leads are unreadable to a signed-in user', (await asRole(d, 'authenticated', ADMIN, `SELECT 1 FROM public.dovec_leads`)).ok, false)
  t('leads are readable to service_role (positive control)', (await asRole(d, 'service_role', null, `SELECT count(*)::int n FROM public.dovec_leads`)).ok, true)
  await d.exec(`UPDATE public.dovec_settings SET last_good_sync_at = now() - interval '25 hours'`)
  t('25 h after the last good sync the project is gone for anon', (await asRole(d, 'anon', null, `SELECT count(*)::int n FROM public.dovec_projects`)).rows[0].n, 0)
  t('counts: a customer is refused', (await asRole(d, 'authenticated', OTHER, `SELECT * FROM public.dovec_lead_counts()`)).msg, 'ADMIN_ONLY')
  t('counts: anon has no EXECUTE', /permission denied/.test((await asRole(d, 'anon', null, `SELECT * FROM public.dovec_lead_counts()`)).msg), true)
  const c = await asRole(d, 'authenticated', ADMIN, `SELECT * FROM public.dovec_lead_counts()`)
  t('counts: admin gets counts and no personal column', [c.ok, Object.keys(c.rows[0] || {}).sort()], [true, ['month', 'n', 'project_id', 'project_name', 'status']])
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
  ['counts open to non-admins', `IF NOT is_admin() THEN`, `IF false THEN`, /not refused with ADMIN_ONLY/],
]) {
  const p = mutant(from, to)
  if (!p) continue
  const d = await freshDb(FIXTURE)
  const r = await applyFile(d, p)
  t(`${name}: refused`, [r.ok, re.test(r.msg || '')], [false, true])
  if (r.ok === false && !re.test(r.msg || '')) console.log('    refused for a different reason:', r.msg)
}

console.log('20261230 — cron file, on top of 20261229')
{
  const FILE_B = fileURLToPath(new URL('../supabase/migrations/20261230_dovec_cron.sql', import.meta.url))
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
    if (withSecret) await d.exec(`INSERT INTO vault.secrets (name, secret) VALUES ('dovec_sync_key', 'test-not-a-real-key')`)
    return d
  }
  {
    const d = await build(false)
    t('A applies', (await applyFile(d, FILE)).ok, true)
    const r = await applyFile(d, FILE_B)
    t('B refuses without the Vault secret', [r.ok, /dovec_sync_key is missing/.test(r.msg || '')], [false, true])
    await d.exec('ROLLBACK; RESET ROLE;')
    t('and leaves no job behind', (await d.query(`SELECT count(*)::int n FROM cron.job`)).rows[0].n, 0)
  }
  {
    const d = await build(true)
    const r0 = await applyFile(d, FILE_B)
    t('B refuses before A', [r0.ok, /20261229 is not applied/.test(r0.msg || '')], [false, true])
    await d.exec('ROLLBACK; RESET ROLE;')
    await applyFile(d, FILE)
    t('B applies with the secret', await applyFile(d, FILE_B), { ok: true, msg: null })
    t('three jobs, one registry row each', (await d.query(`SELECT j.jobname, (SELECT count(*)::int FROM public.data_jobs x WHERE j.jobname = ANY (x.cron_jobnames)) AS rows FROM cron.job j ORDER BY 1`)).rows,
      [{ jobname: 'dovec-lead-retry', rows: 1 }, { jobname: 'dovec-leads-wipe', rows: 1 }, { jobname: 'dovec-sync', rows: 1 }])
    t('re-applying B is idempotent', [(await applyFile(d, FILE_B)).ok, (await d.query(`SELECT count(*)::int n FROM cron.job`)).rows[0].n, (await d.query(`SELECT count(*)::int n FROM public.data_jobs`)).rows[0].n], [true, 3, 3])
  }
}

console.log(bad ? `\n${bad} FAILED` : '\nall passed')
process.exit(bad ? 1 : 0)
