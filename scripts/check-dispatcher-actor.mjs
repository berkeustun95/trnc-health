#!/usr/bin/env node
// ─── Actor rule on every guarded GitHub Actions job (data jobs, slice 6, guard PR) ───────────────────
//
// WHY. A future GitHub App `ada-dispatcher` may only run THREE workflows (gisekibris-feed, daily-health,
// novest-images), by workflow_dispatch from main, attempt 1, with every input at its declared default. GitHub
// itself cannot scope an App that narrowly, so the workflows refuse it: every guarded job carries, in its own
// job-level `if`, a rule that is false for the App unless that exact shape holds. A skipped job never starts,
// gets no environment and no secrets, and runs no step; an actor check INSIDE a job would not do (later
// `always()` / `!cancelled()` steps still run after a failed step, and a continue-on-error job turns red green).
// A GitHub re-run executes the OLD workflow file of the original run for 30 days, so the App is only installed
// once main has been fully guarded for 30 days (the clock below).
//
// ⚠ NEVER RENAME THE APP. `github.triggering_actor` has no id twin: it is pinned by LOGIN only. A renamed App
// has a different login, and the rule would then not recognise it. `github.actor` and `github.actor_id` are
// pinned too (login ada-dispatcher[bot], id 357529844, App ID 5789245).
//
// WHAT IS GUARDED (derived from the parsed workflows, never a list). A job is guarded if ANY holds:
//   * it has `environment:` in any form (string, `${{ }}` expression, `{name:}`);
//   * its JSON, or the workflow-level `env`, matches /\bsecrets\b/i (case-insensitive, like GitHub's context names) (secrets.X, secrets[...], toJSON(secrets), ...);
//   * its effective permissions (job level, else workflow level) grant any `write`, or are `write-all`;
//   * there is NO permissions block at either level (the repo default is not known from here).
// FAIL CLOSED on: a job with `uses:` (reusable workflow), `secrets: inherit`, an `on: workflow_call` trigger.
//
// THE RULE (canonical, parsed, never a substring). DENY is the App by actor, actor id or triggering actor.
//   most workflows   ACTOR_OK = !DENY
//   the three files  ACTOR_OK = (!DENY || (event_name == 'workflow_dispatch' && run_attempt == '1' &&
//                    ref == 'refs/heads/main' && inputs.<each declared input> == <its declared default>))
// A guarded job's `if` is exactly `${{ ACTOR_OK }}` (no earlier `if`) or `${{ ACTOR_OK && (OLD) }}` with OLD the
// previous condition: non-empty, balanced parentheses that never close the wrapper early, no `${{` / `}}`.
// No guarded job may set continue-on-error; typed `inputs.*` only, never `github.event.inputs`.
// GitHub semantics: a bare ACTOR_OK gets the implicit success() like no `if`; `ACTOR_OK && (always() && Y)`
// still counts as containing a status function, so it keeps running after a failed need.
//
//   node scripts/check-dispatcher-actor.mjs                    check + print the guarded list + the 30-day clock
//   node scripts/check-dispatcher-actor.mjs --selftest
//   node scripts/check-dispatcher-actor.mjs --print-expr <workflow file>   the canonical ACTOR_OK for that file
//
// The clock is informational and never fails the check. Every problem line starts with the red cross.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

const require = createRequire(import.meta.url)
let yaml
try { yaml = require('js-yaml') } catch { console.error('✗ js-yaml is not installed (npm ci)'); process.exit(1) }

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WF_DIR = '.github/workflows'

export const BOT_LOGIN = 'ada-dispatcher[bot]'
export const BOT_ID = '357529844'
export const DENY = `(github.actor == '${BOT_LOGIN}' || github.actor_id == '${BOT_ID}' || github.triggering_actor == '${BOT_LOGIN}')`
export const ALLOW_FILES = Object.freeze(['gisekibris-feed.yml', 'daily-health.yml', 'novest-images.yml'])

const asObj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
const dq = (s) => `'${String(s).replace(/'/g, "''")}'`

export function loadWorkflow(src) {
  try { return { doc: yaml.load(src) } } catch (e) { return { error: e.reason ?? 'error' } }
}

// ─── Guarded set ─────────────────────────────────────────────────────────────
function grantsWrite(p) {
  if (typeof p === 'string') return p.toLowerCase() === 'write-all'
  return Object.values(asObj(p)).some((v) => typeof v === 'string' && v.toLowerCase() === 'write')
}

