// "Son Check-in'ler" — the Keşfet tab's third view (CHECKINS gate), every place, newest
// first. Opened from the map's Harita / Liste / Check-in'ler control, as Liste opens
// ExploreScreen. A tapped row opens the place over this list (placeOverlay, ExploreScreen's
// idiom), so back returns to the same scroll position and loaded pages. A Google place's row
// opens GooglePlaceSheet instead (ADA has no page for it).
//
// "Buradayım" at the top checks in wherever the phone is (NearbyCheckin, 20261093); its
// "Not here? Add this place" opens the existing place form (pending → admin moderation) over
// this screen. backRef: Android back / iOS edge swipe closes that form before the feed.
import { useState, useEffect } from 'react'
import { View, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'
import { BROWSE_COLS } from './ExploreScreen'
import ExploreSubmitScreen from './ExploreSubmitScreen'
import { AllCheckins } from '../components/checkins/CheckinFeed'
import NearbyCheckin from '../components/checkins/NearbyCheckin'
import GooglePlaceSheet from '../components/checkins/GooglePlaceSheet'
import { ModuleScreen, ScreenHeader } from '../components/ui'
import { t } from '../constants/i18n'

export default function CheckinFeedScreen({ session, lang, onBack, onRequireAccount, onSelectPlace, placeOverlay = null, backRef }) {
  const [refreshKey, setRefreshKey] = useState(0)
  const [googlePlace, setGooglePlace] = useState(null)   // { id, name } → GooglePlaceSheet
  const [addFix, setAddFix] = useState(null)             // a fix → the add-place form is open

  useEffect(() => {
    if (!backRef) return
    backRef.current = () => { if (addFix) { setAddFix(null); return true } return false }
    return () => { backRef.current = null }
  }, [backRef, addFix])

  // The feed carries the place's id and name only; the place page needs the browse row.
  async function openPlace(placeId) {
    const { data } = await supabase.from('places').select(BROWSE_COLS).eq('id', placeId).maybeSingle()
    if (data) onSelectPlace?.(data)
  }

  if (addFix) {
    return (
      <ExploreSubmitScreen session={session} lang={lang} initialFix={addFix}
        onBack={() => setAddFix(null)} onSubmitted={() => {}} />
    )
  }

  return (
    <View style={s.root}>
      <ModuleScreen topic="explore">
        <SafeAreaView style={s.safe} edges={['top']}>
          <ScreenHeader onBack={onBack} title={t('checkinFeedTitle', lang)} lang={lang} />
          <NearbyCheckin session={session} lang={lang} onRequireAccount={onRequireAccount} style={s.cta}
            onCheckedIn={() => setRefreshKey(k => k + 1)} onAddPlace={fix => fix && setAddFix(fix)} />
          <AllCheckins session={session} lang={lang} onRequireAccount={onRequireAccount} refreshKey={refreshKey}
            onOpenPlace={openPlace} onOpenGooglePlace={(id, name) => setGooglePlace({ id, name })} contentStyle={s.list} />
        </SafeAreaView>
      </ModuleScreen>
      <GooglePlaceSheet place={googlePlace} session={session} lang={lang} onRequireAccount={onRequireAccount}
        onClose={() => setGooglePlace(null)} />
      {placeOverlay && <View style={s.overlay}>{placeOverlay}</View>}
    </View>
  )
}

const s = StyleSheet.create({
  root:    { flex: 1 },
  safe:    { flex: 1 },
  cta:     { paddingHorizontal: 16, paddingTop: 8, flexShrink: 0 },
  list:    { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40 },
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 10, elevation: 10 },
})
