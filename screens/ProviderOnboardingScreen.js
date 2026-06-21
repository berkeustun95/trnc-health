import { useState, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, FlatList, KeyboardAvoidingView, Platform, ActivityIndicator, Image
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons, Feather } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { supabase } from '../lib/supabase'
import { colors, shadow } from '../constants/theme'
import HoursPicker from '../components/HoursPicker'
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
    const a = lookup[base64.charCodeAt(i)], b = lookup[base64.charCodeAt(i + 1)]
    const c = lookup[base64.charCodeAt(i + 2)], d = lookup[base64.charCodeAt(i + 3)]
    out[p++] = (a << 2) | (b >> 4)
    if (p < bufLen) out[p++] = ((b & 15) << 4) | (c >> 2)
    if (p < bufLen) out[p++] = ((c & 3) << 6) | d
  }
  return buf
}

async function sendPushNotification(token, title, body) {
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ to: token, title, body, sound: 'default' }),
    })
  } catch {}
}

const TYPES = ['pharmacy', 'clinic', 'hospital', 'dentist']
const TYPE_ICONS  = { pharmacy: '💊', clinic: '🩺', hospital: '🏥', dentist: '🦷' }
const TYPE_LABELS = { pharmacy: 'Pharmacy', clinic: 'Clinic', hospital: 'Hospital', dentist: 'Dentist' }

