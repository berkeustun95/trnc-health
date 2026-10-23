// 20261132_eatery_orders_is_test.sql against the PGlite harness (PostgreSQL 18; prod is older — see supabase/CLAUDE.md).
// Fixture: the SAME fixture text as scripts/test-eatery-orders-sql.mjs (sliced out of that file, not retyped), then the REAL
// 20261125 file, then 20261132. The 1132 file's own probes do the role work; this script adds
//   (a) "identical except": pg_get_functiondef of create/verify after 1125 vs after 1132, line-diffed, only the listed lines differ;
//   (b) a red-first mutant for each in-file probe (anchor asserted, the apply must FAIL with the expected message);
//   (c) the verify_schema.sql 1132 + 1125 H tokens: never error before 1132, all true after it.
// Not wired into package.json / pre-push / CI, like its siblings: run by hand.
//
//   node scripts/test-eatery-orders-is-test-sql.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile } from './migration-harness.mjs'

const M = (n) => fileURLToPath(new URL(`../supabase/migrations/${n}`, import.meta.url))
const F1125 = M('20261125_eatery_orders.sql'), F1132 = M('20261132_eatery_orders_is_test.sql')
const SQL = readFileSync(F1132, 'utf8')
const PRIOR = readFileSync(M('20261115_eatery_partners.sql'), 'utf8')
const a = PRIOR.indexOf('CREATE TABLE IF NOT EXISTS public.eatery_partners')
const b = PRIOR.indexOf('-- ─── Storage bucket')
if (a < 0 || b < a) throw new Error('fixture anchors missing in 20261115')
const SIB = readFileSync(fileURLToPath(new URL('./test-eatery-orders-sql.mjs', import.meta.url)), 'utf8')
const fa = SIB.indexOf('const FIXTURE = `'), fb = SIB.indexOf('`\n\nlet bad', fa)
if (fa < 0 || fb < fa) throw new Error('FIXTURE anchors missing in test-eatery-orders-sql.mjs')
const FIXTURE = new Function('PRIOR', 'a', 'b', 'return ' + SIB.slice(fa + 'const FIXTURE = '.length, fb + 1))(PRIOR, a, b)

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
const dir = mkdtempSync(join(tmpdir(), 'ist-'))
// A database in the post-20261125 state (the real file applied, its own probes green).
const after1125 = async () => {
  const d = await freshDb(FIXTURE)
  const r = await applyFile(d, F1125)
  if (!r.ok) throw new Error('20261125 did not apply: ' + r.msg)
  return d
}
const q = async (d, sql) => (await d.query(sql)).rows
const SEED_ROW = `INSERT INTO public.eatery_partners (id, slug, name, category) VALUES ('11111111-1111-4111-8111-111111111111','fx','fx','cafe');
  INSERT INTO public.eatery_orders (code, partner_id, lines, total, currency, created_by, created_at, expires_at) VALUES
   ('AAAAAAA2','11111111-1111-4111-8111-111111111111','[1]',1,'TRY',gen_random_uuid(), now()-interval '3 days', now()-interval '3 days' + interval '2 hours')`

// mutant: list of [from, to, all?]; every anchor is asserted present (once, unless all).
const mutant = (name, pairs) => {
  let text = SQL
  for (const [from, to, all] of pairs) {
    const n = text.split(from).length - 1
    if (n < 1 || (!all && n !== 1)) { bad++; console.log(`  ✗ ${name}: anchor ${JSON.stringify(from.slice(0, 60))} found ${n}x`); return null }
    text = all ? text.split(from).join(to) : text.replace(from, () => to)
  }
  const p = join(dir, name.replace(/\W+/g, '_') + '.sql'); writeFileSync(p, text); return p
}
const table = []
const FP = `WHERE t.uid_sha256 = encode(pg_catalog.sha256(pg_catalog.convert_to(p_uid::text, 'UTF8')), 'hex')`
const NEUT_BODY = ["RAISE EXCEPTION 'is_order_tester body is not the fingerprint lookup", "RAISE NOTICE 'is_order_tester body is not the fingerprint lookup"]
const NEUT_CHECK = ["RAISE EXCEPTION 'order_testers_uid_sha256_check is [%]", "RAISE NOTICE 'order_testers_uid_sha256_check is [%]"]
const CHK = `,\n  CONSTRAINT order_testers_uid_sha256_check CHECK (uid_sha256 ~ '^[0-9a-f]{64}$')`
const BODYMSG = 'is_order_tester body is not the fingerprint lookup'
const refused = async (name, p, wantMsg, { seed = SEED_ROW } = {}) => {
  if (!p) { table.push([name, 'ANCHOR MISSING', '']); return }
  const d = await after1125()
  if (seed) await d.exec(seed)
  const r = await applyFile(d, p)
  const hit = !r.ok && (r.msg || '').includes(wantMsg)
  t(`${name}: apply FAILS with "${wantMsg}"`, [r.ok, hit], [false, true])
  console.log(`      ${r.ok ? '(applied!)' : r.msg}`)
  table.push([name, r.ok ? 'GREEN (BAD)' : hit ? 'RED (as expected)' : 'RED, wrong message', r.ok ? '' : r.msg.slice(0, 110)])
}

