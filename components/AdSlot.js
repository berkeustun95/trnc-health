import { useState, useEffect, useRef } from 'react'
import { View, Text, Image, StyleSheet, TouchableOpacity, Linking, AppState } from 'react-native'
import { t } from '../constants/i18n'
import { colors } from '../constants/theme'
import { AD_BANNERS_LIVE } from '../constants/flags'
import { HOUSE_BANNER } from '../constants/redesign'
import { fetchAdForSlot } from '../utils/adBanner'
import { logAdView, logAdTap, logHouseView, logHouseTap } from '../utils/logAdEvent'
import { openWorkWithAda } from '../utils/workWithAda'
import { measureShare, HOUSE_VISIBLE_SHARE } from '../utils/adVisibility'
import { useTabBarFootprint } from './ui/FloatingTabBar'
import {
  adRatioFor, adSpecFor, AD_RATIO_TOLERANCE, AD_PAGE_INSET,
  AD_SHOW_SPONSORED_LABEL, AD_SPONSORED_KEY, AD_HOUSE_PLACEMENTS,
} from '../constants/ads'
import { RemoteImage } from './ui'
import AdHouseBanner from './AdHouseBanner'

// ─── One ad placement. Direct-sold, no SDK, no network, no targeting. ───────
//
// A placement is POSITION x MODULE — "list_top on accommodation".
//
// ⚠ WHERE THIS MAY BE MOUNTED IS NOT A JUDGEMENT CALL, AND THE MODULE BEING ALLOWED DOES
//   NOT MAKE A SCREEN ALLOWED. The permanent exclusion list — no ads on duty pharmacy,
//   emergency contacts, health facilities, search results, push notifications or Ask Oli —
//   is enforced BY FILE in scripts/check-ad-placement.mjs, which allowlists the wrappers in
//   components/ads/ permitted to import this module and fails a push otherwise.
//   `detail_bottom` is a position and `explore` is an allowed module, but mounted on
//   FacilityProfileScreen that pair is an ad on a health surface. Do not add an import
//   here on the strength of a placement looking appropriate.
//
// ─── UNSOLD IS ZERO HEIGHT, NOT A PLACEHOLDER ───────────────────────────────
//
// null on every path that is not "an ad is live and renderable": flag off, still loading,
// nothing sold, a row this bundle cannot honour. The screen then looks exactly as it does
// today — no reserved space, no "advertise here".
//
// EXCEPT the two AD_HOUSE_PLACEMENTS (list_bottom/home, list_top/events): when HOUSE_BANNER is on
// and the slot is confirmed unsold (or ads are not live yet), ADA's own banner shows there ONCE PER
// APP OPEN, counted from when it is actually on screen. Loading, failed and offline stay zero height, and a
// paid ad always wins.
//
// ─── NON-PERSONALIZED BY CONSTRUCTION ───────────────────────────────────────
//
// ADA is a declared mixed-audience app (13-15 / 16-17 / 18+) and under-18 users must
// receive non-personalized ads. NOTHING here or in fetchAdForSlot reads a user attribute —
// no profile, no DOB, no region, no session. Every user is served the same row, so a
// personalized ad is not something this design can express.
//
// Deliberately does NOT reuse promosAllowed() / PROMO_MIN_AGE from constants/homeStrip.js:
// that gates the live STRIP, where a promo can displace real content. A banner displaces
// nothing. The two differing is a decision, not a drift — do not "fix" it.
// ⚠ REPLACING A LIVE CREATIVE AT THE SAME PATH DOES NOT REACH DEVICES. RN's Image caches
//   on disk by URI, and a relaunch does not clear it. Every creative gets its own path —
//   the reasoning, the three rejected component-side fixes and the escape hatch are all in
//   constants/ads.js. This component deliberately does NOT append a cache-buster: doing so
//   would make an image fetched on every app open uncacheable forever, to fix a rare event.
// ─── THE HOUSE BANNER: ONCE PER APP OPEN ────────────────────────────────────
// Module-level, so it resets only when the JS process does (cold start, OTA reload). Returning from background
// is not a new open, so there is deliberately no AppState reset.
// The open is used up when the banner is SEEN (Berke 2026-11-23), not when the slot mounts: Home's bottom slot
// mounts at launch below the fold, so claiming on mount spent it before anyone scrolled there. A mount that is
// never seen claims nothing, and the next mount offers it again. The mount that sees it first keeps it for its
// whole life (and records the one view); any later mount of that placement renders nothing.
const houseShownThisProcess = new Set()

