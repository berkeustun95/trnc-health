#!/usr/bin/env node
// ─── Every scheduled workflow records its run (data jobs, slice 2) ───────────
//
// DERIVED, not a list. Reads three things and makes them agree:
//   1. .github/workflows/*.yml   every file with a `schedule:` trigger (read from the PARSED yaml)
//   2. supabase/migrations/20261205_data_jobs.sql   the seed rows with runner 'github' (the registry)
//   3. scripts/record-data-job-run.mjs   its JOBS allowlist
//
// Rules (WIRING, not presence; the workflows are parsed with js-yaml), per scheduled workflow:
//   * exactly one line in the whole file runs scripts/record-data-job-run.mjs (a --selftest line does not count),
//     exactly one such STEP, in the expected job (never gisekibris-feed's weekly-heartbeat);
//   * the step's `run` is exactly `node scripts/record-data-job-run.mjs --status="$X" --real-run="$Y"` (an echo
//     line does not count, no `${{` inside run); X and Y come from the step's own env: X is the job status
//     (`job.status`, or needs.<job>.result in the split recheck workflow), Y is set and never the literal false;
//   * its `if` contains always() and is not a constant false (absent is red too, except on the recheck's
//     record step, whose JOB carries the always() `if`); no continue-on-error on the step; timeout-minutes set;
//   * it is the LAST step of its job (duyurular-fetch: before the chain step);
//   * duyurular-paused-recheck: the record job `needs` the working job, has environment: production,
//     continue-on-error: true at job level and an always() job `if`; the working job has no environment and no `secrets.`;
//   * cancel-in-progress, at workflow or job level, is literally false or absent;
//   * the allowlist equals the seed's github keys, and every github key has a scheduled workflow with that name.
// Prints what it found, so a workflow the patterns MISSED is a visible absence, not a silent one.
// Every problem line starts with the red cross, so a blocked push shows it.
//
//   node scripts/check-data-job-heartbeats.mjs
//   node scripts/check-data-job-heartbeats.mjs --selftest

import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { JOBS } from './record-data-job-run.mjs'

const require = createRequire(import.meta.url)
let yaml
try { yaml = require('js-yaml') } catch { console.error('✗ js-yaml is not installed (npm ci)'); process.exit(1) }

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SEED = 'supabase/migrations/20261205_data_jobs.sql'
const CALL = 'scripts/record-data-job-run.mjs'
const EXACT = /^node scripts\/record-data-job-run\.mjs --status="\$([A-Z][A-Z0-9_]*)" --real-run="\$([A-Z][A-Z0-9_]*)"\s*$/
const JOB_STATUS = '${{ job.status }}'

// Where each scheduled workflow's record step must be: the one place a table is unavoidable ("the expected job").
export const EXPECT = Object.freeze({
  'gisekibris-feed': { job: 'sync' },
  'duyurular-fetch': { job: 'fetch', before: 'Chain the next run' },
  'novest-images': { job: 'run' },
  'araclar-photo-cleanup': { job: 'run' },
  'daily-health': { job: 'health' },
  'duyurular-paused-recheck': { job: 'record', work: 'recheck' },
})

const live = (src) => src.split('\n').filter(l => !/^\s*#/.test(l))
const asArr = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v])

