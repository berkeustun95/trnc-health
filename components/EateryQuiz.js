import { useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, Image, Pressable, ScrollView, Animated, Easing, AccessibilityInfo, findNodeHandle, PixelRatio, StyleSheet, useWindowDimensions } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { t } from '../constants/i18n'
import { formatPrice, eateryOrderDigits } from '../constants/eatery'
import { QUIZ_STEPS, QUIZ_MULTI, quizToggle, quizMatch, quizSideOrderable, quizBasketSummary, quizBarPartner } from '../constants/eateryQuiz'
import { colors, font, type, radii, space, elevation, press, motion, TAP } from '../constants/theme'
import { ScreenHeader, Card, Button, RemoteImage, haptic } from './ui'
import { EateryLogo, eateryImageUrl } from './EateryBits'
import { QtyStepper, OrderBar } from './EateryOrder'
import { effectiveWhatsapp, getBasket, changeQty, getLastAdded } from '../utils/eateryBasket'
import { subscribe } from '../utils/eateryBasketCore'

// ─── Yeme-İçme: "Ne yesem?" (dish finder) ───────────────────────────────────
// The matching is constants/eateryQuiz.js (pure, tested); this file is the entry card and the page. The page is a
// full-page layer like Sepetim: slides in, stays mounted until onClosed so back animates out. Defined outside the
// screen: these re-render on every tap and must not remount.

