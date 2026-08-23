import { useState, useEffect } from 'react'
import {
  View, Text, TouchableOpacity, ActivityIndicator, ScrollView, StyleSheet, TextInput,
  useWindowDimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Ionicons } from '@expo/vector-icons'
import PageBackground from '../components/PageBackground'
import ScreenHeader from '../components/ScreenHeader'
import MascotIntroCard from '../components/MascotIntroCard'
import { colors, shadow, radius } from '../constants/theme'
import { t } from '../constants/i18n'

// New cache key: the KKTC payload shape differs from the old Frankfurter one,
// so a fresh key avoids parsing a stale incompatible cache after the OTA.
const FX_CACHE_KEY = 'ada_kktc_fx_cache_v1'

// ─── PINNED SCHEMA — KKTC Merkez Bankası daily FX feed ──────────────────────
// Source: https://www.mb.gov.ct.tr/kur/gunluk.xml  (official TRNC Central Bank,
// public, no API key, XML published since 2011). Parsed with regex against a
// FIXED, government-controlled flat schema — deliberately no XML library.
// Header:   <Kur_Tarihi> DD/MM/YYYY   <Gecerli_Tarih_Araligi> single date OR
//           "DD/MM/YYYY - DD/MM/YYYY" (weekends/holidays span a range).
// Per row:  <Resmi_Kur> … <Birim> <Sembol> <Doviz_Alis> <Doviz_Satis>
//           <Efektif_Alis> <Efektif_Satis> … </Resmi_Kur>
// If parseKktcFx() starts returning null, these element names likely changed —
// diff against a fresh fetch of the URL above to diagnose.
const FX_URL = 'https://www.mb.gov.ct.tr/kur/gunluk.xml'

// Display order + flags. Adding a currency = one entry here (parser is generic).
const PAIRS = [
  { code: 'USD', flag: '🇺🇸' },
  { code: 'GBP', flag: '🇬🇧' },
  { code: 'EUR', flag: '🇪🇺' },
]
const WANTED = PAIRS.map(p => p.code)
const TRY_PAIR = { code: 'TRY', flag: '🇹🇷' }

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))
  return m ? m[1].trim() : null
}

