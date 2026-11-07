import { useState, useEffect, useCallback } from 'react'
import { View, FlatList, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { t } from '../constants/i18n'
import { PageCanvas, ScreenHeader, ListCard, ErrorState, EmptyState, CardSkeleton } from '../components/ui'
import SplashStatusBar from '../components/SplashStatusBar'
import { MK_CATEGORY, formatPrice, listingState, canRenew, isAdultDob } from '../constants/marketplace'
import { myListings, photosFor, signedUrls } from '../utils/marketplaceApi'

// ─── Dükkân: İlanlarım ──────────────────────────────────────────────────────
// The seller's own listings in every state (RLS "owner read"). Opened from Dükkân's header and from
// Profil's row. Clean ground.

const STATE_BADGE = { live: 'mkStateLive', sold: 'mkStateSold', expired: 'mkStateExpired', hidden: 'mkStateHidden' }

export default function MarketplaceMineScreen({ lang, session, profile, onBack, onOpen, onPost }) {
  const [rows, setRows]       = useState([])
  const [meta, setMeta]       = useState({})          // id → { cover, pending }
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(false)
  const uid = session?.user?.id

  const load = useCallback(async () => {
    setLoading(true); setError(false)
    try {
      const list = await myListings(uid)
      const photos = await photosFor(list.map(l => l.id))
      const coverPath = id => photos[id].find(p => p.status !== 'rejected')?.storage_path
      const urls = await signedUrls(list.map(l => coverPath(l.id)).filter(Boolean))
      setRows(list)
      setMeta(Object.fromEntries(list.map(l => [l.id, {
        cover: coverPath(l.id) ? urls[coverPath(l.id)] : null,
        pending: photos[l.id].some(p => p.status === 'pending'),
        rejected: photos[l.id].some(p => p.status === 'rejected'),
      }])))
    } catch { setError(true) }
    setLoading(false)
  }, [uid])
  useEffect(() => { load() }, [load])

  const adult = isAdultDob(profile?.date_of_birth)
  return (
    <PageCanvas>
      <SafeAreaView style={s.safe} edges={['top']}>
        <SplashStatusBar style="dark" />
        <ScreenHeader title={t('mkMine', lang)} onBack={onBack} lang={lang}
          actions={adult ? [{ icon: 'add-circle-outline', onPress: onPost, accessibilityLabel: t('mkPost', lang) }] : []} />
        {loading ? (
          <View style={s.list}><CardSkeleton height={96} /><CardSkeleton height={96} /></View>
        ) : error ? (
          <ErrorState onRetry={load} lang={lang} />
        ) : (
          <FlatList
            data={rows}
            keyExtractor={it => String(it.id)}
            contentContainerStyle={s.list}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <EmptyState icon="pricetags-outline" category="homeLife" title={t('mkMineEmptyTitle', lang)}
                message={t(adult ? 'mkMineEmptySub' : 'mkUnder18', lang)}
                action={adult ? { label: t('mkPost', lang), onPress: onPost } : undefined} />
            }
            renderItem={({ item }) => {
              const st = listingState(item)
              const m = meta[item.id] || {}
              const cat = MK_CATEGORY[item.category]
              return (
                <ListCard
                  title={item.title}
                  subtitle={formatPrice(item, lang, t)}
                  leading={m.cover ? { uri: m.cover } : { icon: cat?.icon || 'cube-outline', category: 'homeLife' }}
                  badge={t(STATE_BADGE[st], lang)}
                  meta={[
                    m.pending && { icon: 'hourglass-outline', text: t('mkPhotosInReview', lang) },
                    m.rejected && { icon: 'alert-circle-outline', text: t('mkPhotosRejectedTitle', lang), tone: 'warn' },
                    st !== 'hidden' && canRenew(item) && { icon: 'reload-outline', text: t('mkRenewDue', lang), tone: 'warn' },
                  ]}
                  onPress={() => onOpen(item.id)}
                  lang={lang}
                />
              )
            }}
          />
        )}
      </SafeAreaView>
    </PageCanvas>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  list: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 40, gap: 12 },
})
