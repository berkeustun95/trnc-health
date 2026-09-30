import { Text, TouchableOpacity, Linking, StyleSheet, Platform } from 'react-native'
import { colors } from '../constants/theme'
import { t } from '../constants/i18n'

// "© OpenStreetMap contributors" wherever an OSM-sourced pin is shown (geocoding storage
// policy, CLAUDE.md). OSM data is ODbL; the credit links to the copyright page, as
// WalkingRoutes' PathsCredit does. `overlay` pins it to the bottom-RIGHT
// corner of a map: the provider's own mark sits bottom-left (Google logo on Android, Apple
// Maps logo on iOS) and may not be covered; iOS puts its "Legal" link bottom-right, so the
// credit is raised above it there.
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
  overlay:     { position: 'absolute', right: 6, bottom: Platform.OS === 'ios' ? 26 : 6, paddingHorizontal: 6, paddingVertical: 2,
                 borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.85)' },
  text:        { fontSize: 10, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  overlayText: { color: colors.textPrimary },
})
