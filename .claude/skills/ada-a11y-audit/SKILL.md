---
name: ada-a11y-audit
description: Accessibility audit lens for ADA (React Native / Expo): contrast, touch targets ≥44pt, screen-reader roles and labels, font scaling, reduce motion. Use when auditing or reviewing any ADA screen or component.
---

# Accessibility audit (React Native, not web)

## Check
- **Contrast:** body text ≥ 4.5:1, large text (≥ 18pt, or 14pt bold) and UI boundaries/icons ≥ 3:1.
  Compute with `contrastRatio(fg, bg)` from `constants/theme.js` (run it with node) and print both hex
  values with the ratio. On photos, measure against the WORST pixel (white) under the scrim, as
  `check-hero-contrast.mjs` does. Known-good pairs are documented in theme.js comments.
- **Touch targets:** every tappable ≥ `TAP` (44×44pt). A smaller visual is fine only with `hitSlop`
  making up the difference; measure the visual + hitSlop. Adjacent targets ≥ 8pt apart.
- **Screen reader (TalkBack / VoiceOver):** every touchable has `accessibilityRole` (button, link, tab,
  header, image, switch) and an `accessibilityLabel` when its content is an icon or is ambiguous;
  selected/disabled/expanded via `accessibilityState`; cards that are one action are grouped with
  `accessible` so they read once; decorative images `accessible={false}` / `importantForAccessibility="no"`.
  Labels come from `t()` in the user's language, never hardcoded English.
- **Font scaling:** layouts survive fontScale 1.3 (Android "Largest" ~1.3; `labels:check` tests 1.3).
  `maxFontSizeMultiplier` only where a fixed box truly cannot grow (tile labels), never on body text.
- **Reduce motion:** non-essential animation is skipped when `AccessibilityInfo.isReduceMotionEnabled()`
  is true (only `OliBar.js` checks today; any new motion should too).
- **Colour is never the only signal:** status (open/closed, on duty, error) also has text or an icon.
- **Focus order:** reading order matches visual order; modals/sheets trap focus and announce a title.

Report each finding with the measured value beside the requirement (e.g. "36×36pt, no hitSlop; needs 44").
