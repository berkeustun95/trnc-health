// ada://<route>[/<id>] → { route, id } for the home-screen widgets (and any later link).
// Sign-in links (Supabase confirm / recovery) are NOT routes: they carry one of AUTH_PARAMS and
// stay with App.js's own auth handler, so this returns null for them.
// Unknown routes return null too — the app stays where it is rather than guessing a screen.
const ROUTES = new Set([
  'duty', 'kesfet', 'explore', 'eatery', 'emlak', 'duyurular', 'events',
  // Kept for later widgets/links; App.js opens them only once their module is live.
  'araclar', 'dukkan',
])
const AUTH_PARAMS = ['token_hash', 'code', 'access_token', 'refresh_token', 'error', 'error_code']

export function parseAdaRoute(url) {
  if (typeof url !== 'string' || !url.startsWith('ada://')) return null
  let parsed
  try { parsed = new URL(url.replace('ada://', 'https://x/')) } catch { return null }
  const hash = new URLSearchParams(parsed.hash.replace(/^#/, ''))
  if (AUTH_PARAMS.some(p => parsed.searchParams.has(p) || hash.has(p))) return null
  const [route, id] = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  if (!ROUTES.has(route)) return null
  return { route, id: id || null }
}
