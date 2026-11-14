// 20261200 (delete the 2026-11-14 audit guest) against the PGlite harness (PostgreSQL 18; prod is older, see supabase/CLAUDE.md).
// Synthetic users only. Positive control: exactly one matching guest is deleted and nothing else changes. Each other
// shape (no match, two matches, a signed-up account or a provider in the window, a push token) must refuse and delete
// nothing. Says nothing about prod's FKs on auth.users: the file's own assertions roll back there. Run by hand.
//
//   node scripts/test-delete-audit-guest-sql.mjs
import { fileURLToPath } from 'node:url'
import { freshDb, applyFile } from './migration-harness.mjs'

const FILE = fileURLToPath(new URL('../supabase/migrations/20261200_delete_audit_guest.sql', import.meta.url))
const IN = "'2026-11-14 14:46:10+00'", BEFORE = "'2026-11-14 14:45:00+00'", AFTER = "'2026-11-14 14:49:00+00'"
const G = n => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const FIXTURE = `
ALTER TABLE auth.users ADD COLUMN is_anonymous boolean NOT NULL DEFAULT false, ADD COLUMN email text,
  ADD COLUMN created_at timestamptz DEFAULT '2026-01-01 00:00:00+00', ADD COLUMN deleted_at timestamptz;
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, role text NOT NULL DEFAULT 'customer', push_token text);
CREATE TABLE public.notifications (id bigserial PRIMARY KEY, user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE);
INSERT INTO auth.users (id, is_anonymous, email, created_at) VALUES
  ('${G(1)}', true,  NULL,            ${IN}),      -- the audit guest
  ('${G(2)}', true,  NULL,            ${BEFORE}),  -- a guest just outside the window
  ('${G(3)}', true,  NULL,            ${AFTER}),   -- a guest just outside the window
  ('${G(4)}', false, 'qa@example.com', ${IN});     -- an account signed up in the window
INSERT INTO public.profiles (id) SELECT id FROM auth.users;
INSERT INTO public.notifications (user_id) SELECT id FROM public.profiles;
`
const snapshot = async d => (await d.query('SELECT id::text FROM auth.users ORDER BY id')).rows.map(r => r.id).join(',')

let bad = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!ok) bad++ }

async function run(extra) {
  const d = await freshDb()
  await d.exec(FIXTURE + (extra || ''))
  const before = await snapshot(d)
  const r = await applyFile(d, FILE)
  const err = r.ok ? null : r.msg
  if (!r.ok) await d.exec('ROLLBACK; RESET ROLE;').catch(() => {})
  return { d, before, after: await snapshot(d), err }
}

{ // positive control
  const { d, before, after, err } = await run('')
  check('one matching guest: applies', err === null, err || '')
  check('one matching guest: only that guest is gone', after === before.split(',').filter(x => x !== G(1)).join(','), after)
  const dep = (await d.query(`SELECT count(*)::int n FROM public.profiles WHERE id = '${G(1)}'`)).rows[0].n
    + (await d.query(`SELECT count(*)::int n FROM public.notifications WHERE user_id = '${G(1)}'`)).rows[0].n
  check('one matching guest: profile + notifications cascaded', dep === 0, `left ${dep}`)
  const led = (await d.query(`SELECT count(*)::int n FROM public.schema_migrations_applied WHERE filename = '20261200_delete_audit_guest.sql'`)).rows[0].n
  check('one matching guest: ledger row written', led === 1)
}

const refusals = [
  ['no match (guest already gone)', `DELETE FROM auth.users WHERE id = '${G(1)}';`],
  ['two matching guests', `INSERT INTO auth.users (id, is_anonymous, created_at) VALUES ('${G(5)}', true, ${IN}); INSERT INTO public.profiles (id) VALUES ('${G(5)}');`],
  ['the guest has a push token', `UPDATE public.profiles SET push_token = 'ExponentPushToken[x]' WHERE id = '${G(1)}';`],
  ['the guest has a provider profile', `UPDATE public.profiles SET role = 'provider' WHERE id = '${G(1)}';`],
  ['the guest has an email', `UPDATE auth.users SET email = 'x@example.com' WHERE id = '${G(1)}';`],
]
for (const [name, extra] of refusals) {
  const { before, after, err } = await run(extra)
  check(`${name}: refused`, err !== null && /Nothing deleted|Rolling back/.test(err), err ? err.split('\n')[0].slice(0, 90) : 'applied!')
  check(`${name}: nothing deleted`, after === before)
}

const { readFileSync } = await import('node:fs')
const src = readFileSync(FILE, 'utf8')
check('file carries no uuid', !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(src))
check('messages carry no digits', [...src.matchAll(/RAISE EXCEPTION '([^']*)'/g)].every(m => !/\d/.test(m[1])))

console.log(bad ? `\n${bad} FAILED` : '\nall passed')
process.exit(bad ? 1 : 0)
