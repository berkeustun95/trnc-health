import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, radius } from '../constants/theme'
import { t } from '../constants/i18n'
// `call` and `email` are EXISTING app-wide keys, already translated in all nine and
// already guarded elsewhere. A dedicated petsVetDept* pair would have been two more
// strings saying the same words in nine languages.
import { VET_DEPT_PHONE, VET_DEPT_EMAIL } from '../constants/petsContent'

// Call + email the TRNC Veterinary Department.
//
// ─── WHY A COMPONENT, WITH FOUR CALL SITES ──────────────────────────────────
//
// BringingPetScreen and OwningPetScreen each had their own copy of this row AND their own
// `const VET_DEPT_PHONE` / `VET_DEPT_EMAIL` — two copies of a pair of contact details that
// nothing kept in step, each sitting under a `// Verify contact details with TRNC
// Veterinary Department before shipping` comment that survived every release since the
// module went live. The values now live once in constants/petsContent.js and the row lives
// once here. The other two call sites are new: the PIB.01 fallback and the staleness
// notice, both of which exist precisely to put somebody in touch with this department.
//
// ⚠ THE NUMBER AND ADDRESS ARE UNVERIFIED. They were carried over unchanged and have never
//   been dialled — tracked as PENDING.vetDeptContacts, which npm run pets:health prints on
//   every run. Moving them did not verify them, and this component now surfaces them in
//   more places than before, not fewer.
//
// ⚠ ITS OWN FILE SO IT CAN JOIN THE i18n SURFACES LIST. Both host screens must stay OUT of
//   that list — their regulatory strings are English-only by design — but this row is pure
//   wrapper copy and is guarded in all nine. The DisplayNameCheck lesson applied forward:
//   copy that lives in a component is only guarded if somebody puts the component there.
export default function VetDeptActions({ lang, style }) {
  return (
    <View style={[s.row, style]}>
      <TouchableOpacity
        style={s.btn}
        onPress={() => Linking.openURL(`tel:${VET_DEPT_PHONE}`).catch(() => {})}
        activeOpacity={0.8}
      >
        <Ionicons name="call-outline" size={16} color={colors.primary} />
        <Text style={s.btnText} numberOfLines={2}>{t('call', lang)}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={s.btn}
        onPress={() => Linking.openURL(`mailto:${VET_DEPT_EMAIL}`).catch(() => {})}
        activeOpacity={0.8}
      >
        <Ionicons name="mail-outline" size={16} color={colors.primary} />
        <Text style={s.btnText} numberOfLines={2}>{t('email', lang)}</Text>
      </TouchableOpacity>
    </View>
  )
}

const s = StyleSheet.create({
  row:     { flexDirection: 'row', gap: 10, marginTop: 14 },
  // backgroundColor explicit: borderWidth + borderRadius on Android can render an opaque
  // background without it, and this button is INTENDED to be unfilled — which is exactly
  // the case where that gotcha shows up.
  btn:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
             gap: 6, borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.sm,
             paddingVertical: 10, backgroundColor: 'transparent' },
  // ⚠ TWO LINES, AND THAT IS A MEASUREMENT. numberOfLines={1} truncated Spanish
  //   "Correo electrónico" — 128.0pt of label in a 97.0pt box at 320dp, measured against
  //   the shipped Inter. It rendered as "Correo electr…" on a button whose whole job is to
  //   say what it does. Every other locale fitted, so only a sweep would have caught it.
  //   flexShrink keeps the icon inside the button while the text takes the width it needs.
  btnText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.primary, flexShrink: 1 },
})
