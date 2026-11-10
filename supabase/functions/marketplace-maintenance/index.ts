// marketplace-maintenance — Bandabuliya retention, nightly (20261185's pg_cron job, 01:23 UTC).
//
//   POST { "apply": true }   headers: Authorization: Bearer <service_role key>
//   → 200 { applied, expired_soft_deleted, purged, purge_held_by_report, orphans_found, orphans_removed, … } — counts only
//
// Without "apply": a dry run — the same counts, nothing changed (how to check it by hand).
// 1. public.marketplace_maintenance(apply): listings expired > 90 days are soft-deleted; soft-deleted > 30 days are
//    purged unless a report is pending (rows; photo rows cascade, chats keep the thread).
// 2. public.marketplace_orphan_objects(500): files no live photo row holds, older than 24 h — removed through the
//    Storage API in chunks of 100 (storage.protect_delete blocks SQL deletes).
// service_role callers only (jwtRole, as google-places). verify_jwt = true. Logs carry codes only.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { run } from './run.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

Deno.serve(async req => {
  if (req.method !== 'POST') return json(405, { error: 'METHOD' })
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  let body: unknown = null
  try { body = await req.json() } catch { /* empty body = a dry run */ }
  const r = await run(jwt, body, {
    async retention(apply) {
      const { data, error } = await admin.rpc('marketplace_maintenance', { p_apply: apply })
      if (error) throw error
      return data
    },
    async orphans(limit) {
      const { data, error } = await admin.rpc('marketplace_orphan_objects', { p_limit: limit })
      if (error) throw error
      return (data ?? []).map((r: { name: string }) => r.name)
    },
    async remove(paths) {
      const { error } = await admin.storage.from('marketplace-photos').remove(paths)
      if (error) throw error
    },
    log: code => console.error('marketplace-maintenance:', code),
  })
  return json(r.status, r.body)
})
