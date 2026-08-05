import { useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { t } from '../constants/i18n'
import { FEATURED_LIVE } from '../constants/flags'
import { isFeatured } from '../utils/featured'

// Owner-facing "feature this listing" entry, shown on a provider's own management
// view (garage/grooming ActiveState, health provider screen). GENERIC — reads the
// two facility timestamps and works for any facility type.
//
// ANTI-STEERING (iOS 3.1.1): NO price, amount, bank details, or payment
// instruction appears here. The request says only "we'll be in touch to set it
// up"; payment is arranged entirely off-app by the admin.
//
// Three states, driven purely by the row:
//   active  (featured_until > now)         → "Featured until <date>"
//   pending (featured_requested_at set)    → "requested — we'll be in touch"
//   idle                                   → request CTA
//
// Dark launch: while FEATURED_LIVE is false the request CTA is hidden from normal
// owners; admins (isAdmin) preview it. A listing that already has featured state
// always shows that state, so a mid-window flag flip never hides a live request.
export default function FeaturedRequestCard({ facility, lang, isAdmin = false, onChanged, style }) {
  const [busy, setBusy] = useState(false)

  const active   = isFeatured(facility)
  const pending  = !active && !!facility?.featured_requested_at
  const idle     = !active && !pending

  if (idle && !FEATURED_LIVE && !isAdmin) return null

  async function request() {
    setBusy(true)
    const { error } = await supabase.rpc('request_featured_facility', { p_facility_id: facility.id })
    setBusy(false)
    if (error) {
      Alert.alert('', t('featuredRequestError', lang))
      return
    }
    Alert.alert(t('featuredRequestedTitle', lang), t('featuredRequestedSub', lang))
    onChanged?.()
  }

  if (active) {
    const date = new Date(facility.featured_until).toLocaleDateString('en-GB',
      { day: 'numeric', month: 'short', year: 'numeric' })
    return (
      <View style={[s.wrap, s.wrapActive, style]}>
        <View style={s.row}>
          <Ionicons name="star" size={18} color={s.goldIcon.color} style={{ marginTop: 1 }} />
          <View style={{ flex: 1 }}>
            <Text style={s.title}>{t('featuredActiveTitle', lang)}</Text>
            <Text style={s.body}>{t('featuredActiveUntil', lang).replace('{date}', date)}</Text>
          </View>
        </View>
      </View>
    )
  }

  if (pending) {
    return (
      <View style={[s.wrap, s.wrapPending, style]}>
        <View style={s.row}>
          <Ionicons name="time-outline" size={18} color={s.goldIcon.color} style={{ marginTop: 1 }} />
          <View style={{ flex: 1 }}>
            <Text style={s.title}>{t('featuredRequestedTitle', lang)}</Text>
            <Text style={s.body}>{t('featuredRequestedSub', lang)}</Text>
          </View>
        </View>
      </View>
    )
  }

  return (
    <View style={[s.wrap, s.wrapIdle, style]}>
      <View style={s.row}>
        <Ionicons name="star-outline" size={18} color={s.goldIcon.color} style={{ marginTop: 1 }} />
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{t('featuredRequestTitle', lang)}</Text>
          <Text style={s.body}>{t('featuredRequestSub', lang)}</Text>
        </View>
      </View>
      <TouchableOpacity style={s.cta} onPress={request} disabled={busy} activeOpacity={0.85}>
        {busy
          ? <ActivityIndicator size="small" color="#fff" />
          : <Text style={s.ctaText}>{t('featuredRequestCta', lang)}</Text>}
      </TouchableOpacity>
    </View>
  )
}

const s = StyleSheet.create({
  // Gold family, matching FeaturedBadge. backgroundColor set explicitly with the
  // border (Android borderRadius + borderWidth gotcha).
  wrap:        { borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 13,
                 alignSelf: 'stretch' },
  wrapIdle:    { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  wrapPending: { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' },
  wrapActive:  { backgroundColor: '#FEF3C7', borderColor: '#FCD34D' },
  row:         { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  goldIcon:    { color: '#B45309' },
  title:       { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#92400E', marginBottom: 3 },
  body:        { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#92400E', lineHeight: 19 },
  cta:         { marginTop: 12, backgroundColor: '#B45309', borderRadius: 12, paddingVertical: 12,
                 alignItems: 'center' },
  ctaText:     { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
})
