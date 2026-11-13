// 20261196 (Bandabuliya: remind admins when listing photos wait for review) on top of the whole marketplace chain
// (20261183/84/85/90/92), against the live messaging fixture plus Araçlar S1's prerequisites (scripts/fixtures/*.sql).
// PGlite = PostgreSQL 18; prod is 17.6.
//   node scripts/test-marketplace-photo-reminder-sql.mjs              # cases + red-first mutants
//   node scripts/test-marketplace-photo-reminder-sql.mjs --no-mutants
// What a pass is evidence of: the SQL half — when the reminder sends, to whom, with which text, data and log rows,
// who may call it, and that the job row is written. Not pg_net (stubbed: net.calls records each post), not Expo,
// not pg_cron's timing (cron.schedule is stubbed), not the app's tap routing. Time passing is modelled by moving
// last_sent_at and the photos' created_at back together, never by sleeping.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freshDb, applyFile } from './migration-harness.mjs'

const rel = p => fileURLToPath(new URL(p, import.meta.url))
const MIG = f => rel(`../supabase/migrations/${f}`)
const BASE = readFileSync(rel('./fixtures/messaging-live.sql'), 'utf8') + readFileSync(rel('./fixtures/marketplace-prereqs.sql'), 'utf8')
const CHAIN = ['20261183_marketplace_listings.sql', '20261184_marketplace_messaging.sql', '20261185_marketplace_maintenance.sql',
  '20261190_marketplace_terms.sql', '20261192_notifications_listing_id.sql'].map(MIG)
const F196 = MIG('20261196_marketplace_photo_review_reminder.sql')
const SRC = readFileSync(F196, 'utf8')

const CRON_STUB = `
CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean NOT NULL DEFAULT true);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS $f$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING jobid $f$;
CREATE FUNCTION cron.unschedule(p_name text) RETURNS boolean LANGUAGE sql AS $f$
  WITH d AS (DELETE FROM cron.job WHERE jobname = p_name RETURNING 1) SELECT EXISTS (SELECT 1 FROM d) $f$;
`
// push_log as 20260923 creates it (no CHECK on kind). pg_net's real signature (5 arguments, defaults), recording url/body/headers;
// it replaces the fixture's 3-argument stub, which records the body only.
const STUBS = `
CREATE TABLE public.push_log (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, kind text NOT NULL, request_id bigint,
  sent_at timestamptz NOT NULL DEFAULT now());
DROP FUNCTION net.http_post(text, jsonb, jsonb);
CREATE TABLE net.calls (id bigserial PRIMARY KEY, url text, body jsonb, headers jsonb);
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds integer DEFAULT 5000)
  RETURNS bigint LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO net.calls (url, body, headers) VALUES (url, body, headers);
  RETURN currval(pg_get_serial_sequence('net.calls', 'id'));
END $f$;
`
const U = {
  A:   'a0000000-0000-4000-8000-00000000000a',  // seller, customer, has a token
  C:   'c0000000-0000-4000-8000-00000000000c',  // customer with a token
  P:   'd0000000-0000-4000-8000-00000000000d',  // provider with a token
  AD1: 'ad000000-0000-4000-8000-000000000001',  // admin, token
  AD2: 'ad000000-0000-4000-8000-000000000002',  // admin, token
  AD3: 'ad000000-0000-4000-8000-000000000003',  // admin, NO token
}
const ADMINS = [U.AD1, U.AD2, U.AD3]
const TOKENS = { [U.A]: 'ExponentPushToken[seller]', [U.C]: 'ExponentPushToken[customer]', [U.P]: 'ExponentPushToken[provider]',
  [U.AD1]: 'ExponentPushToken[admin1]', [U.AD2]: 'ExponentPushToken[admin2]' }
