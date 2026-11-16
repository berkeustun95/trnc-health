#!/usr/bin/env node
// ─── Record one finished scheduled run in production: public.data_job_runs ───
//
// Data jobs, slice 2 (RPC: 20261205_data_jobs.sql, record_data_job_run, service_role only).
// Each of the six scheduled workflows calls this as its LAST step and writes one "heartbeat" row:
// job key, ok | failed, an error CLASS from a fixed vocabulary, the GitHub run id. No message,
// no user data. It prints the new row's id (a run sequence number), no other count.
//
//   node scripts/record-data-job-run.mjs --status=<job.status | needs.<job>.result> --real-run=true|false
//   node scripts/record-data-job-run.mjs --selftest        (offline: no network, no key)
//
// Everything below is enforced HERE, because prodWriteGuard() returns at once in CI:
//   * the job key comes from GITHUB_WORKFLOW and must be one of the six (there is no --job);
//   * runs only in Actions, on refs/heads/main, for `schedule`, or `workflow_dispatch` with a real run;
//   * "not a real run" (a dry dispatch) exits 0 silently BEFORE the key is read (duyurular-fetch blanks it);
//   * the only outcome input is the raw GitHub status; error_class is never caller text;
//   * recording must NEVER change the job's status (it runs after the alert steps). Exit codes:
//       in Actions: always 0 - a failed record or a REFUSAL is exactly one ::warning:: line whose reason comes
//         from a FIXED vocabulary (reasonNetwork / reasonHttp below; `refused: ref_not_main`), never text from a
//         response, an error message or the environment; nothing is read or sent on a refusal;
//       exit 1 only for the local prodWriteGuard refusal (not in CI) and a failing --selftest.
//   * no retry: a lost response followed by a retry would insert the run twice.
//   * p_started_at is omitted: the RPC defaults it to now(), so started_at ~= finished_at (a heartbeat,
//     not a duration).
//
// The decision logic is pure and exported (decide, mapStatus, parseArgs, ...) for the self-test and jest.
// Keep the words that start a network call or a key read out of everything above main()'s guard.

import { prodWriteGuard } from './lib/prod-write-guard.mjs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

export const JOBS = Object.freeze([
  'gisekibris-feed', 'duyurular-fetch', 'novest-images',
  'araclar-photo-cleanup', 'daily-health', 'duyurular-paused-recheck',
])
// true = a routine cancel would flap the log, so `cancelled` records nothing. Read from the six
// concurrency blocks on 2026-11-16: none sets cancel-in-progress: true (check-data-job-heartbeats.mjs
// re-checks that on every push and goes red if one ever does).
export const CANCEL_IN_PROGRESS_ANY = false
export const RPC_PATH = '/rest/v1/rpc/record_data_job_run'

async function main() {
  const selftestOnly = process.argv.length === 3 && process.argv[2] === '--selftest'
  if (!selftestOnly && process.env.GITHUB_ACTIONS !== 'true') {
    console.error('record-data-job-run: REFUSED: a run is recorded only by the scheduled workflows themselves (a dispatch records nothing, and nothing is written from this machine).\n  Offline check:  node scripts/record-data-job-run.mjs --selftest')
    process.exit(1)
  }
  prodWriteGuard({ wouldWrite: !selftestOnly, dryHint: 'node scripts/record-data-job-run.mjs --selftest' })

  const args = parseArgs(process.argv.slice(2))
  if (!args.ok) refuse('bad_args')
  if (args.selftest) process.exit(runSelftest())

  const d = decide({ env: process.env, args })
  if (d.action === 'refuse') refuse(d.code)
  if (d.action === 'skip') process.exit(0)

  const give = (why) => { console.log(`::warning::data_job_runs: run not recorded (${why})`); process.exit(0) }
  try {
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
    if (!key) give('service key missing')
    const base = cleanUrl(process.env.EXPO_PUBLIC_SUPABASE_URL)
    if (!base) give('project url missing or not https://<ref>.supabase.co')

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
      give(reasonNetwork(e))
    }
    const text = await res.text().catch(() => '')
    if (!res.ok) {
      give(reasonHttp(res.status, text))
    }
    const id = text.trim()
    if (!/^[0-9]{1,20}$/.test(id)) give(`HTTP ${res.status}, unexpected response`)
    console.log(`data_job_runs: ${d.job} ${d.outcome} row ${id}`)
  } catch (e) {
    give('error unexpected')
  }
}

function refuse(code) {
  const r = refusalOutcome(code, process.env)
  console[r.stream](r.line)
  process.exit(r.exit)
}

