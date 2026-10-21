import { Fragment, useState, useEffect, useRef, useMemo, useCallback, memo } from 'react'
import { StatusBar } from 'expo-status-bar'
import { View, Text, ScrollView, Animated, Linking, Modal, Pressable, AppState, StyleSheet, useWindowDimensions } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { t } from '../constants/i18n'
import { REGION_LABEL_KEY } from '../constants/regions'
import {
  EATERY_CATEGORY_KEY, eateryContacts, eateryMenuUrl, eateryMenuSections, eateryPhotos, eateryWeek,
  eateryOpenStatus, formatPrice, eateryOrderable, eateryOrderDigits, buildOrderMessage, orderWhatsAppUrl, orderTotal,
} from '../constants/eatery'
import { colors, font, type, radii, space, motion, listBottomPad, withAlpha, press } from '../constants/theme'
import { ScreenHeader, Card, Button, RemoteImage } from '../components/ui'
import { EateryLogo, PlaceholderTag, PlaceholderFrame, PhotoPager, eateryImageUrl, useReduceMotion } from '../components/EateryBits'
import { logContactEvent } from '../utils/logContactEvent'
import { effectiveWhatsapp, useBasket, changeQty, clearAll, undo, dropSnapshot } from '../utils/eateryBasket'
import { QtyStepper, OrderBar, BasketPage } from '../components/EateryOrder'
import { haptic } from '../components/ui'
import Snackbar from '../components/Snackbar'

// ─── Yeme-İçme: one partner, in full ────────────────────────────────────────
// Contact buttons are stacked full width: Button truncates its label to one line, and a two-column
// grid leaves "Web sitesi" / "Wegbeschreibung" ~68pt at 320dp.
// Everything comes from the row (constants/eatery.js decides what is empty): a section with
// nothing behind it is absent, never degraded. Fixture partners (partner.placeholder) are labelled
// and NEVER log a contact tap or take an order. Order via WhatsApp: a dish with a price gets a quantity control, the
// basket (in memory, utils/eateryBasket.js) becomes ONE Turkish wa.me message; ADA takes no payment and keeps nothing.

const CONTACT_UI = {
  call:     { icon: 'call-outline',      labelKey: 'petHotelCall',       variant: 'primary' },
  whatsapp: { icon: 'logo-whatsapp',     labelKey: 'petHotelWhatsApp',   variant: 'secondary' },
  website:  { icon: 'globe-outline',     labelKey: 'petHotelWebsite',    variant: 'secondary' },
  maps:     { icon: 'navigate-outline',  labelKey: 'petHotelDirections', variant: 'secondary' },
}

function HoursBlock({ week, open, lang }) {
  return (
    <View>
      {!!open && (
        <View style={[s.chip, s['chip_' + open.tone]]}>
          <Text style={[s.chipText, s['chipText_' + open.tone]]}>{open.text}</Text>
        </View>
      )}
      {week.map(d => (
        <View key={d.day} style={s.hourRow}>
          <Text style={s.hourDay}>{t(d.labelKey, lang)}</Text>
          <Text style={s.hourVal}>{d.text || t('towingClosed', lang)}</Text>
        </View>
      ))}
    </View>
  )
}

// The quiz hand-off cue: a primaryLight wash that fades in, holds, fades out (1.2 s in all). Reduced motion keeps the cue
// but drops the fade: a static wash for the same 1.2 s. Mounted only while marked, behind the row.
const MARK_MS = 1200
function FocusMark({ reduce }) {
  const op = useRef(new Animated.Value(reduce ? 1 : 0)).current
  useEffect(() => {
    if (reduce) return
    const a = Animated.sequence([
      Animated.timing(op, { toValue: 1, duration: motion.fast, useNativeDriver: true }),
      Animated.delay(MARK_MS - motion.fast - motion.base),
      Animated.timing(op, { toValue: 0, duration: motion.base, useNativeDriver: true }),
    ])
    a.start()
    return () => a.stop()
  }, [])
  return <Animated.View pointerEvents="none" style={[s.focusMark, { opacity: op }]} />
}

