import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, ScrollView, Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import JobPostingProfileScreen from './JobPostingProfileScreen'
import JobPostOnboardingScreen from './JobPostOnboardingScreen'
import PageBackground from '../components/PageBackground'
import ScreenHeader from '../components/ScreenHeader'
import { colors, shadow, radius } from '../constants/theme'
import { t } from '../constants/i18n'

const CATEGORIES = [
  { key: 'all',               icon: 'apps-outline',       labelKey: 'jobAllCategories' },
  { key: 'hospitality',       icon: 'restaurant-outline',  labelKey: 'jobCatHospitality' },
  { key: 'construction',      icon: 'construct-outline',   labelKey: 'jobCatConstruction' },
  { key: 'retail',            icon: 'cart-outline',        labelKey: 'jobCatRetail' },
  { key: 'healthcare',        icon: 'medical-outline',     labelKey: 'jobCatHealthcare' },
  { key: 'admin_office',      icon: 'business-outline',    labelKey: 'jobCatAdminOffice' },
  { key: 'education',         icon: 'school-outline',      labelKey: 'jobCatEducation' },
  { key: 'driving_logistics', icon: 'car-outline',         labelKey: 'jobCatDrivingLogistics' },
  { key: 'beauty_wellness',   icon: 'cut-outline',         labelKey: 'jobCatBeautyWellness' },
  { key: 'agriculture',       icon: 'leaf-outline',        labelKey: 'jobCatAgriculture' },
  { key: 'domestic',          icon: 'home-outline',        labelKey: 'jobCatDomestic' },
  { key: 'other',             icon: 'ellipsis-horizontal-outline', labelKey: 'jobCatOther' },
]

const EMPLOYMENT_TYPES = [
  { key: 'full_time',  labelKey: 'jobTypeFullTime' },
  { key: 'part_time',  labelKey: 'jobTypePartTime' },
  { key: 'seasonal',   labelKey: 'jobTypeSeasonal' },
  { key: 'temporary',  labelKey: 'jobTypeTemporary' },
]

const DISTRICTS = ['nicosia', 'kyrenia', 'famagusta', 'morphou', 'iskele', 'lefke', 'karpaz']

const DISTRICT_KEY = {
  nicosia: 'jobDistrictNicosia', kyrenia: 'jobDistrictKyrenia',
  famagusta: 'jobDistrictFamagusta', morphou: 'jobDistrictMorphou',
  iskele: 'jobDistrictIskele', lefke: 'jobDistrictLefke', karpaz: 'jobDistrictKarpaz',
}

function daysPostedAgo(isoString, lang) {
  const days = Math.floor((Date.now() - new Date(isoString).getTime()) / 86400000)
  if (days === 0) return t('jobPostedToday', lang)
  if (days === 1) return t('jobPostedYesterday', lang)
  return t('jobPostedDaysAgo', lang).replace('{n}', days)
}

function categoryLabel(key, lang) {
  const cat = CATEGORIES.find(c => c.key === key)
  return cat ? t(cat.labelKey, lang) : key
}

// ─── Category tile ────────────────────────────────────────────────────────────

function CategoryTile({ item, lang, onPress }) {
  return (
    <TouchableOpacity style={s.catTile} onPress={onPress} activeOpacity={0.75}>
      <View style={s.catIconWrap}>
        <Ionicons name={item.icon} size={26} color={colors.primary} />
      </View>
      <Text style={s.catLabel} numberOfLines={2}>{t(item.labelKey, lang)}</Text>
    </TouchableOpacity>
  )
}

// ─── Job card ─────────────────────────────────────────────────────────────────

