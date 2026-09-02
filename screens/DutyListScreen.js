import { useState, useEffect, useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Linking, SectionList, FlatList } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather, Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import PageBackground from '../components/PageBackground'
import ScreenHeader from '../components/ScreenHeader'
import { colors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'
import { REGION_TO_DUTY } from '../constants/regions'
import { dutyStatus, localDateKey, DUTY_FRESH, DUTY_PARTIAL } from '../utils/dutyStatus'
import { buildFacilityIndex, matchDutyRow } from '../utils/dutyFacilityMatch'

// KTEB publish the roster and are the fallback we send people to. Their number is the
// office line; the page shows TODAY's list for every region.
// ⚠ Not a decoration — at 2am a phone number that works beats a message that does not.
const KTEB_TEL = '+903922280622'
const KTEB_URL = 'https://www.kteb.org/dp/?lang=tr'


const REGION_TO_BL_KEY = {
  'Lefkoşa':    'blDistrictNicosia',
  'Girne':      'blDistrictKyrenia',
  'Gazimağusa': 'blDistrictFamagusta',
  'Güzelyurt':  'blDistrictMorphou',
  'İskele':     'blDistrictIskele',
  'Lefke':      'blDistrictLefke',
  'Karpaz':     'blDistrictKarpaz',
}

// Canonical TRNC district display order for section headers
const DISTRICT_ORDER = ['Lefkoşa', 'Gazimağusa', 'Girne', 'Güzelyurt', 'İskele', 'Lefke', 'Karpaz', 'Mesarya']

function regionBLKey(region) {
  if (!region) return null
  // strip regular and non-breaking spaces
  const trimmed = region.trim().replace(/ /g, ' ').trim()
  if (REGION_TO_BL_KEY[trimmed]) return REGION_TO_BL_KEY[trimmed]
  // case-insensitive fallback (handles GİRNE, LEFKOŞA, etc.)
  const lowerInput = trimmed.toLocaleLowerCase('tr')
  for (const [key, val] of Object.entries(REGION_TO_BL_KEY)) {
    if (key.toLocaleLowerCase('tr') === lowerInput) return val
  }
  return null
}

function regionLabel(region, lang) {
  const key = regionBLKey(region)
  return key ? t(key, lang) : (region ?? '')
}

// Restored verbatim from ee28b42, which a76ee97 removed on 2026-06-29. a76ee97's objection
// was NOT to this function — it was that duty_list has no per-pharmacy coordinates, so the
// old caller measured to a district CENTROID and produced the same distance for every
// pharmacy in a region. Its commit message set the condition for bringing it back: "once a
// roster-keyed coords lookup table is available". facilities is that lookup, joined by name.
//
// ⚠ NO CENTROID FALLBACK, EVER. A row with no matched facility, or a matched facility with
//   no coordinates, gets _dist = null and renders exactly as it does today. A plausible
//   wrong number is worse than no number: it is the lie a76ee97 deleted.
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}