const SNACK_ABOVE_BAR = 150   // clears the pinned order bar / Sepetim footer (stacked bar at font scale 1.3 is the tallest)
const THUMB = 64
const SHOW_SECTION_COUNT = false  // "Nachos · 3": muted dish count beside a section title
const TAB_SCROLL_OFFSET = 8       // a section is "current" once its top is within this of the pinned tab row

// A dish photo is partner content: shown as sent (contain), never cropped. A file that fails to load
// calls onFail and the row drops back to text-only. A Preview fixture dish draws the labelled frame.
function DishThumb({ item, name, lang, reduce, onOpen, onFail }) {
  const uri = eateryImageUrl(item.photoPath)
  const [loaded, setLoaded] = useState(false)
  const ready = !uri || loaded   // opens only once the image is on screen: the viewer never starts on an unloaded file
  return (
    <Pressable style={({ pressed }) => [s.thumb, pressed && { opacity: press.small }]} onPress={ready ? onOpen : undefined}
      accessibilityRole="button" accessibilityState={{ disabled: !ready }}
      accessibilityLabel={t('eateryDishPhotoOpen', lang).replace('{name}', () => name)}>
      {uri
        ? <RemoteImage source={{ uri }} resizeMode="contain" style={s.fill} placeholderColor={colors.card}
            onLoad={() => setLoaded(true)} onError={onFail} transition={reduce ? 0 : 200} accessibilityIgnoresInvertColors />
        : <PlaceholderFrame lang={lang} compact style={s.fill} />}
    </Pressable>
  )
}

// Name and price keep their places in every row (name left, price on the right edge); a row with a
// photo only gains a leading thumbnail, a row without one is exactly the text-only row.
const MenuItemRow = memo(function MenuItemRow({ item, lang, reduce, failed, onFail, onOpenPhoto, ordering, qty, onQty }) {
  const price = formatPrice(item.price, item.currency, lang)
  const hasPhoto = !failed && (!!item.photoPath || item.photoPlaceholder)
  const row = (
    <View style={s.itemRow}>
      {hasPhoto && <DishThumb item={item} name={item.name} lang={lang} reduce={reduce} onOpen={() => onOpenPhoto(item)} onFail={() => onFail(item.id)} />}
      <View style={s.itemText}>
        <Text style={s.itemName}>{item.name}</Text>
        {!!item.description && <Text style={s.itemDesc}>{item.description}</Text>}
      </View>
      {!!price && <Text style={s.itemPrice}>{price}</Text>}
    </View>
  )
  if (!ordering || !eateryOrderable(item)) return row
  return (
    <View>
      {row}
      <View style={s.itemOrder}><QtyStepper id={item.id} name={item.name} qty={qty} onQty={onQty} lang={lang} /></View>
    </View>
  )
})

