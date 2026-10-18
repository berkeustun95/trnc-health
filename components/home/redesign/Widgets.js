import { useEffect, useRef, useState } from 'react'
import { View, Text, Image, TouchableOpacity, StyleSheet, useWindowDimensions, FlatList, AccessibilityInfo, AppState } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, category, type, radii, press, space } from '../../../constants/theme'
import { t, tCount, dateLocale } from '../../../constants/i18n'
import { DUTY_FRESH, DUTY_PARTIAL } from '../../../utils/dutyStatus'
import { rememberStripKind } from '../../../utils/homeStripResolver'
import { untilTr } from '../../../utils/turkishTime'
import { Bone, IconButton, RemoteImage } from '../../ui'
import { PlaceholderTag, eateryImageUrl } from '../../EateryBits'

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

// The event's day + time, 24h: "Bu akşam · 21:00" (today from 17:00), "Bugün · 14:00",
// "Yarın · 20:00", else a short date "3 Eki Cum · 20:00". Device-local time, like the list.
const pad2 = n => String(n).padStart(2, '0')
function eventChip(startsAt, lang) {
  const d = new Date(startsAt)
  const day0 = new Date(); day0.setHours(0, 0, 0, 0)
  const that = new Date(d); that.setHours(0, 0, 0, 0)
  const days = Math.round((that - day0) / 864e5)
  let day
  if (days <= 0) day = d.getHours() >= 17 ? t('stripTonight', lang) : t('dateToday', lang)
  else if (days === 1) day = t('stripTomorrow', lang)
  else {
    try { day = d.toLocaleDateString(dateLocale(lang), { weekday: 'short', day: 'numeric', month: 'short' }) }
    catch { day = `${d.getDate()}.${d.getMonth() + 1}.` }   // a locale Hermes' Intl lacks
  }
  return { text: `${day} · ${pad2(d.getHours())}:${pad2(d.getMinutes())}`, future: days > 0 }
}

// `remember` = the lead only: "never twice running" is about the ladder's pick, so a partner slide
// (kind 'promo') must not record itself and suppress a DB promo next launch.
function bannerParts(item, lang) {
  const title = item.generic ? t(item.titleKey, lang) : item.title
  const isEvent = item.kind === 'event' && !item.generic
  const chip = isEvent && item.startsAt ? eventChip(item.startsAt, lang) : null
  const time = chip ? chip.text : isEvent && item.subtitle ? item.subtitle : null
  const sponsorSub = item.eaterySlug && item.subtitle ? item.subtitle : null
  const tag = item.sponsored ? t('stripSponsored', lang) : item.soon ? t('stripStartingSoon', lang) : null
  return { title, chip, time, sponsorSub, tag }
}
// Screen-reader label. A partner slide reads "Sponsorlu, Crunchy Express, Menüye göz at"; slide 1 as before.
function bannerLabel(item, lang) {
  const { title, time, sponsorSub, tag } = bannerParts(item, lang)
  return (item.eaterySlug ? [tag, title, sponsorSub] : [title, sponsorSub, time, tag]).filter(Boolean).join(', ')
}

