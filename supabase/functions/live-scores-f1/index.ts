// live-scores-f1 — API-Sports Formula 1 → f1_races / f1_results, on cron.
//
// Deploy:  gh workflow run supabase-functions-deploy -f function=live-scores-f1
// Cron:    20261072_live_scores_cron.sql (minute poll gated by live_sync_state, daily 03:04 UTC)
// Body:    { "mode": "daily" } or { "mode": "poll" } (default)
//
// Logic: ../_shared/live-scores-f1.mjs (sessions, results) on ../_shared/live-scores.mjs
// (quota fence, request log, service_role gate). Tested from Node by
// scripts/check-live-scores-sync.mjs.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handle } from '../_shared/live-scores.mjs'
import { runDailyF1, runPollF1 } from '../_shared/live-scores-f1.mjs'

Deno.serve((req: Request) => handle(req, 'f1', createClient, (k: string) => Deno.env.get(k), { daily: runDailyF1, poll: runPollF1 }))
