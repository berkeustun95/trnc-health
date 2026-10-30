import { Fragment, useState, useEffect, useRef, useMemo, useCallback, memo } from 'react'
import { StatusBar } from 'expo-status-bar'
import { View, Text, ScrollView, Animated, Linking, Modal, Pressable, AppState, StyleSheet, useWindowDimensions } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { t } from '../constants/i18n'
import { REGION_LABEL_KEY } from '../constants/regions'
import {
  EATERY_CATEGORY_KEY, eateryContacts, eateryMenuUrl, eateryMenuSections, eateryPhotos, eateryWeek,
  eateryOpenStatus, formatPrice, eateryOrderable, eateryOrderDigits, eateryOrdersByWhatsapp, eateryListMode, buildOrderMessage, orderWhatsAppUrl, orderTotal, serverOrderLines, orderCheck, orderErrorKind, orderAgeGate, orderRpcArgs, basketLines, eateryItemOptions, deliveryReady, eateryPartnerBack, editorStartStep, deliveryFromEntry, EMPTY_DELIVERY_ADDRESS,
} from '../constants/eatery'
import { colors, font, type, radii, space, motion, listBottomPad, withAlpha, press } from '../constants/theme'
import { ScreenHeader, Card, Button, RemoteImage } from '../components/ui'
import { EateryLogo, PlaceholderTag, PlaceholderFrame, PhotoPager, eateryImageUrl, useReduceMotion } from '../components/EateryBits'
import { logContactEvent } from '../utils/logContactEvent'
import { supabase, isGuest } from '../lib/supabase'
import { IS_PREVIEW, CONTACT_LOGGING, partnerContactNumbers, effectiveWhatsapp, useBasket, changeQty, setLine, lineKey, dishQty, dishUsesSheet, clearAll, undo, dropSnapshot } from '../utils/eateryBasket'
import { loadBook, setLastUsed } from '../utils/eateryAddress'
import { QtyStepper, DishAddButton, DishOptionsSheet, OrderBar, BasketPage } from '../components/EateryOrder'
import AddressEditor from '../components/AddressEditor'
import { QuizPage, PartnerQuizBanner } from '../components/EateryQuiz'
import { quizHasMains, partnerQuizConfig } from '../constants/eateryQuiz'
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
const MenuItemRow = memo(function MenuItemRow({ item, lang, reduce, failed, onFail, onOpenPhoto, ordering, qty, sheet, onQty, onOptions }) {
  const price = formatPrice(item.price, item.currency, lang)
  const hasPhoto = !failed && (!!item.photoPath || item.photoPlaceholder)
  const row = (
    <View style={s.itemRow}>
      {hasPhoto && <DishThumb item={item} name={item.name} lang={lang} reduce={reduce} onOpen={() => onOpenPhoto(item)} onFail={() => onFail(item.id)} />}
      <View style={s.itemText}>
        <Text style={s.itemName}>{item.name}</Text>
        {!!item.description && <Text style={s.itemDesc}>{item.description}</Text>}
      </View>
      {price ? <Text style={s.itemPrice}>{price}</Text> : <Text style={s.itemPricePending}>{t('eateryPricePending', lang)}</Text>}
    </View>
  )
  if (!ordering || !eateryOrderable(item)) return row
  return (
    <View>
      {row}
      <View style={s.itemOrder}>
        {sheet
          ? <DishAddButton name={item.name} count={qty} onPress={() => onOptions(item)} lang={lang} />
          : <QtyStepper id={item.id} name={item.name} qty={qty} onQty={onQty} lang={lang} />}
      </View>
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
            {price ? <Text style={s.capPrice}>{price}</Text> : <Text style={s.capPricePending}>{t('eateryPricePending', lang)}</Text>}
          </View>
        </Pressable>
      )}
    </Modal>
  )
}

