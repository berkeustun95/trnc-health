// ─── Oli companion (Home lab, Variant B): the contextual line on the Oli bar pill ─────────────
// Pure data + one function, no React. Returns an i18n KEY, or null (= today's 'hrOliAskSub').
// The key list is exported so scripts/check-tile-labels.mjs measures every one it can return.
//
// Priority: an event tonight → rain → morning → evening → night → null.
// The strip item is the one HomeScreen already resolved (utils/homeStripResolver.js): an event
// carries kind 'event' and `startsAt` (ms); the generic card has `generic: true` and no startsAt.

export const OLI_PILL_KEYS = ['hrOliCtxEventTonight', 'hrOliCtxRain', 'hrOliCtxMorning', 'hrOliCtxEvening', 'hrOliCtxNight']

const RAIN_GROUPS = ['rain', 'drizzle', 'showers', 'thunder']   // weatherGroup() outputs

function eventTonight(now, stripItem) {
  if (!stripItem || stripItem.kind !== 'event' || stripItem.generic) return false
  if (typeof stripItem.startsAt !== 'number') return false
  const s = new Date(stripItem.startsAt)
  return s.toDateString() === now.toDateString() && s.getHours() >= 17
}

export function oliPillKey({ now = new Date(), wxGroup = null, stripItem = null } = {}) {
  if (eventTonight(now, stripItem)) return 'hrOliCtxEventTonight'
  if (RAIN_GROUPS.includes(wxGroup)) return 'hrOliCtxRain'
  const h = now.getHours()
  if (h >= 5 && h < 11) return 'hrOliCtxMorning'
  if (h >= 18 && h < 23) return 'hrOliCtxEvening'
  if (h >= 23 || h < 5) return 'hrOliCtxNight'
  return null
}
