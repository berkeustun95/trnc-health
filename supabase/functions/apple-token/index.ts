// apple-token — Sign in with Apple refresh tokens: kept at sign-in, revoked before deletion.
//
// App Store 5.1.1(v): an app offering Sign in with Apple must revoke the user's Apple tokens
// when the account is deleted. Apple gives out a refresh token only in exchange for the
// one-time authorization code from sign-in (valid five minutes), so the app sends that code
// here right after signing in, and every in-app deletion calls `revoke` BEFORE deleting.
// Decision and alternatives: vault 2026-09-21_social-auth.md, slice 5.
//
// Actions (POST JSON):
//   { action: 'store',       code }    caller = the signed-in user   → exchange, keep
//   { action: 'revoke' }                caller = the signed-in user   → revoke own, delete row
//   { action: 'revoke_code', code }     caller = the signed-in user   → exchange + revoke now
//                                        (Profile deletion when no token was ever stored)
//   { action: 'revoke', userId }        caller holds a SERVICE key    → scripts/revoke-apple-token.mjs
//
// ─── DEPLOYED WITH --no-verify-jwt, AND THAT IS NOT "NO AUTH" ───────────────
// This project uses the new API keys (sb_publishable_ / sb_secret_). A secret key is not a
// JWT, so the gateway's JWT check would turn away the admin script. Every request is
// authenticated HERE instead:
//   • a user call must carry a session token that Supabase Auth accepts (auth.getUser);
//   • the admin path must prove it holds a key that can READ apple_refresh_tokens — a table
//     only service_role can read (20261044: RLS on, zero policies, no client grants). A
//     publishable key or a user token is refused there by the database itself.
//
// Secrets (supabase secrets set): APPLE_SIWA_KEY_P8_B64 (base64 of the .p8 PEM),
// APPLE_SIWA_KEY_ID, APPLE_TEAM_ID, APPLE_CLIENT_ID (= the bundle ID; native Sign in with
// Apple uses the App ID as client_id, not a Services ID). SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const APPLE = 'https://appleid.apple.com'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function secret(name: string): string {
  const v = Deno.env.get(name)
  if (!v) throw new Error(`missing secret ${name}`)
  return v
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// The client_secret Apple requires on /auth/token and /auth/revoke: an ES256 JWT signed with
// the Sign in with Apple key. Apple accepts up to six months; this mints a five-minute one
// per request, so no long-lived secret exists anywhere but the key itself.
async function clientSecret(): Promise<string> {
  const pem = atob(secret('APPLE_SIWA_KEY_P8_B64'))
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const enc = new TextEncoder()
  const now = Math.floor(Date.now() / 1000)
  const head = b64url(enc.encode(JSON.stringify({ alg: 'ES256', kid: secret('APPLE_SIWA_KEY_ID') })))
  const body = b64url(enc.encode(JSON.stringify({
    iss: secret('APPLE_TEAM_ID'), iat: now, exp: now + 300, aud: APPLE, sub: secret('APPLE_CLIENT_ID'),
  })))
  // WebCrypto's ECDSA signature is already raw r||s, which is what JWS ES256 wants.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${body}`)))
  return `${head}.${body}.${b64url(sig)}`
}

