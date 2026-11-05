#!/usr/bin/env node
// ─── Is the duty-pharmacy push still going out? ───────────────────────────────
//
//   node scripts/check-duty-push-staleness.mjs        # exit 1 if no push was sent within MAX_AGE_H
//
// pg_cron reports "succeeded" once a request is queued, so a refused call looks healthy. From 2026-11-03 the gateway
// answered every cron call with 401 and the push stopped for days with nothing red. duty_push_runs is written by the
// function itself, so its newest 'sent' row is the proof. Prints an age only: Actions logs are public.
import { createClient } from '@supabase/supabase-js'
import { prodWriteGuard, serviceRoleKey } from './lib/prod-write-guard.mjs'

prodWriteGuard({ wouldWrite: false, workflow: 'daily-health' })

// The push is daily, but its hour moves with the roster (seen 06:00 to 15:00 UTC), so a day plus that spread.
const MAX_AGE_H = 36
const url = process.env.EXPO_PUBLIC_SUPABASE_URL
if (!url) { console.error('EXPO_PUBLIC_SUPABASE_URL missing'); process.exit(2) }
const sb = createClient(url, serviceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } })

const { data, error } = await sb.from('duty_push_runs').select('started_at')
  .eq('outcome', 'sent').order('started_at', { ascending: false }).limit(1)
if (error) { console.error('read failed:', error.message); process.exit(2) }

const hours = data?.[0] ? (Date.now() - new Date(data[0].started_at).getTime()) / 36e5 : null
console.log(`\n── duty push health ──\n  last sent : ${hours === null ? 'never' : hours.toFixed(1) + 'h ago'}\n  cap       : ${MAX_AGE_H}h\n`)
if (hours === null || hours > MAX_AGE_H) {
  console.error('::error::The duty-pharmacy push has not gone out. Check the duty-push cron response (supabase/readonly/cron_auth_state.sql).')
  process.exit(1)
}
