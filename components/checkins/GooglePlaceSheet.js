// A Google place ADA does not list (CHECKINS gate): opened from a Google pin on the Keşfet
// map or a Google row in a feed. Below: who checked in here, through the same feed rules as an
// ADA place (get_checkin_feed, 20261093).
//
// ⚠ NAME ONLY AWAY FROM A MAP. The billing account is in Cyprus, so the Maps Platform EEA terms
// apply (Berke, 2026-10-07): EEA Service Specific Terms §15.1 forbid showing Places content
// other than lat/lng/place_id "on, next to, or in a manner that is visually associated with any
// map, including a Google Map". Over the Keşfet map (showName={false}) the sheet shows no name,
// does not even fetch it, and offers "Open in Google Maps" — linking to the map that is the
// content's source is the definition's own exception. From a feed (no map) the name is fetched
// live and never stored, with "Google Maps" attribution under it (Places API policies).
import { useEffect, useState } from 'react'
import { ScrollView, Linking, StyleSheet } from 'react-native'
import { supabase } from '../../lib/supabase'
import { googleNames, googleMapsUrl } from '../../utils/googlePlaces'
import { PlaceCheckins } from './CheckinFeed'
import GoogleMapsAttribution from './GoogleMapsAttribution'
import { BottomSheet, Button } from '../ui'
import { t } from '../../constants/i18n'

export default function GooglePlaceSheet({ place, session, lang, onRequireAccount, onClose, showName = true }) {
  const id = place?.id ?? null
  const [name, setName] = useState(showName ? place?.name ?? null : null)
  useEffect(() => {
    setName(showName ? place?.name ?? null : null)
    if (!showName || !id || place?.name) return
    let gone = false
    googleNames(supabase, [id], lang).then(n => { if (!gone) setName(n[id] ?? null) })
    return () => { gone = true }
  }, [id])

  return (
    <BottomSheet visible={!!id} onClose={onClose} title={showName ? (name ?? '…') : t('checkinPlaceTitle', lang)} lang={lang}>
      {!!id && (
        <ScrollView style={s.scroll} contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
          {showName && <GoogleMapsAttribution />}
          <Button variant="secondary" icon="map-outline" title={t('checkinOpenInGoogleMaps', lang)}
            onPress={() => Linking.openURL(googleMapsUrl(id, name)).catch(() => {})} fullWidth />
          <PlaceCheckins googlePlaceId={id} session={session} lang={lang} onRequireAccount={onRequireAccount} showTitle={showName} />
        </ScrollView>
      )}
    </BottomSheet>
  )
}

const s = StyleSheet.create({
  scroll: { flexGrow: 0 },
  body:   { gap: 14, paddingBottom: 8 },
})
