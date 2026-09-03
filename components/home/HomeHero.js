import { useState } from 'react'
import { View, Text, Image, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors } from '../../constants/theme'
import { t } from '../../constants/i18n'
import { REGION_LABEL_KEY } from '../../constants/regions'
import { resolveHero } from '../../constants/homeHero'
import { weatherIcon } from '../../utils/facilityUtils'
import HeroCreditSheet from './HeroCreditSheet'
import { HERO_CONTENT_BOTTOM } from './homeLayout'

// The district hero. Photo, the app's top bar, district name, temperature, attribution.
//
// ─── IT ABSORBED THE TOP BAR ────────────────────────────────────────────────
// There is no separate 54pt bar above this any more: the logo sits centred on the photo
// and the three actions are circular white buttons at the top-right, ON the photo. The
// bar's height went into the hero rather than being spent on a strip of empty canvas,
// which is what buys the band its new proportion at no cost to the content below.
//
// ─── HEIGHT IS PROPORTIONAL, WITH BOUNDS ────────────────────────────────────
// 40% of the window is the draft's "top third and then some", with the Oli card
// overlapping its bottom edge. A fixed pixel height that suits a 6.1" phone is half the
// screen on a 4.7" one and a stripe on a tablet, so the clamp is what keeps it a HERO at
// both ends rather than a number that fitted the device it was drawn on.
//
// ⚠ THE UPPER BOUND IS THE DUTY ROW, NOT TASTE. Nöbetçi eczaneler has to stay above the
//   fold — it is what somebody opens this app for at 2am. At HERO_MAX the duty row's
//   bottom edge lands at hero + 150pt, which clears the fold on every viewport in the
//   round-3 log's fold table, the narrowest being a 640x1424 device read as 320x712dp.
//   Raising HERO_MAX without redoing that table is how the one row that must never be
//   scrolled to ends up below the fold on the cheapest phone somebody owns.
const HERO_FRACTION = 0.40
const HERO_MIN = 280
const HERO_MAX = 400

// ─── THE SCRIM IS TWO RAMPS, AND ONLY ONE OF THEM CARRIES LEGIBILITY ───────
//
// expo-linear-gradient is not installed and this repo does not add packages for a visual
// effect (CLAUDE.md pins the SDK deliberately), so each ramp is a stack of flat bands.
// Steps of ~0.05-0.08 read as smooth at hero scale.
//
// ⚠ THE TOP RAMP IS DECORATION. IT CANNOT BE MADE TO CARRY WHITE CONTROLS, AND THE
//   ATTEMPT WAS MEASURED RATHER THAN ABANDONED ON A HUNCH. Famagusta and İskele have
//   blown-out sky along their entire top edge — brightest-5% luminance 0.996 and 1.000 —
//   and white on that needs a scrim of alpha 0.82 to reach 4.5:1, or 0.70 for even the
//   3:1 UI floor. Either one blacks the photograph out. There is no tolerable flat scrim
//   that makes a white mark legible over an overexposed sky.
//
//   So nothing at the top depends on it: the action buttons are white circles with dark
//   glyphs and the wordmark sits on a white chip, each carrying its own contrast on any
//   photograph whatsoever. The top ramp exists purely to give the band some depth.
//
// The BOTTOM ramp does carry legibility — the district name and temperature are white
// text directly on the photo — and it is sized for it. At 0.66 the worst of the five is
// Golden Beach at 5.29:1, clear of AA. Measured across all five images, not the one that
// happened to be on screen.
//
// If either ramp is retuned, re-measure against all five. The numbers above are the
// output of a script, not a recollection.
const TOP_BANDS    = [0.28, 0.21, 0.14, 0.08, 0.03]
const BOTTOM_BANDS = [0.05, 0.14, 0.24, 0.36, 0.50, 0.66]

