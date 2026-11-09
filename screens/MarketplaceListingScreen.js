import { useState, useEffect, useCallback } from 'react'
import { View, Text, ScrollView, TouchableOpacity, Modal, StyleSheet, useWindowDimensions } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { t } from '../constants/i18n'
import { colors, category as CAT, type, radii } from '../constants/theme'
import { DetailScaffold, InfoRow, InfoBanner, InlineAlert, Button, ConfirmDialog, ErrorState, EmptyState, RemoteImage, IconButton, PageCanvas } from '../components/ui'
import { MK_CATEGORY, MK_CONDITION, formatPrice, listingState, canRenew, daysUntil, mkErrorKey } from '../constants/marketplace'
import { HS_DISTRICT_LABEL_KEY } from '../constants/homeServices'
import { getListing, photosFor, signedUrls, sellerName, setSold, deleteListing, renewListing } from '../utils/marketplaceApi'

// ─── Bandabuliya: one listing ────────────────────────────────────────────────────
// Clean ground (DetailScaffold over PageCanvas). Others see approved photos only (RLS); while none is
// approved the page shows the category placeholder and "Fotoğraflar inceleniyor". The seller sees every
// photo of their own with its review state, and manages the listing here.

const PHOTO_BADGE = { pending: 'mkPhotoPending', rejected: 'mkPhotoRejected' }

function Thumb({ photo, url, mine, lang, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} disabled={!url} activeOpacity={0.85} style={s.thumbWrap}
      accessibilityRole="imagebutton" accessibilityLabel={t('mkOpenPhoto', lang)}>
      {url ? <RemoteImage source={{ uri: url }} style={s.thumb} accessibilityIgnoresInvertColors />
           : <View style={[s.thumb, s.thumbEmpty]}><Ionicons name="image-outline" size={22} color={colors.textSecondary} /></View>}
      {mine && PHOTO_BADGE[photo.status] && (
        <View style={[s.thumbBadge, photo.status === 'rejected' && s.thumbBadgeBad]}>
          <Text style={s.thumbBadgeText} numberOfLines={1}>{t(PHOTO_BADGE[photo.status], lang)}</Text>
        </View>
      )}
    </TouchableOpacity>
  )
}

// Full-screen pager for the photos one may see.
function PhotoViewer({ urls, index, onClose, lang }) {
  const { width } = useWindowDimensions()
  // A Modal: Android back arrives as onRequestClose; iOS has the close button.
  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={onClose}>
      <SafeAreaView style={s.viewer}>
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}
          contentOffset={{ x: index * width, y: 0 }}>
          {urls.map(u => <RemoteImage key={u} source={{ uri: u }} style={{ width, height: '100%' }} resizeMode="contain" accessibilityIgnoresInvertColors />)}
        </ScrollView>
        <View style={s.viewerClose}>
          <IconButton icon="close" variant="frosted" onPress={onClose} accessibilityLabel={t('mkClose', lang)} />
        </View>
      </SafeAreaView>
    </Modal>
  )
}

