import { useState } from 'react'
import { View, Text, FlatList, ScrollView, Pressable, Modal, StyleSheet, Linking, useWindowDimensions } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { IconButton, InfoRow, ContactBar, RemoteImage, PageCanvas } from '../components/ui'
import SplashStatusBar from '../components/SplashStatusBar'
import { photoUrl, placeLabel, priceLabel, kmLabel, fuelLabel, gearboxLabel } from '../components/cars/VehicleCard'
import { colors, category as CAT, type, radii, elevation, TAP } from '../constants/theme'
import { t } from '../constants/i18n'
import { logContactEvent } from '../utils/logContactEvent'
import {
  BODY_LABEL_KEY, COLOUR_LABEL_KEY, STEERING_LABEL_KEY, INTENT_LABEL_KEY, sortedImages, carContact, telUrl, waUrl, contactRegion,
} from '../constants/cars'

// One car. PropertyDetailRedesign's shape (photo gallery, white sheet over it, sticky contact bar)
// rather than DetailScaffold, which takes a single photo: a car listing is judged by its gallery.
// Ara / WhatsApp use the listing's own numbers, falling back to the dealer's (carContact).

const PHOTO_ASPECT = 4 / 3
const c = CAT.city
const photoCount = (lang, n, total) => t('carsPhotoCount', lang).replace('{n}', String(n)).replace('{total}', String(total))

function Gallery({ uris, width, lang, onOpen }) {
  const [idx, setIdx] = useState(0)
  const h = Math.round(width / PHOTO_ASPECT)
  if (uris.length === 0) {
    return <View style={[s.ground, { width, height: h }]}><Ionicons name="car-outline" size={64} color={c.ink} /></View>
  }
  return (
    <View style={{ width, height: h }}>
      <FlatList
        data={uris} keyExtractor={u => u}
        horizontal pagingEnabled showsHorizontalScrollIndicator={false}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        initialNumToRender={2} windowSize={3} maxToRenderPerBatch={2}
        onMomentumScrollEnd={e => setIdx(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item, index }) => (
          <Pressable onPress={() => onOpen(index)} accessibilityRole="imagebutton" accessibilityLabel={photoCount(lang, index + 1, uris.length)}>
            <RemoteImage source={{ uri: item }} style={{ width, height: h }} resizeMode="cover" />
          </Pressable>
        )}
      />
      {uris.length > 1 && (
        <View pointerEvents="none" style={s.counter}>
          <Ionicons name="images-outline" size={12} color="#fff" />
          <Text style={s.counterText}>{idx + 1} / {uris.length}</Text>
        </View>
      )}
    </View>
  )
}

// Full screen, black, every photo whole. Android back closes it through onRequestClose (a Modal is
// its own native window, outside the addBackListener chain); iOS closes it with the button.
function PhotoViewer({ uris, start, lang, onClose }) {
  return (
    <Modal visible={start != null} animationType="fade" onRequestClose={onClose} statusBarTranslucent supportedOrientations={['portrait']}>
      {start != null && <ViewerBody uris={uris} start={start} lang={lang} onClose={onClose} />}
    </Modal>
  )
}

// Mounted per opening, so it starts at the photo that was tapped.
function ViewerBody({ uris, start, lang, onClose }) {
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const [idx, setIdx] = useState(start)
  return (
    <View style={s.viewer}>
      <StatusBar style="light" />
      <FlatList
        data={uris} keyExtractor={u => u}
        horizontal pagingEnabled showsHorizontalScrollIndicator={false}
        initialScrollIndex={start}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        initialNumToRender={1} windowSize={3} maxToRenderPerBatch={2}
        onMomentumScrollEnd={e => setIdx(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item, index }) => (
          <RemoteImage source={{ uri: item }} style={{ width, height }} resizeMode="contain" placeholderColor="transparent"
            accessible accessibilityLabel={photoCount(lang, index + 1, uris.length)} />
        )}
      />
      <View style={[s.viewerBar, { top: insets.top + 8 }]}>
        <View style={s.viewerCount}><Text style={s.viewerCountText}>{idx + 1} / {uris.length}</Text></View>
        <Pressable style={s.viewerClose} onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('uiClose', lang)}>
          <Ionicons name="close" size={22} color="#FFFFFF" />
        </Pressable>
      </View>
    </View>
  )
}

