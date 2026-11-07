// 20261163 (oli_messages) against the PGlite harness (PostgreSQL 18; prod is older, see supabase/CLAUDE.md).
// Seeds auth.users, is_anonymous_session() and a pg_cron stub. Answers: who can read / write / delete whose chat,
// the column grant, the rate guard and the 90-day purge. Says nothing about prod's catalogs: the migration's own
// DO block asserts those at apply. Red-first mutants prove the checks can fail.
// Not wired into CI, like its siblings: run by hand.
//
//   node scripts/test-oli-messages-sql.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile, asRole } from './migration-harness.mjs'

const FILE = fileURLToPath(new URL('../supabase/migrations/20261163_oli_messages.sql', import.meta.url))
const SQL = readFileSync(FILE, 'utf8')
const ALICE = '00000000-0000-4000-8000-0000000000a1', BOB = '00000000-0000-4000-8000-0000000000b2'
const GUEST = '00000000-0000-4000-8000-0000000000c3'

const FIXTURE = `
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid serial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean NOT NULL DEFAULT true);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $f$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (n, s, c) RETURNING jobid $f$;
CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql AS $f$ DELETE FROM cron.job WHERE jobname = n RETURNING true $f$;
CREATE FUNCTION public.is_anonymous_session() RETURNS boolean LANGUAGE sql STABLE SET search_path TO '' AS $f$
  SELECT coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous')::boolean, false)
$f$;
INSERT INTO auth.users (id) VALUES ('${ALICE}'), ('${BOB}'), ('${GUEST}');
`

