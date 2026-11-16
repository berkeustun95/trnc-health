#!/usr/bin/env node
// ─── Every scheduled workflow records its run (data jobs, slice 2) ───────────
//
// DERIVED, not a list. Reads three things and makes them agree:
//   1. .github/workflows/*.yml   every file with a `schedule:` trigger
//   2. supabase/migrations/20261205_data_jobs.sql   the seed rows with runner 'github' (the registry)
//   3. scripts/record-data-job-run.mjs   its JOBS allowlist
// Rules: each scheduled workflow has EXACTLY ONE step running scripts/record-data-job-run.mjs (its --selftest line does not count), that step
// passes --status= and --real-run=, its `name:` is a registry key, the allowlist equals the registry's github
// keys, every github key has a scheduled workflow, and none of them sets cancel-in-progress: true (the script
// records a cancelled run, which a routine cancel would turn into noise). The recheck job of
// duyurular-paused-recheck must mention no `secrets.`.
// Prints what it found, so a workflow the patterns MISSED is a visible absence, not a silent one.
//
//   node scripts/check-data-job-heartbeats.mjs
//   node scripts/check-data-job-heartbeats.mjs --selftest

import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JOBS } from './record-data-job-run.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SEED = 'supabase/migrations/20261205_data_jobs.sql'
const CALL = 'scripts/record-data-job-run.mjs'

