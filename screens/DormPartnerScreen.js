import { useState } from 'react'
import { View, Text, Image, ScrollView, TouchableOpacity, StyleSheet, Linking, useWindowDimensions,
  LayoutAnimation, UIManager, Platform } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import MapView, { Marker } from 'react-native-maps'
import { Ionicons } from '@expo/vector-icons'
import BackButton from '../components/BackButton'
import PartnerLogoStrip from '../components/PartnerLogoStrip'
import DormRoomSheet from '../components/DormRoomSheet'
import AccommodationDetailBottomSlot from '../components/ads/AccommodationDetailBottomSlot'
import { colors, shadow, radius, readableOn } from '../constants/theme'
import { t, LANG_CODES } from '../constants/i18n'
import { REGION_LABEL_KEY } from '../constants/regions'
import { dormSections, dormWaMessage, dormWebsiteUrl, SECTION_ORDER, COLLAPSIBLE } from '../constants/dorms'
import { partnerLogo, partnerAsset } from '../constants/partnerAssets'
import { logContactEvent } from '../utils/logContactEvent'

// The dorm partner showcase. Structure mirrors HomeServicePartnerScreen, which mirrors
// TowingDetailScreen — navbar, hero, a stack of bordered blocks, a fixed contact bar —
// because that is the shape this app already uses for "one listed business, in full".
//
// ⚠ STILL DELIBERATELY NOT A SHARED PartnerShowcase, and this is the THIRD instance, which
//   is the point at which the plan said to revisit. Looked at it: what these three share is
//   already shared (PartnerLogoStrip, logContactEvent, the wa.me handoff shape, the block
//   idiom). What differs is the middle — a towing firm has coverage and prices, a
//   renovation firm has a before/after portfolio, a dorm has room types and a shuttle
//   timetable. Extracting layout would produce a component whose props are the union of
//   three unrelated content models. Revisit at a FOURTH that resembles an existing one.
//
// ─── EMPTY-SAFE MEANS ABSENT, NOT DISABLED ──────────────────────────────────
//
// Özok has delivered none of the assets. With gallery, logo, prices, m², ring saatleri,
// events, the deal band, amenities and both service lists all absent, this screen must
// still read as finished — not as a form somebody abandoned. So every optional section
// renders nothing at all rather than a greyed box or a "coming soon", and the emptiness
// decision is made ONCE in constants/dorms.js (dormSections) rather than by an && chain
// here. A greyed-out control tells the user the app is broken; nothing tells them the
// section does not apply.
//
// What survives with everything absent: badge, name, location, room types, the shuttle
// row, the operator line, and the contact bar. That is a usable page.
//
// ⚠ THIS SCREEN IS THE SECOND HOST OF detail_bottom x accommodation. The same sold row
//   renders here and on PropertyDetailScreen — one slot, two surfaces, which is what
//   amendment 2's "same slots, same rules" asks for. There is NO code-level competitor
//   suppression: a rival dorm's banner can render at the foot of this page, and that is
//   handled commercially rather than in code. constants/ads.js carries the warning where
//   somebody inserting a row will see it.

const HERO_LOGO = { width: 200, height: 56 }
const MAP_H     = 160

// ─── PHOTO ASPECT, TAKEN FROM ALASIA'S OWN FILES ────────────────────────────
//
// SIX OF THEIR SEVEN PHOTOS ARE 1.4971 — five room shots at 1024x684 and hero-2 at
// 1536x1026. Only hero-1 (1536x864) differs. So this is their camera's native aspect, not
// a ratio anybody chose, and a container matching it crops six of seven by NOTHING.
//
// hero-1 loses 15.8% of its WIDTH here. A 16:9 container would invert that — hero-1 exact
// and the other six losing 15.8% of their HEIGHT — which is the worse trade twice over:
// it damages six images instead of one, and on a room photo the height is where the sense
// of space lives (ceiling to floor), while a wide landscape survives losing its sides.
//
// ⚠ FIXED, NOT PER-IMAGE, AND THAT IS DELIBERATE. Per-image aspect removes the crop but
//   makes the container height change between pages, so everything below the hero jumps
//   during a swipe — worse than losing 15.8% of one photo, and it breaks at the moment
//   stability matters most.
//
// ⚠ AND IT IS MEASURED, NOT GUESSED. constants/partners.js records TadilArt shipping a
//   hardcoded `aspect: 1` chosen before the files existed, which cost ~12% of the height on
//   the dimension the photos existed to show. The number below came from the files.
//   If a future image cannot survive this crop, DROP THAT IMAGE rather than bending the
//   layout around it.
const PHOTO_ASPECT = 1024 / 684

