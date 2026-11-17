#!/usr/bin/env node
// ─── The pause switch, read by a workflow's first job: public.data_job_gate ──
//
// Data jobs, slice 3 (RPC: data_jobs_switches migration, service_role only). Three feeds can be paused from the app:
// gisekibris-feed, duyurular-fetch, novest-images. Each has a `gate` job that runs this and writes
// `run=true|false` to GITHUB_OUTPUT; the working job runs unless that output is exactly `false`.
//
//   node scripts/data-job-gate.mjs                  (no arguments, in Actions only)
//   node scripts/data-job-gate.mjs --selftest       (offline: no network, no key)
//
//   * FAIL-OPEN. A broken brake must never stop a feed. Any error (no key, network, 404 / PGRST202 because the RPC
//     is not applied yet, an unexpected body) writes run=true and prints ONE ::warning:: from a fixed vocabulary.
//     Only the exact answer "paused" writes run=false.
//   * Which runs are gated: `schedule`, and duyurular-fetch dispatched with chain=true (GATE_CHAIN=true, set by the
//     workflow from its own input). A hand dispatch is NOT gated and does not call the RPC at all: the RPC is the only
//     probe, and a paused answer records one skipped_paused row, which would be a lie for a run that goes ahead.
//     The cost: no "paused, running anyway" warning on a hand dispatch. A dry dispatch never reads the key either
//     (the workflow does not hand it over, and this script does not look at it).
//   * Runs only in Actions, on refs/heads/main, job key from GITHUB_WORKFLOW (allowlist of three). In Actions it
//     always exits 0; exit 1 only for a local refusal or a failing --selftest.
//   * Never echoes a response body; no retry (a retry of the call that records skipped_paused is pointless
//     and the next scheduled run asks again).
//
// prodWriteGuard() is called first although it returns at once in CI: the RPC inserts a skipped_paused row, so
// check-prod-write-guard.mjs classifies this file as a production writer and requires it.
// Keep the words that start a network call or a key read out of everything above main()'s guard.

import { prodWriteGuard } from './lib/prod-write-guard.mjs'
import { reasonHttp, reasonNetwork, cleanUrl, validRunId } from './record-data-job-run.mjs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const GATE_JOBS = Object.freeze(['gisekibris-feed', 'duyurular-fetch', 'novest-images'])
export const RPC_PATH = '/rest/v1/rpc/data_job_gate'
// The one job whose chain runs (workflow_dispatch with chain=true) are gated.
export const CHAIN_JOB = 'duyurular-fetch'

export const REFUSAL_CODES = Object.freeze(['not_actions', 'ref_not_main', 'event', 'job_not_allowed', 'run_id', 'bad_args'])

// ─── Pure decision logic ─────────────────────────────────────────────────────

export function decideGate(env) {
  if (env.GITHUB_ACTIONS !== 'true') return { action: 'refuse', code: 'not_actions' }
  if (env.GITHUB_REF !== 'refs/heads/main') return { action: 'refuse', code: 'ref_not_main' }
  const job = GATE_JOBS.includes(env.GITHUB_WORKFLOW) ? env.GITHUB_WORKFLOW : null
  if (!job) return { action: 'refuse', code: 'job_not_allowed' }
  if (!validRunId(env.GITHUB_RUN_ID)) return { action: 'refuse', code: 'run_id' }
  const ev = env.GITHUB_EVENT_NAME
  if (ev === 'schedule') return { action: 'consult', job, runRef: env.GITHUB_RUN_ID }
  if (ev === 'workflow_dispatch') {
    if (job === CHAIN_JOB && env.GATE_CHAIN === 'true') return { action: 'consult', job, runRef: env.GITHUB_RUN_ID }
    return { action: 'hand' }
  }
  return { action: 'refuse', code: 'event' }
}

export const parseArgs = (argv) => (argv.length === 0 ? { ok: true, selftest: false } : argv.length === 1 && argv[0] === '--selftest' ? { ok: true, selftest: true } : { ok: false })

// The body of a `RETURNS text` RPC is a JSON string. Only the exact word "paused" pauses; "run" runs quietly;
// anything else is an unexpected answer (run, one warning).
export function interpret(text) {
  let v
  try { v = JSON.parse(text) } catch { return { run: true, warn: 'unexpected response' } }
  if (v === 'paused') return { run: false, warn: null }
  if (v === 'run') return { run: true, warn: null }
  return { run: true, warn: 'unexpected response' }
}

export const rpcBody = (d) => ({ p_job: d.job, p_source: 'github', p_run_ref: d.runRef })

