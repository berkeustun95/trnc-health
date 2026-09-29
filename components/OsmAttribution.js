import { Text, TouchableOpacity, Linking, StyleSheet } from 'react-native'
import { colors } from '../constants/theme'
import { t } from '../constants/i18n'

// "© OpenStreetMap contributors" wherever an OSM-sourced pin is shown (geocoding storage
// policy, CLAUDE.md). OSM data is ODbL; the credit links to the copyright page, as
// WalkingRoutes' PathsCredit does. `overlay` pins it to the bottom-left corner of a map.
const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright'

export default function OsmAttribution({ lang, overlay = false, style }) {
  return (
    <TouchableOpacity onPress={() => Linking.openURL(OSM_COPYRIGHT_URL).catch(() => {})}
      activeOpacity={0.7} accessibilityRole="link" style={[overlay && s.overlay, style]}>
      <Text style={[s.text, overlay && s.overlayText]} numberOfLines={1}>{t('osmAttribution', lang)}</Text>
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  overlay:     { position: 'absolute', left: 6, bottom: 6, paddingHorizontal: 6, paddingVertical: 2,
                 borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.85)' },
  text:        { fontSize: 10, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  overlayText: { color: colors.textPrimary },
})
