import { View, Image, StyleSheet } from 'react-native'
import { colors, category as CAT, pageCanvas } from '../../constants/theme'

// The app's page ground, "Base C" (Berke, 2026-11-01): pageBase with a soft teal gradient at
// the top, fixed to the screen while content scrolls over it. `group` (health | explore |
// homeLife | city) adds that Home group's ink as a faint fade on top; omit it for pages with no
// group and for partner screens (frame only, never a partner colour). Cards stay white.
//
// PNGs, not expo-linear-gradient (a native module), so this ships by OTA. They are baked from
// the tokens by scripts/generate-page-canvas.mjs; one white fade mask serves all four groups
// through tintColor, which keeps the mask's alpha.
const BASE = require('../../assets/page-canvas/base.png')
const GROUP_FADE = require('../../assets/page-canvas/group-fade.png')

export default function PageCanvas({ group, style, children }) {
  const ink = CAT[group]?.ink
  return (
    <View style={[s.root, style]}>
      <Image source={BASE} resizeMode="stretch" style={s.base} />
      {ink && <Image source={GROUP_FADE} resizeMode="stretch" style={[s.fade, { tintColor: ink }]} />}
      {children}
    </View>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.pageBase },
  base: { position: 'absolute', top: 0, left: 0, right: 0, width: '100%', height: pageCanvas.gradient.endAt },
  fade: { position: 'absolute', top: 0, left: 0, right: 0, width: '100%', height: pageCanvas.groupFade.endAt },
})
