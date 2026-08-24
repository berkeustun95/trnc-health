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

// Scroll distance after which the gallery no longer sits behind the floating back button.
// Roughly the button's own height plus its top offset; exact to the pixel does not matter,
// the glyph only has to change before the photo leaves rather than after.
const CHEVRON_CLEAR = 110

// Clears the contact bar, which is now two rows (name, then buttons) rather than one.
const CONTACT_BAR_CLEARANCE = 150

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
  const [overPhoto, setOverPhoto] = useState(true)
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
      <ScrollView showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        // The floating back button is WHITE (hero) because it sits over the gallery
        // photo. Once the body scrolls under it that is white-on-white — see the note at
        // the button itself. Flip to the dark `bare` glyph at the moment the photo stops
        // being behind it. setState only on the transition, so this is two renders in the
        // life of the screen, not one per frame.
        onScroll={e => {
          const over = e.nativeEvent.contentOffset.y < GALLERY_H - CHEVRON_CLEAR
          setOverPhoto(prev => (prev === over ? prev : over))
        }}
        contentContainerStyle={{ paddingBottom: CONTACT_BAR_CLEARANCE }}>

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

      {/* ⚠ THE "BADGE DRAWN OVER THE CHEVRON" BUG WAS NEVER A Z-ORDER BUG.
          It was diagnosed as one first, and rendering this after the ScrollView (instead
          of before it, on zIndex:10) changed nothing visible — which is the evidence that
          the diagnosis was wrong, not that the fix failed.
          The real cause is COLOUR. `hero` draws a WHITE chevron with a soft dark halo,
          which is correct over the gallery photo. But this button floats and the body
          scrolls UNDER it, and the body is colors.bg #F7F8FA on a badge of colors.surface
          #FFFFFF — so a white glyph lands on white. Contrast 1:1, with only a 0.55-alpha
          blur to separate it. The badge reads crisp, the chevron reads as absent, and the
          eye calls that "behind".
          So it switches variant on scroll: `hero` (white, haloed) while the photo is
          behind it, `bare` (colors.textPrimary, no halo) once it is not.
          The paint-order form is kept because it is more robust than depending on zIndex
          across a ScrollView boundary — but it fixed nothing, and saying so here is the
          point. */}
      <BackButton variant={overPhoto ? 'hero' : 'bare'} lang={lang} onPress={onBack}
        style={[ds.backBtn, { top: insets.top + 8 }]} />

      {/* ── Fixed contact bar ────────────────────────────────────────────────
          Pinned, always present, and NEVER shows a per-property agent — the agency is
          the only attribution the product surfaces. Call and WhatsApp render only when
          their column is non-NULL, so an agency with no details shows its name and no
          dead buttons.
          ⚠ THE POPULATED BRANCH WENT UNEXERCISED FOR A WHOLE SLICE. These fields are
          fed by AccommodationScreen's estate_agencies embed — this screen receives
          `property` as a prop and never re-queries — and that embed did not select the
          three contact columns. It was invisible because the columns were NULL anyway:
          the empty state was built, shipped and verified on device while the populated
          state had never once run. The bug surfaced the moment real data arrived. */}
      <View style={[ds.contactBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        {/* THE AGENCY, NOT THE PERSON. Three reasons, in order of weight:
            1. A named individual half-undoes C2. The product decision is that NO
               per-property agent surfaces anywhere; a name pinned to the bottom of all 88
               listings reads exactly like the agent for all 88.
            2. A fixed string cannot truncate. The previous version showed contact_name and
               clipped at "Hüseyin Kamb…" — about the SHORTEST plausible Turkish name — so
               it was one staff change from clipping again. The agency name is ours and
               does not vary.
            3. The Coldwell Banker mark carries more credibility than a person's name.
            contact_name STAYS in the database: it is who the number reaches, and it may be
            wanted later. It is simply not rendered.

            LOGO WITH A TEXT FALLBACK, and the fallback is not a placeholder — it is a
            correct rendering of the same fact. logo_url is NULL today (the file is being
            requested from Novest), so this ships showing the agency name as text and
            starts showing the mark the moment the column is set, with no code change and
            no OTA. resizeMode="contain" so a wordmark of any aspect fits its box. */}
        {agency?.logo_url ? (
          <Image source={{ uri: agency.logo_url }} style={ds.contactLogo} resizeMode="contain"
            accessibilityLabel={agency?.name ?? ''} />
        ) : (
          <Text style={ds.contactName} numberOfLines={1}>{agency?.name || '—'}</Text>
        )}

        <View style={ds.contactBtnRow}>
          {!!phone && (
            // TONAL, not solid. WhatsApp's #25D366 is mandated by their brand guidelines
            // and cannot be quietened, so two solid saturated buttons of equal weight sat
            // at the bottom of every page fighting each other. Making Ara tonal — teal on
            // a teal tint — settles the hierarchy without touching the colour we are not
            // allowed to change. It is still unmistakably a button.
            <TouchableOpacity style={[ds.contactBtn, ds.callBtn]} onPress={call}>
              <Ionicons name="call-outline" size={17} color={colors.primaryDark} />
              <Text style={[ds.contactBtnText, ds.callBtnText]}>{t('accomCall', lang)}</Text>
            </TouchableOpacity>
          )}
          {!!whatsapp && (
            <TouchableOpacity style={[ds.contactBtn, ds.waBtn]} onPress={whatsApp}>
              <Ionicons name="logo-whatsapp" size={17} color="#fff" />
              <Text style={[ds.contactBtnText, ds.waBtnText]}>{t('accomWhatsApp', lang)}</Text>
            </TouchableOpacity>
          )}
        </View>
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

  // Column, not row: the name gets a full line of its own and can never be squeezed by
  // the buttons beside it.
  contactBar:         { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, gap: 10, backgroundColor: colors.cardBg, borderTopWidth: 1, borderTopColor: colors.border, ...shadow },
  contactName:        { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  // Height fixed, width free: a wordmark is much wider than it is tall, and `contain`
  // inside a fixed-height box gives every logo the same optical weight whatever its
  // aspect. alignSelf keeps it left-aligned rather than stretching to the bar's width.
  contactLogo:        { height: 26, width: '60%', alignSelf: 'flex-start' },
  contactBtnRow:      { flexDirection: 'row', gap: 10 },
  // flex:1 on both so they split the width evenly and neither depends on its label
  // length — Turkish 'Ara' and 'WhatsApp' are very different widths.
  contactBtn:         { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 12 },
  contactBtnText:     { fontSize: 14, fontFamily: 'Inter_700Bold' },
  // primaryDark, NOT primary, for the glyph and label: theme.js measures `primary` on
  // `primaryLight` at 4.44:1 — it scrapes AA and reads washed out. primaryDark is 6.71:1
  // on the same tint. The BORDER stays `primary`; that is a shape, not text.
  callBtn:            { backgroundColor: colors.primaryLight, borderWidth: 1.5, borderColor: colors.primary },
  callBtnText:        { color: colors.primaryDark },
  waBtn:              { backgroundColor: '#25D366' },
  waBtnText:          { color: '#fff' },
})
