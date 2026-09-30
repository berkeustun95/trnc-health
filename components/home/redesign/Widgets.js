import { useEffect } from 'react'
import { View, Text, Image, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, category, type, radii, press } from '../../../constants/theme'
import { t, tCount } from '../../../constants/i18n'
import { uvLevel, weatherGroup, weatherLabelKey } from '../../../utils/facilityUtils'
import { DUTY_FRESH, DUTY_PARTIAL } from '../../../utils/dutyStatus'
import { rememberStripKind } from '../../../utils/homeStripResolver'
import { untilTr } from '../../../utils/turkishTime'
import { weatherPhoto, isNightNow } from '../../../constants/weatherPhotos'
import { Bone, ErrorState, IconButton } from '../../ui'

// Both tiles are the V2 live-strip card: full photo, icon badge top-left, dark text band at
// the bottom. Height = badge (10 + 28) + band at its worst case at the 1.15 font cap:
// 8 + 2·17·1.15 (title) + 2·16·1.15 (line) + 8 ≈ 92 → 38 + 4 + 92 = 134. Usually the band
// is two lines and the photo shows above it. labels:check measures every string in it.
export const TILE_H = 134
export const GAP = 12
export const TILE_FONT_CAP = 1.15   // maxFontSizeMultiplier for text in fixed-height tiles
export const TILE_FONT_CAP_NARROW = 1.0   // below 350dp the band cannot take any growth
const tileCap = w => (w < 350 ? TILE_FONT_CAP_NARROW : TILE_FONT_CAP)

// ─── The photo card ──────────────────────────────────────────────────────────
// ⚠ THE IMAGE STYLE IS V2's, ON PURPOSE. In the ADA Preview release APK the duty photo did not
//   draw (the tile showed the scrim over its fallback colour) while the drawable WAS in the
//   APK (aapt2: drawable/assets_backgrounds_adabgdutypharmacy) and the bundle referenced it.
//   The one difference from the V2 strip — which renders this same drawable in production —
//   was a bare StyleSheet.absoluteFill with no width/height. This uses V2's exact style
//   (absoluteFillObject + width/height 100%). Not reproduced here (no emulator on this Mac):
//   confirm on the next Preview build.
// Text sits ONLY on the band: white on rgba(0,0,0,0.72) over a pure-white pixel is 9.29:1,
// so the photo cannot decide the ratio.
function PhotoTile({ image, icon, title, titleLines = 1, line, onPress, a11y, innerRef, surface, alert }) {
  const onPhoto = !!image && !surface
  const cap = tileCap(useWindowDimensions().width)
  return (
    <TouchableOpacity ref={innerRef} collapsable={false} onPress={onPress} disabled={!onPress}
      activeOpacity={press.card} accessibilityRole="button" accessibilityLabel={a11y}
      style={[s.card, { height: TILE_H, backgroundColor: surface || colors.border }, alert && s.alertBorder]}>
      {onPhoto && <Image source={image} style={s.photo} resizeMode="cover" />}
      <View style={[s.badge, alert && s.badgeAlert]}>
        <Ionicons name={alert ? 'alert-circle' : icon} size={15} color={alert ? '#FFFFFF' : colors.textPrimary} />
      </View>
      {/* The arrow sits top-right, not in the band: the band keeps its full width for text. */}
      {!!onPress && (
        <View style={s.arrow}><Ionicons name="arrow-forward" size={15} color={colors.textPrimary} /></View>
      )}
      <View style={[s.band, !onPhoto && s.bandOnSurface]}>
        <Text style={[s.bandTitle, !onPhoto && s.darkText]} numberOfLines={titleLines} maxFontSizeMultiplier={cap}>{title}</Text>
        {typeof line === 'function' ? line(cap) : line}
      </View>
    </TouchableOpacity>
  )
}

