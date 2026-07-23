import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Linking } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { colors, shadow, radius } from '../constants/theme'
import { t } from '../constants/i18n'

const CATEGORIES = [
  { key: 'health', icon: 'heart-outline',    labelKey: 'insTypeHealth' },
  { key: 'car',    icon: 'car-outline',      labelKey: 'insTypeCar' },
  { key: 'home',   icon: 'home-outline',     labelKey: 'insTypeHome' },
  { key: 'travel', icon: 'airplane-outline', labelKey: 'insTypeTravel' },
]

const DISTRICT_KEYS = {
  nicosia: 'blDistrictNicosia', kyrenia: 'blDistrictKyrenia',
  famagusta: 'blDistrictFamagusta', morphou: 'blDistrictMorphou',
  iskele: 'blDistrictIskele', lefke: 'blDistrictLefke', karpaz: 'blDistrictKarpaz',
}

export default function InsuranceProfileScreen({ company, lang, onBack }) {
  const canCall = company.contact_pref === 'call'     || company.contact_pref === 'both'
  const canWA   = company.contact_pref === 'whatsapp' || company.contact_pref === 'both'
  const phone   = company.phone.replace(/\s/g, '')
  const waNum   = (company.whatsapp || company.phone).replace(/[\s+]/g, '')
  const email   = company.email?.trim()

  const primaryCat   = CATEGORIES.find(c => c.key === company.insurance_types?.[0])
  const heroIcon     = primaryCat?.icon ?? 'shield-checkmark-outline'
  const districtKey  = DISTRICT_KEYS[company.district]

  const footerHeight = canCall && canWA ? 90 : 70

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={{ flex: 1 }}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: footerHeight + 24 }}
        >
          {/* Nav bar */}
          <View style={s.navBar}>
            <TouchableOpacity onPress={onBack} style={s.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
              <Text style={s.backText}>{t('back', lang)}</Text>
            </TouchableOpacity>
          </View>

          {/* Hero */}
          <View style={s.cover}>
            <View style={s.heroIconWrap}>
              <Ionicons name={heroIcon} size={52} color={colors.primary} />
            </View>
          </View>

          <View style={s.body}>
            {/* Identity */}
            <View style={s.identityRow}>
              <View style={s.identityMain}>
                <Text style={s.name}>{company.name}</Text>
                <View style={s.badgeRow}>
                  {company.verified && (
                    <View style={s.verifiedBadge}>
                      <Ionicons name="checkmark-circle" size={13} color={colors.success} />
                      <Text style={s.verifiedText}>{t('insVerified', lang)}</Text>
                    </View>
                  )}
                  {districtKey && (
                    <View style={s.districtBadge}>
                      <Ionicons name="location-outline" size={12} color={colors.primary} />
                      <Text style={s.districtText}>{t(districtKey, lang)}</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>

            {/* Insurance types */}
            {company.insurance_types?.length > 0 && (
              <View style={s.section}>
                <Text style={s.sectionLabel}>{t('insTypesOffered', lang)}</Text>
                <View style={s.chipRow}>
                  {company.insurance_types.map(it => {
                    const cat = CATEGORIES.find(c => c.key === it)
                    return (
                      <View key={it} style={s.chip}>
                        {cat && <Ionicons name={cat.icon} size={13} color={colors.primary} />}
                        <Text style={s.chipText}>{cat ? t(cat.labelKey, lang) : it}</Text>
                      </View>
                    )
                  })}
                </View>
              </View>
            )}

            {/* Description */}
            {!!company.description && (
              <View style={s.section}>
                <Text style={s.sectionLabel}>{t('insAbout', lang)}</Text>
                <Text style={s.description}>{company.description}</Text>
              </View>
            )}

            {/* Contact */}
            <View style={s.section}>
              <Text style={s.sectionLabel}>{t('insContact', lang)}</Text>
              {company.phone && (
                <TouchableOpacity
                  style={s.contactRow}
                  onPress={() => Linking.openURL(`tel:${phone}`)}
                  activeOpacity={0.7}
                >
                  <View style={[s.contactIcon, { backgroundColor: colors.primaryLight }]}>
                    <Ionicons name="call-outline" size={16} color={colors.primary} />
                  </View>
                  <Text style={[s.contactText, { flex: 1 }]}>{company.phone}</Text>
                  <Text style={s.contactAction}>{t('insCall', lang)}</Text>
                </TouchableOpacity>
              )}
              {company.whatsapp && (
                <TouchableOpacity
                  style={s.contactRow}
                  onPress={() => Linking.openURL(`https://wa.me/${waNum}`)}
                  activeOpacity={0.7}
                >
                  <View style={[s.contactIcon, { backgroundColor: '#E8F9EE' }]}>
                    <Ionicons name="logo-whatsapp" size={16} color="#25D366" />
                  </View>
                  <Text style={[s.contactText, { flex: 1 }]}>{company.whatsapp}</Text>
                  <Text style={[s.contactAction, { color: '#25D366' }]}>{t('insWhatsApp', lang)}</Text>
                </TouchableOpacity>
              )}
              {email && (
                <TouchableOpacity
                  style={s.contactRow}
                  onPress={() => Linking.openURL(`mailto:${email}`)}
                  activeOpacity={0.7}
                >
                  <View style={[s.contactIcon, { backgroundColor: colors.primaryLight }]}>
                    <Ionicons name="mail-outline" size={16} color={colors.primary} />
                  </View>
                  <Text style={[s.contactText, { flex: 1 }]}>{email}</Text>
                  <Text style={s.contactAction}>{t('insEmail', lang)}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </ScrollView>

        {/* Sticky CTA footer */}
        <View style={s.ctaWrap}>
          {canCall && (
            <TouchableOpacity
              style={s.ctaCall}
              onPress={() => Linking.openURL(`tel:${phone}`)}
              activeOpacity={0.85}
            >
              <Ionicons name="call-outline" size={18} color="#fff" />
              <Text style={s.ctaText}>{t('insCall', lang)}</Text>
            </TouchableOpacity>
          )}
          {canWA && (
            <TouchableOpacity
              style={s.ctaWA}
              onPress={() => Linking.openURL(`https://wa.me/${waNum}`)}
              activeOpacity={0.85}
            >
              <Ionicons name="logo-whatsapp" size={18} color="#fff" />
              <Text style={s.ctaText}>{t('insWhatsApp', lang)}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: colors.bg },

  navBar:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  backBtn:        { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText:       { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary },

  cover:          { width: '100%', height: 180, backgroundColor: colors.primaryLight,
                    justifyContent: 'center', alignItems: 'center' },
  heroIconWrap:   { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.cardBg,
                    justifyContent: 'center', alignItems: 'center', ...shadow },

  body:           { paddingHorizontal: 16, paddingTop: 20 },

  identityRow:    { marginBottom: 24 },
  identityMain:   { gap: 8 },
  name:           { fontSize: 22, fontFamily: 'Inter_700Bold', color: colors.textPrimary,
                    letterSpacing: -0.3 },
  badgeRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  verifiedBadge:  { flexDirection: 'row', alignItems: 'center', gap: 4,
                    backgroundColor: colors.successLight, paddingHorizontal: 9, paddingVertical: 4,
                    borderRadius: 12 },
  verifiedText:   { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.success },
  districtBadge:  { flexDirection: 'row', alignItems: 'center', gap: 4,
                    backgroundColor: colors.primaryLight, paddingHorizontal: 9, paddingVertical: 4,
                    borderRadius: 12 },
  districtText:   { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.primary },

  section:        { marginBottom: 24 },
  sectionLabel:   { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary,
                    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  chipRow:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:           { flexDirection: 'row', alignItems: 'center', gap: 5,
                    backgroundColor: colors.primaryLight, borderRadius: 20,
                    paddingHorizontal: 12, paddingVertical: 6 },
  chipText:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.primary },

  description:    { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary,
                    lineHeight: 22 },

  contactRow:     { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10,
                    borderBottomWidth: 1, borderBottomColor: colors.border },
  contactIcon:    { width: 32, height: 32, borderRadius: 10, justifyContent: 'center',
                    alignItems: 'center', flexShrink: 0 },
  contactText:    { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  contactAction:  { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary },

  ctaWrap:        { position: 'absolute', bottom: 0, left: 0, right: 0,
                    flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 14,
                    backgroundColor: colors.cardBg, borderTopWidth: 1, borderTopColor: colors.border },
  ctaCall:        { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                    gap: 8, backgroundColor: colors.primary, borderRadius: radius.md,
                    paddingVertical: 14 },
  ctaWA:          { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                    gap: 8, backgroundColor: '#25D366', borderRadius: radius.md,
                    paddingVertical: 14 },
  ctaText:        { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
})
