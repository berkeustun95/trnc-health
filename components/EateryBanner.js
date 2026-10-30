import { View, Text, Animated, Image, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { t } from '../constants/i18n'
import { REGION_LABEL_KEY } from '../constants/regions'
import { EATERY_CATEGORY_KEY, EATERY_BANNER_H, BANNER_BAR_ROW } from '../constants/eatery'
import { colors, type, space, elevation } from '../constants/theme'
import { Card, IconButton, RemoteImage } from './ui'
import { HEADER_SCRIM, SCRIM_FADE } from './ui/ModuleScreen'
import SplashStatusBar from './SplashStatusBar'
import { EateryLogo, PlaceholderTag } from './EateryBits'

// Partner page photo banner: the photo sits behind the scroll (BannerPhoto), the head card overlaps its bottom edge
// (BannerHead), and a fixed bar (BannerBar) goes from white-on-scrim to a canvas bar as the page scrolls.
// All three are defined here, outside the screen, so a scroll-driven re-render never remounts the photo.
export const BANNER_COLLAPSE = EATERY_BANNER_H - BANNER_BAR_ROW   // scroll offset at which the photo is fully behind the bar
export const BAR_SOLID_AT = BANNER_COLLAPSE - 24                  // the status bar icons flip dark here
const FADE_IN = 48   // the canvas bar fades in over this much scroll, ending at BANNER_COLLAPSE
const DARK_FADE = require('../assets/oli-scenes/dark-fade.png')   // black 0.6 -> 0, the same strip ModuleScreen uses

export function BannerPhoto({ y, uri, reduce, onError }) {
  const insets = useSafeAreaInsets()
  const translateY = y.interpolate({ inputRange: [0, 1], outputRange: [0, -1], extrapolateLeft: 'clamp' })
  return (
    <Animated.View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
      style={[s.photo, { height: EATERY_BANNER_H + insets.top, transform: [{ translateY }] }]}>
      <RemoteImage source={{ uri }} resizeMode="cover" style={s.fill} placeholderColor={colors.primaryDark}
        transition={reduce ? 0 : 200} onError={onError} accessibilityIgnoresInvertColors />
      <View style={[s.band, { height: insets.top + BANNER_BAR_ROW, backgroundColor: `rgba(0,0,0,${HEADER_SCRIM})` }]} />
      <Image source={DARK_FADE} resizeMode="stretch"
        style={[s.band, { top: insets.top + BANNER_BAR_ROW, height: SCRIM_FADE, opacity: HEADER_SCRIM / 0.6 }]} />
    </Animated.View>
  )
}

export function BannerBar({ y, lang, onBack, solid }) {
  const insets = useSafeAreaInsets()
  const ramp = [BANNER_COLLAPSE - FADE_IN, BANNER_COLLAPSE]
  const canvasOp = y.interpolate({ inputRange: ramp, outputRange: [0, 1], extrapolate: 'clamp' })
  const whiteOp = y.interpolate({ inputRange: ramp, outputRange: [1, 0], extrapolate: 'clamp' })
  const title = t('menuEatery', lang)
  return (
    <View pointerEvents="box-none" style={[s.bar, { height: insets.top + BANNER_BAR_ROW, paddingTop: insets.top }]}>
      <SplashStatusBar style={solid ? 'dark' : 'light'} />
      <Animated.View pointerEvents="none" style={[s.canvas, { opacity: canvasOp }]} />
      <View style={s.row}>
        <IconButton icon="chevron-back" iconSize={24} onPress={onBack} accessibilityLabel={t('back', lang)}
          style={[s.back, elevation.card]} />
        <View style={s.titleBox}>
          <Animated.View pointerEvents="none" style={[s.titleLayer, { opacity: whiteOp }]}
            importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <Text style={[s.title, { color: colors.onPrimary }]} numberOfLines={1}>{title}</Text>
          </Animated.View>
          <Animated.View style={[s.titleLayer, { opacity: canvasOp }]}>
            <Text style={[s.title, { color: colors.textPrimary }]} numberOfLines={1} accessibilityRole="header">{title}</Text>
          </Animated.View>
        </View>
      </View>
    </View>
  )
}

export function BannerHead({ partner, lang }) {
  const regionKey = REGION_LABEL_KEY[partner.region]
  const category = t(EATERY_CATEGORY_KEY[partner.category] || 'eateryCatRestaurant', lang)
  const sub = regionKey ? `${category} · ${t(regionKey, lang)}` : category
  return (
    <Card style={elevation.floating}>
      <View style={s.head}>
        <EateryLogo partner={partner} width={96} height={72} decorative />
        <View style={s.headText}>
          <Text style={s.name} numberOfLines={2}>{partner.name}</Text>
          <Text style={s.sub}>{sub}</Text>
        </View>
      </View>
      {!!partner.placeholder && <PlaceholderTag lang={lang} style={s.tag} />}
      {partner.is_active === false && <PlaceholderTag lang={lang} labelKey="eateryUnpublishedTag" style={s.tag} />}
    </Card>
  )
}

const s = StyleSheet.create({
  photo:      { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: colors.primaryDark, overflow: 'hidden' },
  fill:       { width: '100%', height: '100%' },
  band:       { position: 'absolute', top: 0, left: 0, right: 0 },
  bar:        { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  canvas:     { ...StyleSheet.absoluteFillObject, backgroundColor: colors.canvas },
  row:        { height: BANNER_BAR_ROW, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space[16], gap: space[12] },
  back:       { backgroundColor: colors.card },
  titleBox:   { flex: 1, height: BANNER_BAR_ROW },
  titleLayer: { ...StyleSheet.absoluteFillObject, justifyContent: 'center' },
  title:      { ...type.sectionHeading },
  head:       { flexDirection: 'row', alignItems: 'center', gap: space[16] },
  headText:   { flex: 1 },
  name:       { ...type.detailTitle, color: colors.textPrimary },
  sub:        { ...type.body, color: colors.textSecondary, marginTop: space[4] },
  tag:        { marginTop: space[12] },
})
