import { useCallback } from 'react'
import { View, Text, FlatList, ActivityIndicator, RefreshControl, StyleSheet, Linking } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { ScreenHeader, ContactBar, InfoRow, RemoteImage, PageCanvas, CardSkeleton, EmptyState, ErrorState } from '../components/ui'
import VehicleCard, { photoUrl, placeLabel } from '../components/cars/VehicleCard'
import usePagedVehicles from '../utils/usePagedVehicles'
import { colors, category as CAT, type, radii, elevation, listBottomPad } from '../constants/theme'
import { t } from '../constants/i18n'
import { logContactEvent } from '../utils/logContactEvent'
import { VEHICLE_COLS, telUrl, waUrl } from '../constants/cars'

// A dealer (or rental company): who they are, how to reach them, then their cars — the same card
// as the list. A car opened here stacks over this page (App.js carsStack), so back returns here.
// Contact taps log against the DEALER's id (module 'cars'); a car's own taps log the car's id.

const LOGO = 72
const c = CAT.city
const hostOf = url => String(url).replace(/^https?:\/\//, '').replace(/\/$/, '')

function DealerHeader({ dealer, lang, total }) {
  const logo = photoUrl(dealer.logo_path)
  const place = placeLabel(dealer.region, dealer.area, lang)
  const log = action => logContactEvent('cars', dealer.id, action, dealer.region)
  const actions = [
    dealer.phone && { kind: 'call', onPress: () => { log('call'); Linking.openURL(telUrl(dealer.phone)).catch(() => {}) },
      accessibilityLabel: `${t('call', lang)} ${dealer.phone}` },
    dealer.whatsapp && { kind: 'whatsapp', onPress: () => { log('whatsapp'); Linking.openURL(waUrl(dealer.whatsapp)).catch(() => {}) } },
  ].filter(Boolean)
  const openSite = () => { log('website'); Linking.openURL(dealer.website).catch(() => {}) }
  return (
    <View>
      <View style={s.card}>
        <View style={s.head}>
          {logo
            ? <RemoteImage source={{ uri: logo }} style={s.logo} resizeMode="contain" placeholderColor={colors.soft} accessibilityIgnoresInvertColors />
            : (
              <View style={[s.logo, s.initial]} accessible={false}>
                <Text style={s.initialText}>{(dealer.name || '?').trim().charAt(0).toLocaleUpperCase('tr')}</Text>
              </View>
            )}
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={s.name} accessibilityRole="header">{dealer.name}</Text>
            {dealer.is_rental_company && (
              <View style={s.badge}>
                <Ionicons name="key-outline" size={12} color={CAT.explore.ink} />
                <Text style={s.badgeText}>{t('carsRentalCompany', lang)}</Text>
              </View>
            )}
            {!!place && (
              <View style={s.placeRow}>
                <Ionicons name="location-outline" size={13} color={colors.textSecondary} />
                <Text style={s.place} numberOfLines={1}>{place}</Text>
              </View>
            )}
          </View>
        </View>
        {actions.length > 0 && <ContactBar actions={actions} lang={lang} style={{ marginTop: 14 }} />}
        {!!dealer.website && (
          <View style={{ marginTop: 6 }}>
            <InfoRow icon="globe-outline" category="city" label={t('carsWebsite', lang)} value={hostOf(dealer.website)} onPress={openSite} divider={false} />
          </View>
        )}
      </View>
      <Text style={s.section}>{t('carsDealerCars', lang)}{total > 0 ? ` · ${total}` : ''}</Text>
    </View>
  )
}

export default function DealerScreen({ dealer, lang, onBack, onOpenCar }) {
  const insets = useSafeAreaInsets()
  const dealerId = dealer?.id
  const buildQuery = useCallback(() => supabase.from('vehicles').select(VEHICLE_COLS, { count: 'exact' })
    .eq('status', 'active').eq('dealer_id', dealerId)
    .order('published_at', { ascending: false, nullsFirst: false }).order('id', { ascending: true }), [dealerId])
  const list = usePagedVehicles(buildQuery)
  if (!dealer) return null

  return (
    <PageCanvas flat>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScreenHeader onBack={onBack} title={null} lang={lang} />
        <FlatList
          data={list.loading || list.loadError ? [] : list.items}
          keyExtractor={v => v.id}
          renderItem={({ item }) => <VehicleCard car={item} lang={lang} showDealer={false} onPress={() => onOpenCar(item)} />}
          contentContainerStyle={[s.content, { paddingBottom: listBottomPad(insets) }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[colors.primary]} />}
          onEndReached={list.loadMore}
          onEndReachedThreshold={0.3}
          windowSize={5}
          initialNumToRender={3}
          ListHeaderComponent={<DealerHeader dealer={dealer} lang={lang} total={list.loading ? 0 : list.total} />}
          ListEmptyComponent={
            list.loading ? <CardSkeleton height={300} />
              : list.loadError ? <ErrorState lang={lang} onRetry={list.reload} />
              : <EmptyState icon="car-outline" category="city" title={t('carsDealerEmpty', lang)} />
          }
          ListFooterComponent={
            list.loadingMore ? <ActivityIndicator style={{ marginVertical: 20 }} color={colors.primary} />
              : list.moreError ? <ErrorState lang={lang} compact onRetry={list.retryMore} style={{ marginVertical: 16 }} />
              : null
          }
        />
      </SafeAreaView>
    </PageCanvas>
  )
}

const s = StyleSheet.create({
  content:     { paddingHorizontal: 16, paddingTop: 4 },
  card:        { backgroundColor: colors.card, borderRadius: radii.card, padding: 16, ...elevation.card },
  head:        { flexDirection: 'row', alignItems: 'center', gap: 14 },
  logo:        { width: LOGO, height: LOGO, borderRadius: radii.tile, backgroundColor: colors.soft },
  initial:     { alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg },
  initialText: { fontSize: 30, lineHeight: 36, fontFamily: 'Inter_700Bold', color: c.ink },
  name:        { ...type.sheetTitle, fontSize: 20, lineHeight: 26, color: colors.textPrimary },
  badge:       { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3,
                 borderRadius: radii.pill, backgroundColor: CAT.explore.bg },
  badgeText:   { ...type.caption, fontFamily: 'Inter_700Bold', color: CAT.explore.ink },
  placeRow:    { flexDirection: 'row', alignItems: 'center', gap: 4 },
  place:       { flex: 1, ...type.small, color: colors.textSecondary },
  section:     { ...type.sectionHeading, color: colors.textPrimary, marginTop: 22, marginBottom: 10 },
})
