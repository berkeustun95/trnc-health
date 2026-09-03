import { View, StyleSheet } from 'react-native'

// home_footer — a reserved-height placeholder, and deliberately nothing else.
//
// ─── NO SDK, NO NETWORK, NO AD CODE ─────────────────────────────────────────
// There is no ad component anywhere in this repo and no slot definitions; adding an ad
// SDK is a decision the project owner takes, not a side effect of a layout slice
// (CLAUDE.md: do not add analytics, tracking or third-party SDKs without asking). So
// this reserves the space and renders nothing into it.
//
// ─── AND IT CANNOT SHIP AN AD WITHOUT ONE MORE DECISION BEING MADE ──────────
// ADA is a declared MIXED-AUDIENCE app since 2026-08-29 (target ages 13-15 / 16-17 /
// 18+). Users whose date_of_birth indicates UNDER 18 must receive NON-PERSONALIZED ads,
// and one non-compliant SDK makes the whole app ineligible under Families policy. The
// DOB needed to make that distinction is already in profiles and already loaded into
// PROFILE_COLUMNS, so the branch is cheap — but it is a LAUNCH requirement, not a
// follow-up, and it does not exist yet. Reserving the height without filling it is the
// only version of this slot that is correct today.
//
// Height is reserved rather than zero so that the day something does fill it, the page
// does not suddenly grow by 60pt under a user's thumb.
export default function HomeFooterSlot() {
  return <View style={s.slot} pointerEvents="none" />
}

const s = StyleSheet.create({
  // Transparent, not a tinted box. A visible empty grey rectangle at the bottom of Home
  // reads as a failed image load, and shipping one behind a flag that is already on for
  // everyone (this component is not gated — only the V2 hub that renders it is) would be
  // a visible defect in exchange for nothing. It reserves the space and shows nothing.
  slot: { height: 60 },
})
