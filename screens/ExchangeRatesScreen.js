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

const FX_CACHE_KEY = 'ada_fx_rates_cache'
const API_URL = 'https://api.frankfurter.dev/v1/latest?base=TRY&symbols=GBP,EUR,USD'

const PAIRS = [
  { code: 'GBP', flag: '🇬🇧' },
  { code: 'EUR', flag: '🇪🇺' },
  { code: 'USD', flag: '🇺🇸' },
]

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

export default function ExchangeRatesScreen({ lang, onBack }) {
  // cacheData shape: { rates: { GBP, EUR, USD }, apiDate: string, fetchedOn: string }
  const [cacheData, setCacheData]     = useState(null)
  const [loading, setLoading]         = useState(true)
  const [fetchFailed, setFetchFailed] = useState(false)

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
        const resp = await fetch(API_URL)
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const data = await resp.json()
        const newCache = { rates: data.rates, apiDate: data.date, fetchedOn: todayStr() }
        await AsyncStorage.setItem(FX_CACHE_KEY, JSON.stringify(newCache))
        if (!cancelled) { setCacheData(newCache); setLoading(false) }
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
      const resp = await fetch(API_URL)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json()
      const newCache = { rates: data.rates, apiDate: data.date, fetchedOn: todayStr() }
      await AsyncStorage.setItem(FX_CACHE_KEY, JSON.stringify(newCache))
      setCacheData(newCache)
    } catch (_) {
      setFetchFailed(true)
    } finally {
      setLoading(false)
    }
  }

  const hasData = cacheData?.rates != null
  const isStale = fetchFailed && hasData
  const noData  = fetchFailed && !hasData

  function formatRate(code) {
    const raw = cacheData?.rates?.[code]
    if (!raw) return '—'
    return (1 / raw).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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

          <View style={s.ratesCard}>
            {PAIRS.map((pair, idx) => (
              <View key={pair.code} style={[s.rateRow, idx < PAIRS.length - 1 && s.rateRowBorder]}>
                <Text style={s.rateFlag}>{pair.flag}</Text>
                <Text style={s.rateCurrency}>{pair.code}</Text>
                <View style={s.rateRight}>
                  <Text style={s.rateValue}>{formatRate(pair.code)}</Text>
                  <Text style={s.rateTRY}>₺</Text>
                </View>
              </View>
            ))}
          </View>

          <Text style={s.dateLabel}>{t('fxAsOf', lang)} {cacheData.apiDate}</Text>

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
  ratesCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    overflow: 'hidden',
    marginBottom: 10,
    ...shadow,
  },
  rateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 18,
    gap: 12,
  },
  rateRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rateFlag: { fontSize: 26 },
  rateCurrency: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    width: 44,
  },
  rateRight: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'flex-end',
    gap: 4,
  },
  rateValue: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  rateTRY: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  dateLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'right',
    marginBottom: 14,
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
