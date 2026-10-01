import { useState, useEffect } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useScrollMemory, forgetScroll } from '../utils/scrollMemory'
import FilterDropdown from '../components/FilterDropdown'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import PageBackground from '../components/PageBackground'
import ScreenHeader from '../components/ScreenHeader'
import MascotIntroCard from '../components/MascotIntroCard'
import HomeServiceIcon from '../components/HomeServiceIcon'
import HomeServicePartnerCard from '../components/HomeServicePartnerCard'
import { colors, shadow, radius } from '../constants/theme'
import { t } from '../constants/i18n'
import { HS_CATEGORIES, hsCategory, HS_DISTRICTS, HS_DISTRICT_LABEL_KEY } from '../constants/homeServices'
import { HS_PARTNERS, HS_PARTNER_IDS } from '../constants/partners'
import { PREVIEW_PENDING_PARTNERS, HS_SELF_REGISTRATION } from '../constants/flags'
import { PREVIEW_PARTNER_ROWS } from '../constants/partnerPreview'
import { REDESIGN } from '../constants/redesign'
import { colors as C, category as CAT, type, radii, elevation, press } from '../constants/theme'
import {
  ScreenHeader as UiHeader, FilterBar, Dropdown, InfoBanner, ErrorState, CardSkeleton,
} from '../components/ui'
import HomeServicePartnerScreen from './HomeServicePartnerScreen'
import HomeServiceOnboardingScreen from './HomeServiceOnboardingScreen'

// ─── Tadilat · Bakım · Onarım — TWELVE DOORS ONTO A CURATED LIST ────────────
//
// The category grid and district chips are back, and the thing to understand about them
// is that they are NAVIGATION, NOT A DIRECTORY. Self-registration stays closed
// (HS_SELF_REGISTRATION false, hs_insert_self WITH CHECK (false) since 20261012), so
// eight of these twelve categories have no provider and will not get one under this
// policy. The tiles exist because somebody arriving with a broken tap looks for
// "Plumber", not because we have plumbers.
//
// ⚠ THE PARTNER IS PINNED ON ALL TWELVE, INCLUDING THE EIGHT IT DOES NOT COVER. That is
//   deliberate promotion, decided at go-live, and it is honest only because the card
//   carries its own service chips and its ADA-partner badge — the card says what the firm
//   does; the tile says what the user was looking for. The two are allowed to differ.
//
// ─── WHY THERE IS NO PER-CATEGORY QUERY ─────────────────────────────────────
//
// Phase B ran .contains('service_types', [category]) and derived the pinned card from the
// RESULT, so district-awareness was a property of the query and the pin could not
// disagree with the list. That was the right design then and it is IMPOSSIBLE now, for
// two independent reasons:
//
//   1. hs_select_public requires is_partner, so the query can only ever return partner
//      rows — the same rows the landing fetch already holds. A round trip that
//      reproduces what is in memory, plus a second source that can drift from it.
//   2. Promotion across all twelve means the pin must render for categories the query
//      would correctly exclude. Derivation from the result cannot express that.
//
// So everything below comes from `partnerRows`, fetched ONCE on mount. One source, no
// loading state on tap, and the pin and the copy under it cannot contradict each other
// because they are computed from the same row.
//
// ⚠ REVERSED ON PURPOSE (Berke, 2026-09-28): promotion is now across CATEGORIES *AND*
//   DISTRICTS. The partner card shows on every category × district, and the district no
//   longer hides it. The old rule ("never across districts", so the card vanished where
//   coverage_districts did not reach) left 48 of 84 pages with a "no firm in this district"
//   note — Berke's call is TadilArt everywhere, with no "no partner / no firm" message
//   anywhere in the module. The card still shows its own service areas (coverage row), so
//   the reader can see where the firm works. Do NOT restore the district filter without
//   his decision. The selected district still goes into the WhatsApp draft and the log.

const PARTNER_PREVIEW = __DEV__ && PREVIEW_PENDING_PARTNERS

function districtLabel(d, lang) {
  const key = HS_DISTRICT_LABEL_KEY[d]
  return key ? t(key, lang) : d
}

// ─── Category tile ────────────────────────────────────────────────────────────

function CategoryTile({ item, lang, onPress }) {
  return (
    <TouchableOpacity style={s.catTile} onPress={onPress} activeOpacity={0.75}>
      <View style={s.catIconWrap}>
        <HomeServiceIcon category={item} size={28} color={colors.primary} />
      </View>
      <Text style={s.catLabel} numberOfLines={2}>{t(item.labelKey, lang)}</Text>
    </TouchableOpacity>
  )
}

