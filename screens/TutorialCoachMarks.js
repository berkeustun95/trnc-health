import { useState, useEffect, useRef } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { addBackListener } from '../utils/backHandler'
import { colors } from '../constants/theme'
import { t } from '../constants/i18n'

// The tour must never trap a user (iPad freeze, 2026-10-02). Rules:
//   · Atla / İleri live in a FIXED CONTROL BAR rendered on every step — even one whose bubble
//     cannot be placed — on the half of the screen away from the target, inside the safe area.
//   · The bubble (title + text only) is never hidden and is REMOUNTED per step (key={step}), so its
//     onLayout always fires for that step. The previous version hid it (opacity 0) until onLayout and
//     reset the height in an effect; on the new architecture the step's layout event arrived BEFORE
//     that effect, the reset wiped it, and a bubble whose frame didn't move never laid out again —
//     invisible, with the buttons inside it.
//   · Placement from the LIVE window (useWindowDimensions) and safe area, clamped on screen.
//   · Fail-safes: an unplaceable step (target missing / off-screen) auto-advances; a bubble that
//     hasn't laid out for THIS step within LAYOUT_WAIT_MS auto-advances; if no step can be placed
//     at all, the tour closes (App marks it seen when it starts). Back / iOS edge swipe closes it.
const PAD = 10
const GAP = 14          // target ↔ bubble
const EDGE = 20         // bubble ↔ screen edge; 20 = the phone layout as before
const TIP_MAX_W = 420   // a phone-width card, centred on the target on tablets
const TIP_EST_H = 110   // placement guess until the bubble reports its height
const BAR_H = 60
const BAR_MAX_W = 560
const LAYOUT_WAIT_MS = 1500

function isPlaceable(c, SW, SH) {
  return !!c && [c.x, c.y, c.w, c.h].every(Number.isFinite) && c.w > 0 && c.h > 0 &&
    c.x < SW && c.y < SH && c.x + c.w > 0 && c.y + c.h > 0
}

