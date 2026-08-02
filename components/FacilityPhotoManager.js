import { useState } from 'react'
import { View, Text, Image, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { Feather } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { supabase } from '../lib/supabase'
import { colors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'

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
    const a = lookup[base64.charCodeAt(i)]
    const b = lookup[base64.charCodeAt(i + 1)]
    const c = lookup[base64.charCodeAt(i + 2)]
    const d = lookup[base64.charCodeAt(i + 3)]
    out[p++] = (a << 2) | (b >> 4)
    if (p < bufLen) out[p++] = ((b & 15) << 4) | (c >> 2)
    if (p < bufLen) out[p++] = ((c & 3) << 6) | d
  }
  return buf
}

// Shared logo/cover/gallery uploader — one card, three roles. Consumed by
// ProviderScreen (health) + garage/grooming onboarding. Writes to the public
// `facility-images` bucket keyed by facility id, then persists the URL(s) to
// facilities.{cover_image_url,logo_url,photos}. Behaviour is the exact photo
// block previously inlined in ProviderScreen.
export default function FacilityPhotoManager({
  facilityId,
  initialCover = null,
  initialLogo = null,
  initialPhotos = [],
  lang = 'English',
  onFacilityUpdated,
}) {
  const [coverUrl, setCoverUrl]           = useState(initialCover ?? null)
  const [logoUrl, setLogoUrl]             = useState(initialLogo ?? null)
  const [photos, setPhotos]               = useState(Array.isArray(initialPhotos) ? initialPhotos : [])
  const [uploadingCover, setUploadingCover] = useState(false)
  const [uploadingLogo, setUploadingLogo]   = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [imageError, setImageError]         = useState(null)

  async function pickAndUploadImage(type) {
    const isCover = type === 'cover'
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: isCover ? [16, 9] : [1, 1],
      quality: 0.7,
      base64: true,
    })
    if (result.canceled) return
    const asset = result.assets[0]
    if (isCover) setUploadingCover(true); else setUploadingLogo(true)
    setImageError(null)
    try {
      const ext = (asset.uri.split('.').pop() || 'jpg').toLowerCase()
      const path = `${facilityId}/${type}.${ext}`
      const contentType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
      const { error: uploadError } = await supabase.storage
        .from('facility-images')
        .upload(path, decode(asset.base64), { contentType, upsert: true })
      if (uploadError) throw uploadError
      const { data: { publicUrl } } = supabase.storage.from('facility-images').getPublicUrl(path)
      const url = `${publicUrl}?t=${Date.now()}`
      const field = isCover ? 'cover_image_url' : 'logo_url'
      await supabase.from('facilities').update({ [field]: url }).eq('id', facilityId)
      if (isCover) setCoverUrl(url); else setLogoUrl(url)
      if (onFacilityUpdated) onFacilityUpdated()
    } catch (err) {
      console.error('Image upload error:', err)
      setImageError(t('uploadFailed', lang))
    } finally {
      if (isCover) setUploadingCover(false); else setUploadingLogo(false)
    }
  }

  async function addPhoto() {
    if (photos.length >= 8) return
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
      base64: true,
    })
    if (result.canceled) return
    const asset = result.assets[0]
    setUploadingPhoto(true)
    setImageError(null)
    try {
      const ext = (asset.uri.split('.').pop() || 'jpg').toLowerCase()
      const path = `${facilityId}/photos/${Date.now()}.${ext}`
      const contentType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
      const { error: upErr } = await supabase.storage
        .from('facility-images')
        .upload(path, decode(asset.base64), { contentType })
      if (upErr) throw upErr
      const { data: { publicUrl } } = supabase.storage.from('facility-images').getPublicUrl(path)
      const next = [...photos, publicUrl]
      await supabase.from('facilities').update({ photos: next }).eq('id', facilityId)
      setPhotos(next)
      if (onFacilityUpdated) onFacilityUpdated()
    } catch {
      setImageError(t('uploadFailed', lang))
    } finally {
      setUploadingPhoto(false)
    }
  }

  async function removePhoto(url) {
    const next = photos.filter(p => p !== url)
    await supabase.from('facilities').update({ photos: next }).eq('id', facilityId)
    setPhotos(next)
    if (onFacilityUpdated) onFacilityUpdated()
  }

  return (
    <View style={styles.card}>
      <Text style={styles.fieldLabel}>{t('coverPhoto', lang)}</Text>
      <TouchableOpacity style={styles.coverUploadArea} onPress={() => pickAndUploadImage('cover')} activeOpacity={0.8}>
        {coverUrl
          ? <Image source={{ uri: coverUrl }} style={styles.coverPreview} resizeMode="cover" />
          : <View style={styles.uploadPlaceholder}>
              <Feather name="camera" size={22} color={colors.textSecondary} />
              <Text style={styles.uploadHint}>{t('tapToAddCover', lang)}</Text>
            </View>
        }
        {uploadingCover && <ActivityIndicator style={StyleSheet.absoluteFill} color={colors.primary} />}
        {coverUrl && (
          <View style={styles.uploadEditBadge}>
            <Feather name="edit-2" size={11} color="#fff" />
          </View>
        )}
      </TouchableOpacity>

      <Text style={[styles.fieldLabel, { marginTop: 16 }]}>{t('logoLabel', lang)}</Text>
      <TouchableOpacity style={styles.logoUploadArea} onPress={() => pickAndUploadImage('logo')} activeOpacity={0.8}>
        {logoUrl
          ? <Image source={{ uri: logoUrl }} style={styles.logoPreview} resizeMode="cover" />
          : <View style={styles.uploadPlaceholder}>
              <Feather name="image" size={18} color={colors.textSecondary} />
              <Text style={styles.uploadHint}>{t('tapToAddLogo', lang)}</Text>
            </View>
        }
        {uploadingLogo && <ActivityIndicator style={StyleSheet.absoluteFill} color={colors.primary} />}
        {logoUrl && (
          <View style={styles.uploadEditBadge}>
            <Feather name="edit-2" size={11} color="#fff" />
          </View>
        )}
      </TouchableOpacity>

      <View style={styles.photosHeader}>
        <Text style={[styles.fieldLabel, { marginTop: 16, marginBottom: 0 }]}>PHOTOS</Text>
        <Text style={styles.photoCount}>{photos.length}/8</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoScroll} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
        {photos.map((url, i) => (
          <View key={i} style={styles.photoThumb}>
            <Image source={{ uri: url }} style={styles.photoThumbImg} resizeMode="cover" />
            <TouchableOpacity style={styles.photoRemoveBtn} onPress={() => removePhoto(url)} hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}>
              <Feather name="x" size={11} color="#fff" />
            </TouchableOpacity>
          </View>
        ))}
        {photos.length < 8 && (
          <TouchableOpacity style={styles.photoAddThumb} onPress={addPhoto} disabled={uploadingPhoto} activeOpacity={0.8}>
            {uploadingPhoto
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <>
                  <Feather name="plus" size={20} color={colors.primary} />
                  <Text style={styles.photoAddText}>Add</Text>
                </>
            }
          </TouchableOpacity>
        )}
      </ScrollView>

      {imageError && <Text style={styles.imageErrorText}>{imageError}</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  card:             { backgroundColor: colors.cardBg, borderRadius: 16, padding: 16, marginBottom: 10, ...shadow },
  fieldLabel:       { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  coverUploadArea:  { height: 140, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.border, justifyContent: 'center', alignItems: 'center', position: 'relative' },
  coverPreview:     { width: '100%', height: '100%' },
  logoUploadArea:   { width: 90, height: 90, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.border, justifyContent: 'center', alignItems: 'center', position: 'relative' },
  logoPreview:      { width: '100%', height: '100%' },
  uploadPlaceholder:{ alignItems: 'center', gap: 8 },
  uploadHint:       { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  uploadEditBadge:  { position: 'absolute', bottom: 8, right: 8, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  imageErrorText:   { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.danger, marginTop: 8 },
  photosHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  photoCount:       { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  photoScroll:      { marginTop: 10 },
  photoThumb:       { width: 90, height: 68, borderRadius: 10, overflow: 'hidden', position: 'relative' },
  photoThumbImg:    { width: '100%', height: '100%' },
  photoRemoveBtn:   { position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center' },
  photoAddThumb:    { width: 90, height: 68, borderRadius: 10, borderWidth: 1.5, borderColor: colors.border, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', gap: 3 },
  photoAddText:     { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.primary },
})
