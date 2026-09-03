import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'
import { colors } from '../../constants/theme'
import { t } from '../../constants/i18n'
import { DUTY_FRESH, DUTY_PARTIAL } from '../../utils/dutyStatus'

// Nöbetçi eczaneler — the permanent duty-pharmacy row.
//
// ─── THREE STATES, NOT ONE ──────────────────────────────────────────────────
// The design draft shows only the healthy row, and shipping only that would re-create
// the exact failure this app has already inflicted on users: the duty roster ran out on
// 2026-06-30 and for two months the app told people there was no duty pharmacy tonight,
// when the truth was that WE had lost the list. There is always a duty pharmacy in the
// TRNC, so that message never described the world.
//
//   DUTY_FRESH    pale pink surface, coral icon tile, dark title
//   DUTY_PARTIAL  "Tonight's list looks incomplete" — the list IS current, it just does
//                 not cover the country. Saying "not current" here would be false, and a
//                 user who taps through to a notice that contradicts the banner trusts
//                 neither.
//   stale         "Duty list isn't current"
//
// ⚠ THE RESTYLE KEPT ALL THREE, AND KEPT THEM DISTINGUISHABLE. The draft's calmer
//   treatment moved the title from coral to near-black, which on its own would have made
//   the healthy and unhealthy rows look identical — the old design carried the alarm
//   ENTIRELY in the title colour. So the unhealthy states now change four things at
//   once: surface, border, icon tile, icon glyph, and the title goes danger-red rather
//   than merely dark. A stale roster must never be able to read as the healthy state.
//
// Both unhealthy states keep the row TAPPABLE and still pointing at DutyListScreen,
// which carries the KTEB fallback. Telling somebody the roster is thin and then refusing
// to open it would be worse than the banner that started this.
//
// Copy keys are the ones the V1 banner used, so the three states have one wording
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
      {/* Rounded-square SOLID coral tile with a white glyph — the draft's treatment.
          A medical cross, not the asterisk-shaped 'medical' Ionicon, which at 22pt read
          as a sparkle rather than as anything to do with a pharmacy. */}
      <View style={[s.iconTile, !ok && s.iconTileAlert]}>
        {ok
          ? <MaterialCommunityIcons name="medical-bag" size={22} color="#fff" />
          : <Ionicons name="alert-circle" size={22} color="#fff" />}
      </View>

      <View style={s.text}>
        <Text style={[s.title, !ok && s.titleAlert]} numberOfLines={1}>
          {t(ok ? 'tonightDuty' : partial ? 'dutyBannerPartialTitle' : 'dutyBannerStaleTitle', lang)}
        </Text>
        <View style={s.subRow}>
          <Ionicons
            name={ok ? 'location-outline' : 'information-circle-outline'}
            size={12}
            color={ok ? colors.accent : colors.danger}
          />
          <Text style={[s.sub, !ok && s.subAlert]} numberOfLines={1}>
            {t(ok ? 'homeDutySub' : 'dutyBannerStaleSub', lang)}
          </Text>
        </View>
      </View>

      <Ionicons name="chevron-forward" size={18} color={ok ? colors.accent : colors.danger} />
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  row:           { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.accentLight,
                   borderRadius: 18, padding: 14, borderWidth: 1, borderColor: colors.accent + '2E' },
  rowAlert:      { backgroundColor: colors.dangerLight, borderColor: colors.danger },
  // #E8613A, NOT colors.accent. accent (#FF8552) is a light coral and a white glyph on
  // it is 2.41:1 — under the 3:1 floor for a UI component, i.e. the pharmacy cross was
  // going to be hard to make out for exactly the users who need it. This is the same
  // hue deepened until white clears the bar (3.39:1) while staying clearly CORAL rather
  // than sliding into the danger red the alert state uses.
  iconTile:      { width: 44, height: 44, borderRadius: 14, backgroundColor: '#E8613A',
                   justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  iconTileAlert: { backgroundColor: colors.danger },
  text:          { flex: 1 },
  // Near-black rather than coral. The title is the loudest thing in the row and coral on
  // pale pink was both noisy and, at 2.17:1 MEASURED, nowhere near AA for 15pt — it was
  // failing legibility, not just taste. This is 13.16:1.
  title:         { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: colors.textPrimary },
  titleAlert:    { color: colors.danger },
  subRow:        { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  // Muted coral, but a REAL one rather than accent + 'AA' alpha: an alpha suffix composites
  // against whatever is behind it, so the same token rendered a different colour on the
  // pink surface than it would anywhere else, and its contrast was unknowable by reading.
  // #A84D33 is 5.01:1 on the pink. The first attempt at this was #B4553A, which measured
  // 4.40 — under the 4.5 floor for 12pt, and close enough to have been eyeballed as fine.
  sub:           { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#A84D33', flexShrink: 1 },
  subAlert:      { color: colors.danger },
})
