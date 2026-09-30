import { useEffect } from 'react'
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, category, type, radii, press } from '../../../constants/theme'
import { t, tCount } from '../../../constants/i18n'
import { uvLevel, weatherGroup, weatherLabelKey } from '../../../utils/facilityUtils'
import { DUTY_FRESH, DUTY_PARTIAL } from '../../../utils/dutyStatus'
import { rememberStripKind } from '../../../utils/homeStripResolver'
import { untilTr } from '../../../utils/turkishTime'
import { Bone, ErrorState, IconButton } from '../../ui'

// Sized for the longest locale at 320dp: title 2 lines, count 3, until 1 = 132pt of content
// (npm run labels:check measures the strings; this is their height budget).
export const TILE_H = 136
export const GAP = 12

// ─── Duty pharmacies (compact: same size as the weather tile) ────────────────
// COUNT ONLY, never a pharmacy name: the tile must not rank one pharmacy over another.
// Four states, never confused with each other:
//   loading  → bones (the query has not answered; the old default of "fresh" lied here)
//   error    → the fetch failed: message + retry, and the tile still opens the list
//   unhealthy→ partial / stale / absent roster: an ALERT, not "0 eczane" — an empty duty
//              roster is an error in this country, there is always a duty pharmacy
//   fresh    → "Bugün {n} eczane nöbette" · "00.00'a kadar"
// The whole tile is the target (opens DutyListScreen, which carries the KTEB fallback);
// dutyRef lands on it because App.js measures that ref for the coach mark.
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
  const countLine = loaded && !error && count > 0 ? tCount('hrDutyCount', count, lang) : null
  const alertText = alert ? t(status === DUTY_PARTIAL ? 'hrDutyPartial' : 'hrDutyUnavailable', lang) : null
  const a11y = [t('stripDutyTitle', lang), countLine, fresh ? untilText : null, alertText,
    error ? t('hrDutyUnavailable', lang) : null].filter(Boolean).join(', ')

  // The photo shows while the roster is healthy (or still loading). An alert or a failed
  // fetch REPLACES it with the tinted surface and dark text — the V2 strip's rule: an
  // unhealthy duty card must be unmistakable at a glance, not a shade different.
  const onPhoto = !alert && !error
  const ink = onPhoto ? '#FFFFFF' : category.health.ink
  return (
    <TouchableOpacity ref={dutyRef} collapsable={false} onPress={onPress} activeOpacity={press.card}
      accessibilityRole="button" accessibilityLabel={a11y}
      style={[s.tile, s.photoTile, { height: TILE_H, backgroundColor: category.health.bg }, alert && s.alertBorder]}>
      {onPhoto && (
        <>
          <Image source={DUTY_IMAGE} style={StyleSheet.absoluteFill} resizeMode="cover" />
          <View style={[StyleSheet.absoluteFill, s.scrim]} />
        </>
      )}
      <View style={s.titleRow}>
        <Text style={[s.dutyTitle, { color: onPhoto ? '#FFFFFF' : colors.textPrimary }]} numberOfLines={2}>
          {t('stripDutyTitle', lang)}
        </Text>
        <Ionicons name={alert || error ? 'alert-circle' : 'arrow-forward'} size={18} color={ink} />
      </View>
      {!loaded && (<><Bone width="90%" height={12} style={{ marginTop: 8 }} /><Bone width="60%" height={12} style={{ marginTop: 6 }} /></>)}
      {loaded && error && (
        <ErrorState compact lang={lang} message={t('hrDutyUnavailable', lang)} onRetry={onRetry} style={{ marginTop: 2 }} />
      )}
      {loaded && !error && (
        <>
          {!!countLine && <Text style={[s.dutyLine, onPhoto && s.onPhoto]} numberOfLines={3}>{countLine}</Text>}
          {fresh && !!untilText && <Text style={[s.dutySub, onPhoto && s.onPhoto]} numberOfLines={1}>{untilText}</Text>}
          {alert && <Text style={s.alertText} numberOfLines={3}>{alertText}</Text>}
        </>
      )}
    </TouchableOpacity>
  )
}

