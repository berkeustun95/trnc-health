---
name: ada-ux-audit
description: UX audit lens for ADA (React Native / Expo): task flow, navigation and back behaviour, empty/loading/error states, copy, forms and multilingual layout. Use when auditing or reviewing any ADA screen or flow.
---

# UX audit (React Native)

## Check
- **Primary job:** what the user came to do is reachable in one look and one thumb-reach tap, in the
  lower two-thirds where possible. Mobile-first: one-handed phone use.
- **States, every data screen:** loading (`Skeleton`, `colors.soft` base, shaped like the content, no
  bare spinner on a full screen), empty (`EmptyState` with a next action), error (`ErrorState` with retry).
  A table that cannot legitimately be empty (duty roster, facilities) renders empty AS AN ERROR STATE.
  Offline: does it say so, or hang?
- **Navigation:** back returns where the user came from in ONE press, Android hardware back and iOS edge
  swipe alike (all back handling via `addBackListener`); a pin-opened partner screen returns to its map.
  No drawer, no hamburger.
- **Copy:** plain, specific, sentence case; the action names what happens; errors say what went wrong and
  what to do. All 9 languages exist; Turkish is the length stress test (also de, el, ru). ar/fa render RTL
  text in an LTR layout app-wide: known, not a per-screen finding.
- **Forms:** correct `keyboardType` / `autoComplete` / `textContentType`, `returnKeyType` chains, the
  keyboard never covers the active field or the submit button, inline validation next to the field.
- **Feedback:** every tap gets visible feedback within ~100ms; destructive actions confirm
  (`ConfirmDialog`); success is visible.
- **Trust & placement:** paid partner placements read as distinct from ADA's editorial content; ads only
  where `check-ad-placement.mjs` allows.

Rank by how many users hit it × how badly it blocks the task.
