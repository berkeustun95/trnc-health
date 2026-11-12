// 20261192 (notifications.listing_id) against the PGlite harness (PostgreSQL 18; prod is older, see supabase/CLAUDE.md), on the live
// messaging fixture + Araçlar S1 prerequisites (scripts/fixtures/*.sql, which now also models notifications' RLS policies and the
// 20261088 column grants as the repo migrations leave them) + 20261183/84/85/90 + 20261192.
//   node scripts/test-notifications-listing-id-sql.mjs
// What a pass is evidence of: the column / FK / index shape, who can read and write the column (by role, with a positive control
// beside every denial), that a deleted listing or a deleted seller leaves the notice (or removes it with its owner) without an
// error, and that the migration refuses cleanly on a database it was not written for. NOT evidence of: prod's older Postgres
// (error codes and cascade trigger order are read from this PG 18 catalog), PostgREST's schema cache, or the triggers prod has on
// profiles (the fixture's profiles has none; delete_own_account is the 20261004 body from the repo, with stub facilities/reviews).
// Each case runs in a transaction that is rolled back, so one database serves them all.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile } from './migration-harness.mjs'

const rel = p => fileURLToPath(new URL(p, import.meta.url))
const MIG = f => rel(`../supabase/migrations/${f}`)
const BASE = readFileSync(rel('./fixtures/messaging-live.sql'), 'utf8') + readFileSync(rel('./fixtures/marketplace-prereqs.sql'), 'utf8')
const PRE = ['20261183_marketplace_listings.sql', '20261184_marketplace_messaging.sql', '20261185_marketplace_maintenance.sql', '20261190_marketplace_terms.sql']
const THIS = '20261192_notifications_listing_id.sql'

function slice(file, head, close) {
  const t = readFileSync(MIG(file), 'utf8')
  const s = t.indexOf(head)
  if (s < 0) throw new Error(`${file}: ${head} not found`)
  return t.slice(s, t.indexOf(close, t.indexOf(close, s) + close.length) + close.length) + ';'
}
const DELETE_OWN = slice('20261004_appointments_removal.sql', 'CREATE OR REPLACE FUNCTION public.delete_own_account()', '$function$')
const CRON_STUB = `
CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS $f$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING jobid $f$;
CREATE FUNCTION cron.unschedule(p_name text) RETURNS boolean LANGUAGE sql AS $f$
  WITH d AS (DELETE FROM cron.job WHERE jobname = p_name RETURNING 1) SELECT EXISTS (SELECT 1 FROM d) $f$;
`
const U = { A: 'a0000000-0000-4000-8000-00000000000a', B: 'b0000000-0000-4000-8000-00000000000b', C: 'c0000000-0000-4000-8000-00000000000c' }
const INST = '30000000-0000-4000-8000-000000000003'
const SEED = `
CREATE TABLE public.facilities (id uuid, provider_id uuid);
CREATE TABLE public.reviews (id uuid, facility_id uuid, customer_id uuid);
${DELETE_OWN}
INSERT INTO auth.users VALUES ${Object.values(U).map(u => `('${u}')`).join(',')};
INSERT INTO profiles (id, display_name, date_of_birth, role, terms_version, push_token) VALUES
  ('${U.A}', 'Ayla', '1990-01-01', 'customer', '2026-11-11', NULL), ('${U.B}', 'Burak', '1991-02-02', 'customer', '2026-11-11', 'ExponentPushToken[b]'),
  ('${U.C}', 'Cem', '1992-03-03', 'customer', '2026-11-11', NULL);
INSERT INTO storage.buckets (id, name) VALUES ('marketplace-photos', 'marketplace-photos') ON CONFLICT DO NOTHING;
INSERT INTO institutions VALUES ('${INST}', true);
INSERT INTO student_education (user_id, institution_id, level, listing_opt_in) VALUES
  ('${U.A}', '${INST}', 'university', true), ('${U.B}', '${INST}', 'university', true);
`

