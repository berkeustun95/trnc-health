import { View, Text, Modal, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, radius } from '../constants/theme'
import { t } from '../constants/i18n'

// "We've updated our Privacy Policy" — shown once per LEGAL_VERSION to people who used ADA
// under an older one (who sees it: utils/policyNoticeRules.js; when: App.js). Both buttons
// only mark it seen; neither records acceptance.
export default function PolicyUpdateNotice({ visible, lang, onRead, onDismiss }) {
  return (
    // `=== true`, never truthiness or the raw prop: RN's Modal treats a missing `visible` as
    // SHOWN, so an undefined here would be a notice nobody can close.
    <Modal visible={visible === true} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={s.backdrop}>
        <View style={s.card}>
          <Ionicons name="shield-checkmark-outline" size={28} color={colors.primary} />
          <Text style={s.title}>{t('policyUpdatedTitle', lang)}</Text>
          <Text style={s.body}>{t('policyUpdatedBody', lang)}</Text>
          <TouchableOpacity style={s.primary} onPress={onRead} activeOpacity={0.85}>
            <Text style={s.primaryText}>{t('policyUpdatedRead', lang)}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.secondary} onPress={onDismiss} activeOpacity={0.7}>
            <Text style={s.secondaryText}>{t('policyUpdatedOk', lang)}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  backdrop:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  card:          { backgroundColor: colors.cardBg, borderRadius: radius.xl, padding: 22, alignItems: 'flex-start', gap: 10 },
  title:         { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  body:          { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 20 },
  primary:       { alignSelf: 'stretch', marginTop: 6, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  primaryText:   { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
  secondary:     { alignSelf: 'stretch', paddingVertical: 10, alignItems: 'center' },
  secondaryText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: colors.textSecondary },
})
