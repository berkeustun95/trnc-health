import { useState, useRef, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Image, Alert,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import KeyboardAwareForm from '../components/KeyboardAwareForm'
import FilterDropdown from '../components/FilterDropdown'
import { ScreenHeader, PageCanvas, Button, InfoBanner } from '../components/ui'
import { photoUrl } from '../components/cars/VehicleCard'
import { supabase } from '../lib/supabase'
import { colors, radius, type, radii } from '../constants/theme'
import { t } from '../constants/i18n'
import { REGIONS, REGION_LABEL_KEY } from '../constants/regions'
import {
  VEHICLE_BUCKET, MAX_PHOTOS, POST_INTENTS, FUELS, GEARBOXES, BODIES, COLOURS, STEERINGS, CURRENCIES, CURRENCY_SYMBOL,
  INTENT_LABEL_KEY, FUEL_LABEL_KEY, GEARBOX_LABEL_KEY, BODY_LABEL_KEY, COLOUR_LABEL_KEY, STEERING_LABEL_KEY,
  carForm, carFormError, carPayload, carErrorText, sortedImages,
} from '../constants/cars'

// ─── İlan ver / edit a private listing ──────────────────────────────────────
// Row first, then photos: a photo is only admitted into a listing the caller owns while it is PENDING (20261165; the
// vehicle-photo function applies the same rule), so an approved listing's photos can never be swapped behind the
// reviewer's back. Photos go through that function, which strips their location data first (20261182).
// That is also why editing an approved listing sends it back to review: the row goes to pending on Save (never on
// the first keystroke, so a listing does not go off the air while somebody is only looking), then the photos change.
// Inserts and updates name only the 18 granted columns (carPayload); status / owner_id / source are the server's.

// The bucket takes 5 MB. Picker compression keeps a phone photo well under it; anything still over is refused
// here with a reason instead of failing at upload. A real resize (expo-image-manipulator) waits for the next store build.
const MAX_BYTES = 5 * 1024 * 1024
const PICK_QUALITY = 0.6

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

// A local key for a picked photo (the stored file is named by the vehicle-photo function). expo-crypto when present.
function newUuid() {
  try {
    const Crypto = require('expo-crypto')
    if (typeof Crypto?.randomUUID === 'function') return Crypto.randomUUID().toLowerCase()
  } catch { /* fall through */ }
  const h = '0123456789abcdef'
  let s = ''
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) s += '-'
    else if (i === 14) s += '4'
    else if (i === 19) s += h[(Math.random() * 4) | 8]
    else s += h[(Math.random() * 16) | 0]
  }
  return s
}

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
function fileExt(asset) {
  const fromMime = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[asset.mimeType]
  if (fromMime) return fromMime
  const e = (asset.uri.split('?')[0].split('.').pop() || '').toLowerCase()
  return MIME[e] ? (e === 'jpeg' ? 'jpg' : e) : 'jpg'
}

function Label({ text, hint }) {
  return (
    <View style={s.labelRow}>
      <Text style={s.label}>{text}</Text>
      {!!hint && <Text style={s.labelHint}>{hint}</Text>}
    </View>
  )
}