const ROLES = { [U.A]: 'customer', [U.C]: 'customer', [U.P]: 'provider', [U.AD1]: 'admin', [U.AD2]: 'admin', [U.AD3]: 'admin' }
const seedSql = ({ admins = true } = {}) => {
  const ids = Object.keys(ROLES).filter(id => admins || ROLES[id] !== 'admin')
  return `INSERT INTO auth.users VALUES ${ids.map(id => `('${id}')`).join(', ')};
INSERT INTO profiles (id, display_name, date_of_birth, role, terms_version, push_token) VALUES
  ${ids.map((id, i) => `('${id}', 'User${i}', '1990-01-01', '${ROLES[id]}', '2026-11-11', ${TOKENS[id] ? `'${TOKENS[id]}'` : 'NULL'})`).join(',\n  ')};
INSERT INTO storage.buckets (id, name) VALUES ('marketplace-photos', 'marketplace-photos') ON CONFLICT DO NOTHING;`
}

async function build({ file = F196, admins = true } = {}) {
  const db = await freshDb(BASE + CRON_STUB + STUBS + seedSql({ admins }))
  for (const f of [...CHAIN, file]) {
    const r = await applyFile(db, f)
    if (!r.ok) throw new Error(`apply ${f.split('/').pop()} failed: ${r.msg}`)
  }
  return db
}

async function run(db, role, sql) {
  try {
    await db.exec(`SET role ${role};`)
    const r = await db.query(sql)
    return { ok: true, rows: r.rows, value: r.rows[0] ? Object.values(r.rows[0])[0] : null }
  } catch (e) { return { ok: false, err: e.message } } finally { await db.exec('RESET role;') }
}
const q = async (db, sql) => (await db.query(sql)).rows
const n = async (db, sql) => (await q(db, sql))[0].n

// A live listing of the seller's, written through the guards as the seller would (jwt claims set, postgres role).
let seq = 0
async function listing(db) {
  const id = `e0000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`
  await db.exec(`SELECT set_config('request.jwt.claims', '{"sub":"${U.A}"}', false);
    INSERT INTO marketplace_listings (id, owner_id, title, description, price_tl, is_free, category, condition, district)
    VALUES ('${id}', '${U.A}', 'Bisiklet satılık', 'Az kullanılmış, temiz bisiklet.', 1500, false, 'sports', 'used', 'kyrenia');`)
  return id
}
let pos = {}
async function photo(db, lid, status = 'pending') {
  const p = pos[lid] = (pos[lid] ?? -1) + 1
  await db.exec(`SELECT set_config('request.jwt.claims', '{"sub":"${U.A}"}', false);
    INSERT INTO marketplace_photos (listing_id, position, storage_path) VALUES ('${lid}', ${p}, 'pending/${U.A}/${lid}/${p}.jpg');
    ${status === 'pending' ? '' : `UPDATE marketplace_photos SET status = '${status}' WHERE listing_id = '${lid}' AND position = ${p};`}`)
}
const softDelete = (db, lid) => db.exec(`SELECT set_config('app.trusted_marketplace', 'on', false);
  UPDATE marketplace_listings SET deleted_at = now() WHERE id = '${lid}';
  SELECT set_config('app.trusted_marketplace', 'off', false);`)
// Time passes: the last reminder and every photo move back together (so old photos stay old relative to the stamp).
const pass = (db, min) => db.exec(`UPDATE marketplace_photo_reminder_state SET last_sent_at = last_sent_at - interval '${min} minutes';
  UPDATE marketplace_photos SET created_at = created_at - interval '${min} minutes';`)
const remind = db => run(db, 'service_role', 'SELECT public.marketplace_photo_review_reminder() AS n')
const totals = async db => ({
  notifs: await n(db, `SELECT count(*)::int n FROM notifications`),
  logs:   await n(db, `SELECT count(*)::int n FROM push_log`),
  calls:  await n(db, `SELECT count(*)::int n FROM net.calls`),
})
const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join()
const EXPECTED_DATA = { screen: 'admin', tab: 'marketplace', view: 'photos' }
const deepEq = (a, b) => JSON.stringify(a, Object.keys(a ?? {}).sort()) === JSON.stringify(b, Object.keys(b ?? {}).sort())
  && sameSet(Object.keys(a ?? {}), Object.keys(b ?? {}))

