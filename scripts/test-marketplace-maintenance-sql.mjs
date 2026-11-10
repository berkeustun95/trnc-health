// 20261185 (Bandabuliya maintenance: retention RPCs + the daily cron) on top of 20261183/84, against the live
// messaging fixture plus Araçlar S1's prerequisites (scripts/fixtures/*.sql). PGlite = PostgreSQL 18; prod is 17.6.
//   node scripts/test-marketplace-maintenance-sql.mjs
// What a pass is evidence of: the SQL half — which rows the RPCs soft-delete, purge and list, who may call them,
// and that the job is scheduled. Not the Storage API removal (marketplace-maintenance's deno test), not pg_net,
// not pg_cron's timing: cron.schedule is stubbed here (the harness models no extensions).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { freshDb, applyFile } from './migration-harness.mjs'

const rel = p => fileURLToPath(new URL(p, import.meta.url))
const BASE = readFileSync(rel('./fixtures/messaging-live.sql'), 'utf8') + readFileSync(rel('./fixtures/marketplace-prereqs.sql'), 'utf8')
const FILES = ['20261183_marketplace_listings.sql', '20261184_marketplace_messaging.sql', '20261185_marketplace_maintenance.sql']
  .map(f => rel(`../supabase/migrations/${f}`))

const CRON_STUB = `
CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS $f$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING jobid $f$;
CREATE FUNCTION cron.unschedule(p_name text) RETURNS boolean LANGUAGE sql AS $f$
  WITH d AS (DELETE FROM cron.job WHERE jobname = p_name RETURNING 1) SELECT EXISTS (SELECT 1 FROM d) $f$;
`
const U = { A: 'a0000000-0000-4000-8000-00000000000a', B: 'b0000000-0000-4000-8000-00000000000b' }
const SEED = `
INSERT INTO auth.users VALUES ('${U.A}'), ('${U.B}');
INSERT INTO profiles (id, display_name, date_of_birth, role) VALUES
  ('${U.A}', 'Ayla', '1990-01-01', 'customer'), ('${U.B}', 'Burak', '1991-02-02', 'customer');
INSERT INTO storage.buckets (id, name) VALUES ('marketplace-photos', 'marketplace-photos') ON CONFLICT DO NOTHING;
`

async function run(db, role, sql) {
  try {
    await db.exec(`SET role ${role};`)
    const r = await db.query(sql)
    return { ok: true, rows: r.rows, value: r.rows[0] ? Object.values(r.rows[0])[0] : null }
  } catch (e) { return { ok: false, err: e.message } } finally { await db.exec('RESET role;') }
}

// A listing in a given state, written as postgres with the guard's trusted switch on (what the server functions do).
let seq = 0
// Photos are added while the listing is live: the insert guard refuses them on a deleted one.
async function listing(db, { deletedDaysAgo = null, expiredDaysAgo = null, owner = 'A', photos = 0 } = {}) {
  const id = `e0000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`
  await db.exec(`SELECT set_config('request.jwt.claims', '{"sub":"${U[owner]}"}', false);
    INSERT INTO marketplace_listings (id, owner_id, title, description, price_tl, is_free, category, condition, district)
    VALUES ('${id}', '${U[owner]}', 'Bisiklet satılık', 'Az kullanılmış, temiz bisiklet.', 1500, false, 'sports', 'used', 'kyrenia');`)
  for (let p = 0; p < photos; p++) await photo(db, id, p, { owner })
  await db.exec(`SELECT set_config('app.trusted_marketplace', 'on', false);
    UPDATE marketplace_listings SET
      deleted_at = ${deletedDaysAgo == null ? 'NULL' : `now() - interval '${deletedDaysAgo} days'`},
      expires_at = ${expiredDaysAgo == null ? 'expires_at' : `now() - interval '${expiredDaysAgo} days'`}
    WHERE id = '${id}';
    SELECT set_config('app.trusted_marketplace', 'off', false);`)
  return id
}
const photo = (db, lid, pos, { status = 'pending', owner = 'A' } = {}) => db.exec(`
  SELECT set_config('request.jwt.claims', '{"sub":"${U[owner]}"}', false);
  INSERT INTO marketplace_photos (listing_id, position, storage_path) VALUES ('${lid}', ${pos}, 'pending/${U[owner]}/${lid}/${pos}.jpg');
  UPDATE marketplace_photos SET status = '${status}' WHERE listing_id = '${lid}' AND position = ${pos};`)
