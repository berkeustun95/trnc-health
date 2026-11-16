#!/usr/bin/env node
// ─── Who watches the watchdog: daily-health reads data_jobs_watchdog_age() ───
//
// Data jobs, slice 3 (RPC: data_jobs_watchdog migration, service_role only). The pg_cron job `data-jobs-watchdog`
// alerts admins when a data job goes wrong; if the watchdog itself stops, nothing says so. This is the one step in
// daily-health that does: the RPC returns the seconds since the cron job last succeeded (null = none in 30 days).
//
//   node scripts/check-data-jobs-watchdog.mjs        (no arguments, in Actions only)
//   node scripts/check-data-jobs-watchdog.mjs --selftest
//
//   * SCHEDULED runs only (a hand dispatch of daily-health reads nothing here); refs/heads/main only.
//   * RED (exit 1) only on a readable answer: age over 3 hours, or null.
//   * WARNING, exit 0: the RPC does not exist yet (404 + PGRST202: "watchdog not installed yet"), and every other
//     failure to read (no key, network, any other HTTP status, an unexpected body). A flaky read must not open the
//     "Daily health is red" issue; the cost is that a watchdog whose age cannot be read stays a warning.
//   * Output is from a fixed vocabulary; a response body is never echoed. Read-only: one POST to an RPC that selects.
//     prodWriteGuard() still comes first, because check-prod-write-guard.mjs treats any service-key RPC as a writer.

import { prodWriteGuard } from './lib/prod-write-guard.mjs'
import { reasonHttp, reasonNetwork, cleanUrl } from './record-data-job-run.mjs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

export const RPC_PATH = '/rest/v1/rpc/data_jobs_watchdog_age'
export const MAX_AGE_S = 3 * 3600

// body (JSON text) -> { red, line }. Never echoes the body.
export function judge(text) {
  let v
  try { v = JSON.parse(text) } catch { return { red: false, line: '::warning::data-jobs-watchdog: age not read (unexpected response)' } }
  if (v === null) return { red: true, line: '::error::data-jobs-watchdog: the watchdog has not succeeded in the last 30 days (or never ran)' }
  if (!Number.isInteger(v) || v < 0) return { red: false, line: '::warning::data-jobs-watchdog: age not read (unexpected response)' }
  if (v > MAX_AGE_S) return { red: true, line: `::error::data-jobs-watchdog: the watchdog last succeeded ${Math.floor(v / 60)} min ago (limit ${MAX_AGE_S / 60})` }
  return { red: false, line: `data-jobs-watchdog: last succeeded ${Math.floor(v / 60)} min ago (limit ${MAX_AGE_S / 60})` }
}

export function httpOutcome(status, text) {
  if (status === 404 && /^HTTP 404 code PGRST202$/.test(reasonHttp(status, text))) return { red: false, line: '::warning::data-jobs-watchdog: watchdog not installed yet' }
  return { red: false, line: `::warning::data-jobs-watchdog: age not read (${reasonHttp(status, text)})` }
}

export function decideWatchdog(env) {
  if (env.GITHUB_ACTIONS !== 'true') return { action: 'refuse' }
  if (env.GITHUB_EVENT_NAME !== 'schedule') return { action: 'skip', line: 'data-jobs-watchdog: not a scheduled run, not checked' }
  if (env.GITHUB_REF !== 'refs/heads/main') return { action: 'skip', line: '::warning::data-jobs-watchdog: age not read (refused: ref_not_main)' }
  return { action: 'read' }
}

async function main() {
  const selftestOnly = process.argv.length === 3 && process.argv[2] === '--selftest'
  if (!selftestOnly && process.env.GITHUB_ACTIONS !== 'true') {
    console.error('check-data-jobs-watchdog: REFUSED: read only by daily-health itself.\n  Offline check:  node scripts/check-data-jobs-watchdog.mjs --selftest')
    process.exit(1)
  }
  prodWriteGuard({ wouldWrite: false, dryHint: 'node scripts/check-data-jobs-watchdog.mjs --selftest' })
  if (selftestOnly) process.exit(runSelftest())
  const done = (o) => { console.log(o.line); process.exit(o.red ? 1 : 0) }
  const warn = (why) => done({ red: false, line: `::warning::data-jobs-watchdog: age not read (${why})` })
  if (process.argv.length !== 2) warn('refused: bad_args')
  try {
    const d = decideWatchdog(process.env)
    if (d.action === 'skip') { console.log(d.line); process.exit(0) }
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
    if (!key) warn('service key missing')
    const base = cleanUrl(process.env.EXPO_PUBLIC_SUPABASE_URL)
    if (!base) warn('project url missing or not https://<ref>.supabase.co')
    let res
    try {
      res = await fetch(base + RPC_PATH, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: '{}',
      })
    } catch (e) {
      warn(reasonNetwork(e))
    }
    const text = await res.text().catch(() => '')
    done(res.ok ? judge(text) : httpOutcome(res.status, text))
  } catch (e) {
    warn('error unexpected')
  }
}

