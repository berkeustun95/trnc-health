import { useState, useEffect, useCallback, useMemo } from 'react'
import { View, Text, FlatList, ScrollView, TextInput, TouchableOpacity, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { t, tCount } from '../constants/i18n'
import { colors, category as CAT, type, radii, elevation, press } from '../constants/theme'
import {
  ScreenHeader, FilterBar, Dropdown, InfoBanner, ListCard, ErrorState, EmptyState, CardSkeleton,
  ModuleScreen, OnPhotoLabel,
} from '../components/ui'
import { CARD_BG } from '../components/ui/ModuleScreen'
import { useScrollMemory, forgetScroll } from '../utils/scrollMemory'
import {
  DUY_CATEGORY, DUY_DISTRICTS, DUY_COLUMNS, DUY_PAGE, daysLeft, isClosingSoon, matchesQuery, formatDuyDate,
  visibleCategories,
} from '../constants/duyurular'
import DuyuruDetailScreen from './DuyuruDetailScreen'

// ─── Duyurular: official announcements list ─────────────────────────────────
// Rows come from public.announcements; RLS returns only published, unexpired rows, so this
// screen never filters on is_published itself. Plan: vault 10-ada/2026-10-10_duyurular-plan.md.

export function deadlineMeta(item, lang) {
  if (!item.deadline_at || item.kind !== 'open') return null
  const d = daysLeft(item.deadline_at)
  if (d < 0) return null
  return {
    icon: 'time-outline',
    text: d === 0 ? t('duyLastDay', lang) : tCount('duyDaysLeft', d, lang),
    tone: d <= 3 ? 'warn' : undefined,
  }
}

function SearchField({ value, onChange, lang }) {
  return (
    <View style={s.search}>
      <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
      <TextInput
        style={s.searchInput}
        value={value}
        onChangeText={onChange}
        placeholder={t('duySearch', lang)}
        placeholderTextColor={colors.textSecondary}
        returnKeyType="search"
        autoCorrect={false}
        accessibilityLabel={t('duySearch', lang)}
      />
      {!!value && (
        <TouchableOpacity onPress={() => onChange('')} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('duyClearSearch', lang)}>
          <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      )}
    </View>
  )
}

function ClosingSoonCard({ item, lang, onPress }) {
  const meta = deadlineMeta(item, lang)
  return (
    <TouchableOpacity style={s.soonCard} onPress={onPress} activeOpacity={press.card} accessibilityRole="button"
      accessibilityLabel={[item.title, item.institution, meta?.text].filter(Boolean).join(', ')}>
      <View style={[s.soonPill, meta?.tone === 'warn' && s.soonPillWarn]}>
        <Ionicons name="time-outline" size={13} color={meta?.tone === 'warn' ? colors.dangerInk : CAT.city.ink} />
        <Text style={[s.soonPillText, meta?.tone === 'warn' && { color: colors.dangerInk }]} numberOfLines={1}>{meta?.text}</Text>
      </View>
      <Text style={s.soonTitle} numberOfLines={3}>{item.title}</Text>
      <Text style={s.soonInst} numberOfLines={1}>{item.institution}</Text>
    </TouchableOpacity>
  )
}

function DuyuruCard({ item, lang, onPress }) {
  const cat = DUY_CATEGORY[item.category]
  return (
    <ListCard
      title={item.title}
      subtitle={item.institution}
      leading={{ icon: cat?.icon || 'megaphone-outline', category: 'city' }}
      meta={[{ icon: 'calendar-outline', text: formatDuyDate(item.published_at, lang) }, deadlineMeta(item, lang)]}
      badge={item.kind === 'result' ? t('duyResultBadge', lang) : null}
      onPress={onPress}
      lang={lang}
    />
  )
}

function ListHeader({ lang, closingSoon, onOpen, showIntro }) {
  return (
    <View style={s.header}>
      {showIntro && (
        <InfoBanner icon="megaphone-outline" category="city" title={t('duyIntroTitle', lang)} message={t('duyIntroSub', lang)} />
      )}
      {closingSoon.length > 0 && (
        <View style={s.soonWrap}>
          <OnPhotoLabel accessibilityRole="header">{t('duyClosingSoon', lang)}</OnPhotoLabel>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.soonRow}>
            {closingSoon.map(it => <ClosingSoonCard key={it.id} item={it} lang={lang} onPress={() => onOpen(it)} />)}
          </ScrollView>
        </View>
      )}
    </View>
  )
}

async function fetchAll() {
  const rows = []
  for (let from = 0; ; from += DUY_PAGE) {
    const { data, error, count } = await supabase.from('announcements')
      .select(DUY_COLUMNS, { count: 'exact' })
      .order('published_at', { ascending: false }).order('id', { ascending: false })
      .range(from, from + DUY_PAGE - 1)
    if (error) throw error
    rows.push(...data)
    // The server's max-rows can cap a page below DUY_PAGE; compare against the exact count.
    if (!data.length || rows.length >= (count ?? rows.length)) return rows
  }
}