function Block({ title, children }) {
  return (
    <View style={s.block}>
      <Text style={s.blockTitle}>{title}</Text>
      {children}
    </View>
  )
}

// A section that opens CLOSED and expands on tap.
//
// ⚠ COLLAPSING IS NOT FILTERING. Every item stays, in Alasia's order, and nothing is
//   summarised or promoted into the header. The header carries a COUNT so a closed section
//   still says how much is inside — "Hizmetler · 22" tells you the size of what you are
//   choosing not to open, which a bare chevron does not.
//
// Animated on OPEN because it answers a tap and shows what changed. No entrance animation
// on load: nothing was asked for, so nothing should move. Mirrors ProfileScreen's use of
// LayoutAnimation, including the Android enable call it needs.
function CollapsibleBlock({ title, count, open, onToggle, children }) {
  return (
    <View style={s.block}>
      <TouchableOpacity style={s.collapseHead} onPress={onToggle} activeOpacity={0.6}>
        <Text style={s.blockTitle}>
          {title}
          {count != null && <Text style={s.collapseCount}> · {count}</Text>}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
      </TouchableOpacity>
      {open && children}
    </View>
  )
}

function Chip({ icon, label }) {
  return (
    <View style={s.chip}>
      {!!icon && <Ionicons name={icon} size={13} color={colors.textSecondary} />}
      <Text style={s.chipText}>{label}</Text>
    </View>
  )
}