function PharmacyCard({ item, showRegionBadge, lang }) {
  return (
    <View style={s.card}>
      <View style={s.cardTop}>
        <Text style={s.pharmacyName}>{item.name}</Text>
        <View style={s.hoursBadge}>
          <Text style={s.hoursText}>{item.open_from}–{item.open_until}</Text>
        </View>
      </View>
      {(showRegionBadge && item.region) || item._dist != null ? (
        <View style={s.metaRow}>
          {showRegionBadge && item.region ? (
            <View style={s.regionInlineBadge}>
              <Text style={s.regionInlineText}>{regionLabel(item.region, lang)}</Text>
            </View>
          ) : null}
          {/* Labelled STRAIGHT-LINE, in every language. Haversine is not a driving
              distance and must never be read as one — 3 km across the Girne range is a
              half-hour drive. Rendered only when _dist is non-null; a row without a
              matched coordinate shows nothing at all, no placeholder and no zero. */}
          {item._dist != null ? (
            <Text style={s.distanceText}>
              {item._dist.toFixed(1)} km · {t('dutyStraightLine', lang)}
            </Text>
          ) : null}
        </View>
      ) : null}
      {item.address ? (
        <View style={s.addressRow}>
          <Feather name="map-pin" size={12} color={colors.textSecondary} />
          <Text style={s.addressText} numberOfLines={2}>{item.address}</Text>
        </View>
      ) : null}
      <View style={s.cardActions}>
        {item.phone ? (
          <TouchableOpacity
            style={s.callBtn}
            onPress={() => Linking.openURL(`tel:${item.phone.replace(/\s+/g, '')}`)}
            activeOpacity={0.7}
          >
            <Feather name="phone" size={13} color={colors.accent} />
            <Text style={s.callBtnText}>{item.phone}</Text>
          </TouchableOpacity>
        ) : null}
        {/* NAME + ADDRESS + country, not name alone. "HAZAL REİS ECZANESİ" on its own is
            unscoped — not even constrained to Cyprus. duty_list carries an address on
            100% of rows, so this costs nothing and is markedly more precise. Same
            fallback shape as HomeScreen.js:739-742.

            ⚠ AND THIS IS WHY IT NEEDS NO COORDINATES. A stored wrong pin is SILENT —
            the user drives to it. A search result is visible at the moment of
            navigating, so a bad match is something they can see and correct before
            setting off. It also hands the geocoding to a far better geocoder than the
            one that produced 142 distinct points for 387 pharmacies. */}
        <TouchableOpacity
          style={s.directionsBtn}
          onPress={() => Linking.openURL(
            `https://maps.google.com/?q=${encodeURIComponent(
              [item.name, item.address, 'Kuzey Kıbrıs'].filter(Boolean).join(', ')
            )}`
          )}
          activeOpacity={0.7}
        >
          <Feather name="navigation" size={13} color={colors.primary} />
          <Text style={s.directionsBtnText}>{t('getDirections', lang)}</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

// `initialRegion` is a canonical region slug (from city welcome). We hoist that
// region's sections to the top rather than scrolling to them: the list is short,
// and SectionList.scrollToLocation throws when the index is out of range — which
// it would be on any day that region has no duty pharmacy.
export default function DutyListScreen({ onBack, lang, userLocation, locationDenied, initialRegion = null }) {
  const [rows, setRows] = useState([])
  const [facIndex, setFacIndex] = useState(() => new Map())
  const [loading, setLoading] = useState(true)
  // 'fresh' | 'stale' | 'absent' — see utils/dutyStatus.js. Only 'fresh' is a good state.
  const [status, setStatus] = useState(DUTY_FRESH)

  // ee28b42's condition, restored unchanged: distance sorting is on only when we actually
  // have a fix. locationDenied is checked separately from userLocation because a denied
  // permission leaves userLocation null too, and the two mean different things.
  const sortByDistance = !!userLocation && !locationDenied

  useEffect(() => {
    async function load() {
      // localDateKey(), not toISOString(): TRNC is UTC+2/+3, so between local midnight
      // and 03:00 the UTC date is still YESTERDAY — precisely the hours someone is
      // hunting for a duty pharmacy.
      const today = localDateKey()
      // The newest duty_date is what separates "we never had this" from "it ran out",
      // and the two need different words even though they share a card.
      // Pharmacies WITH coordinates only. A match to a coordinate-less facility yields no
      // distance anyway, so fetching them would cost bandwidth to change nothing. 315 of
      // 387 carry coordinates today; the count guard below is what notices when that
      // crosses PostgREST's max-rows cap, which a plain .limit() cannot.
      const [{ data }, { data: newest }, { data: facs, count: facCount }] = await Promise.all([
        supabase.from('duty_list')
          .select('id, name, address, phone, open_from, open_until, region')
          .eq('duty_date', today),
        supabase.from('duty_list').select('duty_date').order('duty_date', { ascending: false }).limit(1),
        supabase.from('facilities')
          .select('name, latitude, longitude', { count: 'exact' })
          .eq('type', 'pharmacy')
          .not('latitude', 'is', null),
      ])
      // District coverage, not row count — see the threshold note in utils/dutyStatus.js.
      setStatus(dutyStatus({
        todayCount: data?.length ?? 0,
        todayDistricts: new Set((data ?? []).map(r => r.region)).size,
        maxDate: newest?.[0]?.duty_date ?? null,
      }))

      // A truncated read would silently drop distances for the pharmacies past the cap and
      // look completely normal — a short valid array, no error. Comparing the exact count
      // against what arrived is the only form of this check that works at any cap.
      if (facs && facCount != null && facs.length < facCount) {
        console.warn(`duty: facility coords truncated (${facs.length} of ${facCount}) — some distances will be missing`)
      }
      setFacIndex(buildFacilityIndex(facs))
      setRows(data ?? [])
      setLoading(false)
    }
    load()
  }, [])

  // Distances are DERIVED, not stored: userLocation resolves asynchronously in App.js and
  // can land after this screen mounts, so computing them in the fetch would leave a list
  // that never gains distances on a slow fix.
  const decorated = useMemo(() => rows.map(row => {
    const fac = matchDutyRow(row, facIndex)
    const dist = (sortByDistance && fac && fac.latitude != null && fac.longitude != null)
      ? haversineKm(userLocation.latitude, userLocation.longitude, fac.latitude, fac.longitude)
      : null
    return { ...row, _dist: dist }
  }), [rows, facIndex, sortByDistance, userLocation?.latitude, userLocation?.longitude])

  // District SectionList — the shape when location is unavailable, unchanged from today.
  const sections = useMemo(() => {
    if (!decorated.length) return []
    const map = {}
    // 'tr' collator: these are Turkish pharmacy names, and the default one sorts
    // ü as u and ö as o — so "Gülhan" and "Gunay" come out in the wrong order, and
    // dotless ı interleaves with dotted İ instead of preceding it.
    for (const row of [...decorated].sort((a, b) => a.name.localeCompare(b.name, 'tr'))) {
      if (!map[row.region]) map[row.region] = []
      map[row.region].push(row)
    }
    const knownSet = new Set(DISTRICT_ORDER)
    const sorted = [
      ...DISTRICT_ORDER.filter(d => map[d]).map(d => ({ title: d, data: map[d] })),
      ...Object.entries(map).filter(([k]) => !knownSet.has(k)).map(([k, v]) => ({ title: k, data: v })),
    ]
    // Arrived from a city-welcome card: float that city's sections to the top,
    // keeping DISTRICT_ORDER within each group so the rest of the list is
    // untouched.
    const hoist = new Set(REGION_TO_DUTY[initialRegion] ?? [])
    return hoist.size
      ? [...sorted.filter(x => hoist.has(x.title)), ...sorted.filter(x => !hoist.has(x.title))]
      : sorted
  }, [decorated, initialRegion])

  // Flat nearest-first — ee28b42's shape, including its null-last tiebreak. Rows with no
  // matched coordinate keep their place at the END rather than being dropped: an unmatched
  // duty pharmacy is still a duty pharmacy, and at 2am it is still where someone can go.
  const nearest = useMemo(() => [...decorated].sort((a, b) => {
    if (a._dist == null && b._dist == null) return a.name.localeCompare(b.name, 'tr')
    if (a._dist == null) return 1
    if (b._dist == null) return -1
    return a._dist - b._dist
  }), [decorated])

  const d = new Date()
  const dateLabel = d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <PageBackground topic="duty_pharmacy" />
      <ScreenHeader onBack={onBack} title={t('dutyPharmacies', lang)} subtitle={dateLabel} lang={lang} />
      <View style={s.container}>

        {/* PARTIAL: rows exist but cover too few districts to be the whole roster.
            The rows STAY — one real pharmacy at 2am is worth having — but the list must
            not read as complete, which is exactly what it did on 28/29 Eylül 2026: a
            single Karpaz/İskele pharmacy under a green banner, so a user in Girne
            concluded that was the truth. Same KTEB escape as the zero-row card.

            ⚠ flexShrink: 0 on the notice. A fixed-height View above a scrollable list in
            a flex:1 column gets vertically compressed once the list overflows, cropping
            its text top and bottom — and it only reproduces with enough rows to scroll,
            so it is invisible on exactly the short lists this state produces. */}
        {!loading && status === DUTY_PARTIAL ? (
          <View style={s.partialNotice}>
            <View style={s.partialRow}>
              <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
              <Text style={s.partialText}>{t('dutyIncompleteNotice', lang)}</Text>
            </View>
            <View style={s.partialActions}>
              <TouchableOpacity
                style={s.partialCallBtn}
                onPress={() => Linking.openURL(`tel:${KTEB_TEL}`)}
                activeOpacity={0.85}
              >
                <Feather name="phone" size={13} color="#fff" />
                <Text style={s.partialCallText}>{t('dutyCallKteb', lang)}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.partialLinkBtn}
                onPress={() => Linking.openURL(KTEB_URL)}
                activeOpacity={0.85}
              >
                <Feather name="external-link" size={13} color={colors.primaryDark} />
                <Text style={s.partialLinkText}>{t('dutyOpenKteb', lang)}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {loading ? (
          <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
        ) : (sortByDistance ? nearest : sections).length === 0 ? (
          /* NOT an empty state — an ERROR state. There is always a duty pharmacy in the
             TRNC, so zero rows never describes the world, only our missing data. 'stale'
             and 'absent' share this card deliberately: the user does not care which of
             our failures it was, they care where to go now. */
          <View style={s.center}>
            <View style={s.emptyCard}>
              <View style={s.errorIconWrap}>
                <Ionicons name="alert-circle-outline" size={32} color={colors.danger} />
              </View>
              <Text style={s.errorTitle}>{t('dutyUnavailableTitle', lang)}</Text>
              <Text style={s.emptyText}>{t('dutyUnavailableBody', lang)}</Text>

              <TouchableOpacity
                style={s.ktebCallBtn}
                onPress={() => Linking.openURL(`tel:${KTEB_TEL}`)}
                activeOpacity={0.85}
              >
                <Feather name="phone" size={16} color="#fff" />
                <Text style={s.ktebCallText}>{t('dutyCallKteb', lang)}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={s.ktebLinkBtn}
                onPress={() => Linking.openURL(KTEB_URL)}
                activeOpacity={0.85}
              >
                <Feather name="external-link" size={15} color={colors.primaryDark} />
                <Text style={s.ktebLinkText}>{t('dutyOpenKteb', lang)}</Text>
              </TouchableOpacity>

              <Text style={s.ktebAttribution}>{t('dutyKtebAttribution', lang)}</Text>
            </View>
          </View>
        ) : sortByDistance ? (
          /* Located: one flat nearest-first list. The district grouping is dropped on
             purpose — when the question is "which is closest", section headers put a
             40 km Karpaz pharmacy above a 2 km one. The region badge moves onto the card
             so the district is still visible. */
          <FlatList
            data={nearest}
            keyExtractor={item => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={s.listContent}
            renderItem={({ item }) => (
              <PharmacyCard item={item} showRegionBadge lang={lang} />
            )}
          />
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={item => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={s.listContent}
            stickySectionHeadersEnabled={false}
            renderSectionHeader={({ section }) => (
              <View style={s.regionHeader}>
                <Text style={s.regionName}>{regionLabel(section.title, lang)}</Text>
                <View style={s.regionBadge}>
                  <Text style={s.regionCount}>{section.data.length}</Text>
                </View>
              </View>
            )}
            renderItem={({ item }) => (
              <PharmacyCard item={item} showRegionBadge={false} lang={lang} />
            )}
          />
        )}
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: colors.bg },
  container:    { flex: 1, paddingHorizontal: 16 },
  center:       { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyCard:    { backgroundColor: colors.cardBg, borderRadius: 16, padding: 24, alignItems: 'center', ...shadow },
  emptyIconWrap: { width: 64, height: 64, borderRadius: 20, backgroundColor: colors.primaryLight, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  emptyText:    { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center' },
  errorIconWrap: { width: 64, height: 64, borderRadius: 20, backgroundColor: colors.dangerLight, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  errorTitle:   { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textAlign: 'center', marginBottom: 8 },
  ktebCallBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, alignSelf: 'stretch', backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 14, marginTop: 20 },
  ktebCallText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
  ktebLinkBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, alignSelf: 'stretch', backgroundColor: colors.primaryLight, borderRadius: 14, borderWidth: 1.5, borderColor: colors.primary, paddingVertical: 13, marginTop: 10 },
  ktebLinkText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.primaryDark },
  ktebAttribution: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', marginTop: 16, lineHeight: 17 },
  listContent:  { paddingBottom: 40 },

  regionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, marginBottom: 8, backgroundColor: colors.cardBg, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  regionName:   { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  regionBadge:  { backgroundColor: colors.border, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  regionCount:  { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary },

  metaRow:           { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' },
  partialNotice:     { flexShrink: 0, backgroundColor: colors.dangerLight, borderRadius: 14, padding: 14, marginBottom: 12 },
  partialRow:        { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  partialText:       { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 18 },
  partialActions:    { flexDirection: 'row', gap: 8, marginTop: 12 },
  partialCallBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, flex: 1, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 10 },
  partialCallText:   { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#fff' },
  partialLinkBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, flex: 1, backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.primaryDark, borderRadius: 10, paddingVertical: 10 },
  partialLinkText:   { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primaryDark },
  distanceText:      { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
  regionInlineBadge: { backgroundColor: colors.primaryLight, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  regionInlineText:  { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.primary },

  card:         { backgroundColor: colors.cardBg, borderRadius: 16, padding: 14, marginBottom: 8, ...shadow },
  cardTop:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, gap: 8 },
  pharmacyName: { flex: 1, fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary, lineHeight: 20 },
  hoursBadge:   { backgroundColor: colors.primaryLight, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  hoursText:    { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.primary },
  addressRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 10 },
  addressText:  { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 17 },
  cardActions:      { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  callBtn:          { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.accentLight, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 12 },
  callBtnText:      { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.accent },
  directionsBtn:    { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primaryLight, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 12 },
  directionsBtnText:{ fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary },
})
