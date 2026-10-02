import { useState, useRef } from 'react'
import {
  View, Text, Image, TouchableOpacity, StyleSheet,
  FlatList, Dimensions, ScrollView, useWindowDimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { colors, shadow, type, radii } from '../constants/theme'
import { REDESIGN } from '../constants/redesign'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import PhotoFade, { PHOTO_GLASS, CONTENT_MAX_W } from '../components/ui/PhotoFade'
import { Button } from '../components/ui'
import { t, LANGUAGES } from '../constants/i18n'

// Module scope is safe here: app.config.js locks orientation to 'portrait', so this
// cannot go stale the way it would on a rotating device. The FlatList pages on exactly
// this number, so it has to be the same value the slides are laid out with.
const { width, height } = Dimensions.get('window')

// ─── THE FOUR SLIDES ────────────────────────────────────────────────────────
//
// Was five: a language picker plus four feature slides, two of which sold ADA as a
// medical app ("Health & Clinics", and a `medical` icon on the DANGER pair). ADA is a
// guidance and lifestyle app for TRNC — Play has said Travel & Local for a while and the
// carousel had not followed. The picker now shares slide 1 with the positioning line,
// which is what pays for the slide that was removed.
//
// ⚠ KEYS ARE SEMANTIC, NOT POSITIONAL. The set this replaces was slide1Title…onboardingP4,
//   and a positional name cannot survive a reorder — moving a slide would mean either a
//   rename across nine locales or a key that lies about where it sits. Reordering this
//   array is now the whole change.
//
// ⚠ NO `medical` ICON AND NO DANGER PAIR ANYWHERE. Slide 4 covers duty pharmacy and
//   emergency numbers, and it carries `tintUrgent*` — the same coral the Home grid gives
//   its urgent tiles — because that is the app's existing encoding for "the thing you
//   open this for at 2am". `danger`/`dangerLight` means a FAILURE state elsewhere in the
//   app; spending it on a directory entry would be a second meaning for one colour.
const SLIDES = [
  { id: 'welcome' },
  {
    id: 'explore',
    icon: 'compass-outline',
    tint: 'service',
    titleKey: 'onboardingExploreTitle',
    bodyKey: 'onboardingExploreBody',
  },
  {
    id: 'settle',
    icon: 'home-outline',
    tint: 'service',
    titleKey: 'onboardingSettleTitle',
    bodyKey: 'onboardingSettleBody',
    // ⚠ NOT A FEATURE BULLET, AND THE STYLING IS THE POINT. Ulaşım and eSIM are both
    //   DARK: MODULE_FLAGS.transport is false (Coming Soon) and CONNECTIVITY_LIVE is
    //   false (waitlist — and flipping it needs a native build, not an OTA). The string
    //   itself carries the established `comingSoon` wording in all nine locales, and it
    //   renders smaller and muted so the eye reads it as a footnote. Naming a module a
    //   user then cannot open is how somebody learns ADA can't help with that thing.
    noteKey: 'onboardingSoonNote',
  },
  {
    id: 'oli',
    mascot: true,
    tint: 'urgent',
    titleKey: 'onboardingOliTitle',
    bodyKey: 'onboardingOliBody',
  },
]

const TINTS = {
  service: { bg: colors.tintServiceBg, fg: colors.tintServiceFg },
  urgent:  { bg: colors.tintUrgentBg,  fg: colors.tintUrgentFg  },
}

// ─── SLIDE 1 GEOMETRY, AND WHY IT IS COMPUTED RATHER THAN TYPED ─────────────
//
// The Turkish body is the longest string in the carousel — 85 chars against English's
// 64, +33% — and it sits above the language picker. If it takes a line more than budgeted
// the picker goes below the fold on a small phone, which is the one thing slide 1 cannot
// afford: the picker is why the rest of the carousel is readable at all.
//
// So the logo is a FRACTION of the shorter side rather than a fixed point size, and it is
// capped. On a 360x640 phone that is 141pt, which leaves a full extra body line of
// slack over the measured Turkish worst case; on a tall phone it stops at 180pt rather
// than growing to fill space the picker needs. `height * 0.02` of top padding is
// deliberately small for the same reason — the old screen used 0.06 and spent 38pt on a
// 640 screen doing nothing.
const LOGO = Math.min(width * 0.5, height * 0.22, 180)

function WelcomeSlide({ lang, setLang }) {
  return (
    <ScrollView
      style={{ width }}
      contentContainerStyle={s.welcomeContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={s.logoWrap}>
        <Image
          source={require('../assets/adalogo.png')}
          style={{ width: LOGO, height: LOGO }}
          resizeMode="contain"
        />
      </View>

      <Text style={s.welcomeTitle}>{t('onboardingWelcomeTitle', lang)}</Text>
      <Text style={s.welcomeBody}>{t('onboardingWelcomeBody', lang)}</Text>

      <View style={s.divider} />

      <Text style={s.langLabel}>{t('chooseLanguage', lang)}</Text>
      <View style={s.langGrid}>
        {/* LANGUAGES is imported, never redeclared. i18n.js consolidated this array
            BECAUSE four copies had already drifted, and a language the app supports but
            one copy has never heard of is a user stranded in a script they cannot read. */}
        {LANGUAGES.map(({ key, label }) => (
          <TouchableOpacity
            key={key}
            style={[s.langChip, lang === key && s.langChipActive]}
            onPress={() => setLang(key)}
            activeOpacity={0.7}
            accessibilityRole="radio"
            accessibilityState={{ selected: lang === key }}
          >
            <Text style={[s.langChipText, lang === key && s.langChipTextActive]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  )
}

// ─── Redesign (S2b): the slide's picture is an Oli & Maki scene on the teal Oli ground
// (the Home Oli bar's gradient + glow). Picture only — no text sits on it, so it carries no
// contrast obligation. Explore → the events scene, Settle → accommodation, Oli → emergency
// (slide 4 is duty pharmacy + emergency numbers).
const SCENE = {
  explore: require('../assets/oli-scenes/events.png'),
  settle:  require('../assets/oli-scenes/accommodation.png'),
  oli:     require('../assets/oli-scenes/emergency.png'),
}
const SCENE_W = Math.min(width - 48, 340)
const SCENE_H = Math.round(SCENE_W * 0.66)

function SceneCard({ id }) {
  const src = SCENE[id]
  const meta = Image.resolveAssetSource(src)
  const h = SCENE_H - 24
  return (
    <View style={s.sceneCard}>
      <Image source={require('../assets/oli-scenes/oli-bg.png')} resizeMode="stretch" style={StyleSheet.absoluteFill} />
      <Image source={require('../assets/oli-scenes/oli-glow.png')}
        style={{ position: 'absolute', width: SCENE_H * 1.3, height: SCENE_H * 1.3, left: SCENE_W / 2 - SCENE_H * 0.65, top: -SCENE_H * 0.1 }} />
      <Image source={src} resizeMode="contain" accessibilityIgnoresInvertColors
        style={{ position: 'absolute', bottom: 0, alignSelf: 'center', height: h, width: h * meta.width / meta.height }} />
    </View>
  )
}

function FeatureSlide({ slide, lang }) {
  const tint = TINTS[slide.tint]
  return (
    <View style={s.featureSlide}>
      {REDESIGN ? <SceneCard id={slide.id} /> : (
      <View style={[s.circle, { backgroundColor: tint.bg }]}>
        {slide.mascot
          // ─── THE OFFSETS ARE THE ARTWORK'S, NOT A NUDGE ───────────────────
          // oli-button.png is 1024x1024 with its content bounding box at
          // x 26.6%..72.2%, y 5.4%..91.4% — measured from the alpha channel, recorded in
          // components/home/OliRow.js. Under resizeMode 'contain' in a square box those
          // fractions hold, so the visible mascot is 0.456B wide and 0.86B tall and its
          // half-diagonal is 0.487B. To sit inside a circle of radius R that needs
          // 0.487B <= R, i.e. B <= 2R * 1.027 — MASCOT_BOX is 0.875 of the diameter,
          // which clears it with room rather than touching the rim.
          // If the artwork is ever re-exported with different margins, re-measure.
          ? <Image
              source={require('../assets/oli-button.png')}
              style={s.mascot}
              resizeMode="contain"
            />
          : <Ionicons name={slide.icon} size={68} color={tint.fg} />}
      </View>
      )}

      <View style={s.featureText}>
        <Text style={s.featureTitle}>{t(slide.titleKey, lang)}</Text>
        <Text style={s.featureBody}>{t(slide.bodyKey, lang)}</Text>
        {!!slide.noteKey && (
          <Text style={s.featureNote}>{t(slide.noteKey, lang)}</Text>
        )}
      </View>
    </View>
  )
}

// ─── Redesign: onboarding in the Welcome A style ─────────────────────────────
// Each slide: a full-screen photo of ours matching its topic, fading into the deep teal, with
// the Oli & Maki scene and the title + text in white ON the solid teal (12.54:1). Same slides,
// same order, same strings. "Atla" (skip) sits below the status bar; the bottom row — dots,
// a round 52pt back button and a 52pt pill "İleri" — is fixed over every slide, and each slide
// reserves its height on the solid teal, so there is no white strip and the (transparent,
// edge-to-edge) system nav bar sits on teal.
const R_PHOTO = {
  welcome: require('../assets/backgrounds/ada-bg-transportation.jpg'),
  explore: require('../assets/backgrounds/ada-bg-events.jpg'),
  settle:  require('../assets/backgrounds/ada-bg-accommodation.jpg'),   // shared with Welcome + the location screen: own crop
  oli:     require('../assets/backgrounds/ada-bg-duty-pharmacy.jpg'),
}
// The recognisable part of each photo (source x/y, 0–1) and how much to enlarge it, so the
// coast, the street lights, the terrace and the pharmacy sit in the visible photo zone.
// The Kyrenia photo is used three times (Welcome: harbour + castle · location screen: bougainvillea
// and boats · Settle in: the terrace lounge), each on a clearly different part of it. The stone
// houses were too thin a strip of the photo to fill the zone without heavy zoom.
const R_FOCUS = {
  welcome: { x: 0.5,  y: 0.64, zoom: 1.25 },   // coastal road + bus
  explore: { x: 0.5,  y: 0.62, zoom: 1.2 },    // string lights + crowd
  settle:  { x: 0.9,  y: 0.76, zoom: 2.0 },    // the terrace lounge: cushions, throw, lantern
  oli:     { x: 0.55, y: 0.64, zoom: 1.15 },   // shelves + pharmacist
}
const R_SCENE = {
  welcome: require('../assets/oli-scenes/welcome.png'),
  explore: require('../assets/oli-scenes/events.png'),
  settle:  require('../assets/oli-scenes/accommodation.png'),
  oli:     require('../assets/oli-scenes/emergency.png'),
}
const R_NAV_H = 88   // the fixed bottom row: dots (7 + 14) + the 52pt buttons + its 15pt gap, reserved on every slide
// Slide 1 also carries the 9-language picker (~560pt in all); below 720pt of screen its scene is
// left out so the block never reaches the skip button.
// The redesign reads the LIVE window (useWindowDimensions), never the module-load `width`: on an
// iPad / foldable / after rotation that stale width made each slide wider than the screen, so the
// text column ran off the right edge while the mascot (PhotoFade, live) stayed centred.
const R_SHORT_H = 720

function RedesignSlide({ slide, lang, setLang, bottomInset, pageW }) {
  const { height: H } = useWindowDimensions()
  const welcome = slide.id === 'welcome'
  return (
    <View style={{ width: pageW, height: '100%' }}>
      <PhotoFade photo={R_PHOTO[slide.id]} focus={R_FOCUS[slide.id]}
        mascot={welcome && H < R_SHORT_H ? null : R_SCENE[slide.id]}>
        <View style={[rs.content, { paddingBottom: bottomInset + R_NAV_H + 12 }]}>
          <Text style={rs.title} accessibilityRole="header">
            {t(welcome ? 'onboardingWelcomeTitle' : slide.titleKey, lang)}
          </Text>
          <Text style={rs.body}>{t(welcome ? 'onboardingWelcomeBody' : slide.bodyKey, lang)}</Text>
          {!!slide.noteKey && <Text style={rs.note}>{t(slide.noteKey, lang)}</Text>}
          {welcome && (
            <>
              <Text style={rs.langLabel}>{t('chooseLanguage', lang)}</Text>
              <View style={rs.langGrid}>
                {LANGUAGES.map(({ key, label }) => (
                  <TouchableOpacity key={key} onPress={() => setLang(key)} activeOpacity={0.75}
                    style={[rs.langChip, lang === key && rs.langChipOn]}
                    accessibilityRole="radio" accessibilityState={{ selected: lang === key }}>
                    <Text style={[rs.langChipText, lang === key && rs.langChipTextOn]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
        </View>
      </PhotoFade>
    </View>
  )
}

export default function OnboardingScreen({ onComplete }) {
  const [lang, setLang] = useState('English')
  const [index, setIndex] = useState(0)
  const listRef = useRef(null)

  const isLast = index === SLIDES.length - 1

  function goTo(i) {
    listRef.current?.scrollToIndex({ index: i, animated: true })
    setIndex(i)
  }

  if (REDESIGN) return (
    <OnboardingRedesign lang={lang} setLang={setLang} index={index} setIndex={setIndex}
      listRef={listRef} goTo={goTo} isLast={isLast} onComplete={onComplete} />
  )

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={item => item.id}
        horizontal
        pagingEnabled
        scrollEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={e => {
          const i = Math.round(e.nativeEvent.contentOffset.x / width)
          setIndex(i)
        }}
        renderItem={({ item }) =>
          item.id === 'welcome'
            ? <WelcomeSlide lang={lang} setLang={setLang} />
            : <FeatureSlide slide={item} lang={lang} />
        }
      />

      <View style={s.nav}>
        <View style={s.dots}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[s.dot, i === index && s.dotActive]} />
          ))}
        </View>

        <View style={s.navButtons}>
          {index > 0 && (
            <TouchableOpacity style={s.backBtn} onPress={() => goTo(index - 1)} activeOpacity={0.7}
              accessibilityRole="button" accessibilityLabel={t('back', lang)}>
              <Ionicons name="chevron-back" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
          {/* No Skip, deliberately — there is no `skip` key in i18n.js and one was not
              added. Four slides with a visible back chevron and free swiping is not a
              wall somebody needs an escape hatch from.

              `onComplete(lang)` writes @trnc_onboarded and @trnc_lang and hands off to
              WelcomeScreen, NOT to signup — WelcomeScreen is the only route to
              "Continue as guest", which is one tap from a cold start. */}
          <TouchableOpacity
            style={[s.nextBtn, isLast && s.nextBtnLast]}
            onPress={() => isLast ? onComplete(lang) : goTo(index + 1)}
            activeOpacity={0.85}
          >
            <Text style={s.nextText}>
              {isLast ? t('getStarted', lang) : t('next', lang)}
            </Text>
            <Ionicons name="arrow-forward" size={17} color={colors.surface} />
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  )
}

const CIRCLE = 156
const MASCOT_BOX = CIRCLE * 0.875   // see the bbox note in FeatureSlide

const legacyS = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bgWarm },

  // ── Slide 1 ──
  welcomeContent: {
    width,
    paddingHorizontal: 28,
    paddingTop: height * 0.02,
    paddingBottom: 16,
  },
  logoWrap: { alignItems: 'center', marginBottom: 10 },
  welcomeTitle: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: colors.textPrimary,
    textAlign: 'center',
    letterSpacing: -0.4,
    marginBottom: 8,
  },
  welcomeBody: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 16,
  },
  divider: { height: 1, backgroundColor: colors.border, marginBottom: 16 },
  langLabel: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 12,
  },
  langGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  langChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    // minHeight is a defensive floor, not decoration — the house rule about a
    // fixed-height View compressed by a scrolling sibling. Matches ExploreScreen's chip.
    minHeight: 35,
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  langChipActive:     { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  langChipText:       { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  langChipTextActive: { fontFamily: 'Inter_700Bold', color: colors.primaryDark },

  // ── Slides 2-4 ──
  featureSlide: {
    width,
    flex: 1,
    paddingHorizontal: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 36,
    ...shadow,
  },
  mascot: { width: MASCOT_BOX, height: MASCOT_BOX },
  featureText:  { alignItems: 'center' },
  featureTitle: {
    fontSize: 26,
    fontFamily: 'Inter_700Bold',
    color: colors.textPrimary,
    textAlign: 'center',
    letterSpacing: -0.5,
    marginBottom: 14,
  },
  featureBody: {
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 300,
  },
  // Subordinate by three signals at once — smaller, lighter weight and a softer colour —
  // so it cannot be mistaken for the body above it at a glance.
  featureNote: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: colors.textSecondary,
    opacity: 0.7,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 14,
    maxWidth: 280,
  },

  // ── Bottom nav ──
  nav: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 12,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 16,
  },
  dot:       { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.border },
  dotActive: { backgroundColor: colors.primary },

  navButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: colors.border,
    // Android renders borderRadius + borderWidth with an opaque background unless this
    // is set explicitly — house gotcha, not a style preference.
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  nextBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 24,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  nextBtnLast: { backgroundColor: colors.primaryDark },
  nextText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.surface },
})

// Redesign overrides, key by key (the slide geometry above is unchanged, so the measured
// Turkish worst case on slide 1 still holds). 44pt language chips with a 3.66:1 boundary,
// dots that are visible (fieldBorder 3.66:1; colors.border was 1.18), the "coming soon"
// note at full textSecondary (the 0.7 opacity put it under AA), 50pt next button.
const redesignS = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: colors.canvas },
  welcomeTitle:  { ...type.pageTitle, color: colors.textPrimary, textAlign: 'center', marginBottom: 8 },
  welcomeBody:   { ...type.body, color: colors.textSecondary, textAlign: 'center', marginBottom: 16 },
  divider:       { height: 1, backgroundColor: colors.divider, marginBottom: 16 },
  langLabel:     { ...type.meta, fontFamily: 'Inter_600SemiBold', color: colors.textSecondary, marginBottom: 10 },
  langChip:      { paddingHorizontal: 14, minHeight: 44, borderRadius: radii.pill, justifyContent: 'center',
                   backgroundColor: colors.card, borderWidth: 1, borderColor: colors.fieldBorder },
  langChipActive:{ backgroundColor: colors.primaryLight, borderColor: colors.primary, borderWidth: 2 },
  langChipText:  { ...type.body, color: colors.textPrimary },
  sceneCard:     { width: SCENE_W, height: SCENE_H, borderRadius: radii.sheet, overflow: 'hidden', marginBottom: 32,
                   backgroundColor: '#084B4A' },
  featureTitle:  { ...type.pageTitle, color: colors.textPrimary, textAlign: 'center', marginBottom: 12 },
  featureBody:   { ...type.body, fontSize: 16, lineHeight: 24, color: colors.textSecondary, textAlign: 'center', maxWidth: 320 },
  featureNote:   { ...type.small, color: colors.textSecondary, textAlign: 'center', marginTop: 14, maxWidth: 300 },
  nav:           { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 12, backgroundColor: colors.card,
                   borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  dot:           { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.fieldBorder },
  dotActive:     { width: 18, backgroundColor: colors.primary },
  backBtn:       { width: 50, height: 50, borderRadius: radii.md, borderWidth: 1, borderColor: colors.fieldBorder,
                   backgroundColor: 'transparent', justifyContent: 'center', alignItems: 'center' },
  nextBtn:       { flex: 1, backgroundColor: colors.primary, borderRadius: radii.md, minHeight: 50, paddingHorizontal: 24,
                   flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  nextText:      { ...type.rowTitle, color: colors.onPrimary },
})
const s = REDESIGN ? { ...legacyS, ...redesignS } : legacyS

// Module scope (defined outside the screen, so it never remounts on a parent render).
function OnboardingRedesign({ lang, setLang, index, setIndex, listRef, goTo, isLast, onComplete }) {
  const insets = useSafeAreaInsets()
  const win = useWindowDimensions()
  // The page width is the pager's MEASURED width, not a window reading. When it changes (rotation,
  // split view, foldable) the list is REMOUNTED at the new width (key) and reopened at the current
  // slide (initialScrollIndex): every slide is laid out again — a kept list showed slide 1 at the
  // old landscape width after rotating back to portrait (iPad, 2026-10-02).
  const [pageW, setPageW] = useState(win.width)
  return (
    <View style={{ flex: 1, backgroundColor: '#083A39' }}
      onLayout={e => { const w = Math.round(e.nativeEvent.layout.width); if (w > 0 && w !== pageW) setPageW(w) }}>
      <StatusBar style="light" />
      <FlatList
        key={pageW}
        initialScrollIndex={index}
        ref={listRef}
        data={SLIDES}
        keyExtractor={item => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={e => setIndex(Math.round(e.nativeEvent.contentOffset.x / pageW))}
        getItemLayout={(_, i) => ({ length: pageW, offset: pageW * i, index: i })}
        renderItem={({ item }) => <RedesignSlide slide={item} lang={lang} setLang={setLang} bottomInset={insets.bottom} pageW={pageW} />}
      />
      {/* "Atla" finishes onboarding with the language chosen so far — the same onComplete the
          last slide calls (writes @trnc_onboarded + @trnc_lang, then WelcomeScreen). */}
      {!isLast && (
        <TouchableOpacity style={[rs.skip, { top: insets.top + 8 }]} onPress={() => onComplete(lang)}
          accessibilityRole="button" accessibilityLabel={t('hrSkip', lang)}>
          <Text style={rs.skipText}>{t('hrSkip', lang)}</Text>
        </TouchableOpacity>
      )}
      <View style={[rs.nav, { paddingBottom: insets.bottom + 12, paddingHorizontal: Math.max(24, (pageW - CONTENT_MAX_W) / 2) }]} pointerEvents="box-none">
        <View style={rs.dots}>
          {SLIDES.map((_, i) => <View key={i} style={[rs.dot, i === index && rs.dotOn]} />)}
        </View>
        <View style={rs.navRow}>
          {index > 0 && (
            <TouchableOpacity style={rs.backRound} onPress={() => goTo(index - 1)} activeOpacity={0.75}
              accessibilityRole="button" accessibilityLabel={t('back', lang)}>
              <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          )}
          <Button size="lg" variant="inverse" icon="arrow-forward" style={{ flex: 1 }} fullWidth
            title={isLast ? t('getStarted', lang) : t('next', lang)}
            onPress={() => (isLast ? onComplete(lang) : goTo(index + 1))} />
        </View>
      </View>
    </View>
  )
}

const rs = StyleSheet.create({
  content:      { paddingHorizontal: 24, paddingTop: 4, width: '100%', maxWidth: CONTENT_MAX_W, alignSelf: 'center' },
  title:        { fontSize: 26, lineHeight: 32, fontFamily: 'Inter_700Bold', color: '#FFFFFF', marginBottom: 8, textAlign: 'center' },
  body:         { fontSize: 16, lineHeight: 23, fontFamily: 'Inter_400Regular', color: '#FFFFFF', textAlign: 'center' },
  note:         { ...type.small, color: '#FFFFFF', marginTop: 10, textAlign: 'center' },
  langLabel:    { ...type.meta, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF', marginTop: 16, marginBottom: 8, textAlign: 'center' },
  langGrid:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  langChip:     { minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderRadius: radii.pill,
                  borderWidth: 1, borderColor: 'rgba(255,255,255,0.55)', backgroundColor: 'rgba(255,255,255,0.10)' },
  langChipOn:   { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  langChipText: { ...type.body, color: '#FFFFFF' },
  langChipTextOn:{ fontFamily: 'Inter_700Bold', color: '#083A39' },
  skip:         { position: 'absolute', right: 16, minHeight: 44, minWidth: 44, paddingHorizontal: 16,
                  justifyContent: 'center', borderRadius: radii.pill, backgroundColor: `rgba(0,0,0,${PHOTO_GLASS})`,
                  borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  skipText:     { ...type.body, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF' },
  nav:          { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 24 },
  dots:         { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 14 },
  dot:          { width: 7, height: 7, borderRadius: 3.5, backgroundColor: 'rgba(255,255,255,0.45)' },
  dotOn:        { width: 18, backgroundColor: '#FFFFFF' },
  navRow:       { flexDirection: 'row', alignItems: 'center', gap: 12 },
  backRound:    { width: 52, height: 52, borderRadius: 26, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)',
                  backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
})
