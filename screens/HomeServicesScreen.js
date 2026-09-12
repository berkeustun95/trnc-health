import { useState, useEffect } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
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
// ⚠ THE DISTRICT RULE IS NOW AN EXPLICIT PREDICATE, and Phase B's comment warned against
//   exactly this shape ("reading a config id and pinning unconditionally would put
//   TadilArt at the top of Girne even on a day the partnership stopped covering it").
//   The warning still stands and the predicate still honours it — `covers()` reads
//   coverage_districts off the row, so the pin disappears from a district the agreement
//   does not cover, same as before. What changed is that it is now WRITTEN DOWN rather
//   than falling out of the query. Do not "simplify" it back to an unconditional pin.
//
// Promotion is across CATEGORIES, never across DISTRICTS.

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

// ─── The two empty states, which are NOT the same statement ─────────────────
//
// Neither is "no providers found". That string was honest when this was a directory
// anyone could join; under a partner-only policy it describes a search that failed,
// when what actually happened is that we have not signed anybody. It tells the user
// ADA cannot help with this — the opposite of true, since the pinned firm is sitting
// right above it in the eight-category case.
//
// The titles differ because the CLAIMS differ, and each is false in the other's case:
//
//   "No OTHER listings"        false when no card rendered at all — there is nothing for
//                              the other listings to be other THAN.
//   "None in this district"    false when no district chip is active. That is reachable
//                              without any partner problem at all: it is what a failed
//                              fetch looks like, and blaming the district for a network
//                              error would send the user chip-hunting for a list that was
//                              never filtered.
//
// So the third case falls back to the landing's own copy, which is the one honest
// statement when we have no rows and no filter to blame.
function EmptyNote({ titleKey, bodyKey, lang }) {
  return (
    <View style={s.emptyCard}>
      <Ionicons name="ribbon-outline" size={30} color={colors.border} style={s.emptyIcon} />
      <Text style={s.emptyTitle}>{t(titleKey, lang)}</Text>
      <Text style={s.emptyHint}>{t(bodyKey, lang)}</Text>
    </View>
  )
}

