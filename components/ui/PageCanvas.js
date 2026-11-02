import { View, Image, StyleSheet } from 'react-native'
import { colors, pageCanvas } from '../../constants/theme'
import { OnPhotoContext } from './onPhoto'

// The app's page ground, "Base C" (Berke, 2026-11-01): pageBase with a soft teal gradient at
// the top, fixed to the screen while content scrolls over it. The same on every non-photo ADA
// page: no per-group tint (variant B, 2026-11-01); a group's colour lives in its chips and icons.
// Cards stay white. Secondary text sitting directly on it is colors.textSecondaryOnPage.
// Partner pages pass `flat` (below).
//
// A PNG, not expo-linear-gradient (a native module), so this ships by OTA. Baked from the
// tokens by scripts/generate-page-canvas.mjs.
//
// `flat`: pageBase only, no gradient. Partner pages (Berke, 2026-11-02): the partner's own
// grey text sits straight on the ground there and read washed out on the teal, so they keep
// their original textSecondary / primary / dangerInk (all >= 4.5 on pageBase).
//
// A PageCanvas opened over a module photo (the Eatery quiz over its list) is off the photo again,
// so the kit inside it gets its canvas variants back, as Card does for its children.
const BASE = require('../../assets/page-canvas/base.png')

export default function PageCanvas({ flat = false, style, children }) {
  return (
    <OnPhotoContext.Provider value={false}>
      <View style={[s.root, style]}>
        {!flat && <Image source={BASE} resizeMode="stretch" style={s.base} />}
        {children}
      </View>
    </OnPhotoContext.Provider>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.pageBase },
  base: { position: 'absolute', top: 0, left: 0, right: 0, width: '100%', height: pageCanvas.gradient.endAt },
})