function Fact({ label, value }) {
  return (
    <View style={s.fact}>
      <Text style={s.factLabel}>{label}</Text>
      <Text style={s.factValue}>{value}</Text>
    </View>
  )
}

export default function CarDetailScreen({ car, lang, onBack, onOpenDealer }) {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const [viewerAt, setViewerAt] = useState(null)
  if (!car) return null

  const uris = sortedImages(car.vehicle_images).map(i => photoUrl(i.storage_path)).filter(Boolean)
  const dealer = car.dealers || null
  const { phone, whatsapp } = carContact(car)
  const place = placeLabel(car.region, car.area, lang)
  const label = (map, code) => (map[code] ? t(map[code], lang) : code)

  // Logged on the line BEFORE the link (fire-and-forget, cannot throw): a metrics failure never costs the call.
  const call = () => { logContactEvent('cars', car.id, 'call', contactRegion(car.region)); Linking.openURL(telUrl(phone)).catch(() => {}) }
  const openWhatsApp = () => { logContactEvent('cars', car.id, 'whatsapp', contactRegion(car.region)); Linking.openURL(waUrl(whatsapp)).catch(() => {}) }
  const actions = [
    phone && { kind: 'call', onPress: call, accessibilityLabel: `${t('call', lang)} ${phone}` },
    whatsapp && { kind: 'whatsapp', onPress: openWhatsApp },
  ].filter(Boolean)

  const facts = [
    [t('carsYear', lang), String(car.year)],
    [t('carsKm', lang), kmLabel(car.km)],
    [t('carsFuel', lang), fuelLabel(car.fuel, lang)],
    [t('carsGearbox', lang), gearboxLabel(car.gearbox, lang)],
    [t('carsBody', lang), label(BODY_LABEL_KEY, car.body_type)],
    [t('carsColour', lang), label(COLOUR_LABEL_KEY, car.colour)],
    [t('carsSteering', lang), label(STEERING_LABEL_KEY, car.steering)],
  ].filter(f => f[1])

  const barH = 10 + (actions.length ? TAP : 20) + 10
  return (
    <PageCanvas flat>
      <SafeAreaView style={s.root} edges={['top']}>
        <SplashStatusBar style="dark" />
        <View style={{ flex: 1 }}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: barH + Math.max(insets.bottom, 12) + 16 }}>
            <Gallery uris={uris} width={width} lang={lang} onOpen={setViewerAt} />

            <View style={s.sheet}>
              <View style={s.tagRow}>
                <View style={[s.tag, { backgroundColor: car.intent === 'rent' ? CAT.explore.bg : colors.primaryLight }]}>
                  <Text style={[s.tagText, { color: car.intent === 'rent' ? CAT.explore.ink : colors.primaryDark }]}>{label(INTENT_LABEL_KEY, car.intent)}</Text>
                </View>
                {/* Steering up front: TRNC drives on the left, so a left-hand-drive import is a deciding fact, not a footnote. */}
                <View style={[s.tag, { backgroundColor: c.bg }]}>
                  <Ionicons name="car-sport-outline" size={13} color={c.ink} />
                  <Text style={[s.tagText, { color: c.ink }]}>{label(STEERING_LABEL_KEY, car.steering)}</Text>
                </View>
              </View>
              <Text style={s.title} accessibilityRole="header">{car.make} {car.model}</Text>
              <Text style={s.subtitle}>{[String(car.year), kmLabel(car.km)].filter(Boolean).join(' · ')}</Text>
              {!!priceLabel(car, lang) && <Text style={s.price}>{priceLabel(car, lang)}</Text>}

              <Text style={s.section}>{t('carsSpecs', lang)}</Text>
              <View style={s.factGrid}>
                {facts.map(([l, v]) => <Fact key={l} label={l} value={v} />)}
              </View>

              {!!car.description && (
                <>
                  <Text style={s.section}>{t('carsDescription', lang)}</Text>
                  <Text style={s.description}>{car.description}</Text>
                </>
              )}

              <View style={s.rows}>
                <InfoRow icon="location-outline" category="city" label={t('carsLocation', lang)} value={place} divider={!!dealer} />
                {!!dealer && (
                  <InfoRow icon="storefront-outline" category="city" label={t(dealer.is_rental_company ? 'carsRentalCompany' : 'carsDealer', lang)}
                    value={dealer.name} onPress={() => onOpenDealer(dealer)} divider={false} />
                )}
              </View>
            </View>
          </ScrollView>

          <View style={s.topBar} pointerEvents="box-none">
            <IconButton icon="chevron-back" variant="frosted" onPress={onBack} accessibilityLabel={t('back', lang)} />
          </View>

          <View style={[s.sticky, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            {actions.length
              ? <ContactBar actions={actions} lang={lang} />
              : <Text style={s.noContact}>{t('carsNoContact', lang)}</Text>}
          </View>
        </View>
      </SafeAreaView>
      <PhotoViewer uris={uris} start={viewerAt} lang={lang} onClose={() => setViewerAt(null)} />
    </PageCanvas>
  )
}

