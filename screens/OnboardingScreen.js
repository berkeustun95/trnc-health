import { useState, useRef } from 'react'
import {
  View, Text, Image, TouchableOpacity, StyleSheet,
  FlatList, Dimensions, ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { colors, shadow } from '../constants/theme'
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

function FeatureSlide({ slide, lang }) {
  const tint = TINTS[slide.tint]
  return (
    <View style={s.featureSlide}>
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

export default function OnboardingScreen({ onComplete }) {
  const [lang, setLang] = useState('English')
  const [index, setIndex] = useState(0)
  const listRef = useRef(null)

  const isLast = index === SLIDES.length - 1

  function goTo(i) {
    listRef.current?.scrollToIndex({ index: i, animated: true })
    setIndex(i)
  }

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
            <TouchableOpacity style={s.backBtn} onPress={() => goTo(index - 1)} activeOpacity={0.7}>
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

const s = StyleSheet.create({
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
