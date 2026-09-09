import { View, Text, Image, ScrollView, TouchableOpacity, StyleSheet, Linking, useWindowDimensions } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import BackButton from '../components/BackButton'
import HomeServiceIcon from '../components/HomeServiceIcon'
import PartnerLogoStrip from '../components/PartnerLogoStrip'
import { colors, shadow, radius } from '../constants/theme'
import { t } from '../constants/i18n'
import { hsCategory, HS_DISTRICT_LABEL_KEY } from '../constants/homeServices'
import { partnerWaMessage, partnerGallery } from '../constants/partners'
import { partnerLogo, partnerAsset } from '../constants/partnerAssets'
import { logContactEvent } from '../utils/logContactEvent'

// The partner detail screen. Structure mirrors TowingDetailScreen — navbar, hero, a stack
// of bordered blocks, a fixed contact bar — because that is the shape this app already
// uses for "one listed business, in full", and a second shape would be a second thing to
// maintain for no reader.
//
// ⚠ DELIBERATELY NOT A SHARED PartnerShowcase. Two implementations is not enough to
//   abstract from: this screen and the pinned card genuinely differ (a card is a summary
//   with two buttons, this is a portfolio), and the parts they do share are already
//   shared — PartnerLogoStrip, HomeServiceIcon, partnerWaMessage, partnerGallery. What
//   would be left to extract is layout, which is the part most likely to diverge at
//   partner #3. Revisit then, with three examples in front of you.
//
// EMPTY-SAFE, MEANING ABSENT AND NOT DISABLED. No about copy, no gallery and no logo and
// the screen still reads as finished: hero, services, contact. There is no website
// affordance at all — TadilArt has none, and a greyed-out link that goes nowhere tells
// the user the app is broken rather than that the firm has no website.

const HERO_LOGO = { width: 200, height: 56 }

// One source for the horizontal gallery gap. The style and the snap interval must agree,
// and they cannot if the number is typed twice.
const STRIP_GAP = 10

// A project that does not declare `aspect` still renders. Square is the neutral choice —
// it favours neither orientation, so an undeclared project is cropped evenly rather than
// gutted on whichever axis a guess happened to pick. A non-positive or non-finite value
// is treated as absent for the same reason: a container with aspectRatio 0 or NaN
// collapses to nothing and the photo silently disappears.
const ASPECT_FALLBACK = 1
const projectAspect = p =>
  (Number.isFinite(p?.aspect) && p.aspect > 0 ? p.aspect : ASPECT_FALLBACK)

function Block({ title, children }) {
  return (
    <View style={s.block}>
      <Text style={s.blockTitle}>{title}</Text>
      {children}
    </View>
  )
}

// A photo with its label drawn OVER it. The label is always a translated string; the
// source posts had English "Before" / "In Progress" burned into the artwork, which is a
// caption seven of our nine locales cannot read and no translation can reach.
function Shot({ source, label, width, aspect }) {
  return (
    <View style={[s.shot, { width, aspectRatio: aspect }]}>
      <Image source={source} style={s.shotImg} resizeMode="cover" />
      {!!label && (
        <View style={s.shotLabel}>
          <Text style={s.shotLabelText} numberOfLines={1}>{label}</Text>
        </View>
      )}
    </View>
  )
}

