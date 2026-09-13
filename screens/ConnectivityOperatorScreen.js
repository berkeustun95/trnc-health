import { useState, useEffect, useCallback } from 'react'
import { View, Text, Image, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors, readableOn, brandInk, withAlpha } from '../constants/theme'
import { t } from '../constants/i18n'
import BackButton from '../components/BackButton'
import ConnectivityErrorState from '../components/ConnectivityErrorState'
import OperatorWordmark from '../components/OperatorWordmark'
import { fetchPackages, latestPriceUpdate } from '../lib/connectivity'

// Bağlantı & eSIM — the operator's own screen (screen 2 of 3).
//
// ⚠ PACKAGE NAMES ARE NEVER TRANSLATED. `name`, `data_amount` and `duration_label` render
//   exactly as KKTCELL wrote them — they are the partner's own wording for their own
//   products, and passing them through t() would both fail (they are not keys) and be
//   wrong in principle. Everything AROUND them is translated.
//
// The whole screen is data-driven so a price change is one UPDATE and no OTA — which is
// the promise made to KKTCELL in the partner design, and the reason the stamp below the
// list exists at all.

// The tag row. eSIM and physical-SIM come from the BOOLEAN columns and are translated
// (they are ADA describing a capability); anything else comes from the `tags` array and is
// rendered as stored, because those are the partner's own labels ("4.5g", "sms").
function PackageTags({ pkg, lang, primary }) {
  const extra = (pkg.tags ?? []).filter(x => String(x).toLowerCase() !== 'esim')

  return (
    <View style={s.tagRow}>
      {pkg.supports_esim && (
        // A 20% wash of the brand over a white card is light whatever the brand is — dark
        // ink is therefore readable against it for ANY operator, which a brand-derived
        // foreground would not reliably be.
        <View style={[s.tag, { backgroundColor: withAlpha(primary, 0.2) }]}>
          <Text style={s.tagText}>{t('connTagEsim', lang)}</Text>
        </View>
      )}
      {pkg.supports_physical_sim && (
        <View style={s.tag}>
          <Text style={s.tagText}>{t('connTagPhysical', lang)}</Text>
        </View>
      )}
      {extra.map(tag => (
        <View key={String(tag)} style={s.tag}>
          <Text style={s.tagText}>{String(tag).toUpperCase()}</Text>
        </View>
      ))}
    </View>
  )
}