const live = (src) => src.split('\n').filter(l => !/^\s*#/.test(l))

export function registryKeys(sql) {
  const keys = []
  for (const m of sql.matchAll(/^\s*\('([a-z0-9-]+)',\s*'github',/gm)) keys.push(m[1])
  return keys
}

export function inspectWorkflow(src) {
  const lines = live(src)
  const name = lines.map(l => /^name:\s*['"]?([^'"\s#]+)/.exec(l)?.[1]).find(Boolean) ?? null
  const scheduled = lines.some(l => /^  schedule:/.test(l))
  const calls = lines.filter(l => l.includes(CALL) && !l.includes('--selftest'))
  const callText = calls.join('\n')
  return {
    name, scheduled, calls: calls.length,
    hasStatus: /--status=/.test(callText), hasRealRun: /--real-run=/.test(callText),
    cancelInProgress: lines.some(l => /cancel-in-progress:\s*true/.test(l)),
    lines,
  }
}

export function check({ workflows, seedSql, allowlist }) {
  const problems = [], found = []
  const reg = registryKeys(seedSql)
  if (reg.length === 0) problems.push(`no github rows parsed from ${SEED}`)
  const scheduledNames = []
  for (const [file, src] of Object.entries(workflows)) {
    const w = inspectWorkflow(src)
    if (!w.scheduled) {
      if (w.calls) problems.push(`${file}: calls the record script but has no schedule:`)
      continue
    }
    scheduledNames.push(w.name)
    found.push({ file, name: w.name, calls: w.calls, registered: reg.includes(w.name) })
    if (!reg.includes(w.name)) problems.push(`${file}: name '${w.name}' is not a github key in the seed`)
    if (w.calls !== 1) problems.push(`${file}: ${w.calls} record steps, exactly 1 required`)
    if (w.calls >= 1 && !(w.hasStatus && w.hasRealRun)) problems.push(`${file}: the record step must pass --status= and --real-run=`)
    if (w.cancelInProgress) problems.push(`${file}: cancel-in-progress: true — the script records a cancelled run; change its rule first`)
    if (file.endsWith('duyurular-paused-recheck.yml')) {
      const start = w.lines.findIndex(l => /^  recheck:/.test(l))
      const rest = w.lines.slice(start + 1)
      const end = rest.findIndex(l => /^  [a-z][a-z0-9_-]*:/.test(l))
      const block = (end < 0 ? rest : rest.slice(0, end)).join('\n')
      if (start < 0) problems.push(`${file}: no recheck job found`)
      else if (/secrets\./.test(block) || /^\s{4}environment:/m.test(block)) problems.push(`${file}: the recheck job must have no secrets and no environment`)
    }
  }
  const al = [...allowlist].sort(), rg = [...reg].sort()
  if (JSON.stringify(al) !== JSON.stringify(rg)) problems.push(`record script allowlist [${al}] != seeded github keys [${rg}]`)
  for (const k of reg) if (!scheduledNames.includes(k)) problems.push(`seeded github job '${k}' has no scheduled workflow with that name`)
  return { problems, found, reg }
}

if (process.argv.includes('--selftest')) {
  let bad = 0
  const t = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) bad++; console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(66)}  ${JSON.stringify(got)}${ok ? '' : `  wanted ${JSON.stringify(want)}`}`) }
  const sql = "  ('job-a', 'github',    'feed', '{}', 'x', interval '1 hour', 1),\n  ('job-b', 'github',    'feed', '{}', 'x', interval '1 hour', 2),\n  ('cron-c', 'cron_http', 'feed', ARRAY['c'], NULL, interval '1 hour', 3),\n"
  const wf = (name, steps = 1, extra = '') => `name: ${name}\non:\n  schedule:\n    - cron: '1 * * * *'\njobs:\n  x:\n    steps:\n` +
    Array.from({ length: steps }, () => `      - run: node ${CALL} --status="$S" --real-run=true\n`).join('') + extra
  const run = (workflows, allowlist = ['job-a', 'job-b']) => check({ workflows, seedSql: sql, allowlist }).problems.length
  const good = { 'a.yml': wf('job-a'), 'b.yml': wf('job-b') }
  t('registry parse: github rows only', registryKeys(sql), ['job-a', 'job-b'])
  t('a correct set is clean', run(good), 0)
  t('a scheduled workflow without the step is red', run({ ...good, 'b.yml': wf('job-b', 0) }) > 0, true)
  t('a name not in the registry is red (that very rule)', check({ workflows: { ...good, 'b.yml': wf('job-z') }, seedSql: sql, allowlist: ['job-a', 'job-b'] }).problems.some(p => p.includes('is not a github key')), true)
  t('two record steps is red', run({ ...good, 'b.yml': wf('job-b', 2) }) > 0, true)
  t('a seeded job with no workflow is red', run({ 'a.yml': wf('job-a') }) > 0, true)
  t('an allowlist that differs is red', run(good, ['job-a', 'job-b', 'job-x']) > 0, true)
  t('a commented-out step does not count', run({ ...good, 'b.yml': wf('job-b', 0, `      # - run: node ${CALL} --status=x --real-run=true\n`) }) > 0, true)
  t('a step without --real-run is red', run({ ...good, 'b.yml': wf('job-b', 0, `      - run: node ${CALL} --status="$S"\n`) }) > 0, true)
  t('cancel-in-progress: true is red', run({ ...good, 'b.yml': wf('job-b', 1, '    concurrency: { cancel-in-progress: true }\n') }) > 0, true)
  t('a --selftest line is not a record step', run({ ...good, 'b.yml': wf('job-b', 1, `      - run: node ${CALL} --selftest\n`) }), 0)
  t('an unscheduled workflow is ignored', run({ ...good, 'c.yml': 'name: other\non:\n  workflow_dispatch:\n' }), 0)
  t('an unscheduled workflow calling the script is red', run({ ...good, 'c.yml': `name: job-a\non:\n  workflow_dispatch:\njobs:\n  x:\n    steps:\n      - run: node ${CALL}\n` }) > 0, true)
  t('a scheduled non-data workflow that records nothing is red', run({ ...good, 'c.yml': wf('other', 0) }) > 0, true)
  const pr = `name: duyurular-paused-recheck\non:\n  schedule:\n    - cron: '1 * * * *'\njobs:\n  recheck:\n    runs-on: x\n    steps:\n      - run: echo \${{ secrets.K }}\n  record:\n    steps:\n      - run: node ${CALL} --status="$S" --real-run=true\n`
  const sqlPr = sql.replace('job-b', 'duyurular-paused-recheck')
  t('recheck job with a secret is red', check({ workflows: { 'duyurular-paused-recheck.yml': pr, 'a.yml': wf('job-a') }, seedSql: sqlPr, allowlist: ['job-a', 'duyurular-paused-recheck'] }).problems.length > 0, true)
  t('recheck job without a secret is clean', check({ workflows: { 'duyurular-paused-recheck.yml': pr.replace('echo ${{ secrets.K }}', 'echo ok'), 'a.yml': wf('job-a') }, seedSql: sqlPr, allowlist: ['job-a', 'duyurular-paused-recheck'] }).problems.length, 0)
  console.log(bad ? `\n  ${bad} self-test failure(s).` : '\n  Self-test clean.')
  process.exit(bad ? 1 : 0)
}

const wfDir = resolve(ROOT, '.github/workflows')
const workflows = Object.fromEntries(readdirSync(wfDir).filter(f => /\.ya?ml$/.test(f)).sort().map(f => [`.github/workflows/${f}`, readFileSync(resolve(wfDir, f), 'utf8')]))
const { problems, found, reg } = check({ workflows, seedSql: readFileSync(resolve(ROOT, SEED), 'utf8'), allowlist: JOBS })

console.log(`\nSeeded github jobs (${reg.length}): ${reg.join(', ')}`)
console.log(`Record-script allowlist (${JOBS.length}): ${[...JOBS].join(', ')}`)
console.log(`\nScheduled workflows that record (${found.length}):`)
for (const f of found) console.log(`  ${f.registered && f.calls === 1 ? '✓' : '✗'} ${f.file}  name=${f.name}  record steps=${f.calls}`)
if (problems.length) {
  console.error(`\n✗ ${problems.length} problem(s):`)
  for (const p of problems) console.error(`    ${p}`)
  process.exit(1)
}
console.log('\n✓ every scheduled data job records its run, and the registry, the allowlist and the workflows agree.')
