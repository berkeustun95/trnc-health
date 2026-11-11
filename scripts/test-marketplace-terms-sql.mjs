// 20261190 (Bandabuliya: terms accepted before posting or messaging) on top of 20261183/84/85, against the live messaging
// fixture plus Araçlar S1's prerequisites. PGlite = PostgreSQL 18; prod is 17.6.
//   node scripts/test-marketplace-terms-sql.mjs
// What a pass is evidence of: which RPC / trigger outcomes follow from profiles.terms_version, who can still do what with
// terms missing, the pins and tokens of the file. Not PostgREST, not the Storage API, not the client's own gate.
// Red-first: every refusal below is also run on the database WITHOUT 20261190, where it must NOT be refused.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { freshDb, applyFile } from './migration-harness.mjs'

const rel = p => fileURLToPath(new URL(p, import.meta.url))
const BASE = readFileSync(rel('./fixtures/messaging-live.sql'), 'utf8') + readFileSync(rel('./fixtures/marketplace-prereqs.sql'), 'utf8')
const MIG = f => rel('../supabase/migrations/' + f)
const F183 = MIG('20261183_marketplace_listings.sql'), F184 = MIG('20261184_marketplace_messaging.sql')
const F185 = MIG('20261185_marketplace_maintenance.sql'), F190 = MIG('20261190_marketplace_terms.sql')
const T190 = readFileSync(F190, 'utf8')
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex')

const CRON_STUB = `
CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS $f$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING jobid $f$;
CREATE FUNCTION cron.unschedule(p_name text) RETURNS boolean LANGUAGE sql AS $f$
  WITH d AS (DELETE FROM cron.job WHERE jobname = p_name RETURNING 1) SELECT EXISTS (SELECT 1 FROM d) $f$;
`
const U = {
  S: 'a0000000-0000-4000-8000-00000000000a',  // seller
  B: 'b0000000-0000-4000-8000-00000000000b',  // buyer
  R: 'c0000000-0000-4000-8000-00000000000c',  // reporter
  X: 'e0000000-0000-4000-8000-00000000000e',  // admin
  P: 'd0000000-0000-4000-8000-00000000000d',  // listed student, not in the thread
  G: '20000000-0000-4000-8000-000000000002',  // guest
}
const INST = '30000000-0000-4000-8000-000000000003'
const SEED = `
INSERT INTO auth.users VALUES ${Object.values(U).map(u => `('${u}')`).join(',')};
INSERT INTO profiles (id, display_name, date_of_birth, role, terms_version) VALUES
  ('${U.S}', 'Satıcı', '1988-01-01', 'customer', '2026-11-11'), ('${U.B}', 'Alıcı', '1990-01-01', 'customer', '2026-11-11'),
  ('${U.R}', 'Rapor', '1991-01-01', 'customer', '2026-11-11'), ('${U.X}', 'Admin', '1985-01-01', 'admin', '2026-11-11'),
  ('${U.P}', 'Öğrenci', '1999-01-01', 'customer', '2026-11-11'), ('${U.G}', NULL, NULL, NULL, NULL);
INSERT INTO institutions VALUES ('${INST}', true);
INSERT INTO student_education (user_id, institution_id, level, listing_opt_in) VALUES ('${U.P}', '${INST}', 'university', true);
INSERT INTO storage.buckets (id, name) VALUES ('marketplace-photos', 'marketplace-photos') ON CONFLICT DO NOTHING;
`
// as(): a signed-in user (or null = no session / anon role; 'svc' = service role, no session).
async function as(db, who, sql) {
  const claims = who === 'G' ? { sub: U.G, is_anonymous: true } : (who === null || who === 'svc') ? null : { sub: U[who] }
  try {
    await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [claims ? JSON.stringify(claims) : ''])
    await db.exec(who === null ? 'SET role anon;' : who === 'svc' ? 'SET role service_role;' : 'SET role authenticated;')
    const r = await db.query(sql)
    return { ok: true, rows: r.rows, value: r.rows[0] ? Object.values(r.rows[0])[0] : null }
  } catch (e) { return { ok: false, err: e.message } } finally { await db.exec('RESET role;') }
}
const errIs = (r, code) => !r.ok && r.err.includes(code)
const setTerms = (db, who, v) => db.exec(`UPDATE profiles SET terms_version = ${v === null ? 'NULL' : `'${v}'`} WHERE id = '${U[who]}'`)
const ITEM = (title = 'Gitar satılık') =>
  `INSERT INTO marketplace_listings (title, description, price_tl, is_free, category, condition, district)
   VALUES ('${title}', 'Akustik gitar, çok iyi durumda.', 3000, false, 'hobby_music', 'like_new', 'nicosia')`