// One full send: n waiting → every admin a notice + a log row, every admin with a token one exact push, nobody else anything.
// Reads everything written so far: a case that sends twice calls clearSent() before the second send (clock-free, so two
// statements in the same millisecond cannot hide a row).
const clearSent = db => db.exec(`DELETE FROM notifications; DELETE FROM push_log; DELETE FROM net.calls;`)
async function sentTo(db, count) {
  const notifs = await q(db, `SELECT user_id::text u, title, body, type, listing_id FROM notifications`)
  const logs = await q(db, `SELECT user_id::text u, kind, request_id FROM push_log`)
  const calls = await q(db, `SELECT url, body, headers FROM net.calls`)
  const body = `${count} fotoğraf onay bekliyor`
  const why = []
  if (!sameSet(notifs.map(r => r.u), ADMINS)) why.push(['notice recipients', notifs.map(r => r.u)])
  if (!notifs.every(r => r.title === 'Bandabuliya' && r.body === body && r.type === 'admin_alert' && r.listing_id === null)) why.push(['notice text', notifs])
  if (!sameSet(logs.map(r => r.u), ADMINS) || !logs.every(r => r.kind === 'mk_photos_waiting')) why.push(['push_log', logs])
  if (logs.find(r => r.u === U.AD3)?.request_id !== null) why.push(['token-less admin logged with a request id', logs])
  if (!logs.filter(r => r.u !== U.AD3).every(r => r.request_id !== null)) why.push(['admin with a token logged without a request id', logs])
  if (!sameSet(calls.map(c => c.body.to), [TOKENS[U.AD1], TOKENS[U.AD2]])) why.push(['push recipients', calls.map(c => c.body.to)])
  for (const c of calls) {
    if (c.url !== 'https://exp.host/--/api/v2/push/send' || c.headers?.['Content-Type'] !== 'application/json'
        || c.body.title !== 'Bandabuliya' || c.body.body !== body || c.body.sound !== 'default' || !deepEq(c.body.data, EXPECTED_DATA)) why.push(['push shape', c])
  }
  return why
}
const lastStamp = async db => (await q(db, `SELECT last_sent_at::text t FROM marketplace_photo_reminder_state`))[0]?.t ?? null

