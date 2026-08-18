import { View, Text, StyleSheet } from 'react-native'
import { colors } from '../constants/theme'
import BackButton from './BackButton'

export default function ScreenHeader({
  onBack,
  backLabel,
  lang,
  title,
  subtitle,
  titleIcon,
  rightElement,
}) {
  return (
    <View style={s.bar}>
      <BackButton lang={lang} label={backLabel} onPress={onBack} style={s.back} />

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
                  paddingHorizontal: 16, paddingVertical: 2,
                  backgroundColor: colors.cardBg,
                  borderBottomWidth: 1, borderBottomColor: colors.border,
                  marginBottom: 18 },
  back:         { minWidth: 70, justifyContent: 'flex-start' },
  center:       { flex: 1, alignItems: 'center' },
  iconTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title:        { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textAlign: 'center' },
  subtitle:     { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 1, textAlign: 'center' },
  right:        { minWidth: 70, alignItems: 'flex-end' },
})
