import { useState, useEffect, useCallback, useMemo } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Linking } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { colors, brandInk } from '../constants/theme'
import { t } from '../constants/i18n'
import BackButton from '../components/BackButton'
import StoreMap from '../components/StoreMap'
import ConnectivityErrorState from '../components/ConnectivityErrorState'
import { fetchStores, storeDirectionsUrl, decorateStores, mappableStores } from '../lib/connectivity'

// Bağlantı & eSIM — the operator's branch list and map.
//
// Reached from the compact "En yakın şube" row on screen 2, and deliberately NOT from
// Explore: the branch list is single-source in connectivity_stores, and a user mid-way
// through choosing a package must not be dropped into a different module to find the door.
//
// ⚠ THE MAP IS INTERACTIVE HERE AND READ-ONLY ON SCREEN 3, from the same component. The
//   read-only treatment exists because a gesture-enabled map inside a ScrollView steals
//   vertical drags; that reasoning does not apply on a dedicated screen where the map IS
//   the content and the list scrolls separately below it. One component, one boolean.

// Defined outside the screen so it is not remounted on every parent render.
function StoreRow({ store, lang, accent, first }) {
  const url = storeDirectionsUrl(store)
  const detail = [store.city, store.opening_hours].filter(Boolean).join(' · ')

  return (
    <View style={[s.row, !first && s.rowDivided]}>
      <View style={s.rowInfo}>
        <Text style={s.rowName}>{store.name}</Text>
        {store.is_airport && (
          <Text style={[s.rowTag, { color: accent }]}>{t('connPickupAirport', lang)}</Text>
        )}
        {!!detail && <Text style={s.rowDetail}>{detail}</Text>}
        {/* Labelled straight-line for the same reason as everywhere else in this module:
            haversine is not a driving distance. Absent entirely when the row has no
            coordinates — no placeholder, no zero. */}
        {store._dist != null && (
          <Text style={s.rowDist}>
            {store._dist.toFixed(1)} km · {t('dutyStraightLine', lang)}
          </Text>
        )}
      </View>
      {/* maps_url when the row carries one, coordinates otherwise, and hidden when it has
          neither — an address-only branch is a real place, but a directions link that opens
          nothing is worse than no link. */}
      {!!url && (
        <TouchableOpacity
          onPress={() => Linking.openURL(url).catch(() => {})}
          activeOpacity={0.7}
          accessibilityRole="link"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={s.rowLink}>{t('connDirections', lang)}</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

export default function ConnectivityStoresScreen({ operator, lang, onBack, userLocation, locationDenied }) {
  const [stores, setStores]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [retrying, setRetrying] = useState(false)
  const [failed, setFailed]     = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await fetchStores(operator?.id)
    setFailed(!!error)
    setStores(data ?? [])
  }, [operator?.id])

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data, error } = await fetchStores(operator?.id)
      if (!active) return
      setFailed(!!error)
      setStores(data ?? [])
      setLoading(false)
    })()
    return () => { active = false }
  }, [operator?.id])

  // Its OWN retry, not screen 2's. The two screens query the same table for different
  // purposes and must not be able to refetch each other.
  const onRetry = useCallback(async () => {
    setRetrying(true)
    await load()
    setRetrying(false)
  }, [load])

  const sortByDistance = !!userLocation && !locationDenied
  const primary = operator?.brand_primary || colors.primary
  const ink     = brandInk(operator?.brand_secondary || colors.textPrimary)

  // Derived, keyed on the coordinates — the fix can land after this screen mounts.
  const decorated = useMemo(
    () => decorateStores(stores, sortByDistance ? userLocation : null, { sortByDistance }),
    [stores, sortByDistance, userLocation?.latitude, userLocation?.longitude],
  )

  // The map draws only rows that HAVE coordinates; the list below draws all of them. Two
  // derivations from one fetch, on purpose — an address-only branch is a real place a user
  // can walk into, so it belongs in the list even though it can never be a pin.
  const mapStores = useMemo(() => mappableStores(decorated), [decorated])

  function renderBody() {
    if (loading) return <View style={[s.bodyPad, s.center]}><ActivityIndicator color={colors.primary} /></View>

    // ⚠ A FAILURE IS AN ERROR STATE; ZERO ROWS IS NOT. This is the only table in the module
    //   that may legitimately be empty, and the distinction is preserved deliberately —
    //   conn:health reports an empty store list as a note rather than a failure for exactly
    //   the same reason. Reaching this screen at zero rows takes a mid-session race (the
    //   entry row on screen 2 is absent when there are no stores), but "unlikely" is not
    //   "impossible", and rendering a fault here would teach the wrong lesson.
    if (failed) {
      // TITLE NAMES WHAT FAILED. Without this it would say "Operatör listesi yüklenemedi" on
      // a screen the user reached THROUGH the operator screen, having just watched that list
      // load — the exact failure the per-screen title rule was introduced to prevent.
      return (
        <View style={s.bodyPad}>
          <ConnectivityErrorState
            lang={lang}
            onRetry={onRetry}
            retrying={retrying}
            titleKey="connStoresErrorTitle"
          />
        </View>
      )
    }
    if (!decorated.length) {
      return (
        <View style={[s.bodyPad, s.emptyBox]}>
          <Ionicons name="storefront-outline" size={28} color={colors.textSecondary} />
          <Text style={s.emptyText}>{t('connStoresEmpty', lang)}</Text>
        </View>
      )
    }

    return (
      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={s.list}>
          {decorated.map((store, i) => (
            <StoreRow key={store.id} store={store} lang={lang} accent={ink} first={i === 0} />
          ))}
        </View>
      </ScrollView>
    )
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <BackButton lang={lang} onPress={onBack} />
        <Text style={s.headerTitle} numberOfLines={1}>{t('connStoresTitle', lang)}</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* ⚠ THE MAP IS A FIXED SIBLING ABOVE THE LIST, NOT INSIDE THE SCROLLVIEW — and that
          is the whole reason it can be interactive at all. An interactive MapView inside a
          scrolling parent is exactly the gesture conflict StoreMap's read-only mode exists
          to avoid: the map swallows vertical drags and the page stops scrolling. Putting it
          outside removes the conflict rather than trading one bug for another.

          flexShrink: 0 is mandatory here, not decorative: a fixed-height View placed as a
          flex sibling ABOVE a scrollable list in a flex:1 column gets vertically compressed
          once the list overflows. It only reproduces with enough rows to make the list
          scroll, so it is invisible with the short lists we have today. */}
      {!loading && !failed && mapStores.length > 0 && (
        <View style={s.mapWrap}>
          <StoreMap stores={mapStores} pinColor={primary} interactive height={220} style={s.map} />
        </View>
      )}

      {renderBody()}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: colors.bg },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.cardBg, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle:   { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, flex: 1, textAlign: 'center' },
  scroll:        { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 48 },
  center:        { paddingVertical: 40, alignItems: 'center' },
  // The success branch owns its own padded ScrollView; the three non-success branches are
  // bare children of SafeAreaView since the map was hoisted out, so they need the padding
  // back explicitly. Without it the error card — rounded and shadowed — sits flush against
  // both screen edges.
  bodyPad:       { padding: 16 },

  mapWrap:       { flexShrink: 0, paddingHorizontal: 16, paddingTop: 16 },
  map:           { borderRadius: 14, overflow: 'hidden' },

  list:          { backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.border, borderRadius: 14, overflow: 'hidden' },
  row:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 13, paddingVertical: 12 },
  rowDivided:    { borderTopWidth: 1, borderTopColor: colors.border },
  // flex:1 so a long branch name wraps instead of pushing the directions link off the row.
  rowInfo:       { flex: 1 },
  rowName:       { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  rowTag:        { fontSize: 9.5, fontFamily: 'Inter_700Bold', letterSpacing: 0.4, marginTop: 3 },
  rowDetail:     { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 2 },
  rowDist:       { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 3 },
  // ADA's teal, not the brand: our action on our surface, like every other directions link.
  rowLink:       { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.primary },

  emptyBox:      { alignItems: 'center', gap: 10, paddingVertical: 40, paddingHorizontal: 24 },
  emptyText:     { fontSize: 13.5, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
})
