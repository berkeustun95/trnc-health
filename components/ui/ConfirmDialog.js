import { Modal, View, Text, Pressable, StyleSheet } from 'react-native'
import { colors, type, radii, elevation } from '../../constants/theme'
import { t } from '../../constants/i18n'
import Button from './Button'

// Centred, and ONLY for blocking or destructive decisions (sign out, delete, clear all).
// Everything else is a BottomSheet. Cancel is always offered, and the backdrop / Android back
// both mean cancel.
//
// Two shapes:
//   • confirm/cancel — `confirmLabel` + `onConfirm` (`destructive` paints it dangerInk)
//   • stacked actions — `actions: [{ label, onPress, variant }]`, cancel added last. Used by
//     the guest sign-out: "Hesap oluştur" · "Yine de çıkış yap" · "Vazgeç".
export default function ConfirmDialog({
  visible, title, message, confirmLabel, cancelLabel, onConfirm, onCancel,
  destructive = false, loading = false, error, actions, lang,
}) {
  const cancel = cancelLabel || t('cancel', lang)
  return (
    <Modal visible={visible === true} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={s.center}>
        <Pressable style={[StyleSheet.absoluteFill, s.backdrop]} onPress={onCancel}
          accessibilityRole="button" accessibilityLabel={cancel} />
        <View style={[s.box, elevation.floating]} accessibilityViewIsModal>
          <Text style={s.title} accessibilityRole="header">{title}</Text>
          {!!message && <Text style={s.msg}>{message}</Text>}
          {!!error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
          {actions ? (
            <View style={s.stack}>
              {actions.map(a => (
                <Button key={a.label} variant={a.variant || 'secondary'} title={a.label} onPress={a.onPress}
                  loading={a.loading} fullWidth />
              ))}
              <Button variant="text" title={cancel} onPress={onCancel} fullWidth />
            </View>
          ) : (
            <View style={s.actions}>
              <Button variant="secondary" title={cancel} onPress={onCancel} style={s.flex} fullWidth />
              <Button variant={destructive ? 'danger' : 'primary'} title={confirmLabel} onPress={onConfirm}
                loading={loading} style={s.flex} fullWidth />
            </View>
          )}
        </View>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  center:   { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.45)' },
  box:      { width: '100%', maxWidth: 360, backgroundColor: colors.card, borderRadius: radii.widget, padding: 20 },
  title:    { ...type.sheetTitle, color: colors.textPrimary },
  msg:      { ...type.body, color: colors.textSecondary, marginTop: 8 },
  error:    { ...type.small, color: colors.dangerInk, marginTop: 8 },
  actions:  { flexDirection: 'row', gap: 10, marginTop: 20 },
  stack:    { gap: 8, marginTop: 20 },
  flex:     { flex: 1 },
})
