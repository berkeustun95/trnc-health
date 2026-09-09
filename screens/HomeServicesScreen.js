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
import HomeServicePartnerCard from '../components/HomeServicePartnerCard'
import { colors, shadow, radius } from '../constants/theme'
import { t } from '../constants/i18n'
import { HS_PARTNERS, HS_PARTNER_IDS } from '../constants/partners'
import { PREVIEW_PENDING_PARTNERS, HS_SELF_REGISTRATION } from '../constants/flags'
import { PREVIEW_PARTNER_ROWS } from '../constants/partnerPreview'
import HomeServicePartnerScreen from './HomeServicePartnerScreen'
import HomeServiceOnboardingScreen from './HomeServiceOnboardingScreen'

// ─── Ev Hizmetleri — a CURATED PARTNER LIST, not a directory ────────────────
//
// The 12-tile category grid, the district filter chips and the filterable provider list
// are GONE as of the partner-only policy. They are not gated, they are removed: with
// hs_select_public requiring is_partner (20261012), a category list could only ever
// return partner rows, so the grid would have been twelve doors onto one firm — eight of
// them onto nothing at all. Reverting the policy means reverting those commits, not
// flipping a boolean; the SQL half has its own revert block in 20261012.
//
// ⚠ NO BRANCH ON HS_PARTNERS.length. With one partner this screen is thin, and that is
//   accepted deliberately: opening straight into a single firm's detail page would make
//   the module structurally mean "TadilArt", and partner #2 would then be a rebuild
//   rather than a config entry. The shape must not change when the second one arrives.
//
// The copy carries the difference. This is not "find a tradesperson" — nothing here
// invites a search, and the intro says whose firms these are.

const PARTNER_PREVIEW = __DEV__ && PREVIEW_PENDING_PARTNERS

export default function HomeServicesScreen({ lang, session, onBack, onRequireAccount }) {
  // Held as a { partner, row } pair rather than an id, because the row is already in
  // hand at the tap site and re-fetching it would give the screen a loading state it
  // does not need.
  const [selectedPartner, setSelectedPartner] = useState(null)
  const [showOnboarding,  setShowOnboarding]  = useState(false)
  const [fetchedRows,     setFetchedRows]     = useState([])
  // Distinguishes "still asking" from "asked, and there are none". Without it the empty
  // state flashes for the length of the round trip on every open — and with the grid
  // gone there is nothing else on screen to cover it. Starts true in preview, where the
  // fixture is available synchronously and no request is made.
  const [loaded,          setLoaded]          = useState(PARTNER_PREVIEW)

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

  function handleBack() {
    if (selectedPartner) setSelectedPartner(null)
    else onBack()
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
                // No category context on a partner list, so the WhatsApp draft uses its
                // generic fallback ("tadilat işleri" / "renovation work") and
                // logContactEvent records no district. Both are correct here: the user
                // has not told us which job they mean.
                serviceContext={null}
                region={null}
                onPress={() => setSelectedPartner({ partner, row, serviceContext: null, region: null })}
              />
            </View>
          ))
        ) : (
          // A legitimately empty state, not an error one: before the first partner is
          // approved this is exactly what the module is. It says so calmly instead of
          // looking broken — and it is what a failed fetch shows too, which is honest,
          // because "we could not ask" and "there are none" are indistinguishable to
          // someone holding the phone.
          <View style={s.emptyCard}>
            <Ionicons name="ribbon-outline" size={34} color={colors.border} style={s.emptyIcon} />
            <Text style={s.emptyTitle}>{t('hsPartnersEmpty', lang)}</Text>
            <Text style={s.emptyHint}>{t('hsPartnersEmptyHint', lang)}</Text>
          </View>
        )}

        {/* Absent, not disabled. A greyed-out "List your services" would tell a
            tradesperson the door exists and is shut on them; nothing at all says the
            module is a curated list, which is what it now is. */}
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

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: colors.bg },

  scroll:       { padding: 20, paddingBottom: 40 },
  introCard:    { marginBottom: 20 },
  spinner:      { marginTop: 32 },
  partnerWrap:  { marginBottom: 16 },

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
