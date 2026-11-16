import { View, Text, Linking, StyleSheet } from 'react-native'
import { colors } from '../constants/theme'
import { creditParts } from '../utils/photoCreditParts'

// The photo-credit BODY: creator, licence, source — rendered once, used by every surface
// that shows a third-party photo.
//
// ─── EXTRACTED FROM ExploreProfileScreen, NOT REWRITTEN ─────────────────────
// This is that screen's PhotoAttribution with the resolve step lifted out. The two
// surfaces that need it disagree about the CONTAINER — Explore renders a small caption
// under the photo, the Home hero renders a sheet behind an ℹ︎ chip — but they must not
// disagree about which fields appear, in what order, or what is tappable. A second
// implementation of that is a second chance to publish an image with the creator's name
// missing, which is not a styling bug.
//
// ─── WHY EVERY ROW IS A ROW, AND WHY flexShrink IS LOAD-BEARING ─────────────
// The credit sits in a flexDirection:'row' container so the licence and source can follow
// it. In a row, a Text that cannot shrink pushes its siblings off-screen instead of
// wrapping — which is how PropertyDetailScreen's contact bar clipped at "Hüseyin Kamb…",
// roughly the SHORTEST plausible Turkish name. Turkish photographer names are long
// ("Hüseyin Kambüroğlu") and this app also carries Cyrillic ones, so flexShrink:1 with no
// numberOfLines is what makes them wrap onto a second line rather than truncate.
//
// ⚠ DO NOT ADD numberOfLines ANYWHERE IN HERE. A truncated credit is a broken
//   attribution, not a cosmetic problem — it is the one string in the app whose
//   correctness is a licence condition rather than a preference.
//
// `a` is a resolved attribution: {credit, license, licenseUrl, sourceUrl, source}.
// Callers pass whatever their own data shape resolves to — utils/photoAttribution.js's
// resolveAttribution() for a place row, resolveHeroCredit() for a bundled hero.
// A null `a` renders NOTHING, never a blank line.
//
// What is rendered comes from creditParts() (utils/photoCreditParts.js): strings or null only,
// links https only. A link opens through openLink(), which never throws or rejects.
const openLink = url => {
  try { Promise.resolve(Linking.openURL(url)).catch(() => {}) } catch {}
}

export default function PhotoCredit({ a, lang, style, textStyle }) {
  if (!a) return null

  const { line, license, licenseUrl, sourceLabel, sourceUrl } = creditParts(a, lang)
  const hasMeta = !!license || !!sourceLabel

  return (
    <View style={style}>
      {!!line && (
        <View style={s.creditRow}>
          <Text style={[s.photoCredit, textStyle]}>
            {line}
          </Text>
        </View>
      )}

      {hasMeta && (
        <View style={s.creditMetaRow}>
          {!!license && (licenseUrl ? (
            <Text
              style={[s.photoCreditMeta, s.creditLink, textStyle]}
              accessibilityRole="link"
              accessibilityLabel={t('photoLicenseA11y', lang)}
              onPress={() => openLink(licenseUrl)}
            >{license}</Text>
          ) : (
            <Text style={[s.photoCreditMeta, textStyle]}>{license}</Text>
          ))}

          {!!license && !!sourceLabel && <Text style={[s.creditDot, textStyle]}>·</Text>}

          {!!sourceLabel && (sourceUrl ? (
            <Text
              style={[s.photoCreditMeta, s.creditLink, textStyle]}
              accessibilityRole="link"
              accessibilityLabel={t('photoSourceA11y', lang)}
              onPress={() => openLink(sourceUrl)}
            >{sourceLabel}</Text>
          ) : (
            <Text style={[s.photoCreditMeta, textStyle]}>{sourceLabel}</Text>
          ))}
        </View>
      )}
    </View>
  )
}

// Copied VERBATIM from ExploreProfileScreen's block so the extraction is
// behaviour-preserving — same values, same gaps, same flexShrink. Only `creditWrap`
// stayed behind: it carried that screen's own paddingHorizontal:16, which is a position
// on a page, not a property of a credit. Callers pass their own container via `style`.
const s = StyleSheet.create({
  creditRow:       { flexDirection: 'row' },
  creditMetaRow:   { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  photoCredit:     { flexShrink: 1, fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  photoCreditMeta: { flexShrink: 1, fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  creditLink:      { color: colors.primary, textDecorationLine: 'underline' },
  creditDot:       { fontSize: 11, color: colors.textSecondary },
})
