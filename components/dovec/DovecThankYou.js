import { View, Text, ScrollView, Linking, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { Button, Card } from '../ui'
import { colors, type, radii } from '../../constants/theme'
import { t } from '../../constants/i18n'
import { dovecWaUrl, dovecWaText } from '../../constants/dovec'
import { logContactEvent } from '../../utils/logContactEvent'

// After an accepted enquiry. WhatsApp shows only when dovec_settings.whatsapp_e164 is set; each tap is counted
// (module 'dovec', entity = the project's entity_uuid) on the line before the handoff.
export default function DovecThankYou({ project, reference, whatsapp, lang, onBack }) {
  const insets = useSafeAreaInsets()
  const waUrl = whatsapp ? dovecWaUrl(whatsapp, dovecWaText(project.name, reference)) : null
  const openWa = () => {
    logContactEvent('dovec', project.entity_uuid, 'whatsapp')
    Linking.openURL(waUrl).catch(() => {})
  }
  return (
    <ScrollView contentContainerStyle={[s.page, { paddingBottom: 32 + insets.bottom }]}>
      <View style={s.badge}><Ionicons name="checkmark" size={34} color={colors.successInk} /></View>
      <Text style={s.title} accessibilityRole="header">{t('dovecThanksTitle', lang)}</Text>
      <Text style={s.body}>{t('dovecThanksBody', lang).replace('{project}', () => project.name)}</Text>
      {!!reference && (
        <Card style={s.refCard}>
          <Text style={s.refLabel}>{t('dovecThanksRef', lang)}</Text>
          <Text style={s.ref} selectable>{reference}</Text>
        </Card>
      )}
      {!!waUrl && <Button fullWidth icon="logo-whatsapp" title={t('dovecThanksWa', lang)} onPress={openWa} style={s.btn} />}
      <Button fullWidth variant="secondary" title={t('dovecThanksBack', lang)} onPress={onBack} style={s.btn} />
    </ScrollView>
  )
}

const s = StyleSheet.create({
  page:     { paddingHorizontal: 20, paddingTop: 32, alignItems: 'center' },
  badge:    { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.successLight, alignItems: 'center', justifyContent: 'center' },
  title:    { ...type.detailTitle, color: colors.textPrimary, textAlign: 'center', marginTop: 18 },
  body:     { ...type.body, color: colors.textSecondary, textAlign: 'center', marginTop: 8 },
  refCard:  { alignSelf: 'stretch', alignItems: 'center', marginTop: 24, borderRadius: radii.card },
  refLabel: { ...type.meta, color: colors.textSecondary },
  ref:      { ...type.sectionHeading, color: colors.textPrimary, marginTop: 4 },
  btn:      { alignSelf: 'stretch', marginTop: 12 },
})
