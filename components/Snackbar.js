import { useEffect, useRef, useState } from 'react'
import { Animated, AccessibilityInfo, Pressable, Text, StyleSheet } from 'react-native'
import { colors, font, type, radii, space, elevation, motion, press, TAP } from '../constants/theme'

// A short-lived message with one action ("Sepet temizlendi" · "Geri al"). White card on the canvas with the
// floating elevation (no dark fill: ada-style §6). The message is announced once when it appears (iOS
// VoiceOver ignores liveRegion; Android reads it from accessibilityLiveRegion). Reduced motion = no fade.
// A screen reader needs longer to reach the action (READER_DURATION). The parent owns `visible` and hides it from onTimeout / onAction; `bottom` lifts it clear of the inset.
const READER_DURATION = 8000

export default function Snackbar({ visible, message, actionLabel, onAction, onTimeout, reduce, bottom = space[16], duration = 5000 }) {
  const fade = useRef(new Animated.Value(0)).current
  const cb = useRef({ onTimeout })
  cb.current = { onTimeout }
  const [reader, setReader] = useState(false)
  useEffect(() => {
    let alive = true
    AccessibilityInfo.isScreenReaderEnabled().then(v => { if (alive) setReader(v) }).catch(() => {})
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (visible !== true) return
    AccessibilityInfo.announceForAccessibility(message)
    if (reduce) fade.setValue(1)
    else { fade.setValue(0); Animated.timing(fade, { toValue: 1, duration: motion.fast, useNativeDriver: true }).start() }
    const timer = setTimeout(() => cb.current.onTimeout?.(), reader ? READER_DURATION : duration)
    return () => clearTimeout(timer)
  }, [visible, message, reduce, duration, reader, fade])

  if (visible !== true) return null
  return (
    <Animated.View style={[s.bar, { bottom, opacity: fade }]}>
      <Text style={s.msg} numberOfLines={2}>{message}</Text>
      {!!actionLabel && (
        <Pressable onPress={onAction} style={({ pressed }) => [s.action, pressed && { opacity: press.small }]}
          accessibilityRole="button" accessibilityLabel={actionLabel}>
          <Text style={s.actionText}>{actionLabel}</Text>
        </Pressable>
      )}
    </Animated.View>
  )
}

const s = StyleSheet.create({
  bar:        { position: 'absolute', left: space[16], right: space[16], flexDirection: 'row', alignItems: 'center',
                backgroundColor: colors.card, borderRadius: radii.md, paddingLeft: space[16], paddingRight: space[8],
                minHeight: TAP + 8, ...elevation.floating },
  msg:        { flex: 1, ...type.body, color: colors.textPrimary },
  action:     { minHeight: TAP, minWidth: TAP, paddingHorizontal: space[12], alignItems: 'center', justifyContent: 'center' },
  actionText: { ...type.body, fontFamily: font.semibold, color: colors.primaryDark },
})
