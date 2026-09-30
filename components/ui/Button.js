import { TouchableOpacity, Text, View, ActivityIndicator, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, type, radii, press, TAP } from '../../constants/theme'
import { haptic } from './haptics'

// primary · secondary · text · danger. Min 44pt tall whatever the label size, so a short
// label can never shrink the target. Primary and danger give a light haptic on press.
//
// `disabledHint` is shown under a disabled button: a greyed-out control with no reason
// is the 1.18:1 dead end the audit found on Profil and the wizard.
const VARIANTS = {
  primary:   { bg: colors.primary,  fg: colors.onPrimary, border: null },
  secondary: { bg: colors.card,     fg: colors.primaryDark, border: colors.border },
  text:      { bg: 'transparent',   fg: colors.primaryDark, border: null },
  danger:    { bg: colors.dangerInk, fg: colors.onPrimary, border: null },
}

export default function Button({
  title, onPress, variant = 'primary', icon, loading = false, disabled = false,
  disabledHint, fullWidth = false, accessibilityLabel, style,
}) {
  const v = VARIANTS[variant] || VARIANTS.primary
  const off = disabled || loading
  const handlePress = () => {
    if (variant === 'primary' || variant === 'danger') haptic()
    onPress?.()
  }
  return (
    <View style={[fullWidth && s.full, style]}>
      <TouchableOpacity
        onPress={handlePress}
        disabled={off}
        activeOpacity={press.small}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || title}
        accessibilityState={{ disabled: off, busy: loading }}
        style={[
          s.btn,
          variant === 'text' && s.textBtn,
          { backgroundColor: v.bg },
          v.border && { borderWidth: 1, borderColor: v.border },
          off && s.off,
        ]}
      >
        {loading
          ? <ActivityIndicator size="small" color={v.fg} />
          : (
            <>
              {!!icon && <Ionicons name={icon} size={18} color={v.fg} />}
              <Text style={[s.label, { color: v.fg }]} numberOfLines={1}>{title}</Text>
            </>
          )}
      </TouchableOpacity>
      {disabled && !!disabledHint && <Text style={s.hint}>{disabledHint}</Text>}
    </View>
  )
}

const s = StyleSheet.create({
  full:    { alignSelf: 'stretch' },
  btn:     { minHeight: TAP + 4, borderRadius: radii.md, paddingHorizontal: 18,
             flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  textBtn: { minHeight: TAP, paddingHorizontal: 8 },
  // Opacity on the real colours, never a lighter text colour: the label keeps its contrast
  // ratio relative to its own fill.
  off:     { opacity: 0.45 },
  label:   { ...type.rowTitle },
  hint:    { ...type.meta, color: colors.textSecondary, marginTop: 6, textAlign: 'center' },
})
