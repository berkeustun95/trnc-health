import { readFileSync } from 'node:fs'
// 20261087 against a fixture of the live shapes (probe 2026-10-06). PGlite = PG 18; prod is 17.6.
//   node scripts/test-notifications-conversation-sql.mjs
import { fileURLToPath } from 'node:url'
import { freshDb, applyFile } from './migration-harness.mjs'

const REPO = fileURLToPath(new URL('../supabase/migrations/', import.meta.url))
const m1066 = readFileSync(REPO + '20261066_notification_type.sql', 'utf8')
const i = m1066.indexOf('CREATE OR REPLACE FUNCTION public.notify_new_message(p_message_id uuid)')
const nnm = m1066.slice(i, m1066.indexOf('$function$;', i) + '$function$;'.length)

// Live shapes, from the 2026-10-06 probe (constraints quoted from pg_get_constraintdef).
const SEED = `
CREATE SCHEMA net;
CREATE FUNCTION net.http_post(url text, body jsonb, headers jsonb) RETURNS bigint LANGUAGE sql AS 'SELECT 1::bigint';
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  preferred_language text, push_token text);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL
  REFERENCES profiles(id) ON DELETE CASCADE, title text NOT NULL, body text NOT NULL, read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), type text,
  CONSTRAINT notifications_type_check CHECK ((type = ANY (ARRAY['duty'::text, 'message'::text, 'waitlist'::text, 'question'::text, 'admin_alert'::text, 'admin_message'::text, 'featured'::text, 'general'::text]))));
CREATE TABLE public.conversations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  initiator_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  recipient_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  closed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  accepted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES profiles(id) ON DELETE SET NULL, sender_display_name text, body text,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION public.delete_own_account() RETURNS void LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'auth' AS $f$
BEGIN
  DELETE FROM notifications WHERE user_id = auth.uid();
  DELETE FROM profiles      WHERE id      = auth.uid();
  DELETE FROM auth.users    WHERE id      = auth.uid();
END $f$;
${nnm}
REVOKE ALL ON FUNCTION public.notify_new_message(uuid) FROM PUBLIC, anon, authenticated;

INSERT INTO auth.users VALUES ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');
INSERT INTO profiles (id, preferred_language, push_token) VALUES
  ('11111111-1111-4111-8111-111111111111', 'Turkish', NULL), ('22222222-2222-4222-8222-222222222222', 'English', 'tok');
INSERT INTO conversations (id, initiator_id, recipient_id, accepted_at) VALUES
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', now());
`
const results = []
const check = (name, ok, got) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  got: ' + JSON.stringify(got)}`) }