// Own memo component: an active-tab change re-renders this row only, never the 46 dish rows.
// Tab positions inside the row are measured with measureLayout when the active tab changes.
const SectionTabs = memo(function SectionTabs({ titles, active, onSelect, onHeight, reduce }) {
  const scrollRef = useRef(null)
  const tabRefs = useRef([])
  const tabsViewW = useRef(0)
  useEffect(() => {
    const tab = tabRefs.current[active]
    const inner = scrollRef.current?.getInnerViewRef?.()
    if (!tab || !inner || tabsViewW.current === 0) return
    tab.measureLayout(inner, (x, _y, w) => {
      scrollRef.current?.scrollTo({ x: Math.max(0, x + w / 2 - tabsViewW.current / 2), animated: !reduce })
    }, () => {})
  }, [active, reduce])
  return (
    <View style={s.tabsWrap} onLayout={e => onHeight(e.nativeEvent.layout.height)}>
      <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist"
        onLayout={e => { tabsViewW.current = e.nativeEvent.layout.width }} contentContainerStyle={s.tabsContent}>
        {titles.map((title, i) => (
          <Pressable key={title} ref={r => { tabRefs.current[i] = r }} onPress={() => onSelect(i)}
            style={({ pressed }) => [s.tab, i === active && s.tabOn, pressed && { opacity: press.small }]} accessibilityRole="tab" accessibilityLabel={title}
            accessibilityState={{ selected: i === active }}>
            <Text style={[s.tabText, i === active && s.tabTextOn]}>{title}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  )
})

function DishPhotoViewer({ item, lang, reduce, onClose, onFail }) {
  const insets = useSafeAreaInsets()
  const { width: winW } = useWindowDimensions()
  const uri = item ? eateryImageUrl(item.photoPath) : null
  const price = item ? formatPrice(item.price, item.currency, lang) : ''
  return (
    <Modal visible={!!item === true} transparent animationType={reduce ? 'none' : 'fade'} onRequestClose={onClose}
      statusBarTranslucent supportedOrientations={['portrait']}>
      {!!item && (
        <Pressable style={[s.viewer, { paddingTop: insets.top + space[8], paddingBottom: insets.bottom + space[16] }]}
          onPress={onClose} accessible={false}>
          <StatusBar style="light" />
          <View style={s.viewerBar}>
            <Pressable style={s.closeBtn} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('uiClose', lang)}>
              <Ionicons name="close" size={20} color={colors.onPrimary} />
              <Text style={s.closeText}>{t('uiClose', lang)}</Text>
            </Pressable>
          </View>
          <View style={s.viewerImg}>
            {uri
              ? <RemoteImage source={{ uri }} resizeMode="contain" style={s.fill} placeholderColor="transparent" onError={() => { onFail(item.id); onClose() }} transition={reduce ? 0 : 200} accessibilityIgnoresInvertColors />
              : <PlaceholderFrame lang={lang} style={{ width: winW - 32, aspectRatio: item.aspect || 4 / 3, borderRadius: radii.card }} />}
          </View>
          <View style={s.caption}>
            <Text style={s.capName}>{item.name}</Text>
            {!!price && <Text style={s.capPrice}>{price}</Text>}
          </View>
        </Pressable>
      )}
    </Modal>
  )
}

// focusItemId: the "Ne yesem?" quiz opens the page at one dish; see the focus effect below. openBasket: ... or straight into
// Sepetim (its Back lands on this menu). Initial state only: the page remounts for every partner opened.
export default function EateryPartnerScreen({ partner, lang, onBack, backRef = null, focusItemId = null, openBasket: startInBasket = false }) {
  const [viewing, setViewing] = useState(null)
  const [failedDishes, setFailedDishes] = useState({})
  const failDish = useCallback(id => setFailedDishes(f => ({ ...f, [id]: true })), [])
  const reduce = useReduceMotion()
  const insets = useSafeAreaInsets()
  const { width: winW } = useWindowDimensions()
  const W = winW - 32

  const contacts = eateryContacts(partner)
  const menuUrl = eateryMenuUrl(partner)
  const sections = useMemo(() => eateryMenuSections(partner), [partner])
  const gallery = eateryPhotos(partner, 'gallery')
  const menuPhotos = eateryPhotos(partner, 'menu')
  const week = eateryWeek(partner)
  const open = eateryOpenStatus(partner, lang)
  const regionKey = REGION_LABEL_KEY[partner.region]
  const hasMenu = sections.length > 0 || menuPhotos.length > 0 || !!menuUrl

  // Order via WhatsApp. The basket (per partner, in memory) holds quantities only; names and prices are read from the
  // menu rows here. No number behind it (and never a fixture partner) = no basket at all.
  const orderDigits = eateryOrderDigits(effectiveWhatsapp(partner))
  const ordering = !!orderDigits
  const basket = useBasket(partner.id)
  const lines = useMemo(() => {
    if (!ordering) return []
    return sections.flatMap(sec => sec.items).filter(eateryOrderable)
      .filter(i => basket[i.id] > 0).map(i => ({ id: i.id, name: i.name, qty: basket[i.id], price: Number(i.price), photoPath: i.photoPath }))
  }, [ordering, sections, basket])
  const orderCurrency = sections.flatMap(sec => sec.items).find(eateryOrderable)?.currency
  const formatMoney = useCallback(n => formatPrice(n, orderCurrency, lang), [orderCurrency, lang])
  const orderCount = lines.reduce((n, l) => n + l.qty, 0)
  const orderTotalText = formatMoney(orderTotal(lines))
  const [basketOpen, setBasketOpen] = useState(startInBasket === true && ordering)     // the target; basketShown keeps the page mounted through its slide-out
  const [basketShown, setBasketShown] = useState(startInBasket === true && ordering)
  const [note, setNote] = useState('')
  const noteRef = useRef('')
  noteRef.current = note
  const armedRef = useRef(null)     // set when the WhatsApp link was opened; { left } turns true once the app really left
  const [snack, setSnack] = useState(null)   // 'eateryBasketCleared' | 'eateryBasketItemRemoved' while its "Geri al" is offered
  // Empties the basket but keeps it and the note for the snackbar's "Geri al" (no confirm dialog); see eateryBasketCore.js.
  const clearBasket = () => {
    if (!clearAll(partner.id, noteRef.current)) return
    setNote('')
    setSnack('eateryBasketCleared')
  }
  // Any real edit drops the old snapshot inside the store; taking the last unit off a dish (the bin) offers its own undo.
  const onQty = useCallback((id, delta) => {
    const r = changeQty(partner.id, id, delta)
    if (r) setSnack(r === 'removed' ? 'eateryBasketItemRemoved' : null)
  }, [partner.id])
  useEffect(() => {
    const sub = AppState.addEventListener('change', st => {
      const a = armedRef.current
      if (!a) return
      if (st !== 'active') { a.left = true; return }
      if (!a.left) return
      armedRef.current = null
      clearBasket()
    })
    return () => sub.remove()
  }, [partner.id])
  const undoClear = () => {
    try { haptic() } catch { /* never blocks the undo */ }
    setSnack(null)
    const u = undo(partner.id)
    if (u && u.kind === 'all') setNote(u.note)
  }

  // Section tabs: tab row pins (sticky) above the menu; scroll position picks the active section.
  const showTabs = sections.length >= 2
  const tabsIndex = 1 + (gallery.length > 0 ? 1 : 0)   // children of the ScrollView: head Card, [pager], tabs
  const scrollRef = useRef(null)
  const secRefs = useRef([])
  const tops = useRef([])          // section tops in scroll-content coordinates, refreshed by measureTops()
  const tabsH = useRef(0)
  const activeRef = useRef(0)
  const lockRef = useRef(false)    // true while a tab tap is scrolling: scroll-sync stays quiet
  const lockTimer = useRef(null)
  const [activeSec, setActiveSec] = useState(0)

  const measureTops = useCallback(() => new Promise(resolve => {
    const inner = scrollRef.current?.getInnerViewRef?.()
    if (!inner) { resolve(); return }
    Promise.all(secRefs.current.map((r, i) => new Promise(res => {
      if (!r) { res(); return }
      r.measureLayout(inner, (_x, y) => { tops.current[i] = y; res() }, () => res())
    }))).then(resolve)
  }), [])
  const measureTimer = useRef(null)
  const scheduleMeasure = useCallback(() => {
    clearTimeout(measureTimer.current)
    measureTimer.current = setTimeout(measureTops, 50)
  }, [measureTops])
  useEffect(() => () => { clearTimeout(lockTimer.current); clearTimeout(measureTimer.current) }, [])

  const releaseLock = useCallback(() => { lockRef.current = false }, [])
  const onScroll = useCallback(e => {
    if (lockRef.current) return
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent
    const edge = contentOffset.y + tabsH.current + TAB_SCROLL_OFFSET
    let idx = 0
    for (let i = 0; i < tops.current.length; i++) if (tops.current[i] != null && tops.current[i] <= edge) idx = i
    if (contentOffset.y + layoutMeasurement.height >= contentSize.height - 2 && tops.current.length) idx = tops.current.length - 1
    if (idx !== activeRef.current) { activeRef.current = idx; setActiveSec(idx) }
  }, [])

  const selectSection = useCallback(async i => {
    await measureTops()
    if (tops.current[i] == null) return
    lockRef.current = true
    activeRef.current = i
    setActiveSec(i)
    scrollRef.current?.scrollTo({ y: Math.max(0, tops.current[i] - tabsH.current), animated: !reduce })
    clearTimeout(lockTimer.current)
    lockTimer.current = setTimeout(() => { lockRef.current = false }, reduce ? 80 : 1200)
  }, [measureTops, reduce])
  const setTabsH = useCallback(h => { tabsH.current = h }, [])

  // Quiz hand-off: scroll so the dish row sits just under the pinned tabs, then mark it for 1.2 s (no mark with reduced
  // motion). One shot per open. The row is measured against the scroll content (no cached onLayout); a measure that
  // fails because the row has not mounted yet is retried a few times.
  const focusRef = useRef(null)
  const reduceRef = useRef(reduce)
  reduceRef.current = reduce
  const [marked, setMarked] = useState(null)
  useEffect(() => {
    if (focusItemId == null) return
    const si = sections.findIndex(sec => sec.items.some(i => i.id === focusItemId))
    if (si < 0) return
    const timers = []
    const attempt = n => {
      const inner = scrollRef.current?.getInnerViewRef?.()
      const node = focusRef.current
      const retry = () => { if (n < 5) timers.push(setTimeout(() => attempt(n + 1), 200)) }
      if (!inner || !node) { retry(); return }
      node.measureLayout(inner, (_x, y) => {
        lockRef.current = true
        activeRef.current = si
        setActiveSec(si)
        scrollRef.current?.scrollTo({ y: Math.max(0, y - tabsH.current - 8), animated: !reduceRef.current })
        timers.push(setTimeout(() => { lockRef.current = false }, reduceRef.current ? 80 : 1200))
        setMarked(focusItemId)
        timers.push(setTimeout(() => setMarked(null), MARK_MS))
      }, retry)
    }
    timers.push(setTimeout(() => attempt(0), 350))
    return () => timers.forEach(clearTimeout)
  }, [focusItemId, sections])
  const sectionTitles = useMemo(() => sections.map(sec => sec.title), [sections])

  // App's single back handler asks here first (the dish photo viewer is a layer above the partner page).
  useEffect(() => {
    if (!backRef) return
    backRef.current = () => {
      if (basketOpen) { setBasketOpen(false); return true }
      if (viewing) { setViewing(null); return true }
      return false
    }
    return () => { backRef.current = null }
  })

  // The tap is logged on the line BEFORE the link opens (utils/logContactEvent: it never throws);
  // a placeholder partner has no real id and an inactive (previewer-only) row is not live: both log nothing.
  const go = (action, url, onFail) => {
    if (!partner.placeholder && partner.is_active !== false) logContactEvent('eatery', partner.id, action)
    Linking.openURL(url).catch(() => { onFail?.() })
  }
  // Closes the basket page and opens WhatsApp. Only the tap is logged (action 'order_whatsapp'): never the basket or the note.
  const sendOrder = () => {
    if (!ordering || lines.length === 0) return
    armedRef.current = { left: false }
    setBasketOpen(false)
    go('order_whatsapp', orderWhatsAppUrl(orderDigits, buildOrderMessage(lines, note)), () => { armedRef.current = null })
  }
  const openBasket = () => { armedRef.current = null; setBasketShown(true); setBasketOpen(true) }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.under} {...(basketOpen ? { importantForAccessibility: 'no-hide-descendants', accessibilityElementsHidden: true } : null)}>
      <ScreenHeader lang={lang} title={t('menuEatery', lang)} onBack={onBack} />
      <ScrollView ref={scrollRef} contentContainerStyle={[s.content, { paddingBottom: lines.length > 0 ? space[20] : listBottomPad(insets) }]} showsVerticalScrollIndicator={false}
        stickyHeaderIndices={showTabs ? [tabsIndex] : undefined} onScroll={showTabs ? onScroll : undefined} scrollEventThrottle={16}
        onContentSizeChange={showTabs ? scheduleMeasure : undefined}
        onMomentumScrollEnd={showTabs ? releaseLock : undefined} onScrollEndDrag={showTabs ? releaseLock : undefined}>
        <Card>
          <View style={s.head}>
            <EateryLogo partner={partner} width={72} height={72} decorative />
            <View style={s.headText}>
              <Text style={s.name}>{partner.name}</Text>
              <Text style={s.sub}>{t(EATERY_CATEGORY_KEY[partner.category] || 'eateryCatRestaurant', lang)}</Text>
              {!!regionKey && (
                <View style={s.region}>
                  <Ionicons name="location-outline" size={13} color={colors.textSecondary} />
                  <Text style={s.regionText}>{t(regionKey, lang)}</Text>
                </View>
              )}
            </View>
          </View>
          {!!partner.placeholder && <PlaceholderTag lang={lang} style={s.tag} />}
          {partner.is_active === false && <PlaceholderTag lang={lang} labelKey="eateryUnpublishedTag" style={s.tag} />}
        </Card>

        {gallery.length > 0 && <PhotoPager photos={gallery} width={W} ratio={4 / 3} fit="contain" lang={lang} />}

        {showTabs && <SectionTabs titles={sectionTitles} active={activeSec} onSelect={selectSection} onHeight={setTabsH} reduce={reduce} />}

        {hasMenu && (
          <Card>
            <Text style={s.h}>{t('eateryMenu', lang)}</Text>
            {!!partner.placeholder && <PlaceholderTag lang={lang} style={s.tagGap} />}
            {sections.map((sec, si) => (
              <View key={sec.title} ref={r => { secRefs.current[si] = r }} collapsable={false} onLayout={showTabs ? scheduleMeasure : undefined}
                style={[s.menuSec, si > 0 && s.menuSecNext]}>
                <Text style={s.secTitle} accessibilityRole="header">
                  {sec.title}
                  {SHOW_SECTION_COUNT && <Text style={s.secCount}>{' · ' + sec.items.length}</Text>}
                </Text>
                {sec.items.map(i => {
                  const row = <MenuItemRow item={i} lang={lang} reduce={reduce} failed={!!failedDishes[i.id]} onFail={failDish} onOpenPhoto={setViewing}
                    ordering={ordering} qty={basket[i.id] || 0} onQty={onQty} />
                  return i.id === focusItemId
                    ? <View key={i.id} ref={focusRef} collapsable={false} style={s.focusRow}>{marked === i.id && <FocusMark reduce={reduce} />}{row}</View>
                    : <Fragment key={i.id}>{row}</Fragment>
                })}
              </View>
            ))}
            {menuPhotos.length > 0 && (
              <View style={s.menuSec}>
                <PhotoPager photos={menuPhotos} width={W - 32} ratio={3 / 4} fit="contain" lang={lang} radius={radii.md} />
              </View>
            )}
            {!!menuUrl && (
              <Button style={s.menuBtn} variant="secondary" icon="restaurant-outline"
                title={t('eateryViewMenu', lang)} onPress={() => go('menu', menuUrl)} />
            )}
          </Card>
        )}

        {(!!week || !!partner.address) && (
          <Card>
            {!!week && (
              <>
                <Text style={s.h}>{t('eateryHours', lang)}</Text>
                <HoursBlock week={week} open={open} lang={lang} />
              </>
            )}
            {!!partner.address && (
              <View style={!!week && s.addrGap}>
                <Text style={s.h}>{t('eateryAddress', lang)}</Text>
                <Text style={s.body}>{partner.address}</Text>
              </View>
            )}
          </Card>
        )}

        {contacts.length > 0 && (
          <View style={s.actions}>
            {contacts.map(c => (
              <Button key={c.action} fullWidth variant={CONTACT_UI[c.action].variant}
                icon={CONTACT_UI[c.action].icon} title={t(CONTACT_UI[c.action].labelKey, lang)}
                onPress={() => go(c.action, c.url)} />
            ))}
          </View>
        )}

      </ScrollView>
      {lines.length > 0 && <OrderBar count={orderCount} totalText={orderTotalText} lang={lang} onOpen={openBasket} />}
      </View>
      {ordering && basketShown === true && (
        <BasketPage partner={partner} lang={lang} open={basketOpen === true} onClosed={() => setBasketShown(false)} lines={lines} onQty={onQty} formatMoney={formatMoney} totalText={orderTotalText}
          note={note} onNote={setNote} onClear={clearBasket} onSend={sendOrder} onClose={() => setBasketOpen(false)} reduce={reduce} />
      )}
      <Snackbar visible={snack !== null} message={snack ? t(snack, lang) : ''} actionLabel={t('eateryOrderUndo', lang)}
        onAction={undoClear} onTimeout={() => { setSnack(null); dropSnapshot(partner.id) }} reduce={reduce}
        bottom={insets.bottom + (lines.length > 0 ? SNACK_ABOVE_BAR : space[16])} />
      <DishPhotoViewer item={viewing} lang={lang} reduce={reduce} onFail={failDish} onClose={() => setViewing(null)} />
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: colors.canvas },
  under:     { flex: 1 },
  content:   { paddingHorizontal: 16, paddingTop: space[8], gap: 14 },
  head:      { flexDirection: 'row', alignItems: 'center', gap: space[16] },
  headText:  { flex: 1 },
  name:      { ...type.detailTitle, color: colors.textPrimary },
  sub:       { ...type.small, color: colors.textSecondary, marginTop: 2 },
  region:    { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 6 },
  regionText:{ ...type.meta, color: colors.textSecondary },
  tag:       { marginTop: space[12] },
  tagGap:    { marginBottom: space[8] },
  h:         { ...type.sectionHeading, color: colors.textPrimary, marginBottom: space[8] },
  body:      { ...type.body, color: colors.textPrimary },
  addrGap:   { marginTop: space[20] },
  chip:      { alignSelf: 'flex-start', borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4, marginBottom: space[8] },
  chip_ok:      { backgroundColor: colors.primaryLight },
  chip_warn:    { backgroundColor: colors.dangerLight },
  chip_neutral: { backgroundColor: colors.soft },
  chipText:  { ...type.meta },
  chipText_ok:      { color: colors.primaryDark },
  chipText_warn:    { color: colors.dangerInk },
  chipText_neutral: { color: colors.textPrimary },
  hourRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space[12], minHeight: 28 },
  hourDay:   { ...type.body, color: colors.textSecondary, flexShrink: 1 },
  hourVal:   { ...type.body, color: colors.textPrimary, flexShrink: 0 },
  actions:   { gap: space[8] },
  menuSec:   { marginTop: space[12] },
  menuSecNext: { marginTop: space[20] },
  secTitle:  { ...type.sectionHeading, color: colors.primaryDark, backgroundColor: colors.primaryLight, borderRadius: radii.sm, paddingVertical: space[8], paddingHorizontal: space[12], marginBottom: space[4] },
  secCount:  { fontFamily: font.regular, color: colors.textSecondary },
  tabsWrap:  { marginHorizontal: -16, backgroundColor: colors.canvas, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  tabsContent: { paddingHorizontal: 16 },
  tab:       { minHeight: 44, paddingHorizontal: space[12], justifyContent: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent' },
  tabOn:     { borderBottomColor: colors.primary },
  tabText:   { ...type.body, fontFamily: font.semibold, color: colors.textSecondary },
  tabTextOn: { color: colors.primary },
  itemRow:   { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[12], paddingVertical: space[8] },
  itemText:  { flex: 1 },
  itemName:  { ...type.body, color: colors.textPrimary },
  itemDesc:  { ...type.small, color: colors.textSecondary, marginTop: 2 },
  itemPrice: { ...type.body, fontFamily: font.semibold, fontVariant: ['tabular-nums'], color: colors.textPrimary, flexShrink: 0 },
  itemOrder: { alignItems: 'flex-end', marginBottom: space[4] },
  focusRow:  { marginHorizontal: -space[8], paddingHorizontal: space[8], borderRadius: radii.sm },
  focusMark: { ...StyleSheet.absoluteFillObject, borderRadius: radii.sm, backgroundColor: colors.primaryLight },
  menuBtn:   { marginTop: space[16] },
  fill:      { width: '100%', height: '100%' },
  thumb:     { width: THUMB, height: THUMB, borderRadius: radii.md, overflow: 'hidden', backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  // Neutral black scrim = photo treatment (ada-style §6), not a brand colour: never tint partner food photos.
  viewer:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)' },
  viewerBar: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: space[16], flexShrink: 0 },
  closeBtn:  { minHeight: 44, minWidth: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[4], paddingHorizontal: space[16], borderRadius: radii.pill, backgroundColor: withAlpha(colors.onPrimary, 0.18) },
  closeText: { ...type.body, fontFamily: font.semibold, color: colors.onPrimary },
  viewerImg: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: space[12], paddingHorizontal: space[8] },
  caption:   { paddingHorizontal: space[20], gap: space[4], alignItems: 'center', flexShrink: 0 },
  capName:   { ...type.rowTitle, color: colors.onPrimary, textAlign: 'center' },
  capPrice:  { ...type.body, fontFamily: font.semibold, fontVariant: ['tabular-nums'], color: colors.onPrimary },
})
