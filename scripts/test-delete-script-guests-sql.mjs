// 20261162 (delete the script-made guests) against the PGlite harness (PostgreSQL 18; prod is older, see supabase/CLAUDE.md).
// Seeds the 70 ids from the real file plus bystanders, then flips one id at a time out of the signature: each must refuse
// and delete nothing. Says nothing about prod's triggers or FKs on auth.users: the file's own assertions roll back there.
// Not wired into CI, like its siblings: run by hand.
//
//   node scripts/test-delete-script-guests-sql.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { freshDb, applyFile } from './migration-harness.mjs'

const FILE = fileURLToPath(new URL('../supabase/migrations/20261162_delete_script_guests.sql', import.meta.url))
const IDS = [...new Set(readFileSync(FILE, 'utf8').match(/'[0-9a-f]{8}-[0-9a-f-]{27}'/g).map(x => x.slice(1, -1)))]
const ACCOUNT = 'a0000000-0000-4000-8000-000000000001', REAL_GUEST = 'a0000000-0000-4000-8000-000000000002', PROVIDER = 'a0000000-0000-4000-8000-000000000003'

const FIXTURE = `
ALTER TABLE auth.users ADD COLUMN is_anonymous boolean NOT NULL DEFAULT false, ADD COLUMN email text, ADD COLUMN created_at timestamptz DEFAULT now(),
  ADD COLUMN updated_at timestamptz DEFAULT now(), ADD COLUMN last_sign_in_at timestamptz, ADD COLUMN deleted_at timestamptz;
CREATE TABLE auth.sessions (id bigserial PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, user_agent text, refreshed_at timestamp);
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, role text NOT NULL DEFAULT 'customer', push_token text);
CREATE TABLE public.notifications (id bigserial PRIMARY KEY, user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE);
INSERT INTO auth.users (id, is_anonymous) SELECT unnest(ARRAY['${IDS.join("','")}']::uuid[]), true;
INSERT INTO auth.users (id, is_anonymous, email) VALUES ('${ACCOUNT}', false, 'a@example.com'), ('${REAL_GUEST}', true, NULL), ('${PROVIDER}', false, 'p@example.com');
INSERT INTO public.profiles (id) SELECT id FROM auth.users;
UPDATE public.profiles SET role = 'provider' WHERE id = '${PROVIDER}';
INSERT INTO auth.sessions (user_id, user_agent) SELECT unnest(ARRAY['${IDS.join("','")}']::uuid[]), 'node';
INSERT INTO auth.sessions (user_id, user_agent) VALUES ('${REAL_GUEST}', 'okhttp/4.12.0'), ('${ACCOUNT}', 'node');
INSERT INTO public.notifications (user_id) SELECT id FROM public.profiles;
`
let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
const count = async (d, sql) => Number((await d.query(`SELECT count(*) c FROM ${sql}`)).rows[0].c)

console.log('20261162 — real file')
{
  const d = await freshDb(FIXTURE)
  t('ids in the file', IDS.length, 70)
  t('applies', await applyFile(d, FILE), { ok: true, msg: null })
  t('all listed users gone', await count(d, `auth.users WHERE id = ANY(ARRAY['${IDS.join("','")}']::uuid[])`), 0)
  t('account, provider and real guest remain', await count(d, 'auth.users'), 3)
  t('their profiles and notifications remain', [await count(d, 'public.profiles'), await count(d, 'public.notifications')], [3, 3])
}

console.log('one id out of the signature: refuses, deletes nothing')
const X = IDS[0]
for (const [name, sql] of [
  ['it is signed-up', `UPDATE auth.users SET is_anonymous = false WHERE id = '${X}'`],
  ['it has an email', `UPDATE auth.users SET email = 'x@example.com' WHERE id = '${X}'`],
  ['it is a provider', `UPDATE public.profiles SET role = 'provider' WHERE id = '${X}'`],
  ['it has a push token', `UPDATE public.profiles SET push_token = 'tok' WHERE id = '${X}'`],
  ['it also has an app session', `INSERT INTO auth.sessions (user_id, user_agent) VALUES ('${X}', 'okhttp/4.12.0')`],
  ['its session was refreshed', `UPDATE auth.sessions SET refreshed_at = now() WHERE user_id = '${X}'`],
  ['it was used after creation', `UPDATE auth.users SET last_sign_in_at = now() + interval '1 hour' WHERE id = '${X}'`],
  ['its script session is gone', `DELETE FROM auth.sessions WHERE user_id = '${X}'`],
  ['it no longer exists', `DELETE FROM auth.users WHERE id = '${X}'`],
]) {
  const d = await freshDb(FIXTURE)
  await d.exec(sql)
  const before = await count(d, 'auth.users')
  const r = await applyFile(d, FILE)
  await d.exec('ROLLBACK; RESET ROLE;').catch(() => {})
  t(`${name}`, [r.ok, await count(d, 'auth.users')], [false, before])
}

console.log(bad ? `\nFAILED: ${bad}` : '\nall passed')
process.exit(bad ? 1 : 0)
