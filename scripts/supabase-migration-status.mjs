#!/usr/bin/env node
// ─── Migration status report — the engine of .github/workflows/supabase-migration-status.yml ─
//
//   node scripts/supabase-migration-status.mjs <out-dir>     (CI only: needs the access token)
//
// READ ONLY. Every query goes to `/database/query/read-only` (supabase_read_only_user), and the
// role is proved before anything else runs. Nothing here can apply, backfill or stamp.
//
// One status per file in supabase/migrations/:
//   APPLIED                ledger row, checksum matches disk. Evidence says which kind of row:
//                          `stamped` = provenance (the file recorded itself at apply time);
//                          `baseline` = "matched live at the 2026-08-19 drift audit", NOT provenance.
//   APPLIED-EDITED         ledger row, checksum differs from disk (L2): the file changed after it ran.
//   APPLIED-UNTRACKED      no ledger row, every object it creates exists in prod.
//   PARTIAL                no ledger row, some objects exist and some do not.
//   PENDING                no ledger row, none of its objects exist.
//   UNVERIFIABLE           no ledger row and nothing a catalog can see (data-only UPDATE/INSERT).
// The bootstrap 20260903_migration_ledger.sql is absent from its own ledger by design; the
// table existing is its applied-record.
//
// Object evidence for unledgered files: verify_schema.sql QUERY 1 rows tagged with the file
// (registered, authoritative) first, then a regex read of the SQL (heuristic: an object a LATER
// migration dropped reads as missing, so a PARTIAL needs a human look before anything is applied).
// The heuristic is controlled every run: a known-applied file must read fully present and a
// made-up object must read absent, or the run fails rather than report a broken instrument.

import { readFileSync, readdirSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prodWriteGuard } from './lib/prod-write-guard.mjs'

prodWriteGuard({ wouldWrite: false, workflow: 'supabase-migration-status' })

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MIG = resolve(ROOT, 'supabase/migrations')
const BOOTSTRAP = '20260903_migration_ledger.sql'
const CONTROL_FILE = '20261070_live_scores.sql'
const OUT = resolve(ROOT, process.argv[2] || 'migration-status')

const fail = m => { console.error(`::error::${m}`); process.exit(1) }
const token = process.env.SUPABASE_ACCESS_TOKEN
const ref = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/.exec(process.env.SUPABASE_URL ?? '')?.[1]
if (!token) fail('SUPABASE_ACCESS_TOKEN is empty.')
if (!ref) fail('Could not derive the project ref from SUPABASE_URL.')

async function readOnly(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query/read-only`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  if (!r.ok || !Array.isArray(json)) return { error: `HTTP ${r.status}: ${(json?.message ?? text).slice(0, 1500)}` }
  return { rows: json }
}
const must = async (label, query) => {
  const r = await readOnly(query)
  if (r.error) fail(`${label}: ${r.error}`)
  return r.rows
}
const q = s => `'${String(s).replace(/'/g, "''")}'`

// 1 — prove the role.
const [p] = await must('role proof', `select current_user::text as role,
  (select rolbypassrls from pg_catalog.pg_roles where rolname = current_user) as bypasses_rls,
  has_table_privilege('public.notifications', 'INSERT') as can_insert,
  has_table_privilege('public.notifications', 'UPDATE') as can_update,
  has_table_privilege('public.notifications', 'DELETE') as can_delete`)
const roleLine = `role: ${p.role} · bypasses RLS: ${p.bypasses_rls} · INSERT/UPDATE/DELETE on notifications: ${p.can_insert}/${p.can_update}/${p.can_delete}`
console.log(roleLine)
if (p.can_insert || p.can_update || p.can_delete) fail('This role can write — refusing to run anything.')
if (!p.bypasses_rls) fail('This role does not bypass RLS: schema_migrations_applied has RLS on and zero policies, so it would read empty.')

// 2 — files, in the ledger tool's order.
const files = readdirSync(MIG).filter(f => f.endsWith('.sql')).sort()

// 3 — the ledger. Zero rows is a visibility failure, not 182 pending migrations.
const [{ n: ledgerCount }] = await must('ledger count', 'select count(*)::int as n from public.schema_migrations_applied')
const ledger = await must('ledger read', `select filename, checksum, applied_at::date::text as applied_on, applied_by
  from public.schema_migrations_applied order by filename`)
if (ledgerCount === 0) fail('The ledger reads 0 rows — the role cannot see it. Nothing can be classified.')
if (ledger.length !== ledgerCount) fail(`Ledger truncated: count(*) = ${ledgerCount}, rows received = ${ledger.length}.`)
const byFile = new Map(ledger.map(r => [r.filename, r]))