// ─── Duty pharmacies ─────────────────────────────────────────────────────────
// COUNT ONLY, never a pharmacy name. States, never confused with each other:
//   loading → bone line · error → message + retry (tinted surface) · partial/stale/absent →
//   ALERT on the tinted surface (an empty duty roster is an error here, there is always a
//   duty pharmacy) · fresh → "13 eczane · 00.00'a kadar". The whole tile opens the duty
//   list (KTEB fallback lives there); dutyRef is App.js's coach-mark target.
export function dutyUntilText(until, lang) {
  if (!until) return null
  if (lang === 'Turkish') return untilTr(until)
  return t('hrDutyUntil', lang).replace('{time}', String(until).slice(0, 5))
}

export function DutyTile({ summary, lang, onPress, onRetry, dutyRef }) {
  const { loaded, error, status, count, until } = summary || {}
  const fresh = status === DUTY_FRESH
  const alert = loaded && !error && !fresh
  const untilText = dutyUntilText(until, lang)
  const short = loaded && !error && count > 0
    ? tCount('hrDutyShort', count, lang).replace('{until}', fresh && untilText ? untilText : '').replace(/ · $/, '')
    : null
  // Tile-only short wording for the two unhealthy states; the full sentence is in the a11y label.
  const alertText = alert ? t(status === DUTY_PARTIAL ? 'hrDutyTileAlertPartial' : 'hrDutyTileAlertDown', lang) : null
  const title = t('stripDutyTitle', lang)
  let line
  if (!loaded) line = <Bone width="80%" height={11} style={{ marginTop: 5 }} />
  else if (error) line = <ErrorState compact lang={lang} message={t('hrDutyTileAlertDown', lang)} onRetry={onRetry} />
  else if (alert) line = cap => <Text style={s.alertText} numberOfLines={2} maxFontSizeMultiplier={cap}>{alertText}</Text>
  else line = cap => <Text style={s.bandLine} numberOfLines={2} maxFontSizeMultiplier={cap}>{short}</Text>
  return (
    <PhotoTile
      innerRef={dutyRef}
      image={DUTY_IMAGE}
      icon="medkit"
      title={title}
      titleLines={2}
      line={line}
      onPress={onPress}
      surface={alert || error ? category.health.bg : null}
      alert={alert || error}
      a11y={[title, short, alert ? t(status === DUTY_PARTIAL ? 'hrDutyPartial' : 'hrDutyUnavailable', lang) : null,
        error ? t('hrDutyUnavailable', lang) : null].filter(Boolean).join(', ')}
    />
  )
}

// ─── Weather ─────────────────────────────────────────────────────────────────
// "24° · Güneşli" on the band, UV as text below. The photo follows the weather (bundled CC0
// set, constants/weatherPhotos.js); an unmapped code falls back to the city tint.
const WEATHER_ION = {
  clear: 'sunny', partlyCloudy: 'partly-sunny', overcast: 'cloudy',
  fog: 'cloudy', drizzle: 'rainy', rain: 'rainy', snow: 'snow',
  showers: 'rainy', thunder: 'thunderstorm', unknown: 'thermometer',
}

export function WeatherTile({ weatherData, lang, onPress }) {
  const cur = weatherData?.current
  const uv = cur ? uvLevel(cur.uv_index) : null
  const temp = cur?.temperature_2m
  // Tile-only: "Partly cloudy" is too long for the band in ru/fr/es; the short forecast term
  // is used here and the full name stays in the weather sheet.
  const condKey = cur ? weatherLabelKey(cur.symbol) : null
  const cond = cur ? t(condKey === 'weatherPartlyCloudy' ? 'hrWxPartlyTile' : condKey, lang) : null
  const uvText = uv ? t('hrWeatherUv', lang).replace('{n}', String(Math.round(cur.uv_index))).replace('{level}', t(uv.key, lang)) : null
  const photo = cur ? weatherPhoto(cur.symbol, isNightNow(weatherData)) : null
  // "24° · Parçalı bulutlu" over up to two lines. UV left the tile (Berke: less text is fine);
  // it stays in the weather sheet and in this tile's accessibility label.
  const title = cur ? `${temp != null ? Math.round(temp) + '°' : '—'} · ${cond}` : t('homeWeatherTitle', lang)
  const line = cur ? null : <Bone width="60%" height={11} style={{ marginTop: 5 }} />
  return (
    <PhotoTile
      image={photo?.source}
      icon={WEATHER_ION[weatherGroup(cur?.symbol)] || WEATHER_ION.unknown}
      title={title}
      titleLines={2}
      line={line}
      onPress={cur ? onPress : undefined}
      surface={photo ? null : category.city.bg}
      a11y={[t('homeWeatherTitle', lang), cur ? title : null, uvText].filter(Boolean).join(', ')}
    />
  )
}

