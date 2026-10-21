import { useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, Image, Pressable, ScrollView, Animated, Easing, AccessibilityInfo, findNodeHandle, StyleSheet, useWindowDimensions } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { t } from '../constants/i18n'
import { formatPrice } from '../constants/eatery'
import { QUIZ_STEPS, quizCandidates, quizBudgetBands, quizMatch, quizAmount } from '../constants/eateryQuiz'
import { colors, font, type, radii, space, elevation, press, motion, TAP } from '../constants/theme'
import { ScreenHeader, Card, Button, RemoteImage } from './ui'
import { EateryLogo, eateryImageUrl } from './EateryBits'

// ─── Yeme-İçme: "Ne yesem?" (dish finder) ───────────────────────────────────
// The matching is constants/eateryQuiz.js (pure, tested); this file is the entry card and the page. The page is a
// full-page layer like Sepetim: slides in, stays mounted until onClosed so back animates out. Defined outside the
// screen: these re-render on every tap and must not remount.

const OPTION_ICON = { on: 'radio-button-on', off: 'radio-button-off' }

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

function Option({ label, selected, onPress }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: selected, selected }} accessibilityLabel={label}
      style={({ pressed }) => [st.option, selected && st.optionOn, pressed && { opacity: press.card }]}>
      <Ionicons name={selected ? OPTION_ICON.on : OPTION_ICON.off} size={22} color={selected ? colors.primary : colors.textSecondary} />
      <Text style={[st.optionText, selected && st.optionTextOn]}>{label}</Text>
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

function ResultCard({ entry, companion, lang, onPress }) {
  const { item, partner } = entry
  const price = formatPrice(item.price, item.currency, lang)
  const pork = item.protein === 'pork'
  const side = companion
    ? (formatPrice(companion.item.price, companion.item.currency, lang)
      ? t('eateryQuizSide', lang).replace('{name}', () => companion.item.name).replace('{price}', () => formatPrice(companion.item.price, companion.item.currency, lang))
      : t('eateryQuizSideNoPrice', lang).replace('{name}', () => companion.item.name))
    : ''
  const label = [t('eateryQuizOpenA11y', lang).replace('{name}', () => item.name).replace('{partner}', () => partner.name), price, pork ? t('eateryQuizPork', lang) : '', side].filter(Boolean).join('. ')
  return (
    <Card onPress={onPress} accessibilityLabel={label} padding={space[12]}>
      <View style={st.resultRow}>
        <DishPhoto photoPath={item.photo_path} />
        <View style={st.resultText}>
          <Text style={st.dishName}>{item.name}</Text>
          <View style={st.partnerRow}>
            <EateryLogo partner={partner} width={20} height={20} radius={radii.pill} decorative />
            <Text style={st.partnerName} numberOfLines={1}>{partner.name}</Text>
          </View>
          {!!price && <Text style={st.price}>{price}</Text>}
          {pork && (
            <View style={st.pork}>
              <Ionicons name="alert-circle-outline" size={14} color={colors.dangerInk} />
              <Text style={st.porkText}>{t('eateryQuizPork', lang)}</Text>
            </View>
          )}
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
      </View>
      {!!side && (
        <View style={st.side}>
          <Ionicons name="add-circle-outline" size={18} color={colors.primaryDark} />
          <Text style={st.sideText}>{side}</Text>
        </View>
      )}
    </Card>
  )
}

const STEPS = [
  { key: 'protein', q: 'eateryQuizQ1', opts: [['chicken', 'eateryQuizChicken'], ['beef', 'eateryQuizBeef'], ['veg', 'eateryQuizVeg'], ['any', 'eateryQuizAny']] },
  { key: 'spicy',   q: 'eateryQuizQ2', opts: [['yes', 'eateryQuizYes'], ['no', 'eateryQuizNo'], ['any', 'eateryQuizAny']] },
  { key: 'portion', q: 'eateryQuizQ3', opts: [['snack', 'eateryQuizSnack'], ['meal', 'eateryQuizMeal'], ['share', 'eateryQuizShare']] },
  { key: 'budget',  q: 'eateryQuizQ4' },
  { key: 'extra',   q: 'eateryQuizQ5', opts: [['sauce', 'eateryQuizSauce'], ['drink', 'eateryQuizDrink'], ['dessert', 'eateryQuizDessert'], ['none', 'eateryQuizNone']] },
]
const RELAX_KEY = { budget: 'eateryQuizRelaxBudget', portion: 'eateryQuizRelaxPortion', spicy: 'eateryQuizRelaxSpicy' }

