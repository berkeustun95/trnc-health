import { View, Text, ScrollView, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { colors, category as CAT, type, radii, elevation } from '../../constants/theme'
import { t } from '../../constants/i18n'
import IconButton from './IconButton'
import RemoteImage from './RemoteImage'
import { StatusBar } from 'expo-status-bar'
import ContactBar from './ContactBar'

// The detail screen pattern (S4, from the event detail): a photo (or the category ground when
// there is none), a white sheet rising over it, a category tag, the title, then the screen's own
// rows, and a STICKY action bar at the bottom so Call / Directions / Book are never ~600pt down
// the page (the audit's facility-profile finding). The floating tab bar does not render over
// module screens (App.js shows it only on the three tab roots), so the bar pads by the safe-area
// inset alone. Back is a frosted IconButton over the photo; Android back stays with the caller
// (register it through addBackListener, as every layer does).
//
//   photo:    image source ({ uri } or require) | null → category ground with the icon
//   tag:      { label, category, icon? }
//   actions:  ContactBar actions for the sticky bar (omit for none)
//   headerRight: optional element over the photo, top-right (share, favourite)
//   scrollProps: spread onto the ScrollView — e.g. a useScrollMemory() result, so coming back
//                from a deeper screen (all reviews) returns to the same scroll position
export const DETAIL_PHOTO_H = 260
export default function DetailScaffold({
  photo, icon = 'location-outline', tag, title, subtitle, onBack, actions, headerRight, lang, children, scrollProps,
}) {
  const insets = useSafeAreaInsets()
  const c = CAT[tag?.category] || CAT.city
  return (
    <View style={s.root}>
      <StatusBar style="light" />
      <ScrollView {...scrollProps} contentContainerStyle={{ paddingBottom: (actions ? 96 : 24) + insets.bottom }} showsVerticalScrollIndicator={false}>
        <View style={[s.photo, { height: DETAIL_PHOTO_H + insets.top, backgroundColor: c.bg }]}>
          {photo
            ? <RemoteImage source={photo} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />
            : <Ionicons name={icon} size={64} color={c.ink} style={{ marginTop: insets.top }} />}
        </View>
        <View style={s.sheet}>
          {!!tag && (
            <View style={[s.tag, { backgroundColor: c.bg }]}>
              {!!tag.icon && <Ionicons name={tag.icon} size={13} color={c.ink} />}
              <Text style={[s.tagText, { color: c.ink }]} numberOfLines={1}>{tag.label}</Text>
            </View>
          )}
          <Text style={s.title} accessibilityRole="header">{title}</Text>
          {!!subtitle && <Text style={s.subtitle}>{subtitle}</Text>}
          {children}
        </View>
      </ScrollView>
      <View style={[s.topBar, { top: insets.top + 8 }]} pointerEvents="box-none">
        <IconButton icon="chevron-back" variant="frosted" onPress={onBack} accessibilityLabel={t('back', lang)} />
        {headerRight}
      </View>
      {!!actions && (
        <View style={[s.sticky, { paddingBottom: 10 + insets.bottom }]}>
          <ContactBar actions={actions} lang={lang} />
        </View>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  root:     { flex: 1, backgroundColor: colors.canvas },
  photo:    { width: '100%', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  sheet:    { marginTop: -28, backgroundColor: colors.card, borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet,
              paddingHorizontal: 20, paddingTop: 20, minHeight: 300 },
  tag:      { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: radii.pill,
              paddingHorizontal: 10, paddingVertical: 4, marginBottom: 8 },
  tagText:  { ...type.meta, fontFamily: 'Inter_700Bold' },
  title:    { ...type.pageTitle, color: colors.textPrimary },
  subtitle: { ...type.body, color: colors.textSecondary, marginTop: 4 },
  topBar:   { position: 'absolute', left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between' },
  sticky:   { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.card, paddingHorizontal: 16,
              paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider, ...elevation.floating },
})
