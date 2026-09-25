import { useState } from 'react'
import { View, Text, Image, Modal, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, radius, shadow } from '../constants/theme'
import { t } from '../constants/i18n'

// ─── "A new version is available" / "Please update ADA" ─────────────────────
//
// Two tiers off ONE component (utils/appUpdate.js decides which):
//   soft   dismissible. [Update] [Later]; Later snoozes 3 days per latest_version.
//   force  blocking. [Update] only, no Later, no backdrop dismiss, no hardware back.
//
// ─── THE ESCAPE HATCH IS NOT A COURTESY, IT IS THE POINT ───────────────────
//
// ADA is how people find the on-duty pharmacy and the emergency numbers. A blocking modal
// that also hides those is a health app deciding that an out-of-date binary is a good reason
// not to show somebody an ambulance number. So the force tier carries a low-emphasis link
// that opens exactly those two surfaces and nothing else; App.js renders the REAL screens
// (no copies) and every way out of them returns here.
//
// The two rows reuse menuEmergency and coachDutyTitle — the keys that already own those
// names everywhere else in the app — so the link, the rows and the screens they open cannot
// drift apart. That is also why updateEmergencyLink borrows the same two nouns.
//
// ─── visible={x === true}, AND WHY IT IS NOT truthiness ────────────────────
//
// RN's Modal treats `visible={undefined}` as SHOWN. Combined with Hermes not enforcing the
// temporal dead zone, that shipped a policy notice on 2026-09-24 that every user saw and
// nobody could close. Same guard as PolicyUpdateNotice: an explicit boolean, never the raw
// prop. onRequestClose is a NO-OP on force for the same family of reason — it is the Android
// hardware-back handler for a Modal, and a force tier that back can dismiss is not a force
// tier. App.js also holds the top of the BackHandler chain; both exist because which one
// wins the event is not something this should depend on.
export default function AppUpdateNotice({
  visible, tier, lang, onUpdate, onLater, onEmergency, onDuty,
}) {
  const [escapeOpen, setEscapeOpen] = useState(false)
  const force = tier === 'force'

  function close() {
    setEscapeOpen(false)
    onLater?.()
  }

  return (
    <Modal
      visible={visible === true}
      transparent
      animationType="fade"
      onRequestClose={force ? () => {} : close}
    >
      <View style={s.backdrop}>
        <View style={s.card}>
          <View style={s.mascotWrap}>
            <Image source={require('../assets/oli-button.png')} style={s.mascot} resizeMode="cover" />
          </View>

          <Text style={s.title}>{t(force ? 'updateForceTitle' : 'updateTitle', lang)}</Text>
          <Text style={s.body}>{t(force ? 'updateForceBody' : 'updateBody', lang)}</Text>

          <TouchableOpacity style={s.primary} onPress={onUpdate} activeOpacity={0.85}>
            <Text style={s.primaryText}>{t('updateCta', lang)}</Text>
          </TouchableOpacity>

          {!force && (
            <TouchableOpacity style={s.secondary} onPress={close} activeOpacity={0.7}>
              <Text style={s.secondaryText}>{t('updateLater', lang)}</Text>
            </TouchableOpacity>
          )}

          {force && !escapeOpen && (
            <TouchableOpacity style={s.secondary} onPress={() => setEscapeOpen(true)} activeOpacity={0.7}>
              <Text style={s.escapeLinkText}>{t('updateEmergencyLink', lang)}</Text>
            </TouchableOpacity>
          )}

          {force && escapeOpen && (
            <View style={s.escapeRows}>
              <TouchableOpacity style={s.escapeRow} onPress={onEmergency} activeOpacity={0.7}>
                <Ionicons name="call-outline" size={18} color={colors.textSecondary} />
                <Text style={s.escapeRowText}>{t('menuEmergency', lang)}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity style={s.escapeRow} onPress={onDuty} activeOpacity={0.7}>
                <Ionicons name="medkit-outline" size={18} color={colors.textSecondary} />
                <Text style={s.escapeRowText}>{t('coachDutyTitle', lang)}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  backdrop:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  card:           { backgroundColor: colors.cardBg, borderRadius: radius.xl, padding: 22, alignItems: 'center' },

  mascotWrap:     { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.tintServiceBg, alignItems: 'center', justifyContent: 'center', marginBottom: 14, ...shadow },
  mascot:         { width: 74, height: 74, borderRadius: 37 },

  title:          { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textAlign: 'center', marginBottom: 8 },
  body:           { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 6 },

  primary:        { alignSelf: 'stretch', marginTop: 10, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  primaryText:    { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
  secondary:      { alignSelf: 'stretch', paddingVertical: 10, alignItems: 'center' },
  secondaryText:  { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textSecondary },

  // Deliberately quieter than [Later]: regular weight, underlined, no button chrome. It must
  // read as a way out for somebody who needs one, not as a second CTA competing with Update.
  escapeLinkText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textDecorationLine: 'underline', textAlign: 'center' },

  escapeRows:     { alignSelf: 'stretch', marginTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  escapeRow:      { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.border },
  escapeRowText:  { flex: 1, fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
})
