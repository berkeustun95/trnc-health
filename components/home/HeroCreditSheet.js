import { View, Text, Modal, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, radius } from '../../constants/theme'
import { t } from '../../constants/i18n'
import PhotoCredit from '../PhotoCredit'

// The hero photo's attribution, behind the ℹ︎ chip.
//
// ─── A SHEET RATHER THAN A CAPTION, AND WHY THAT IS STILL COMPLIANT ─────────
// The hero already carries two pieces of overlaid text — district name and temperature —
// and a third line of small grey credit over a photograph is where all three become
// unreadable. CC BY asks for attribution "reasonable to the medium"; on a phone hero the
// reasonable form is a visible, permanent, one-tap affordance rather than a caption
// competing with the content. The chip is always present whenever a credited photo is
// shown — it is rendered from the same condition as the photo itself, so a hero can
// never appear without its route to the credit.
//
// The BODY is components/PhotoCredit.js, the same renderer ExploreProfileScreen uses.
// The creator's name, the licence link and the source link are identical on both
// surfaces because they are literally the same component.
export default function HeroCreditSheet({ visible, credit, lang, onClose }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onClose}>
        <View style={s.sheet} onStartShouldSetResponder={() => true}>
          <View style={s.header}>
            <Text style={s.title}>{t('heroCreditTitle', lang)}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* textStyle bumps 11pt to 13pt. The 11pt in PhotoCredit is sized for a
              caption tucked under a gallery; in a sheet with room of its own it is
              needlessly small. Size is the caller's business — the FIELDS, their order
              and what is tappable are not, and those stay in the shared component. */}
          <PhotoCredit a={credit} lang={lang} style={s.body} textStyle={s.bodyText} />

          {/* Carries the MODIFICATION NOTICE as well as the source. Every hero image
              is cropped and resized from its original, and CC BY asks for changes to be
              indicated — naming the author and licence while presenting a crop as the
              original is an incomplete attribution. See constants/homeHero.js. */}
          <Text style={s.note}>{t('heroCreditNote', lang)}</Text>
        </View>
      </TouchableOpacity>
    </Modal>
  )
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet:    { backgroundColor: colors.cardBg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: 20, paddingBottom: 34 },
  header:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  title:    { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  body:     { gap: 4 },
  bodyText: { fontSize: 13 },
  note:     { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 16, lineHeight: 18 },
})
