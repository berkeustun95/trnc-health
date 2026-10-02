import { forwardRef } from 'react'
import { TouchableOpacity, View, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, press, TAP } from '../../constants/theme'

// An icon-only control. accessibilityLabel is REQUIRED: 38 labels across 765 touchables was
// the audit's starting point, and a rule that is only documented does not hold. In __DEV__
// a missing label warns loudly and renders a red ring so it is seen on the device.
//
// variant: 'plain' (transparent) · 'frosted' (white 0.94, for use over photos) · 'soft'
// (canvas well). The hit area is always 44×44, whatever the visual size.
const BG = {
  plain:   'transparent',
  frosted: 'rgba(255,255,255,0.94)',
  soft:    colors.soft,
}

const IconButton = forwardRef(function IconButton({
  icon, onPress, accessibilityLabel, variant = 'plain', iconSize = 20,
  color = colors.textPrimary, badge = false, disabled = false, style,
}, ref) {
  const missing = !accessibilityLabel
  if (__DEV__ && missing) console.warn(`IconButton '${icon}' has no accessibilityLabel`)
  return (
    <TouchableOpacity
      ref={ref}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={press.small}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      style={[s.btn, { backgroundColor: BG[variant] ?? BG.plain },
        __DEV__ && missing && s.devMissing, disabled && { opacity: 0.45 }, style]}
    >
      <Ionicons name={icon} size={iconSize} color={color} />
      {badge && <View style={s.dot} />}
    </TouchableOpacity>
  )
})

export default IconButton

const s = StyleSheet.create({
  btn:        { width: TAP, height: TAP, borderRadius: TAP / 2,
                justifyContent: 'center', alignItems: 'center' },
  dot:        { position: 'absolute', top: 10, right: 10, width: 9, height: 9, borderRadius: 4.5,
                backgroundColor: colors.dangerInk, borderWidth: 1.5, borderColor: '#FFFFFF' },
  devMissing: { borderWidth: 2, borderColor: 'red' },
})
