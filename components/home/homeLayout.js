// Shared geometry for the hero / Oli overlap.
//
// ─── WHY A THIRD FILE RATHER THAN AN EXPORT FROM EITHER COMPONENT ───────────
// These two numbers are a CONTRACT between HomeHero and OliRow: the hero reserves space
// at the bottom of its content, and the Oli card is pulled up into exactly that space.
// They were previously exported from HomeHero and imported by OliRow, which worked while
// there was one number and made OliRow depend on the hero for a constant it needs before
// the hero renders. With two numbers and a mascot that now intrudes into the hero's own
// content box, a neutral module both can read is the honest shape — neither component
// owns the other's spacing.
//
// The rule they encode: THE HERO'S CONTENT MUST CLEAR EVERYTHING OLI OCCUPIES. Two
// components each carrying their own literal drift silently, and the symptom is a
// mis-tap — a control sitting underneath an opaque card — not a visual break.

// How far the Oli CARD is pulled up over the hero's bottom edge.
export const HERO_OVERLAP = 22

// How far the mascot rises ABOVE the card's top edge. He is a cut-out standing ON the
// banner, so he breaks its top line; this is that overhang.
//
// ⚠ DERIVED FROM HIS SIZE, NOT CHOSEN. His artwork's BOTTOM has always been pinned to
//   the card's bottom edge, so the overhang is simply (artwork height - card height).
//   Round 6 raised MASCOT_BOX 132 -> 158, which is what moved this 26 -> 48. If the box
//   changes again this number must be recomputed from OliRow's arithmetic, not nudged.
export const OLI_OVERHANG = 48

// Height of the keylined wordmark on the hero.
//
// ⚠ TWO HALVES OF ONE NUMBER. The keyline is BAKED into the asset at a radius chosen for
//   this exact render height (see assets/hero/ada-wordmark-keyline.json). Change this
//   without re-baking and the keyline is no longer 1pt on screen — thicker if the render
//   shrinks, thinner if it grows. `npm run logo:check` fails when the two disagree; that
//   guard exists because this is the class of bug that cost rounds 3 to 5.
export const HERO_LOGO_H = 72

// Breathing room between the hero's lowest content and the highest thing Oli occupies.
//
// ⚠ IT CLEARS THE hitSlop, NOT THE PIXELS. 10 was enough to stop the mascot's ears
//   overlapping the temperature chip visually, and still wrong: that chip carries
//   `hitSlop: 8`, and the Oli row's TouchableOpacity begins at exactly
//   HERO_OVERLAP + OLI_OVERHANG + HEADROOM above the hero's bottom. At 10 the chip's
//   lower slop reached 8pt INTO the Oli row's touch area, and because Oli renders later
//   it sits on top — so the bottom of the chip's target silently belonged to Oli.
//
//   Nothing looks wrong when that happens. A tap near the bottom of the temperature chip
//   just opens Ask Oli instead of the weather, which reads as a misfire rather than as a
//   layout bug, and is the exact class of defect this file exists to prevent.
//
//   20 puts the chip's full slop above the Oli row's first pixel with 2pt to spare.
const CLEARANCE = 20

// What the hero must reserve at the bottom of its content box.
//
// ⚠ DERIVED, NOT TYPED. It is the overlap PLUS the mascot's overhang, because the
//   mascot rises higher than the card does — so a hero that only cleared HERO_OVERLAP
//   would put the district name and the temperature chip underneath a donkey's ears.
//   That is precisely the failure this file exists to prevent, one component further on
//   from the version that only had to clear the card.
export const HERO_CONTENT_BOTTOM = HERO_OVERLAP + OLI_OVERHANG + CLEARANCE
