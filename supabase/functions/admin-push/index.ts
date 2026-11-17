// admin-push — the admin's two many-recipient pushes (duty swap broadcast, Broadcast tab), server-side.
//
// POST { kind: 'duty_swap', request_id, duty_list_id, test? } | { kind: 'broadcast', request_id, target, title, body, test? }
// headers: Authorization: Bearer <the admin's user JWT>. The caller must be signed in (not a guest) AND profiles.role =
// 'admin' (read with the service key, never a claim); the service key itself is refused. verify_jwt stays true.
// The gate is the first statement of the handler: a refused call reads nothing and writes no ledger row.
// Send-once ledger: admin_push_sends (20261217), service role only; separate from duty_push_runs on purpose.
// Test mode (test: true): recipients = audience ∩ the ADMIN_PUSH_TEST_USER_IDS secret. Logs: codes only.
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { adminCaller } from '../_shared/caller-auth.mjs'
import { handle, type Deps, type Profile } from './send.ts'

const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const deps: Deps = {
  testUserIds: () => Deno.env.get('ADMIN_PUSH_TEST_USER_IDS'),
  async claim(row) {
    const { error } = await service.from('admin_push_sends').insert(row)
    if (!error) return 'claimed'
    return error.code === '23505' ? 'duplicate' : 'error'
  },
  async storedOutcome(id) {
    const { data } = await service.from('admin_push_sends').select('outcome').eq('request_id', id).maybeSingle()
    return data?.outcome ?? null
  },
  async finish(id, fields) {
    const { error } = await service.from('admin_push_sends').update({ ...fields, finished_at: new Date().toISOString() }).eq('request_id', id)
    if (error) console.error('admin-push: ledger finish failed')
  },
  async dutyEntry(id) {
    const { data, error } = await service.from('duty_list').select('name, duty_date').eq('id', id).maybeSingle()
    return { data: error ? null : data, error: !!error }
  },
  profilePage: (role) => (after) => {
    let q = service.from('profiles').select('id, push_token, preferred_language', { count: 'exact' }).order('id').limit(1000)
    if (role) q = q.eq('role', role)
    if (after) q = q.gt('id', after)
    return q as unknown as PromiseLike<{ data: Profile[] | null; error: { message: string } | null; count: number | null }>
  },
  async insertNotifications(rows) {
    const { error } = await service.from('notifications').insert(rows)
    return !error
  },
  getLastSignIn: async (id) => (await service.auth.admin.getUserById(id)).data?.user?.last_sign_in_at,
  fetchFn: fetch,
  log: (code) => console.error('admin-push:', code),
}

serve(async (req) => {
  const caller = await adminCaller(req.headers.get('Authorization'), {
    getUser: (jwt) => service.auth.getUser(jwt),
    getRole: (id) => service.from('profiles').select('role').eq('id', id).maybeSingle(),
  })
  if (!('id' in caller)) {
    console.error('admin-push: caller refused', caller.status)
    return new Response(JSON.stringify({ ok: false, error: caller.error }), { status: caller.status, headers: { 'Content-Type': 'application/json' } })
  }
  const input = await req.json().catch(() => null)
  const result = await handle(input, caller.id, deps)
  return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'Content-Type': 'application/json' } })
})
