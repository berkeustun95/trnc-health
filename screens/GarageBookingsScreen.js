import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { colors, radius, shadow } from '../constants/theme'
import { t } from '../constants/i18n'
import BackButton from '../components/BackButton'

// Owner-side bookings surface for garages. Clones the grooming version: reads/writes
// appointments under the role-agnostic owner policies (facility ownership), so it needs
// NO profiles.role. The garage delta is the garage_booking_details display
// (multi-service badges + car + tappable phone + notes).

const GARAGE_SVC_KEY = {
  muayene: 'garageCatMuayene', repair: 'garageCatRepair', tyres: 'garageCatTyres',
  wash: 'garageCatWash', parts: 'garageCatParts', towing: 'garageCatTowing',
}

async function sendPush(token, title, body) {
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ to: token, title, body, sound: 'default', data: { screen: 'profile' } }),
    })
  } catch { /* non-critical */ }
}

// Notify the booking customer (push + in-app inbox row), localized to their language.
// get_customer_contacts returns only the caller's own booking-customers (an appointment
// at their facility) and only safe columns; insert_notification's owner→customer branch
// is role-agnostic (facility ownership).
async function notifyCustomer(customerId, facilityName, titleKey, bodyKey) {
  try {
    const { data: contacts } = await supabase
      .rpc('get_customer_contacts', { p_ids: [customerId] })
    const p = contacts?.[0]
    const cLang = p?.preferred_language || 'English'
    const title = t(titleKey, cLang)
    const body  = t(bodyKey, cLang).replace('{name}', facilityName)
    if (p?.push_token) await sendPush(p.push_token, title, body)
    await supabase.rpc('insert_notification', { p_user_id: customerId, p_title: title, p_body: body })
  } catch { /* non-critical */ }
}

function fmtWhen(iso, lang) {
  const code = { English:'en-US', Turkish:'tr-TR', Arabic:'ar', Russian:'ru-RU', Greek:'el-GR',
                 French:'fr-FR', Spanish:'es-ES', German:'de-DE', Persian:'fa-IR' }[lang] || 'en-US'
  try {
    return new Date(iso).toLocaleString(code, { weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })
  } catch {
    return new Date(iso).toLocaleString()
  }
}

