// "Son Check-in'ler" — the Keşfet tab's third view (CHECKINS gate), every place, newest
// first. Opened from the map's Harita / Liste / Check-in'ler control, as Liste opens
// ExploreScreen. A tapped row opens the place over this list (placeOverlay, ExploreScreen's
// idiom), so back returns to the same scroll position and loaded pages.
import { View, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'
import { BROWSE_COLS } from './ExploreScreen'
import { AllCheckins } from '../components/checkins/CheckinFeed'
import { ModuleScreen, ScreenHeader } from '../components/ui'
import { t } from '../constants/i18n'

export default function CheckinFeedScreen({ session, lang, onBack, onRequireAccount, onSelectPlace, placeOverlay = null }) {
  // The feed carries the place's id and name only; the place page needs the browse row.
  async function openPlace(placeId) {
    const { data } = await supabase.from('places').select(BROWSE_COLS).eq('id', placeId).maybeSingle()
    if (data) onSelectPlace?.(data)
  }

  return (
    <View style={s.root}>
      <ModuleScreen topic="explore">
        <SafeAreaView style={s.safe} edges={['top']}>
          <ScreenHeader onBack={onBack} title={t('checkinFeedTitle', lang)} lang={lang} />
          <AllCheckins session={session} lang={lang} onRequireAccount={onRequireAccount}
            onOpenPlace={openPlace} contentStyle={s.list} />
        </SafeAreaView>
      </ModuleScreen>
      {placeOverlay && <View style={s.overlay}>{placeOverlay}</View>}
    </View>
  )
}

const s = StyleSheet.create({
  root:    { flex: 1 },
  safe:    { flex: 1 },
  list:    { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 10, elevation: 10 },
})