// rows: the visible partner rows (with tagged menu items). backRef: App's back chain asks here first (the page is a layer above the list).
export function QuizPage({ lang, open, rows, reduce, backRef, onClose, onClosed, onOpenDish }) {
  const insets = useSafeAreaInsets()
  const { width: winW } = useWindowDimensions()
  const [step, setStep] = useState(0)          // 0-4 = a question, 5 = the result
  const [answers, setAnswers] = useState({})
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

  const pick = (key, value) => {
    // An earlier answer changes what the later ones mean (budget bands follow Q1-Q3): everything after it is asked again.
    const idx = STEPS.findIndex(s => s.key === key)
    const next = { ...answers }
    STEPS.slice(idx + 1).forEach(s => { delete next[s.key] })
    next[key] = value
    setAnswers(next)
    setStep(idx + 1)
  }
  const retry = () => { setAnswers({}); setStep(0) }

  const cands = useMemo(() => quizCandidates(rows, answers), [rows, answers])
  const bands = useMemo(() => (step === 3 ? quizBudgetBands(cands) : []), [step, cands])
  const result = useMemo(() => (step >= QUIZ_STEPS ? quizMatch(rows, answers) : null), [step, rows, answers])
  const cur = STEPS[step]

  const budgetOptions = () => {
    const cur0 = cands[0]?.item.currency
    const a = n => quizAmount(n, cur0, lang)
    const label = b => b.key === 'low' ? t('eateryQuizBudgetLow', lang).replace('{a}', () => a(b.max))
      : b.key === 'mid' ? t('eateryQuizBudgetMid', lang).replace('{a}', () => a(b.min)).replace('{b}', () => a(b.max))
      : t('eateryQuizBudgetHigh', lang).replace('{a}', () => a(b.min))
    return [...bands.map(b => [b.key, label(b)]), ['any', t('eateryQuizAny', lang)]]
  }

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
        <ScrollView ref={scrollRef} style={st.scroll} contentContainerStyle={[st.content, { paddingBottom: insets.bottom + space[24] }]} showsVerticalScrollIndicator={false}>
          {cur ? (
            <>
              <Text ref={headRef} style={st.question} accessibilityRole="header">{t(cur.q, lang)}</Text>
              <View style={st.options} accessibilityRole="radiogroup">
                {(cur.key === 'budget' ? budgetOptions() : cur.opts.map(([v, k]) => [v, t(k, lang)])).map(([v, label]) => (
                  <Option key={v} label={label} selected={answers[cur.key] === v} onPress={() => pick(cur.key, v)} />
                ))}
              </View>
            </>
          ) : (
            <>
              <Text ref={headRef} style={st.question} accessibilityRole="header">{t('eateryQuizResultTitle', lang)}</Text>
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
                    {result?.dishes.map((d, i) => (
                      <ResultCard key={d.item.id} entry={d} lang={lang} companion={i === 0 ? result.companion : null} onPress={() => onOpenDish(d.partner, d.item.id)} />
                    ))}
                  </View>
                </>
              )}
              <Button variant="secondary" icon="refresh-outline" title={t('eateryQuizRetry', lang)} onPress={retry} fullWidth style={st.retry} />
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Animated.View>
  )
}

const st = StyleSheet.create({
  entry:      { flexDirection: 'row', alignItems: 'center', gap: space[12] },
  // 72 / 88 are content-driven, not tokens: Oli's artwork is mostly padding (72 box = ~25x48 visible), the photo box fits a 3-line dish name.
  mascot:     { width: 72, height: 72 },
  entryText:  { flex: 1 },
  entryTitle: { ...type.rowTitle, color: colors.textPrimary },
  entryBody:  { ...type.small, color: colors.textSecondary, marginTop: 2 },
  page:       { flex: 1, backgroundColor: colors.canvas },
  progress:   { flexShrink: 0, paddingHorizontal: space[16], paddingTop: space[4], gap: space[8] },
  dots:       { flexDirection: 'row', gap: space[4] },
  dot:        { flex: 1, height: 4, borderRadius: radii.pill, backgroundColor: colors.border },
  dotOn:      { backgroundColor: colors.primary },
  step:       { ...type.meta, color: colors.textSecondary },
  scroll:     { flex: 1 },
  content:    { paddingHorizontal: space[16], paddingTop: space[16], gap: space[16] },
  question:   { ...type.detailTitle, color: colors.textPrimary },
  options:    { gap: space[12] },
  option:     { minHeight: TAP + 12, flexDirection: 'row', alignItems: 'center', gap: space[12], paddingVertical: space[12], paddingHorizontal: space[16], borderRadius: radii.tile, backgroundColor: colors.card, ...elevation.card },
  optionOn:   { backgroundColor: colors.primaryLight },
  optionText: { flex: 1, ...type.sectionHeading, fontFamily: font.semibold, color: colors.textPrimary },
  optionTextOn: { color: colors.primaryDark },
  cards:      { gap: space[12] },
  resultRow:  { flexDirection: 'row', alignItems: 'center', gap: space[12] },
  photo:      { width: 88, height: 88, borderRadius: radii.md, overflow: 'hidden', backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  photoEmpty: { backgroundColor: colors.soft, borderWidth: 0 },
  fill:       { width: '100%', height: '100%' },
  resultText: { flex: 1, gap: 4 },
  dishName:   { ...type.rowTitle, color: colors.textPrimary },
  partnerRow: { flexDirection: 'row', alignItems: 'center', gap: space[8] },
  partnerName:{ flexShrink: 1, ...type.small, color: colors.textSecondary },
  price:      { ...type.body, fontFamily: font.semibold, fontVariant: ['tabular-nums'], color: colors.textPrimary },
  pork:       { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radii.pill, paddingHorizontal: space[8], paddingVertical: space[4], backgroundColor: colors.dangerLight },
  porkText:   { ...type.meta, color: colors.dangerInk, flexShrink: 1 },
  side:       { flexDirection: 'row', alignItems: 'center', gap: space[8], marginTop: space[12], paddingTop: space[12], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  sideText:   { flex: 1, ...type.small, color: colors.textPrimary },
  relaxed:    { flexDirection: 'row', alignItems: 'flex-start', gap: space[8], padding: space[12], borderRadius: radii.md, backgroundColor: colors.primaryLight },
  relaxedText:{ flex: 1, ...type.small, color: colors.primaryDark },
  empty:      { alignItems: 'center', paddingVertical: space[24], gap: space[12] },
  emptyText:  { ...type.body, color: colors.textSecondary, textAlign: 'center' },
  retry:      { marginTop: space[4] },
})
