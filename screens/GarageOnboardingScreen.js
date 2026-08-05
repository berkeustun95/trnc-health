import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import KeyboardAwareForm from '../components/KeyboardAwareForm'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { colors, radius } from '../constants/theme'
import { t } from '../constants/i18n'
import { moderationErrorKey } from '../utils/profanity'
import { GARAGE_CATEGORIES } from './GaragesScreen'
import GarageBookingsScreen from './GarageBookingsScreen'
import GroomingAvailabilityEditor from './GroomingAvailabilityEditor'
import FacilityPhotoManager from '../components/FacilityPhotoManager'
import MapPinPicker from '../components/MapPinPicker'
import Dropdown from '../components/Dropdown'
import ListingHiddenBanner from '../components/ListingHiddenBanner'
import FeaturedRequestCard from '../components/FeaturedRequestCard'
import { REGIONS, REGION_LABEL_KEY } from '../constants/regions'
import { areaOptions } from '../constants/areas'

// ─── State screens ────────────────────────────────────────────────────────────

function PendingState({ lang, onClose }) {
  return (
    <View style={s.stateWrap}>
      <Text style={s.stateEmoji}>⏳</Text>
      <Text style={s.stateTitle}>{t('garageRegisterPending', lang)}</Text>
      <Text style={s.stateSub}>{t('garageRegisterPendingSub', lang)}</Text>
      <TouchableOpacity style={s.ghostBtn} onPress={onClose}>
        <Text style={s.ghostBtnText}>{t('back', lang)}</Text>
      </TouchableOpacity>
    </View>
  )
}

function DeclinedState({ lang, onClose }) {
  return (
    <View style={s.stateWrap}>
      <Text style={s.stateEmoji}>❌</Text>
      <Text style={s.stateTitle}>{t('garageRegisterDeclined', lang)}</Text>
      <Text style={s.stateSub}>{t('garageRegisterDeclinedSub', lang)}</Text>
      <TouchableOpacity style={s.ghostBtn} onPress={onClose}>
        <Text style={s.ghostBtnText}>{t('back', lang)}</Text>
      </TouchableOpacity>
    </View>
  )
}

function ActiveState({ lang, facility, hiddenAt, hiddenReason, onClose, onManageBookings, onManageAvailability, onManagePhotos, onEdit, onFeaturedChanged }) {
  return (
    <View style={s.stateWrap}>
      <ListingHiddenBanner hiddenAt={hiddenAt} hiddenReason={hiddenReason} lang={lang} style={{ marginBottom: 20, alignSelf: 'stretch' }} />
      <FeaturedRequestCard facility={facility} lang={lang} onChanged={onFeaturedChanged} style={{ marginBottom: 20 }} />
      <Text style={s.stateEmoji}>✅</Text>
      <Text style={s.stateTitle}>{t('garageRegisterActive', lang)}</Text>
      <Text style={s.stateSub}>{t('garageRegisterActiveSub', lang)}</Text>
      <TouchableOpacity style={s.primaryBtn} onPress={onManageBookings} activeOpacity={0.85}>
        <Ionicons name="list-outline" size={18} color="#fff" />
        <Text style={s.primaryBtnText}>{t('garageManageBookings', lang)}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.secondaryBtn} onPress={onManageAvailability} activeOpacity={0.85}>
        <Ionicons name="calendar-outline" size={18} color={colors.primary} />
        <Text style={s.secondaryBtnText}>{t('garageManageAvail', lang)}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.secondaryBtn} onPress={onManagePhotos} activeOpacity={0.85}>
        <Ionicons name="image-outline" size={18} color={colors.primary} />
        <Text style={s.secondaryBtnText}>{t('garageManagePhotos', lang)}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.secondaryBtn} onPress={onEdit} activeOpacity={0.85}>
        <Ionicons name="create-outline" size={18} color={colors.primary} />
        <Text style={s.secondaryBtnText}>{t('garageEditListing', lang)}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.ghostBtn} onPress={onClose}>
        <Text style={s.ghostBtnText}>{t('back', lang)}</Text>
      </TouchableOpacity>
    </View>
  )
}

// ─── Field wrapper ────────────────────────────────────────────────────────────

