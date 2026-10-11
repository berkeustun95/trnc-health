// 20261104_duyurular_waitlist_notify.sql against the PGlite harness, seeded with the LIVE bodies of
// module_notif_text and notify_module_waitlist as read from production on 2026-10-10
// (scripts/fixtures-duyurular-notify-live-20261010.sql = pg_get_functiondef output, verbatim).
// Evidence about PG18's rendering only; the in-file md5 guard is what protects production.
//
//   node scripts/test-duyurular-notify-sql.mjs

import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile } from './migration-harness.mjs'

const FILE = fileURLToPath(new URL('../supabase/migrations/20261104_duyurular_waitlist_notify.sql', import.meta.url))
const LIVE = readFileSync(fileURLToPath(new URL('./fixtures-duyurular-notify-live-20261010.sql', import.meta.url)), 'utf8')
const SEED = `
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT false $f$;
${LIVE}
REVOKE ALL ON FUNCTION public.notify_module_waitlist(text) FROM PUBLIC, anon, authenticated;
`
let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}

const db = await freshDb(SEED)
t('applies on the live bodies (md5 guards + assertions green)', await applyFile(db, FILE), { ok: true, msg: null })
const q = async sql => (await db.query(sql)).rows[0]?.v
t('Turkish title', await q(`SELECT public.module_notif_text('title','duyurular','Turkish') v`), "ADA'da yeni: Duyurular")
t('Persian name', await q(`SELECT public.module_notif_text('title','duyurular','Persian') v`), 'جدید در ADA: اطلاعیه‌ها')
t('allow-list has duyurular', /'checkins','duyurular'\)/.test(await q(`SELECT pg_get_functiondef('public.notify_module_waitlist(text)'::regprocedure) v`)), true)
t('anon still cannot EXECUTE the RPC', await q(`SELECT has_function_privilege('anon','public.notify_module_waitlist(text)','EXECUTE') v`), false)

console.log('\nMutants')
const dir = mkdtempSync(join(tmpdir(), 'duy-notify-'))
// A production body that drifted after the 2026-10-10 read must abort the file, not be reverted.
const drifted = SEED.replace("'Neu bei ADA: {module}'", "'Neu in ADA: {module}'")
if (drifted === SEED) { bad++; console.log('  ✗ drift anchor not found') }
const r1 = await applyFile(await freshDb(drifted), FILE)
t(`drifted module_notif_text → refused (${r1.msg})`, !r1.ok && /changed since 2026-10-10/.test(r1.msg), true)
const sql = readFileSync(FILE, 'utf8')
const p = join(dir, 'm.sql')
writeFileSync(p, sql.replace("('duyurular','Turkish','Duyurular')", "('duyurular','Turkish','Duyurlar')"))
const r2 = await applyFile(await freshDb(SEED), p)
t(`typo in the Turkish name → refused (${r2.msg})`, !r2.ok && /Turkish title|more than the duyurular rows/.test(r2.msg), true)
writeFileSync(p, sql.replace("('checkins','English','Check-ins'),", "('checkins','English','Check ins'),"))
const r3 = await applyFile(await freshDb(SEED), p)
t(`an unrelated row edited → refused (${r3.msg})`, !r3.ok && /more than the duyurular rows/.test(r3.msg), true)

console.log(bad ? `\n✗ ${bad} failure(s).` : '\n✓ all checks pass.')
process.exit(bad ? 1 : 0)