// The quiz entry on a partner's own page: ADA chrome (soft teal band, no shadow), narrow on purpose: not a second hero.
export function PartnerQuizBanner({ lang, partnerName, onPress }) {
  const title = t('eateryQuizCardTitle', lang)
  const body = t('eateryQuizPartnerBanner', lang).replace('{partner}', () => partnerName)
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title} ${body}`}
      style={({ pressed }) => [st.banner, pressed && { opacity: press.card }]}>
      <Image source={require('../assets/oli-button.png')} style={st.bannerMascot} resizeMode="contain" accessibilityIgnoresInvertColors />
      <Text style={st.bannerText}><Text style={st.bannerLead}>{title}</Text> {body}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.primaryDark} />
    </Pressable>
  )
}

export function QuizEntryCard({ lang, onPress }) {
  const title = t('eateryQuizCardTitle', lang)
  const body = t('eateryQuizCardBody', lang)
  return (
    <Card onPress={onPress} accessibilityLabel={`${title}. ${body}`} padding={space[12]}>
      <View style={st.entry}>
        <Image source={require('../assets/oli-button.png')} style={st.mascot} resizeMode="contain" accessibilityIgnoresInvertColors />
        <View style={st.entryText}>
          <Text style={st.entryTitle}>{title}</Text>
          <Text style={st.entryBody}>{body}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
      </View>
    </Card>
  )
}

// One answer: a big tile with an emoji and a short label. Selected = check badge + primary border + primaryLight fill (never
// colour alone). Q2 is a radio, the multi-select questions are checkboxes. A tile the cap has locked stays tappable on
// purpose (the tap says "En fazla 2") but is dimmed and announced as disabled. The border is its own transparent-fill layer.
function Tile({ emoji, image, label, selected, locked, hint, role, onPress, cols }) {
  const row = cols === 1
  return (
    <Pressable onPress={onPress} accessibilityRole={role} accessibilityLabel={label} accessibilityHint={locked ? hint : undefined}
      accessibilityState={{ checked: selected }}
      style={({ pressed }) => [st.tile, row ? st.tileRow : st.tileCol, cols === 2 && st.tileHalf, selected && st.tileOn, locked && st.tileLocked, pressed && { opacity: press.card }]}>
      {image
        ? <Image source={image} style={[st.icon, locked && st.emojiLocked]} resizeMode="contain" accessible={false} importantForAccessibility="no" accessibilityElementsHidden accessibilityIgnoresInvertColors />
        : <Text style={[st.emoji, locked && st.emojiLocked]} accessibilityElementsHidden importantForAccessibility="no">{emoji}</Text>}
      <Text style={[st.tileText, selected && st.tileTextOn, locked && st.tileTextLocked]}>{label}</Text>
      {selected && (
        <View style={st.badge} accessible={false} importantForAccessibility="no-hide-descendants">
          <Ionicons name="checkmark" size={14} color={colors.onPrimary} />
        </View>
      )}
      {selected && <View style={st.tileBorder} pointerEvents="none" />}
    </Pressable>
  )
}

function Dots({ step }) {
  return (
    <View style={st.dots} accessible={false} importantForAccessibility="no-hide-descendants">
      {Array.from({ length: QUIZ_STEPS }, (_, i) => <View key={i} style={[st.dot, i <= step && st.dotOn]} />)}
    </View>
  )
}

function DishPhoto({ photoPath }) {
  const [failed, setFailed] = useState(false)
  const uri = eateryImageUrl(photoPath)
  const photo = !!uri && !failed
  return (
    <View style={[st.photo, !photo && st.photoEmpty]} accessible={false} importantForAccessibility="no-hide-descendants">
      {photo
        ? <RemoteImage source={{ uri }} resizeMode="contain" style={st.fill} placeholderColor={colors.card} onError={() => setFailed(true)} accessibilityIgnoresInvertColors />
        : <Ionicons name="restaurant-outline" size={28} color={colors.textSecondary} />}
    </View>
  )
}

// A pill with a fixed 44pt target; the label may wrap to two lines.
function PillButton({ icon, title, label, filled, onPress }) {
  return (
    <Pressable onPress={() => { try { haptic() } catch { /* never blocks the add */ } onPress?.() }} accessibilityRole="button" accessibilityLabel={label || title}
      style={({ pressed }) => [st.pill, filled ? st.pillFilled : st.pillOutline, pressed && { opacity: press.small }]}>
      <Ionicons name={icon} size={18} color={filled ? colors.onPrimary : colors.primaryDark} />
      <Text style={[st.pillText, filled && st.pillTextFilled]} numberOfLines={2}>{title}</Text>
    </Pressable>
  )
}

// Height 0 <-> content height over motion.base (instant with reduced motion). The content is measured from an absolutely
// placed copy, stays mounted while it animates out, and is hidden from screen readers while closed.
function Expand({ open, reduce, children }) {
  const [h, setH] = useState(0)
  const [mounted, setMounted] = useState(open)
  const v = useRef(new Animated.Value(0)).current
  useEffect(() => { if (open) setMounted(true) }, [open])
  useEffect(() => {
    if (!mounted || h === 0) return
    const to = open ? h : 0
    const done = () => { if (!open) setMounted(false) }
    if (reduce) { v.setValue(to); done(); return }
    Animated.timing(v, { toValue: to, duration: motion.base, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(({ finished }) => { if (finished) done() })
    return () => v.stopAnimation()
  }, [open, h, mounted, reduce])
  if (!mounted) return null
  return (
    <Animated.View style={{ height: v, overflow: 'hidden' }} {...(open ? null : { importantForAccessibility: 'no-hide-descendants', accessibilityElementsHidden: true })}>
      <View style={st.expandInner} onLayout={e => setH(Math.ceil(e.nativeEvent.layout.height))}>{children}</View>
    </Animated.View>
  )
}

// One "Yanına" line. A priced side is a 44pt toggle (the whole row): the plus adds one unit to the partner's basket, then
// it reads "Eklendi" and a second tap takes that one unit off again. A side that cannot be ordered stays a plain line.
function SideRow({ item, text, qty, orderable, lang, onToggle }) {
  if (!orderable) {
    return (
      <View style={st.sideRow}>
        <Ionicons name="add-circle-outline" size={18} color={colors.primaryDark} />
        <Text style={st.sideText}>{text}</Text>
      </View>
    )
  }
  const added = qty > 0
  return (
    <Pressable onPress={onToggle} style={({ pressed }) => [st.sideRow, st.sideTap, pressed && { opacity: press.small }]} accessibilityRole="button"
      accessibilityLabel={added ? t('eateryQuizSideRemoveA11y', lang).replace('{name}', () => item.name) : `${t('eateryOrderAddA11y', lang).replace('{name}', () => item.name)}. ${text}`}>
      <Ionicons name={added ? 'checkmark-circle' : 'add-circle-outline'} size={22} color={colors.primaryDark} />
      <Text style={st.sideText}>{text}</Text>
      {added && <Text style={st.sideAdded}>{t('eateryQuizSideAdded', lang)}</Text>}
    </Pressable>
  )
}

function ResultCard({ entry, lang, canOrder, basket, reduce, scoped, onPress, onOpenPartner, onQty }) {
  const { item, partner, companions } = entry
  const price = formatPrice(item.price, item.currency, lang)
  const pork = item.protein === 'pork'
  const sideItems = (companions || []).map(c => c.item)
  const sides = sideItems.map(i => {
    const p = formatPrice(i.price, i.currency, lang)
    return p ? `${i.name} · ${p}` : i.name
  })
  const label = [t('eateryQuizOpenA11y', lang).replace('{name}', () => item.name).replace('{partner}', () => partner.name), price, pork ? t('eateryQuizPork', lang) : ''].filter(Boolean).join('. ')
  const sideOk = sideItems.map(i => canOrder && quizSideOrderable(i))
  const qty = basket[item.id] || 0
  // The sides open once THIS dish is in the basket, and fold away when it goes back to 0 (sides already added stay).
  const showSides = canOrder && qty > 0 && sides.length > 0
  const wasOpen = useRef(showSides)
  useEffect(() => {
    if (showSides && !wasOpen.current) AccessibilityInfo.announceForAccessibility?.(t('eateryQuizSidesTitle', lang))
    wasOpen.current = showSides
  }, [showSides])
  return (
    <Card padding={space[12]}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [st.resultRow, pressed && { opacity: press.card }]}>
        <DishPhoto photoPath={item.photo_path} />
        <View style={st.resultText}>
          <Text style={st.dishName}>{item.name}</Text>
          {!!price && <Text style={st.price}>{price}</Text>}
          {pork && (
            <View style={st.pork}>
              <Ionicons name="alert-circle-outline" size={14} color={colors.dangerInk} />
              <Text style={st.porkText}>{t('eateryQuizPork', lang)}</Text>
            </View>
          )}
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
      </Pressable>
      {!scoped && <Pressable onPress={onOpenPartner} accessibilityRole="button" accessibilityLabel={t('eateryQuizPartnerA11y', lang).replace('{partner}', () => partner.name)}
        style={({ pressed }) => [st.partnerRow, pressed && { opacity: press.small }]}>
        <EateryLogo partner={partner} width={20} height={20} radius={radii.pill} decorative />
        <Text style={st.partnerName} numberOfLines={1}>{partner.name}</Text>
        <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
      </Pressable>}
      {canOrder && (
        <View style={st.orderRow}>
          {qty < 1
            ? <PillButton filled icon="basket-outline" title={t('eateryQuizAddToBasket', lang)}
                label={t('eateryOrderAddA11y', lang).replace('{name}', () => item.name)} onPress={() => onQty(partner, item.id, 1)} />
            : <QtyStepper id={item.id} name={item.name} qty={qty} onQty={(id, d) => onQty(partner, id, d)} lang={lang} />}
        </View>
      )}
      {sides.length > 0 && (
        <Expand open={showSides} reduce={reduce}>
          <View style={st.side}>
            <Text style={st.sidesTitle} accessibilityRole="header">{t('eateryQuizSidesTitle', lang)}</Text>
            {sides.map((line, k) => (
              <SideRow key={sideItems[k].id} item={sideItems[k]} text={line} qty={basket[sideItems[k].id] || 0} orderable={sideOk[k]} lang={lang}
                onToggle={() => onQty(partner, sideItems[k].id, (basket[sideItems[k].id] || 0) > 0 ? -1 : 1)} />
            ))}
          </View>
        </Expand>
      )}
    </Card>
  )
}

// kind 'multi' = checkboxes (QUIZ_MULTI holds the cap and the exclusive tile), 'single' = radios.
const STEPS = [
  { key: 'protein', kind: 'multi', q: 'eateryQuizQ1', hint: 'eateryQuizHintMax2', opts: [['chicken', 'eateryQuizChicken', '🍗'], ['beef', 'eateryQuizBeef', '🥩'], ['veg', 'eateryQuizVeg', '🥗'], ['any', 'eateryQuizAny', '🤷']] },
  { key: 'spicy',   kind: 'single', q: 'eateryQuizQ2', opts: [['yes', 'eateryQuizYes', '🌶️'], ['no', 'eateryQuizNo', '😌'], ['any', 'eateryQuizAny', '🤷']] },
  { key: 'portion', kind: 'multi', q: 'eateryQuizQ3', hint: 'eateryQuizHintMax2', opts: [['snack', 'eateryQuizSnack', null, require('../assets/eatery-quiz/snack.png')], ['meal', 'eateryQuizMeal', null, require('../assets/eatery-quiz/meal.png')], ['share', 'eateryQuizShare', null, require('../assets/eatery-quiz/share.png')]] },
  { key: 'extra',   kind: 'multi', q: 'eateryQuizQ4', hint: 'eateryQuizHintAny', opts: [['sauce', 'eateryQuizSauce', '🥫'], ['drink', 'eateryQuizDrink', '🥤'], ['dessert', 'eateryQuizDessert', '🍰'], ['none', 'eateryQuizNone', '🚫']] },
]
const RELAX_KEY = { portion: 'eateryQuizRelaxPortion', spicy: 'eateryQuizRelaxSpicy' }

// rows: the visible partner rows (with tagged menu items). backRef: App's back chain asks here first (the page is a layer above the list).
// scoped: rows is ONE partner (the quiz opened from that partner's own page): its cards drop the partner row and "Menüyü gör" is the caller's close.
export function QuizPage({ lang, open, rows, reduce, scoped = false, backRef, onClose, onClosed, onOpenDish, onOpenMenu, onOpenBasket }) {
  const insets = useSafeAreaInsets()
  const { width: winW } = useWindowDimensions()
  const width = winW
  const [step, setStep] = useState(0)          // 0-4 = a question, 5 = the result
  const [answers, setAnswers] = useState({ protein: [], portion: [], extra: [] })
  const scrollRef = useRef(null)

  const slide = useRef(new Animated.Value(reduce ? 0 : winW)).current
  const first = useRef(true)
  useEffect(() => {
    const to = open ? 0 : winW
    const done = () => { if (!open) onClosed?.() }
    if (reduce) { slide.setValue(to); done(); return }
    if (first.current && open) slide.setValue(winW)
    first.current = false
    Animated.timing(slide, { toValue: to, duration: open ? motion.sheetIn : motion.sheetOut,
      easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic), useNativeDriver: true }).start(done)
  }, [open])

  const goBack = () => { if (step > 0) setStep(step - 1); else onClose() }
  useEffect(() => {
    if (!backRef || !open) return
    const mine = () => { goBack(); return true }
    backRef.current = mine
    return () => { if (backRef.current === mine) backRef.current = null }
  })
  const headRef = useRef(null)
  const focusReady = useRef(false)
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false })
    if (!focusReady.current) { focusReady.current = true; return }   // mount: the page's own entrance, nothing to move
    const id = setTimeout(() => {   // after layout: the new header exists
      const h = headRef.current && findNodeHandle(headRef.current)
      if (h) AccessibilityInfo.setAccessibilityFocus(h)
    }, 150)
    return () => clearTimeout(id)
  }, [step])

  const [capHit, setCapHit] = useState(false)
  useEffect(() => { setCapHit(false) }, [step])
  const tap = (cur, value) => {
    if (cur.kind === 'single') { setAnswers(a => ({ ...a, [cur.key]: value })); return }
    const { next, blocked } = quizToggle(cur.key, answers[cur.key], value)
    if (blocked) {
      setCapHit(true)
      AccessibilityInfo.announceForAccessibility?.(t('eateryQuizHintMax2', lang))
      return
    }
    setCapHit(false)
    setAnswers(a => ({ ...a, [cur.key]: next }))
  }
  const retry = () => { setAnswers({ protein: [], portion: [], extra: [] }); setStep(0) }

  const result = useMemo(() => (step >= QUIZ_STEPS ? quizMatch(rows, answers) : null), [step, rows, answers])

  // Results basket: the SAME per-partner store the menu page uses, so edits made there (clear after sending, undo, the
  // stepper) show here: any store change re-renders this page, which reads the baskets fresh.
  const [, setTick] = useState(0)
  useEffect(() => subscribe(() => setTick(n => n + 1)), [])
  const canOrder = p => !!eateryOrderDigits(effectiveWhatsapp(p))
  const onQty = (p, id, delta) => {
    changeQty(p.id, id, delta)
  }
  const resultPartners = result ? result.dishes.map(d => d.partner).filter((p, i, a) => a.findIndex(x => x.id === p.id) === i && canOrder(p)) : []
  const barPartner = quizBarPartner(resultPartners, p => quizBasketSummary(p, getBasket(p.id)), getLastAdded())
  const bar = barPartner ? quizBasketSummary(barPartner, getBasket(barPartner.id)) : null
  const cur = STEPS[step]
  const showBar = !cur && !!bar
  const picked = cur ? answers[cur.key] : null
  const canNext = !!cur && (cur.kind === 'single' ? !!picked : !!picked?.length)
  const cols = width < 340 || PixelRatio.getFontScale() >= 1.3 ? 1 : 2
  const tileW = cols === 2 ? Math.floor((width - space[16] * 2 - space[12]) / 2) : null

  return (
    <Animated.View collapsable={false} style={[StyleSheet.absoluteFill, { transform: [{ translateX: slide }] }]} accessibilityViewIsModal>
      <SafeAreaView style={st.page} edges={['top']}>
        <ScreenHeader lang={lang} title={t('eateryQuizCardTitle', lang)} onBack={goBack} />
        <View style={st.progress}>
          <Dots step={step} />
          {!!cur && (
            <Text style={st.step} accessibilityLiveRegion="polite">
              {t('eateryQuizStep', lang).replace('{n}', () => String(step + 1)).replace('{total}', () => String(QUIZ_STEPS))}
            </Text>
          )}
        </View>
        <ScrollView ref={scrollRef} style={st.scroll} contentContainerStyle={[st.content, { paddingBottom: showBar ? space[24] : insets.bottom + space[24] }]} showsVerticalScrollIndicator={false}>
          {cur ? (
            <>
              <View style={st.qRow}>
                <Image source={require('../assets/oli-button.png')} style={st.qMascot} resizeMode="contain" accessibilityIgnoresInvertColors />
                <Text ref={headRef} style={st.question} accessibilityRole="header">{t(cur.q, lang)}</Text>
              </View>
              {!!cur.hint && (
                <Text style={[st.hint, capHit && st.hintHit]} accessibilityLiveRegion="polite">{t(cur.hint, lang)}</Text>
              )}
              <View style={[st.grid, cols === 2 && st.gridWrap]} accessibilityRole={cur.kind === 'single' ? 'radiogroup' : undefined} accessibilityLabel={t(cur.q, lang)}>
                {cur.opts.map(([v, k, emoji, image]) => {
                  const sel = cur.kind === 'single' ? picked === v : picked.includes(v)
                  const max = cur.kind === 'multi' ? QUIZ_MULTI[cur.key].max : null
                  const locked = !!max && !sel && picked.length >= max
                  return (
                    <View key={v} style={tileW ? { width: tileW } : st.fullW}>
                      <Tile emoji={emoji} image={image} label={t(k, lang)} selected={sel} locked={locked} hint={t('eateryQuizHintMax2', lang)}
                        role={cur.kind === 'single' ? 'radio' : 'checkbox'} cols={cols} onPress={() => tap(cur, v)} />
                    </View>
                  )
                })}
              </View>
            </>
          ) : (
            <>
              <Text ref={headRef} style={[st.question, { flex: 0 }]} accessibilityRole="header">{t('eateryQuizResultTitle', lang)}</Text>
              {!!result && result.dishes.length === 0 ? (
                <View style={st.empty}>
                  <Ionicons name="restaurant-outline" size={44} color={colors.textSecondary} />
                  <Text style={st.emptyText}>{t('eateryQuizEmpty', lang)}</Text>
                </View>
              ) : (
                <>
                  {!!result && result.relaxed.length > 0 && (
                    <View style={st.relaxed}>
                      <Ionicons name="information-circle-outline" size={18} color={colors.primaryDark} />
                      <Text style={st.relaxedText}>{t('eateryQuizRelaxed', lang).replace('{what}', () => result.relaxed.map(k => t(RELAX_KEY[k], lang)).join(', '))}</Text>
                    </View>
                  )}
                  <View style={st.cards}>
                    {result?.dishes.map(d => (
                      <ResultCard key={d.item.id} entry={d} lang={lang} reduce={reduce}
                        canOrder={canOrder(d.partner)} basket={getBasket(d.partner.id)} onQty={onQty} scoped={scoped}
                        onPress={() => onOpenDish(d.partner, d.item.id)} onOpenPartner={() => onOpenMenu(d.partner)} />
                    ))}
                  </View>
                </>
              )}
              {!!result && result.dishes.length > 0 && (
                <Button variant="secondary" icon="restaurant-outline" title={t('eateryQuizViewMenu', lang)} onPress={() => onOpenMenu(result.dishes[0].partner)} fullWidth style={st.retry} />
              )}
              <Button variant="text" icon="refresh-outline" title={t('eateryQuizRetry', lang)} onPress={retry} fullWidth style={st.retry} />
            </>
          )}
        </ScrollView>
        {showBar && (
          <OrderBar count={bar.count} totalText={formatPrice(bar.total, bar.currency, lang)} lang={lang} partnerName={barPartner.name} onOpen={() => onOpenBasket(barPartner)} />
        )}
        {!!cur && (
          <View style={[st.footer, { paddingBottom: insets.bottom + space[12] }]}>
            <Button fullWidth title={t(step === QUIZ_STEPS - 1 ? 'eateryQuizSeeResults' : 'eateryQuizNext', lang)} disabled={!canNext} disabledHint={t('eateryQuizPickOne', lang)} onPress={() => setStep(step + 1)} />
          </View>
        )}
      </SafeAreaView>
    </Animated.View>
  )
}

const st = StyleSheet.create({
  entry:      { flexDirection: 'row', alignItems: 'center', gap: space[12] },
  // 72 / 88 are content-driven, not tokens: Oli's artwork is mostly padding (72 box = ~25x48 visible), the photo box fits a 3-line dish name.
  mascot:     { width: 72, height: 72 },
  banner:     { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: space[8], paddingVertical: space[4], paddingLeft: space[8], paddingRight: space[12], borderRadius: radii.sm, backgroundColor: colors.primaryLight },
  bannerMascot:{ width: 56, height: 56 },   // the artwork is mostly padding: a 44 box shows a ~15x29 figure
  bannerText: { flex: 1, ...type.small, color: colors.primaryDark },
  bannerLead: { fontFamily: font.semibold },
  entryText:  { flex: 1 },
  entryTitle: { ...type.rowTitle, color: colors.textPrimary },
  entryBody:  { ...type.small, color: colors.textSecondary, marginTop: 2 },
  page:       { flex: 1, backgroundColor: colors.canvas },
  progress:   { flexShrink: 0, backgroundColor: colors.canvas, zIndex: 1, paddingHorizontal: space[16], paddingTop: space[4], paddingBottom: space[12], gap: space[8] },
  dots:       { flexDirection: 'row', gap: space[4] },
  dot:        { flex: 1, height: 4, borderRadius: radii.pill, backgroundColor: colors.border },
  dotOn:      { backgroundColor: colors.primary },
  step:       { ...type.meta, color: colors.textSecondary },
  scroll:     { flex: 1 },
  content:    { paddingHorizontal: space[16], paddingTop: space[4], gap: space[16] },
  question:   { flex: 1, ...type.detailTitle, color: colors.textPrimary },
  qRow:       { flexDirection: 'row', alignItems: 'center', gap: space[12] },
  qMascot:    { width: 56, height: 56, flexShrink: 0 },
  hint:       { ...type.small, color: colors.textSecondary, marginTop: -space[8] },
  hintHit:    { color: colors.dangerInk, fontFamily: font.semibold },
  grid:       { gap: space[12] },
  gridWrap:   { flexDirection: 'row', flexWrap: 'wrap' },
  fullW:      { width: '100%' },
  tile:       { minHeight: TAP + 20, borderRadius: radii.tile, backgroundColor: colors.card, padding: space[16], ...elevation.card },
  tileCol:    { justifyContent: 'center', gap: space[8], minHeight: 112 },
  tileHalf:   { flex: 1 },
  tileRow:    { flexDirection: 'row', alignItems: 'center', gap: space[16] },
  tileOn:     { backgroundColor: colors.primaryLight },
  tileLocked: { backgroundColor: colors.soft },
  emojiLocked:{ opacity: 0.5 },
  tileTextLocked: { color: colors.textSecondary },
  tileBorder: { ...StyleSheet.absoluteFillObject, borderRadius: radii.tile, borderWidth: 2, borderColor: colors.primary, backgroundColor: 'transparent' },
  icon:       { width: 40, height: 40, marginVertical: 1 },   // emoji line box is 38 tall: the Q3 icons sit in the same row height
  emoji:      { fontSize: 30, lineHeight: 38 },
  tileText:   { ...type.rowTitle, color: colors.textPrimary },
  tileTextOn: { color: colors.primaryDark },
  badge:      { position: 'absolute', top: space[8], right: space[8], width: 22, height: 22, borderRadius: radii.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  footer:     { flexShrink: 0, backgroundColor: colors.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingHorizontal: space[16], paddingTop: space[12] },
  cards:      { gap: space[12] },
  resultRow:  { flexDirection: 'row', alignItems: 'center', gap: space[12] },
  photo:      { width: 88, height: 88, borderRadius: radii.md, overflow: 'hidden', backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  photoEmpty: { backgroundColor: colors.soft, borderWidth: 0 },
  fill:       { width: '100%', height: '100%' },
  resultText: { flex: 1, gap: 4 },
  dishName:   { ...type.rowTitle, color: colors.textPrimary },
  partnerRow: { minHeight: TAP, flexDirection: 'row', alignItems: 'center', gap: space[8], marginTop: space[4] },
  partnerName:{ flexShrink: 1, ...type.small, color: colors.textSecondary },
  price:      { ...type.body, fontFamily: font.semibold, fontVariant: ['tabular-nums'], color: colors.textPrimary },
  pork:       { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radii.pill, paddingHorizontal: space[8], paddingVertical: space[4], backgroundColor: colors.dangerLight },
  porkText:   { ...type.meta, color: colors.dangerInk, flexShrink: 1 },
  side:       { gap: space[4], marginTop: space[12], paddingTop: space[12], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  sideRow:    { flexDirection: 'row', alignItems: 'center', gap: space[8] },
  sideText:   { flex: 1, ...type.small, color: colors.textPrimary },
  relaxed:    { flexDirection: 'row', alignItems: 'flex-start', gap: space[8], padding: space[12], borderRadius: radii.md, backgroundColor: colors.primaryLight },
  relaxedText:{ flex: 1, ...type.small, color: colors.primaryDark },
  empty:      { alignItems: 'center', paddingVertical: space[24], gap: space[12] },
  emptyText:  { ...type.body, color: colors.textSecondary, textAlign: 'center' },
  retry:      { marginTop: space[4] },
  pill:       { alignSelf: 'flex-start', minHeight: TAP, paddingHorizontal: space[16], flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[4], borderRadius: radii.pill },
  pillFilled: { backgroundColor: colors.primary },
  pillOutline:{ borderWidth: 1.5, borderColor: colors.primary, backgroundColor: 'transparent' },
  expandInner:{ position: 'absolute', top: 0, left: 0, right: 0 },
  sidesTitle: { ...type.rowTitle, color: colors.textPrimary },
  pillText:   { ...type.body, fontFamily: font.semibold, color: colors.primaryDark, flexShrink: 1, textAlign: 'center' },
  pillTextFilled: { color: colors.onPrimary },
  orderRow:   { alignItems: 'flex-start', marginTop: space[8] },
  sideTap:    { minHeight: TAP },
  sideAdded:  { ...type.small, fontFamily: font.semibold, color: colors.primaryDark },
})
