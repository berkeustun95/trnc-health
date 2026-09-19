import { View, Text, StyleSheet } from 'react-native'
import { colors } from '../constants/theme'
import BackButton from './BackButton'

// ⚠ TEMPORARY MEASUREMENT — 2026-09-19, REMOVE ONCE READ.
//
// t('back') clips to "G…" here in Turkish with 29.9dp of room for a word needing ~31.
// The 1.1dp gap is larger than the pixel-grid quantum (0.36dp at density 2.75), so this is
// probably NOT the rounding class that explains the home hero — something is genuinely
// constraining the width. Two derivations from the stylesheet have failed to reproduce it:
// `back` has minWidth 70 (a FLOOR, not a cap), `bar` is a plain row, and nothing visible
// here stops the column growing to its content.
//
// So this stops deriving and reads the number. back width minus the 2dp gap minus the
// 29.9dp the audit already reports for the label gives the icon's real advance width,
// which is the quantity every attempt so far has had to assume.
const probed = { done: false }

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
      <BackButton
        lang={lang} label={backLabel} onPress={onBack} style={s.back}
        onLayout={__DEV__ ? e => {
          if (probed.done) return
          probed.done = true
          const w = e.nativeEvent.layout.width
          console.log(`[probe] ScreenHeader back column = ${w.toFixed(1)}dp ` +
                      `(minWidth is 70; label reported 29.9dp, gap 2 -> icon ~${(w - 2 - 29.9).toFixed(1)}dp)`)
        } : undefined}
      />

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