export function EventBanner({ item, loading, lang, onPress, onDismiss, remember = true }) {
  const kind = item?.kind
  const [bandH, setBandH] = useState(0)
  useEffect(() => { if (remember && !loading && kind) rememberStripKind(kind) }, [remember, loading, kind])
  if (loading) return <Bone width="100%" height={160} borderRadius={radii.widget} />
  if (!item) return null
  const { title, chip, time, sponsorSub, tag } = bannerParts(item, lang)
  // A partner slide is never a photo: the ADA frame + the contained logo (no crop of partner content).
  const showFrame = !!item.eaterySlug
  const logoUri = item.logoPath ? eateryImageUrl(item.logoPath) : null
  const fallback = (item.kind === 'notice' && NOTICE_FALLBACK[item.action?.route]) || EVENTS_IMAGE
  return (
    <View>
      <TouchableOpacity onPress={() => onPress?.(item)} activeOpacity={press.card} accessibilityRole="button"
        accessibilityLabel={bannerLabel(item, lang)} style={s.banner}>
        {showFrame ? (
          // A sponsor never borrows the events picture: ADA-theme frame (also the fallback for a photo
          // that fails to load). Padded by the MEASURED band height, so the logo can never meet the band.
          <View style={[s.sponsorFrame, { paddingTop: bandH + 6 }]}>
            {logoUri
              ? <RemoteImage source={{ uri: logoUri }} style={s.sponsorLogo} resizeMode="contain" placeholderColor="transparent" />
              : <Ionicons name={item.icon || 'restaurant-outline'} size={40} color={category.explore.ink} />}
          </View>
        ) : (
          <RemoteImage source={item.imageUrl ? { uri: item.imageUrl } : fallback} style={s.bannerPhoto} resizeMode="cover" />
        )}
        {/* Title band at the TOP (Berke, 2026-10-15): at Home's first scroll position the card's
            lower part sits under the floating tab bar, so a bottom band hid the title. */}
        <View onLayout={e => setBandH(Math.ceil(e.nativeEvent.layout.height))}
          style={[s.bannerBand, item.kind === 'notice' && !!onDismiss && s.bannerBandDismiss]}>
          {(!!time || !!tag) && (
            <View style={s.bandMeta}>
              {!!time && (
                <>
                  <Ionicons name={chip?.future ? 'calendar-outline' : 'time-outline'} size={14} color="#FFFFFF" />
                  <Text style={s.timeText} numberOfLines={1} maxFontSizeMultiplier={showFrame ? 1.2 : undefined}>{time}</Text>
                </>
              )}
              {!!tag && <View style={s.tag}><Text style={s.tagText} numberOfLines={1} maxFontSizeMultiplier={showFrame ? 1.2 : undefined}>{tag}</Text></View>}
              {!!item.placeholder && <PlaceholderTag lang={lang} lines={1} style={s.placeholderTag} />}
            </View>
          )}
          <View style={s.bandTitleRow}>
            <Text style={s.bannerTitle} numberOfLines={showFrame ? 1 : 2} maxFontSizeMultiplier={showFrame ? 1.2 : undefined}>{title}</Text>
            <Ionicons name="chevron-forward" size={18} color="#FFFFFF" />
          </View>
          {!!sponsorSub && <Text style={s.sponsorSub} numberOfLines={1} maxFontSizeMultiplier={1.2}>{sponsorSub}</Text>}
        </View>
      </TouchableOpacity>
      {item.kind === 'notice' && !!onDismiss && (
        <IconButton icon="close" iconSize={16} variant="frosted" onPress={() => onDismiss(item)}
          accessibilityLabel={t('uiClose', lang)} style={s.dismiss} />
      )}
    </View>
  )
}

// ─── The Bugün ADA'da slider ────────────────────────────────────────────────
// slide 1 = the ladder's lead (the card as ever), 2..n = eatery partners. ONE slide renders the plain
// static card (no pager, dots or timer). Auto-advance stops for the rest of the session after the first
// touch: module-level, so it survives re-renders and Home remounts but resets on app restart.
const SLIDE_MS = 5000
let userTookOver = false

function useReduceMotion() {
  const [on, setOn] = useState(false)
  useEffect(() => {
    let alive = true
    AccessibilityInfo.isReduceMotionEnabled().then(v => { if (alive) setOn(v) }).catch(() => {})
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setOn)
    return () => { alive = false; sub?.remove?.() }
  }, [])
  return on
}

function useScreenReader() {
  const [on, setOn] = useState(false)
  useEffect(() => {
    let alive = true
    AccessibilityInfo.isScreenReaderEnabled().then(v => { if (alive) setOn(v) }).catch(() => {})
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', setOn)
    return () => { alive = false; sub?.remove?.() }
  }, [])
  return on
}

function useForeground() {
  const [fg, setFg] = useState(AppState.currentState === 'active')
  useEffect(() => {
    const sub = AppState.addEventListener('change', st => setFg(st === 'active'))
    return () => sub?.remove?.()
  }, [])
  return fg
}

