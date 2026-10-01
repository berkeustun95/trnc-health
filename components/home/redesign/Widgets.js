import { useEffect } from 'react'
import { View, Text, Image, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, category, type, radii, press } from '../../../constants/theme'
import { t, tCount } from '../../../constants/i18n'
import { DUTY_FRESH, DUTY_PARTIAL } from '../../../utils/dutyStatus'
import { rememberStripKind } from '../../../utils/homeStripResolver'
import { untilTr } from '../../../utils/turkishTime'
import { Bone, IconButton, RemoteImage } from '../../ui'

// Home v3 tiles: two equal cards, 104pt. Duty is the V2 live-strip card (photo, icon badge
// top-left, dark band); Acil Numaralar is solid health red. Each band carries its title and
// an arrow — nothing else (Berke: no count, no time; those are in the accessibility label).
// Height = badge (10 + 28) + band at the 1.15 cap: 8 + 2·17·1.15 + 8 ≈ 55 → 93 ≤ 104.
// ALERT and ERROR are rare and must say something, so the row grows to TILE_H_ALERT: title
// (2 lines) + message (2 lines) at the cap = 8 + 39 + 37 + 8 = 92, under a 38pt badge row
// → 130; with the badge row overlapping the band's top padding that is 128. labels:check
// measures every string in both boxes.
export const TILE_H = 104
export const TILE_H_ALERT = 128
export const GAP = 12
export const TILE_FONT_CAP = 1.15   // maxFontSizeMultiplier for text in fixed-height tiles
export const TILE_FONT_CAP_NARROW = 1.0   // below 350dp the band cannot take any growth
export const ARROW_W = 22           // chevron (16) + gap (6) beside the band title
const tileCap = w => (w < 350 ? TILE_FONT_CAP_NARROW : TILE_FONT_CAP)

// ─── The card ────────────────────────────────────────────────────────────────
// ⚠ THE IMAGE STYLE IS V2's, ON PURPOSE (absoluteFillObject + width/height 100%). The Preview
//   duty photo did not draw with a bare StyleSheet.absoluteFill; V2 renders this same drawable
//   in production with this style. Confirmed on the next Preview device check.
// On a photo, text sits ONLY on the 0.72 band (white over a pure-white pixel: 9.29:1).
function Tile({ image, bg, icon, iconColor, title, line, corner, onPress, a11y, innerRef, surface, alert, height }) {
  const onPhoto = !!image && !surface
  const light = onPhoto || !!bg        // white text: on the band, or on the solid red
  const cap = tileCap(useWindowDimensions().width)
  return (
    <TouchableOpacity ref={innerRef} collapsable={false} onPress={onPress} disabled={!onPress}
      activeOpacity={press.card} accessibilityRole="button" accessibilityLabel={a11y}
      style={[s.card, { height, backgroundColor: surface || bg || colors.border }, alert && s.alertBorder]}>
      {onPhoto && <Image source={image} style={s.photo} resizeMode="cover" />}
      <View style={[s.badge, alert && s.badgeAlert]}>
        <Ionicons name={alert ? 'alert-circle' : icon} size={15} color={alert ? '#FFFFFF' : (iconColor || colors.textPrimary)} />
      </View>
      {corner}
      <View style={[s.band, !onPhoto && s.bandClear]}>
        <View style={s.bandRow}>
          <Text style={[s.bandTitle, !light && s.darkText]} numberOfLines={2} maxFontSizeMultiplier={cap}>{title}</Text>
          {!!onPress && <Ionicons name="chevron-forward" size={16} color={light ? '#FFFFFF' : colors.textPrimary} />}
        </View>
        {typeof line === 'function' ? line(cap) : line}
      </View>
    </TouchableOpacity>
  )
}

// ─── Duty pharmacies ─────────────────────────────────────────────────────────
// The tile says ONLY "Nöbetçi Eczaneler". Count and closing time are in the accessibility
// label, never a pharmacy name. States, never confused with each other:
//   loading → bone line · error → message (tinted; tap retries + opens the list) · partial/stale/absent → ALERT on
//   the tinted surface (there is always a duty pharmacy, so an empty roster is an error here)
//   · fresh → title only. The tile opens the duty list (KTEB fallback lives there).
export function dutyUntilText(until, lang) {
  if (!until) return null
  if (lang === 'Turkish') return untilTr(until)
  return t('hrDutyUntil', lang).replace('{time}', String(until).slice(0, 5))
}