const CASES = [
  ['no waiting photos (only approved / rejected, or none) → 0 and nothing written or posted', async db => {
    const r0 = await remind(db)
    const lid = await listing(db); await photo(db, lid, 'approved'); await photo(db, lid, 'rejected')
    const r1 = await remind(db)
    const t = await totals(db)
    return [r0.value === 0 && r1.value === 0 && t.notifs === 0 && t.logs === 0 && t.calls === 0 && (await lastStamp(db)) === null, { r0, r1, t }]
  }],
  ['waiting photos → every admin a notice + log row (token-less one: request_id NULL), the two token admins one exact push each; returns 3', async db => {
    const lid = await listing(db); await photo(db, lid); await photo(db, lid); await photo(db, lid); await photo(db, lid, 'approved')
    const r = await remind(db)
    const why = await sentTo(db, 3)
    return [r.ok && r.value === 3 && why.length === 0 && (await lastStamp(db)) !== null, { r, why }]
  }],
  ['customers and providers (with push tokens) never get a notice, a log row or a push', async db => {
    const lid = await listing(db); await photo(db, lid)
    await remind(db)
    const nonAdmin = `('${U.A}','${U.C}','${U.P}')`
    const a = await n(db, `SELECT count(*)::int n FROM notifications WHERE user_id IN ${nonAdmin}`)
    const b = await n(db, `SELECT count(*)::int n FROM push_log WHERE user_id IN ${nonAdmin}`)
    const c = await n(db, `SELECT count(*)::int n FROM net.calls WHERE body->>'to' IN ('${TOKENS[U.A]}','${TOKENS[U.C]}','${TOKENS[U.P]}')`)
    const admins = await n(db, `SELECT count(*)::int n FROM notifications`)
    return [a === 0 && b === 0 && c === 0 && admins === 3, { a, b, c, admins }]
  }],
  ['rerun immediately → 0, nothing more', async db => {
    const lid = await listing(db); await photo(db, lid)
    const r1 = await remind(db); const t1 = await totals(db)
    const r2 = await remind(db); const t2 = await totals(db)
    return [r1.value === 3 && r2.value === 0 && deepEq(t1, t2), { r1, r2, t1, t2 }]
  }],
  ['31 minutes later with NO new photo → nothing (a known queue does not ping again)', async db => {
    const lid = await listing(db); await photo(db, lid); await photo(db, lid)
    await remind(db); const t1 = await totals(db)
    await pass(db, 31)
    const r = await remind(db); const t2 = await totals(db)
    return [r.value === 0 && deepEq(t1, t2), { r, t1, t2 }]
  }],
  ['a new photo 31 minutes later → sends again, the count is old + new', async db => {
    const lid = await listing(db); await photo(db, lid); await photo(db, lid)
    await remind(db); await clearSent(db)
    await pass(db, 31)
    await photo(db, lid)
    const r = await remind(db)
    const why = await sentTo(db, 3)
    return [r.value === 3 && why.length === 0, { r, why }]
  }],
  ['a new photo inside the 30 minutes → nothing at 29 minutes, sends at 31', async db => {
    const lid = await listing(db); await photo(db, lid)
    await remind(db); const t1 = await totals(db)
    await pass(db, 1)
    await photo(db, lid)
    await pass(db, 28)                                 // 29 minutes since the reminder
    const r29 = await remind(db); const t29 = await totals(db)
    await pass(db, 2)                                  // 31
    await clearSent(db)
    const r31 = await remind(db)
    const why = await sentTo(db, 2)
    return [r29.value === 0 && deepEq(t1, t29) && r31.value === 3 && why.length === 0, { r29, t1, t29, r31, why }]
  }],
  ['photos on a deleted listing are not counted', async db => {
    const gone = await listing(db); await photo(db, gone); await photo(db, gone); await softDelete(db, gone)
    const live = await listing(db); await photo(db, live)
    const r = await remind(db)
    const why = await sentTo(db, 1)
    return [r.value === 3 && why.length === 0, { r, why }]
  }],
  ['only deleted-listing photos waiting → nothing', async db => {
    const gone = await listing(db); await photo(db, gone); await softDelete(db, gone)
    const r = await remind(db); const t = await totals(db)
    return [r.value === 0 && t.notifs === 0 && t.calls === 0, { r, t }]
  }],
  ['a NEW photo on a since-deleted listing alone does not trigger a send after the window', async db => {
    const live = await listing(db); await photo(db, live)
    await remind(db); const t1 = await totals(db)
    await pass(db, 31)
    const gone = await listing(db); await photo(db, gone); await softDelete(db, gone)
    const r = await remind(db); const t2 = await totals(db)
    return [r.value === 0 && deepEq(t1, t2), { r, t1, t2 }]
  }],
  ['anon and authenticated cannot execute; service_role can (positive control)', async db => {
    const lid = await listing(db); await photo(db, lid)
    await db.exec(`SELECT set_config('request.jwt.claims', '{"sub":"${U.AD1}"}', false)`)  // even an admin's session
    const au = await run(db, 'authenticated', 'SELECT public.marketplace_photo_review_reminder() AS n')
    await db.exec(`SELECT set_config('request.jwt.claims', '', false)`)
    const an = await run(db, 'anon', 'SELECT public.marketplace_photo_review_reminder() AS n')
    const t = await totals(db)
    const sr = await remind(db)
    return [!au.ok && !an.ok && t.notifs === 0 && sr.ok && sr.value === 3, { au, an, t, sr }]
  }],
  ['the state table: anon and authenticated can neither read nor write it; the function (service_role) writes it', async db => {
    const res = {}
    for (const role of ['anon', 'authenticated']) {
      res[role] = [(await run(db, role, 'SELECT * FROM public.marketplace_photo_reminder_state')).ok,
        (await run(db, role, `UPDATE public.marketplace_photo_reminder_state SET last_sent_at = now() - interval '1 day'`)).ok,
        (await run(db, role, 'DELETE FROM public.marketplace_photo_reminder_state')).ok]
    }
    const lid = await listing(db); await photo(db, lid)
    const before = await lastStamp(db)
    await remind(db)
    const after = await lastStamp(db)
    return [res.anon.every(x => !x) && res.authenticated.every(x => !x) && before === null && after !== null, { res, before, after }]
  }],
  ['zero admins → nothing sent and NOT stamped; the first admin then gets the current queue', async db => {
    await db.exec(`UPDATE profiles SET role = 'customer' WHERE role = 'admin'`)
    const lid = await listing(db); await photo(db, lid); await photo(db, lid)
    const r0 = await remind(db); const stamp0 = await lastStamp(db); const t0 = await totals(db)
    await db.exec(`UPDATE profiles SET role = 'admin' WHERE id IN ('${U.AD1}','${U.AD2}','${U.AD3}')`)
    const r1 = await remind(db)
    const why = await sentTo(db, 2)
    return [r0.value === 0 && stamp0 === null && t0.notifs === 0 && t0.calls === 0 && r1.value === 3 && why.length === 0, { r0, stamp0, t0, r1, why }]
  }],
  ['a missing state row heals on the next send (no reminder every 5 minutes)', async db => {
    await db.exec(`DELETE FROM marketplace_photo_reminder_state`)
    const lid = await listing(db); await photo(db, lid)
    const r1 = await remind(db); const r2 = await remind(db)
    const rows = await n(db, `SELECT count(*)::int n FROM marketplace_photo_reminder_state WHERE last_sent_at IS NOT NULL`)
    return [r1.value === 3 && r2.value === 0 && rows === 1, { r1, r2, rows }]
  }],
  ['the job: one row, */5 * * * *, the exact call', async db => {
    const j = await q(db, `SELECT schedule, command FROM cron.job WHERE jobname = 'marketplace-photo-review-reminder'`)
    return [j.length === 1 && j[0].schedule === '*/5 * * * *' && j[0].command.trim() === 'SELECT public.marketplace_photo_review_reminder();', j]
  }],
  ['a re-apply keeps the stamp and leaves one job', async db => {
    const lid = await listing(db); await photo(db, lid)
    await remind(db); const s1 = await lastStamp(db)
    const again = await applyFile(db, CURRENT_FILE)
    const s2 = await lastStamp(db)
    const jobs = await n(db, `SELECT count(*)::int n FROM cron.job WHERE jobname = 'marketplace-photo-review-reminder'`)
    const rows = await n(db, `SELECT count(*)::int n FROM marketplace_photo_reminder_state`)
    return [again.ok && s1 !== null && s1 === s2 && jobs === 1 && rows === 1, { again, s1, s2, jobs, rows }]
  }],
]

