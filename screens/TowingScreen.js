import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, Linking, BackHandler,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import PageBackground from '../components/PageBackground'
import ScreenHeader from '../components/ScreenHeader'
import TowingLogo from '../components/TowingLogo'
import TowingDetailScreen from './TowingDetailScreen'
import { colors, shadow, radius } from '../constants/theme'
import { t } from '../constants/i18n'
import { REGIONS, REGION_LABEL_KEY } from '../constants/regions'
import { VEHICLE_CLASSES, DEFAULT_VEHICLE_CLASS } from '../constants/towing'
import { openState, sortTowingCompanies } from '../utils/towingHours'
import { resolveRegion } from '../utils/resolveRegion'

// Çekici & Yol Yardım — the list.
//
// THIS IS AN EMERGENCY SCREEN, NOT A BROWSE SCREEN. Every decision below follows from
// the user being at the roadside, possibly stressed, possibly on one bar of signal:
//   • the CALL BUTTON IS ON THE CARD. No detour through the detail page.
//   • a closed firm is never hidden — it sorts down and says when it opens.
//   • the list NEVER comes back empty. See the two fallbacks in `visible`.

// ─── Card ────────────────────────────────────────────────────────────────────
// Defined at module scope, not inside the screen, so it is not remounted on every
// parent render.
function TowingCard({ item, lang, onPress, onCall, onCallSecondary, onWhatsApp }) {
  const st = openState(item)
  const classes = (item.vehicle_classes || [])
    .map(c => VEHICLE_CLASSES.find(v => v.key === c))
    .filter(Boolean)
    .map(v => t(v.labelKey, lang))
    .join(' · ')

  const coverage = (item.coverage_regions || [])
    .filter(r => REGIONS.includes(r))
    .map(r => t(REGION_LABEL_KEY[r], lang))
    .join(' · ')

  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={0.85}>
      <View style={s.cardHead}>
        <TowingLogo uri={item.logo_url} name={item.name} size={64} />
        <View style={s.cardHeadText}>
          <Text style={s.cardName} numberOfLines={2}>{item.name}</Text>
          <View style={s.badgeRow}>
            {st.state === 'open' ? (
              <View style={[s.badge, s.badgeOpen]}>
                <Text style={[s.badgeText, s.badgeOpenText]}>{t('towingOpenNow', lang)}</Text>
              </View>
            ) : st.state === 'opens' ? (
              <View style={[s.badge, s.badgeShut]}>
                <Text style={[s.badgeText, s.badgeShutText]}>
                  {t('towingOpensAt', lang).replace('{time}', st.at)}
                </Text>
              </View>
            ) : st.unknown ? (
              // NOT "closed today" — we do not know. Claiming closed could stop someone
              // calling a firm that is actually open, which on this screen is the one
              // failure mode that matters. Say what we know: nothing.
              <View style={[s.badge, s.badgeCls]}>
                <Text style={[s.badgeText, s.badgeClsText]}>{t('towingHoursUnknownBadge', lang)}</Text>
              </View>
            ) : (
              <View style={[s.badge, s.badgeShut]}>
                <Text style={[s.badgeText, s.badgeShutText]}>{t('towingClosedToday', lang)}</Text>
              </View>
            )}
            {!!item.is_24_7 && (
              <View style={[s.badge, s.badgeDay]}>
                <Text style={[s.badgeText, s.badgeDayText]}>{t('towing247', lang)}</Text>
              </View>
            )}
            {!!classes && (
              <View style={[s.badge, s.badgeCls]}>
                <Text style={[s.badgeText, s.badgeClsText]}>{classes}</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      <View style={s.cardMeta}>
        <Text style={s.coverage} numberOfLines={2}>
          <Text style={s.coverageLabel}>{t('towingCoverageLabel', lang)} </Text>
          {coverage}
        </Text>
        <Text style={s.price}>
          {item.starting_price != null
            ? t('towingPriceFrom', lang).replace('{price}', String(item.starting_price))
            : t('towingCallForPrice', lang)}
        </Text>
      </View>

      {/* tel: is the primary action and it lives HERE, on the card. WhatsApp is
          deliberately subordinate: a small icon, no label, never the wide button. */}
      <View style={s.actions}>
        <TouchableOpacity style={s.callBtn} onPress={onCall} activeOpacity={0.85}>
          <Ionicons name="call" size={17} color="#FFFFFF" />
          <Text style={s.callText}>{t('towingCall', lang)}</Text>
        </TouchableOpacity>
        {!!item.whatsapp && (
          <TouchableOpacity style={s.waBtn} onPress={onWhatsApp} activeOpacity={0.85}>
            <Ionicons name="logo-whatsapp" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Fallback number — a full-width bordered button directly under Ara. It began
          as a small text link and device testing showed that was too weak to read as an
          action, so it now carries the same width, height and radius as Ara, outlined
          rather than filled so the primary call stays visually dominant.
          The number is IN the label: at the roadside, seeing which number you are about
          to dial is worth more than a tidy label.
          Still not a chooser — one tap to one number, the fallback one tap further.
          Renders only when phone_secondary is non-null. */}
      {!!item.phone_secondary && (
        <TouchableOpacity style={s.secondNumBtn} onPress={onCallSecondary} activeOpacity={0.85}>
          <Ionicons name="call-outline" size={15} color={colors.primary} />
          <Text style={s.secondNumText} numberOfLines={1}>
            {t('towingSecondNumberBtn', lang).replace('{number}', item.phone_secondary)}
          </Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  )
}

export default function TowingScreen({ lang, userLocation, onBack }) {
  const [companies, setCompanies] = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(false)
  const [vClass, setVClass]       = useState(DEFAULT_VEHICLE_CLASS)
  const [region, setRegion]       = useState(null)      // null = could not resolve
  const [pickingRegion, setPick]  = useState(false)
  const [selected, setSelected]   = useState(null)

  // Region comes from the OFFLINE resolver, never a geocoder, and it NEVER prompts for
  // permission — userLocation is whatever the app already has. If that is nothing, the
  // pill says "choose a region" and the list falls back to everything (see `visible`).
  useEffect(() => {
    if (!userLocation) return
    const r = resolveRegion(userLocation.latitude, userLocation.longitude)
    if (r) setRegion(prev => prev ?? r)
  }, [userLocation])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data, error: err } = await supabase
        .from('towing_companies')
        .select('*')
        .eq('is_active', true)
      if (!alive) return
      if (err) { setError(true); setLoading(false); return }
      setCompanies(data || [])
      setLoading(false)
    })()
    return () => { alive = false }
  }, [])

  const inClass = companies.filter(c => (c.vehicle_classes || []).includes(vClass))
  const inRegionAndClass = region
    ? inClass.filter(c => (c.coverage_regions || []).includes(region))
    : []

  // ─── THE LIST MUST NEVER BE EMPTY ─────────────────────────────────────────
  // Two distinct ways the region filter can yield nothing, and they need different
  // explanations because the user's situation is different:
  //   'none-here'   we know where they are, nobody covers it
  //   'no-region'   we do NOT know where they are (permission never granted, revoked,
  //                 no fix, outside the TRNC outline, or >25km from any anchor). This
  //                 is likely the MORE common case: someone rural who denied location
  //                 months ago and has now broken down.
  // Either way the fallback is the same and non-negotiable — every firm in the selected
  // vehicle class. A roadside user must always come away with a number to call.
  let visible = inRegionAndClass
  let fallback = null
  if (!region)                       { visible = inClass; fallback = 'no-region' }
  else if (!inRegionAndClass.length) { visible = inClass; fallback = 'none-here' }
  // Both notices say "…so every firm is listed", which is a lie when the fallback set is
  // ALSO empty (no firms seeded at all, or none in this vehicle class). Then the plain
  // empty state is the only honest thing to show.
  if (!inClass.length) fallback = null

  const sorted = sortTowingCompanies(visible)

  // Numbers are stored E.164 with spaces for readability; tel: wants them stripped.
  const dial     = useCallback(n => { if (n) Linking.openURL(`tel:${String(n).replace(/\s/g, '')}`) }, [])
  const whatsApp = useCallback(c => {
    if (c.whatsapp) Linking.openURL(`https://wa.me/${String(c.whatsapp).replace(/\D/g, '')}`)
  }, [])

  // Android hardware back closes the DETAIL first, not the whole module.
  //
  // App.js's global back handler only knows about `showTowing`, so without this the back
  // button would jump straight out of the module from the detail overlay — losing the
  // user's region and vehicle-class selection. This is the same gap left open in the
  // events detail overlay; not repeating it here.
  useEffect(() => {
    if (!selected) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setSelected(null); return true })
    return () => sub.remove()
  }, [selected])

  if (selected) {
    return (
      <TowingDetailScreen
        company={selected}
        lang={lang}
        onBack={() => setSelected(null)}
      />
    )
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <PageBackground topic="transportation" />
      <ScreenHeader lang={lang} title={t('menuTowing', lang)} onBack={onBack} />

      {/* flexShrink:0 — this block is a fixed-height flex sibling ABOVE a scrolling
          list in a flex:1 column. Without it, it gets vertically compressed once the
          list overflows and the chip text is cropped top and bottom. Invisible with a
          short list; guaranteed with a long one, and guaranteed in Turkish first. */}
      <View style={s.filters}>
        <TouchableOpacity style={s.regionBar} onPress={() => setPick(p => !p)} activeOpacity={0.8}>
          <View style={s.regionLeft}>
            <Ionicons name="location" size={15} color={colors.primary} />
            <Text style={s.regionText} numberOfLines={1}>
              {region ? t('towingRegionPill', lang).replace('{region}', t(REGION_LABEL_KEY[region], lang))
                      : t('towingPickRegion', lang)}
            </Text>
          </View>
          <Text style={s.regionChange}>{t('towingChange', lang)}</Text>
        </TouchableOpacity>

        {pickingRegion && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.chipRow}
          >
            {REGIONS.map(r => {
              const active = r === region
              return (
                <TouchableOpacity
                  key={r}
                  style={[s.chip, active && s.chipActive]}
                  onPress={() => { setRegion(r); setPick(false) }}
                >
                  <Text style={[s.chipText, active && s.chipTextActive]}>
                    {t(REGION_LABEL_KEY[r], lang)}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </ScrollView>
        )}

        {/* Vehicle class sits ABOVE the results because a firm that tows cars cannot
            tow a bus — a wrong result here is a wasted call in an emergency. */}
        <View style={s.segment}>
          {VEHICLE_CLASSES.map(v => {
            const active = v.key === vClass
            return (
              <TouchableOpacity
                key={v.key}
                style={[s.segItem, active && s.segItemActive]}
                onPress={() => setVClass(v.key)}
                activeOpacity={0.85}
              >
                <Text style={[s.segText, active && s.segTextActive]}>{t(v.labelKey, lang)}</Text>
              </TouchableOpacity>
            )
          })}
        </View>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
      ) : error ? (
        <View style={s.center}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.border} />
          <Text style={s.emptyText}>{t('towingLoadError', lang)}</Text>
        </View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={c => c.id}
          contentContainerStyle={s.listContent}
          ListHeaderComponent={
            fallback ? (
              <View style={s.notice}>
                <Ionicons name="information-circle-outline" size={17} color={colors.textSecondary} />
                <Text style={s.noticeText}>
                  {fallback === 'no-region'
                    ? t('towingNoRegionNotice', lang)
                    : t('towingNoneInRegionNotice', lang)
                        .replace('{region}', region ? t(REGION_LABEL_KEY[region], lang) : '')}
                </Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={s.center}>
              <Ionicons name="car-outline" size={40} color={colors.border} />
              <Text style={s.emptyText}>{t('towingEmpty', lang)}</Text>
            </View>
          }
          ListFooterComponent={
            <Text style={s.disclaimer}>{t('towingDisclaimer', lang)}</Text>
          }
          renderItem={({ item }) => (
            <TowingCard
              item={item}
              lang={lang}
              onPress={() => setSelected(item)}
              onCall={() => dial(item.phone)}
              onCallSecondary={() => dial(item.phone_secondary)}
              onWhatsApp={() => whatsApp(item)}
            />
          )}
        />
      )}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: colors.bg },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },

  filters:     { flexShrink: 0, paddingHorizontal: 16, paddingBottom: 10, gap: 10 },
  regionBar:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                 backgroundColor: colors.primaryLight, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10 },
  regionLeft:  { flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1 },
  regionText:  { fontSize: 13.5, fontWeight: '700', color: colors.primaryDark, flexShrink: 1 },
  regionChange:{ fontSize: 12, fontWeight: '700', color: colors.primaryDark },

  chipRow:     { gap: 8, paddingVertical: 2 },
  // backgroundColor is an OPAQUE fill, not 'transparent'. The Android
  // borderRadius+borderWidth gotcha is satisfied by setting the property explicitly —
  // it does not require transparency. These chips sit over a PageBackground photo, so
  // transparent made them read as floating text rather than tappable controls.
  chip:        { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
                 borderWidth: 1, borderColor: colors.border, backgroundColor: colors.cardBg },
  chipActive:  { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  chipText:    { fontSize: 13, color: colors.textSecondary },
  chipTextActive: { color: colors.primary, fontWeight: '700' },

  segment:     { flexDirection: 'row', gap: 8 },
  segItem:     { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
                 borderWidth: 1, borderColor: colors.border, backgroundColor: colors.cardBg },
  segItemActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  segText:     { fontSize: 13, color: colors.textSecondary },
  segTextActive: { color: '#FFFFFF', fontWeight: '700' },

  listContent: { padding: 16, paddingTop: 4, gap: 11 },

  notice:      { flexDirection: 'row', gap: 8, alignItems: 'flex-start',
                 backgroundColor: colors.cardBg, borderRadius: radius.md, padding: 12,
                 borderWidth: 1, borderColor: colors.border, marginBottom: 4 },
  noticeText:  { flex: 1, fontSize: 12.5, lineHeight: 18, color: colors.textSecondary },

  card:        { backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 13,
                 borderWidth: 1, borderColor: colors.border, ...shadow },
  cardHead:    { flexDirection: 'row', gap: 11, alignItems: 'flex-start' },
  cardHeadText:{ flex: 1 },
  cardName:    { fontSize: 15, fontWeight: '800', color: colors.textPrimary, lineHeight: 20 },

  badgeRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 6 },
  badge:       { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5 },
  badgeText:   { fontSize: 10.5, fontWeight: '700' },
  badgeOpen:   { backgroundColor: colors.successLight },
  badgeOpenText: { color: colors.success },
  badgeShut:   { backgroundColor: colors.dangerLight },
  badgeShutText: { color: colors.danger },
  badgeDay:    { backgroundColor: colors.primaryLight },
  badgeDayText:{ color: colors.primary },
  badgeCls:    { backgroundColor: colors.sand },
  badgeClsText:{ color: colors.textSecondary },

  cardMeta:    { marginTop: 9, paddingTop: 9, borderTopWidth: 1, borderTopColor: colors.border, gap: 3 },
  coverage:    { fontSize: 12, color: colors.textPrimary, lineHeight: 17 },
  coverageLabel: { color: colors.textSecondary },
  price:       { fontSize: 12, color: colors.textSecondary },

  actions:     { flexDirection: 'row', gap: 8, marginTop: 11 },
  callBtn:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
                 backgroundColor: colors.primary, paddingVertical: 11, borderRadius: radius.sm },
  callText:    { color: '#FFFFFF', fontSize: 14.5, fontWeight: '700' },
  waBtn:       { width: 46, alignItems: 'center', justifyContent: 'center',
                 borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
                 backgroundColor: 'transparent' },

  // Same height/radius as callBtn, outlined instead of filled. 'transparent' is safe
  // HERE (unlike the filter chips) because this sits inside an opaque cardBg card, not
  // over the PageBackground photo — the card is what shows through.
  secondNumBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                   gap: 7, marginTop: 8, paddingVertical: 11, borderRadius: radius.sm,
                   borderWidth: 1, borderColor: colors.primary, backgroundColor: 'transparent' },
  secondNumText: { fontSize: 14, fontWeight: '700', color: colors.primary, flexShrink: 1 },

  emptyText:   { fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
  disclaimer:  { fontSize: 11.5, lineHeight: 17, color: colors.textSecondary,
                 textAlign: 'center', marginTop: 14, paddingHorizontal: 8 },
})