export function guardedReasons(doc, job) {
  const r = []
  if (job && Object.prototype.hasOwnProperty.call(job, 'environment') && job.environment !== undefined && job.environment !== null) r.push('environment')
  if (/\bsecrets\b/i.test(JSON.stringify(job ?? {})) || /\bsecrets\b/i.test(JSON.stringify(doc?.env ?? {}))) r.push('secrets')
  const eff = job && job.permissions !== undefined ? job.permissions : doc?.permissions
  if (eff === undefined || eff === null) r.push('no permissions block (repo default unknown)')
  else if (grantsWrite(eff)) r.push('write permission')
  return r
}

function exemptReason(doc, job) {
  const eff = job.permissions !== undefined ? job.permissions : doc.permissions
  return `no environment, no secrets, permissions ${JSON.stringify(eff)} grant no write`
}

// ─── Fail closed ─────────────────────────────────────────────────────────────
export function failClosedProblems(doc) {
  const out = []
  const on = doc?.on
  const triggers = typeof on === 'string' ? [on] : Array.isArray(on) ? on : Object.keys(asObj(on))
  if (triggers.includes('workflow_call')) out.push('on: workflow_call (a reusable workflow: this guard cannot follow it; failing closed)')
  for (const [jn, j] of Object.entries(asObj(doc?.jobs))) {
    if (j && typeof j === 'object' && 'uses' in j) out.push(`job ${jn}: has uses: (a reusable workflow call: failing closed)`)
    if (j && typeof j === 'object' && j.secrets === 'inherit') out.push(`job ${jn}: secrets: inherit (failing closed)`)
  }
  return out
}

// ─── The canonical expression ────────────────────────────────────────────────
function inputLiteral(name, inp) {
  const spec = asObj(inp)
  if (!('default' in spec) || spec.default === undefined || spec.default === null) return { problem: `input ${name} has no explicit default (every input of an allowlisted workflow needs one)` }
  const type = spec.type ?? 'string'
  const d = spec.default
  if (type === 'boolean') return typeof d === 'boolean' ? { lit: String(d) } : { problem: `input ${name} is boolean but its default is ${JSON.stringify(d)}` }
  if (type === 'number') return typeof d === 'number' && Number.isFinite(d) ? { lit: String(d) } : { problem: `input ${name} is number but its default is ${JSON.stringify(d)}` }
  if (type === 'string' || type === 'choice' || type === 'environment') return { lit: dq(d) }
  return { problem: `input ${name} has an unknown type ${JSON.stringify(type)}` }
}

// `file` is the workflow FILE name (the allowlist is by file). Returns { expr } or { problems }.
export function actorOk(file, doc) {
  if (!ALLOW_FILES.includes(file)) return { expr: `!${DENY}` }
  const wd = asObj(doc?.on).workflow_dispatch
  if (!asObj(doc?.on) || !('workflow_dispatch' in asObj(doc?.on))) return { problems: [`${file} is allowlisted but has no workflow_dispatch trigger`] }
  const inputs = asObj(asObj(wd).inputs)
  const problems = [], lits = []
  for (const [name, inp] of Object.entries(inputs)) {
    const r = inputLiteral(name, inp)
    if (r.problem) problems.push(r.problem)
    else lits.push(` && inputs.${name} == ${r.lit}`)
  }
  if (problems.length) return { problems }
  return { expr: `(!${DENY} || (github.event_name == 'workflow_dispatch' && github.run_attempt == '1' && github.ref == 'refs/heads/main'${lits.join('')}))` }
}

export const buildIf = (ok, old) => (old === undefined ? `\${{ ${ok} }}` : `\${{ ${ok} && (${old}) }}`)

// Balanced, never below depth 0, ignoring parentheses inside '…' literals ('' is an escaped quote).
export function parensOk(s) {
  let depth = 0, inStr = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inStr) { if (c === "'") { if (s[i + 1] === "'") i++; else inStr = false } continue }
    if (c === "'") inStr = true
    else if (c === '(') depth++
    else if (c === ')') { depth--; if (depth < 0) return false }
  }
  return depth === 0 && !inStr
}