// withFull = true: 183 + 184 + 185 + 190. false: the same without 190 (the red-first database).
async function build(withFull) {
  const db = await freshDb(BASE + CRON_STUB + SEED)
  for (const f of [F183, F184, F185, ...(withFull ? [F190] : [])]) {
    const r = await applyFile(db, f); if (!r.ok) throw new Error(f.split('/').pop() + ': ' + r.msg)
  }
  for (const w of ['S', 'B', 'P']) await as(db, w, `SELECT accept_marketplace_notice('2026-11-07')`)
  const l = await as(db, 'S', ITEM() + ' RETURNING id')   // posted while the terms were valid
  if (!l.ok) throw new Error(l.err)
  db.listing = l.value
  return db
}
const open = (db, who, body = 'Merhaba, hâlâ satılık mı?', id) => as(db, who, `SELECT start_listing_conversation('${id ?? db.listing}', '${body}')`)
const thread = async (db, who) => (await as(db, who, `SELECT conversation_id FROM list_conversations('listing')`)).value
const send = (db, who, id, body = 'Evet') => as(db, who, `SELECT send_message('${id}', '${body}')`)
const photo = (db, who, lid, pos) => as(db, who, `INSERT INTO marketplace_photos (listing_id, position, storage_path) VALUES ('${lid}', ${pos}, 'pending/${U[who]}/${lid}/${pos}.jpg') RETURNING id`)
const nearExpiry = db => db.exec(`SELECT set_config('app.trusted_marketplace', 'on', false); UPDATE marketplace_listings SET expires_at = now() + interval '2 days' WHERE id = '${db.listing}'; SELECT set_config('app.trusted_marketplace', 'off', false);`)
const listingRow = async db => (await db.query(`SELECT status, hidden_at IS NOT NULL h, deleted_at IS NOT NULL d, title FROM marketplace_listings WHERE id = '${db.listing}'`)).rows[0]

let failed = 0
const check = (name, ok, got) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  got: ' + JSON.stringify(got)}`) }

const REFUSED_VALUES = [null, '2026-09', '2026-11-09', '2026-11-10']
const ALLOWED_VALUES = ['2026-11-11', '2026-11-12', '2027-01-01']

// ── 0. The floor, the pins, the method ──────────────────────────────────────────────────────────
const floorLines = T190.split('\n').filter(l => /'\d{4}-\d{2}-\d{2}'/.test(l) && !/^\s*--/.test(l))
const floorHits = (T190.match(/'2026-11-11'/g) || []).length
const FLOOR = /terms_version COLLATE "C" >= '(\d{4}-\d{2}-\d{2})'/.exec(T190)?.[1]
console.log('floor line: ' + (floorLines[0] ?? '').trim())
check('the floor is stated once in the whole file, on one non-comment line, in a stable shape', floorHits === 1 && floorLines.length === 1 && FLOOR === '2026-11-11', { floorHits, floorLines, FLOOR })