export function runSelftest() {
  let bad = 0
  const t = (label, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want), ok = g === w
    if (!ok) bad++
    console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(60)}  ${g}${ok ? '' : `  wanted ${w}`}`)
  }
  const J = (x) => { const o = judge(x); return [o.red, o.line] }
  t('fresh: 5 min', J('300'), [false, 'data-jobs-watchdog: last succeeded 5 min ago (limit 180)'])
  t('exactly the limit is fine', J('10800')[0], false)
  t('one second over the limit is red', J('10801')[0], true)
  t('null is red', J('null'), [true, '::error::data-jobs-watchdog: the watchdog has not succeeded in the last 30 days (or never ran)'])
  t('a string is a warning, not red', J('"x"'), [false, '::warning::data-jobs-watchdog: age not read (unexpected response)'])
  t('a negative age is a warning', J('-5')[0], false)
  t('a float is a warning', J('1.5')[0], false)
  t('an object is a warning', J('{"a":1}')[0], false)
  t('empty body is a warning', J('')[0], false)
  t('404 PGRST202 = not installed yet, not red', [httpOutcome(404, '{"code":"PGRST202"}').red, httpOutcome(404, '{"code":"PGRST202"}').line], [false, '::warning::data-jobs-watchdog: watchdog not installed yet'])
  t('404 with another code is a plain warning', httpOutcome(404, '{"code":"PGRST999"}').line, '::warning::data-jobs-watchdog: age not read (HTTP 404 code PGRST999)')
  t('403 is a warning, not red', [httpOutcome(403, '').red, httpOutcome(403, '').line], [false, '::warning::data-jobs-watchdog: age not read (HTTP 403)'])
  t('a hostile body code is not echoed', httpOutcome(500, '{"code":"hostile-token_1"}').line, '::warning::data-jobs-watchdog: age not read (HTTP 500)')
  const CI = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'schedule', GITHUB_REF: 'refs/heads/main' }
  t('schedule on main reads', decideWatchdog(CI).action, 'read')
  t('a dispatch is skipped', decideWatchdog({ ...CI, GITHUB_EVENT_NAME: 'workflow_dispatch' }).action, 'skip')
  t('a feature branch is skipped with a warning', decideWatchdog({ ...CI, GITHUB_REF: 'refs/heads/x' }).line.startsWith('::warning::'), true)
  t('not in Actions is refused', decideWatchdog({}).action, 'refuse')

  const self = fileURLToPath(import.meta.url)
  const trip = 'data:text/javascript,globalThis.fetch=()=>{console.error("NETWORK");process.exit(9)}'
  const stubFor = (body, status) => `data:text/javascript,globalThis.fetch=async()=>new Response(${JSON.stringify(JSON.stringify(body))},{status:${status}})`
  const stubThrow = `data:text/javascript,globalThis.fetch=async()=>{const e=new Error("secret");e.name="TimeoutError";throw e}`
  const KEYENV = { SUPABASE_SERVICE_ROLE_KEY: 'dummy-key', EXPO_PUBLIC_SUPABASE_URL: 'https://abcdefgh.supabase.co' }
  const runner = (label, stub, over, want) => {
    const env = { PATH: process.env.PATH, ...CI, ...over }
    for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k]
    const r = spawnSync(process.execPath, ['--import', stub, self], { env, encoding: 'utf8' })
    t(`runner: ${label}`, [r.status, r.stdout.split('\n').filter(Boolean), r.stderr], want)
  }
  runner('age 600 -> green', stubFor(600, 200), KEYENV, [0, ['data-jobs-watchdog: last succeeded 10 min ago (limit 180)'], ''])
  runner('age 20000 -> red', stubFor(20000, 200), KEYENV, [1, ['::error::data-jobs-watchdog: the watchdog last succeeded 333 min ago (limit 180)'], ''])
  runner('null -> red', stubFor(null, 200), KEYENV, [1, ['::error::data-jobs-watchdog: the watchdog has not succeeded in the last 30 days (or never ran)'], ''])
  runner('RPC missing -> warning, green', stubFor({ code: 'PGRST202' }, 404), KEYENV, [0, ['::warning::data-jobs-watchdog: watchdog not installed yet'], ''])
  runner('500 -> warning, green', stubFor('x', 500), KEYENV, [0, ['::warning::data-jobs-watchdog: age not read (HTTP 500)'], ''])
  runner('network error -> warning, green', stubThrow, KEYENV, [0, ['::warning::data-jobs-watchdog: age not read (network TimeoutError)'], ''])
  runner('no key -> warning, no network', trip, { EXPO_PUBLIC_SUPABASE_URL: KEYENV.EXPO_PUBLIC_SUPABASE_URL }, [0, ['::warning::data-jobs-watchdog: age not read (service key missing)'], ''])
  runner('a dispatch reads nothing', trip, { ...KEYENV, GITHUB_EVENT_NAME: 'workflow_dispatch' }, [0, ['data-jobs-watchdog: not a scheduled run, not checked'], ''])
  {
    const r = spawnSync(process.execPath, [self], { env: { PATH: process.env.PATH }, encoding: 'utf8' })
    t('local run (not Actions) is refused, exit 1', [r.status, r.stdout], [1, ''])
  }
  console.log(bad ? `\n  ${bad} self-test failure(s).` : '\n  Self-test clean.')
  return bad ? 1 : 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