export default function MarketplaceListingScreen({ id, lang, session, onBack, onEdit, onChanged }) {
  const [listing, setListing] = useState(null)
  const [photos, setPhotos]   = useState([])
  const [urls, setUrls]       = useState({})
  const [seller, setSeller]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(false)
  const [busy, setBusy]       = useState(false)
  const [actionError, setActionError] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [viewer, setViewer]   = useState(null)
  const mine = listing && listing.owner_id === session?.user?.id

  const load = useCallback(async () => {
    setLoading(true); setError(false)
    try {
      const l = await getListing(id)
      if (!l) { setListing(null); setLoading(false); return }
      const [ph, name] = await Promise.all([photosFor([id]), sellerName(l)])
      const list = ph[id]
      setListing(l); setPhotos(list); setSeller(name)
      setUrls(await signedUrls(list.filter(p => p.status !== 'rejected').map(p => p.storage_path)))
    } catch { setError(true) }
    setLoading(false)
  }, [id])
  useEffect(() => { load() }, [load])

  async function act(fn) {
    setBusy(true); setActionError(null)
    try { await fn(); await load(); onChanged?.() } catch (e) { setActionError(t(mkErrorKey(e), lang)) }
    setBusy(false)
  }

  if (loading || error || !listing) {
    return (
      <PageCanvas>
        <SafeAreaView style={s.center} edges={['top', 'bottom']}>
          {loading ? null : error ? <ErrorState onRetry={load} lang={lang} />
            : <EmptyState icon="storefront-outline" category="homeLife" title={t('mkGoneTitle', lang)} message={t('mkGoneSub', lang)}
                action={{ label: t('mkBack', lang), onPress: onBack }} />}
        </SafeAreaView>
      </PageCanvas>
    )
  }

  const cat = MK_CATEGORY[listing.category]
  const visiblePhotos = photos.filter(p => (mine ? p.status !== 'rejected' : p.status === 'approved'))
  const approved = photos.filter(p => p.status === 'approved')
  const cover = approved[0] && urls[approved[0].storage_path]
  const viewable = visiblePhotos.map(p => urls[p.storage_path]).filter(Boolean)
  const state = listingState(listing)
  const rejected = mine ? photos.filter(p => p.status === 'rejected') : []

  return (
    <>
      <DetailScaffold
        photo={cover ? { uri: cover } : null}
        icon={cat?.icon || 'cube-outline'}
        tag={{ label: t(cat?.labelKey, lang), category: 'homeLife', icon: cat?.icon }}
        title={listing.title}
        onBack={onBack}
        lang={lang}
      >
        <Text style={s.price}>{formatPrice(listing, lang, t)}</Text>

        {state === 'sold' && <InfoBanner icon="checkmark-done-outline" category="homeLife" title={t('mkSoldBanner', lang)} style={s.block} />}
        {mine && state === 'hidden' && <InfoBanner icon="eye-off-outline" category="health" title={t('mkHiddenTitle', lang)} message={t('mkHiddenBanner', lang)} style={s.block} />}
        {mine && state === 'expired' && <InfoBanner icon="time-outline" category="homeLife" title={t('mkExpiredTitle', lang)} message={t('mkExpiredBanner', lang)} style={s.block} />}

        {!approved.length && (
          <InfoBanner icon="hourglass-outline" category="homeLife" title={t('mkPhotosInReview', lang)}
            message={mine ? t('mkPhotosInReviewMine', lang) : t('mkPhotosInReviewOther', lang)} style={s.block} />
        )}

        {visiblePhotos.length > (mine ? 0 : 1) && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.thumbs} style={s.block}>
            {visiblePhotos.map((p, i) => (
              <Thumb key={p.id} photo={p} url={urls[p.storage_path]} mine={mine} lang={lang}
                onPress={() => setViewer(Math.max(0, viewable.indexOf(urls[p.storage_path])))} />
            ))}
          </ScrollView>
        )}
        {rejected.length > 0 && (
          <InfoBanner icon="alert-circle-outline" category="health" title={t('mkPhotosRejectedTitle', lang)} message={t('mkPhotosRejected', lang)} style={s.block} />
        )}

        <View style={s.rows}>
          <InfoRow category="homeLife" icon="pricetag-outline" label={t('mkCondition', lang)} value={t(MK_CONDITION[listing.condition]?.labelKey, lang)} />
          <InfoRow category="homeLife" icon="location-outline" label={t('ddDistrict', lang)} value={t(HS_DISTRICT_LABEL_KEY[listing.district], lang)} />
          {!!seller && <InfoRow category="homeLife" icon="person-outline" label={t('mkSeller', lang)} value={seller} />}
          {mine && state !== 'expired' && (
            <InfoRow category="homeLife" icon="time-outline" label={t('mkExpiresIn', lang)} value={t('mkDaysLeft', lang).replace('{n}', String(Math.max(0, daysUntil(listing.expires_at))))} />
          )}
        </View>

        <Text style={s.sectionTitle}>{t('mkDescription', lang)}</Text>
        <Text style={s.body} selectable>{listing.description}</Text>

        {!mine && (
          <View style={[s.safety, s.block]}>
            <Ionicons name="shield-checkmark-outline" size={18} color={CAT.homeLife.ink} />
            <Text style={s.safetyText}>{t('mkSafetyShort', lang)}</Text>
          </View>
        )}

        {mine && (
          <View style={s.ownerActions}>
            {!!actionError && <InlineAlert message={actionError} />}
            {state !== 'hidden' && <Button title={t('mkEdit', lang)} icon="create-outline" variant="secondary" fullWidth disabled={busy} onPress={() => onEdit(listing)} />}
            {(state === 'live' || state === 'sold') && (
              <Button title={t(state === 'sold' ? 'mkMarkAvailable' : 'mkMarkSold', lang)} icon={state === 'sold' ? 'refresh-outline' : 'checkmark-done-outline'}
                variant="secondary" fullWidth loading={busy} onPress={() => act(() => setSold(listing.id, state !== 'sold'))} />
            )}
            {state !== 'hidden' && canRenew(listing) && (
              <Button title={t('mkRenew', lang)} icon="reload-outline" fullWidth loading={busy} onPress={() => act(() => renewListing(listing.id))} />
            )}
            <Button title={t('mkDelete', lang)} icon="trash-outline" variant="text" fullWidth disabled={busy} onPress={() => setConfirmDelete(true)} />
          </View>
        )}
      </DetailScaffold>

      <ConfirmDialog visible={confirmDelete} title={t('mkDeleteTitle', lang)} message={t('mkDeleteBody', lang)}
        confirmLabel={t('mkDelete', lang)} destructive loading={busy} lang={lang}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setBusy(true)
          try { await deleteListing(listing.id); setConfirmDelete(false); onChanged?.(); onBack() }
          catch (e) { setActionError(t(mkErrorKey(e), lang)); setConfirmDelete(false) }
          setBusy(false)
        }} />
      {viewer !== null && viewable.length > 0 && <PhotoViewer urls={viewable} index={viewer} lang={lang} onClose={() => setViewer(null)} />}
    </>
  )
}