console.log('20261132_eatery_orders_is_test — real files on the 20261115-state fixture, 1125 applied first')

// ── green: the unmutated file ──
const db = await after1125()
const defs = async () => ({
  create: (await q(db, `SELECT pg_get_functiondef('public.create_eatery_order(uuid,jsonb,text)'::regprocedure) d`))[0].d,
  verify: (await q(db, `SELECT pg_get_functiondef('public.verify_eatery_order(text)'::regprocedure) d`))[0].d })
const meta = async () => q(db, `SELECT p.proname, pg_get_userbyid(p.proowner) o, p.prosecdef sd, p.proconfig cfg, p.pronargs na, pg_get_function_arguments(p.oid) args,
    (SELECT string_agg(CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END, ',' ORDER BY 1) FROM aclexplode(p.proacl) x LEFT JOIN pg_roles r ON r.oid = x.grantee WHERE x.privilege_type = 'EXECUTE') grants
  FROM pg_proc p WHERE p.proname IN ('create_eatery_order','verify_eatery_order') AND p.pronamespace = 'public'::regnamespace ORDER BY 1`)
const d1 = await defs(), m1 = await meta()
await db.exec(SEED_ROW)
const preCount = (await q(db, `SELECT count(*)::int n FROM public.eatery_orders`))[0].n
const first = await applyFile(db, F1132)
t('1132 applies cleanly on the 1125 state (in-file probes green)', first, { ok: true, msg: null })
if (!first.ok) process.exit(1)
t('1132 applies a SECOND time (re-runnable, ledger row present)', await applyFile(db, F1132), { ok: true, msg: null })
t('ledger row written', (await q(db, `SELECT filename FROM public.schema_migrations_applied ORDER BY 1`)).map(r => r.filename), ['20261125_eatery_orders.sql', '20261132_eatery_orders_is_test.sql'])
t('pre-existing order kept, is_test = false', (await q(db, `SELECT code, is_test FROM public.eatery_orders`)), [{ code: 'AAAAAAA2', is_test: false }])
t('row count unchanged', (await q(db, `SELECT count(*)::int n FROM public.eatery_orders`))[0].n, preCount)
t('cron: one job, hourly :40', await q(db, `SELECT jobname, schedule FROM cron.job`), [{ jobname: 'eatery-orders-retention', schedule: '40 * * * *' }])
t('order_testers empty after apply', (await q(db, `SELECT count(*)::int n FROM public.order_testers`))[0].n, 0)
t('no probe row survived', (await q(db, `SELECT (SELECT count(*) FROM public.eatery_orders)::int o, (SELECT count(*) FROM public.eatery_partners WHERE slug LIKE 'zz-%')::int p, (SELECT count(*) FROM private.preview_key_hashes)::int k`)), [{ o: 1, p: 0, k: 0 }])