const object = (db, name, hoursAgo) =>
  db.exec(`INSERT INTO storage.objects (bucket_id, name, created_at) VALUES ('marketplace-photos', '${name}', now() - interval '${hoursAgo} hours')`)
const exists = async (db, id) => (await db.query(`SELECT count(*)::int n FROM marketplace_listings WHERE id = '${id}'`)).rows[0].n === 1
const deletedAt = async (db, id) => (await db.query(`SELECT deleted_at FROM marketplace_listings WHERE id = '${id}'`)).rows[0]?.deleted_at ?? null

async function build() {
  const db = await freshDb(BASE + CRON_STUB + SEED)
  for (const f of FILES) {
    const r = await applyFile(db, f)
    if (!r.ok) throw new Error(`apply ${f.split('/').pop()} failed: ${r.msg}`)
  }
  return db
}

let failed = 0
const check = (name, ok, got) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  got: ' + JSON.stringify(got)}`) }
const MAINT = apply => `SELECT public.marketplace_maintenance(${apply}) AS r`

const CASES = [
  // ── who may call ──
  ['authenticated and anon cannot run maintenance or list orphans', async db =>
    !(await run(db, 'authenticated', MAINT(false))).ok && !(await run(db, 'anon', MAINT(false))).ok
    && !(await run(db, 'authenticated', 'SELECT * FROM public.marketplace_orphan_objects(10)')).ok],
  ['service_role can (positive control)', async db =>
    (await run(db, 'service_role', MAINT(false))).ok && (await run(db, 'service_role', 'SELECT * FROM public.marketplace_orphan_objects(10)')).ok],

  // ── retention rules ──
  ['expired > 90 days → soft-deleted; expired 89 days and live listings untouched', async db => {
    const old = await listing(db, { expiredDaysAgo: 91 }), recent = await listing(db, { expiredDaysAgo: 89 }), live = await listing(db)
    const r = await run(db, 'service_role', MAINT(true))
    return r.ok && r.value.expired_soft_deleted === 1 && (await deletedAt(db, old)) !== null
      && (await deletedAt(db, recent)) === null && (await deletedAt(db, live)) === null
  }],
  ['deleted > 30 days → purged with its photo rows; deleted 29 days kept', async db => {
    const old = await listing(db, { deletedDaysAgo: 31, photos: 2 }), recent = await listing(db, { deletedDaysAgo: 29 })
    const r = await run(db, 'service_role', MAINT(true))
    const photosLeft = (await db.query(`SELECT count(*)::int n FROM marketplace_photos WHERE listing_id = '${old}'`)).rows[0].n
    return r.ok && r.value.purged === 1 && !(await exists(db, old)) && (await exists(db, recent)) && photosLeft === 0
  }],
  ['a pending report holds the purge; an actioned one does not', async db => {
    const held = await listing(db, { deletedDaysAgo: 40 }), done = await listing(db, { deletedDaysAgo: 40 })
    await db.exec(`INSERT INTO content_reports (reporter_id, content_type, content_id, reason, status) VALUES
      ('${U.B}', 'listing', '${held}', 'spam', 'pending'), ('${U.B}', 'listing', '${done}', 'spam', 'actioned')`)
    const r = await run(db, 'service_role', MAINT(true))
    return r.ok && r.value.purge_held_by_report === 1 && (await exists(db, held)) && !(await exists(db, done))
  }],
  ['a purge keeps the chat: the thread stays, its listing_id becomes NULL', async db => {
    const lid = await listing(db, { deletedDaysAgo: 31 })
    await db.exec(`INSERT INTO conversations (id, initiator_id, recipient_id, kind, listing_id)
      VALUES ('f0000000-0000-4000-8000-000000000001', '${U.B}', '${U.A}', 'listing', '${lid}')`)
    const r = await run(db, 'service_role', MAINT(true))
    const c = (await db.query(`SELECT listing_id FROM conversations WHERE id = 'f0000000-0000-4000-8000-000000000001'`)).rows
    return r.ok && c.length === 1 && c[0].listing_id === null
  }],
  ['dry run (apply = false) counts but changes nothing', async db => {
    const exp = await listing(db, { expiredDaysAgo: 120 }), del = await listing(db, { deletedDaysAgo: 60 })
    const r = await run(db, 'service_role', MAINT(false))
    return r.ok && r.value.expired_soft_deleted === 1 && r.value.purged === 1 && r.value.applied === false
      && (await deletedAt(db, exp)) === null && (await exists(db, del))
  }],

  // ── orphan objects ──
  ['orphans: no row and older than 24 h (pending/ and approved/); a fresh upload and a live row are kept', async db => {
    const lid = await listing(db)
    await photo(db, lid, 0)
    await object(db, `pending/${U.A}/${lid}/0.jpg`, 48)              // has its row → kept
    await object(db, `pending/${U.A}/${lid}/9.jpg`, 48)              // no row, old → orphan
    await object(db, `approved/${U.A}/${lid}/x.jpg`, 48)             // no row, old → orphan
    await object(db, `pending/${U.A}/${lid}/8.jpg`, 2)               // no row yet, fresh → kept (upload in flight)
    await db.exec(`INSERT INTO storage.objects (bucket_id, name, created_at) VALUES ('avatars', 'x/old.jpg', now() - interval '9 days')`)
    const r = await run(db, 'service_role', 'SELECT * FROM public.marketplace_orphan_objects(100) ORDER BY 1')
    const names = (r.rows ?? []).map(x => Object.values(x)[0])
    return r.ok && names.length === 2 && names.every(n => n.endsWith('9.jpg') || n.startsWith('approved/'))
  }],
  ['orphans: a rejected row does not shelter its file', async db => {
    const lid = await listing(db)
    await photo(db, lid, 1, { status: 'rejected' })
    await object(db, `pending/${U.A}/${lid}/1.jpg`, 48)
    const r = await run(db, 'service_role', 'SELECT * FROM public.marketplace_orphan_objects(100)')
    return r.ok && r.rows.length === 1
  }],
  ['orphans: the limit is honoured', async db => {
    for (let i = 0; i < 5; i++) await object(db, `pending/${U.A}/e0000000-0000-4000-8000-000000000999/${i}.jpg`, 30)
    const r = await run(db, 'service_role', 'SELECT * FROM public.marketplace_orphan_objects(3)')
    return r.ok && r.rows.length === 3
  }],

  ['a second apply succeeds and leaves one job', async db => {
    const r = await applyFile(db, FILES[2])
    return r.ok && (await db.query(`SELECT count(*)::int n FROM cron.job WHERE jobname = 'marketplace-maintenance'`)).rows[0].n === 1
  }],

  // ── schedule ──
  ['the daily job is scheduled and posts {"apply": true} with the Vault key', async db => {
    const j = (await db.query(`SELECT schedule, command FROM cron.job WHERE jobname = 'marketplace-maintenance'`)).rows[0]
    return !!j && /^\d+ \d+ \* \* \*$/.test(j.schedule) && j.command.includes('/functions/v1/marketplace-maintenance')
      && j.command.includes(`"apply": true`) && j.command.includes(`name = 'novest_sync_key'`)
  }],
]

