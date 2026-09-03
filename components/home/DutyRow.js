import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors } from '../../constants/theme'
import { t } from '../../constants/i18n'
import { DUTY_FRESH, DUTY_PARTIAL } from '../../utils/dutyStatus'

// Nöbetçi eczaneler — the permanent duty-pharmacy row, directly under the live strip.
//
// ─── THREE STATES, NOT ONE ──────────────────────────────────────────────────
// The mockup shows only the healthy pink row, and shipping only that would re-create the
// exact failure this app has already inflicted on users: the duty roster ran out on
// 2026-06-30 and for two months the app told people there was no duty pharmacy tonight,
// when the truth was that WE had lost the list. There is always a duty pharmacy in the
// TRNC, so that message never described the world.
//
//   DUTY_FRESH    pale pink surface, coral icon square — the mockup's row
//   DUTY_PARTIAL  "Tonight's list looks incomplete" — the list IS current, it just does
//                 not cover the country. Saying "not current" here would be false, and a
//                 user who taps through to a notice that contradicts the banner trusts
//                 neither.
//   stale         "Duty list isn't current" — alert styling
//
// Both unhealthy states keep the row TAPPABLE and keep it pointing at DutyListScreen,
// which carries the KTEB fallback. Telling somebody the roster is thin and then refusing
// to open it would be worse than the banner that started this.
//
// Copy keys are the same ones the V1 banner used, so the three states have one wording
// between the two layouts and cannot drift while both ship in one bundle.
export default function DutyRow({ lang, status = DUTY_FRESH, onPress, innerRef }) {
  const ok      = status === DUTY_FRESH
  const partial = status === DUTY_PARTIAL

  return (
    <TouchableOpacity
      ref={innerRef}
      style={[s.row, !ok && s.rowAlert]}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
    >
      <View style={[s.iconSquare, !ok && s.iconSquareAlert]}>
        <Ionicons
          name={ok ? 'medical' : 'alert-circle-outline'}
          size={22}
          color={ok ? colors.accent : colors.danger}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.title, !ok && { color: colors.danger }]} numberOfLines={1}>
          {t(ok ? 'tonightDuty' : partial ? 'dutyBannerPartialTitle' : 'dutyBannerStaleTitle', lang)}
        </Text>
        <Text style={[s.sub, !ok && s.subAlert]} numberOfLines={1}>
          {t(ok ? 'homeDutySub' : 'dutyBannerStaleSub', lang)}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={ok ? colors.accent : colors.danger} />
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  row:             { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.accentLight, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: colors.accent + '30' },
  rowAlert:        { backgroundColor: colors.dangerLight, borderColor: colors.danger },
  iconSquare:      { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.accent + '22', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  iconSquareAlert: { backgroundColor: '#fff' },
  title:           { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.accent },
  sub:             { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.accent + 'AA', marginTop: 1 },
  subAlert:        { color: colors.danger + 'CC' },
})
