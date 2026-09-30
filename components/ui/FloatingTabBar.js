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

// The vertical space the bar occupies above the screen's bottom edge. Screens that must
// not be covered pad by this; Home scrolls under it and pads its content instead.
export function useTabBarFootprint() {
  const insets = useSafeAreaInsets()
  return TAB_BAR_H + GAP_BELOW + Math.max(insets.bottom, 8)
}

export default function FloatingTabBar({ tabs, activeTab, onTabPress, refs = {}, lang }) {
  const insets = useSafeAreaInsets()
  return (
    <View
      style={[s.bar, elevation.tabBar, { bottom: GAP_BELOW + Math.max(insets.bottom, 8) }]}
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
  )
}

const s = StyleSheet.create({
  bar:       { position: 'absolute', left: TAB_BAR_SIDE, right: TAB_BAR_SIDE, height: TAB_BAR_H,
               borderRadius: radii.pill, backgroundColor: colors.card, flexDirection: 'row',
               alignItems: 'center', justifyContent: 'space-around', paddingHorizontal: 8 },
  tab:       { minWidth: 52, height: 48, borderRadius: radii.pill, flexDirection: 'row',
               alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 14 },
  tabActive: { backgroundColor: colors.primaryLight, paddingHorizontal: 16, flexShrink: 1 },
  label:     { ...type.small, fontFamily: 'Inter_600SemiBold', color: colors.primaryDark, flexShrink: 1 },
})