async function appleForm(path: string, fields: Record<string, string>) {
  const form = new URLSearchParams({ client_id: secret('APPLE_CLIENT_ID'), client_secret: await clientSecret(), ...fields })
  const res = await fetch(`${APPLE}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form,
  })
  const text = await res.text()
  let data: Record<string, unknown> = {}
  try { data = text ? JSON.parse(text) : {} } catch { /* revoke answers with an empty body */ }
  return { ok: res.ok, status: res.status, data }
}

const jwtSub = (idToken: unknown): string | null => {
  try {
    const p = String(idToken).split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(p + '='.repeat((4 - (p.length % 4)) % 4))).sub ?? null
  } catch { return null }
}

// The code must belong to the CALLER's Apple identity. Without this, a signed-in user could
// file somebody else's token under their own account. The id_token comes straight from Apple
// over TLS in answer to our own client_secret, so reading its `sub` needs no signature check.
type Identity = { provider: string; id: string; identity_data?: { sub?: string } }
async function exchange(user: { identities?: Identity[] }, code: string) {
  const r = await appleForm('/auth/token', { grant_type: 'authorization_code', code })
  // Apple's error CODE (invalid_client vs invalid_grant) is what tells a bad key/team/client
  // ID apart from a stale code — no request without a real code can distinguish them, so
  // the first real sign-in is the test, and this reason is what reads its result.
  if (!r.ok || typeof r.data.refresh_token !== 'string') return { error: `exchange_failed_${r.data.error ?? r.status}` }
  // identity_data.sub first: what identities[].id holds has changed across GoTrue versions.
  const apple = user.identities?.find(i => i.provider === 'apple')
  const appleSub = apple?.identity_data?.sub ?? apple?.id
  if (!appleSub || jwtSub(r.data.id_token) !== appleSub) return { error: 'identity_mismatch' }
  return { refreshToken: r.data.refresh_token as string }
}

async function revokeStored(userId: string) {
  const { data: row, error } = await admin.from('apple_refresh_tokens')
    .select('refresh_token').eq('user_id', userId).maybeSingle()
  if (error) return json(500, { revoked: false, reason: 'db_read_failed' })
  if (!row) return json(200, { revoked: false, reason: 'no_token' })
  const r = await appleForm('/auth/revoke', { token: row.refresh_token, token_type_hint: 'refresh_token' })
  if (!r.ok) return json(502, { revoked: false, reason: `apple_${r.data.error ?? r.status}` })
  await admin.from('apple_refresh_tokens').delete().eq('user_id', userId)
  return json(200, { revoked: true })
}

// Proof of a SERVICE key: only service_role can read apple_refresh_tokens, so a key that can
// is one. Sent as `apikey` only — a sb_secret_ key is not a bearer JWT.
async function holdsServiceKey(key: string): Promise<boolean> {
  if (!key) return false
  const r = await fetch(`${SUPABASE_URL}/rest/v1/apple_refresh_tokens?select=user_id&limit=1`, { headers: { apikey: key } })
  await r.body?.cancel()
  return r.ok
}

Deno.serve(async req => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  let body: { action?: string; code?: string; userId?: string }
  try { body = await req.json() } catch { return json(400, { error: 'bad_json' }) }
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')

  try {
    // Admin path: revoke for a named user. Used BEFORE deleting an Apple user outside the app.
    if (body.userId) {
      if (body.action !== 'revoke') return json(400, { error: 'bad_action' })
      if (!/^[0-9a-f-]{36}$/i.test(body.userId)) return json(400, { error: 'bad_user_id' })
      const key = req.headers.get('apikey') ?? bearer
      if (!(await holdsServiceKey(key))) return json(401, { error: 'service_key_required' })
      return await revokeStored(body.userId)
    }

    const { data: { user }, error: authErr } = await admin.auth.getUser(bearer)
    if (authErr || !user) return json(401, { error: 'unauthenticated' })

    if (body.action === 'store') {
      if (!body.code) return json(400, { error: 'missing_code' })
      const x = await exchange(user, body.code)
      if ('error' in x) return json(400, { stored: false, reason: x.error })
      const { error } = await admin.from('apple_refresh_tokens').upsert({
        user_id: user.id, refresh_token: x.refreshToken, updated_at: new Date().toISOString(),
      })
      return error ? json(500, { stored: false, reason: 'db_write_failed' }) : json(200, { stored: true })
    }

    if (body.action === 'revoke') return await revokeStored(user.id)

    if (body.action === 'revoke_code') {
      if (!body.code) return json(400, { error: 'missing_code' })
      const x = await exchange(user, body.code)
      if ('error' in x) return json(400, { revoked: false, reason: x.error })
      const r = await appleForm('/auth/revoke', { token: x.refreshToken, token_type_hint: 'refresh_token' })
      return r.ok ? json(200, { revoked: true }) : json(502, { revoked: false, reason: `apple_${r.data.error ?? r.status}` })
    }

    return json(400, { error: 'bad_action' })
  } catch (e) {
    // Names a missing secret; never echoes a token, a code or Apple's body.
    console.error('apple-token:', e instanceof Error ? e.message : String(e))
    return json(500, { error: 'internal' })
  }
})
