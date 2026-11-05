// Who may run a cron-only function: a caller presenting one of this project's secret keys.
//
// Since 2026-11-03 the gateway refuses the legacy service_role JWT ("Legacy API keys are disabled"), and verify_jwt
// only understands JWTs, so it cannot accept a sb_secret_ key either. These functions therefore run with
// verify_jwt = false and this is their ONLY gate: call it first, before any other work.
// The platform injects SUPABASE_SECRET_KEYS as a JSON object of { name: key }.
export function callerHoldsSecretKey(req, env) {
  const tok = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!tok) return false
  let keys = []
  try { keys = Object.values(JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}')) } catch { return false }
  return keys.some(k => typeof k === 'string' && k.length > 0 && k === tok)
}
