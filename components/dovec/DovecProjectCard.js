import { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { RemoteImage } from '../ui'
import { colors, type, radii, elevation, press } from '../../constants/theme'
import { t } from '../../constants/i18n'
import { formatGbp, placeLine } from '../../constants/dovec'

export const COVER_ASPECT = 16 / 9
const fill = (text, k, v) => text.replace(`{${k}}`, () => String(v))

// The list card and the detail page hand Cover the SAME url string (project.cover_url, never re-encoded or rebuilt), so both ask
// expo-image for the same cache key. The grey box under the image is the loading placeholder on every path (expo-image and the
// legacy RN Image); a url that fails to load falls back to the no-cover icon instead of a blank box.
export function Cover({ url, width }) {
  const [failedUrl, setFailedUrl] = useState(null)
  const box = { width, height: Math.round(width / COVER_ASPECT) }
  if (!url || failedUrl === url) {
    return (
      <View style={[box, s.noCover]}>
        <Ionicons name="business-outline" size={36} color={colors.textSecondary} />
      </View>
    )
  }
  return (
    <View style={[box, s.noCover]}>
      <RemoteImage source={{ uri: url }} style={box} resizeMode="cover" onError={() => setFailedUrl(url)} accessibilityIgnoresInvertColors />
    </View>
  )
}

export function StatusChip({ status, lang }) {
  const sale = status === 'on_sale'
  return (
    <View style={[s.chip, sale ? s.chipSale : s.chipBuild]}>
      <Ionicons name={sale ? 'pricetag-outline' : 'construct-outline'} size={13} color={colors.primaryDark} />
      <Text style={s.chipText} numberOfLines={1}>{t(sale ? 'dovecStatusSale' : 'dovecStatusBuilding', lang)}</Text>
    </View>
  )
}

export const fromPriceText = (p, lang) => {
  const price = formatGbp(p.from_price)
  return price ? fill(t('dovecFrom', lang), 'price', price) : null
}

export const unitsText = (p, lang) =>
  typeof p.available_units === 'number' && p.available_units > 0 ? fill(t('dovecUnits', lang), 'n', p.available_units) : null

export default function DovecProjectCard({ project, lang, width, onPress }) {
  const place = placeLine(project)
  const price = fromPriceText(project, lang)
  const units = unitsText(project, lang)
  const label = [project.name, t(project.status === 'on_sale' ? 'dovecStatusSale' : 'dovecStatusBuilding', lang), place, price, units].filter(Boolean).join(', ')
  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={press.card} accessibilityRole="button" accessibilityLabel={label}>
      <Cover url={project.cover_url} width={width} />
      <View style={s.body}>
        <StatusChip status={project.status} lang={lang} />
        <Text style={s.title} numberOfLines={2}>{project.name}</Text>
        {!!place && <Text style={s.meta} numberOfLines={1}>{place}</Text>}
        {(!!price || !!units) && (
          <View style={s.foot}>
            {!!price && <Text style={s.price}>{price}</Text>}
            {!!units && <Text style={s.meta}>{units}</Text>}
          </View>
        )}
      </View>
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  card:     { backgroundColor: colors.card, borderRadius: radii.card, overflow: 'hidden', ...elevation.card },
  noCover:  { backgroundColor: colors.soft, alignItems: 'center', justifyContent: 'center' },
  body:     { padding: 16, gap: 6 },
  title:    { ...type.sectionHeading, color: colors.textPrimary },
  meta:     { ...type.small, color: colors.textSecondary },
  foot:     { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 12, rowGap: 2, marginTop: 4 },
  price:    { ...type.rowTitle, color: colors.primaryDark },
  chip:     { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill },
  chipSale: { backgroundColor: colors.primaryLight },
  chipBuild:{ backgroundColor: colors.soft },
  chipText: { ...type.meta, color: colors.primaryDark },
})
