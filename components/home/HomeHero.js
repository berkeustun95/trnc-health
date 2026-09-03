import { useState } from 'react'
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors } from '../../constants/theme'
import { t } from '../../constants/i18n'
import { REGION_LABEL_KEY } from '../../constants/regions'
import { resolveHero } from '../../constants/homeHero'
import HeroCreditSheet from './HeroCreditSheet'
import { weatherIcon } from '../../utils/facilityUtils'

// Half-height district hero. Photo + district name + current temperature.
//
// ─── FIXED HEIGHT, ALWAYS ───────────────────────────────────────────────────
// Nothing below this reflows: the image is bundled (constants/homeHero.js), so it paints
// on the first frame with no request and no skeleton, and the only async value on the
// card is the temperature — which appears or does not, inside a box whose height never
// depends on it. A hero that grows when the weather lands would shove the Nöbetçi row
// down under the user's thumb mid-tap.
export const HERO_HEIGHT = 176

// How far the Oli card is pulled up over the hero's bottom edge.
//
// ─── ONE NUMBER, TWO COMPONENTS, AND THAT IS THE POINT ──────────────────────
// The card overlaps the hero by design. What was NOT designed was three controls landing
// in the same corner: the card's top edge crossed both the temperature chip and the
// hero's round arrow, so two tappable things sat underneath an opaque card. Whichever
// won the touch, one of them was a lie.
//
// The fix is that the hero reserves this much space at the bottom of its own content
// (plus clearance), and OliRow pulls up by exactly the same figure — so the overlap
// zone provably contains nothing tappable. Two components reading one constant cannot
// drift; two components each carrying their own -22 can, and silently, because the
// symptom is a mis-tap rather than a visual break.
export const HERO_OVERLAP = 22

// Clearance between the hero's lowest content and the top of the Oli card.
const OVERLAP_CLEARANCE = 14

// ─── THE GRADIENT IS SIX FLAT BANDS, NOT A GRADIENT ─────────────────────────
// expo-linear-gradient is not installed, and this repo does not add packages to get a
// visual effect (CLAUDE.md pins the SDK deliberately). Six stacked bands of increasing
// black alpha across the bottom 60% read as a smooth ramp at hero scale because each
// step is only ~0.09 apart — well under the ~0.02-per-pixel threshold where banding
// becomes visible on a photo. The point of it is legibility, not decoration: the title
// sits on the darkest band, so it stays readable over a bright sky or a pale wall
// without knowing anything about the photo underneath.
const SCRIM_BANDS = [0.04, 0.13, 0.22, 0.34, 0.50, 0.68]

export default function HomeHero({ region, weatherData, lang, onOpenPlace, onOpenWeather }) {
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
  // a GENERIC hero is inert, and deriving it here in each caller is how half of them
  // end up not applying it.
  const tappable = !!placeId

  const body = (
    <View style={s.fill}>
      <Image source={source} style={s.photo} resizeMode="cover" fadeDuration={0} />

      {SCRIM_BANDS.map((a, i) => (
        <View
          key={a}
          pointerEvents="none"
          style={[
            s.band,
            {
              backgroundColor: `rgba(0,0,0,${a})`,
              bottom: (HERO_HEIGHT * 0.6 / SCRIM_BANDS.length) * i,
              height: HERO_HEIGHT * 0.6 / SCRIM_BANDS.length + 1,
            },
          ]}
        />
      ))}

      <View style={s.content} pointerEvents="box-none">
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

        {tappable && (
          <View style={s.openChip} pointerEvents="none">
            <Ionicons name="arrow-forward" size={16} color={colors.textPrimary} />
          </View>
        )}
      </View>

      {/* ℹ︎ — rendered from `credit`, the SAME value that decides whether a licensed
          photo is on screen at all. Not from a separate condition: two conditions is
          how a photo ends up displayed with its route to the attribution missing, and
          that is a licence breach that looks like a working screen. */}
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

  if (!tappable) return <>{<View style={s.card}>{body}</View>}{sheet}</>

  return (
    <>
      <TouchableOpacity
        style={s.card}
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
  card:      { height: HERO_HEIGHT, borderRadius: 20, overflow: 'hidden', backgroundColor: colors.border },
  fill:      { flex: 1 },
  photo:     { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  band:      { position: 'absolute', left: 0, right: 0 },
  // paddingBottom is DERIVED from the overlap, never a literal: everything in here sits
  // above the Oli card's top edge because the number that positions the card is the same
  // number that reserves the room.
  content:   { flex: 1, justifyContent: 'flex-end', flexDirection: 'row', alignItems: 'flex-end', padding: 16, paddingBottom: HERO_OVERLAP + OVERLAP_CLEARANCE, gap: 12 },
  textCol:   { flex: 1 },
  district:  { fontSize: 24, fontFamily: 'Inter_700Bold', color: '#fff' },
  tempPill:  { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6, alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  tempEmoji: { fontSize: 14 },
  tempText:  { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
  openChip:  { width: 34, height: 34, borderRadius: 17, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', marginBottom: 2 },
  // Top-right. The bottom of the hero belongs to the district name, the temperature and
  // the open chip; the top-right is the only corner with nothing in it.
  infoChip:  { position: 'absolute', top: 10, right: 10, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.42)', justifyContent: 'center', alignItems: 'center' },
})
