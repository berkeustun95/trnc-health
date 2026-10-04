// live-scores-football — API-Sports football → matches / teams / match_events, on cron.
//
// Deploy:  gh workflow run supabase-functions-deploy -f function=live-scores-football
// Cron:    20261072_live_scores_cron.sql (minute poll gated by live_sync_state, 03:00 UTC daily)
// Body:    { "mode": "daily" } or { "mode": "poll" } (default)
//
// All logic lives in ../_shared/live-scores.mjs, shared with the other sport and testable
// from Node (scripts/check-live-scores-sync.mjs). service_role callers only — see
// callerIsServiceRole there for why verify_jwt alone is not enough.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handle, runDaily, runPoll, runLeagueLookup } from '../_shared/live-scores.mjs'

Deno.serve((req: Request) => handle(req, 'football', createClient, (k: string) => Deno.env.get(k),
  { daily: runDaily, poll: runPoll, leagues: runLeagueLookup }))