// ─── Oli + search (one card; the hero no longer has a search bar) ──────────
// The only solid tile. White on primary is 5.01:1. The field is a white pill inside the
// card; the whole card opens the Oli sheet with its input focused. searchRef lands on the
// field — App.js measures it for the search coach mark.
export function OliSearchCard({ lang, onPress, searchRef }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={press.card} accessibilityRole="search"
      accessibilityLabel={`${t('homeOliTitle', lang)}. ${t('hrOliField', lang)}`}
      style={s.oliCard}>
      <Image source={require('../../../assets/oli-button.png')} style={s.oli} resizeMode="contain"
        accessibilityIgnoresInvertColors pointerEvents="none" />
      <View style={s.oliBody}>
        <Text style={s.oliTitle} numberOfLines={1}>{t('homeOliTitle', lang)}</Text>
        <View ref={searchRef} collapsable={false} style={s.oliField}>
          <Ionicons name="search" size={17} color={colors.textSecondary} />
          <Text style={s.oliFieldText} numberOfLines={1}>{t('hrOliField', lang)}</Text>
        </View>
      </View>
    </TouchableOpacity>
  )
}

// ─── Tonight (event banner) ──────────────────────────────────────────────────
// The item comes from resolveStripItem, unchanged: a pinned event, tonight's first event,
// the dormant notice path, a new place or a promo — and the generic events fallback, so the
// banner never stands empty. Photo, dark band, time chip (events only). Dismiss exists only
// on a notice, as in V2.
const EVENTS_IMAGE = require('../../../assets/backgrounds/ada-bg-events.png')
// The old live strip's duty card photo, reused (no new image).
const DUTY_IMAGE = require('../../../assets/backgrounds/ada-bg-duty-pharmacy.png')
const NOTICE_FALLBACK = { accommodation: require('../../../assets/backgrounds/ada-bg-accommodation.png') }

export function EventBanner({ item, loading, lang, onPress, onDismiss }) {
  const kind = item?.kind
  useEffect(() => { if (!loading && kind) rememberStripKind(kind) }, [loading, kind])
  if (loading) return <Bone width="100%" height={160} borderRadius={radii.widget} />
  if (!item) return null
  const title = item.generic ? t(item.titleKey, lang) : item.title
  const time = item.kind === 'event' && !item.generic && item.subtitle ? item.subtitle : null
  const tag = item.sponsored ? t('stripSponsored', lang) : item.soon ? t('stripStartingSoon', lang) : null
  const fallback = (item.kind === 'notice' && NOTICE_FALLBACK[item.action?.route]) || EVENTS_IMAGE
  return (
    <View>
      <TouchableOpacity onPress={() => onPress?.(item)} activeOpacity={press.card} accessibilityRole="button"
        accessibilityLabel={[title, time, tag].filter(Boolean).join(', ')} style={s.banner}>
        <Image source={item.imageUrl ? { uri: item.imageUrl } : fallback} style={s.bannerPhoto} resizeMode="cover" />
        {!!time && (
          <View style={s.timeChip}>
            <Ionicons name="time-outline" size={14} color={colors.textPrimary} />
            <Text style={s.timeText}>{time}</Text>
          </View>
        )}
        {!!tag && <View style={s.tag}><Text style={s.tagText} numberOfLines={1}>{tag}</Text></View>}
        <View style={s.bannerBand}>
          <Text style={s.bannerTitle} numberOfLines={2}>{title}</Text>
          <Ionicons name="chevron-forward" size={18} color="#FFFFFF" />
        </View>
      </TouchableOpacity>
      {item.kind === 'notice' && !!onDismiss && (
        <IconButton icon="close" iconSize={16} variant="frosted" onPress={() => onDismiss(item)}
          accessibilityLabel={t('uiClose', lang)} style={s.dismiss} />
      )}
    </View>
  )
}

