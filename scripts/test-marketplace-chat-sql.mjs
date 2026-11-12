// 20261184 (Bandabuliya chat) on top of 20261183, against the live messaging fixture + Araçlar prerequisites.
// Student Hub's own outcomes are scripts/test-marketplace-messaging-sql.mjs (MARKETPLACE_MIGRATIONS=…).
//   node scripts/test-marketplace-chat-sql.mjs
// PGlite = PostgreSQL 18; prod is 17.6. Evidence about the RPC outcomes seeded here, nothing else.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { freshDb, applyFile } from './migration-harness.mjs'

const rel = p => fileURLToPath(new URL(p, import.meta.url))
const BASE = readFileSync(rel('./fixtures/messaging-live.sql'), 'utf8') + readFileSync(rel('./fixtures/marketplace-prereqs.sql'), 'utf8') +
  // 20261191 stands on the real profiles triggers (profiles-terms-prereqs.sql adds the columns the name trigger reads)
  readFileSync(rel('./fixtures/profiles-terms-prereqs.sql'), 'utf8') + readFileSync(rel('./fixtures/profiles-triggers-live-2026-10-07.sql'), 'utf8')
const FILES = ['20261183_marketplace_listings.sql', '20261184_marketplace_messaging.sql', '20261190_marketplace_terms.sql', '20261191_accept_terms_server.sql'].map(f => rel('../supabase/migrations/' + f))

const U = {
  S: 'a0000000-0000-4000-8000-00000000000a',  // adult seller, not a student
  B: 'b0000000-0000-4000-8000-00000000000b',  // adult buyer, not a student
  T: '10000000-0000-4000-8000-000000000001',  // 15-year-old buyer
  L: 'c0000000-0000-4000-8000-00000000000c',  // listed adult student (Student Hub)
  N: 'd0000000-0000-4000-8000-00000000000d',  // adult who has NOT read the notice
  G: '20000000-0000-4000-8000-000000000002',  // guest
}
const INST = '30000000-0000-4000-8000-000000000003'
const SEED = `
INSERT INTO auth.users VALUES ${Object.values(U).map(u => `('${u}')`).join(',')};
INSERT INTO profiles (id, display_name, date_of_birth, push_token, terms_version) VALUES
  ('${U.S}', 'Satıcı', '1988-01-01', 'ExponentPushToken[s]', '2026-11-11'), ('${U.B}', 'Alıcı', '1990-01-01', NULL, '2026-11-11'),
  ('${U.T}', 'Genç', (current_date - interval '15 years')::date, NULL, '2026-11-11'), ('${U.L}', 'Öğrenci', '1999-01-01', NULL, '2026-11-11'),
  ('${U.N}', 'Okumadı', '1990-01-01', NULL, '2026-11-11'), ('${U.G}', NULL, NULL, NULL, NULL);
INSERT INTO institutions VALUES ('${INST}', true);
INSERT INTO student_education (user_id, institution_id, level, listing_opt_in) VALUES ('${U.L}', '${INST}', 'university', true);
`
async function as(db, who, sql) {
  const claims = who === 'G' ? { sub: U.G, is_anonymous: true } : { sub: U[who] }
  try {
    await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)])
    await db.exec('SET role authenticated;')
    const r = await db.query(sql)
    return { ok: true, rows: r.rows, value: r.rows[0] ? Object.values(r.rows[0])[0] : null }
  } catch (e) { return { ok: false, err: e.message } } finally { await db.exec('RESET role;') }
}
const errIs = (r, code) => !r.ok && r.err.includes(code)
const notice = (db, who) => as(db, who, `SELECT accept_marketplace_notice('2026-11-07')`)
async function build(files = FILES) {
  const db = await freshDb(BASE + SEED)
  for (const f of files) { const r = await applyFile(db, f); if (!r.ok) throw new Error(f + ': ' + r.msg) }
  for (const w of ['S', 'B', 'T', 'L']) await notice(db, w)
  const r = await as(db, 'S', `INSERT INTO marketplace_listings (title, description, price_tl, is_free, category, condition, district)
    VALUES ('Gitar satılık', 'Akustik gitar, çok iyi durumda.', 3000, false, 'hobby_music', 'like_new', 'nicosia') RETURNING id`)
  if (!r.ok) throw new Error(r.err)
  db.listing = r.value
  return db
}
const open = (db, who, body = 'Merhaba, hâlâ satılık mı?') => as(db, who, `SELECT start_listing_conversation('${db.listing}', '${body}')`)
const thread = async (db, who) => (await as(db, who, `SELECT conversation_id FROM list_conversations('listing')`)).value
const send = (db, who, id, body = 'Evet') => as(db, who, `SELECT send_message('${id}', '${body}')`)

