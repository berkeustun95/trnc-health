import { useState, useEffect, useRef } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { addBackListener } from '../utils/backHandler'
import { colors } from '../constants/theme'
import { t } from '../constants/i18n'

const PAD = 10
const GAP = 14          // target ↔ tooltip
const EDGE = 20         // tooltip ↔ screen edge (inside the safe area); 20 = the phone layout as before
const TIP_MAX_W = 420   // a phone-width card, centred on the target on tablets
const LAYOUT_WAIT_MS = 1500

// Placement uses the LIVE window (useWindowDimensions), never a size read at module load: on an
// iPad / foldable / after rotation that stale size put the tooltip off-screen while the dimmed
// overlay swallowed every touch — the tour froze (2026-10-02). The tooltip is clamped inside the
// safe area, and a step that cannot be placed (target missing or off-screen, or the tooltip never
// lays out) is SKIPPED rather than left hanging.

export default function TutorialCoachMarks({ steps, visible, onFinish, onNext, lang }) {
  const [step, setStep]       = useState(0)
  const [blocked, setBlocked] = useState(false)
  const [tipH, setTipH]       = useState(0)
  const { width: SW, height: SH } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const laidOut = useRef(false)

  useEffect(() => {
    if (visible) setStep(0)
  }, [visible])

  useEffect(() => {
    if (!visible) return
    const sub = addBackListener(() => true)
    return () => sub.remove()
  }, [visible])

  const cur = visible ? steps[step] : null
  const placeable = !!cur && [cur.x, cur.y, cur.w, cur.h].every(Number.isFinite) && cur.w > 0 && cur.h > 0 &&
    cur.x < SW && cur.y < SH && cur.x + cur.w > 0 && cur.y + cur.h > 0

  // Fail-safes: skip a step whose target is unplaceable, or whose tooltip never lays out.
  useEffect(() => {
    if (!visible || !cur) return
    laidOut.current = false
    setTipH(0)
    if (!placeable) { skipStep(); return }
    const timer = setTimeout(() => { if (!laidOut.current) skipStep() }, LAYOUT_WAIT_MS)
    return () => clearTimeout(timer)
  }, [visible, step, placeable])

  function skipStep() {
    if (step < steps.length - 1) setStep(s => s + 1)
    else onFinish()
  }

  if (!visible || !steps.length) return null
  if (step >= steps.length || !placeable) return null

  const { x, y, w, h, title, body } = cur

  const hx = Math.max(0, x - PAD)
  const hy = Math.max(0, y - PAD)
  const hw = Math.min(w + PAD * 2, SW - hx)
  const hh = Math.min(h + PAD * 2, SH - hy)

  // Width: phone-card wide, centred on the target, clamped to the screen.
  const tipW = Math.min(SW - EDGE * 2, TIP_MAX_W)
  const tipLeft = Math.min(Math.max(EDGE, x + w / 2 - tipW / 2), SW - EDGE - tipW)
  // Height: below the target if it fits, else above, else clamped inside the safe area
  // (it may then overlap the highlight — visible and tappable beats hidden).
  const minTop = insets.top + EDGE
  const maxTop = SH - insets.bottom - EDGE - tipH
  const below = hy + hh + GAP, above = hy - GAP - tipH
  const tipTop = below <= maxTop ? below : above >= minTop ? above : Math.max(minTop, Math.min(below, maxTop))

  async function advance() {
    if (blocked) return
    setBlocked(true)
    await onNext?.(step)
    if (step < steps.length - 1) {
      setStep(s => s + 1)
    } else {
      onFinish()
    }
    setBlocked(false)
  }

  return (
    <View style={[StyleSheet.absoluteFill, { elevation: 9999, zIndex: 9999 }]} onStartShouldSetResponder={() => true}>
      {/* Four dark rectangles create the spotlight cutout */}
      <View style={[s.dark, { top: 0, left: 0, right: 0, height: hy }]} />
      <View style={[s.dark, { top: hy + hh, left: 0, right: 0, bottom: 0 }]} />
      <View style={[s.dark, { top: hy, left: 0, width: hx, height: hh }]} />
      <View style={[s.dark, { top: hy, left: hx + hw, right: 0, height: hh }]} />

      {/* Highlight ring */}
      <View style={[s.ring, { top: hy, left: hx, width: hw, height: hh }]} />

      {/* Tooltip bubble */}
      <View
        style={[s.tooltip, { left: tipLeft, width: tipW, top: tipTop }, !tipH && { opacity: 0 }]}
        onLayout={e => { laidOut.current = true; setTipH(Math.ceil(e.nativeEvent.layout.height)) }}
      >
        <Text style={s.title}>{title}</Text>
        <Text style={s.body}>{body}</Text>
        <View style={s.footer}>
          <View style={s.dots}>
            {steps.map((_, i) => (
              <View key={i} style={[s.dot, i === step && s.dotActive]} />
            ))}
          </View>
          <View style={s.btns}>
            <TouchableOpacity onPress={onFinish} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={s.skip}>{t('coachSkip', lang)}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.nextBtn} onPress={advance} disabled={blocked}>
              <Text style={s.nextText}>{step === steps.length - 1 ? t('coachDone', lang) : t('coachNext', lang)}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  dark:    { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.72)' },
  ring:    { position: 'absolute', borderRadius: 14, borderWidth: 2.5, borderColor: colors.primary, backgroundColor: 'transparent' },
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
  body:     { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 21, marginBottom: 16 },
  footer:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dots:     { flexDirection: 'row', gap: 5 },
  dot:      { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotActive:{ backgroundColor: colors.primary },
  btns:     { flexDirection: 'row', alignItems: 'center', gap: 14 },
  skip:     { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  nextBtn:  { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 18 },
  nextText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
})