let failed = 0
const check = (name, ok, got) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  got: ' + JSON.stringify(got)}`) }

let CURRENT_FILE = F196  // the file under test: the real one, or a mutant copy (a re-apply must re-apply the SAME text)
async function runCase(fn, opts) {
  pos = {}; CURRENT_FILE = opts?.file ?? F196
  try { const db = await build(opts); const [ok, got] = await fn(db); await db.close(); return { ok, got } }
  catch (e) { return { ok: false, got: e.message } }
}
for (const [name, fn] of CASES) {
  const { ok, got } = await runCase(fn)
  check(name, ok, got)
}

// Refusals: the pre-flight must be able to fail.
{
  const db = await freshDb(BASE + CRON_STUB + STUBS + seedSql() + 'DROP TABLE public.push_log;')
  for (const f of CHAIN) await applyFile(db, f)
  const r = await applyFile(db, F196)
  await db.exec('ROLLBACK')  // the refused file left its transaction open and aborted
  check('red: push_log missing → refused, nothing applied', !r.ok && /push_log \(20260923\) is missing/.test(r.msg)
    && (await n(db, `SELECT count(*)::int n FROM pg_class WHERE relname = 'marketplace_photo_reminder_state'`)) === 0, r)
  await db.close()
}
{
  const db = await freshDb(BASE + CRON_STUB + STUBS + seedSql())
  const r = await applyFile(db, F196)
  check('red: 20261183 not applied → refused', !r.ok && /20261183/.test(r.msg), r)
  await db.close()
}