let failed = 0
const check = (name, ok, got) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  got: ' + JSON.stringify(got)}`) }

const CASES = [
  ['adult buyer (not a student) → seller: sent; seller replies; buyer continues', async db => {
    const r = await open(db, 'B'); const id = await thread(db, 'S')
    return r.value === 'sent' && id && (await send(db, 'S', id)).value === 'sent' && (await send(db, 'B', id, 'Yarın bakabilir miyim?')).value === 'sent'
  }],
  ['TEEN buyer → adult seller: sent, and the seller can reply (the existing age rule, unchanged)', async db => {
    const r = await open(db, 'T'); const id = await thread(db, 'S')
    return r.value === 'sent' && (await send(db, 'S', id)).value === 'sent'
  }],
  ['adult → teen can never happen: a seller cannot open a thread on their own listing', async db => errIs(await open(db, 'S'), 'OWN_LISTING')],
  ['age rule is still applied: with may_initiate_by_age refusing, the buyer gets "refused"', async db => {
    await db.exec(`CREATE OR REPLACE FUNCTION public.may_initiate_by_age(p_sender uuid, p_recipient uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false'`)
    return (await open(db, 'B')).value === 'refused'
  }],
  ['notice not read → NOTICE_REQUIRED (open), and for a reply', async db => {
    const r = await open(db, 'N')
    const id = (await open(db, 'B'), await thread(db, 'B'))
    await db.exec(`SELECT set_config('app.trusted_marketplace_notice', 'on', false); UPDATE profiles SET marketplace_notice_at = NULL WHERE id = '${U.S}'; SELECT set_config('app.trusted_marketplace_notice', 'off', false);`)
    return errIs(r, 'NOTICE_REQUIRED') && errIs(await send(db, 'S', id), 'NOTICE_REQUIRED')
  }],
  ['guest → AUTH_REQUIRED', async db => errIs(await open(db, 'G'), 'AUTH_REQUIRED')],
  ['buyer must wait for the seller (AWAITING_ACCEPTANCE)', async db => {
    await open(db, 'B'); return errIs(await send(db, 'B', await thread(db, 'B')), 'AWAITING_ACCEPTANCE')
  }],
  ['second live thread for the same listing → CONVERSATION_EXISTS; a second listing is a new thread', async db => {
    await open(db, 'B')
    const r2 = await open(db, 'B')
    const l2 = (await as(db, 'S', `INSERT INTO marketplace_listings (title, description, price_tl, is_free, category, condition, district)
      VALUES ('Amfi satılık', 'Gitar amfisi, temiz.', 1200, false, 'hobby_music', 'used', 'nicosia') RETURNING id`)).value
    const r3 = await as(db, 'B', `SELECT start_listing_conversation('${l2}', 'Amfi de var mı?')`)
    const n = (await as(db, 'B', `SELECT count(*)::int FROM list_conversations('listing')`)).value
    return errIs(r2, 'CONVERSATION_EXISTS') && r3.value === 'sent' && n === 2
  }],
  ['a Bandabuliya thread does not block a Student Hub thread with the same person (and vice versa)', async db => {
    await db.exec(`INSERT INTO student_education (user_id, institution_id, level, listing_opt_in) VALUES ('${U.S}', '${INST}', 'university', true)`)
    await as(db, 'L', `SELECT start_conversation('${U.S}', 'selam')`)
    const r = await as(db, 'L', `SELECT start_listing_conversation('${db.listing}', 'Gitar için yazıyorum')`)
    return r.value === 'sent'
  }],
  ['inboxes are split: Student Hub list shows no Bandabuliya thread; a non-student CAN list Bandabuliya', async db => {
    await open(db, 'L')
    const sh = (await as(db, 'L', `SELECT count(*)::int FROM list_conversations()`)).value
    const mk = (await as(db, 'L', `SELECT count(*)::int FROM list_conversations('listing')`)).value
    const nonStudent = await as(db, 'B', `SELECT count(*)::int FROM list_conversations('listing')`)
    const nonStudentSH = await as(db, 'B', `SELECT * FROM list_conversations()`)
    return sh === 0 && mk === 1 && nonStudent.ok && errIs(nonStudentSH, 'NOT_LISTED')
  }],
  ['inbox carries the listing; "Satıldı" stays readable; title vanishes when the listing is hidden', async db => {
    await open(db, 'B')
    await as(db, 'S', `UPDATE marketplace_listings SET status = 'sold' WHERE id = '${db.listing}'`)
    const sold = (await as(db, 'B', `SELECT listing_title, listing_status, listing_available FROM list_conversations('listing')`)).rows[0]
    await as(db, 'T', `INSERT INTO content_reports (reporter_id, content_type, content_id, reason) VALUES ('${U.T}', 'listing', '${db.listing}', 'spam')`)
    const hid = (await as(db, 'B', `SELECT listing_title, listing_available FROM list_conversations('listing')`)).rows[0]
    return sold.listing_title === 'Gitar satılık' && sold.listing_status === 'sold' && sold.listing_available === true
      && hid.listing_title === null && hid.listing_available === false
  }],
  ['sold / hidden / deleted listing: no NEW thread (NO_SUCH_LISTING)', async db => {
    await as(db, 'S', `UPDATE marketplace_listings SET status = 'sold' WHERE id = '${db.listing}'`)
    return errIs(await open(db, 'B'), 'NO_SUCH_LISTING')
  }],
  ['block (either way) closes the thread and refuses a new one', async db => {
    await open(db, 'B'); const id = await thread(db, 'S'); await send(db, 'S', id)
    await as(db, 'S', `SELECT block_user('${U.B}')`)
    // 'refused', the one word for block / decline / age: the buyer cannot learn they were blocked.
    return errIs(await send(db, 'B', id), 'CONVERSATION_CLOSED') && (await open(db, 'B')).value === 'refused'
  }],
  ['declined for this listing → that buyer gets "refused" for it again', async db => {
    await open(db, 'B'); const id = await thread(db, 'S')
    await as(db, 'S', `SELECT decline_conversation('${id}')`)
    return (await open(db, 'B')).value === 'refused'
  }],
  ['the 24 h cap is shared with Student Hub', async db => {
    await db.exec(`INSERT INTO conversation_attempts (initiator_id, recipient_id, outcome) SELECT '${U.B}', '${U.S}', 'refused' FROM generate_series(1, 50)`)
    return errIs(await open(db, 'B'), 'RATE_LIMITED')
  }],
  ['word filter applies to Bandabuliya messages', async db => errIs(await open(db, 'B', 'bu yasakkelime'), 'BLOCKED_TERM')],
  ['push for a Bandabuliya thread: screen marketplace_conversation + listing_id; Student Hub push unchanged', async db => {
    await open(db, 'B')
    const mk = (await db.query(`SELECT body->'data' d FROM _posts`)).rows.pop()?.d
    await db.exec(`DELETE FROM _posts; UPDATE profiles SET push_token = 'ExponentPushToken[l]' WHERE id = '${U.S}';
      INSERT INTO student_education (user_id, institution_id, level, listing_opt_in) VALUES ('${U.S}', '${INST}', 'university', true)`)
    await as(db, 'L', `SELECT start_conversation('${U.S}', 'selam')`)
    const sh = (await db.query(`SELECT body->'data' d FROM _posts`)).rows.pop()?.d
    return mk?.screen === 'marketplace_conversation' && mk?.listing_id === db.listing && sh?.screen === 'conversation' && !('listing_id' in (sh || {}))
  }],
  ['send_listing_message is not client-callable', async db => !(await as(db, 'B', `SELECT send_listing_message(gen_random_uuid(), 'x')`)).ok],
]

for (const [name, fn] of CASES) {
  let ok, got
  try { ok = await fn(await build()) } catch (e) { ok = false; got = e.message }
  check(name, ok === true, got)
}
{
  const db = await build(FILES.slice(0, 2))
  const again = await applyFile(db, FILES[1])
  check('20261184 second apply is a clean re-run', again.ok, again.msg)
}
{
  const db = await freshDb(BASE + SEED + `CREATE OR REPLACE FUNCTION public.send_message(p_conversation_id uuid, p_body text) RETURNS text LANGUAGE sql AS 'SELECT ''x''';`)
  await applyFile(db, FILES[0])
  const r = await applyFile(db, FILES[1])
  check('red: a drifted send_message body → refused', !r.ok && /REFUSING: live messaging bodies changed/.test(r.msg), r.msg)
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