// What to print and write for a finished decision. `warn` is always one of the fixed words above.
export function outcome({ run, warn, job, note }) {
  const lines = []
  if (warn) lines.push(`::warning::data_job_gate: not consulted, running (${warn})`)
  if (note) lines.push(note)
  if (run === false) lines.push(`::notice::data_job_gate: ${job} is paused, the run is skipped`)
  return { output: `run=${run ? 'true' : 'false'}\n`, lines }
}

// ─── Runtime ─────────────────────────────────────────────────────────────────

function finish(res) {
  const o = outcome(res)
  for (const l of o.lines) console.log(l)
  try { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, o.output) } catch { /* the step still exits 0; the job then reads an empty output = run */ }
  process.exit(0)
}

async function main() {
  const selftestOnly = process.argv.length === 3 && process.argv[2] === '--selftest'
  if (!selftestOnly && process.env.GITHUB_ACTIONS !== 'true') {
    console.error('data-job-gate: REFUSED: the pause switch is read only by the workflows themselves (nothing is read from this machine).\n  Offline check:  node scripts/data-job-gate.mjs --selftest')
    process.exit(1)
  }
  prodWriteGuard({ wouldWrite: !selftestOnly, dryHint: 'node scripts/data-job-gate.mjs --selftest' })

  const args = parseArgs(process.argv.slice(2))
  if (args.selftest) process.exit(runSelftest())
  const bad = (warn) => finish({ run: true, warn })
  if (!args.ok) bad('refused: bad_args')

  try {
    const d = decideGate(process.env)
    if (d.action === 'refuse') bad(`refused: ${REFUSAL_CODES.includes(d.code) ? d.code : 'bad_args'}`)
    if (d.action === 'hand') finish({ run: true, warn: null, note: 'data_job_gate: dispatched by hand, the pause switch is not consulted' })

    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
    if (!key) bad('service key missing')
    const base = cleanUrl(process.env.EXPO_PUBLIC_SUPABASE_URL)
    if (!base) bad('project url missing or not https://<ref>.supabase.co')

    let res
    try {
      res = await fetch(base + RPC_PATH, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(rpcBody(d)),
      })
    } catch (e) {
      bad(reasonNetwork(e))
    }
    const text = await res.text().catch(() => '')
    if (!res.ok) {
      const notInstalled = res.status === 404 && /^HTTP 404 code PGRST202$/.test(reasonHttp(res.status, text))
      bad(notInstalled ? 'switch not installed yet' : reasonHttp(res.status, text))
    }
    const a = interpret(text)
    finish({ run: a.run, warn: a.warn, job: d.job })
  } catch (e) {
    bad('error unexpected')
  }
}

// ─── Self-test (offline) ─────────────────────────────────────────────────────

