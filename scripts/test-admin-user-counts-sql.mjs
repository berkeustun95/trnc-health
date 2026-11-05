// 20261161 (admin_user_counts) against the PGlite harness (PostgreSQL 18; prod is older, see supabase/CLAUDE.md).
// Seeds only the auth columns the function reads. Says nothing about whether prod's postgres can read auth.sessions:
// the migration's own positive control measures that at apply. Red-first mutants prove the gate tests can fail.
// Not wired into CI, like its siblings: run by hand.
//
//   node scripts/test-admin-user-counts-sql.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile, asRole } from './migration-harness.mjs'

const FILE = fileURLToPath(new URL('../supabase/migrations/20261161_admin_user_counts.sql', import.meta.url))
const SQL = readFileSync(FILE, 'utf8')
const ADMIN = '00000000-0000-4000-8000-000000000001', CUSTOMER = '00000000-0000-4000-8000-000000000002'
const GUEST = '00000000-0000-4000-8000-000000000003', BOTH = '00000000-0000-4000-8000-000000000004'
const ZONE = "'Europe/Nicosia'"
const edge = (unit, offset) => `(date_trunc('${unit}', now() AT TIME ZONE ${ZONE}) ${offset}) AT TIME ZONE ${ZONE}`

const FIXTURE = `
ALTER TABLE auth.users ADD COLUMN is_anonymous boolean NOT NULL DEFAULT false, ADD COLUMN created_at timestamptz,
  ADD COLUMN deleted_at timestamptz, ADD COLUMN email text;
CREATE TABLE auth.sessions (id bigserial PRIMARY KEY, user_id uuid NOT NULL, user_agent text, not_after timestamptz);
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id), role text NOT NULL DEFAULT 'customer');
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $f$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$f$;
INSERT INTO auth.users (id, is_anonymous, created_at, email) VALUES
  ('${ADMIN}', false, now() - interval '400 days', 'admin@example.com'),
  ('${CUSTOMER}', false, now() - interval '400 days', 'customer@example.com'),
  ('${GUEST}', true, now() - interval '400 days', NULL),
  ('${BOTH}', false, now() - interval '400 days', 'both@example.com');
INSERT INTO public.profiles (id, role) VALUES ('${ADMIN}', 'admin'), ('${CUSTOMER}', 'customer'), ('${GUEST}', 'customer'), ('${BOTH}', 'customer');
INSERT INTO auth.sessions (user_id, user_agent, not_after) VALUES
  ('${CUSTOMER}', 'ADA/1 CFNetwork/1568 Darwin/24', NULL),
  ('${CUSTOMER}', 'ADA/1 CFNetwork/1568 Darwin/24', now() + interval '1 day'),
  ('${GUEST}', 'okhttp/4.12.0', NULL),
  ('${BOTH}', 'okhttp/4.12.0', NULL),
  ('${BOTH}', 'ADA/1 CFNetwork/1568 Darwin/24', NULL),
  ('${ADMIN}', 'okhttp/4.12.0', now() - interval '1 day'),
  ('${ADMIN}', 'Mozilla/5.0', NULL),
  ('${ADMIN}', NULL, NULL);
`
// Rows on each side of the Nicosia boundaries, for the second run. A row at a boundary minus one minute belongs to the period before.
const EDGES = `
INSERT INTO auth.users (id, created_at) VALUES
  ('10000000-0000-4000-8000-000000000001', ${edge('day', "+ interval '1 second'")}),
  ('10000000-0000-4000-8000-000000000002', ${edge('day', "- interval '1 minute'")}),
  ('10000000-0000-4000-8000-000000000003', ${edge('week', "- interval '1 minute'")}),
  ('10000000-0000-4000-8000-000000000004', ${edge('month', "- interval '1 minute'")});
INSERT INTO auth.users (id, created_at, deleted_at) VALUES ('10000000-0000-4000-8000-000000000005', now(), now());
`

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
const ready = async (seed = FIXTURE, file = FILE) => {
  const d = await freshDb(seed)
  return { d, r: await applyFile(d, file) }
}
const call = (d, role, uid) => asRole(d, role, uid, 'SELECT public.admin_user_counts() AS c')

