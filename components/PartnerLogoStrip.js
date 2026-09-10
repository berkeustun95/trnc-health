import { View, Image, StyleSheet } from 'react-native'

// A partner's wordmark in a WIDE STRIP, left-aligned.
//
// ─── WHY A STRIP AND NOT THE 46px SQUARE IT REPLACES ────────────────────────
// TadilArt's mark is a 1600x455 wordmark — 3.5:1. Dropped into a square slot it
// rendered about 11pt tall and could not be read, which is worse than no logo: an
// illegible smudge where a brand should be reads as a broken image.
//
// This is the shape for EVERY partner, not a TadilArt accommodation. A square mark is
// handled by construction rather than by a special case: the fit below takes the
// SMALLER of the box height and the height the width allows, so a 1:1 logo lands as a
// height x height square pinned to the left of the strip, with the remaining width
// simply unused. Nothing needs to know which kind of mark it is holding.
//
// ─── resizeMode DOES NOT DO THIS ────────────────────────────────────────────
// 'contain' fits, but it CENTRES what it fits — there is no left-aligned contain in
// React Native. So the Image is measured and sized explicitly instead:
// Image.resolveAssetSource is synchronous for a bundled asset (it reads the manifest
// Metro produced at build time; it is only async for a remote uri), which is why this
// can be done during render with no layout flash and no state.
//
// The alternative — a full-width Image with resizeMode 'contain' — was rejected because
// it centres a 3.5:1 wordmark in a 244pt card and leaves it floating, and because
// nothing then stops a future square logo being blown up to 140pt tall.

export default function PartnerLogoStrip({
  source,                 // a require()'d asset, or undefined/null while none is wired
  name,                   // for the monogram fallback and the accessibility label
  width,
  height,
  style,
}) {
  const meta   = source ? Image.resolveAssetSource(source) : null
  const aspect = meta && meta.height ? meta.width / meta.height : null

  // ─── NO LOGO RENDERS NOTHING AT ALL ────────────────────────────────────────
  //
  // This used to draw an initials monogram: a teal rounded box with the partner's two
  // initials in white, on the argument that it was a finished state rather than a
  // placeholder. THAT ARGUMENT WAS WRONG, and device testing is what showed it.
  //
  // "Alasia Dorm" resolves to the initials **AD**, and ADA serves labelled banner
  // advertising. A teal badge reading AD, sitting at the top of a partner's own card, is
  // indistinguishable from an ad marker — so the monogram did not merely fail to help,
  // it actively mislabelled a paying partner's listing as an advert. No other partner
  // name is safe from this either: the failure is that a two-letter mark on a coloured
  // chip is ad-shaped, and which two letters it happens to be is luck.
  //
  // Returning null takes the `style` prop's margin with it, so the card closes up and its
  // height follows its content. That is deliberate — a reserved empty slot was the other
  // half of the same finding.
  //
  // ⚠ components/TowingLogo.js STILL HAS ITS OWN MONOGRAM, a separate implementation with
  //   the same shape. It was left alone because towing is a different module and was not
  //   in scope, not because it is safe — the same "AD"-shaped reading is available there
  //   the moment a firm's initials land badly.
  if (!source || !aspect) return null

  // Fit INSIDE the box on both axes and never upscale past it. min() is what makes a
  // square mark a square and a wordmark a full-width strip, with one expression.
  const h = Math.min(height, width / aspect)
  const w = h * aspect

  return (
    <View style={[s.row, { width, height }, style]}>
      <Image
        source={source}
        style={{ width: w, height: h }}
        resizeMode="contain"
        accessibilityLabel={name || ''}
      />
    </View>
  )
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start' },
})