// ── helpers ──
// Run one statement as a role (+ JWT sub) inside a savepoint, so a refusal does not abort the case's transaction.
async function as(db, role, sub, sql) {
  await db.exec('SAVEPOINT stmt')
  try {
    await db.exec(`SET role ${role}; SELECT set_config('request.jwt.claims', '${sub ? JSON.stringify({ sub, role }) : ''}', false);`)
    const r = await db.query(sql)
    await db.exec('RESET role; RELEASE SAVEPOINT stmt')
    return { ok: true, rows: r.rows, n: r.affectedRows ?? r.rows.length }
  } catch (e) {
    await db.exec('ROLLBACK TO SAVEPOINT stmt; RESET role; RELEASE SAVEPOINT stmt')
    return { ok: false, code: e.code, err: e.message }
  }
}
const denied = r => !r.ok && r.code === '42501'
let seq = 0
const uuid = () => `e0000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`
async function listing(db, owner = 'A', deletedDaysAgo = null) {
  const id = uuid()
  await db.exec(`SELECT set_config('request.jwt.claims', '{"sub":"${U[owner]}"}', false);
    INSERT INTO marketplace_listings (id, owner_id, title, description, price_tl, is_free, category, condition, district)
    VALUES ('${id}', '${U[owner]}', 'Bisiklet satılık', 'Az kullanılmış, temiz bisiklet.', 1500, false, 'sports', 'used', 'kyrenia');`)
  if (deletedDaysAgo != null) await db.exec(`SELECT set_config('app.trusted_marketplace', 'on', false);
    UPDATE marketplace_listings SET deleted_at = now() - interval '${deletedDaysAgo} days' WHERE id = '${id}';
    SELECT set_config('app.trusted_marketplace', 'off', false);`)
  return id
}
const notice = async (db, owner, listingId, type = 'marketplace') => {
  const id = uuid()
  await db.exec(`INSERT INTO notifications (id, user_id, title, body, type, listing_id) VALUES
    ('${id}', '${U[owner]}', 'Bandabuliya', 'x', '${type}', ${listingId ? `'${listingId}'` : 'NULL'})`)
  return id
}
const row = async (db, id) => (await db.query(`SELECT listing_id, user_id FROM notifications WHERE id = '${id}'`)).rows[0] ?? null
const count = async (db, sql) => (await db.query(sql)).rows[0].n

async function build({ order = null } = {}) {
  const db = await freshDb(BASE + CRON_STUB + SEED)
  for (const f of [...PRE, THIS]) {
    const r = await applyFile(db, MIG(f))
    if (!r.ok) throw new Error(`apply ${f} failed: ${r.msg}`)
  }
  if (order) {
    const notifs = `ALTER TABLE public.notifications DROP CONSTRAINT notifications_user_id_fkey;
      ALTER TABLE public.notifications ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;`
    const lists = `ALTER TABLE public.marketplace_listings DROP CONSTRAINT marketplace_listings_owner_id_fkey;
      ALTER TABLE public.marketplace_listings ADD CONSTRAINT marketplace_listings_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE;`
    await db.exec(order === 'listingsFirst' ? lists + notifs : notifs + lists)  // created first = fires first (trigger names sort by OID)
  }
  return db
}
// Which profile cascade fires first, read from the catalog (same-event triggers fire in name order).
async function cascadeOrder(db) {
  return (await db.query(`SELECT c.conrelid::regclass::text t FROM pg_trigger tg JOIN pg_constraint c ON c.oid = tg.tgconstraint
    WHERE tg.tgrelid = 'public.profiles'::regclass AND c.contype = 'f' AND c.conname IN ('notifications_user_id_fkey', 'marketplace_listings_owner_id_fkey')
      AND tg.tgfoid = '"RI_FKey_cascade_del"'::regproc ORDER BY tg.tgname`)).rows.map(r => r.t)
}

let failed = 0
const check = (name, ok, got) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  got: ' + JSON.stringify(got)}`) }