// asRole() writes {sub, role}; a guest needs is_anonymous too, so guest calls set the claims themselves.
async function asGuest(db, sql) {
  await db.exec('RESET ROLE;')
  await db.query("SELECT set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: GUEST, role: 'authenticated', is_anonymous: true })])
  await db.exec('SET ROLE authenticated;')
  try { return { ok: true, rows: (await db.query(sql)).rows } }
  catch (e) { return { ok: false, msg: String(e.message || e).split('\n')[0] } }
  finally { await db.exec('RESET ROLE;') }
}

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
const ins = (who, role, body, payload) => {
  const b = body === null ? 'NULL' : `'${body}'`
  const p = payload === null ? 'NULL' : `'${JSON.stringify(payload)}'::jsonb`
  return `INSERT INTO public.oli_messages (role, body, payload) VALUES ('${role}', ${b}, ${p})`
}
const count = rows => Number(rows?.[0]?.n)

console.log('20261163 — real file')
{
  const { d, r } = await ready()
  t('applies, including its own assertions and the purge probe', r, { ok: true, msg: null })

  t('Alice inserts her own question', (await asRole(d, 'authenticated', ALICE, ins(ALICE, 'user', 'nöbetçi eczane', null))).ok, true)
  t('Alice inserts Oli\'s answer', (await asRole(d, 'authenticated', ALICE, ins(ALICE, 'oli', null, { v: 1, kind: 'answer', intent: 'pharmacy' }))).ok, true)
  t('Bob inserts his own question', (await asRole(d, 'authenticated', BOB, ins(BOB, 'user', 'events', null))).ok, true)
  t('the row is stamped with the caller as user_id (DEFAULT auth.uid())',
    (await asRole(d, null, null, `SELECT count(*) n FROM public.oli_messages WHERE user_id = '${ALICE}'`)).rows[0].n, 2)

  t('Alice reads only her own 2 rows', count((await asRole(d, 'authenticated', ALICE, 'SELECT count(*) n FROM public.oli_messages')).rows), 2)
  t('Bob reads only his own 1 row', count((await asRole(d, 'authenticated', BOB, 'SELECT count(*) n FROM public.oli_messages')).rows), 1)
  t('Bob cannot see any of Alice\'s rows', count((await asRole(d, 'authenticated', BOB, `SELECT count(*) n FROM public.oli_messages WHERE user_id = '${ALICE}'`)).rows), 0)
  t('anon has no SELECT privilege', (await asRole(d, 'anon', null, 'SELECT count(*) n FROM public.oli_messages')).ok, false)
  t('anon cannot insert', (await asRole(d, 'anon', null, ins(null, 'user', 'x', null))).ok, false)

  t('a guest reads nothing', count((await asGuest(d, 'SELECT count(*) n FROM public.oli_messages')).rows), 0)
  t('a guest cannot insert', /row-level security/.test((await asGuest(d, ins(GUEST, 'user', 'hi', null))).msg), true)

  t('Alice cannot write into Bob\'s history (user_id not in the grant)',
    /permission denied/.test((await asRole(d, 'authenticated', ALICE, `INSERT INTO public.oli_messages (user_id, role, body) VALUES ('${BOB}', 'user', 'x')`)).msg), true)
  t('Alice cannot backdate (created_at not in the grant)',
    /permission denied/.test((await asRole(d, 'authenticated', ALICE, `INSERT INTO public.oli_messages (role, body, created_at) VALUES ('user', 'x', now() - interval '1 year')`)).msg), true)
  t('nobody can UPDATE', (await asRole(d, 'authenticated', ALICE, `UPDATE public.oli_messages SET body = 'edited'`)).ok, false)

  t('a 501-char body is refused', (await asRole(d, 'authenticated', ALICE, ins(ALICE, 'user', 'x'.repeat(501), null))).ok, false)
  t('a 500-char body is accepted (positive control)', (await asRole(d, 'authenticated', ALICE, ins(ALICE, 'user', 'x'.repeat(500), null))).ok, true)
  t('a user row with a payload is refused', (await asRole(d, 'authenticated', ALICE, ins(ALICE, 'user', 'x', { v: 1 }))).ok, false)
  t('an oli row with no payload is refused', (await asRole(d, 'authenticated', ALICE, ins(ALICE, 'oli', null, null))).ok, false)
  t('a non-object payload is refused', (await asRole(d, 'authenticated', ALICE, `INSERT INTO public.oli_messages (role, payload) VALUES ('oli', '[1]'::jsonb)`)).ok, false)
  t('an over-8000-byte payload is refused', (await asRole(d, 'authenticated', ALICE, ins(ALICE, 'oli', null, { v: 1, pad: 'x'.repeat(8100) }))).ok, false)
  t('an unknown role is refused', (await asRole(d, 'authenticated', ALICE, ins(ALICE, 'admin', 'x', null))).ok, false)

  t('Bob\'s DELETE of everything removes none of Alice\'s rows',
    (await asRole(d, 'authenticated', BOB, 'DELETE FROM public.oli_messages')).ok, true)
  t('…Alice still has her 3 rows', count((await asRole(d, 'authenticated', ALICE, 'SELECT count(*) n FROM public.oli_messages')).rows), 3)
  t('…and Bob has none left', count((await asRole(d, 'authenticated', BOB, 'SELECT count(*) n FROM public.oli_messages')).rows), 0)
  t('Alice deletes her own history', (await asRole(d, 'authenticated', ALICE, 'DELETE FROM public.oli_messages')).ok, true)
  t('…and it is gone (read as postgres)', count((await asRole(d, null, null, `SELECT count(*) n FROM public.oli_messages WHERE user_id = '${ALICE}'`)).rows), 0)

  // Rate guard: 40 rows in 10 minutes, then refused. Earlier rows are older than the window and do not count.
  for (let i = 0; i < 40; i++) await asRole(d, 'authenticated', BOB, ins(BOB, 'user', `q${i}`, null))
  t('Bob has 40 rows after 40 inserts', count((await asRole(d, 'authenticated', BOB, 'SELECT count(*) n FROM public.oli_messages')).rows), 40)
  t('the 41st insert within 10 minutes is refused with OLI_RATE_LIMIT', (await asRole(d, 'authenticated', BOB, ins(BOB, 'user', 'q41', null))).msg, 'OLI_RATE_LIMIT')
  t('Alice is not limited by Bob\'s rows (positive control)', (await asRole(d, 'authenticated', ALICE, ins(ALICE, 'user', 'hi', null))).ok, true)
  await d.exec(`UPDATE public.oli_messages SET created_at = now() - interval '11 minutes' WHERE user_id = '${BOB}'`)
  t('once those rows are older than 10 minutes Bob may insert again', (await asRole(d, 'authenticated', BOB, ins(BOB, 'user', 'later', null))).ok, true)

  t('authenticated cannot call the purge', (await asRole(d, 'authenticated', ALICE, 'SELECT public.purge_oli_messages()')).ok, false)
  await d.exec(`UPDATE public.oli_messages SET created_at = now() - interval '100 days' WHERE body = 'later'`)
  const res = (await asRole(d, null, null, 'SELECT public.purge_oli_messages() AS r')).rows[0].r
  t('the purge deletes exactly the one 100-day-old row', res.deleted, 1)
  t('…and keeps the 11-minute-old rows', count((await asRole(d, null, null, `SELECT count(*) n FROM public.oli_messages WHERE user_id = '${BOB}'`)).rows), 40)

  await d.exec(`DELETE FROM auth.users WHERE id = '${BOB}'`)
  t('deleting the account cascades to the chat', count((await asRole(d, null, null, `SELECT count(*) n FROM public.oli_messages WHERE user_id = '${BOB}'`)).rows), 0)
}

// Mutants: each break must make the file refuse at apply (its own assertions) or a behaviour check fail.
const dir = mkdtempSync(join(tmpdir(), 'oli-msg-'))
function mutant(name, from, to) {
  if (!SQL.includes(from)) throw new Error(`mutant "${name}": anchor not found`)
  const p = join(dir, `${name}.sql`)
  writeFileSync(p, SQL.replace(from, to))
  return p
}
console.log('mutants (each must be refused at apply)')
const refused = async (name, file) => {
  const { r } = await ready(file)
  t(`${name} → refused`, r.ok, false)
  if (!r.ok) console.log(`      ${r.msg}`)
}
await refused('admin read policy added', mutant('admin', 'DROP POLICY IF EXISTS "oli_no_update"',
  'CREATE POLICY "oli_select_admin" ON public.oli_messages FOR SELECT TO authenticated USING (true);\nDROP POLICY IF EXISTS "oli_no_update"'))
await refused('guest exclusion dropped from select', mutant('guest',
  'USING (user_id = (select auth.uid()) AND NOT (select public.is_anonymous_session()));\n\nDROP POLICY IF EXISTS "oli_insert_own"',
  'USING (user_id = (select auth.uid()));\n\nDROP POLICY IF EXISTS "oli_insert_own"'))
await refused('user_id added to the insert grant', mutant('grant', 'GRANT INSERT (role, body, payload)', 'GRANT INSERT (user_id, role, body, payload)'))
await refused('cascade removed', mutant('cascade', 'REFERENCES auth.users(id) ON DELETE CASCADE', 'REFERENCES auth.users(id)'))
await refused('purge callable by authenticated', mutant('exec',
  'REVOKE ALL ON FUNCTION public.purge_oli_messages() FROM PUBLIC, anon, authenticated;',
  'REVOKE ALL ON FUNCTION public.purge_oli_messages() FROM PUBLIC, anon, authenticated;\nGRANT EXECUTE ON FUNCTION public.purge_oli_messages() TO authenticated;'))
await refused('retention 9 days instead of 90', mutant('ret', "v_cut timestamptz := now() - interval '90 days';", "v_cut timestamptz := now() - interval '9 days';"))
await refused('cron schedule changed', mutant('cron', "SELECT cron.schedule('purge-oli-messages', '57 3 * * *'", "SELECT cron.schedule('purge-oli-messages', '57 4 * * *'"))
await refused('rate-guard trigger removed', mutant('trg', 'CREATE TRIGGER oli_messages_rate_guard BEFORE INSERT', 'CREATE TRIGGER oli_messages_rate_guard AFTER INSERT'))

console.log(bad ? `\n${bad} FAILED` : '\nall passed')
process.exit(bad ? 1 : 0)
