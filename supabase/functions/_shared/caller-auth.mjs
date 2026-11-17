// Who may call a service-only function. 'exact' = the bearer IS the runtime service key (compared in constant
// time over sha256 digests); 'role' = a JWT whose role claim is service_role (the gateway has already verified
// the signature, which is only true while the function's verify_jwt stays true). Anything else = null.
const enc = new TextEncoder()
const digest = async s => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))

function jwtRole(jwt) {
  try {
    const p = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(p + '='.repeat((4 - p.length % 4) % 4)))?.role ?? null
  } catch { return null }
}

const ONE_JWT = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/

export async function serviceCaller(authorizationHeader, serviceKey) {
  const header = authorizationHeader ?? ''
  const m = /^Bearer (.+)$/.exec(header)
  if (!m) return null
  const token = m[1]
  if (typeof serviceKey === 'string' && serviceKey.length > 0) {
    const [a, b] = await Promise.all([digest(token), digest(serviceKey)])
    let diff = 0
    for (let i = 0; i < 32; i++) diff |= a[i] ^ b[i]
    if (diff === 0) return 'exact'
  }
  const one = ONE_JWT.exec(header)
  return one && jwtRole(one[1]) === 'service_role' ? 'role' : null
}

// An admin's own session, for the functions the app calls with supabase.functions.invoke. Pure, deps injected:
//   getUser(jwt)  = the service client's auth.getUser(jwt) -> { data: { user }, error }  (verifies the token with Auth;
//                   the service key itself is not a user token, so it is refused here, not waved through)
//   getRole(id)   = the service client's profiles.select('role').eq('id', id).maybeSingle() -> { data, error }
// The role comes from the profiles row, never from a JWT claim or from the request body.
// Returns { id } or { status, error }: 401 unauthorized (no/odd header, bad token, guest), 403 forbidden (signed in,
// not admin), 503 auth_unavailable (Auth or the profiles read is down: not a verdict on the caller).
export async function adminCaller(authorizationHeader, { getUser, getRole }) {
  const refuse = (status, error) => ({ status, error })
  const one = ONE_JWT.exec(authorizationHeader ?? '')
  if (!one) return refuse(401, 'unauthorized')
  let got
  try { got = await getUser(one[1]) } catch { return refuse(503, 'auth_unavailable') }
  const { data, error } = got ?? {}
  if (error && !(error.status > 0 && error.status < 500)) return refuse(503, 'auth_unavailable')
  const user = data?.user
  if (error || !user || typeof user.id !== 'string' || user.is_anonymous === true) return refuse(401, 'unauthorized')
  let prof
  try { prof = await getRole(user.id) } catch { return refuse(503, 'auth_unavailable') }
  if (!prof || prof.error) return refuse(503, 'auth_unavailable')
  if (prof.data?.role !== 'admin') return refuse(403, 'forbidden')
  return { id: user.id }
}
