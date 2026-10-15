---
name: ada-feel-better
description: "Make interfaces feel better" lens for ADA (React Native / Expo): press feedback, haptics, perceived speed, skeletons, optical details and polish that separate a production app from a functional one. Use when auditing or polishing any ADA screen.
---

# Make it feel better (React Native)

Small details, each cheap, that together read as quality. Find where they are missing.

- **Press feedback:** every touchable responds: `activeOpacity` = `press.small` (0.7) for controls,
  `press.card` (0.85) for cards. No dead taps, no feedback on non-tappable things.
- **Haptics:** `haptic()` from `components/ui/haptics.js` on meaningful moments only (toggle, favourite,
  confirm, pull-to-refresh trigger), never on every tap.
- **Perceived speed:** content-shaped `Skeleton` instead of a spinner; keep previous content while
  refreshing; images fade in (`RemoteImage`/`PhotoFade`) with a fixed aspect box so nothing jumps.
- **No layout shift:** fixed heights for async rows, reserved space for images and badges; numbers that
  update use tabular figures (`fontVariant: ['tabular-nums']`).
- **Optical details:** icon optically centred in its well; text vertically centred in pills (check
  `lineHeight`); consistent corner radii by hierarchy (outer radius = inner radius + padding);
  shadows soft and from one light source (`elevation.*` only).
- **Edges:** safe-area insets respected top and bottom; content clears the floating tab bar
  (`useTabBarFootprint`); lists end with `listBottomPad(insets)`; status-bar style matches what is under it.
- **Scroll:** pull-to-refresh where data is live; `keyboardShouldPersistTaps="handled"` in forms;
  headers that stay pinned have `flexShrink: 0`.
- **Empty and done states** have personality through clear copy and the right icon, not decoration.

Every proposal names the exact component, prop and token.
