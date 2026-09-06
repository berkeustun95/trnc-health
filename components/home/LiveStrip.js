import { useEffect } from 'react'
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, shadow } from '../../constants/theme'
import { t } from '../../constants/i18n'
import { Skeleton } from '../Skeleton'
import { DUTY_FRESH, DUTY_PARTIAL } from '../../utils/dutyStatus'
import { STRIP_CARD_H, STRIP_BAND_H } from '../../constants/homeStrip'
import { rememberStripKind } from '../../utils/homeStripResolver'

// ─── THE TWO BUNDLED IMAGES ─────────────────────────────────────────────────
//
// They live HERE and not in constants/homeStrip.js because that file is imported by a
// plain-Node guard, where require() of a PNG throws. See the note there.
//
// ⚠ THE LEFT CARD'S FALLBACK IS THE EVENTS MODULE'S GENERIC IMAGE, NEVER A PAST EVENT'S
//   PHOTO. Reusing the last event's picture on a day it is not happening misrepresents
//   what is on, which is the one thing this section exists to report. When nothing
//   qualifies, the card says "Events / What's on" over this image and opens the events
//   screen — honest, and still a destination.
const STRIP_EVENTS_IMAGE = require('../../assets/backgrounds/ada-bg-events.png')

// ⚠ PLACEHOLDER, PENDING BERKE'S IMAGE. assets/backgrounds/ada-bg-duty-pharmacy.png is an
//   existing ADA-owned asset, already used by components/PageBackground.js for the duty
//   screen — so it is on-brand, correctly licensed, and actually depicts a pharmacy.
//   Swapping it is this one line and nothing else.
const STRIP_DUTY_IMAGE = require('../../assets/backgrounds/ada-bg-duty-pharmacy.png')

// Bugün ADA'da — two photo cards, side by side.
//
//   LEFT   today's event, resolved through the ladder in utils/homeStripResolver.js,
//          falling back to the events module's generic image.
//   RIGHT  the duty pharmacy, always, opening DutyListScreen.
//
// ─── THE TWO-UP PROP DID NOT SURVIVE, AND HALF OF IT DID ────────────────────
//
// The old contract was `items` + `columns`: N interchangeable cards from ONE ladder. This
// design is two FIXED SLOTS with different sources and different state models, so that
// contract is gone and the props are explicit.
//
// What DID survive is the part that mattered: StripCard needed no change to work at half
// width. It carries no width, no margin and no percentage — `flex: 1` in a row — and the
// photo is absolutely filled, the band anchored, the title ellipsing. That was the actual
// claim, and it held.
//
// What could not survive:
//   • the duty card has FRESHNESS STATES the ladder never produces and cannot rank;
//   • `rememberStripKind` recorded the LAST item, which would now record the duty card and
//     silently corrupt the never-two-promos-in-a-row rule. It records the LEFT card only;
//   • `columns` is meaningless when there are exactly two slots of different kinds.
//
// ─── IT CANNOT RENDER NOTHING, AND THE PROOF IS DIFFERENT NOW ───────────────
//
// It used to be "the resolver's last rank is a local constant". It is now stronger: both
// cards are unconditional JSX and both fall back to a `require`d image compiled into the
// bundle. There is no branch here that renders fewer than two cards, and no data state —
// offline, RLS-blocked, empty database, unapplied migration — that can produce one.

