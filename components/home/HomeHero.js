import { useState } from 'react'
import { View, Text, Image, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native'
import { Feather, Ionicons } from '@expo/vector-icons'
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
// ⚠ THE UPPER BOUND IS THE DUTY ROW, AND THE GUARANTEE IS BACK — BY REORDERING THE PAGE,
//   NOT BY RESIZING THIS HERO. Nöbetçi eczaneler is the most-used feature in the app and
//   the one people reach for under pressure at 2am, so it must not need a scroll.
//
//   It briefly did. Slice 2 put the "Bugün ADA'da" strip between Oli and the duty row —
//   a 52pt heading, a 150pt card and a 24pt gap, 226pt in total — which pushed duty below
//   the fold on small phones. On 2026-09-06 the duty row moved back above the strip and
//   the whole 226pt came back.
//
//   RE-MEASURED after the move, worst case throughout (a duty title wrapped to two lines,
//   which is the tallest that row gets). The fold is screenHeight minus the tab bar; the
//   hero is full-bleed and scrolls under the status bar, so nothing is subtracted at the
//   top. Tab bar = 1 border + 10 padding + 24 icon + 3 gap + 13.2 label + bottom inset.
//
//       device                        hero   duty ends   fold (gesture nav)   margin
//       360x640  small Android         305        460          555             +95
//       320x712  cheapest in the table 305        460          627            +167
//       360x800  mid-range             320        475          715            +240
//       393x852  Pixel 8 class         341        496          767            +271
//       412x915  large Android         366        521          830            +309
//
//   RE-MEASURED 2026-09-07 after the hero's overlap deepened and the mascot moved inside
//   the card. Both improved it: the Oli row's flow height fell from 66pt to 48 (the
//   overhang and headroom it used to add are gone), so the duty row moved 18pt UP and the
//   worst case went from +77 to +95.
//
//   Button-nav devices have a 59pt bar instead of 85 and clear by a further 26.
//
//   HERO_MIN STAYS AT 305: the margin is comfortable at every size, so there is no reason
//   to shrink the band. If HERO_MAX is ever raised, or anything is inserted between Oli
//   and the duty row, redo this table — those are the two edits that can spend the margin,
//   and the 45dp shortfall this note used to record is what happens when one of them is
//   made without recomputing.
//
//   ⚠ AND THE EARLIER FIGURE IN THIS FILE WAS TOO KIND. It said 45dp below on a 320x712
//     device; that model subtracted a status bar the content actually scrolls under, and
//     it never tested a 360x640 screen, where the real shortfall was 147dp. Both are moot
//     now, and both are why this table names its model rather than just its answers.
const HERO_FRACTION = 0.40
// 280 -> 305 in round 7. The search pill added 58pt of content inside the hero, and at
// 280 the logo's bottom edge landed 2pt from the pill's top on a 712dp device — touching,
// not merely tight. 305 restores a 23pt gap there and costs nothing at the fold: the duty
// row still clears it by 185pt on the same device (round-7 log has the table).
const HERO_MIN = 305
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
// text directly on the photo — and since 2026-09-07 it is the ONLY thing carrying them,
// because the dark pill they used to sit on is gone. It is sized for exactly that: the
// figures live at BOTTOM_MAX below and are re-derived on every run by
// `npm run hero:check`, which composites all SIX backgrounds (the five photos and the
// generic) rather than the one that happened to be on screen.
//
// ⚠ THE FIGURE THAT USED TO BE QUOTED HERE — "at 0.66 the worst of the five is 5.29:1" —
//   HAS BEEN REMOVED RATHER THAN UPDATED. It certified the old chip, whose dark plate did
//   most of the work, and it counted five backgrounds when six can render. Carrying it
//   forward would have been a number that was true of a design that no longer exists.
//
// If either ramp is retuned, re-measure against all five AND re-solve the deltas. The
// numbers above are the output of a script, not a recollection.
// ─── The ramps are GENERATED, not typed ─────────────────────────────────────
//
// A ramp is RAMP_STEPS layers, all anchored at their own edge, layer k spanning
// (k+1)/RAMP_STEPS of the ramp height. They stack, so their alphas multiply and the
// visible result is the cumulative curve below.
//
// ⚠ STACKED, NOT TILED — that is a bug fix. The first version laid each band in its own
//   slot with `height: bandH + 1`. The +1 made consecutive bands OVERLAP by a point, and
//   two semi-transparent blacks over the same point composite darker than either, so
//   every boundary drew a dark hairline — five of them across the hero. Dropping the +1
//   would only trade a dark seam for a bright one at sub-pixel positions. Anchoring every
//   layer at the edge removes the question: the only edge in the stack is the TOP of each
//   layer, which is exactly where the ramp is meant to step.
//
// ⚠ AND THE BOTTOM RAMP USED TO BE UPSIDE DOWN. Both arrays were indexed by distance from
//   their own edge; the top one was written darkest-first and was right, the bottom one
//   lightest-first, which put alpha 0.05 on the bottom edge and 0.66 about 150pt above it.
//   The bottom ramp got LIGHTER toward the bottom — the opposite of a scrim. Round 3's
//   check did not catch it because it assumed the strongest band covered the bottom strip
//   and computed against 0.66 there: the code and the check disagreed and only the check
//   was read.
//
// RAMP_STEPS is 14 because at 6 the steps were visible as banding across flat sky, which
// is exactly where a hero photograph is smoothest and least able to hide them.
//
// ⚠ THE EXPONENT IS NO LONGER 1.5, AND IT NO LONGER REPRODUCES THE OLD HAND-TUNED PROFILE.
//   It used to: 1.5 matched the six values 0.66 0.50 0.36 0.24 0.14 0.05 at sixths to
//   within 0.005, and that sentence stood here as its justification. Removing the pill
//   made that profile the wrong one — it is shallow exactly where the text now sits — so
//   1.15 is a DELIBERATE departure from it, solved against the six backgrounds. The old
//   curve is history, not a target; see BOTTOM_MAX below for what replaced it and why.
//
// ⚠ ONE SHARED EXPONENT, TWO RAMPS. RAMP_EXP shapes the TOP ramp as well, so this change
//   made it slightly fuller too — about +0.03 alpha at its midpoint. That is harmless by
//   the top ramp's own design (nothing up there depends on it: the action buttons are
//   white circles and the wordmark carries a baked keyline, each holding its own contrast
//   on any photograph). If the two ever need to diverge, split it into TOP_EXP and
//   BOTTOM_EXP — it is one constant, not a refactor.
const RAMP_STEPS  = 14
const TOP_MAX     = 0.28
// ─── 0.66 -> 0.72 AND 1.5 -> 1.15, BOTH SOLVED FOR THE PILL-FREE TEXT ───────
// The district row lost its dark pill on 2026-09-07, so the scrim is now the ONLY thing
// carrying that text and it had to be re-solved rather than inherited. Measured against
// all six real backgrounds — the five district photos and the generic — sampled at the
// text row's actual position with the 95th-percentile luminance, which is the figure a
// glyph sits on rather than a single specular pixel.
//
// The exponent matters more than the max here. At 1.5 the curve is still shallow where the
// text sits (~40% up the ramp) and delivered only 0.317; at 1.15 the same row gets 0.410.
// Raising the max alone could not have worked: even BOTTOM_MAX 0.95 at exponent 1.5 left
// the generic at 3.05:1.
//
// The extra darkness is largely FREE now, and that is a consequence of HERO_OVERLAP going
// to 40: the bottom 40pt of the ramp — where it is strongest — sits behind the Oli card.
const BOTTOM_MAX  = 0.72
const RAMP_EXP    = 1.15
// ─── THE GENERIC FALLBACK NEEDS MORE, AND IT IS THE ONLY ONE THAT DOES ──────
// auth-bg.png is not a photograph chosen for a hero; it is the app's auth background
// standing in for districts with no licence-clean image (morphou, lefke) and for anyone
// with no region at all. It is also far brighter than any of the five photos: 95th
// percentile 0.823 at the text row, against 0.526 for the next worst (karpaz).
//
// A flat 0.28 over it, composited on top of the ramp, is what takes it from 2.21:1 to
// 5.12:1. Applied ONLY when isGeneric — darkening the five photographs to solve a problem
// only the sixth has would be paying a licensed image's fidelity for our own asset choice.
// It is flat rather than another ramp because the whole image is too bright, not its
// bottom.
const GENERIC_SCRIM = 0.28

// Cumulative alpha this ramp should show at normalised distance u from its edge.
export function rampAlphaAt(max, u) {
  return u >= 1 ? 0 : max * Math.pow(1 - u, RAMP_EXP)
}

// Per-layer alphas whose PRODUCT reproduces that curve. Solved outward-in: each layer
// only has to supply what the layers beyond it have not.
function rampLayers(max) {
  const d = new Array(RAMP_STEPS)
  for (let i = RAMP_STEPS - 1; i >= 0; i--) {
    let below = 1
    for (let k = i + 1; k < RAMP_STEPS; k++) below *= (1 - d[k])
    d[i] = 1 - (1 - rampAlphaAt(max, i / RAMP_STEPS)) / below
  }
  return d
}

const TOP_LAYERS    = rampLayers(TOP_MAX)
const BOTTOM_LAYERS = rampLayers(BOTTOM_MAX)


export default function HomeHero({
  region, weatherData, lang, onOpenPlace, onOpenWeather, topControls,
  onOpenSearch, searchRef, showSearch = true,
}) {
  const { height: winH } = useWindowDimensions()
  const heroH = Math.max(HERO_MIN, Math.min(HERO_MAX, Math.round(winH * HERO_FRACTION)))

  const { source, placeId, credit, isGeneric } = resolveHero(region)
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

      {TOP_LAYERS.map((a, i) => (
        <View key={`t${i}`} pointerEvents="none" style={[s.band, {
          backgroundColor: `rgba(0,0,0,${a})`,
          top: 0,
          height: (topRampH / RAMP_STEPS) * (i + 1),
        }]} />
      ))}

      {/* The generic's extra flat scrim, under the ramp layers so the ramp still shapes
          the bottom. See GENERIC_SCRIM. */}
      {isGeneric && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFillObject,
          { backgroundColor: `rgba(0,0,0,${GENERIC_SCRIM})` }]} />
      )}

      {BOTTOM_LAYERS.map((a, i) => (
        <View key={`b${i}`} pointerEvents="none" style={[s.band, {
          backgroundColor: `rgba(0,0,0,${a})`,
          bottom: 0,
          height: (bottomRampH / RAMP_STEPS) * (i + 1),
        }]} />
      ))}

      {/* The app bar, rendered INSIDE the photo. Passed in rather than built here so
          this component stays about the hero: HomeScreen owns which controls exist and
          what they do, and still owns the refs App.js measures for the coach marks. */}
      {topControls}

      <View style={[s.content, { paddingBottom: HERO_CONTENT_BOTTOM }]} pointerEvents="box-none">
        {/* ─── ONE LINE: pin · district · dot · sun · temperature ───────────
            Was a 28pt district title stacked over a separate temperature pill — about
            71pt of stacked chrome. This is a single 32pt row.

            Only the TEMPERATURE half is tappable; the district name is not, so a tap
            there falls through to the hero's own deep-link. Two touch targets inside one
            pill, not one target doing two jobs. */}
        {/* ─── SEARCH, AS A BAR ON THE PHOTOGRAPH ────────────────────────────
            A white pill rather than a third circular button in the top-right. It opens
            the SAME expand-in-place search — only the entry point's appearance changed —
            and it carries searchRef so App.js's coach mark still measures the real
            target. Solid white, so like every other element on this hero it carries its
            own contrast instead of borrowing it from the scrim. */}
        {showSearch && (
          <View ref={searchRef} collapsable={false}>
            <TouchableOpacity
              style={s.searchPill}
              onPress={onOpenSearch}
              activeOpacity={0.85}
              accessibilityRole="search"
              accessibilityLabel={t('homeSearchA11y', lang)}
            >
              <Feather name="search" size={17} color={colors.textSecondary} />
              <Text style={s.searchText} numberOfLines={1}>{t('hubSearchPlaceholder', lang)}</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={s.bottomRow} pointerEvents="box-none">
        <View style={s.chipCol} pointerEvents="box-none">
        <View style={s.chip} pointerEvents="box-none">
          <Ionicons name="location" size={12} color="#fff" />
          <Text style={s.district} numberOfLines={1}>{title}</Text>

          {temp != null && (
            <>
              <Text style={s.chipDot}>·</Text>
              <TouchableOpacity
                style={s.tempHit}
                onPress={onOpenWeather}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={t('homeWeatherTitle', lang)}
              >
                <Text style={s.tempEmoji}>{weatherIcon(code)}</Text>
                <Text style={s.tempText}>{Math.round(temp)}°C</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
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
  // A COLUMN: the search pill sits full-width above the district row.
  //
  // ─── paddingHorizontal 16, NOT 20 — ONE LEFT EDGE FOR THE WHOLE SCREEN ────
  // It was a uniform 20, which put the search pill and the district chip 4pt further in
  // than everything else on the page: v2Below insets its column by 16 and HomeTopBar's
  // own bar is already 16. So the hero had two different left edges inside it (bar at 16,
  // content at 20) and neither matched the cards below. With the Oli card's stray 10pt
  // inset also removed in this pass, every element from the top bar to the last grid tile
  // now starts at the same 16pt.
  //
  // The VERTICAL 20 stays: it is breathing room above the search pill, not an alignment,
  // and the bottom is overridden inline with HERO_CONTENT_BOTTOM anyway.
  // gap 12 -> 18. Two things move the search pill DOWN, away from the wordmark it was
  // crowding: HERO_CONTENT_BOTTOM dropping 90 -> 60 takes the whole content box 30pt
  // lower, and this widens the space between the pill and the district row beneath it.
  // Measured on the tightest case — a 360x640 device with a 44pt safe-area inset, where
  // the wordmark's bottom edge lands at 116: the pill's top was 125 (a 9pt gap, which is
  // what 'crowding each other' looks like) and is now 164, clearing by 48.
  content:   { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 16, paddingTop: 20, gap: 18 },
  bottomRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  searchPill:{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 46,
               borderRadius: 23, backgroundColor: '#fff', paddingHorizontal: 16 },
  searchText:{ flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  // A single pill, deliberately shallow: paddingVertical 6 against the old stack's ~71pt.
  // alignSelf flex-start so it hugs its content instead of stretching across the hero.
  // flex:1 so the bottom-right column stays pinned right; the chip itself hugs its
  // content via alignSelf.
  chipCol:   { flex: 1 },
  // ─── NO BACKDROP. PLAIN TEXT ON THE PHOTOGRAPH ────────────────────────────
  //
  // This was a rgba(0,0,0,0.74) pill. The draft has no plate at all — smaller, lighter
  // text sitting directly on the image — and the pill is gone.
  //
  // ⚠ IT WAS NOT SHIPPED BARE ON A HUNCH. Measured against ALL SIX real backgrounds (the
  //   five district photographs and the generic), at the text row's actual position, using
  //   the 95th-percentile luminance rather than a single bright pixel:
  //
  //     BARE, at the OLD position and the OLD ramp — three of six FAIL
  //       kyrenia 4.84  famagusta 3.51  iskele 5.62  karpaz 2.51  nicosia 5.98  generic 1.89
  //
  //   Moving the row lower (HERO_OVERLAP 40 dropped the content box 30pt) was not enough on
  //   its own — the generic is bright at every height. What closed it was the ramp re-solve
  //   plus the generic's own flat scrim; both are documented at BOTTOM_MAX above.
  //
  //     SHIPPED — all six clear the 4.5:1 floor for normal text
  //       kyrenia 6.68  famagusta 6.03  iskele 8.27  karpaz 4.56  nicosia 9.36  generic 5.12
  //
  //   Worst case is karpaz at 4.56:1 on a 360x305 hero. Re-measure all six if the ramp,
  //   HERO_OVERLAP or the type size changes — each of the three moves these numbers.
  //
  // The textShadow is a belt-and-braces perceptual aid at glyph EDGES and is deliberately
  // not counted in any figure above: WCAG has no method for it, so it is not something the
  // numbers may lean on. The scrim is what carries the contrast.
  chip:      { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  // 14pt, down from 17. "Smaller and lighter" is the brief; the floor does not move with
  // size here because 17pt was never large-text either (that needs 18pt, or 14pt bold).
  district:  { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff', flexShrink: 1,
               textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  chipDot:   { fontSize: 12, color: 'rgba(255,255,255,0.75)',
               textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  tempHit:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tempEmoji: { fontSize: 12 },
  tempText:  { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff',
               textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  rightCol:  { alignItems: 'center', gap: 10 },
  openChip:  { width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  infoChip:  { width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.42)', justifyContent: 'center', alignItems: 'center' },
})