function BookingRow({ item, lang, actions }) {
  const details = item.garage_booking_details || {}
  const car = details.car || {}
  const carLine = [car.make, car.model, car.year, car.plate].filter(Boolean).join(' ')
  return (
    <View style={s.row}>
      <View style={{ flex: 1 }}>
        <Text style={s.when}>{fmtWhen(item.requested_time, lang)}</Text>
        <Text style={s.customer} numberOfLines={1}>{item.customer_name || t('garageBkCustomer', lang)}</Text>
        {details.services?.length > 0 && (
          <View style={s.badgeRow}>
            {details.services.map(sv => (
              <View key={sv} style={s.serviceBadge}>
                <Text style={s.serviceBadgeText}>{t(GARAGE_SVC_KEY[sv] || sv, lang)}</Text>
              </View>
            ))}
          </View>
        )}
        {!!carLine && <Text style={s.detailLine} numberOfLines={1}>🚗 {carLine}</Text>}
        {!!details.notes && <Text style={s.detailLine} numberOfLines={2}>{details.notes}</Text>}
        {!!details.phone && (
          <TouchableOpacity style={s.callRow} onPress={() => Linking.openURL(`tel:${details.phone}`)}>
            <Ionicons name="call-outline" size={13} color={colors.primary} />
            <Text style={s.callText}>{details.phone}</Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={s.actions}>{actions}</View>
    </View>
  )
}

export default function GarageBookingsScreen({ facility, lang = 'English', onBack }) {
  const [pending, setPending]   = useState([])
  const [upcoming, setUpcoming] = useState([])
  const [past, setPast]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(false)
  const [acting, setActing]     = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    const { data, error: err } = await supabase
      .from('appointments')
      .select('id, requested_time, status, customer_id, garage_booking_details')
      .eq('facility_id', facility.id)
      .in('status', ['pending', 'confirmed'])
      .order('requested_time', { ascending: true })
    if (err) { setError(true); setLoading(false); return }

    const rows = data || []
    const ids = [...new Set(rows.map(r => r.customer_id).filter(Boolean))]
    const names = {}
    if (ids.length) {
      const { data: profs } = await supabase.rpc('get_customer_contacts', { p_ids: ids })
      ;(profs || []).forEach(p => { names[p.id] = p.full_name })
    }
    const withNames = rows.map(r => ({ ...r, customer_name: names[r.customer_id] || null }))
    const now = new Date()
    setPending(withNames.filter(r => r.status === 'pending'))
    setUpcoming(withNames.filter(r => r.status === 'confirmed' && new Date(r.requested_time) >= now))
    setPast(withNames.filter(r => r.status === 'confirmed' && new Date(r.requested_time) < now))
    setLoading(false)
  }, [facility.id])

  useEffect(() => { load() }, [load])

  async function setStatus(item, status, titleKey, bodyKey) {
    setActing(item.id)
    const { error: err } = await supabase.from('appointments').update({ status }).eq('id', item.id)
    if (!err) {
      if (titleKey) await notifyCustomer(item.customer_id, facility.name, titleKey, bodyKey)
      await load()
    } else {
      Alert.alert('', err.message)
    }
    setActing(null)
  }

  async function noShow(item) {
    setActing(item.id)
    const { error: err } = await supabase.rpc('record_no_show', { p_appointment_id: item.id })
    if (!err) await load()
    else Alert.alert('', err.message)
    setActing(null)
  }

  function confirm(item) {
    setStatus(item, 'confirmed', 'garageNotifConfirmedTitle', 'garageNotifConfirmedBody')
  }
  function decline(item) {
    Alert.alert(t('garageBkDeclineQ', lang), t('garageBkDeclineQBody', lang), [
      { text: t('back', lang), style: 'cancel' },
      { text: t('garageBkDecline', lang), style: 'destructive',
        onPress: () => setStatus(item, 'cancelled', 'garageNotifDeclinedTitle', 'garageNotifDeclinedBody') },
    ])
  }
  function cancelConfirmed(item) {
    Alert.alert(t('garageBkCancelQ', lang), t('garageBkCancelQBody', lang), [
      { text: t('back', lang), style: 'cancel' },
      { text: t('garageBkCancel', lang), style: 'destructive',
        onPress: () => setStatus(item, 'cancelled', 'garageNotifCancelledTitle', 'garageNotifCancelledBody') },
    ])
  }
  function complete(item) { setStatus(item, 'completed', null, null) }
  function markNoShow(item) {
    Alert.alert(t('garageBkNoShowQ', lang), t('garageBkNoShowQBody', lang), [
      { text: t('back', lang), style: 'cancel' },
      { text: t('garageBkNoShow', lang), style: 'destructive', onPress: () => noShow(item) },
    ])
  }

  const sections = [
    pending.length  && { key: 'pending',  title: t('garageBkPendingSection', lang),  data: pending },
    upcoming.length && { key: 'upcoming', title: t('garageBkUpcomingSection', lang), data: upcoming },
    past.length     && { key: 'past',     title: t('garageBkPastSection', lang),     data: past },
  ].filter(Boolean)

  function renderActions(item) {
    const busy = acting === item.id
    if (busy) return <ActivityIndicator color={colors.primary} />
    if (item.status === 'pending') {
      return (
        <>
          <TouchableOpacity style={s.confirmBtn} onPress={() => confirm(item)}>
            <Text style={s.confirmBtnText}>{t('garageBkConfirm', lang)}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.ghostDanger} onPress={() => decline(item)}>
            <Text style={s.ghostDangerText}>{t('garageBkDecline', lang)}</Text>
          </TouchableOpacity>
        </>
      )
    }
    const isPast = new Date(item.requested_time) < new Date()
    if (isPast) {
      return (
        <>
          <TouchableOpacity style={s.ghostBtn} onPress={() => complete(item)}>
            <Text style={s.ghostBtnText}>{t('garageBkComplete', lang)}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.ghostDanger} onPress={() => markNoShow(item)}>
            <Text style={s.ghostDangerText}>{t('garageBkNoShow', lang)}</Text>
          </TouchableOpacity>
        </>
      )
    }
    return (
      <TouchableOpacity style={s.ghostDanger} onPress={() => cancelConfirmed(item)}>
        <Text style={s.ghostDangerText}>{t('garageBkCancel', lang)}</Text>
      </TouchableOpacity>
    )
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <BackButton variant="bare" lang={lang} onPress={onBack} />
        <Text style={s.headerTitle}>{t('garageBkTitle', lang)}</Text>
        <View style={{ width: 44 }} />
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={colors.primary} style={{ flex: 1 }} />
      ) : error ? (
        <View style={s.center}>
          <Ionicons name="wifi-outline" size={40} color={colors.border} style={{ marginBottom: 12 }} />
          <Text style={s.emptyText}>{t('facilityLoadError', lang)}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={load}>
            <Text style={s.retryBtnText}>{t('tryAgain', lang)}</Text>
          </TouchableOpacity>
        </View>
      ) : sections.length === 0 ? (
        <View style={s.center}>
          <View style={s.emptyIcon}><Ionicons name="calendar-outline" size={34} color={colors.border} /></View>
          <Text style={s.emptyText}>{t('garageBkEmpty', lang)}</Text>
        </View>
      ) : (
        <FlatList
          data={sections}
          keyExtractor={sec => sec.key}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item: sec }) => (
            <View style={{ marginBottom: 20 }}>
              <Text style={s.sectionTitle}>{sec.title}</Text>
              {sec.data.map(item => (
                <BookingRow key={item.id} item={item} lang={lang} actions={renderActions(item)} />
              ))}
            </View>
          )}
        />
      )}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: colors.bg },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                   paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.cardBg,
                   borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle:   { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary },

  list:          { padding: 20, paddingBottom: 40 },
  sectionTitle:  { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textSecondary,
                   letterSpacing: 0.5, marginBottom: 10, textTransform: 'uppercase' },

  row:           { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.cardBg,
                   borderRadius: radius.card, padding: 14, marginBottom: 8, ...shadow,
                   borderWidth: 1, borderColor: colors.border },
  when:          { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 2 },
  customer:      { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  badgeRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  serviceBadge:  { backgroundColor: colors.primaryLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  serviceBadgeText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary },
  detailLine:    { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 6 },
  callRow:       { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, alignSelf: 'flex-start' },
  callText:      { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary },
  actions:       { flexDirection: 'row', alignItems: 'center', gap: 8 },

  confirmBtn:    { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: 14 },
  confirmBtnText:{ fontSize: 13, fontFamily: 'Inter_700Bold', color: '#fff' },
  ghostBtn:      { backgroundColor: colors.primaryLight, borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: 12 },
  ghostBtnText:  { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary },
  ghostDanger:   { backgroundColor: colors.dangerLight, borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: 12 },
  ghostDangerText:{ fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.danger },

  center:        { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyIcon:     { width: 68, height: 68, borderRadius: 34, backgroundColor: colors.cardBg,
                   alignItems: 'center', justifyContent: 'center', marginBottom: 14, ...shadow },
  emptyText:     { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textAlign: 'center' },
  retryBtn:      { marginTop: 14, backgroundColor: colors.primaryLight, borderRadius: radius.md,
                   paddingHorizontal: 20, paddingVertical: 10 },
  retryBtnText:  { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.primary },
})
