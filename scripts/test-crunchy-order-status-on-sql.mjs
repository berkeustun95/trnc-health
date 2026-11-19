// 20261220_crunchy_order_status_on.sql against the PGlite harness (PG 18; prod is older). Minimal fixture: eatery_partners (the columns the
// file reads) + private.eatery_partner_pins. Cases: refusals (no PIN, wrong slug, inactive, not whatsapp) apply nothing; off → on; a re-run
// skips; other partners untouched; RED-FIRST mutant (UPDATE without WHERE) must be refused by the post-check. Run by hand:
//   node scripts/test-crunchy-order-status-on-sql.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile as apply0 } from './migration-harness.mjs'

// a refused file leaves its transaction aborted, as in prod: roll it back so the state can be read
const applyFile = async (d, f) => { const r = await apply0(d, f); if (!r.ok) await d.exec('ROLLBACK; RESET ROLE;').catch(() => {}); return r }

const F = fileURLToPath(new URL('../supabase/migrations/20261220_crunchy_order_status_on.sql', import.meta.url))
const C = 'bb9dad05-6bb0-4c1c-90fb-cb0a4ad68434', O1 = '11111111-1111-1111-1111-111111111111', O2 = '22222222-2222-2222-2222-222222222222'
const SEED = `
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE public.eatery_partners (id uuid PRIMARY KEY, slug text UNIQUE NOT NULL, is_active boolean NOT NULL DEFAULT false,
  order_method text, order_status_enabled boolean NOT NULL DEFAULT false);
CREATE TABLE private.eatery_partner_pins (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, scope text NOT NULL, partner_id uuid UNIQUE,
  salt text NOT NULL DEFAULT 's', pin_sha256 text NOT NULL DEFAULT 'h', set_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public.eatery_partners VALUES ('${C}', 'crunchy-express', true, 'whatsapp', false),
  ('${O1}', 'other-on', true, 'whatsapp', true), ('${O2}', 'other-off', true, 'phone', false);
INSERT INTO private.eatery_partner_pins (scope, partner_id) VALUES ('test', NULL), ('partner', '${O1}');`
const VS = readFileSync(fileURLToPath(new URL('../supabase/verify_schema.sql', import.meta.url)), 'utf8')
const vs0 = VS.indexOf("SELECT '20261220_crunchy_order_status_on'"), vs1 = VS.indexOf("'crunchy-express'), false)", vs0)
if (vs0 < 0 || vs1 < vs0) throw new Error('verify_schema 20261220 row missing')
const ne = VS.indexOf('NOT EXISTS(', vs0)
if (ne < 0 || ne > vs1) throw new Error('verify_schema 20261220 row: NOT EXISTS anchor missing')
const VROW = 'SELECT ' + VS.slice(ne, vs1 + "'crunchy-express'), false)".length) + ' AS ok'

let bad = 0
const t = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) bad++
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`}`) }
const state = async (d) => (await d.query('SELECT slug, order_status_enabled AS on FROM public.eatery_partners ORDER BY slug')).rows.map(r => `${r.slug}:${r.on}`)
const ledger = async (d) => (await d.query(`SELECT count(*)::int AS n FROM public.schema_migrations_applied WHERE filename = '20261220_crunchy_order_status_on.sql'`)).rows[0].n
const vrow = async (d) => (await d.query(VROW)).rows[0].ok
const BEFORE = ['crunchy-express:false', 'other-off:false', 'other-on:true']
const AFTER = ['crunchy-express:true', 'other-off:false', 'other-on:true']

for (const [name, sql, msg] of [
  ['no partner PIN', '', 'partner PIN rows: 0, want 1'],
  ['wrong slug', `UPDATE public.eatery_partners SET slug = 'crunchy-x' WHERE id = '${C}';`, 'not crunchy-express'],
  ['inactive', `UPDATE public.eatery_partners SET is_active = false WHERE id = '${C}';`, 'is_active is [f]'],
  ['not whatsapp', `UPDATE public.eatery_partners SET order_method = 'phone' WHERE id = '${C}';`, 'order_method is [phone]'],
]) {
  const d = await freshDb(SEED); await d.exec(sql)
  const r = await applyFile(d, F)
  t(`REFUSES (${name}), nothing applied, no ledger row`, [r.ok, (r.msg || '').includes(msg), await ledger(d)], [false, true, 0])
}

const d = await freshDb(SEED)
await d.exec(`INSERT INTO private.eatery_partner_pins (scope, partner_id) VALUES ('partner', '${C}')`)
t('fixture before', await state(d), BEFORE)
t('verify_schema row vacuously true before apply', await vrow(d), true)
t('applies (pin set, off)', await applyFile(d, F), { ok: true, msg: null })
t('after: crunchy on, others untouched, ledger row', [await state(d), await ledger(d)], [AFTER, 1])
t('verify_schema row OK after apply', await vrow(d), true)
t('re-run applies (UPDATE skipped), same state', [await applyFile(d, F), await state(d)], [{ ok: true, msg: null }, AFTER])
await d.exec(`UPDATE public.eatery_partners SET order_status_enabled = false WHERE id = '${C}'`)
t('verify_schema row goes red when switched off later', await vrow(d), false)

const S = readFileSync(F, 'utf8'), A = "UPDATE public.eatery_partners SET order_status_enabled = true WHERE id = c_id;"
if (!S.includes(A)) throw new Error('mutant anchor missing')
const dir = mkdtempSync(join(tmpdir(), 'm1220-')), MF = join(dir, 'm.sql')
writeFileSync(MF, S.replace(A, 'UPDATE public.eatery_partners SET order_status_enabled = true;'))
const m = await freshDb(SEED); await m.exec(`INSERT INTO private.eatery_partner_pins (scope, partner_id) VALUES ('partner', '${C}')`)
const rm = await applyFile(m, MF)
t('RED-FIRST: UPDATE without WHERE is refused by the post-check, nothing applied', [rm.ok, (rm.msg || '').includes("another partner's order_status_enabled changed"), await state(m), await ledger(m)], [false, true, BEFORE, 0])

console.log(bad ? `\n✗ ${bad} failed` : '\n✓ all passed'); process.exit(bad ? 1 : 0)