// 4 — the generated ledger check (L1 never-applied · L2 checksum-mismatch · L3 orphan).
const check = await must('ledger check', readFileSync(resolve(ROOT, 'supabase/migration_ledger_check.sql'), 'utf8'))
const L = s => new Set(check.filter(r => r.section === s).map(r => r.c1))
const [l1, l2, l3] = [L('L1-never-applied'), L('L2-checksum-mismatch'), L('L3-ledger-orphan')]
// Two readings of the same fact must agree: L1 from the check vs. files absent from the rows read.
const absent = new Set(files.filter(f => f !== BOOTSTRAP && !byFile.has(f)))
if ([...absent].sort().join() !== [...l1].sort().join()) fail(`L1 (${l1.size}) and the ledger read (${absent.size} absent) disagree.`)

// 5 — verify_schema.sql, the five queries sliced by their banners and sent one at a time.
const vs = readFileSync(resolve(ROOT, 'supabase/verify_schema.sql'), 'utf8')
const banners = [1, 2, 3, 4, 5].map(n => vs.indexOf(`═══ QUERY ${n} / 5`))
if (banners.some(i => i < 0)) fail('verify_schema.sql: a QUERY n / 5 banner is missing.')
const lineStart = i => vs.lastIndexOf('\n', i) + 1
const verify = []
for (let n = 1; n <= 5; n++) {
  const a = lineStart(banners[n - 1])
  const b = n < 5 ? lineStart(banners[n]) : vs.length
  const r = await readOnly(vs.slice(a, b))
  verify.push({ n, title: vs.slice(banners[n - 1], vs.indexOf('\n', banners[n - 1])).replace(/═/g, '').trim(), ...r })
}
const q1 = verify[0].rows ?? []

