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
//   * the record step sets no working-directory or shell, and neither the job nor the workflow sets defaults.run (they
//     could point `node scripts/record-data-job-run.mjs` at another file or another interpreter);
//   * duyurular-fetch: the record step is IMMEDIATELY before the chain step (nothing slips in between);
//   * SWITCHABLE workflows (gisekibris-feed, duyurular-fetch, novest-images; data jobs slice 3) carry a `gate` job:
//     it has no `if`, environment production, permissions exactly contents: read, outputs.run from its gate step, a
//     checkout with persist-credentials: false, exactly one step running `node scripts/data-job-gate.mjs` with no
//     argument, no working-directory / shell / defaults.run, the service key only on that step and only for the runs
//     that are gated (a pinned expression, so a dry dispatch never reads it), GATE_CHAIN only on duyurular-fetch;
//     and the working job `needs: gate` with EXACTLY the `if` below (only the exact output `false` stops it; a failed
//     gate job lets the feed run: fail-open);
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
import { GATE_JOBS } from './data-job-gate.mjs'

const require = createRequire(import.meta.url)
let yaml
try { yaml = require('js-yaml') } catch { console.error('✗ js-yaml is not installed (npm ci)'); process.exit(1) }

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SEED = 'supabase/migrations/20261205_data_jobs.sql'
const CALL = 'scripts/record-data-job-run.mjs'
const EXACT = /^node scripts\/record-data-job-run\.mjs --status="\$([A-Z][A-Z0-9_]*)" --real-run="\$([A-Z][A-Z0-9_]*)"\s*$/
const JOB_STATUS = '${{ job.status }}'
const GATE_CALL = 'scripts/data-job-gate.mjs'
const GATE_IF = "${{ !cancelled() && needs.gate.outputs.run != 'false' }}"
const KEY_SCHEDULE = "${{ github.event_name == 'schedule' && secrets.SUPABASE_SERVICE_ROLE_KEY || '' }}"
const KEY_CHAIN = "${{ (github.event_name == 'schedule' || inputs.chain == true) && secrets.SUPABASE_SERVICE_ROLE_KEY || '' }}"

