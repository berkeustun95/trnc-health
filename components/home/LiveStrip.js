import { useEffect } from 'react'
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, shadow } from '../../constants/theme'
import { t } from '../../constants/i18n'
import { Skeleton } from '../Skeleton'
import { STRIP_CARD_H, STRIP_BAND_H } from '../../constants/homeStrip'
import { rememberStripKind } from '../../utils/homeStripResolver'

// Bugün ADA'da — the live strip.
//
// ─── ONE CARD TODAY, TWO-UP AS A PROP ───────────────────────────────────────
//
// The brief asks for one full-width card built so a two-up variant is a prop rather than a
// rewrite. That is a statement about where the WIDTH is decided, and the answer is: not in
// the card. StripCard carries no width, no marginHorizontal and no percentage — it is
// `flex: 1` inside a row, so one card fills the row and two share it, with `columns`
// deciding nothing but how many the row contains.
//
// The parts that would otherwise need rewriting are already width-agnostic for the same
// reason: the photo is absolutely filled, the band is anchored left/right/bottom, and the
// title ellipses rather than wrapping to a height the card does not have. Only the ITEMS
// array and `columns` change. Nothing here is a placeholder for the second variant; there
// is no dead two-up code, because there is nothing to write.
//
// ─── IT CANNOT RENDER NOTHING ───────────────────────────────────────────────
//
// There is no early return in this component and no empty branch. `loading` gives the
// skeleton; anything else gives cards. The invariant that the strip is never empty is
// enforced one level up — utils/homeStripResolver.js has no path that returns null, ending
// at a local constant — and this file simply has no way to express an empty state. That
// matters because the section HEADING lives in HomeScreen next to the grid's, and a
// component that could return null would orphan it.
//
// ─── THE SKELETON IS THE SAME HEIGHT AS THE CARD, FROM THE SAME CONSTANT ────
//
// Both read STRIP_CARD_H. A skeleton that is merely "about right" is worse than none: the
// page settles under the user's thumb at the exact moment the resolver returns, which is
// the moment they are looking at it. One number, two consumers, no drift.

