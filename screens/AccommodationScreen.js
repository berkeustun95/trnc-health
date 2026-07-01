import { useState, useEffect, useCallback, useRef } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
  TextInput, ScrollView, Image, Dimensions, Modal, Pressable,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons, Feather } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import PageBackground from '../components/PageBackground'
import ScreenHeader from '../components/ScreenHeader'
import { colors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'

const { width: SCREEN_W } = Dimensions.get('window')
const CARD_IMAGE_H = 220

const INTENTS    = ['all', 'rent', 'sale', 'short_term']
const DISTRICTS  = ['nicosia', 'kyrenia', 'famagusta', 'morphou', 'iskele']
const PROP_TYPES = ['apartment', 'villa', 'studio', 'house', 'land', 'commercial']
const CURRENCIES = { GBP: '£', TRY: '₺', EUR: '€' }
const SORT_OPTS  = ['newest', 'popular', 'price_asc', 'price_desc']

function intentLabel(intent, lang) {
  if (intent === 'rent')       return t('accomRent', lang)
  if (intent === 'sale')       return t('accomSale', lang)
  if (intent === 'short_term') return t('accomShortTerm', lang)
  return intent
}

function districtLabel(d, lang) {
  const map = {
    nicosia:   t('accomDistrictNicosia', lang),
    kyrenia:   t('accomDistrictKyrenia', lang),
    famagusta: t('accomDistrictFamagusta', lang),
    morphou:   t('accomDistrictMorphou', lang),
    iskele:    t('accomDistrictIskele', lang),
  }
  return map[d] || d
}

function typeLabel(type, lang) {
  const map = {
    apartment:  t('accomTypeApartment', lang),
    villa:      t('accomTypeVilla', lang),
    studio:     t('accomTypeStudio', lang),
    house:      t('accomTypeHouse', lang),
    land:       t('accomTypeLand', lang),
    commercial: t('accomTypeCommercial', lang),
  }
  return map[type] || type
}

function priceDisplay(price, currency, period, lang) {
  const sym = CURRENCIES[currency] || currency
  const formatted = Number(price).toLocaleString('en-GB', { maximumFractionDigits: 0 })
  if (period === 'monthly') return `${sym}${formatted}${t('accomPerMonth', lang)}`
  if (period === 'nightly') return `${sym}${formatted}${t('accomPerNight', lang)}`
  return `${sym}${formatted}`
}

// ─── Image Carousel ──────────────────────────────────────────────────────────

function ImageCarousel({ images }) {
  const [idx, setIdx] = useState(0)
  if (!images || images.length === 0) {
    return (
      <View style={cs.imagePlaceholder}>
        <Ionicons name="home-outline" size={48} color={colors.border} />
      </View>
    )
  }
  return (
    <View>
      <FlatList
        data={images}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={i => i.id}
        onMomentumScrollEnd={e => {
          setIdx(Math.round(e.nativeEvent.contentOffset.x / SCREEN_W))
        }}
        renderItem={({ item }) => (
          <Image source={{ uri: item.url }} style={cs.cardImage} resizeMode="cover" />
        )}
      />
      {images.length > 1 && (
        <View style={cs.dotRow}>
          {images.map((_, i) => (
            <View key={i} style={[cs.dot, i === idx && cs.dotActive]} />
          ))}
        </View>
      )}
    </View>
  )
}

// ─── Property Card ───────────────────────────────────────────────────────────

function PropertyCard({ item, lang, onPress }) {
  const agent  = item.estate_agents
  const agency = agent?.estate_agencies

  return (
    <TouchableOpacity style={cs.card} onPress={onPress} activeOpacity={0.92}>
      <View>
        <ImageCarousel images={item.property_images} />
        {/* Intent badge */}
        <View style={[cs.intentBadge, item.intent === 'sale' && cs.intentBadgeSale,
          item.intent === 'short_term' && cs.intentBadgeShort]}>
          <Text style={cs.intentBadgeText}>{intentLabel(item.intent, lang)}</Text>
        </View>
        {/* Price badge */}
        <View style={cs.priceBadge}>
          <Text style={cs.priceBadgeText}>
            {priceDisplay(item.price, item.currency, item.price_period, lang)}
          </Text>
        </View>
      </View>

      {/* Agent row */}
      <View style={cs.agentRow}>
        <View style={cs.agentLogoWrap}>
          {agency?.logo_url
            ? <Image source={{ uri: agency.logo_url }} style={cs.agencyLogo} resizeMode="contain" />
            : <View style={[cs.agencyLogo, cs.agencyLogoPlaceholder]}>
                <Ionicons name="business-outline" size={18} color={colors.textSecondary} />
              </View>
          }
        </View>
        <View style={cs.agentCenter}>
          <Text style={cs.agentName} numberOfLines={1}>{agent?.full_name || '—'}</Text>
          {agency?.name && (
            <Text style={cs.agencyName} numberOfLines={1}>{agency.name}</Text>
          )}
          {agent?.phone && (
            <Text style={cs.agentPhone} numberOfLines={1}>{agent.phone}</Text>
          )}
        </View>
        <View style={cs.agentPhotoWrap}>
          {agent?.photo_url
            ? <Image source={{ uri: agent.photo_url }} style={cs.agentPhoto} />
            : <View style={[cs.agentPhoto, cs.agentPhotoPlaceholder]}>
                <Ionicons name="person-outline" size={18} color={colors.textSecondary} />
              </View>
          }
        </View>
      </View>

      {/* Specs row */}
      <View style={cs.specsRow}>
        <Text style={cs.propType}>{typeLabel(item.property_type, lang)}</Text>
        {item.bedrooms != null && (
          <View style={cs.specChip}><Text style={cs.specText}>{item.bedrooms} {t('accomBeds', lang)}</Text></View>
        )}
        {item.bathrooms != null && (
          <View style={cs.specChip}><Text style={cs.specText}>{item.bathrooms} {t('accomBaths', lang)}</Text></View>
        )}
        {item.area_sqm != null && (
          <View style={cs.specChip}><Text style={cs.specText}>{item.area_sqm}m²</Text></View>
        )}
        {item.furnished != null && (
          <View style={cs.specChip}>
            <Text style={cs.specText}>{item.furnished ? t('accomFurnished', lang) : t('accomUnfurnished', lang)}</Text>
          </View>
        )}
      </View>

      {/* Address row */}
      {(item.district || item.address) && (
        <View style={cs.addressRow}>
          <Ionicons name="location-outline" size={13} color={colors.textSecondary} />
          <Text style={cs.addressText} numberOfLines={1}>
            {[districtLabel(item.district, lang), item.address].filter(Boolean).join(' · ')}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  )
}

// ─── Filter Pill ─────────────────────────────────────────────────────────────

function FilterPill({ label, active, onPress }) {
  return (
    <TouchableOpacity style={[cs.pill, active && cs.pillActive]} onPress={onPress} activeOpacity={0.75}>
      <Text style={[cs.pillText, active && cs.pillTextActive]}>{label}</Text>
    </TouchableOpacity>
  )
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function AccommodationScreen({ lang, session, onClose, onBecomeAgent, onOpenProperty }) {
  const [properties, setProperties]   = useState([])
  const [agencies, setAgencies]       = useState([])
  const [loading, setLoading]         = useState(true)
  const [intent, setIntent]           = useState('all')
  const [district, setDistrict]       = useState(null)
  const [propType, setPropType]       = useState(null)
  const [agencyId, setAgencyId]       = useState(null)
  const [sort, setSort]               = useState('newest')
  const [priceMin, setPriceMin]       = useState('')
  const [priceMax, setPriceMax]       = useState('')
  const [filterCurrency, setFilterCurrency] = useState(null)
  const [showDistrictModal, setShowDistrictModal] = useState(false)
  const [showTypeModal, setShowTypeModal]         = useState(false)
  const [showAgencyModal, setShowAgencyModal]     = useState(false)
  const [showSortModal, setShowSortModal]         = useState(false)
  const [showPriceModal, setShowPriceModal]       = useState(false)

  const fetchProperties = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('properties')
      .select(`*, property_images(id, url, sort_order), estate_agents(id, full_name, phone, photo_url, estate_agencies(id, name, logo_url))`)
      .eq('status', 'active')

    if (intent !== 'all')  q = q.eq('intent', intent)
    if (district)          q = q.eq('district', district)
    if (propType)          q = q.eq('property_type', propType)
    if (agencyId)          q = q.eq('agency_id', agencyId)
    if (filterCurrency)    q = q.eq('currency', filterCurrency)
    if (priceMin !== '')   q = q.gte('price', Number(priceMin))
    if (priceMax !== '')   q = q.lte('price', Number(priceMax))

    if (sort === 'newest')     q = q.order('created_at', { ascending: false })
    if (sort === 'popular')    q = q.order('view_count', { ascending: false })
    if (sort === 'price_asc')  q = q.order('price', { ascending: true })
    if (sort === 'price_desc') q = q.order('price', { ascending: false })

    const { data, error } = await q
    if (!error) {
      setProperties((data || []).map(p => ({
        ...p,
        property_images: (p.property_images || []).sort((a, b) => a.sort_order - b.sort_order),
      })))
    }
    setLoading(false)
  }, [intent, district, propType, agencyId, sort, priceMin, priceMax, filterCurrency])

  const fetchAgencies = useCallback(async () => {
    const { data } = await supabase.from('estate_agencies').select('id, name').eq('status', 'active')
    setAgencies(data || [])
  }, [])

  useEffect(() => { fetchProperties() }, [fetchProperties])
  useEffect(() => { fetchAgencies() }, [fetchAgencies])

  const activeFilters = [district, propType, agencyId, filterCurrency, priceMin || priceMax].filter(Boolean).length

  function sortLabel(s) {
    if (s === 'newest')     return t('accomSortNewest', lang)
    if (s === 'popular')    return t('accomSortPopular', lang)
    if (s === 'price_asc')  return t('accomSortPriceLow', lang)
    if (s === 'price_desc') return t('accomSortPriceHigh', lang)
    return s
  }

  return (
    <SafeAreaView style={cs.safe} edges={['top']}>
      <PageBackground topic="accommodation" />
      <ScreenHeader onBack={onClose} title={t('accomTitle', lang)} lang={lang} />

      {/* Intent tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={cs.intentBar} contentContainerStyle={cs.intentBarContent}>
        {INTENTS.map(i => (
          <TouchableOpacity key={i} style={[cs.intentTab, intent === i && cs.intentTabActive]} onPress={() => setIntent(i)}>
            <Text style={[cs.intentTabText, intent === i && cs.intentTabTextActive]}>
              {i === 'all' ? t('accomAll', lang) : intentLabel(i, lang)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Filter pills */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={cs.pillBar} contentContainerStyle={cs.pillBarContent}>
        <FilterPill
          label={district ? districtLabel(district, lang) : t('accomFilterDistrict', lang)}
          active={!!district}
          onPress={() => setShowDistrictModal(true)}
        />
        <FilterPill
          label={propType ? typeLabel(propType, lang) : t('accomFilterType', lang)}
          active={!!propType}
          onPress={() => setShowTypeModal(true)}
        />
        <FilterPill
          label={agencyId ? (agencies.find(a => a.id === agencyId)?.name || t('accomFilterAgency', lang)) : t('accomFilterAgency', lang)}
          active={!!agencyId}
          onPress={() => setShowAgencyModal(true)}
        />
        <FilterPill
          label={(priceMin || priceMax || filterCurrency)
            ? `${filterCurrency || ''}${priceMin ? ` >${priceMin}` : ''}${priceMax ? ` <${priceMax}` : ''}`.trim() || t('accomFilterPrice', lang)
            : t('accomFilterPrice', lang)}
          active={!!(priceMin || priceMax || filterCurrency)}
          onPress={() => setShowPriceModal(true)}
        />
        <FilterPill
          label={sortLabel(sort)}
          active={sort !== 'newest'}
          onPress={() => setShowSortModal(true)}
        />
        {activeFilters > 0 && (
          <TouchableOpacity style={cs.clearPill} onPress={() => {
            setDistrict(null); setPropType(null); setAgencyId(null)
            setPriceMin(''); setPriceMax(''); setFilterCurrency(null); setSort('newest')
          }}>
            <Feather name="x" size={14} color={colors.danger} />
            <Text style={cs.clearPillText}>{t('accomClear', lang)}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* List */}
      {loading
        ? <ActivityIndicator style={{ marginTop: 60 }} size="large" color={colors.primary} />
        : (
          <FlatList
            data={properties}
            keyExtractor={i => i.id}
            contentContainerStyle={cs.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={cs.emptyWrap}>
                <View style={cs.emptyCard}>
                  <Ionicons name="home-outline" size={48} color={colors.border} style={{ marginBottom: 10 }} />
                  <Text style={cs.emptyTitle}>{t('accomNoResults', lang)}</Text>
                  <Text style={cs.emptySub}>{t('accomNoResultsSub', lang)}</Text>
                </View>
              </View>
            }
            ListFooterComponent={
              <View style={cs.footer}>
                <View style={cs.footerCard}>
                  <Ionicons name="briefcase-outline" size={28} color={colors.primary} />
                  <Text style={cs.footerTitle}>{t('accomBecomeAgent', lang)}</Text>
                  <Text style={cs.footerSub}>{t('accomBecomeAgentSub', lang)}</Text>
                  <TouchableOpacity style={cs.footerBtn} onPress={onBecomeAgent}>
                    <Text style={cs.footerBtnText}>{t('accomBecomeAgent', lang)}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            }
            renderItem={({ item }) => (
              <PropertyCard item={item} lang={lang} onPress={() => onOpenProperty(item)} />
            )}
          />
        )
      }

      {/* District modal */}
      <PickerModal
        visible={showDistrictModal}
        title={t('accomFilterDistrict', lang)}
        options={DISTRICTS}
        selected={district}
        labelFn={d => districtLabel(d, lang)}
        onSelect={v => { setDistrict(v === district ? null : v); setShowDistrictModal(false) }}
        onClose={() => setShowDistrictModal(false)}
      />

      {/* Type modal */}
      <PickerModal
        visible={showTypeModal}
        title={t('accomFilterType', lang)}
        options={PROP_TYPES}
        selected={propType}
        labelFn={tp => typeLabel(tp, lang)}
        onSelect={v => { setPropType(v === propType ? null : v); setShowTypeModal(false) }}
        onClose={() => setShowTypeModal(false)}
      />

      {/* Agency modal */}
      <PickerModal
        visible={showAgencyModal}
        title={t('accomFilterAgency', lang)}
        options={agencies.map(a => a.id)}
        selected={agencyId}
        labelFn={id => agencies.find(a => a.id === id)?.name || id}
        onSelect={v => { setAgencyId(v === agencyId ? null : v); setShowAgencyModal(false) }}
        onClose={() => setShowAgencyModal(false)}
      />

      {/* Sort modal */}
      <PickerModal
        visible={showSortModal}
        title={t('accomFilterSort', lang)}
        options={SORT_OPTS}
        selected={sort}
        labelFn={s => sortLabel(s)}
        onSelect={v => { setSort(v); setShowSortModal(false) }}
        onClose={() => setShowSortModal(false)}
      />

      {/* Price range modal */}
      <Modal visible={showPriceModal} transparent animationType="slide">
        <Pressable style={cs.overlay} onPress={() => setShowPriceModal(false)}>
          <Pressable style={cs.sheet}>
            <Text style={cs.sheetTitle}>{t('accomFilterPriceRange', lang)}</Text>
            {/* Currency selector */}
            <View style={cs.currencyChips}>
              {['GBP', 'TRY', 'EUR'].map(c => (
                <TouchableOpacity
                  key={c}
                  style={[cs.currencyChip, filterCurrency === c && cs.currencyChipActive]}
                  onPress={() => setFilterCurrency(filterCurrency === c ? null : c)}
                >
                  <Text style={[cs.currencyChipText, filterCurrency === c && cs.currencyChipTextActive]}>
                    {CURRENCIES[c]} {c}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={cs.priceRow}>
              <TextInput
                style={[cs.input, { flex: 1 }]}
                placeholder={t('accomMin', lang)}
                placeholderTextColor={colors.textSecondary}
                keyboardType="numeric"
                value={priceMin}
                onChangeText={setPriceMin}
              />
              <Text style={cs.priceDash}>–</Text>
              <TextInput
                style={[cs.input, { flex: 1 }]}
                placeholder={t('accomMax', lang)}
                placeholderTextColor={colors.textSecondary}
                keyboardType="numeric"
                value={priceMax}
                onChangeText={setPriceMax}
              />
            </View>
            <TouchableOpacity style={cs.applyBtn} onPress={() => setShowPriceModal(false)}>
              <Text style={cs.applyBtnText}>{t('accomApply', lang)}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  )
}

// ─── Generic picker bottom sheet ─────────────────────────────────────────────

function PickerModal({ visible, title, options, selected, labelFn, onSelect, onClose }) {
  return (
    <Modal visible={visible} transparent animationType="slide">
      <Pressable style={cs.overlay} onPress={onClose}>
        <Pressable style={cs.sheet}>
          <Text style={cs.sheetTitle}>{title}</Text>
          {options.map(opt => (
            <TouchableOpacity key={opt} style={cs.sheetOption} onPress={() => onSelect(opt)}>
              <Text style={[cs.sheetOptionText, selected === opt && cs.sheetOptionTextActive]}>
                {labelFn(opt)}
              </Text>
              {selected === opt && <Ionicons name="checkmark" size={18} color={colors.primary} />}
            </TouchableOpacity>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const cs = StyleSheet.create({
  safe:                { flex: 1, backgroundColor: colors.bg },

  intentBar:           { flexGrow: 0 },
  intentBarContent:    { paddingHorizontal: 16, gap: 8, paddingBottom: 10 },
  intentTab:           { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.cardBg },
  intentTabActive:     { backgroundColor: colors.primary },
  intentTabText:       { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  intentTabTextActive: { fontFamily: 'Inter_700Bold', color: '#fff' },

  pillBar:             { flexGrow: 0 },
  pillBarContent:      { paddingHorizontal: 16, gap: 8, paddingBottom: 12 },
  pill:                { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  pillActive:          { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  pillText:            { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  pillTextActive:      { fontFamily: 'Inter_700Bold', color: colors.primary },
  clearPill:           { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: colors.dangerLight, backgroundColor: colors.dangerLight },
  clearPillText:       { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.danger },

  listContent:         { paddingHorizontal: 16, paddingBottom: 40 },

  card:                { backgroundColor: colors.cardBg, borderRadius: 20, marginBottom: 16, overflow: 'hidden', ...shadow },
  cardImage:           { width: SCREEN_W - 32, height: CARD_IMAGE_H },
  imagePlaceholder:    { width: SCREEN_W - 32, height: CARD_IMAGE_H, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },

  dotRow:              { position: 'absolute', bottom: 10, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 5 },
  dot:                 { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.5)' },
  dotActive:           { backgroundColor: '#fff', width: 18 },

  intentBadge:         { position: 'absolute', top: 12, right: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: colors.primary },
  intentBadgeSale:     { backgroundColor: colors.success },
  intentBadgeShort:    { backgroundColor: colors.accent },
  intentBadgeText:     { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#fff', textTransform: 'uppercase', letterSpacing: 0.5 },

  priceBadge:          { position: 'absolute', bottom: 12, left: 12, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.65)' },
  priceBadgeText:      { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },

  agentRow:            { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10, gap: 10 },
  agentLogoWrap:       { width: 44, alignItems: 'flex-start' },
  agencyLogo:          { width: 38, height: 38, borderRadius: 8 },
  agencyLogoPlaceholder: { backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  agentCenter:         { flex: 1 },
  agentName:           { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  agencyName:          { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.primary, marginTop: 1 },
  agentPhone:          { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 2 },
  agentPhotoWrap:      { width: 44, alignItems: 'flex-end' },
  agentPhoto:          { width: 40, height: 40, borderRadius: 20 },
  agentPhotoPlaceholder: { backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },

  specsRow:            { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', paddingHorizontal: 14, gap: 6, paddingBottom: 8 },
  propType:            { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.3 },
  specChip:            { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: colors.surface },
  specText:            { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary },

  addressRow:          { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, paddingBottom: 14 },
  addressText:         { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, flex: 1 },

  emptyWrap:           { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyCard:           { backgroundColor: colors.cardBg, borderRadius: 16, paddingHorizontal: 24, paddingVertical: 20, alignItems: 'center', ...shadow },
  emptyTitle:          { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 4 },
  emptySub:            { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center' },

  footer:              { paddingTop: 12, paddingBottom: 20 },
  footerCard:          { backgroundColor: colors.primaryLight, borderRadius: 20, padding: 20, alignItems: 'center', gap: 8 },
  footerTitle:         { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.primary },
  footerSub:           { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.primary, textAlign: 'center', opacity: 0.8 },
  footerBtn:           { marginTop: 4, paddingHorizontal: 24, paddingVertical: 11, borderRadius: 14, backgroundColor: colors.primary },
  footerBtnText:       { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },

  // modals
  overlay:             { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet:               { backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40 },
  sheetTitle:          { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 14 },
  sheetOption:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  sheetOptionText:     { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  sheetOptionTextActive: { fontFamily: 'Inter_700Bold', color: colors.primary },

  currencyChips:       { flexDirection: 'row', gap: 10, marginBottom: 16 },
  currencyChip:        { flex: 1, paddingVertical: 11, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center' },
  currencyChipActive:  { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  currencyChipText:    { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
  currencyChipTextActive: { color: colors.primary },
  priceRow:            { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  priceDash:           { fontSize: 18, color: colors.textSecondary },
  input:               { borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, padding: 12, fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textPrimary, backgroundColor: colors.surface },
  applyBtn:            { backgroundColor: colors.primary, borderRadius: 14, padding: 14, alignItems: 'center' },
  applyBtnText:        { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
})