const s = StyleSheet.create({
  center:       { flex: 1, justifyContent: 'center' },
  price:        { ...type.pageTitle, color: colors.primaryDark, marginTop: 6 },
  block:        { marginTop: 14 },
  thumbs:       { gap: 10 },
  thumbWrap:    { width: 96, height: 96, borderRadius: radii.card, overflow: 'hidden' },
  thumb:        { width: 96, height: 96 },
  thumbEmpty:   { backgroundColor: colors.soft, alignItems: 'center', justifyContent: 'center' },
  thumbBadge:   { position: 'absolute', left: 4, right: 4, bottom: 4, borderRadius: radii.pill, backgroundColor: 'rgba(0,0,0,0.6)',
                  paddingHorizontal: 6, paddingVertical: 2, alignItems: 'center' },
  thumbBadgeBad: { backgroundColor: colors.dangerInk },
  thumbBadgeText: { ...type.caption, color: '#FFFFFF', fontFamily: 'Inter_600SemiBold' },
  rows:         { marginTop: 16, gap: 4 },
  sectionTitle: { ...type.rowTitle, color: colors.textPrimary, marginTop: 20, marginBottom: 6 },
  body:         { ...type.body, color: colors.textPrimary },
  safety:       { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: CAT.homeLife.bg, borderRadius: radii.card, padding: 12 },
  safetyText:   { flex: 1, ...type.meta, color: colors.textPrimary },
  ownerActions: { marginTop: 24, gap: 10 },
  viewer:       { flex: 1, backgroundColor: '#000' },
  viewerClose:  { position: 'absolute', top: 48, right: 12 },
})