// One room, as a CARD. Photo, both of Alasia's names, and the headline payment line.
//
// ⚠ THE PAYMENT LINE IS NEVER A SUM. Alasia publishes "€500" and "€2,490" as two figures
//   and does not publish their total. Adding them would be ADA's arithmetic, and a
//   directory that does arithmetic has started editing.
//
// ⚠ AND THE FIGURE NEVER APPEARS BARE — no exceptions anywhere in this file. 2,490 is
//   simultaneously the Quad Bungalow's full-payment total and the Triple Room's balance
//   after deposit, both true, so a mix-up cannot be caught by checking the number. Every
//   figure carries its plan label and sits inside its room's card.
//
//   No currency symbol is hardcoded either: the holding deposit arrives from
//   partner.deposits.holding.amount. A figure typed into a component is a figure nobody
//   updates when the source changes.
function DormRoomRow({ room, lang, holding, width, onPress }) {
  const src  = partnerAsset(room.photo)
  const full = room.plans?.full
  return (
    <TouchableOpacity style={s.roomCard} onPress={onPress} activeOpacity={0.9}>
      {/* An image sized to SELL THE ROOM rather than to label it. A 64pt thumbnail against
          a 1024x684 photo told you a room existed; this shows you what it is.
          NULL-SAFE: the Single Bungalow has no photo on Alasia's site, so its card renders
          text-only — no grey box, no placeholder icon, no reserved band. */}
      {!!src && (
        <Image source={src}
          style={{ width, height: Math.round(width / PHOTO_ASPECT), borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md }}
          resizeMode="cover" />
      )}
      <View style={s.roomBody}>
        <Text style={s.roomName} numberOfLines={2}>{t(room.nameKey, lang)}</Text>
        {!!room.sourceName && (
          <Text style={s.roomAlt} numberOfLines={1}>
            {t('dormListedAs', lang)}: {room.sourceName}
          </Text>
        )}
        {!!full && (
          <View style={s.roomPriceRow}>
            <Text style={s.roomPriceLabel}>{t('dormPlanFull', lang)}</Text>
            <Text style={s.roomPrice} numberOfLines={2}>
              {!!holding && <>{holding} {t('dormKapora', lang)} + </>}
              {full.amounts[0]} {t('dormBalance', lang)}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  )
}

function SourceLink({ label, url }) {
  return (
    <TouchableOpacity style={s.sourceLinkRow} activeOpacity={0.6}
      onPress={() => Linking.openURL(url).catch(() => {})}>
      <Ionicons name="open-outline" size={13} color={colors.primary} />
      <Text style={s.sourceLinkLabel}>{label}</Text>
    </TouchableOpacity>
  )
}

// One service. Name left, value right when there is one — and nothing at all when there is
// not. NO TICK COLUMN: a tick on every row of a list headed "included" carries no
// information and costs a column the longer locales need.
//
// ⚠ SOLVED AS A ROW-DESIGN PROBLEM, NOT A LAYOUT ONE, and the alternative is worth
//   recording. Two columns would fit 22 items in half the height and BREAK ALASIA'S ORDER
//   whichever way they are read: down-then-across defeats normal left-right scanning,
//   across-then-down silently changes the sequence. The order is theirs, so neither is
//   available. The single column was made to read instead — taller rows, a lighter
//   divider, the value set hard against the label.
function DormServiceRow({ item, lang }) {
  const value = item.value || (item.valueKey ? t(item.valueKey, lang) : null)
  return (
    <View style={s.svcRow}>
      <Text style={s.svcName} numberOfLines={2}>{t(item.labelKey, lang)}</Text>
      {!!value && <Text style={s.svcValue}>{value}</Text>}
    </View>
  )
}

// One shuttle route. Name, stop list, departure times as wrapped chips.
//
// ⚠ A CARD RATHER THAN A TABLE ROW, and that is the whole point: routes have different
//   numbers of departures (six, five, five, three), so a grid needs a dash in every gap.
//   A dash is a table artifact, not information Alasia published. Chips wrap instead.
//
// Route names, stop lists and times are PROPER NOUNS and figures — verbatim, untranslated.
function DormRouteCard({ route, lang }) {
  return (
    <View style={s.routeCard}>
      <Text style={s.routeName}>{route.name}</Text>
      {!!route.stops && <Text style={s.routeStops} numberOfLines={2}>{route.stops}</Text>}
      <View style={s.timeWrap}>
        {route.times.map(tm => (
          <View key={tm} style={s.timeChip}><Text style={s.timeChipText}>{tm}</Text></View>
        ))}
      </View>
    </View>
  )
}

export default function DormPartnerScreen({ partner, lang, region, onBack, onAdNavigate }) {
  const insets = useSafeAreaInsets()
  const { width: winW } = useWindowDimensions()
  // The room sheet is a Modal, so its own onRequestClose consumes Android back — unlike the
  // showcase overlay, this state is correctly local. See the note in DormRoomSheet.js.
  const [openRoom, setOpenRoom] = useState(null)
  const [heroIdx, setHeroIdx]   = useState(0)
  // Closed on first render. Both sections are long and a page that opens with 28 rows of
  // detail buries the six room cards above them.
  const [openSections, setOpenSections] = useState({})
  const toggle = id => {
    if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true)
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    setOpenSections(o => ({ ...o, [id]: !o[id] }))
  }
  if (!partner) return null

  const phone = String(partner.phone || '').replace(/\s/g, '')
  const waNum = String(partner.whatsapp || partner.phone || '').replace(/\D/g, '')
  const langCode = LANG_CODES[lang] || 'en'

  // Emptiness is decided in the config module, once, for every section. This screen makes
  // no such judgement of its own — which is what stops a half-wired section leaking
  // through as a heading with nothing under it.
  const sec = dormSections(partner, { resolveAsset: partnerAsset })

  const districtName = REGION_LABEL_KEY[partner.district] ? t(REGION_LABEL_KEY[partner.district], lang) : partner.district
  const place = [partner.area, districtName].filter(Boolean).join(' · ')

  // t() returns the KEY when a string is missing, so an unwritten about block must be
  // compared against its own key name — otherwise the screen renders "dormAlasiaAbout" to
  // a user. Özok has supplied no copy, so today this is always false by design.
  const about     = partner.aboutKey ? t(partner.aboutKey, lang) : ''
  const showAbout = !!about && about !== partner.aboutKey

  const accent = partner.accent || colors.primary
  // ⚠ THE DEAL BAND'S TEXT COLOUR IS DERIVED, NEVER HARDCODED. It used to be '#fff', which
  //   is correct on the ADA teal fallback (5.01:1) and invisible on a light brand colour —
  //   white on a brand yellow measures 1.43:1. The fallback hid it: the band had never once
  //   rendered against a real accent, because Özok's hex has not arrived. readableOn() picks
  //   white or ink by luminance, so partner #2's colour needs no further work.
  //   scripts/check-dorms.mjs refuses any configured accent whose best foreground is under
  //   4.5:1 — there are colours (mid greys) where neither option reaches it and no function
  //   can invent a third.
  const onAccent = readableOn(accent)

  // ─── Contact handoff ──────────────────────────────────────────────────────
  // logContactEvent is fire-and-forget and can never throw — it is called on the line
  // BEFORE Linking.openURL, so a synchronous throw here would cost the user the call.
  //
  // `region` is the region filter active at tap time. The dorm tab has NO filter row, so
  // it is null and stays null: passing the partner's own district would fabricate user
  // context into a column that means something else.
  const openWhatsApp = () => {
    if (!waNum) return
    logContactEvent('accommodation', partner.id, 'whatsapp', region)
    Linking.openURL(`https://wa.me/${waNum}?text=${encodeURIComponent(dormWaMessage(partner, langCode))}`)
      .catch(() => {})
  }
  const call = () => {
    if (!phone) return
    logContactEvent('accommodation', partner.id, 'call', region)
    Linking.openURL(`tel:${phone}`).catch(() => {})
  }
  // ⚠ 'website' REQUIRES 20261014_contact_events_website_action.sql TO BE APPLIED. Until it
  //   is, the CHECK rejects the row and logContactEvent swallows the error by design — the
  //   tap still opens the site, but it is never counted, and a silent zero is
  //   indistinguishable from no demand. DORMS_LIVE gates this whole screen, so the window
  //   is unreachable today; the precondition is recorded on the flag in constants/flags.js.
  const openWebsite = () => {
    const url = dormWebsiteUrl(partner)
    if (!url) return
    logContactEvent('accommodation', partner.id, 'website', region)
    Linking.openURL(url).catch(() => {})
  }
  const openDirections = () => {
    if (!sec.coords) return
    const { latitude, longitude } = sec.coords
    Linking.openURL(`https://maps.google.com/?q=${latitude},${longitude}`).catch(() => {})
  }

  const CONTENT_W = winW - 32
  const HERO_ASPECT = 16 / 9

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.navbar}>
        <BackButton lang={lang} onPress={onBack} />
        <Text style={s.navTitle} numberOfLines={1}>{partner.name}</Text>
        <View style={s.navSpacer} />
      </View>

      {/* 120 clears the absolute contact bar — the same figure TowingDetailScreen,
          PropertyDetailScreen and HomeServicePartnerScreen all use for their identical
          bars. It is also where slice 4's ad slot lands. */}
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: 120 + insets.bottom }]}>

        {/* 1. HERO GALLERY — full-bleed, fixed ratio, swipeable. */}
        {sec.gallery.length > 0 && (
          <View style={[s.heroWrap, { width: winW, marginLeft: -16 }]}>
            <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={e => setHeroIdx(Math.round(e.nativeEvent.contentOffset.x / winW))}>
              {sec.gallery.map((src, i) => (
                <Image key={i} source={src}
                  style={{ width: winW, height: Math.round(winW / PHOTO_ASPECT) }}
                  resizeMode="cover" />
              ))}
            </ScrollView>
            {sec.gallery.length > 1 && (
              <View style={s.heroDots}>
                {sec.gallery.map((_, i) => (
                  <View key={i} style={[s.heroDot, i === heroIdx && s.heroDotOn]} />
                ))}
              </View>
            )}
          </View>
        )}

        {/* 2 + 3. LOGO, BADGE, NAME, LOCATION */}
        <View style={s.hero}>
          {/* FILLED with the accent, text derived — not accent-coloured text on white.
              That earlier shape was the same defect the deal band had, in its inverse:
              accent AS TEXT on cardBg is 1.43:1 on a brand yellow, and readableOn() does not
              apply to it because there is no fill to read against.
              Filling reuses the one primitive instead of introducing a second contrast rule,
              and it gives the brand colour more surface area than thin text would. */}
          <View style={[s.badge, { backgroundColor: accent }]}>
            <Ionicons name="ribbon-outline" size={12} color={onAccent} />
            <Text style={[s.badgeText, { color: onAccent }]}>{t('dormPartnerBadge', lang)}</Text>
          </View>

          <PartnerLogoStrip
            source={partnerLogo(partner)}
            name={partner.name}
            width={HERO_LOGO.width}
            height={HERO_LOGO.height}
            style={{ marginBottom: 8 }}
          />

          <Text style={s.heroName}>{partner.name}</Text>
          {!!place && (
            <View style={s.placeRow}>
              <Ionicons name="location-outline" size={14} color={colors.textSecondary} />
              <Text style={s.placeText}>{place}</Text>
            </View>
          )}
        </View>

        {/* 4. DEAL BAND — text AND a future expiry, or nothing. */}
        {!!sec.deal && (
          <View style={[s.dealBand, { backgroundColor: accent }]}>
            <Ionicons name="pricetag-outline" size={15} color={onAccent} />
            <Text style={[s.dealText, { color: onAccent }]}>{t(sec.deal.textKey, lang)}</Text>
          </View>
        )}

        {showAbout && (
          <Block title={t('dormAbout', lang)}>
            <Text style={s.about}>{about}</Text>
          </Block>
        )}

        {/* ─── SECTIONS, IN CONFIG ORDER ──────────────────────────────────────
            SECTION_ORDER in constants/dorms.js decides the sequence, not this file's JSX
            position — so the order can change again without a component edit.
            Rooms first because PRICE IS THE QUESTION AFTER THE PHOTOS. */}
        {SECTION_ORDER.map(id => {
          const collapsible = COLLAPSIBLE.includes(id)
          const open = !!openSections[id]

          if (id === 'rooms' && !!sec.rooms) return (
            <Block key={id} title={t('dormRooms', lang)}>
              {sec.rooms.map(r => (
                <DormRoomRow key={r.code} room={r} lang={lang} width={winW - 32}
                  holding={partner.deposits?.holding?.amount} onPress={() => setOpenRoom(r)} />
              ))}
              {/* The academic year travels WITH the prices, so a stale table is visibly
                  stale rather than silently wrong. */}
              <Text style={s.yearNote}>{t('dormAcademicYear', lang)} {partner.academicYear}</Text>
            </Block>
          )

          if (id === 'services' && (!!sec.included || !!sec.extra)) {
            const count = (sec.included?.length || 0) + (sec.extra?.length || 0)
            return (
              <CollapsibleBlock key={id} title={t('dormServices', lang)} count={count}
                open={open} onToggle={() => toggle(id)}>
                {!!sec.included && (
                  <>
                    <Text style={s.subTitle}>{t('dormIncluded', lang)}</Text>
                    {sec.included.map(x => <DormServiceRow key={x.labelKey} item={x} lang={lang} />)}
                  </>
                )}
                {!!sec.extra && (
                  <>
                    <Text style={[s.subTitle, s.svcGroupGap]}>{t('dormExtra', lang)}</Text>
                    {sec.extra.map(x => <DormServiceRow key={x.labelKey} item={x} lang={lang} />)}
                  </>
                )}
              </CollapsibleBlock>
            )
          }

          if (id === 'shuttles' && !!sec.shuttles) {
            // flatMap, not reduce: check-dorms.mjs forbids reduce/parseFloat/parseInt/Number
            // anywhere in this file, because publishing a total Alasia does not publish is
            // editing. The rule is blunt on purpose and it is cheap to satisfy — counting
            // routes reads better this way regardless.
            const routes = sec.shuttles.flatMap(sv => sv.weekend ? [...sv.routes, sv.weekend] : sv.routes).length
            return (
              <CollapsibleBlock key={id} title={t('dormTransport', lang)} count={routes}
                open={open} onToggle={() => toggle(id)}>
                {/* ⚠ THE TWO SERVICES STAY SEPARATELY ATTRIBUTED INSIDE THE SECTION. They are
                    not merged into one list to save height: the free shuttle is Alasia
                    International University's and the paid one is the dorm's, and collapsing
                    is about height, never about losing who runs what. */}
                {sec.shuttles.map((sv, i) => (
                  <View key={sv.id} style={i > 0 ? s.svcGroupGap : null}>
                    <View style={s.shuttleHead}>
                      <Text style={s.shuttleName}>{t(sv.nameKey, lang)}</Text>
                      <Text style={s.shuttleProvider}>
                        {t('dormShuttleProvidedBy', lang)}: {sv.providerName}
                      </Text>
                    </View>
                    {sv.routes.map(rt => <DormRouteCard key={rt.name} route={rt} lang={lang} />)}
                    {!!sv.weekend && (
                      <View style={s.routeCard}>
                        <Text style={s.routeName}>{sv.weekend.name}</Text>
                        <Text style={s.routeStops}>{t('dormShuttleWeekend', lang)}</Text>
                        <View style={s.timeWrap}>
                          <View style={s.timeChip}>
                            <Text style={s.timeChipText}>
                              <Text style={s.timeChipLabel}>{t('dormShuttleOut', lang)} </Text>
                              {sv.weekend.out}
                            </Text>
                          </View>
                          <View style={s.timeChip}>
                            <Text style={s.timeChipText}>
                              <Text style={s.timeChipLabel}>{t('dormShuttleBack', lang)} </Text>
                              {sv.weekend.back}
                            </Text>
                          </View>
                        </View>
                      </View>
                    )}
                  </View>
                ))}
              </CollapsibleBlock>
            )
          }

          if (id === 'location' && !!sec.coords) return (
            <Block key={id} title={t('dormLocation', lang)}>
              <MapView style={{ height: MAP_H, borderRadius: radius.md, overflow: 'hidden' }}
                pointerEvents="none"
                initialRegion={{ latitude: sec.coords.latitude, longitude: sec.coords.longitude,
                                 latitudeDelta: 0.01, longitudeDelta: 0.01 }}>
                <Marker coordinate={sec.coords} title={partner.name} />
              </MapView>
            </Block>
          )

          if (id === 'ring' && !!sec.ringTimes) return (
            <Block key={id} title={t('dormRing', lang)}>
              {sec.ringTimes.map((r, i) => (
                <View key={i} style={s.row}>
                  <Text style={s.rowLabel}>{t(r.labelKey, lang)}</Text>
                  <Text style={s.rowValue}>{r.times}</Text>
                </View>
              ))}
            </Block>
          )

          if (id === 'events' && !!sec.events) return (
            <Block key={id} title={t('dormEvents', lang)}>
              {sec.events.map((e, i) => (
                <View key={i} style={s.row}>
                  <Text style={s.rowLabel}>{t(e.titleKey, lang)}</Text>
                  {!!e.date && <Text style={s.rowValue}>{e.date}</Text>}
                </View>
              ))}
            </Block>
          )

          if (id === 'contact') return (
            <Block key={id} title={t('dormContact', lang)}>
              {!!partner.phone && (
                <TouchableOpacity style={s.row} onPress={call} activeOpacity={0.6}>
                  <Text style={s.rowLabel}>{t('accomCall', lang)}</Text>
                  <View style={s.rowRight}>
                    <Text style={[s.rowValue, s.rowValueLink]}>{partner.phone}</Text>
                    <Ionicons name="call-outline" size={15} color={colors.primary} />
                  </View>
                </TouchableOpacity>
              )}
              {!!partner.email && (
                <TouchableOpacity style={s.row} activeOpacity={0.6}
                  onPress={() => Linking.openURL(`mailto:${partner.email}`).catch(() => {})}>
                  <Text style={s.rowLabel}>{t('dormEmail', lang)}</Text>
                  <View style={s.rowRight}>
                    <Text style={[s.rowValue, s.rowValueLink]}>{partner.email}</Text>
                    <Ionicons name="mail-outline" size={15} color={colors.primary} />
                  </View>
                </TouchableOpacity>
              )}
              {!!partner.website && (
                <TouchableOpacity style={s.row} onPress={openWebsite} activeOpacity={0.6}>
                  <Text style={s.rowLabel}>{t('dormWebsite', lang)}</Text>
                  <View style={s.rowRight}>
                    <Ionicons name="open-outline" size={15} color={colors.primary} />
                  </View>
                </TouchableOpacity>
              )}
              {/* The street address verbatim, with THEIR OWN Maps link as the directions
                  target — not a coordinate we resolved. */}
              {!!partner.address && (
                <View style={s.addressRow}>
                  <Text style={s.rowLabel}>{t('dormAddress', lang)}</Text>
                  <Text style={s.addressText}>{partner.address}</Text>
                </View>
              )}
              {!!partner.mapsUrl && (
                <TouchableOpacity style={s.directionsBtn} activeOpacity={0.85}
                  onPress={() => Linking.openURL(partner.mapsUrl).catch(() => {})}>
                  <Ionicons name="navigate-outline" size={16} color="#fff" />
                  <Text style={s.directionsBtnText}>{t('getDirections', lang)}</Text>
                </TouchableOpacity>
              )}
            </Block>
          )

          if (id === 'source' && !!partner.priceSource?.url) return (
            <View key={id} style={s.sourceBlock}>
              <Text style={s.sourceTitle}>{t('dormSourceTitle', lang)}</Text>
              <Text style={s.sourceBody}>{t('dormSourceBody', lang)}</Text>
              <View style={s.sourceLinks}>
                <SourceLink label={t('dormSourcePrices', lang)} url={partner.priceSource.url} />
                {!!partner.priceSource.pdfUrl && (
                  <SourceLink label={t('dormSourcePdf', lang)} url={partner.priceSource.pdfUrl} />
                )}
                {!!partner.shuttleSource && (
                  <SourceLink label={t('dormSourceShuttles', lang)} url={partner.shuttleSource} />
                )}
              </View>
            </View>
          )

          return null
        })}

        {/* 11. OPERATOR FOOTER */}
        {!!partner.operatorKey && (
          <Text style={s.operator}>{t(partner.operatorKey, lang)}</Text>
        )}

        {/* Last child of the ScrollView, exactly as on PropertyDetailScreen. The 120pt
            contentContainerStyle padding above already reserves the contact bar's space
            AFTER the last child, so the banner clears it with no constant touched.
            Unsold renders null: zero height, no placeholder. */}
        <AccommodationDetailBottomSlot lang={lang} onNavigate={onAdNavigate} />
      </ScrollView>

      <View style={[s.contactBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        {!!waNum && (
          <TouchableOpacity style={s.waBtn} onPress={openWhatsApp} activeOpacity={0.85}>
            <Ionicons name="logo-whatsapp" size={18} color="#fff" />
            <Text style={s.barBtnText}>{t('accomWhatsApp', lang)}</Text>
          </TouchableOpacity>
        )}
        {!!phone && (
          <TouchableOpacity style={s.callBtn} onPress={call} activeOpacity={0.85}>
            <Ionicons name="call" size={18} color="#fff" />
            <Text style={s.barBtnText}>{t('accomCall', lang)}</Text>
          </TouchableOpacity>
        )}
      </View>

      <DormRoomSheet room={openRoom} partner={partner} lang={lang} region={region}
        onClose={() => setOpenRoom(null)} />
    </SafeAreaView>
  )
}