// Defined outside the screen so it is not remounted on every parent render.
function PackageCard({ pkg, lang, primary, secondary, onPress }) {
  const ink = brandInk(secondary)
  const onPrimary = readableOn(primary)

  return (
    <TouchableOpacity
      style={[
        s.pkg,
        pkg.is_featured && [s.pkgFeatured, { borderColor: primary, shadowColor: primary }],
      ]}
      onPress={() => onPress(pkg)}
      activeOpacity={0.85}
      accessibilityRole="button"
    >
      {pkg.is_featured && (
        <View style={[s.flag, { backgroundColor: primary }]}>
          <Text style={[s.flagText, { color: onPrimary }]}>{t('connFeaturedFlag', lang)}</Text>
        </View>
      )}

      <View style={s.pkgHead}>
        <View style={s.pkgHeadLeft}>
          <Text style={[s.pkgName, { color: ink }]}>{pkg.name}</Text>
          {/* data_amount · duration_label. The spec carries a third element ("faturasız")
              that no column holds, and its price sub-line repeats the duration — with only
              two facts in the data that repetition would be the same word twice on one
              row, so the duration lives here and the price stands alone. */}
          <Text style={s.pkgMeta}>
            {[pkg.data_amount, pkg.duration_label].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <Text style={[s.pkgPrice, { color: ink }]}>{formatPrice(pkg.price_try)}</Text>
      </View>

      <PackageTags pkg={pkg} lang={lang} primary={primary} />
    </TouchableOpacity>
  )
}

// numeric(10,2) arrives as a number through PostgREST. Trailing ".00" is noise on a price
// board, so integers render bare and genuine decimals keep two places, in the device's
// locale — Turkish wants "1.499,50" where English wants "1,499.50".
function formatPrice(value) {
  // null/undefined/'' BEFORE Number(): Number(null) and Number('') are both 0, which is
  // finite, so a missing price would render "0 ₺" and tell the user the package is free.
  // Caught by the unit test, not by reading the code.
  if (value == null || value === '') return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  const body = n.toLocaleString([], {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  })
  return `${body} ₺`
}

export default function ConnectivityOperatorScreen({ operator, lang, onBack, onOpenPackage }) {
  const [packages, setPackages] = useState([])
  const [loading, setLoading]   = useState(true)
  const [retrying, setRetrying] = useState(false)
  const [failed, setFailed]     = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await fetchPackages(operator?.id)
    setFailed(!!error)
    setPackages(data)
  }, [operator?.id])

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data, error } = await fetchPackages(operator?.id)
      if (!active) return
      setFailed(!!error)
      setPackages(data)
      setLoading(false)
    })()
    return () => { active = false }
  }, [operator?.id])

  const onRetry = useCallback(async () => {
    setRetrying(true)
    await load()
    setRetrying(false)
  }, [load])

  const primary   = operator?.brand_primary   || colors.primary
  const secondary = operator?.brand_secondary || colors.textPrimary
  const onPrimary = readableOn(primary)

  const stampDate = latestPriceUpdate(packages)

  function renderBody() {
    if (loading) return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>

    // A live operator with no active packages is the same class of fault as no operator at
    // all — not an empty list. The TITLE names this failure specifically; telling someone
    // the operator list broke when they just watched it load is worse than saying nothing.
    if (failed || packages.length === 0) {
      return (
        <ConnectivityErrorState
          lang={lang}
          onRetry={onRetry}
          retrying={retrying}
          titleKey="connPkgErrorTitle"
        />
      )
    }

    return (
      <>
        {packages.map(pkg => (
          <PackageCard
            key={pkg.id}
            pkg={pkg}
            lang={lang}
            primary={primary}
            secondary={secondary}
            onPress={onOpenPackage}
          />
        ))}

        {/* Campaign slot — KKTCELL's own artwork, 1080x420. Rendered only when the column
            holds a URL; there is deliberately NO dashed placeholder, because the empty
            frame in the partner design exists to SHOW them where it goes, not to ship. */}
        {!!operator?.promo_image_url && (
          <Image
            source={{ uri: operator.promo_image_url }}
            style={s.promo}
            resizeMode="cover"
            accessibilityLabel={operator?.name ?? ''}
          />
        )}

        {/* Derived from max(price_updated_at) across the packages actually on screen, so it
            cannot go stale independently of the prices it describes. */}
        <View style={s.stamp}>
          <Text style={s.stampText}>
            {t('connStampSource', lang).replace('{operator}', operator?.name ?? '')}
          </Text>
          {!!stampDate && (
            <Text style={s.stampText}>
              {t('connStampUpdated', lang)
                .replace('{date}', stampDate.toLocaleDateString([], { dateStyle: 'medium' }))}
            </Text>
          )}
        </View>
      </>
    )
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <BackButton lang={lang} onPress={onBack} />
        {/* The operator's name, not a translated module title — this is their screen. */}
        <Text style={s.headerTitle} numberOfLines={1}>{operator?.name ?? ''}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={[s.band, { backgroundColor: primary }]}>
          <OperatorWordmark operator={operator} onBrand={onPrimary} />
          <View style={[s.bandBadge, { backgroundColor: secondary }]}>
            <Text style={[s.bandBadgeText, { color: primary }]}>{t('connPkgBadge', lang)}</Text>
          </View>
        </View>

        {renderBody()}
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: colors.bg },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.cardBg, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle:   { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, flex: 1, textAlign: 'center' },
  scroll:        { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 48 },
  center:        { paddingVertical: 40, alignItems: 'center' },

  band:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 14 },
  bandBadge:     { flexShrink: 1, borderRadius: 20, paddingVertical: 5, paddingHorizontal: 10 },
  bandBadgeText: { fontSize: 9.5, fontFamily: 'Inter_700Bold', textAlign: 'center', lineHeight: 12 },

  // marginTop leaves room for the featured flag, which sits above the card's top edge.
  pkg:           { backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 9, marginTop: 9 },
  pkgFeatured:   { borderWidth: 1.5, shadowOpacity: 0.22, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  flag:          { position: 'absolute', top: -9, left: 13, borderRadius: 5, paddingHorizontal: 8, paddingVertical: 3 },
  flagText:      { fontSize: 9.5, fontFamily: 'Inter_700Bold' },

  pkgHead:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  // flex:1 so a long package name wraps instead of squeezing the price off the row.
  pkgHeadLeft:   { flex: 1 },
  pkgName:       { fontSize: 14, fontFamily: 'Inter_700Bold' },
  pkgMeta:       { fontSize: 11.5, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 3 },
  pkgPrice:      { fontSize: 17, fontFamily: 'Inter_700Bold', lineHeight: 19 },

  tagRow:        { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  tag:           { backgroundColor: '#F0F4F6', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  tagText:       { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#4A5B66' },

  // 1080x420 = 2.571:1. aspectRatio rather than a fixed height so the artwork is never
  // cropped or letterboxed on a narrow device.
  promo:         { width: '100%', aspectRatio: 1080 / 420, borderRadius: 13, marginTop: 6, backgroundColor: colors.border },

  stamp:         { marginTop: 11, alignItems: 'center' },
  stampText:     { fontSize: 10.5, fontFamily: 'Inter_400Regular', color: '#93A2AB', textAlign: 'center', lineHeight: 16 },
})