// The fixed vocabulary of refusal reasons. Only these words are ever printed.
export const REFUSAL_CODES = Object.freeze(['not_actions', 'ref_not_main', 'event', 'job_not_allowed', 'run_id', 'bad_args'])

// In Actions a refusal is a warning and exit 0 (never a red job); locally it is loud, exit 1.
export function refusalOutcome(code, env) {
  const c = REFUSAL_CODES.includes(code) ? code : 'bad_args'
  if (env.GITHUB_ACTIONS === 'true') return { exit: 0, stream: 'log', line: `::warning::data_job_runs: run not recorded (refused: ${c})` }
  return { exit: 1, stream: 'error', line: `record-data-job-run: REFUSED: ${c}` }
}

// ─── Pure decision logic ─────────────────────────────────────────────────────

// Warning reasons come from a FIXED vocabulary: nothing a server, an exception or the environment says is echoed
// unless it matches a closed shape below.
export const ERROR_NAMES = Object.freeze(['TimeoutError', 'AbortError', 'TypeError'])
export const NET_CODES = Object.freeze([
  'ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
  'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
])
// PostgREST (PGRST123) or a 5-character SQLSTATE; anything else is dropped.
export const BODY_CODE = /^(PGRST[0-9]{3}|[0-9A-Z]{5})$/

export function reasonNetwork(e) {
  const name = ERROR_NAMES.includes(e?.name) ? e.name : 'unknown'
  const code = NET_CODES.includes(e?.cause?.code) ? ' ' + e.cause.code : ''
  return `network ${name}${code}`
}

export function reasonHttp(status, text) {
  const st = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0
  let code = ''
  try { const c = JSON.parse(text)?.code; if (typeof c === 'string' && BODY_CODE.test(c)) code = c } catch { /* not JSON */ }
  return `HTTP ${st || 'unknown'}${code ? ' code ' + code : ''}`
}

export function parseArgs(argv) {
  const out = { ok: true, selftest: false, status: undefined, realRun: undefined }
  for (const a of argv) {
    if (a === '--selftest') { if (out.selftest) return bad('--selftest twice'); out.selftest = true; continue }
    const m = /^--(status|real-run)=(.*)$/s.exec(a)
    if (!m) return bad('unknown argument')
    if (m[1] === 'status') {
      if (out.status !== undefined) return bad('--status twice')
      out.status = m[2]
    } else {
      if (out.realRun !== undefined) return bad('--real-run twice')
      if (m[2] !== 'true' && m[2] !== 'false') return bad('--real-run must be true or false')
      out.realRun = m[2] === 'true'
    }
  }
  if (out.selftest) return out.status === undefined && out.realRun === undefined ? out : bad('--selftest takes no other argument')
  if (out.status === undefined) return bad('--status is required')
  if (out.realRun === undefined) return bad('--real-run is required')
  return out
  function bad(why) { return { ok: false, why } }
}

export const jobFromWorkflow = (name) => (JOBS.includes(name) ? name : null)
export const validRunId = (v) => typeof v === 'string' && /^[0-9]{1,20}$/.test(v)

// Raw GitHub status -> what is recorded. Never accepts a caller-supplied class or outcome.
export function mapStatus(raw, cancelInProgressAny = CANCEL_IN_PROGRESS_ANY) {
  if (raw === 'success') return { record: true, outcome: 'ok', errorClass: null }
  if (raw === 'failure') return { record: true, outcome: 'failed', errorClass: 'job_failure' }
  if (raw === 'cancelled') {
    if (cancelInProgressAny) return { record: false }
    return { record: true, outcome: 'failed', errorClass: 'cancelled' }
  }
  return { record: true, outcome: 'failed', errorClass: 'unknown_status' }
}

export function decide({ env, args }) {
  if (env.GITHUB_ACTIONS !== 'true') return { action: 'refuse', code: 'not_actions' }
  if (env.GITHUB_REF !== 'refs/heads/main') return { action: 'refuse', code: 'ref_not_main' }
  const ev = env.GITHUB_EVENT_NAME
  if (ev !== 'schedule' && ev !== 'workflow_dispatch') return { action: 'refuse', code: 'event' }
  const job = jobFromWorkflow(env.GITHUB_WORKFLOW)
  if (!job) return { action: 'refuse', code: 'job_not_allowed' }
  if (!validRunId(env.GITHUB_RUN_ID)) return { action: 'refuse', code: 'run_id' }
  if (args.realRun !== true) return { action: 'skip' }
  const m = mapStatus(args.status)
  if (!m.record) return { action: 'skip' }
  return { action: 'record', job, outcome: m.outcome, errorClass: m.errorClass, runRef: env.GITHUB_RUN_ID }
}

