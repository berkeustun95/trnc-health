import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, type, radii, elevation, press, TAP } from '../../../constants/theme'
import { t } from '../../../constants/i18n'
import { IconButton } from '../../ui'

// Home's service section, top to bottom: CustomiseCard (once) · ServicesHeader · FavouritePanel ·
// AllServicesButton. All module level: HomeScreen re-renders constantly and a component defined
// inside it would remount on every render.

// One-time nudge to the Düzenle sheet. The body opens the sheet; the × only dismisses.
export function CustomiseCard({ lang, onOpen, onDismiss }) {
  return (
    <View style={[s.card, elevation.card]}>
      <TouchableOpacity style={s.cardBody} onPress={onOpen} activeOpacity={press.card}
        accessibilityRole="button" accessibilityLabel={`${t('homeCustomiseTitle', lang)}. ${t('homeCustomiseBody', lang)}`}>
        <View style={s.cardIcon}><Ionicons name="options-outline" size={20} color={colors.primaryDark} /></View>
        <View style={s.cardText}>
          <Text style={s.cardTitle} numberOfLines={2}>{t('homeCustomiseTitle', lang)}</Text>
          <Text style={s.cardLine} numberOfLines={3}>{t('homeCustomiseBody', lang)}</Text>
        </View>
      </TouchableOpacity>
      <IconButton icon="close" onPress={onDismiss} accessibilityLabel={t('homeCustomiseDismiss', lang)}
        color={colors.textSecondary} style={s.cardClose} />
    </View>
  )
}

// Not SectionHeader: that takes one action, this row has two links. Same row spacing and type.
export function ServicesHeader({ lang, onEdit, onSeeAll }) {
  return (
    <View style={s.head}>
      <View style={s.headTitleWrap}>
        <View style={s.dot} />
        <Text style={s.headTitle} numberOfLines={1} accessibilityRole="header">{t('homeServicesTitle', lang)}</Text>
      </View>
      <TouchableOpacity onPress={onEdit} activeOpacity={press.small} style={s.link}
        hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }} accessibilityRole="button"
        accessibilityLabel={`${t('favEdit', lang)}, ${t('homeServicesTitle', lang)}`}>
        <Text style={s.linkText} numberOfLines={1}>{t('favEdit', lang)}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onSeeAll} activeOpacity={press.small} style={s.link}
        hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }} accessibilityRole="button"
        accessibilityLabel={t('hrAllServices', lang)}>
        <Text style={s.linkText} numberOfLines={1}>{t('homeServicesSeeAll', lang)}</Text>
        <Ionicons name="chevron-forward" size={14} color={colors.primaryDark}
          accessible={false} importantForAccessibility="no" />
      </TouchableOpacity>
    </View>
  )
}

// Not components/ui Button: it has no outline variant.
// Outline pill. backgroundColor is explicit: Android draws borderRadius + borderWidth opaque otherwise.
export function AllServicesButton({ lang, count, onPress }) {
  const label = t('homeServicesAllButton', lang).replace('{n}', String(count))
  return (
    <TouchableOpacity style={s.pill} onPress={onPress} activeOpacity={press.small}
      accessibilityRole="button" accessibilityLabel={label}>
      <Text style={s.pillText} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  card:      { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: radii.card,
               marginTop: 16, paddingLeft: 14, paddingRight: 2, minHeight: 72 },
  cardBody:  { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, minHeight: TAP },
  cardIcon:  { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  cardText:  { flex: 1, flexShrink: 1 },
  cardTitle: { ...type.rowTitle, color: colors.textPrimary },
  cardLine:  { ...type.meta, color: colors.textSecondary, marginTop: 2 },
  cardClose: { alignSelf: 'center' },

  head:      { flexDirection: 'row', alignItems: 'center', marginTop: 24, marginBottom: 12, gap: 16 },
  headTitleWrap: { flex: 1, flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot:       { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  headTitle: { ...type.sectionHeading, color: colors.textPrimary, flexShrink: 1 },
  link:      { flexDirection: 'row', alignItems: 'center', flexShrink: 0, gap: 2 },
  linkText:  { ...type.small, fontFamily: 'Inter_600SemiBold', color: colors.primaryDark },

  pill:      { height: 48, marginTop: 12, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.primary,
               backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  pillText:  { ...type.rowTitle, color: colors.primaryDark, fontVariant: ['tabular-nums'] },
})