export function registryKeys(sql) {
  const keys = []
  for (const m of sql.matchAll(/^\s*\('([a-z0-9-]+)',\s*'github',/gm)) keys.push(m[1])
  return keys
}

export const isScheduled = (doc) => {
  const on = doc?.on
  if (typeof on === 'string') return on === 'schedule'
  if (Array.isArray(on)) return on.includes('schedule')
  return !!on && typeof on === 'object' && Object.prototype.hasOwnProperty.call(on, 'schedule')
}

// An `if` that can never be true: a bare false/0, or a false/0 literal outside quotes.
const constantFalse = (v) => {
  if (v === false || v === 0) return true
  if (typeof v !== 'string') return false
  const e = v.replace(/^\s*\$\{\{|\}\}\s*$/g, '').replace(/'[^']*'|"[^"]*"/g, "''")
  return /(^|[^.\w])(false|0)([^.\w]|$)/.test(e)
}
const hasAlways = (v) => typeof v === 'string' && /\balways\(\)/.test(v) && !constantFalse(v)

function concurrencyProblems(doc) {
  const out = []
  const one = (where, c) => {
    if (c && typeof c === 'object' && 'cancel-in-progress' in c && c['cancel-in-progress'] !== false)
      out.push(`${where} cancel-in-progress must be literally false or absent, found ${JSON.stringify(c['cancel-in-progress'])} (the script records a cancelled run; change its rule first)`)
  }
  one('workflow', doc.concurrency)
  for (const [jn, j] of Object.entries(doc.jobs ?? {})) one(`job ${jn}`, j?.concurrency)
  return out
}

export function inspectWorkflow(src, expect = EXPECT) {
  const problems = []
  let doc
  try { doc = yaml.load(src) } catch (e) { return { name: null, scheduled: false, parseError: true, problems: [`yaml does not parse (${e.reason ?? 'error'})`] } }
  const name = typeof doc?.name === 'string' ? doc.name : null
  const scheduled = isScheduled(doc)
  const calls = live(src).filter(l => l.includes(CALL) && !l.includes('--selftest')).length
  const out = { name, scheduled, calls, problems, step: null }
  if (!scheduled) return out
  const ex = expect[name]
  const jobs = doc.jobs ?? {}
  if (!ex) { problems.push(`no wiring expectation for '${name}' (add it to EXPECT in this script)`); return out }
  problems.push(...concurrencyProblems(doc))

  const rec = []
  for (const [jn, j] of Object.entries(jobs))
    asArr(j?.steps).forEach((st, i) => { if (typeof st?.run === 'string' && st.run.includes(CALL) && !st.run.includes('--selftest')) rec.push({ jn, i, st }) })
  if (calls !== 1) problems.push(`${calls} lines run the record script, exactly 1 required`)
  if (rec.length !== 1) problems.push(`${rec.length} record steps, exactly 1 required`)
  const r = rec[0]
  if (!r) return out
  const { jn, i, st } = r
  out.step = { job: jn, index: i, of: asArr(jobs[jn].steps).length, if: st.if, timeout: st['timeout-minutes'], env: st.env }
  if (jn === 'weekly-heartbeat') problems.push('the record step is in weekly-heartbeat')
  if (jn !== ex.job) problems.push(`the record step is in job '${jn}', expected '${ex.job}'`)
  const m = EXACT.exec(st.run.trim())
  if (!m) problems.push(`the record step's run must be exactly: node ${CALL} --status="$X" --real-run="$Y" (found ${JSON.stringify(st.run.trim().slice(0, 120))})`)
  if (st.run.includes('${{')) problems.push("the record step's run contains a ${{ }} expression (put it in env)")
  const env = st.env && typeof st.env === 'object' ? st.env : {}
  if (m) {
    const wantStatus = ex.work ? '${{ needs.' + ex.work + '.result }}' : JOB_STATUS
    if (env[m[1]] !== wantStatus) problems.push(`--status="$${m[1]}": env ${m[1]} must be ${wantStatus}, found ${JSON.stringify(env[m[1]])}`)
    const rr = env[m[2]]
    if (rr === undefined || rr === '' || constantFalse(rr) || (typeof rr === 'string' && rr.trim().toLowerCase() === 'false'))
      problems.push(`--real-run="$${m[2]}": env ${m[2]} must be set and not the literal false, found ${JSON.stringify(rr)}`)
  }
  if (!('if' in st)) { if (!ex.work) problems.push('the record step has no if: always() (it would be skipped after a failure)') }
  else if (!hasAlways(st.if)) problems.push(`the record step's if must contain always() and not be constant false, found ${JSON.stringify(st.if)}`)
  if ('continue-on-error' in st) problems.push('the record step must not set continue-on-error')
  if (!(Number(st['timeout-minutes']) > 0)) problems.push('the record step has no timeout-minutes')

  const steps = asArr(jobs[jn].steps)
  if (ex.before) {
    const c = steps.findIndex(s => typeof s?.name === 'string' && s.name.startsWith(ex.before))
    if (c < 0) problems.push(`no step named '${ex.before}...' found`)
    else if (!(i < c)) problems.push(`the record step (#${i + 1}) must come before the '${ex.before}' step (#${c + 1})`)
  } else if (i !== steps.length - 1) problems.push(`the record step is #${i + 1} of ${steps.length}; it must be the last step of its job`)

  if (ex.work) {
    const rj = jobs[jn], wj = jobs[ex.work]
    if (!asArr(rj.needs).includes(ex.work)) problems.push(`job ${jn} must need ${ex.work}`)
    const envName = typeof rj.environment === 'string' ? rj.environment : rj.environment?.name
    if (envName !== 'production') problems.push(`job ${jn} must have environment: production`)
    if (rj['continue-on-error'] !== true) problems.push(`job ${jn} must have continue-on-error: true (a runner fault there must not turn a green run red)`)
    if (!hasAlways(rj.if)) problems.push(`job ${jn}: if must contain always() and not be constant false, found ${JSON.stringify(rj.if)}`)
    if (!wj) problems.push(`no job '${ex.work}'`)
    else {
      if ('environment' in wj) problems.push(`job ${ex.work} must have no environment`)
      if (JSON.stringify(wj).includes('secrets.')) problems.push(`job ${ex.work} must not mention secrets.`)
    }
  }
  return out
}

export function check({ workflows, seedSql, allowlist, expect = EXPECT }) {
  const problems = [], found = []
  const reg = registryKeys(seedSql)
  if (reg.length === 0) problems.push(`no github rows parsed from ${SEED}`)
  const scheduledNames = []
  for (const [file, src] of Object.entries(workflows)) {
    const w = inspectWorkflow(src, expect)
    if (w.parseError) { problems.push(`${file}: ${w.problems[0]}`); continue }
    if (!w.scheduled) {
      if (w.calls) problems.push(`${file}: calls the record script but has no schedule:`)
      continue
    }
    scheduledNames.push(w.name)
    found.push({ file, name: w.name, registered: reg.includes(w.name), calls: w.calls, step: w.step, nProblems: w.problems.length })
    if (!reg.includes(w.name)) problems.push(`${file}: name '${w.name}' is not a github key in the seed`)
    for (const p of w.problems) problems.push(`${file}: ${p}`)
  }
  const al = [...allowlist].sort(), rg = [...reg].sort()
  if (JSON.stringify(al) !== JSON.stringify(rg)) problems.push(`record script allowlist [${al}] != seeded github keys [${rg}]`)
  for (const k of reg) if (!scheduledNames.includes(k)) problems.push(`seeded github job '${k}' has no scheduled workflow with that name`)
  return { problems, found, reg }
}

if (process.argv.includes('--selftest')) {
  let bad = 0
  const t = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) bad++; console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(72)}  ${JSON.stringify(got)}${ok ? '' : `  wanted ${JSON.stringify(want)}`}`) }
  const sql = "  ('job-a', 'github',    'feed', '{}', 'x', interval '1 hour', 1),\n  ('job-f', 'github',    'feed', '{}', 'x', interval '1 hour', 2),\n  ('job-r', 'github',    'feed', '{}', 'x', interval '1 hour', 3),\n  ('cron-c', 'cron_http', 'feed', ARRAY['c'], NULL, interval '1 hour', 4),\n"
  const ex = { 'job-a': { job: 'x' }, 'job-f': { job: 'x', before: 'Chain' }, 'job-r': { job: 'rec', work: 'work' } }
  const RUN = `node ${CALL} --status="$S" --real-run="$RR"`
  const SCHED_IF = "${{ always() && github.event_name == 'schedule' }}"
  const recStep = (status = JOB_STATUS) => ({ name: 'Record', if: SCHED_IF, 'timeout-minutes': 2, env: { S: status, RR: "${{ github.event_name == 'schedule' }}" }, run: RUN })
  const base = (name) => {
    const o = { name, on: { schedule: [{ cron: '1 * * * *' }], workflow_dispatch: {} }, concurrency: { group: 'g', 'cancel-in-progress': false } }
    if (name === 'job-r') o.jobs = {
      work: { 'runs-on': 'u', steps: [{ run: 'echo hi' }] },
      rec: { needs: ['work'], if: SCHED_IF, 'continue-on-error': true, environment: 'production', 'runs-on': 'u', steps: [{ uses: 'a/b@1' }, recStep('${{ needs.work.result }}')] },
    }
    else if (name === 'job-f') o.jobs = { x: { steps: [{ run: 'echo hi' }, recStep(), { name: 'Chain the next run', run: 'echo chain' }] } }
    else o.jobs = { x: { steps: [{ run: 'echo hi' }, recStep()] }, other: { steps: [{ run: 'echo o' }] } }
    return o
  }
  const mk = (name, mut) => { const o = base(name); if (mut) mut(o); return yaml.dump(o, { lineWidth: -1 }) }
  const good = () => ({ 'a.yml': mk('job-a'), 'f.yml': mk('job-f'), 'r.yml': mk('job-r') })
  const run = (w) => check({ workflows: w, seedSql: sql, allowlist: ['job-a', 'job-f', 'job-r'], expect: ex }).problems
  // A red case: one broken workflow must produce a problem that names its rule.
  const red = (label, replace, needle) => t(`red: ${label}`, run({ ...good(), ...replace }).some(x => x.includes(needle)), true)
  const redA = (label, mut, needle) => red(label, { 'a.yml': mk('job-a', mut) }, needle)
  const redF = (label, mut, needle) => red(label, { 'f.yml': mk('job-f', mut) }, needle)
  const redR = (label, mut, needle) => red(label, { 'r.yml': mk('job-r', mut) }, needle)
  const rs = (o, job = 'x') => o.jobs[job].steps.find(s => s.name === 'Record')

  t('registry parse: github rows only', registryKeys(sql), ['job-a', 'job-f', 'job-r'])
  t('a correct set is clean', run(good()), [])
  t('EXPECT covers exactly the six jobs of the allowlist', Object.keys(EXPECT).sort(), [...JOBS].sort())

  redA('no record step', o => { o.jobs.x.steps.pop() }, 'record steps, exactly 1')
  redA('two record steps', o => { o.jobs.x.steps.push({ ...recStep(), name: 'Record 2' }) }, 'record steps, exactly 1')
  redA('the record step in weekly-heartbeat', o => { o.jobs['weekly-heartbeat'] = { steps: [rs(o)] }; o.jobs.x.steps.pop() }, 'in weekly-heartbeat')
  redA('the record step in another job', o => { o.jobs.other.steps.push(o.jobs.x.steps.pop()) }, "expected 'x'")
  redA('an echo line instead of the call', o => { rs(o).run = `echo node ${CALL} --status="$S" --real-run="$RR"` }, 'must be exactly')
  redA('an echo line besides the real step', o => { o.jobs.x.steps.unshift({ run: `echo ${CALL}` }) }, 'exactly 1')
  redA('a ${{ }} inside run', o => { rs(o).run = `node ${CALL} --status="$S" --real-run="` + '${{ github.event_name }}' + '"' }, 'must be exactly')
  redA('--real-run missing from the call', o => { rs(o).run = `node ${CALL} --status="$S"` }, 'must be exactly')
  redA('status env is not job.status', o => { rs(o).env.S = 'success' }, 'must be ${{ job.status }}')
  redA('step if without always()', o => { rs(o).if = "${{ github.event_name == 'schedule' }}" }, 'always()')
  redA('step if absent', o => { delete rs(o).if }, 'no if: always()')
  redA('step if constant false', o => { rs(o).if = '${{ always() && false }}' }, 'always()')
  redA('step if boolean false', o => { rs(o).if = false }, 'always()')
  redA('continue-on-error on the step', o => { rs(o)['continue-on-error'] = true }, 'must not set continue-on-error')
  redA('no timeout-minutes', o => { delete rs(o)['timeout-minutes'] }, 'timeout-minutes')
  redA('REAL_RUN is the literal string false', o => { rs(o).env.RR = 'false' }, 'literal false')
  redA('REAL_RUN is the boolean false', o => { rs(o).env.RR = false }, 'literal false')
  redA('REAL_RUN is not set', o => { delete rs(o).env.RR }, 'literal false')
  t('a REAL_RUN expression is fine (positive control)', run({ ...good(), 'a.yml': mk('job-a', o => { rs(o).env.RR = "${{ env.WRITE == 'true' && !inputs.limit }}" }) }), [])
  t('a constant REAL_RUN of true is fine (positive control)', run({ ...good(), 'a.yml': mk('job-a', o => { rs(o).env.RR = 'true' }) }), [])
  redA('not the last step of its job', o => { o.jobs.x.steps.push({ run: 'echo after' }) }, 'must be the last step')
  redF('fetch: the record step after the chain step', o => { o.jobs.x.steps.push(o.jobs.x.steps.splice(1, 1)[0]) }, "must come before the 'Chain")
  redF('fetch: no chain step', o => { o.jobs.x.steps.pop() }, "no step named 'Chain")
  t('fetch: a step after the chain is fine (positive control)', run({ ...good(), 'f.yml': mk('job-f', o => { o.jobs.x.steps.push({ run: 'echo tail' }) }) }), [])
  redR('recheck: the record job does not need the working job', o => { o.jobs.rec.needs = [] }, 'must need work')
  redR('recheck: the record job has no environment production', o => { delete o.jobs.rec.environment }, 'environment: production')
  redR('recheck: the record job has no continue-on-error', o => { delete o.jobs.rec['continue-on-error'] }, 'continue-on-error: true')
  redR('recheck: the record job if has no always()', o => { o.jobs.rec.if = "${{ github.event_name == 'schedule' }}" }, 'always()')
  redR('recheck: the working job has an environment', o => { o.jobs.work.environment = 'production' }, 'must have no environment')
  redR('recheck: the working job mentions secrets.', o => { o.jobs.work.steps[0].env = { K: '${{ secrets.K }}' } }, 'must not mention secrets.')
  redR('recheck: status is not needs.<work>.result', o => { rs(o, 'rec').env.S = JOB_STATUS }, 'needs.work.result')
  redR('recheck: continue-on-error on the record STEP', o => { rs(o, 'rec')['continue-on-error'] = true }, 'must not set continue-on-error')
  redA('cancel-in-progress: true', o => { o.concurrency['cancel-in-progress'] = true }, 'cancel-in-progress')
  redA('cancel-in-progress as an expression', o => { o.concurrency['cancel-in-progress'] = "${{ github.event_name == 'push' }}" }, 'cancel-in-progress')
  redA('cancel-in-progress: true on a job', o => { o.jobs.x.concurrency = { group: 'j', 'cancel-in-progress': true } }, 'cancel-in-progress')
  t('cancel-in-progress absent is fine (positive control)', run({ ...good(), 'a.yml': mk('job-a', o => { o.concurrency = 'plain-group' }) }), [])
  const flow = mk('job-a', o => { o.jobs.x.steps.pop() }).replace(/^on:[\s\S]*?^concurrency:/m, "on: { schedule: [ { cron: '1 * * * *' } ] }\nconcurrency:")
  t('flow-style on.schedule is detected (its missing step is red)', run({ ...good(), 'a.yml': flow }).some(x => x.includes('record steps, exactly 1')), true)
  t('on: "schedule" as a bare string is scheduled', isScheduled({ on: 'schedule' }), true)
  t('a dispatch-only workflow is not scheduled', isScheduled({ on: { workflow_dispatch: {} } }), false)
  red('a scheduled workflow with no EXPECT entry', { 'c.yml': mk('other', o => { o.jobs.x.steps.pop() }) }, 'no wiring expectation')
  red('a name not in the registry', { 'z.yml': mk('job-z') }, 'is not a github key')
  t('red: a seeded job with no workflow', check({ workflows: { 'a.yml': mk('job-a') }, seedSql: sql, allowlist: ['job-a', 'job-f', 'job-r'], expect: ex }).problems.some(p => p.includes("seeded github job 'job-f'")), true)
  t('red: an allowlist that differs', check({ workflows: good(), seedSql: sql, allowlist: ['job-a', 'job-f', 'job-r', 'job-x'], expect: ex }).problems.some(p => p.includes('allowlist')), true)
  red('an unparsable workflow', { 'bad.yml': 'name: [unclosed\non: {' }, 'does not parse')
  red('an unscheduled workflow calling the script', { 'c.yml': `name: job-a\non:\n  workflow_dispatch:\njobs:\n  x:\n    steps:\n      - run: node ${CALL}\n` }, 'has no schedule')
  t('an unscheduled workflow is ignored', run({ ...good(), 'c.yml': 'name: other\non:\n  workflow_dispatch:\n' }), [])
  t('a --selftest line is not a record step', run({ ...good(), 'a.yml': mk('job-a', o => { o.jobs.other.steps.push({ run: `node ${CALL} --selftest` }) }) }), [])
  t('a commented-out call does not count', run({ ...good(), 'a.yml': mk('job-a') + `# node ${CALL}\n` }), [])
  console.log(bad ? `\n  ${bad} self-test failure(s).` : '\n  Self-test clean.')
  process.exit(bad ? 1 : 0)
}