// ── (a) byte-for-byte: only the listed lines differ ──
const d2 = await defs(), m2 = await meta()
const lineDiff = (x, y) => {
  const A = x.split('\n'), B = y.split('\n')
  const L = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0))
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const removed = [], added = []
  let i = 0, j = 0
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { i++; j++ } else if (L[i + 1][j] >= L[i][j + 1]) removed.push(A[i++]); else added.push(B[j++])
  }
  while (i < A.length) removed.push(A[i++])
  while (j < B.length) added.push(B[j++])
  // blank lines are diff-ambiguous (an added blank can pair with any existing one): compare non-blank lines only
  return { removed: removed.filter(l => l.trim()), added: added.filter(l => l.trim()) }
}
const cd = lineDiff(d1.create, d2.create)
t('create_eatery_order: removed lines are exactly the 3 changed statements', cd.removed, [
  `  SELECT count(*) INTO v_part_n FROM public.eatery_orders WHERE partner_id = p_partner AND created_as_guest AND created_at > now() - interval '1 hour';`,
  `      INSERT INTO public.eatery_orders (code, partner_id, lines, total, currency, created_by, client_id, created_as_guest)`,
  `      VALUES (v_code, p_partner, v_lines, v_total, v_cur, v_uid, p_client_id, v_guest)`])
t('create_eatery_order: added lines are exactly the declaration, the derivation (+2 comment lines; a blank line is diff-ambiguous) and the 3 replacements', cd.added, [
  `  v_test    boolean;`,
  `  -- 20261132: a TEST order is decided by the server, never by a parameter: the ADA Preview app (its key header) or a`,
  `  -- listed order tester. Test orders are deleted after 24 h and never count toward the partner cap.`,
  `  v_test := public.is_previewer() OR public.is_order_tester(v_uid);`,
  `  SELECT count(*) INTO v_part_n FROM public.eatery_orders WHERE partner_id = p_partner AND created_as_guest AND NOT is_test AND created_at > now() - interval '1 hour';`,
  `      INSERT INTO public.eatery_orders (code, partner_id, lines, total, currency, created_by, client_id, created_as_guest, is_test)`,
  `      VALUES (v_code, p_partner, v_lines, v_total, v_cur, v_uid, p_client_id, v_guest, v_test)`])
const vd = lineDiff(d1.verify, d2.verify)
t('verify_eatery_order: only the return object gained the is_test key', vd, {
  removed: [`    'view_count_before',      v_o.view_count);`],
  added: [`    'view_count_before',      v_o.view_count,`, `    'is_test',                v_o.is_test);`] })
t('create/verify: owner, DEFINER, search_path, argument list, ACL identical before and after', m2, m1)
t('create: exactly 3 argument names, none *test*', (await q(db, `SELECT proargnames FROM pg_proc WHERE oid = 'public.create_eatery_order(uuid,jsonb,text)'::regprocedure`))[0].proargnames, ['p_partner', 'p_items', 'p_client_id'])
console.log('  per-user count (must still count ALL orders):', d2.create.split('\n').find(l => l.includes('v_user_n FROM')).trim())

// ── (c) verify_schema.sql tokens ──
const VS = readFileSync(fileURLToPath(new URL('../supabase/verify_schema.sql', import.meta.url)), 'utf8')
const i32 = VS.indexOf('    -- ── 1132: server-marked TEST orders'), i25 = VS.indexOf('    -- ── 1125: WhatsApp order proof.'), i19 = VS.indexOf("    UNION ALL SELECT '1119_eatery_preview_read','eatery_partners: exactly 2")
if (i32 < 0 || i25 < i32 || i19 < i25) throw new Error('verify_schema 1132 / 1125 token anchors missing')
const tokq = (s) => `SELECT migration, object, ok FROM (SELECT ''::text migration, ''::text object, false ok WHERE false\n${s}) z`
const T32 = tokq(VS.slice(i32, i25)), T25 = tokq(VS.slice(i25, i19))
const tokens = async (d, label, sql, want) => {
  try {
    const rows = (await d.query(sql)).rows
    t(`verify_schema ${label}: ${rows.length} tokens, all ${want}`, [rows.length > 0, rows.every(r => r.ok === want)], [true, true])
    if (rows.some(r => r.ok !== want)) console.log(rows.filter(r => r.ok !== want).map(r => '      ' + r.object.slice(0, 100)).join('\n'))
  } catch (e) { t(`verify_schema ${label} does not error`, String(e.message).split('\n')[0], 'no error') }
}
const pre = await after1125()
await tokens(pre, '1125 tokens BEFORE 1132 (1125 alone)', T25, true)
await tokens(pre, '1132 tokens BEFORE 1132 (must not error; red is fine)', T32, false)
await tokens(db, '1125 tokens AFTER 1132', T25, true)
await tokens(db, '1132 tokens AFTER 1132', T32, true)

