import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import HomeServiceIcon from './HomeServiceIcon'
import PartnerLogoStrip from './PartnerLogoStrip'
import { partnerLogo } from '../constants/partnerAssets'
import { colors, shadow, radius } from '../constants/theme'
import { t } from '../constants/i18n'
import { hsCategory, HS_DISTRICT_LABEL_KEY } from '../constants/homeServices'
import { partnerWaMessage } from '../constants/partners'
import { logContactEvent } from '../utils/logContactEvent'

// The pinned card for a commercial partner, on the Ev Hizmetleri landing and at the top
// of each category list the partner covers.
//
// IT IS NOT A SHOWCASE COMPONENT AND MUST NOT BECOME ONE. Everything specific to a firm
// arrives as props from constants/partners.js plus the firm's own home_services row, so
// a second partner is a config entry. But it is also not an abstraction over "partner
// surfaces in general" — two implementations is not enough to generalise from, and
// Phase 3's detail screen deliberately repeats structure rather than sharing it. Revisit
// at partner #3, not before.
//
// ─── EMPTY-SAFE, MEANING ABSENT AND NOT DISABLED ────────────────────────────
// No logo → an initials monogram, which is a finished state (components/TowingLogo.js
// does the same). No tagline → the line is gone, not blank. No service types → no chip
// row. There is no website affordance at all: TadilArt has no site, and a greyed-out
// link that goes nowhere tells the user the app is broken rather than that the firm has
// no website.

// ─── THE LOGO IS A WIDE STRIP, STACKED ABOVE THE NAME ──────────────────────
//
// It replaced a 46px square, which rendered TadilArt's 3.5:1 wordmark about 11pt tall
// and unreadable. The strip is 140x40 here and 200x56 on the detail hero.
//
// STACKED, not beside the name, and that is a measurement fact rather than taste: the
// card's inner width at 320dp is 244pt, so a 140pt strip in the identity ROW would have
// left the name about 92pt — and "TadilArt Cyprus" measures ~128pt at 16/700. The name
// would have ellipsised to "TadilArt Cyp…" on every narrow phone. Stacking gives both
// the full width.
const LOGO_STRIP = { width: 140, height: 40 }