export const rpcBody = (d) => ({
  p_job: d.job, p_outcome: d.outcome, p_error_class: d.errorClass, p_run_ref: d.runRef, p_source: 'github',
})

// The project url exactly as the workflows hold it (EXPO_PUBLIC_SUPABASE_URL); one trailing slash is tolerated.
export function cleanUrl(v) {
  const u = typeof v === 'string' ? v.trim().replace(/\/$/, '') : ''
  return /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(u) ? u : null
}

// ─── Self-test (offline) ─────────────────────────────────────────────────────

export function runSelftest() {
  let bad = 0
  const t = (label, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want), ok = g === w
    if (!ok) bad++
    console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(62)}  ${g}${ok ? '' : `  wanted ${w}`}`)
  }
  const CI = { GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'schedule', GITHUB_WORKFLOW: 'daily-health', GITHUB_RUN_ID: '123456' }
  const A = (status, realRun = true) => ({ status, realRun })
  const act = (env, args) => decide({ env: { ...CI, ...env }, args }).action
  const rec = (env, args) => { const d = decide({ env: { ...CI, ...env }, args }); return d.action === 'record' ? [d.job, d.outcome, d.errorClass, d.runRef] : d.action }

  t('mapping: success -> ok', mapStatus('success'), { record: true, outcome: 'ok', errorClass: null })
  t('mapping: failure -> failed/job_failure', mapStatus('failure'), { record: true, outcome: 'failed', errorClass: 'job_failure' })
  t('mapping: skipped -> failed/unknown_status', mapStatus('skipped'), { record: true, outcome: 'failed', errorClass: 'unknown_status' })
  t('mapping: empty -> failed/unknown_status', mapStatus(''), { record: true, outcome: 'failed', errorClass: 'unknown_status' })
  t('mapping: unknown word -> failed/unknown_status', mapStatus('banana'), { record: true, outcome: 'failed', errorClass: 'unknown_status' })
  t('mapping: skipped_paused is not accepted', mapStatus('skipped_paused').outcome, 'failed')
  t('mapping: cancelled -> failed/cancelled (no cancel-in-progress)', mapStatus('cancelled', false), { record: true, outcome: 'failed', errorClass: 'cancelled' })
  t('mapping: cancelled records nothing when cancel-in-progress', mapStatus('cancelled', true), { record: false })
  t('rule applied today: CANCEL_IN_PROGRESS_ANY', CANCEL_IN_PROGRESS_ANY, false)

  t('allowlist: exactly the six', [...JOBS].sort(), ['araclar-photo-cleanup', 'daily-health', 'duyurular-fetch', 'duyurular-paused-recheck', 'gisekibris-feed', 'novest-images'])
  t('allowlist: a seventh workflow is refused', act({ GITHUB_WORKFLOW: 'supabase-migrate' }, A('success')), 'refuse')
  t('allowlist: a case change is refused', act({ GITHUB_WORKFLOW: 'Daily-Health' }, A('success')), 'refuse')
  t('allowlist: no workflow name is refused', act({ GITHUB_WORKFLOW: '' }, A('success')), 'refuse')

  t('record: schedule + success', rec({}, A('success')), ['daily-health', 'ok', null, '123456'])
  t('record: dispatch + real run + failure', rec({ GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_WORKFLOW: 'novest-images' }, A('failure')), ['novest-images', 'failed', 'job_failure', '123456'])
  t('body: source is hardcoded github, no started_at', rpcBody({ job: 'daily-health', outcome: 'ok', errorClass: null, runRef: '1' }), { p_job: 'daily-health', p_outcome: 'ok', p_error_class: null, p_run_ref: '1', p_source: 'github' })

  t('refuse: not in Actions', act({ GITHUB_ACTIONS: undefined }, A('success')), 'refuse')
  t('refuse: GITHUB_ACTIONS=1 is not true', act({ GITHUB_ACTIONS: '1' }, A('success')), 'refuse')
  t('refuse: a feature branch', act({ GITHUB_REF: 'refs/heads/feat/x' }, A('success')), 'refuse')
  t('refuse: a tag', act({ GITHUB_REF: 'refs/tags/main' }, A('success')), 'refuse')
  t('refuse: event push', act({ GITHUB_EVENT_NAME: 'push' }, A('success')), 'refuse')
  t('refuse: event workflow_run', act({ GITHUB_EVENT_NAME: 'workflow_run' }, A('success')), 'refuse')
  t('refuse: run id with letters', act({ GITHUB_RUN_ID: '12a' }, A('success')), 'refuse')
  t('refuse: run id 21 digits', act({ GITHUB_RUN_ID: '1'.repeat(21) }, A('success')), 'refuse')
  t('refuse: run id empty', act({ GITHUB_RUN_ID: '' }, A('success')), 'refuse')
  t('accept: run id 20 digits', act({ GITHUB_RUN_ID: '1'.repeat(20) }, A('success')), 'record')

  t('not a real run: dispatch + real-run=false -> skip', act({ GITHUB_EVENT_NAME: 'workflow_dispatch' }, A('success', false)), 'skip')
  t('not a real run: schedule + real-run=false -> skip', act({}, A('success', false)), 'skip')
  t('not a real run: skip even on a failed status', act({ GITHUB_EVENT_NAME: 'workflow_dispatch' }, A('failure', false)), 'skip')
  t('cancelled with cancel-in-progress records nothing (pure path)', mapStatus('cancelled', true).record, false)

  t('args: the two flags', parseArgs(['--status=success', '--real-run=true']), { ok: true, selftest: false, status: 'success', realRun: true })
  t('args: empty status value is allowed (maps to failed)', parseArgs(['--status=', '--real-run=false']).status, '')
  t('args: unknown flag refused', parseArgs(['--status=success', '--real-run=true', '--job=x']).ok, false)
  t('args: --job is not a flag', parseArgs(['--job=daily-health', '--status=success', '--real-run=true']).ok, false)
  t('args: bare word refused', parseArgs(['--status=success', '--real-run=true', 'x']).ok, false)
  t('args: --real-run=yes refused', parseArgs(['--status=success', '--real-run=yes']).ok, false)
  t('args: --real-run=TRUE refused', parseArgs(['--status=success', '--real-run=TRUE']).ok, false)
  t('args: status missing refused', parseArgs(['--real-run=true']).ok, false)
  t('args: real-run missing refused', parseArgs(['--status=success']).ok, false)
  t('args: duplicate --status refused', parseArgs(['--status=success', '--status=failure', '--real-run=true']).ok, false)
  t('args: duplicate --real-run refused', parseArgs(['--status=success', '--real-run=true', '--real-run=false']).ok, false)
  t('args: --selftest alone', parseArgs(['--selftest']).selftest, true)
  t('args: --selftest with --status refused', parseArgs(['--selftest', '--status=success']).ok, false)
  t('args: --selftest with --real-run refused', parseArgs(['--selftest', '--real-run=true']).ok, false)
  t('args: --self (a near miss) refused', parseArgs(['--self']).ok, false)
  t('args: none refused', parseArgs([]).ok, false)

  t('url: a project url', cleanUrl('https://abcdefgh.supabase.co'), 'https://abcdefgh.supabase.co')
  t('url: one trailing slash tolerated', cleanUrl('https://abcdefgh.supabase.co/'), 'https://abcdefgh.supabase.co')
  t('url: http refused', cleanUrl('http://abcdefgh.supabase.co'), null)
  t('url: another host refused', cleanUrl('https://abcdefgh.supabase.co.evil.example'), null)
  t('url: a path refused', cleanUrl('https://abcdefgh.supabase.co/rest/v1'), null)
  t('url: userinfo refused', cleanUrl('https://a@abcdefgh.supabase.co'), null)
  t('url: empty refused', cleanUrl(''), null)
  t('url: undefined refused', cleanUrl(undefined), null)

  t('refusal codes: the fixed vocabulary', [...REFUSAL_CODES], ['not_actions', 'ref_not_main', 'event', 'job_not_allowed', 'run_id', 'bad_args'])
  const dec = (env, args) => { const d = decide({ env: { ...CI, ...env }, args }); return d.action === 'refuse' ? d.code : d.action }
  t('decision: wrong ref -> refuse ref_not_main', dec({ GITHUB_REF: 'refs/heads/x' }, A('success')), 'ref_not_main')
  t('decision: wrong event -> refuse event', dec({ GITHUB_EVENT_NAME: 'push' }, A('success')), 'event')
  t('decision: unknown workflow -> refuse job_not_allowed', dec({ GITHUB_WORKFLOW: 'x' }, A('success')), 'job_not_allowed')
  t('decision: bad run id -> refuse run_id', dec({ GITHUB_RUN_ID: 'x' }, A('success')), 'run_id')
  t('decision: not in Actions -> refuse not_actions', dec({ GITHUB_ACTIONS: undefined }, A('success')), 'not_actions')
  t('outcome: CI refusal = exit 0 + one warning', refusalOutcome('ref_not_main', { GITHUB_ACTIONS: 'true' }), { exit: 0, stream: 'log', line: '::warning::data_job_runs: run not recorded (refused: ref_not_main)' })
  t('outcome: local refusal = exit 1', refusalOutcome('ref_not_main', {}).exit, 1)
  t('outcome: an unknown code cannot be echoed', refusalOutcome('password=hunter2', { GITHUB_ACTIONS: 'true' }).line.includes('hunter2'), false)

  // End to end as a runner would: no key, no url; fetch is replaced by a tripwire that exits 9.
  const self = fileURLToPath(import.meta.url)
  const trip = 'data:text/javascript,globalThis.fetch=()=>{console.error("NETWORK");process.exit(9)}'
  const runner = (label, envOver, argv, code) => {
    const env = { PATH: process.env.PATH, ...CI, ...envOver }
    for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k]
    const r = spawnSync(process.execPath, ['--import', trip, self, ...argv], { env, encoding: 'utf8' })
    const lines = r.stdout.split('\n').filter(Boolean)
    t(`runner: ${label}`, [r.status, lines.length, lines[0]?.startsWith(`::warning::data_job_runs: run not recorded (refused: ${code})`) && lines[0].endsWith(')'), r.stderr, lines[0]?.includes('CANARY')], [0, 1, true, '', false])
  }
  const OK = ['--status=success', '--real-run=true']
  runner('wrong ref', { GITHUB_REF: 'refs/heads/CANARY' }, OK, 'ref_not_main')
  runner('wrong event', { GITHUB_EVENT_NAME: 'CANARY' }, OK, 'event')
  runner('workflow not allowed', { GITHUB_WORKFLOW: 'CANARY' }, OK, 'job_not_allowed')
  runner('bad run id', { GITHUB_RUN_ID: 'CANARY' }, OK, 'run_id')
  runner('unknown flag', {}, [...OK, '--CANARY=1'], 'bad_args')
  runner('duplicate flag', {}, [...OK, '--status=CANARY'], 'bad_args')
  runner('missing flag', {}, ['--status=success'], 'bad_args')

  // End to end: fetch answers 403 with a hostile body code; the one warning line must carry the status only.
  {
    const stub = 'data:text/javascript,globalThis.fetch=async()=>new Response(JSON.stringify({code:"dummy-secret-looking_token.123",message:"dummy-secret-looking_token.123"}),{status:403})'
    const env = { PATH: process.env.PATH, ...CI, GITHUB_WORKFLOW: 'daily-health', SUPABASE_SERVICE_ROLE_KEY: 'dummy-key', EXPO_PUBLIC_SUPABASE_URL: 'https://abcdefgh.supabase.co' }
    const r = spawnSync(process.execPath, ['--import', stub, self, ...OK], { env, encoding: 'utf8' })
    t('runner: a 403 with a hostile body code -> HTTP 403 only', [r.status, r.stdout.trim(), r.stderr], [0, '::warning::data_job_runs: run not recorded (HTTP 403)', ''])
  }
  t('http: a 403 with a hostile body code prints the status only', reasonHttp(403, '{"code":"dummy-secret-looking_token.123"}'), 'HTTP 403')
  t('http: a 5-char SQLSTATE passes', reasonHttp(400, '{"code":"P0001"}'), 'HTTP 400 code P0001')
  t('http: a PGRST code passes', reasonHttp(404, '{"code":"PGRST202","message":"secret"}'), 'HTTP 404 code PGRST202')
  t('http: lowercase 5-char is dropped', reasonHttp(400, '{"code":"p0001"}'), 'HTTP 400')
  t('http: a long code is dropped', reasonHttp(400, '{"code":"PGRST1234"}'), 'HTTP 400')
  t('http: a non-string code is dropped', reasonHttp(400, '{"code":12345}'), 'HTTP 400')
  t('http: not JSON', reasonHttp(502, '<html>secret</html>'), 'HTTP 502')
  t('http: an array body', reasonHttp(500, '[1]'), 'HTTP 500')
  t('http: a non-integer status cannot be echoed', reasonHttp('1 secret', ''), 'HTTP unknown')
  t('network: a hostile error name and cause code are not echoed', reasonNetwork({ name: 'secret-name', cause: { code: 'secret-code' } }), 'network unknown')
  t('network: a timeout', reasonNetwork({ name: 'TimeoutError' }), 'network TimeoutError')
  t('network: fetch failed with a DNS cause', reasonNetwork({ name: 'TypeError', cause: { code: 'ENOTFOUND' } }), 'network TypeError ENOTFOUND')
  t('network: undefined error', reasonNetwork(undefined), 'network unknown')

  console.log(bad ? `\n  ${bad} self-test failure(s).` : '\n  Self-test clean.')
  return bad ? 1 : 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
