import { useState, useEffect, useCallback } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Linking } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { colors, readableOn, brandInk } from '../constants/theme'
import { t } from '../constants/i18n'
import BackButton from '../components/BackButton'
import StoreMap from '../components/StoreMap'
import { packageHandoffUrl, handoffHost, fetchStores, storeDirectionsUrl, mappableStores } from '../lib/connectivity'

// Bağlantı & eSIM — package detail and application handoff (screen 3 of 3).
//
// ADA DOES NOT SELL ANYTHING HERE. It explains the three steps, then hands the user to the
// operator's own page. The store card is slice 5.

const STEPS = [
  { titleKey: 'connStep1Title', bodyKey: 'connStep1Body' },
  { titleKey: 'connStep2Title', bodyKey: 'connStep2Body' },
  { titleKey: 'connStep3Title', bodyKey: 'connStep3Body' },
]

// ─── THE HANDOFF, AND WHY IT IS require()D INSIDE THE HANDLER ───────────────
//
// ⚠ THIS `require` MUST STAY INSIDE THE FUNCTION. It is not a style choice and it is not a
//   lazy-loading optimisation — it is the single thing standing between an ordinary OTA and
//   a launch crash on every phone that has not taken the native build.
//
//   expo-web-browser was added on 2026-09-13 and is a NATIVE module. Its entry point,
//   expo-web-browser/build/ExpoWebBrowser.js, is two lines:
//       import { requireNativeModule } from 'expo-modules-core'
//       export default requireNativeModule('ExpoWebBrowser')
//   — a top-level call. A static `import` at the head of this file would therefore run
//   requireNativeModule the moment the BUNDLE IS EVALUATED, which happens at launch, on
//   every device, whether or not anybody opens this screen. On a production binary built
//   before that date the module does not exist and it throws.
//
//   runtimeVersion.policy is 'appVersion' (app.config.js), which does NOT fence those older
//   binaries unless the version is bumped, so an `eas update` carrying a static import would
//   reach them. Inside the handler the worst case is instead a single failed tap on a screen
//   that CONNECTIVITY_LIVE already makes unreachable — and even that degrades, below, to the
//   system browser rather than to nothing.
//
// ─── AND WHY NOT A WEBVIEW ──────────────────────────────────────────────────
//
// openBrowserAsync gives SFSafariViewController on iOS and Custom Tabs on Android. Both show
// the REAL ADDRESS BAR. The user types passport details on the other side of this tap, so
// they must be able to see whose site they are on and that it is HTTPS. A WKWebView would
// render the same page chromeless and indistinguishable from a page ADA had written itself,
// which is exactly the shape of a credential-harvesting screen. Do not "improve" this by
// keeping the user in-app.
async function openHandoff(url, brand) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const WebBrowser = require('expo-web-browser')
    await WebBrowser.openBrowserAsync(url, {
      toolbarColor: brand.secondary,          // Android Custom Tabs
      controlsColor: brand.onSecondary,       // iOS SFSafariViewController tint
      dismissButtonStyle: 'close',
      enableBarCollapsing: true,
    })
    return true
  } catch {
    // The native module is absent (an OTA on an older binary) or the browser could not be
    // presented. Linking.openURL leaves the app for the system browser: a worse experience —
    // the user loses the in-app return — but they still reach the page they asked for, and
    // they still see a real address bar.
    try {
      await Linking.openURL(url)
      return true
    } catch {
      return false
    }
  }
}

