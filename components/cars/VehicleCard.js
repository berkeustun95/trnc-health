import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { RemoteImage } from '../ui'
import { CARD_BG } from '../ui/ModuleScreen'
import { colors, category, type, radii, elevation, press } from '../../constants/theme'
import { t } from '../../constants/i18n'
import { REGION_LABEL_KEY } from '../../constants/regions'
import { areaName } from '../../constants/areas'
import {
  VEHICLE_BUCKET, FUEL_LABEL_KEY, GEARBOX_LABEL_KEY, INTENT_LABEL_KEY, carPrice, groupDigits, sortedImages,
} from '../../constants/cars'

// The one car card: the list (CarsScreen) and a dealer's stock (DealerScreen). Photo-led like the
// property card — a 64pt ListCard thumb would hide the one thing a car listing is judged by.

export const photoUrl = path => (path ? supabase.storage.from(VEHICLE_BUCKET).getPublicUrl(path).data.publicUrl : null)

const label = (map, code, lang) => (map[code] ? t(map[code], lang) : code)
export const fuelLabel = (code, lang) => label(FUEL_LABEL_KEY, code, lang)
export const gearboxLabel = (code, lang) => label(GEARBOX_LABEL_KEY, code, lang)

// "Girne · Alsancak": the district translated, the area a proper noun (constants/areas.js).
export function placeLabel(region, area, lang) {
  return [REGION_LABEL_KEY[region] ? t(REGION_LABEL_KEY[region], lang) : region, area ? areaName(area, region) : null]
    .filter(Boolean).join(' · ')
}

export const kmLabel = km => (km != null ? `${groupDigits(km)} km` : null)

export function priceLabel(car, lang) {
  const p = carPrice(car)
  if (!p) return null
  return car.intent === 'rent' ? `${p}${t('carsPerDay', lang)}` : p
}

export default function VehicleCard({ car, lang, onPress, showDealer = true }) {
  const { width } = useWindowDimensions()
  const photoH = Math.round((width - 32) * 0.6)
  const images = sortedImages(car.vehicle_images)
  const uri = photoUrl(images[0]?.storage_path)
  const title = `${car.make} ${car.model}`
  const specs = [kmLabel(car.km), fuelLabel(car.fuel, lang), gearboxLabel(car.gearbox, lang)].filter(Boolean).join(' · ')
  const place = placeLabel(car.region, car.area, lang)
  const price = priceLabel(car, lang)
  const dealer = showDealer ? car.dealers?.name : null
  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={press.card} accessibilityRole="button"
      accessibilityLabel={[title, String(car.year), price, specs, place].filter(Boolean).join(', ')}>
      <View style={{ height: photoH }}>
        {uri
          ? <RemoteImage source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />
          : <View style={[StyleSheet.absoluteFill, s.noPhoto]}><Ionicons name="car-outline" size={44} color={category.city.ink} /></View>}
        <View pointerEvents="none" style={[s.intent, car.intent === 'rent' && s.intentRent]}>
          <Text style={s.intentText}>{t(INTENT_LABEL_KEY[car.intent] || 'carsSale', lang)}</Text>
        </View>
        {!!price && (
          <View pointerEvents="none" style={s.price}>
            <Text style={s.priceText} numberOfLines={1}>{price}</Text>
          </View>
        )}
        {images.length > 1 && (
          <View pointerEvents="none" style={s.count}>
            <Ionicons name="images-outline" size={12} color="#fff" />
            <Text style={s.countText}>{images.length}</Text>
          </View>
        )}
      </View>
      <View style={s.body}>
        <View style={s.titleRow}>
          <Text style={s.title} numberOfLines={1}>{title}</Text>
          <Text style={s.year}>{car.year}</Text>
        </View>
        {!!specs && <Text style={s.specs} numberOfLines={1}>{specs}</Text>}
        {(!!place || !!dealer) && (
          <View style={s.placeRow}>
            {!!place && <>
              <Ionicons name="location-outline" size={13} color={colors.textSecondary} />
              <Text style={s.place} numberOfLines={1}>{place}</Text>
            </>}
            {!!dealer && <Text style={s.dealer} numberOfLines={1}>{dealer}</Text>}
          </View>
        )}
      </View>
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  card:       { backgroundColor: CARD_BG, borderRadius: radii.card, marginBottom: 12, overflow: 'hidden', ...elevation.card },
  noPhoto:    { backgroundColor: category.city.bg, alignItems: 'center', justifyContent: 'center' },
  intent:     { position: 'absolute', top: 12, left: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill,
                backgroundColor: colors.primary },
  intentRent: { backgroundColor: category.explore.ink },
  intentText: { ...type.meta, fontFamily: 'Inter_700Bold', color: '#fff' },
  price:      { position: 'absolute', left: 12, bottom: 12, maxWidth: '70%', paddingHorizontal: 12, paddingVertical: 6,
                borderRadius: radii.pill, backgroundColor: 'rgba(0,0,0,0.68)' },
  priceText:  { ...type.rowTitle, fontFamily: 'Inter_700Bold', color: '#fff' },
  count:      { position: 'absolute', right: 12, bottom: 12, flexDirection: 'row', alignItems: 'center', gap: 4,
                paddingHorizontal: 9, paddingVertical: 4, borderRadius: radii.pill, backgroundColor: 'rgba(0,0,0,0.6)' },
  countText:  { ...type.meta, fontFamily: 'Inter_700Bold', color: '#fff' },
  body:       { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, gap: 4 },
  titleRow:   { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  title:      { flex: 1, ...type.rowTitle, fontSize: 16, color: colors.textPrimary },
  year:       { ...type.small, fontFamily: 'Inter_700Bold', color: colors.primaryDark },
  specs:      { ...type.small, color: colors.textSecondary },
  placeRow:   { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  place:      { flex: 1, ...type.meta, color: colors.textSecondary },
  dealer:     { ...type.caption, fontFamily: 'Inter_700Bold', color: colors.primaryDark, maxWidth: '45%' },
})
