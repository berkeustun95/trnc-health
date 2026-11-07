import { useState, useEffect, useCallback, useRef } from 'react'
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { t } from '../constants/i18n'
import { colors, type, radii, elevation } from '../constants/theme'
import {
  ScreenHeader, FilterBar, Dropdown, InfoBanner, ListCard, ErrorState, EmptyState, CardSkeleton, Button, ModuleScreen,
} from '../components/ui'
import { CARD_BG } from '../components/ui/ModuleScreen'
import { useScrollMemory, forgetScroll } from '../utils/scrollMemory'
import { isGuest } from '../lib/supabase'
import { MK_CATEGORIES, MK_CATEGORY, MK_CONDITION, MK_DISTRICTS, formatPrice, isAdultDob } from '../constants/marketplace'
import { HS_DISTRICT_LABEL_KEY } from '../constants/homeServices'
import { listListings, photosFor, signedUrls, setFixtureUser, usingFixture } from '../utils/marketplaceApi'
import MarketplaceListingScreen from './MarketplaceListingScreen'
import MarketplaceFormScreen from './MarketplaceFormScreen'
import MarketplaceMineScreen from './MarketplaceMineScreen'

// ─── Dükkân: browse ─────────────────────────────────────────────────────────
// The module's main page (photo ground). Detail, form and İlanlarım open over it as layers; Android back
// closes the top one (backRef), the same shape as Duyurular. Plan: vault 2026-11-07_marketplace-plan.md.

function SearchField({ value, onChange, lang }) {
  return (
    <View style={s.search}>
      <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
      <TextInput
        style={s.searchInput}
        value={value}
        onChangeText={onChange}
        placeholder={t('mkSearch', lang)}
        placeholderTextColor={colors.textSecondary}
        returnKeyType="search"
        autoCorrect={false}
        accessibilityLabel={t('mkSearch', lang)}
      />
      {!!value && (
        <TouchableOpacity onPress={() => onChange('')} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('mkClearSearch', lang)}>
          <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      )}
    </View>
  )
}

function ListingCard({ item, cover, lang, onPress }) {
  const cat = MK_CATEGORY[item.category]
  return (
    <ListCard
      title={item.title}
      subtitle={formatPrice(item, lang, t)}
      leading={cover ? { uri: cover } : { icon: cat?.icon || 'cube-outline', category: 'homeLife' }}
      meta={[
        { icon: 'location-outline', text: t(HS_DISTRICT_LABEL_KEY[item.district], lang) },
        { icon: 'pricetag-outline', text: t(MK_CONDITION[item.condition]?.labelKey, lang) },
      ]}
      onPress={onPress}
      lang={lang}
    />
  )
}

// Who may post decides the call to action: guests sign in, under-18s are told why (no dead button).
function PostCta({ session, profile, lang, onPost, onSignIn }) {
  if (!session || isGuest(session)) {
    return <Button title={t('mkSignInToPost', lang)} variant="secondary" icon="log-in-outline" onPress={onSignIn} fullWidth />
  }
  const adult = isAdultDob(profile?.date_of_birth)
  return (
    <Button title={t('mkPost', lang)} icon="add-circle-outline" onPress={onPost} fullWidth
      disabled={!adult} disabledHint={adult ? undefined : t('mkUnder18', lang)} />
  )
}

function ListHeader({ lang, session, profile, onPost, onSignIn, showIntro }) {
  return (
    <View style={s.header}>
      {showIntro && <InfoBanner icon="storefront-outline" category="homeLife" title={t('mkIntroTitle', lang)} message={t('mkIntroSub', lang)} />}
      <View style={s.ctaCard}>
        <PostCta session={session} profile={profile} lang={lang} onPost={onPost} onSignIn={onSignIn} />
      </View>
    </View>
  )
}

