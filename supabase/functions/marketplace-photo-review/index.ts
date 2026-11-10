// marketplace-photo-review — an admin approves or rejects one pending Bandabuliya photo (20261183).
//
//   POST  { photo_id, action: 'approve' | 'reject', reason? }   headers: Authorization: Bearer <admin's JWT>
//   → 200 { status, width?, height? }  | 4xx/5xx { error: CODE }
//
// Approve: Storage resizes the pending original to fit 1600×1600 (image transformation, format kept), the shared
// stripper removes what the transform leaves (Exif, IPTC — GPS is already gone), the result is re-scanned, written
// to approved/<owner>/<listing>/<photo>.<ext>, and the row is settled; then the original is removed. Reject: the
// row is settled, the original removed, and the seller gets one in-app notice + push per 10 minutes.
// Why Storage resizes (Berke, 2026-11-09): decoding a 12 MP photo inside the function measured 0.5–1.8 s of the
// 2 s CPU cap; the transform costs no function CPU and accepts up to 50 MP.
//
// Admin = public.is_admin() called with the caller's JWT (profiles.role = 'admin'), the one SQL definition.
// Rows are settled with the service key, conditional on status = 'pending': marketplace_photos has no UPDATE policy.
// verify_jwt = true. Logs carry codes only.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendBatch } from '../send-duty-notification/push.ts'
import { handle, type Deps } from './review.ts'

const BUCKET = 'marketplace-photos'
const SB_URL = Deno.env.get('SUPABASE_URL')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const admin = createClient(SB_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function deps(jwt: string): Deps {
  return {
    async reviewer(token) {
      const { data: { user } = { user: null }, error } = await admin.auth.getUser(token)
      if (error && !(error.status && error.status < 500)) throw { status: 503 }
      if (error || !user || user.is_anonymous === true) return null
      const asCaller = createClient(SB_URL, ANON, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${jwt}` } },
      })
      const { data: isAdmin, error: rpcErr } = await asCaller.rpc('is_admin')
      if (rpcErr) throw { status: 503 }
      return { id: user.id, isAdmin: isAdmin === true }
    },
    async photo(id) {
      const { data, error } = await admin.from('marketplace_photos')
        .select('id, listing_id, owner_id, status, storage_path').eq('id', id).maybeSingle()
      if (error) throw error
      return data
    },
    async transformed(path) {
      const { data, error } = await admin.storage.from(BUCKET)
        .download(path, { transform: { width: 1600, height: 1600, resize: 'contain', quality: 80, format: 'origin' } })
      if (error || !data) throw error ?? new Error('empty')
      return new Uint8Array(await data.arrayBuffer())
    },
    async upload(path, bytes, contentType) {
      const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true, cacheControl: '3600' })
      if (error) throw error
    },
    async remove(paths) {
      const { error } = await admin.storage.from(BUCKET).remove(paths)
      if (error) throw error
    },
    async settle(id, fields) {
      const { data, error } = await admin.from('marketplace_photos').update(fields).eq('id', id).eq('status', 'pending').select('id')
      if (error) throw error
      return (data ?? []).length === 1
    },
    async seller(ownerId, listingId) {
      const [{ data: prof }, { data: lst }, { data: last }] = await Promise.all([
        admin.from('profiles').select('preferred_language, push_token').eq('id', ownerId).maybeSingle(),
        admin.from('marketplace_listings').select('title').eq('id', listingId).maybeSingle(),
        admin.from('notifications').select('created_at').eq('user_id', ownerId).eq('type', 'marketplace')
          .order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ])
      return { lang: prof?.preferred_language ?? 'English', token: prof?.push_token ?? null, title: lst?.title ?? '',
               noticedAt: last?.created_at ? Date.parse(last.created_at) : null }
    },
    async notify(row) {
      const { error } = await admin.from('notifications').insert({ ...row, type: 'marketplace' })
      if (error) throw error
    },
    async push(message) {
      const now = Date.now()
      await sendBatch([message], { fetchFn: fetch, sleep: ms => new Promise(r => setTimeout(r, ms)), now: Date.now, random: Math.random, deadlineAt: now + 20_000 })
    },
    now: () => Date.now(),
    log: code => console.error('marketplace-photo-review:', code),
  }
}

Deno.serve(async req => {
  if (req.method !== 'POST') return json(405, { error: 'METHOD' })
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  let body: unknown = null
  try { body = await req.json() } catch { return json(400, { error: 'BAD_REQUEST' }) }
  try {
    const r = await handle(jwt, body, deps(jwt))
    return json(r.status, r.body)
  } catch {
    console.error('marketplace-photo-review: unexpected')
    return json(500, { error: 'STORE_FAILED' })
  }
})
