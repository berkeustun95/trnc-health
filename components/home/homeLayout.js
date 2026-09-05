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
//
// 22 -> 40 on 2026-09-07. At 22 the banner read as sitting BELOW the photograph with a
// sliver of overlap; the draft has it sitting INTO the photo. 40 of the card's 88pt height
// is over the image — a little under half — which is enough to read as inset rather than
// adjacent, while leaving the card's own text block clear of the hero's bottom edge.
//
// It also pays for itself twice over. The hero's content box is padded by
// HERO_CONTENT_BOTTOM, which is derived from this, so a deeper overlap moves the district
// text LOWER — into a stronger part of the bottom scrim, where it measures better. And the
// darkest 40pt of that scrim is now hidden behind the card, so the ramp can be deepened
// without the murk showing.
export const HERO_OVERLAP = 40

// How far the mascot rises ABOVE the card's top edge.
//
// ⚠ ZERO SINCE 2026-09-07, AND THAT IS THE POINT RATHER THAN AN OMISSION. He used to be a
//   cut-out standing ON the banner and breaking its top line — MASCOT_BOX 158 put 48pt of
//   him above the card. The brief is now that he sits INSIDE it. At MASCOT_BOX 88 his
//   artwork is 75.7pt tall in an 88pt card, so he clears the top edge by 6.3pt and the
//   overhang is nothing.
//
//   It stays a NAMED CONSTANT at zero rather than being deleted, because it is what the
//   hero reserves space from (HERO_CONTENT_BOTTOM below) and what the geometry guard
//   compares his ink against. Deleting it would scatter the assumption "he does not stick
//   out" across three files instead of stating it in one.
//
//   Still derived, not chosen: it is max(0, artwork height + inset - card height) from
//   OliRow's own numbers. `npm run home:check` recomputes it and fails if they disagree.
export const OLI_OVERHANG = 0

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
//
//   ⚠ RE-VERIFIED 2026-09-07 after the mascot shrank and the overlap deepened. Both moved
//     the boundary this number defends. The Oli row's first pixel is still exactly
//     HERO_OVERLAP + OLI_OVERHANG + HEADROOM above the hero's bottom — 40 + 0 + 0 = 40 —
//     and the temperature text's bottom sits at HERO_CONTENT_BOTTOM = 60, so its 8pt lower
//     slop reaches 52 and clears Oli's 40 by 12pt. More margin than before, not less,
//     because the overhang and headroom that used to eat into it are gone.
const CLEARANCE = 20

// What the hero must reserve at the bottom of its content box.
//
// ⚠ DERIVED, NOT TYPED. It is the overlap PLUS the mascot's overhang PLUS the clearance.
//   The overhang term is zero today — he sits inside the card — so what the hero actually
//   reserves is 40 + 20 = 60. The term stays in the expression because it is what makes
//   this correct for a mascot that sticks out again: when he did, at OLI_OVERHANG 48, a
//   hero clearing only HERO_OVERLAP would have put the district name and the temperature
//   underneath a donkey's ears. That failure is why this file exists, and the arithmetic
//   that prevents it should not be quietly deleted just because one of its terms is
//   currently zero.
export const HERO_CONTENT_BOTTOM = HERO_OVERLAP + OLI_OVERHANG + CLEARANCE
