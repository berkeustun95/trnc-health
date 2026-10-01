import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, type, radii, elevation, press } from '../../constants/theme'
import CategoryIcon from './CategoryIcon'
import ContactBar from './ContactBar'
import { useOnPhoto, OnPhotoContext } from './onPhoto'
import { CARD_BG } from './ModuleScreen'

// The equal list card (S3). Every non-partner directory row is this card: same structure,
// same height rhythm, no visual ranking beyond the list's own sort (Berke: duty pharmacies
// are equal cards, distance sort only). Partner cards may pass `accent` (their agreed accent
// border) — they keep their own order and brand; this card never reorders anything.
//
//   leading:  { icon, category } | { uri } | { source }   (photo thumb 64pt, or category icon)
//   meta:     [{ icon, text, tone? }]  small facts (distance, hours, district); tone 'ok'|'warn'
//   badge:    short text chip top-right (e.g. "Açık", "Nöbetçi")
//   actions:  ContactBar actions (call / directions / whatsapp / web)
export default function ListCard({
  title, subtitle, leading, meta = [], badge, onPress, actions, lang, accent, accessibilityLabel, style, children,
}) {
  const onPhoto = useOnPhoto()   // on a module photo: 93% white (text stays ≥ 5.1:1)
  const lead = leading?.uri || leading?.source
    ? <Image source={leading.source || { uri: leading.uri }} style={s.thumb} resizeMode="cover" accessibilityIgnoresInvertColors />
    : leading?.icon ? <CategoryIcon icon={leading.icon} category={leading.category} size={48} /> : null
  const head = (
    <View style={s.head}>
      {lead}
      <View style={s.text}>
        <Text style={s.title} numberOfLines={2}>{title}</Text>
        {!!subtitle && <Text style={s.sub} numberOfLines={2}>{subtitle}</Text>}
        {meta.filter(m => m && m.text).length > 0 && (
          <View style={s.meta}>
            {meta.filter(m => m && m.text).map((m, i) => (
              <View key={i} style={s.metaItem}>
                {!!m.icon && <Ionicons name={m.icon} size={13} color={m.tone === 'warn' ? colors.dangerInk : m.tone === 'ok' ? colors.primaryDark : colors.textSecondary} />}
                <Text style={[s.metaText, m.tone === 'warn' && { color: colors.dangerInk }]} numberOfLines={1}>{m.text}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
      {!!badge && <View style={s.badge}><Text style={s.badgeText} numberOfLines={1}>{badge}</Text></View>}
    </View>
  )
  return (
    <View style={[s.card, onPhoto && { backgroundColor: CARD_BG }, accent && { borderWidth: 2, borderColor: accent }, style]}>
      {onPress ? (
        <TouchableOpacity onPress={onPress} activeOpacity={press.card} accessibilityRole="button"
          accessibilityLabel={accessibilityLabel || [title, subtitle, ...meta.map(m => m?.text)].filter(Boolean).join(', ')}>
          {head}
        </TouchableOpacity>
      ) : head}
      {onPhoto ? <OnPhotoContext.Provider value={false}>{children}</OnPhotoContext.Provider> : children}
      {!!actions && <ContactBar actions={actions} lang={lang} style={s.actions} />}
    </View>
  )
}

const s = StyleSheet.create({
  card:     { backgroundColor: colors.card, borderRadius: radii.card, padding: 14, ...elevation.card },
  head:     { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  thumb:    { width: 64, height: 64, borderRadius: radii.tile, backgroundColor: colors.border },
  text:     { flex: 1, gap: 2 },
  title:    { ...type.rowTitle, color: colors.textPrimary },
  sub:      { ...type.small, color: colors.textSecondary },
  meta:     { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4, marginTop: 4 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%' },
  metaText: { ...type.meta, color: colors.textSecondary, flexShrink: 1 },
  badge:    { backgroundColor: colors.primaryLight, borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 3, maxWidth: 110 },
  badgeText:{ ...type.caption, fontFamily: 'Inter_700Bold', color: colors.primaryDark },
  actions:  { marginTop: 12 },
})