function StripCard({ image, imageUrl, icon, title, tag, tagTone, alert, onPress, innerRef }) {
  return (
    <TouchableOpacity
      ref={innerRef}
      collapsable={false}
      style={[s.card, alert && s.cardAlert]}
      onPress={onPress}
      activeOpacity={0.88}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      {/* ─── THE ALERT STATE REPLACES THE PHOTOGRAPH, IT DOES NOT TINT IT ─────
          At half width a tint is easy to miss and a missing photograph is not. A duty
          roster running out is the failure this app has already inflicted on users — the
          list ran out on 2026-06-30 and for two months the app said there was no duty
          pharmacy tonight, when the truth was that we had lost the list — so an unhealthy
          card must be unmistakable at a glance, not a shade different.

          FIVE things change at once (surface, badge colour, badge glyph, band colour,
          card border), so colour is never the sole carrier and the state survives
          greyscale and colour-blindness. Same principle the standalone Nöbetçi row used. */}
      {alert
        ? <View style={[s.photo, s.photoAlert]} />
        : <Image source={imageUrl ? { uri: imageUrl } : image} style={s.photo} resizeMode="cover" />}

      <View style={[s.badge, alert && s.badgeAlert]}>
        <Ionicons name={alert ? 'alert-circle' : icon} size={15} color={alert ? '#fff' : colors.textPrimary} />
      </View>

      {!!tag && (
        <View style={[s.tag, tagTone === 'sponsored' ? s.tagSponsored : s.tagSoon]}>
          <Text style={s.tagText} numberOfLines={1}>{tag}</Text>
        </View>
      )}

      {/* A solid band, not a gradient: expo-linear-gradient is not installed and this repo
          does not add a package for a visual effect. Solid is also strictly better here —
          its contrast is a constant rather than a function of which photograph loaded.
          White on rgba(0,0,0,0.78) over a white photo is 11.73:1; on the alert band's
          #C0384A it is 5.38:1. Both measured, neither carried forward. */}
      <View style={[s.band, alert && s.bandAlert]}>
        <View style={s.bandText}>
          {/* TITLE ONLY since 2026-09-10 — the subtitles are gone and the band shrank from
              60 to 46 so the photograph gets the difference.
              TWO lines: the text box is 83pt at 320dp, narrower than a module-grid label
              with type at 14pt instead of 11, so one line is not survivable in any locale.
              Every string here is measured against that box by `npm run labels:check`. */}
          <Text style={s.title} numberOfLines={2}>{title}</Text>
        </View>
        <View style={s.chevron}>
          <Ionicons name="chevron-forward" size={15} color={alert ? '#C0384A' : colors.textPrimary} />
        </View>
      </View>
    </TouchableOpacity>
  )
}

function StripSkeleton() {
  return (
    <View style={s.row}>
      <Skeleton width="100%" height={STRIP_CARD_H} borderRadius={18} style={{ flex: 1 }} />
      <Skeleton width="100%" height={STRIP_CARD_H} borderRadius={18} style={{ flex: 1 }} />
    </View>
  )
}

export default function LiveStrip({
  item, loading, lang, dutyStatus = DUTY_FRESH, onPressEvent, onPressDuty, dutyRef,
}) {
  // Recorded when SHOWN, not when resolved — a mount abandoned mid-flight resolves
  // something nobody saw, and the promo rule is about what appeared. The LEFT card only:
  // the duty card is not ranked and must never enter that sequence.
  const kind = item?.kind
  useEffect(() => {
    if (!loading && kind) rememberStripKind(kind)
  }, [loading, kind])

  if (loading) return <StripSkeleton />

  const ok = dutyStatus === DUTY_FRESH
  // The generic card carries i18n KEYS; a real event carries its database title. Resolving
  // both upstream would mean inventing keys for user-submitted event names.
  // ─── TITLE ONLY, AND THE EVENT'S TIME IS DELIBERATELY DROPPED ─────────────
  // The subtitle used to carry "19:30". Appending it to the title instead — "Bandabuliya
  // Gecesi · 19:30" — would re-import the overflow this change exists to remove: the box
  // is 83pt at 320dp and an event name already needs both lines of it. The card also
  // already says TODAY by being on this strip, and the urgency case keeps its signal: the
  // "starting soon" tag is a chip on the PHOTO, not in the band, so it survives untouched.
  const evTitle = item?.generic ? t(item.titleKey, lang) : item?.title

  return (
    <View style={s.row}>
      <StripCard
        image={STRIP_EVENTS_IMAGE}
        imageUrl={item?.imageUrl}
        icon={item?.icon || 'calendar-outline'}
        title={evTitle}
        tag={item?.sponsored ? t('stripSponsored', lang) : item?.soon ? t('stripStartingSoon', lang) : null}
        tagTone={item?.sponsored ? 'sponsored' : 'soon'}
        onPress={() => onPressEvent?.(item)}
      />
      {/* ─── THE DUTY CARD IS UNCONDITIONAL ──────────────────────────────────
          It is not resolved, not ranked and cannot be outranked — a stronger guarantee
          than the standalone row it replaces, because a row can be scrolled past and a
          slot cannot be lost.

          Both unhealthy states keep the card TAPPABLE and still pointing at
          DutyListScreen, which carries the KTEB fallback. Telling somebody the roster is
          thin and then refusing to open it would be worse than the banner that started
          this.

          dutyBannerRef lands HERE. App.js measures that exact ref to place the duty coach
          mark, and a ref that measures null drops the tutorial step silently. */}
      <StripCard
        innerRef={dutyRef}
        image={STRIP_DUTY_IMAGE}
        icon="medkit"
        alert={!ok}
        title={t(ok ? 'stripDutyTitle'
                    : dutyStatus === DUTY_PARTIAL ? 'stripDutyPartialTitle'
                    : 'stripDutyStaleTitle', lang)}
        onPress={onPressDuty}
      />
    </View>
  )
}

