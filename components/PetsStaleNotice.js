import { View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, radius } from '../constants/theme'
import { t } from '../constants/i18n'
import { showUserStaleNotice, verifiedLabel } from '../constants/petsContent'
import VetDeptActions from './VetDeptActions'

// "We last checked these rules in <month>, and that was a while ago."
//
// ─── THE SECOND OF TWO THRESHOLDS, AND THE ONLY ONE A USER EVER SEES ────────
//
// 90 days turns scripts/check-pets-staleness.mjs red — that is the TEAM being told, in a
// terminal, with a full quarter to make one phone call. 180 days is this: the point at
// which we have demonstrably failed to check and owe the user the truth.
//
// The gap is deliberate and the ordering is asserted by the guard. Telling users "this may
// be out of date" has a real cost — it devalues content that is probably still correct —
// so it should not be the first response to a missed review, only the last.
//
// ─── WHY IT CARRIES ACTIONS AND NOT JUST A WARNING ──────────────────────────
//
// A notice that says "this might be wrong" and stops there leaves somebody stuck with a
// problem they cannot act on, which is worse than the stale content: it removes trust
// without offering a way to restore it. VetDeptActions puts the phone number and the
// email one tap away, so the sentence ends in something the reader can DO.
//
// ⚠ ALL NINE LOCALES. Unlike the regulatory copy this is ADA's own wrapper text — our
//   admission about our own process, not a rule — so every reader gets it in their own
//   language. The date inside it is localised too, via verifiedLabel(), which routes
//   through constants/months.js rather than toLocaleDateString: that file MEASURED that
//   Intl resolves Persian to the Jalali calendar, so a naive format would have shown a
//   Persian reader a month that is not the month meant.
//
// ⚠ THE CLOCK IS READ AT RENDER, not captured. A long-lived session must start showing
//   this the moment it crosses the threshold, not on next launch.
export default function PetsStaleNotice({ lang, style }) {
  if (!showUserStaleNotice()) return null
  return (
    <View style={[s.wrap, style]}>
      <View style={s.row}>
        <Ionicons name="alert-circle-outline" size={17} color={colors.accent}
          style={{ marginTop: 1, flexShrink: 0 }} />
        <View style={s.body}>
          <Text style={s.title}>{t('petsStaleNoticeTitle', lang)}</Text>
          <Text style={s.text}>
            {t('petsStaleNoticeBody', lang).replace('{date}', verifiedLabel(lang))}
          </Text>
        </View>
      </View>
      <VetDeptActions lang={lang} />
    </View>
  )
}

const s = StyleSheet.create({
  // Accent-tinted, unlike PetsRegulatoryNotice's neutral card. This one IS a warning and
  // does need acting on, so the two must not look alike — a reader who has learned to skip
  // the quiet language notice must still stop at this one.
  wrap:  { padding: 12, marginBottom: 14, borderRadius: radius.card,
           borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.accentLight },
  row:   { flexDirection: 'row', gap: 10 },
  body:  { flex: 1 },
  title: { fontSize: 13.5, fontFamily: 'Inter_700Bold', color: colors.accent, marginBottom: 3 },
  text:  { fontSize: 12.5, lineHeight: 18, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
})
