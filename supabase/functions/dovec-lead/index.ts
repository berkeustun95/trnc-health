// dovec-lead — saves an enquiry about a Döveç project and forwards it to Döveç.
//
//   POST { client_request_id, project_id, unit_type?, name, phone, email?, message?, consent: true,
//          consent_text_version, language }                      (a signed-in, non-guest user)
//     -> 200 { ok: true, external_id, status }  | 200 { ok: false, error: 'rejected', external_id }
//     -> 400 invalid_request{field} / consent_required · 403 sign_in_required / under_18 · 404 project_unavailable
//        409 request_changed · 429 rate_limited
//   POST { mode: 'retry' }                                         (service key only: cron 20261230)
//   POST { mode: 'test_lead', dry?: boolean }                      (service key only: workflow dovec-test-lead; dry by default)
//   Service modes accept the runtime key, a service_role JWT (cron) or an sb_secret_ key the database accepts as service_role.
//
// Deploy:  scripts/fn-deploy.sh dovec-lead --go   (after Berke's go; verify_jwt true, deploy-config.json)
// Secrets: DOVEC_PARTNER_KEY (Bearer for Döveç), DOVEC_LEADS_MODE ('live' = lock 2 of 2; with the code constant
//          LEADS_LIVE_ALLOWED in ../_shared/dovec-lead.mjs = lock 1). Unless BOTH, nothing leaves: status 'mock'.
//          The one test enquiry has its OWN locks: constant TEST_LEAD_ALLOWED AND DOVEC_LEADS_MODE === 'test_once';
//          its phone is DOVEC_TEST_LEAD_PHONE (E.164). Under test_once user enquiries stay 'mock'.
// Who: the caller's id comes from auth.getUser() on THAT JWT, never from the body. Guests are refused. dovec_leads has no
//      policy and no grant for an app role: this function (service role) is the only way in and never returns another
//      person's lead.
// PRIVACY: logs hold external_id, a status word and an HTTP code. Never a name, phone, e-mail, message or user id.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serviceCaller, secretKeyCaller } from '../_shared/caller-auth.mjs'
import { handleLead, STALE_LEAD_MS, TEST_PROJECT_SEED } from '../_shared/dovec-lead.mjs'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const ONE_JWT = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/
const PENDING_GRACE_MS = 10 * 60000
const COLS = 'id,external_id,status,payload_hash,attempts,project_id,unit_type,name,phone,email,message,language_code,consent,created_at,next_attempt_at,is_test'

const dueFilter = (nowIso: string) =>
  `next_attempt_at.lte.${nowIso},and(next_attempt_at.is.null,created_at.lte.${new Date(new Date(nowIso).getTime() - PENDING_GRACE_MS).toISOString()})`

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  const url = Deno.env.get('SUPABASE_URL')!
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const authz = req.headers.get('Authorization')
  const holdsServiceKey = async (k: string) => {
    const r = await fetch(`${url}/rest/v1/dovec_leads?select=id&limit=0`, { headers: { apikey: k }, signal: AbortSignal.timeout(10000) })
    await r.body?.cancel()
    return r.status === 200
  }

  let caller: { kind: 'user'; id: string } | { kind: 'service' }
  if (await serviceCaller(authz, key) || await secretKeyCaller(authz, holdsServiceKey)) {
    caller = { kind: 'service' }
  } else {
    const jwt = ONE_JWT.exec(authz ?? '')?.[1]
    if (!jwt) return json(401, { error: 'unauthorized' })
    const { data, error } = await admin.auth.getUser(jwt)
    const user = data?.user
    if (error || !user) return json(401, { error: 'unauthorized' })
    if (user.is_anonymous === true) return json(403, { error: 'sign_in_required' })
    caller = { kind: 'user', id: user.id }
  }

  let body: unknown = null
  try { body = await req.json() } catch { return json(400, { error: 'invalid_request', field: 'body' }) }

  const store = {
    async isPublished() {
      const { data, error } = await admin.from('dovec_settings').select('published').eq('id', 1).maybeSingle()
      if (error) throw error
      return data?.published === true
    },
    async isAdmin(userId: string) {
      const { data, error } = await admin.from('profiles').select('role').eq('id', userId).maybeSingle()
      if (error) throw error
      return data?.role === 'admin'
    },
    async findByRequest(userId: string, crid: string) {
      const { data, error } = await admin.from('dovec_leads').select(COLS).eq('user_id', userId).eq('client_request_id', crid).maybeSingle()
      if (error) throw error
      return data
    },
    async getVisibleProject(id: string) {
      const fresh = await admin.rpc('dovec_feed_is_fresh')
      if (fresh.error) throw fresh.error
      if (fresh.data !== true) return null
      const { data, error } = await admin.from('dovec_projects').select('id,name,unit_types').eq('id', id).eq('listed', true).maybeSingle()
      if (error) throw error
      return data
    },
    async countLeads({ userId, sinceIso }: { userId?: string; sinceIso: string }) {
      let q = admin.from('dovec_leads').select('id', { count: 'exact', head: true }).eq('is_test', false).gte('created_at', sinceIso)
      if (userId) q = q.eq('user_id', userId)
      const { count, error } = await q
      if (error) throw error
      return count ?? 0
    },
    async insertLead(row: Record<string, unknown>) {
      const { data, error } = await admin.from('dovec_leads').insert(row).select(COLS).single()
      if (error) throw error
      return data
    },
    async updateLead(id: number, patch: Record<string, unknown>) {
      const { error } = await admin.from('dovec_leads').update(patch).eq('id', id)
      if (error) throw error
    },
    async dueLeads(limit: number, nowIso: string, statuses: string[]) {
      const { data, error } = await admin.from('dovec_leads').select(COLS).eq('is_test', false).in('status', statuses)
        .gt('created_at', new Date(new Date(nowIso).getTime() - STALE_LEAD_MS).toISOString())
        .or(dueFilter(nowIso)).order('created_at').limit(limit)
      if (error) throw error
      return data ?? []
    },
    async findTestLead() {
      const { data, error } = await admin.from('dovec_leads').select(COLS).eq('is_test', true).maybeSingle()
      if (error) throw error
      return data
    },
    async getTestProject() {
      const seed = await admin.from('dovec_project_coords').select('project_id').eq('seed_name', TEST_PROJECT_SEED).maybeSingle()
      if (seed.error) throw seed.error
      if (!seed.data?.project_id) return null
      const { data, error } = await admin.from('dovec_projects').select('id,name').eq('id', seed.data.project_id).eq('listed', true).maybeSingle()
      if (error) throw error
      return data
    },
    async claimLead(id: number, nowIso: string, untilIso: string) {
      const { data, error } = await admin.from('dovec_leads').update({ next_attempt_at: untilIso }).eq('id', id)
        .in('status', ['retry', 'pending']).or(dueFilter(nowIso)).select(COLS).maybeSingle()
      if (error) throw error
      return data
    },
    async getDateOfBirth(userId: string) {
      const { data, error } = await admin.from('profiles').select('date_of_birth').eq('id', userId).maybeSingle()
      if (error) throw error
      return data?.date_of_birth ?? null
    },
  }

  try {
    const res = await handleLead({
      caller, body,
      deps: {
        store, log: (s: string) => console.log(s),
        env: { mode: Deno.env.get('DOVEC_LEADS_MODE'), apiKey: Deno.env.get('DOVEC_PARTNER_KEY'), testPhone: Deno.env.get('DOVEC_TEST_LEAD_PHONE') },
      },
    })
    return json(res.status, res.body)
  } catch {
    console.error('dovec-lead: failed')
    return json(500, { error: 'server_error' })
  }
})