// Parse a job `if` against the canonical wrapper. Returns { none, old, problems }.
export function splitIf(v, ok) {
  if (v === undefined) return { none: true, problems: ['no if (every guarded job carries the actor rule)'] }
  if (typeof v !== 'string') return { problems: [`if is not a string: ${JSON.stringify(v)}`] }
  const s = v.trim()
  const bad = []
  if (s.includes('github.event.inputs')) bad.push('the rule uses github.event.inputs (use the typed inputs.*)')
  if (s === buildIf(ok)) return { bare: true, old: undefined, problems: bad }
  const pre = `\${{ ${ok} && (`, suf = ') }}'
  if (!s.startsWith(pre) || !s.endsWith(suf) || s.length < pre.length + suf.length) {
    bad.push(`if is not the canonical \${{ ACTOR_OK }} or \${{ ACTOR_OK && (OLD) }} (canonical form: node scripts/check-dispatcher-actor.mjs --print-expr <file>), found ${JSON.stringify(s.slice(0, 160))}`)
    return { problems: bad }
  }
  const old = s.slice(pre.length, s.length - suf.length)
  if (!old.trim()) bad.push('the wrapped condition is empty')
  if (old.includes('${{') || old.includes('}}')) bad.push('the wrapped condition contains ${{ or }}')
  if (!parensOk(old)) bad.push(`the wrapped condition has unbalanced parentheses, or closes the wrapper early (${JSON.stringify(old.slice(0, 80))})`)
  return { old, problems: bad }
}

// ─── The check ───────────────────────────────────────────────────────────────
export function check({ workflows, allow = ALLOW_FILES }) {
  const problems = [], rows = [], exempt = []
  const byName = Object.fromEntries(Object.entries(workflows).map(([f, s]) => [basename(f), s]))
  for (const a of allow) {
    if (!(a in byName)) problems.push(`allowlisted workflow ${a} is missing`)
  }
  for (const [file, src] of Object.entries(byName)) {
    const w = loadWorkflow(src)
    if (w.error || !w.doc || typeof w.doc !== 'object') { problems.push(`${file}: yaml does not parse (${w.error ?? 'empty'})`); continue }
    const doc = w.doc
    for (const p of failClosedProblems(doc)) problems.push(`${file}: ${p}`)
    const a = actorOk(file, doc)
    if (a.problems) for (const p of a.problems) problems.push(`${file}: ${p}`)
    for (const [jn, job] of Object.entries(asObj(doc.jobs))) {
      const reasons = guardedReasons(doc, job)
      if (!reasons.length) { exempt.push({ file, job: jn, why: exemptReason(doc, job) }); continue }
      rows.push({ file, job: jn, reasons })
      if (!a.expr) continue
      const s = splitIf(job.if, a.expr)
      for (const p of s.problems) problems.push(`${file}: job ${jn}: ${p}`)
      if (s.problems.length === 0 && file === 'gisekibris-feed.yml' && jn === 'weekly-heartbeat' && (s.bare || s.old.trim() !== "github.event_name == 'schedule'"))
        problems.push(`${file}: job ${jn}: must stay schedule-only: its condition must be exactly github.event_name == 'schedule'`)
      const coe = job['continue-on-error']
      if (coe !== undefined && coe !== false) problems.push(`${file}: job ${jn}: guarded job must not set job-level continue-on-error (found ${JSON.stringify(coe)}); a rule in one job never protects another`)
    }
  }
  return { problems, rows, exempt }
}

// ─── The 30-day clock (informational) ────────────────────────────────────────
// `list` newest first: [{ sha, date, pass }]. Start = the oldest passing commit NEWER than the first failing one.
export function clockStart(list) {
  if (!list.length) return { state: 'empty' }
  if (!list[0].pass) return { state: 'not-started' }
  const k = list.findIndex((c) => !c.pass)
  if (k < 0) return { state: 'started', commit: list[list.length - 1], allPass: true }
  return { state: 'started', commit: list[k - 1] }
}

// Pure. `commit` = { sha, date } (committer date); `lookup(sha)` returns an ISO merged_at string, or null/throws when
// unavailable. Start = the LATER of merged_at and the committer date (a direct admin push keeps an old committer date).
export function resolveStart(commit, lookup) {
  const commitMs = new Date(commit.date).getTime()
  let merged = null
  if (lookup) { try { merged = lookup(commit.sha) } catch { merged = null } }
  const mergedMs = merged ? new Date(merged).getTime() : NaN
  if (Number.isNaN(mergedMs)) return { start: new Date(commitMs), source: 'commit date only', note: '(push time UNCONFIRMED: commit date only, may be early)' }
  if (mergedMs > commitMs) return { start: new Date(mergedMs), source: 'PR merged_at (later than the commit date)', note: '' }
  return { start: new Date(commitMs), source: 'committer date (PR merged_at is not later)', note: '' }
}