// 6 — object extraction for unledgered files (heuristic; see header).
const ID = String.raw`(?:"[^"]+"|[A-Za-z_][\w$]*)`
const QN = String.raw`(?:${ID}\s*\.\s*)?${ID}`
const norm = s => (s.startsWith('"') ? s.slice(1, -1) : s.toLowerCase())
const split = s => { const parts = s.split(/\s*\.\s*(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(norm); return parts.length === 2 ? parts : ['public', parts[0]] }
function extract(sql) {
  const body = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '').replace(/\$([\w]*)\$[\s\S]*?\$\1\$/g, "''")
  const creates = new Map(), drops = new Map()
  const key = (k, s, t, n) => `${k}|${s}|${t}|${n}`
  const add = (at, k, s, t, n) => creates.set(key(k, s, t, n), { k, s, t, n, at })
  const drop = (at, k, s, t, n) => drops.set(key(k, s, t, n), at)
  for (const m of body.matchAll(new RegExp(String.raw`CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${QN})`, 'gi'))) { const [s, n] = split(m[1]); add(m.index, 'table', s, n, n) }
  for (const m of body.matchAll(new RegExp(String.raw`ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${QN})([^;]*)`, 'gi'))) {
    const [s, t] = split(m[1])
    for (const c of m[2].matchAll(new RegExp(String.raw`ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(${ID})`, 'gi'))) {
      if (!/^(constraint|primary|unique|foreign|check|exclude)$/i.test(c[1])) add(m.index, 'column', s, t, norm(c[1]))
    }
    for (const c of m[2].matchAll(new RegExp(String.raw`DROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?(${ID})`, 'gi'))) {
      if (!/^(constraint|default|not|identity|expression)$/i.test(c[1])) drop(m.index, 'column', s, t, norm(c[1]))
    }
  }
  for (const m of body.matchAll(new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(${QN})\s*\(`, 'gi'))) { const [s, n] = split(m[1]); add(m.index, 'function', s, '', n) }
  for (const m of body.matchAll(new RegExp(String.raw`CREATE\s+POLICY\s+(${ID})\s+ON\s+(${QN})`, 'gi'))) { const [s, t] = split(m[2]); add(m.index, 'policy', s, t, norm(m[1])) }
  for (const m of body.matchAll(new RegExp(String.raw`CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(${ID})\s+ON\s+(?:ONLY\s+)?(${QN})`, 'gi'))) { const [s] = split(m[2]); add(m.index, 'index', s, '', norm(m[1])) }
  for (const m of body.matchAll(new RegExp(String.raw`CREATE\s+TYPE\s+(${QN})`, 'gi'))) { const [s, n] = split(m[1]); add(m.index, 'type', s, '', n) }
  for (const m of body.matchAll(new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+(${ID})[\s\S]*?\sON\s+(${QN})`, 'gi'))) { const [s, t] = split(m[2]); add(m.index, 'trigger', s, t, norm(m[1])) }
  for (const m of body.matchAll(new RegExp(String.raw`DROP\s+(TABLE|FUNCTION|TYPE|INDEX)\s+(?:IF\s+EXISTS\s+)?(${QN})`, 'gi'))) {
    const [s, n] = split(m[2]); const k = m[1].toLowerCase()
    drop(m.index, k, s, k === 'table' ? n : '', n)
  }
  for (const m of body.matchAll(new RegExp(String.raw`DROP\s+(POLICY|TRIGGER)\s+(?:IF\s+EXISTS\s+)?(${ID})\s+ON\s+(${QN})`, 'gi'))) {
    const [s, t] = split(m[3]); drop(m.index, m[1].toLowerCase(), s, t, norm(m[2]))
  }
  // DROP … IF EXISTS before CREATE is the re-runnable idiom; only a drop after the last create removes it.
  return [...creates.entries()].filter(([k, o]) => !(drops.get(k) > o.at)).map(([, { k, s, t, n }]) => ({ k, s, t, n }))
}
async function present(objs) {
  if (!objs.length) return []
  const vals = objs.map(o => `(${q(o.k)}, ${q(o.s)}, ${q(o.t)}, ${q(o.n)})`).join(',\n')
  const rows = await must('catalog check', `select k, s, t, n, case k
    when 'table'    then to_regclass(quote_ident(s) || '.' || quote_ident(n)) is not null
    when 'column'   then exists (select 1 from pg_attribute a where a.attrelid = to_regclass(quote_ident(s) || '.' || quote_ident(t))
                                   and a.attname = n and a.attnum > 0 and not a.attisdropped)
    when 'function' then exists (select 1 from pg_proc x join pg_namespace ns on ns.oid = x.pronamespace where ns.nspname = s and x.proname = n)
    when 'policy'   then exists (select 1 from pg_policies x where x.schemaname = s and x.tablename = t and x.policyname = n)
    when 'index'    then exists (select 1 from pg_indexes x where x.schemaname = s and x.indexname = n)
    when 'type'     then exists (select 1 from pg_type x join pg_namespace ns on ns.oid = x.typnamespace where ns.nspname = s and x.typname = n)
    when 'trigger'  then exists (select 1 from pg_trigger x join pg_class c on c.oid = x.tgrelid join pg_namespace ns on ns.oid = c.relnamespace
                                   where ns.nspname = s and c.relname = t and x.tgname = n and not x.tgisinternal)
    end as present
    from (values ${vals}) v(k, s, t, n)`)
  if (rows.length !== objs.length) fail(`catalog check returned ${rows.length} rows for ${objs.length} objects.`)
  return rows
}
const label = o => `${o.k} ${o.s === 'public' ? '' : o.s + '.'}${o.t && o.t !== o.n ? o.t + '.' : ''}${o.n}`

// Controls: a known-applied file reads fully present; a made-up object reads absent.
const ctl = await present(extract(readFileSync(resolve(MIG, CONTROL_FILE), 'utf8')))
const fake = await present([{ k: 'table', s: 'public', t: '', n: '__migration_status_absent_probe' }])
if (!ctl.length || ctl.some(r => !r.present)) fail(`Positive control failed: ${CONTROL_FILE} should read fully present: ${ctl.filter(r => !r.present).map(label).join(', ') || 'no objects extracted'}`)
if (fake[0].present) fail('Negative control failed: a made-up table reads present.')

// verify_schema Q1 tags are abbreviated ('0621_provider_verification', 'capture_1'): match by substring.
const q1For = f => q1.filter(r => r.migration && r.migration !== '-' && r.section !== 'Z-VERDICT' && f.includes(r.migration))

// 7 — classify.
const report = []
for (const f of files) {
  const led = byFile.get(f)
  if (f === BOOTSTRAP) { report.push({ f, status: 'APPLIED', ev: 'bootstrap: the ledger table exists (absent from its own ledger by design)' }); continue }
  if (led && l2.has(f)) { report.push({ f, status: 'APPLIED-EDITED', ev: check.find(r => r.c1 === f && r.section === 'L2-checksum-mismatch').c2 }); continue }
  if (led) {
    report.push({ f, status: 'APPLIED', ev: led.applied_by === 'baseline'
      ? 'ledger: baseline — matched live at the 2026-08-19 drift audit (not provenance)'
      : `ledger: stamped ${led.applied_on} by ${led.applied_by}` })
    continue
  }
  const sql = readFileSync(resolve(MIG, f), 'utf8')
  const objs = await present(extract(sql))
  const vrows = q1For(f)
  const vBad = vrows.filter(r => !['OK', 'ON'].includes(r.status))
  const have = objs.filter(r => r.present), miss = objs.filter(r => !r.present)
  const nAll = objs.length + vrows.length, nMiss = miss.length + vBad.length
  const status = nAll === 0 ? 'UNVERIFIABLE' : nMiss === 0 ? 'APPLIED-UNTRACKED' : nMiss === nAll ? 'PENDING' : 'PARTIAL'
  const ev = [
    vrows.length ? `verify_schema: ${vrows.length - vBad.length}/${vrows.length} OK${vBad.length ? ' (bad: ' + vBad.map(r => `${r.object} ${r.status}`).join(', ') + ')' : ''}` : 'verify_schema: no rows tagged',
    objs.length ? `catalog (heuristic): ${have.length}/${objs.length} present${miss.length ? ' (missing: ' + miss.map(label).join(', ') + ')' : ''}` : 'catalog: no DDL found',
  ].join(' · ')
  // Dependencies: tables this file touches that are missing and that another unledgered file creates.
  const touched = [...sql.matchAll(new RegExp(String.raw`(?:REFERENCES|ON|ALTER\s+TABLE(?:\s+IF\s+EXISTS)?|INTO|UPDATE)\s+(?:ONLY\s+)?(${QN})`, 'gi'))].map(m => split(m[1]).join('.'))
  report.push({ f, status, ev, touched: [...new Set(touched)], creates: extract(sql).filter(o => o.k === 'table').map(o => `${o.s}.${o.n}`) })
}

// 8 — render.
const esc = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
const counts = report.reduce((m, r) => (m[r.status] = (m[r.status] || 0) + 1, m), {})
const baseline = ledger.filter(r => r.applied_by === 'baseline').length
const todo = report.filter(r => ['PENDING', 'PARTIAL', 'UNVERIFIABLE'].includes(r.status))
const md = []
md.push('# Migration status — production', '')
md.push(`- ${roleLine}`)
md.push(`- files in supabase/migrations/: **${files.length}** · ledger rows: **${ledgerCount}** (${baseline} baseline, ${ledgerCount - baseline} stamped)`)
md.push(`- committed migration_ledger_check.sql fresh: ${process.env.LEDGER_CHECK_FRESH ?? 'unknown (run outside the workflow)'}`)
md.push(`- controls: ${CONTROL_FILE} reads ${ctl.length}/${ctl.length} present · made-up table reads absent`)
md.push(`- **${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}**`)
md.push(`- verify_schema QUERY 1 verdict: **${q1[0]?.object ?? verify[0].error}** [${q1[0]?.status ?? 'ERROR'}]`, '')
md.push('## Needs action (apply order)', '')
if (!todo.length) md.push('None. Every file is in the ledger (or is the bootstrap).', '')
else {
  md.push('| # | file | status | depends on (unledgered files creating a table it touches) |', '|---|---|---|---|')
  todo.forEach((r, i) => {
    const deps = todo.filter(o => o.f < r.f && o.creates?.some(t => r.touched?.includes(t))).map(o => o.f)
    md.push(`| ${i + 1} | ${r.f} | ${r.status} | ${deps.join(', ') || '—'} |`)
  })
  md.push('')
}
if (l3.size) md.push('## In the ledger, not on disk (L3)', '', ...[...l3].map(f => `- ${f}`), '')
md.push('## All files', '', '| file | status | evidence |', '|---|---|---|')
for (const r of report) md.push(`| ${r.f} | ${r.status} | ${esc(r.ev)} |`)
md.push('', '## verify_schema.sql', '')
for (const v of verify) {
  md.push(`### ${v.title}`, '')
  if (v.error) { md.push('```', v.error, '```', ''); continue }
  const rows = v.n === 1 ? v.rows.filter((r, i) => i === 0 || !['OK', 'ON'].includes(r.status)) : v.rows
  if (v.n === 1) md.push(`${v.rows.length - 1} checks; the verdict row and every non-OK row:`, '')
  if (!rows.length) { md.push('(no rows)', ''); continue }
  const cols = Object.keys(rows[0])
  md.push(`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`, ...rows.map(r => `| ${cols.map(c => esc(r[c])).join(' | ')} |`), '')
}
const text = md.join('\n')

mkdirSync(OUT, { recursive: true })
writeFileSync(resolve(OUT, 'report.md'), text)
writeFileSync(resolve(OUT, 'verify_schema.json'), JSON.stringify(verify, null, 2))
writeFileSync(resolve(OUT, 'ledger.json'), JSON.stringify({ ledger, check }, null, 2))
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n')
console.log(text)
for (const v of verify.filter(v => v.error)) console.log(`::warning::verify_schema QUERY ${v.n} did not run: ${v.error.split('\n')[0]}`)
if (todo.length || l2.size) console.log(`::warning::${todo.length} file(s) need action, ${l2.size} edited after applying — see the summary.`)