// ── pre-state ──
{
  const d = await freshDb(FIXTURE)
  const r = await applyFile(d, F1132)
  t('pre-state: refuses without 20261125 in the ledger', [r.ok, (r.msg || '').includes('20261125_eatery_orders.sql is not in the ledger')], [false, true])
  table.push(['1125 not applied', r.ok ? 'GREEN (BAD)' : 'RED (as expected)', (r.msg || '').slice(0, 110)])
}

console.log('\nMUTANTS (each must be refused by the guarding probe/assertion; seed: one 3-day-old real order)')
const DER = `v_test := public.is_previewer() OR public.is_order_tester(v_uid);`
const CAP = `created_as_guest AND NOT is_test AND created_at > now()`
const PUC = `WHERE created_by = v_uid AND created_at > now() - interval '1 hour'`
// structural-red: only the function body is mutated, the in-file assertion that reads the body fires
await refused('derivation OR -> AND (body only)', mutant('der_struct', [[`\n  ${DER}\n`, `\n  v_test := public.is_previewer() AND public.is_order_tester(v_uid);\n`]]), 'create_eatery_order body is not as designed')
await refused('partner cap loses AND NOT is_test (body only)', mutant('cap_struct', [[`created_as_guest AND NOT is_test AND created_at > now() - interval '1 hour';\n  IF v_guest`, `created_as_guest AND created_at > now() - interval '1 hour';\n  IF v_guest`]]), 'create_eatery_order body is not as designed')
await refused('per-user count starts excluding tests (body only)', mutant('usr_struct', [[`WHERE created_by = v_uid AND created_at > now() - interval '1 hour';\n  IF v_user_n`, `WHERE created_by = v_uid AND NOT is_test AND created_at > now() - interval '1 hour';\n  IF v_user_n`]]), 'create_eatery_order body is not as designed')
await refused('INSERT stores false instead of v_test (body only)', mutant('ins_struct', [[`p_client_id, v_guest, v_test)\n`, `p_client_id, v_guest, false)\n`]]), 'create_eatery_order body is not as designed')
await refused('verify drops the is_test key', mutant('ver', [[`'is_test',                v_o.is_test);`, `'is_test',                false);`]]), 'verify_eatery_order body')
await refused("retention '24 hours' -> '240 hours' (command only)", mutant('c240_struct', [[`(is_test AND created_at < now() - interval '24 hours')$$`, `(is_test AND created_at < now() - interval '240 hours')$$`]]), 'cron job eatery-orders-retention')
await refused('retention schedule back to 03:40 daily', mutant('cron_daily', [[`SELECT cron.schedule('eatery-orders-retention', '40 * * * *',`, `SELECT cron.schedule('eatery-orders-retention', '40 3 * * *',`]]), 'cron job eatery-orders-retention')
await refused('is_test DEFAULT true', mutant('def_true', [['ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false', 'ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT true']]), 'is_test is not boolean NOT NULL DEFAULT false')
await refused('existing rows flipped to is_test = true', mutant('flip', [['COMMENT ON COLUMN public.eatery_orders.is_test IS', 'UPDATE public.eatery_orders SET is_test = true;\nCOMMENT ON COLUMN public.eatery_orders.is_test IS']]), 'pre-existing order(s)')
await refused('an existing order deleted by the migration', mutant('del', [['COMMENT ON COLUMN public.eatery_orders.is_test IS', 'DELETE FROM public.eatery_orders;\nCOMMENT ON COLUMN public.eatery_orders.is_test IS']]), 'rows changed during the ALTER')
await refused('order_testers has a policy', mutant('pol', [['REVOKE ALL ON TABLE public.order_testers FROM PUBLIC, anon, authenticated;', `CREATE POLICY zz_open ON public.order_testers FOR SELECT TO authenticated USING (true);\nREVOKE ALL ON TABLE public.order_testers FROM PUBLIC, anon, authenticated;`]]), 'order_testers has 1 policies')
await refused('order_testers left to authenticated (REVOKE without authenticated)', mutant('tbl', [['REVOKE ALL ON TABLE public.order_testers FROM PUBLIC, anon, authenticated;', 'REVOKE ALL ON TABLE public.order_testers FROM PUBLIC, anon;']]), 'authenticated holds')
await refused('order_testers RLS not enabled', mutant('rls', [['ALTER TABLE public.order_testers ENABLE ROW LEVEL SECURITY;', '']]), 'RLS is not enabled on order_testers')
await refused('order_testers given an FK to auth.users', mutant('fk', [['  note       text,\n', '  note       text,\n  zz_uid uuid REFERENCES auth.users (id),\n']]), 'foreign key')
await refused('is_order_tester EXECUTE granted to authenticated', mutant('gr', [['REVOKE EXECUTE ON FUNCTION public.is_order_tester(uuid) FROM PUBLIC, anon, authenticated;', 'REVOKE EXECUTE ON FUNCTION public.is_order_tester(uuid) FROM PUBLIC, anon;']]), 'is_order_tester: EXECUTE grantees')
await refused('is_order_tester search_path unpinned', mutant('sp', [[`  SET search_path = ''\nAS $fn$`, `AS $fn$`]]), 'is_order_tester: definer=')
await refused('create EXECUTE granted to anon', mutant('ganon', [['GRANT  EXECUTE ON FUNCTION public.create_eatery_order(uuid, jsonb, text) TO authenticated;', 'GRANT  EXECUTE ON FUNCTION public.create_eatery_order(uuid, jsonb, text) TO anon, authenticated;']]), 'create_eatery_order: EXECUTE grantees')

