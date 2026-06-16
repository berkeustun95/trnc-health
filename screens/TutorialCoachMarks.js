import { useState, useEffect } from 'react'
import { View, Text, Modal, TouchableOpacity, StyleSheet, Dimensions } from 'react-native'
import { colors } from '../constants/theme'

const { width: SW, height: SH } = Dimensions.get('window')
const PAD = 10

export default function TutorialCoachMarks({ steps, visible, onFinish, onNext }) {
  const [step, setStep]       = useState(0)
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    if (visible) setStep(0)
  }, [visible])

  if (!visible || !steps.length) return null

  const cur = steps[step]
  const { x, y, w, h, title, body } = cur

  const hx = Math.max(0, x - PAD)
  const hy = Math.max(0, y - PAD)
  const hw = Math.min(w + PAD * 2, SW - hx)
  const hh = h + PAD * 2

  const isTopHalf = y < SH * 0.55

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
    <Modal visible transparent animationType="fade">
      {/* Four dark rectangles create the spotlight cutout */}
      <View style={[s.dark, { top: 0, left: 0, right: 0, height: hy }]} />
      <View style={[s.dark, { top: hy + hh, left: 0, right: 0, bottom: 0 }]} />
      <View style={[s.dark, { top: hy, left: 0, width: hx, height: hh }]} />
      <View style={[s.dark, { top: hy, left: hx + hw, right: 0, height: hh }]} />

      {/* Highlight ring */}
      <View style={[s.ring, { top: hy, left: hx, width: hw, height: hh }]} />

      {/* Tooltip bubble */}
      <View
        style={[
          s.tooltip,
          { left: 20, right: 20 },
          isTopHalf ? { top: hy + hh + 14 } : { bottom: SH - hy + 14 },
        ]}
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
              <Text style={s.skip}>Skip</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.nextBtn} onPress={advance} disabled={blocked}>
              <Text style={s.nextText}>{step === steps.length - 1 ? 'Done' : 'Next'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  dark:    { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.72)' },
  ring:    { position: 'absolute', borderRadius: 14, borderWidth: 2.5, borderColor: colors.primary },
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
