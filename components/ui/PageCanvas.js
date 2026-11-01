import { View, Image, StyleSheet } from 'react-native'
import { colors, pageCanvas } from '../../constants/theme'

// The app's page ground, "Base C" (Berke, 2026-11-01): pageBase with a soft teal gradient at
// the top, fixed to the screen while content scrolls over it. The same on every non-photo page:
// no per-group tint (variant B, 2026-11-01); a group's colour lives in its chips and icons.
// Cards stay white. Secondary text sitting directly on it is colors.textSecondaryOnPage.
//
// A PNG, not expo-linear-gradient (a native module), so this ships by OTA. Baked from the
// tokens by scripts/generate-page-canvas.mjs.
const BASE = require('../../assets/page-canvas/base.png')

export default function PageCanvas({ style, children }) {
  return (
    <View style={[s.root, style]}>
      <Image source={BASE} resizeMode="stretch" style={s.base} />
      {children}
    </View>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.pageBase },
  base: { position: 'absolute', top: 0, left: 0, right: 0, width: '100%', height: pageCanvas.gradient.endAt },
})
