import { Modal, View, Text, TouchableOpacity, StyleSheet, Pressable } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors } from '../constants/theme'
import { t } from '../constants/i18n'

// Shown when a guest taps an action that needs a real account. `messageKey` is an
// i18n key so each call site explains what signing up unlocks, rather than one
// generic string.
export default function AccountRequiredSheet({ visible, messageKey, lang, onSignUp, onClose }) {
  if (!messageKey) return null

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={e => e.stopPropagation()}>
          <View style={s.grabber} />

          <View style={s.iconWrap}>
            <Ionicons name="person-add-outline" size={26} color={colors.primary} />
          </View>

          <Text style={s.title}>{t('gateTitle', lang)}</Text>
          <Text style={s.message}>{t(messageKey, lang)}</Text>

          <TouchableOpacity style={s.primaryBtn} onPress={onSignUp} activeOpacity={0.85}>
            <Text style={s.primaryBtnText}>{t('signup', lang)}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.dismissBtn} onPress={onClose} activeOpacity={0.7}>
            <Text style={s.dismissText}>{t('gateNotNow', lang)}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const s = StyleSheet.create({
  backdrop:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet:     { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
               paddingHorizontal: 24, paddingTop: 10, paddingBottom: 34, alignItems: 'center' },
  grabber:   { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 18 },
  iconWrap:  { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.primaryLight,
               justifyContent: 'center', alignItems: 'center', marginBottom: 14 },
  title:     { fontSize: 19, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textAlign: 'center', marginBottom: 8 },
  message:   { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center',
               lineHeight: 20, marginBottom: 24, paddingHorizontal: 4 },
  primaryBtn:{ alignSelf: 'stretch', backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  primaryBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff', letterSpacing: 0.3 },
  dismissBtn:{ paddingVertical: 14, paddingHorizontal: 16, minHeight: 44, justifyContent: 'center' },
  dismissText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
})