export default function HomeServicesScreen({ lang, session, onBack, onRequireAccount }) {
  // Held as a { partner, row } pair rather than an id, because the row is already in
  // hand at the tap site and re-fetching it would give the screen a loading state it
  // does not need.
  const [selectedPartner,  setSelectedPartner]  = useState(null)
  const [selectedCategory, setSelectedCategory] = useState(null)
  const [selectedDistrict, setSelectedDistrict] = useState(null)
  const [showOnboarding,   setShowOnboarding]   = useState(false)
  const [fetchedRows,      setFetchedRows]      = useState([])
  // Distinguishes "still asking" from "asked, and there are none". Without it the empty
  // state flashes for the length of the round trip on every open. Starts true in preview,
  // where the fixture is available synchronously and no request is made.
  const [loaded,           setLoaded]           = useState(PARTNER_PREVIEW)

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
      // same reason utils/logContactEvent.js passes two. A failed fetch lands on the
      // empty state, which is the honest thing to show when we could not ask.
      .then(
        ({ data }) => { if (alive) { setFetchedRows(data || []); setLoaded(true) } },
        ()          => { if (alive) setLoaded(true) },
      )
    return () => { alive = false }
  }, [])

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

  if (selectedPartner) {
    return (
      <HomeServicePartnerScreen
        partner={selectedPartner.partner}
        row={selectedPartner.row}
        lang={lang}
        serviceContext={selectedPartner.serviceContext}
        region={selectedPartner.region}
        onBack={() => setSelectedPartner(null)}
      />
    )
  }

  // ORDER COMES FROM THE CONFIG, not from the database. HS_PARTNERS is the display
  // truth — it holds the tagline, the logo and the gallery — and a partner with a row
  // but no config entry could not be rendered anyway. Mapping the config also means the
  // running order is something a person chose rather than whatever the query returned.
  const cards = HS_PARTNERS
    .map(partner => ({ partner, row: partnerRows.find(r => r.id === partner.id) }))
    .filter(x => x.row)

  const activeCat = hsCategory(selectedCategory)

  // ─── Landing ──────────────────────────────────────────────────────────────

  if (!selectedCategory) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <PageBackground topic="home_services" />
        <ScreenHeader onBack={handleBack} backLabel={t('back', lang)} title={t('hsTitle', lang)} lang={lang} />

        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          <MascotIntroCard
            module="house_services"
            subtitle={t('hsPartnersIntro', lang)}
            style={s.introCard}
          />

          {!loaded ? (
            <ActivityIndicator size="large" color={colors.primary} style={s.spinner} />
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
          ) : (
            // A legitimately empty state, not an error one — and it is what a failed
            // fetch shows too, which is honest, because "we could not ask" and "there are
            // none" are indistinguishable to someone holding the phone.
            <View style={s.emptyCard}>
              <Ionicons name="ribbon-outline" size={34} color={colors.border} style={s.emptyIcon} />
              <Text style={s.emptyTitle}>{t('hsPartnersEmpty', lang)}</Text>
              <Text style={s.emptyHint}>{t('hsPartnersEmptyHint', lang)}</Text>
            </View>
          )}

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
  // `visible` applies the district rule. It reads the ROW, never the config —
  // coverage_districts is what an admin can correct, and constants/partners.js does not
  // carry it on purpose.
  //
  // There is deliberately no list-level `covered` flag any more: whether the partner
  // covers this category no longer changes what is RENDERED, only what goes into the
  // WhatsApp draft, which is a per-row question answered at the card below.
  const visible = selectedDistrict
    ? cards.filter(({ row }) => (row.coverage_districts || []).includes(selectedDistrict))
    : cards

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <PageBackground topic="home_services" />
      <ScreenHeader
        onBack={handleBack}
        backLabel={t('hsBackToCategories', lang)}
        title={activeCat ? t(activeCat.labelKey, lang) : t('hsTitle', lang)}
        lang={lang}
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // flexShrink: 0 is not decoration. This row is a fixed-height sibling ABOVE a
        // scrollable body in a flex column; without it the row is vertically COMPRESSED
        // once the body overflows and the chip text is cropped top and bottom.
        style={{ flexGrow: 0, flexShrink: 0 }}
        contentContainerStyle={s.districtRow}
      >
        <TouchableOpacity
          style={[s.chip, !selectedDistrict && s.chipActive]}
          onPress={() => setSelectedDistrict(null)}
        >
          <Text style={[s.chipText, !selectedDistrict && s.chipTextActive]}>
            {t('hsAllDistricts', lang)}
          </Text>
        </TouchableOpacity>
        {HS_DISTRICTS.map(d => (
          <TouchableOpacity
            key={d}
            style={[s.chip, selectedDistrict === d && s.chipActive]}
            onPress={() => setSelectedDistrict(selectedDistrict === d ? null : d)}
          >
            <Text style={[s.chipText, selectedDistrict === d && s.chipTextActive]}>
              {districtLabel(d, lang)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={s.catScroll} showsVerticalScrollIndicator={false}>
        {!loaded ? (
          <ActivityIndicator size="large" color={colors.primary} style={s.spinner} />
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
              const rowCovers = (row.service_types || []).includes(selectedCategory)
              const serviceContext = rowCovers && activeCat
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

            {/* ⚠ A RENDERED CARD ENDS THE QUESTION. If anything is on screen, nothing is
                said about what is not — including in the eight categories the partner
                does not cover. The card carries its own service chips and its ADA-partner
                badge, so a reader can see exactly what the firm does; adding "no other
                listings in this category" underneath tells them nothing the card has not
                already told them, and spends the space arguing about absence instead.
                (An earlier build showed it for the eight. Removed on the partner's read of
                the page, and it is the better call on its own merits.)

                So the copy survives ONLY where the screen would otherwise be BLANK. */}
            {visible.length > 0 ? null
              : selectedDistrict ? (
                <EmptyNote titleKey="hsCatEmptyDistrictTitle" bodyKey="hsCatEmptyBody" lang={lang} />
              ) : (
                // No rows and no filter to blame — the partner list is empty, or the
                // fetch failed. Same statement the landing makes, for the same reason:
                // "we could not ask" and "there are none" are indistinguishable to
                // someone holding the phone, and neither is the district's fault.
                <EmptyNote titleKey="hsPartnersEmpty" bodyKey="hsPartnersEmptyHint" lang={lang} />
              )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
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

  emptyCard:    { backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 24,
                  alignItems: 'center', ...shadow, borderWidth: 1, borderColor: colors.border },
  emptyIcon:    { marginBottom: 10 },
  emptyTitle:   { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary,
                  textAlign: 'center', marginBottom: 4 },
  emptyHint:    { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                  textAlign: 'center', lineHeight: 19 },

  ctaCard:      { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20,
                  backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 16,
                  ...shadow, borderWidth: 1, borderColor: colors.border },
  ctaIconWrap:  { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primaryLight,
                  alignItems: 'center', justifyContent: 'center' },
  ctaCardTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary,
                  marginBottom: 2 },
  ctaCardSub:   { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
})