const wfDir = resolve(ROOT, '.github/workflows')
const workflows = Object.fromEntries(readdirSync(wfDir).filter(f => /\.ya?ml$/.test(f)).sort().map(f => [`.github/workflows/${f}`, readFileSync(resolve(wfDir, f), 'utf8')]))
const { problems, found, reg } = check({ workflows, seedSql: readFileSync(resolve(ROOT, SEED), 'utf8'), allowlist: JOBS })

console.log(`\nSeeded github jobs (${reg.length}): ${reg.join(', ')}`)
console.log(`Record-script allowlist (${JOBS.length}): ${[...JOBS].join(', ')}`)
console.log(`\nScheduled workflows that record (${found.length}):`)
for (const f of found) {
  const st = f.step
  console.log(`  ${f.registered && f.nProblems === 0 ? '✓' : '✗'} ${f.file}  name=${f.name}  record lines=${f.calls}`)
  if (st) {
    const rr = Object.entries(st.env ?? {}).find(([k]) => /REAL_RUN/.test(k))
    console.log(`      step: job=${st.job} #${st.index + 1} of ${st.of}  if=${JSON.stringify(st.if ?? null)}  timeout=${st.timeout}  ${rr ? rr[0] + '=' + JSON.stringify(rr[1]) : 'no REAL_RUN env'}`)
  }
}
if (problems.length) {
  console.error(`\n✗ ${problems.length} problem(s):`)
  for (const p of problems) console.error(`  ✗ ${p}`)
  process.exit(1)
}
console.log('\n✓ every scheduled data job records its run, and the registry, the allowlist and the workflows agree.')
