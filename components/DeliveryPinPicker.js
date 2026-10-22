import { useRef, useState } from 'react'
import { View, Text, TextInput, Pressable, Keyboard, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import MapView from 'react-native-maps'
import { t } from '../constants/i18n'
import { searchAreasTop } from '../constants/deliveryAreas'
import { MAP_PROVIDER } from '../utils/googleMap'
import { useLocate } from '../utils/deliveryLocate'
import { colors, type, radii, space, elevation, press, motion, TAP } from '../constants/theme'
import useKeyboardTop from '../utils/useKeyboardTop'
import { accuracyNote } from '../constants/eatery'
import { Button } from './ui'

// Step 2's map: the pin stays in the middle and the MAP moves under it (no draggable marker, which is fiddly with a thumb); the
// coordinate is whatever is under the pin when the map stops. The search box only knows the bundled area list: on this phone, no
// network, no geocoder. Base-map POIs stay on here (unlike the check-in maps): there is no Places content on this map.
// The map has its own flex:1 frame and the buttons sit BELOW it, so the provider's attribution (Google logo / Apple Legal) is never
// covered and the pin centres on the visible map. While the keyboard is open the button bar is hidden (the map is not squeezed on Android).
// Defined outside the editor so it never remounts. start: { lat, lng, delta, gps?, accuracy? }. onUse({ lat, lng }) = "Bu konumu kullan".
// start.gps = the map opened on a GPS fix the person must CONFIRM ("Pin tam kapında mı?" / "Evet, bu konum"); a fix worse than
// LOCATE_POOR_M says so in words until they move the map. The accuracy lives in this state only: onUse hands back lat / lng and nothing else.
const PIN_H = 44
const AREA_DELTA = 0.01

export default function DeliveryPinPicker({ lang, start, reduce, onUse }) {
  const insets = useSafeAreaInsets()
  const kbTop = useKeyboardTop()
  const mapRef = useRef(null)
  const centre = useRef({ lat: start.lat, lng: start.lng })
  const [query, setQuery] = useState('')
  const [acc, setAcc] = useState(start.accuracy ?? null)   // metres, of the fix the pin is still sitting on; cleared by the first pan
  const gpsMode = start.gps === true
  const { locating, refining, note, locate, openFix } = useLocate(lang)
  const results = searchAreasTop(query)
  const accM = accuracyNote(acc)

  const goTo = (lat, lng, delta) => {
    centre.current = { lat, lng }
    mapRef.current?.animateToRegion({ latitude: lat, longitude: lng, latitudeDelta: delta, longitudeDelta: delta }, reduce ? 0 : motion.base)
  }
  const pickArea = a => { setQuery(''); Keyboard.dismiss(); goTo(a.lat, a.lng, AREA_DELTA) }
  const goMe = async () => {
    Keyboard.dismiss()
    const p = await locate()
    if (p) { setAcc(p.accuracy); goTo(p.lat, p.lng, AREA_DELTA / 2) }
  }
  return (
    <View style={s.root}>
      <View style={s.mapWrap}>
      <View style={StyleSheet.absoluteFill} accessible accessibilityLabel={t(gpsMode ? 'eateryPinMapA11yGps' : 'eateryPinMapA11y', lang)}>
        <MapView ref={mapRef} style={StyleSheet.absoluteFill} provider={MAP_PROVIDER}
          initialRegion={{ latitude: start.lat, longitude: start.lng, latitudeDelta: start.delta, longitudeDelta: start.delta }}
          onPanDrag={() => setAcc(null)}
          onRegionChangeComplete={r => { centre.current = { lat: r.latitude, lng: r.longitude } }}
          toolbarEnabled={false} rotateEnabled={false} pitchEnabled={false} showsUserLocation={false} />
      </View>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, s.pinWrap]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Ionicons name="location" size={PIN_H} color={colors.primary} style={s.pin} />
        <View style={s.dot} />
      </View>
      <View style={s.top}>
        <View style={[s.search, elevation.card]}>
          <Ionicons name="search" size={18} color={colors.textSecondary} />
          <TextInput style={s.input} value={query} onChangeText={setQuery} maxLength={40} placeholder={t('eateryPinSearch', lang)}
            placeholderTextColor={colors.textSecondary} accessibilityLabel={t('eateryPinSearch', lang)} autoCorrect={false} autoComplete="off"
            importantForAutofill="no" textContentType="none" returnKeyType="search" onSubmitEditing={() => { if (results[0]) pickArea(results[0]) }} />
          {!!query && (
            <Pressable onPress={() => setQuery('')} hitSlop={space[8]} style={s.clear} accessibilityRole="button" accessibilityLabel={t('eateryPinClearSearch', lang)}>
              <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
            </Pressable>
          )}
        </View>
        {query.trim() ? (
          <View style={[s.list, elevation.card]}>
            {results.length === 0
              ? <Text style={s.none} accessibilityLiveRegion="polite">{t('eateryPinNoMatch', lang)}</Text>
              : results.map(a => (
                <Pressable key={`${a.region}-${a.name}`} onPress={() => pickArea(a)} style={({ pressed }) => [s.row, pressed && { opacity: press.small }]}
                  accessibilityRole="button" accessibilityLabel={a.name}>
                  <Ionicons name="location-outline" size={18} color={colors.textSecondary} />
                  <Text style={s.rowText} numberOfLines={1}>{a.name}</Text>
                </Pressable>
              ))}
          </View>
        ) : (
          <View style={[s.help, elevation.card]}>
            <Text style={s.helpText}>{t(gpsMode ? 'eateryPinHelpGps' : 'eateryPinHelp', lang)}</Text>
            {accM != null && <Text style={s.accText} accessibilityLiveRegion="polite">{t('eateryPinAccuracy', lang).replace('{m}', () => String(accM))}</Text>}
          </View>
        )}
      </View>
      </View>
      {kbTop == null && <View style={[s.bottom, { paddingBottom: insets.bottom + space[12] }]}>
        {!!note && (
          <View style={s.fail} accessibilityLiveRegion="polite">
            <Text style={s.failText}>{t(note.msgKey, lang)}</Text>
            {note.action && <Button variant="text" title={t('openSettings', lang)} onPress={() => openFix(note.action)} />}
          </View>
        )}
        <Button variant="secondary" fullWidth icon="locate-outline" title={t('eateryPinGoMe', lang)} loading={locating}
          loadingTitle={t(refining ? 'eateryDeliveryRefining' : 'eateryDeliveryLocating', lang)} onPress={goMe} />
        <Button fullWidth icon="checkmark" title={t(gpsMode ? 'eateryPinUseGps' : 'eateryPinUse', lang)} onPress={() => onUse(centre.current)} />
      </View>}
    </View>
  )
}

