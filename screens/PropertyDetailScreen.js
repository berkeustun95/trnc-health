import { useState } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Image,
  FlatList, Dimensions, Linking, Platform,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { colors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'
import { REGION_LABEL_KEY } from '../constants/regions'
import { areaName } from '../constants/areas'
import BackButton from '../components/BackButton'

const { width: W } = Dimensions.get('window')
const GALLERY_H = Math.round(W * 3 / 4)   // 4:3 — the detail view can afford the height

const CURRENCIES = { GBP: '£', EUR: '€', USD: '$', TRY: '₺' }
const PERIOD_SUFFIX_KEY = {
  monthly: 'accomPerMonth', weekly: 'accomPerWeek',
  yearly:  'accomPerYear',  nightly: 'accomPerNight',
}

// TRNC deed vocabulary is DELIBERATELY NOT TRANSLATED, in any locale. These are legal
// terms of art; a literal rendering into Greek or Arabic could be actively wrong, and
// Greek in a Cyprus property context is loaded. Same convention as constants/areas.js,
// which treats area names as proper nouns identical in all nine locales.
const DEED_LABEL = {
  turkish:    'Türk koçanı',
  exchange:   'Eşdeğer',
  foreign:    'Yabancı koçan',
  allocation: 'Tahsis',
  tmd:        'TMD',
}

function priceDisplay(price, currency, period, lang) {
  if (price == null) return null
  const sym = CURRENCIES[currency] || currency
  const formatted = Number(price).toLocaleString('en-GB', { maximumFractionDigits: 0 })
  const key = PERIOD_SUFFIX_KEY[period]
  return `${sym}${formatted}${key ? t(key, lang) : ''}`
}

function typeLabel(type, lang) {
  const map = {
    apartment: t('accomTypeApartment', lang), villa: t('accomTypeVilla', lang),
    studio: t('accomTypeStudio', lang),       house: t('accomTypeHouse', lang),
    land: t('accomTypeLand', lang),           commercial: t('accomTypeCommercial', lang),
  }
  return map[type] || type
}

function intentLabel(intent, lang) {
  if (intent === 'rent')       return t('accomRent', lang)
  if (intent === 'sale')       return t('accomSale', lang)
  if (intent === 'short_term') return t('accomShortTerm', lang)
  return intent
}

const districtLabel = (d, lang) => (REGION_LABEL_KEY[d] ? t(REGION_LABEL_KEY[d], lang) : d)

// Amenity slugs come from the partner's vocabulary and are NOT a controlled set — the
// column has no CHECK by design. Anything unmapped is shown de-slugged rather than
// dropped, so a new feature from the feed degrades to readable text instead of vanishing.
function amenityLabel(slug) {
  return String(slug).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ─── One key fact ────────────────────────────────────────────────────────────
// Rendered ONLY when value is non-empty. The caller decides presence with `!= null`,
// never truthiness: floor is 0 for a ground-floor listing and gated_community is a real
// false. A `0` or an em-dash placeholder would be a claim we cannot support — an absent
// row is honest, a filled-in zero is a lie.
function Fact({ label, value }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <View style={ds.fact}>
      <Text style={ds.factLabel}>{label}</Text>
      <Text style={ds.factValue}>{value}</Text>
    </View>
  )
}

export default function PropertyDetailScreen({ property: prop, lang, onBack, onOpenMap }) {
  const insets = useSafeAreaInsets()
  const [imgIdx, setImgIdx] = useState(0)

  // is_primary first, then sort_order — the same rule the card uses.
  const images = [...(prop.property_images || [])].sort((a, b) => {
    if (!!a.is_primary !== !!b.is_primary) return a.is_primary ? -1 : 1
    return (a.sort_order ?? 0) - (b.sort_order ?? 0)
  })

  const agency  = prop.estate_agencies
  const isRent  = prop.intent === 'rent' || prop.intent === 'short_term'
  const place   = [districtLabel(prop.district, lang), prop.area ? areaName(prop.area, prop.district) : null]
                    .filter(Boolean).join(' · ')

  const rooms = (prop.bedrooms != null && prop.living_rooms != null)
    ? `${prop.bedrooms}+${prop.living_rooms}`
    : (prop.bedrooms != null ? String(prop.bedrooms) : null)

  const floorText = (prop.floor != null && prop.total_floors != null)
    ? `${prop.floor} / ${prop.total_floors}`
    : (prop.floor != null ? String(prop.floor) : null)

  // Link out rather than embed a translation SDK: no new dependency, no API key, no
  // provider decision, and nothing is stored — descriptions stay in source language.
  function translateDescription() {
    if (!prop.description) return
    const url = 'https://translate.google.com/?sl=auto&tl=' + encodeURIComponent(lang === 'Turkish' ? 'tr' : 'en')
      + '&text=' + encodeURIComponent(prop.description) + '&op=translate'
    Linking.openURL(url)
  }

  // BUG 4. The predecessor rendered this chip whenever latitude was set and wired it to
  // an onOpenMap prop that App.js never passed, so tapping it did nothing at all. It now
  // opens the platform map directly and treats a host-supplied handler as an override,
  // so the affordance cannot go dead again by someone forgetting to thread a prop.
  function openMap() {
    if (prop.latitude == null || prop.longitude == null) return
    if (onOpenMap) {
      onOpenMap({ latitude: prop.latitude, longitude: prop.longitude,
                  title: prop.title, approximate: prop.location_precision === 'area' })
      return
    }
    const label = encodeURIComponent(prop.title || '')
    const ll = `${prop.latitude},${prop.longitude}`
    Linking.openURL(Platform.OS === 'ios'
      ? `https://maps.apple.com/?ll=${ll}&q=${label}`
      : `geo:${ll}?q=${ll}(${label})`)
  }

  const phone    = agency?.contact_phone
  const whatsapp = agency?.contact_whatsapp
  function call()     { if (phone)    Linking.openURL(`tel:${phone}`) }
  function whatsApp() { if (whatsapp) Linking.openURL(`https://wa.me/${whatsapp.replace(/\D/g, '')}`) }

  return (
    <SafeAreaView style={ds.safe} edges={['top']}>
      <BackButton variant="hero" lang={lang} onPress={onBack} style={[ds.backBtn, { top: insets.top + 8 }]} />

      <ScrollView showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}>

        {images.length > 0 ? (
          <View>
            <FlatList
              data={images} horizontal pagingEnabled showsHorizontalScrollIndicator={false}
              keyExtractor={i => i.id}
              onMomentumScrollEnd={e => setImgIdx(Math.round(e.nativeEvent.contentOffset.x / W))}
              renderItem={({ item }) => (
                <Image source={{ uri: item.url }} style={ds.galleryImg} resizeMode="cover" />
              )}
            />
            {images.length > 1 && (
              <View style={ds.galleryCounter}>
                <Text style={ds.galleryCounterText}>{imgIdx + 1} / {images.length}</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={ds.galleryPlaceholder}>
            <Ionicons name="home-outline" size={56} color={colors.border} />
          </View>
        )}

        <View style={ds.body}>
          {/* Title + price */}
          <View style={ds.badgeRow}>
            <View style={ds.typeBadge}><Text style={ds.typeBadgeText}>{typeLabel(prop.property_type, lang)}</Text></View>
            <View style={ds.intentBadge}><Text style={ds.intentBadgeText}>{intentLabel(prop.intent, lang)}</Text></View>
          </View>
          <Text style={ds.title}>{prop.title}</Text>
          <Text style={ds.price}>{priceDisplay(prop.price, prop.currency, prop.price_period, lang)}</Text>

          {/* Location + reference number */}
          <View style={ds.locRow}>
            {!!place && <>
              <Ionicons name="location-outline" size={15} color={colors.primary} />
              <Text style={ds.locText}>{place}</Text>
            </>}
            {prop.external_id != null && (
              <Text style={ds.refNo}>{t('accomRefNo', lang)} {prop.external_id}</Text>
            )}
          </View>
          {!!prop.development_name && <Text style={ds.devName}>{prop.development_name}</Text>}

          {/* ── Key facts. Every row self-hides when its value is absent. ── */}
          <View style={ds.divider} />
          <Text style={ds.sectionLabel}>{t('accomKeyFacts', lang)}</Text>
          <View style={ds.factGrid}>
            <Fact label={t('accomRooms', lang)}       value={rooms} />
            <Fact label={t('accomBaths', lang)}       value={prop.bathrooms != null ? String(prop.bathrooms) : null} />
            <Fact label={t('accomEnsuite', lang)}     value={prop.ensuite_count != null ? String(prop.ensuite_count) : null} />
            <Fact label={t('accomGrossArea', lang)}   value={prop.area_sqm != null ? `${prop.area_sqm} m²` : null} />
            <Fact label={t('accomNetArea', lang)}     value={prop.net_area_sqm != null ? `${prop.net_area_sqm} m²` : null} />
            <Fact label={t('accomPlot', lang)}        value={prop.plot_sqm != null ? `${Number(prop.plot_sqm).toLocaleString('en-GB')} m²` : null} />
            <Fact label={t('accomFloor', lang)}       value={floorText} />
            {/* building_age_band is a TEXT BAND ("6 - 10"). Rendered verbatim — never
                parsed, never cast, never turned into a number. */}
            <Fact label={t('accomBuildingAge', lang)} value={prop.building_age_band} />
            <Fact label={t('accomDeedType', lang)}    value={prop.deed_type ? (DEED_LABEL[prop.deed_type] || prop.deed_type) : null} />
            <Fact label={t('accomGated', lang)}       value={prop.gated_community != null ? (prop.gated_community ? t('accomYes', lang) : t('accomNo', lang)) : null} />
            <Fact label={t('accomSwap', lang)}        value={prop.swap_available} />
            <Fact label={t('accomFilterFurnished', lang)} value={prop.furnished != null ? (prop.furnished ? t('accomFurnished', lang) : t('accomUnfurnished', lang)) : null} />
            {/* Rent-only facts. Hidden entirely on a sale listing. */}
            {isRent && <Fact label={t('accomDeposit', lang)} value={prop.deposit != null ? priceDisplay(prop.deposit, prop.deposit_currency || prop.currency, null, lang) : null} />}
            {isRent && <Fact label={t('accomMinTerm', lang)} value={prop.min_term_months != null ? `${prop.min_term_months} ${t('accomMonths', lang)}` : null} />}
            {isRent && <Fact label={t('accomBills', lang)}   value={prop.bills_included} />}
          </View>

          {/* Description */}
          {!!prop.description && (
            <>
              <View style={ds.divider} />
              <View style={ds.descHead}>
                <Text style={ds.sectionLabel}>{t('accomDescription', lang)}</Text>
                <TouchableOpacity style={ds.translateBtn} onPress={translateDescription}>
                  <Ionicons name="language-outline" size={14} color={colors.primary} />
                  <Text style={ds.translateText}>{t('accomTranslate', lang)}</Text>
                </TouchableOpacity>
              </View>
              <Text style={ds.description}>{prop.description}</Text>
              <Text style={ds.translateNote}>{t('accomTranslateNote', lang)}</Text>
            </>
          )}

          {/* Features */}
          {Array.isArray(prop.amenities) && prop.amenities.length > 0 && (
            <>
              <View style={ds.divider} />
              <Text style={ds.sectionLabel}>{t('accomFeatures', lang)}</Text>
              <View style={ds.amenityWrap}>
                {prop.amenities.map(a => (
                  <View key={a} style={ds.amenityChip}>
                    <Ionicons name="checkmark" size={13} color={colors.primary} />
                    <Text style={ds.amenityText}>{amenityLabel(a)}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* ── Map honesty ──────────────────────────────────────────────────
              The source withholds exact coordinates and states so outright. Three
              distinct states, and none of them is a dead chip:
                • coordinates + precision 'area' -> map offered, LABELLED approximate
                • coordinates + precision 'exact' -> map offered plainly
                • no coordinates                 -> the area name, and NO map affordance
              The old screen rendered a "View on map" chip whenever latitude was set and
              never wired it up, so it did nothing when tapped. */}
          {(prop.latitude != null && prop.longitude != null) ? (
            <>
              <View style={ds.divider} />
              <Text style={ds.sectionLabel}>{t('accomFilterArea', lang)}</Text>
              {prop.location_precision === 'area' && (
                <View style={ds.approxBox}>
                  <Ionicons name="information-circle-outline" size={16} color={colors.accent} />
                  <View style={{ flex: 1 }}>
                    <Text style={ds.approxTitle}>{t('accomApproxArea', lang)}</Text>
                    <Text style={ds.approxSub}>{t('accomApproxAreaSub', lang)}</Text>
                  </View>
                </View>
              )}
              <TouchableOpacity style={ds.mapBtn} onPress={openMap}>
                <Ionicons name="map-outline" size={16} color={colors.primary} />
                <Text style={ds.mapBtnText}>{t('accomViewOnMap', lang)}</Text>
              </TouchableOpacity>
            </>
          ) : !!place && (
            <>
              <View style={ds.divider} />
              <Text style={ds.sectionLabel}>{t('accomFilterArea', lang)}</Text>
              <View style={ds.approxBox}>
                <Ionicons name="information-circle-outline" size={16} color={colors.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={ds.approxTitle}>{place}</Text>
                  <Text style={ds.approxSub}>{t('accomApproxAreaSub', lang)}</Text>
                </View>
              </View>
            </>
          )}
        </View>
      </ScrollView>

      {/* ── Fixed contact bar ────────────────────────────────────────────────
          Pinned, always present, and NEVER shows a per-property agent. The agency
          name always renders; Call and WhatsApp appear only when their column is
          non-NULL — which today is never, since the real contact details are not set
          yet. So the honest current state is a bar naming the agency and offering
          nothing, rather than a dead button. */}
      <View style={[ds.contactBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={{ flex: 1 }}>
          <Text style={ds.contactLabel}>{t('accomContactTitle', lang)}</Text>
          <Text style={ds.contactName} numberOfLines={1}>
            {agency?.contact_name || agency?.name || '—'}
          </Text>
        </View>
        {!!phone && (
          <TouchableOpacity style={ds.callBtn} onPress={call}>
            <Ionicons name="call-outline" size={17} color="#fff" />
            <Text style={ds.callBtnText}>{t('accomCall', lang)}</Text>
          </TouchableOpacity>
        )}
        {!!whatsapp && (
          <TouchableOpacity style={ds.waBtn} onPress={whatsApp}>
            <Ionicons name="logo-whatsapp" size={17} color="#fff" />
            <Text style={ds.callBtnText}>{t('accomWhatsApp', lang)}</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  )
}

const ds = StyleSheet.create({
  safe:               { flex: 1, backgroundColor: colors.bg },
  backBtn:            { position: 'absolute', left: 16, zIndex: 10 },

  galleryImg:         { width: W, height: GALLERY_H },
  galleryPlaceholder: { width: W, height: GALLERY_H, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  galleryCounter:     { position: 'absolute', bottom: 12, right: 14, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.55)' },
  galleryCounterText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#fff' },

  body:               { padding: 20 },
  badgeRow:           { flexDirection: 'row', gap: 6, marginBottom: 10 },
  typeBadge:          { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: colors.surface },
  typeBadgeText:      { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase' },
  intentBadge:        { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: colors.primaryLight },
  intentBadgeText:    { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.3 },

  title:              { fontSize: 20, fontFamily: 'Inter_700Bold', color: colors.textPrimary, lineHeight: 27 },
  price:              { fontSize: 24, fontFamily: 'Inter_700Bold', color: colors.primary, marginTop: 8 },

  locRow:             { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 12, flexWrap: 'wrap' },
  locText:            { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  refNo:              { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  devName:            { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 4 },

  divider:            { height: 1, backgroundColor: colors.border, marginVertical: 20 },
  sectionLabel:       { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },

  factGrid:           { flexDirection: 'row', flexWrap: 'wrap' },
  fact:               { width: '50%', paddingVertical: 8, paddingRight: 12 },
  factLabel:          { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginBottom: 2 },
  factValue:          { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary },

  descHead:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  translateBtn:       { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: colors.primaryLight, marginBottom: 12 },
  translateText:      { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary },
  description:        { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 23 },
  translateNote:      { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 10, fontStyle: 'italic' },

  amenityWrap:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  amenityChip:        { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, backgroundColor: colors.surface },
  amenityText:        { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textPrimary },

  approxBox:          { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 14, borderRadius: 14, backgroundColor: colors.surface },
  approxTitle:        { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  approxSub:          { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 2, lineHeight: 17 },
  mapBtn:             { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12, paddingVertical: 12, borderRadius: 14, borderWidth: 1.5, borderColor: colors.primary },
  mapBtnText:         { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.primary },

  contactBar:         { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 12, backgroundColor: colors.cardBg, borderTopWidth: 1, borderTopColor: colors.border, ...shadow },
  contactLabel:       { fontSize: 10, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  contactName:        { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginTop: 1 },
  callBtn:            { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 11, borderRadius: 12, backgroundColor: colors.primary },
  waBtn:              { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 11, borderRadius: 12, backgroundColor: '#25D366' },
  callBtnText:        { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
})