export default function DuyurularScreen({ lang, onBack, backRef = null }) {
  const [items, setItems]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(false)
  const [category, setCategory] = useState(null)
  const [district, setDistrict] = useState(null)
  const [sort, setSort]         = useState('new')
  const [query, setQuery]       = useState('')
  const [opened, setOpened]     = useState(null)
  const listMem = useScrollMemory('duy:list')
  useEffect(() => () => forgetScroll('duy:'), [])

  useEffect(() => {
    if (!backRef) return
    backRef.current = () => {
      if (opened) { setOpened(null); return true }
      return false
    }
    return () => { backRef.current = null }
  })

  const load = useCallback(async () => {
    setLoading(true); setError(false)
    try { setItems(await fetchAll()) } catch { setError(true) }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const categories = useMemo(() => visibleCategories(items), [items])
  // A category that drops under the threshold while selected falls back to "Tümü".
  const activeCategory = categories.some(c => c.key === category) ? category : null

  const filtered = useMemo(() => items.filter(it =>
    (!activeCategory || it.category === activeCategory) &&
    (!district || it.region === district) &&
    matchesQuery(it, query)
  ), [items, activeCategory, district, query])

  const sorted = useMemo(() => {
    if (sort !== 'deadline') return filtered
    const upcoming = it => it.kind === 'open' && it.deadline_at && daysLeft(it.deadline_at) >= 0
    return [...filtered].sort((a, b) => {
      const ua = upcoming(a), ub = upcoming(b)
      if (ua && ub) return new Date(a.deadline_at) - new Date(b.deadline_at)
      if (ua !== ub) return ua ? -1 : 1
      return new Date(b.published_at) - new Date(a.published_at)
    })
  }, [filtered, sort])

  const closingSoon = useMemo(() => query ? [] : filtered.filter(it => isClosingSoon(it))
    .sort((a, b) => new Date(a.deadline_at) - new Date(b.deadline_at)), [filtered, query])

  if (opened) {
    return <DuyuruDetailScreen item={opened} lang={lang} onBack={() => setOpened(null)} />
  }

  const filtersOn = !!(activeCategory || district || query)
  return (
    <ModuleScreen topic="duyurular">
      <SafeAreaView style={s.safe} edges={['top']}>
        <ScreenHeader onBack={onBack} title={t('menuDuyurular', lang)}
          subtitle={!loading && !error ? tCount('duyCount', filtered.length, lang) : undefined} lang={lang} />
        <View style={s.searchRow}>
          <SearchField value={query} onChange={setQuery} lang={lang} />
        </View>
        <FilterBar>
          <Dropdown
            label={t('ddCategory', lang)}
            options={categories.map(c => ({ value: c.key, label: t(c.labelKey, lang), count: c.count }))}
            value={activeCategory} onChange={setCategory} lang={lang}
          />
          <Dropdown
            label={t('ddDistrict', lang)}
            options={DUY_DISTRICTS.map(d => ({ value: d.key, label: t(d.labelKey, lang) }))}
            value={district} onChange={setDistrict} lang={lang}
          />
          <Dropdown
            label={t('duySort', lang)}
            options={[{ value: 'new', label: t('duySortNew', lang) }, { value: 'deadline', label: t('duySortDeadline', lang) }]}
            value={sort} onChange={v => setSort(v || 'new')} allowAll={false} lang={lang}
          />
        </FilterBar>
        {loading ? (
          <View style={s.list}>
            <CardSkeleton height={96} />
            <CardSkeleton height={96} />
            <CardSkeleton height={96} />
          </View>
        ) : error ? (
          <ErrorState onRetry={load} lang={lang} />
        ) : (
          <FlatList
            {...listMem}
            data={sorted}
            keyExtractor={it => String(it.id)}
            contentContainerStyle={s.list}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            ListHeaderComponent={<ListHeader lang={lang} closingSoon={closingSoon} onOpen={setOpened} showIntro={!filtersOn} />}
            ListEmptyComponent={
              <EmptyState icon="megaphone-outline" category="city"
                title={t(filtersOn ? 'duyEmptyTitle' : 'duyNoneYetTitle', lang)}
                message={t(filtersOn ? 'duyEmptySub' : 'duyNoneYetSub', lang)}
                action={filtersOn ? { label: t('duyClearFilters', lang), onPress: () => { setCategory(null); setDistrict(null); setQuery('') } } : null} />
            }
            renderItem={({ item }) => <DuyuruCard item={item} lang={lang} onPress={() => setOpened(item)} />}
          />
        )}
      </SafeAreaView>
    </ModuleScreen>
  )
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: 'transparent' },
  searchRow:    { paddingHorizontal: 16, paddingTop: 4, flexShrink: 0 },
  search:       { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, borderRadius: radii.pill,
                  backgroundColor: CARD_BG, paddingHorizontal: 14, ...elevation.card },
  searchInput:  { flex: 1, ...type.body, color: colors.textPrimary, paddingVertical: 8 },
  list:         { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 40, gap: 12 },
  header:       { gap: 12, marginBottom: 4 },
  soonWrap:     { gap: 8 },
  soonRow:      { gap: 10, paddingRight: 16 },
  soonCard:     { width: 236, minHeight: 132, backgroundColor: CARD_BG, borderRadius: radii.card, padding: 14, gap: 6, ...elevation.card },
  soonPill:     { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radii.pill,
                  backgroundColor: CAT.city.bg, paddingHorizontal: 8, paddingVertical: 3 },
  soonPillWarn: { backgroundColor: CAT.health.bg },
  soonPillText: { ...type.caption, fontFamily: 'Inter_700Bold', color: CAT.city.ink },
  soonTitle:    { ...type.rowTitle, color: colors.textPrimary },
  soonInst:     { ...type.meta, color: colors.textSecondary },
})
