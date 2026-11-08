import { useState, useEffect, useCallback } from 'react'
import { View, Text, FlatList, TouchableOpacity, RefreshControl, Alert, StyleSheet } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { ScreenHeader, PageCanvas, Button, CardSkeleton, EmptyState, ErrorState, RemoteImage } from '../components/ui'
import ListingHiddenBanner from '../components/ListingHiddenBanner'
import { photoUrl, priceLabel, kmLabel } from '../components/cars/VehicleCard'
import { colors, type, radii, elevation, press, listBottomPad } from '../constants/theme'
import { t } from '../constants/i18n'
import {
  MY_VEHICLE_COLS, MY_STATE_LABEL_KEY, OPEN_LISTING_CAP, myCarState, daysLeft, canRenew, canEdit, openListingCount,
  sortedImages, carErrorText, rejectionText,
} from '../constants/cars'

// ─── İlanlarım: the seller's own listings in every state ────────────────────
// Read through my_vehicles() (owner_id is not client-readable). Renew = renew_vehicle() (30 days from now; an expired
// listing re-checks the cap of 3). Remove = status 'removed', final: the guard refuses any later change, and the
// nightly cleanup deletes its photo files after a few days. Edit opens the form; on an approved listing it re-submits.

const STATE_STYLE = {
  pending:  { bg: colors.accentLight, ink: colors.tintLifestyleFg, icon: 'time-outline' },
  active:   { bg: colors.successLight, ink: colors.successInk, icon: 'checkmark-circle-outline' },
  expired:  { bg: colors.soft, ink: colors.textSecondary, icon: 'hourglass-outline' },
  rejected: { bg: colors.dangerLight, ink: colors.dangerInk, icon: 'close-circle-outline' },
  removed:  { bg: colors.soft, ink: colors.textSecondary, icon: 'trash-outline' },
  hidden:   { bg: colors.dangerLight, ink: colors.dangerInk, icon: 'eye-off-outline' },
}

function StatusPill({ state, lang }) {
  const st = STATE_STYLE[state] || STATE_STYLE.pending
  return (
    <View style={[s.pill, { backgroundColor: st.bg }]}>
      <Ionicons name={st.icon} size={13} color={st.ink} />
      <Text style={[s.pillText, { color: st.ink }]}>{t(MY_STATE_LABEL_KEY[state], lang)}</Text>
    </View>
  )
}

function MyCarCard({ car, lang, busy, onOpen, onEdit, onRenew, onRemove }) {
  const state = myCarState(car)
  const uri = photoUrl(sortedImages(car.vehicle_images)[0]?.storage_path)
  const left = daysLeft(car)
  const price = priceLabel(car, lang)
  const photoCount = car.vehicle_images?.length ?? 0
  let note = null
  if (state === 'active' && left != null) note = t(left <= 1 ? 'carsMineEndsTomorrow' : 'carsMineEndsIn', lang).replace('{n}', String(left))
  if (state === 'pending') note = t('carsMinePendingNote', lang)
  if (state === 'expired') note = t('carsMineExpiredNote', lang)
  if (state === 'removed') note = t('carsMineRemovedNote', lang)
  const noPhotos = state !== 'removed' && photoCount === 0

  return (
    <View style={s.card}>
      <TouchableOpacity style={s.top} onPress={state === 'active' ? onOpen : onEdit} disabled={!canEdit(car) && state !== 'active'}
        activeOpacity={press.card} accessibilityRole="button">
        <View style={s.thumb}>
          {uri
            ? <RemoteImage source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            : <Ionicons name="car-outline" size={28} color={colors.textSecondary} />}
        </View>
        <View style={s.info}>
          <StatusPill state={state} lang={lang} />
          <Text style={s.title} numberOfLines={1}>{car.make} {car.model}</Text>
          <Text style={s.sub} numberOfLines={1}>{[String(car.year), kmLabel(car.km), price].filter(Boolean).join(' · ')}</Text>
        </View>
      </TouchableOpacity>

      {!!note && <Text style={s.note}>{note}</Text>}
      {state === 'rejected' && (
        <View style={s.reason}>
          <Text style={s.reasonTitle}>{t('carsMineRejectedWhy', lang)}</Text>
          <Text style={s.reasonText}>{car.rejection_reason ? rejectionText(car.rejection_reason, k => t(k, lang)) : t('carsMineRejectedNoReason', lang)}</Text>
        </View>
      )}
      {noPhotos && <Text style={s.warn}>{t('carsMineNoPhotos', lang)}</Text>}
      {state === 'hidden' && <ListingHiddenBanner hiddenAt={car.hidden_at} hiddenReason={null} lang={lang} style={{ marginTop: 10 }} />}

      {state !== 'removed' && (
        <View style={s.actions}>
          {canRenew(car) && <Button title={t('carsMineRenew', lang)} icon="refresh" onPress={onRenew} loading={busy === 'renew'} style={s.action} />}
          {canEdit(car) && <Button title={t(state === 'rejected' ? 'carsMineFix' : 'carsMineEdit', lang)} variant="secondary" icon="create-outline" onPress={onEdit} style={s.action} />}
          <Button title={t('carsMineRemove', lang)} variant="text" onPress={onRemove} loading={busy === 'remove'} style={s.action} />
        </View>
      )}
    </View>
  )
}