function parseKktcFx(xml) {
  if (!xml) return null
  const date = tag(xml, 'Kur_Tarihi')
  const validRange = tag(xml, 'Gecerli_Tarih_Araligi')
  const rates = {}
  const blocks = xml.match(/<Resmi_Kur>[\s\S]*?<\/Resmi_Kur>/g) || []
  for (const block of blocks) {
    const sym = tag(block, 'Sembol')
    if (!sym || !WANTED.includes(sym)) continue
    // Birim is the unit multiplier (e.g. JPY quotes per 100). Always divide so
    // adding a Birim>1 currency later can never silently produce a 100× value.
    const birim = parseFloat(tag(block, 'Birim')) || 1
    const num = name => {
      const v = parseFloat(tag(block, name))
      return Number.isFinite(v) ? v / birim : null
    }
    rates[sym] = {
      dovizAlis:    num('Doviz_Alis'),
      dovizSatis:   num('Doviz_Satis'),
      efektifAlis:  num('Efektif_Alis'),
      efektifSatis: num('Efektif_Satis'),
    }
  }
  if (!date || Object.keys(rates).length === 0) return null
  return { date, validRange, rates }
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

// ─── Converter helpers ───────────────────────────────────────────────────────
// The cap is a domain limit, not a display one — the rows step their font size
// down (see amountFontSize) rather than clip, so the ceiling is free to be as
// large as the currency needs. TRY devalues continuously and it is the side that
// needs the digits: 1,000,000 GBP is unrealistic, 1,000,000 TRY is about 20k.
const MAX_AMOUNT = 999999999.99
const MAX_INT_DIGITS = String(Math.floor(MAX_AMOUNT)).length // 9

// Measured, not estimated: SFNS.ttf instanced at wght 700 / opsz 22 with the tnum
// glyphs both rows select via fontVariant: ['tabular-nums'] — every digit advances
// 0.6587em (1349/2048), separators 0.2915em. Roboto 700 (Android) is ~12% narrower
// at 0.5737em, so sizing to SF Pro fits both platforms.
const DIGIT_EM = 0.6587
const SEP_EM = 0.2915

// Everything horizontal between the screen edge and the number: bodyContent
// paddingHorizontal 16x2, calcCard padding 16x2, calcField borderWidth 1.5x2,
// calcField paddingHorizontal 14x2, calcFieldCurr minWidth 78, calcField gap 12.
// Six terms; change any of them and change this with them. calcFieldCurr's own
// gap: 8 is internal to its minWidth and is deliberately NOT counted again.
const FIELD_CHROME = 185
const SIZE_STEPS = [22, 20, 18, 17, 16, 15, 14]

// Weighted by glyph, not by length: a 14-char result carries three separators and
// is ~24dp narrower than 14 all-digit characters, so sizing on length alone either
// wastes size or clips. adjustsFontSizeToFit is deliberately avoided — unreliable
// on Android. The 2dp margin keeps the longest reachable result off a knife edge
// (53,999,999,999.99 lands on 175.15dp at 18pt against 175dp available).
function amountFontSize(str, avail) {
  let w = 0
  for (const ch of str) w += ch >= '0' && ch <= '9' ? DIGIT_EM : SEP_EM
  return SIZE_STEPS.find(sz => w * sz <= avail - 2) ?? SIZE_STEPS[SIZE_STEPS.length - 1]
}

// Digits left of the separator, leading zeros ignored ("007" is one digit).
function intDigits(v) {
  return v.split('.')[0].replace(/^0+(?=\d)/, '').length
}

// A decimal-pad shows "," on Turkish/European devices and "." on others, so both
// arrive here; normalise to "." and keep only the first one.
function sanitizeAmount(raw) {
  let v = raw.replace(/,/g, '.').replace(/[^0-9.]/g, '')
  const first = v.indexOf('.')
  if (first !== -1) v = v.slice(0, first + 1) + v.slice(first + 1).replace(/\./g, '')
  const [int, dec] = v.split('.')
  v = dec === undefined ? int : `${int}.${dec.slice(0, 2)}`
  // Clamp, never slice. Slicing an over-cap value drops it by a power of ten and
  // the result still looks like a real number (399999960.00 -> 3999999.00).
  const n = parseFloat(v)
  return Number.isFinite(n) && n > MAX_AMOUNT ? MAX_AMOUNT.toFixed(2) : v
}

// Only an append at the cap is a no-op — once 7 integer digits are on screen the
// next keystroke is dropped rather than rewriting the field to 9999999.99. A
// replacing paste does not extend the previous value, so it clamps like any other
// over-cap value. The at-cap test is what makes that split work: startsWith is
// trivially true against an empty field, so without it a paste into a blank input
// would read as an append and be swallowed.
function nextAmount(prev, raw) {
  const norm = raw.replace(/,/g, '.').replace(/[^0-9.]/g, '')
  const overflow = intDigits(norm) > MAX_INT_DIGITS
  const isAppend = norm.startsWith(prev) && norm.length > prev.length
  return overflow && isAppend && intDigits(prev) >= MAX_INT_DIGITS ? prev : sanitizeAmount(raw)
}

// Dot decimal + comma grouping in every language, deliberately: the rates table
// directly below is not localised either, and two number conventions on one
// screen read as a bug.
function formatMoney(n) {
  const [int, dec] = n.toFixed(2).split('.')
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec}`
}

// The maths uses the feed's full precision, so the "1 USD = …" line must show it
// too — rounded to the table's 2 dp, a user checking by hand would find the
// result off. Trailing zeros trimmed below 4 dp, never below 2.
function formatRate(n) {
  return n.toFixed(4).replace(/(\.\d{2}\d*?)0+$/, '$1')
}

async function fetchKktcFx() {
  const resp = await fetch(FX_URL)
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const xml = await resp.text()
  const parsed = parseKktcFx(xml)
  if (!parsed) throw new Error('parse failed')
  return { ...parsed, fetchedOn: todayStr() }
}

export default function ExchangeRatesScreen({ lang, onBack }) {
  // cacheData shape: { date, validRange, rates: { USD, GBP, EUR }, fetchedOn }
  const [cacheData, setCacheData]     = useState(null)
  const [loading, setLoading]         = useState(true)
  const [fetchFailed, setFetchFailed] = useState(false)
  const [mode, setMode]               = useState('efektif') // 'efektif' (cash) | 'doviz' (transfer)
  const [calcCurrency, setCalcCurrency] = useState('USD')
  const [calcDir, setCalcDir]           = useState('toTry')  // 'toTry' | 'toForeign'
  const [amount, setAmount]             = useState('')
  const { width: winWidth }             = useWindowDimensions()

  useEffect(() => {
    let cancelled = false

    async function load() {
      let cache = null
      try {
        const raw = await AsyncStorage.getItem(FX_CACHE_KEY)
        if (raw) cache = JSON.parse(raw)
      } catch (_) {}

      if (cache && cache.fetchedOn === todayStr()) {
        if (!cancelled) { setCacheData(cache); setLoading(false) }
        return
      }

      try {
        const fresh = await fetchKktcFx()
        await AsyncStorage.setItem(FX_CACHE_KEY, JSON.stringify(fresh))
        if (!cancelled) { setCacheData(fresh); setLoading(false) }
      } catch (_) {
        if (!cancelled) {
          setCacheData(cache)
          setFetchFailed(true)
          setLoading(false)
        }
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  async function retry() {
    setLoading(true)
    setFetchFailed(false)
    try {
      const fresh = await fetchKktcFx()
      await AsyncStorage.setItem(FX_CACHE_KEY, JSON.stringify(fresh))
      setCacheData(fresh)
    } catch (_) {
      setFetchFailed(true)
    } finally {
      setLoading(false)
    }
  }

  const hasData = cacheData?.rates != null
  const isStale = fetchFailed && hasData
  const noData  = fetchFailed && !hasData

  const isRange = typeof cacheData?.validRange === 'string' && cacheData.validRange.includes(' - ')

  function formatVal(code) {
    const r = cacheData?.rates?.[code]
    if (!r) return { buy: '—', sell: '—' }
    const buy  = mode === 'efektif' ? r.efektifAlis  : r.dovizAlis
    const sell = mode === 'efektif' ? r.efektifSatis : r.dovizSatis
    const fmt = v => v == null ? '—' : v.toFixed(2)
    return { buy: fmt(buy), sell: fmt(sell) }
  }

  // An exchange office BUYS the foreign currency you hand over (alış) and SELLS
  // it to you when you pay in lira (satış) — so direction picks the rate, and the
  // cash/transfer toggle above picks the column. Computed from the raw feed
  // values, never the 2-dp strings the table renders.
  const calcPair = PAIRS.find(p => p.code === calcCurrency)
  const calcRow  = cacheData?.rates?.[calcCurrency]
  const calcRate = calcDir === 'toTry'
    ? (mode === 'efektif' ? calcRow?.efektifAlis  : calcRow?.dovizAlis)
    : (mode === 'efektif' ? calcRow?.efektifSatis : calcRow?.dovizSatis)
  const calcAmt = parseFloat(amount)
  const calcResult = (!Number.isFinite(calcAmt) || !calcRate)
    ? null
    : (calcDir === 'toTry' ? calcAmt * calcRate : calcAmt / calcRate)
  const fromPair = calcDir === 'toTry' ? calcPair : TRY_PAIR
  const toPair   = calcDir === 'toTry' ? TRY_PAIR : calcPair

  // Sized independently per row. A shared size would shrink a short input just
  // because its result is long, which reads as a bug with nothing on screen to
  // explain it. Two rows at different sizes is ordinary.
  const resultText   = calcResult == null ? '—' : formatMoney(calcResult)
  const fieldAvail   = winWidth - FIELD_CHROME
  const inputFontSz  = amountFontSize(amount || '0', fieldAvail)
  const resultFontSz = amountFontSize(resultText, fieldAvail)

  // Carry the plain fixed-point value, NOT formatMoney() — its thousands commas
  // would be re-read as decimal separators by sanitizeAmount. Routed through
  // sanitizeAmount so an over-cap result clamps here, visibly, instead of sitting
  // in the field until the next keystroke silently drops it by a power of ten.
  function swapDirection() {
    setAmount(Number.isFinite(calcResult) ? sanitizeAmount(calcResult.toFixed(2)) : '')
    setCalcDir(d => (d === 'toTry' ? 'toForeign' : 'toTry'))
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <PageBackground topic="exchange_rates" />
      <ScreenHeader onBack={onBack} lang={lang} />

      <MascotIntroCard
        module="exchange"
        title={t('fxTitle', lang)}
        subtitle={t('fxSubtitle', lang)}
        style={s.introCard}
      />

      {loading && (
        <View style={s.center}>
          <View style={s.stateCard}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={s.loadingText}>{t('fxLoading', lang)}</Text>
          </View>
        </View>
      )}

      {!loading && noData && (
        <View style={s.center}>
          <View style={s.stateCard}>
            <Ionicons name="cloud-offline-outline" size={48} color={colors.textSecondary} />
            <Text style={s.noDataTitle}>{t('fxNoData', lang)}</Text>
            <Text style={s.noDataDetail}>{t('fxNoDataDetail', lang)}</Text>
            <TouchableOpacity style={s.retryBtn} onPress={retry} activeOpacity={0.8}>
              <Text style={s.retryBtnText}>{t('fxRetry', lang)}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {!loading && hasData && (
        <ScrollView
          style={s.body}
          contentContainerStyle={s.bodyContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {isStale && (
            <View style={s.offlineBanner}>
              <Ionicons name="information-circle-outline" size={16} color={colors.accent} style={{ marginTop: 1 }} />
              <Text style={s.offlineBannerText}>{t('fxOfflineBanner', lang)}</Text>
            </View>
          )}

          <View style={s.dateHeader}>
            <Text style={s.officialLabel}>{t('fxOfficialRate', lang)}</Text>
            <Text style={s.dateValue}>{cacheData.date}</Text>
            {isRange && (
              <Text style={s.rangeLabel}>{t('fxValidRange', lang)} {cacheData.validRange}</Text>
            )}
          </View>

          <View style={s.toggleRow}>
            <TouchableOpacity
              style={[s.toggleChip, mode === 'efektif' && s.toggleChipActive]}
              onPress={() => setMode('efektif')}
              activeOpacity={0.8}
            >
              <Text style={[s.toggleText, mode === 'efektif' && s.toggleTextActive]}>{t('fxCash', lang)}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.toggleChip, mode === 'doviz' && s.toggleChipActive]}
              onPress={() => setMode('doviz')}
              activeOpacity={0.8}
            >
              <Text style={[s.toggleText, mode === 'doviz' && s.toggleTextActive]}>{t('fxTransfer', lang)}</Text>
            </TouchableOpacity>
          </View>

          <View style={s.calcCard}>
            <Text style={s.calcTitle}>{t('fxCalcTitle', lang)}</Text>

            <View style={s.calcChipRow}>
              {PAIRS.map(pair => (
                <TouchableOpacity
                  key={pair.code}
                  style={[s.calcChip, calcCurrency === pair.code && s.calcChipActive]}
                  onPress={() => setCalcCurrency(pair.code)}
                  activeOpacity={0.8}
                >
                  <Text style={s.calcChipFlag}>{pair.flag}</Text>
                  <Text style={[s.calcChipText, calcCurrency === pair.code && s.calcChipTextActive]}>
                    {pair.code}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={s.calcField}>
              <View style={s.calcFieldCurr}>
                <Text style={s.calcFieldFlag}>{fromPair.flag}</Text>
                <Text style={s.calcFieldCode}>{fromPair.code}</Text>
              </View>
              <TextInput
                style={[s.calcInput, { fontSize: inputFontSz }]}
                value={amount}
                onChangeText={v => setAmount(prev => nextAmount(prev, v))}
                keyboardType="decimal-pad"
                inputMode="decimal"
                placeholder="0"
                placeholderTextColor={colors.textSecondary}
                selectTextOnFocus
              />
            </View>

            <View style={s.calcSwapRow}>
              <TouchableOpacity
                style={s.calcSwapBtn}
                onPress={swapDirection}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={t('fxCalcSwap', lang)}
              >
                <Ionicons name="swap-vertical" size={20} color={colors.primary} />
              </TouchableOpacity>
            </View>

            <View style={[s.calcField, s.calcFieldResult]}>
              <View style={s.calcFieldCurr}>
                <Text style={s.calcFieldFlag}>{toPair.flag}</Text>
                <Text style={s.calcFieldCode}>{toPair.code}</Text>
              </View>
              <Text style={[s.calcResultValue, { fontSize: resultFontSz }]} numberOfLines={1}>
                {resultText}
              </Text>
            </View>

            {calcRate ? (
              <Text style={s.calcRateLine}>
                {`1 ${calcCurrency} = ${formatRate(calcRate)} ₺ · ${t(calcDir === 'toTry' ? 'fxColBuy' : 'fxColSell', lang)}`}
              </Text>
            ) : null}
            <Text style={s.calcNote}>{t('fxCalcNote', lang)}</Text>
          </View>

          <View style={s.ratesCard}>
            <View style={s.headerRow}>
              <View style={s.currCell} />
              <Text style={s.colHeader}>{t('fxColBuy', lang)}</Text>
              <Text style={s.colHeader}>{t('fxColSell', lang)}</Text>
            </View>
            {PAIRS.map((pair, idx) => {
              const { buy, sell } = formatVal(pair.code)
              return (
                <View key={pair.code} style={[s.rateRow, idx < PAIRS.length - 1 && s.rateRowBorder]}>
                  <View style={s.currCell}>
                    <Text style={s.rateFlag}>{pair.flag}</Text>
                    <Text style={s.rateCurrency}>{pair.code}</Text>
                  </View>
                  <Text style={s.rateValue}>{buy}</Text>
                  <Text style={s.rateValue}>{sell}</Text>
                </View>
              )
            })}
          </View>

          <View style={s.disclaimerCard}>
            <Ionicons name="information-circle-outline" size={15} color={colors.textSecondary} style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <Text style={s.disclaimerText}>{t('fxDisclaimer', lang)}</Text>
              <Text style={s.sourceLabel}>{t('fxSource', lang)}</Text>
            </View>
          </View>

          {isStale && (
            <TouchableOpacity style={s.retryLink} onPress={retry} activeOpacity={0.7}>
              <Text style={s.retryLinkText}>{t('fxRetry', lang)}</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  introCard: {
    marginHorizontal: 16,
    marginBottom: 20,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  // Loading and empty states need their own surface: bare text sits on the
  // photographic background and drops to ~1.7:1 against the scrimmed sky.
  stateCard: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    paddingVertical: 24,
    paddingHorizontal: 20,
    ...shadow,
  },
  loadingText: {
    fontSize: 15,
    color: colors.textSecondary,
    marginTop: 8,
  },
  noDataTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  noDataDetail: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: 24,
    paddingVertical: 12,
    marginTop: 8,
  },
  retryBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.surface,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: colors.accentLight,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 16,
  },
  offlineBannerText: {
    flex: 1,
    fontSize: 13,
    color: colors.textPrimary,
    lineHeight: 18,
  },
  // Pill, not a full-bleed card: the rates table below is already full width, and
  // a second slab reads as two competing headers. Auto-width keeps it a caption.
  dateHeader: {
    alignSelf: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginBottom: 14,
    ...shadow,
  },
  officialLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  dateValue: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 2,
  },
  rangeLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  toggleChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  toggleChipActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  toggleTextActive: {
    color: colors.primary,
  },
  calcCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: 16,
    marginBottom: 16,
    ...shadow,
  },
  calcTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 12,
  },
  calcChipRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  calcChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    // Opaque fill, NOT transparent. The Android radius+border gotcha only requires that
    // backgroundColor be set EXPLICITLY; 'transparent' let the PageBackground photo
    // through and the unselected calculator chips read as floating text.
    backgroundColor: colors.cardBg,
  },
  calcChipActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  calcChipFlag: { fontSize: 16 },
  calcChipText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  calcChipTextActive: {
    color: colors.primary,
  },
  calcField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  calcFieldResult: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  calcFieldCurr: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 78,
  },
  calcFieldFlag: { fontSize: 22 },
  calcFieldCode: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  calcInput: {
    flex: 1,
    textAlign: 'right',
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
    padding: 0,
    fontVariant: ['tabular-nums'],
  },
  calcResultValue: {
    flex: 1,
    textAlign: 'right',
    fontSize: 22,
    fontWeight: '700',
    color: colors.primary,
    fontVariant: ['tabular-nums'],
  },
  calcSwapRow: {
    alignItems: 'center',
    marginVertical: 8,
  },
  calcSwapBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  calcRateLine: {
    marginTop: 12,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  calcNote: {
    marginTop: 4,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  ratesCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    overflow: 'hidden',
    marginBottom: 16,
    ...shadow,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  colHeader: {
    flex: 1,
    textAlign: 'right',
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  rateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  rateRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  currCell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rateFlag: { fontSize: 24 },
  rateCurrency: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  rateValue: {
    flex: 1,
    textAlign: 'right',
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  disclaimerCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 16,
  },
  disclaimerText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  sourceLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 6,
  },
  retryLink: {
    alignSelf: 'center',
    marginTop: 16,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  retryLinkText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '500',
  },
})