export default function AdSlot({ position, module, lang, onNavigate }) {
  const [ad, setAd] = useState(null)
  const [showHouse, setShowHouse] = useState(false)
  const viewed = useRef(null)
  const houseOwned = useRef(false)
  const houseBox = useRef(null)
  const footprint = useTabBarFootprint()

  useEffect(() => {
    if (!position || !module) return
    const houseKey = `${position}/${module}`
    const houseEligible = HOUSE_BANNER && AD_HOUSE_PLACEMENTS.includes(houseKey)
    // Offered, not claimed: the claim happens in the visibility effect below, once it is on screen.
    const offerHouse = () => {
      if (!houseEligible) return
      if (!houseOwned.current && houseShownThisProcess.has(houseKey)) return
      setShowHouse(true)
    }
    // Ads not live: nothing is sold and nothing is queried. An eligible slot offers the house banner, the rest stay empty.
    if (!AD_BANNERS_LIVE) { offerHouse(); return }
    let alive = true
    fetchAdForSlot(position, module).then(res => {
      if (!alive || res.failed) return          // failed / offline: zero height, never the house banner
      if (res.row) setAd(res.row)               // sold: paid always wins, uncapped
      else offerHouse()                         // confirmed unsold
    })
    return () => { alive = false }
  }, [position, module])

  // Claims the open and records the one view only once at least HOUSE_VISIBLE_SHARE of the banner is on screen
  // above the tab bar. Measured on mount and then every 400 ms while unseen, foreground only; no scroll wiring,
  // so it covers a restored scroll offset and a strip that grows above it. Stops at the claim or the unmount.
  useEffect(() => {
    if (!showHouse || houseOwned.current) return
    const houseKey = `${position}/${module}`
    let done = false
    let timer = null
    const stop = () => { done = true; if (timer) clearInterval(timer) }
    const check = () => {
      if (done) return
      if (houseShownThisProcess.has(houseKey)) { stop(); setShowHouse(false); return }   // another mount saw it first
      if (AppState.currentState === 'background') return   // 'unknown' at an iOS launch still counts as foreground
      measureShare(houseBox.current, footprint, share => {
        if (done || share < HOUSE_VISIBLE_SHARE || houseShownThisProcess.has(houseKey)) return
        stop()
        houseShownThisProcess.add(houseKey)
        houseOwned.current = true
        logHouseView(position, module)
      })
    }
    timer = setInterval(check, 400)
    check()
    return stop
  }, [showHouse, position, module, footprint])

  // ─── __DEV__ ONLY: is this the right creative for THIS position? ──────────
  // Two specs now — 3.2:1 for list_top/list_bottom/detail_bottom, 6.4:1 for list_inline —
  // so the likeliest mistake is no longer "wrong size" but "right size, wrong slot": a
  // 640x200 banner sold for list_top, uploaded against a list_inline row. It renders
  // centre-cropped to a strip and looks deliberate. Nothing server-side can see image
  // dimensions without fetching the bytes, so the check lives where the bytes already are.
  useEffect(() => {
    if (!__DEV__ || !ad?.image_url) return
    const spec = adSpecFor(position)
    Image.getSize(
      ad.image_url,
      (w, h) => {
        if (!h) return
        const r = w / h
        if (Math.abs(r - spec.ratio) / spec.ratio > AD_RATIO_TOLERANCE) {
          console.warn(
            `[AdSlot] ${position}/${module} "${ad.advertiser_name}" image is ${w}x${h} ` +
            `(${r.toFixed(2)}:1) but this position expects ${spec.ratio}:1 ` +
            `(${spec.w}x${spec.h}). It will be CENTRE-CROPPED — check the artwork is not ` +
            `losing its logo, and that this creative was authored for THIS position.`)
        }
      },
      () => {},
    )
  }, [ad, position, module])

  if (showHouse) {
    return (
      <AdHouseBanner
        boxRef={houseBox}
        position={position}
        lang={lang}
        onPress={() => {
          // Counted BEFORE the page opens, same rule as a paid tap; neither call can throw.
          logHouseTap(position, module)
          openWorkWithAda(lang)
        }}
      />
    )
  }

  if (!AD_BANNERS_LIVE || !ad) return null

  function handlePress() {
    // Counted BEFORE the destination opens, and it cannot throw. Navigating first would
    // drop the count on any path that unmounts this component synchronously.
    logAdTap(ad.id)
    if (ad.route) { onNavigate?.(ad.route); return }
    if (ad.link_url) Linking.openURL(ad.link_url).catch(() => {})
  }

  const label = t(AD_SPONSORED_KEY, lang)
  const inline = position === 'list_inline'
  const ratio = adRatioFor(position)

  const image = (
    <RemoteImage
      source={{ uri: ad.image_url }}
      style={{ width: '100%', aspectRatio: ratio }}
      resizeMode="cover"
      onLoad={() => {
        if (viewed.current === ad.id) return
        viewed.current = ad.id
        logAdView(ad.id)
      }}
    />
  )

  // ─── list_inline — a full-bleed strip that cannot read as a listing ───────
  //
  // FOUR structural differences from a list card, none of which needs the user to read
  // anything and none of which depends on colour, so the distinction survives greyscale
  // and a red-green colourblind reader:
  //
  //   1. IT BREAKS THE INSET. Every card in these lists is inset AD_PAGE_INSET with a
  //      radius. This has a negative margin of exactly that inset, touches both screen
  //      edges, and has SQUARE corners.
  //   2. IT IS HALF THE HEIGHT. 6.4:1 is ~61pt at 393dp; a listing card is ~90-120pt.
  //   3. NO APP-STYLED TEXT BLOCK. Every list item carries a title and subtitle in ADA's
  //      typography. This has none — all advertiser text is inside their own artwork.
  //   4. THE LABEL IS OUTSIDE THE CREATIVE — a caption on an OPAQUE app-drawn bar above
  //      the image, in our font. A chip drawn ON artwork can be blended into it by a competent
  //      designer; a caption rendered outside their pixels cannot be touched at all.
  //
  // Reason 4 is the one that does the real work, and it is why this variant does NOT use
  // the overlay chip the 3.2:1 banner uses.
  if (inline) {
    return (
      <View style={[s.inlineWrap, { marginHorizontal: -AD_PAGE_INSET }]}>
        {AD_SHOW_SPONSORED_LABEL && (
          <View style={s.inlineCaptionBar}>
            <Text style={s.inlineCaption} numberOfLines={1}>{label}</Text>
          </View>
        )}
        <TouchableOpacity
          onPress={handlePress}
          activeOpacity={0.9}
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${ad.advertiser_name}`}
          style={s.inlineBody}
        >
          {image}
        </TouchableOpacity>
      </View>
    )
  }

  // ─── The 3.2:1 banner — list_top, list_bottom, detail_bottom ──────────────
  // Inset with the page, rounded like a card, disclosure as an overlay chip. It is
  // allowed to look like a piece of the page here precisely because it is NOT interleaved
  // among listings: at the top, the bottom, or the end of a detail screen there is no row
  // of similar objects for it to impersonate.
  return (
    <TouchableOpacity
      style={s.slot}
      onPress={handlePress}
      activeOpacity={0.9}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${ad.advertiser_name}`}
    >
      {image}
      {AD_SHOW_SPONSORED_LABEL && (
        <View style={s.tag}><Text style={s.tagText} numberOfLines={1}>{label}</Text></View>
      )}
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  slot: {
    marginTop: 24,
    borderRadius: 14,
    overflow: 'hidden',
    // Android renders an opaque background on a view with borderRadius unless this is set
    // explicitly (CLAUDE.md, Android gotchas).
    backgroundColor: 'transparent',
  },
  tag: {
    position: 'absolute', top: 8, right: 8, maxWidth: '60%',
    borderRadius: 10, paddingHorizontal: 7, paddingVertical: 3,
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  tagText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  // ── inline: hairline rules top and bottom, and NO radius anywhere ──
  inlineWrap: {
    marginVertical: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  // ─── THE CAPTION SITS ON ITS OWN OPAQUE BAR ───────────────────────────────
  //
  // It used to be bare text in the page gutter, and that made the DISCLOSURE the one
  // element on screen whose legibility depended on the photograph behind it. All three
  // ad-bearing lists render over a PageBackground — accommodation over a harbour, explore
  // over a beach — so 10pt grey-on-photo was somewhere between fine and unreadable
  // depending on which image had loaded. For an ordinary label that is a polish bug; for
  // the label that says "this is an advert" it is the whole point failing.
  //
  // ⚠ OPAQUE, NOT AN ALPHA SCRIM, AND THAT IS THE POINT. rgba(0,0,0,0.78) would be legible
  //   over most photographs; an opaque fill is legible over ALL of them, because the text
  //   never touches the photograph at all. Same move as LiveStrip's solid band over a
  //   gradient — contrast becomes a CONSTANT rather than a function of which image loaded,
  //   which is the only version of this that can be measured once and stay true.
  //
  // ⚠ AND IT IS STILL OUTSIDE THE CREATIVE. The bar is drawn by the app, above the
  //   advertiser's image, in the app's own colour and font. Nothing here moves the label
  //   into artwork an advertiser controls — that was the requirement, and a dark bar
  //   satisfies it exactly as a bare caption did, while actually being readable.
  //
  // primaryDark (ADA teal) rather than black or ink: it is the app's own furniture, so the
  // bar reads as part of ADA rather than as a foreign dark box. White text on it is 7.58:1,
  // and it stays opaque so contrast is constant.
  inlineCaptionBar: {
    backgroundColor: colors.primaryDark,
  },
  inlineCaption: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: '#FFFFFF',
    letterSpacing: 0.4,
    // ⚠ NO textTransform: 'uppercase'. It was there for the "this is a label, not content"
    //   read, and it is wrong in two of the nine locales. Greek "Χορηγούμενο" uppercases to
    //   "ΧΟΡΗΓΟΎΜΕΝΟ" — JS keeps the tonos, and Greek typography drops accents in all-caps,
    //   so it renders as a spelling error to a Greek reader. Turkish is the standing hazard
    //   next to it: today's "Sponsorlu" has no dotted i, but any future edit that adds one
    //   would uppercase to "I" instead of "İ" — the exact bug 20260925 recorded in the word
    //   filter. Letter-spacing and the secondary colour carry the label read on their own,
    //   in every script including the two that have no case at all.
    paddingHorizontal: AD_PAGE_INSET,
    paddingTop: 8,
    paddingBottom: 6,
  },
  // Square corners, explicitly. Every list card has one; this must not.
  inlineBody: { borderRadius: 0, overflow: 'hidden' },
})