// One branch. The "Yol tarifi" action is hidden rather than dead when the row carries
// neither maps_url nor coordinates — an address-only branch is a legitimate row, and a CTA
// that opens nothing is worse than no CTA.
function StoreRow({ store, lang, accent, first }) {
  const url = storeDirectionsUrl(store)
  const detail = [store.city, store.opening_hours].filter(Boolean).join(' · ')

  return (
    <View style={[s.storeRow, !first && s.storeRowDivided]}>
      <View style={s.storeInfo}>
        <Text style={s.storeName}>{store.name}</Text>
        {store.is_airport && (
          <Text style={[s.storeTag, { color: accent }]}>{t('connPickupAirport', lang)}</Text>
        )}
        {!!detail && <Text style={s.storeDetail}>{detail}</Text>}
      </View>
      {!!url && (
        <TouchableOpacity
          onPress={() => Linking.openURL(url).catch(() => {})}
          activeOpacity={0.7}
          accessibilityRole="link"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={s.storeLink}>{t('connDirections', lang)}</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

export default function ConnectivityPackageScreen({ pkg, operator, lang, onBack }) {
  const [stores, setStores] = useState([])
  const [opening, setOpening] = useState(false)
  const [failed, setFailed]   = useState(false)

  const primary     = operator?.brand_primary   || colors.primary
  const secondary   = operator?.brand_secondary || colors.textPrimary
  const onPrimary   = readableOn(primary)
  const onSecondary = readableOn(secondary)
  const ink         = brandInk(secondary)

  const url  = packageHandoffUrl(pkg, operator)
  const host = handoffHost(url)
  const phone = operator?.support_phone
  const operatorName = operator?.name ?? ''

  const onContinue = useCallback(async () => {
    if (!url || opening) return
    setOpening(true)
    setFailed(false)
    const ok = await openHandoff(url, { secondary, onSecondary })
    setOpening(false)
    if (!ok) setFailed(true)
  }, [url, opening, secondary, onSecondary])

  // tel: is refused by the OS on a tablet with no dialler, and support_phone is a nullable
  // column — either way the button is hidden rather than shown dead.
  // Stores are fetched here rather than passed down: this is the only screen that shows
  // them, and the whole card disappears when there are none. A failure is treated exactly
  // like an empty result — unlike operators and packages, a store list CAN legitimately be
  // empty (KKTCELL has not sent the branch list yet), so there is no fault to report and no
  // error state to show. Hiding the card is the correct rendering of both.
  useEffect(() => {
    let active = true
    ;(async () => {
      const { data } = await fetchStores(operator?.id)
      if (active) setStores(data ?? [])
    })()
    return () => { active = false }
  }, [operator?.id])

  const onCall = useCallback(() => {
    if (!phone) return
    Linking.openURL(`tel:${phone.replace(/\s+/g, '')}`).catch(() => {})
  }, [phone])

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <BackButton lang={lang} onPress={onBack} />
        {/* The package's own name, exactly as KKTCELL wrote it — never translated. */}
        <Text style={s.headerTitle} numberOfLines={1}>{pkg?.name ?? ''}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={s.sectionLabel}>{t('connStepsTitle', lang)}</Text>

        <View style={s.steps}>
          {STEPS.map((step, i) => (
            <View key={step.titleKey} style={[s.step, i > 0 && s.stepDivided]}>
              <View style={[s.num, { backgroundColor: primary }]}>
                <Text style={[s.numText, { color: onPrimary }]}>{i + 1}</Text>
              </View>
              <View style={s.stepBody}>
                <Text style={s.stepTitle}>{t(step.titleKey, lang)}</Text>
                <Text style={s.stepText}>
                  {t(step.bodyKey, lang).replace('{operator}', operatorName)}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {/* Hidden rather than dead when the operator row carries neither a package handoff
            nor a generic eSIM URL. conn:health fails on that case, so it should never reach
            a user — but a CTA that does nothing is the worst possible way to find out. */}
        {!!url && (
          <TouchableOpacity
            style={[s.ctaPrimary, { backgroundColor: secondary }, opening && s.ctaBusy]}
            onPress={onContinue}
            disabled={opening}
            activeOpacity={0.85}
            accessibilityRole="link"
            accessibilityHint={host ?? undefined}
          >
            {opening ? (
              <ActivityIndicator color={onSecondary} />
            ) : (
              <>
                <Text style={[s.ctaPrimaryText, { color: onSecondary }]}>
                  {t('connCtaPrimary', lang).replace('{operator}', operatorName)}
                </Text>
                {!!host && (
                  // The real destination host, derived from the URL that will actually open.
                  <Text style={[s.ctaPrimarySub, { color: onSecondary, opacity: 0.72 }]}>
                    {t('connCtaPrimarySub', lang).replace('{host}', host)}
                  </Text>
                )}
              </>
            )}
          </TouchableOpacity>
        )}

        {failed && <Text style={s.failText}>{t('connOpenFailed', lang)}</Text>}

        {!!phone && (
          <TouchableOpacity
            style={[s.ctaSecondary, { borderColor: secondary }]}
            onPress={onCall}
            activeOpacity={0.8}
            accessibilityRole="button"
          >
            <Ionicons name="call-outline" size={16} color={ink} />
            <Text style={[s.ctaSecondaryText, { color: ink }]}>{t('connCtaCall', lang)}</Text>
          </TouchableOpacity>
        )}

        {/* ⚠ THE WHOLE CARD IS ABSENT WHEN THE OPERATOR HAS NO ACTIVE STORES — not an empty
            list, not a "no stores yet" message. connectivity_stores is empty today and will
            be until KKTCELL sends their branch list, and an empty card would advertise a
            missing feature on every user's screen for no benefit. This is the one place in
            the module where zero rows is NOT a fault: conn:health prints it as a note rather
            than a failure, precisely so the distinction survives. */}
        {stores.length > 0 && (
          <View style={s.storeCard}>
            <Text style={s.storeCardTitle}>{t('connStoresTitle', lang)}</Text>

            {/* Null when no store has coordinates. An address-only branch still lists below;
                it just cannot be a pin, and an empty MapView would show open ocean. */}
            <StoreMap stores={stores} pinColor={primary} />

            <View style={mappableStores(stores).length ? s.storeListDivided : null}>
              {stores.map((store, i) => (
                <StoreRow key={store.id} store={store} lang={lang} accent={ink} first={i === 0} />
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: colors.bg },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.cardBg, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle:   { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, flex: 1, textAlign: 'center' },
  scroll:        { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 48 },

  sectionLabel:  { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textSecondary, marginBottom: 9, marginLeft: 4 },

  steps:         { backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 4 },
  step:          { flexDirection: 'row', gap: 12, paddingVertical: 10 },
  stepDivided:   { borderTopWidth: 1, borderTopColor: '#EEF2F4' },
  num:           { width: 25, height: 25, borderRadius: 12.5, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  numText:       { fontSize: 12, fontFamily: 'Inter_700Bold' },
  // flex:1 so long Turkish step copy wraps inside the row instead of pushing it wide.
  stepBody:      { flex: 1 },
  stepTitle:     { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  stepText:      { fontSize: 11.5, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 18, marginTop: 3 },

  ctaPrimary:    { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center', marginTop: 14 },
  ctaBusy:       { opacity: 0.75 },
  ctaPrimaryText:{ fontSize: 13.5, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  ctaPrimarySub: { fontSize: 10.5, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 3 },

  ctaSecondary:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.cardBg, borderWidth: 1.5, borderRadius: 12, paddingVertical: 12, marginTop: 9 },
  ctaSecondaryText: { fontSize: 13, fontFamily: 'Inter_700Bold' },

  failText:      { fontSize: 12.5, fontFamily: 'Inter_400Regular', color: colors.danger, textAlign: 'center', marginTop: 10 },

  // overflow:hidden so the map's square corners are clipped to the card radius.
  storeCard:     { marginTop: 12, backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.border, borderRadius: 14, overflow: 'hidden' },
  storeCardTitle:{ fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textSecondary, paddingHorizontal: 13, paddingTop: 12, paddingBottom: 10 },
  // Only drawn when a map sits above the list, so the first row is separated from it.
  storeListDivided: { borderTopWidth: 1, borderTopColor: colors.border },
  storeRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 13, paddingVertical: 11 },
  storeRowDivided: { borderTopWidth: 1, borderTopColor: colors.border },
  // flex:1 so a long branch name wraps instead of pushing the directions link off the row.
  storeInfo:     { flex: 1 },
  storeName:     { fontSize: 12.5, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  storeTag:      { fontSize: 9.5, fontFamily: 'Inter_700Bold', letterSpacing: 0.4, marginTop: 3 },
  storeDetail:   { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 2 },
  // ADA's teal, not the brand: this is our action on our surface, the same as every other
  // directions link in the app.
  storeLink:     { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.primary },
})
