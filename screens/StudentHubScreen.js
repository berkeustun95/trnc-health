import { useState, useMemo, useEffect, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, TextInput, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import PageBackground from '../components/PageBackground'
import ScreenHeader from '../components/ScreenHeader'
import ContentCard from '../components/ContentCard'
import MascotIntroCard from '../components/MascotIntroCard'
import { colors, shadow, radius } from '../constants/theme'
import { t } from '../constants/i18n'
import { REGIONS, REGION_LABEL_KEY } from '../constants/regions'
import { normalize } from '../constants/oliIntents'

// The profile wizard's escape hatch for students at an unlisted institution
// (20261001 seed, sort_order 999). It is not a place, so it has no row in a directory.
const OTHER_INSTITUTION_ID = '00000000-0000-4000-b000-0000000000ff'

function SectionTitle({ text }) {
  return <Text style={s.sectionTitle}>{text}</Text>
}

function BulletRow({ iconName, iconColor, title, text }) {
  return (
    <View style={s.bulletRow}>
      <Ionicons name={iconName || 'checkmark-circle-outline'} size={18} color={iconColor || colors.primary} style={s.bulletIcon} />
      <View style={s.bulletBody}>
        {title ? <Text style={s.bulletTitle}>{title}</Text> : null}
        <Text style={s.bulletText}>{text}</Text>
      </View>
    </View>
  )
}

function UniversityRow({ uni, lang }) {
  const meta = [uni.short_name, uni.city && t(REGION_LABEL_KEY[uni.city], lang)].filter(Boolean).join(' · ')
  return (
    <View style={s.uniCard}>
      <Text style={s.uniName}>{uni.name}</Text>
      {meta ? <Text style={s.uniMeta}>{meta}</Text> : null}
    </View>
  )
}

function LoadError({ lang, onRetry }) {
  return (
    <View style={s.errorWrap}>
      <View style={s.errorIcon}>
        <Ionicons name="alert-circle-outline" size={28} color={colors.danger} />
      </View>
      <Text style={s.errorText}>{t('studentLoadError', lang)}</Text>
      <TouchableOpacity style={s.retryBtn} onPress={onRetry} activeOpacity={0.85} accessibilityRole="button">
        <Ionicons name="refresh" size={17} color={colors.surface} />
        <Text style={s.retryText}>{t('tryAgain', lang)}</Text>
      </TouchableOpacity>
    </View>
  )
}

function UniversitiesTab({ lang, universities, failed, onRetry }) {
  const [query, setQuery]   = useState('')
  const [region, setRegion] = useState('all')

  const regions = useMemo(
    () => ['all', ...REGIONS.filter(r => universities?.some(u => u.city === r))],
    [universities],
  )

  const results = useMemo(() => {
    if (!universities) return []
    const q = normalize(query)
    return universities.filter(u => {
      if (region !== 'all' && u.city !== region) return false
      if (!q) return true
      const blob = normalize([u.name, u.short_name].filter(Boolean).join(' '))
      return q.split(' ').every(tok => blob.includes(tok))
    })
  }, [universities, query, region])

  if (failed) {
    return (
      <View style={s.tabContent}>
        <LoadError lang={lang} onRetry={onRetry} />
      </View>
    )
  }

  if (!universities) {
    return <ActivityIndicator size="large" color={colors.primary} style={s.loading} />
  }

  return (
    <ScrollView style={s.tabScroll} contentContainerStyle={s.tabContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={s.searchBox}>
        <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
        <TextInput
          style={s.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder={t('studentSearchPlaceholder', lang)}
          placeholderTextColor={colors.textSecondary}
          returnKeyType="search"
        />
        {query ? (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
        {regions.map(r => {
          const active = r === region
          return (
            <TouchableOpacity
              key={r}
              style={[s.chip, active && s.chipActive]}
              onPress={() => setRegion(r)}
              activeOpacity={0.8}
            >
              <Text style={[s.chipText, active && s.chipTextActive]}>
                {t(r === 'all' ? 'filterAll' : REGION_LABEL_KEY[r], lang)}
              </Text>
            </TouchableOpacity>
          )
        })}
      </ScrollView>

      {results.length === 0 ? (
        <View style={s.emptyWrap}>
          <Ionicons name="school-outline" size={28} color={colors.textSecondary} />
          <Text style={s.emptyText}>{t('studentNoResults', lang)}</Text>
        </View>
      ) : (
        results.map(u => <UniversityRow key={u.id} uni={u} lang={lang} />)
      )}
    </ScrollView>
  )
}

function BasicsTab({ lang, onShowEsim, onShowNewcomerEssentials }) {
  return (
    <ScrollView style={s.tabScroll} contentContainerStyle={s.tabContent} showsVerticalScrollIndicator={false}>
      <ContentCard>
        <SectionTitle text={t('studentArrivalTitle', lang)} />
        <BulletRow iconName="card-outline"   iconColor="#185FA5"       title={t('studentPermitTitle', lang)} text={t('studentPermitBody', lang)} />
        <BulletRow iconName="wallet-outline"  iconColor={colors.accent} title={t('studentBankTitle', lang)}   text={t('studentBankBody', lang)} />
        <BulletRow iconName="cellular-outline" iconColor="#0E7C7B"      title={t('studentSimTitle', lang)}    text={t('studentSimBody', lang)} />

        <TouchableOpacity style={s.linkBtn} onPress={onShowEsim} activeOpacity={0.8}>
          <Ionicons name="cellular-outline" size={18} color={colors.surface} />
          <Text style={s.linkBtnText}>{t('studentSimBtn', lang)}</Text>
        </TouchableOpacity>
      </ContentCard>

      <ContentCard style={s.secondCard}>
        <SectionTitle text={t('studentNewcomerTitle', lang)} />
        <Text style={s.crossText}>{t('studentNewcomerBody', lang)}</Text>
        <TouchableOpacity style={s.linkBtnGhost} onPress={onShowNewcomerEssentials} activeOpacity={0.8}>
          <Ionicons name="compass-outline" size={18} color={colors.primary} />
          <Text style={s.linkBtnGhostText}>{t('studentNewcomerBtn', lang)}</Text>
        </TouchableOpacity>
      </ContentCard>
    </ScrollView>
  )
}

export default function StudentHubScreen({ lang, onBack, onShowEsim, onShowNewcomerEssentials }) {
  const [tab, setTab] = useState('universities')
  const [universities, setUniversities] = useState(null)
  const [failed, setFailed] = useState(false)

  // Loaded here rather than in the tab so switching tabs does not refetch.
  const load = useCallback(() => {
    setFailed(false)
    setUniversities(null)
    supabase.from('institutions')
      .select('id, name, short_name, city')
      .eq('is_active', true)
      .neq('id', OTHER_INSTITUTION_ID)
      .order('name')
      .then(({ data, error }) => {
        // Zero rows is a fault, not an empty directory: the table is seeded and cannot
        // legitimately be empty, and a session RLS refuses gets [] with no error.
        if (error || !data?.length) { setFailed(true); return }
        setUniversities(data)
      })
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <PageBackground topic="newcomer_essentials" />
      <ScreenHeader onBack={onBack} lang={lang} title={t('menuStudentHub', lang)} />

      <View style={s.introWrap}>
        <MascotIntroCard
          module="welcome_guide"
          title={t('studentHubTitle', lang)}
          subtitle={t('studentHubSubtitle', lang)}
        />
      </View>

      <View style={s.segment}>
        <TouchableOpacity
          style={[s.segmentBtn, tab === 'universities' && s.segmentBtnActive]}
          onPress={() => setTab('universities')}
          activeOpacity={0.9}
        >
          <Text style={[s.segmentText, tab === 'universities' && s.segmentTextActive]}>{t('studentTabUniversities', lang)}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.segmentBtn, tab === 'basics' && s.segmentBtnActive]}
          onPress={() => setTab('basics')}
          activeOpacity={0.9}
        >
          <Text style={[s.segmentText, tab === 'basics' && s.segmentTextActive]}>{t('studentTabBasics', lang)}</Text>
        </TouchableOpacity>
      </View>

      {tab === 'universities'
        ? <UniversitiesTab lang={lang} universities={universities} failed={failed} onRetry={load} />
        : <BasicsTab lang={lang} onShowEsim={onShowEsim} onShowNewcomerEssentials={onShowNewcomerEssentials} />}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  introWrap: { paddingHorizontal: 16, marginBottom: 16 },

  segment: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    padding: 4,
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  segmentBtnActive: { backgroundColor: colors.surface, ...shadow },
  segmentText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  segmentTextActive: { color: colors.primary },

  tabScroll: { flex: 1 },
  tabContent: { paddingHorizontal: 16, paddingBottom: 40 },
  loading: { marginTop: 48 },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    ...shadow,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.textPrimary, padding: 0 },

  chipRow: { gap: 8, paddingRight: 8, paddingBottom: 4 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  chipTextActive: { color: colors.surface },

  uniCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: 16,
    marginTop: 12,
    ...shadow,
  },
  uniName: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, lineHeight: 21 },
  uniMeta: { fontSize: 13, color: colors.textSecondary, marginTop: 3 },

  emptyWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, gap: 10 },
  emptyText: { fontSize: 15, color: colors.textSecondary, textAlign: 'center' },

  errorWrap: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: 24,
    marginTop: 12,
    alignItems: 'center',
    ...shadow,
  },
  errorIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.dangerLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  errorText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'stretch',
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 13,
    marginTop: 18,
  },
  retryText: { fontSize: 15, fontWeight: '600', color: colors.surface },

  secondCard: { marginTop: 16 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 14,
  },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16, gap: 10 },
  bulletIcon: { marginTop: 1, flexShrink: 0 },
  bulletBody: { flex: 1 },
  bulletTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: 3 },
  bulletText: { fontSize: 14, color: colors.textPrimary, lineHeight: 21 },

  crossText: { fontSize: 14, color: colors.textPrimary, lineHeight: 21, marginBottom: 14 },

  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 13,
    marginTop: 8,
    gap: 8,
  },
  linkBtnText: { fontSize: 15, fontWeight: '600', color: colors.surface },
  linkBtnGhost: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 13,
    gap: 8,
  },
  linkBtnGhostText: { fontSize: 15, fontWeight: '600', color: colors.primary },
})
