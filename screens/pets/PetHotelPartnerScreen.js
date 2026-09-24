import { View, Text, Image, ScrollView, FlatList, TouchableOpacity, StyleSheet, Linking, useWindowDimensions } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import BackButton from '../../components/BackButton'
import PartnerLogoStrip from '../../components/PartnerLogoStrip'
import { colors, shadow, radius } from '../../constants/theme'
import { t, LANG_CODES } from '../../constants/i18n'
import { REGION_LABEL_KEY } from '../../constants/regions'
import { partnerAsset, partnerLogo } from '../../constants/partnerAssets'
import { petPartnerSections, petWaUrl, petPartnerWebsiteUrl, SECTION_ORDER } from '../../constants/petPartners'
import { logContactEvent } from '../../utils/logContactEvent'

// The pet hotel partner screen. Structure mirrors DormPartnerScreen and
// HomeServicePartnerScreen — navbar, hero, a stack of bordered blocks, a fixed contact bar
// — because that is the shape this app already uses for "one listed business, in full",
// and a third shape would be a third thing to maintain for no reader.
//
// ⚠ CONFIG-DRIVEN, SO PARTNER #2 IS A CONFIG ENTRY AND NOT A SCREEN EDIT. Every section
//   comes from petPartnerSections() and the ORDER comes from SECTION_ORDER, both in
//   constants/petPartners.js. This file contains no knowledge of Shiny Paw specifically
//   and no `if (slug === ...)`.
//
// ⚠ EMPTINESS IS NOT DECIDED HERE. petPartnerSections() returns null for a section with no
//   content and this file renders what it is given. That is the discipline partnerGallery()
//   established for TadilArt and dormSections() for Alasia, and it matters for two reasons
//   beyond tidiness: a screen-side `&&` chain cannot be tested without rendering, and it
//   gets copied wrong when the second partner arrives.
//
//   TODAY THAT MEANS FIVE SECTIONS RENDER, NOT SEVEN. `about` is a pending key and
//   `pricing` is declined by the partner, so the page is hero → services → practical →
//   location → contact. That is the FINISHED page for what Shiny Paw has told us, not a
//   degraded one: no empty rows, no "bilgi yok", no greyed placeholders. A greyed row tells
//   the user the app is broken; an absent section tells them nothing, which is the honest
//   answer when we know nothing.
//
// ─── NOT AN RTL-MIRRORED LAYOUT, AND THAT IS THE APP-WIDE CHOICE ────────────
//
// There is no I18nManager call anywhere in this codebase, so Arabic and Persian render
// right-to-left TEXT inside a left-to-right LAYOUT, exactly as every other screen does.
// This file follows that rather than inventing a one-off: no hardcoded textAlign on body
// copy, so each string aligns to its own script, and no row that would read backwards if
// mirrored. Turning on real RTL mirroring is an app-wide decision with an app-wide device
// pass behind it — not something one partner screen should start.

// Matches TowingDetailScreen, PropertyDetailScreen, DormPartnerScreen and
// HomeServicePartnerScreen: the figure that clears the absolute contact bar.
const CONTACT_BAR_CLEARANCE = 120

// One source for the horizontal gallery gap. The style and the snap interval must agree,
// and they cannot if the number is typed twice.
const STRIP_GAP = 10
// Same box as DormPartnerScreen's hero. PartnerLogoStrip fits a square mark to height x
// height, left-aligned, and renders nothing when no logo is wired.
const HERO_LOGO = { width: 200, height: 56 }

const StripGap = () => <View style={{ width: STRIP_GAP }} />

function Block({ title, children }) {
  return (
    <View style={s.block}>
      <Text style={s.blockTitle}>{title}</Text>
      {children}
    </View>
  )
}