// A case runs in BEGIN … ROLLBACK on the shared database.
const CASES = [
  // ── shape ──
  ['column: uuid, nullable; FK is SET NULL to marketplace_listings(id); partial index on it; no triggers on notifications', async db => {
    const c = (await db.query(`SELECT format_type(atttypid, atttypmod) t, attnotnull nn FROM pg_attribute WHERE attrelid = 'public.notifications'::regclass AND attname = 'listing_id'`)).rows[0]
    const fk = (await db.query(`SELECT confdeltype, confrelid::regclass::text rel FROM pg_constraint WHERE conname = 'notifications_listing_id_fkey' AND conrelid = 'public.notifications'::regclass`)).rows[0]
    const ix = (await db.query(`SELECT indpred IS NOT NULL p FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = 'notifications_listing_id_idx'`)).rows[0]
    const trg = await count(db, `SELECT count(*)::int n FROM pg_trigger WHERE tgrelid = 'public.notifications'::regclass AND NOT tgisinternal`)
    return c?.t === 'uuid' && c.nn === false && fk?.confdeltype === 'n' && fk.rel === 'marketplace_listings' && ix?.p === true && trg === 0
  }],
  ['the migration is recorded in the ledger (stamp last)', async db =>
    (await count(db, `SELECT count(*)::int n FROM schema_migrations_applied WHERE filename = '${THIS}'`)) === 1],

  // ── who can read / write the column ──
  ['owner reads listing_id on their own notice; another user sees no such row (positive control: that user reads their own)', async db => {
    const l = await listing(db), n = await notice(db, 'A', l), nb = await notice(db, 'B', null)
    const own = await as(db, 'authenticated', U.A, `SELECT listing_id FROM notifications WHERE id = '${n}'`)
    const other = await as(db, 'authenticated', U.B, `SELECT listing_id FROM notifications WHERE id = '${n}'`)
    const ctl = await as(db, 'authenticated', U.B, `SELECT id FROM notifications WHERE id = '${nb}'`)
    return own.ok && own.rows.length === 1 && own.rows[0].listing_id === l && other.ok && other.rows.length === 0 && ctl.ok && ctl.rows.length === 1
  }],
  ['authenticated INSERT carrying listing_id is refused (42501); the same insert as service_role works', async db => {
    const l = await listing(db)
    const sql = `INSERT INTO notifications (user_id, title, body, type, listing_id) VALUES ('${U.A}', 'x', 'x', 'marketplace', '${l}')`
    const a = await as(db, 'authenticated', U.A, sql), n = await as(db, 'anon', null, sql), s = await as(db, 'service_role', null, sql)
    return denied(a) && denied(n) && s.ok
  }],
  ['authenticated UPDATE of listing_id is refused (42501); UPDATE of read still works on the owner\'s row; another user\'s row is untouched', async db => {
    const l = await listing(db), n = await notice(db, 'A', l)
    const bad = await as(db, 'authenticated', U.A, `UPDATE notifications SET listing_id = NULL WHERE id = '${n}'`)
    const badAnon = await as(db, 'anon', null, `UPDATE notifications SET listing_id = NULL WHERE id = '${n}'`)
    const okRead = await as(db, 'authenticated', U.A, `UPDATE notifications SET read = true WHERE id = '${n}'`)
    const other = await as(db, 'authenticated', U.B, `UPDATE notifications SET read = true WHERE id = '${n}'`)
    const r = (await db.query(`SELECT read, listing_id FROM notifications WHERE id = '${n}'`)).rows[0]
    return denied(bad) && denied(badAnon) && okRead.ok && okRead.n === 1 && other.ok && other.n === 0 && r.read === true && r.listing_id === l
  }],
  ['service_role: insert with a real listing id works; with a non-existent id fails on the FK (23503)', async db => {
    const l = await listing(db)
    const mk = id => `INSERT INTO notifications (user_id, title, body, type, listing_id) VALUES ('${U.A}', 'x', 'x', 'marketplace', '${id}')`
    const good = await as(db, 'service_role', null, mk(l)), bad = await as(db, 'service_role', null, mk(uuid()))
    return good.ok && !bad.ok && bad.code === '23503'
  }],
  ['owner can still delete their own notice, not someone else\'s (1089 unchanged)', async db => {
    const l = await listing(db), n = await notice(db, 'A', l), nb = await notice(db, 'B', l)
    const own = await as(db, 'authenticated', U.A, `DELETE FROM notifications WHERE id = '${n}'`)
    const other = await as(db, 'authenticated', U.A, `DELETE FROM notifications WHERE id = '${nb}'`)
    return own.ok && own.n === 1 && other.ok && other.n === 0 && (await row(db, nb)) !== null && (await row(db, n)) === null
  }],

  // ── a deleted listing leaves the notice ──
  ['hard-deleting the listing keeps the notice with listing_id NULL (positive control: it was set before)', async db => {
    const l = await listing(db), n = await notice(db, 'A', l)
    const before = (await row(db, n)).listing_id
    await db.exec(`DELETE FROM marketplace_listings WHERE id = '${l}'`)
    const after = await row(db, n)
    return before === l && after !== null && after.listing_id === null
  }],
  ['the nightly purge (marketplace_maintenance) keeps the notice with listing_id NULL; a live listing\'s notice keeps its id', async db => {
    const old = await listing(db, 'A', 31), live = await listing(db, 'A')
    const n1 = await notice(db, 'A', old), n2 = await notice(db, 'A', live)
    const r = await as(db, 'service_role', null, `SELECT public.marketplace_maintenance(true) AS r`)
    const gone = await count(db, `SELECT count(*)::int n FROM marketplace_listings WHERE id = '${old}'`)
    return r.ok && r.rows[0].r.purged >= 1 && gone === 0 && (await row(db, n1)).listing_id === null && (await row(db, n2)).listing_id === live
  }],

  // ── existing writers unchanged ──
  ['a Student Hub notice (start_conversation → notify_new_message) still works and has listing_id NULL', async db => {
    const r = await as(db, 'authenticated', U.A, `SELECT start_conversation('${U.B}', 'merhaba')`)
    const n = (await db.query(`SELECT type, listing_id, conversation_id FROM notifications WHERE user_id = '${U.B}'`)).rows
    return r.ok && n.length === 1 && n[0].type === 'message' && n[0].listing_id === null && n[0].conversation_id !== null
  }],

  // ── ACCOUNT DELETION: the FK shape that broke it three times. A seller owning a listing AND a notice pointing at it. ──
  ['DELETE FROM auth.users (seller with a listing and a notice on it): succeeds; the seller\'s rows go; another user\'s notice on that listing stays with NULL', async db => {
    const l = await listing(db, 'A'), mine = await notice(db, 'A', l), plain = await notice(db, 'A', null), theirs = await notice(db, 'B', l)
    await db.exec(`DELETE FROM auth.users WHERE id = '${U.A}'`)
    return (await row(db, mine)) === null && (await row(db, plain)) === null
      && (await count(db, `SELECT count(*)::int n FROM marketplace_listings WHERE id = '${l}'`)) === 0
      && (await row(db, theirs))?.listing_id === null
  }],
  ['delete_own_account() as the seller (the app\'s path): succeeds, same outcome', async db => {
    const l = await listing(db, 'A'), mine = await notice(db, 'A', l), theirs = await notice(db, 'B', l)
    const r = await as(db, 'authenticated', U.A, `SELECT public.delete_own_account()`)
    return r.ok && (await row(db, mine)) === null && (await row(db, theirs))?.listing_id === null
      && (await count(db, `SELECT count(*)::int n FROM auth.users WHERE id = '${U.A}'`)) === 0
  }],
  ['a seller with a soft-deleted listing and a notice on it can be deleted too (purge-pending state)', async db => {
    const l = await listing(db, 'A', 5), mine = await notice(db, 'A', l)
    await db.exec(`DELETE FROM auth.users WHERE id = '${U.A}'`)
    return (await row(db, mine)) === null && (await count(db, `SELECT count(*)::int n FROM marketplace_listings WHERE id = '${l}'`)) === 0
  }],
]

