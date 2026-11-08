import { useState } from 'react'
import { View, Text, ScrollView, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { colors, category as CAT, type, radii, elevation } from '../../constants/theme'
import { t } from '../../constants/i18n'
import IconButton from './IconButton'
import RemoteImage from './RemoteImage'
import SplashStatusBar from '../SplashStatusBar'
import ContactBar from './ContactBar'
import PageCanvas from './PageCanvas'

// The detail screen pattern (S4, from the event detail): a photo (or the page ground, PageCanvas,
// with the category icon when there is none), a white sheet rising over it, a category tag, the title, then the screen's own
// rows, and a STICKY action bar at the bottom so Call / Directions / Book are never ~600pt down
// the page (the audit's facility-profile finding). The floating tab bar does not render over
// module screens (App.js shows it only on the three tab roots), so the bar pads by the safe-area
// inset alone. Back is a frosted IconButton over the photo; Android back stays with the caller
// (register it through addBackListener, as every layer does).
//
//   photo:    image source ({ uri } or require) | null → the page ground with the category icon
//   tag:      { label, category, icon? }
//   actions:  ContactBar actions for the sticky bar (omit for none)
//   headerRight: optional element over the photo, top-right (share, favourite)
//   scrollProps: spread onto the ScrollView — e.g. a useScrollMemory() result, so coming back
//                from a deeper screen (all reviews) returns to the same scroll position
// Status icons: light over a photo, dark over any light ground (white measured 1.16–1.64 there).
export const DETAIL_PHOTO_H = 260

// The solid band behind a detail page's floating top bar, shared by every detail layout (this
// scaffold, PropertyDetail's gallery page). `at`: the scroll offset where the sheet reaches the bar;
// `forward`: the caller's own onScroll (scroll memory) still runs.
export function useCoveredTopBar(at, forward) {
  const [covered, setCovered] = useState(false)
  const onScroll = e => {
    forward?.(e)
    const next = e.nativeEvent.contentOffset.y > at
    if (next !== covered) setCovered(next)
  }
  return [covered, onScroll]
}
export function CoveredBand({ covered, top = 0 }) {
  return covered ? <View style={[s.band, { height: top + 60 }]} pointerEvents="none" /> : null
}

export default function DetailScaffold({
  photo, icon = 'location-outline', tag, title, subtitle, onBack, actions, headerRight, lang, children, scrollProps,
}) {
  const insets = useSafeAreaInsets()
  const c = CAT[tag?.category] || CAT.city
  // Once the sheet reaches the top bar, a solid band sits behind it: without one the tag and title
  // scrolled under the frosted back button (visible through it), and light status icons sat on white.
  const [covered, onScroll] = useCoveredTopBar(DETAIL_PHOTO_H - 28 - 56, scrollProps?.onScroll)
  return (
    <PageCanvas>
      <SplashStatusBar style={photo && !covered ? 'light' : 'dark'} />
      <ScrollView {...scrollProps} onScroll={onScroll} scrollEventThrottle={scrollProps?.scrollEventThrottle ?? 32} contentContainerStyle={{ paddingBottom: (actions ? 96 : 24) + insets.bottom }} showsVerticalScrollIndicator={false}>
        <View style={[s.photo, { height: DETAIL_PHOTO_H + insets.top, backgroundColor: photo ? c.bg : 'transparent' }]}>
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
      <CoveredBand covered={covered} top={insets.top} />
      <View style={[s.topBar, { top: insets.top + 8 }]} pointerEvents="box-none">
        <IconButton icon="chevron-back" variant="frosted" onPress={onBack} accessibilityLabel={t('back', lang)} />
        {headerRight}
      </View>
      {!!actions && (
        <View style={[s.sticky, { paddingBottom: 10 + insets.bottom }]}>
          <ContactBar actions={actions} lang={lang} />
        </View>
      )}
    </PageCanvas>
  )
}

const s = StyleSheet.create({
  photo:    { width: '100%', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  sheet:    { marginTop: -28, backgroundColor: colors.card, borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet,
              paddingHorizontal: 20, paddingTop: 20, minHeight: 300 },
  tag:      { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: radii.pill,
              paddingHorizontal: 10, paddingVertical: 4, marginBottom: 8 },
  tagText:  { ...type.meta, fontFamily: 'Inter_700Bold' },
  title:    { ...type.pageTitle, color: colors.textPrimary },
  subtitle: { ...type.body, color: colors.textSecondary, marginTop: 4 },
  band:     { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: colors.card,
              borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  topBar:   { position: 'absolute', left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between' },
  sticky:   { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.card, paddingHorizontal: 16,
              paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider, ...elevation.floating },
})
