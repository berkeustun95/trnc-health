import { View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, radius } from '../constants/theme'
import { t, LANG_CODES } from '../constants/i18n'
import { fallsBackToEnglish } from '../constants/petsContent'

// "The requirements below are in English, and here is why."
//
// ─── WHAT IT IS FOR ─────────────────────────────────────────────────────────
//
// The pets module's REGULATORY strings — import steps, waiting intervals, fees, banned
// breeds, airline policy, TRNC statute names — are deliberately not translated into the
// seven locales that lack them. A mistranslated "90 days after the titer blood draw" does
// not look wrong in any language; it looks like an instruction, and somebody follows it to
// an airport. So the English is kept and this explains the choice, IN THE READER'S OWN
// LANGUAGE, rather than leaving them to conclude the app is half-finished.
//
// Without it the fallback is indistinguishable from a bug — which is what it WAS until
// this slice: seven locales silently rendering English with nothing acknowledging it.
//
// ⚠ NEVER SHOWN TO en OR tr. Turkish already carries all 39 regulatory strings, fully
//   translated, and always has. The rule for this slice was that it ADDS and never
//   REMOVES, so tr keeps its own rule text and this notice would be a lie there.
//   fallsBackToEnglish() in constants/petsContent.js is the single source of that split —
//   the same constant validate-i18n-coverage.mjs reads, so the notice and the guard can
//   never disagree about which locales are affected.
//
// ⚠ ONE PER SCREEN, AT THE TOP. Not one per regulatory block: there are fifteen of those
//   across three screens, and a banner repeated fifteen times stops being read by the
//   third. It is placed above the first regulatory content so the reader meets the
//   explanation before the English, not after it.
export default function PetsRegulatoryNotice({ lang, style }) {
  if (!fallsBackToEnglish(LANG_CODES[lang] || 'en')) return null
  return (
    <View style={[s.wrap, style]}>
      <Ionicons name="language-outline" size={16} color={colors.textSecondary}
        style={{ marginTop: 1, flexShrink: 0 }} />
      <View style={s.body}>
        <Text style={s.title}>{t('petsRegulatoryNoticeTitle', lang)}</Text>
        <Text style={s.text}>{t('petsRegulatoryNoticeBody', lang)}</Text>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  // Deliberately QUIET — a bordered neutral card, not a warning. Nothing is wrong here and
  // nothing needs acting on; coral or amber would make a reader think the requirements
  // themselves were in doubt, which is the opposite of what this says.
  //
  // backgroundColor explicit: borderWidth + borderRadius on Android can render an opaque
  // background without it, and this is intended to be unfilled.
  wrap:  { flexDirection: 'row', gap: 10, padding: 12, marginBottom: 14,
           borderRadius: radius.card, borderWidth: 1, borderColor: colors.border,
           backgroundColor: 'transparent' },
  body:  { flex: 1 },
  title: { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 3 },
  text:  { fontSize: 12.5, lineHeight: 18, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
})
