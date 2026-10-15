---
name: ada-motion
description: Animation and motion lens for ADA (React Native / Expo SDK 54): when to animate, durations from theme motion tokens, native-driver Animated, sheets, transitions and reduce motion. Use when auditing, adding or reviewing motion in ADA.
---

# Motion (React Native)

ADA has NO Reanimated or Gesture Handler in package.json. Adding either is a native dependency: ask
Berke first (native build, versions pinned to SDK 54). Use RN `Animated` / `LayoutAnimation`.

## Rules
- **Animate only to explain a change:** something appeared, moved, opened, was confirmed. No ambient,
  looping or decorative motion; no fade-up on every row (one orchestrated entrance at most per screen).
  Sanctioned exception: `OliBar`'s crossfade (Berke's Home v3 call; pauses off-screen, in background and
  under Reduce Motion). Do not flag it; any NEW ambient motion needs Berke's call.
- **Durations:** `motion.fast` 180 (press, small state changes), `motion.base` 250 (content swap),
  `motion.sheetIn` 280 / `sheetOut` 220 (sheets: exits faster than entries), `motion.spring`
  {bounciness 4, speed 12}. No raw durations.
- **Easing:** entering = decelerate (`Easing.out`), leaving = accelerate (`Easing.in`); springs for things
  the finger moved.
- **Thread:** `useNativeDriver: true` for opacity and transform; never animate width/height/top/left
  on a scrolling list (JS-thread animation drops frames on low-end Android).
- **Interruptible:** a second tap mid-animation must not queue or jump; stop/reverse the running one.
- **Reduce motion:** check `AccessibilityInfo.isReduceMotionEnabled()` (see `OliBar.js`) and replace
  movement with an instant change or a short fade.
- **Sheets & modals:** use `components/ui/BottomSheet.js`; backdrop fades, sheet slides; back handled via
  `addBackListener`.

## Audit
Name each motion: trigger → property → duration/easing → token it should use → reduce-motion behaviour.
Motion cannot be judged from a still screenshot: say "needs device check" rather than guessing feel.