const s = StyleSheet.create({
  root:        { flex: 1 },
  ground:      { alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg },
  counter:     { position: 'absolute', bottom: 40, right: 14, flexDirection: 'row', alignItems: 'center', gap: 4,
                 paddingHorizontal: 9, paddingVertical: 4, borderRadius: radii.pill, backgroundColor: 'rgba(0,0,0,0.6)' },
  counterText: { ...type.meta, fontFamily: 'Inter_700Bold', color: '#fff' },
  sheet:       { marginTop: -28, backgroundColor: colors.card, borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet,
                 paddingHorizontal: 20, paddingTop: 20, minHeight: 300 },
  tagRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  tag:         { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4 },
  tagText:     { ...type.meta, fontFamily: 'Inter_700Bold' },
  title:       { ...type.detailTitle, color: colors.textPrimary },
  subtitle:    { ...type.body, color: colors.textSecondary, marginTop: 2 },
  price:       { ...type.sectionHeading, fontSize: 22, lineHeight: 28, color: colors.primaryDark, marginTop: 8 },
  section:     { ...type.sectionHeading, color: colors.textPrimary, marginTop: 24, marginBottom: 10 },
  factGrid:    { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: colors.soft, borderRadius: radii.tile, padding: 6 },
  fact:        { width: '50%', paddingVertical: 8, paddingHorizontal: 8 },
  factLabel:   { ...type.meta, color: colors.textSecondary },
  factValue:   { ...type.rowTitle, color: colors.textPrimary, marginTop: 2 },
  description: { ...type.body, fontSize: 15, lineHeight: 23, color: colors.textPrimary },
  rows:        { marginTop: 16 },
  topBar:      { position: 'absolute', top: 8, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between' },
  sticky:      { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.card, paddingHorizontal: 16, paddingTop: 10,
                 borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider, ...elevation.floating },
  noContact:   { ...type.small, color: colors.textSecondary, textAlign: 'center', paddingVertical: 2 },
  viewer:      { flex: 1, backgroundColor: '#000' },
  viewerBar:   { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  viewerCount: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: 'rgba(255,255,255,0.16)' },
  viewerCountText: { ...type.small, fontFamily: 'Inter_700Bold', color: '#fff' },
  viewerClose: { width: TAP, height: TAP, borderRadius: TAP / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)' },
})
