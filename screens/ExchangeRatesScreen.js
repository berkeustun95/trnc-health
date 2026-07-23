import { useState, useEffect } from 'react'
import {
  View, Text, TouchableOpacity, ActivityIndicator, StyleSheet,
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
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={s.loadingText}>{t('fxLoading', lang)}</Text>
        </View>
      )}

      {!loading && noData && (
        <View style={s.center}>
          <Ionicons name="cloud-offline-outline" size={48} color={colors.border} />
          <Text style={s.noDataTitle}>{t('fxNoData', lang)}</Text>
          <Text style={s.noDataDetail}>{t('fxNoDataDetail', lang)}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={retry} activeOpacity={0.8}>
            <Text style={s.retryBtnText}>{t('fxRetry', lang)}</Text>
          </TouchableOpacity>
        </View>
      )}

      {!loading && hasData && (
        <View style={s.body}>
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
            <Text style={s.disclaimerText}>{t('fxDisclaimer', lang)}</Text>
          </View>

          <Text style={s.sourceLabel}>{t('fxSource', lang)}</Text>

          {isStale && (
            <TouchableOpacity style={s.retryLink} onPress={retry} activeOpacity={0.7}>
              <Text style={s.retryLinkText}>{t('fxRetry', lang)}</Text>
            </TouchableOpacity>
          )}
        </View>
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
    gap: 12,
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
    paddingHorizontal: 16,
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
  dateHeader: {
    alignItems: 'center',
    marginBottom: 14,
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
    marginBottom: 6,
  },
  disclaimerText: {
    flex: 1,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  sourceLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 4,
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
