import { useState, useEffect, useCallback, useMemo } from 'react'
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import {
  ScreenHeader, FilterBar, Dropdown, CardSkeleton, EmptyState, ErrorState, ModuleScreen, OnPhotoLabel,
} from '../components/ui'
import VehicleCard from '../components/cars/VehicleCard'
import usePagedVehicles from '../utils/usePagedVehicles'
import { loadKktcFx, todayStr } from '../utils/kktcFx'
import { colors, type, radii, elevation, TAP, listBottomPad } from '../constants/theme'
import { t, tCount } from '../constants/i18n'
import { REGIONS, REGION_LABEL_KEY } from '../constants/regions'
import {
  VEHICLE_COLS, CAR_MODES, INTENT_LABEL_KEY, PRICE_BANDS, YEAR_BANDS, CURRENCY_SYMBOL,
  bandId, groupDigits, priceOrFilter, fxComplete,
} from '../constants/cars'

// ─── Araçlar: the list ──────────────────────────────────────────────────────
// Satılık / Kiralık / Tümü is a MODE (it changes what a price means: a sale price vs a daily rate),
// so it is the segmented bar, not a filter. Below it the app's one filter control: Marka · Fiyat ·
// Yıl · İlçe. Detail and dealer pages open OVER this list from App.js (carsStack), so filters,
// pages and scroll survive the round trip and Android back walks the layers.

// Rates older than this are not used for the price filter: a week-old cache is close enough to
// sort cars into £-bands, an older one is not.
const FX_MAX_AGE_DAYS = 7
const daysOld = iso => (Date.parse(todayStr()) - Date.parse(iso)) / 86400000

const gbp = n => `${CURRENCY_SYMBOL.GBP}${groupDigits(n)}`
function bandLabel([lo, hi], mode, lang) {
  const text = lo === 0 ? t('carsUnder', lang).replace('{p}', gbp(hi))
    : hi == null ? t('carsAndUp', lang).replace('{p}', gbp(lo))
    : `${gbp(lo)} – ${gbp(hi)}`
  return mode === 'rent' ? `${text}${t('carsPerDay', lang)}` : text
}
const yearId = ([a, b]) => `${a ?? ''}-${b ?? ''}`
function yearLabel([from, to], lang) {
  if (to == null) return t('carsYearFrom', lang).replace('{y}', String(from))
  if (from == null) return t('carsYearUpTo', lang).replace('{y}', String(to))
  return `${from} – ${to}`
}