function Chips({ options, value, onChange, labelOf }) {
  return (
    <View style={s.chipRow}>
      {options.map(o => {
        const on = o === value
        return (
          <TouchableOpacity key={o} style={[s.chip, on && s.chipOn]} onPress={() => onChange(o)} activeOpacity={0.85}
            accessibilityRole="radio" accessibilityState={{ selected: on }}>
            <Text style={[s.chipText, on && s.chipTextOn]}>{labelOf(o)}</Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

function Field({ value, onChangeText, placeholder, keyboardType, maxLength, multiline, autoCapitalize, autoComplete }) {
  return (
    <TextInput
      style={[s.input, multiline && s.textArea]}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.textSecondary}
      keyboardType={keyboardType}
      maxLength={maxLength}
      multiline={multiline}
      textAlignVertical={multiline ? 'top' : 'center'}
      autoCapitalize={autoCapitalize}
      autoComplete={autoComplete}
    />
  )
}

export default function CarPostScreen({ session, lang, car = null, profilePhone = null, backRef, onBack, onSaved }) {
  const insets = useSafeAreaInsets()
  const isEdit = !!car
  const initial = useRef(carForm(car, profilePhone)).current
  const [form, setForm] = useState(initial)
  // existing: rows already on the listing; added: picked this session, uploaded on Save.
  const [photos, setPhotos] = useState(() => sortedImages(car?.vehicle_images).map(i => ({ key: i.id, kind: 'existing', id: i.id, path: i.storage_path, uri: photoUrl(i.storage_path) })))
  const [removed, setRemoved] = useState([])
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const L = (map, code) => t(map[code], lang)

  async function addPhotos() {
    setError(null)
    const room = MAX_PHOTOS - photos.length
    if (room <= 0) return
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: room, orderedSelection: true,
      quality: PICK_QUALITY, base64: true, exif: false,
    })
    if (res.canceled) return
    let tooBig = 0
    const picked = []
    for (const a of res.assets.slice(0, room)) {
      if (!a.base64) continue
      if ((a.base64.length * 3) / 4 > MAX_BYTES) { tooBig++; continue }
      picked.push({ key: `new-${newUuid()}`, kind: 'new', uri: a.uri, base64: a.base64, ext: fileExt(a) })
    }
    if (picked.length) setPhotos(p => [...p, ...picked].slice(0, MAX_PHOTOS))
    if (tooBig) setError(t('carsPostPhotoTooBig', lang))
  }

  function removePhoto(ph) {
    setPhotos(p => p.filter(x => x.key !== ph.key))
    if (ph.kind === 'existing') setRemoved(r => [...r, ph])
  }
  function makeCover(ph) {
    setPhotos(p => [ph, ...p.filter(x => x.key !== ph.key)])
  }

  // Through the vehicle-photo edge function, never straight to the bucket (20261182 closed that): the function strips
  // every Exif / XMP block (GPS included) before the file is stored, then inserts the photo row as this user.
  async function uploadNew(vehicleId, list) {
    let failed = 0
    for (let i = 0; i < list.length; i++) {
      const ph = list[i]
      if (ph.kind !== 'new') continue
      const { error: fnErr } = await supabase.functions.invoke('vehicle-photo', {
        body: decode(ph.base64),
        headers: { 'Content-Type': MIME[ph.ext], 'x-vehicle-id': vehicleId, 'x-sort-order': String(i), 'x-primary': i === 0 ? '1' : '0' },
      })
      if (fnErr) failed++
    }
    return failed
  }

  async function save() {
    if (saving) return
    const problem = carFormError(form, photos.length)
    if (problem) { setError(t(problem, lang)); return }
    setError(null)
    setSaving(true)
    const payload = carPayload(form)
    try {
      if (!isEdit) {
        const { data, error: insErr } = await supabase.from('vehicles').insert(payload).select('id').single()
        if (insErr) throw insErr
        const failed = await uploadNew(data.id, photos)
        onSaved?.({ id: data.id, created: true, photoFailures: failed })
        return
      }

      const fieldsChanged = JSON.stringify(payload) !== JSON.stringify(carPayload(initial))
      const orderChanged = photos.some((p, i) => p.kind === 'existing' && sortedImages(car.vehicle_images).findIndex(x => x.id === p.id) !== i)
      const photosChanged = removed.length > 0 || photos.some(p => p.kind === 'new') || orderChanged
      if (!fieldsChanged && !photosChanged) { onBack(); return }

      // Always back to review: the guard does it for a field edit, and a photo-only edit must ask, because the photo
      // policies only open on a pending listing. Unconditional, because `car` is İlanlarım's copy and the admin may have
      // approved it since; pending → pending is no change to the guard.
      const patch = { ...payload, status: 'pending' }
      const { data: upd, error: updErr } = await supabase.from('vehicles').update(patch).eq('id', car.id).select('id')
      if (updErr) throw updErr
      if (!upd?.length) throw new Error('VEHICLE_NOT_FOUND')

      for (const ph of removed) {
        // Row first: a file with no row is swept later; a row with no file would be a broken photo.
        const { error: delErr } = await supabase.from('vehicle_images').delete().eq('id', ph.id)
        if (!delErr) await supabase.storage.from(VEHICLE_BUCKET).remove([ph.path])
      }
      for (let i = 0; i < photos.length; i++) {
        const ph = photos[i]
        if (ph.kind !== 'existing') continue
        await supabase.from('vehicle_images').update({ sort_order: i, is_primary: i === 0 }).eq('id', ph.id)
      }
      const failed = await uploadNew(car.id, photos)
      onSaved?.({ id: car.id, created: false, photoFailures: failed })
    } catch (e) {
      setError(carErrorText(e, k => t(k, lang)))
    } finally {
      setSaving(false)
    }
  }

  function confirmLeave() {
    const dirty = JSON.stringify(form) !== JSON.stringify(initial)
      || removed.length > 0 || photos.some(p => p.kind === 'new')
    if (!dirty) { onBack(); return }
    Alert.alert(t('carsPostDiscardTitle', lang), undefined, [
      { text: t('carsPostStay', lang), style: 'cancel' },
      { text: t('carsPostDiscard', lang), style: 'destructive', onPress: onBack },
    ])
  }

  // Android back / iOS edge swipe ask before throwing a filled form away, like the header back does. App's back chain
  // calls this through backRef: a listener of our own would not stay first, because App re-registers its listener
  // whenever one of its many deps changes, and the newest listener runs first.
  const leaveRef = useRef(confirmLeave)
  leaveRef.current = confirmLeave
  useEffect(() => {
    backRef.current = () => leaveRef.current()
    return () => { backRef.current = null }
  }, [])

  const reReview = isEdit && car.status !== 'pending'
  const priceLabel = form.intent === 'rent' ? t('carsPostPricePerDay', lang) : t('carsPostPrice', lang)

  return (
    <PageCanvas>
      <SafeAreaView style={s.safe} edges={['top']}>
        <KeyboardAwareForm>
          <ScreenHeader title={t(isEdit ? 'carsPostEditTitle' : 'carsPostTitle', lang)} onBack={confirmLeave} lang={lang} />
          <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}
            showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            <InfoBanner icon={reReview ? 'refresh-outline' : 'shield-checkmark-outline'}
              message={t(reReview ? 'carsPostReReview' : 'carsPostReviewNote', lang)} />

            <Label text={t('carsPostIntent', lang)} />
            <Chips options={POST_INTENTS} value={form.intent} onChange={v => set('intent', v)} labelOf={v => L(INTENT_LABEL_KEY, v)} />

            <Label text={t('carsPostPhotos', lang)} hint={`${photos.length}/${MAX_PHOTOS}`} />
            <View style={s.photos}>
              {photos.map((ph, i) => (
                <View key={ph.key} style={s.thumbWrap}>
                  <TouchableOpacity onPress={() => i > 0 && makeCover(ph)} activeOpacity={i > 0 ? 0.8 : 1}
                    accessibilityRole="button" accessibilityLabel={i === 0 ? t('carsPostCover', lang) : t('carsPostMakeCover', lang)}>
                    <Image source={{ uri: ph.uri }} style={s.thumb} resizeMode="cover" />
                  </TouchableOpacity>
                  {i === 0 && <View style={s.coverTag}><Text style={s.coverText}>{t('carsPostCover', lang)}</Text></View>}
                  <TouchableOpacity style={s.thumbRemove} onPress={() => removePhoto(ph)} hitSlop={8}
                    accessibilityRole="button" accessibilityLabel={t('uiRemove', lang)}>
                    <Ionicons name="close-circle" size={24} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
              {photos.length < MAX_PHOTOS && (
                <TouchableOpacity style={s.addPhoto} onPress={addPhotos} activeOpacity={0.8} accessibilityRole="button">
                  <Ionicons name="camera-outline" size={26} color={colors.primary} />
                  <Text style={s.addPhotoText}>{t('carsPostAddPhotos', lang)}</Text>
                </TouchableOpacity>
              )}
            </View>
            {photos.length > 1 && <Text style={s.help}>{t('carsPostCoverHint', lang)}</Text>}

            <Label text={t('carsPostMake', lang)} />
            <Field value={form.make} onChangeText={v => set('make', v)} placeholder={t('carsPostMakePh', lang)} maxLength={40} autoCapitalize="words" />
            <Label text={t('carsPostModel', lang)} />
            <Field value={form.model} onChangeText={v => set('model', v)} placeholder={t('carsPostModelPh', lang)} maxLength={60} autoCapitalize="words" />

            <View style={s.pair}>
              <View style={s.half}>
                <Label text={t('carsYear', lang)} />
                <Field value={form.year} onChangeText={v => set('year', v.replace(/[^0-9]/g, ''))} placeholder="2018" keyboardType="number-pad" maxLength={4} />
              </View>
              <View style={s.half}>
                <Label text={t('carsKm', lang)} />
                <Field value={form.km} onChangeText={v => set('km', v)} placeholder="65,000" keyboardType="number-pad" maxLength={9} />
              </View>
            </View>

            <Label text={t('carsFuel', lang)} />
            <Chips options={FUELS} value={form.fuel} onChange={v => set('fuel', v)} labelOf={v => L(FUEL_LABEL_KEY, v)} />
            <Label text={t('carsGearbox', lang)} />
            <Chips options={GEARBOXES} value={form.gearbox} onChange={v => set('gearbox', v)} labelOf={v => L(GEARBOX_LABEL_KEY, v)} />

            <View style={s.pair}>
              <View style={s.half}>
                <Label text={t('carsBody', lang)} />
                <FilterDropdown variant="field" allowAll={false} lang={lang} label={t('carsBody', lang)}
                  options={BODIES.map(b => ({ value: b, label: L(BODY_LABEL_KEY, b) }))} value={form.body_type} onChange={v => set('body_type', v)} />
              </View>
              <View style={s.half}>
                <Label text={t('carsColour', lang)} />
                <FilterDropdown variant="field" allowAll={false} lang={lang} label={t('carsColour', lang)}
                  options={COLOURS.map(c => ({ value: c, label: L(COLOUR_LABEL_KEY, c) }))} value={form.colour} onChange={v => set('colour', v)} />
              </View>
            </View>

            <Label text={t('carsSteering', lang)} hint={t('carsPostSteeringHint', lang)} />
            <Chips options={STEERINGS} value={form.steering} onChange={v => set('steering', v)} labelOf={v => L(STEERING_LABEL_KEY, v)} />

            <Label text={priceLabel} />
            <View style={s.priceRow}>
              <View style={{ flex: 1 }}>
                <Field value={form.price} onChangeText={v => set('price', v)} placeholder={form.intent === 'rent' ? '40' : '9,500'} keyboardType="number-pad" maxLength={12} />
              </View>
            </View>
            <Chips options={CURRENCIES} value={form.currency} onChange={v => set('currency', v)} labelOf={c => `${CURRENCY_SYMBOL[c]} ${c}`} />

            <Label text={t('carsPostRegion', lang)} />
            <FilterDropdown variant="field" allowAll={false} lang={lang} label={t('carsPostRegion', lang)}
              options={REGIONS.map(r => ({ value: r, label: t(REGION_LABEL_KEY[r], lang) }))} value={form.region} onChange={v => set('region', v)} />
            <Label text={t('carsPostArea', lang)} hint={t('carsPostOptional', lang)} />
            <Field value={form.area} onChangeText={v => set('area', v)} placeholder={t('carsPostAreaPh', lang)} maxLength={80} autoCapitalize="words" />

            <Label text={t('carsDescription', lang)} hint={`${form.description.length}/3000`} />
            <Field value={form.description} onChangeText={v => set('description', v)} placeholder={t('carsPostDescPh', lang)} maxLength={3000} multiline />

            <Label text={t('carsPostPhone', lang)} />
            <Field value={form.phone} onChangeText={v => set('phone', v)} placeholder="0533 123 45 67" keyboardType="phone-pad" maxLength={20} autoComplete="tel" />
            <Label text={t('carsPostWhatsapp', lang)} />
            <Field value={form.whatsapp} onChangeText={v => set('whatsapp', v)} placeholder="0533 123 45 67" keyboardType="phone-pad" maxLength={20} autoComplete="tel" />
            <Text style={s.help}>{t('carsPostContactHint', lang)}</Text>

            {!!error && <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text>}

            <Button title={t(isEdit ? 'carsPostSaveEdit' : 'carsPostSubmit', lang)} onPress={save} loading={saving}
              loadingTitle={t('carsPostSaving', lang)} fullWidth style={{ marginTop: 24 }} />
          </ScrollView>
        </KeyboardAwareForm>
      </SafeAreaView>
    </PageCanvas>
  )
}

const s = StyleSheet.create({
  safe:        { flex: 1 },
  scroll:      { paddingHorizontal: 20, paddingTop: 4 },
  labelRow:    { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 20, marginBottom: 8 },
  label:       { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textSecondaryOnPage, letterSpacing: 0.2 },
  labelHint:   { ...type.meta, color: colors.textSecondaryOnPage },
  chipRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:        { paddingHorizontal: 14, minHeight: 40, justifyContent: 'center', borderRadius: radii.pill,
                 backgroundColor: colors.cardBg, borderWidth: 1.5, borderColor: colors.border },
  chipOn:      { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  chipText:    { fontSize: 14, fontFamily: 'Inter_500Medium', color: colors.textSecondary },
  chipTextOn:  { fontFamily: 'Inter_700Bold', color: colors.primaryDark },
  input:       { backgroundColor: colors.cardBg, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md,
                 paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  textArea:    { minHeight: 120, paddingTop: 12 },
  pair:        { flexDirection: 'row', gap: 12 },
  half:        { flex: 1, minWidth: 0 },
  priceRow:    { flexDirection: 'row', gap: 10, marginBottom: 10 },
  photos:      { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  thumbWrap:   { position: 'relative' },
  thumb:       { width: 96, height: 72, borderRadius: radius.sm, backgroundColor: colors.soft },
  thumbRemove: { position: 'absolute', top: -8, right: -8, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 12 },
  coverTag:    { position: 'absolute', left: 4, bottom: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radii.pill, backgroundColor: 'rgba(0,0,0,0.6)' },
  coverText:   { ...type.meta, fontSize: 10, fontFamily: 'Inter_700Bold', color: '#fff' },
  addPhoto:    { width: 96, height: 72, borderRadius: radius.sm, backgroundColor: colors.cardBg, borderWidth: 1.5,
                 borderColor: colors.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 2 },
  addPhotoText:{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: colors.primary, textAlign: 'center' },
  help:        { ...type.small, color: colors.textSecondaryOnPage, marginTop: 8 },
  error:       { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: colors.dangerInkOnPage, marginTop: 20, textAlign: 'center' },
})