function Field({ label, children }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      {children}
    </View>
  )
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function GarageOnboardingScreen({ session, lang, onClose, onSubmitted }) {
  const [existing, setExisting] = useState(undefined)
  const [checking, setChecking] = useState(true)
  const [managingBookings, setManagingBookings] = useState(false)
  const [editingAvail, setEditingAvail] = useState(false)
  const [managingPhotos, setManagingPhotos] = useState(false)
  const [editing, setEditing] = useState(false)

  const [name,        setName]        = useState('')
  const [services,    setServices]    = useState([]) // multi-select category keys
  const [address,     setAddress]     = useState('') // free-text street/building → facilities.address
  const [city,        setCity]        = useState(null) // region slug (REGIONS)
  const [area,        setArea]        = useState(null) // area slug (AREAS_BY_REGION[city])
  const [phone,       setPhone]       = useState('')
  const [hours,       setHours]       = useState('')
  const [description, setDescription] = useState('')
  const [lat,         setLat]         = useState(null)
  const [lng,         setLng]         = useState(null)
  const [showMapPicker, setShowMapPicker] = useState(false)

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState(null)

  const loadExisting = useCallback(async () => {
    const { data } = await supabase
      .from('facilities')
      .select('id, name, status, hidden_at, hidden_reason, provider_id, address, phone, opening_hours, description, service_types, availability, cover_image_url, logo_url, photos, latitude, longitude, city, area, featured_until, featured_requested_at')
      .eq('provider_id', session.user.id)
      .eq('type', 'garage')
      .maybeSingle()
    setExisting(data)
    setChecking(false)
  }, [session.user.id])

  useEffect(() => { loadExisting() }, [loadExisting])

  function toggleService(key) {
    setServices(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]))
  }

  // Changing region invalidates the dependent area — clear it so no stale mismatch persists.
  function selectCity(region) {
    setCity(region)
    setArea(null)
  }

  async function handleSubmit() {
    setError(null)
    if (!name.trim())       { setError(t('garageErrorName', lang)); return }
    if (services.length === 0) { setError(t('garageErrorServices', lang)); return }

    setSaving(true)
    try {
      const { data: newId, error: err } = await supabase.rpc('create_garage_facility', {
        p_name:          name.trim(),
        p_service_types: services,
        p_address:       address.trim() || null,
        p_phone:         phone.trim() || null,
        p_opening_hours: hours.trim() || null,
        p_description:   description.trim() || null,
      })
      if (err) throw err
      // location + city + area live in non-guard-locked columns the owner may write
      // directly via RLS. Persist whatever was set on the fresh row in one update.
      const patch = {}
      if (lat != null && lng != null) { patch.latitude = lat; patch.longitude = lng }
      if (city) patch.city = city
      if (area) patch.area = area
      if (newId && Object.keys(patch).length) {
        await supabase.from('facilities').update(patch).eq('id', newId)
      }
      onSubmitted?.()
    } catch (err) {
      const key = moderationErrorKey(err)
      setError(key ? t(key, lang) : (err.message || t('garageErrorGeneric', lang)))
    } finally {
      setSaving(false)
    }
  }

  function startEdit() {
    setName(existing.name || '')
    setServices(existing.service_types || [])
    setAddress(existing.address || '')
    setCity(existing.city ?? null)
    setArea(existing.area ?? null)
    setPhone(existing.phone || '')
    setHours(existing.opening_hours || '')
    setDescription(existing.description || '')
    setLat(existing.latitude ?? null)
    setLng(existing.longitude ?? null)
    setError(null)
    setEditing(true)
  }

  // Location is not a guard-locked column, so an owner may write it directly (RLS
  // "Provider can update own facility"). While editing an existing row, persist the
  // pin immediately; during create it's held in state and written after the RPC.
  async function confirmLocation(la, lo) {
    setLat(la); setLng(lo); setShowMapPicker(false)
    if (editing && existing?.id) {
      await supabase.from('facilities').update({ latitude: la, longitude: lo }).eq('id', existing.id)
      setExisting(prev => ({ ...prev, latitude: la, longitude: lo }))
    }
  }

  async function handleEdit() {
    setError(null)
    if (!name.trim())          { setError(t('garageErrorName', lang)); return }
    if (services.length === 0) { setError(t('garageErrorServices', lang)); return }

    setSaving(true)
    try {
      const { data: material, error: err } = await supabase.rpc('update_garage_facility', {
        p_facility_id:   existing.id,
        p_name:          name.trim(),
        p_service_types: services,
        p_address:       address.trim() || null,
        p_phone:         phone.trim() || null,
        p_opening_hours: hours.trim() || null,
        p_description:   description.trim() || null,
      })
      if (err) throw err
      // city + area are non-material (not guard-locked) — persist them directly, outside the RPC.
      await supabase.from('facilities').update({ city, area }).eq('id', existing.id)
      setEditing(false)
      // Material change flipped the row back to pending — refetch so the pending state shows.
      await loadExisting()
      Alert.alert('', t(material ? 'garageEditPendingNote' : 'garageEditSaved', lang))
    } catch (err) {
      const key = moderationErrorKey(err)
      setError(key ? t(key, lang) : (err.message || t('garageErrorGeneric', lang)))
    } finally {
      setSaving(false)
    }
  }

  if (checking) {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <ActivityIndicator size="large" color={colors.primary} style={{ flex: 1 }} />
      </SafeAreaView>
    )
  }

  if (existing?.status === 'pending') {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <PendingState lang={lang} onClose={onClose} />
      </SafeAreaView>
    )
  }

  if (existing?.status === 'active' && !editing) {
    if (managingBookings) {
      return <GarageBookingsScreen facility={existing} lang={lang} onBack={() => setManagingBookings(false)} />
    }
    if (editingAvail) {
      // Reuses the service-neutral availability editor (writes facilities.availability
      // jsonb, the same shape BookingScreen.generateSlots reads for garages).
      return (
        <GroomingAvailabilityEditor
          facility={existing}
          lang={lang}
          onBack={() => setEditingAvail(false)}
          onSaved={a => setExisting(prev => ({ ...prev, availability: a }))}
        />
      )
    }
    if (managingPhotos) {
      return (
        <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
          <View style={s.header}>
            <TouchableOpacity onPress={() => setManagingPhotos(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={s.headerTitle}>{t('garageManagePhotos', lang)}</Text>
            <View style={{ width: 24 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 16 }} showsVerticalScrollIndicator={false}>
            <FacilityPhotoManager
              facilityId={existing.id}
              initialCover={existing.cover_image_url}
              initialLogo={existing.logo_url}
              initialPhotos={existing.photos}
              lang={lang}
              onFacilityUpdated={loadExisting}
            />
          </ScrollView>
        </SafeAreaView>
      )
    }
    return (
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <ActiveState
          lang={lang}
          facility={existing}
          hiddenAt={existing.hidden_at}
          hiddenReason={existing.hidden_reason}
          onClose={onClose}
          onManageBookings={() => setManagingBookings(true)}
          onManageAvailability={() => setEditingAvail(true)}
          onManagePhotos={() => setManagingPhotos(true)}
          onEdit={startEdit}
          onFeaturedChanged={loadExisting}
        />
      </SafeAreaView>
    )
  }

  if (existing?.status === 'suspended') {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <DeclinedState lang={lang} onClose={onClose} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAwareForm>
        <View style={s.header}>
          <TouchableOpacity onPress={editing ? () => setEditing(false) : onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>{editing ? t('garageEditTitle', lang) : t('garageRegisterTitle', lang)}</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={s.intro}>{editing ? t('garageEditMaterialNote', lang) : t('garageRegisterIntro', lang)}</Text>

          {/* Business name */}
          <Field label={t('garageRegisterName', lang)}>
            <TextInput
              style={s.input}
              value={name}
              onChangeText={setName}
              placeholder={t('garageRegisterNamePlaceholder', lang)}
              placeholderTextColor={colors.textSecondary}
            />
          </Field>

          {/* Services (multi-select, required) */}
          <Field label={t('garageRegisterServices', lang)}>
            <View style={s.chipRow}>
              {GARAGE_CATEGORIES.map(c => {
                const selected = services.includes(c.key)
                return (
                  <TouchableOpacity
                    key={c.key}
                    style={[s.selChip, selected && s.selChipActive]}
                    onPress={() => toggleService(c.key)}
                  >
                    <Ionicons
                      name={c.icon}
                      size={14}
                      color={selected ? colors.primary : colors.textSecondary}
                    />
                    <Text style={[s.selChipText, selected && s.selChipTextActive]}>
                      {t(c.labelKey, lang)}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </Field>

          {/* City / region (dropdown) */}
          <Field label={t('garageRegisterCity', lang)}>
            <Dropdown
              value={city}
              options={REGIONS.map(r => ({ value: r, label: t(REGION_LABEL_KEY[r], lang) }))}
              onSelect={selectCity}
              placeholder={t('dropdownSelect', lang)}
            />
          </Field>

          {/* Area / neighbourhood (dependent dropdown) */}
          <Field label={t('garageRegisterArea', lang)}>
            <Dropdown
              value={area}
              options={areaOptions(city)}
              onSelect={setArea}
              placeholder={t('dropdownSelect', lang)}
              disabled={!city}
              disabledText={t('dropdownPickCityFirst', lang)}
            />
          </Field>

          {/* Street address (free-text building/street detail) */}
          <Field label={t('garageRegisterStreet', lang)}>
            <TextInput
              style={s.input}
              value={address}
              onChangeText={setAddress}
              placeholder={t('garageRegisterStreetPlaceholder', lang)}
              placeholderTextColor={colors.textSecondary}
            />
          </Field>

          {/* Business location (map pin + GPS) */}
          <Field label={t('garageRegisterLocation', lang)}>
            {lat != null && lng != null && (
              <View style={s.locRow}>
                <Ionicons name="location" size={14} color={colors.primary} />
                <Text style={s.locText}>{lat.toFixed(5)}, {lng.toFixed(5)}</Text>
              </View>
            )}
            <TouchableOpacity style={s.locBtn} onPress={() => setShowMapPicker(true)} activeOpacity={0.85}>
              <Ionicons name="map-outline" size={16} color={colors.primary} />
              <Text style={s.locBtnText}>{lat != null ? t('garageLocationUpdate', lang) : t('garageLocationSet', lang)}</Text>
            </TouchableOpacity>
          </Field>

          {/* Phone */}
          <Field label={t('garageRegisterPhone', lang)}>
            <TextInput
              style={s.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="+90 548 000 0000"
              placeholderTextColor={colors.textSecondary}
              keyboardType="phone-pad"
            />
          </Field>

          {/* Opening hours (display text) */}
          <Field label={t('garageRegisterHours', lang)}>
            <TextInput
              style={s.input}
              value={hours}
              onChangeText={setHours}
              placeholder={t('garageRegisterHoursPlaceholder', lang)}
              placeholderTextColor={colors.textSecondary}
            />
          </Field>

          {/* Description */}
          <Field label={t('garageRegisterDesc', lang)}>
            <TextInput
              style={[s.input, s.inputMulti]}
              value={description}
              onChangeText={setDescription}
              placeholder={t('garageRegisterDescPlaceholder', lang)}
              placeholderTextColor={colors.textSecondary}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          </Field>

          {!!error && <Text style={s.errorText}>{error}</Text>}

          <TouchableOpacity
            style={[s.submitBtn, saving && s.submitBtnDisabled]}
            onPress={editing ? handleEdit : handleSubmit}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.submitBtnText}>{editing ? t('garageEditSubmit', lang) : t('garageRegisterSubmit', lang)}</Text>
            }
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAwareForm>

      <MapPinPicker
        visible={showMapPicker}
        initialLat={lat}
        initialLng={lng}
        onConfirm={confirmLocation}
        onCancel={() => setShowMapPicker(false)}
      />
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: colors.bg },

  header:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                      paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.cardBg,
                      borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle:      { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary },

  scrollContent:    { padding: 20, paddingBottom: 48 },
  intro:            { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                      lineHeight: 21, marginBottom: 20 },

  field:            { marginBottom: 20 },
  fieldLabel:       { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textSecondary,
                      marginBottom: 8 },
  input:            { backgroundColor: colors.cardBg, borderWidth: 1.5, borderColor: colors.border,
                      borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12,
                      fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  inputMulti:       { minHeight: 100, paddingTop: 12 },
  locRow:           { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  locText:          { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.primary },
  locBtn:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
                      borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.md,
                      paddingVertical: 12, backgroundColor: colors.cardBg },
  locBtnText:       { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.primary },

  chipRow:          { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  selChip:          { flexDirection: 'row', alignItems: 'center', gap: 5,
                      paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
                      borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.cardBg },
  selChipActive:    { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  selChipText:      { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  selChipTextActive:{ fontFamily: 'Inter_700Bold', color: colors.primary },

  errorText:        { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.danger,
                      marginBottom: 16, textAlign: 'center' },
  submitBtn:        { backgroundColor: colors.primary, borderRadius: radius.md,
                      paddingVertical: 15, alignItems: 'center', marginTop: 4 },
  submitBtnDisabled:{ opacity: 0.6 },
  submitBtnText:    { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },

  // State screens
  stateWrap:        { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  stateEmoji:       { fontSize: 52, marginBottom: 4 },
  stateTitle:       { fontSize: 20, fontFamily: 'Inter_700Bold', color: colors.textPrimary,
                      textAlign: 'center' },
  stateSub:         { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                      textAlign: 'center', lineHeight: 21 },
  primaryBtn:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                      backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 14,
                      paddingHorizontal: 28, marginTop: 8 },
  primaryBtnText:   { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
  secondaryBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                      backgroundColor: colors.primaryLight, borderRadius: radius.md, paddingVertical: 14,
                      paddingHorizontal: 28, marginTop: 10 },
  secondaryBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.primary },
  ghostBtn:         { paddingVertical: 12, paddingHorizontal: 24 },
  ghostBtnText:     { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
})
