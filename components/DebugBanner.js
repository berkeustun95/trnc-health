import { useRef, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'

// TEMPORARY diagnostic — delete with its call sites.
//
// Every instrument built for this bug so far LOGGED. A log tells you what the React
// tree holds; it cannot tell you what is painted. Nine rounds of investigation were
// spent comparing the tree against a description of the screen. This renders instead,
// so a photograph answers the question directly.
//
// Each banner states three things about the component that owns it:
//   name  — which screen these pixels belong to
//   r=    — its render count, so stale pixels are visible as a frozen number
//   TAP n — an always-on target that increments when THIS tree receives a touch
//
// The TAP counter is what settles the direction. If Home's banner counts and the pets
// banner does not, Home is live and the pets pixels are stale; if the reverse, the
// pets tree is live behind stale Home pixels; if both count, there are two live trees,
// which is a finding in itself.
export default function DebugBanner({ name, detail, top, color }) {
  const renders = useRef(0)
  renders.current += 1
  const [taps, setTaps] = useState(0)

  return (
    // box-none so the banner itself never blocks the screen under it — only the
    // button is touchable, which keeps the instrument from changing what it measures.
    <View style={[s.wrap, { top }]} pointerEvents="box-none">
      <View style={[s.pill, { backgroundColor: color }]}>
        <Text style={s.txt}>{name} r={renders.current}{detail ? ` ${detail}` : ''}</Text>
        <TouchableOpacity style={s.btn} onPress={() => setTaps(t => t + 1)}>
          <Text style={s.btnTxt}>TAP {taps}</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  wrap:   { position: 'absolute', left: 0, right: 0, zIndex: 9999 },
  pill:   { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
            paddingHorizontal: 6, paddingVertical: 2, gap: 8 },
  txt:    { color: '#fff', fontSize: 10, fontFamily: 'Inter_700Bold' },
  btn:    { backgroundColor: 'rgba(255,255,255,0.3)', paddingHorizontal: 6, paddingVertical: 2 },
  btnTxt: { color: '#fff', fontSize: 10, fontFamily: 'Inter_700Bold' },
})