// A contact row. Kept as one component because the four of them differ only in icon, label
// and handler. There is no email row, by decision (2026-09-24).
function ContactRow({ icon, label, value, onPress }) {
  return (
    <TouchableOpacity style={s.row} onPress={onPress} activeOpacity={0.6}>
      <Text style={s.rowLabel}>{label}</Text>
      <View style={s.rowRight}>
        {!!value && <Text style={[s.rowValue, s.rowValueLink]} numberOfLines={1}>{value}</Text>}
        <Ionicons name={icon} size={15} color={colors.primary} />
      </View>
    </TouchableOpacity>
  )
}

export default function PetHotelPartnerScreen({ partner, lang, region, onBack }) {
  const insets = useSafeAreaInsets()
  const { width: winW } = useWindowDimensions()
  if (!partner) return null

  // ⚠ `lang` IS A FULL NAME ('Turkish'), NOT A CODE. Derived here rather than taken as a
  //   prop, exactly as DormPartnerScreen does — one less thing a second call site can pass
  //   wrongly. Comparing `lang` against 'tr' anywhere downstream would send English to
  //   every Turkish speaker and look completely correct in review.
  const langCode = LANG_CODES[lang] || 'en'

  const sec = petPartnerSections(partner, { resolveAsset: partnerAsset })

  // t() returns the KEY when a string is missing, so a pending or withdrawn about block
  // must be compared against its own key name — otherwise the screen renders
  // "petHotelShinyPawAbout" to a user. Same guard HomeServicePartnerScreen carries, and the
  // reason PENDING_KEYS can exist at all.
  const aboutText = sec.about ? t(sec.about, lang) : ''
  const showAbout = !!aboutText && aboutText !== sec.about

  const districtKey = REGION_LABEL_KEY[partner.district]

  const CONTENT_W = winW - 32                       // s.content padding, both sides
  const SHOT_W    = Math.min(300, CONTENT_W * 0.86)
  // Derived from the same two numbers the layout uses. A hardcoded interval drifts the
  // moment either changes and the strip stops landing on a frame, which looks like the
  // scroll is broken rather than mistuned.
  const SNAP      = SHOT_W + STRIP_GAP

  // ─── CONTACT ACTIONS — FOUR, ALL FOUR LOG ──────────────────────────────────
  //
  // logContactEvent is fire-and-forget and can never throw. It is called on the line BEFORE
  // Linking.openURL precisely so a hanging analytics write cannot cost somebody their tap —
  // the rule utils/logContactEvent.js states at length.
  //
  // module is 'pets'. Verified against the LIVE database (pg_get_constraintdef, 2026-09-14)
  // rather than the migration file: contact_events_module_check permits 'pets' and
  // contact_events_action_check permits 'website'. That check is not paranoia — the CHECK
  // rejecting a value does not error here, it is swallowed, and the taps would read as a
  // permanent zero indistinguishable from nobody tapping. Both are now asserted by
  // DEFINITION in supabase/verify_schema.sql.
  const openWhatsApp = () => {
    const url = petWaUrl(partner, langCode)
    if (!url) return
    logContactEvent('pets', partner.id, 'whatsapp', region)
    Linking.openURL(url).catch(() => {})
  }
  const call = () => {
    const phone = String(partner.phone || '').replace(/\s/g, '')
    if (!phone) return
    logContactEvent('pets', partner.id, 'call', region)
    Linking.openURL(`tel:${phone}`).catch(() => {})
  }
  const openWebsite = () => {
    const url = petPartnerWebsiteUrl(partner)
    if (!url) return
    logContactEvent('pets', partner.id, 'website', region)
    Linking.openURL(url).catch(() => {})
  }
  // ⚠ THEIR maps LINK for directions, not `coords`. The partner-confirmed coords feed the
  //   Explore map pin; their own link stays the directions target. There is also
  //   no ADA rating here by decision — a config-only partner has no row to anchor one to —
  //   so this is the only review affordance on the screen, and their Wix testimonials are
  //   deliberately not imported.
  //
  // ⚠ THE DIRECTIONS TAP LOGS AS 'maps', ITS OWN ACTION. Until 2026-09-23 it did not log
  //   at all: contact_events_action_check had no 'maps', and logging it as 'website' would
  //   have folded two intentions into one number. 20261046 adds 'maps' to the CHECK;
  //   applied and verified 2026-09-23. DormPartnerScreen's directions log 'maps' too.
  const openMaps = () => {
    if (!sec.location?.mapsUrl) return
    logContactEvent('pets', partner.id, 'maps', region)
    Linking.openURL(sec.location.mapsUrl).catch(() => {})
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.navbar}>
        <BackButton lang={lang} onPress={onBack} />
        <Text style={s.navTitle} numberOfLines={1}>{partner.name}</Text>
        <View style={s.navSpacer} />
      </View>

      <ScrollView contentContainerStyle={[s.content, { paddingBottom: CONTACT_BAR_CLEARANCE + insets.bottom }]}>
        {/* ─── SECTIONS, IN CONFIG ORDER ────────────────────────────────────
            SECTION_ORDER in constants/petPartners.js decides the sequence, not this
            file's JSX position — so the order can change without a component edit. */}
        {SECTION_ORDER.map(id => {
          if (id === 'hero') return (
            <View key={id} style={s.hero}>
              <View style={s.badge}>
                <Ionicons name="ribbon-outline" size={12} color={colors.accent} />
                <Text style={s.badgeText}>{t('petHotelBadge', lang)}</Text>
              </View>

              {/* ⚠ LIGHT ONLY. The app has no dark theme (app.config.js userInterfaceStyle
                  'light'), so nothing passes 'dark' here. If one arrives, do NOT use
                  partnerLogo(partner, 'dark'): it falls back to `logo`, and Shiny Paw's mark
                  is keyed from white and breaks on dark (PENDING_FIELDS.logoOnDark). With
                  logoOnDark pending, a dark hero renders no logo at all. */}
              <PartnerLogoStrip
                source={partnerLogo(partner)}
                name={partner.name}
                width={HERO_LOGO.width}
                height={HERO_LOGO.height}
                style={{ marginBottom: 8 }}
              />

              {/* ⚠ DOG BOARDING, NEVER "PETS". The one claim on this page most likely to
                  drift: the surface sits inside a module called Evcil Hayvanlar and every
                  icon around it is a paw. partner.displayType is the source, so widening
                  it is a config edit the guard refuses. */}
              <Text style={s.heroName}>{partner.name}</Text>
              <View style={s.heroMetaRow}>
                <View style={s.typePill}>
                  <Ionicons name="paw" size={11} color={colors.primary} />
                  <Text style={s.typePillText}>{t('petHotelDogBoarding', lang)}</Text>
                </View>
                {!!districtKey && (
                  <View style={s.metaItem}>
                    <Ionicons name="location-outline" size={13} color={colors.textSecondary} />
                    <Text style={s.metaText}>{t(districtKey, lang)}</Text>
                  </View>
                )}
              </View>

              {/* Photos carry their OWN aspect from config. A single container aspect for a
                  mixed set centre-crops whichever photo disagrees — which for a 512x640
                  portrait is most of the subject. */}
              {/* ⚠ WINDOWED, NOT A ScrollView. A horizontal ScrollView mounts every child, and
                  an Image starts loading when it mounts, not when it scrolls into view, so all
                  five photos decoded together as the hero rendered. windowSize 3 keeps about one
                  viewport either side mounted. The cost: a frame scrolled far out of the window
                  unmounts, and on the way back it shows the sand ground while it decodes again. */}
              {!!sec.photos && (
                <FlatList
                  horizontal
                  data={sec.photos}
                  keyExtractor={(_, i) => String(i)}
                  renderItem={({ item: ph }) => (
                    <View style={[s.shot, { width: SHOT_W, aspectRatio: ph.aspect }]}>
                      <Image source={ph.source} style={s.shotImg} resizeMode="cover" />
                    </View>
                  )}
                  ItemSeparatorComponent={StripGap}
                  // Offsets from the same numbers the layout uses (16 = s.strip paddingHorizontal),
                  // so windowing never waits on measurement.
                  getItemLayout={(_, i) => ({ length: SHOT_W, offset: 16 + i * SNAP, index: i })}
                  initialNumToRender={2}
                  maxToRenderPerBatch={1}
                  windowSize={3}
                  showsHorizontalScrollIndicator={false}
                  snapToInterval={SNAP}
                  snapToAlignment="start"
                  decelerationRate="fast"
                  contentContainerStyle={s.strip}
                  style={s.stripWrap}
                />
              )}
            </View>
          )

          if (id === 'about' && showAbout) return (
            <Block key={id} title={t('petHotelAbout', lang)}>
              <Text style={s.about}>{aboutText}</Text>
            </Block>
          )

          if (id === 'services' && !!sec.services) return (
            <Block key={id} title={t('petHotelServices', lang)}>
              {sec.services.map(sv => (
                <View key={sv.id} style={s.service}>
                  <View style={s.serviceIcon}>
                    <Ionicons name={sv.icon} size={18} color={colors.primary} />
                  </View>
                  <View style={s.serviceBody}>
                    <Text style={s.serviceTitle}>{t(sv.titleKey, lang)}</Text>
                    <Text style={s.serviceText}>{t(sv.bodyKey, lang)}</Text>
                  </View>
                </View>
              ))}
            </Block>
          )

          // Each value is an i18n key (petPartnerSections), so a value renders in the
          // reader's language like its label does.
          if (id === 'practical' && !!sec.practical) return (
            <Block key={id} title={t('petHotelPractical', lang)}>
              {sec.practical.map(r => (
                <View key={r.id} style={s.row}>
                  <Text style={s.rowLabel}>{t(r.labelKey, lang)}</Text>
                  <Text style={s.rowValue}>{t(r.value, lang)}</Text>
                </View>
              ))}
            </Block>
          )

          if (id === 'pricing' && !!sec.pricing) return (
            <Block key={id} title={t('petHotelPricing', lang)}>
              <Text style={s.about}>{sec.pricing}</Text>
            </Block>
          )

          if (id === 'location' && !!sec.location) return (
            <Block key={id} title={t('petHotelLocation', lang)}>
              {/* Address is pending. When it arrives it renders here with no screen edit;
                  until then this block is the directions button alone, which is a real
                  affordance rather than a placeholder for one. */}
              {!!sec.location.address && <Text style={s.about}>{sec.location.address}</Text>}
              {!!sec.location.mapsUrl && (
                <TouchableOpacity style={s.mapsBtn} onPress={openMaps} activeOpacity={0.85}>
                  <Ionicons name="navigate-outline" size={16} color={colors.primary} />
                  <Text style={s.mapsBtnText}>{t('petHotelDirections', lang)}</Text>
                </TouchableOpacity>
              )}
            </Block>
          )

          if (id === 'contact') return (
            <Block key={id} title={t('petHotelContact', lang)}>
              {sec.contact.includes('whatsapp') && (
                <ContactRow icon="logo-whatsapp" label={t('petHotelWhatsApp', lang)}
                  value={partner.whatsapp} onPress={openWhatsApp} />
              )}
              {sec.contact.includes('call') && (
                <ContactRow icon="call-outline" label={t('petHotelCall', lang)}
                  value={partner.phone} onPress={call} />
              )}
              {sec.contact.includes('website') && (
                <ContactRow icon="globe-outline" label={t('petHotelWebsite', lang)}
                  value={null} onPress={openWebsite} />
              )}
              {sec.contact.includes('maps') && (
                <ContactRow icon="navigate-outline" label={t('petHotelDirections', lang)}
                  value={null} onPress={openMaps} />
              )}
            </Block>
          )

          return null
        })}
      </ScrollView>

      {/* WhatsApp and call only. Website and directions are rows in the contact block — a
          four-button bar at 320dp gives each button 68pt, which clips every Turkish label
          on it. Same split DormPartnerScreen uses. */}
      <View style={[s.contactBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        {sec.contact.includes('whatsapp') && (
          <TouchableOpacity style={s.waBtn} onPress={openWhatsApp} activeOpacity={0.85}>
            <Ionicons name="logo-whatsapp" size={18} color="#fff" />
            <Text style={s.barBtnText} numberOfLines={1}>{t('petHotelWhatsApp', lang)}</Text>
          </TouchableOpacity>
        )}
        {sec.contact.includes('call') && (
          <TouchableOpacity style={s.callBtn} onPress={call} activeOpacity={0.85}>
            <Ionicons name="call" size={18} color="#fff" />
            <Text style={s.barBtnText} numberOfLines={1}>{t('petHotelCall', lang)}</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: colors.bg },
  navbar:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
                  paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border,
                  backgroundColor: colors.cardBg, gap: 10 },
  navTitle:     { flex: 1, fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  navSpacer:    { width: 24 },

  content:      { padding: 16 },

  hero:         { paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  badge:        { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4,
                  backgroundColor: colors.accentLight, paddingHorizontal: 8, paddingVertical: 3,
                  borderRadius: 10, marginBottom: 12 },
  badgeText:    { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.accent },
  heroName:     { fontSize: 20, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  // flexWrap, because Turkish "Köpek pansiyonu" beside a district name overflows 320dp.
  heroMetaRow:  { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  typePill:     { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primaryLight,
                  paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  typePillText: { fontSize: 11.5, fontFamily: 'Inter_700Bold', color: colors.primary },
  metaItem:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText:     { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },

  stripWrap:    { marginTop: 14, marginHorizontal: -16 },
  // paddingHorizontal equals the content padding so the first frame lines up with the text
  // above it and the last one has the same breathing room as the gap between frames.
  strip:        { paddingHorizontal: 16 },
  shot:         { borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.sand },
  shotImg:      { width: '100%', height: '100%' },

  block:        { paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: colors.border },
  blockTitle:   { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase',
                  color: colors.textSecondary, fontFamily: 'Inter_700Bold', marginBottom: 10 },

  about:        { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_400Regular', color: colors.textPrimary },

  // Icon BESIDE the text, not above it: unlike HomeServicePartnerScreen's 12 category
  // tiles these are six full sentences, so the body needs the width and the icon is a
  // marker rather than the content.
  service:      { flexDirection: 'row', gap: 12, marginBottom: 14 },
  serviceIcon:  { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primaryLight,
                  alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  serviceBody:  { flex: 1 },
  serviceTitle: { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 3 },
  serviceText:  { fontSize: 13, lineHeight: 19, fontFamily: 'Inter_400Regular', color: colors.textSecondary },

  mapsBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                  borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.sm,
                  paddingVertical: 11, marginTop: 10, backgroundColor: 'transparent' },
  mapsBtnText:  { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.primary },

  row:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                  paddingVertical: 7, gap: 12 },
  rowLabel:     { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, flexShrink: 0 },
  // textAlign right: a practical value that wraps (ru/el/es/fr/ar/fa at 320dp, measured
  // 2026-09-24) must hug the right edge like the single-line values above and below it,
  // not start mid-row. Contact-row values are single-line, so they are unchanged.
  rowValue:     { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textPrimary, flexShrink: 1, textAlign: 'right' },
  rowValueLink: { color: colors.primary },
  rowRight:     { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },

  contactBar:   { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row',
                  alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 12,
                  backgroundColor: colors.cardBg, borderTopWidth: 1, borderTopColor: colors.border,
                  ...shadow },
  waBtn:        { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                  gap: 8, backgroundColor: '#25D366', paddingVertical: 13, borderRadius: radius.sm },
  callBtn:      { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                  gap: 8, backgroundColor: colors.primary, paddingVertical: 13, borderRadius: radius.sm },
  barBtnText:   { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_700Bold', flexShrink: 1 },
})
