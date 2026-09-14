import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, radius } from '../constants/theme'
import { t } from '../constants/i18n'

// A one-line pointer to the pet hotel partner, shown on TravelWithPetScreen and
// OwningPetScreen.
//
// ─── ITS OWN FILE FOR THE SAME REASON PetHotelPartnerCard.js IS ─────────────
//
// Both host screens are outside scripts/validate-i18n-coverage.mjs's SURFACES list and must
// stay outside it — their `pets*` keys exist in English and Turkish only, a separate
// slice's problem. Written inline, these two strings would have inherited that exemption.
// As a component it joins SURFACES on its own, which is exactly the DisplayNameCheck lesson
// that guard's header records: when copy moves into a component, the guard does not follow
// it unless somebody moves it too.
//
// ⚠ DELIBERATELY SMALLER AND QUIETER THAN PetHotelPartnerCard. This appears at the foot of
//   two REGULATORY screens — import rules, vaccination law, cruelty reporting — and a
//   full-bleed advert under a paragraph about banned breeds reads as ADA selling against
//   its own guidance. It is a cross-reference, so it looks like one: one row, one line of
//   copy, a border rather than a fill, and it still carries the partner badge so nobody can
//   mistake it for editorial.
export default function PetHotelCrossLink({ lang, onPress }) {
  return (
    <TouchableOpacity style={s.wrap} onPress={onPress} activeOpacity={0.8}>
      <View style={s.icon}>
        <Ionicons name="home-outline" size={16} color={colors.primary} />
      </View>
      <View style={s.body}>
        {/* ⚠ THE BADGE IS ON ITS OWN ROW, AND THAT IS A MEASUREMENT, NOT A PREFERENCE.
            Title and badge shared one row with numberOfLines={1} until it was measured
            against the shipped Inter at 320dp: Turkish
            "Seyahate mi çıkıyorsunuz?" + "ADA İş Ortağı" came to 257.8pt in a 190.0pt
            box — 67.8pt over, which truncates the question mark off a question. Every
            other locale fitted, so only a Turkish pass would have caught it on device.
            Split onto two rows the title gets the full width and two lines. */}
        <View style={s.badge}>
          <Text style={s.badgeText}>{t('petHotelBadge', lang)}</Text>
        </View>
        <Text style={s.title} numberOfLines={2}>{t('petHotelCrossTitle', lang)}</Text>
        <Text style={s.sub} numberOfLines={2}>{t('petHotelCrossSub', lang)}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  // backgroundColor explicit: borderWidth + borderRadius on Android can render an opaque
  // background without it (the gotcha CLAUDE.md records), and this one is INTENDED to be
  // unfilled — which is precisely the case where the bug shows up.
  wrap:      { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20,
               padding: 12, borderRadius: radius.card, borderWidth: 1,
               borderColor: colors.border, backgroundColor: 'transparent' },
  icon:      { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primaryLight,
               alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  body:      { flex: 1 },
  title:     { fontSize: 13.5, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginTop: 4 },
  // alignSelf so the pill hugs its text instead of stretching the full row width.
  badge:     { alignSelf: 'flex-start', backgroundColor: colors.accentLight,
               paddingHorizontal: 6, paddingVertical: 2, borderRadius: 7 },
  badgeText: { fontSize: 9.5, fontFamily: 'Inter_700Bold', color: colors.accent },
  sub:       { fontSize: 12.5, lineHeight: 17, fontFamily: 'Inter_400Regular',
               color: colors.textSecondary, marginTop: 2 },
})