// Redesign tile: the same twelve doors, on the Ev & Yaşam category ground.
function RCategoryTile({ item, lang, onPress }) {
  return (
    <TouchableOpacity style={r.catTile} onPress={onPress} activeOpacity={press.card}
      accessibilityRole="button" accessibilityLabel={t(item.labelKey, lang)}>
      <View style={r.catIconWrap}>
        <HomeServiceIcon category={item} size={26} color={CAT.homeLife.ink} />
      </View>
      <Text style={r.catLabel} numberOfLines={2}>{t(item.labelKey, lang)}</Text>
    </TouchableOpacity>
  )
}

export default function HomeServicesScreen({ lang, session, onBack, onRequireAccount, backRef = null }) {
  // Held as a { partner, row } pair rather than an id, because the row is already in
  // hand at the tap site and re-fetching it would give the screen a loading state it
  // does not need.
  const [selectedPartner,  setSelectedPartner]  = useState(null)
  // The landing unmounts while a category is open (early return), so its offset is kept
  // here and restored when it comes back; forgotten when the module closes.
  const landingMem = useScrollMemory('hs:landing')
  useEffect(() => () => forgetScroll('hs:'), [])
  const [selectedCategory, setSelectedCategory] = useState(null)
  const [selectedDistrict, setSelectedDistrict] = useState(null)
  const [showOnboarding,   setShowOnboarding]   = useState(false)
  const [fetchedRows,      setFetchedRows]      = useState([])
  // Distinguishes "still asking" from "asked, and there are none". Without it the empty
  // state flashes for the length of the round trip on every open. Starts true in preview,
  // where the fixture is available synchronously and no request is made.
  const [loaded,           setLoaded]           = useState(PARTNER_PREVIEW)
  // A failed fetch used to land on the same render as "no partner rows", so the category page
  // came up blank (audit). Now it is its own state with a retry that re-runs the same query.
  const [loadError,        setLoadError]        = useState(false)
  const [attempt,          setAttempt]          = useState(0)
  const retry = () => { setLoadError(false); setLoaded(false); setAttempt(a => a + 1) }

  const partnerRows = PARTNER_PREVIEW ? PREVIEW_PARTNER_ROWS : fetchedRows

  // status='active' is asserted HERE and not assumed from the config: a partner row
  // seeded but not yet approved must produce no card at all in a release build. RLS
  // enforces the same thing from the other side — hs_select_public's public arm requires
  // status='active' AND is_partner — so this filter is belt to that policy's braces
  // rather than the only thing standing there.
  useEffect(() => {
    if (PARTNER_PREVIEW) return
    let alive = true
    supabase
      .from('home_services')
      .select('*')
      .in('id', HS_PARTNER_IDS)
      .eq('status', 'active')
      // BOTH handlers. A supabase-js query builder is a lazy thenable, and .then() with
      // only a success arm turns a network failure into an unhandled rejection — the
      // same reason utils/logContactEvent.js passes two. Either failure (a PostgREST
      // error in the result, or a rejection) is an ERROR state with a retry, never empty.
      .then(
        ({ data, error }) => {
          if (!alive) return
          if (error) setLoadError(true)
          else setFetchedRows(data || [])
          setLoaded(true)
        },
        () => { if (alive) { setLoadError(true); setLoaded(true) } },
      )
    return () => { alive = false }
  }, [attempt])

  function selectCategory(key) {
    setSelectedDistrict(null)
    setSelectedCategory(key)
  }

  function handleBack() {
    // The partner overlay is FIRST in the chain: it can be opened from the landing, where
    // selectedCategory is null, so any later branch would close the module instead of the
    // overlay.
    if (selectedPartner) {
      setSelectedPartner(null)
    } else if (selectedCategory) {
      setSelectedCategory(null)
      setSelectedDistrict(null)
    } else {
      onBack()
    }
  }

  // App's hardware-back chain asks this before closing the module: handleBack's steps minus
  // the final onBack, so Android back and the header back cannot disagree.
  useEffect(() => {
    if (!backRef) return
    backRef.current = () => {
      if (HS_SELF_REGISTRATION && showOnboarding) { setShowOnboarding(false); return true }
      if (selectedPartner) { setSelectedPartner(null); return true }
      if (selectedCategory) { setSelectedCategory(null); setSelectedDistrict(null); return true }
      return false
    }
    return () => { backRef.current = null }
  })

  // HS_SELF_REGISTRATION guards the RENDER, not only the button that sets the state.
  // Gating the CTA alone would leave the form one stale `showOnboarding` away — and it
  // would submit into an API that now refuses it (hs_insert_self is WITH CHECK (false)
  // since 20261012), so the user would fill the whole thing in and be rejected by a raw
  // Postgres error at the last step.
  if (HS_SELF_REGISTRATION && showOnboarding) {
    return (
      <HomeServiceOnboardingScreen
        session={session}
        lang={lang}
        onClose={() => setShowOnboarding(false)}
        onSubmitted={() => setShowOnboarding(false)}
      />
    )
  }

  // The partner showcase draws OVER the landing or category list (still mounted), so back
  // lands on the same scroll with the category and district intact (slice 6, 2026-09-28).
  const withPartner = body => (
    <View style={{ flex: 1 }}>
      {body}
      {selectedPartner && (
        <View style={s.partnerOverlay}>
          <HomeServicePartnerScreen
            partner={selectedPartner.partner}
            row={selectedPartner.row}
            lang={lang}
            serviceContext={selectedPartner.serviceContext}
            region={selectedPartner.region}
            onBack={() => setSelectedPartner(null)}
          />
        </View>
      )}
    </View>
  )

  // ORDER COMES FROM THE CONFIG, not from the database. HS_PARTNERS is the display
  // truth — it holds the tagline, the logo and the gallery — and a partner with a row
  // but no config entry could not be rendered anyway. Mapping the config also means the
  // running order is something a person chose rather than whatever the query returned.
  const cards = HS_PARTNERS
    .map(partner => ({ partner, row: partnerRows.find(r => r.id === partner.id) }))
    .filter(x => x.row)

  const activeCat = hsCategory(selectedCategory)

  // ─── Redesign (REDESIGN only; same state, handlers, order and pinning) ─────
  // The partner card itself (HomeServicePartnerCard) is untouched: same component, same
  // props, same position at the top of the landing and of every category page.
  if (REDESIGN) {
    const partnerList = (forCategory) => {
      if (!loaded) return <CardSkeleton height={190} />
      if (loadError) return <ErrorState lang={lang} onRetry={retry} />
      return cards.map(({ partner, row }) => {
        // Same covered-only rule as the legacy path below: the draft names the category
        // only when the firm lists it.
        const serviceContext = forCategory && (row.service_types || []).includes(selectedCategory) && activeCat
          ? { tr: t(activeCat.labelKey, 'Turkish'), en: t(activeCat.labelKey, 'English') }
          : null
        const region = forCategory ? selectedDistrict : null
        return (
          <View key={partner.id} style={r.partnerWrap}>
            <HomeServicePartnerCard
              partner={partner}
              row={row}
              lang={lang}
              serviceContext={serviceContext}
              region={region}
              onPress={() => setSelectedPartner({ partner, row, serviceContext, region })}
            />
          </View>
        )
      })
    }

    if (!selectedCategory) {
      return withPartner(
        <SafeAreaView style={r.safe} edges={['top']}>
          <UiHeader onBack={handleBack} title={t('hsTitle', lang)} lang={lang} />
          <ScrollView {...landingMem} contentContainerStyle={r.scroll} showsVerticalScrollIndicator={false}>
            <InfoBanner icon="ribbon-outline" category="homeLife" message={t('hsPartnersIntro', lang)} style={r.banner} />
            {partnerList(false)}
            <View style={r.grid}>
              {HS_CATEGORIES.map(cat => (
                <RCategoryTile key={cat.key} item={cat} lang={lang} onPress={() => selectCategory(cat.key)} />
              ))}
            </View>
            {HS_SELF_REGISTRATION && (
              <TouchableOpacity style={r.ctaCard} onPress={() => { if (onRequireAccount?.('gateHomeService')) return; setShowOnboarding(true) }} activeOpacity={press.card}>
                <View style={r.catIconWrap}>
                  <Ionicons name="add-circle-outline" size={26} color={CAT.homeLife.ink} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={r.ctaTitle}>{t('hsRegisterCTA', lang)}</Text>
                  <Text style={r.ctaSub}>{t('hsRegisterCTASub', lang)}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={C.textSecondary} />
              </TouchableOpacity>
            )}
          </ScrollView>
        </SafeAreaView>
      )
    }

    return withPartner(
      <SafeAreaView style={r.safe} edges={['top']}>
        <UiHeader onBack={handleBack} title={activeCat ? t(activeCat.labelKey, lang) : t('hsTitle', lang)} lang={lang} />
        <FilterBar>
          <Dropdown
            label={t('ddDistrict', lang)}
            lang={lang}
            options={HS_DISTRICTS.map(d => ({ value: d, label: districtLabel(d, lang) }))}
            value={selectedDistrict}
            onChange={setSelectedDistrict}
          />
        </FilterBar>
        <ScrollView contentContainerStyle={r.catScroll} showsVerticalScrollIndicator={false}>
          {partnerList(true)}
        </ScrollView>
      </SafeAreaView>
    )
  }

  // ─── Landing ──────────────────────────────────────────────────────────────

  if (!selectedCategory) {
    return withPartner(
      <SafeAreaView style={s.safe} edges={['top']}>
        <PageBackground topic="home_services" />
        <ScreenHeader onBack={handleBack} backLabel={t('back', lang)} title={t('hsTitle', lang)} lang={lang} />

        <ScrollView {...landingMem} contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          <MascotIntroCard
            module="house_services"
            subtitle={t('hsPartnersIntro', lang)}
            style={s.introCard}
          />

          {!loaded ? (
            <ActivityIndicator size="large" color={colors.primary} style={s.spinner} />
          ) : loadError ? (
            <ErrorState lang={lang} onRetry={retry} />
          ) : cards.length > 0 ? (
            cards.map(({ partner, row }) => (
              <View key={partner.id} style={s.partnerWrap}>
                <HomeServicePartnerCard
                  partner={partner}
                  row={row}
                  lang={lang}
                  // No category context on the landing, so the WhatsApp draft uses its
                  // generic fallback ("tadilat işleri" / "renovation work") and
                  // logContactEvent records no district. Both correct here: the user has
                  // not told us which job they mean.
                  serviceContext={null}
                  region={null}
                  onPress={() => setSelectedPartner({ partner, row, serviceContext: null, region: null })}
                />
              </View>
            ))
          ) : null}

          <View style={s.grid}>
            {HS_CATEGORIES.map(cat => (
              <CategoryTile
                key={cat.key}
                item={cat}
                lang={lang}
                onPress={() => selectCategory(cat.key)}
              />
            ))}
          </View>

          {/* Absent, not disabled. A greyed-out "List your services" would tell a
              tradesperson the door exists and is shut on them; nothing at all says the
              module is a curated list, which is what it is. */}
          {HS_SELF_REGISTRATION && (
            <TouchableOpacity style={s.ctaCard} onPress={() => { if (onRequireAccount?.('gateHomeService')) return; setShowOnboarding(true) }} activeOpacity={0.8}>
              <View style={s.ctaIconWrap}>
                <Ionicons name="add-circle-outline" size={28} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.ctaCardTitle}>{t('hsRegisterCTA', lang)}</Text>
                <Text style={s.ctaCardSub}>{t('hsRegisterCTASub', lang)}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </ScrollView>
      </SafeAreaView>
    )
  }

  // ─── One category ─────────────────────────────────────────────────────────
  //
  // Every partner card shows on EVERY category × district (Berke, 2026-09-28): TadilArt on
  // all 12 categories and all 7 district choices. The district no longer hides a card; it
  // only goes into the WhatsApp draft and the contact log. The card shows its own service
  // areas, and no "no partner / no firm" message exists anywhere in this module.
  const visible = cards

  // Whether the WhatsApp draft may name the category (the firm lists it as a service).
  // The "no ADA partner for {category}" banner this also drove was REMOVED (2026-09-28,
  // Berke): it sat above TadilArt's own card on 8 of the 12 categories and read as a bug.
  // A card on screen now ends the question; only a truly empty list says anything.
  const rowCovers = row => (row.service_types || []).includes(selectedCategory)

  return withPartner(
    <SafeAreaView style={s.safe} edges={['top']}>
      <PageBackground topic="home_services" />
      <ScreenHeader
        onBack={handleBack}
        backLabel={t('hsBackToCategories', lang)}
        title={activeCat ? t(activeCat.labelKey, lang) : t('hsTitle', lang)}
        lang={lang}
      />

      {/* İlçe dropdown (replacing the district chip row). flexShrink 0 — a fixed row above a
          scrolling body is otherwise compressed and its text cropped (CLAUDE.md). The district
          sets which partner covers you, so no counts: every district is always offered. */}
      <View style={s.ddRow}>
        <FilterDropdown
          label={t('ddDistrict', lang)}
          lang={lang}
          options={HS_DISTRICTS.map(d => ({ value: d, label: districtLabel(d, lang) }))}
          value={selectedDistrict}
          onChange={setSelectedDistrict}
        />
      </View>

      <ScrollView contentContainerStyle={s.catScroll} showsVerticalScrollIndicator={false}>
        {!loaded ? (
          <ActivityIndicator size="large" color={colors.primary} style={s.spinner} />
        ) : loadError ? (
          <ErrorState lang={lang} onRetry={retry} />
        ) : (
          <>
            {visible.map(({ partner, row }) => {
              // ⚠ COVERED-ONLY, and this is the honesty hinge of the whole promotion.
              // The context goes into the WhatsApp draft the user sends the firm. Passing
              // the active category unconditionally would draft a PLUMBING enquiry to a
              // renovation company because the user tapped a tile we chose to show them —
              // words they did not write, in a message sent under their name. The chips on
              // the card can advertise across categories; a message cannot.
              //
              // Read in the message's OWN language, never the user's: it is the FIRM that
              // reads it. See constants/partners.js.
              const serviceContext = rowCovers(row) && activeCat
                ? { tr: t(activeCat.labelKey, 'Turkish'), en: t(activeCat.labelKey, 'English') }
                : null
              return (
                <View key={partner.id} style={s.partnerWrap}>
                  <HomeServicePartnerCard
                    partner={partner}
                    row={row}
                    lang={lang}
                    serviceContext={serviceContext}
                    region={selectedDistrict}
                    onPress={() => setSelectedPartner({ partner, row, serviceContext, region: selectedDistrict })}
                  />
                </View>
              )
            })}

          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  ddRow: { flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 10, flexShrink: 0 },
  partnerOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 10, elevation: 10, backgroundColor: colors.bg },
  safe:         { flex: 1, backgroundColor: colors.bg },

  scroll:       { padding: 20, paddingBottom: 40 },
  catScroll:    { padding: 20, paddingBottom: 40 },
  introCard:    { marginBottom: 20 },
  spinner:      { marginTop: 32 },
  partnerWrap:  { marginBottom: 16 },

  grid:         { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 },
  catTile:      { width: '47%', backgroundColor: colors.cardBg, borderRadius: radius.card,
                  padding: 18, alignItems: 'center', gap: 10, ...shadow,
                  borderWidth: 1, borderColor: colors.border },
  catIconWrap:  { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primaryLight,
                  alignItems: 'center', justifyContent: 'center' },
  catLabel:     { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary,
                  textAlign: 'center' },

  districtRow:  { paddingHorizontal: 20, paddingVertical: 10, gap: 8, alignItems: 'center' },
  chip:         { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
                  backgroundColor: colors.cardBg, borderWidth: 1.5, borderColor: colors.border },
  chipActive:   { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  chipText:     { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  chipTextActive: { fontFamily: 'Inter_700Bold', color: colors.primary },


  ctaCard:      { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20,
                  backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 16,
                  ...shadow, borderWidth: 1, borderColor: colors.border },
  ctaIconWrap:  { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primaryLight,
                  alignItems: 'center', justifyContent: 'center' },
  ctaCardTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary,
                  marginBottom: 2 },
  ctaCardSub:   { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
})

const r = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: C.canvas },
  scroll:      { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 40 },
  catScroll:   { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 40 },
  banner:      { marginBottom: 16 },
  partnerWrap: { marginBottom: 16 },
  grid:        { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 },
  catTile:     { width: '47%', minHeight: 112, backgroundColor: C.card, borderRadius: radii.card,
                 padding: 16, alignItems: 'center', justifyContent: 'center', gap: 10, ...elevation.card },
  catIconWrap: { width: 48, height: 48, borderRadius: radii.tile, backgroundColor: CAT.homeLife.bg,
                 alignItems: 'center', justifyContent: 'center' },
  catLabel:    { ...type.small, fontFamily: 'Inter_600SemiBold', color: C.textPrimary, textAlign: 'center' },
  ctaCard:     { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20, backgroundColor: C.card,
                 borderRadius: radii.card, padding: 16, ...elevation.card },
  ctaTitle:    { ...type.rowTitle, color: C.textPrimary, marginBottom: 2 },
  ctaSub:      { ...type.small, color: C.textSecondary },
})