// Where each scheduled workflow's record step must be: the one place a table is unavoidable ("the expected job").
export const EXPECT = Object.freeze({
  'gisekibris-feed': { job: 'sync', gate: { key: KEY_SCHEDULE } },
  'duyurular-fetch': { job: 'fetch', before: 'Chain the next run', gate: { key: KEY_CHAIN, chain: true } },
  'novest-images': { job: 'run', gate: { key: KEY_SCHEDULE } },
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

const normIf = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v)

function defaultsProblems(doc, jobNames) {
  const out = []
  if (doc.defaults && 'run' in doc.defaults) out.push('the workflow sets defaults.run (working-directory / shell could redirect the scripts)')
  for (const jn of jobNames) if (doc.jobs?.[jn]?.defaults && 'run' in doc.jobs[jn].defaults) out.push(`job ${jn} sets defaults.run`)
  return out
}

export function gateProblems(doc, ex) {
  const out = [], jobs = doc.jobs ?? {}
  const g = jobs.gate, w = jobs[ex.job]
  if (!g) { out.push("no job 'gate'"); return out }
  const steps = asArr(g.steps)
  const calls = []
  for (const [jn, j] of Object.entries(jobs)) asArr(j?.steps).forEach((s) => { if (typeof s?.run === 'string' && s.run.includes(GATE_CALL) && !s.run.includes('--selftest')) calls.push({ jn, s }) })
  if (calls.length !== 1) out.push(`${calls.length} steps run the gate script, exactly 1 required`)
  const c = calls[0]
  if (c) {
    if (c.jn !== 'gate') out.push(`the gate script runs in job '${c.jn}', expected 'gate'`)
    if (c.s.run.trim() !== `node ${GATE_CALL}`) out.push(`the gate step's run must be exactly: node ${GATE_CALL} (no argument; found ${JSON.stringify(c.s.run.trim().slice(0, 120))})`)
    if (c.s.id !== 'gate') out.push(`the gate step must have id: gate, found ${JSON.stringify(c.s.id)}`)
    if ('working-directory' in c.s || 'shell' in c.s) out.push('the gate step must not set working-directory or shell')
    if ('if' in c.s) out.push('the gate step must have no if (it must always answer)')
    const env = c.s.env && typeof c.s.env === 'object' ? c.s.env : {}
    if (env.SUPABASE_SERVICE_ROLE_KEY !== ex.gate.key) out.push(`the gate step's SUPABASE_SERVICE_ROLE_KEY must be exactly ${ex.gate.key}, found ${JSON.stringify(env.SUPABASE_SERVICE_ROLE_KEY)} (a dry or hand dispatch must not get the key)`)
    const want = ['EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', ...(ex.gate.chain ? ['GATE_CHAIN'] : [])].sort()
    if (JSON.stringify(Object.keys(env).sort()) !== JSON.stringify(want)) out.push(`the gate step's env must be exactly [${want}], found [${Object.keys(env).sort()}]`)
    if (ex.gate.chain && env.GATE_CHAIN !== '${{ inputs.chain == true }}') out.push(`GATE_CHAIN must be \${{ inputs.chain == true }}, found ${JSON.stringify(env.GATE_CHAIN)}`)
  }
  if ('if' in g) out.push(`job gate must have no if (found ${JSON.stringify(g.if)}): it must run on every event`)
  if (asArr(g.needs).length) out.push('job gate must not need another job')
  const envName = typeof g.environment === 'string' ? g.environment : g.environment?.name
  if (envName !== 'production') out.push('job gate must have environment: production (the key lives there)')
  if (JSON.stringify(g.permissions) !== JSON.stringify({ contents: 'read' })) out.push(`job gate permissions must be exactly {contents: read}, found ${JSON.stringify(g.permissions)}`)
  if (g.outputs?.run !== '${{ steps.gate.outputs.run }}') out.push(`job gate outputs.run must be \${{ steps.gate.outputs.run }}, found ${JSON.stringify(g.outputs?.run)}`)
  const co = steps.filter(s => typeof s?.uses === 'string' && s.uses.startsWith('actions/checkout@'))
  if (co.length !== 1 || co[0].with?.['persist-credentials'] !== false) out.push('job gate must check out once with persist-credentials: false')
  if (g.env && JSON.stringify(g.env).includes('secrets.')) out.push('job gate: the secrets belong on the gate step only, not the job')
  for (const s of steps) if (s !== c?.s && JSON.stringify(s).includes('secrets.')) out.push(`job gate: step '${s.name ?? s.uses}' mentions secrets.`)
  if (!w) out.push(`no job '${ex.job}'`)
  else {
    if (!asArr(w.needs).includes('gate')) out.push(`job ${ex.job} must need gate`)
    if (normIf(w.if) !== GATE_IF) out.push(`job ${ex.job}: if must be exactly ${GATE_IF}, found ${JSON.stringify(w.if)}`)
  }
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
  if (ex.gate) problems.push(...gateProblems(doc, ex))
  problems.push(...defaultsProblems(doc, Object.keys(jobs).filter(j => j === ex.job || j === 'gate')))

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
  if ('working-directory' in st || 'shell' in st) problems.push('the record step must not set working-directory or shell')
  if (!(Number(st['timeout-minutes']) > 0)) problems.push('the record step has no timeout-minutes')

  const steps = asArr(jobs[jn].steps)
  if (ex.before) {
    const c = steps.findIndex(s => typeof s?.name === 'string' && s.name.startsWith(ex.before))
    if (c < 0) problems.push(`no step named '${ex.before}...' found`)
    else if (i !== c - 1) problems.push(`the record step (#${i + 1}) must be IMMEDIATELY before the '${ex.before}' step (#${c + 1})`)
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
  const ex = { 'job-a': { job: 'x', gate: { key: KEY_SCHEDULE } }, 'job-f': { job: 'x', before: 'Chain', gate: { key: KEY_CHAIN, chain: true } }, 'job-r': { job: 'rec', work: 'work' } }
  const gateJob = (chain) => ({
    environment: 'production', 'continue-on-error': true, permissions: { contents: 'read' }, outputs: { run: '${{ steps.gate.outputs.run }}' },
    steps: [{ uses: 'actions/checkout@abc', with: { 'persist-credentials': false } }, { uses: 'actions/setup-node@abc' },
      { name: 'Pause switch', id: 'gate', env: { SUPABASE_SERVICE_ROLE_KEY: chain ? KEY_CHAIN : KEY_SCHEDULE, EXPO_PUBLIC_SUPABASE_URL: '${{ secrets.EXPO_PUBLIC_SUPABASE_URL }}', ...(chain ? { GATE_CHAIN: '${{ inputs.chain == true }}' } : {}) }, run: `node ${GATE_CALL}` }],
  })
  const gated = (o, chain) => { o.jobs.gate = gateJob(chain); o.jobs.x.needs = 'gate'; o.jobs.x.if = GATE_IF }
  const RUN = `node ${CALL} --status="$S" --real-run="$RR"`
  const SCHED_IF = "${{ always() && github.event_name == 'schedule' }}"
  const recStep = (status = JOB_STATUS) => ({ name: 'Record', if: SCHED_IF, 'timeout-minutes': 2, env: { S: status, RR: "${{ github.event_name == 'schedule' }}" }, run: RUN })
  const base = (name) => {
    const o = { name, on: { schedule: [{ cron: '1 * * * *' }], workflow_dispatch: {} }, concurrency: { group: 'g', 'cancel-in-progress': false } }
    if (name === 'job-r') o.jobs = {
      work: { 'runs-on': 'u', steps: [{ run: 'echo hi' }] },
      rec: { needs: ['work'], if: SCHED_IF, 'continue-on-error': true, environment: 'production', 'runs-on': 'u', steps: [{ uses: 'a/b@1' }, recStep('${{ needs.work.result }}')] },
    }
    else if (name === 'job-f') { o.jobs = { x: { steps: [{ run: 'echo hi' }, recStep(), { name: 'Chain the next run', run: 'echo chain' }] } }; gated(o, true) }
    else { o.jobs = { x: { steps: [{ run: 'echo hi' }, recStep()] }, other: { steps: [{ run: 'echo o' }] } }; gated(o, false) }
    return o
  }
  const mk = (name, mut) => { const o = base(name); if (mut) mut(o); return yaml.dump(o, { lineWidth: -1 }) }
  const good = () => ({ 'a.yml': mk('job-a'), 'f.yml': mk('job-f'), 'r.yml': mk('job-r') })
  const run = (w) => check({ workflows: w, seedSql: sql, allowlist: ['job-a', 'job-f', 'job-r'], expect: ex }).problems
  // A red case: one broken workflow must produce a problem that names its rule.
  const red = (label, replace, needle) => { const hit = run({ ...good(), ...replace }).find(x => x.includes(needle)); t(`red: ${label}`, hit ? hit.slice(0, 110) : null, hit ? hit.slice(0, 110) : '(a problem containing ' + JSON.stringify(needle) + ')') }
  const redA = (label, mut, needle) => red(label, { 'a.yml': mk('job-a', mut) }, needle)
  const redF = (label, mut, needle) => red(label, { 'f.yml': mk('job-f', mut) }, needle)
  const redR = (label, mut, needle) => red(label, { 'r.yml': mk('job-r', mut) }, needle)
  const rs = (o, job = 'x') => o.jobs[job].steps.find(s => s.name === 'Record')

  t('EXPECT: exactly the three switchable workflows carry a gate', Object.entries(EXPECT).filter(([, v]) => v.gate).map(([k]) => k).sort(), ['duyurular-fetch', 'gisekibris-feed', 'novest-images'])
  t('EXPECT: gate script allowlist equals the gated workflows', [...GATE_JOBS].sort(), Object.entries(EXPECT).filter(([, v]) => v.gate).map(([k]) => k).sort())
  t('registry parse: github rows only', registryKeys(sql), ['job-a', 'job-f', 'job-r'])
  t('a correct set is clean', run(good()), [])
  t('EXPECT covers exactly the six jobs of the allowlist', Object.keys(EXPECT).sort(), [...JOBS].sort())

  redA('no record step', o => { o.jobs.x.steps.pop() }, 'record steps, exactly 1')
  redA('two record steps', o => { o.jobs.x.steps.push({ ...recStep(), name: 'Record 2' }) }, 'record steps, exactly 1')
  redA('the record step in weekly-heartbeat', o => { o.jobs['weekly-heartbeat'] = { steps: [rs(o)] }; o.jobs.x.steps.pop() }, 'in weekly-heartbeat')
  redA('the record step in another job', o => { o.jobs.other.steps.push(o.jobs.x.steps.pop()) }, "expected 'x'")
  redA('an echo line instead of the call', o => { rs(o).run = `echo node ${CALL} --status="$S" --real-run="$RR"` }, 'must be exactly')
  redA('an echo line besides the real step', o => { o.jobs.x.steps.unshift({ run: `echo ${CALL}` }) }, 'exactly 1')
  redA('a ${{ }} inside run', o => { rs(o).run = `node ${CALL} --status="$S" --real-run="` + '${{ github.event_name }}' + '"' }, '${{ }} expression')
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
  redF('fetch: the record step after the chain step', o => { o.jobs.x.steps.push(o.jobs.x.steps.splice(1, 1)[0]) }, "IMMEDIATELY before the 'Chain")
  redF('fetch: a step between the record step and the chain step', o => { o.jobs.x.steps.splice(2, 0, { name: 'Sneak', run: 'echo sneak' }) }, "IMMEDIATELY before the 'Chain")
  t('fetch: the record step right before the chain step is fine (positive control)', run(good()), [])
  redA('record step with working-directory', o => { rs(o)['working-directory'] = 'evil' }, 'working-directory or shell')
  redA('record step with shell', o => { rs(o).shell = 'python {0}' }, 'working-directory or shell')
  redA('defaults.run at workflow level', o => { o.defaults = { run: { 'working-directory': 'evil' } } }, 'defaults.run')
  redA('defaults.run on the working job', o => { o.jobs.x.defaults = { run: { shell: 'python {0}' } } }, 'sets defaults.run')
  redA('defaults.run on the gate job', o => { o.jobs.gate.defaults = { run: { shell: 'python {0}' } } }, 'job gate sets defaults.run')
  t('defaults without run is fine (positive control)', run({ ...good(), 'a.yml': mk('job-a', o => { o.defaults = { } }) }), [])
  const gs = (o) => o.jobs.gate.steps.find(s => s.id === 'gate')
  redA('no gate job', o => { delete o.jobs.gate }, "no job 'gate'")
  redA('working job does not need gate', o => { delete o.jobs.x.needs }, 'must need gate')
  redA('working job needs another job instead of gate', o => { o.jobs.x.needs = 'other' }, 'must need gate')
  redA('working job if absent', o => { delete o.jobs.x.if }, 'if must be exactly')
  redA('working job if is the bare == true form (fail-closed)', o => { o.jobs.x.if = "${{ needs.gate.outputs.run == 'true' }}" }, 'if must be exactly')
  redA('working job if uses always() (cancel would not halt it)', o => { o.jobs.x.if = "${{ always() && needs.gate.outputs.run != 'false' }}" }, 'if must be exactly')
  redA('working job if drops !cancelled()', o => { o.jobs.x.if = "${{ needs.gate.outputs.run != 'false' }}" }, 'if must be exactly')
  redA('gate job has an if', o => { o.jobs.gate.if = "${{ github.event_name == 'schedule' }}" }, 'job gate must have no if')
  redA('gate job without environment', o => { delete o.jobs.gate.environment }, 'environment: production')
  redA('gate job with wider permissions', o => { o.jobs.gate.permissions = { contents: 'read', issues: 'write' } }, 'permissions must be exactly')
  redA('gate job without permissions', o => { delete o.jobs.gate.permissions }, 'permissions must be exactly')
  redA('gate job outputs.run missing', o => { delete o.jobs.gate.outputs }, 'outputs.run must be')
  redA('checkout keeps credentials', o => { o.jobs.gate.steps[0].with['persist-credentials'] = true }, 'persist-credentials: false')
  redA('checkout without persist-credentials', o => { delete o.jobs.gate.steps[0].with }, 'persist-credentials: false')
  redA('gate script with an argument', o => { gs(o).run = `node ${GATE_CALL} --run=true` }, 'no argument')
  redA('gate script behind an echo', o => { gs(o).run = `echo node ${GATE_CALL}` }, 'no argument')
  redA('gate script not run at all', o => { gs(o).run = 'echo nothing' }, 'exactly 1 required')
  redA('gate script run twice', o => { o.jobs.gate.steps.push({ run: `node ${GATE_CALL}` }) }, 'exactly 1 required')
  redA('gate script run in the working job', o => { o.jobs.x.steps.unshift({ run: `node ${GATE_CALL}` }) }, 'exactly 1 required')
  redA('gate step with working-directory', o => { gs(o)['working-directory'] = 'evil' }, 'working-directory or shell')
  redA('gate step with shell', o => { gs(o).shell = 'python {0}' }, 'working-directory or shell')
  redA('gate step with an if', o => { gs(o).if = "${{ github.event_name == 'schedule' }}" }, 'must have no if')
  redA('gate step key always set (a dry dispatch would get it)', o => { gs(o).env.SUPABASE_SERVICE_ROLE_KEY = '${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}' }, 'must be exactly')
  redA('gate step key also for dispatches', o => { gs(o).env.SUPABASE_SERVICE_ROLE_KEY = "${{ github.event_name != 'x' && secrets.SUPABASE_SERVICE_ROLE_KEY || '' }}" }, 'must be exactly')
  redA('gate step gets an extra env var', o => { gs(o).env.EXTRA = '1' }, 'env must be exactly')
  redA('gate step gets GATE_CHAIN where it must not', o => { gs(o).env.GATE_CHAIN = 'true' }, 'env must be exactly')
  redA('secrets on the gate JOB env', o => { o.jobs.gate.env = { K: '${{ secrets.K }}' } }, 'secrets belong on the gate step only')
  redA('secrets on another gate step', o => { o.jobs.gate.steps[1].env = { K: '${{ secrets.K }}' } }, 'mentions secrets.')
  redF('fetch: GATE_CHAIN missing', o => { delete o.jobs.gate.steps.find(s => s.id === 'gate').env.GATE_CHAIN }, 'env must be exactly')
  redF('fetch: GATE_CHAIN hard-wired true', o => { o.jobs.gate.steps.find(s => s.id === 'gate').env.GATE_CHAIN = 'true' }, 'GATE_CHAIN must be')
  redF('fetch: key only for schedule (a chain run would not be gated)', o => { o.jobs.gate.steps.find(s => s.id === 'gate').env.SUPABASE_SERVICE_ROLE_KEY = KEY_SCHEDULE }, 'must be exactly')
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

const gatedNames = Object.entries(EXPECT).filter(([, v]) => v.gate).map(([k]) => k).sort()
if (JSON.stringify(gatedNames) !== JSON.stringify([...GATE_JOBS].sort())) problems.push(`gate script allowlist [${[...GATE_JOBS]}] != workflows expected to carry a gate [${gatedNames}]`)
console.log(`\nSeeded github jobs (${reg.length}): ${reg.join(', ')}`)
console.log(`Record-script allowlist (${JOBS.length}): ${[...JOBS].join(', ')}`)
console.log(`\nScheduled workflows that record (${found.length}):`)
for (const f of found) {
  const st = f.step
  console.log(`  ${f.registered && f.nProblems === 0 ? '✓' : '✗'} ${f.file}  name=${f.name}  record lines=${f.calls}`)
  if (EXPECT[f.name]?.gate) console.log(`      gate: job 'gate' -> job ${EXPECT[f.name].job} needs it, if ${GATE_IF}${f.nProblems === 0 ? '' : '  (see problems)'}`)
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
