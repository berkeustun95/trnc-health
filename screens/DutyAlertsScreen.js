import { useEffect, useState } from 'react'
import { View, Text, StyleSheet, ScrollView, Linking } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import * as Location from 'expo-location'
import { colors, type } from '../constants/theme'
import { t } from '../constants/i18n'
import { Button, PageCanvas } from '../components/ui'
import CityPicker from '../components/CityPicker'
import { askedFix } from '../utils/locationServices'
import { resolveRegion } from '../utils/resolveRegion'
import { logOnboardingEvent } from '../utils/onboardingEvents'
import { OFFER_EVENTS, OFFER_GRANTED, OFFER_DENIED, OFFER_LATER } from '../utils/onboardingState'

// Onboarding v2, Screen 2: the duty-pharmacy alert offer, right after "Hemen başla" (or the signup
// wizard). It IS the explanation, so both permissions go straight to the OS, and only on a tap.
// App owns the writes: onEnableNotifications asks + registers and resolves to true when granted;
// onResolve({ outcome, city }) saves and goes Home; onLocation hands a fix back so Home needs no relaunch.
export default function DutyAlertsScreen({ lang, onEnableNotifications, onResolve, onLocation }) {
  const [city, setCity] = useState(null)
  const [outside, setOutside] = useState(false)
  const [locating, setLocating] = useState(false)
  const [busy, setBusy] = useState(null)   // 'enable' | 'later' while resolving

  useEffect(() => { logOnboardingEvent(OFFER_EVENTS.shown) }, [])

  async function useLocation() {
    if (locating || busy) return
    setLocating(true)
    try {
      const perm = await Location.requestForegroundPermissionsAsync()
      if (perm.status !== 'granted') {
        onLocation?.({ canAskAgain: perm.canAskAgain !== false })
        if (perm.canAskAgain === false) Linking.openSettings().catch(() => {})
        return
      }
      const loc = await askedFix(Location.Accuracy.Balanced)   // a tap: may ask to turn device location on
      if (!loc) return
      onLocation?.({ canAskAgain: true, coords: loc.coords })
      const region = resolveRegion(loc.coords.latitude, loc.coords.longitude)
      setOutside(!region)
      if (region) setCity(region)
    } catch {
      // No fix (services off, timeout): the picker is still there.
    } finally {
      setLocating(false)
    }
  }

  async function finish(kind) {
    if (busy) return
    setBusy(kind)
    let outcome = OFFER_LATER
    if (kind === 'enable') {
      let granted = false
      try { granted = (await onEnableNotifications()) === true } catch {}
      outcome = granted ? OFFER_GRANTED : OFFER_DENIED
    }
    logOnboardingEvent(OFFER_EVENTS[outcome])
    await onResolve({ outcome, city })
  }

  return (
    <PageCanvas>
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        <ScrollView style={s.scrollView} contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          <View style={s.bell}>
            <Ionicons name="notifications-outline" size={30} color={colors.primaryDark} />
          </View>
          <Text style={s.title} accessibilityRole="header">{t('dutyAlertsTitle', lang)}</Text>
          <Text style={s.body}>{t('dutyAlertsBody', lang)}</Text>

          <Text style={s.label}>{t('cwAskPickCity', lang)}</Text>
          <CityPicker value={city} lang={lang} onSelect={r => { setCity(r); setOutside(false) }} />
          <Button variant="text" icon="locate-outline" title={t('permUseLocation', lang)}
            onPress={useLocation} loading={locating} disabled={!!busy} style={s.locate} />
          {outside && <Text style={s.hint}>{t('dutyAlertsOutsideTrnc', lang)}</Text>}
        </ScrollView>

        <View style={s.footer}>
          <Button size="lg" title={t('permNotifTurnOn', lang)} onPress={() => finish('enable')}
            loading={busy === 'enable'} disabled={!!busy && busy !== 'enable'} fullWidth />
          <Button variant="text" title={t('permPrimerNotNow', lang)} onPress={() => finish('later')}
            loading={busy === 'later'} disabled={!!busy && busy !== 'later'} fullWidth />
        </View>
      </SafeAreaView>
    </PageCanvas>
  )
}

const s = StyleSheet.create({
  root:       { flex: 1, backgroundColor: 'transparent' },
  scrollView: { flex: 1 },
  scroll:     { paddingHorizontal: 24, paddingTop: 32, paddingBottom: 16, width: '100%', maxWidth: 560, alignSelf: 'center' },
  bell:       { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primaryLight,
                alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  title:      { ...type.pageTitle, color: colors.textPrimary },
  body:       { ...type.body, color: colors.textSecondaryOnPage, marginTop: 10 },
  label:      { ...type.rowTitle, color: colors.textPrimary, marginTop: 28, marginBottom: 12 },
  locate:     { alignSelf: 'flex-start', marginTop: 8, marginLeft: -8 },
  hint:       { ...type.small, color: colors.textSecondaryOnPage, marginTop: 2 },
  // Fixed under the scrolling copy in a flex:1 column.
  footer:     { flexShrink: 0, paddingHorizontal: 24, paddingTop: 8, paddingBottom: 8, gap: 4,
                width: '100%', maxWidth: 560, alignSelf: 'center' },
})