for (const [name, fn] of CASES) {
  let ok = false, got
  try { const db = await build(); ok = await fn(db); await db.close() } catch (e) { got = e.message }
  check(name, ok, got)
}

// Red controls: the assertions must be able to fail.
{
  let refused = false
  try {
    const db = await freshDb(BASE + CRON_STUB + SEED)
    for (const f of FILES.slice(0, 2)) await applyFile(db, f)
    await db.exec(`ALTER TABLE public.conversations DROP CONSTRAINT conversations_listing_id_fkey;
      ALTER TABLE public.conversations ADD CONSTRAINT conversations_listing_id_fkey FOREIGN KEY (listing_id)
      REFERENCES public.marketplace_listings(id) ON DELETE CASCADE`)
    const r = await applyFile(db, FILES[2])
    refused = !r.ok && /ON DELETE SET NULL/.test(r.msg)
  } catch (e) { refused = /ON DELETE SET NULL/.test(e.message) }
  check('red: a CASCADE chat link (purge would delete chats) → refused', refused)
}
{
  let refused = false
  try {
    const db = await freshDb(BASE + CRON_STUB + SEED)
    const r = await applyFile(db, FILES[2])
    refused = !r.ok && /20261183/.test(r.msg)
  } catch (e) { refused = /20261183/.test(e.message) }
  check('red: 20261183 not applied → refused', refused)
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
