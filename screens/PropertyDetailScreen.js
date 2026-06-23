import { useState, useEffect, useRef } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Image,
  FlatList, Dimensions, Linking, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons, Feather } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { colors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'

const { width: W } = Dimensions.get('window')
const GALLERY_H = 300

const CURRENCIES  = { GBP: '£', TRY: '₺', EUR: '€' }
const CURRENCY_NAMES = { GBP: 'British Pound', TRY: 'Turkish Lira', EUR: 'Euro' }
const ALL_CURRENCIES = ['GBP', 'EUR', 'TRY']

function intentLabel(intent, lang) {
  if (intent === 'rent')       return t('accomRent', lang)
  if (intent === 'sale')       return t('accomSale', lang)
  if (intent === 'short_term') return t('accomShortTerm', lang)
  return intent
}

function typeLabel(type, lang) {
  const map = {
    apartment: t('accomTypeApartment', lang), villa: t('accomTypeVilla', lang),
    studio: t('accomTypeStudio', lang),       house: t('accomTypeHouse', lang),
    land: t('accomTypeLand', lang),           commercial: t('accomTypeCommercial', lang),
  }
  return map[type] || type
}

function districtLabel(d, lang) {
  const map = {
    nicosia: t('accomDistrictNicosia', lang),     kyrenia: t('accomDistrictKyrenia', lang),
    famagusta: t('accomDistrictFamagusta', lang),  morphou: t('accomDistrictMorphou', lang),
    iskele: t('accomDistrictIskele', lang),
  }
  return map[d] || d
}

function priceDisplay(price, currency, period, lang) {
  const sym = CURRENCIES[currency] || currency
  const formatted = Number(price).toLocaleString('en-GB', { maximumFractionDigits: 0 })
  if (period === 'monthly') return `${sym}${formatted}${t('accomPerMonth', lang)}`
  if (period === 'nightly') return `${sym}${formatted}${t('accomPerNight', lang)}`
  return `${sym}${formatted}`
}

// ─── Currency Converter ──────────────────────────────────────────────────────

function CurrencyConverter({ price, currency, period, lang }) {
  const [rates, setRates]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(false)

  useEffect(() => {
    async function fetchRates() {
      try {
        const res  = await fetch(`https://open.er-api.com/v6/latest/${currency}`)
        const data = await res.json()
        if (data.result === 'success') setRates(data.rates)
        else setError(true)
      } catch {
        setError(true)
      } finally {
        setLoading(false)
      }
    }
    fetchRates()
  }, [currency])

  const sym = CURRENCIES[currency] || currency
  const formatted = Number(price).toLocaleString('en-GB', { maximumFractionDigits: 0 })
  const periodSuffix = period === 'monthly' ? t('accomPerMonth', lang)
    : period === 'nightly' ? t('accomPerNight', lang) : ''

  return (
    <View style={ds.converterBox}>
      <View style={ds.converterHeader}>
        <Ionicons name="swap-horizontal-outline" size={18} color={colors.primary} />
        <Text style={ds.converterTitle}>{t('accomCurrencyConverter', lang)}</Text>
      </View>
      <Text style={ds.converterListed}>
        {t('accomListedIn', lang)}: <Text style={ds.converterListedVal}>{sym}{formatted}{periodSuffix}</Text>
      </Text>
      {loading && <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: 8 }} />}
      {error && !loading && <Text style={ds.converterError}>Could not load live rates</Text>}
      {!loading && !error && rates && (
        <View style={ds.ratesGrid}>
          {ALL_CURRENCIES.filter(c => c !== currency).map(c => {
            const rate = rates[c]
            if (!rate) return null
            const converted = (Number(price) * rate).toLocaleString('en-GB', { maximumFractionDigits: 0 })
            return (
              <View key={c} style={ds.rateRow}>
                <Text style={ds.rateCurrency}>{CURRENCY_NAMES[c]}</Text>
                <Text style={ds.rateValue}>{CURRENCIES[c]}{converted}{periodSuffix}</Text>
              </View>
            )
          })}
        </View>
      )}
      {!loading && !error && (
        <Text style={ds.ratesNote}>{t('accomRatesNote', lang)}</Text>
      )}
    </View>
  )
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function PropertyDetailScreen({ property: prop, lang, onClose, onOpenMap }) {
  const [imgIdx, setImgIdx] = useState(0)
  const images = (prop.property_images || []).sort((a, b) => a.sort_order - b.sort_order)
  const agent  = prop.estate_agents
  const agency = agent?.estate_agencies

  useEffect(() => {
    // Increment view count without waiting
    supabase.from('properties').update({ view_count: (prop.view_count || 0) + 1 }).eq('id', prop.id)
  }, [prop.id])

  function callAgent() {
    if (agent?.phone) Linking.openURL(`tel:${agent.phone}`)
  }

  function whatsAppAgent() {
    if (!agent?.phone) return
    const num = agent.phone.replace(/\D/g, '')
    Linking.openURL(`https://wa.me/${num}`)
  }

  function openMapPin() {
    if (prop.latitude && prop.longitude) {
      onOpenMap?.({ latitude: prop.latitude, longitude: prop.longitude, title: prop.title })
    }
  }

  return (
    <SafeAreaView style={ds.safe} edges={['top']}>
      {/* Back button overlaid on gallery */}
      <TouchableOpacity style={ds.backBtn} onPress={onClose}>
        <Ionicons name="arrow-back" size={22} color="#fff" />
      </TouchableOpacity>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Image gallery */}
        {images.length > 0
          ? (
            <View>
              <FlatList
                data={images}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                keyExtractor={i => i.id}
                onMomentumScrollEnd={e => setImgIdx(Math.round(e.nativeEvent.contentOffset.x / W))}
                renderItem={({ item }) => (
                  <Image source={{ uri: item.url }} style={ds.galleryImg} resizeMode="cover" />
                )}
              />
              <View style={ds.galleryCounter}>
                <Text style={ds.galleryCounterText}>{imgIdx + 1} / {images.length}</Text>
              </View>
              <View style={ds.dotRow}>
                {images.map((_, i) => (
                  <View key={i} style={[ds.dot, i === imgIdx && ds.dotActive]} />
                ))}
              </View>
            </View>
          )
          : <View style={ds.galleryPlaceholder}><Ionicons name="home-outline" size={64} color={colors.border} /></View>
        }

        <View style={ds.body}>
          {/* Title + type + intent */}
          <View style={ds.titleRow}>
            <View style={ds.titleLeft}>
              <Text style={ds.title}>{prop.title}</Text>
              <View style={ds.badgeRow}>
                <View style={ds.typeBadge}>
                  <Text style={ds.typeBadgeText}>{typeLabel(prop.property_type, lang)}</Text>
                </View>
                <View style={[ds.intentBadge,
                  prop.intent === 'sale' && ds.intentBadgeSale,
                  prop.intent === 'short_term' && ds.intentBadgeShort]}>
                  <Text style={ds.intentBadgeText}>{intentLabel(prop.intent, lang)}</Text>
                </View>
              </View>
            </View>
            <View style={ds.priceBlock}>
              <Text style={ds.priceMain}>{priceDisplay(prop.price, prop.currency, prop.price_period, lang)}</Text>
            </View>
          </View>

          {/* Address */}
          {(prop.district || prop.address) && (
            <TouchableOpacity style={ds.addressRow} onPress={openMapPin} activeOpacity={prop.latitude ? 0.7 : 1}>
              <Ionicons name="location-outline" size={16} color={colors.primary} />
              <Text style={ds.addressText}>
                {[districtLabel(prop.district, lang), prop.address].filter(Boolean).join(' · ')}
              </Text>
              {prop.latitude != null && (
                <View style={ds.mapBtn}>
                  <Text style={ds.mapBtnText}>{t('accomViewOnMap', lang)}</Text>
                </View>
              )}
            </TouchableOpacity>
          )}

          <View style={ds.divider} />

          {/* Specs */}
          <View style={ds.specsGrid}>
            {prop.bedrooms   != null && <SpecItem icon="bed-outline"         label={`${prop.bedrooms} ${t('accomBeds', lang)}`} />}
            {prop.bathrooms  != null && <SpecItem icon="water-outline"       label={`${prop.bathrooms} ${t('accomBaths', lang)}`} />}
            {prop.area_sqm   != null && <SpecItem icon="expand-outline"      label={`${prop.area_sqm} m²`} />}
            {prop.furnished  != null && (
              <SpecItem icon="home-outline" label={prop.furnished ? t('accomFurnished', lang) : t('accomUnfurnished', lang)} />
            )}
          </View>

          {/* Description */}
          {prop.description ? (
            <>
              <View style={ds.divider} />
              <Text style={ds.sectionLabel}>{t('accomDescription', lang)}</Text>
              <Text style={ds.description}>{prop.description}</Text>
            </>
          ) : null}

          <View style={ds.divider} />

          {/* Currency converter */}
          <CurrencyConverter
            price={prop.price}
            currency={prop.currency}
            period={prop.price_period}
            lang={lang}
          />

          <View style={ds.divider} />

          {/* Agent card */}
          <Text style={ds.sectionLabel}>{t('accomContactAgent', lang)}</Text>
          <View style={ds.agentCard}>
            <View style={ds.agentCardInner}>
              {agent?.photo_url
                ? <Image source={{ uri: agent.photo_url }} style={ds.agentPhoto} />
                : <View style={[ds.agentPhoto, ds.agentPhotoPlaceholder]}><Ionicons name="person-outline" size={24} color={colors.textSecondary} /></View>
              }
              <View style={ds.agentInfo}>
                <Text style={ds.agentName}>{agent?.full_name || '—'}</Text>
                {agency?.name && <Text style={ds.agencyLink}>{agency.name}</Text>}
                {agent?.phone && <Text style={ds.agentPhone}>{agent.phone}</Text>}
              </View>
            </View>
            <View style={ds.contactBtns}>
              <TouchableOpacity style={ds.callBtn} onPress={callAgent}>
                <Ionicons name="call-outline" size={18} color="#fff" />
                <Text style={ds.callBtnText}>{t('accomCallAgent', lang)}</Text>
              </TouchableOpacity>
              {agent?.phone && (
                <TouchableOpacity style={ds.waBtn} onPress={whatsAppAgent}>
                  <Ionicons name="logo-whatsapp" size={18} color="#fff" />
                  <Text style={ds.waBtnText}>{t('accomWhatsApp', lang)}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Agency card (if agent belongs to one) */}
          {agency && (
            <>
              <View style={ds.divider} />
              <View style={ds.agencyCard}>
                {agency.logo_url
                  ? <Image source={{ uri: agency.logo_url }} style={ds.agencyLogo} resizeMode="contain" />
                  : <View style={[ds.agencyLogo, ds.agencyLogoPlaceholder]}><Ionicons name="business-outline" size={22} color={colors.textSecondary} /></View>
                }
                <View style={{ flex: 1 }}>
                  <Text style={ds.agencyName}>{agency.name}</Text>
                  {agency.address && <Text style={ds.agencyAddress}>{agency.address}</Text>}
                  {agency.phone && <Text style={ds.agencyPhone}>{agency.phone}</Text>}
                </View>
              </View>
            </>
          )}

          <View style={{ height: 40 }} />
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function SpecItem({ icon, label }) {
  return (
    <View style={ds.specItem}>
      <Ionicons name={icon} size={18} color={colors.primary} />
      <Text style={ds.specLabel}>{label}</Text>
    </View>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const ds = StyleSheet.create({
  safe:                  { flex: 1, backgroundColor: colors.bg },
  backBtn:               { position: 'absolute', top: 12, left: 16, zIndex: 10, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },

  galleryImg:            { width: W, height: GALLERY_H },
  galleryPlaceholder:    { width: W, height: GALLERY_H, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  galleryCounter:        { position: 'absolute', top: 12, right: 14, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.55)' },
  galleryCounterText:    { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#fff' },
  dotRow:                { position: 'absolute', bottom: 10, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 5 },
  dot:                   { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.5)' },
  dotActive:             { backgroundColor: '#fff', width: 18 },

  body:                  { padding: 20 },
  titleRow:              { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  titleLeft:             { flex: 1 },
  title:                 { fontSize: 20, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 8 },
  badgeRow:              { flexDirection: 'row', gap: 6 },
  typeBadge:             { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: colors.surface },
  typeBadgeText:         { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'capitalize' },
  intentBadge:           { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: colors.primaryLight },
  intentBadgeSale:       { backgroundColor: '#D1FAE5' },
  intentBadgeShort:      { backgroundColor: '#FEF3C7' },
  intentBadgeText:       { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.3 },
  priceBlock:            { alignItems: 'flex-end' },
  priceMain:             { fontSize: 20, fontFamily: 'Inter_700Bold', color: colors.primary },

  addressRow:            { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, flexWrap: 'wrap' },
  addressText:           { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  mapBtn:                { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 10, backgroundColor: colors.primaryLight },
  mapBtnText:            { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary },

  divider:               { height: 1, backgroundColor: colors.border, marginVertical: 20 },
  sectionLabel:          { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 14 },

  specsGrid:             { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  specItem:              { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.surface },
  specLabel:             { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary },

  description:           { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 22 },

  // converter
  converterBox:          { backgroundColor: colors.surface, borderRadius: 16, padding: 16, ...shadow },
  converterHeader:       { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  converterTitle:        { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.primary },
  converterListed:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginBottom: 12 },
  converterListedVal:    { fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  converterError:        { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.danger, marginTop: 4 },
  ratesGrid:             { gap: 10 },
  rateRow:               { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  rateCurrency:          { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  rateValue:             { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  ratesNote:             { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 10, textAlign: 'right' },

  // agent card
  agentCard:             { backgroundColor: colors.surface, borderRadius: 16, padding: 16, gap: 14, ...shadow },
  agentCardInner:        { flexDirection: 'row', alignItems: 'center', gap: 14 },
  agentPhoto:            { width: 56, height: 56, borderRadius: 28 },
  agentPhotoPlaceholder: { backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  agentInfo:             { flex: 1 },
  agentName:             { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  agencyLink:            { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.primary, marginTop: 2 },
  agentPhone:            { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 2 },
  contactBtns:           { flexDirection: 'row', gap: 10 },
  callBtn:               { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 12, backgroundColor: colors.primary },
  callBtnText:           { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
  waBtn:                 { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 12, backgroundColor: '#25D366' },
  waBtnText:             { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },

  // agency card
  agencyCard:            { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: 16, padding: 14 },
  agencyLogo:            { width: 52, height: 52, borderRadius: 10 },
  agencyLogoPlaceholder: { backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  agencyName:            { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  agencyAddress:         { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 2 },
  agencyPhone:           { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 1 },
})