console.log('20261161 — real file')
{
  const { d, r } = await ready()
  t('applies, including its own assertions', r, { ok: true, msg: null })
  t('anon has no EXECUTE', (await call(d, 'anon', null)).ok, false)
  t('anon is refused for the privilege, not by the gate', /permission denied/.test((await call(d, 'anon', null)).msg), true)
  t('a customer is refused', (await call(d, 'authenticated', CUSTOMER)).msg, 'ADMIN_ONLY')
  t('a guest is refused', (await call(d, 'authenticated', GUEST)).msg, 'ADMIN_ONLY')
  const a = await call(d, 'authenticated', ADMIN)
  const c = a.rows[0].c
  t('admin gets the exact key set, counts only', Object.keys(c).sort(),
    ['accounts', 'android_users', 'daily', 'guests', 'ios_users', 'new_month', 'new_today', 'new_week', 'total'])
  t('total, accounts, guests', [c.total, c.accounts, c.guests], [4, 3, 1])
  t('iOS: two users, duplicate sessions counted once', c.ios_users, 2)
  t('Android: two users; expired session and other agents ignored', c.android_users, 2)
  t('daily has 30 days, oldest first, zero-filled', [c.daily.length, c.daily[0].day < c.daily[29].day, c.daily.every(x => x.n === 0)], [30, true, true])
  t('no email or id anywhere in the payload', /@example|00000000-0000/.test(JSON.stringify(c)), false)
}
{
  const { d } = await ready(FIXTURE + EDGES)
  const c = (await call(d, 'authenticated', ADMIN)).rows[0].c
  const b = (await d.query(`SELECT date_trunc('week', now() AT TIME ZONE ${ZONE}) AS w, date_trunc('month', now() AT TIME ZONE ${ZONE}) AS m, date_trunc('day', now() AT TIME ZONE ${ZONE}) AS t`)).rows[0]
  const prior = [new Date(b.t.getTime() - 60000), new Date(b.w.getTime() - 60000), new Date(b.m.getTime() - 60000)]
  t('soft-deleted user is left out of total', c.total, 8)
  t('today holds only the row after midnight Nicosia', c.new_today, 1)
  t('this week excludes the row one minute before Monday', c.new_week, 1 + (prior[0] >= b.w ? 1 : 0) + (prior[2] >= b.w ? 1 : 0))
  t('this month excludes the row one minute before the 1st', c.new_month, 1 + (prior[0] >= b.m ? 1 : 0) + (prior[1] >= b.m ? 1 : 0))
  t('the last daily bucket is today', c.daily[29].n, 1)
  t('yesterday bucket holds the row before midnight', c.daily[28].n >= 1, true)
}

console.log('mutants (each must be refused or caught)')
const dir = mkdtempSync(join(tmpdir(), 'auc-'))
const mutant = (name, from, to) => {
  if (!SQL.includes(from)) throw new Error(`mutant anchor missing: ${name}`)
  const p = join(dir, `${name}.sql`)
  writeFileSync(p, SQL.replace(from, to))
  return p
}
{
  const { r } = await ready(FIXTURE, mutant('no-gate', "IF NOT is_admin() THEN\n    RAISE EXCEPTION 'ADMIN_ONLY';\n  END IF;", ''))
  t('without the is_admin gate the file refuses itself', r.ok, false)
}
{
  const { r } = await ready(FIXTURE, mutant('anon-exec', 'REVOKE ALL ON FUNCTION public.admin_user_counts() FROM anon;', ''))
  t('without the anon revoke the file refuses itself', r.msg, 'anon can still EXECUTE admin_user_counts')
}
{
  const { r } = await ready(FIXTURE, mutant('no-deleted-filter', "FROM auth.users\n     WHERE deleted_at IS NULL\n  ), live", "FROM auth.users\n  ), live"))
  t('control: the positive control sees nothing wrong without soft-deleted rows', r.ok, true)
  const { r: r2 } = await ready(FIXTURE + EDGES, mutant('no-deleted-filter2', "FROM auth.users\n     WHERE deleted_at IS NULL\n  ), live", "FROM auth.users\n  ), live"))
  t('with a soft-deleted row, dropping the filter fails the add-up check', r2.ok, false)
}

console.log(bad ? `\nFAILED: ${bad}` : '\nall passed')
process.exit(bad ? 1 : 0)