export function ghMergedAt(sha) {
  if (!/^[0-9a-f]{40}$/.test(sha)) return null
  const out = execFileSync('gh', ['api', `repos/berkeustun95/trnc-health/commits/${sha}/pulls`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 })
  const prs = JSON.parse(out)
  const hits = prs.filter((pr) => pr.merged_at && pr.base?.ref === 'main' && pr.merge_commit_sha === sha)
  return hits.length ? hits.map((pr) => pr.merged_at).sort().pop() : null
}

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 })

function treeAt(sha) {
  const names = git('ls-tree', '--name-only', sha, `${WF_DIR}/`).split('\n').filter((n) => /\.ya?ml$/.test(n))
  return Object.fromEntries(names.map((n) => [n, git('show', `${sha}:${n}`)]))
}

function passesAt(sha) {
  try { return check({ workflows: treeAt(sha) }).problems.length === 0 } catch { return false }
}

function printClock(guardedFiles, online) {
  console.log('\n30-day clock (informational, never fails the check):')
  try {
    let shallow = 'false'
    try { shallow = git('rev-parse', '--is-shallow-repository').trim() } catch {}
    let tip
    try { tip = git('rev-parse', '--verify', 'origin/main').trim() } catch { tip = null }
    if (!tip || shallow === 'true') { console.log(`  origin/main is unavailable here (${tip ? 'shallow clone' : 'no origin/main ref'}): clock not computed`); return }
    console.log(`  origin/main SHA used: ${tip}`)
    const shas = git('rev-list', '--first-parent', tip, '--', WF_DIR).split('\n').filter(Boolean)
    const list = []
    for (const sha of shas) {
      const pass = passesAt(sha)
      list.push({ sha, pass, date: git('log', '-1', '--format=%cI', sha).trim() })
      if (!pass) break
    }
    const c = clockStart(list)
    if (c.state === 'not-started' || c.state === 'empty') console.log('  30-day clock: NOT STARTED (origin/main still has unguarded jobs)')
    else {
      const r = resolveStart(c.commit, online ? ghMergedAt : null)
      const start = r.start
      const end = new Date(start.getTime() + 30 * 86400000)
      console.log(`  clock start source: ${online ? r.source : `${r.source}; lookup not requested (offline, pass --clock-online)`}`)
      console.log(`  clock start: ${start.toISOString()}${r.note ? ` ${r.note}` : ''}  (commit ${c.commit.sha}${c.allPass ? ', the oldest commit in the list: every commit passes' : ', the commit that made main pass'})`)
      console.log(`  earliest App key / install: ${end.toISOString()}`)
    }
    const last = guardedFiles.length ? git('log', '--first-parent', '-1', '--format=%cI %H', tip, '--', ...guardedFiles.map((f) => `${WF_DIR}/${f}`)).trim() : ''
    console.log(`  last commit on origin/main touching a guarded workflow file (information only): ${last || '(none)'}`)
  } catch (e) { console.log(`  clock not computed (${String(e.message).split('\n')[0]})`) }
}

