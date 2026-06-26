import { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator, Image, Switch, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { supabase } from '../lib/supabase'
import { colors, placeColors, shadow, radius } from '../constants/theme'
import { t } from '../constants/i18n'
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

const DISTRICTS = ['nicosia', 'kyrenia', 'famagusta', 'morphou', 'iskele', 'lefke', 'karpaz']

const CATEGORIES = [
  'castle_fortress', 'ancient_ruins', 'museum',
  'religious_site',  'monument',      'nature_scenic',
]

const CATEGORY_KEY = {
  castle_fortress: 'blCatCastleFortress',
  ancient_ruins:   'blCatAncientRuins',
  museum:          'blCatMuseum',
  religious_site:  'blCatReligiousSite',
  monument:        'blCatMonument',
  nature_scenic:   'blCatNatureScenic',
}

function districtLabel(d, lang) {
  const map = {
    nicosia:   t('blDistrictNicosia', lang),
    kyrenia:   t('blDistrictKyrenia', lang),
    famagusta: t('blDistrictFamagusta', lang),
    morphou:   t('blDistrictMorphou', lang),
    iskele:    t('blDistrictIskele', lang),
    lefke:     t('blDistrictLefke', lang),
    karpaz:    t('blDistrictKarpaz', lang),
  }
  return map[d] || d
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

export default function PlaceSubmitScreen({ session, lang, onBack, onSubmitted }) {
  const [placeType, setPlaceType] = useState('beach')
  const [name,      setName]      = useState('')
  const [district,  setDistrict]  = useState(null)
  const [desc,      setDesc]      = useState('')
  const [lat,       setLat]       = useState(null)
  const [lng,       setLng]       = useState(null)
  const [photos,    setPhotos]    = useState([])   // { uri, base64 }

  // Beach-specific
  const [blueFlag,  setBlueFlag]  = useState(false)
  const [access,    setAccess]    = useState('public')

  // Landmark-specific
  const [category,  setCategory]  = useState(null)

  const [showMap, setShowMap]   = useState(false)
  const [saving,  setSaving]    = useState(false)
  const [error,   setError]     = useState(null)
  const [done,    setDone]      = useState(false)

  async function addPhoto() {
    if (photos.length >= 5) return
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      Alert.alert('Permission required', 'Photo library access is needed.')
      return
    }
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
    if (!district)           { setError(t('blSubmitErrDistrict', lang)); return }
    if (lat == null || lng == null) { setError(t('blSubmitErrLocation', lang)); return }

    setSaving(true)
    try {
      const table = placeType === 'beach' ? 'beaches' : 'landmarks'
      const base  = {
        submitted_by: session.user.id,
        name:         { [lang]: name.trim() },
        district,
        latitude:     lat,
        longitude:    lng,
        description:  desc.trim() ? { [lang]: desc.trim() } : null,
        status:       'pending',
        photo_urls:   [],
      }
      const payload = placeType === 'beach'
        ? { ...base, blue_flag: blueFlag, access_type: access }
        : { ...base, category: category || 'monument' }

      const { data, error: insErr } = await supabase
        .from(table).insert(payload).select('id').single()
      if (insErr) throw insErr
      const rowId = data.id

      // Upload photos to place-photos bucket
      const urls = []
      for (let i = 0; i < photos.length; i++) {
        const ph  = photos[i]
        const ext = (ph.uri.split('.').pop() || 'jpg').toLowerCase().split('?')[0]
        const path = `${table}/${rowId}/${i}.${ext}`
        const ct   = ext === 'jpeg' || ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
        const { error: upErr } = await supabase.storage
          .from('place-photos')
          .upload(path, decode(ph.base64), { contentType: ct })
        if (upErr) throw upErr
        const { data: { publicUrl } } = supabase.storage
          .from('place-photos').getPublicUrl(path)
        urls.push(publicUrl)
      }

      if (urls.length > 0) {
        await supabase.from(table).update({ photo_urls: urls }).eq('id', rowId)
      }

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
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

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
          {/* Type */}
          <SectionLabel text={t('blSubmitType', lang)} />
          <View style={s.chipRow}>
            {['beach', 'landmark'].map(tp => (
              <TouchableOpacity
                key={tp}
                style={[s.chip, placeType === tp && s.chipActive]}
                onPress={() => setPlaceType(tp)}
                activeOpacity={0.8}
              >
                <Text style={[s.chipText, placeType === tp && s.chipTextActive]}>
                  {t(tp === 'beach' ? 'blFilterBeaches' : 'blFilterLandmarks', lang)}
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

          {/* District */}
          <SectionLabel text={t('blSubmitDistrict', lang)} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipScroll}>
            {DISTRICTS.map(d => (
              <TouchableOpacity
                key={d}
                style={[s.chip, district === d && s.chipActive]}
                onPress={() => setDistrict(d)}
                activeOpacity={0.8}
              >
                <Text style={[s.chipText, district === d && s.chipTextActive]}>
                  {districtLabel(d, lang)}
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
          {placeType === 'beach' && (
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

          {/* Landmark-only: category */}
          {placeType === 'landmark' && (
            <>
              <SectionLabel text={t('blSubmitCategory', lang)} />
              <View style={s.chipWrap}>
                {CATEGORIES.map(c => (
                  <TouchableOpacity
                    key={c}
                    style={[s.chip, category === c && s.chipActive]}
                    onPress={() => setCategory(c)}
                    activeOpacity={0.8}
                  >
                    <Text style={[s.chipText, category === c && s.chipTextActive]}>
                      {t(CATEGORY_KEY[c], lang)}
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
      </KeyboardAvoidingView>

      <MapPinPicker
        visible={showMap}
        initialLat={lat}
        initialLng={lng}
        onConfirm={({ latitude, longitude }) => {
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
