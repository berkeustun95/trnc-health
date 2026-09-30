import { useEffect } from 'react'
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, category, type, radii, press } from '../../../constants/theme'
import { t, tCount } from '../../../constants/i18n'
import { uvLevel, weatherGroup, weatherLabelKey } from '../../../utils/facilityUtils'
import { DUTY_FRESH, DUTY_PARTIAL } from '../../../utils/dutyStatus'
import { rememberStripKind } from '../../../utils/homeStripResolver'
import { Bone, ErrorState, IconButton } from '../../ui'

export const TILE_H = 118
export const GAP = 12
export const TALL_H = TILE_H * 2 + GAP

// ─── Duty pharmacies ─────────────────────────────────────────────────────────
// COUNT ONLY, never a pharmacy name: the tile must not rank one pharmacy over another.
// Four states, never confused with each other:
//   loading  → bones (the query has not answered; the old default of "fresh" lied here)
//   error    → the fetch failed: message + retry, and the tile still opens the list
//   unhealthy→ partial / stale / absent roster: an ALERT, not "0 eczane" — an empty duty
//              roster is an error in this country, there is always a duty pharmacy
//   fresh    → "Bugün {n} eczane nöbette · {until}"
// The whole tile is the target (opens DutyListScreen, which carries the KTEB fallback);
// dutyRef lands on it because App.js measures that ref for the coach mark.
export function DutyTile({ summary, lang, onPress, onRetry, dutyRef }) {
  const { loaded, error, status, count, until } = summary || {}
  const fresh = status === DUTY_FRESH
  const alert = loaded && !error && !fresh
  const untilText = until === '00:00' ? t('hrDutyUntilMidnight', lang)
    : until ? t('hrDutyUntil', lang).replace('{time}', until) : null
  const countLine = loaded && !error && count > 0 ? tCount('hrDutyCount', count, lang) : null
  const a11y = [t('stripDutyTitle', lang), countLine, fresh ? untilText : null,
    alert ? t(status === DUTY_PARTIAL ? 'hrDutyPartial' : 'hrDutyUnavailable', lang) : null]
    .filter(Boolean).join(', ')

  return (
    <TouchableOpacity ref={dutyRef} collapsable={false} onPress={onPress} activeOpacity={press.card}
      accessibilityRole="button" accessibilityLabel={a11y}
      style={[s.tile, s.tall, { backgroundColor: category.health.bg }, alert && s.alertBorder]}>
      <View style={s.iconDisc}>
        <Ionicons name={alert ? 'alert-circle' : 'medkit'} size={22} color={category.health.ink} />
      </View>
      <Text style={s.dutyTitle}>{t('stripDutyTitle', lang)}</Text>

      <View style={s.dutyBody}>
        {!loaded && (<><Bone width="90%" height={13} /><Bone width="60%" height={13} style={{ marginTop: 8 }} /></>)}
        {loaded && error && (
          <ErrorState compact lang={lang} message={t('hrDutyUnavailable', lang)} onRetry={onRetry} />
        )}
        {loaded && !error && (
          <>
            {!!countLine && <Text style={s.dutyLine}>{countLine}</Text>}
            {fresh && !!untilText && <Text style={s.dutySub}>{untilText}</Text>}
            {alert && (
              <Text style={s.alertText}>
                {t(status === DUTY_PARTIAL ? 'hrDutyPartial' : 'hrDutyUnavailable', lang)}
              </Text>
            )}
          </>
        )}
      </View>

      <View style={s.dutyBtn}>
        <Text style={s.dutyBtnText} numberOfLines={1}>{t('hrDutyOpenList', lang)}</Text>
        <Ionicons name="arrow-forward" size={15} color={category.health.ink} />
      </View>
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

// ─── Oli ─────────────────────────────────────────────────────────────────────
// The only solid tile. White on primary is 5.01:1; the lead line keeps V2's #F2FAFA
// (4.74:1 on flat primary, measured in V2 and unchanged here).
export function OliTile({ lang, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={press.card} accessibilityRole="button"
      accessibilityLabel={`${t('homeOliTitle', lang)}. ${t('homeOliSub', lang)}`}
      style={[s.tile, { height: TILE_H, backgroundColor: colors.primary, overflow: 'hidden' }]}>
      <Text style={s.oliLead} numberOfLines={2}>{t('homeOliSub', lang)}</Text>
      <Text style={s.oliTitle} numberOfLines={1}>{t('homeOliTitle', lang)}</Text>
      <Image source={require('../../../assets/oli-button.png')} style={s.oli} resizeMode="contain"
        accessibilityIgnoresInvertColors />
    </TouchableOpacity>
  )
}

// ─── Tonight (event banner) ──────────────────────────────────────────────────
// The item comes from resolveStripItem, unchanged: a pinned event, tonight's first event,
// the dormant notice path, a new place or a promo — and the generic events fallback, so the
// banner never stands empty. Photo, dark band, time chip (events only). Dismiss exists only
// on a notice, as in V2.
const EVENTS_IMAGE = require('../../../assets/backgrounds/ada-bg-events.png')
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
  tile:        { borderRadius: radii.widget, padding: 14 },
  tall:        { height: TALL_H, justifyContent: 'space-between' },
  alertBorder: { borderWidth: 1.5, borderColor: colors.dangerInk },
  iconDisc:    { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.card,
                 justifyContent: 'center', alignItems: 'center' },
  dutyTitle:   { ...type.rowTitle, color: colors.textPrimary, marginTop: 10 },
  dutyBody:    { flex: 1, marginTop: 6 },
  dutyLine:    { ...type.small, fontFamily: 'Inter_600SemiBold', color: colors.textPrimary },
  dutySub:     { ...type.small, color: colors.textSecondary, marginTop: 2 },
  alertText:   { ...type.small, fontFamily: 'Inter_600SemiBold', color: colors.dangerInk, marginTop: 4 },
  dutyBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                 backgroundColor: colors.card, borderRadius: radii.pill, minHeight: 40, paddingHorizontal: 12 },
  dutyBtnText: { ...type.small, fontFamily: 'Inter_600SemiBold', color: category.health.ink, flexShrink: 1 },

  weatherTop:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  temp:        { ...type.pageTitle, color: colors.textPrimary },
  cond:        { ...type.small, fontFamily: 'Inter_600SemiBold', color: colors.textPrimary, marginTop: 4 },
  uv:          { ...type.meta, color: colors.textSecondary, marginTop: 2 },

  oliLead:     { ...type.meta, color: '#F2FAFA', maxWidth: '70%' },
  oliTitle:    { ...type.sectionHeading, color: colors.onPrimary, marginTop: 4 },
  oli:         { position: 'absolute', right: -6, bottom: -8, width: 62, height: 62 },

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