// ─── Weather ─────────────────────────────────────────────────────────────────
// Temperature, condition, UV AS TEXT. No emoji and no coloured UV badge — the V2 badges
// measured 1.92–3.76:1. Opens the existing WeatherSheet.
const WEATHER_ION = {
  clear: 'sunny-outline', partlyCloudy: 'partly-sunny-outline', overcast: 'cloudy-outline',
  fog: 'cloudy-outline', drizzle: 'rainy-outline', rain: 'rainy-outline', snow: 'snow-outline',
  showers: 'rainy-outline', thunder: 'thunderstorm-outline', unknown: 'thermometer-outline',
}

export function WeatherTile({ weatherData, lang, onPress }) {
  const cur = weatherData?.current
  const uv = cur ? uvLevel(cur.uv_index) : null
  const temp = cur?.temperature_2m
  const cond = cur ? t(weatherLabelKey(cur.symbol), lang) : null
  const uvText = uv ? t('hrWeatherUv', lang).replace('{n}', String(Math.round(cur.uv_index))).replace('{level}', t(uv.key, lang)) : null
  return (
    <TouchableOpacity onPress={cur ? onPress : undefined} disabled={!cur} activeOpacity={press.card}
      accessibilityRole="button"
      accessibilityLabel={[t('homeWeatherTitle', lang), temp != null ? `${Math.round(temp)}°C` : null, cond, uvText].filter(Boolean).join(', ')}
      style={[s.tile, { height: TILE_H, backgroundColor: category.city.bg }]}>
      <View style={s.weatherTop}>
        <Text style={s.temp}>{temp != null ? `${Math.round(temp)}°` : '—'}</Text>
        <Ionicons name={WEATHER_ION[weatherGroup(cur?.symbol)] || WEATHER_ION.unknown} size={26} color={category.city.ink} />
      </View>
      {cur ? (
        <>
          <Text style={s.cond} numberOfLines={1}>{cond}</Text>
          {!!uvText && <Text style={s.uv} numberOfLines={1}>{uvText}</Text>}
        </>
      ) : (
        <><Bone width="70%" height={12} /><Bone width="50%" height={12} style={{ marginTop: 6 }} /></>
      )}
    </TouchableOpacity>
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
  tile:        { borderRadius: radii.widget, padding: 12 },
  alertBorder: { borderWidth: 1.5, borderColor: colors.dangerInk },
  photoTile:   { overflow: 'hidden' },
  // White on this photo under 0.60 black: p95 6.51:1 (393dp tile) / 6.45 (320dp), measured
  // on ada-bg-duty-pharmacy.png at tile size — every pixel, since text can sit anywhere.
  scrim:       { backgroundColor: 'rgba(0,0,0,0.60)' },
  onPhoto:     { color: '#FFFFFF' },
  titleRow:    { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  dutyTitle:   { ...type.body, fontFamily: 'Inter_600SemiBold', lineHeight: 18, flex: 1 },
  dutyLine:    { ...type.small, fontFamily: 'Inter_600SemiBold', color: colors.textPrimary, marginTop: 2 },
  dutySub:     { ...type.small, color: colors.textSecondary, marginTop: 1 },
  alertText:   { ...type.small, fontFamily: 'Inter_600SemiBold', color: colors.dangerInk, marginTop: 2 },

  weatherTop:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  temp:        { ...type.pageTitle, color: colors.textPrimary },
  cond:        { ...type.small, fontFamily: 'Inter_600SemiBold', color: colors.textPrimary, marginTop: 4 },
  uv:          { ...type.meta, color: colors.textSecondary, marginTop: 2 },

  // ─── MASCOT GEOMETRY, FROM THE ASSET'S OWN ALPHA BOUNDS ────────────────────
  // oli-button.png is 1024² and the art occupies x 26.6–72.3%, y 5.3–91.5%. At 136pt the
  // visible mascot is 117pt tall on a 100pt card, feet on the card's bottom edge, head
  // ~17pt above its top (it pops). Visible left edge 8pt, right edge 70pt, so the content
  // starts at 78 — flush beside the mascot, no gap. overflow stays visible for the pop.
  oliCard:     { backgroundColor: colors.primary, borderRadius: radii.widget, height: 100,
                 paddingLeft: 78, paddingRight: 12, justifyContent: 'center', overflow: 'visible' },
  oli:         { position: 'absolute', left: -28, bottom: -12, width: 136, height: 136 },
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