export default function TutorialCoachMarks({ steps, visible, onFinish, onNext, lang }) {
  const [step, setStep]         = useState(0)
  const [blocked, setBlocked]   = useState(false)
  const [measured, setMeasured] = useState({ step: -1, h: 0 })
  const laidOutStep = useRef(-1)
  const { width: SW, height: SH } = useWindowDimensions()
  const insets = useSafeAreaInsets()

  const active = visible && steps.length > 0 && step < steps.length
  const cur = active ? steps[step] : null
  const placeable = isPlaceable(cur, SW, SH)
  const last = step >= steps.length - 1

  function goNext() {
    if (last) onFinish()
    else setStep(s => s + 1)
  }

  useEffect(() => {
    if (visible) { setStep(0); laidOutStep.current = -1 }
  }, [visible])

  // Back (Android) / edge swipe (iOS) closes the tour.
  useEffect(() => {
    if (!visible) return
    const sub = addBackListener(() => { onFinish(); return true })
    return () => sub.remove()
  }, [visible, onFinish])

  // Nothing placeable at all → close.
  useEffect(() => {
    if (visible && steps.length && !steps.some(c => isPlaceable(c, SW, SH))) onFinish()
  }, [visible, steps, SW, SH])

  // This step unplaceable → advance; placeable but its bubble never laid out → advance.
  useEffect(() => {
    if (!active) return
    if (!placeable) { goNext(); return }
    const timer = setTimeout(() => { if (laidOutStep.current !== step) goNext() }, LAYOUT_WAIT_MS)
    return () => clearTimeout(timer)
  }, [active, step, placeable])

  if (!active) return null

  async function advance() {
    if (blocked) return
    setBlocked(true)
    await onNext?.(step)
    goNext()
    setBlocked(false)
  }

  // The control bar goes on the half AWAY from the target, so it never covers the highlight.
  const targetLow = placeable ? cur.y + cur.h / 2 > SH / 2 : true
  const barW = Math.min(SW - 32, BAR_MAX_W)
  const barStyle = { left: (SW - barW) / 2, width: barW,
    ...(targetLow ? { top: insets.top + 8 } : { bottom: insets.bottom + 8 }) }

  const controls = (
    <View style={[s.bar, barStyle]}>
      <TouchableOpacity onPress={onFinish} style={s.skipBtn} accessibilityRole="button" accessibilityLabel={t('coachSkip', lang)}>
        <Text style={s.skip}>{t('coachSkip', lang)}</Text>
      </TouchableOpacity>
      <View style={s.dots}>
        {steps.map((_, i) => <View key={i} style={[s.dot, i === step && s.dotActive]} />)}
      </View>
      <TouchableOpacity style={s.nextBtn} onPress={advance} disabled={blocked} accessibilityRole="button">
        <Text style={s.nextText}>{last ? t('coachDone', lang) : t('coachNext', lang)}</Text>
      </TouchableOpacity>
    </View>
  )

  if (!placeable) {
    return (
      <View style={[StyleSheet.absoluteFill, s.root]} onStartShouldSetResponder={() => true}>
        <View style={[StyleSheet.absoluteFill, s.darkFill]} />
        {controls}
      </View>
    )
  }

  const { x, y, w, h, title, body } = cur
  const hx = Math.max(0, x - PAD)
  const hy = Math.max(0, y - PAD)
  const hw = Math.min(w + PAD * 2, SW - hx)
  const hh = Math.min(h + PAD * 2, SH - hy)

  // Bubble: phone-card wide, centred on the target, below it if it fits, else above, else clamped —
  // always inside the safe area and clear of the control bar.
  const tipH = measured.step === step ? measured.h : TIP_EST_H
  const tipW = Math.min(SW - EDGE * 2, TIP_MAX_W)
  const tipLeft = Math.min(Math.max(EDGE, x + w / 2 - tipW / 2), SW - EDGE - tipW)
  const minTop = insets.top + EDGE + (targetLow ? BAR_H + 8 : 0)
  const maxTop = SH - insets.bottom - EDGE - tipH - (targetLow ? 0 : BAR_H + 8)
  const below = hy + hh + GAP, above = hy - GAP - tipH
  const tipTop = below <= maxTop ? below : above >= minTop ? above : Math.max(minTop, Math.min(below, maxTop))

  return (
    <View style={[StyleSheet.absoluteFill, s.root]} onStartShouldSetResponder={() => true}>
      {/* Four dark rectangles create the spotlight cutout */}
      <View style={[s.dark, { top: 0, left: 0, right: 0, height: hy }]} />
      <View style={[s.dark, { top: hy + hh, left: 0, right: 0, bottom: 0 }]} />
      <View style={[s.dark, { top: hy, left: 0, width: hx, height: hh }]} />
      <View style={[s.dark, { top: hy, left: hx + hw, right: 0, height: hh }]} />

      <View style={[s.ring, { top: hy, left: hx, width: hw, height: hh }]} />

      <View key={step} style={[s.tooltip, { left: tipLeft, width: tipW, top: tipTop }]}
        onLayout={e => {
          laidOutStep.current = step
          const lh = Math.ceil(e.nativeEvent.layout.height)
          if (measured.step !== step || measured.h !== lh) setMeasured({ step, h: lh })
        }}>
        <Text style={s.title}>{title}</Text>
        <Text style={s.body}>{body}</Text>
      </View>

      {controls}
    </View>
  )
}

const s = StyleSheet.create({
  root:     { elevation: 9999, zIndex: 9999 },
  dark:     { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.72)' },
  darkFill: { backgroundColor: 'rgba(0,0,0,0.72)' },
  ring:     { position: 'absolute', borderRadius: 14, borderWidth: 2.5, borderColor: colors.primary, backgroundColor: 'transparent' },
  tooltip: {
    position: 'absolute',
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  title:    { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 6 },
  body:     { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 21 },
  bar: {
    position: 'absolute', height: BAR_H, borderRadius: 18, backgroundColor: '#fff',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 4 }, elevation: 10,
  },
  skipBtn:  { minHeight: 44, minWidth: 64, justifyContent: 'center', paddingHorizontal: 12 },
  skip:     { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: colors.textSecondary },
  dots:     { flexDirection: 'row', gap: 5 },
  dot:      { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotActive:{ backgroundColor: colors.primary },
  nextBtn:  { minHeight: 44, justifyContent: 'center', backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 20 },
  nextText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
})
