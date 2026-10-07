// A Google place ADA does not list (CHECKINS gate): opened from a Google pin on the Keşfet
// map or a Google row in a feed. Its name is fetched live (google-places "details") and never
// stored; "Google Maps" attribution sits under it (Places API policies). Below: who checked in
// here, through the same feed rules as an ADA place (get_checkin_feed, 20261091).
import { useEffect, useState } from 'react'
import { ScrollView, Linking, StyleSheet } from 'react-native'
import { supabase } from '../../lib/supabase'
import { googleNames, googleMapsUrl } from '../../utils/googlePlaces'
import { PlaceCheckins } from './CheckinFeed'
import GoogleMapsAttribution from './GoogleMapsAttribution'
import { BottomSheet, Button } from '../ui'
import { t } from '../../constants/i18n'

export default function GooglePlaceSheet({ place, session, lang, onRequireAccount, onClose }) {
  const id = place?.id ?? null
  const [name, setName] = useState(place?.name ?? null)
  useEffect(() => {
    setName(place?.name ?? null)
    if (!id || place?.name) return
    let gone = false
    googleNames(supabase, [id], lang).then(n => { if (!gone) setName(n[id] ?? null) })
    return () => { gone = true }
  }, [id])

  return (
    <BottomSheet visible={!!id} onClose={onClose} title={name ?? '…'} lang={lang}>
      {!!id && (
        <ScrollView style={s.scroll} contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
          <GoogleMapsAttribution />
          <Button variant="secondary" icon="map-outline" title={t('checkinOpenInGoogleMaps', lang)}
            onPress={() => Linking.openURL(googleMapsUrl(id, name)).catch(() => {})} fullWidth />
          <PlaceCheckins googlePlaceId={id} session={session} lang={lang} onRequireAccount={onRequireAccount} />
        </ScrollView>
      )}
    </BottomSheet>
  )
}

const s = StyleSheet.create({
  scroll: { flexGrow: 0 },
  body:   { gap: 14, paddingBottom: 8 },
})