export default function HomeHero({
  region, weatherData, lang, onOpenPlace, onOpenWeather, topControls,
}) {
  const { height: winH } = useWindowDimensions()
  const heroH = Math.max(HERO_MIN, Math.min(HERO_MAX, Math.round(winH * HERO_FRACTION)))

  const { source, placeId, credit } = resolveHero(region)
  const [creditOpen, setCreditOpen] = useState(false)

  // The district name falls back to a country-level label rather than to an empty
  // string: a hero with a blank title reads as a failed load. A guest with location
  // denied and no profile.region is a normal state, not an error.
  const title = region && REGION_LABEL_KEY[region]
    ? t(REGION_LABEL_KEY[region], lang)
    : t('homeHeroFallbackTitle', lang)

  const temp = weatherData?.current?.temperature_2m
  const code = weatherData?.current?.weather_code

  // Tappability comes from resolveHero, never from a local condition — the rule is that
  // a GENERIC hero is inert, and deriving it in each caller is how half of them end up
  // not applying it.
  const tappable = !!placeId

  const topRampH    = Math.round(heroH * 0.42)
  const bottomRampH = Math.round(heroH * 0.52)

  const body = (
    <View style={s.fill}>
      <Image source={source} style={s.photo} resizeMode="cover" fadeDuration={0} />

      {TOP_BANDS.map((a, i) => (
        <View key={`t${a}`} pointerEvents="none" style={[s.band, {
          backgroundColor: `rgba(0,0,0,${a})`,
          top: (topRampH / TOP_BANDS.length) * i,
          height: topRampH / TOP_BANDS.length + 1,
        }]} />
      ))}

      {BOTTOM_BANDS.map((a, i) => (
        <View key={`b${a}`} pointerEvents="none" style={[s.band, {
          backgroundColor: `rgba(0,0,0,${a})`,
          bottom: (bottomRampH / BOTTOM_BANDS.length) * i,
          height: bottomRampH / BOTTOM_BANDS.length + 1,
        }]} />
      ))}

      {/* The app bar, rendered INSIDE the photo. Passed in rather than built here so
          this component stays about the hero: HomeScreen owns which controls exist and
          what they do, and still owns the refs App.js measures for the coach marks. */}
      {topControls}

      <View style={[s.content, { paddingBottom: HERO_CONTENT_BOTTOM }]} pointerEvents="box-none">
        <View style={s.textCol} pointerEvents="box-none">
          <Text style={s.district} numberOfLines={1}>{title}</Text>

          {temp != null && (
            // A separate target INSIDE the hero. The weather detail is the old weather
            // card's expanded state — UV, sunscreen warning, four-day forecast — which
            // the V2 anatomy has no row for. Attaching it to the temperature keeps every
            // one of those values reachable rather than quietly dropping them.
            <TouchableOpacity
              style={s.tempPill}
              onPress={onOpenWeather}
              activeOpacity={0.75}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={t('homeWeatherTitle', lang)}
            >
              <Text style={s.tempEmoji}>{weatherIcon(code)}</Text>
              <Text style={s.tempText}>{Math.round(temp)}°C</Text>
              <Ionicons name="chevron-forward" size={12} color="#fff" />
            </TouchableOpacity>
          )}
        </View>

        {/* Bottom-right COLUMN, not two absolutely-placed chips. Stacking them means
            neither can land on the temperature pill and neither needs a magic offset:
            they inherit the content box's padding, which already clears the Oli overlap.
            An earlier draft put ℹ︎ at absolute bottom-left, directly on top of the
            temperature pill. */}
        {(!!credit || tappable) && (
          <View style={s.rightCol}>
            {!!credit && (
              <TouchableOpacity
                style={s.infoChip}
                onPress={() => setCreditOpen(true)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel={t('heroCreditTitle', lang)}
              >
                <Ionicons name="information" size={13} color="#fff" />
              </TouchableOpacity>
            )}
            {tappable && (
              <View style={s.openChip} pointerEvents="none">
                <Ionicons name="arrow-forward" size={16} color={colors.textPrimary} />
              </View>
            )}
          </View>
        )}
      </View>
    </View>
  )

  // The sheet is a SIBLING of the card, never a child of the tappable wrapper: nested
  // inside it, a press anywhere on the sheet would also fire the hero's deep-link.
  const sheet = (
    <HeroCreditSheet
      visible={creditOpen}
      credit={credit}
      lang={lang}
      onClose={() => setCreditOpen(false)}
    />
  )

  if (!tappable) return <>{<View style={[s.card, { height: heroH }]}>{body}</View>}{sheet}</>

  return (
    <>
      <TouchableOpacity
        style={[s.card, { height: heroH }]}
        onPress={() => onOpenPlace?.(placeId)}
        activeOpacity={0.9}
        accessibilityRole="button"
        accessibilityLabel={title}
      >
        {body}
      </TouchableOpacity>
      {sheet}
    </>
  )
}

const s = StyleSheet.create({
  // Square top corners: the hero runs to the very top of the screen now, under the
  // status bar, so a rounded top edge would show canvas in the notch corners.
  card:      { borderBottomLeftRadius: 24, borderBottomRightRadius: 24, overflow: 'hidden', backgroundColor: colors.border },
  fill:      { flex: 1 },
  photo:     { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  band:      { position: 'absolute', left: 0, right: 0 },
  content:   { flex: 1, justifyContent: 'flex-end', flexDirection: 'row', alignItems: 'flex-end', padding: 20, gap: 12 },
  textCol:   { flex: 1 },
  district:  { fontSize: 28, fontFamily: 'Inter_700Bold', color: '#fff' },
  tempPill:  { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8, alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.20)', borderRadius: 20, paddingHorizontal: 11, paddingVertical: 6 },
  tempEmoji: { fontSize: 14 },
  tempText:  { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
  rightCol:  { alignItems: 'center', gap: 10 },
  openChip:  { width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  infoChip:  { width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.42)', justifyContent: 'center', alignItems: 'center' },
})
