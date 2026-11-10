import { useState, useEffect } from 'react'
import { View, Text, TextInput, ScrollView, TouchableOpacity, Image, Switch, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { t } from '../constants/i18n'
import { colors, category as CAT, type, radii } from '../constants/theme'
import { PageCanvas, ScreenHeader, Button, InlineAlert, InfoBanner } from '../components/ui'
import FilterDropdown from '../components/FilterDropdown'
import KeyboardAwareForm from '../components/KeyboardAwareForm'
import SplashStatusBar from '../components/SplashStatusBar'
import {
  MK_CATEGORIES, MK_CONDITIONS, MK_DISTRICTS, MK_TITLE_MIN, MK_TITLE_MAX, MK_DESC_MIN, MK_DESC_MAX, MK_PRICE_MAX,
  MK_PHOTOS_MAX, mkErrorKey,
} from '../constants/marketplace'
import { createListing, updateListing, photosFor, signedUrls, uploadPhoto, removePhoto } from '../utils/marketplaceApi'

// ─── Bandabuliya: post / edit a listing ──────────────────────────────────────────
// Clean ground. The form checks the table's own bounds (20261183) before sending; the server repeats every
// one of them (18+, word filter, caps). Photos upload after the row exists (the path carries its id), one
// at a time with progress; a failed photo leaves the listing saved and the form in edit mode, so a retry
// sends only what is missing.

function Label({ text, hint }) {
  return (
    <View style={s.labelRow}>
      <Text style={s.label}>{text}</Text>
      {!!hint && <Text style={s.hint}>{hint}</Text>}
    </View>
  )
}

const freePositions = (taken, n) => {
  const out = []
  for (let i = 0; i < MK_PHOTOS_MAX && out.length < n; i++) if (!taken.has(i)) out.push(i)
  return out
}

export default function MarketplaceFormScreen({ lang, session, listing = null, onBack, onSaved }) {
  const [editingId, setEditingId] = useState(listing?.id || null)
  const [title, setTitle]         = useState(listing?.title || '')
  const [category, setCategory]   = useState(listing?.category || null)
  const [condition, setCondition] = useState(listing?.condition || null)
  const [district, setDistrict]   = useState(listing?.district || null)
  const [isFree, setIsFree]       = useState(listing?.is_free || false)
  const [price, setPrice]         = useState(listing?.price_tl ? String(listing.price_tl) : '')
  const [desc, setDesc]           = useState(listing?.description || '')
  const [existing, setExisting]   = useState([])          // saved photos (not rejected), { id, position, url, status }
  const [removed, setRemoved]     = useState([])          // ids of saved photos to remove on save
  const [picked, setPicked]       = useState([])          // new assets
  const [rulesOk, setRulesOk]     = useState(!!listing)
  const [saving, setSaving]       = useState(false)
  const [progress, setProgress]   = useState(null)
  const [error, setError]         = useState(null)
  const uid = session?.user?.id
  // A fixed field clears the message about it (and any other): the next save re-checks everything.
  useEffect(() => { setError(null) }, [title, category, condition, district, isFree, price, desc, rulesOk, picked.length, removed.length])

  useEffect(() => {
    if (!editingId) return
    let live = true
    ;(async () => {
      const ph = (await photosFor([editingId]))[editingId].filter(p => p.status !== 'rejected')
      const urls = await signedUrls(ph.map(p => p.storage_path))
      if (live) setExisting(ph.map(p => ({ id: p.id, position: p.position, status: p.status, url: urls[p.storage_path] })))
    })().catch(() => {})
    return () => { live = false }
  }, [editingId])

  const keptExisting = existing.filter(p => !removed.includes(p.id))
  const photoCount = keptExisting.length + picked.length

  async function addPhotos() {
    const room = MK_PHOTOS_MAX - photoCount
    if (room <= 0) return
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) { setError(t('mkErrPhotoPermission', lang)); return }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true, selectionLimit: room, quality: 0.7, base64: true, exif: false,
    })
    if (result.canceled) return
    setPicked(prev => [...prev, ...result.assets.slice(0, room)])
  }

  function validate() {
    const priceNum = Number(price)
    if (!photoCount) return 'mkErrNeedPhoto'
    if (title.trim().length < MK_TITLE_MIN) return 'mkErrTitleShort'
    if (!category) return 'mkErrNeedCategory'
    if (!condition) return 'mkErrNeedCondition'
    if (!isFree && !(Number.isInteger(priceNum) && priceNum >= 1 && priceNum <= MK_PRICE_MAX)) return 'mkErrPrice'
    if (!district) return 'mkErrNeedDistrict'
    if (desc.trim().length < MK_DESC_MIN) return 'mkErrDescShort'
    if (!rulesOk) return 'mkErrRules'
    return null
  }

  async function save() {
    const bad = validate()
    if (bad) { setError(t(bad, lang)); return }
    setSaving(true); setError(null)
    const fields = { title: title.trim(), description: desc.trim(), is_free: isFree, price_tl: isFree ? null : Number(price),
                     category, condition, district }
    let id = editingId
    try {
      if (id) await updateListing(id, fields)
      else { id = await createListing(fields); setEditingId(id) }
      for (const pid of removed) await removePhoto(pid)
      setRemoved([])
      const slots = freePositions(new Set(keptExisting.map(p => p.position)), picked.length)
      const left = [...picked]
      for (let i = 0; i < slots.length; i++) {
        setProgress(t('mkUploading', lang).replace('{n}', String(i + 1)).replace('{total}', String(slots.length)))
        await uploadPhoto({ uid, listingId: id, asset: left[0], position: slots[i] })
        left.shift()
        setPicked([...left])
      }
      setProgress(null); setSaving(false)
      onSaved(id)
    } catch (e) {
      setProgress(null); setSaving(false)
      // The listing may already exist: stay here in edit mode so a retry sends only what is missing.
      setError(t(id && !editingId ? 'mkErrPhotosPartial' : mkErrorKey(e), lang))
      if (id) {
        const ph = (await photosFor([id]).catch(() => ({ [id]: [] })))[id].filter(p => p.status !== 'rejected')
        const urls = await signedUrls(ph.map(p => p.storage_path)).catch(() => ({}))
        setExisting(ph.map(p => ({ id: p.id, position: p.position, status: p.status, url: urls[p.storage_path] })))
      }
    }
  }

  return (
    <PageCanvas>
      <SafeAreaView style={s.safe} edges={['top']}>
        <SplashStatusBar style="dark" />
        <KeyboardAwareForm>
          <ScreenHeader title={t(editingId ? 'mkEditTitle' : 'mkPostTitle', lang)} onBack={onBack} lang={lang} />
          <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Label text={t('mkPhotos', lang)} hint={`${photoCount}/${MK_PHOTOS_MAX}`} />
            <View style={s.photos}>
              {keptExisting.map(p => (
                <View key={p.id} style={s.thumbWrap}>
                  {p.url ? <Image source={{ uri: p.url }} style={s.thumb} /> : <View style={[s.thumb, s.thumbEmpty]} />}
                  {p.status === 'pending' && <View style={s.pending}><Text style={s.pendingText}>{t('mkPhotoPending', lang)}</Text></View>}
                  <TouchableOpacity style={s.remove} onPress={() => setRemoved(r => [...r, p.id])} hitSlop={8}
                    accessibilityRole="button" accessibilityLabel={t('uiRemove', lang)}>
                    <Ionicons name="close-circle" size={22} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>
              ))}
              {picked.map((a, i) => (
                <View key={a.uri + i} style={s.thumbWrap}>
                  <Image source={{ uri: a.uri }} style={s.thumb} />
                  <TouchableOpacity style={s.remove} onPress={() => setPicked(prev => prev.filter((_, j) => j !== i))} hitSlop={8}
                    accessibilityRole="button" accessibilityLabel={t('uiRemove', lang)}>
                    <Ionicons name="close-circle" size={22} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>
              ))}
              {photoCount < MK_PHOTOS_MAX && (
                <TouchableOpacity style={s.addPhoto} onPress={addPhotos} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={t('mkAddPhotos', lang)}>
                  <Ionicons name="camera-outline" size={26} color={colors.primary} />
                  <Text style={s.addPhotoText}>{t('mkAddPhotos', lang)}</Text>
                </TouchableOpacity>
              )}
            </View>
            <Text style={s.note}>{t('mkPhotosNote', lang)}</Text>

            <Label text={t('mkTitle', lang)} hint={`${title.length}/${MK_TITLE_MAX}`} />
            <TextInput style={s.input} value={title} onChangeText={v => setTitle(v.slice(0, MK_TITLE_MAX))}
              placeholder={t('mkTitlePlaceholder', lang)} placeholderTextColor={colors.textSecondary} accessibilityLabel={t('mkTitle', lang)} />

            <Label text={t('ddCategory', lang)} />
            <FilterDropdown variant="field" allowAll={false} lang={lang} label={t('ddCategory', lang)}
              searchPlaceholder={t('mkSearchCategory', lang)} options={MK_CATEGORIES.map(c => ({ value: c.key, label: t(c.labelKey, lang) }))} value={category} onChange={setCategory} />

            <Label text={t('mkCondition', lang)} />
            <FilterDropdown variant="field" allowAll={false} lang={lang} label={t('mkCondition', lang)}
              options={MK_CONDITIONS.map(c => ({ value: c.key, label: t(c.labelKey, lang) }))} value={condition} onChange={setCondition} />

            <Label text={t('mkPrice', lang)} />
            <View style={s.freeRow}>
              <Text style={s.freeText}>{t('mkFreeToggle', lang)}</Text>
              <Switch value={isFree} onValueChange={setIsFree} accessibilityLabel={t('mkFreeToggle', lang)}
                trackColor={{ false: colors.border, true: colors.primaryLight }} thumbColor={isFree ? colors.primary : '#CCCCCC'} />
            </View>
            {!isFree && (
              <View style={s.priceWrap}>
                <TextInput style={[s.input, s.priceInput]} value={price} onChangeText={v => setPrice(v.replace(/[^0-9]/g, '').slice(0, 7))}
                  keyboardType="number-pad" placeholder="0" placeholderTextColor={colors.textSecondary} accessibilityLabel={t('mkPrice', lang)} />
                <Text style={s.currency}>TL</Text>
              </View>
            )}

            <Label text={t('ddDistrict', lang)} />
            <FilterDropdown variant="field" allowAll={false} lang={lang} label={t('ddDistrict', lang)}
              options={MK_DISTRICTS.map(d => ({ value: d.key, label: t(d.labelKey, lang) }))} value={district} onChange={setDistrict} />
            <Text style={s.note}>{t('mkDistrictNote', lang)}</Text>

            <Label text={t('mkDescription', lang)} hint={`${desc.length}/${MK_DESC_MAX}`} />
            <TextInput style={[s.input, s.textArea]} value={desc} onChangeText={v => setDesc(v.slice(0, MK_DESC_MAX))} multiline
              textAlignVertical="top" placeholder={t('mkDescPlaceholder', lang)} placeholderTextColor={colors.textSecondary}
              accessibilityLabel={t('mkDescription', lang)} />

            {!listing && (
              <>
                <InfoBanner icon="ban-outline" category="health" title={t('mkRulesTitle', lang)} message={t('mkRulesBody', lang)} style={s.rules} />
                <TouchableOpacity style={s.check} onPress={() => setRulesOk(v => !v)} activeOpacity={0.8}
                  accessibilityRole="checkbox" accessibilityState={{ checked: rulesOk }}>
                  <Ionicons name={rulesOk ? 'checkbox' : 'square-outline'} size={24} color={rulesOk ? colors.primary : colors.textSecondary} />
                  <Text style={s.checkText}>{t('mkRulesAccept', lang)}</Text>
                </TouchableOpacity>
              </>
            )}

            {!!error && <InlineAlert message={error} style={s.error} />}
            <Button title={progress || t(editingId ? 'mkSave' : 'mkPublish', lang)} onPress={save} loading={saving}
              loadingTitle={progress || undefined} fullWidth style={s.submit} />
          </ScrollView>
        </KeyboardAwareForm>
      </SafeAreaView>
    </PageCanvas>
  )
}