const s = StyleSheet.create({
  root:     { flex: 1, backgroundColor: colors.canvas },
  mapWrap:  { flex: 1, overflow: 'hidden' },
  // The pin's tip (not its middle) sits on the centre of the map: lift the icon by its own height.
  pinWrap:  { alignItems: 'center', justifyContent: 'center' },
  pin:      { marginBottom: PIN_H },
  dot:      { position: 'absolute', width: 8, height: 8, borderRadius: radii.pill, backgroundColor: colors.primaryDark, opacity: 0.5 },
  top:      { position: 'absolute', top: space[8], left: space[16], right: space[16], gap: space[8] },
  search:   { minHeight: TAP, flexDirection: 'row', alignItems: 'center', gap: space[8], paddingLeft: space[12], borderRadius: radii.md, backgroundColor: colors.card },
  input:    { flex: 1, minHeight: TAP, ...type.body, color: colors.textPrimary, paddingVertical: space[8] },
  clear:    { width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center' },
  help:     { borderRadius: radii.md, backgroundColor: colors.card, paddingHorizontal: space[12], paddingVertical: space[8] },
  helpText: { ...type.small, color: colors.textPrimary },
  accText:  { ...type.small, color: colors.textSecondary, marginTop: space[4] },
  list:     { borderRadius: radii.md, backgroundColor: colors.card, overflow: 'hidden' },
  row:      { minHeight: TAP, flexDirection: 'row', alignItems: 'center', gap: space[8], paddingHorizontal: space[12] },
  rowText:  { flex: 1, ...type.body, color: colors.textPrimary },
  none:     { ...type.small, color: colors.textSecondary, padding: space[12] },
  bottom:   { flexShrink: 0, backgroundColor: colors.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingHorizontal: space[16], paddingTop: space[12], gap: space[8] },
  fail:     { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space[8] },
  failText: { flex: 1, minWidth: 140, ...type.small, color: colors.textPrimary },
})
