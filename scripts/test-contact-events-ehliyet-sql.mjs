// 20261109_contact_events_ehliyet.sql against the PGlite harness (PostgreSQL 18; prod is older).
// Standalone: the fixture is a bare contact_events with the 13-module CHECK and the 7-action CHECK
// (what 20261083 left); no driving_schools.
// Final check applies 20261108 THEN 20261109 on one database (the order they would run in).
//
//   node scripts/test-contact-events-ehliyet-sql.mjs

import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile } from './migration-harness.mjs'

const mig = (n) => fileURLToPath(new URL(`../supabase/migrations/${n}`, import.meta.url))
const FILE = mig('20261109_contact_events_ehliyet.sql')
const SQL = readFileSync(FILE, 'utf8')
const MODS13 = ['homeServices','grooming','garages','transport','insurance','pets','events','jobs',
                'accommodation','studentHub','explore','towing','hotels']
const ACTS7 = ['call','whatsapp','call_secondary','website','maps','route_complete','book']
const ACTS10 = [...ACTS7, 'instagram', 'facebook', 'email']
let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
const fixture = (mods, acts = ACTS7) => `
  CREATE TABLE public.contact_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), module text NOT NULL, entity_id uuid NOT NULL,
    action text NOT NULL, region text, created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT contact_events_module_check CHECK (module IN (${mods.map(m => `'${m}'`).join(',')})),
    CONSTRAINT contact_events_action_check CHECK (action IN (${acts.map(a => `'${a}'`).join(',')})));`
const dir = mkdtempSync(join(tmpdir(), 'ce-'))
const mods = async (d) => (await d.query(`SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) a FROM regexp_matches((SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='contact_events_module_check'), '''([a-zA-Z]+)''::text', 'g') AS m`)).rows[0].a

const acts = async (d) => (await d.query(`SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) a FROM regexp_matches((SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='contact_events_action_check'), '''([a-z_]+)''::text', 'g') AS m`)).rows[0].a

console.log('20261109_contact_events_ehliyet — real file, bare contact_events fixture')
const db = await freshDb(fixture(MODS13))
t('applies cleanly (pre/post-state, positive + negative control green)', await applyFile(db, FILE), { ok: true, msg: null })
t('module set = 13 + ehliyet', await mods(db), [...MODS13, 'ehliyet'].sort())
t('action set = 7 + instagram, facebook, email', await acts(db), [...ACTS10].sort())
t('no probe row survived', (await db.query('SELECT count(*)::int n FROM public.contact_events')).rows[0].n, 0)

console.log('MUTANTS (each must be refused)')
const run = async (name, sql, extra) => {
  const p = join(dir, name.replace(/\W+/g, '_') + '.sql'); writeFileSync(p, sql)
  const r = await applyFile(await freshDb(extra), p)
  t(`${name} refused`, r.ok, false); console.log(`      ${r.msg}`)
}
await run('pre-state drift (towing missing)', SQL, fixture(MODS13.filter(m => m !== 'towing')))
await run('pre-state drift (extra module)', SQL, fixture([...MODS13, 'zzextra']))
const aAnchor = `'instagram','facebook','email'));`
const anchor = `'transport','ehliyet'));`
if (!SQL.includes(anchor)) { bad++; console.log('  ✗ anchor missing') }
else {
  await run('CHECK re-added without ehliyet', SQL.replace(anchor, `'transport'));`), fixture(MODS13))
  await run('CHECK dropped (negative control must notice)', SQL.replace(/CHECK \(module IN \([^;]*\)\);/, 'CHECK (true);'), fixture(MODS13))
}
if (!SQL.includes(aAnchor)) { bad++; console.log('  ✗ action anchor missing') }
else {
  await run('action pre-state drift (book missing)', SQL, fixture(MODS13, ACTS7.filter(a => a !== 'book')))
  await run('action pre-state drift (extra action)', SQL, fixture(MODS13, [...ACTS7, 'zzextra']))
  await run('action pre-state drift (already has instagram)', SQL, fixture(MODS13, [...ACTS7, 'instagram']))
  await run('action CHECK re-added without email', SQL.replace(aAnchor, `'instagram','facebook'));`), fixture(MODS13))
  await run('action CHECK re-added without instagram', SQL.replace(`'instagram','facebook','email'));`, `'facebook','email'));`), fixture(MODS13))
  await run('action CHECK re-added without book (survival)', SQL.replace(`'route_complete','book',\n                    'instagram'`, `'route_complete',\n                    'instagram'`), fixture(MODS13))
  await run('action CHECK replaced by CHECK (true) (negative control must notice)', SQL.replace(/CHECK \(action IN \([^;]*\)\);/, 'CHECK (true);'), fixture(MODS13))
}

console.log('Independence + order: 20261108 alone, then 20261108 -> 20261109')
const alone = await freshDb()
t('20261108 applies with NO contact_events table', await applyFile(alone, mig('20261108_driving_schools.sql')), { ok: true, msg: null })
const both = await freshDb(fixture(MODS13))
t('20261108 applies', await applyFile(both, mig('20261108_driving_schools.sql')), { ok: true, msg: null })
t('20261109 applies after it', await applyFile(both, FILE), { ok: true, msg: null })
t('module set = 13 + ehliyet', await mods(both), [...MODS13, 'ehliyet'].sort())
t('action set = 10', await acts(both), [...ACTS10].sort())

if (bad) { console.log(`\n${bad} FAILED`); process.exit(1) }
console.log('\nall green')