const s = StyleSheet.create({
  safe:        { flex: 1 },
  scroll:      { padding: 20, paddingBottom: 48 },
  labelRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 20, marginBottom: 8 },
  label:       { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textSecondaryOnPage, letterSpacing: 0.2 },
  hint:        { ...type.caption, color: colors.textSecondaryOnPage },
  note:        { ...type.caption, color: colors.textSecondaryOnPage, marginTop: 6 },
  input:       { backgroundColor: colors.card, borderRadius: radii.input || 12, borderWidth: 1, borderColor: colors.border,
                 paddingHorizontal: 14, paddingVertical: 12, ...type.body, color: colors.textPrimary },
  textArea:    { minHeight: 120 },
  photos:      { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  thumbWrap:   { width: 92, height: 92, borderRadius: radii.card, overflow: 'hidden' },
  thumb:       { width: 92, height: 92 },
  thumbEmpty:  { backgroundColor: colors.soft },
  pending:     { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)', paddingVertical: 3, alignItems: 'center' },
  pendingText: { ...type.caption, color: '#FFFFFF' },
  remove:      { position: 'absolute', top: 4, right: 4, backgroundColor: 'transparent' },
  addPhoto:    { width: 92, height: 92, borderRadius: radii.card, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.primary,
                 backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', gap: 4, padding: 6 },
  addPhotoText: { ...type.caption, color: colors.primary, textAlign: 'center' },
  freeRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card,
                 borderRadius: radii.card, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 10 },
  freeText:    { ...type.body, color: colors.textPrimary },
  priceWrap:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  priceInput:  { flex: 1 },
  currency:    { ...type.rowTitle, color: colors.textPrimary },
  rules:       { marginTop: 24 },
  check:       { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, minHeight: 44 },
  checkText:   { flex: 1, ...type.body, color: colors.textPrimary },
  error:       { marginTop: 16 },
  submit:      { marginTop: 24 },
})
