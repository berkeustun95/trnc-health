import { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Image, Switch,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import KeyboardAwareForm from '../components/KeyboardAwareForm'
import { Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { supabase } from '../lib/supabase'
import { colors, shadow, radius } from '../constants/theme'
import { t } from '../constants/i18n'
import { REGIONS, REGION_LABEL_KEY } from '../constants/regions'
import { SUBMITTABLE_CATEGORIES, CATEGORY_LABEL_KEY } from '../constants/exploreCategories'
import MapPinPicker from '../components/MapPinPicker'

function decode(base64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const lookup = new Uint8Array(256)
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i
  lookup['='.charCodeAt(0)] = 0
  const len = base64.length
  let bufLen = (len * 3) >> 2
  if (base64[len - 1] === '=') bufLen--
  if (base64[len - 2] === '=') bufLen--
  const buf = new ArrayBuffer(bufLen)
  const out = new Uint8Array(buf)
  let p = 0
  for (let i = 0; i < len; i += 4) {
    const a = lookup[base64.charCodeAt(i)],   b = lookup[base64.charCodeAt(i + 1)]
    const c = lookup[base64.charCodeAt(i + 2)], d = lookup[base64.charCodeAt(i + 3)]
    out[p++] = (a << 2) | (b >> 4)
    if (p < bufLen) out[p++] = ((b & 15) << 4) | (c >> 2)
    if (p < bufLen) out[p++] = ((c & 3) << 6) | d
  }
  return buf
}

function regionLabel(r, lang) {
  return REGION_LABEL_KEY[r] ? t(REGION_LABEL_KEY[r], lang) : r
}
function categoryLabel(c, lang) {
  const key = CATEGORY_LABEL_KEY[c]
  return key ? t(key, lang) : c
}

function SectionLabel({ text }) {
  return <Text style={s.sectionLabel}>{text}</Text>
}

// ─── Success state ────────────────────────────────────────────────────────────

function SuccessState({ lang, onBack }) {
  return (
    <View style={s.stateWrap}>
      <Text style={s.stateEmoji}>✅</Text>
      <Text style={s.stateTitle}>{t('blSubmitSuccess', lang)}</Text>
      <Text style={s.stateSub}>{t('blSubmitSuccessSub', lang)}</Text>
      <TouchableOpacity style={s.doneBtn} onPress={onBack} activeOpacity={0.85}>
        <Text style={s.doneBtnText}>{t('back', lang)}</Text>
      </TouchableOpacity>
    </View>
  )
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ExploreSubmitScreen({ session, lang, onBack, onSubmitted }) {
  const [category, setCategory] = useState('beach')
  const [name,     setName]     = useState('')
  const [region,   setRegion]   = useState(null)
  const [desc,     setDesc]     = useState('')
  const [lat,      setLat]      = useState(null)
  const [lng,      setLng]      = useState(null)
  const [photos,   setPhotos]   = useState([])   // { uri, base64 }

  // Beach-only fields
  const [blueFlag, setBlueFlag] = useState(false)
  const [access,   setAccess]   = useState('public')

  const [showMap, setShowMap]   = useState(false)
  const [saving,  setSaving]    = useState(false)
  const [error,   setError]     = useState(null)
  const [done,    setDone]      = useState(false)

  const isBeach = category === 'beach'

  async function addPhoto() {
    if (photos.length >= 5) return
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, aspect: [4, 3], quality: 0.8, base64: true,
    })
    if (result.canceled) return
    const asset = result.assets[0]
    setPhotos(prev => [...prev, { uri: asset.uri, base64: asset.base64 }])
  }

  function removePhoto(i) {
    setPhotos(prev => prev.filter((_, j) => j !== i))
  }

  async function handleSubmit() {
    setError(null)
    if (!name.trim())        { setError(t('blSubmitErrName',     lang)); return }
    if (!region)             { setError(t('blSubmitErrDistrict', lang)); return }
    if (lat == null || lng == null) { setError(t('blSubmitErrLocation', lang)); return }

    setSaving(true)
    try {
      // PHOTO-FIRST (atomic): upload photos BEFORE inserting the row, so a failed upload
      // aborts before any `places` row exists — no half-saved, photo-less place, and no
      // rowId-in-path dependency. Path = {uid}/{timestamp}/i.ext: uid so the uid-owner
      // place-photos DELETE policy lets the submitter clean up their own uploads; a
      // timestamp (NOT crypto.randomUUID — unreliable on Hermes) for a client-unique
      // folder, matching the events / estate-doc path convention.
      //
      // ORPHAN TRADE-OFF (accepted, vs orphan ROWS): a failure AFTER upload but BEFORE
      // the insert commits leaves files under {uid}/{ts}/ with no row pointing at them.
      // Two sources: (1) a later photo's upload throwing; (2) once Slice 3's content
      // filter lands, the INSERT being rejected (BLOCKED_TERM) after photos are up.
      // A backlog orphan-sweep reclaims them (see backlog.md).
      const uid   = session.user.id
      const stamp = Date.now()
      const urls  = []
      for (let i = 0; i < photos.length; i++) {
        const ph  = photos[i]
        const ext = (ph.uri.split('.').pop() || 'jpg').toLowerCase().split('?')[0]
        const path = `${uid}/${stamp}/${i}.${ext}`
        const ct   = ext === 'jpeg' || ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
        const { error: upErr } = await supabase.storage
          .from('place-photos')
          .upload(path, decode(ph.base64), { contentType: ct })
        if (upErr) throw upErr
        const { data: { publicUrl } } = supabase.storage
          .from('place-photos').getPublicUrl(path)
        urls.push(publicUrl)
      }

      // name = plain proper noun. name_i18n stays NULL on user submit (translations are a
      // curation step). description is locale-specific → description_i18n.
      const payload = {
        submitted_by:    uid,
        category,
        name:            name.trim(),
        description_i18n: desc.trim() ? { [lang]: desc.trim() } : null,
        region,
        latitude:        lat,
        longitude:       lng,
        status:          'pending',
        photos:          urls,
        cover_image_url: urls[0] || null,
        ...(isBeach ? { blue_flag: blueFlag, access_type: access } : {}),
      }
      const { error: insErr } = await supabase.from('places').insert(payload)
      if (insErr) throw insErr

      setDone(true)
      onSubmitted?.()
    } catch (err) {
      setError(err.message || 'Submission failed. Try again.')
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    return (
      <SafeAreaView style={[s.safe, s.safeCenter]} edges={['top', 'bottom']}>
        <SuccessState lang={lang} onBack={onBack} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAwareForm>

        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>{t('blSubmitTitle', lang)}</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Category */}
          <SectionLabel text={t('blSubmitType', lang)} />
          <View style={s.chipWrap}>
            {SUBMITTABLE_CATEGORIES.map(c => (
              <TouchableOpacity
                key={c}
                style={[s.chip, category === c && s.chipActive]}
                onPress={() => setCategory(c)}
                activeOpacity={0.8}
              >
                <Text style={[s.chipText, category === c && s.chipTextActive]}>
                  {categoryLabel(c, lang)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Name */}
          <SectionLabel text={t('blSubmitName', lang)} />
          <TextInput
            style={s.input}
            value={name}
            onChangeText={setName}
            placeholder={t('blSubmitNamePlaceholder', lang)}
            placeholderTextColor={colors.textSecondary}
          />

          {/* Region */}
          <SectionLabel text={t('blSubmitDistrict', lang)} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipScroll}>
            {REGIONS.map(r => (
              <TouchableOpacity
                key={r}
                style={[s.chip, region === r && s.chipActive]}
                onPress={() => setRegion(r)}
                activeOpacity={0.8}
              >
                <Text style={[s.chipText, region === r && s.chipTextActive]}>
                  {regionLabel(r, lang)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Description */}
          <SectionLabel text={t('blSubmitDesc', lang)} />
          <TextInput
            style={[s.input, s.textArea]}
            value={desc}
            onChangeText={setDesc}
            placeholder={t('blSubmitDescPlaceholder', lang)}
            placeholderTextColor={colors.textSecondary}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />

          {/* Location */}
          <SectionLabel text={t('blSubmitLocation', lang)} />
          <TouchableOpacity
            style={[s.pinBtn, lat != null && s.pinBtnDone]}
            onPress={() => setShowMap(true)}
            activeOpacity={0.85}
          >
            <Ionicons name="map-outline" size={18} color={lat != null ? colors.success : colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[s.pinBtnText, lat != null && s.pinBtnTextDone]}>
                {lat != null ? t('blSubmitPinned', lang) : t('blSubmitPinBtn', lang)}
              </Text>
              {lat != null && (
                <Text style={s.coordText}>{lat.toFixed(5)}, {lng.toFixed(5)}</Text>
              )}
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          </TouchableOpacity>

          {/* Photos */}
          <SectionLabel text={t('blSubmitPhotos', lang)} />
          <View style={s.photosRow}>
            {photos.map((ph, i) => (
              <View key={i} style={s.thumbWrap}>
                <Image source={{ uri: ph.uri }} style={s.thumb} resizeMode="cover" />
                <TouchableOpacity style={s.thumbRemove} onPress={() => removePhoto(i)}>
                  <Ionicons name="close-circle" size={22} color="#fff" />
                </TouchableOpacity>
              </View>
            ))}
            {photos.length < 5 && (
              <TouchableOpacity style={s.addPhotoBtn} onPress={addPhoto} activeOpacity={0.8}>
                <Ionicons name="add" size={28} color={colors.primary} />
                <Text style={s.addPhotoText}>{t('blSubmitAddPhoto', lang)}</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Beach-only fields */}
          {isBeach && (
            <>
              <View style={s.switchRow}>
                <Text style={s.switchLabel}>{t('blSubmitBlueFlag', lang)}</Text>
                <Switch
                  value={blueFlag}
                  onValueChange={setBlueFlag}
                  trackColor={{ false: colors.border, true: colors.primaryLight }}
                  thumbColor={blueFlag ? colors.primary : '#ccc'}
                />
              </View>

              <SectionLabel text={t('blSubmitAccess', lang)} />
              <View style={s.chipRow}>
                {['public', 'private'].map(a => (
                  <TouchableOpacity
                    key={a}
                    style={[s.chip, access === a && s.chipActive]}
                    onPress={() => setAccess(a)}
                    activeOpacity={0.8}
                  >
                    <Text style={[s.chipText, access === a && s.chipTextActive]}>
                      {t(a === 'public' ? 'blAccessPublic' : 'blAccessPrivate', lang)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {error && <Text style={s.error}>{error}</Text>}

          <TouchableOpacity
            style={[s.submitBtn, saving && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.submitBtnText}>{t('blSubmitBtn', lang)}</Text>
            }
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAwareForm>

      <MapPinPicker
        visible={showMap}
        initialLat={lat}
        initialLng={lng}
        onConfirm={(latitude, longitude) => {   // MapPinPicker passes positional (lat, lng), not an object
          setLat(latitude)
          setLng(longitude)
          setShowMap(false)
        }}
        onCancel={() => setShowMap(false)}
      />
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: colors.bg },
  safeCenter: { justifyContent: 'center' },

  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                 paddingHorizontal: 16, paddingVertical: 14,
                 backgroundColor: colors.cardBg, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontFamily: 'Inter_700Bold',
                 color: colors.textPrimary },

  scroll:       { padding: 20, gap: 0, paddingBottom: 48 },
  sectionLabel: { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textSecondary,
                  textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8, marginTop: 20 },

  // Chips
  chipRow:    { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chipWrap:   { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chipScroll: { gap: 8, paddingRight: 16 },
  chip:       { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20,
                backgroundColor: colors.cardBg, borderWidth: 1.5, borderColor: colors.border },
  chipActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  chipText:       { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  chipTextActive: { fontFamily: 'Inter_700Bold', color: colors.primary },

  // Inputs
  input:    { backgroundColor: colors.cardBg, borderWidth: 1.5, borderColor: colors.border,
              borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12,
              fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  textArea: { height: 100, paddingTop: 12 },

  // Location pin button
  pinBtn:      { flexDirection: 'row', alignItems: 'center', gap: 10,
                 backgroundColor: colors.cardBg, borderWidth: 1.5, borderColor: colors.primary,
                 borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12 },
  pinBtnDone:  { borderColor: colors.success, backgroundColor: colors.successLight },
  pinBtnText:     { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.primary },
  pinBtnTextDone: { color: colors.success },
  coordText:      { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 2 },

  // Photos
  photosRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  thumbWrap: { position: 'relative' },
  thumb:     { width: 80, height: 80, borderRadius: radius.sm },
  thumbRemove: { position: 'absolute', top: -8, right: -8 },
  addPhotoBtn: { width: 80, height: 80, borderRadius: radius.sm,
                 backgroundColor: colors.cardBg, borderWidth: 1.5, borderColor: colors.border,
                 borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 2 },
  addPhotoText: { fontSize: 10, fontFamily: 'Inter_400Regular', color: colors.primary, textAlign: 'center' },

  // Blue Flag switch
  switchRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                backgroundColor: colors.cardBg, borderWidth: 1.5, borderColor: colors.border,
                borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, marginTop: 8 },
  switchLabel:{ fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textPrimary },

  // Error
  error: { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.danger,
           marginTop: 16, textAlign: 'center' },

  // Submit button
  submitBtn:     { marginTop: 28, backgroundColor: colors.primary, borderRadius: radius.md,
                   paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  submitBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },

  // Success state
  stateWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  stateEmoji: { fontSize: 56 },
  stateTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textAlign: 'center' },
  stateSub:   { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                textAlign: 'center', lineHeight: 22 },
  doneBtn:    { marginTop: 12, backgroundColor: colors.primary, borderRadius: radius.md,
                paddingHorizontal: 40, paddingVertical: 14 },
  doneBtnText:{ fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
})
