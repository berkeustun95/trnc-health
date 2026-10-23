// 20261133 (Berke's two order_testers rows) against the PGlite harness. The real file locates accounts by the
// SHA-256 of their e-mail, so a public test cannot use the real constants: each case swaps them for fixture
// accounts (a@test.invalid / b@test.invalid) and runs the REAL file body. The real constants are checked for
// shape only. Each refusal is red-first: same file, only the DB state differs, and the baseline passes.
//
//   node scripts/test-order-testers-sql.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile } from './migration-harness.mjs'

const REAL = fileURLToPath(new URL('../supabase/migrations/20261133_order_testers_berke.sql', import.meta.url))
const SRC = readFileSync(REAL, 'utf8')
const h = s => createHash('sha256').update(s, 'utf8').digest('hex')
const A = { id: '1aa4b1a5-4176-498d-8921-cbccb193959d', email: 'a@test.invalid' }
const B = { id: 'd2f37c06-04b9-4528-b25c-caf3124a88dd', email: 'b@test.invalid' }
let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
const consts = [...SRC.matchAll(/c_(email_a|email_b|uid_a)\s+constant text := '([^']*)'/g)].map(m => [m[1], m[2]])
t('real constants: three, each 64 lowercase hex', consts.map(([k, v]) => [k, /^[0-9a-f]{64}$/.test(v)]), [['email_a', true], ['email_b', true], ['uid_a', true]])
t('no e-mail address or uuid literal in the real file', [/@[a-z0-9.-]+\.[a-z]{2,}/i.test(SRC), /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(SRC)], [false, false])

const dir = mkdtempSync(join(tmpdir(), 'ot-'))
const variant = (uidA = h(A.id)) => {
  const s = SRC.replace(/(c_email_a\s+constant text := ')[^']*'/, `$1${h(A.email)}'`)
               .replace(/(c_email_b\s+constant text := ')[^']*'/, `$1${h(B.email)}'`)
               .replace(/(c_uid_a\s+constant text := ')[^']*'/, `$1${uidA}'`)
  const p = join(dir, `v${Math.random().toString(36).slice(2)}.sql`); writeFileSync(p, s); return p
}
const FIX = `
ALTER TABLE auth.users ADD COLUMN email text, ADD COLUMN is_anonymous boolean NOT NULL DEFAULT false;
CREATE TABLE public.order_testers (uid_sha256 text NOT NULL, added_at timestamptz NOT NULL DEFAULT now(), note text,
  CONSTRAINT order_testers_pkey PRIMARY KEY (uid_sha256), CONSTRAINT order_testers_uid_sha256_check CHECK (uid_sha256 ~ '^[0-9a-f]{64}$'));
INSERT INTO public.order_testers (uid_sha256, note) VALUES ('${h('99999999-9999-4999-8999-999999999999')}', 'someone else');`
const users = (o = {}) => `INSERT INTO auth.users (id, email) VALUES ('${A.id}', '${o.emailA ?? A.email}'), ('${B.id}', '${B.email}')${o.dupB ? `, ('33333333-3333-4333-8333-333333333333', '${B.email.toUpperCase()}')` : ''};`
const L1132 = `INSERT INTO public.schema_migrations_applied (filename, checksum) VALUES ('20261132_eatery_orders_is_test.sql', 'x');`
const db = async (seed) => { const d = await freshDb(FIX); await d.exec(seed); return d }
const q = async (d, sql) => (await d.query(sql)).rows

console.log('20261133 order_testers rows')
{
  const d = await db(L1132 + users())
  t('baseline applies', await applyFile(d, variant()), { ok: true, msg: null })
  t('both fingerprints present (as is_order_tester computes them), other row kept', await q(d, `SELECT uid_sha256 = '${h(A.id)}' a, uid_sha256 = '${h(B.id)}' b, note FROM public.order_testers ORDER BY note`),
    [{ a: true, b: false, note: 'Berke live checks (A)' }, { a: false, b: true, note: 'Berke live checks (B)' }, { a: false, b: false, note: 'someone else' }])
  t('re-run is a no-op pass (ON CONFLICT)', await applyFile(d, variant()), { ok: true, msg: null })
  t('still 3 rows', (await q(d, `SELECT count(*)::int n FROM public.order_testers`))[0].n, 3)
}
for (const [name, seed, uidA, msg] of [
  ['1132 not applied', users(), undefined, 'is not applied'],
  ['account A missing', L1132 + users({ emailA: 'other@test.invalid' }), undefined, 'exactly 1 account'],
  ['email B matches 2 accounts', L1132 + users({ dupB: true }), undefined, 'exactly 1 account'],
  ['given fingerprint for A wrong (typo)', L1132 + users(), h(A.id).replace(/.$/, c => c === '0' ? '1' : '0'), 'does not equal'],
]) {
  const d = await db(seed)
  const r = await applyFile(d, variant(uidA))
  t(`${name}: refused`, [r.ok, (r.msg || '').includes(msg)], [false, true]); console.log(`      ${r.msg}`)
  await d.exec('ROLLBACK').catch(() => {}); await d.exec('RESET ROLE').catch(() => {})
  t(`${name}: nothing inserted`, (await q(d, `SELECT count(*)::int n FROM public.order_testers`))[0].n, 1)
}
console.log(bad ? `\n${bad} FAILED` : '\nall passed'); process.exit(bad ? 1 : 0)
