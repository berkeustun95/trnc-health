import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { colors, type, radii, elevation, press } from '../../constants/theme'
import { t } from '../../constants/i18n'

// White floating pill, inset 24 from each side, 64 tall. The active tab shows icon + label
// on a primaryLight pill (label in primaryDark, 6.71:1); inactive tabs are icon-only and
// carry their label as accessibilityLabel instead. Real tab semantics: role "tab" and
// selected state — the old bar exposed "button" and no state.
//
// tabs: [{ key, iconOn, iconOff, labelKey }] · refs: { [key]: ref } (App.js measures the
// Keşfet tab for the coach marks, so that ref must land on the real button).
export const TAB_BAR_H = 64
export const TAB_BAR_SIDE = 24
const GAP_BELOW = 12
// Content fades out instead of cutting sharply at the bar: a solid canvas band from the
// screen's bottom edge (under the Android nav bar, which is edge-to-edge and draws its own
// contrast scrim over whatever is behind it — canvas, now, not content) up to the bar's
// middle, then FADE_H of canvas → transparent. Stepped views: expo-linear-gradient would be a
// native module. Scroll content pads by the footprint + FADE_H so its last row clears it.
export const FADE_H = 32
const FADE_STEPS = 8
const CANVAS_RGB = '244,246,245'   // colors.canvas #F4F6F5

// The vertical space the bar occupies above the screen's bottom edge. Screens that must
// not be covered pad by this; Home scrolls under it and pads its content instead.
export function useTabBarFootprint() {
  const insets = useSafeAreaInsets()
  return TAB_BAR_H + GAP_BELOW + Math.max(insets.bottom, 8)
}

// For tab screens that must not be covered (Keşfet map, Profil): pads by the footprint, so
// their layout is exactly what it was above a docked bar. A component, not a hook call in
// App: App.js renders its own SafeAreaProvider, so App's body has no insets to read.
export function TabBarPad({ children }) {
  const pad = useTabBarFootprint() + FADE_H
  return <View style={{ flex: 1, paddingBottom: pad }}>{children}</View>
}

export default function FloatingTabBar({ tabs, activeTab, onTabPress, refs = {}, lang }) {
  const insets = useSafeAreaInsets()
  const bottom = GAP_BELOW + Math.max(insets.bottom, 8)
  const solid = bottom + TAB_BAR_H / 2
  return (
    <>
    <View pointerEvents="none" style={[s.fadeWrap, { height: solid + FADE_H }]}>
      {Array.from({ length: FADE_STEPS }, (_, i) => (
        <View key={i} style={{ height: FADE_H / FADE_STEPS,
          backgroundColor: `rgba(${CANVAS_RGB},${((i + 1) / (FADE_STEPS + 1)).toFixed(3)})` }} />
      ))}
      <View style={{ height: solid, backgroundColor: `rgb(${CANVAS_RGB})` }} />
    </View>
    <View
      style={[s.bar, elevation.tabBar, { bottom }]}
      accessibilityRole="tablist"
    >
      {tabs.map(tab => {
        const active = tab.key === activeTab
        const label = t(tab.labelKey, lang)
        return (
          <TouchableOpacity
            key={tab.key}
            ref={refs[tab.key]}
            onPress={() => onTabPress(tab.key)}
            activeOpacity={press.small}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={label}
            style={[s.tab, active && s.tabActive]}
          >
            <Ionicons name={active ? tab.iconOn : tab.iconOff} size={22}
              color={active ? colors.primaryDark : colors.textSecondary} />
            {active && <Text style={s.label} numberOfLines={1}>{label}</Text>}
          </TouchableOpacity>
        )
      })}
    </View>
    </>
  )
}

const s = StyleSheet.create({
  fadeWrap:  { position: 'absolute', left: 0, right: 0, bottom: 0 },
  bar:       { position: 'absolute', left: TAB_BAR_SIDE, right: TAB_BAR_SIDE, height: TAB_BAR_H,
               borderRadius: radii.pill, backgroundColor: colors.card, flexDirection: 'row',
               alignItems: 'center', justifyContent: 'space-around', paddingHorizontal: 8 },
  tab:       { minWidth: 52, height: 48, borderRadius: radii.pill, flexDirection: 'row',
               alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 14 },
  tabActive: { backgroundColor: colors.primaryLight, paddingHorizontal: 16, flexShrink: 1 },
  label:     { ...type.small, fontFamily: 'Inter_600SemiBold', color: colors.primaryDark, flexShrink: 1 },
})
