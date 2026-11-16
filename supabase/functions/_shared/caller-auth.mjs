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

export async function serviceCaller(authorizationHeader, serviceKey) {
  const m = /^Bearer (.+)$/.exec(authorizationHeader ?? '')
  if (!m) return null
  const token = m[1]
  if (typeof serviceKey === 'string' && serviceKey.length > 0) {
    const [a, b] = await Promise.all([digest(token), digest(serviceKey)])
    let diff = 0
    for (let i = 0; i < 32; i++) diff |= a[i] ^ b[i]
    if (diff === 0) return 'exact'
  }
  return jwtRole(token) === 'service_role' ? 'role' : null
}
