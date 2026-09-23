import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, shadow, radius } from '../constants/theme'
import { t } from '../constants/i18n'
import { REGION_LABEL_KEY } from '../constants/regions'
import { partnerAsset } from '../constants/partnerAssets'

// The pet hotel partner card — the entry point to PetHotelPartnerScreen.
//
// ─── WHY THIS IS ITS OWN FILE AND NOT JSX INSIDE PetsHomeScreen ─────────────
//
// Not tidiness. scripts/validate-i18n-coverage.mjs guards a LIST OF FILES, and the pets
// module cannot join that list: its 117 `pets*` keys exist in English and Turkish only, so
// adding screens/pets/PetsHomeScreen.js would turn the guard red on 819 pre-existing
// key×locale pairs that are a separate slice's problem. Written inline, this card's own
// strings would have inherited that exemption and shipped unguarded.
//
// As its own file it goes into SURFACES on its own, in the commit that creates it — which
// is what that guard's header asks for four separate times, having been relearned each
// time. The card is the one piece of this feature every pets user sees, so it is also the
// piece that most needs the nine-locale check.
//
// ⚠ VISUALLY DISTINCT FROM THE THREE JOURNEY CARDS ON PURPOSE. It is not a fourth journey.
//   The journeys are ADA's own editorial guidance and carry no commercial relationship;
//   this is a business that pays us. Reading as a fourth journey would launder a paid
//   placement into neutral advice, which is the one thing a partner card must not do — so
//   it takes a tinted ground, a border, a photo and an explicit partner badge, none of
//   which a journey card has.
export default function PetHotelPartnerCard({ partner, lang, onPress }) {
  if (!partner) return null

  // The dedicated thumb file first: a 64pt box needs 192 px, not a 900 px gallery frame.
  // Failing that, the first resolvable photo. That falls through the list rather than
  // indexing [0], so an unwired or dropped key degrades to the next one instead of to a
  // blank thumbnail, and to no thumbnail at all if none resolve, which the layout handles.
  const thumb = partnerAsset(partner.thumb)
    || (partner.photos || []).map(p => partnerAsset(p.key)).find(Boolean)
  const districtKey = REGION_LABEL_KEY[partner.district]

  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={0.85}>
      <View style={s.badgeRow}>
        <View style={s.badge}>
          <Ionicons name="ribbon-outline" size={11} color={colors.accent} />
          <Text style={s.badgeText}>{t('petHotelBadge', lang)}</Text>
        </View>
      </View>

      <View style={s.body}>
        {!!thumb && (
          <View style={s.thumbWrap}>
            <Image source={thumb} style={s.thumb} resizeMode="cover" />
          </View>
        )}
        <View style={s.text}>
          <Text style={s.name} numberOfLines={2}>{partner.name}</Text>
          {/* DOG BOARDING, NEVER "PETS" — the claim, and the district, in one line.
              flexWrap because Turkish "Köpek pansiyonu · Lefkoşa" overflows 320dp beside
              a 64pt thumbnail. */}
          <View style={s.metaRow}>
            <View style={s.typePill}>
              <Ionicons name="paw" size={10} color={colors.primary} />
              <Text style={s.typePillText}>{t('petHotelDogBoarding', lang)}</Text>
            </View>
            {!!districtKey && <Text style={s.meta}>{t(districtKey, lang)}</Text>}
          </View>
          <View style={s.ctaRow}>
            <Text style={s.cta}>{t('petHotelCardCta', lang)}</Text>
            <Ionicons name="chevron-forward" size={15} color={colors.primary} />
          </View>
        </View>
      </View>
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  // borderWidth + borderRadius on Android can render an opaque background unless
  // backgroundColor is set explicitly — the gotcha CLAUDE.md records. It is set here
  // anyway (the tint IS the distinction from a journey card), which makes it safe rather
  // than lucky; do not remove it if the tint is ever dropped.
  card:         { backgroundColor: colors.primaryLight, borderRadius: radius.card, padding: 14,
                  marginTop: 4, marginBottom: 12, borderWidth: 1, borderColor: colors.border, ...shadow },
  badgeRow:     { flexDirection: 'row', marginBottom: 10 },
  badge:        { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.accentLight,
                  paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  badgeText:    { fontSize: 10.5, fontFamily: 'Inter_700Bold', color: colors.accent },

  body:         { flexDirection: 'row', gap: 12, alignItems: 'center' },
  thumbWrap:    { width: 64, height: 64, borderRadius: 12, overflow: 'hidden',
                  backgroundColor: colors.sand, flexShrink: 0 },
  thumb:        { width: '100%', height: '100%' },
  text:         { flex: 1 },
  name:         { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 5 },
  metaRow:      { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  typePill:     { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.cardBg,
                  paddingHorizontal: 7, paddingVertical: 2, borderRadius: 7 },
  typePillText: { fontSize: 10.5, fontFamily: 'Inter_700Bold', color: colors.primary },
  meta:         { fontSize: 12.5, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  ctaRow:       { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 7 },
  cta:          { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary },
})