async function runCases(label, db) {
  for (const [name, fn] of CASES) {
    let ok = false, got
    try { await db.exec('BEGIN'); ok = await fn(db) } catch (e) { got = e.message }
    finally { await db.exec('ROLLBACK; RESET role').catch(() => {}) }
    check(`[${label}] ${name}`, ok, got)
  }
}

const main = await build()
console.log('default build: profiles cascade order =', JSON.stringify(await cascadeOrder(main)))
await runCases('default', main)
check('rollback left nothing behind (no notifications, no listings)',
  (await count(main, `SELECT (SELECT count(*) FROM notifications)::int + (SELECT count(*) FROM marketplace_listings)::int n`)) === 0)
check('a second apply of 20261192 succeeds and leaves one ledger row, one FK, one index', await (async () => {
  const r = await applyFile(main, MIG(THIS))
  return r.ok
    && (await count(main, `SELECT count(*)::int n FROM schema_migrations_applied WHERE filename = '${THIS}'`)) === 1
    && (await count(main, `SELECT count(*)::int n FROM pg_constraint WHERE conname = 'notifications_listing_id_fkey'`)) === 1
    && (await count(main, `SELECT count(*)::int n FROM pg_indexes WHERE indexname = 'notifications_listing_id_idx'`)) === 1
})())