export function runSelftest() {
  let bad = 0
  const t = (label, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want), ok = g === w
    if (!ok) bad++
    console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(66)}  ${g}${ok ? '' : `  wanted ${w}`}`)
  }
  const CI = { GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'schedule', GITHUB_WORKFLOW: 'novest-images', GITHUB_RUN_ID: '123456' }
  const dec = (over) => { const d = decideGate({ ...CI, ...over }); return d.action === 'refuse' ? 'refuse ' + d.code : d.action }

  t('allowlist: exactly the three', [...GATE_JOBS].sort(), ['duyurular-fetch', 'gisekibris-feed', 'novest-images'])
  t('schedule is consulted', dec({}), 'consult')
  t('schedule is consulted: gisekibris-feed', dec({ GITHUB_WORKFLOW: 'gisekibris-feed' }), 'consult')
  t('dispatch without chain is a hand run (no RPC)', dec({ GITHUB_EVENT_NAME: 'workflow_dispatch' }), 'hand')
  t('dispatch: GATE_CHAIN=true does not gate novest-images', dec({ GITHUB_EVENT_NAME: 'workflow_dispatch', GATE_CHAIN: 'true' }), 'hand')
  t('dispatch: duyurular-fetch without chain is a hand run', dec({ GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_WORKFLOW: 'duyurular-fetch' }), 'hand')
  t('dispatch: duyurular-fetch + chain=true is consulted', dec({ GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_WORKFLOW: 'duyurular-fetch', GATE_CHAIN: 'true' }), 'consult')
  t('dispatch: duyurular-fetch + chain=TRUE is a hand run', dec({ GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_WORKFLOW: 'duyurular-fetch', GATE_CHAIN: 'TRUE' }), 'hand')
  t('schedule ignores GATE_CHAIN=false (still consulted)', dec({ GATE_CHAIN: 'false' }), 'consult')
  t('refuse: not in Actions', dec({ GITHUB_ACTIONS: undefined }), 'refuse not_actions')
  t('refuse: a feature branch', dec({ GITHUB_REF: 'refs/heads/feat/x' }), 'refuse ref_not_main')
  t('refuse: a tag named main', dec({ GITHUB_REF: 'refs/tags/main' }), 'refuse ref_not_main')
  t('refuse: another workflow', dec({ GITHUB_WORKFLOW: 'daily-health' }), 'refuse job_not_allowed')
  t('refuse: a case change', dec({ GITHUB_WORKFLOW: 'Novest-Images' }), 'refuse job_not_allowed')
  t('refuse: event push', dec({ GITHUB_EVENT_NAME: 'push' }), 'refuse event')
  t('refuse: run id with letters', dec({ GITHUB_RUN_ID: '12a' }), 'refuse run_id')
  t('refuse: empty run id', dec({ GITHUB_RUN_ID: '' }), 'refuse run_id')
  t('body: source github, run ref, nothing else', rpcBody({ job: 'novest-images', runRef: '9' }), { p_job: 'novest-images', p_source: 'github', p_run_ref: '9' })
  t('args: none', parseArgs([]).ok, true)
  t('args: --selftest alone', parseArgs(['--selftest']).selftest, true)
  t('args: --selftest with another refused', parseArgs(['--selftest', '--x']).ok, false)
  t('args: any extra argument refused', parseArgs(['--run=true']).ok, false)
  t('args: a bare word refused', parseArgs(['x']).ok, false)

  t('answer: "paused" pauses', interpret('"paused"'), { run: false, warn: null })
  t('answer: "run" runs quietly', interpret('"run"'), { run: true, warn: null })
  t('answer: "Paused" (case) runs + warns', interpret('"Paused"'), { run: true, warn: 'unexpected response' })
  t('answer: paused without quotes runs + warns', interpret('paused'), { run: true, warn: 'unexpected response' })
  t('answer: " paused" (space) runs + warns', interpret('" paused"'), { run: true, warn: 'unexpected response' })
  t('answer: ["paused"] runs + warns', interpret('["paused"]'), { run: true, warn: 'unexpected response' })
  t('answer: {"paused":true} runs + warns', interpret('{"paused":true}'), { run: true, warn: 'unexpected response' })
  t('answer: true runs + warns', interpret('true'), { run: true, warn: 'unexpected response' })
  t('answer: null runs + warns', interpret('null'), { run: true, warn: 'unexpected response' })
  t('answer: empty runs + warns', interpret(''), { run: true, warn: 'unexpected response' })
  t('outcome: paused writes run=false + one notice', outcome({ run: false, job: 'novest-images' }), { output: 'run=false\n', lines: ['::notice::data_job_gate: novest-images is paused, the run is skipped'] })
  t('outcome: a warning writes run=true', outcome({ run: true, warn: 'switch not installed yet' }), { output: 'run=true\n', lines: ['::warning::data_job_gate: not consulted, running (switch not installed yet)'] })

  // End to end as a runner would: GITHUB_OUTPUT is a temp file, fetch is replaced, nothing leaves the process.
  const self = fileURLToPath(import.meta.url)
  const dir = mkdtempSync(join(tmpdir(), 'gate-'))
  const trip = 'data:text/javascript,globalThis.fetch=()=>{console.error("NETWORK");process.exit(9)}'
  const stubFor = (body, status) => `data:text/javascript,globalThis.fetch=async()=>new Response(${JSON.stringify(JSON.stringify(body))},{status:${status}})`
  const stubThrow = (name, code) => `data:text/javascript,globalThis.fetch=async()=>{const e=new Error("secret");e.name="${name}";e.cause={code:"${code}"};throw e}`
  const KEYENV = { SUPABASE_SERVICE_ROLE_KEY: 'dummy-key', EXPO_PUBLIC_SUPABASE_URL: 'https://abcdefgh.supabase.co' }
  let n = 0
  const runner = (label, stub, envOver, argv, want) => {
    const out = join(dir, `out${n++}`)
    const env = { PATH: process.env.PATH, ...CI, GITHUB_OUTPUT: out, ...envOver }
    for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k]
    const r = spawnSync(process.execPath, ['--import', stub, self, ...argv], { env, encoding: 'utf8' })
    let o = ''
    try { o = readFileSync(out, 'utf8') } catch { /* nothing written */ }
    const lines = r.stdout.split('\n').filter(Boolean)
    t(`runner: ${label}`, [r.status, o, lines, r.stderr], want)
  }
  const W = (line) => [0, 'run=true\n', [`::warning::data_job_gate: not consulted, running (${line})`], '']
  runner('paused', stubFor('paused', 200), KEYENV, [], [0, 'run=false\n', ['::notice::data_job_gate: novest-images is paused, the run is skipped'], ''])
  runner('run', stubFor('run', 200), KEYENV, [], [0, 'run=true\n', [], ''])
  runner('RPC not applied (404 PGRST202) -> run, one warning', stubFor({ code: 'PGRST202', message: 'hostile' }, 404), KEYENV, [], W('switch not installed yet'))
  runner('404 with another code -> HTTP only', stubFor({ code: 'hostile-token_1' }, 404), KEYENV, [], W('HTTP 404'))
  runner('UNKNOWN_JOB (400 P0001) -> run, one warning', stubFor({ code: 'P0001', message: 'UNKNOWN_JOB hostile' }, 400), KEYENV, [], W('HTTP 400 code P0001'))
  runner('403 -> run, status only', stubFor({ code: 'hostile-token_1', message: 'hostile-token_1' }, 403), KEYENV, [], W('HTTP 403'))
  runner('500 html body -> run', stubFor('<html>hostile</html>', 500), KEYENV, [], W('HTTP 500'))
  runner('200 with an object -> run + unexpected', stubFor({ paused: true }, 200), KEYENV, [], W('unexpected response'))
  runner('200 with "PAUSED" -> run + unexpected', stubFor('PAUSED', 200), KEYENV, [], W('unexpected response'))
  runner('network error, hostile name and code not echoed', stubThrow('hostile-name', 'hostile-code'), KEYENV, [], W('network unknown'))
  runner('network ENOTFOUND', stubThrow('TypeError', 'ENOTFOUND'), KEYENV, [], W('network TypeError ENOTFOUND'))
  runner('no service key -> run, no network', trip, { EXPO_PUBLIC_SUPABASE_URL: 'https://abcdefgh.supabase.co' }, [], W('service key missing'))
  runner('bad project url -> run, no network', trip, { SUPABASE_SERVICE_ROLE_KEY: 'k', EXPO_PUBLIC_SUPABASE_URL: 'https://evil.example' }, [], W('project url missing or not https://<ref>.supabase.co'))
  runner('hand dispatch never reads the key or the network', trip, { ...KEYENV, GITHUB_EVENT_NAME: 'workflow_dispatch' }, [], [0, 'run=true\n', ['data_job_gate: dispatched by hand, the pause switch is not consulted'], ''])
  runner('dispatch with chain=true on novest-images is a hand run', trip, { ...KEYENV, GITHUB_EVENT_NAME: 'workflow_dispatch', GATE_CHAIN: 'true' }, [], [0, 'run=true\n', ['data_job_gate: dispatched by hand, the pause switch is not consulted'], ''])
  runner('chain dispatch of duyurular-fetch is consulted', stubFor('paused', 200), { ...KEYENV, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_WORKFLOW: 'duyurular-fetch', GATE_CHAIN: 'true' }, [], [0, 'run=false\n', ['::notice::data_job_gate: duyurular-fetch is paused, the run is skipped'], ''])
  runner('wrong ref -> run, no network', trip, { ...KEYENV, GITHUB_REF: 'refs/heads/CANARY' }, [], W('refused: ref_not_main'))
  runner('workflow not allowed -> run, no network', trip, { ...KEYENV, GITHUB_WORKFLOW: 'CANARY' }, [], W('refused: job_not_allowed'))
  runner('event push -> run, no network', trip, { ...KEYENV, GITHUB_EVENT_NAME: 'push' }, [], W('refused: event'))
  runner('bad run id -> run, no network', trip, { ...KEYENV, GITHUB_RUN_ID: 'CANARY' }, [], W('refused: run_id'))
  runner('an argument -> run, no network', trip, KEYENV, ['--CANARY=1'], W('refused: bad_args'))
  {
    const r = spawnSync(process.execPath, [self], { env: { PATH: process.env.PATH }, encoding: 'utf8' })
    t('local run (not Actions) is refused, exit 1, nothing read', [r.status, r.stdout, r.stderr.startsWith('data-job-gate: REFUSED')], [1, '', true])
  }
  rmSync(dir, { recursive: true, force: true })

  console.log(bad ? `\n  ${bad} self-test failure(s).` : '\n  Self-test clean.')
  return bad ? 1 : 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