export default function HomeServicePartnerCard({
  partner,          // the constants/partners.js entry
  row,              // the live home_services row — the card renders nothing without it
  lang,
  serviceContext,   // { tr, en } service name for the WhatsApp draft, or null on the landing
  region,           // active district chip, for logContactEvent; null on the landing
  onPress,          // opens the partner detail screen; omit and the card is inert
}) {
  // The row is the authority on existence. It is fetched with status='active', so a
  // partner that has not been approved yet simply has no card — which is the same
  // absence a user saw before the partnership, not a broken one.
  if (!partner || !row) return null

  const phone = String(row.phone || '').replace(/\s/g, '')
  const waNum = String(row.whatsapp || row.phone || '').replace(/\D/g, '')

  const coverage = (row.coverage_districts || [])
    .map(d => HS_DISTRICT_LABEL_KEY[d])
    .filter(Boolean)
    .map(k => t(k, lang))
    .join(' · ')

  const services = (row.service_types || []).map(hsCategory).filter(Boolean)

  // Logged BEFORE the link fires and never awaited — see utils/logContactEvent.js. The
  // entity is the partner's home_services id, which is what contact_events_monthly
  // groups by, and `region` is the district chip the user was filtering on (NULL on the
  // landing, which is a real state and not a gap).
  const openWhatsApp = () => {
    if (!waNum) return
    logContactEvent('homeServices', row.id, 'whatsapp', region)
    // encodeURIComponent, always: an unescaped `ı` or `ş` in the query string produces a
    // link some Android WhatsApp builds refuse to open, and the failure is silent.
    const msg = encodeURIComponent(partnerWaMessage(lang, serviceContext))
    Linking.openURL(`https://wa.me/${waNum}?text=${msg}`)
  }

  const call = () => {
    if (!phone) return
    logContactEvent('homeServices', row.id, 'call', region)
    Linking.openURL(`tel:${phone}`)
  }

  const tagline = partner.taglineKey ? t(partner.taglineKey, lang) : ''
  // t() returns the key itself when a string is missing, so an unwritten tagline would
  // render as "hsPartnerTadilartTagline" on someone's phone. Absent, not raw.
  const showTagline = !!tagline && tagline !== partner.taglineKey

  // The whole card opens the detail screen; the two buttons do not. No plumbing is
  // needed for that — React Native's responder system gives the gesture to the INNERMOST
  // touchable, so a tap on WhatsApp never reaches this wrapper. `Wrap` degrades to a
  // plain View when no onPress is supplied, so a future inert mount is not a special case.
  const Wrap = onPress ? TouchableOpacity : View
  const wrapProps = onPress ? { onPress, activeOpacity: 0.9 } : {}

  return (
    <Wrap style={s.card} {...wrapProps}>
      <View style={s.badge}>
        <Ionicons name="ribbon-outline" size={12} color={colors.accent} />
        <Text style={s.badgeText}>{t('hsPartnerBadge', lang)}</Text>
      </View>

      <PartnerLogoStrip
        source={partnerLogo(partner)}
        name={row.name}
        width={LOGO_STRIP.width}
        height={LOGO_STRIP.height}
        style={s.logoStrip}
      />

      <Text style={s.name} numberOfLines={1}>{row.name}</Text>
      {showTagline && <Text style={s.tagline} numberOfLines={2}>{tagline}</Text>}

      {services.length > 0 && (
        <View style={s.chipRow}>
          {services.map(cat => (
            <View key={cat.key} style={s.chip}>
              <HomeServiceIcon category={cat} size={12} color={colors.primary} />
              <Text style={s.chipText}>{t(cat.labelKey, lang)}</Text>
            </View>
          ))}
        </View>
      )}

      {!!coverage && (
        <View style={s.coverageRow}>
          <Ionicons name="location-outline" size={13} color={colors.textSecondary} />
          <Text style={s.coverageText} numberOfLines={1}>{coverage}</Text>
        </View>
      )}

      <View style={s.btnRow}>
        {!!waNum && (
          <TouchableOpacity style={s.waBtn} onPress={openWhatsApp} activeOpacity={0.8}>
            <Ionicons name="logo-whatsapp" size={15} color="#fff" />
            <Text style={s.btnText}>{t('hsWhatsApp', lang)}</Text>
          </TouchableOpacity>
        )}
        {!!phone && (
          <TouchableOpacity style={s.callBtn} onPress={call} activeOpacity={0.8}>
            <Ionicons name="call-outline" size={15} color="#fff" />
            <Text style={s.btnText}>{t('hsCall', lang)}</Text>
          </TouchableOpacity>
        )}
      </View>
    </Wrap>
  )
}

const s = StyleSheet.create({
  // backgroundColor is EXPLICIT, not inherited: on Android a View with both borderRadius
  // and borderWidth renders an opaque background unless one is set.
  card:          { backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 16,
                   borderWidth: 2, borderColor: colors.accent, ...shadow },

  badge:         { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4,
                   backgroundColor: colors.accentLight, paddingHorizontal: 8, paddingVertical: 3,
                   borderRadius: 10, marginBottom: 10 },
  badgeText:     { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.accent },

  logoStrip:     { marginBottom: 10 },
  name:          { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  tagline:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                   lineHeight: 18, marginTop: 2 },

  chipRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  chip:          { flexDirection: 'row', alignItems: 'center', gap: 4,
                   backgroundColor: colors.primaryLight, paddingHorizontal: 8, paddingVertical: 4,
                   borderRadius: 10 },
  chipText:      { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.primaryDark },

  coverageRow:   { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10 },
  coverageText:  { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary },

  btnRow:        { flexDirection: 'row', gap: 10, marginTop: 14 },
  waBtn:         { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                   gap: 6, backgroundColor: '#25D366', borderRadius: radius.md, paddingVertical: 10 },
  callBtn:       { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                   gap: 6, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 10 },
  btnText:       { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
})