// behaviour-red: the structural assertion is mutated too (same edit), so only the in-file BEHAVIOUR probes can notice
await refused('derivation OR -> AND (body + its assertion): behaviour probe', mutant('der_beh', [[DER, `v_test := public.is_previewer() AND public.is_order_tester(v_uid);`, true]]), 'is_test for "Preview key header"')
await refused('derivation ignores the previewer (body + assertion): behaviour probe', mutant('der_prev', [[DER, `v_test := public.is_order_tester(v_uid);`, true]]), 'is_test for "Preview key header"')
await refused('derivation ignores testers (body + assertion): behaviour probe', mutant('der_tst', [[DER, `v_test := public.is_previewer();`, true]]), 'is_test for "listed tester"')
await refused('partner cap counts test orders again (body + assertion): behaviour probe', mutant('cap_beh', [[CAP, `created_as_guest AND created_at > now()`, true]]), 'fresh guest NOT blocked by 60 guest TEST orders')
await refused('INSERT stores false (body + assertion): behaviour probe', mutant('ins_beh', [[`p_client_id, v_guest, v_test)`, `p_client_id, v_guest, false)`, true]]), 'is_test for "Preview key header"')
await refused('per-user count excludes tests (body + assertion): behaviour probe', mutant('usr_beh', [[`created_by = v_uid AND created_at > now() - interval ''1 hour'';`, `created_by = v_uid AND NOT is_test AND created_at > now() - interval ''1 hour'';`, true], [PUC + `;\n  IF v_user_n`, PUC.replace('created_by = v_uid', 'created_by = v_uid AND NOT is_test') + `;\n  IF v_user_n`], [`OR v_def LIKE '%created_by = v_uid AND NOT is_test%'`, 'OR false']]), '5 TEST orders by one user block the 6th')
await refused('is_order_tester drops the anonymous-session check: behaviour probe', mutant('anon', [['    AND NOT public.is_anonymous_session()\n', ''], NEUT_BODY]), 'is_test for "listed uid, anonymous session"')
await refused("retention '24 hours' -> '240 hours' (command + assertion): behaviour probe", mutant('c240_beh', [["interval '24 hours')$$", "interval '240 hours')$$"], ["interval ''24 hours'')'", "interval ''240 hours'')'"]]), 'retention command left')
await refused('retention drops the real-order 30-day branch (command + assertion): behaviour probe', mutant('c30', [["created_at < now() - interval '30 days' OR (is_test", "created_at < now() - interval '3000 days' OR (is_test"], ["created_at < now() - interval ''30 days'' OR (is_test", "created_at < now() - interval ''3000 days'' OR (is_test"]]), 'retention command left')
await refused('is_order_tester answers true for everyone listed or not: behaviour probe', mutant('allt', [[FP, 'WHERE true'], NEUT_BODY]), 'is_test for "no key"')

