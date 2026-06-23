import { useState, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator, Image, Switch, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons, Feather } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { supabase } from '../lib/supabase'
import { colors, shadow } from '../constants/theme'
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

const INTENTS    = ['rent', 'sale', 'short_term']
const PROP_TYPES = ['apartment', 'villa', 'studio', 'house', 'land', 'commercial']
const DISTRICTS  = ['nicosia', 'kyrenia', 'famagusta', 'morphou', 'iskele']
const CURRENCIES = ['GBP', 'TRY', 'EUR']

function intentLabel(i, lang) {
  return { rent: t('accomRent', lang), sale: t('accomSale', lang), short_term: t('accomShortTerm', lang) }[i] || i
}
function typeLabel(tp, lang) {
  return {
    apartment: t('accomTypeApartment', lang), villa: t('accomTypeVilla', lang),
    studio:    t('accomTypeStudio', lang),    house: t('accomTypeHouse', lang),
    land:      t('accomTypeLand', lang),      commercial: t('accomTypeCommercial', lang),
  }[tp] || tp
}
function districtLabel(d, lang) {
  return {
    nicosia:   t('accomDistrictNicosia', lang),   kyrenia:   t('accomDistrictKyrenia', lang),
    famagusta: t('accomDistrictFamagusta', lang),  morphou:   t('accomDistrictMorphou', lang),
    iskele:    t('accomDistrictIskele', lang),
  }[d] || d
}

