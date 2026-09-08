import { View, Text, Image, StyleSheet } from 'react-native'
import { colors } from '../constants/theme'

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

  if (!source || !aspect) {
    // Finished state, not a placeholder box — same posture as components/TowingLogo.js.
    // A square monogram at the strip's height, left-aligned, so the row is the same
    // height whether or not a logo has been wired.
    return (
      <View style={[s.row, { width, height }, style]}>
        <View style={[s.mono, { width: height, height, borderRadius: Math.round(height * 0.22) }]}>
          <Text style={[s.monoText, { fontSize: Math.round(height * 0.36) }]} numberOfLines={1}>
            {initials(name)}
          </Text>
        </View>
      </View>
    )
  }

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

function initials(name) {
  const words = String(name || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toLocaleUpperCase('tr')
  return (words[0][0] + words[1][0]).toLocaleUpperCase('tr')
}

const s = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start' },
  mono:     { backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden' },
  monoText: { color: '#FFFFFF', fontFamily: 'Inter_700Bold', letterSpacing: 0.5 },
})