// 0. Positive: the fixture's function body has the md5 the migration demands.
{
  const db = await freshDb(SEED)
  const md5 = (await db.query(`SELECT md5(prosrc) m FROM pg_proc WHERE proname = 'notify_new_message'`)).rows[0].m
  check('fixture body md5 = live md5', md5 === '9daa04e8ad5be2dd4c66ba4616bc2a32', md5)

  // a message + its notification in ONE transaction (backfill must match it exactly)
  await db.exec(`BEGIN;
    INSERT INTO messages (id, conversation_id, sender_id, sender_display_name, body) VALUES
      ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '11111111-1111-4111-8111-111111111111', 'Ali', 'merhaba');
    SELECT notify_new_message('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
    COMMIT;`)
  // and one 'message' row with no message behind it (unmatched)
  await db.exec(`INSERT INTO notifications (user_id, title, body, type, created_at) VALUES
    ('22222222-2222-4222-8222-222222222222', 'old', 'old', 'message', now() - interval '3 days')`)

  const r = await applyFile(db, REPO + '20261087_notifications_conversation_id.sql')
  check('migration applies', r.ok, r.msg)
  const rows = (await db.query(`SELECT title, conversation_id FROM notifications ORDER BY created_at`)).rows
  check('backfill: unmatched stays NULL', rows[0].conversation_id === null, rows)
  check('backfill: matched row gets the thread', rows[1].conversation_id === 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', rows)

  // the new function: row + push both carry it
  await db.exec(`CREATE TABLE _posts (body jsonb);
    CREATE OR REPLACE FUNCTION net.http_post(url text, body jsonb, headers jsonb) RETURNS bigint LANGUAGE sql AS 'INSERT INTO _posts VALUES (body) RETURNING 1::bigint';
    BEGIN;
    INSERT INTO messages (id, conversation_id, sender_id, sender_display_name, body) VALUES
      ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '11111111-1111-4111-8111-111111111111', 'Ali', 'ikinci');
    SELECT notify_new_message('ffffffff-ffff-4fff-8fff-ffffffffffff');
    COMMIT;`)
  const post = (await db.query(`SELECT body->'data' d FROM _posts`)).rows[0]?.d
  check('push data = screen/type/conversation_id', post?.screen === 'conversation' && post?.type === 'message' && post?.conversation_id === 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', post)
  const n = (await db.query(`SELECT conversation_id FROM notifications WHERE body = 'ikinci'`)).rows[0]
  check('new row carries the thread', n?.conversation_id === 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', n)
  const users = (await db.query(`SELECT count(*)::int c FROM auth.users`)).rows[0].c
  check('deletion test rolled back (both users still exist)', users === 2, users)

  const again = await applyFile(db, REPO + '20261087_notifications_conversation_id.sql')
  check('second apply is a clean re-run', again.ok, again.msg)
  const rows2 = (await db.query(`SELECT count(*)::int c FROM notifications WHERE conversation_id IS NOT NULL`)).rows[0].c
  check('… and changes nothing (2 linked rows)', rows2 === 2, rows2)
}

// 0b. Red: a body that is neither 20261066's nor this file's → refused.
{
  const db = await freshDb(SEED + `CREATE OR REPLACE FUNCTION public.notify_new_message(p_message_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$BEGIN NULL; END$f$;`)
  const r = await applyFile(db, REPO + '20261087_notifications_conversation_id.sql')
  check('drifted body → refused', !r.ok && /REFUSING: live notify_new_message body/.test(r.msg), r.msg)
}

// 1. Red: a trigger on notifications → refused before anything happens.
{
  const db = await freshDb(SEED + `CREATE FUNCTION t() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END';
    CREATE TRIGGER x BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION t();`)
  const r = await applyFile(db, REPO + '20261087_notifications_conversation_id.sql')
  check('trigger on notifications → refused', !r.ok && /has triggers/.test(r.msg), r.msg)
}

// 2. Red: a delete path that breaks (leg labelled) — a trigger on conversations deletion.
{
  const db = await freshDb(SEED + `CREATE FUNCTION nodel() RETURNS trigger LANGUAGE plpgsql AS $f$BEGIN RAISE EXCEPTION 'no deletes'; END$f$;
    CREATE TRIGGER nodel BEFORE DELETE ON conversations FOR EACH ROW EXECUTE FUNCTION nodel();`)
  const r = await applyFile(db, REPO + '20261087_notifications_conversation_id.sql')
  check('broken conversation delete → leg B named', !r.ok && /leg \[B: DELETE FROM conversations\]/.test(r.msg), r.msg)
  await db.exec('ROLLBACK; RESET ROLE;')
  const col = (await db.query(`SELECT count(*)::int c FROM information_schema.columns WHERE table_name = 'notifications' AND column_name = 'conversation_id'`)).rows[0].c
  check('… and nothing applied (column absent)', col === 0, col)
}

// 3. Red: a CHECK the SET NULL would trip (the 20261029 bug class) → leg B fails.
{
  const db = await freshDb(SEED)
  // drop in the CHECK after the column exists: apply once is impossible, so emulate by pre-creating the column + CHECK
  await db.exec(`ALTER TABLE notifications ADD COLUMN conversation_id uuid;
    ALTER TABLE notifications ADD CONSTRAINT bad CHECK (type IS DISTINCT FROM 'message' OR conversation_id IS NOT NULL);`)
  const r = await applyFile(db, REPO + '20261087_notifications_conversation_id.sql')
  check('SET NULL tripping a CHECK → leg B named', !r.ok && /leg \[B/.test(r.msg), r.msg)
}

console.log(results.every(Boolean) ? `\nALL ${results.length} PASS` : `\n${results.filter(x => !x).length} FAILED`)
process.exit(results.every(Boolean) ? 0 : 1)