function JobCard({ item, lang, onPress }) {
  const canCall = item.contact_pref === 'call'     || item.contact_pref === 'both'
  const canWA   = item.contact_pref === 'whatsapp' || item.contact_pref === 'both'
  const phone   = (item.phone || '').replace(/\s/g, '')
  const waNum   = (item.whatsapp || item.phone || '').replace(/[\s+]/g, '')

  const typeLabel = EMPLOYMENT_TYPES.find(et => et.key === item.employment_type)

  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={0.85}>
      <View style={s.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={s.cardTitle} numberOfLines={2}>{item.job_title}</Text>
          <Text style={s.cardEmployer} numberOfLines={1}>{item.employer_name}</Text>
        </View>
        <Text style={s.cardAge}>{daysPostedAgo(item.created_at, lang)}</Text>
      </View>

      <View style={s.badgeRow}>
        {typeLabel && (
          <View style={s.typeBadge}>
            <Text style={s.typeBadgeText}>{t(typeLabel.labelKey, lang)}</Text>
          </View>
        )}
        <View style={s.districtBadge}>
          <Text style={s.districtBadgeText}>{t(DISTRICT_KEY[item.district] || 'jobAllDistricts', lang)}</Text>
        </View>
        <View style={s.catBadge}>
          <Text style={s.catBadgeText}>{categoryLabel(item.category, lang)}</Text>
        </View>
      </View>

      {!!item.salary && (
        <Text style={s.salaryText}>{t('jobSalaryLabel', lang)}: {item.salary}</Text>
      )}

      {!!item.description && (
        <Text style={s.cardDesc} numberOfLines={3}>{item.description}</Text>
      )}

      <View style={s.btnRow}>
        {canCall && (
          <TouchableOpacity
            style={s.callBtn}
            onPress={() => Linking.openURL(`tel:${phone}`)}
            activeOpacity={0.8}
          >
            <Ionicons name="call-outline" size={15} color="#fff" />
            <Text style={s.callBtnText}>{t('jobCall', lang)}</Text>
          </TouchableOpacity>
        )}
        {canWA && (
          <TouchableOpacity
            style={s.waBtn}
            onPress={() => Linking.openURL(`https://wa.me/${waNum}`)}
            activeOpacity={0.8}
          >
            <Ionicons name="logo-whatsapp" size={15} color="#fff" />
            <Text style={s.waBtnText}>{t('jobWhatsApp', lang)}</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  )
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function JobPostingsScreen({ lang, session, onBack }) {
  const [selectedCategory,   setSelectedCategory]   = useState(null)
  const [selectedType,       setSelectedType]       = useState(null)
  const [selectedDistrict,   setSelectedDistrict]   = useState(null)
  const [selectedJob,        setSelectedJob]        = useState(null)
  const [showPostForm,       setShowPostForm]       = useState(false)
  const [jobs,               setJobs]               = useState([])
  const [loading,            setLoading]            = useState(false)

  const loadJobs = useCallback(async (category, empType, district) => {
    setLoading(true)
    let query = supabase
      .from('job_postings')
      .select('*')
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })

    if (category && category !== 'all') query = query.eq('category', category)
    if (empType)  query = query.eq('employment_type', empType)
    if (district) query = query.eq('district', district)

    const { data } = await query
    setJobs(data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (selectedCategory !== null) loadJobs(selectedCategory, selectedType, selectedDistrict)
  }, [selectedCategory, selectedType, selectedDistrict, loadJobs])

  function selectCategory(key) {
    setSelectedType(null)
    setSelectedDistrict(null)
    setSelectedCategory(key)
  }

  function handleBack() {
    if (selectedJob) {
      setSelectedJob(null)
    } else if (selectedCategory !== null) {
      setSelectedCategory(null)
      setSelectedType(null)
      setSelectedDistrict(null)
      setJobs([])
    } else {
      onBack()
    }
  }

  const activeCat   = CATEGORIES.find(c => c.key === selectedCategory)
  const headerTitle = activeCat ? t(activeCat.labelKey, lang) : t('jobTitle', lang)
  const backLabel   = selectedCategory !== null ? t('jobAllCategories', lang) : t('back', lang)

  // ── Post form ─────────────────────────────────────────────────────────────
  if (showPostForm) {
    return (
      <JobPostOnboardingScreen
        session={session}
        lang={lang}
        onClose={() => setShowPostForm(false)}
      />
    )
  }

  // ── Profile view ──────────────────────────────────────────────────────────
  if (selectedJob) {
    return (
      <JobPostingProfileScreen
        job={selectedJob}
        lang={lang}
        session={session}
        onBack={() => setSelectedJob(null)}
        onMarkedFilled={() => {
          setSelectedJob(null)
          loadJobs(selectedCategory, selectedType, selectedDistrict)
        }}
      />
    )
  }

  // ── List view (category selected) ─────────────────────────────────────────
  if (selectedCategory !== null) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <PageBackground topic="home_services" />
        <ScreenHeader onBack={handleBack} backLabel={backLabel} title={headerTitle} lang={lang} />

        {/* Employment type chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={s.filterRow}
        >
          <TouchableOpacity
            style={[s.chip, !selectedType && s.chipActive]}
            onPress={() => setSelectedType(null)}
          >
            <Text style={[s.chipText, !selectedType && s.chipTextActive]}>
              {t('jobAllTypes', lang)}
            </Text>
          </TouchableOpacity>
          {EMPLOYMENT_TYPES.map(et => (
            <TouchableOpacity
              key={et.key}
              style={[s.chip, selectedType === et.key && s.chipActive]}
              onPress={() => setSelectedType(selectedType === et.key ? null : et.key)}
            >
              <Text style={[s.chipText, selectedType === et.key && s.chipTextActive]}>
                {t(et.labelKey, lang)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* District chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={[s.filterRow, { paddingTop: 0 }]}
        >
          <TouchableOpacity
            style={[s.chip, !selectedDistrict && s.chipActive]}
            onPress={() => setSelectedDistrict(null)}
          >
            <Text style={[s.chipText, !selectedDistrict && s.chipTextActive]}>
              {t('jobAllDistricts', lang)}
            </Text>
          </TouchableOpacity>
          {DISTRICTS.map(d => (
            <TouchableOpacity
              key={d}
              style={[s.chip, selectedDistrict === d && s.chipActive]}
              onPress={() => setSelectedDistrict(selectedDistrict === d ? null : d)}
            >
              <Text style={[s.chipText, selectedDistrict === d && s.chipTextActive]}>
                {t(DISTRICT_KEY[d], lang)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {loading
          ? <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 48 }} />
          : (
            <FlatList
              data={jobs}
              keyExtractor={item => item.id}
              contentContainerStyle={s.listContent}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <View style={s.emptyWrap}>
                  <View style={s.emptyCard}>
                    <Ionicons name="briefcase-outline" size={44} color={colors.border} style={{ marginBottom: 10 }} />
                    <Text style={s.emptyTitle}>{t('jobEmptyTitle', lang)}</Text>
                    <Text style={s.emptySub}>{t('jobEmptySub', lang)}</Text>
                    {!!session && (
                      <TouchableOpacity style={s.emptyPostBtn} onPress={() => setShowPostForm(true)} activeOpacity={0.8}>
                        <Text style={s.emptyPostBtnText}>{t('jobPostCTA', lang)}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              }
              renderItem={({ item }) => (
                <JobCard item={item} lang={lang} onPress={() => setSelectedJob(item)} />
              )}
            />
          )
        }
      </SafeAreaView>
    )
  }

  // ── Category grid ─────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <PageBackground topic="home_services" />
      <ScreenHeader onBack={onBack} backLabel={t('back', lang)} title={t('jobTitle', lang)} lang={lang} />

      <ScrollView
        contentContainerStyle={s.catScroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.subtitleCard}>
          <Text style={s.subtitle}>{t('jobSubtitle', lang)}</Text>
        </View>

        <View style={s.grid}>
          {CATEGORIES.map(cat => (
            <CategoryTile
              key={cat.key}
              item={cat}
              lang={lang}
              onPress={() => selectCategory(cat.key)}
            />
          ))}
        </View>

        {!!session && (
          <TouchableOpacity style={s.ctaCard} onPress={() => setShowPostForm(true)} activeOpacity={0.8}>
            <View style={s.ctaIconWrap}>
              <Ionicons name="add-circle-outline" size={28} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.ctaTitle}>{t('jobPostCTA', lang)}</Text>
              <Text style={s.ctaSub}>{t('jobPostCTASub', lang)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: colors.bg },

  // Category grid
  catScroll:        { padding: 20, paddingBottom: 40 },
  subtitleCard:     { backgroundColor: colors.cardBg, borderRadius: 14, paddingHorizontal: 16,
                      paddingVertical: 12, marginBottom: 20, ...shadow },
  subtitle:         { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                      textAlign: 'center' },
  grid:             { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  catTile:          { width: '47%', backgroundColor: colors.cardBg, borderRadius: radius.card,
                      padding: 18, alignItems: 'center', gap: 10, ...shadow,
                      borderWidth: 1, borderColor: colors.border },
  catIconWrap:      { width: 50, height: 50, borderRadius: 25, backgroundColor: colors.primaryLight,
                      alignItems: 'center', justifyContent: 'center' },
  catLabel:         { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textPrimary,
                      textAlign: 'center' },

  // Post CTA card
  ctaCard:          { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20,
                      backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 16,
                      ...shadow, borderWidth: 1, borderColor: colors.border },
  ctaIconWrap:      { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primaryLight,
                      alignItems: 'center', justifyContent: 'center' },
  ctaTitle:         { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 2 },
  ctaSub:           { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },

  // Filter chips
  filterRow:        { paddingHorizontal: 16, paddingVertical: 10, gap: 8, alignItems: 'center' },
  chip:             { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
                      backgroundColor: colors.cardBg, borderWidth: 1.5, borderColor: colors.border },
  chipActive:       { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  chipText:         { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  chipTextActive:   { fontFamily: 'Inter_700Bold', color: colors.primary },

  // Job list
  listContent:      { padding: 16, paddingBottom: 40, gap: 12 },

  // Job card
  card:             { backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 16,
                      ...shadow, borderWidth: 1, borderColor: colors.border },
  cardHeader:       { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  cardTitle:        { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, flex: 1 },
  cardEmployer:     { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 2 },
  cardAge:          { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                      marginTop: 2, flexShrink: 0 },
  badgeRow:         { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  typeBadge:        { backgroundColor: colors.accentLight, paddingHorizontal: 9, paddingVertical: 3,
                      borderRadius: 10 },
  typeBadgeText:    { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.accent },
  districtBadge:    { backgroundColor: colors.primaryLight, paddingHorizontal: 9, paddingVertical: 3,
                      borderRadius: 10 },
  districtBadgeText:{ fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.primary },
  catBadge:         { backgroundColor: colors.bg, paddingHorizontal: 9, paddingVertical: 3,
                      borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  catBadgeText:     { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  salaryText:       { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.success,
                      marginBottom: 6 },
  cardDesc:         { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                      lineHeight: 19, marginBottom: 10 },
  btnRow:           { flexDirection: 'row', gap: 10 },
  callBtn:          { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                      gap: 6, backgroundColor: colors.primary, borderRadius: radius.md,
                      paddingVertical: 10 },
  callBtnText:      { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
  waBtn:            { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                      gap: 6, backgroundColor: '#25D366', borderRadius: radius.md,
                      paddingVertical: 10 },
  waBtnText:        { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },

  // Empty state
  emptyWrap:        { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyCard:        { backgroundColor: colors.cardBg, borderRadius: 16, paddingHorizontal: 24,
                      paddingVertical: 24, alignItems: 'center', ...shadow },
  emptyTitle:       { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary,
                      textAlign: 'center', marginBottom: 6 },
  emptySub:         { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                      textAlign: 'center', lineHeight: 20, marginBottom: 16 },
  emptyPostBtn:     { backgroundColor: colors.primary, borderRadius: radius.md,
                      paddingVertical: 12, paddingHorizontal: 24 },
  emptyPostBtnText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
})
