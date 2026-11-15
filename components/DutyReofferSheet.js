import { useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, type, radii } from '../constants/theme'
import { t } from '../constants/i18n'
import { BottomSheet, Button } from './ui'

// Onboarding v2 S4: the one-time second duty-alert offer, after a duty-list visit. Screen 2's copy (its
// first sentence only when `noCity`) and buttons. App owns eligibility, the once-per-device write and the
// events: onEnable resolves when the ask is over; onDecline is idempotent (the sheet's own close paths —
// backdrop, drag, Android back via onRequestClose — and "Şimdi değil" can both reach it).
export default function DutyReofferSheet({ visible, lang, noCity, onEnable, onDecline }) {
  const [busy, setBusy] = useState(false)

  async function enable() {
    if (busy) return
    setBusy(true)
    try { await onEnable() } finally { setBusy(false) }
  }

  return (
    <BottomSheet visible={visible === true} onClose={() => { if (!busy) onDecline() }} lang={lang}>
      <View style={s.head}>
        <View style={s.bell}>
          <Ionicons name="notifications-outline" size={26} color={colors.primaryDark} />
        </View>
        <Text style={s.title} accessibilityRole="header">{t('dutyAlertsTitle', lang)}</Text>
        {/* No home city and no fix: no "your city on top" promise (App: reofferNoCity). */}
        <Text style={s.body}>{noCity ? t('dutyReofferBodyNoCity', lang) : t('dutyAlertsBody', lang)}</Text>
      </View>
      <View style={s.actions}>
        <Button size="lg" title={t('dutyAlertsEnable', lang)} wrap onPress={enable} loading={busy} fullWidth />
        <Button variant="text" title={t('dutyAlertsNotNow', lang)} onPress={onDecline} disabled={busy} fullWidth />
      </View>
    </BottomSheet>
  )
}

const s = StyleSheet.create({
  head:    { alignItems: 'center', paddingTop: 8 },
  bell:    { width: 56, height: 56, borderRadius: radii.pill, backgroundColor: colors.primaryLight,
             alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  title:   { ...type.sheetTitle, color: colors.textPrimary, textAlign: 'center' },
  body:    { ...type.body, color: colors.textSecondary, textAlign: 'center', marginTop: 8 },
  actions: { marginTop: 20, gap: 8 },
})
