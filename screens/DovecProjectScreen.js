import { View, Text, ScrollView, TouchableOpacity, Linking, StyleSheet, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { Button, Card, RemoteImage } from '../components/ui'
import DovecLogo from '../components/dovec/DovecLogo'
import { Cover, StatusChip, fromPriceText, unitsText } from '../components/dovec/DovecProjectCard'
import { colors, type, radii, press } from '../constants/theme'
import { t } from '../constants/i18n'
import { formatGbp, placeLine, deliveryLabel, galleryUrls, unitTypes, unitTypeLabel, dovecMapsUrl } from '../constants/dovec'

// One Döveç project. ADA owns the frame; the project's name, photos, text and prices are Döveç's own data, shown as synced.
// Deliberately NO Call / WhatsApp here: contact starts with the enquiry form (WhatsApp appears on its thank-you screen).
const GALLERY_H = 150

export default function DovecProjectScreen({ project, lang, onEnquire }) {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const place = placeLine(project)
  const price = fromPriceText(project, lang)
  const units = unitsText(project, lang)
  const delivery = deliveryLabel(project.planned_delivery_month, lang)
  const types = unitTypes(project)
  const gallery = galleryUrls(project.gallery)
  const mapsUrl = dovecMapsUrl(project)
  const description = typeof project.description === 'string' ? project.description.trim() : ''

  return (
    <View style={s.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 110 + insets.bottom }}>
        <Cover url={project.cover_url} width={width} />
        <View style={s.body}>
          <DovecLogo variant="navy" height={36} />
          <StatusChip status={project.status} lang={lang} />
          <Text style={s.title} accessibilityRole="header">{project.name}</Text>
          {!!place && (
            <View style={s.row}>
              <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
              <Text style={s.meta}>{place}</Text>
            </View>
          )}
          {!!price && <Text style={s.price}>{price}</Text>}
          {!!units && <Text style={s.meta}>{units}</Text>}
          {!!delivery && (
            <View style={s.row}>
              <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
              <Text style={s.meta}>{t('dovecDelivery', lang).replace('{date}', () => delivery)}</Text>
            </View>
          )}

          {types.length > 0 && (
            <Card style={s.block} padding={16}>
              <Text style={s.blockTitle} accessibilityRole="header">{t('dovecUnitTypes', lang)}</Text>
              {types.map((u, i) => {
                const p = formatGbp(u.from_price)
                return (
                  <View key={`${u.type}-${i}`} style={[s.unit, i > 0 && s.unitSep]}>
                    <Text style={s.unitType} numberOfLines={2}>{unitTypeLabel(u.type, lang, t)}</Text>
                    {!!p && <Text style={s.unitPrice}>{t('dovecFrom', lang).replace('{price}', () => p)}</Text>}
                  </View>
                )
              })}
            </Card>
          )}

          {!!description && (
            <Card style={s.block} padding={16}>
              <Text style={s.blockTitle} accessibilityRole="header">{t('dovecAbout', lang)}</Text>
              <Text style={s.desc}>{description}</Text>
            </Card>
          )}

          {gallery.length > 0 && (
            <View style={s.block}>
              <Text style={[s.blockTitle, s.galleryTitle]} accessibilityRole="header">{t('dovecGallery', lang)}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.gallery}>
                {gallery.map(u => (
                  <RemoteImage key={u} source={{ uri: u }} style={s.galleryImg} resizeMode="cover" accessibilityIgnoresInvertColors />
                ))}
              </ScrollView>
            </View>
          )}

          {!!mapsUrl && (
            <TouchableOpacity style={s.web} onPress={() => Linking.openURL(mapsUrl).catch(() => {})} activeOpacity={press.small}
              accessibilityRole="link" accessibilityLabel={t('dovecOpenMaps', lang)}>
              <Ionicons name="map-outline" size={18} color={colors.primary} />
              <Text style={s.webText}>{t('dovecOpenMaps', lang)}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={s.web} onPress={() => Linking.openURL(project.website_url).catch(() => {})} activeOpacity={press.small}
            accessibilityRole="link" accessibilityLabel={t('dovecWebsite', lang)}>
            <Ionicons name="open-outline" size={18} color={colors.primary} />
            <Text style={s.webText}>{t('dovecWebsite', lang)}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Button fullWidth title={t('dovecEnquire', lang)} icon="paper-plane-outline" onPress={onEnquire} />
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  root:       { flex: 1 },
  body:       { padding: 16, gap: 8 },
  title:      { ...type.detailTitle, color: colors.textPrimary },
  row:        { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meta:       { ...type.small, color: colors.textSecondary, flexShrink: 1 },
  price:      { ...type.sectionHeading, color: colors.primaryDark },
  block:      { marginTop: 8 },
  blockTitle: { ...type.rowTitle, color: colors.textPrimary, marginBottom: 8 },
  unit:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, minHeight: 44 },
  unitSep:    { borderTopWidth: 1, borderTopColor: colors.border },
  unitType:   { ...type.body, color: colors.textPrimary, flex: 1 },
  unitPrice:  { ...type.rowTitle, color: colors.primaryDark },
  desc:       { ...type.body, color: colors.textPrimary },
  galleryTitle: { marginBottom: 8 },
  gallery:    { gap: 10 },
  galleryImg: { width: Math.round(GALLERY_H * 16 / 9), height: GALLERY_H, borderRadius: radii.md },
  web:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48, marginTop: 8 },
  webText:    { ...type.rowTitle, color: colors.primary },
  bar:        { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12,
                backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border },
})