function ModeBar({ mode, onChange, lang }) {
  return (
    <View style={s.modeBar} accessibilityRole="tablist">
      {CAR_MODES.map(m => {
        const active = m === mode
        return (
          <TouchableOpacity key={m} style={[s.modeSeg, active && s.modeSegOn]} onPress={() => onChange(m)} activeOpacity={0.85}
            accessibilityRole="tab" accessibilityState={{ selected: active }}>
            <Text style={[s.modeText, active && s.modeTextOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
              {t(INTENT_LABEL_KEY[m], lang)}
            </Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

// The price pill while it cannot work: says why instead of offering a filter that would be wrong.
// While the rates load it is the same pill with a spinner, so it never looks tappable and does nothing.
function PricePillOff({ text, loading = false }) {
  return (
    <View style={s.pillOff} accessibilityRole="button" accessibilityState={{ disabled: true, busy: loading }} accessibilityLabel={text}>
      {loading ? <ActivityIndicator size="small" color={colors.textSecondary} /> : <Feather name="slash" size={13} color={colors.textSecondary} />}
      <Text style={s.pillOffText} numberOfLines={1}>{text}</Text>
    </View>
  )
}

export default function CarsScreen({ lang, onBack, onOpenCar, onPost, onMine }) {
  const insets = useSafeAreaInsets()
  const [mode, setMode] = useState('sale')
  const [make, setMake] = useState(null)
  const [priceBand, setPriceBand] = useState(null)   // a bandId
  const [yearBand, setYearBand] = useState(null)     // a yearId
  const [region, setRegion] = useState(null)
  const [makes, setMakes] = useState([])
  const [fx, setFx] = useState({ state: 'loading', data: null })

  useEffect(() => {
    let off = false
    loadKktcFx().then(({ data, failed }) => {
      if (off) return
      const usable = fxComplete(data) && (!failed || (data?.fetchedOn && daysOld(data.fetchedOn) <= FX_MAX_AGE_DAYS))
      setFx(usable ? { state: 'ok', data } : { state: 'none', data: null })
    })
    return () => { off = true }
  }, [])

  // Makes on offer in this mode, for the Marka sheet (searchable past 10). A make picked in another
  // mode that has none here is cleared, so the list is never filtered by a pill that reads "Marka".
  useEffect(() => {
    let off = false
    let q = supabase.from('vehicles').select('make', { count: 'exact' }).eq('status', 'active')
    if (mode !== 'all') q = q.eq('intent', mode)
    q.order('make').range(0, 999).then(({ data, count, error }) => {
      if (off || error || !data) return
      if (__DEV__ && data.length !== count) console.warn(`CarsScreen: makes list read ${data.length} of ${count} rows`)
      const list = [...new Set(data.map(r => r.make))].sort((a, b) => a.localeCompare(b))
      setMakes(list)
      setMake(m => (m && !list.includes(m) ? null : m))
    }, () => {})
    return () => { off = true }
  }, [mode])

  const bands = mode === 'all' ? [] : PRICE_BANDS[mode]
  const band = bands.find(b => bandId(b) === priceBand) || null
  const years = YEAR_BANDS.find(y => yearId(y) === yearBand) || null
  const priceOr = band ? priceOrFilter(mode, band, fx.data) : null

  const buildQuery = useCallback(() => {
    let q = supabase.from('vehicles').select(VEHICLE_COLS, { count: 'exact' }).eq('status', 'active')
    if (mode !== 'all') q = q.eq('intent', mode)
    if (make) q = q.eq('make', make)
    if (priceOr) q = q.or(priceOr)
    if (years?.[0] != null) q = q.gte('year', years[0])
    if (years?.[1] != null) q = q.lte('year', years[1])
    if (region) q = q.eq('region', region)
    return q.order('published_at', { ascending: false, nullsFirst: false }).order('id', { ascending: true })
  }, [mode, make, priceOr, years, region])

  const list = usePagedVehicles(buildQuery)

  // Leaving a mode drops its price band: £/day and £ bands are different scales.
  function changeMode(next) {
    if (next === mode) return
    setMode(next)
    setPriceBand(null)
  }
  const activeCount = [make, priceBand, yearBand, region].filter(v => v != null).length
  function clearAll() { setMake(null); setPriceBand(null); setYearBand(null); setRegion(null) }

  const makeOptions = useMemo(() => makes.map(m => ({ value: m, label: m })), [makes])

  return (
    <ModuleScreen topic="cars">
      <SafeAreaView style={s.safe} edges={['top']}>
        <ScreenHeader onBack={onBack} title={t('menuCars', lang)} lang={lang}
          actions={[{ icon: 'person-circle-outline', onPress: onMine, accessibilityLabel: t('carsMineTitle', lang) }]} />
        <ModeBar mode={mode} onChange={changeMode} lang={lang} />
        <FilterBar>
          <Dropdown label={t('carsFilterMake', lang)} lang={lang} options={makeOptions} value={make} onChange={setMake} />
          {mode !== 'all' && (
            fx.state === 'ok'
              ? <Dropdown label={t('carsFilterPrice', lang)} title={t('carsPriceTitle', lang)} lang={lang}
                  options={bands.map(b => ({ value: bandId(b), label: bandLabel(b, mode, lang) }))}
                  value={priceBand} onChange={setPriceBand} />
              : fx.state === 'loading'
                ? <PricePillOff text={t('carsFilterPrice', lang)} loading />
                : <PricePillOff text={t('carsPriceNoRates', lang)} />
          )}
          <Dropdown label={t('carsFilterYear', lang)} lang={lang}
            options={YEAR_BANDS.map(y => ({ value: yearId(y), label: yearLabel(y, lang) }))}
            value={yearBand} onChange={setYearBand} />
          <Dropdown label={t('carsFilterDistrict', lang)} lang={lang}
            options={REGIONS.map(r => ({ value: r, label: t(REGION_LABEL_KEY[r], lang) }))}
            value={region} onChange={setRegion} />
          {activeCount > 0 && (
            <TouchableOpacity style={s.clear} onPress={clearAll} accessibilityRole="button">
              <Feather name="x" size={14} color={colors.dangerInk} />
              <Text style={s.clearText}>{t('carsClear', lang)}</Text>
            </TouchableOpacity>
          )}
        </FilterBar>

        <View style={s.pane}>
          {list.loading ? (
            <View style={s.listContent}>{[0, 1, 2].map(i => <CardSkeleton key={i} height={300} style={{ marginBottom: 12 }} />)}</View>
          ) : list.loadError ? (
            <ErrorState lang={lang} onRetry={list.reload} style={{ marginTop: 40 }} />
          ) : (
            <FlatList
              data={list.items}
              keyExtractor={c => c.id}
              renderItem={({ item }) => <VehicleCard car={item} lang={lang} onPress={() => onOpenCar(item)} />}
              contentContainerStyle={[s.listContent, { paddingBottom: listBottomPad(insets) + TAP + 28 }]}
              showsVerticalScrollIndicator={false}
              refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} tintColor="#FFFFFF" colors={[colors.primary]} />}
              onEndReached={list.loadMore}
              onEndReachedThreshold={0.3}
              windowSize={5}
              initialNumToRender={4}
              maxToRenderPerBatch={4}
              removeClippedSubviews
              ListHeaderComponent={list.items.length > 0
                ? <OnPhotoLabel style={s.count}>{tCount('carsResultCount', list.total, lang)}</OnPhotoLabel>
                : null}
              ListEmptyComponent={
                <EmptyState icon="car-outline" category="city" style={{ marginTop: 28 }}
                  title={t(activeCount > 0 ? 'carsEmptyFiltered' : 'carsEmptyNone', lang)}
                  message={t(activeCount > 0 ? 'carsEmptyFilteredSub' : 'carsEmptyNoneSub', lang)}
                  action={activeCount > 0 ? { label: t('carsClear', lang), onPress: clearAll } : undefined} />
              }
              ListFooterComponent={
                list.loadingMore ? <ActivityIndicator style={{ marginVertical: 20 }} color="#FFFFFF" />
                  : list.moreError ? <ErrorState lang={lang} compact onRetry={list.retryMore} style={{ marginVertical: 16 }} />
                  : null
              }
            />
          )}
          {/* İlan ver: the one way in for a private seller. Guests and under-18s are stopped in App.js before the form. */}
          <TouchableOpacity style={[s.fab, { bottom: Math.max(insets.bottom, 12) + 12 }]} onPress={onPost} activeOpacity={0.88}
            accessibilityRole="button" accessibilityLabel={t('carsPostCta', lang)}>
            <Feather name="plus" size={20} color={colors.onPrimary} />
            <Text style={s.fabText}>{t('carsPostCta', lang)}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </ModuleScreen>
  )
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: 'transparent' },
  modeBar:     { flexDirection: 'row', flexGrow: 0, flexShrink: 0, marginHorizontal: 16, marginTop: 4, marginBottom: 2,
                 padding: 3, gap: 4, borderRadius: radii.tile, backgroundColor: colors.card, ...elevation.card },
  modeSeg:     { flex: 1, minHeight: TAP - 4, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, borderRadius: radii.md },
  modeSegOn:   { backgroundColor: colors.primary },
  modeText:    { ...type.body, fontFamily: 'Inter_500Medium', color: colors.textSecondary },
  modeTextOn:  { fontFamily: 'Inter_700Bold', color: colors.onPrimary },
  pillOff:     { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
                 borderWidth: 1.5, borderColor: colors.border, borderStyle: 'dashed', backgroundColor: colors.soft, maxWidth: 220 },
  pillOffText: { flexShrink: 1, fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.textSecondary },
  clear:       { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, minHeight: 36,
                 borderRadius: radii.pill, backgroundColor: colors.dangerLight },
  clearText:   { ...type.small, fontFamily: 'Inter_700Bold', color: colors.dangerInk },
  pane:        { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingTop: 4 },
  count:       { marginBottom: 10 },
  fab:         { position: 'absolute', right: 16, flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: TAP + 4,
                 paddingHorizontal: 18, borderRadius: radii.pill, backgroundColor: colors.primary, ...elevation.floating },
  fabText:     { ...type.body, fontFamily: 'Inter_700Bold', color: colors.onPrimary },
})