export default function ProviderOnboardingScreen({ session, onDone }) {
  const [step, setStep]   = useState(1) // 1 | 2 | '2b' | 3
  const [mode, setMode]   = useState(null) // 'claim' | 'new'
  const [unclaimedFacilities, setUnclaimedFacilities] = useState([])
  const [loadingFacilities, setLoadingFacilities]     = useState(false)
  const [searchText, setSearchText]       = useState('')
  const [selectedFacility, setSelectedFacility] = useState(null)
  const [form, setForm] = useState({
    name: '', type: 'clinic', address: '', phone: '', opening_hours: '', membership_tier: 'basic', registration_number: '',
    latitude: null, longitude: null,
  })
  const [saving, setSaving]               = useState(false)
  const [error, setError]                 = useState(null)
  const [showMapPicker, setShowMapPicker] = useState(false)
  const [documents, setDocuments]         = useState([]) // [{ doc_type, uri, base64 }]
  const [uploadingDocs, setUploadingDocs] = useState(false)

  useEffect(() => {
    if (step !== 2) return
    setLoadingFacilities(true)
    supabase.from('facilities').select('id, name, type, address').is('provider_id', null).order('name')
      .then(({ data }) => { setUnclaimedFacilities(data ?? []); setLoadingFacilities(false) })
  }, [step])

  const set = key => val => setForm(f => ({ ...f, [key]: val }))

  const filtered = unclaimedFacilities.filter(f => {
    if (!searchText.trim()) return true
    const q = searchText.trim().toLowerCase()
    return f.name.toLowerCase().includes(q) || (f.address && f.address.toLowerCase().includes(q))
  })

  async function pickDocument(docType) {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) return
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.8,
      base64: true,
    })
    if (result.canceled) return
    setDocuments(prev => {
      const filtered = prev.filter(d => d.doc_type !== docType)
      return [...filtered, { doc_type: docType, uri: result.assets[0].uri, base64: result.assets[0].base64 }]
    })
  }

  async function uploadDocuments(facilityId) {
    if (documents.length === 0) return
    setUploadingDocs(true)
    for (const doc of documents) {
      try {
        const ext = (doc.uri.split('.').pop() || 'jpg').toLowerCase()
        const path = `${session.user.id}/${facilityId}/${doc.doc_type}.${ext}`
        const contentType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
        const { error: upErr } = await supabase.storage
          .from('provider-documents')
          .upload(path, decode(doc.base64), { contentType, upsert: true })
        if (!upErr) {
          const { data: { publicUrl } } = supabase.storage.from('provider-documents').getPublicUrl(path)
          await supabase.from('provider_documents').insert({
            facility_id:  facilityId,
            provider_id:  session.user.id,
            doc_type:     doc.doc_type,
            document_url: publicUrl,
          })
        }
      } catch {}
    }
    setUploadingDocs(false)
  }

  async function submit() {
    setSaving(true)
    setError(null)
    const facilityName = mode === 'claim' ? selectedFacility?.name : form.name.trim()
    if (mode === 'claim') {
      const { error: err } = await supabase.from('claim_requests').insert({
        facility_id:         selectedFacility.id,
        requester_id:        session.user.id,
        requested_tier:      form.membership_tier,
        registration_number: form.registration_number.trim() || null,
      })
      if (err) { setError(err.message); setSaving(false); return }
      if (form.latitude != null && form.longitude != null) {
        await supabase.from('facilities')
          .update({ latitude: form.latitude, longitude: form.longitude })
          .eq('id', selectedFacility.id)
      }
      await uploadDocuments(selectedFacility.id)
    } else {
      if (!form.name.trim()) { setError('Facility name is required.'); setSaving(false); return }
      const { data: newFacility, error: err } = await supabase.from('facilities').insert({
        name:                form.name.trim(),
        type:                form.type,
        address:             form.address.trim() || null,
        phone:               form.phone.trim() || null,
        opening_hours:       form.opening_hours.trim() || null,
        membership_tier:     form.membership_tier,
        status:              'pending',
        provider_id:         session.user.id,
        is_public:           false,
        verified:            false,
        registration_number: form.registration_number.trim() || null,
        latitude:            form.latitude,
        longitude:           form.longitude,
      }).select('id').single()
      if (err) { setError(err.message); setSaving(false); return }
      if (newFacility?.id) await uploadDocuments(newFacility.id)
    }
    setSaving(false)
    try {
      const { data: admins } = await supabase.from('profiles').select('id, push_token').eq('role', 'admin')
      const title = mode === 'claim' ? 'New facility claim' : 'New provider application'
      const body = `${facilityName || 'A facility'} submitted for review.`
      for (const admin of admins ?? []) {
        if (admin.push_token) await sendPushNotification(admin.push_token, title, body)
        await supabase.from('notifications').insert({ user_id: admin.id, title, body })
      }
    } catch {}
    onDone()
  }

  // ── Step 1: Welcome ────────────────────────────────────────────────────────
  if (step === 1) {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <View style={s.welcomeWrap}>
          <Text style={s.welcomeEmoji}>🏥</Text>
          <Text style={s.welcomeTitle}>Join ADA</Text>
          <Text style={s.welcomeSub}>List your facility and connect with patients across Northern Cyprus. Setup takes 2 minutes.</Text>

          <View style={s.featureList}>
            {[
              { icon: '📅', text: 'Manage appointment requests' },
              { icon: '💬', text: 'Answer patient questions' },
              { icon: '⭐', text: 'Build trust with verified reviews' },
            ].map(f => (
              <View key={f.icon} style={s.featureRow}>
                <Text style={s.featureIcon}>{f.icon}</Text>
                <Text style={s.featureText}>{f.text}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity style={s.primaryBtn} onPress={() => setStep(2)}>
            <Text style={s.primaryBtnText}>Get started</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => supabase.auth.signOut()}>
            <Text style={s.signOutText}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  // ── Step 2: Find existing facility ────────────────────────────────────────
  if (step === 2) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.stepHeader}>
          <TouchableOpacity onPress={() => setStep(1)}>
            <Text style={s.backBtnText}>← Back</Text>
          </TouchableOpacity>
          <Text style={s.stepLabelRight}>Step 1 of 2</Text>
        </View>

        <View style={s.searchHeaderWrap}>
          <Text style={s.formTitle}>Is your facility listed?</Text>
          <Text style={s.formSub}>Search to see if it's already in our directory.</Text>
          <View style={s.searchBar}>
            <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
            <TextInput
              style={s.searchInput}
              value={searchText}
              onChangeText={setSearchText}
              placeholder="Search by name or address…"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
            />
            {searchText.length > 0 && (
              <TouchableOpacity onPress={() => setSearchText('')}>
                <Ionicons name="close" size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {loadingFacilities ? (
          <View style={s.loadingWrap}><ActivityIndicator color={colors.primary} /></View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={f => f.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={s.facilityList}
            ListEmptyComponent={
              <Text style={s.emptyText}>
                {searchText.trim() ? 'No facilities match your search.' : 'No unclaimed facilities yet.'}
              </Text>
            }
            renderItem={({ item }) => (
              <View style={s.facilityRow}>
                <View style={s.facilityRowLeft}>
                  <Text style={s.facilityRowIcon}>{TYPE_ICONS[item.type] ?? '🏥'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.facilityRowName} numberOfLines={1}>{item.name}</Text>
                    {item.address ? <Text style={s.facilityRowAddr} numberOfLines={1}>{item.address}</Text> : null}
                  </View>
                </View>
                <TouchableOpacity
                  style={s.claimBtn}
                  onPress={() => { setSelectedFacility(item); setMode('claim'); setStep(3) }}
                >
                  <Text style={s.claimBtnText}>This is mine</Text>
                </TouchableOpacity>
              </View>
            )}
            ListFooterComponent={
              <TouchableOpacity
                style={s.notListedBtn}
                onPress={() => { setMode('new'); setStep('2b') }}
              >
                <Text style={s.notListedText}>My facility isn't listed yet →</Text>
              </TouchableOpacity>
            }
          />
        )}
      </SafeAreaView>
    )
  }

  // ── Step 2b: New facility form ─────────────────────────────────────────────
  if (step === '2b') {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={s.formWrap} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <TouchableOpacity style={s.backBtn} onPress={() => setStep(2)}>
              <Text style={s.backBtnText}>← Back</Text>
            </TouchableOpacity>
            <Text style={s.stepLabel}>Step 1 of 2</Text>
            <Text style={s.formTitle}>Your facility</Text>
            <Text style={s.formSub}>Tell patients about your practice.</Text>

            <Text style={s.fieldLabel}>FACILITY NAME *</Text>
            <TextInput
              style={s.input}
              value={form.name}
              onChangeText={set('name')}
              placeholder="e.g. Lefkoşa Central Clinic"
              placeholderTextColor={colors.border}
            />

            <Text style={s.fieldLabel}>TYPE</Text>
            <View style={s.typeGrid}>
              {TYPES.map(type => (
                <TouchableOpacity
                  key={type}
                  style={[s.typeCard, form.type === type && s.typeCardActive]}
                  onPress={() => set('type')(type)}
                  activeOpacity={0.7}
                >
                  <Text style={s.typeCardIcon}>{TYPE_ICONS[type]}</Text>
                  <Text style={[s.typeCardLabel, form.type === type && s.typeCardLabelActive]}>{TYPE_LABELS[type]}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.fieldLabel}>ADDRESS</Text>
            <TextInput
              style={s.input}
              value={form.address}
              onChangeText={set('address')}
              placeholder="Street, City"
              placeholderTextColor={colors.border}
            />

            <Text style={s.fieldLabel}>MAP LOCATION</Text>
            {form.latitude != null
              ? <Text style={s.locationSet}>📍 {form.latitude.toFixed(5)}, {form.longitude.toFixed(5)}</Text>
              : <Text style={s.locationMissing}>Not set — your facility won't appear on the map.</Text>
            }
            <TouchableOpacity
              style={s.locationBtn}
              onPress={() => setShowMapPicker(true)}
              activeOpacity={0.8}
            >
              <Text style={s.locationBtnText}>
                {form.latitude != null ? '📍 Update pin' : '📍 Pin on map'}
              </Text>
            </TouchableOpacity>
            <MapPinPicker
              visible={showMapPicker}
              initialLat={form.latitude}
              initialLng={form.longitude}
              onConfirm={(lat, lng) => { setForm(f => ({ ...f, latitude: lat, longitude: lng })); setShowMapPicker(false) }}
              onCancel={() => setShowMapPicker(false)}
            />

            <Text style={s.fieldLabel}>PHONE</Text>
            <TextInput
              style={s.input}
              value={form.phone}
              onChangeText={set('phone')}
              placeholder="+90 392 000 0000"
              placeholderTextColor={colors.border}
              keyboardType="phone-pad"
            />

            <Text style={s.fieldLabel}>OPENING HOURS</Text>
            <HoursPicker value={form.opening_hours} onChange={set('opening_hours')} />

            <Text style={s.fieldLabel}>BUSINESS REGISTRATION / LICENSE NO.</Text>
            <TextInput
              style={s.input}
              value={form.registration_number}
              onChangeText={set('registration_number')}
              placeholder="e.g. Ministry reg. no."
              placeholderTextColor={colors.border}
              autoCapitalize="none"
            />

            <TouchableOpacity
              style={[s.primaryBtn, !form.name.trim() && s.primaryBtnDisabled]}
              onPress={() => { if (form.name.trim()) { setError(null); setStep(3) } }}
              disabled={!form.name.trim()}
            >
              <Text style={s.primaryBtnText}>Next →</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    )
  }

  // ── Step 3: Tier selection ─────────────────────────────────────────────────
  const facilityType = selectedFacility?.type ?? form.type
  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={s.formWrap} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={s.backBtn} onPress={() => setStep(mode === 'claim' ? 2 : '2b')}>
          <Text style={s.backBtnText}>← Back</Text>
        </TouchableOpacity>

        <Text style={s.stepLabel}>Step 2 of 2</Text>
        <Text style={s.formTitle}>Choose your plan</Text>

        {selectedFacility && (
          <View style={s.claimingBadge}>
            <Text style={s.claimingIcon}>{TYPE_ICONS[selectedFacility.type] ?? '🏥'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.claimingLabel}>CLAIMING</Text>
              <Text style={s.claimingName} numberOfLines={1}>{selectedFacility.name}</Text>
            </View>
          </View>
        )}

        <Text style={s.formSub}>
          {mode === 'claim'
            ? 'Your claim will be verified within 24 hours before going live.'
            : 'Both plans include a 5-day free trial. No payment until you\'re verified and live.'}
        </Text>

        {mode === 'claim' && (
          <>
            <Text style={s.fieldLabel}>BUSINESS REGISTRATION / LICENSE NO.</Text>
            <TextInput
              style={s.input}
              value={form.registration_number}
              onChangeText={set('registration_number')}
              placeholder="e.g. Ministry reg. no."
              placeholderTextColor={colors.border}
              autoCapitalize="none"
            />
            <Text style={[s.fieldLabel, { marginTop: 18 }]}>MAP LOCATION</Text>
            {form.latitude != null
              ? <Text style={s.locationSet}>📍 {form.latitude.toFixed(5)}, {form.longitude.toFixed(5)}</Text>
              : <Text style={s.locationMissing}>Not set — your facility won't appear on the map.</Text>
            }
            <TouchableOpacity
              style={s.locationBtn}
              onPress={() => setShowMapPicker(true)}
              activeOpacity={0.8}
            >
              <Text style={s.locationBtnText}>
                {form.latitude != null ? '📍 Update pin' : '📍 Pin on map'}
              </Text>
            </TouchableOpacity>
            <MapPinPicker
              visible={showMapPicker}
              initialLat={form.latitude}
              initialLng={form.longitude}
              onConfirm={(lat, lng) => { setForm(f => ({ ...f, latitude: lat, longitude: lng })); setShowMapPicker(false) }}
              onCancel={() => setShowMapPicker(false)}
            />
          </>
        )}

        {/* ── Verification documents ──────────────────────── */}
        <Text style={[s.fieldLabel, { marginTop: 24 }]}>VERIFICATION DOCUMENTS</Text>
        <Text style={s.docsNote}>Upload at least one document to help us verify your identity faster. All files are reviewed privately by our team.</Text>
        {[
          { key: 'medical_license',   label: 'Medical License / Practice Certificate' },
          { key: 'registration_cert', label: 'Chamber / Ministry Registration' },
          { key: 'business_license',  label: 'Business License' },
          { key: 'national_id',       label: 'National ID / Passport' },
        ].map(({ key, label }) => {
          const attached = documents.find(d => d.doc_type === key)
          return (
            <TouchableOpacity key={key} style={[s.docUploadRow, attached && s.docUploadRowDone]} onPress={() => pickDocument(key)} activeOpacity={0.8}>
              {attached
                ? <Image source={{ uri: attached.uri }} style={s.docThumb} />
                : <View style={s.docThumbPlaceholder}><Feather name="upload" size={14} color={colors.primary} /></View>
              }
              <Text style={[s.docUploadLabel, attached && { color: colors.success }]} numberOfLines={1}>{label}</Text>
              {attached && <Feather name="check-circle" size={16} color={colors.success} />}
            </TouchableOpacity>
          )
        })}

        <TouchableOpacity
          style={[s.tierCard, form.membership_tier === 'basic' && s.tierCardSelected]}
          onPress={() => set('membership_tier')('basic')}
          activeOpacity={0.8}
        >
          <View style={s.tierCardHeader}>
            <Text style={s.tierName}>Basic</Text>
            {form.membership_tier === 'basic' && <Text style={s.tierCheck}>✓ Selected</Text>}
          </View>
          <Text style={s.tierDesc}>Listing, appointment management, Q&A</Text>
          {['Listed in directory', 'Appointment requests', 'Q&A with patients', 'Basic stats'].map(f => (
            <View key={f} style={s.tierFeatureRow}>
              <Text style={s.tierTick}>✓</Text>
              <Text style={s.tierFeatureText}>{f}</Text>
            </View>
          ))}
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.tierCard, form.membership_tier === 'pro' && s.tierCardSelected, form.membership_tier === 'pro' && s.tierCardPro]}
          onPress={() => set('membership_tier')('pro')}
          activeOpacity={0.8}
        >
          <View style={s.tierCardHeader}>
            <View style={s.tierNameRow}>
              <Text style={s.tierName}>Pro</Text>
              <View style={s.proBadge}><Text style={s.proBadgeText}>RECOMMENDED</Text></View>
            </View>
            {form.membership_tier === 'pro' && <Text style={[s.tierCheck, { color: colors.primary }]}>✓ Selected</Text>}
          </View>
          <Text style={s.tierDesc}>Everything in Basic, plus premium features</Text>
          {[
            'Everything in Basic',
            'Featured in search results',
            facilityType === 'pharmacy' ? 'Supplement quiz reviews 💊' : 'Priority listing',
            'Advanced analytics',
          ].map(f => (
            <View key={f} style={s.tierFeatureRow}>
              <Text style={[s.tierTick, { color: colors.primary }]}>✓</Text>
              <Text style={s.tierFeatureText}>{f}</Text>
            </View>
          ))}
        </TouchableOpacity>

        {error ? <Text style={s.errorText}>{error}</Text> : null}

        <TouchableOpacity style={[s.primaryBtn, (saving || uploadingDocs) && s.primaryBtnDisabled]} onPress={submit} disabled={saving || uploadingDocs}>
          {(saving || uploadingDocs)
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.primaryBtnText}>
                {mode === 'claim' ? 'Submit claim' : 'Submit for review'}
              </Text>
          }
        </TouchableOpacity>

        <Text style={s.disclaimer}>
          {mode === 'claim'
            ? 'We\'ll verify your ownership and activate your account within 24 hours.'
            : 'Your listing will be reviewed within 24 hours. You\'ll get full dashboard access once approved.'}
        </Text>
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:               { flex: 1, backgroundColor: colors.bg },

  // Welcome
  welcomeWrap:        { flex: 1, paddingHorizontal: 28, justifyContent: 'center', alignItems: 'center' },
  welcomeEmoji:       { fontSize: 56, marginBottom: 20 },
  welcomeTitle:       { fontSize: 28, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textAlign: 'center', marginBottom: 12 },
  welcomeSub:         { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: 32 },
  featureList:        { width: '100%', gap: 14, marginBottom: 40 },
  featureRow:         { flexDirection: 'row', alignItems: 'center', gap: 14 },
  featureIcon:        { fontSize: 22, width: 32, textAlign: 'center' },
  featureText:        { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textPrimary },

  // Step 2 — search
  stepHeader:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  stepLabelRight:     { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary, textTransform: 'uppercase', letterSpacing: 1 },
  searchHeaderWrap:   { paddingHorizontal: 20, paddingBottom: 12 },
  searchBar:          { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cardBg, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, marginTop: 12, gap: 10, borderWidth: 1, borderColor: colors.border },
  searchInput:        { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, padding: 0 },
  loadingWrap:        { flex: 1, justifyContent: 'center', alignItems: 'center' },
  facilityList:       { paddingHorizontal: 16, paddingBottom: 32 },
  facilityRow:        { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cardBg, borderRadius: 14, padding: 14, marginBottom: 8, gap: 10, ...shadow },
  facilityRowLeft:    { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  facilityRowIcon:    { fontSize: 24 },
  facilityRowName:    { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 2 },
  facilityRowAddr:    { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  claimBtn:           { backgroundColor: colors.primaryLight, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  claimBtnText:       { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary },
  notListedBtn:       { marginTop: 20, alignItems: 'center', paddingVertical: 16 },
  notListedText:      { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.primary },
  emptyText:          { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', marginTop: 40 },

  // Form (step 2b)
  formWrap:           { paddingHorizontal: 20, paddingBottom: 48, paddingTop: 16 },
  formHeader:         { marginBottom: 24 },
  stepLabel:          { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  formTitle:          { fontSize: 26, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 8 },
  formSub:            { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 20, marginBottom: 20 },
  fieldLabel:         { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, letterSpacing: 0.5, marginBottom: 8, marginTop: 18 },
  input:              { borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, padding: 13, fontSize: 15, fontFamily: 'Inter_400Regular', backgroundColor: colors.surface, color: colors.textPrimary },
  typeGrid:           { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 4 },
  typeCard:           { flex: 1, minWidth: '45%', borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, padding: 14, alignItems: 'center', backgroundColor: colors.surface },
  typeCardActive:     { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  typeCardIcon:       { fontSize: 26, marginBottom: 6 },
  typeCardLabel:      { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  typeCardLabelActive:{ fontFamily: 'Inter_700Bold', color: colors.primary },
  locationSet:        { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.success, marginBottom: 10, marginTop: 4 },
  locationMissing:    { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginBottom: 10, marginTop: 4 },
  locationBtn:        { backgroundColor: colors.primaryLight, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginBottom: 4 },
  locationBtnText:    { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.primary },

  // Claiming badge (step 3)
  claimingBadge:      { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.primaryLight, borderRadius: 14, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: colors.primary + '30' },
  claimingIcon:       { fontSize: 28 },
  claimingLabel:      { fontSize: 10, fontFamily: 'Inter_700Bold', color: colors.primary, letterSpacing: 0.5, marginBottom: 2 },
  claimingName:       { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary },

  // Tier cards
  tierCard:           { borderWidth: 1.5, borderColor: colors.border, borderRadius: 16, padding: 18, marginBottom: 14, backgroundColor: colors.cardBg, ...shadow },
  tierCardSelected:   { borderColor: colors.border },
  tierCardPro:        { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  tierCardHeader:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  tierNameRow:        { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tierName:           { fontSize: 20, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  tierCheck:          { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
  proBadge:           { backgroundColor: colors.primary, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  proBadgeText:       { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#fff', letterSpacing: 0.5 },
  tierDesc:           { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginBottom: 12, lineHeight: 18 },
  tierFeatureRow:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 },
  tierTick:           { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textSecondary, width: 14 },
  tierFeatureText:    { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textPrimary },

  // Shared
  primaryBtn:         { backgroundColor: colors.primary, borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 28 },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText:     { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },
  backBtn:            { marginBottom: 20 },
  backBtnText:        { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  errorText:          { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.danger, marginTop: 8 },
  signOutText:        { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textSecondary, marginTop: 16, textAlign: 'center' },
  disclaimer:         { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', marginTop: 16, lineHeight: 18 },

  docsNote:           { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 17, marginBottom: 10, marginTop: 4 },
  docUploadRow:       { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, padding: 12, marginBottom: 8 },
  docUploadRowDone:   { borderColor: colors.success, backgroundColor: '#F0FDF4' },
  docThumb:           { width: 36, height: 36, borderRadius: 8 },
  docThumbPlaceholder:{ width: 36, height: 36, borderRadius: 8, backgroundColor: colors.primaryLight, justifyContent: 'center', alignItems: 'center' },
  docUploadLabel:     { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
})
