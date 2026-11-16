#!/usr/bin/env node
// ─── Duty push send-once watch (Round 5, 2026-11-16; daily-health step, 7 days) ─────────
//
//   node scripts/check-duty-push-send-once.mjs          # exit 1 if a duty run since the #479 deploy went wrong
//   node scripts/check-duty-push-send-once.mjs --self   # verdict self-test, offline
//
// #479 made every Expo batch go out once (a re-send after 503/429 double-pushed real users). Red when any duty run
// since that deploy re-sent a batch (push_retries > 0: old code ran), had a failed batch (outcome partial /
// push_failed) or was cut off ('running' over 15 min). Prints PASS/FAIL only, never a count: Actions logs are public.
// After STOP_AFTER it prints "window over" and passes; then remove the daily-health step.
import { prodWriteGuard, serviceRoleKey } from './lib/prod-write-guard.mjs'

export const DEPLOYED_AT = '2026-11-16T19:44:48Z'
export const STOP_AFTER = '2026-11-23'
const STUCK_MS = 15 * 60_000

export function verdict(rows, nowMs) {
  return rows.some((r) => (r.push_retries ?? 0) > 0
    || r.outcome === 'partial' || r.outcome === 'push_failed'
    || (r.outcome === 'running' && nowMs - Date.parse(r.started_at) > STUCK_MS)) ? 'FAIL' : 'PASS'
}

if (process.argv.includes('--self')) {
  const now = Date.parse('2026-11-18T18:00:00Z')
  const ok = { started_at: '2026-11-18T15:00:00Z', outcome: 'sent', push_retries: 0 }
  const cases = [
    [[], 'PASS'], [[ok], 'PASS'], [[{ ...ok, outcome: 'no_duties' }], 'PASS'],
    [[ok, { ...ok, push_retries: 1 }], 'FAIL'],
    [[{ ...ok, outcome: 'partial' }], 'FAIL'], [[{ ...ok, outcome: 'push_failed' }], 'FAIL'],
    [[{ ...ok, outcome: 'running', started_at: '2026-11-18T17:50:00Z' }], 'PASS'],
    [[{ ...ok, outcome: 'running' }], 'FAIL'],
  ]
  for (const [rows, want] of cases) {
    const got = verdict(rows, now)
    if (got !== want) { console.error(`✗ self-test: ${JSON.stringify(rows)} → ${got}, want ${want}`); process.exit(1) }
  }
  console.log(`✓ self-test: ${cases.length} cases`)
  process.exit(0)
}

prodWriteGuard({ wouldWrite: false, workflow: 'daily-health' })
console.log('\n── duty push send-once watch ──')
if (new Date().toISOString().slice(0, 10) > STOP_AFTER) {
  console.log(`  window over (${STOP_AFTER}): PASS. Remove this daily-health step.`)
  process.exit(0)
}
const { createClient } = await import('@supabase/supabase-js')
const url = process.env.EXPO_PUBLIC_SUPABASE_URL
if (!url) { console.error('EXPO_PUBLIC_SUPABASE_URL missing'); process.exit(2) }
const sb = createClient(url, serviceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } })
const { data, error } = await sb.from('duty_push_runs').select('started_at, outcome, push_retries')
  .gt('started_at', DEPLOYED_AT).limit(1000)
if (error) { console.error('read failed:', error.message); process.exit(2) }
const v = verdict(data ?? [], Date.now())
console.log(`  ${v}\n`)
if (v === 'FAIL') {
  console.error('::error::Duty push since the send-once deploy: a re-sent batch, a failed batch or a cut-off run. Open supabase/probe_duty_push_retries.sql (sealed) for details.')
  process.exit(1)
}