export default function MarketplaceScreen({ lang, session, profile, onBack, onSignIn, backRef = null, initialView = null }) {
  const [rows, setRows]         = useState([])
  const [covers, setCovers]     = useState({})
  const [more, setMore]         = useState(false)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(false)
  const [category, setCategory] = useState(null)
  const [district, setDistrict] = useState(null)
  const [query, setQuery]       = useState('')
  const [opened, setOpened]     = useState(null)           // listing id
  const [form, setForm]         = useState(initialView === 'post' ? { mode: 'create' } : null)
  const [mine, setMine]         = useState(initialView === 'mine')
  const listMem = useScrollMemory('mk:list')
  const seq = useRef(0)
  const uid = session?.user?.id
  useEffect(() => () => forgetScroll('mk:'), [])

  // Back closes the top layer: form over detail over İlanlarım over the list.
  useEffect(() => {
    if (!backRef) return
    backRef.current = () => {
      if (form) { setForm(null); return true }
      if (opened) { setOpened(null); return true }
      if (mine && initialView !== 'mine') { setMine(false); return true }
      return false
    }
    return () => { backRef.current = null }
  })

  const loadCovers = useCallback(async list => {
    const photos = await photosFor(list.map(l => l.id))
    const firstApproved = Object.fromEntries(list.map(l => [l.id, photos[l.id].find(p => p.status === 'approved')?.storage_path]))
    const urls = await signedUrls(Object.values(firstApproved).filter(Boolean))
    return Object.fromEntries(Object.entries(firstApproved).map(([id, p]) => [id, p ? urls[p] : null]))
  }, [])

  const load = useCallback(async () => {
    const my = ++seq.current
    setLoading(true); setError(false)
    try {
      const { rows: r, more: m } = await listListings({ category, district, query })
      if (usingFixture()) setFixtureUser(uid, profile?.display_name)
      const c = await loadCovers(r)
      if (my !== seq.current) return
      setRows(r); setMore(m); setCovers(c)
    } catch { if (my === seq.current) setError(true) }
    if (my === seq.current) setLoading(false)
  }, [category, district, query, uid, profile?.display_name, loadCovers])

  // Search waits for a pause in typing; filters apply at once.
  useEffect(() => {
    const h = setTimeout(load, query ? 300 : 0)
    return () => clearTimeout(h)
  }, [load, query])

  const loadMore = useCallback(async () => {
    if (!more || loading) return
    try {
      const { rows: r, more: m } = await listListings({ category, district, query, from: rows.length })
      const c = await loadCovers(r)
      setRows(prev => [...prev, ...r]); setMore(m); setCovers(prev => ({ ...prev, ...c }))
    } catch { /* the next scroll retries */ }
  }, [more, loading, category, district, query, rows.length, loadCovers])

  const refreshAfterChange = () => { setForm(null); load() }

  if (form) {
    return <MarketplaceFormScreen lang={lang} session={session} listing={form.listing} onBack={() => setForm(null)}
      onSaved={id => { refreshAfterChange(); setOpened(id) }} />
  }
  if (opened) {
    return <MarketplaceListingScreen id={opened} lang={lang} session={session} onBack={() => { setOpened(null); load() }}
      onEdit={l => setForm({ mode: 'edit', listing: l })} onChanged={load} />
  }
  if (mine) {
    return <MarketplaceMineScreen lang={lang} session={session} profile={profile}
      onBack={() => (initialView === 'mine' ? onBack() : setMine(false))}
      onOpen={setOpened} onPost={() => setForm({ mode: 'create' })} />
  }

  const filtersOn = !!(category || district || query)
  const signedIn = !!session && !isGuest(session)
  return (
    <ModuleScreen topic="marketplace">
      <SafeAreaView style={s.safe} edges={['top']}>
        <ScreenHeader onBack={onBack} title={t('menuMarketplace', lang)} lang={lang}
          actions={signedIn ? [{ icon: 'albums-outline', onPress: () => setMine(true), accessibilityLabel: t('mkMine', lang) }] : []} />
        <View style={s.searchRow}>
          <SearchField value={query} onChange={setQuery} lang={lang} />
        </View>
        <FilterBar>
          <Dropdown
            label={t('ddCategory', lang)} searchPlaceholder={t('mkSearchCategory', lang)}
            options={MK_CATEGORIES.map(c => ({ value: c.key, label: t(c.labelKey, lang) }))}
            value={category} onChange={setCategory} lang={lang}
          />
          <Dropdown
            label={t('ddDistrict', lang)}
            options={MK_DISTRICTS.map(d => ({ value: d.key, label: t(d.labelKey, lang) }))}
            value={district} onChange={setDistrict} lang={lang}
          />
        </FilterBar>
        {loading && !rows.length ? (
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
            data={rows}
            keyExtractor={it => String(it.id)}
            contentContainerStyle={s.list}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            onEndReached={loadMore}
            onEndReachedThreshold={0.5}
            ListHeaderComponent={<ListHeader lang={lang} session={session} profile={profile} showIntro={!filtersOn}
              onPost={() => setForm({ mode: 'create' })} onSignIn={onSignIn} />}
            // A young marketplace can be genuinely empty, so this is an EmptyState, not an error.
            ListEmptyComponent={filtersOn ? (
              <EmptyState icon="search-outline" category="homeLife" title={t('mkEmptyFilteredTitle', lang)} message={t('mkEmptyFilteredSub', lang)}
                action={{ label: t('mkClearFilters', lang), onPress: () => { setCategory(null); setDistrict(null); setQuery('') } }} />
            ) : (
              <EmptyState icon="storefront-outline" category="homeLife" title={t('mkEmptyTitle', lang)} message={t('mkEmptySub', lang)} />
            )}
            renderItem={({ item }) => <ListingCard item={item} cover={covers[item.id]} lang={lang} onPress={() => setOpened(item.id)} />}
          />
        )}
      </SafeAreaView>
    </ModuleScreen>
  )
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: 'transparent' },
  searchRow:   { paddingHorizontal: 16, paddingTop: 4, flexShrink: 0 },
  search:      { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, borderRadius: radii.pill,
                 backgroundColor: CARD_BG, paddingHorizontal: 14, ...elevation.card },
  searchInput: { flex: 1, ...type.body, color: colors.textPrimary, paddingVertical: 8 },
  list:        { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 40, gap: 12 },
  header:      { gap: 12, marginBottom: 4 },
  ctaCard:     { backgroundColor: CARD_BG, borderRadius: radii.card, padding: 12, ...elevation.card },
})