// ─── TYPE SCALE ─────────────────────────────────────────────────────────────
//
// Measured before this pass: 25 of the 29 font sizes on this screen sat between 11pt and
// 14pt. One 22, one 16, and everything else — section headings, room names, prices, service
// rows, shuttle times, source links — inside a 4pt band. That is why the page read as a
// document rather than a screen, and it is a HIERARCHY problem, not a decoration one.
//
// Five steps with assigned roles. A size outside this set is a decision somebody should
// have to make deliberately.
const TYPE = {
  title:   22,   // the partner's name. Once per page.
  section: 17,   // a Block heading. The thing you scan for.
  item:    15,   // a room name, a plan name, a route name — the unit of content.
  body:    13,   // service names, row labels, prices in a row.
  meta:    11,   // source names, notes, captions, attribution.
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: colors.bg },
  navbar:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  navTitle:    { flex: 1, textAlign: 'center', fontSize: TYPE.body, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  navSpacer:   { width: 40 },
  content:     { paddingHorizontal: 16 },

  // ─── Hero ────────────────────────────────────────────────────────────────
  heroWrap:    { marginBottom: 18 },
  heroDots:    { flexDirection: 'row', gap: 5, alignSelf: 'center', marginTop: 10 },
  heroDot:     { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  heroDotOn:   { backgroundColor: colors.textSecondary },

  hero:        { alignItems: 'flex-start', marginBottom: 22 },
  badge:       { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
                 paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10, marginBottom: 12 },
  badgeText:   { fontSize: TYPE.meta, fontFamily: 'Inter_700Bold' },
  heroName:    { fontSize: TYPE.title, fontFamily: 'Inter_700Bold', color: colors.textPrimary, lineHeight: 28 },
  placeRow:    { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  placeText:   { flex: 1, fontSize: TYPE.body, fontFamily: 'Inter_400Regular', color: colors.textSecondary },

  dealBand:    { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12,
                 borderRadius: radius.md, marginBottom: 18 },
  dealText:    { flex: 1, fontSize: TYPE.body, fontFamily: 'Inter_700Bold' },

  // ─── Section rhythm ──────────────────────────────────────────────────────
  // 22pt between blocks, not 12. The eleven sections were near-uniform slabs with the same
  // gap inside them as between them, so nothing read as a boundary.
  block:       { marginBottom: 22 },
  blockTitle:  { fontSize: TYPE.section, fontFamily: 'Inter_700Bold', color: colors.textPrimary,
                 marginBottom: 12 },
  subTitle:    { fontSize: TYPE.body, fontFamily: 'Inter_700Bold', color: colors.textSecondary,
                 textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4, marginBottom: 8 },
  about:       { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 21 },

  // ─── Room cards ──────────────────────────────────────────────────────────
  roomCard:    { backgroundColor: colors.cardBg, borderRadius: radius.md, marginBottom: 14,
                 overflow: 'hidden', ...shadow },
  roomBody:    { padding: 14 },
  roomName:    { fontSize: TYPE.item, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  roomAlt:     { fontSize: TYPE.meta, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 2 },
  roomPriceRow:{ marginTop: 10 },
  roomPriceLabel: { fontSize: TYPE.meta, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                    textTransform: 'uppercase', letterSpacing: 0.4 },
  roomPrice:   { fontSize: TYPE.item, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginTop: 2 },
  yearNote:    { marginTop: 2, fontSize: TYPE.meta, fontFamily: 'Inter_400Regular', color: colors.textSecondary },

  // ─── Services — a ROW DESIGN problem, solved as one ───────────────────────
  // Two columns were rejected: down-then-across defeats normal left-right scanning,
  // across-then-down silently changes Alasia's order. Neither is safe, and the order is
  // theirs. So the single column was made to read instead — taller rows, a lighter
  // divider, the value set against the label rather than floating.
  svcRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                 gap: 12, paddingVertical: 11,
                 borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  svcName:     { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  svcValue:    { fontSize: TYPE.body, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  svcGroupGap: { marginTop: 22 },
  collapseHead:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                   gap: 12, paddingVertical: 2 },
  collapseCount: { fontFamily: 'Inter_400Regular', color: colors.textSecondary },

  // ─── Shuttles ────────────────────────────────────────────────────────────
  shuttleHead:    { marginBottom: 10 },
  shuttleName:    { fontSize: TYPE.item, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  shuttleProvider:{ fontSize: TYPE.meta, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 2 },
  routeCard:   { backgroundColor: colors.cardBg, borderRadius: radius.md, padding: 12, marginBottom: 10, ...shadow },
  routeName:   { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  routeStops:  { fontSize: TYPE.meta, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                 marginTop: 2, marginBottom: 9, lineHeight: 15 },
  timeWrap:    { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  timeChip:    { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 9, backgroundColor: colors.surface },
  timeChipText:{ fontSize: TYPE.body, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  timeChipLabel:{ fontFamily: 'Inter_400Regular', color: colors.textSecondary },

  chipWrap:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:        { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10,
                 paddingVertical: 6, borderRadius: 14, backgroundColor: colors.surface },
  chipText:    { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary },

  // ─── Contact + source ────────────────────────────────────────────────────
  row:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                 paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  rowLabel:    { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  rowValue:    { fontSize: TYPE.body, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
  rowValueLink:{ color: colors.primary },
  rowRight:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
  addressRow:  { paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  addressText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, marginTop: 4, lineHeight: 19 },

  directionsBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                   marginTop: 14, paddingVertical: 12, borderRadius: radius.md, backgroundColor: colors.primary },
  directionsBtnText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },

  sourceBlock: { marginTop: 4, marginBottom: 14, padding: 14, borderRadius: radius.md,
                 backgroundColor: colors.surface },
  sourceTitle: { fontSize: TYPE.body, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  sourceBody:  { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                 lineHeight: 18, marginTop: 6 },
  sourceLinks: { marginTop: 10, gap: 2 },
  sourceLinkRow:   { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  sourceLinkLabel: { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary },

  operator:    { marginTop: 2, marginBottom: 10, textAlign: 'center', fontSize: TYPE.meta,
                 fontFamily: 'Inter_400Regular', color: colors.textSecondary },

  contactBar:  { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 10,
                 paddingHorizontal: 16, paddingTop: 12, backgroundColor: colors.cardBg,
                 borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  waBtn:       { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
                 paddingVertical: 13, borderRadius: radius.md, backgroundColor: '#25D366' },
  callBtn:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
                 paddingVertical: 13, borderRadius: radius.md, backgroundColor: colors.primary },
  barBtnText:  { fontSize: TYPE.item, fontFamily: 'Inter_700Bold', color: '#fff' },
})