// focusItemId: the "Ne yesem?" quiz opens the page at one dish; see the focus effect below. openBasket: ... or straight into
// Sepetim (its Back lands on this menu). Initial state only: the page remounts for every partner opened.
export default function EateryPartnerScreen({ partner, lang, onBack, backRef = null, focusItemId = null, openBasket: startInBasket = false, session = null, dateOfBirth = null, onRequireAccount = null, onRefresh = null }) {
  const [viewing, setViewing] = useState(null)
  const [failedDishes, setFailedDishes] = useState({})
  const failDish = useCallback(id => setFailedDishes(f => ({ ...f, [id]: true })), [])
  const reduce = useReduceMotion()
  const insets = useSafeAreaInsets()
  const { width: winW } = useWindowDimensions()
  const W = winW - 32

  const nums = partnerContactNumbers(partner)
  const contacts = eateryContacts(partner, nums)
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
  const whatsappOrdering = eateryOrdersByWhatsapp(partner) && !!orderDigits
  // "Listem" (phone partners): the same basket store and controls, but the list is read out on the call: nothing is sent or recorded.
  const listMode = eateryListMode(partner, nums)
  const ordering = listMode != null
  const orderByPhone = partner.order_method === 'phone'
  const callUrl = contacts.find(c => c.action === 'call')?.url
  const basket = useBasket(partner.id)
  const lines = useMemo(() => {
    if (!ordering) return []
    return basketLines(sections.flatMap(sec => sec.items).filter(eateryOrderable), basket)
  }, [ordering, sections, basket])
  const orderCurrency = sections.flatMap(sec => sec.items).find(eateryOrderable)?.currency
  const formatMoney = useCallback(n => formatPrice(n, orderCurrency, lang), [orderCurrency, lang])
  const orderCount = lines.reduce((n, l) => n + l.qty, 0)
  const orderTotalText = formatMoney(orderTotal(lines))
  const [basketOpen, setBasketOpen] = useState(false)     // the target; basketShown keeps the page mounted through its slide-out
  const [basketShown, setBasketShown] = useState(false)
  // "Ne yesem?" scoped to this partner: a layer over the page (rows = just this partner), closed by Back first.
  const showQuizBanner = !partner.placeholder && quizHasMains([partner])
  const [quizOpen, setQuizOpen] = useState(false)
  const [quizShown, setQuizShown] = useState(false)
  const quizBackRef = useRef(null)
  const quizRows = useMemo(() => [partner], [partner])
  const quizConfig = partnerQuizConfig(partner.slug)   // Bidda has its own questions, every other partner the general set over its own menu
  const [focusReq, setFocusReq] = useState(null)   // { id, n }: a dish picked on the quiz results; n lets the same dish be picked twice
  const focusId = focusReq ? focusReq.id : focusItemId
  const [note, setNote] = useState('')
  // Teslimat: mode is null until chosen (required). The address is one entry of this phone's address book (utils/eateryAddress.js):
  // the last used one is selected on open; components/AddressEditor.js adds, edits and deletes. coords = its optional map pin.
  const [delivery, setDelivery] = useState({ mode: null, ...EMPTY_DELIVERY_ADDRESS })
  const onDelivery = useCallback(patch => { setOrderError(null); setDelivery(d => ({ ...d, ...patch })) }, [])
  useEffect(() => {
    let live = true
    loadBook().then(book => {
      const a = book.items.find(i => i.id === book.lastUsedId)
      if (live && a) setDelivery(d => (d.addressId ? d : { ...d, ...deliveryFromEntry(a) }))
    })
    return () => { live = false }
  }, [])
  // The address editor: a page over Sepetim. shown keeps it mounted through its slide-out; step / picker live here so Back and the header
  // arrow share one code path (editorBackTo); the draft lives in the editor.
  const [editor, setEditor] = useState({ shown: false, open: false, seed: null, step: 1, picker: false, key: 0 })
  const openEditor = (seed, step) => setEditor(e => ({ shown: true, open: true, seed, step: step || editorStartStep(seed), picker: false, key: e.key + 1 }))
  const closeEditor = () => setEditor(e => ({ ...e, open: false }))
  const editorBackTo = r => { if (r.close) closeEditor(); else setEditor(e => ({ ...e, step: r.step, picker: r.picker })) }
  const onAddressSaved = item => { setOrderError(null); setDelivery(d => ({ ...d, ...deliveryFromEntry(item) })); closeEditor() }
  // Deleting an entry that is not the selected one leaves the selection alone.
  const onAddressDeleted = next => { setOrderError(null); setDelivery(d => (d.addressId && d.addressId !== editor.seed?.addressId ? d : { ...d, ...(next ? deliveryFromEntry(next) : EMPTY_DELIVERY_ADDRESS) })); closeEditor() }
  // Per-dish options: one sheet for the whole screen. fromKey = the Sepetim line being edited (null = a fresh add); the item stays
  // set while the sheet slides out.
  const [optSheet, setOptSheet] = useState({ open: false, item: null, fromKey: null, initial: null })
  const openOptions = useCallback(item => setOptSheet({ open: true, item, fromKey: null, initial: null }), [])
  const editLine = line => setOptSheet({ open: true, item: line.item, fromKey: line.key, initial: { opts: line.opts, qty: line.qty } })
  const confirmOptions = ({ opts, qty }) => {
    setLine(partner.id, optSheet.fromKey, lineKey(optSheet.item.id, opts), qty)
    setOrderError(null)
    setSnack(null)
    setOptSheet(o => ({ ...o, open: false }))
  }
  const noteRef = useRef('')
  noteRef.current = note
  const armedRef = useRef(null)     // set when the WhatsApp link was opened; { left } turns true once the app really left
  const [snack, setSnack] = useState(null)   // 'eateryBasketCleared' | 'eateryBasketItemRemoved' while its "Geri al" is offered
  // Empties the basket but keeps it and the note for the snackbar's "Geri al" (no confirm dialog); see eateryBasketCore.js.
  const clearBasket = () => {
    if (!clearAll(partner.id, noteRef.current)) return
    setNote('')
    setSnack(listMode === 'phone' ? 'eateryListCleared' : 'eateryBasketCleared')
  }
  // Any real edit drops the old snapshot inside the store; taking the last unit off a dish (the bin) offers its own undo.
  const onQty = useCallback((id, delta) => {
    const r = changeQty(partner.id, id, delta)
    setOrderError(null)
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
  const tabsIndex = 1 + (showQuizBanner ? 1 : 0) + (gallery.length > 0 ? 1 : 0)   // children of the ScrollView: head Card, [pager], [quiz banner], tabs
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
  const sectionsRef = useRef(sections)
  sectionsRef.current = sections
  const focusDone = useRef(null)
  const focusKey = focusReq ? 'r' + focusReq.n : 'p' + focusItemId
  useEffect(() => {
    if (focusId == null || focusDone.current === focusKey) return   // once per request: a new partner object never re-scrolls
    const si = sectionsRef.current.findIndex(sec => sec.items.some(i => i.id === focusId))
    if (si < 0) return
    const timers = []
    const attempt = n => {
      const inner = scrollRef.current?.getInnerViewRef?.()
      const node = focusRef.current
      const retry = () => { if (n < 5) timers.push(setTimeout(() => attempt(n + 1), 200)) }
      if (!inner || !node) { retry(); return }
      node.measureLayout(inner, (_x, y) => {
        focusDone.current = focusKey
        lockRef.current = true
        activeRef.current = si
        setActiveSec(si)
        scrollRef.current?.scrollTo({ y: Math.max(0, y - tabsH.current - 8), animated: !reduceRef.current })
        timers.push(setTimeout(() => { lockRef.current = false }, reduceRef.current ? 80 : 1200))
        setMarked(focusId)
        timers.push(setTimeout(() => setMarked(null), MARK_MS))
      }, retry)
    }
    timers.push(setTimeout(() => attempt(0), 350))
    return () => timers.forEach(clearTimeout)
  }, [focusId, focusReq])
  const sectionTitles = useMemo(() => sections.map(sec => sec.title), [sections])

  // App's single back handler asks here first (the dish photo viewer is a layer above the partner page).
  useEffect(() => {
    if (!backRef) return
    backRef.current = () => {
      const r = eateryPartnerBack({ editorOpen: editor.open === true, editorStep: editor.step, pickerOpen: editor.picker === true,
        quizBack: () => quizBackRef.current?.(), basketOpen, viewing: !!viewing })
      if (!r) return false
      if (r.layer === 'editor') editorBackTo(r)
      else if (r.layer === 'basket') setBasketOpen(false)
      else if (r.layer === 'viewing') setViewing(null)
      return true
    }
    return () => { backRef.current = null }
  })

  // The tap is logged on the line BEFORE the link opens (utils/logContactEvent: it never throws);
  // a placeholder partner has no real id and an inactive (previewer-only) row is not live: both log nothing.
  const go = (action, url, onFail) => {
    if (CONTACT_LOGGING && !partner.placeholder && partner.is_active !== false) logContactEvent('eatery', partner.id, action)
    Linking.openURL(url).catch(() => { onFail?.() })
  }
  // Closes the basket page and opens WhatsApp. Only the tap is logged (action 'order_whatsapp'): never the basket or the note.
  // The server records the order FIRST (create_eatery_order, 20261125) and the WhatsApp text is built from its answer
  // (database prices + a verifiable code). Any refusal, a changed price or a network failure sends nothing.
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)
  const [orderError, setOrderError] = useState(null)   // null | 'generic' | 'rate' | 'account' | 'prices' | 'items'
  // 18+ partners: guests, accounts without a date of birth and under-18 accounts browse and fill the basket but cannot send.
  const ageGate = orderAgeGate({ adultOnly: partner.adult_only, guest: isGuest(session), dob: dateOfBirth })
  const sendOrder = async () => {
    if (!whatsappOrdering || lines.length === 0 || sendingRef.current || ageGate || !deliveryReady(delivery) || lines.some(l => l.stale)) return
    if (partner.order_requires_account === true && isGuest(session)) { setOrderError('account'); return }
    sendingRef.current = true
    setSending(true)
    setOrderError(null)
    const sent = lines
    let res = null, kind = null
    try {
      const { data, error } = await supabase.rpc('create_eatery_order', orderRpcArgs(partner.id, sent))
      if (error || !data) kind = orderErrorKind(error)
      else { kind = orderCheck(sent, data); if (!kind) res = data }
    } catch { kind = 'generic' }
    sendingRef.current = false
    setSending(false)
    if (!res) {
      setOrderError(kind)
      if (kind === 'prices' || kind === 'items') onRefresh?.()   // reload the menu rows so Sepetim shows the new prices
      return
    }
    armedRef.current = { left: false }
    setBasketOpen(false)
    if (delivery.mode === 'delivery' && delivery.addressId) setLastUsed(delivery.addressId)
    const text = buildOrderMessage(serverOrderLines(res), note, res.code, delivery)
    setDelivery(d => ({ ...d, mode: null }))
    go('order_whatsapp', orderWhatsAppUrl(orderDigits, text), () => { armedRef.current = null })
  }
  const openBasket = () => { armedRef.current = null; setOrderError(null); setBasketShown(true); setBasketOpen(true) }
  // From the quiz bar: Sepetim opens once, and only when its lines exist (never an empty page).
  const autoOpened = useRef(false)
  useEffect(() => {
    if (!startInBasket || autoOpened.current || !ordering || lines.length === 0) return
    autoOpened.current = true
    openBasket()
  }, [startInBasket, ordering, lines.length])

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.under} {...(basketOpen || quizOpen ? { importantForAccessibility: 'no-hide-descendants', accessibilityElementsHidden: true } : null)}>
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

        {showQuizBanner && <PartnerQuizBanner lang={lang} partnerName={partner.name} onPress={() => { setQuizShown(true); setQuizOpen(true) }} />}

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
                    ordering={ordering} qty={dishQty(basket, i.id)} sheet={dishUsesSheet(basket, i.id, eateryItemOptions(i).length > 0)} onQty={onQty} onOptions={openOptions} />
                  return i.id === focusId
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
                icon={CONTACT_UI[c.action].icon} title={t(c.action === 'call' && orderByPhone ? 'eateryOrderByPhone' : CONTACT_UI[c.action].labelKey, lang)}
                onPress={() => go(c.action, c.url)} />
            ))}
            {IS_PREVIEW && contacts.some(c => c.action === 'call' || c.action === 'whatsapp') && <Text style={s.previewHint}>{t('eateryTestNumberHint', lang)}</Text>}
          </View>
        )}

      </ScrollView>
      {lines.length > 0 && <OrderBar count={orderCount} totalText={orderTotalText} lang={lang} onOpen={openBasket} mode={listMode} />}
      </View>
      {ordering && basketShown === true && (
        <BasketPage partner={partner} lang={lang} mode={listMode} onCall={() => { if (callUrl) go('call', callUrl) }} open={basketOpen === true} onClosed={() => setBasketShown(false)} lines={lines} onQty={onQty} onEditLine={editLine} formatMoney={formatMoney} totalText={orderTotalText}
          note={note} onNote={setNote} delivery={delivery} onDelivery={onDelivery} onAddress={openEditor} covered={editor.open === true} onClear={clearBasket} onSend={sendOrder} sending={sending} orderError={orderError} ageGate={ageGate} onSignIn={() => onRequireAccount?.('gateEateryOrder')} onClose={() => setBasketOpen(false)} reduce={reduce} />
      )}
      {whatsappOrdering && editor.shown === true && (
        <AddressEditor key={editor.key} lang={lang} open={editor.open === true} step={editor.step} pickerOpen={editor.picker === true} seed={editor.seed} reduce={reduce}
          onStep={n => setEditor(e => ({ ...e, step: n }))} onPicker={v => setEditor(e => ({ ...e, picker: v }))}
          onBack={() => editorBackTo(eateryPartnerBack({ editorOpen: true, editorStep: editor.step, pickerOpen: editor.picker === true }))}
          onClosed={() => setEditor(e => (e.open ? e : { ...e, shown: false }))} onSaved={onAddressSaved} onDeleted={onAddressDeleted} />
      )}
      {quizShown === true && (
        <QuizPage lang={lang} open={quizOpen === true} rows={quizRows} reduce={reduce} scoped config={quizConfig} backRef={quizBackRef}
          onClose={() => setQuizOpen(false)} onClosed={() => setQuizShown(false)}
          onOpenDish={(_p, id) => { setQuizOpen(false); setFocusReq({ id, n: Date.now() }) }}
          onOpenMenu={() => setQuizOpen(false)} onOpenBasket={() => { setQuizOpen(false); openBasket() }} />
      )}
      {ordering && !!optSheet.item && (
        <DishOptionsSheet visible={optSheet.open === true} lang={lang} item={optSheet.item} initial={optSheet.initial} editing={optSheet.fromKey != null}
          onClose={() => setOptSheet(o => ({ ...o, open: false }))} onConfirm={confirmOptions} />
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
  previewHint: { ...type.small, color: colors.textSecondary, textAlign: 'center' },
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
  itemPricePending: { ...type.small, color: colors.textSecondary, flexShrink: 0 },
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
  capPricePending: { ...type.small, color: colors.onPrimary, opacity: 0.75 },
})