export default function MyCarsScreen({ lang, onBack, onPost, onEdit, onOpenCar, reloadKey = 0 }) {
  const insets = useSafeAreaInsets()
  const [cars, setCars] = useState(null)
  const [failed, setFailed] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState(null)   // `${id}:renew` | `${id}:remove`

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_vehicles').select(MY_VEHICLE_COLS)
    if (error) { setFailed(true); return }
    setFailed(false)
    setCars(data || [])
  }, [])
  useEffect(() => { load() }, [load, reloadKey])

  async function refresh() { setRefreshing(true); await load(); setRefreshing(false) }

  async function renew(car) {
    setBusy(`${car.id}:renew`)
    const { error } = await supabase.rpc('renew_vehicle', { p_id: car.id })
    setBusy(null)
    if (error) { Alert.alert(t('carsMineRenew', lang), carErrorText(error, k => t(k, lang))); return }
    load()
  }

  function remove(car) {
    Alert.alert(t('carsMineRemoveTitle', lang), t('carsMineRemoveBody', lang), [
      { text: t('cancel', lang), style: 'cancel' },
      {
        text: t('carsMineRemove', lang), style: 'destructive', onPress: async () => {
          setBusy(`${car.id}:remove`)
          const { data, error } = await supabase.from('vehicles').update({ status: 'removed' }).eq('id', car.id).select('id')
          setBusy(null)
          if (error || !data?.length) { Alert.alert(t('carsMineRemove', lang), carErrorText(error, k => t(k, lang))); return }
          load()
        },
      },
    ])
  }

  const list = (cars || []).filter(c => myCarState(c) !== 'removed')
  const atCap = cars ? openListingCount(cars) >= OPEN_LISTING_CAP : false

  return (
    <PageCanvas>
      <SafeAreaView style={s.safe} edges={['top']}>
        <ScreenHeader title={t('carsMineTitle', lang)} onBack={onBack} lang={lang} />
        {cars == null && !failed ? (
          <View style={s.content}>{[0, 1].map(i => <CardSkeleton key={i} height={150} style={{ marginBottom: 12 }} />)}</View>
        ) : failed ? (
          <ErrorState lang={lang} onRetry={load} style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={list}
            keyExtractor={c => c.id}
            renderItem={({ item }) => (
              <MyCarCard car={item} lang={lang} busy={busy?.startsWith(item.id) ? busy.split(':')[1] : null}
                onOpen={() => onOpenCar(item)} onEdit={() => onEdit(item)} onRenew={() => renew(item)} onRemove={() => remove(item)} />
            )}
            contentContainerStyle={[s.content, { paddingBottom: listBottomPad(insets) }]}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} colors={[colors.primary]} />}
            ListHeaderComponent={list.length > 0 ? (
              <View style={s.head}>
                <Text style={s.cap}>{t('carsMineCap', lang).replace('{n}', String(OPEN_LISTING_CAP))}</Text>
                {!atCap && <Button title={t('carsPostCta', lang)} icon="add" onPress={onPost} style={{ marginTop: 10 }} />}
              </View>
            ) : null}
            ListEmptyComponent={
              <EmptyState icon="car-outline" category="city" style={{ marginTop: 28 }}
                title={t('carsMineEmpty', lang)} message={t('carsMineEmptySub', lang)}
                action={{ label: t('carsPostCta', lang), onPress: onPost }} />
            }
          />
        )}
      </SafeAreaView>
    </PageCanvas>
  )
}

const s = StyleSheet.create({
  safe:       { flex: 1 },
  content:    { paddingHorizontal: 16, paddingTop: 4 },
  head:       { marginBottom: 12 },
  cap:        { ...type.small, color: colors.textSecondaryOnPage },
  card:       { backgroundColor: colors.card, borderRadius: radii.tile, padding: 12, marginBottom: 12, ...elevation.card },
  top:        { flexDirection: 'row', gap: 12 },
  thumb:      { width: 96, height: 72, borderRadius: radii.md, overflow: 'hidden', backgroundColor: colors.soft,
                alignItems: 'center', justifyContent: 'center' },
  info:       { flex: 1, minWidth: 0, gap: 3 },
  pill:       { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.pill },
  pillText:   { ...type.meta, fontFamily: 'Inter_700Bold' },
  title:      { ...type.rowTitle, color: colors.textPrimary },
  sub:        { ...type.small, color: colors.textSecondary },
  note:       { ...type.small, color: colors.textSecondary, marginTop: 10 },
  warn:       { ...type.small, fontFamily: 'Inter_600SemiBold', color: colors.dangerInk, marginTop: 8 },
  reason:     { marginTop: 10, padding: 10, borderRadius: radii.md, backgroundColor: colors.dangerLight },
  reasonTitle:{ ...type.meta, fontFamily: 'Inter_700Bold', color: colors.dangerInk },
  reasonText: { ...type.small, color: colors.textPrimary, marginTop: 2 },
  actions:    { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 12 },
  action:     { flexGrow: 0 },
})
