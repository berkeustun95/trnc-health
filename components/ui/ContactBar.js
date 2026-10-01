import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, type, radii, press, TAP } from '../../constants/theme'
import { t } from '../../constants/i18n'
import { haptic } from './haptics'

// ONE contact row for every list card and detail screen (S3): replaces 8 hand-built
// call / WhatsApp / directions buttons. It owns only the LOOK. The URL each action opens
// stays built at the call site, unchanged, so a partner's tel:/wa.me/maps link is
// byte-identical before and after.
//
//   actions: [{ kind: 'call' | 'directions' | 'whatsapp' | 'web', onPress, label?, accessibilityLabel? }]
//
// Up to TWO actions: both labelled, equal width (labels may wrap to two lines, never mid-word).
// THREE: the first is labelled and the other two are 48pt icon-only buttons with their label as
// the screen-reader name — at 320dp two labelled buttons beside an icon leave "Get Directions"
// 56pt, which it cannot fit. At most CONTACT_MAX: a fourth contact belongs in an InfoRow (a
// website row) on the detail screen, never squeezed in here. Callers order by priority
// (call, directions first). Labels cap at 1.15 (1.0 below 350dp);
// labels:check measures every one in a card and in the sticky bar. WhatsApp is white on WhatsApp's own dark green #075E54 (7.67:1) — the old white on
// #25D366 was 1.98:1. Call is the primary; the rest are outlined.
export const CONTACT_KINDS = {
  call:       { icon: 'call',          labelKey: 'call',          style: 'primary' },
  directions: { icon: 'navigate',      labelKey: 'getDirections', style: 'outline' },
  whatsapp:   { icon: 'logo-whatsapp', label: 'WhatsApp',         style: 'whatsapp' },
  web:        { icon: 'globe-outline', labelKey: 'visitWebsite',  style: 'outline' },
}
export const CONTACT_FONT_CAP = 1.15
export const CONTACT_FONT_CAP_NARROW = 1.0
export const CONTACT_GAP = 8
export const CONTACT_PAD = 10      // horizontal padding inside each button
export const CONTACT_ICON = 16
export const CONTACT_ICON_BTN = 48   // width of an icon-only action (3rd and later)
export const CONTACT_MAX = 3
export const labelledCount = n => (n <= 2 ? n : 1)
const WA = '#075E54'

export default function ContactBar({ actions = [], lang, style }) {
  const { width } = useWindowDimensions()
  const cap = width < 350 ? CONTACT_FONT_CAP_NARROW : CONTACT_FONT_CAP
  const valid = actions.filter(a => a && CONTACT_KINDS[a.kind] && a.onPress)
  if (__DEV__ && valid.length > CONTACT_MAX) console.warn(`ContactBar: ${valid.length} actions, max ${CONTACT_MAX} — move the rest into InfoRows`)
  const shown = valid.slice(0, CONTACT_MAX)
  if (!shown.length) return null
  const lab = labelledCount(shown.length)
  return (
    <View style={[s.row, style]}>
      {shown.map((a, i) => {
        const k = CONTACT_KINDS[a.kind]
        const iconOnly = i >= lab
        const label = a.label || k.label || t(k.labelKey, lang)
        const v = k.style
        const fg = v === 'outline' ? colors.primaryDark : '#FFFFFF'
        return (
          <TouchableOpacity key={a.kind} activeOpacity={press.small}
            onPress={() => { if (v !== 'outline') haptic(); a.onPress() }}
            accessibilityRole="button" accessibilityLabel={a.accessibilityLabel || label}
            style={[s.btn, iconOnly && s.iconOnly, v === 'primary' && s.primary, v === 'whatsapp' && s.whatsapp, v === 'outline' && s.outline]}>
            <Ionicons name={k.icon} size={iconOnly ? 20 : CONTACT_ICON} color={fg} />
            {!iconOnly && <Text style={[s.label, { color: fg }]} numberOfLines={2} maxFontSizeMultiplier={cap}>{label}</Text>}
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

const s = StyleSheet.create({
  row:      { flexDirection: 'row', gap: CONTACT_GAP },
  btn:      { flex: 1, minHeight: TAP, borderRadius: radii.md, paddingHorizontal: CONTACT_PAD,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 6 },
  iconOnly: { flex: 0, width: CONTACT_ICON_BTN, paddingHorizontal: 0 },
  primary:  { backgroundColor: colors.primary },
  whatsapp: { backgroundColor: WA },
  // fieldBorder boundary on white: 3.66:1 (1.4.11); label primaryDark 7.58:1.
  outline:  { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.fieldBorder },
  label:    { ...type.small, fontFamily: 'Inter_600SemiBold', flexShrink: 1, textAlign: 'center' },
})