function StripCard({ item, lang, onPress }) {
  const isTip = item.kind === 'tip'
  // Tips carry KEYS, everything else carries resolved strings — a tip's text comes from a
  // local constant and must be translated at render, while an event's title is a row in
  // the database. Resolving both in the resolver would mean passing `lang` in to build a
  // string that could be built here; carrying keys for both would mean inventing keys for
  // user-submitted event titles.
  const title    = isTip ? t(item.titleKey, lang)    : item.title
  const subtitle = isTip ? t(item.subtitleKey, lang) : item.subtitle

  return (
    <TouchableOpacity
      style={s.card}
      onPress={() => onPress?.(item)}
      activeOpacity={0.88}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title} — ${subtitle}` : title}
    >
      {/* No photo is a NORMAL state, not a broken one — every tip is imageless by design
          and plenty of events are submitted without one. The fallback is a flat brand
          surface, so the card keeps its shape and its band keeps its contrast. */}
      {item.imageUrl
        ? <Image source={{ uri: item.imageUrl }} style={s.photo} resizeMode="cover" />
        : <View style={[s.photo, s.photoFallback]} />}

      {/* ─── ICON BADGE, TOP-LEFT ────────────────────────────────────────────
          A white circle with a dark glyph, like the hero's action buttons and for the
          same measured reason: this sits on an arbitrary photograph from an arbitrary
          submission, and there is no flat scrim alpha that makes a white mark legible
          over a blown-out sky without blacking the photo out. It carries its own
          contrast instead of borrowing it. */}
      <View style={s.badge}>
        <Ionicons name={item.icon} size={17} color={colors.textPrimary} />
      </View>

      {/* Two labels can share the top-right corner: "Sponsorlu" and "soon". They never
          collide because a promo is rank 5 and a soon-event is rank 2 — the ladder
          returns ONE item, so at most one of these is ever true. */}
      {item.sponsored && (
        <View style={[s.tag, s.tagSponsored]}>
          <Text style={s.tagText} numberOfLines={1}>{t('stripSponsored', lang)}</Text>
        </View>
      )}
      {!item.sponsored && item.soon && (
        <View style={[s.tag, s.tagSoon]}>
          <Text style={s.tagText} numberOfLines={1}>{t('stripStartingSoon', lang)}</Text>
        </View>
      )}

      {/* ─── A SOLID BAND, NOT A GRADIENT ────────────────────────────────────
          expo-linear-gradient is not installed and this repo does not add a package for a
          visual effect. The hero fakes a ramp with stacked flat bands because its text
          sits high on the photo; here the text sits in a fixed strip at the bottom, so a
          solid band is both simpler and strictly better — its contrast is a constant
          rather than a function of which photograph loaded.

          0.78 black gives white text 11.6:1 at worst, against a white photo. */}
      <View style={s.band}>
        <View style={s.bandText}>
          <Text style={s.title} numberOfLines={1}>{title}</Text>
          {/* TWO lines, and that is the degradation path rather than the design. Every
              locale's tip copy is written to fit ONE line on a 393dp screen (measured;
              the numbers are in the Slice 2 log), but Greek, Russian and German run
              20-25% longer than English and a 320dp device is in the fold table. Wrapping
              a subtitle costs nothing — the band is 62pt and title + two subtitle lines is
              ~51pt — while truncating one costs the whole point of the card: "Beaches,
              sights and mo…" is not a shorter sentence, it is a broken one.
              The TITLE stays at one line: a wrapped title unbalances the band, and titles
              are short enough in every locale to fit. */}
          {!!subtitle && <Text style={s.sub} numberOfLines={2}>{subtitle}</Text>}
        </View>
        {/* A filled circle rather than a bare chevron — same reasoning as the Oli row:
            on a busy background a lone glyph reads as decoration, and this is the card's
            only affordance. */}
        <View style={s.chevron}>
          <Ionicons name="chevron-forward" size={17} color={colors.textPrimary} />
        </View>
      </View>
    </TouchableOpacity>
  )
}

function StripSkeleton() {
  return (
    <View style={s.row}>
      <Skeleton width="100%" height={STRIP_CARD_H} borderRadius={18} />
    </View>
  )
}

export default function LiveStrip({ item, items, loading, lang, columns = 1, onPress }) {
  // `items` is the two-up path and `item` the one-up shorthand. Both land in one array so
  // the render below has a single shape.
  const list = items ?? (item ? [item] : [])

  // ─── RECORDED WHEN SHOWN, NOT WHEN RESOLVED ──────────────────────────────
  // The "never two promos in a row" rule is about what APPEARED, and a mount abandoned
  // mid-flight resolves an item nobody saw. Writing from the render effect keeps the
  // record honest. Fires per kind change rather than per render.
  const shownKind = list.map(i => i.kind).join(',')
  useEffect(() => {
    if (!loading && list.length) rememberStripKind(list[list.length - 1].kind)
  }, [loading, shownKind])

  if (loading) return <StripSkeleton />

  return (
    <View style={s.row}>
      {list.slice(0, columns).map(it => (
        <StripCard key={`${it.kind}:${it.id}`} item={it} lang={lang} onPress={onPress} />
      ))}
    </View>
  )
}

const s = StyleSheet.create({
  // The row owns the gap; the card owns nothing about its own width. `gap` is inert at
  // columns=1 and is what makes the two-up variant a prop.
  row:           { flexDirection: 'row', gap: 10 },
  card:          { flex: 1, height: STRIP_CARD_H, borderRadius: 18, overflow: 'hidden',
                   backgroundColor: colors.border, ...shadow },
  photo:         { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  photoFallback: { backgroundColor: colors.primary },
  badge:         { position: 'absolute', top: 10, left: 10, width: 32, height: 32, borderRadius: 16,
                   backgroundColor: 'rgba(255,255,255,0.94)', justifyContent: 'center', alignItems: 'center' },
  // maxWidth so a long Turkish or German label cannot run under the card's right edge —
  // "Sponsorlu" is short but "Yakında başlıyor" is not, and the tag must ellipse rather
  // than escape.
  tag:           { position: 'absolute', top: 12, right: 10, maxWidth: '62%',
                   borderRadius: 11, paddingHorizontal: 9, paddingVertical: 4 },
  tagSponsored:  { backgroundColor: 'rgba(0,0,0,0.62)' },
  // Deepened accent, not `accent` itself: white on #FF8552 is 2.41:1 and this is a label
  // meant to be read at a glance. #C2410C is the same token DutyRow and the lifestyle tint
  // already use for exactly this reason, and gives white 5.94:1.
  tagSoon:       { backgroundColor: '#C2410C' },
  tagText:       { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  band:          { position: 'absolute', left: 0, right: 0, bottom: 0, height: STRIP_BAND_H,
                   backgroundColor: 'rgba(0,0,0,0.78)', flexDirection: 'row', alignItems: 'center',
                   paddingHorizontal: 14, gap: 12 },
  bandText:      { flex: 1 },
  // 600, matching the Oli and duty titles — this card is a peer of those two rows, not a
  // section heading, and the V2 scale puts row titles at SemiBold.
  title:         { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  // rgba(255,255,255,0.86) is 8.9:1 on the band. A flat grey token would composite against
  // whatever photograph is behind the band's own alpha and stop being knowable by reading.
  sub:           { fontSize: 12, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.86)', marginTop: 2 },
  chevron:       { width: 32, height: 32, borderRadius: 16, backgroundColor: '#fff',
                   justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
})