export default function HomeServicePartnerScreen({
  partner, row, lang, serviceContext, region, onBack,
}) {
  const insets = useSafeAreaInsets()
  const { width: winW } = useWindowDimensions()
  if (!partner || !row) return null

  const phone = String(row.phone || '').replace(/\s/g, '')
  const waNum = String(row.whatsapp || row.phone || '').replace(/\D/g, '')

  const coverage = (row.coverage_districts || [])
    .map(d => HS_DISTRICT_LABEL_KEY[d]).filter(Boolean).map(k => t(k, lang)).join(' · ')
  const services = (row.service_types || []).map(hsCategory).filter(Boolean)

  // t() returns the KEY when a string is missing, so an unapproved or withdrawn about
  // block must be compared against its own key name — otherwise the screen renders
  // "hsPartnerTadilartAbout" to a user.
  const about     = partner.aboutKey ? t(partner.aboutKey, lang) : ''
  const showAbout = !!about && about !== partner.aboutKey

  // The gallery decides its own emptiness, once, in constants/partners.js. This screen
  // renders what it returns and makes no such judgement of its own — which is why a
  // half-wired pair cannot leak through as a lone "before" photo.
  const gallery = partnerGallery(partner, partnerAsset)

  const CONTENT_W = winW - 32               // s.content padding, both sides
  const PAIR_W    = (CONTENT_W - 8) / 2     // two shots + s.pairRow gap
  const STEP_W    = Math.min(240, CONTENT_W * 0.62)
  // The snap interval is the item plus the gap, and it has to be DERIVED from the same
  // two numbers the layout uses — a hardcoded interval drifts the moment either changes
  // and the strip stops landing on a frame, which looks like the scroll is broken rather
  // than mistuned.
  const SNAP      = STEP_W + STRIP_GAP

  const openWhatsApp = () => {
    if (!waNum) return
    logContactEvent('homeServices', row.id, 'whatsapp', region)
    Linking.openURL(`https://wa.me/${waNum}?text=${encodeURIComponent(partnerWaMessage(lang, serviceContext))}`)
  }
  const call = () => {
    if (!phone) return
    logContactEvent('homeServices', row.id, 'call', region)
    Linking.openURL(`tel:${phone}`)
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.navbar}>
        <BackButton lang={lang} onPress={onBack} />
        <Text style={s.navTitle} numberOfLines={1}>{row.name}</Text>
        <View style={s.navSpacer} />
      </View>

      {/* 120 clears the absolute contact bar — the same figure TowingDetailScreen and
          PropertyDetailScreen use for their identical bars. */}
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: 120 + insets.bottom }]}>
        <View style={s.hero}>
          <View style={s.badge}>
            <Ionicons name="ribbon-outline" size={12} color={colors.accent} />
            <Text style={s.badgeText}>{t('hsPartnerBadge', lang)}</Text>
          </View>
          <PartnerLogoStrip
            source={partnerLogo(partner)}
            name={row.name}
            width={HERO_LOGO.width}
            height={HERO_LOGO.height}
            style={s.heroLogo}
          />
          <Text style={s.heroName}>{row.name}</Text>
          {!!coverage && (
            <View style={s.coverageRow}>
              <Ionicons name="location-outline" size={13} color={colors.textSecondary} />
              <Text style={s.coverageText}>{coverage}</Text>
            </View>
          )}
        </View>

        {showAbout && (
          <Block title={t('hsAbout', lang)}>
            <Text style={s.about}>{about}</Text>
          </Block>
        )}

        {services.length > 0 && (
          <Block title={t('hsServicesOffered', lang)}>
            <View style={s.serviceGrid}>
              {services.map(cat => (
                <View key={cat.key} style={s.serviceCell}>
                  <View style={s.serviceIcon}>
                    <HomeServiceIcon category={cat} size={20} color={colors.primary} />
                  </View>
                  <Text style={s.serviceLabel} numberOfLines={2}>{t(cat.labelKey, lang)}</Text>
                </View>
              ))}
            </View>
          </Block>
        )}

        {gallery.length > 0 && (
          <Block title={t('hsPartnerGallery', lang)}>
            {gallery.map(project => (
              <View key={project.id} style={s.project}>
                <Text style={s.projectTitle}>{t(project.titleKey, lang)}</Text>

                {project.mode === 'pairs' && (
                  <>
                    {project.pairs.map(pair => (
                      <View key={pair.labelKey} style={s.pairWrap}>
                        <Text style={s.pairLabel}>{t(pair.labelKey, lang)}</Text>
                        <View style={s.pairRow}>
                          <Shot source={pair.before} label={t('hsPartnerBefore', lang)} width={PAIR_W} aspect={projectAspect(project)} />
                          <Shot source={pair.after}  label={t('hsPartnerAfter', lang)}  width={PAIR_W} aspect={projectAspect(project)} />
                        </View>
                      </View>
                    ))}
                    {project.extra.length > 0 && (
                      <>
                        <Text style={s.extraTitle}>{t('hsPartnerMorePhotos', lang)}</Text>
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          snapToInterval={SNAP}
                          snapToAlignment="start"
                          decelerationRate="fast"
                          contentContainerStyle={s.strip}
                        >
                          {project.extra.map((src, i) => (
                            <Shot key={i} source={src} label={null} width={STEP_W} aspect={projectAspect(project)} />
                          ))}
                        </ScrollView>
                      </>
                    )}
                  </>
                )}

                {project.mode === 'sequence' && (
                  // Horizontal, because the ORDER is the content — a vertical stack of six
                  // frames reads as six unrelated photos, and swiping left is the gesture
                  // that says "and then".
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    snapToInterval={SNAP}
                    snapToAlignment="start"
                    decelerationRate="fast"
                    contentContainerStyle={s.strip}
                  >
                    {project.steps.map((step, i) => (
                      <View key={step.labelKey} style={{ width: STEP_W }}>
                        <Shot source={step.image} label={null} width={STEP_W} aspect={projectAspect(project)} />
                        {/* TWO lines, not one. The measured worst case is 95.5pt in a
                            178.6pt box so nothing should ever clip — but a label that
                            silently loses its last word is a bad way to find out the
                            measurement was wrong, and a step called "4. Constructi"
                            reads as a broken app rather than as tight copy. */}
                        <Text style={s.stepLabel} numberOfLines={2}>
                          {i + 1}. {t(step.labelKey, lang)}
                        </Text>
                      </View>
                    ))}
                  </ScrollView>
                )}
              </View>
            ))}
          </Block>
        )}

        <Block title={t('hsContact', lang)}>
          {!!row.phone && (
            <TouchableOpacity style={s.row} onPress={call} activeOpacity={0.6}>
              <Text style={s.rowLabel}>{t('hsCall', lang)}</Text>
              <View style={s.rowRight}>
                <Text style={[s.rowValue, s.rowValueLink]}>{row.phone}</Text>
                <Ionicons name="call-outline" size={15} color={colors.primary} />
              </View>
            </TouchableOpacity>
          )}
          {!!row.whatsapp && (
            <TouchableOpacity style={s.row} onPress={openWhatsApp} activeOpacity={0.6}>
              <Text style={s.rowLabel}>{t('hsWhatsApp', lang)}</Text>
              <View style={s.rowRight}>
                <Text style={[s.rowValue, s.rowValueLink]}>{row.whatsapp}</Text>
                <Ionicons name="logo-whatsapp" size={15} color={colors.primary} />
              </View>
            </TouchableOpacity>
          )}
        </Block>
      </ScrollView>

      <View style={[s.contactBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        {!!waNum && (
          <TouchableOpacity style={s.waBtn} onPress={openWhatsApp} activeOpacity={0.85}>
            <Ionicons name="logo-whatsapp" size={18} color="#fff" />
            <Text style={s.barBtnText}>{t('hsWhatsApp', lang)}</Text>
          </TouchableOpacity>
        )}
        {!!phone && (
          <TouchableOpacity style={s.callBtn} onPress={call} activeOpacity={0.85}>
            <Ionicons name="call" size={18} color="#fff" />
            <Text style={s.barBtnText}>{t('hsCall', lang)}</Text>
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
  heroLogo:     { marginBottom: 10 },
  heroName:     { fontSize: 20, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  coverageRow:  { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  coverageText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },

  block:        { paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: colors.border },
  blockTitle:   { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase',
                  color: colors.textSecondary, fontFamily: 'Inter_700Bold', marginBottom: 10 },

  about:        { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_400Regular',
                  color: colors.textPrimary },

  serviceGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  // ICON ABOVE LABEL, not beside it. Side-by-side left the label 73pt at 320dp and
  // clipped two real strings — French "Rénovation salle de bains" ran to three lines and
  // German "Renovierung" broke mid-word. Stacked, the label gets the whole cell (115pt),
  // which is WIDER than the 95.6pt box the twelve category tiles already fit in, so this
  // grid cannot be the tighter of the two.
  serviceCell:  { width: '47%', alignItems: 'center', gap: 8,
                  backgroundColor: colors.cardBg, borderRadius: radius.sm, padding: 10,
                  borderWidth: 1, borderColor: colors.border },
  serviceIcon:  { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primaryLight,
                  alignItems: 'center', justifyContent: 'center' },
  serviceLabel: { fontSize: 12.5, fontFamily: 'Inter_400Regular', color: colors.textPrimary,
                  textAlign: 'center' },

  project:      { marginBottom: 18 },
  projectTitle: { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary,
                  marginBottom: 10 },
  pairWrap:     { marginBottom: 14 },
  pairLabel:    { fontSize: 12.5, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                  marginBottom: 6 },
  pairRow:      { flexDirection: 'row', gap: 8 },
  extraTitle:   { fontSize: 12.5, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                  marginTop: 2, marginBottom: 8 },
  // paddingRight equals the gap so the last frame has the same breathing room as the
  // space between frames; without it the strip ends flush against the screen edge and
  // reads as cut off rather than finished.
  strip:        { gap: STRIP_GAP, paddingRight: STRIP_GAP },
  stepLabel:    { fontSize: 12.5, fontFamily: 'Inter_700Bold', color: colors.textPrimary,
                  marginTop: 6 },

  shot:         { borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.sand },
  shotImg:      { width: '100%', height: '100%' },
  shotLabel:    { position: 'absolute', left: 8, bottom: 8, paddingHorizontal: 8, paddingVertical: 3,
                  borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.6)' },
  shotLabelText:{ fontSize: 11, fontFamily: 'Inter_700Bold', color: '#fff' },

  row:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                  paddingVertical: 6, gap: 12 },
  rowLabel:     { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  rowValue:     { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
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
  barBtnText:   { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_700Bold' },
})