const s = StyleSheet.create({
  card:        { borderRadius: radii.widget, overflow: 'hidden' },
  alertBorder: { borderWidth: 1.5, borderColor: colors.dangerInk },
  photo:       { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  badge:       { position: 'absolute', top: 10, left: 10, width: 28, height: 28, borderRadius: 14,
                 backgroundColor: 'rgba(255,255,255,0.94)', justifyContent: 'center', alignItems: 'center' },
  badgeAlert:  { backgroundColor: colors.dangerInk },
  band:        { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.72)',
                 paddingHorizontal: 12, paddingVertical: 8 },
  arrow:       { position: 'absolute', top: 10, right: 10, width: 28, height: 28, borderRadius: 14,
                 backgroundColor: 'rgba(255,255,255,0.94)', justifyContent: 'center', alignItems: 'center' },
  bandOnSurface:{ backgroundColor: 'transparent' },
  bandTitle:   { ...type.small, fontFamily: 'Inter_600SemiBold', lineHeight: 17, color: '#FFFFFF' },
  bandLine:    { ...type.meta, fontFamily: 'Inter_500Medium', color: '#FFFFFF', marginTop: 1 },
  darkText:    { color: colors.textPrimary },
  alertText:   { ...type.meta, fontFamily: 'Inter_600SemiBold', color: colors.dangerInk, marginTop: 1 },

  // ─── MASCOT GEOMETRY, FROM THE ASSET'S OWN ALPHA BOUNDS ────────────────────
  // oli-button.png is 1024² and the art occupies x 26.6–72.3%, y 5.3–91.5%. At 120pt the
  // visible mascot is 103pt tall on a 100pt card: feet on the bottom edge, head ~3.4pt above
  // the top — which leaves 8.6pt of the 12pt gap clear of the tiles above (Berke: ≥ 8pt).
  // Visible left edge 8pt, right edge 63pt, so the content starts at 70 — flush beside him.
  oliCard:     { backgroundColor: colors.primary, borderRadius: radii.widget, height: 100,
                 paddingLeft: 70, paddingRight: 12, justifyContent: 'center', overflow: 'visible' },
  oli:         { position: 'absolute', left: -24, bottom: -10, width: 120, height: 120 },
  oliBody:     { gap: 6 },
  oliTitle:    { ...type.sectionHeading, color: colors.onPrimary },
  oliField:    { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, borderRadius: 999,
                 backgroundColor: colors.card, paddingHorizontal: 14 },
  oliFieldText:{ ...type.body, color: colors.textSecondary, flex: 1 },

  banner:      { height: 160, borderRadius: radii.widget, overflow: 'hidden', backgroundColor: colors.border },
  bannerPhoto: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  timeChip:    { position: 'absolute', top: 12, left: 12, flexDirection: 'row', alignItems: 'center', gap: 5,
                 backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: radii.pill, paddingHorizontal: 10, height: 28 },
  timeText:    { ...type.meta, fontFamily: 'Inter_600SemiBold', color: colors.textPrimary },
  tag:         { position: 'absolute', top: 12, right: 12, backgroundColor: 'rgba(0,0,0,0.62)',
                 borderRadius: radii.pill, paddingHorizontal: 10, height: 26, justifyContent: 'center' },
  tagText:     { ...type.caption, color: '#FFFFFF' },
  // White on rgba(0,0,0,0.72) over a white photo: 9.29:1 (computed). A solid band, so the ratio is a
  // constant rather than a function of which photo loaded.
  bannerBand:  { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.72)',
                 flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10 },
  bannerTitle: { ...type.rowTitle, color: '#FFFFFF', flex: 1 },
  dismiss:     { position: 'absolute', top: 4, right: 4 },
})
