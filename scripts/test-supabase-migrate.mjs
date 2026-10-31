#!/usr/bin/env node
// ─── Offline proofs for scripts/supabase-migrate.mjs (the list mode) ─────────
//
//   node scripts/test-supabase-migrate.mjs
//
// Runs the REAL script against a stubbed fetch (preloaded with --import), on two real stamped
// files, and asserts what reaches the Management API and in which order: each file alone, its
// ledger row after it, QUERY 1 once after the LAST file; a failing file stops the run and
// nothing after it is sent; every refusal fires before anything is sent.

import { writeFileSync, readFileSync, mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = resolve(HERE, 'supabase-migrate.mjs')
const A = '20261144_eatery_order_method.sql', B = '20261151_eatery_partners_banner_path.sql'
const dir = mkdtempSync(join(tmpdir(), 'migrate-test-'))

// Ledger: MOCK_APPLIED (comma list) is recorded up front; a stamped file that is sent records itself.
// MOCK_FAIL = a file whose apply returns HTTP 400. Every call is logged as one line: apply:<file> | ledger:<file> | q1.
const MOCK = join(dir, 'mock-fetch.mjs')
writeFileSync(MOCK, `
import { appendFileSync } from 'node:fs'
const applied = new Map((process.env.MOCK_APPLIED || '').split(',').filter(Boolean).map(f => [f, 'x'.repeat(64)]))
const log = l => appendFileSync(process.env.MOCK_LOG, l + '\\n')
const res = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) })
globalThis.fetch = async (_url, init) => {
  const q = JSON.parse(init.body).query
  // QUERY 1 itself reads schema_migrations_applied by filename, so it is classified first.
  if (q.includes('Z-VERDICT')) { log('q1'); return res(200, [{ section: 'Z-VERDICT', status: 'OK', object: 'ALL PASS' }]) }
  const stamp = /VALUES \\('([^']+)', '([0-9a-f]{64})'\\)/.exec(q)
  if (q.includes('ledger:stamp:begin') && stamp) {
    log('apply:' + stamp[1])
    if (stamp[1] === process.env.MOCK_FAIL) return res(400, { message: 'boom' })
    applied.set(stamp[1], stamp[2]); return res(201, [])
  }
  const lf = /schema_migrations_applied WHERE filename = '([^']+)'/.exec(q)
  if (lf) { log('ledger:' + lf[1]); const c = applied.get(lf[1]); return res(200, c ? [{ filename: lf[1], checksum: c, applied_at: 't', applied_by: 'u' }] : []) }
  log('unknown'); return res(500, {})
}
`)

let n = 0, bad = 0
function run(name, argv, env = {}) {
  const logFile = join(dir, `log-${++n}.txt`)
  writeFileSync(logFile, '')
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(MOCK).href, SCRIPT, ...argv], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_ACTIONS: 'true', SUPABASE_ACCESS_TOKEN: 't', SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', MOCK_LOG: logFile, ...env },
  })
  return { name, status: r.status, out: r.stdout + r.stderr, calls: readFileSync(logFile, 'utf8').split('\n').filter(Boolean) }
}
function expect(r, status, calls, needle) {
  const okCalls = JSON.stringify(r.calls) === JSON.stringify(calls)
  const okNeedle = !needle || r.out.includes(needle)
  const ok = r.status === status && okCalls && okNeedle
  if (!ok) bad++
  console.log(`${ok ? '✓' : '✗'} ${r.name}`)
  if (!ok) console.log(`    exit ${r.status} (want ${status})\n    calls ${JSON.stringify(r.calls)}\n    want  ${JSON.stringify(calls)}${okNeedle ? '' : `\n    output lacks: ${needle}\n${r.out}`}`)
}

for (const f of [A, B]) if (!existsSync(resolve(HERE, '../supabase/migrations', f))) { console.error(`fixture ${f} is missing`); process.exit(1) }

expect(run('two files apply in order; QUERY 1 once, after the last', [A, B, '--apply']), 0,
  [`ledger:${A}`, `ledger:${B}`, `apply:${A}`, `ledger:${A}`, `apply:${B}`, `ledger:${B}`, 'q1'], `${A}, ${B} applied`)
expect(run('one file still works', [A, '--apply']), 0, [`ledger:${A}`, `apply:${A}`, `ledger:${A}`, 'q1'])
expect(run('dry sends no SQL', [A, B]), 0, [`ledger:${A}`, `ledger:${B}`], `${A} → ${B}`)
expect(run('a failing file stops the run; nothing after it is sent; no QUERY 1', [A, B, '--apply'], { MOCK_FAIL: A }), 1,
  [`ledger:${A}`, `ledger:${B}`, `apply:${A}`], `never sent: ${B}`)
expect(run('failure in the second names the first as committed', [A, B, '--apply'], { MOCK_FAIL: B }), 1,
  [`ledger:${A}`, `ledger:${B}`, `apply:${A}`, `ledger:${A}`, `apply:${B}`], `committed before it: ${A}`)
expect(run('a recorded file refuses the whole list before anything is sent', [A, B, '--apply'], { MOCK_APPLIED: B }), 1,
  [`ledger:${A}`, `ledger:${B}`], `ledger already records ${B}`)
expect(run('non-ascending list refused', [B, A, '--apply']), 1, [], 'not ascending')
expect(run('duplicate refused', [A, A, '--apply']), 1, [], 'more than once')
expect(run('bad name refused', [A, 'x.sql', '--apply']), 1, [], 'Not a migration file name')
expect(run('missing file refused', [A, '29991231_nope.sql', '--apply']), 1, [], 'is not in this commit')
expect(run('no file refused', ['--apply']), 1, [], 'No migration file given')

console.log(bad ? `\n${bad} FAILED` : '\nall passed')
process.exit(bad ? 1 : 0)
