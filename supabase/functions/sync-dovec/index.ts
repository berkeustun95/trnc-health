// sync-dovec — mirrors Döveç's projects feed into dovec_projects, every 10 minutes (cron 20261230).
//
// Deploy:  scripts/fn-deploy.sh sync-dovec --go   (after Berke's go; verify_jwt from deploy-config.json)
// Order and the secrets it needs: PLUG-IN.md. ALL API KNOWLEDGE is in ../_shared/dovec-feed.mjs; this file only moves rows.
//
// Who: the service key only (cron through Vault, or a hand call). Any other caller gets 401.
// Secrets: DOVEC_PARTNER_KEY (Bearer for Döveç; set in prod, never printed).
// Logs: project-level words and counts only. Never the partner key, never a response body.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serviceCaller } from '../_shared/caller-auth.mjs'
import { readAllResult } from '../_shared/read-all-rows.mjs'
import { recordDataJobRun } from '../_shared/data-jobs.mjs'
import { runSync } from '../_shared/dovec-feed.mjs'

const JOB = 'dovec-sync'
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  const caller = await serviceCaller(req.headers.get('Authorization'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))
  if (!caller) {
    console.error('sync-dovec: caller refused')
    return json(401, { ok: false, error: 'unauthorized' })
  }
  const started = Date.now()
  const url = Deno.env.get('SUPABASE_URL')!
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const cfg = { url, key, log: (s: string) => console.log(s) }

  const store = {
    async listedIds() {
      const { data, error } = await readAllResult((a: number, b: number) => supabase
        .from('dovec_projects').select('id', { count: 'exact' }).eq('listed', true).order('id').range(a, b))
      if (error) throw new Error('read failed')
      return (data ?? []).map((r: { id: string }) => r.id)
    },
    async upsert(rows: Record<string, unknown>[], nowIso: string) {
      const payload = rows.map(r => ({ ...r, listed: true, delisted_at: null, last_seen_at: nowIso, updated_at: nowIso }))
      const { error } = await supabase.from('dovec_projects').upsert(payload, { onConflict: 'id' })
      if (error) throw new Error('upsert failed')
    },
    async delist(ids: string[], nowIso: string) {
      const { error } = await supabase.from('dovec_projects')
        .update({ listed: false, delisted_at: nowIso, updated_at: nowIso }).in('id', ids).eq('listed', true)
      if (error) throw new Error('delist failed')
    },
    async setState(patch: Record<string, unknown>) {
      const { error } = await supabase.from('dovec_settings').update(patch).eq('id', 1)
      if (error) throw new Error('state write failed')
    },
  }

  try {
    const res = await runSync({
      apiKey: Deno.env.get('DOVEC_PARTNER_KEY'),
      store,
    })
    console.log(`sync-dovec: ${res.status} valid=${res.valid} skipped=${res.skipped} delisted=${res.delisted}`)
    const good = res.status === 'ok'
    await recordDataJobRun(cfg, JOB, good ? 'ok' : 'failed', good ? null : res.status, started)
    return json(200, { ok: good, status: res.status, valid: res.valid, skipped: res.skipped, delisted: res.delisted })
  } catch {
    console.error('sync-dovec: state write failed')
    await recordDataJobRun(cfg, JOB, 'failed', 'state_write_failed', started)
    return json(500, { ok: false, error: 'state_write_failed' })
  }
})
