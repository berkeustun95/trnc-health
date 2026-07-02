import { useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Linking, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { colors, shadow, radius } from '../constants/theme'
import { t } from '../constants/i18n'

const CATEGORY_ICONS = {
  hospitality:       'restaurant-outline',
  construction:      'construct-outline',
  retail:            'cart-outline',
  healthcare:        'medical-outline',
  admin_office:      'business-outline',
  education:         'school-outline',
  driving_logistics: 'car-outline',
  beauty_wellness:   'cut-outline',
  agriculture:       'leaf-outline',
  domestic:          'home-outline',
  other:             'ellipsis-horizontal-outline',
}

const CATEGORY_LABEL_KEYS = {
  hospitality:       'jobCatHospitality',
  construction:      'jobCatConstruction',
  retail:            'jobCatRetail',
  healthcare:        'jobCatHealthcare',
  admin_office:      'jobCatAdminOffice',
  education:         'jobCatEducation',
  driving_logistics: 'jobCatDrivingLogistics',
  beauty_wellness:   'jobCatBeautyWellness',
  agriculture:       'jobCatAgriculture',
  domestic:          'jobCatDomestic',
  other:             'jobCatOther',
}

const EMPLOYMENT_TYPE_LABEL_KEYS = {
  full_time:  'jobTypeFullTime',
  part_time:  'jobTypePartTime',
  seasonal:   'jobTypeSeasonal',
  temporary:  'jobTypeTemporary',
}

const DISTRICT_LABEL_KEYS = {
  nicosia:   'jobDistrictNicosia',
  kyrenia:   'jobDistrictKyrenia',
  famagusta: 'jobDistrictFamagusta',
  morphou:   'jobDistrictMorphou',
  iskele:    'jobDistrictIskele',
  lefke:     'jobDistrictLefke',
  karpaz:    'jobDistrictKarpaz',
}

function daysPostedAgo(isoString, lang) {
  const days = Math.floor((Date.now() - new Date(isoString).getTime()) / 86400000)
  if (days === 0) return t('jobPostedToday', lang)
  if (days === 1) return t('jobPostedYesterday', lang)
  return t('jobPostedDaysAgo', lang).replace('{n}', days)
}

export default function JobPostingProfileScreen({ job, lang, session, onBack, onMarkedFilled }) {
  const [markingFilled, setMarkingFilled] = useState(false)

  const canCall    = job.contact_pref === 'call'     || job.contact_pref === 'both'
  const canWA      = job.contact_pref === 'whatsapp' || job.contact_pref === 'both'
  const phone      = (job.phone || '').replace(/\s/g, '')
  const waNum      = (job.whatsapp || job.phone || '').replace(/[\s+]/g, '')
  const isOwner    = !!session && session.user.id === job.owner_id

  const heroIcon    = CATEGORY_ICONS[job.category] ?? 'briefcase-outline'
  const categoryKey = CATEGORY_LABEL_KEYS[job.category]
  const typeKey     = EMPLOYMENT_TYPE_LABEL_KEYS[job.employment_type]
  const districtKey = DISTRICT_LABEL_KEYS[job.district]

  async function handleMarkFilled() {
    setMarkingFilled(true)
    await supabase.from('job_postings').update({ status: 'filled' }).eq('id', job.id)
    setMarkingFilled(false)
    onMarkedFilled?.()
  }

  const footerHeight = isOwner ? 110 : (canCall && canWA) ? 90 : 70

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
              <Ionicons name={heroIcon} size={48} color={colors.primary} />
            </View>
          </View>

          <View style={s.body}>
            {/* Identity */}
            <View style={s.identityBlock}>
              <Text style={s.jobTitle}>{job.job_title}</Text>
              <Text style={s.employer}>{job.employer_name}</Text>
              <View style={s.badgeRow}>
                {typeKey && (
                  <View style={s.typeBadge}>
                    <Text style={s.typeBadgeText}>{t(typeKey, lang)}</Text>
                  </View>
                )}
                {districtKey && (
                  <View style={s.districtBadge}>
                    <Ionicons name="location-outline" size={12} color={colors.primary} />
                    <Text style={s.districtBadgeText}>{t(districtKey, lang)}</Text>
                  </View>
                )}
              </View>
              <Text style={s.postedAge}>{daysPostedAgo(job.created_at, lang)}</Text>
            </View>

            {/* Job Details */}
            <View style={s.section}>
              <Text style={s.sectionLabel}>{t('jobSectionDetails', lang)}</Text>

              {categoryKey && (
                <View style={s.detailRow}>
                  <Ionicons name={heroIcon} size={16} color={colors.textSecondary} style={s.detailIcon} />
                  <Text style={s.detailText}>{t(categoryKey, lang)}</Text>
                </View>
              )}
              {typeKey && (
                <View style={s.detailRow}>
                  <Ionicons name="time-outline" size={16} color={colors.textSecondary} style={s.detailIcon} />
                  <Text style={s.detailText}>{t(typeKey, lang)}</Text>
                </View>
              )}
              {!!job.salary && (
                <View style={s.detailRow}>
                  <Ionicons name="cash-outline" size={16} color={colors.success} style={s.detailIcon} />
                  <Text style={[s.detailText, { color: colors.success, fontFamily: 'Inter_700Bold' }]}>
                    {job.salary}
                  </Text>
                </View>
              )}
            </View>

            {/* About */}
            {!!job.description && (
              <View style={s.section}>
                <Text style={s.sectionLabel}>{t('jobSectionAbout', lang)}</Text>
                <Text style={s.description}>{job.description}</Text>
              </View>
            )}

            {/* Contact */}
            <View style={s.section}>
              <Text style={s.sectionLabel}>{t('jobSectionContact', lang)}</Text>
              {job.phone && (
                <TouchableOpacity
                  style={s.contactRow}
                  onPress={() => Linking.openURL(`tel:${phone}`)}
                  activeOpacity={0.7}
                >
                  <View style={[s.contactIcon, { backgroundColor: colors.primaryLight }]}>
                    <Ionicons name="call-outline" size={16} color={colors.primary} />
                  </View>
                  <Text style={[s.contactText, { flex: 1 }]}>{job.phone}</Text>
                  <Text style={s.contactAction}>{t('jobCall', lang)}</Text>
                </TouchableOpacity>
              )}
              {job.whatsapp && (
                <TouchableOpacity
                  style={s.contactRow}
                  onPress={() => Linking.openURL(`https://wa.me/${waNum}`)}
                  activeOpacity={0.7}
                >
                  <View style={[s.contactIcon, { backgroundColor: '#E8F9EE' }]}>
                    <Ionicons name="logo-whatsapp" size={16} color="#25D366" />
                  </View>
                  <Text style={[s.contactText, { flex: 1 }]}>{job.whatsapp}</Text>
                  <Text style={[s.contactAction, { color: '#25D366' }]}>{t('jobWhatsApp', lang)}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </ScrollView>

        {/* Sticky footer */}
        <View style={s.footer}>
          {isOwner && (
            <TouchableOpacity
              style={s.footerFilled}
              onPress={handleMarkFilled}
              disabled={markingFilled}
              activeOpacity={0.85}
            >
              {markingFilled
                ? <ActivityIndicator color="#fff" size="small" />
                : <>
                    <Ionicons name="checkmark-done-outline" size={18} color="#fff" />
                    <Text style={s.footerBtnText}>{t('jobMarkFilled', lang)}</Text>
                  </>
              }
            </TouchableOpacity>
          )}
          {!isOwner && canCall && (
            <TouchableOpacity
              style={s.footerCall}
              onPress={() => Linking.openURL(`tel:${phone}`)}
              activeOpacity={0.85}
            >
              <Ionicons name="call-outline" size={18} color="#fff" />
              <Text style={s.footerBtnText}>{t('jobCall', lang)}</Text>
            </TouchableOpacity>
          )}
          {!isOwner && canWA && (
            <TouchableOpacity
              style={s.footerWA}
              onPress={() => Linking.openURL(`https://wa.me/${waNum}`)}
              activeOpacity={0.85}
            >
              <Ionicons name="logo-whatsapp" size={18} color="#fff" />
              <Text style={s.footerBtnText}>{t('jobWhatsApp', lang)}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:              { flex: 1, backgroundColor: colors.bg },

  navBar:            { flexDirection: 'row', alignItems: 'center',
                       paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  backBtn:           { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText:          { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary },

  cover:             { width: '100%', height: 160, backgroundColor: colors.primaryLight,
                       justifyContent: 'center', alignItems: 'center' },
  heroIconWrap:      { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.cardBg,
                       justifyContent: 'center', alignItems: 'center', ...shadow },

  body:              { paddingHorizontal: 16, paddingTop: 20 },

  identityBlock:     { marginBottom: 28 },
  jobTitle:          { fontSize: 22, fontFamily: 'Inter_700Bold', color: colors.textPrimary,
                       letterSpacing: -0.3, marginBottom: 4 },
  employer:          { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                       marginBottom: 10 },
  badgeRow:          { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  typeBadge:         { backgroundColor: colors.accentLight, paddingHorizontal: 10, paddingVertical: 4,
                       borderRadius: 12 },
  typeBadgeText:     { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.accent },
  districtBadge:     { flexDirection: 'row', alignItems: 'center', gap: 4,
                       backgroundColor: colors.primaryLight, paddingHorizontal: 10, paddingVertical: 4,
                       borderRadius: 12 },
  districtBadgeText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.primary },
  postedAge:         { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary },

  section:           { marginBottom: 28 },
  sectionLabel:      { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary,
                       textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },

  detailRow:         { flexDirection: 'row', alignItems: 'center', paddingVertical: 8,
                       borderBottomWidth: 1, borderBottomColor: colors.border },
  detailIcon:        { marginRight: 12, width: 20 },
  detailText:        { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, flex: 1 },

  description:       { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary,
                       lineHeight: 22 },

  contactRow:        { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10,
                       borderBottomWidth: 1, borderBottomColor: colors.border },
  contactIcon:       { width: 32, height: 32, borderRadius: 10, justifyContent: 'center',
                       alignItems: 'center', flexShrink: 0 },
  contactText:       { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  contactAction:     { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary },

  footer:            { position: 'absolute', bottom: 0, left: 0, right: 0,
                       flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 14,
                       backgroundColor: colors.cardBg, borderTopWidth: 1, borderTopColor: colors.border },
  footerFilled:      { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                       gap: 8, backgroundColor: '#7C3AED', borderRadius: radius.md,
                       paddingVertical: 14 },
  footerCall:        { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                       gap: 8, backgroundColor: colors.primary, borderRadius: radius.md,
                       paddingVertical: 14 },
  footerWA:          { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                       gap: 8, backgroundColor: '#25D366', borderRadius: radius.md,
                       paddingVertical: 14 },
  footerBtnText:     { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
})
