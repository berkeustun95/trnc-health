import { View, Text, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, type } from '../../constants/theme'
import { t } from '../../constants/i18n'
import IconButton from './IconButton'

// Back · left-aligned title · up to two labelled actions. No white slab with a hairline:
// the header sits on the page canvas, which is the Home direction. `inset` adds the top
// safe-area padding for screens that are not already inside a SafeAreaView.
// actions: [{ icon, onPress, accessibilityLabel, badge }]
// tone 'light': white title, subtitle and icons over a module photo (ModuleBackdrop A);
// tone 'wash': the subtitle in WASH_SECONDARY on the veiled photo (ModuleBackdrop C).
export default function ScreenHeader({ title, subtitle, onBack, lang, actions = [], inset = false, style, tone }) {
  const light = tone === 'light'
  const insets = useSafeAreaInsets()
  return (
    <View style={[s.bar, inset && { paddingTop: insets.top }, style]}>
      {onBack
        ? <IconButton icon="chevron-back" iconSize={24} onPress={onBack} accessibilityLabel={t('back', lang)}
            color={light ? '#FFFFFF' : undefined} />
        : <View style={s.spacer} />}
      <View style={s.titles}>
        {!!title && <Text style={[s.title, light && s.light]} numberOfLines={1} accessibilityRole="header">{title}</Text>}
        {!!subtitle && <Text style={[s.subtitle, light && s.light, tone === 'wash' && s.wash]} numberOfLines={1}>{subtitle}</Text>}
      </View>
      {actions.slice(0, 2).map(a => <IconButton key={a.icon} {...a} color={light ? '#FFFFFF' : a.color} />)}
    </View>
  )
}

const s = StyleSheet.create({
  bar:      { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, minHeight: 56 },
  spacer:   { width: 8 },
  titles:   { flex: 1, paddingHorizontal: 4 },
  title:    { ...type.sheetTitle, color: colors.textPrimary },
  subtitle: { ...type.meta, color: colors.textSecondary },
  light:    { color: '#FFFFFF' },
  wash:     { color: '#3E4A59' },   // ModuleBackdrop WASH_SECONDARY
})
