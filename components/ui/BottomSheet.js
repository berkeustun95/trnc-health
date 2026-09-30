import { useEffect, useRef, useState } from 'react'
import {
  Modal, View, Text, Animated, PanResponder, Pressable, StyleSheet, useWindowDimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, type, radii, motion } from '../../constants/theme'
import { t } from '../../constants/i18n'
import IconButton from './IconButton'

// White, radius 28, grabber, drag-to-close, bottom safe-area padding. ALWAYS slides.
//
// Built on RN Modal + Animated + PanResponder: no gesture-handler or Reanimated (both are
// native modules). Android back arrives as the Modal's onRequestClose, which closes only
// this sheet. `visible === true`, never truthiness: RN Modal treats `undefined` as SHOWN
// (the 2026-09-24 policy-notice incident).
//
// The Modal stays mounted through the exit animation, then onClose fires.
export default function BottomSheet({ visible, onClose, title, lang, children, maxHeight = 0.88 }) {
  const insets = useSafeAreaInsets()
  const { height: winH } = useWindowDimensions()
  const shown = visible === true
  const [mounted, setMounted] = useState(shown)
  const y = useRef(new Animated.Value(winH)).current
  const fade = useRef(new Animated.Value(0)).current
  const closing = useRef(false)

  useEffect(() => {
    if (shown) {
      closing.current = false
      setMounted(true)
      y.setValue(winH)
      Animated.parallel([
        Animated.timing(y, { toValue: 0, duration: motion.sheetIn, useNativeDriver: true }),
        Animated.timing(fade, { toValue: 1, duration: motion.sheetIn, useNativeDriver: true }),
      ]).start()
    } else if (mounted) {
      animateOut(() => setMounted(false))
    }
  }, [shown])

  function animateOut(done) {
    Animated.parallel([
      Animated.timing(y, { toValue: winH, duration: motion.sheetOut, useNativeDriver: true }),
      Animated.timing(fade, { toValue: 0, duration: motion.sheetOut, useNativeDriver: true }),
    ]).start(done)
  }

  function requestClose() {
    if (closing.current) return
    closing.current = true
    animateOut(() => { setMounted(false); onClose?.() })
  }

  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: (_, g) => { if (g.dy > 0) y.setValue(g.dy) },
    onPanResponderRelease: (_, g) => {
      if (g.dy > 110 || g.vy > 0.9) requestClose()
      else Animated.spring(y, { toValue: 0, ...motion.spring, useNativeDriver: true }).start()
    },
  })).current

  if (!mounted) return null
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={requestClose}>
      <Animated.View style={[StyleSheet.absoluteFill, s.backdrop, { opacity: fade }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={requestClose}
          accessibilityRole="button" accessibilityLabel={t('uiClose', lang)} />
      </Animated.View>
      <Animated.View
        style={[s.sheet, { maxHeight: winH * maxHeight, paddingBottom: Math.max(insets.bottom, 16),
          transform: [{ translateY: y }] }]}
        accessibilityViewIsModal
      >
        <View {...pan.panHandlers} style={s.handleZone}>
          <View style={s.grabber} />
          {!!title && (
            <View style={s.header}>
              <Text style={s.title} accessibilityRole="header">{title}</Text>
              <IconButton icon="close" onPress={requestClose} accessibilityLabel={t('uiClose', lang)} />
            </View>
          )}
        </View>
        {children}
      </Animated.View>
    </Modal>
  )
}

const s = StyleSheet.create({
  backdrop:   { backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet:      { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.card,
                borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet,
                paddingHorizontal: 20 },
  handleZone: { paddingTop: 10 },
  grabber:    { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border,
                marginBottom: 6 },
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title:      { ...type.sheetTitle, color: colors.textPrimary, flex: 1 },
})