export function dutyTileNeedsRoom(summary) {
  const { loaded, error, status } = summary || {}
  return !!loaded && (!!error || status !== DUTY_FRESH)
}

export function DutyTile({ summary, lang, onPress, onRetry, height }) {
  const { loaded, error, status, count, until } = summary || {}
  const fresh = status === DUTY_FRESH
  const alert = loaded && !error && !fresh
  const untilText = dutyUntilText(until, lang)
  const short = loaded && !error && count > 0
    ? tCount('hrDutyShort', count, lang).replace('{until}', fresh && untilText ? untilText : '').replace(/ · $/, '')
    : null
  const alertText = alert ? t(status === DUTY_PARTIAL ? 'hrDutyTileAlertPartial' : 'hrDutyTileAlertDown', lang) : null
  const title = t('stripDutyTitle', lang)
  let line = null
  if (!loaded) line = <Bone width="60%" height={10} style={{ marginTop: 4 }} />
  // ERROR: the same short message as the down alert. The tile still opens the duty list —
  // which has its own retry and the KTEB call fallback — and re-runs Home's fetch on the way.
  else if (error || alert) line = cap => (
    <Text style={s.alertText} numberOfLines={2} maxFontSizeMultiplier={cap}>
      {error ? t('hrDutyTileAlertDown', lang) : alertText}
    </Text>
  )
  return (
    <Tile
      image={DUTY_IMAGE}
      icon="medkit"
      title={title}
      line={line}
      onPress={error ? () => { onRetry?.(); onPress?.() } : onPress}
      height={height}
      surface={alert || error ? category.health.bg : null}
      alert={alert || error}
      a11y={[title, short, alert ? t(status === DUTY_PARTIAL ? 'hrDutyPartial' : 'hrDutyUnavailable', lang) : null,
        error ? t('hrDutyUnavailable', lang) : null].filter(Boolean).join(', ')}
    />
  )
}

// ─── Emergency numbers ───────────────────────────────────────────────────────
// Solid health red (white on #B83246 is measured by check-hero-contrast). The numbers in the
// corner are the state lines — the same three the emergency sheet lists first — and are
// digits in every locale. Opens the emergency BottomSheet (the force-update escape too).
export const EMERGENCY_CORNER = '112 · 155 · 199'
export const EMERGENCY_BG = category.health.ink
export function EmergencyTile({ lang, onPress, height }) {
  const cap = tileCap(useWindowDimensions().width)
  const title = t('menuEmergency', lang)
  return (
    <Tile
      bg={EMERGENCY_BG}
      icon="call"
      iconColor={EMERGENCY_BG}
      title={title}
      onPress={onPress}
      height={height}
      corner={<Text style={s.corner} numberOfLines={1} maxFontSizeMultiplier={cap}>{EMERGENCY_CORNER}</Text>}
      a11y={`${title}: 112, 155, 199`}
    />
  )
}

// ─── Tonight (event banner) ──────────────────────────────────────────────────
// The item comes from resolveStripItem, unchanged: a pinned event, tonight's first event,
// the dormant notice path, a new place or a promo — and the generic events fallback, so the
// banner never stands empty. Photo, dark band, time chip (events only). Dismiss exists only
// on a notice, as in V2.
const EVENTS_IMAGE = require('../../../assets/backgrounds/ada-bg-events.jpg')
// The old live strip's duty card photo, reused (no new image).
const DUTY_IMAGE = require('../../../assets/backgrounds/ada-bg-duty-pharmacy.jpg')
const NOTICE_FALLBACK = { accommodation: require('../../../assets/backgrounds/ada-bg-accommodation.jpg') }

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
        <RemoteImage source={item.imageUrl ? { uri: item.imageUrl } : fallback} style={s.bannerPhoto} resizeMode="cover" />
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
  corner:      { position: 'absolute', top: 16, right: 12, ...type.meta, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  band:        { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.72)',
                 paddingHorizontal: 12, paddingVertical: 8 },
  bandClear:   { backgroundColor: 'transparent' },
  bandRow:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bandTitle:   { ...type.small, fontFamily: 'Inter_600SemiBold', lineHeight: 17, color: '#FFFFFF', flex: 1 },
  darkText:    { color: colors.textPrimary },
  alertText:   { ...type.meta, fontFamily: 'Inter_600SemiBold', color: colors.dangerInk, marginTop: 1 },

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