function ChipRow({ options, selected, onSelect, labelFn }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {options.map(opt => (
        <TouchableOpacity key={opt}
          style={[ps.chip, selected === opt && ps.chipActive]}
          onPress={() => onSelect(opt)}>
          <Text style={[ps.chipText, selected === opt && ps.chipTextActive]}>{labelFn(opt)}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  )
}

export default function PropertySubmitScreen({ session, lang, property: editProp, onClose, onSubmitted }) {
  const isEdit = !!editProp

  const [title, setTitle]           = useState(editProp?.title || '')
  const [description, setDesc]      = useState(editProp?.description || '')
  const [intent, setIntent]         = useState(editProp?.intent || 'rent')
  const [propType, setPropType]     = useState(editProp?.property_type || 'apartment')
  const [price, setPrice]           = useState(editProp?.price ? String(editProp.price) : '')
  const [currency, setCurrency]     = useState(editProp?.currency || 'GBP')
  const [period, setPeriod]         = useState(editProp?.price_period || 'monthly')
  const [bedrooms, setBedrooms]     = useState(editProp?.bedrooms ? String(editProp.bedrooms) : '')
  const [bathrooms, setBathrooms]   = useState(editProp?.bathrooms ? String(editProp.bathrooms) : '')
  const [area, setArea]             = useState(editProp?.area_sqm ? String(editProp.area_sqm) : '')
  const [furnished, setFurnished]   = useState(editProp?.furnished ?? null)
  const [district, setDistrict]     = useState(editProp?.district || null)
  const [address, setAddress]       = useState(editProp?.address || '')
  const [latitude, setLatitude]     = useState(editProp?.latitude || null)
  const [longitude, setLongitude]   = useState(editProp?.longitude || null)
  const [photos, setPhotos]         = useState([])
  const [showMapPicker, setShowMapPicker] = useState(false)
  const [agentRecord, setAgentRecord]     = useState(null)

  const [saving, setSaving]   = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError]     = useState(null)

  useEffect(() => {
    async function loadAgent() {
      const { data } = await supabase
        .from('estate_agents')
        .select('id, agency_id')
        .eq('user_id', session.user.id)
        .eq('status', 'active')
        .maybeSingle()
      setAgentRecord(data)
    }
    loadAgent()

    if (isEdit) {
      supabase.from('property_images').select('id, url, sort_order')
        .eq('property_id', editProp.id)
        .order('sort_order')
        .then(({ data }) => setPhotos(data || []))
    }
  }, [session.user.id, isEdit])

  // Period auto-set when intent changes
  useEffect(() => {
    if (intent === 'sale')       setPeriod('total')
    if (intent === 'rent')       setPeriod('monthly')
    if (intent === 'short_term') setPeriod('nightly')
  }, [intent])

  async function addPhoto() {
    if (photos.length >= 8) return
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) { Alert.alert('Permission required', 'Photo library access is needed.'); return }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, aspect: [4, 3], quality: 0.8, base64: true,
    })
    if (result.canceled) return
    const asset = result.assets[0]
    setUploading(true)
    try {
      const propId = isEdit ? editProp.id : `tmp-${session.user.id}-${Date.now()}`
      const ext    = (asset.uri.split('.').pop() || 'jpg').toLowerCase()
      const path   = `${propId}/${Date.now()}.${ext}`
      const contentType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
      const { error: upErr } = await supabase.storage
        .from('property-images')
        .upload(path, decode(asset.base64), { contentType })
      if (upErr) throw upErr
      const { data: { publicUrl } } = supabase.storage.from('property-images').getPublicUrl(path)
      setPhotos(prev => [...prev, { id: path, url: publicUrl, sort_order: prev.length }])
    } catch {
      setError('Photo upload failed. Try again.')
    } finally {
      setUploading(false)
    }
  }

  async function removePhoto(photo) {
    setPhotos(prev => prev.filter(p => p.id !== photo.id))
    // photos from the DB have UUID ids (no '/'); newly uploaded photos have a storage path
    if (isEdit && photo.id && !photo.id.includes('/')) {
      await supabase.from('property_images').delete().eq('id', photo.id)
    }
  }

  async function handleSubmit() {
    setError(null)
    if (!title.trim())   { setError('Title is required.'); return }
    if (!price.trim())   { setError('Price is required.'); return }
    if (!district)       { setError('Please select a district.'); return }
    if (!agentRecord)    { setError('Your agent profile must be approved before listing.'); return }

    setSaving(true)
    try {
      const payload = {
        agent_id:      agentRecord.id,
        agency_id:     agentRecord.agency_id || null,
        title:         title.trim(),
        description:   description.trim() || null,
        intent,
        property_type: propType,
        price:         Number(price),
        currency,
        price_period:  period,
        bedrooms:      bedrooms ? Number(bedrooms) : null,
        bathrooms:     bathrooms ? Number(bathrooms) : null,
        area_sqm:      area ? Number(area) : null,
        furnished:     furnished,
        district,
        address:       address.trim() || null,
        latitude,
        longitude,
        status:        'pending',
      }

      let propertyId
      if (isEdit) {
        const { error: updErr } = await supabase.from('properties').update(payload).eq('id', editProp.id)
        if (updErr) throw updErr
        propertyId = editProp.id
      } else {
        const { data, error: insErr } = await supabase.from('properties').insert(payload).select('id').single()
        if (insErr) throw insErr
        propertyId = data.id
      }

      // Save images (re-associate with property id if new listing)
      for (let i = 0; i < photos.length; i++) {
        const ph = photos[i]
        if (isEdit && !ph.id.includes('/')) {
          await supabase.from('property_images').update({ sort_order: i }).eq('id', ph.id)
        } else {
          await supabase.from('property_images').insert({ property_id: propertyId, url: ph.url, sort_order: i })
        }
      }

      onSubmitted?.()
    } catch (err) {
      setError(err.message || 'Submission failed. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SafeAreaView style={ps.safe} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Header */}
        <View style={ps.header}>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={ps.headerTitle}>{isEdit ? t('accomEditTitle', lang) : t('accomSubmitTitle', lang)}</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={ps.scrollContent} showsVerticalScrollIndicator={false}>

          {/* Basic info */}
          <Field label={t('accomPropTitle', lang)}>
            <TextInput style={ps.input} value={title} onChangeText={setTitle}
              placeholder="e.g. Spacious 2BR near the sea" placeholderTextColor={colors.textSecondary} />
          </Field>
          <Field label={t('accomPropDesc', lang)}>
            <TextInput style={[ps.input, { minHeight: 88 }]} value={description} onChangeText={setDesc}
              placeholder="Describe the property…" placeholderTextColor={colors.textSecondary}
              multiline textAlignVertical="top" />
          </Field>

          {/* Intent */}
          <Field label={t('accomPropIntent', lang)}>
            <ChipRow options={INTENTS} selected={intent} onSelect={setIntent} labelFn={i => intentLabel(i, lang)} />
          </Field>

          {/* Property type */}
          <Field label={t('accomPropType', lang)}>
            <ChipRow options={PROP_TYPES} selected={propType} onSelect={setPropType} labelFn={tp => typeLabel(tp, lang)} />
          </Field>

          {/* Price */}
          <View style={ps.priceRow}>
            <Field label={t('accomPropPrice', lang)} style={{ flex: 1 }}>
              <TextInput style={ps.input} value={price} onChangeText={setPrice}
                placeholder="0" placeholderTextColor={colors.textSecondary} keyboardType="numeric" />
            </Field>
            <View style={{ width: 10 }} />
            <Field label={t('accomPropCurrency', lang)} style={{ width: 100 }}>
              <View style={ps.currencyRow}>
                {CURRENCIES.map(c => (
                  <TouchableOpacity key={c} style={[ps.currencyBtn, currency === c && ps.currencyBtnActive]}
                    onPress={() => setCurrency(c)}>
                    <Text style={[ps.currencyBtnText, currency === c && ps.currencyBtnTextActive]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Field>
          </View>

          {/* Period */}
          <Field label={t('accomPropPeriod', lang)}>
            <ChipRow
              options={['monthly', 'nightly', 'total']}
              selected={period}
              onSelect={setPeriod}
              labelFn={p => ({ monthly: t('accomPropPeriodMonthly', lang), nightly: t('accomPropPeriodNightly', lang), total: t('accomPropPeriodTotal', lang) }[p])}
            />
          </Field>

          {/* Specs */}
          <View style={ps.specRow}>
            <Field label={t('accomPropBedrooms', lang)} style={{ flex: 1 }}>
              <TextInput style={ps.input} value={bedrooms} onChangeText={setBedrooms}
                placeholder="0" placeholderTextColor={colors.textSecondary} keyboardType="numeric" />
            </Field>
            <View style={{ width: 10 }} />
            <Field label={t('accomPropBathrooms', lang)} style={{ flex: 1 }}>
              <TextInput style={ps.input} value={bathrooms} onChangeText={setBathrooms}
                placeholder="0" placeholderTextColor={colors.textSecondary} keyboardType="numeric" />
            </Field>
            <View style={{ width: 10 }} />
            <Field label={t('accomPropArea', lang)} style={{ flex: 1 }}>
              <TextInput style={ps.input} value={area} onChangeText={setArea}
                placeholder="m²" placeholderTextColor={colors.textSecondary} keyboardType="numeric" />
            </Field>
          </View>

          {/* Furnished */}
          <View style={ps.switchRow}>
            <Text style={ps.switchLabel}>{t('accomPropFurnished', lang)}</Text>
            <Switch
              value={furnished === true}
              onValueChange={v => setFurnished(v)}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
            />
          </View>

          {/* District */}
          <Field label={t('accomPropDistrict', lang)}>
            <ChipRow
              options={DISTRICTS}
              selected={district}
              onSelect={setDistrict}
              labelFn={d => districtLabel(d, lang)}
            />
          </Field>

          {/* Address + map pin */}
          <Field label={t('accomPropAddress', lang)}>
            <TextInput style={ps.input} value={address} onChangeText={setAddress}
              placeholder="Street, building…" placeholderTextColor={colors.textSecondary} />
          </Field>

          <TouchableOpacity style={ps.mapPinBtn} onPress={() => setShowMapPicker(true)}>
            <Ionicons name="location-outline" size={18} color={colors.primary} />
            <Text style={ps.mapPinText}>
              {latitude != null ? `📍 ${latitude.toFixed(5)}, ${longitude.toFixed(5)}` : '📍 Pin on map (optional)'}
            </Text>
          </TouchableOpacity>

          {/* Photos */}
          <Field label={`${t('accomPropPhotos', lang)} (${photos.length}/8)`}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ps.photosRow}>
              {photos.map((ph, i) => (
                <View key={ph.id || i} style={ps.photoThumb}>
                  <Image source={{ uri: ph.url }} style={ps.photoThumbImg} resizeMode="cover" />
                  <TouchableOpacity style={ps.photoRemoveBtn} onPress={() => removePhoto(ph)}>
                    <Feather name="x" size={14} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
              {photos.length < 8 && (
                <TouchableOpacity style={ps.photoAddBtn} onPress={addPhoto} disabled={uploading}>
                  {uploading
                    ? <ActivityIndicator size="small" color={colors.primary} />
                    : <>
                        <Ionicons name="camera-outline" size={24} color={colors.primary} />
                        <Text style={ps.photoAddText}>{t('accomAddPhoto', lang)}</Text>
                      </>
                  }
                </TouchableOpacity>
              )}
            </ScrollView>
          </Field>

          {error && <Text style={ps.errorText}>{error}</Text>}

          <TouchableOpacity
            style={[ps.primaryBtn, (saving || uploading) && ps.primaryBtnDisabled]}
            onPress={handleSubmit}
            disabled={saving || uploading}
          >
            {saving
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={ps.primaryBtnText}>{t('accomSubmitListing', lang)}</Text>
            }
          </TouchableOpacity>
          <Text style={ps.reviewNote}>Listing will be reviewed before going live.</Text>
        </ScrollView>
      </KeyboardAvoidingView>

      <MapPinPicker
        visible={showMapPicker}
        initialLat={latitude}
        initialLng={longitude}
        onConfirm={(lat, lng) => { setLatitude(lat); setLongitude(lng); setShowMapPicker(false) }}
        onCancel={() => setShowMapPicker(false)}
      />
    </SafeAreaView>
  )
}

function Field({ label, children, style }) {
  return (
    <View style={[ps.fieldGroup, style]}>
      <Text style={ps.fieldLabel}>{label}</Text>
      {children}
    </View>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const ps = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: colors.bg },
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  headerTitle:     { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  scrollContent:   { paddingHorizontal: 20, paddingBottom: 60 },

  fieldGroup:      { marginBottom: 16 },
  fieldLabel:      { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 7 },
  input:           { borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, padding: 13, fontSize: 15, fontFamily: 'Inter_400Regular', backgroundColor: colors.surface, color: colors.textPrimary },

  chip:            { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  chipActive:      { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  chipText:        { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  chipTextActive:  { fontFamily: 'Inter_700Bold', color: colors.primary },

  priceRow:        { flexDirection: 'row', alignItems: 'flex-start' },
  currencyRow:     { flexDirection: 'row', gap: 4 },
  currencyBtn:     { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', backgroundColor: colors.surface },
  currencyBtnActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  currencyBtnText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  currencyBtnTextActive: { fontFamily: 'Inter_700Bold', color: colors.primary },

  specRow:         { flexDirection: 'row', alignItems: 'flex-start' },
  switchRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, paddingVertical: 4 },
  switchLabel:     { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textPrimary },

  mapPinBtn:       { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: 16 },
  mapPinText:      { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary },

  photosRow:       { gap: 8, paddingVertical: 4 },
  photoThumb:      { width: 90, height: 90, borderRadius: 10, overflow: 'hidden' },
  photoThumbImg:   { width: 90, height: 90 },
  photoRemoveBtn:  { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  photoAddBtn:     { width: 90, height: 90, borderRadius: 10, borderWidth: 1.5, borderColor: colors.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: colors.surface },
  photoAddText:    { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.primary, textAlign: 'center' },

  errorText:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.danger, marginBottom: 14, textAlign: 'center' },
  primaryBtn:      { backgroundColor: colors.primary, borderRadius: 14, padding: 15, alignItems: 'center', marginTop: 8, marginBottom: 12 },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText:  { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
  reviewNote:      { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center' },
})