const s = StyleSheet.create({
  row:           { flexDirection: 'row', gap: 10 },
  card:          { flex: 1, height: STRIP_CARD_H, borderRadius: 18, overflow: 'hidden',
                   backgroundColor: colors.border, ...shadow },
  // A danger border as the fifth signal — the one that still reads when a screenshot is
  // scaled to a thumbnail and the band's text is illegible.
  cardAlert:     { borderWidth: 1, borderColor: colors.danger },
  photo:         { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  photoAlert:    { backgroundColor: colors.dangerLight },
  badge:         { position: 'absolute', top: 10, left: 10, width: 28, height: 28, borderRadius: 14,
                   backgroundColor: 'rgba(255,255,255,0.94)', justifyContent: 'center', alignItems: 'center' },
  // White glyph on colors.danger is 4.36:1 — clear of the 3:1 floor that applies to a UI
  // component, which is the rule for an icon rather than the 4.5:1 text floor.
  badgeAlert:    { backgroundColor: colors.danger },
  tag:           { position: 'absolute', top: 10, right: 10, maxWidth: '84%',
                   borderRadius: 10, paddingHorizontal: 7, paddingVertical: 3 },
  tagSponsored:  { backgroundColor: 'rgba(0,0,0,0.62)' },
  // Brand teal, not coral: coral means URGENT on this screen — the duty card and three
  // grid tiles — and an event starting in four hours is not that. White on #0E7C7B is
  // 5.01:1.
  tagSoon:       { backgroundColor: colors.primary },
  tagText:       { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  band:          { position: 'absolute', left: 0, right: 0, bottom: 0, height: STRIP_BAND_H,
                   backgroundColor: 'rgba(0,0,0,0.78)', flexDirection: 'row', alignItems: 'center',
                   paddingHorizontal: 12, gap: 8 },
  // #C0384A, not colors.danger. White on danger (#D1495B) is 4.36:1 — under the 4.5 floor
  // for this 14pt title. This is the same hue deepened until white clears it at 5.38:1,
  // the same move DutyRow made for its icon tile and its subtitle.
  bandAlert:     { backgroundColor: '#C0384A' },
  bandText:      { flex: 1 },
  title:         { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  // rgba white rather than a grey token: a flat token would composite against whatever the
  // band's own alpha sits on and stop being knowable by reading.
  // 28 -> 24 with the band's shrink. A 28pt disc in a 46pt band leaves 9pt above and
  // below and reads as jammed; 24 leaves 11. It also widens the title box from 77pt to
  // 83pt at 320dp, which is what lets the plural duty titles fit — "Pharmacies" measures
  // 79.6pt and did not fit the old box in English or French.
  chevron:       { width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff',
                   justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
})
