import { useState } from 'react'
import { View, Text, Image, ScrollView, TouchableOpacity, StyleSheet, Linking, useWindowDimensions } from 'react-native'
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
import { dormSections, dormWaMessage, dormWebsiteUrl } from '../constants/dorms'
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

function Block({ title, children }) {
  return (
    <View style={s.block}>
      <Text style={s.blockTitle}>{title}</Text>
      {children}
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

// One room in the vertical list. Thumbnail, both of Alasia's names, and the headline
// payment line.
//
// ⚠ THE PAYMENT LINE IS NEVER A SUM. Alasia publishes "€500" and "€2,490" as two figures
//   and does not publish their total. Adding them would be ADA's arithmetic, and a
//   directory that does arithmetic has started editing. So: "€500 kapora + €2,490 bakiye".
//
// ⚠ AND THE FIGURE NEVER APPEARS BARE — WITH NO EXCEPTIONS ANYWHERE IN THIS FILE.
//   2,490 is simultaneously the Quad Bungalow's full-payment total and the Triple Room's
//   balance after deposit — both true, so a mix-up cannot be caught by checking whether the
//   number is right. Every figure carries its plan label and sits inside its room's row.
//
//   The hero used to quote Alasia's own "Starting From € 2490" under a deliberate
//   carve-out. It is GONE. On device in Turkish it rendered an English sentence, because a
//   QUOTATION CANNOT BE LOCALISED — translating it stops it being a quotation — so it
//   shipped English into all nine locales. The six qualified prices below carry the same
//   information properly, and a rule with no exceptions is easier to keep true than a rule
//   with one.
//
//   No currency symbol is hardcoded here either: the holding deposit arrives from
//   partner.deposits.holding.amount. A figure typed into a component is a figure nobody
//   updates when the source changes.
function DormRoomRow({ room, lang, holding, onPress }) {
  const src  = partnerAsset(room.photo)
  const full = room.plans?.full
  return (
    <TouchableOpacity style={s.roomRow} onPress={onPress} activeOpacity={0.7}>
      {!!src && <Image source={src} style={s.roomThumb} resizeMode="cover" />}
      <View style={s.roomBody}>
        <Text style={s.roomName} numberOfLines={2}>{t(room.nameKey, lang)}</Text>
        {!!room.sourceName && (
          <Text style={s.roomAlt} numberOfLines={1}>
            {t('dormListedAs', lang)}: {room.sourceName}
          </Text>
        )}
        {!!full && (
          <Text style={s.roomPrice} numberOfLines={2}>
            <Text style={s.roomPriceLabel}>{t('dormPlanFull', lang)} · </Text>
            {!!holding && <>{holding} {t('dormKapora', lang)} + </>}
            {full.amounts[0]} {t('dormBalance', lang)}
          </Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
    </TouchableOpacity>
  )
}

// One service. Name left, value right when there is one — and nothing at all when there is
// not. NO TICK COLUMN: a tick on every row of a list headed "included" carries no
// information and costs a column the longer locales need.
function SourceLink({ label, url }) {
  return (
    <TouchableOpacity style={s.sourceLinkRow} activeOpacity={0.6}
      onPress={() => Linking.openURL(url).catch(() => {})}>
      <Ionicons name="open-outline" size={13} color={colors.primary} />
      <Text style={s.sourceLinkLabel}>{label}</Text>
    </TouchableOpacity>
  )
}

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

        {/* 1. HERO GALLERY — absent today. Not a placeholder box: with no photos the page
               simply starts at the logo, which is a normal-looking page. */}
        {sec.gallery.length > 0 && (
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}
            style={{ marginBottom: 14 }}>
            {sec.gallery.map((src, i) => (
              <Image key={i} source={src}
                style={{ width: CONTENT_W, height: Math.round(CONTENT_W / HERO_ASPECT), borderRadius: radius.md }}
                resizeMode="cover" />
            ))}
          </ScrollView>
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

        {/* 5. SHUTTLES — ROUTE CARDS, NOT A TABLE.
               Their own page presents this as a grid, which needs a dash wherever a route
               has fewer departures than the widest one. A DASH IS A TABLE ARTIFACT, not
               something Alasia published. One card per route instead: name, stops, and the
               departure times as wrapped chips — no empty cells to fill.

               TWO SERVICES, SEPARATELY ATTRIBUTED. The free one is the university's, not
               the dorm's. Presenting them as two distinct services is faithful
               reproduction and happens to leave no apparent contradiction to trip over. */}
        {!!sec.shuttles && (
          <Block title={t('dormTransport', lang)}>
            {sec.shuttles.map((sv, i) => (
              <View key={sv.id} style={i > 0 ? s.svcGroupGap : null}>
                <View style={s.shuttleHead}>
                  <Text style={s.shuttleName}>{t(sv.nameKey, lang)}</Text>
                  {/* The attribution is the load-bearing field on this whole section. */}
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
          </Block>
        )}
        {!!sec.amenities && (
          <Block title={t('dormAmenities', lang)}>
            <View style={s.chipWrap}>
              {sec.amenities.map((a, i) => <Chip key={i} icon={a.icon} label={t(a.labelKey, lang)} />)}
            </View>
          </Block>
        )}

        {/* 6. ROOM TYPES — A VERTICAL LIST, NOT A CAROUSEL.
               Six types each carrying a price cannot live in a horizontal strip: three sit
               off-screen, and comparing prices is the one thing somebody is here to do.
               Thumbnail left, names and payment line right.
               NULL-SAFE PER ROW: the Single Bungalow has no photo on Alasia's site, so its
               card renders without one and must still look finished — no grey box, no
               placeholder icon, the text simply takes the full width. */}
        {!!sec.rooms && (
          <Block title={t('dormRooms', lang)}>
            {sec.rooms.map(r => (
              <DormRoomRow key={r.code} room={r} lang={lang}
                holding={partner.deposits?.holding?.amount} onPress={() => setOpenRoom(r)} />
            ))}
            {/* The academic year travels WITH the prices, so a stale table is visibly stale
                rather than silently wrong. */}
            <Text style={s.yearNote}>
              {t('dormAcademicYear', lang)} {partner.academicYear}
            </Text>
          </Block>
        )}

        {/* 7. SERVICES — ALASIA'S OWN ORDER, VALUES RIGHT-ALIGNED, NO TICK COLUMN.
               A tick beside every row of a list titled "included" says nothing, and it
               costs a column the longer locales need. Rows with no value are just a name;
               nothing renders a dash or an empty cell. */}
        {(!!sec.included || !!sec.extra) && (
          <Block title={t('dormServices', lang)}>
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
          </Block>
        )}

        {/* 8. MAP — coords are owed. A district centre would be a WRONG pin on a partner's
               own page, which is worse than no map, so null collapses the whole block
               including the directions button. */}
        {!!sec.coords && (
          <Block title={t('dormLocation', lang)}>
            <MapView
              style={{ height: MAP_H, borderRadius: radius.md, overflow: 'hidden' }}
              pointerEvents="none"
              initialRegion={{
                latitude: sec.coords.latitude, longitude: sec.coords.longitude,
                latitudeDelta: 0.01, longitudeDelta: 0.01,
              }}>
              <Marker coordinate={sec.coords} title={partner.name} />
            </MapView>
            <TouchableOpacity style={s.directionsBtn} onPress={openDirections} activeOpacity={0.85}>
              <Ionicons name="navigate-outline" size={16} color="#fff" />
              <Text style={s.directionsBtnText}>{t('getDirections', lang)}</Text>
            </TouchableOpacity>
          </Block>
        )}

        {/* 9. RING SAATLERİ */}
        {!!sec.ringTimes && (
          <Block title={t('dormRing', lang)}>
            {sec.ringTimes.map((r, i) => (
              <View key={i} style={s.row}>
                <Text style={s.rowLabel}>{t(r.labelKey, lang)}</Text>
                <Text style={s.rowValue}>{r.times}</Text>
              </View>
            ))}
          </Block>
        )}

        {/* 10. EVENTS */}
        {!!sec.events && (
          <Block title={t('dormEvents', lang)}>
            {sec.events.map((e, i) => (
              <View key={i} style={s.row}>
                <Text style={s.rowLabel}>{t(e.titleKey, lang)}</Text>
                {!!e.date && <Text style={s.rowValue}>{e.date}</Text>}
              </View>
            ))}
          </Block>
        )}

        {/* Website lives with contact, not in the bar: the bar is for reaching a person. */}
        <Block title={t('dormContact', lang)}>
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
          {/* The street address, verbatim, with THEIR OWN Maps link as the directions
              target. Not a coordinate we resolved: a short link resolves to the pin Alasia
              chose, where a lat/lng we derived is our guess at where they meant. */}
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

        {/* ─── WHERE THIS INFORMATION COMES FROM ────────────────────────────
            The obligation that comes with being a directory rather than an editor: say so,
            in the page, and link the authority. If ADA reproduces Alasia's numbers then a
            reader must be able to reach Alasia's numbers — and when the two disagree, the
            source wins and the reader can see that for themselves. */}
        {!!partner.priceSource?.url && (
          <View style={s.sourceBlock}>
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
        )}

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

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: colors.bg },
  navbar:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  navTitle:    { flex: 1, textAlign: 'center', fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  navSpacer:   { width: 40 },
  content:     { paddingHorizontal: 16 },

  hero:        { alignItems: 'flex-start', marginBottom: 14 },
  // No borderWidth and no `backgroundColor` default: the fill is set inline from the accent.
  // The Android borderRadius + borderWidth gotcha that forces an explicit transparent
  // background does not apply once the border is gone and the fill is real.
  badge:       { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
                 paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10, marginBottom: 10 },
  badgeText:   { fontSize: 11, fontFamily: 'Inter_700Bold' },
  heroName:    { fontSize: 22, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  placeRow:    { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  placeText:   { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },

  dealBand:    { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12,
                 borderRadius: radius.md, marginBottom: 14 },
  // No `color` here on purpose — it is set inline from readableOn(accent). A default white
  // would be the value that is right on teal and wrong on every light brand colour, sitting
  // in the stylesheet waiting for somebody to delete the inline override as redundant.
  dealText:    { flex: 1, fontSize: 13, fontFamily: 'Inter_700Bold' },

  block:       { backgroundColor: colors.cardBg, borderRadius: radius.md, padding: 14, marginBottom: 12, ...shadow },
  blockTitle:  { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textSecondary,
                 textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  subTitle:    { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginTop: 4, marginBottom: 6 },
  about:       { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 20 },

  chipWrap:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:        { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10,
                 paddingVertical: 6, borderRadius: 14, backgroundColor: colors.surface },
  chipText:    { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary },

  roomRow:     { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10,
                 borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  // 64x64. No placeholder when absent — the body simply takes the width, which is what
  // keeps a photo-less room looking finished rather than broken.
  roomThumb:   { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: colors.surface },
  roomBody:    { flex: 1 },
  roomName:    { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  roomAlt:     { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 1 },
  roomPrice:   { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginTop: 4 },
  roomPriceLabel: { fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  yearNote:    { marginTop: 10, fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary },

  addressRow:  { paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  addressText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textPrimary, marginTop: 3, lineHeight: 18 },

  sourceBlock: { marginTop: 4, marginBottom: 10, padding: 14, borderRadius: radius.md,
                 backgroundColor: colors.surface },
  sourceTitle: { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  sourceBody:  { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                 lineHeight: 17, marginTop: 5 },
  sourceLinks: { marginTop: 9, gap: 2 },
  sourceLinkRow:   { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5 },
  sourceLinkLabel: { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary },

  svcRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                 gap: 12, paddingVertical: 7 },
  svcName:     { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  svcValue:    { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
  svcGroupGap: { marginTop: 14 },

  shuttleHead:    { marginBottom: 8 },
  shuttleName:    { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  shuttleProvider:{ fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 1 },
  routeCard:   { backgroundColor: colors.surface, borderRadius: radius.md, padding: 10, marginBottom: 8 },
  routeName:   { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  routeStops:  { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 1, marginBottom: 7 },
  timeWrap:    { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  timeChip:    { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 9, backgroundColor: colors.cardBg },
  timeChipText:{ fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  timeChipLabel:{ fontFamily: 'Inter_400Regular', color: colors.textSecondary },

  row:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                 paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  rowLabel:    { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  rowValue:    { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
  rowValueLink:{ color: colors.primary },
  rowRight:    { flexDirection: 'row', alignItems: 'center', gap: 6 },

  directionsBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                   marginTop: 10, paddingVertical: 11, borderRadius: radius.md, backgroundColor: colors.primary },
  directionsBtnText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },

  operator:    { marginTop: 4, marginBottom: 8, textAlign: 'center', fontSize: 12,
                 fontFamily: 'Inter_400Regular', color: colors.textSecondary },

  contactBar:  { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 10,
                 paddingHorizontal: 16, paddingTop: 12, backgroundColor: colors.cardBg,
                 borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  waBtn:       { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
                 paddingVertical: 13, borderRadius: radius.md, backgroundColor: '#25D366' },
  callBtn:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
                 paddingVertical: 13, borderRadius: radius.md, backgroundColor: colors.primary },
  barBtnText:  { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
})