// ── RED-FIRST mutants: break the function on a COPY (anchor asserted present exactly once), the named case must go red ──
// `neut` turns one in-migration catalog assertion into a NOTICE, so what goes red is the BEHAVIOUR case, not the shape check.
const MUTANTS = [
  { n: 'M1 the 30-minute window removed', pairs: [[`IF v_last IS NOT NULL AND v_last > now() - interval '30 minutes' THEN`, `IF false THEN`]],
    red: 'a new photo inside the 30 minutes' },
  { n: 'M2 the "new photo" test removed (known queue pings every 30 min)', pairs: [[`IF v_count < 1 OR v_new < 1 THEN`, `IF v_count < 1 THEN`]],
    red: '31 minutes later with NO new photo' },
  { n: 'M3 deleted_at dropped from the predicate (count)', pairs: [[`WHERE p.status = 'pending' AND l.deleted_at IS NULL;`, `WHERE p.status = 'pending';`]],
    red: 'photos on a deleted listing are not counted' },
  { n: 'M3b deleted_at dropped from the "new" test only', pairs: [[`count(*) FILTER (WHERE v_last IS NULL OR p.created_at > v_last)`,
      `(SELECT count(*) FROM marketplace_photos p2 WHERE p2.status = 'pending' AND (v_last IS NULL OR p2.created_at > v_last))`]],
    red: 'a NEW photo on a since-deleted listing alone' },
  { n: 'M4 every profile notified, not only admins', pairs: [[`FROM profiles WHERE role = 'admin' LOOP`, `FROM profiles LOOP`]],
    red: 'customers and providers' },
  { n: 'M5 push data screen = marketplace', pairs: [[`'screen', 'admin'`, `'screen', 'marketplace'`]],
    red: 'waiting photos → every admin' },
  { n: 'M6 push_log only when a push went out', pairs: [[`INSERT INTO push_log (user_id, kind, request_id) VALUES (r.id, 'mk_photos_waiting', req);`,
      `IF req IS NOT NULL THEN INSERT INTO push_log (user_id, kind, request_id) VALUES (r.id, 'mk_photos_waiting', req); END IF;`]],
    red: 'waiting photos → every admin' },
  { n: 'M7 EXECUTE granted to authenticated', pairs: [[`GRANT EXECUTE ON FUNCTION public.marketplace_photo_review_reminder() TO service_role;`,
      `GRANT EXECUTE ON FUNCTION public.marketplace_photo_review_reminder() TO service_role, authenticated;`]],
    neut: [`% can execute marketplace_photo_review_reminder()`], red: 'anon and authenticated cannot execute' },
  { n: 'M8 the function REVOKE dropped (Supabase default privileges keep anon/authenticated)', pairs: [[`REVOKE ALL ON FUNCTION public.marketplace_photo_review_reminder() FROM PUBLIC, anon, authenticated;\n`, '']],
    neut: [`% can execute marketplace_photo_review_reminder()`], red: 'anon and authenticated cannot execute' },
  { n: 'M9 stamped even when no admin was notified', pairs: [[`IF n > 0 THEN\n    INSERT INTO marketplace_photo_reminder_state`, `IF true THEN\n    INSERT INTO marketplace_photo_reminder_state`]],
    red: 'zero admins' },
  { n: 'M10 the text counts only the NEW photos', pairs: [[`bdy := v_count || ' fotoğraf onay bekliyor';`, `bdy := v_new || ' fotoğraf onay bekliyor';`]],
    red: 'a new photo 31 minutes later' },
  { n: 'M11 the type is general, not admin_alert', pairs: [[`VALUES (r.id, ttl, bdy, 'admin_alert');`, `VALUES (r.id, ttl, bdy, 'general');`]],
    red: 'waiting photos → every admin' },
  { n: 'M12 the job runs every 30 minutes', pairs: [[`'marketplace-photo-review-reminder', '*/5 * * * *'`, `'marketplace-photo-review-reminder', '*/30 * * * *'`]],
    neut: [`marketplace-photo-review-reminder has the wrong schedule or command`], red: 'the job: one row' },
  { n: 'M13 the state table REVOKE dropped', pairs: [[`REVOKE ALL ON public.marketplace_photo_reminder_state FROM PUBLIC, anon, authenticated;\n`, '']],
    neut: [`% holds a privilege on marketplace_photo_reminder_state`], red: 'the state table' },
  { n: 'M14 [catalog] the state table loses RLS → apply refused', pairs: [[`ALTER TABLE public.marketplace_photo_reminder_state ENABLE ROW LEVEL SECURITY;\n`, '']],
    applyFails: 'marketplace_photo_reminder_state has RLS off' },
  { n: 'M18 the stamp is an UPDATE (a missing row is never re-created)', pairs: [[`    INSERT INTO marketplace_photo_reminder_state (id, last_sent_at) VALUES (true, now())\n    ON CONFLICT (id) DO UPDATE SET last_sent_at = excluded.last_sent_at;`,
      `    UPDATE marketplace_photo_reminder_state SET last_sent_at = now() WHERE id;`]],
    red: 'a missing state row heals' },
  { n: 'M15 a re-apply resets the stamp', pairs: [[`ON CONFLICT (id) DO NOTHING;`, `ON CONFLICT (id) DO UPDATE SET last_sent_at = NULL;`]],
    red: 'a re-apply keeps the stamp' },
  { n: 'M16 [catalog] authenticated granted, assertion live → apply refused', pairs: [[`GRANT EXECUTE ON FUNCTION public.marketplace_photo_review_reminder() TO service_role;`,
      `GRANT EXECUTE ON FUNCTION public.marketplace_photo_review_reminder() TO service_role, authenticated;`]],
    applyFails: 'authenticated can execute marketplace_photo_review_reminder()' },
  // Removing the GRANT alone changes nothing: Supabase's default privileges (modelled by the harness) already give service_role
  // EXECUTE, so the explicit GRANT is belt-and-braces. The break that can happen is a revoke.
  { n: 'M17 [catalog] service_role EXECUTE revoked → apply refused (positive control)', pairs: [[`GRANT EXECUTE ON FUNCTION public.marketplace_photo_review_reminder() TO service_role;`,
      `REVOKE EXECUTE ON FUNCTION public.marketplace_photo_review_reminder() FROM service_role;`]],
    applyFails: 'service_role cannot execute marketplace_photo_review_reminder()' },
]
if (process.argv.includes('--no-mutants')) console.log('\n(mutants skipped)')
else {
  console.log('\nRED-FIRST mutants (each must turn its named case red)')
  const dir = mkdtempSync(join(tmpdir(), 'mk-reminder-mutants-'))
  try {
    for (const m of MUTANTS) {
      let text = SRC, missing = null
      const pairs = [...m.pairs, ...(m.neut ?? []).map(x => [`RAISE EXCEPTION '${x}`, `RAISE NOTICE '${x}`])]
      for (const [from, to] of pairs) {
        const k = text.split(from).length - 1
        if (k !== 1) { missing = `anchor ${JSON.stringify(from.slice(0, 70))} found ${k}x`; break }
        text = text.replace(from, () => to)
      }
      if (missing) { check(`${m.n}: anchor present once`, false, missing); continue }
      const p = join(dir, m.n.replace(/\W+/g, '_') + '.sql'); writeFileSync(p, text)
      if (m.applyFails) {
        let msg = null
        try { await build({ file: p }) } catch (e) { msg = e.message }
        check(`${m.n}: RED (apply refused with "${m.applyFails}")`, msg !== null && msg.includes(m.applyFails), msg ?? 'applied!')
        continue
      }
      const target = CASES.filter(([name]) => name.startsWith(m.red))
      if (target.length !== 1) { check(`${m.n}: names exactly one case`, false, target.map(t => t[0])); continue }
      const { ok, got } = await runCase(target[0][1], { file: p })
      check(`${m.n}: RED on "${target[0][0].slice(0, 60)}…"`, !ok, ok ? 'stayed GREEN' : got)
      if (!ok) console.log(`      red evidence: ${JSON.stringify(got).slice(0, 220)}`)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
