import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
  TextInput, ScrollView, Image, Dimensions, Modal, Pressable,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import KeyboardAwareForm from '../components/KeyboardAwareForm'
import { Ionicons, Feather } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import PageBackground from '../components/PageBackground'
import AccommodationListTopSlot from '../components/ads/AccommodationListTopSlot'
import AccommodationListInlineSlot from '../components/ads/AccommodationListInlineSlot'
import AccommodationListBottomSlot from '../components/ads/AccommodationListBottomSlot'
import PropertyDetailScreen from './PropertyDetailScreen'
import DormPartnerScreen from './DormPartnerScreen'
import ScreenHeader from '../components/ScreenHeader'
import PartnerLogoStrip from '../components/PartnerLogoStrip'
import { colors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'
import { REGIONS, REGION_LABEL_KEY } from '../constants/regions'
import { areaOptions, areaName } from '../constants/areas'
import { DORMS_LIVE } from '../constants/flags'
import { accomSegments, accomLanding, DORM_PARTNERS } from '../constants/dorms'
import { partnerLogo } from '../constants/partnerAssets'

const { width: SCREEN_W } = Dimensions.get('window')
const CARD_W  = SCREEN_W - 32
// 2:1, not 16:9. At 16:9 on a 390pt-wide device the image alone is ~201pt and the whole
// card ~387pt, so only 1.7 fit on screen — confirmed on device. The photo's job on a LIST
// card is to convey property type and condition, which 2:1 still does; the extra 22pt of
// height was not buying recognition. Paired with moving the price onto the image (below),
// this brings the card to ~310pt and just over 2 per screen, with the third peeking so
// the list still reads as scrollable.
const CARD_IMAGE_H = Math.round(CARD_W / 2)

// The partner logo strip on a dorm card. Same 140x40 the Ev Hizmetleri partner card uses,
// so one logo file serves both surfaces and a partner never has to supply two crops.
// PartnerLogoStrip fits INSIDE this box and left-aligns, so a square mark lands as a
// 40x40 square with the remaining width unused rather than being blown up.
const DORM_LOGO = { width: 140, height: 40 }

// ─── THE IN-CARD PAGER IS BOUNDED AT 5, AND THE BOUND IS THE POINT ──────────
//
// Listings carry a median of 8 images and a maximum of 28. Paging all of them would make
// each card's memory ceiling depend on that outlier, and the mirrored images decode to
// 3.1-4.1 MB EACH (1200x675 / 1200x900, ARGB8888) — the 83-181 KB on the wire is not the
// number that matters.
//
// A horizontal FlatList defaults to initialNumToRender: 10. Naively nested inside the
// outer list on ITS defaults (windowSize 21, ~45 cards retained), a 28-image listing
// would have put 45 x 10 x ~3.5 MB in play. That is not slow scrolling, it is an OOM on a
// mid-range Android — and it would never reproduce on a recent test device.
//
// Five is a FIXED ceiling: a listing with 28 images costs exactly what one with 6 costs.
// The alternative was tuning windowing props precisely enough to survive the outlier,
// where being wrong crashes rather than janks. Nobody pages 28 photos in a list view;
// they page two or three and either tap in or scroll on.
//
// The counter still shows the REAL total ("3 / 28") — capping what is pageable must not
// hide how many exist, because that count is what makes the tap worth making.
const CARD_PAGER_MAX = 5

// Mirrors ReviewsScreen's PAGE. One pagination idiom in this repo, not two.
const PAGE = 20

// ─── SEGMENT ROW AND LANDING TAB ─────────────────────────────────────────────
// Both come from constants/dorms.js, where the ORDER and the PROMOTED flag are config so
// the Yurtlar promotion reverts without a code change. 'all' stays last because it is the
// least coherent view.
//
// The 'all' tab cannot be coherently sorted: it interleaves intents (every £500/mo rental
// outranks every £107,500 sale on a price sort), currencies (£107k vs ₺4.75m is not a
// comparison — no FX by product decision) and rent periods (£6,000/year vs £500/month).
// Landing on a SINGLE intent makes price sort mean something. That is still true and is
// what sortOpts below is built on.
//
// LANDING MOVED FROM 'sale' TO 'dorm' (2026-09-10, by decision). The old note argued
// 'sale' against a rent-heavy counter-argument; that debate is now moot for the landing
// tab, though it still applies if Yurtlar is ever unpromoted — the fallback is 'sale', not
// 'rent'. If the Novest inventory question is ever reopened,
//   SELECT intent, count(*) FROM properties WHERE source IS NOT NULL GROUP BY intent;
// settles it with data instead of intuition.
//
// ⚠ BOTH ARE DERIVED FROM DORMS_LIVE, NEVER READ STRAIGHT OFF THE CONFIG. ACCOM_LANDING
//   is 'dorm' and the flag ships false, so a literal read would open the module on a tab
//   that is not in the chip row — an empty list under a selection the user can neither
//   see nor change. accomLanding() falls back to the first VISIBLE segment, which is
//   'sale'. Module scope is correct: both are constant for a given bundle.
const SEGMENTS       = accomSegments(DORMS_LIVE)
const LANDING_INTENT = accomLanding(DORMS_LIVE)
const PROP_TYPES = ['apartment', 'villa', 'studio', 'house', 'land', 'commercial']
const BED_OPTS   = [1, 2, 3, 4]
const PERIODS    = ['monthly', 'weekly', 'yearly', 'nightly']

// Slice 1 widened properties_currency_check to exactly these four — the currencies
// actually transacted in North Cyprus. A code with no symbol here renders raw
// ("USD450,000"), which is the bug this map exists to prevent.
const CURRENCIES = { GBP: '£', EUR: '€', USD: '$', TRY: '₺' }
const CURRENCY_CODES = ['GBP', 'EUR', 'USD', 'TRY']

// 'total' deliberately has no suffix. Every other period must have one, or a yearly
// rent renders as a bare number and reads as a sale price.
const PERIOD_SUFFIX_KEY = {
  monthly: 'accomPerMonth',
  weekly:  'accomPerWeek',
  yearly:  'accomPerYear',
  nightly: 'accomPerNight',
}

// ─── formatting ──────────────────────────────────────────────────────────────

function priceDisplay(price, currency, period, lang) {
  if (price == null) return null
  const sym = CURRENCIES[currency] || currency
  const formatted = Number(price).toLocaleString('en-GB', { maximumFractionDigits: 0 })
  const key = PERIOD_SUFFIX_KEY[period]
  return `${sym}${formatted}${key ? t(key, lang) : ''}`
}

function intentLabel(intent, lang) {
  if (intent === 'rent')       return t('accomRent', lang)
  if (intent === 'sale')       return t('accomSale', lang)
  if (intent === 'short_term') return t('accomShortTerm', lang)
  if (intent === 'all')        return t('accomAll', lang)
  if (intent === 'dorm')       return t('accomDorms', lang)
  return intent
}

function typeLabel(type, lang) {
  const map = {
    apartment:  t('accomTypeApartment', lang), villa: t('accomTypeVilla', lang),
    studio:     t('accomTypeStudio', lang),    house: t('accomTypeHouse', lang),
    land:       t('accomTypeLand', lang),      commercial: t('accomTypeCommercial', lang),
  }
  return map[type] || type
}

function periodLabel(period, lang) {
  const map = {
    monthly: t('accomPropPeriodMonthly', lang), weekly: t('accomPropPeriodWeekly', lang),
    yearly:  t('accomPropPeriodYearly', lang),  nightly: t('accomPropPeriodNightly', lang),
    total:   t('accomPropPeriodTotal', lang),
  }
  return map[period] || period
}

// Districts reuse the canonical 7-region set and its blDistrict* keys, which already
// exist in all 9 locales. Slice 1 widened properties_district_check from 5 to these 7.
const districtLabel = (d, lang) => (REGION_LABEL_KEY[d] ? t(REGION_LABEL_KEY[d], lang) : d)

// "2+1" is how rooms are quoted in TRNC: bedrooms + living rooms. Fall back to a plain
// bed count when living_rooms is unknown rather than inventing a "+0".
function roomsLabel(beds, living, lang) {
  if (beds != null && living != null) return `${beds}+${living}`
  if (beds != null) return `${beds} ${t('accomBeds', lang)}`
  return null
}

// is_primary wins; otherwise lowest sort_order. Slice 2 sets primaries — until then
// every seeded/imported row falls through to the sort_order branch, so both paths
// must work.
// The first CARD_PAGER_MAX images, primary first then by sort_order.
//
// This REPLACES the old primaryImage(), which has been deleted rather than left beside
// it: two functions choosing "the first image" by two sorts is how the card's first frame
// and its counter drift apart. pages[0] is the primary, by construction.
//
// property_images_primary_unique guarantees at most one is_primary per property, and the
// mirror's repair pass guarantees at least one wherever images exist — so the comparator
// below never has to break a tie between two primaries.
function cardImages(images) {
  if (!images || images.length === 0) return []
  return [...images]
    .sort((a, b) => (a.is_primary === b.is_primary
      ? (a.sort_order ?? 0) - (b.sort_order ?? 0)
      : (a.is_primary ? -1 : 1)))
    .slice(0, CARD_PAGER_MAX)
}

// ─── Property card ───────────────────────────────────────────────────────────
// NO agent name, photo or phone anywhere — the product decision is that no
// per-property agent is surfaced. The agency name is the only attribution shown.

function PropertyCard({ item, lang, onPress }) {
  const pages   = cardImages(item.property_images)
  const count   = item.property_images?.length ?? 0
  const [imgIdx, setImgIdx] = useState(0)
  const agency  = item.estate_agencies?.name
  const rooms   = roomsLabel(item.bedrooms, item.living_rooms, lang)
  const place   = [districtLabel(item.district, lang), item.area ? areaName(item.area, item.district) : null]
                    .filter(Boolean).join(' · ')

  return (
    // NOT a TouchableOpacity wrapping everything any more. The whole card used to be one
    // press target; with a pager inside, the press and the pan compete for the same
    // gesture and "usually cancels on movement" is not good enough — a card that opens
    // when you meant to swipe is the failure. So: the image strip owns its own taps (one
    // per page), the body is its own press target, and neither contains the other.
    <View style={cs.card}>
      <View>
        {pages.length > 0 ? (
          <FlatList
            data={pages}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            // iOS: stops a mostly-vertical drag that begins on the image from being
            // claimed by this list instead of the outer one. Android resolves by dominant
            // axis already.
            directionalLockEnabled
            keyExtractor={i => i.id}
            // Every page is exactly CARD_W, so the list never has to measure.
            getItemLayout={(_, i) => ({ length: CARD_W, offset: CARD_W * i, index: i })}
            // At most ~2 images decoded per card at any moment. With the 5-page cap above,
            // this is what keeps a 28-image listing costing the same as a 6-image one.
            initialNumToRender={1}
            maxToRenderPerBatch={1}
            windowSize={2}
            // removeClippedSubviews is deliberately NOT set here, though it IS on the
            // outer list. With at most 5 items, windowSize={2} already caps what is
            // mounted, so it would buy almost nothing — and it has a history of blanking
            // cells in a paging horizontal list, which would show as an empty photo the
            // user has to swipe past twice. Not worth it for no measurable gain.
            onMomentumScrollEnd={e => setImgIdx(Math.round(e.nativeEvent.contentOffset.x / CARD_W))}
            renderItem={({ item: im }) => (
              <TouchableOpacity activeOpacity={0.92} onPress={onPress}>
                <Image source={{ uri: im.url }} style={cs.cardImage} resizeMode="cover" />
              </TouchableOpacity>
            )}
          />
        ) : (
          <TouchableOpacity activeOpacity={0.92} onPress={onPress} style={cs.imagePlaceholder}>
            <Ionicons name="home-outline" size={44} color={colors.border} />
          </TouchableOpacity>
        )}

        {/* pointerEvents="none" ON EVERY OVERLAY. These sit on top of the pager, and an
            absolutely-positioned View with default pointerEvents swallows the pan that
            starts underneath it — the swipe would simply die wherever a badge happens to
            be. They were inert decoration before because the whole card was one press
            target; they are in the gesture path now. */}
        <View pointerEvents="none" style={[cs.intentBadge,
          item.intent === 'sale' && cs.intentBadgeSale,
          item.intent === 'short_term' && cs.intentBadgeShort]}>
          <Text style={cs.intentBadgeText}>{intentLabel(item.intent, lang)}</Text>
        </View>

        <View pointerEvents="none" style={cs.priceBadge}>
          <Text style={cs.priceBadgeText}>
            {priceDisplay(item.price, item.currency, item.price_period, lang)}
          </Text>
        </View>

        {/* The detail screen's counter idiom, not dots: the median listing has 8 images
            and the largest has 28, and 28 dots is noise. `count` is the REAL total, not
            pages.length — the pager stops at 5 but the card must still say how many exist,
            because that number is the reason to tap through. */}
        {count > 1 && (
          <View pointerEvents="none" style={cs.imgCount}>
            <Ionicons name="images-outline" size={12} color="#fff" />
            <Text style={cs.imgCountText}>{Math.min(imgIdx + 1, count)} / {count}</Text>
          </View>
        )}
      </View>

      <TouchableOpacity style={cs.cardBody} onPress={onPress} activeOpacity={0.92}>
        {/* 3, not 2 — and it costs nothing on the 86 cards that do not need it, because
            numberOfLines is a MAXIMUM and not a fixed height. Only the two titles that
            actually overflow two lines grow, by one 19pt line each.
            WHY IT WAS NEEDED: Turkish is head-final. English leads with the thing ("Corner
            shop for sale in Alayköy…"); Turkish stacks the modifiers and puts the noun
            LAST, so novest-19307 clamped to "…70 m2 Ofis Alanı v…" and dropped "Satılık
            Köşe Dükkan" — you could not tell what was for sale. A two-line clamp on a
            Turkish title keeps the adjectives and loses the noun, exactly reversed from
            English, and invisible if you only ever test in English. */}
        <Text style={cs.title} numberOfLines={3}>{item.title}</Text>

        {/* Place and agency share a row. Two separate rows cost ~23pt for content that
            reads fine side by side, and the agency is the only attribution shown. */}
        {(!!place || !!agency) && (
          <View style={cs.placeRow}>
            {!!place && <>
              <Ionicons name="location-outline" size={13} color={colors.textSecondary} />
              <Text style={cs.placeText} numberOfLines={1}>{place}</Text>
            </>}
            {!!agency && <Text style={cs.agencyName} numberOfLines={1}>{agency}</Text>}
          </View>
        )}

        {/* Every chip is `!= null`, never truthiness: floor 0 and bedrooms 0 are real
            values that a truthy check would silently drop. */}
        <View style={cs.specsRow}>
          <Text style={cs.propType}>{typeLabel(item.property_type, lang)}</Text>
          {rooms != null && <View style={cs.specChip}><Text style={cs.specText}>{rooms}</Text></View>}
          {item.bathrooms != null && (
            <View style={cs.specChip}><Text style={cs.specText}>{item.bathrooms} {t('accomBaths', lang)}</Text></View>
          )}
          {/* Built area if known; otherwise PLOT area. A land listing has area_sqm NULL
              and plot_sqm set, so without this its spec row renders empty and the one
              figure that matters for land is missing. Keyed on null-ness, not on
              property_type, so a commercial (or any) listing with only a plot figure is
              covered by the same branch. */}
          {item.area_sqm != null ? (
            <View style={cs.specChip}><Text style={cs.specText}>{item.area_sqm} m²</Text></View>
          ) : item.plot_sqm != null ? (
            <View style={cs.specChip}>
              <Text style={cs.specText}>
                {Number(item.plot_sqm).toLocaleString('en-GB')} m² {t('accomPlot', lang)}
              </Text>
            </View>
          ) : null}
          {item.furnished != null && (
            <View style={cs.specChip}>
              <Text style={cs.specText}>{item.furnished ? t('accomFurnished', lang) : t('accomUnfurnished', lang)}</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    </View>
  )
}

// ─── DORM PARTNER CARD ───────────────────────────────────────────────────────
//
// Defined at module scope like PropertyCard, not inline in the screen — a component
// declared inside its parent is a new type on every render and remounts its subtree.
//
// TAPPABLE AS OF SLICE 2, and not before: it became a TouchableOpacity in the same commit
// that gave it somewhere to go (DormPartnerScreen). A card styled as a press target that
// does nothing reads as broken rather than as unfinished.
//
// No image, no price. The "From €2490" anchor is held back until Özok says what a dönem
// is — see the priceFrom comment in constants/dorms.js.
//
// THE CARD'S HEIGHT IS ITS CONTENT, with nothing reserved. PartnerLogoStrip returns null
// when no asset is wired (it used to draw an initials monogram — see the note there for
// why that had to go), and returning null takes its margin with it. So today, with every
// Alasia asset still owed, the card is a compact two-line block rather than a full-size
// one with an empty band across the top. Nothing here sets a height, a minHeight or an
// aspect: each absent field simply costs its own rows.
function DormCard({ item, lang, onPress }) {
  const districtName = REGION_LABEL_KEY[item.district] ? t(REGION_LABEL_KEY[item.district], lang) : item.district
  // Area is a proper noun and untranslated (constants/areas.js states the rule); the
  // district is translated. Either half may be absent without leaving a stray separator.
  const place = [item.area, districtName].filter(Boolean).join(' · ')

  return (
    <TouchableOpacity style={[cs.card, cs.dormCard]} onPress={onPress} activeOpacity={0.9}>
      {/* partnerLogo(), never partnerAsset(item.logo) directly. The variant seam is the one
          place the light/dark choice lives, and partnerAssets.js says why: the day a dark
          surface appears is not the day anyone will remember that a partner's mark is pure
          black. This card sits on colors.cardBg so it resolves to 'light' today — the point
          is that a second call site does not bypass the seam. */}
      <PartnerLogoStrip
        source={partnerLogo(item)}
        name={item.name}
        width={DORM_LOGO.width}
        height={DORM_LOGO.height}
        style={{ marginBottom: 10 }}
      />
      <Text style={cs.dormName} numberOfLines={2}>{item.name}</Text>
      {!!place && (
        <View style={cs.dormMetaRow}>
          <Ionicons name="location-outline" size={14} color={colors.textSecondary} />
          <Text style={cs.dormMetaText} numberOfLines={1}>{place}</Text>
        </View>
      )}
    </TouchableOpacity>
  )
}

function FilterPill({ label, active, disabled, onPress }) {
  return (
    <TouchableOpacity
      style={[cs.pill, active && cs.pillActive, disabled && cs.pillDisabled]}
      onPress={onPress} disabled={disabled} activeOpacity={0.75}
    >
      <Text style={[cs.pillText, active && cs.pillTextActive, disabled && cs.pillTextDisabled]}>
        {label}
      </Text>
    </TouchableOpacity>
  )
}

// ─── Main screen ─────────────────────────────────────────────────────────────

// ─── WHY THE DETAIL IS AN OVERLAY, AND WHY ITS STATE LIVES IN App.js ─────────
//
// The detail used to render INSTEAD of this screen, from its own `else if` branch in
// App.js's content chain. That unmounts the list: scroll position, page number, loaded
// items and every filter were destroyed on open and rebuilt from page 0 on close.
// Rendering it as an overlay INSIDE this screen keeps the FlatList mounted, so all of
// that survives the round trip for free.
//
// The state (`selectedProperty`) deliberately stays in App.js rather than moving in here,
// and that is the part that protects Android back. A child-registered BackHandler looks
// like the obvious move but is racy: RN invokes handlers in REVERSE registration order,
// React runs child effects BEFORE parent effects, and App.js re-registers its handler
// whenever any of its ~35 dependencies change. So a parent re-render while the overlay is
// open silently promotes App's handler above this screen's, and back closes the whole
// module instead of the overlay — which is exactly the EventsScreen defect, reached by a
// different route.
//
// Keeping the state where the back handler already lives removes the race entirely.
// App.js:490 already reads `if (openedProperty) { setOpenedProperty(null); return true }`
// BEFORE its showAccommodation line, so the correct two-step back — detail, then module —
// is preserved by construction rather than by winning a registration race.
export default function AccommodationScreen({
  onAdNavigate, lang, onClose,
  onOpenProperty, selectedProperty, onCloseProperty,
  onOpenDorm, selectedDorm, onCloseDorm,
}) {
  const [items, setItems]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [page, setPage]             = useState(0)
  const [done, setDone]             = useState(false)
  const [total, setTotal]           = useState(0)

  const [intent, setIntent]     = useState(LANDING_INTENT)
  const [district, setDistrict] = useState(null)
  const [area, setArea]         = useState(null)
  const [propType, setPropType] = useState(null)
  const [beds, setBeds]         = useState(null)
  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('')
  const [currency, setCurrency] = useState(null)
  const [plotMin, setPlotMin]   = useState('')       // sale only
  const [furnished, setFurnished] = useState(null)   // rent only
  const [period, setPeriod]     = useState(null)     // rent only

  const [sheet, setSheet] = useState(null)           // which picker is open
  const [pendingArea, setPendingArea] = useState(false)  // came via the area pill

  const isSale = intent === 'sale'
  const isRent = intent === 'rent' || intent === 'short_term'
  // The dorm segment is not a properties view at all: no query, no filters, no sort, no
  // pagination. Everything below branches on this rather than on intent === 'dorm', so
  // there is one name to search for when the second partner type arrives.
  const isDorm = intent === 'dorm'

  // 'all' mixes intents, currencies and rent periods, so a price sort there is
  // meaningless. Offer it only on a single-intent tab.
  const sortOpts = intent === 'all' ? ['updated'] : ['price_asc', 'price_desc', 'updated']
  const [sort, setSort] = useState('price_asc')
  const effectiveSort = sortOpts.includes(sort) ? sort : 'updated'

  const buildQuery = useCallback(() => {
    // THE C2 FIX. The agency is embedded DIRECTLY via properties.agency_id. It used to
    // hang off estate_agents(...), and a partner listing has agent_id NULL — so that
    // embed returned null and the agency name, the one attribution the product requires,
    // never rendered on a single feed row.
    let q = supabase
      .from('properties')
      .select(
        // contact_name / contact_phone / contact_whatsapp ARE NOT OPTIONAL HERE.
        // PropertyDetailScreen takes `property` as a prop and never re-queries, so this
        // embed is the ONLY source of the contact bar's data. They were missing for the
        // whole of Slice 3 and nobody noticed, because the columns were NULL the entire
        // time — the empty state was built, shipped and verified on device, and the
        // populated state had never once run. See the note in the slice-2 log.
        // agencies_select_public already exposes these to anon for an active agency;
        // Slice 1 signed that widening off knowingly. Three short strings per page.
        '*, estate_agencies(id, name, logo_url, contact_name, contact_phone, contact_whatsapp), property_images(id, url, sort_order, is_primary)',
        { count: 'exact' },
      )
      .eq('status', 'active')

    if (intent !== 'all') q = q.eq('intent', intent)
    if (district)         q = q.eq('district', district)
    if (area)             q = q.eq('area', area)
    if (propType)         q = q.eq('property_type', propType)
    if (beds != null)     q = beds >= 4 ? q.gte('bedrooms', 4) : q.eq('bedrooms', beds)
    if (currency)         q = q.eq('currency', currency)
    if (priceMin !== '')  q = q.gte('price', Number(priceMin))
    if (priceMax !== '')  q = q.lte('price', Number(priceMax))
    if (isSale && plotMin !== '') q = q.gte('plot_sqm', Number(plotMin))
    if (isRent && furnished != null) q = q.eq('furnished', furnished)
    if (isRent && period)            q = q.eq('price_period', period)

    // id is the tiebreaker on every sort: without it, rows sharing a price can shuffle
    // between pages and pagination duplicates or drops them.
    if (effectiveSort === 'price_asc')  q = q.order('price', { ascending: true }).order('id', { ascending: true })
    if (effectiveSort === 'price_desc') q = q.order('price', { ascending: false }).order('id', { ascending: true })
    if (effectiveSort === 'updated')    q = q.order('updated_at', { ascending: false, nullsFirst: false }).order('id', { ascending: true })
    return q
  }, [intent, district, area, propType, beds, currency, priceMin, priceMax,
      plotMin, furnished, period, effectiveSort, isSale, isRent])

  const load = useCallback(async (pageNum = 0) => {
    // ─── THE DORM SEGMENT NEVER TOUCHES SUPABASE ──────────────────────────────
    // Partners are config, so there is no fetch, no error path and no second page. This
    // returning BEFORE buildQuery() is also what guarantees a pseudo-intent can never
    // reach .eq('intent', 'dorm') against a CHECK constraint that has never heard of it —
    // the guarantee is structural rather than a filter somebody has to remember.
    // `done` is set so onEndReached cannot start a page that does not exist.
    if (isDorm) {
      setItems(DORM_PARTNERS)
      setTotal(DORM_PARTNERS.length)
      setDone(true)
      setLoading(false)
      setLoadingMore(false)
      return
    }
    if (pageNum === 0) setLoading(true); else setLoadingMore(true)
    const from = pageNum * PAGE
    const { data, count, error } = await buildQuery().range(from, from + PAGE - 1)
    if (!error && data) {
      setItems(prev => (pageNum === 0 ? data : [...prev, ...data]))
      setTotal(count ?? 0)
      if (data.length < PAGE) setDone(true)
    }
    if (pageNum === 0) setLoading(false); else setLoadingMore(false)
  }, [buildQuery, isDorm])

  // Any filter or sort change resets to page 0 and fetches ONE page — not the whole
  // table, which is what this screen used to do on every keystroke.
  useEffect(() => { setPage(0); setDone(false); load(0) }, [load])

  function loadMore() {
    if (loadingMore || done || loading) return
    const next = page + 1
    setPage(next)
    load(next)
  }

  // Leaving an intent clears the filters that no longer apply, so a stale rent filter
  // cannot silently narrow a sale list.
  function changeIntent(next) {
    setIntent(next)
    // Yurtlar applies no filter and no sort, so ENTERING it must disturb neither —
    // otherwise a plot or price filter set before the detour is silently thrown away and
    // the user comes back to a list they did not ask for. Leaving it falls through to the
    // destination intent's own rules below, which are unchanged.
    if (next === 'dorm') return
    if (next !== 'sale') setPlotMin('')
    if (next === 'sale' || next === 'all') { setFurnished(null); setPeriod(null) }
    if (next === 'all' && sort !== 'updated') setSort('updated')
    if (next !== 'all' && sort === 'updated') setSort('price_asc')
  }

  function clearAll() {
    setDistrict(null); setArea(null); setPropType(null); setBeds(null)
    setPriceMin(''); setPriceMax(''); setCurrency(null)
    setPlotMin(''); setFurnished(null); setPeriod(null)
    setSort(intent === 'all' ? 'updated' : 'price_asc')
  }

  // `furnished` can legitimately be false, so this counts on presence, not truthiness —
  // the same trap as floor 0 on the card.
  const activeCount = [
    district, area, propType, beds, currency,
    (priceMin || priceMax) || null, plotMin || null, furnished, period,
  ].filter(v => v !== null && v !== undefined && v !== '').length

  // areaOptions() sorts with the 'tr' collator — see constants/areas.js.
  const areaChoices = useMemo(() => (district ? areaOptions(district) : []), [district])

  function sortLabel(s) {
    if (s === 'price_asc')  return t('accomSortPriceLow', lang)
    if (s === 'price_desc') return t('accomSortPriceHigh', lang)
    return t('accomSortUpdated', lang)
  }

  return (
    <SafeAreaView style={cs.safe} edges={['top']}>
      <PageBackground topic="accommodation" />
      <ScreenHeader onBack={onClose} title={t('accomTitle', lang)} lang={lang} />

      {/* ─── A WRAPPING ROW, NOT A HORIZONTAL SCROLL ────────────────────────
          Five chips do not fit on one line in ANY of the nine locales at 393dp, and four
          did not fit in ar/ru/el/fr before Yurtlar existed — so the row has been
          scrolling unannounced since the module shipped. Scrolling was never the problem;
          DISCOVERY was: measured, the last chip is 0% visible in seven of nine locales,
          because the viewport edge lands in the GAP between chips rather than across one.
          A horizontal ScrollView's only free affordance is a partially-cut item, and there
          is not one.
          Wrapping shows every chip in every locale instead of signalling that something is
          hidden. See the plan note for the measurements and for why the other two options
          were rejected.

          flexShrink:0 — a fixed-height row above a scrolling list gets vertically
          compressed once the list overflows, cropping its text top and bottom. It matters
          MORE now than it did as one line: there is twice as much height to squeeze. */}
      <View style={cs.intentBar}>
        {SEGMENTS.map(seg => (
          <TouchableOpacity key={seg.id} style={[cs.intentTab, intent === seg.id && cs.intentTabActive]}
            onPress={() => changeIntent(seg.id)}>
            <Text style={[cs.intentTabText, intent === seg.id && cs.intentTabTextActive]}>
              {intentLabel(seg.id, lang)}
            </Text>
            {/* The promoted marker. ABSOLUTELY POSITIONED, and that is the whole
                requirement: laid out inline it would add its own width and gap to the
                chip and break "same shape and size as the other chips".
                ─────────────────────────────────────────────────────────────────────
                SHOWN IN BOTH STATES. It was previously gated on `intent !== seg.id`, on
                the theory that the nudge has done its job once you are on the tab. That
                was wrong the moment the landing moved to Yurtlar: the chip is SELECTED on
                first paint, so the dot never rendered at all — which is why the device
                check found no dot rather than a dim one. Absent, not invisible.
                ─────────────────────────────────────────────────────────────────────
                THE COLOUR IS STATE-AWARE BECAUSE NO SINGLE COLOUR WORKS. Measured against
                both chip backgrounds (#FFFFFF unselected, colors.primary #0E7C7B
                selected), nothing in the palette clears 3:1 on both — colors.accent is
                2.41 and 2.08, which is the "unreadable at icon size" problem theme.js
                already records for accent at this size. So: tintLifestyleFg (the repo's
                own deepened accent) at 5.18:1 on white, and plain white at 5.01:1 on
                teal. */}
            {seg.promoted && (
              <View pointerEvents="none"
                style={[cs.intentDot, intent === seg.id && cs.intentDotOnActive]} />
            )}
          </TouchableOpacity>
        ))}
      </View>

      {/* HIDDEN ENTIRELY ON YURTLAR, not disabled. Every pill here filters or sorts a
          `properties` query the dorm segment does not run — district, bedrooms, m², price
          period. A greyed-out bar reads as broken (the same reasoning the area pill's own
          comment gives for never being disabled), and sorting one partner is not a
          feature. */}
      {!isDorm && (
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={cs.pillBar} contentContainerStyle={cs.pillBarContent}>
        <FilterPill label={district ? districtLabel(district, lang) : t('accomFilterDistrict', lang)}
          active={!!district} onPress={() => setSheet('district')} />
        {/* Area depends on district — but a greyed-out pill that does nothing when tapped
            reads as BROKEN, not as waiting. So it is always live: with no district chosen
            it opens the district picker and then advances straight to areas, turning a
            dead control into a two-step flow. */}
        <FilterPill label={area ? areaName(area, district) : t('accomFilterArea', lang)}
          active={!!area}
          onPress={() => { if (district) { setSheet('area') } else { setPendingArea(true); setSheet('district') } }} />
        <FilterPill label={propType ? typeLabel(propType, lang) : t('accomFilterType', lang)}
          active={!!propType} onPress={() => setSheet('type')} />
        <FilterPill label={beds != null ? (beds >= 4 ? '4+' : String(beds)) : t('accomFilterBeds', lang)}
          active={beds != null} onPress={() => setSheet('beds')} />
        <FilterPill
          label={(priceMin || priceMax || currency)
            ? `${currency || ''}${priceMin ? ` >${priceMin}` : ''}${priceMax ? ` <${priceMax}` : ''}`.trim()
            : t('accomFilterPrice', lang)}
          active={!!(priceMin || priceMax || currency)} onPress={() => setSheet('price')} />

        {/* Listing-type-aware: a control that cannot apply is not rendered at all. */}
        {isSale && (
          <FilterPill label={plotMin ? `${t('accomFilterPlotMin', lang)} ${plotMin}` : t('accomFilterPlotMin', lang)}
            active={!!plotMin} onPress={() => setSheet('plot')} />
        )}
        {isRent && (
          <FilterPill
            label={furnished == null ? t('accomFilterFurnished', lang)
              : (furnished ? t('accomFurnished', lang) : t('accomUnfurnished', lang))}
            active={furnished != null} onPress={() => setSheet('furnished')} />
        )}
        {isRent && (
          <FilterPill label={period ? periodLabel(period, lang) : t('accomFilterPeriod', lang)}
            active={!!period} onPress={() => setSheet('period')} />
        )}

        <FilterPill label={sortLabel(effectiveSort)} active onPress={() => setSheet('sort')} />

        {activeCount > 0 && (
          <TouchableOpacity style={cs.clearPill} onPress={clearAll}>
            <Feather name="x" size={14} color={colors.danger} />
            <Text style={cs.clearPillText}>{t('accomClear', lang)}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
      )}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} size="large" color={colors.primary} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={i => i.id}
          contentContainerStyle={cs.listContent}
          ListHeaderComponent={
            // list_top — a HEADER, so it scrolls away. Mounting it above the FlatList
            // would make it sticky, and a permanently visible ad is a different product.
            // GATED ON A NON-EMPTY LIST: an ad above "no results" is worse than no ad,
            // and this list's filters intersect to zero routinely.
            items.length > 0
              ? <AccommodationListTopSlot lang={lang} onNavigate={onAdNavigate} />
              : null
          }
          showsVerticalScrollIndicator={false}
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          // ─── WINDOWING, SET EXPLICITLY ──────────────────────────────────────
          // This list ran on defaults: windowSize 21, initialNumToRender 10, no
          // removeClippedSubviews. At ~2.1 cards per screen that retains roughly 45
          // cards — loose already at one image each, and untenable once each card can
          // hold a pager.
          //
          // windowSize 5 -> ~11 cards retained. With the inner pager capped at 5 pages
          // and windowed to ~2 decoded, that is ~22 images in play against ~45 before.
          // The pager makes the list cheaper than it was, not dearer, which is the only
          // reason it is safe to add one.
          //
          // No getItemLayout: card height varies (282-320pt, and now a little more where
          // a Turkish title takes a third line), so any fixed estimate would be wrong and
          // wrong scroll offsets are worse than unmeasured ones.
          windowSize={5}
          initialNumToRender={4}
          maxToRenderPerBatch={4}
          removeClippedSubviews
          ListEmptyComponent={
            // NOTHING ON YURTLAR, by instruction: no empty-state text and no placeholder
            // rows. The property empty state is "no results, try widening your filters",
            // which is the wrong sentence entirely for a curated partner list — there are
            // no filters to widen, and the honest reading of an empty one is that ADA has
            // not signed a dorm yet. It is also unreachable today (DORM_PARTNERS holds
            // one entry and the list is not a query), so this is what the list does at
            // N=0, not something a user can currently see.
            isDorm ? null : (
              <View style={cs.emptyWrap}>
                <View style={cs.emptyCard}>
                  <Ionicons name="home-outline" size={44} color={colors.border} style={{ marginBottom: 10 }} />
                  <Text style={cs.emptyTitle}>{t('accomNoResults', lang)}</Text>
                  <Text style={cs.emptySub}>{t('accomNoResultsSub', lang)}</Text>
                </View>
              </View>
            )
          }
          ListFooterComponent={
            loadingMore
              ? <ActivityIndicator style={{ marginVertical: 20 }} color={colors.primary} />
              : items.length > 0
                ? <>
                    {/* list_bottom. LOW-VALUE INVENTORY BY CONSTRUCTION: this list
                        paginates, so the footer is only reached after every page has
                        loaded. Shipped, but do not price it like list_top. */}
                    <AccommodationListBottomSlot lang={lang} onNavigate={onAdNavigate} />
                    <View style={{ height: 24 }} />
                  </>
                : <View style={{ height: 24 }} />
          }
          renderItem={({ item, index }) => (
            // list_inline — ONCE, after the 8th card, never repeated however far the user
            // paginates. `index === 7` is a point, not a modulus: an every-Nth rule would
            // turn a directory into an ad feed. Below 8 results it never renders, which is
            // correct on a heavily filtered list.
            <>
              {/* Only the CARD branches. The inline slot's rule is shared deliberately,
                  so "banners render on partner showcases exactly as anywhere else in the
                  module" stays true by construction rather than by being re-implemented.
                  At today's N=1 it never fires; it starts working at the ninth partner
                  without anyone remembering to wire it. */}
              {isDorm
                ? <DormCard item={item} lang={lang} onPress={() => onOpenDorm(item)} />
                : <PropertyCard item={item} lang={lang} onPress={() => onOpenProperty(item)} />}
              {index === 7 && <AccommodationListInlineSlot lang={lang} onNavigate={onAdNavigate} />}
            </>
          )}
        />
      )}

      <PickerSheet visible={sheet === 'district'} title={t('accomFilterDistrict', lang)}
        options={REGIONS} selected={district} labelFn={d => districtLabel(d, lang)}
        onSelect={v => {
          const n = v === district ? null : v
          setDistrict(n); setArea(null)
          // Chained from the area pill: hand straight over to areas rather than closing
          // and making them tap again.
          const chain = pendingArea && n
          setPendingArea(false)
          setSheet(chain ? 'area' : null)
        }}
        onClose={() => { setPendingArea(false); setSheet(null) }} />

      <PickerSheet visible={sheet === 'area'} title={t('accomFilterArea', lang)}
        options={areaChoices.map(a => a.value)} selected={area}
        labelFn={s => areaName(s, district)}
        onSelect={v => { setArea(v === area ? null : v); setSheet(null) }}
        onClose={() => setSheet(null)} />

      <PickerSheet visible={sheet === 'type'} title={t('accomFilterType', lang)}
        options={PROP_TYPES} selected={propType} labelFn={tp => typeLabel(tp, lang)}
        onSelect={v => { setPropType(v === propType ? null : v); setSheet(null) }}
        onClose={() => setSheet(null)} />

      <PickerSheet visible={sheet === 'beds'} title={t('accomFilterBeds', lang)}
        options={BED_OPTS} selected={beds} labelFn={n => (n >= 4 ? '4+' : String(n))}
        onSelect={v => { setBeds(v === beds ? null : v); setSheet(null) }}
        onClose={() => setSheet(null)} />

      <PickerSheet visible={sheet === 'period'} title={t('accomFilterPeriod', lang)}
        options={PERIODS} selected={period} labelFn={p => periodLabel(p, lang)}
        onSelect={v => { setPeriod(v === period ? null : v); setSheet(null) }}
        onClose={() => setSheet(null)} />

      <PickerSheet visible={sheet === 'furnished'} title={t('accomFilterFurnished', lang)}
        options={[true, false]} selected={furnished}
        labelFn={b => (b ? t('accomFurnished', lang) : t('accomUnfurnished', lang))}
        onSelect={v => { setFurnished(v === furnished ? null : v); setSheet(null) }}
        onClose={() => setSheet(null)} />

      <PickerSheet visible={sheet === 'sort'} title={t('accomFilterSort', lang)}
        options={sortOpts} selected={effectiveSort} labelFn={sortLabel}
        onSelect={v => { setSort(v); setSheet(null) }}
        onClose={() => setSheet(null)} />

      {/* Price range + currency. Currency matters here beyond filtering: a price sort
          across currencies is not a comparison, so narrowing to one makes it real. */}
      <Modal visible={sheet === 'price'} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
        <KeyboardAwareForm>
        <Pressable style={cs.overlay} onPress={() => setSheet(null)}>
          <Pressable style={cs.sheet}>
            <Text style={cs.sheetTitle}>{t('accomFilterPriceRange', lang)}</Text>
            <View style={cs.currencyChips}>
              {CURRENCY_CODES.map(c => (
                <TouchableOpacity key={c}
                  style={[cs.currencyChip, currency === c && cs.currencyChipActive]}
                  onPress={() => setCurrency(currency === c ? null : c)}>
                  <Text style={[cs.currencyChipText, currency === c && cs.currencyChipTextActive]}>
                    {CURRENCIES[c]} {c}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={cs.priceRow}>
              <TextInput style={[cs.input, { flex: 1 }]} placeholder={t('accomMin', lang)}
                placeholderTextColor={colors.textSecondary} keyboardType="numeric"
                value={priceMin} onChangeText={setPriceMin} />
              <Text style={cs.priceDash}>–</Text>
              <TextInput style={[cs.input, { flex: 1 }]} placeholder={t('accomMax', lang)}
                placeholderTextColor={colors.textSecondary} keyboardType="numeric"
                value={priceMax} onChangeText={setPriceMax} />
            </View>
            <TouchableOpacity style={cs.applyBtn} onPress={() => setSheet(null)}>
              <Text style={cs.applyBtnText}>{t('accomApply', lang)}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
        </KeyboardAwareForm>
      </Modal>

      {/* Above everything, and the list beneath it is never unmounted. Both overlays take
          their open state from App.js rather than from local state, so Android hardware
          back closes the OVERLAY and not the whole module — App.js's back chain checks
          openedDorm/openedProperty before showAccommodation, which makes the two-step back
          correct by construction rather than by winning a registration race. */}
      {selectedDorm && (
        <View style={cs.detailOverlay}>
          <DormPartnerScreen partner={selectedDorm} lang={lang} region={null} onBack={onCloseDorm} />
        </View>
      )}

      {selectedProperty && (
        <View style={cs.detailOverlay}>
          <PropertyDetailScreen property={selectedProperty} lang={lang} onBack={onCloseProperty} onAdNavigate={onAdNavigate} />
        </View>
      )}

      <Modal visible={sheet === 'plot'} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
        <KeyboardAwareForm>
        <Pressable style={cs.overlay} onPress={() => setSheet(null)}>
          <Pressable style={cs.sheet}>
            <Text style={cs.sheetTitle}>{t('accomFilterPlotMin', lang)}</Text>
            <TextInput style={cs.input} placeholder={t('accomMin', lang)}
              placeholderTextColor={colors.textSecondary} keyboardType="numeric"
              value={plotMin} onChangeText={setPlotMin} />
            <TouchableOpacity style={[cs.applyBtn, { marginTop: 16 }]} onPress={() => setSheet(null)}>
              <Text style={cs.applyBtnText}>{t('accomApply', lang)}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
        </KeyboardAwareForm>
      </Modal>
    </SafeAreaView>
  )
}

function PickerSheet({ visible, title, options, selected, labelFn, onSelect, onClose }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={cs.overlay} onPress={onClose}>
        <Pressable style={cs.sheet}>
          <Text style={cs.sheetTitle}>{title}</Text>
          <ScrollView style={{ maxHeight: 380 }}>
            {options.map(opt => (
              <TouchableOpacity key={String(opt)} style={cs.sheetOption} onPress={() => onSelect(opt)}>
                <Text style={[cs.sheetOptionText, selected === opt && cs.sheetOptionTextActive]}>
                  {labelFn(opt)}
                </Text>
                {selected === opt && <Ionicons name="checkmark" size={18} color={colors.primary} />}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const cs = StyleSheet.create({
  safe:                { flex: 1, backgroundColor: colors.bg },
  detailOverlay:       { ...StyleSheet.absoluteFillObject, backgroundColor: colors.bg, zIndex: 20 },

  // ONE style now, not a style + contentContainerStyle pair: this is a plain wrapping View
  // rather than a ScrollView, so there is no inner content container to configure.
  // `gap` supplies BOTH the column gap between chips and the row gap between wrapped
  // lines, which is why one wrapped line costs 32.9pt (chip) + 8pt (gap) = 40.9pt.
  // flexShrink:0 is load-bearing and more so than before — see the comment at the markup.
  intentBar:           { flexDirection: 'row', flexWrap: 'wrap', flexGrow: 0, flexShrink: 0,
                         paddingHorizontal: 16, gap: 8, paddingBottom: 10 },
  intentTab:           { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.cardBg },
  intentTabActive:     { backgroundColor: colors.primary },
  intentTabText:       { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  intentTabTextActive: { fontFamily: 'Inter_700Bold', color: '#fff' },
  // The promoted marker. `position: 'absolute'` is the requirement, not the styling
  // choice: it takes the dot out of the chip's layout so the chip measures exactly as it
  // did before, which is what "same shape and size as the other chips" means. RN views
  // are position:'relative' by default, so this anchors to the chip with no other change.
  // 7px, not 6: at 6 the dot reads as a rendering artefact rather than a mark. Still well
  // inside the chip's 8pt horizontal / 8pt vertical padding, so it cannot touch the label.
  intentDot:           { position: 'absolute', top: 6, right: 7, width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.tintLifestyleFg },
  intentDotOnActive:   { backgroundColor: '#FFFFFF' },

  pillBar:             { flexGrow: 0, flexShrink: 0 },
  pillBarContent:      { paddingHorizontal: 16, gap: 8, paddingBottom: 12 },
  pill:                { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  pillActive:          { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  pillDisabled:        { opacity: 0.4 },
  pillText:            { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  pillTextActive:      { fontFamily: 'Inter_700Bold', color: colors.primary },
  pillTextDisabled:    { color: colors.textSecondary },
  clearPill:           { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: colors.dangerLight, backgroundColor: colors.dangerLight },
  clearPillText:       { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.danger },

  listContent:         { paddingHorizontal: 16, paddingBottom: 24 },

  card:                { backgroundColor: colors.cardBg, borderRadius: 20, marginBottom: 16, overflow: 'hidden', ...shadow },
  // A dorm card carries no edge-to-edge image, so unlike a property card it needs its own
  // padding — `card` has none because its image is meant to bleed to the corners.
  dormCard:            { padding: 16 },
  dormName:            { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary, lineHeight: 22 },
  dormMetaRow:         { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  // flex:1 so a long Turkish area/district pair truncates inside the row instead of
  // pushing the icon off the card.
  dormMetaText:        { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  cardImage:           { width: CARD_W, height: CARD_IMAGE_H },
  imagePlaceholder:    { width: CARD_W, height: CARD_IMAGE_H, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },

  intentBadge:         { position: 'absolute', top: 12, left: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: colors.primary },
  intentBadgeSale:     { backgroundColor: colors.success },
  intentBadgeShort:    { backgroundColor: colors.accent },
  intentBadgeText:     { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#fff', textTransform: 'uppercase', letterSpacing: 0.5 },

  imgCount:            { position: 'absolute', bottom: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.6)' },
  imgCountText:        { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#fff' },

  cardBody:            { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 12, gap: 5 },
  title:               { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary, lineHeight: 19 },
  placeRow:            { flexDirection: 'row', alignItems: 'center', gap: 4 },
  placeText:           { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  priceBadge:          { position: 'absolute', bottom: 10, left: 12, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.68)' },
  priceBadgeText:      { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },

  specsRow:            { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  propType:            { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.3 },
  specChip:            { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: colors.surface },
  specText:            { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary },

  agencyName:          { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.primary, maxWidth: '45%' },

  emptyWrap:           { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyCard:           { backgroundColor: colors.cardBg, borderRadius: 16, paddingHorizontal: 24, paddingVertical: 20, alignItems: 'center', ...shadow },
  emptyTitle:          { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 4 },
  emptySub:            { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center' },

  overlay:             { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet:               { backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40 },
  sheetTitle:          { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 14 },
  sheetOption:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  sheetOptionText:     { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  sheetOptionTextActive: { fontFamily: 'Inter_700Bold', color: colors.primary },

  currencyChips:       { flexDirection: 'row', gap: 8, marginBottom: 16 },
  currencyChip:        { flex: 1, paddingVertical: 11, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center' },
  currencyChipActive:  { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  currencyChipText:    { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
  currencyChipTextActive: { color: colors.primary },
  priceRow:            { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  priceDash:           { fontSize: 18, color: colors.textSecondary },
  input:               { borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, padding: 12, fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textPrimary, backgroundColor: colors.surface },
  applyBtn:            { backgroundColor: colors.primary, borderRadius: 14, padding: 14, alignItems: 'center' },
  applyBtnText:        { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
})
