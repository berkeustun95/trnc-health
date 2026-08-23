import { View, Text, Image, StyleSheet } from 'react-native'
import { colors } from '../constants/theme'
import { t } from '../constants/i18n'
import { REGIONS, REGION_LABEL_KEY } from '../constants/regions'
import { MAP_VIEWBOX, MAP_LABEL_ANCHORS } from '../constants/towing'

// Static coverage map of TRNC. Seven regions; the ones a firm serves are filled teal,
// the rest sand.
//
// NO SVG, NO MAP LIBRARY, NO TILES, NO NETWORK. react-native-svg is not in this project
// and cannot be added without a native build (see scripts/generate-towing-map.mjs for
// the full reasoning). The polygons are pre-rasterised into flat PNG masks that stack:
// one base showing all seven in sand, plus one teal overlay per covered region.
//
// Renders offline by design — a driver broken down in the middle of nowhere is the
// exact person looking at this, and they are the least likely to have a connection.
//
// LABELS ARE RN <Text>, NOT BAKED INTO THE PNGs. Two reasons, both load-bearing:
//   1. they have to translate across 9 locales;
//   2. they are keyed off REGION_LABEL_KEY, the same canonical constant the filter and
//      the resolver use — so a region-key drift breaks the build (assertMapKeysMatchRegions)
//      instead of quietly rendering a region as uncovered.

// require() needs literal paths — a computed require is not statically analysable by
// Metro and would silently ship nothing. One line per region, deliberately explicit.
const MASKS = {
  nicosia:   require('../assets/towing-map/nicosia.png'),
  kyrenia:   require('../assets/towing-map/kyrenia.png'),
  famagusta: require('../assets/towing-map/famagusta.png'),
  morphou:   require('../assets/towing-map/morphou.png'),
  iskele:    require('../assets/towing-map/iskele.png'),
  lefke:     require('../assets/towing-map/lefke.png'),
  karpaz:    require('../assets/towing-map/karpaz.png'),
}
const BASE = require('../assets/towing-map/base.png')

const ASPECT = MAP_VIEWBOX.width / MAP_VIEWBOX.height

// Wide enough for the longest district label in any of the 9 locales.
const LABEL_BOX = 96

export default function CoverageMap({ regions = [], lang, showLegend = true, style }) {
  const covered = new Set(Array.isArray(regions) ? regions : [])

  return (
    <View style={style}>
      <View style={s.frame}>
        <Image source={BASE} style={s.layer} resizeMode="contain" />
        {REGIONS.filter(r => covered.has(r)).map(r => (
          <Image key={r} source={MASKS[r]} style={s.layer} resizeMode="contain" />
        ))}

        {REGIONS.map(r => {
          const a = MAP_LABEL_ANCHORS[r]
          const on = covered.has(r)
          return (
            <View
              key={r}
              pointerEvents="none"
              style={[
                s.labelWrap,
                {
                  left: `${(a.x / MAP_VIEWBOX.width) * 100}%`,
                  top:  `${(a.y / MAP_VIEWBOX.height) * 100}%`,
                },
              ]}
            >
              {/* Centred on the anchor by a fixed-width box pulled back half its width.
                  NOT a zero-width box with alignItems:'center' — that measures the Text
                  to 0 and renders nothing on Android. LABEL_BOX is wide enough for the
                  longest translated district name (Greek and Turkish run well past
                  English) and never clips, because nothing here sets overflow:hidden. */}
              <Text
                numberOfLines={1}
                style={[s.label, on ? s.labelOn : s.labelOff]}
              >
                {t(REGION_LABEL_KEY[r], lang)}
              </Text>
            </View>
          )
        })}
      </View>

      {showLegend && (
        <View style={s.legend}>
          <View style={s.legendItem}>
            <View style={[s.swatch, { backgroundColor: colors.primary }]} />
            <Text style={s.legendText}>{t('towingMapLegendOn', lang)}</Text>
          </View>
          <View style={s.legendItem}>
            <View style={[s.swatch, { backgroundColor: colors.sand }]} />
            <Text style={s.legendText}>{t('towingMapLegendOff', lang)}</Text>
          </View>
        </View>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  frame:      { width: '100%', aspectRatio: ASPECT, position: 'relative' },
  layer:      { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },

  // Zero-width centring anchor: the wrapper sits exactly on the label point and the
  // text is allowed to overflow it symmetrically.
  labelWrap:  {
    position: 'absolute',
    width: LABEL_BOX,
    marginLeft: -LABEL_BOX / 2,   // centre horizontally on the anchor
    marginTop: -7,                // centre vertically on it (half a 14px line)
    alignItems: 'center',
  },
  label:      { fontSize: 11, fontWeight: '700', textAlign: 'center' },
  labelOn:    { color: '#FFFFFF' },
  labelOff:   { color: colors.textSecondary },

  legend:     { flexDirection: 'row', justifyContent: 'center', gap: 18, marginTop: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch:     { width: 11, height: 11, borderRadius: 3 },
  legendText: { fontSize: 12, color: colors.textSecondary },
})