// Both cascade orders out of profiles (read from the catalog, so the claim is "these two really differ").
const orders = {}
for (const order of ['listingsFirst', 'notifsFirst']) {
  const db = await build({ order })
  orders[order] = await cascadeOrder(db)
  const want = order === 'listingsFirst' ? ['marketplace_listings', 'notifications'] : ['notifications', 'marketplace_listings']
  check(`[${order}] profiles cascade fires ${want.join(' then ')} (derived from pg_trigger)`, JSON.stringify(orders[order]) === JSON.stringify(want), orders[order])
  await runCases(order, db)
  await db.close()
}

// ── pre-flight refusals: clean, named, and nothing left behind ──
async function refuses(name, prepare, pattern) {
  let ok = false, got
  try {
    const db = await freshDb(BASE + CRON_STUB + SEED)
    await prepare(db)
    const r = await applyFile(db, MIG(THIS))
    await db.exec('ROLLBACK; RESET ROLE').catch(() => {})
    const col = await count(db, `SELECT count(*)::int n FROM information_schema.columns WHERE table_name = 'notifications' AND column_name = 'listing_id'`)
    const led = await count(db, `SELECT count(*)::int n FROM schema_migrations_applied WHERE filename = '${THIS}'`)
    got = { msg: r.msg, col, led }
    ok = !r.ok && pattern.test(r.msg) && /Nothing applied|REFUSING/.test(r.msg) && col === 0 && led === 0
    await db.close()
  } catch (e) { got = e.message }
  check(name, ok, got)
}
const applyAll = async db => { for (const f of PRE) { const r = await applyFile(db, MIG(f)); if (!r.ok) throw new Error(f + ': ' + r.msg) } }
await refuses('refuses cleanly when marketplace_listings is absent (20261183 not applied)', async () => {}, /REFUSING: .*marketplace_listings is missing/)
await refuses('refuses cleanly when 20261088 is not recorded', async db => {
  await applyAll(db); await db.exec(`DELETE FROM schema_migrations_applied WHERE filename = '20261088_notifications_lock_client_writes.sql'`)
}, /REFUSING: 20261088 is not recorded/)
await refuses('refuses cleanly when notifications has a trigger', async db => {
  await applyAll(db)
  await db.exec(`CREATE FUNCTION public._t() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$;
    CREATE TRIGGER t_probe BEFORE UPDATE ON public.notifications FOR EACH ROW EXECUTE FUNCTION public._t()`)
}, /REFUSING: notifications has triggers/)

