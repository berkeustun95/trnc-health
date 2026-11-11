// Student Hub messaging regression suite, run against the LIVE bodies (scripts/fixtures/messaging-live.sql,
// probe 42413063083) and again with the marketplace migrations applied on top: a marketplace change that alters
// any Student Hub outcome fails here. Red-first: each broken variant below must make its target case fail.
//   node scripts/test-marketplace-messaging-sql.mjs
// PGlite = PostgreSQL 18; prod is 17.6. Evidence about the RPC outcomes seeded here, nothing else.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { freshDb, applyFile } from './migration-harness.mjs'

const MIGRATIONS = (process.env.MARKETPLACE_MIGRATIONS || '').split(' ').filter(Boolean)
  .map(f => fileURLToPath(new URL('../supabase/migrations/' + f, import.meta.url)))
// With migrations: also the prerequisites they build on (Araçlar S1, storage, report constraints).
const FIXTURE = ['./fixtures/messaging-live.sql', ...(MIGRATIONS.length ? ['./fixtures/marketplace-prereqs.sql'] : [])]
  .map(f => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8')).join('\n')

const U = {
  A: 'a0000000-0000-4000-8000-00000000000a', B: 'b0000000-0000-4000-8000-00000000000b',
  C: 'c0000000-0000-4000-8000-00000000000c', D: 'd0000000-0000-4000-8000-00000000000d',
  E: 'e0000000-0000-4000-8000-00000000000e', F: 'f0000000-0000-4000-8000-00000000000f',
  M: '10000000-0000-4000-8000-000000000001', G: '20000000-0000-4000-8000-000000000002',
}
const INST = '30000000-0000-4000-8000-000000000003'
const ADULT = `'1990-01-01'`
const MINOR = `(current_date - interval '15 years')::date`
const SEED = `
INSERT INTO auth.users VALUES ${Object.values(U).map(u => `('${u}')`).join(',')};
INSERT INTO profiles (id, display_name, date_of_birth) VALUES
  ('${U.A}', 'Ayla', ${ADULT}), ('${U.B}', 'Burak', ${ADULT}), ('${U.C}', 'Cem', ${ADULT}),
  ('${U.D}', 'Deniz', ${ADULT}), ('${U.E}', 'Ece', ${ADULT}), ('${U.F}', 'Fatma', ${ADULT}),
  ('${U.M}', 'Mert', ${MINOR}), ('${U.G}', NULL, NULL);
UPDATE profiles SET push_token = 'ExponentPushToken[b]' WHERE id = '${U.B}';
INSERT INTO institutions VALUES ('${INST}', true);
INSERT INTO student_education (user_id, institution_id, level, listing_opt_in) VALUES
  ('${U.A}', '${INST}', 'university', true), ('${U.B}', '${INST}', 'university', true),
  ('${U.D}', '${INST}', 'university', true), ('${U.E}', '${INST}', 'university', true),
  ('${U.F}', '${INST}', 'university', true), ('${U.M}', '${INST}', 'high_school', true);
`

// Run one statement as a user; returns { ok, value, err } with the exception text.
async function as(db, who, sql) {
  const claims = who === 'G' ? { sub: U.G, is_anonymous: true } : { sub: U[who] }
  try {
    await db.exec(`SET role authenticated; SELECT set_config('request.jwt.claims', '${JSON.stringify(claims)}', false);`)
    const r = await db.query(sql)
    return { ok: true, value: r.rows[0] ? Object.values(r.rows[0])[0] : null, rows: r.rows }
  } catch (e) { return { ok: false, err: e.message } } finally { await db.exec('RESET role;') }
}
const start = (db, who, to, body = 'merhaba') => as(db, who, `SELECT start_conversation('${U[to]}', '${body}')`)
const conv = async (db, x, y) => (await db.query(`SELECT id FROM conversations WHERE pair_lo = least('${U[x]}'::uuid,'${U[y]}'::uuid)
  AND pair_hi = greatest('${U[x]}'::uuid,'${U[y]}'::uuid) ORDER BY created_at DESC LIMIT 1`)).rows[0]?.id
const send = (db, who, id, body = 'selam') => as(db, who, `SELECT send_message('${id}', '${body}')`)
const errIs = (r, code) => !r.ok && r.err.includes(code)

// Each case: [name, async db => boolean]. Every case gets its own fresh database.
const CASES = [
  ['listed adult → listed adult: sent, one thread, one message, one push', async db => {
    const r = await start(db, 'A', 'B')
    const n = (await db.query(`SELECT (SELECT count(*) FROM conversations)::int c, (SELECT count(*) FROM messages)::int m, (SELECT count(*) FROM _posts)::int p`)).rows[0]
    return r.value === 'sent' && n.c === 1 && n.m === 1 && n.p === 1
  }],
  ['initiator cannot send again before acceptance (AWAITING_ACCEPTANCE)', async db => {
    await start(db, 'A', 'B'); return errIs(await send(db, 'A', await conv(db, 'A', 'B')), 'AWAITING_ACCEPTANCE')
  }],
  ['recipient reply accepts; then the initiator can send', async db => {
    await start(db, 'A', 'B'); const id = await conv(db, 'A', 'B')
    const r1 = await send(db, 'B', id); const r2 = await send(db, 'A', id)
    const acc = (await db.query(`SELECT accepted_at IS NOT NULL a FROM conversations WHERE id = '${id}'`)).rows[0].a
    return r1.value === 'sent' && r2.value === 'sent' && acc
  }],
  ['second live thread for the same pair → CONVERSATION_EXISTS', async db => {
    await start(db, 'A', 'B'); return errIs(await start(db, 'B', 'A'), 'CONVERSATION_EXISTS')
  }],
  ['non-listed sender → NOT_LISTED', async db => errIs(await start(db, 'C', 'A'), 'NOT_LISTED')],
  ['non-listed recipient → refused', async db => (await start(db, 'A', 'C')).value === 'refused'],
  ['guest → AUTH_REQUIRED', async db => errIs(await start(db, 'G', 'A'), 'AUTH_REQUIRED')],
  ['adult → minor → refused (age rule)', async db => (await start(db, 'D', 'M')).value === 'refused'],
  ['minor → adult → sent, and the adult can reply', async db => {
    const r = await start(db, 'M', 'D'); const id = await conv(db, 'M', 'D')
    return r.value === 'sent' && (await send(db, 'D', id)).value === 'sent'
  }],
  ['block closes the thread both ways and refuses a new start', async db => {
    await start(db, 'A', 'B'); const id = await conv(db, 'A', 'B'); await send(db, 'B', id)
    await as(db, 'B', `SELECT block_user('${U.A}')`)
    return errIs(await send(db, 'A', id), 'CONVERSATION_CLOSED') && (await start(db, 'A', 'B')).value === 'refused'
  }],
  ['declined initiator may never re-initiate; the decliner still may', async db => {
    await start(db, 'E', 'F'); const id = await conv(db, 'E', 'F')
    await as(db, 'F', `SELECT decline_conversation('${id}')`)
    return (await start(db, 'E', 'F')).value === 'refused' && (await start(db, 'F', 'E')).value === 'sent'
  }],
  ['list_conversations: participant sees the thread, non-listed → NOT_LISTED', async db => {
    await start(db, 'A', 'B'); const r = await as(db, 'B', `SELECT count(*)::int FROM list_conversations()`)
    return r.value === 1 && errIs(await as(db, 'C', `SELECT * FROM list_conversations()`), 'NOT_LISTED')
  }],
  ['blocked term in the opening message → BLOCKED_TERM', async db => errIs(await start(db, 'A', 'B', 'bu yasakkelime var'), 'BLOCKED_TERM')],
  ['50 attempts in 24 h → RATE_LIMITED', async db => {
    await db.exec(`INSERT INTO conversation_attempts (initiator_id, recipient_id, outcome)
      SELECT '${U.A}', '${U.B}', 'refused' FROM generate_series(1, 50)`)
    return errIs(await start(db, 'A', 'D'), 'RATE_LIMITED')
  }],
  ['recipient no longer listed → reply refused (CONVERSATION_CLOSED)', async db => {
    await start(db, 'A', 'B'); const id = await conv(db, 'A', 'B'); await send(db, 'B', id)
    await db.exec(`UPDATE student_education SET listing_opt_in = false WHERE user_id = '${U.B}'`)
    return errIs(await send(db, 'A', id), 'CONVERSATION_CLOSED')
  }],
  // 20261190: Student Hub asks nothing of the Bandabuliya terms. profiles.terms_version is NULL for A (never accepted any) and
  // '2026-09' for B (an old version): start, reply, accept and the inbox all work exactly as with current terms.
  ['terms NULL / older (2026-09) on both sides: start, reply, continue and inbox are unchanged', async db => {
    await db.exec(`UPDATE profiles SET terms_version = NULL WHERE id = '${U.A}'; UPDATE profiles SET terms_version = '2026-09' WHERE id = '${U.B}'`)
    const r = await start(db, 'A', 'B'); const id = await conv(db, 'A', 'B')
    const r1 = await send(db, 'B', id); const r2 = await send(db, 'A', id)
    const inbox = await as(db, 'B', `SELECT count(*)::int FROM list_conversations()`)
    return r.value === 'sent' && r1.value === 'sent' && r2.value === 'sent' && inbox.value === 1
  }],
  ['terms NULL on the SENDER of a reply (listed student, never accepted anything): reply still accepted', async db => {
    await start(db, 'A', 'B'); const id = await conv(db, 'A', 'B')
    await db.exec(`UPDATE profiles SET terms_version = NULL WHERE id IN ('${U.A}', '${U.B}')`)
    return (await send(db, 'B', id)).value === 'sent' && (await send(db, 'A', id)).value === 'sent'
  }],
  ['clients cannot write conversations or messages directly', async db => {
    const r1 = await as(db, 'A', `INSERT INTO conversations (initiator_id, recipient_id) VALUES ('${U.A}', '${U.B}')`)
    return !r1.ok
  }],
]

async function build(extra = '', post = '') {
  const db = await freshDb(FIXTURE + SEED + extra)
  for (const f of MIGRATIONS) {
    const r = await applyFile(db, f)
    if (!r.ok) throw new Error(`migration ${f} failed: ${r.msg}`)
  }
  if (post) await db.exec(post)
  return db
}
async function runSuite(extra = '', post = '') {
  const out = []
  for (const [name, fn] of CASES) {
    let ok
    try { ok = await fn(await build(extra, post)) } catch { ok = false }  // a case that throws (e.g. no thread was created) is a failed case; assigning to the string `name` threw a TypeError here
    out.push([name, ok === true])
  }
  return out
}

let failed = 0
const check = (name, ok, got) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  got: ' + JSON.stringify(got)}`) }

// 0. The fixture IS the live system: its bodies hash to the probe's md5s.
if (!MIGRATIONS.length) {
  const LIVE_MD5 = {
    start_conversation: 'ebc64230658bf71451bd47d3abf236d7', send_message: '384abcad73aaa28c00d15a2dbf84a63d',
    list_conversations: 'da2984e37a90a7ceff8128b5d4bdafb0', notify_new_message: '3cd1e046ff8149cfb09214421c469f2b',
    may_initiate_by_age: '4ba8dd5b6f6fb8410870084a27ad8d8b', enforce_message_age_rule: 'fd3b5c3f9b102b5d008826e18ed413b6',
    is_listed_student: 'db3cf1989fea55b88635d3ff7b8153fd', block_user: '58bfe272a4fc1d384973e978b27b5d78',
  }
  const db = await freshDb(FIXTURE)
  const rows = (await db.query(`SELECT proname, md5(prosrc) m FROM pg_proc WHERE proname = ANY($1)`, [Object.keys(LIVE_MD5)])).rows
  const bad = Object.entries(LIVE_MD5).filter(([n, m]) => rows.find(r => r.proname === n)?.m !== m).map(([n]) => n)
  check(`fixture bodies = live md5 (${Object.keys(LIVE_MD5).length} functions)`, bad.length === 0, bad)
}

// 1. The suite, green.
const label = MIGRATIONS.length ? `with ${MIGRATIONS.map(f => f.split('/').pop()).join(' + ')}` : 'live fixture'
for (const [name, ok] of await runSuite()) check(`[${label}] ${name}`, ok)

// 2. Red-first: break one rule at a time; the case that guards it must fail.
const BREAKS = [
  ['age rule removed from start_conversation', 'adult → minor → refused (age rule)',
   `CREATE OR REPLACE FUNCTION public.may_initiate_by_age(p_sender uuid, p_recipient uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true';`],
  ['listed check always true', 'non-listed sender → NOT_LISTED',
   `CREATE OR REPLACE FUNCTION public.can_see_student_lists() RETURNS boolean LANGUAGE sql AS 'SELECT true';`],
  ['block check gone from send_message', 'block closes the thread both ways and refuses a new start',
   `DROP TABLE blocks CASCADE; CREATE TABLE blocks (blocker_id uuid, blocked_id uuid, origin text, created_at timestamptz DEFAULT now(), PRIMARY KEY (blocker_id, blocked_id));
    CREATE OR REPLACE FUNCTION public.block_user(p_user_id uuid) RETURNS void LANGUAGE sql AS 'SELECT NULL::void';`],
  ['word filter trigger dropped', 'blocked term in the opening message → BLOCKED_TERM',
   `DROP TRIGGER msg_30_ugc_screen ON public.messages;`],
]
// Red-first for the 20261190 cases (with the migrations applied): put the Bandabuliya terms gate INTO the two Student Hub
// functions after the fact; the cases that say "Student Hub asks nothing of terms" must fail.
if (MIGRATIONS.some(f => f.includes('20261190_marketplace_terms'))) {
  const gate = fn => `DO $m$ DECLARE d text; BEGIN
    d := pg_get_functiondef('public.${fn}'::regprocedure);
    IF position('IF NOT can_see_student_lists() THEN' IN d) = 0 THEN RAISE EXCEPTION 'mutation anchor missing in ${fn}'; END IF;
    EXECUTE replace(d, 'IF NOT can_see_student_lists() THEN', 'IF NOT i_have_marketplace_terms() THEN RAISE EXCEPTION ''TERMS_REQUIRED''; END IF; IF NOT can_see_student_lists() THEN');
  END $m$;`
  for (const [what, post] of [['start_conversation', gate('start_conversation(uuid,text)')], ['send_message', gate('send_message(uuid,text)')]]) {
    const res = await runSuite('', post)
    const hit = res.filter(([n]) => n.startsWith('terms NULL'))
    check(`red: a terms gate inside Student Hub's ${what} → both terms cases fail`, hit.length === 2 && hit.every(([, ok]) => ok === false), hit)
  }
}
if (!MIGRATIONS.length) {
  for (const [what, target, sql] of BREAKS) {
    const res = await runSuite(sql)
    const hit = res.find(([n]) => n === target)
    check(`red: ${what} → "${target}" fails`, hit && hit[1] === false, hit)
  }
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