// ── fingerprint store (order_testers holds sha256(uuid text), never the user id) ──
await refused('lookup compares the RAW uuid text (body only)', mutant('raw_s', [[FP, `WHERE t.uid_sha256 = p_uid::text`]]), BODYMSG)
await refused('lookup compares the RAW uuid text (body + assertion): behaviour probe', mutant('raw_b', [[FP, `WHERE t.uid_sha256 = p_uid::text`], NEUT_BODY]), 'is_test for "listed tester"')
await refused('lookup hashes md5 instead of sha256 (body only)', mutant('md5_s', [[FP, `WHERE t.uid_sha256 = pg_catalog.md5(p_uid::text)`]]), BODYMSG)
await refused('lookup hashes md5 instead of sha256 (body + assertion): behaviour probe', mutant('md5_b', [[FP, `WHERE t.uid_sha256 = pg_catalog.md5(p_uid::text)`], NEUT_BODY]), 'is_test for "listed tester"')
await refused('lookup hashes an UPPERCASED uuid text (body only)', mutant('up_s', [[FP, `WHERE t.uid_sha256 = encode(pg_catalog.sha256(pg_catalog.convert_to(upper(p_uid::text), 'UTF8')), 'hex')`]]), BODYMSG)
await refused('lookup hashes an UPPERCASED uuid text (body + assertion): behaviour probe', mutant('up_b', [[FP, `WHERE t.uid_sha256 = encode(pg_catalog.sha256(pg_catalog.convert_to(upper(p_uid::text), 'UTF8')), 'hex')`], NEUT_BODY]), 'is_test for "listed tester whose uuid has hex letters"')
await refused('lookup ignores p_uid, matches any listed row (body only)', mutant('any_s', [[FP, `WHERE true`]]), BODYMSG)
await refused('CHECK on uid_sha256 dropped (DDL only)', mutant('chk_s', [[CHK, '']]), 'order_testers_uid_sha256_check is [')
await refused('CHECK on uid_sha256 dropped (DDL + assertion): in-file insert probe', mutant('chk_b', [[CHK, ''], NEUT_CHECK]), 'order_testers accepted or mis-refused a non-fingerprint value')
await refused('CHECK weakened to ^[0-9a-f]+$ (DDL only)', mutant('chk_w_s', [['CHECK (uid_sha256 ~ \'^[0-9a-f]{64}$\')', 'CHECK (uid_sha256 ~ \'^[0-9a-f]+$\')']]), 'order_testers_uid_sha256_check is [')
await refused('CHECK weakened to ^[0-9a-f]+$ (DDL + assertion): in-file insert probe', mutant('chk_w_b', [['CHECK (uid_sha256 ~ \'^[0-9a-f]{64}$\')', 'CHECK (uid_sha256 ~ \'^[0-9a-f]+$\')'], NEUT_CHECK]), 'order_testers accepted or mis-refused a non-fingerprint value')
await refused('CHECK weakened to case-insensitive ~* (DDL + assertion): in-file insert probe', mutant('chk_i_b', [['CHECK (uid_sha256 ~ \'^[0-9a-f]{64}$\')', 'CHECK (uid_sha256 ~* \'^[0-9a-f]{64}$\')'], ["v_s NOT LIKE '%^[0-9a-f]{64}$%' THEN", "false THEN"]]), 'order_testers accepted or mis-refused a non-fingerprint value')
await refused('a user_id column re-added to order_testers', mutant('uid_col', [['  note       text,\n', '  note       text,\n  user_id    uuid,\n']]), 'order_testers columns are [')
await refused('order_testers keyed on a different column (pkey moved to note, which turns NOT NULL)', mutant('pk', [['CONSTRAINT order_testers_pkey PRIMARY KEY (uid_sha256)', 'CONSTRAINT order_testers_pkey PRIMARY KEY (note)']]), 'order_testers columns are [')

console.log('\nRED / GREEN TABLE')
const w = Math.max(...table.map(r => r[0].length))
for (const [n, s, m] of table) console.log(`  ${n.padEnd(w)}  ${s.padEnd(20)} ${m}`)
console.log(bad ? `\n${bad} FAILED` : '\nALL GREEN')
process.exit(bad ? 1 : 0)