// ── red-first: the in-file assertions must be able to fail ──
async function mutated(name, prepare, transform, pattern, { prepCreatesColumn = false } = {}) {
  let ok = false, got
  try {
    const db = await freshDb(BASE + CRON_STUB + SEED)
    await applyAll(db)
    await prepare(db)
    let sql = readFileSync(MIG(THIS), 'utf8')
    const out = transform(sql)
    if (out === sql) throw new Error('mutation anchor missing')
    const dir = mkdtempSync(join(tmpdir(), 'lid-')), f = join(dir, 'mut.sql')
    writeFileSync(f, out)
    const r = await applyFile(db, f)
    await db.exec('ROLLBACK; RESET ROLE').catch(() => {})
    const led = await count(db, `SELECT count(*)::int n FROM schema_migrations_applied WHERE filename = '${THIS}'`)
    const col = await count(db, `SELECT count(*)::int n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'listing_id'`)
    const fk = (await db.query(`SELECT confdeltype::text d FROM pg_constraint WHERE conrelid = 'public.notifications'::regclass AND conname = 'notifications_listing_id_fkey'`)).rows.map(x => x.d)
    got = { msg: r.msg, led, col, fk, prepCreatesColumn }
    // refused = no ledger row; the file altered nothing: column absent, or (when prepare made it) still there with its FK untouched
    const unchanged = prepCreatesColumn ? col === 1 && fk.length === 1 && fk[0] === 'c' : col === 0
    ok = !r.ok && pattern.test(r.msg) && led === 0 && unchanged
    await db.close()
  } catch (e) { got = e.message }
  check(name, ok, got)
}
await mutated('red: a client INSERT grant on the new column → the file refuses (a client could write it)', async () => {},
  s => s.replace(`COMMENT ON COLUMN public.notifications.listing_id`, `GRANT INSERT (listing_id) ON public.notifications TO authenticated;\nCOMMENT ON COLUMN public.notifications.listing_id`),
  /a client role can write notifications.listing_id/)
await mutated('red: a client UPDATE grant on the new column → refused', async () => {},
  s => s.replace(`COMMENT ON COLUMN public.notifications.listing_id`, `GRANT UPDATE (listing_id) ON public.notifications TO anon;\nCOMMENT ON COLUMN public.notifications.listing_id`),
  /a client role can write notifications.listing_id/)
await mutated('red: a leftover CASCADE foreign key on the column → refused', async db => {
  await db.exec(`ALTER TABLE public.notifications ADD COLUMN listing_id uuid;
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.marketplace_listings(id) ON DELETE CASCADE`)
}, s => s + '\n-- file unchanged: the prepared database is the mutation\n', /ON DELETE SET NULL/, { prepCreatesColumn: true })
await mutated('red: the file\'s FK without SET NULL (NO ACTION) → refused', async () => {},
  s => s.replace('REFERENCES public.marketplace_listings(id) ON DELETE SET NULL;', 'REFERENCES public.marketplace_listings(id);'),
  /ON DELETE SET NULL/)
await mutated('red: a policy added while the file runs → refused (policy set changed)', async () => {},
  s => s.replace(`COMMENT ON COLUMN public.notifications.listing_id`, `CREATE POLICY probe_extra ON public.notifications FOR SELECT TO authenticated USING (true);\nCOMMENT ON COLUMN public.notifications.listing_id`),
  /policy set changed/)
await mutated('red: the column created NOT NULL → refused', async () => {},
  s => s.replace('ADD COLUMN IF NOT EXISTS listing_id uuid;', 'ADD COLUMN IF NOT EXISTS listing_id uuid NOT NULL DEFAULT gen_random_uuid();'),
  /must be nullable uuid/)

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