// `paused`: Home's own overlays (weather / favourites sheet / search). Home unmounts when another tab or
// module screen opens (App.js renders it only for activeTab === 'home' and replaces `content` for modules),
// so mounted = visible and no navigation signal is needed.
export function StripSlider({ slides, loading, lang, onPress, onDismiss, paused = false }) {
  const [width, setWidth] = useState(0)
  const [page, setPage] = useState(0)
  const listRef = useRef(null)
  const pageRef = useRef(0)
  const reduceMotion = useReduceMotion()
  const screenReader = useScreenReader()
  const foreground = useForeground()
  const n = slides.length
  const multi = !loading && n > 1
  const animated = !reduceMotion

  const goTo = (i, anim) => {
    const next = Math.max(0, Math.min(n - 1, i))
    pageRef.current = next
    setPage(next)
    listRef.current?.scrollToOffset({ offset: next * width, animated: anim })
  }

  const auto = multi && width > 0 && animated && !screenReader && foreground && !paused
  useEffect(() => {
    if (!auto || userTookOver) return
    const id = setInterval(() => {
      if (userTookOver) { clearInterval(id); return }
      const next = (pageRef.current + 1) % n
      goTo(next, next !== 0)   // last -> first is a cut, not a rewind sweep across every slide
    }, SLIDE_MS)
    return () => clearInterval(id)
  }, [auto, n, width])

  useEffect(() => { if (pageRef.current >= n) goTo(0, false) }, [n])
  // The list unmounts while loading / single-slide and remounts at offset 0: reset the position
  // so the dots and the screen-reader value never point at a slide that is not showing.
  useEffect(() => { if (!multi) { pageRef.current = 0; setPage(0) } }, [multi])

  if (!multi) return <EventBanner item={slides[0] ?? null} loading={loading} lang={lang} onPress={onPress} onDismiss={onDismiss} />

  const cur = slides[Math.min(page, n - 1)]
  const label = bannerLabel(cur, lang)
  const takeOver = () => { userTookOver = true }
  const onAction = e => {
    const a = e.nativeEvent.actionName
    takeOver()
    if (a === 'increment') goTo(page + 1, animated)
    else if (a === 'decrement') goTo(page - 1, animated)
    else if (a === 'activate') onPress?.(cur)
    else if (a === 'dismiss') onDismiss?.(cur)
  }
  const actions = [{ name: 'increment' }, { name: 'decrement' }, { name: 'activate' }]
  if (page === 0 && cur.kind === 'notice' && onDismiss) actions.push({ name: 'dismiss', label: t('uiClose', lang) })

  return (
    <View style={s.slider} onLayout={e => setWidth(Math.round(e.nativeEvent.layout.width))}
      accessible accessibilityRole="adjustable" accessibilityLabel={label}
      accessibilityValue={{ text: `${t('stripSlideOf', lang).replace('{n}', page + 1).replace('{total}', n)}, ${cur.title}` }}
      accessibilityActions={actions} onAccessibilityAction={onAction} onAccessibilityTap={() => onPress?.(cur)}>
      {width > 0 && (
        <FlatList
          ref={listRef}
          horizontal
          pagingEnabled
          data={slides}
          keyExtractor={x => String(x.id)}
          renderItem={({ item, index }) => (
            <View style={{ width }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              <EventBanner item={item} lang={lang} remember={index === 0 && !item.eaterySlug} onPress={onPress}
                onDismiss={index === 0 ? onDismiss : undefined} />
            </View>
          )}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          showsHorizontalScrollIndicator={false}
          onScrollBeginDrag={takeOver}
          onScroll={e => {
            const i = Math.round(e.nativeEvent.contentOffset.x / width)
            if (i !== pageRef.current && i >= 0 && i < n) { pageRef.current = i; setPage(i) }
          }}
          scrollEventThrottle={32}
          style={s.sliderList}
        />
      )}
      <View style={s.dots} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {slides.map((x, i) => <View key={x.id} style={[s.dot, i === page && s.dotOn]} />)}
      </View>
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

  slider:      { height: 160, borderRadius: radii.widget, overflow: 'hidden', backgroundColor: colors.border },
  sliderList:  { height: 160, flexGrow: 0 },
  // The pill keeps the dots readable on the lilac frame and on any photo (white on #F1EAFB alone is ~1.2:1).
  dots:        { position: 'absolute', alignSelf: 'center', bottom: 6, flexDirection: 'row', gap: 5,
                 backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: radii.pill, paddingHorizontal: space[8], paddingVertical: 4 },
  dot:         { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.7)' },
  dotOn:       { backgroundColor: '#FFFFFF' },
  banner:      { height: 160, borderRadius: radii.widget, overflow: 'hidden', backgroundColor: colors.border },
  sponsorFrame: { ...StyleSheet.absoluteFillObject, backgroundColor: category.explore.bg,
                  alignItems: 'center', justifyContent: 'center', paddingBottom: 18 },
  sponsorLogo: { width: 140, flex: 1, minHeight: 40 },
  sponsorSub:  { ...type.meta, color: '#FFFFFF' },
  placeholderTag: { marginLeft: 6, flexShrink: 1 },
  bannerPhoto: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  timeText:    { ...type.meta, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF', flexShrink: 1 },
  tag:         { marginLeft: 6, backgroundColor: 'rgba(255,255,255,0.22)',
                 borderRadius: radii.pill, paddingHorizontal: 8, height: 20, justifyContent: 'center' },
  tagText:     { ...type.caption, color: '#FFFFFF' },
  // White on rgba(0,0,0,0.72) over a white photo: 9.29:1 (computed). A solid band, so the ratio is a
  // constant rather than a function of which photo loaded.
  bannerBand:  { position: 'absolute', left: 0, right: 0, top: 0, backgroundColor: 'rgba(0,0,0,0.72)',
                 gap: 4, paddingHorizontal: 14, paddingVertical: 10 },
  bannerBandDismiss: { paddingRight: 48 },
  bandMeta:    { flexDirection: 'row', alignItems: 'center', gap: 5 },
  bandTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bannerTitle: { ...type.rowTitle, color: '#FFFFFF', flex: 1 },
  dismiss:     { position: 'absolute', top: 4, right: 4 },
})