function bodyOf(src, sig) {
  const name = sig.replace(/^public\./, '').replace(/\(.*$/, '')
  const i = src.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  const a = src.indexOf('AS $function$', i) + 'AS $function$'.length
  return i < 0 ? null : src.slice(a, src.indexOf('$function$;', a))
}
{
  const f184 = readFileSync(F184, 'utf8'), f183 = readFileSync(F183, 'utf8')
  check('method control: the body of start_conversation extracted from 20261184 hashes to the md5 20261184 records as its own (c053fc5f…)',
    md5(bodyOf(f184, 'public.start_conversation(uuid,text)')) === 'c053fc5fcd770d95965316810acfc79a')
  const pins = [...T190.matchAll(/^ {6}\('(public\.[^']+)', '([0-9a-f]{32})', '([0-9a-f]{32})'\)/gm)].map(m => ({ sig: m[1], original: m[2], mine: m[3] }))
  check('pre-flight lists exactly the six replaced bodies', pins.length === 6, pins.map(p => p.sig))
  const full = await build(true)
  for (const p of pins) {
    const src = /listing_message|start_listing/.test(p.sig) ? f184 : f183
    const live = (await full.query(`SELECT md5(prosrc) m FROM pg_proc WHERE oid = to_regprocedure('${p.sig}')`)).rows[0].m
    check(`pins ${p.sig}: original = md5 of main's body, mine = md5 of this file's body = the body created`,
      p.original === md5(bodyOf(src, p.sig)) && p.mine === md5(bodyOf(T190, p.sig)) && p.mine === live && p.original !== p.mine,
      { p, fromFile183or84: md5(bodyOf(src, p.sig)), own: md5(bodyOf(T190, p.sig)), live })
  }
}

// ── 1. Refusals: [name, whose terms vary, setup (terms valid), act → the refusal word?] ────────────────────────────
// setup runs while the terms are valid (a thread has to exist first); then the varying user's terms are set; then act.
const REFUSALS = [
  ['post (insert)', 'S', null, async db => as(db, 'S', ITEM('Başka eşya'))],
  ['edit the title', 'S', null, db => as(db, 'S', `UPDATE marketplace_listings SET title = 'Gitar, fiyat düştü' WHERE id = '${db.listing}'`)],
  ['edit only the price', 'S', null, db => as(db, 'S', `UPDATE marketplace_listings SET price_tl = 2500 WHERE id = '${db.listing}'`)],
  ['edit the category and district', 'S', null, db => as(db, 'S', `UPDATE marketplace_listings SET category = 'other', district = 'lefke' WHERE id = '${db.listing}'`)],
  ['relist (sold → active)', 'S', db => as(db, 'S', `UPDATE marketplace_listings SET status = 'sold' WHERE id = '${db.listing}'`),
    db => as(db, 'S', `UPDATE marketplace_listings SET status = 'active' WHERE id = '${db.listing}'`)],
  ['sold + a title change in one UPDATE', 'S', null, db => as(db, 'S', `UPDATE marketplace_listings SET status = 'sold', title = 'Satıldı ama başlık değişti' WHERE id = '${db.listing}'`)],
  ['edit through a faked trusted switch', 'S', null, async db => {
    await db.exec(`SELECT set_config('app.trusted_marketplace', 'on', false)`)
    const r = await as(db, 'S', `UPDATE marketplace_listings SET title = 'Hile ile başlık' WHERE id = '${db.listing}'`)
    await db.exec(`SELECT set_config('app.trusted_marketplace', 'off', false)`)
    return r
  }],
  ['renew', 'S', nearExpiry, db => as(db, 'S', `SELECT renew_marketplace_listing('${db.listing}')`)],
  ['add a photo', 'S', null, db => photo(db, 'S', db.listing, 0)],
  ['start_listing_conversation (buyer)', 'B', null, db => open(db, 'B')],
  ['send_listing_message: buyer (via send_message)', 'B', async db => { await open(db, 'B'); await send(db, 'S', await thread(db, 'S')) }, async db => send(db, 'B', await thread(db, 'B'))],
  ['send_listing_message: seller reply (via send_message)', 'S', async db => { await open(db, 'B') }, async db => send(db, 'S', await thread(db, 'S'))],
]
const labelV = v => v === null ? 'NULL' : v
async function runRefusal(withFull, [, who, setup, act], v) {
  const db = await build(withFull)
  if (setup) await setup(db)
  await setTerms(db, who, v)
  return act(db)
}
for (const c of REFUSALS) {
  for (const v of REFUSED_VALUES) {
    const r = await runRefusal(true, c, v)
    check(`refused with terms ${labelV(v)}: ${c[0]}`, errIs(r, 'TERMS_REQUIRED'), r.err ?? r.value)
  }
  const r0 = await runRefusal(false, c, null)
  check(`red-first (no 20261190): ${c[0]} with terms NULL is NOT refused`, r0.ok === true, r0.err)
}

// Allowed values: the same actions go through (post, edit, renew, photo, start, send) for the floor itself and later versions.
const ALLOWED = [
  ['post', (db) => as(db, 'S', ITEM('Başka eşya'))],
  ['edit the title', (db) => as(db, 'S', `UPDATE marketplace_listings SET title = 'Gitar, fiyat düştü' WHERE id = '${db.listing}'`)],
  ['renew', async db => { await nearExpiry(db); return as(db, 'S', `SELECT renew_marketplace_listing('${db.listing}')`) }],
  ['add a photo', db => photo(db, 'S', db.listing, 0)],
  ['start + seller reply + buyer continues', async db => {
    const r = await open(db, 'B'); const id = await thread(db, 'S')
    const r2 = await send(db, 'S', id); const r3 = await send(db, 'B', id)
    return r.ok && r2.ok && r3.ok ? { ok: true } : { ok: false, err: JSON.stringify([r, r2, r3].map(x => x.err)) }
  }],
]
for (const [name, act] of ALLOWED) {
  for (const v of ALLOWED_VALUES) {
    const db = await build(true)
    await setTerms(db, 'S', v); await setTerms(db, 'B', v)
    const r = await act(db)
    check(`allowed with terms ${v}: ${name}`, r.ok === true, r.err)
  }
}

// ── 2. Positive controls: with the seller's terms MISSING these keep working ──────────────────────
async function noTerms(db, ...who) { for (const w of who) await setTerms(db, w, null) }
const CONTROLS = [
  ['seller marks an active listing sold (status → sold only)', async db => {
    await noTerms(db, 'S'); const r = await as(db, 'S', `UPDATE marketplace_listings SET status = 'sold' WHERE id = '${db.listing}'`)
    return r.ok && (await listingRow(db)).status === 'sold'
  }],
  ['a no-op update by the seller passes', async db => { await noTerms(db, 'S'); return (await as(db, 'S', `UPDATE marketplace_listings SET status = 'active' WHERE id = '${db.listing}'`)).ok }],
  ['seller deletes (delete_marketplace_listing)', async db => {
    await noTerms(db, 'S'); const r = await as(db, 'S', `SELECT delete_marketplace_listing('${db.listing}')`)
    return r.ok && (await listingRow(db)).d
  }],
  ['report auto-hide (the reporter, terms missing, is the caller; the seller\'s terms missing too)', async db => {
    await noTerms(db, 'S', 'R')
    const r = await as(db, 'R', `INSERT INTO content_reports (reporter_id, content_type, content_id, reason) VALUES ('${U.R}', 'listing', '${db.listing}', 'spam')`)
    return r.ok && (await listingRow(db)).h
  }],
  ['admin hide and restore (admin_set_listing_hidden), terms missing on admin and seller', async db => {
    await noTerms(db, 'S', 'X')
    const a = await as(db, 'X', `SELECT admin_set_listing_hidden('${db.listing}', true)`); const h = (await listingRow(db)).h
    const b = await as(db, 'X', `SELECT admin_set_listing_hidden('${db.listing}', false)`); const h2 = (await listingRow(db)).h
    return a.ok && b.ok && h === true && h2 === false
  }],
  ['maintenance: soft-delete (expired > 90 days) and purge (deleted > 30 days), terms missing', async db => {
    const l2 = (await as(db, 'S', ITEM('İkinci eşya') + ' RETURNING id')).value
    await noTerms(db, 'S')
    await db.exec(`SELECT set_config('app.trusted_marketplace', 'on', false);
      UPDATE marketplace_listings SET expires_at = now() - interval '91 days' WHERE id = '${db.listing}';
      UPDATE marketplace_listings SET deleted_at = now() - interval '31 days' WHERE id = '${l2}';
      SELECT set_config('app.trusted_marketplace', 'off', false);`)
    const r = await as(db, 'svc', `SELECT public.marketplace_maintenance(true) AS r`)
    return r.ok && r.value.expired_soft_deleted === 1 && r.value.purged === 1 && (await listingRow(db)).d
  }],
  ['photo approve and reject (service role, as marketplace-photo-review), terms missing', async db => {
    const p1 = (await photo(db, 'S', db.listing, 0)).value, p2 = (await photo(db, 'S', db.listing, 1)).value
    await noTerms(db, 'S')
    // the exact field sets marketplace-photo-review/review.ts writes (approve: status, storage_path, width, height + reviewed;
    // reject: status, reject_reason + reviewed; reviewed = reviewed_by, reviewed_at, review_source), as the service role
    const a = await as(db, 'svc', `UPDATE marketplace_photos SET status = 'approved', storage_path = 'approved/${U.S}/${db.listing}/${p1}.jpg', width = 800, height = 600,
      reviewed_by = '${U.X}', reviewed_at = now(), review_source = 'admin' WHERE id = '${p1}' AND status = 'pending' RETURNING id`)
    const b = await as(db, 'svc', `UPDATE marketplace_photos SET status = 'rejected', reject_reason = 'other',
      reviewed_by = '${U.X}', reviewed_at = now(), review_source = 'admin' WHERE id = '${p2}' AND status = 'pending' RETURNING id`)
    const st = (await db.query(`SELECT string_agg(status, ',' ORDER BY position) s FROM marketplace_photos`)).rows[0].s
    return a.ok && b.ok && a.rows.length === 1 && b.rows.length === 1 && st === 'approved,rejected'
  }],
  ['the seller deletes a photo of their own, terms missing (photo DELETE is untouched)', async db => {
    await photo(db, 'S', db.listing, 0); await noTerms(db, 'S')
    const r = await as(db, 'S', `DELETE FROM marketplace_photos WHERE listing_id = '${db.listing}' RETURNING id`)
    return r.ok && r.rows.length === 1
  }],
  ['a content edit with no session at all (service role / SQL editor, auth.uid() NULL) is not this check\'s business', async db => {
    await noTerms(db, 'S'); const r = await as(db, 'svc', `UPDATE marketplace_listings SET title = 'Yönetici düzeltmesi' WHERE id = '${db.listing}' RETURNING id`)
    return r.ok && r.rows.length === 1
  }],
  ['an admin reads and others read the listing exactly as before (no policy moved)', async db => {
    await noTerms(db, 'S')
    return (await as(db, 'B', `SELECT count(*)::int FROM marketplace_listings WHERE id = '${db.listing}'`)).value === 1
  }],
  ['Student Hub start + reply with terms NULL and older (a listed student pair)', async db => {
    await db.exec(`INSERT INTO student_education (user_id, institution_id, level, listing_opt_in) VALUES ('${U.S}', '${INST}', 'university', true)`)
    await setTerms(db, 'S', null); await setTerms(db, 'P', '2026-09')
    const r = await as(db, 'S', `SELECT start_conversation('${U.P}', 'selam')`)
    const id = (await db.query(`SELECT id FROM conversations WHERE kind = 'student' ORDER BY created_at DESC LIMIT 1`)).rows[0]?.id
    return r.value === 'sent' && (await send(db, 'P', id)).value === 'sent'
  }],
]
for (const [name, fn] of CONTROLS) {
  let ok, got
  try { ok = await fn(await build(true)) } catch (e) { ok = false; got = e.message }
  check(`positive control (terms missing): ${name}`, ok === true, got)
}

// ── 3. Error order and no existence oracle ─────────────────────────────────────────────────────
{
  // TERMS_REQUIRED wins over NOTICE_REQUIRED in both message paths; with the terms valid the notice word is still reachable.
  const db = await build(true)
  await db.exec(`SELECT set_config('app.trusted_marketplace_notice', 'on', false); UPDATE profiles SET marketplace_notice_at = NULL WHERE id = '${U.B}'; SELECT set_config('app.trusted_marketplace_notice', 'off', false);`)
  await setTerms(db, 'B', null)
  check('start with terms AND notice missing → TERMS_REQUIRED (not NOTICE_REQUIRED)', errIs(await open(db, 'B'), 'TERMS_REQUIRED'))
  await setTerms(db, 'B', '2026-11-11')
  check('  …positive control: terms valid, notice missing → NOTICE_REQUIRED', errIs(await open(db, 'B'), 'NOTICE_REQUIRED'))
  await as(db, 'B', `SELECT accept_marketplace_notice('2026-11-07')`); await open(db, 'B'); const id = await thread(db, 'S')
  await db.exec(`SELECT set_config('app.trusted_marketplace_notice', 'on', false); UPDATE profiles SET marketplace_notice_at = NULL WHERE id = '${U.S}'; SELECT set_config('app.trusted_marketplace_notice', 'off', false);`)
  await setTerms(db, 'S', null)
  check('reply with terms AND notice missing → TERMS_REQUIRED', errIs(await send(db, 'S', id), 'TERMS_REQUIRED'))
  await setTerms(db, 'S', '2026-11-11')
  check('  …positive control: terms valid, notice missing → NOTICE_REQUIRED', errIs(await send(db, 'S', id), 'NOTICE_REQUIRED'))
}
async function sendOracle(db) {
  await open(db, 'B'); const id = await thread(db, 'B')
  const random = 'f0000000-0000-4000-8000-0000000000ff'
  await setTerms(db, 'P', null)
  const real = await send(db, 'P', id), fake = await send(db, 'P', random)
  return { same: !real.ok && !fake.ok && /NO_SUCH_CONVERSATION/.test(real.err) && /NO_SUCH_CONVERSATION/.test(fake.err), words: [real.err, fake.err], id }
}
{
  const db = await build(true)
  const o = await sendOracle(db)
  check('send_message: a listed student with NO terms who is not in the thread gets the SAME word for a real listing thread and a random id', o.same, o.words)
  await setTerms(db, 'B', null)
  check('  …positive control: the participant without terms DOES get TERMS_REQUIRED', errIs(await send(db, 'B', o.id), 'TERMS_REQUIRED'))
}
{
  // red-first: the terms check moved straight after the sign-in check in send_listing_message (the order this file rejects) makes the words differ
  const dir0 = mkdtempSync(join(tmpdir(), 'terms-oracle-'))
  const mutO = join(dir0, '20261190_oracle_mutant.sql')
  const TERMS_BLOCK = "  IF NOT i_have_marketplace_terms() THEN\n    RAISE EXCEPTION 'TERMS_REQUIRED';\n  END IF;\n"
  const AUTH_BLOCK = "  IF v_me IS NULL OR is_anonymous_session() THEN\n    RAISE EXCEPTION 'AUTH_REQUIRED';\n  END IF;\n"
  const s0 = T190.indexOf('CREATE OR REPLACE FUNCTION public.send_listing_message('), s1 = T190.indexOf('$function$;', s0)
  let fnText = T190.slice(s0, s1)
  fnText = fnText.replace(TERMS_BLOCK, '').replace(AUTH_BLOCK, AUTH_BLOCK + TERMS_BLOCK)
  writeFileSync(mutO, T190.slice(0, s0) + fnText + T190.slice(s1))
  const dbm = await build(false)
  const r = await applyFile(dbm, mutO)
  const o = r.ok ? await sendOracle(dbm) : null
  check('red-first: terms checked straight after AUTH in send_listing_message → the oracle check FAILS (real thread: TERMS_REQUIRED, random id: NO_SUCH_CONVERSATION)',
    r.ok && o.same === false && /TERMS_REQUIRED/.test(o.words[0]) && /NO_SUCH_CONVERSATION/.test(o.words[1]), r.msg ?? o?.words)
}
{
  const db = await build(true)
  const random = 'f0000000-0000-4000-8000-0000000000ff'
  await setTerms(db, 'B', null)
  const real = await open(db, 'B'), fake = await open(db, 'B', 'x', random)
  check('start_listing_conversation: no terms → the SAME word for a live listing and a random id (no listing oracle)',
    errIs(real, 'TERMS_REQUIRED') && errIs(fake, 'TERMS_REQUIRED'), [real.err, fake.err])
  await setTerms(db, 'B', '2026-11-11')
  check('  …positive control: with terms the live listing is "sent" and the random id is NO_SUCH_LISTING (the oracle would exist without the order)',
    (await open(db, 'B')).value === 'sent' && errIs(await open(db, 'B', 'x', random), 'NO_SUCH_LISTING'))
}
{
  const db = await build(true)
  check('a guest (terms NULL) gets AUTH_REQUIRED, not TERMS_REQUIRED, on post and on start',
    errIs(await as(db, 'G', ITEM('Misafir ilanı')), 'AUTH_REQUIRED') && errIs(await open(db, 'G'), 'AUTH_REQUIRED'))
  const anon = await as(db, null, ITEM('Anon ilanı'))
  check('no session at all cannot post (anon role: no privilege)', !anon.ok, anon)
}

// ── 4. The helper ────────────────────────────────────────────────────────────────────────────────
{
  const db = await build(true)
  const me = async (who) => (await as(db, who, 'SELECT i_have_marketplace_terms()')).value
  await setTerms(db, 'S', null); await setTerms(db, 'B', '2026-11-09'); await setTerms(db, 'R', '2026-11-11')
  check('i_have_marketplace_terms(): NULL → false, 2026-11-09 → false, 2026-11-11 → true (each for the caller only)',
    (await me('S')) === false && (await me('B')) === false && (await me('R')) === true, [await me('S'), await me('B'), await me('R')])
  check('  …a guest → false; anon cannot call it; it takes no uuid (no oracle on another account)',
    (await me('G')) === false && !(await as(db, null, 'SELECT i_have_marketplace_terms()')).ok
    && !(await as(db, 'R', `SELECT i_have_marketplace_terms('${U.S}')`)).ok)
  const cmp = async (v) => { await setTerms(db, 'R', v); return me('R') }
  check('  …text comparison as the client does it: 2026-11 and 2026-11-1 are older, 2026-11-11T09:00 and 2027 are newer, lower-case "z" sorts above digits',
    (await cmp('2026-11')) === false && (await cmp('2026-11-1')) === false && (await cmp('2026-11-11T09:00')) === true && (await cmp('2027')) === true && (await cmp('z')) === true)
}

// ── 5. The migration itself ──────────────────────────────────────────────────────────────────────
{
  const db = await build(true)
  const again = await applyFile(db, F190)
  check('20261190: a second apply is a clean re-run', again.ok, again.msg)
  const sm = async d => (await d.query(`SELECT md5(prosrc) m FROM pg_proc WHERE proname IN ('send_message', 'start_conversation') ORDER BY proname`)).rows.map(r => r.m).join(',')
  check('Student Hub: send_message / start_conversation bodies are identical with and without 20261190', (await sm(db)) === (await sm(await build(false))))
  const pol = async d => (await d.query(`SELECT string_agg(tablename || ':' || policyname || ':' || cmd, ',' ORDER BY schemaname, tablename, policyname) p FROM pg_policies WHERE tablename IN ('marketplace_listings', 'marketplace_photos', 'objects')`)).rows[0].p
  check('no policy differs with and without 20261190 (marketplace_listings, marketplace_photos, storage.objects)', (await pol(db)) === (await pol(await build(false))))
  // pre-flight refusals
  const d1 = await freshDb(BASE + CRON_STUB + SEED); await applyFile(d1, F183)
  const r1 = await applyFile(d1, F190)
  check('red: only 20261183 applied → refused ("apply 20261183 and 20261184 first")', !r1.ok && /apply 20261183 and 20261184 first/.test(r1.msg), r1.msg)
  const d2 = await freshDb(BASE + CRON_STUB + SEED); await applyFile(d2, F183); await applyFile(d2, F184)
  await d2.exec(`CREATE OR REPLACE FUNCTION public.renew_marketplace_listing(p_listing_id uuid) RETURNS timestamptz LANGUAGE sql AS 'SELECT now()'`)
  const r2 = await applyFile(d2, F190)
  await d2.exec('ROLLBACK')
  check('red: a body that differs from 20261183\'s → refused, nothing applied', !r2.ok && /REFUSING: live Bandabuliya bodies differ/.test(r2.msg)
    && (await d2.query(`SELECT to_regprocedure('public.i_have_marketplace_terms()') IS NULL AS n`)).rows[0].n === true, r2.msg)
  const d3 = await build(true)
  await d3.exec(`CREATE OR REPLACE FUNCTION public.send_listing_message(p_conversation_id uuid, p_body text) RETURNS text LANGUAGE sql AS 'SELECT ''x'''`)
  const r3 = await applyFile(d3, F190)
  check('red: a body edited after 20261190 → a re-run refuses', !r3.ok && /REFUSING/.test(r3.msg), r3.msg)
  // Student Hub assertion can fail: a variant of the file that also replaces send_message
  const dir = mkdtempSync(join(tmpdir(), 'terms-'))
  const mut = join(dir, '20261190_mutant.sql')
  writeFileSync(mut, T190.replace('-- ─── 4. Assertions', `CREATE OR REPLACE FUNCTION public.send_message(p_conversation_id uuid, p_body text) RETURNS text LANGUAGE sql AS 'SELECT ''x''';\n-- ─── 4. Assertions`))
  const d4 = await build(false); const r4 = await applyFile(d4, mut)
  check('red: a variant that replaces send_message → the in-migration assertion refuses ("a Student Hub body changed")', !r4.ok && /a Student Hub body changed/.test(r4.msg), r4.msg)
  // The terms check removed from one body → the in-migration assertion refuses
  const mut2 = join(dir, '20261190_mutant2.sql')
  writeFileSync(mut2, T190.replace(/(CREATE OR REPLACE FUNCTION public\.renew_marketplace_listing[\s\S]*?)  IF NOT i_have_marketplace_terms\(\) THEN\n    RAISE EXCEPTION 'TERMS_REQUIRED';\n  END IF;\n/, '$1'))
  const d5 = await build(false); const r5 = await applyFile(d5, mut2)
  check('red: renew without its terms check → refused (pin or assertion)', !r5.ok, r5.msg)
  // Order: notice before terms in one message path
  const mut3 = join(dir, '20261190_mutant3.sql')
  const m3 = T190.replace(/(CREATE OR REPLACE FUNCTION public\.start_listing_conversation[\s\S]*?)(  IF NOT i_have_marketplace_terms\(\) THEN\n    RAISE EXCEPTION 'TERMS_REQUIRED';\n  END IF;\n)([\s\S]*?)(  IF \(SELECT marketplace_notice_at FROM profiles WHERE id = v_me\) IS NULL THEN\n    RAISE EXCEPTION 'NOTICE_REQUIRED';\n  END IF;\n)/, '$1$3$4$2')
  writeFileSync(mut3, m3)
  const d6 = await build(false); const r6 = await applyFile(d6, mut3)
  check('red: the notice checked before the terms → refused', m3 !== T190 && !r6.ok && /checks the safety notice before the terms/.test(r6.msg), r6.msg)
  // Re-applying 20261183 / 20261184 after 20261190 restores the ungated bodies (documented in the header)
  const d7 = await build(true)
  await applyFile(d7, F183); await applyFile(d7, F184)
  await setTerms(d7, 'S', null)
  check('consequence (header): re-applying 20261183 + 20261184 AFTER 20261190 removes the gate again (the post is allowed)', (await as(d7, 'S', ITEM('Üçüncü eşya'))).ok === true)
}

// ── 5b. service_role must hold EXECUTE on the helper explicitly (the update guard is SECURITY INVOKER) ──────────────
{
  // A project without Supabase's default EXECUTE grants: the helper is created, then service_role's EXECUTE is revoked
  // right before the file's own GRANT line. Real file: that line puts it back. Mutant: the line names authenticated only.
  const GRANT = 'GRANT EXECUTE ON FUNCTION public.i_have_marketplace_terms() TO authenticated, service_role;'
  const NOGRANT = 'GRANT EXECUTE ON FUNCTION public.i_have_marketplace_terms() TO authenticated;'
  const REVOKE = 'REVOKE EXECUTE ON FUNCTION public.i_have_marketplace_terms() FROM service_role;\n'
  const ASSERT_SVC = /  IF NOT has_function_privilege\('service_role'[\s\S]*?END IF;\n/
  check('the file grants EXECUTE on the helper to authenticated and service_role, and asserts service_role holds it', T190.includes(GRANT) && ASSERT_SVC.test(T190))
  const dir = mkdtempSync(join(tmpdir(), 'terms-svc-'))
  const real = join(dir, '20261190_real_noprivs.sql'), mutA = join(dir, '20261190_nogrant_noassert.sql'), mutB = join(dir, '20261190_nogrant_assert.sql')
  writeFileSync(real, T190.replace(GRANT, REVOKE + GRANT))
  writeFileSync(mutA, T190.replace(GRANT, REVOKE + NOGRANT).replace(ASSERT_SVC, ''))
  writeFileSync(mutB, T190.replace(GRANT, REVOKE + NOGRANT))
  const upd = db => as(db, 'svc', `UPDATE marketplace_listings SET status = 'sold' WHERE id = '${db.listing}' RETURNING id`)
  const dA = await build(false); const rA = await applyFile(dA, mutA)
  const uA = rA.ok ? await upd(dA) : null
  console.log('RED (no explicit service_role grant, EXECUTE revoked): applied=' + rA.ok + '  service-role status-only update: ' + (uA ? (uA.ok ? 'ok' : uA.err) : 'n/a'))
  check('red: without the explicit grant a service-role status-only UPDATE fails ("permission denied for function")', rA.ok && uA && !uA.ok && /permission denied for function/.test(uA.err), uA ?? rA.msg)
  const dB = await build(false); const rB = await applyFile(dB, real)
  const uB = rB.ok ? await upd(dB) : null
  console.log('GREEN (the file, same EXECUTE revoke before its GRANT): applied=' + rB.ok + '  service-role status-only update: ' + (uB ? (uB.ok ? 'ok' : uB.err) : 'n/a'))
  check('green: with the explicit grant the same service-role status-only UPDATE passes', rB.ok && uB && uB.ok && uB.rows.length === 1 && (await listingRow(dB)).status === 'sold', uB ?? rB.msg)
  const dC = await build(false); const rC = await applyFile(dC, mutB)
  check('red: grant dropped but the in-migration assertion kept → the migration refuses ("service_role must be able to call")', !rC.ok && /service_role must be able to call/.test(rC.msg), rC.msg)
  const dD = await build(true)
  const priv = async r => (await dD.query(`SELECT has_function_privilege('${r}', 'public.i_have_marketplace_terms()', 'EXECUTE') AS p`)).rows[0].p
  check('privileges on the helper after the file: authenticated yes, service_role yes (positive controls), anon no, PUBLIC (as a role) no',
    (await priv('authenticated')) === true && (await priv('service_role')) === true && (await priv('anon')) === false, [await priv('authenticated'), await priv('service_role'), await priv('anon')])
}

// ── 6. verify_schema tokens, before and after ────────────────────────────────────────────────────
{
  const vs = readFileSync(rel('../supabase/verify_schema.sql'), 'utf8')
  const start = vs.indexOf('-- ── H. BEHAVIOR / VERSION TOKENS'), end = vs.indexOf('  ) z', start)
  const H = vs.slice(start, end)
  const tokens = []
  const first = /SELECT '([^']*)' m, '((?:[^']|'')*)' label,\n/.exec(H)
  const re = /UNION ALL SELECT '([^']*)',\s*'((?:[^']|'')*)',\s*\n?/g
  const marks = []
  if (first) marks.push({ m: first[1], label: first[2], at: first.index + first[0].length, kind: 'first' })
  let m; while ((m = re.exec(H))) marks.push({ m: m[1], label: m[2], at: m.index + m[0].length, kind: 'u', idx: m.index })
  marks.sort((a, b) => a.at - b.at)
  marks.forEach((k, i) => {
    const nextStart = marks[i + 1] ? (marks[i + 1].kind === 'u' ? marks[i + 1].idx : H.length) : H.length
    // the expression runs to the line before the next "UNION ALL SELECT" (comments between tokens are dropped by the sql parser)
    tokens.push({ label: `${k.m}: ${k.label.replace(/''/g, "'").slice(0, 70)}`, expr: H.slice(k.at, nextStart) })
  })
  const evalOn = async (db, tk) => {
    const r = await as(db, 'postgres_role', `SELECT (${tk.expr}) AS ok`).catch(() => null)
    return r
  }
  async function run(db, tk) {
    try { await db.exec('RESET role;'); const r = await db.query(`SELECT (${tk.expr}) AS ok`); return String(r.rows[0].ok) }
    catch (e) { return 'error: ' + String(e.message).split('\n')[0].slice(0, 60) }
  }
  void evalOn
  const before = await build(false), after = await build(true)
  const rows = []
  for (const tk of tokens) rows.push({ label: tk.label, before: await run(before, tk), after: await run(after, tk) })
  const changed = rows.filter(r => r.before !== r.after)
  const mine = rows.filter(r => r.label.startsWith('20261190'))
  const summary = (k) => ['true', 'false'].map(v => `${v}=${rows.filter(r => r[k] === v).length}`).concat(`error=${rows.filter(r => r[k].startsWith('error')).length}`).join(' ')
  console.log(`\nH tokens parsed: ${rows.length}. Before 20261190: ${summary('before')}. After: ${summary('after')}.`)
  console.log('tokens whose result differs before/after 20261190:'); for (const r of changed) console.log(`  ${r.label}   ${r.before} -> ${r.after}`)
  const NAMES = /marketplace_listing_insert_guard|marketplace_listing_update_guard|renew_marketplace_listing|marketplace_photo_insert_guard|send_listing_message|start_listing_conversation|\bsend_message\b|\bstart_conversation\b|i_am_adult/
  const naming = tokens.filter(tk => !tk.label.startsWith('20261190') && NAMES.test(tk.expr)).map(tk => tk.label)
  console.log(`existing tokens whose expression names one of the replaced / neighbouring bodies (${naming.length}):`); for (const l of naming) console.log('  ' + l)
  check('H tokens: the existing tokens that name those bodies are found (positive control) and read the same before and after', naming.length >= 3 && naming.every(l => changed.every(r => r.label !== l)), naming)
  check('H tokens: the parser found them (positive control)', rows.length >= 400, rows.length)
  check('H tokens: EVERY existing token reads the same before and after 20261190 (nothing pinning a replaced body goes red)',
    changed.filter(r => !r.label.startsWith('20261190')).length === 0, changed.filter(r => !r.label.startsWith('20261190')))
  const SH = /Student Hub send_message/
  check('H tokens: the 8 20261190 tokens are TRUE after; the 7 that pin new behaviour are not true before, the Student Hub negative is true both ways (unchanged bodies)',
    mine.length === 8 && mine.every(r => r.after === 'true') && mine.filter(r => !SH.test(r.label)).every(r => r.before !== 'true')
    && mine.filter(r => SH.test(r.label)).every(r => r.before === 'true'), mine)
  // the three regexes use `.*` across lines: in PostgreSQL's default ARE mode `.` matches a newline, which is checked here
  // with a positive and a negative control on this engine (a newline-sensitive `(?n)` would flip the first one)
  const nl = async sql => (await after.query(`SELECT (${sql}) AS r`)).rows[0].r
  check('regex control: `.` crosses a newline in the default mode (true), does not with (?n) (false); `[\\s\\S]` is not used in verify_schema',
    (await nl(`E'a\\nb' ~ 'a.*b'`)) === true && (await nl(`E'a\\nb' ~ '(?n)a.*b'`)) === false && (await nl(`E'a\\nb' ~ 'a.b'`)) === true && !/\[\\s\\S\]/.test(vs))
  // red: re-applying 20261183 + 20261184 after 20261190 (ungated bodies back) turns them red
  const re2 = await build(true); await applyFile(re2, F183); await applyFile(re2, F184)
  const redRows = []; for (const tk of tokens.filter(t => t.label.startsWith('20261190'))) redRows.push({ label: tk.label, v: await run(re2, tk) })
  const isHelper = r => /i_have_marketplace_terms\(\):/.test(r.label), isSH = r => SH.test(r.label)
  check('H tokens red-first: after re-applying 20261183/84 on top, exactly the 6 replaced-body tokens are red; the helper token and the Student Hub negative stay true',
    redRows.length === 8 && redRows.filter(r => !isHelper(r) && !isSH(r)).length === 6 && redRows.filter(r => !isHelper(r) && !isSH(r)).every(r => r.v === 'false')
    && redRows.filter(r => isHelper(r) || isSH(r)).every(r => r.v === 'true'), redRows)
}

// ── 7. verify_schema.sql still parses whole (the C / G tuple lists were edited by script) ───────────────────────────
{
  const vs = readFileSync(rel('../supabase/verify_schema.sql'), 'utf8')
  const q1 = vs.slice(vs.indexOf('WITH report AS ('), vs.indexOf('═══ QUERY 2 / 5'))
  const db = await build(true)
  const code = async sql => { try { await db.query(sql); return 'ok' } catch (e) { await db.exec('ROLLBACK').catch(() => {}); return String(e.code ?? e.message) } }
  const got = await code(q1)
  console.log('QUERY 1 on the fixture database: ' + got + ' (42P01 = a table this fixture lacks, i.e. already past the parser)')
  check('verify_schema QUERY 1 parses (any error but 42601 syntax)', q1.length > 100000 && got !== '42601', got)
  // positive control: the same text with one comma removed from the registered tuples must be a syntax error
  const marker = "('20261190_marketplace_terms','i_have_marketplace_terms'),"
  const broken = q1.replace(marker, "('20261190_marketplace_terms','i_have_marketplace_terms')")
  check('  …control: one comma removed from a registered tuple list is a syntax error (42601)', broken !== q1 && await code(broken) === '42601')
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
