import { supabase } from '../lib/supabase'
import { AD_ROUTES, AD_POSITIONS, AD_MODULES } from '../constants/ads'

// ─── Which ad, if any, is live in a placement right now ─────────────────────
//
// A placement is POSITION x MODULE — "list_top on accommodation" — not a flat slot id.
// Both halves are required and both are validated against the vocabulary before the
// query, because a missing module would widen the read to every module's inventory for
// that position rather than returning nothing.
//
// Returns a row or null. NULL IS THE NORMAL CASE and it means "unsold": the slot collapses
// to zero height and the screen looks exactly as it does with no ad system at all.
// Schema, RLS and the tie-break: supabase/migrations/20261008_ad_banners.sql.
//
// ─── EVERY FAILURE IS AN UNSOLD SLOT ────────────────────────────────────────
//
// Offline, RLS-empty, table absent (42P01 — the state this ships in until the DDL is
// applied), a malformed row: all of them return null, and null renders nothing. There is
// no error state to design because there is nothing an error could usefully say to a user
// about an advert. The ONE thing that must never happen is a broken-looking box on Home.
//
// ─── THE TIE-BREAK ──────────────────────────────────────────────────────────
//
//     starts_at DESC, created_at DESC, id
//
// Newest campaign wins, so a takeover can be sold OVER a standing placement without first
// deactivating it. `id` is the final term so the order is TOTAL — two rows sharing a start
// and a creation timestamp still resolve to the same one on every device, rather than to
// whatever the planner happened to return. The index idx_ad_banners_slot_live carries the
// first two terms; correctness comes from this ORDER BY, not from the index.
//
// ─── THE WINDOW IS FILTERED TWICE, AND THAT IS DEFENCE, NOT THE BOUNDARY ────
//
// ad_banners_select_public already enforces is_active + the flight window, so an expired
// campaign is not merely undrawn, it is unreadable. This repeats it because a client-side
// filter costs nothing and a future loosening of the policy should not silently resurrect
// a finished campaign. If the two ever disagree, the POLICY is the one that is true.
export async function fetchAdForSlot(position, module) {
  try {
    // Both halves, or nothing. A missing module used to be expressible as a missing slot
    // id; now it would silently widen the query to every module's inventory for that
    // position — an accommodation advertiser's banner appearing on Events.
    if (!position || !module) return null
    if (!AD_POSITIONS.includes(position) || !AD_MODULES.includes(module)) {
      if (__DEV__) console.warn(`[fetchAdForSlot] unknown placement ${position}/${module}`)
      return null
    }
    const nowIso = new Date().toISOString()
    const { data, error } = await supabase
      .from('ad_banners')
      .select('id, position, module, advertiser_name, image_url, link_url, route')
      .eq('position', position)
      .eq('module', module)
      .eq('is_active', true)
      .lte('starts_at', nowIso)
      .gte('ends_at', nowIso)
      .order('starts_at',  { ascending: false })
      .order('created_at', { ascending: false })
      .order('id',         { ascending: true })
      .limit(1)
    if (error) {
      // 42P01 (table absent) is EXPECTED until the migration is applied and must stay
      // quiet even in development — it is the shipping state, not a mistake.
      if (__DEV__ && error.code !== '42P01' && error.code !== 'PGRST205') {
        console.warn('[fetchAdForSlot]', `${position}/${module}`, error.message)
      }
      return null
    }
    const row = (data || [])[0]
    return row && isRenderable(row) ? row : null
  } catch (e) {
    if (__DEV__) console.warn('[fetchAdForSlot] threw:', e?.message || e)
    return null
  }
}

// ─── A ROW THE APP CANNOT HONOUR IS TREATED AS UNSOLD ───────────────────────
//
// The database constrains all of this already (ad_banners_destination_check,
// ad_banners_route_check, ad_banners_link_scheme_check). This is not distrust of those
// constraints — it is that the consequence of one drifting is specific and bad: a PAID
// banner that renders and does nothing when tapped. That reads to the advertiser as the
// app being broken, and it is invisible to us because nothing errors.
//
// So the rule is: if this build cannot resolve the destination, do not draw the ad. An
// empty slot is honest; a dead one is not. A dropped ad is also loud in exactly the right
// way — the advertiser notices immediately, which is the fastest possible bug report.
function isRenderable(row) {
  if (!row.image_url || !/^https:\/\//.test(row.image_url)) return false
  const hasLink  = !!row.link_url
  const hasRoute = !!row.route
  if (hasLink === hasRoute) return false            // exactly one, never both, never neither
  if (hasLink)  return /^https:\/\//.test(row.link_url)
  // An unknown route means THIS BUNDLE has no handler for it — which is also what happens
  // to an older app after a new route id is added. Dropping the ad is right in both cases.
  return AD_ROUTES.includes(row.route)
}
