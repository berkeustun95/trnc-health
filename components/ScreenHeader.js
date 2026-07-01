import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors } from '../constants/theme'
import { t } from '../constants/i18n'

export default function ScreenHeader({
  onBack,
  backLabel,
  lang,
  title,
  subtitle,
  titleIcon,
  rightElement,
}) {
  const label = backLabel ?? t('back', lang)

  return (
    <View style={s.bar}>
      <TouchableOpacity style={s.back} onPress={onBack} activeOpacity={0.7}>
        <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
        <Text style={s.backText}>{label}</Text>
      </TouchableOpacity>

      <View style={s.center}>
        {titleIcon ? (
          <View style={s.iconTitleRow}>
            {titleIcon}
            {title ? <Text style={s.title}>{title}</Text> : null}
          </View>
        ) : (
          <>
            {title ? <Text style={s.title}>{title}</Text> : null}
            {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
          </>
        )}
      </View>

      <View style={s.right}>
        {rightElement ?? null}
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  bar:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                  paddingHorizontal: 16, paddingVertical: 12,
                  backgroundColor: colors.cardBg,
                  borderBottomWidth: 1, borderBottomColor: colors.border },
  back:         { flexDirection: 'row', alignItems: 'center', gap: 2, minWidth: 70 },
  backText:     { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  center:       { flex: 1, alignItems: 'center' },
  iconTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title:        { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textAlign: 'center' },
  subtitle:     { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 1, textAlign: 'center' },
  right:        { minWidth: 70, alignItems: 'flex-end' },
})