// ─── Selftest ────────────────────────────────────────────────────────────────
function selftest() {
  let bad = 0
  const t = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) bad++; console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(74)}  ${JSON.stringify(got)}${ok ? '' : `  wanted ${JSON.stringify(want)}`}`) }
  const OK = `!${DENY}`
  const mkAllowDoc = (inputs) => ({ on: { workflow_dispatch: inputs ? { inputs } : {} } })

  // Fixture workflows. `read-only` is a job with no env, no secrets and no write permission.
  const job = (extra) => ({ 'runs-on': 'u', permissions: { contents: 'read' }, environment: 'production', steps: [{ run: 'echo hi' }], ...extra })
  const wf = (name, jobs, extra) => yaml.dump({ name, on: { workflow_dispatch: {} }, permissions: { contents: 'read' }, jobs, ...extra }, { lineWidth: -1 })
  const dump = (o) => yaml.dump(o, { lineWidth: -1 })
  const goodJob = (extra) => job({ if: buildIf(OK), ...extra })
  const goodAllow = (file) => {
    const doc = { name: file, on: { schedule: [{ cron: '1 * * * *' }], workflow_dispatch: { inputs: { apply: { type: 'boolean', default: false }, limit: { type: 'string', default: '' }, mode: { type: 'choice', options: ['--dry', "--it's"], default: "--it's" }, n: { type: 'number', default: 3 } } } }, permissions: { contents: 'read' }, jobs: {} }
    const ok = actorOk(file, doc).expr
    doc.jobs.a = job({ if: buildIf(ok) })
    return { doc, ok }
  }
  const base = () => ({
    'plain.yml': wf('plain', { a: goodJob() }),
    'oli.yml': wf('oli', { test: { 'runs-on': 'u', steps: [{ run: 'echo hi' }] } }),
    ...Object.fromEntries(ALLOW_FILES.map((f) => [f, dump(goodAllow(f).doc)])),
  })
  const run = (over) => check({ workflows: Object.fromEntries(Object.entries({ ...base(), ...over }).filter(([, v]) => v !== undefined)) })
  const base0 = run({}).problems
  t('a correct set is clean (positive control)', base0, [])
  const red = (label, over, needle) => {
    const b0 = base()
    for (const [k, v] of Object.entries(over)) if (v === b0[k]) { bad++; console.log(`  ✗ red: ${label}: the break did not land (${k} is unchanged)`) }
    const r = run(over).problems
    const hit = r.find((p) => p.includes(needle))
    t(`red: ${label}`, hit ? hit.slice(0, 100) : null, hit ? hit.slice(0, 100) : `(a problem containing ${JSON.stringify(needle)})`)
  }
  const mut = (src, fn) => { const o = yaml.load(src); fn(o); return dump(o) }

  // 1. A job with no rule at all.
  red('a guarded job with no rule', { 'plain.yml': wf('plain', { a: job() }) }, 'no if (every guarded job')
  // 2. Substring-only match: ACTOR_OK appears but not in the canonical frame.
  red('substring-only match (rule inside a larger expression)', { 'plain.yml': wf('plain', { a: job({ if: `\${{ always() || ${OK} }}` }) }) }, 'not the canonical')
  red('the rule hidden after another condition', { 'plain.yml': wf('plain', { a: job({ if: `\${{ github.event_name == 'push' && ${OK} }}` }) }) }, 'not the canonical')
  // 3. The paren escape.
  red('paren escape: true) || (true', { 'plain.yml': wf('plain', { a: job({ if: buildIf(OK, 'true) || (true') }) }) }, 'closes the wrapper early')
  red('an unterminated quote in OLD', { 'plain.yml': wf('plain', { a: job({ if: buildIf(OK, "x == 'a") }) }) }, 'unbalanced parentheses')
  red('an empty OLD', { 'plain.yml': wf('plain', { a: job({ if: `\${{ ${OK} && () }}` }) }) }, 'is empty')
  red('}} inside OLD', { 'plain.yml': wf('plain', { a: job({ if: buildIf(OK, "x }} || ${{ y") }) }) }, 'contains ${{ or }}')
  t('a parenthesis inside a string literal is fine (positive control)', run({ 'plain.yml': wf('plain', { a: job({ if: buildIf(OK, "github.ref == 'a)b' && always()") }) }) }).problems, [])
  t('an escaped quote in OLD is fine (positive control)', run({ 'plain.yml': wf('plain', { a: job({ if: buildIf(OK, "github.ref == 'it''s)' ") }) }) }).problems, [])
  t('a wrapped existing condition is fine (positive control)', run({ 'plain.yml': wf('plain', { a: job({ if: buildIf(OK, "!cancelled() && needs.x.result == 'success'") }) }) }).problems, [])
  // 4. github.event.inputs in the rule.
  const dispatchExpr = goodAllow('novest-images.yml').ok
  red('github.event.inputs used in the rule', { 'novest-images.yml': mut(base()['novest-images.yml'], (o) => { o.jobs.a.if = buildIf(dispatchExpr.replace(/inputs\./g, 'github.event.inputs.')) }) }, 'github.event.inputs')
  // 5. Allowlisted workflows: bool + string/choice/number inputs, default literals.
  const g = goodAllow('novest-images.yml')
  t('canonical allowlist expr: boolean, string, choice with a quote, number', g.ok,
    `(!${DENY} || (github.event_name == 'workflow_dispatch' && github.run_attempt == '1' && github.ref == 'refs/heads/main' && inputs.apply == false && inputs.limit == '' && inputs.mode == '--it''s' && inputs.n == 3))`)
  red('allowlisted: wrong boolean default literal', { 'novest-images.yml': mut(base()['novest-images.yml'], (o) => { o.jobs.a.if = buildIf(g.ok.replace('inputs.apply == false', 'inputs.apply == true')) }) }, 'not the canonical')
  red('allowlisted: wrong string default literal', { 'novest-images.yml': mut(base()['novest-images.yml'], (o) => { o.jobs.a.if = buildIf(g.ok.replace("inputs.limit == ''", "inputs.limit == 'x'")) }) }, 'not the canonical')
  red('allowlisted: wrong choice literal (quote not doubled)', { 'novest-images.yml': mut(base()['novest-images.yml'], (o) => { o.jobs.a.if = buildIf(g.ok.replace("'--it''s'", "'--it's'")) }) }, 'not the canonical')
  red('allowlisted: a declared input left out of the rule', { 'novest-images.yml': mut(base()['novest-images.yml'], (o) => { o.jobs.a.if = buildIf(g.ok.replace(' && inputs.n == 3', '')) }) }, 'not the canonical')
  red('allowlisted: the plain !DENY form (no dispatch exemption)', { 'novest-images.yml': mut(base()['novest-images.yml'], (o) => { o.jobs.a.if = buildIf(OK) }) }, 'not the canonical')
  red('allowlisted: an input with no default', { 'novest-images.yml': mut(base()['novest-images.yml'], (o) => { delete o.on.workflow_dispatch.inputs.limit.default }) }, 'has no explicit default')
  red('allowlisted: a missing file', { 'daily-health.yml': undefined }, 'allowlisted workflow daily-health.yml is missing')
  red('allowlisted: no workflow_dispatch', { 'daily-health.yml': mut(base()['daily-health.yml'], (o) => { o.on = { schedule: [{ cron: '1 * * * *' }] } }) }, 'no workflow_dispatch')
  // 6. Non-allowlisted file with the permissive form.
  red('a non-allowlisted file using the permissive form', { 'plain.yml': wf('plain', { a: job({ if: buildIf(g.ok) }) }) }, 'not the canonical')
  // 7. Job-level continue-on-error.
  red('job-level continue-on-error: true on a guarded job', { 'plain.yml': wf('plain', { a: goodJob({ 'continue-on-error': true }) }) }, 'must not set job-level continue-on-error')
  red('job-level continue-on-error as an expression', { 'plain.yml': wf('plain', { a: goodJob({ 'continue-on-error': '${{ true }}' }) }) }, 'must not set job-level continue-on-error')
  t('continue-on-error: false is fine (positive control)', run({ 'plain.yml': wf('plain', { a: goodJob({ 'continue-on-error': false }) }) }).problems, [])
  // 8. An always() step is not a guard; the job inherits job-level secrets.
  red('only guard is an always() step; job-level secrets inherited', { 'plain.yml': wf('plain', { a: { 'runs-on': 'u', permissions: { contents: 'read' }, env: { K: '${{ secrets.K }}' }, steps: [{ if: `\${{ always() && ${OK} }}`, run: 'echo hi' }] } }) }, 'no if (every guarded job')
  // 9. The duyurular chain=true laundering case.
  const laundered = wf('plain', {
    gate: goodJob({ 'continue-on-error': true, steps: [{ run: 'echo gate' }] }),
    fetch: { 'runs-on': 'u', needs: 'gate', environment: 'production', permissions: { contents: 'read', actions: 'write' }, if: "${{ !cancelled() && needs.gate.outputs.run != 'false' }}", steps: [{ name: 'Chain the next run', run: 'echo chain' }] },
  })
  red('laundering: the gate carries the rule (with continue-on-error); the fetch job lacks it', { 'plain.yml': laundered }, 'job fetch: if is not the canonical')
  red('laundering: the gate job with continue-on-error is itself red', { 'plain.yml': laundered }, 'job gate: guarded job must not set job-level continue-on-error')
  // 10. Fail closed.
  red('a job with uses: (reusable workflow)', { 'plain.yml': wf('plain', { a: goodJob(), r: { uses: './.github/workflows/x.yml' } }) }, 'has uses:')
  red('secrets: inherit', { 'plain.yml': wf('plain', { a: goodJob(), r: { uses: './x.yml', secrets: 'inherit' } }) }, 'secrets: inherit')
  red('on: workflow_call', { 'plain.yml': wf('plain', { a: goodJob() }, { on: { workflow_call: {} } }) }, 'on: workflow_call')
  // 11. Guarded-set derivation.
  const wfSecretsDyn = wf('plain', { a: { 'runs-on': 'u', permissions: { contents: 'read' }, steps: [{ run: 'echo x', env: { K: '${{ secrets[inputs.name] }}' } }] } })
  red('secrets[x] dynamic access counts as guarded', { 'plain.yml': wfSecretsDyn }, 'no if (every guarded job')
  red('toJSON(secrets) counts as guarded', { 'plain.yml': wf('plain', { a: { 'runs-on': 'u', permissions: { contents: 'read' }, steps: [{ run: 'echo x', env: { K: '${{ toJSON(secrets) }}' } }] } }) }, 'no if (every guarded job')
  red('a workflow-level env that reads secrets guards every job', { 'plain.yml': wf('plain', { a: { 'runs-on': 'u', permissions: { contents: 'read' }, steps: [{ run: 'echo x' }] } }, { env: { K: '${{ secrets.K }}' } }) }, 'no if (every guarded job')
  red('a job with no permissions block (and none at workflow level) is guarded', { 'plain.yml': dump({ name: 'plain', on: { workflow_dispatch: {} }, jobs: { a: { 'runs-on': 'u', steps: [{ run: 'echo x' }] } } }) }, 'no if (every guarded job')
  red('a job-level write permission is guarded', { 'plain.yml': wf('plain', { a: { 'runs-on': 'u', permissions: { contents: 'write' }, steps: [{ run: 'echo x' }] } }) }, 'no if (every guarded job')
  red('a workflow-level write-all is guarded', { 'plain.yml': dump({ name: 'plain', on: { workflow_dispatch: {} }, permissions: 'write-all', jobs: { a: { 'runs-on': 'u', steps: [{ run: 'echo x' }] } } }) }, 'no if (every guarded job')
  red('an environment given as an expression is guarded', { 'plain.yml': wf('plain', { a: { 'runs-on': 'u', permissions: {}, environment: '${{ inputs.e }}', steps: [{ run: 'echo x' }] } }) }, 'no if (every guarded job')
  red('an environment given as {name:} is guarded', { 'plain.yml': wf('plain', { a: { 'runs-on': 'u', permissions: {}, environment: { name: 'production' }, steps: [{ run: 'echo x' }] } }) }, 'no if (every guarded job')
  t('a read-only job with no env and no secrets is NOT guarded (positive control)', guardedReasons({ permissions: { contents: 'read' } }, { 'runs-on': 'u', steps: [{ run: 'echo x' }] }), [])
  t('a job-level permissions {} overriding workflow write is NOT guarded by permissions', guardedReasons({ permissions: 'write-all' }, { permissions: {}, steps: [] }), [])
  t('the unguarded fixture job is listed as exempt', run({}).exempt.map((e) => `${e.file}:${e.job}`), ['oli.yml:test'])
  for (const [label, val] of [['SECRETS.K (upper case context)', '${{ SECRETS.K }}'], ["Secrets['K'] (mixed case)", "${{ Secrets['K'] }}"]]) {
    const src = wf('plain', { a: { 'runs-on': 'u', permissions: { contents: 'read' }, steps: [{ run: 'echo x', env: { K: val } }] } })
    if (!/secrets/i.test(src) || /\bsecrets\b/.test(src)) { bad++; console.log(`  ✗ red: ${label}: the break did not land`) }
    red(`${label} counts as guarded`, { 'plain.yml': src }, 'no if (every guarded job')
  }
  {
    const src = wf('plain', { a: { 'runs-on': 'u', permissions: { contents: 'WRITE' }, steps: [{ run: 'echo x' }] } })
    if (!src.includes('WRITE')) { bad++; console.log('  ✗ red: contents: WRITE: the break did not land') }
    red('contents: WRITE (upper case) is guarded', { 'plain.yml': src }, 'no if (every guarded job')
    t('permissions: Write-All is a write grant', guardedReasons({}, { permissions: 'Write-All', steps: [] }), ['write permission'])
  }
  // 12. gisekibris weekly-heartbeat stays schedule-only.
  const gk = goodAllow('gisekibris-feed.yml')
  const gkWf = (old) => mut(base()['gisekibris-feed.yml'], (o) => { o.jobs['weekly-heartbeat'] = job({ if: buildIf(gk.ok, old) }) })
  t('weekly-heartbeat with exactly the schedule condition is clean (positive control)', run({ 'gisekibris-feed.yml': gkWf("github.event_name == 'schedule'") }).problems, [])
  red('weekly-heartbeat widened beyond schedule', { 'gisekibris-feed.yml': gkWf("github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'") }, 'must stay schedule-only')
  red('weekly-heartbeat with a bare rule (no schedule condition)', { 'gisekibris-feed.yml': mut(base()['gisekibris-feed.yml'], (o) => { o.jobs['weekly-heartbeat'] = job({ if: buildIf(gk.ok) }) }) }, 'must stay schedule-only')
  // 13. Builders.
  t('buildIf with no old condition', buildIf('X'), '${{ X }}')
  t('buildIf with an old condition', buildIf('X', 'Y'), '${{ X && (Y) }}')
  t('parensOk: depth never below 0', [parensOk('a) || (b'), parensOk('(a) && (b)'), parensOk("'(' == x"), parensOk("x == ')'")], [false, true, true, true])
  // 14. The clock.
  const c = (sha, pass) => ({ sha, pass, date: `d-${sha}` })
  t('clock: fail -> pass -> pass gives the date of the FIRST pass', clockStart([c('p2', true), c('p1', true), c('F', false)]).commit.sha, 'p1')
  t('clock: a later edit that keeps every job guarded does not restart it', clockStart([c('p3', true), c('p2', true), c('p1', true), c('F', false), c('F0', false)]).commit.sha, 'p1')
  t('clock: the newest commit failing means NOT STARTED', clockStart([c('F2', false), c('p1', true)]).state, 'not-started')
  t('clock: pass, fail, pass: the older pass is irrelevant', clockStart([c('p2', true), c('F', false), c('p0', true)]).commit.sha, 'p2')
  t('clock: all commits pass starts at the oldest', clockStart([c('p2', true), c('p1', true)]).commit.sha, 'p1')

  const cd = '2026-11-01T00:00:00+00:00'
  const lk = (v) => () => v
  const a = resolveStart({ sha: 's', date: cd }, lk('2026-11-05T00:00:00Z'))
  t('clock start: merged_at later than the commit date -> merged_at', [a.start.toISOString(), a.note], ['2026-11-05T00:00:00.000Z', ''])
  const b = resolveStart({ sha: 's', date: cd }, lk(null))
  t('clock start: lookup unavailable -> commit date + UNCONFIRMED marker', [b.start.toISOString(), b.note], ['2026-11-01T00:00:00.000Z', '(push time UNCONFIRMED: commit date only, may be early)'])
  const b2 = resolveStart({ sha: 's', date: cd }, () => { throw new Error('offline') })
  t('clock start: lookup throws -> same marker, never fails', b2.note, b.note)
  const d = resolveStart({ sha: 's', date: cd }, lk('2026-10-20T00:00:00Z'))
  t('clock start: merged_at earlier -> the commit date', [d.start.toISOString(), d.note], ['2026-11-01T00:00:00.000Z', ''])
  t('clock start: no lookup injected -> marker', resolveStart({ sha: 's', date: cd }, null).note, b.note)

  console.log(bad ? `\n  ${bad} self-test failure(s).` : '\n  Self-test clean.')
  process.exit(bad ? 1 : 0)
}

// ─── CLI ─────────────────────────────────────────────────────────────────────
function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--selftest')) return selftest()
  const pe = argv.indexOf('--print-expr')
  if (pe >= 0) {
    const arg = argv[pe + 1]
    if (!arg) { console.error('✗ --print-expr needs a workflow file'); process.exit(1) }
    const path = existsSync(arg) ? arg : resolve(ROOT, WF_DIR, basename(arg))
    const w = loadWorkflow(readFileSync(path, 'utf8'))
    if (w.error) { console.error(`✗ ${arg}: yaml does not parse (${w.error})`); process.exit(1) }
    const a = actorOk(basename(path), w.doc)
    if (a.problems) { for (const p of a.problems) console.error(`✗ ${p}`); process.exit(1) }
    console.log(a.expr)
    return
  }
  const dir = resolve(ROOT, WF_DIR)
  const workflows = Object.fromEntries(readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort().map((f) => [f, readFileSync(resolve(dir, f), 'utf8')]))
  const { problems, rows, exempt } = check({ workflows })
  const files = [...new Set(rows.map((r) => r.file))]
  console.log(`Guarded jobs (${rows.length} jobs in ${files.length} of ${Object.keys(workflows).length} workflows):`)
  for (const f of files) {
    console.log(`  ${f}${ALLOW_FILES.includes(f) ? '  [dispatcher allowlist]' : ''}`)
    for (const r of rows.filter((x) => x.file === f)) console.log(`      job ${r.job}: ${r.reasons.join(', ')}`)
  }
  console.log(`\nNot guarded (${exempt.length}):`)
  for (const e of exempt) console.log(`  ${e.file} job ${e.job}: exempt, ${e.why}`)
  printClock(files, argv.includes('--clock-online'))
  if (problems.length) {
    console.error(`\n✗ ${problems.length} problem(s):`)
    for (const p of problems) console.error(`  ✗ ${p}`)
    process.exit(1)
  }
  console.log(`\n✓ every guarded job (${rows.length} in ${files.length} workflows) carries the canonical actor rule.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
