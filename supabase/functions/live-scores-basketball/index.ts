// live-scores-basketball — API-Sports basketball → matches / teams, on cron.
//
// Deploy:  gh workflow run supabase-functions-deploy -f function=live-scores-basketball
// Cron:    supabase/live_scores_schedule.sql (minute poll gated by live_sync_state, 03:00 UTC daily)
// Body:    { "mode": "daily" } or { "mode": "poll" } (default)
//
// All logic lives in ../_shared/live-scores.mjs, shared with the other sport and testable
// from Node (scripts/check-live-scores-sync.mjs). service_role callers only — see
// callerIsServiceRole there for why verify_jwt alone is not enough.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handle } from '../_shared/live-scores.mjs'

Deno.serve((req: Request) => handle(req, 'basketball', createClient, (k: string) => Deno.env.get(k)))
