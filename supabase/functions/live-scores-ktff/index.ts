// live-scores-ktff — KTFF "Sitene Ekle" API → ktff_leagues / ktff_standings / ktff_fixtures, on cron.
//
// Deploy:  scripts/fn-deploy.sh live-scores-ktff --go   (verify_jwt true, see deploy-config.json)
// Cron:    20261228_live_scores_ktff.sql — every 15 minutes, POSTs only when ktff_sync_due() says so.
// Body:    none needed. No secrets beyond the runtime's own: KTFF is recognised by Origin https://getadaapp.com.
//
// All logic lives in ../_shared/ktff.mjs, shared with Node (scripts/check-ktff-sync.mjs). service_role callers only.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handle } from '../_shared/ktff.mjs'

Deno.serve((req: Request) => handle(req, createClient, (k: string) => Deno.env.get(k)))
