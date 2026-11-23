#!/usr/bin/env node
// ─── Is the Döveç projects feed alive, and are enquiries getting through? ─────
//
//   node scripts/check-dovec-health.mjs        # exit 1 on any red below; run hourly by .github/workflows/dovec-health.yml
//
// Reads dovec_settings (the sync's own bookkeeping) and answers two lead questions as BOOLEANS. Actions logs are public:
// no counts, no ids, no names. Red (the run fails, GitHub emails) when:
//   suspended            Döveç rejected the partner key (401): the app already hides every project
//   last status not ok   a refusal or an error word (http_401, not_provisioned, refused_*, write_error, ...)
//   stale                no good sync for more than 30 minutes (the cron runs every 10)
//   stuck                an enquiry has waited for a send (retry / pending) for over an hour
//   rejected             an enquiry was rejected by Döveç or failed for good in the last 24 hours
// The one agreed test enquiry (is_test) is never read here: it has its own report (workflow dovec-test-lead).
// Map pins (informational, NEVER red): prints dovec_coord_status() (seeded pins not attached, attached projects renamed since,
// live projects without a pin). Public marketing names and Döveç project ids only, no user data; a missing function (20261229
// not applied) or a read error is printed, not failed.
// NOT ARMED until the first sync has ever run (last_run_at is null): the workflow lands with the code, the cron lands later
// (20261230), and an hourly red before go-live would teach everyone to ignore it. Arming is the first sync run itself.
import { createClient } from '@supabase/supabase-js'
import { prodWriteGuard, serviceRoleKey } from './lib/prod-write-guard.mjs'

prodWriteGuard({ wouldWrite: false, workflow: 'dovec-health' })

const STALE_MIN = 30
const url = process.env.EXPO_PUBLIC_SUPABASE_URL
if (!url) { console.error('EXPO_PUBLIC_SUPABASE_URL missing'); process.exit(2) }
const sb = createClient(url, serviceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } })

const { data: s, error } = await sb.from('dovec_settings')
  .select('published, suspended, last_good_sync_at, last_run_at, last_run_status').eq('id', 1).maybeSingle()
if (error) { console.error('read failed:', error.message); process.exit(2) }
if (!s) { console.error('::error::dovec_settings has no row (is 20261229 applied?)'); process.exit(1) }

const exists = async (build) => {
  const { data, error: e } = await build(sb.from('dovec_leads').select('id').eq('is_test', false).limit(1))
  if (e) { console.error('read failed:', e.message); process.exit(2) }
  return (data ?? []).length > 0
}
const ago = (min) => new Date(Date.now() - min * 60000).toISOString()

if (s.last_run_at === null) {
  console.log('\n── dovec health ──\n  not armed: the sync has never run (monitoring starts with its first run)\n')
  process.exit(0)
}
const ageMin = s.last_good_sync_at ? (Date.now() - new Date(s.last_good_sync_at).getTime()) / 60000 : null
const stuck = await exists(q => q.in('status', ['retry', 'pending']).lt('created_at', ago(60)))
const rejected = await exists(q => q.in('status', ['rejected', 'failed']).gte('created_at', ago(24 * 60)))

console.log(`\n── dovec health ──
  published        : ${s.published}
  suspended        : ${s.suspended}
  last run status  : ${s.last_run_status}
  last good sync   : ${ageMin === null ? 'never' : ageMin.toFixed(0) + ' min ago'}  (cap ${STALE_MIN} min)
  lead stuck > 1 h : ${stuck}
  rejected/failed 24 h : ${rejected}
`)

const coords = await sb.rpc('dovec_coord_status')
if (coords.error) console.log(`  pins             : not readable (${coords.error.code ?? 'error'})`)
else {
  const c = coords.data ?? {}
  const list = (a, f) => (Array.isArray(a) && a.length ? a.map(f).join('; ') : 'none')
  console.log(`  pins unmatched   : ${list(c.unmatched, x => `${x.seed} (${x.reason})`)}
  pins renamed     : ${list(c.renamed, x => `${x.seed} -> ${x.name}`)}
  live without pin : ${list(c.live_without_coords, x => x.name)}
`)
}

const reds = []
if (s.suspended) reds.push('The Döveç partner key was rejected (suspended): the app hides every project. Check the key with Döveç.')
if (s.last_run_status !== 'ok') reds.push(`The last sync run was "${s.last_run_status}", not ok. Function logs: Dashboard, Edge Functions, sync-dovec.`)
if (ageMin === null || ageMin > STALE_MIN) reds.push(`No good sync within ${STALE_MIN} minutes. Is the dovec-sync cron job running (admin Jobs screen)?`)
if (stuck) reds.push('An enquiry has waited more than an hour to be sent. Check dovec-lead logs and the dovec-lead-retry cron job.')
if (rejected) reds.push('An enquiry was rejected or failed for good in the last 24 hours. Check dovec-lead logs (external ids only).')
for (const r of reds) console.error(`::error::${r}`)
process.exit(reds.length ? 1 : 0)
