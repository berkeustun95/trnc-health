// 20261143_partner_booking_requests.sql against the PGlite harness (PostgreSQL 18; prod is an older major,
// see supabase/CLAUDE.md). Only dependency outside the file: public.is_admin(), stubbed to read the JWT
// claim `app_admin` (so an admin session is a real positive control for the SELECT policy).
//
//   node scripts/test-partner-booking-requests-sql.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile } from './migration-harness.mjs'

const FILE = fileURLToPath(new URL('../supabase/migrations/20261143_partner_booking_requests.sql', import.meta.url))
const SQL = readFileSync(FILE, 'utf8')
const FIXTURE = `CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'app_admin')::boolean, false) $$;`

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
const dir = mkdtempSync(join(tmpdir(), 'pbr-'))
const mutant = (name, from, to) => {
  if (!SQL.includes(from)) { bad++; console.log(`  ✗ ${name}: anchor missing`); return null }
  const p = join(dir, name.replace(/\W+/g, '_') + '.sql'); writeFileSync(p, SQL.replace(from, to)); return p
}
const refused = async (name, p, extra, wantMsg) => {
  if (!p) return
  const d = await freshDb(FIXTURE); if (extra) await d.exec(extra)
  const r = await applyFile(d, p)
  t(`${name} refused`, r.ok, false)
  t(`  message mentions "${wantMsg}"`, (r.msg || '').includes(wantMsg), true)
  console.log(`      ${r.msg}`)
}
const as = async (db, role, claims, sql) => {
  await db.exec('RESET ROLE;')
  await db.query("SELECT set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims)])
  await db.exec(`SET ROLE ${role};`)
  try { return { ok: true, rows: (await db.query(sql)).rows } }
  catch (e) { return { ok: false, msg: String(e.message || e).split('\n')[0] } }
  finally { await db.exec('RESET ROLE;') }
}

console.log('20261143_partner_booking_requests — real file on a fresh Supabase-shaped DB')
const db = await freshDb(FIXTURE)
const q = async (sql) => (await db.query(sql)).rows
t('applies cleanly (in-file assertions + probes green)', await applyFile(db, FILE), { ok: true, msg: null })
t('applies a SECOND time (re-runnable)', await applyFile(db, FILE), { ok: true, msg: null })
t('probe rows cleaned up', (await q(`SELECT count(*)::int n FROM public.partner_booking_requests`))[0].n, 0)
t('ledger row written', (await q(`SELECT filename FROM public.schema_migrations_applied`)).map(r => r.filename), ['20261143_partner_booking_requests.sql'])
console.log('  renderings (PG 18):')
for (const r of await q(`SELECT conname, pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid='public.partner_booking_requests'::regclass AND contype IN ('p','c') ORDER BY 1`)) console.log(`    ${r.conname}: ${r.d}`)
for (const r of await q(`SELECT policyname, cmd, permissive, roles::text, qual, with_check FROM pg_policies WHERE tablename='partner_booking_requests' ORDER BY 1`)) console.log(`    policy ${r.policyname}: ${r.cmd} ${r.permissive} ${r.roles} qual=${r.qual} check=${r.with_check}`)

const guest = { sub: 'c0000000-0000-4000-8000-000000000001', role: 'authenticated', is_anonymous: true }
const admin = { sub: 'a0000000-0000-4000-8000-000000000001', role: 'authenticated', app_admin: true }
const ins = `INSERT INTO public.partner_booking_requests (partner, apartment, check_in, check_out, guests) VALUES ('north_houses','yasemin-2plus1-plus', current_date+10, current_date+12, 4)`
t('guest insert (no RETURNING) ok', (await as(db, 'authenticated', guest, ins)).ok, true)
t('guest insert WITH RETURNING fails (SELECT policy) — client must not use .select()', (await as(db, 'authenticated', guest, ins + ' RETURNING id')).ok, false)
t('guest sees 0 rows', (await as(db, 'authenticated', guest, `SELECT * FROM public.partner_booking_requests`)).rows.length, 0)
t('admin sees the 1 row (positive control)', (await as(db, 'authenticated', admin, `SELECT * FROM public.partner_booking_requests`)).rows.length, 1)
t('admin UPDATE affects nothing / denied', (await as(db, 'authenticated', admin, `UPDATE public.partner_booking_requests SET guests=1`)).ok, false)
t('admin DELETE denied', (await as(db, 'authenticated', admin, `DELETE FROM public.partner_booking_requests`)).ok, false)
t('anon insert denied', (await as(db, 'anon', {}, ins)).ok, false)
t('anon select denied', (await as(db, 'anon', {}, `SELECT * FROM public.partner_booking_requests`)).ok, false)
t('guest cannot set created_at', (await as(db, 'authenticated', guest, ins.replace('(partner,', '(created_at, partner,').replace("VALUES (", "VALUES (now()-interval '9 days', "))).ok, false)
t('admin read does not need a second row: owner still sees 1', (await q(`SELECT count(*)::int n FROM public.partner_booking_requests`))[0].n, 1)

console.log('MUTANTS (each must be refused by the guarding assertion)')
await refused('extra grant: authenticated UPDATE',
  mutant('grant-update', "GRANT SELECT ON public.partner_booking_requests TO authenticated;", "GRANT SELECT, UPDATE ON public.partner_booking_requests TO authenticated;"), '', 'authenticated holds UPDATE')
await refused('insert grant widened to created_at',
  mutant('grant-created', "GRANT INSERT (partner, apartment, check_in, check_out, guests)", "GRANT INSERT (partner, apartment, check_in, check_out, guests, created_at)"), '', 'INSERT columns are not exactly')
await refused('anon granted INSERT',
  mutant('anon-ins', "GRANT SELECT ON public.partner_booking_requests TO authenticated;", "GRANT SELECT ON public.partner_booking_requests TO authenticated;\nGRANT INSERT (partner, apartment, check_in, check_out, guests) ON public.partner_booking_requests TO anon;"), '', 'anon')
await refused('select policy opened to everyone',
  mutant('select-open', "USING ((select public.is_admin()));", "USING (true);"), '', 'non-admin SELECT returned')
await refused('RLS guests bound dropped (table CHECK still there): policy layer must be caught',
  mutant('guests-rls', "AND guests BETWEEN 1 AND 12\n  );", "AND guests > 0\n  );"), '', 'reached CHECK, policy let it through')
await refused('table guests CHECK dropped (policy still there): CHECK layer must be caught',
  mutant('guests-chk', "CONSTRAINT partner_booking_requests_guests_check CHECK (guests BETWEEN 1 AND 12)", "CONSTRAINT partner_booking_requests_guests_check CHECK (guests > 0)"), '', 'CHECK layer ACCEPTED')
await refused('identifier column added', mutant('idcol', "guests     smallint    NOT NULL,", "guests     smallint    NOT NULL,\n  user_id    uuid,"), '', 'columns')
console.log(bad ? `\n${bad} FAILED` : '\nALL PASS')
process.exit(bad ? 1 : 0)
