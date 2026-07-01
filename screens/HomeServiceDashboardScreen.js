import { useState, useEffect, useRef } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Image, AppState, RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { colors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'

const CATEGORIES = [
  { key: 'plumber',     icon: 'water-outline',        labelKey: 'hsCategoryPlumber' },
  { key: 'electrician', icon: 'flash-outline',         labelKey: 'hsCategoryElectrician' },
  { key: 'carpenter',   icon: 'construct-outline',     labelKey: 'hsCategoryCarpenter' },
  { key: 'painter',     icon: 'color-palette-outline', labelKey: 'hsCategoryPainter' },
  { key: 'sewer',       icon: 'funnel-outline',        labelKey: 'hsCategorySewer' },
  { key: 'ac_tech',     icon: 'thermometer-outline',   labelKey: 'hsCategoryAcTech' },
  { key: 'locksmith',   icon: 'key-outline',           labelKey: 'hsCategoryLocksmith' },
  { key: 'tiler',       icon: 'grid-outline',          labelKey: 'hsCategoryTiler' },
  { key: 'handyman',    icon: 'hammer-outline',        labelKey: 'hsCategoryHandyman' },
]

const DISTRICTS     = ['nicosia', 'kyrenia', 'famagusta', 'morphou', 'iskele', 'lefke']
const DISTRICT_KEYS = {
  nicosia: 'hsDistrictNicosia', kyrenia: 'hsDistrictKyrenia',
  famagusta: 'hsDistrictFamagusta', morphou: 'hsDistrictMorphou',
  iskele: 'hsDistrictIskele', lefke: 'hsDistrictLefke',
}
const CONTACT_PREFS = [
  { key: 'whatsapp', labelKey: 'hsContactPrefWA',   icon: 'logo-whatsapp' },
  { key: 'call',     labelKey: 'hsContactPrefCall',  icon: 'call-outline' },
  { key: 'both',     labelKey: 'hsContactPrefBoth',  icon: 'chatbubbles-outline' },
]

function statusColor(status) {
  if (status === 'active')   return colors.success
  if (status === 'pending')  return colors.accent
  if (status === 'rejected') return colors.danger
  return colors.textSecondary
}

export default function HomeServiceDashboardScreen({ session, lang = 'English' }) {
  const [listing,  setListing]  = useState(null)
  const [loading,  setLoading]  = useState(true)

  const [name,         setName]         = useState('')
  const [phone,        setPhone]        = useState('')
  const [whatsapp,     setWhatsapp]     = useState('')
  const [contactPref,  setContactPref]  = useState('whatsapp')
  const [district,     setDistrict]     = useState(null)
  const [serviceTypes, setServiceTypes] = useState([])
  const [description,  setDescription]  = useState('')

  const [saving,    setSaving]    = useState(false)
  const [saved,     setSaved]     = useState(false)
  const [error,     setError]     = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const appState = useRef(AppState.currentState)

  useEffect(() => {
    load()
    const sub = AppState.addEventListener('change', nextState => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        load(true)
      }
      appState.current = nextState
    })
    return () => sub.remove()
  }, [])

  async function refresh() {
    setRefreshing(true)
    await load(true)
    setRefreshing(false)
  }

  async function load(silent = false) {
    if (!silent) setLoading(true)
    const { data } = await supabase
      .from('home_services')
      .select('id, status, rejection_reason, name, phone, whatsapp, contact_pref, district, service_types, description')
      .eq('owner_id', session.user.id)
      .maybeSingle()
    if (data) {
      setListing(data)
      setName(data.name || '')
      setPhone(data.phone || '')
      setWhatsapp(data.whatsapp || '')
      setContactPref(data.contact_pref || 'whatsapp')
      setDistrict(data.district || null)
      setServiceTypes(data.service_types || [])
      setDescription(data.description || '')
    }
    if (!silent) setLoading(false)
  }

  function toggleService(key) {
    setServiceTypes(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

  async function save() {
    setError(null)
    if (!name.trim())             { setError(t('hsErrorName', lang)); return }
    if (!phone.trim())            { setError(t('hsErrorPhone', lang)); return }
    if (!district)                { setError(t('hsErrorDistrict', lang)); return }
    if (serviceTypes.length === 0){ setError(t('hsErrorServices', lang)); return }

    setSaving(true)
    const { error: err } = await supabase
      .from('home_services')
      .update({
        name:             name.trim(),
        phone:            phone.trim(),
        whatsapp:         whatsapp.trim() || null,
        contact_pref:     contactPref,
        district,
        service_types:    serviceTypes,
        description:      description.trim() || null,
        status:           'pending',
        rejection_reason: null,
      })
      .eq('id', listing.id)
    if (err) {
      setError(err.message)
    } else {
      setListing(prev => ({ ...prev, status: 'pending', rejection_reason: null }))
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    }
    setSaving(false)
  }

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
      </SafeAreaView>
    )
  }

  const statusC = statusColor(listing?.status)

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      {/* ── Header ─────────────────────────────────────────────── */}
      <View style={s.header}>
        <Image source={require('../assets/adalogo.png')} style={s.headerLogo} resizeMode="contain" />
        <TouchableOpacity style={s.signOutBtn} onPress={() => supabase.auth.signOut()}>
          <Text style={s.signOutText}>{t('signOut', lang)}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
      >

        {/* ── Status card ─────────────────────────────────────── */}
        <View style={s.card}>
          <View style={s.statusRow}>
            <Text style={s.statusLabel}>Listing Status</Text>
            <View style={[s.statusPill, { backgroundColor: statusC + '22' }]}>
              <Text style={[s.statusPillText, { color: statusC }]}>
                {listing?.status === 'active' ? 'Active' : listing?.status === 'pending' ? 'Pending Review' : 'Rejected'}
              </Text>
            </View>
          </View>
          {listing?.status === 'active' && (
            <Text style={s.statusNote}>Your listing is live and visible to customers.</Text>
          )}
          {listing?.status === 'pending' && (
            <Text style={s.statusNote}>Your listing is under review. We'll notify you once it's approved.</Text>
          )}
          {listing?.status === 'rejected' && (
            <View style={s.rejectionBox}>
              <Text style={s.rejectionLabel}>Rejection reason</Text>
              <Text style={s.rejectionText}>{listing.rejection_reason || 'No reason provided.'}</Text>
              <Text style={s.rejectionHint}>Edit your listing below and save to resubmit.</Text>
            </View>
          )}
        </View>

        {/* ── Edit form ────────────────────────────────────────── */}
        <View style={s.card}>
          <Text style={s.sectionTitle}>YOUR LISTING</Text>

          <Text style={s.fieldLabel}>Business / Name</Text>
          <TextInput
            style={s.input}
            value={name}
            onChangeText={setName}
            placeholder="Your name or business name"
            placeholderTextColor={colors.textSecondary}
          />

          <Text style={[s.fieldLabel, { marginTop: 14 }]}>Phone</Text>
          <TextInput
            style={s.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="+90 548 000 0000"
            placeholderTextColor={colors.textSecondary}
            keyboardType="phone-pad"
          />

          <Text style={[s.fieldLabel, { marginTop: 14 }]}>WhatsApp (optional)</Text>
          <TextInput
            style={s.input}
            value={whatsapp}
            onChangeText={setWhatsapp}
            placeholder="+90 548 000 0000"
            placeholderTextColor={colors.textSecondary}
            keyboardType="phone-pad"
          />

          <Text style={[s.fieldLabel, { marginTop: 14 }]}>Contact preference</Text>
          <View style={s.chipRow}>
            {CONTACT_PREFS.map(cp => (
              <TouchableOpacity
                key={cp.key}
                style={[s.chip, contactPref === cp.key && s.chipActive]}
                onPress={() => setContactPref(cp.key)}
              >
                <Ionicons name={cp.icon} size={14} color={contactPref === cp.key ? '#fff' : colors.textSecondary} style={{ marginRight: 5 }} />
                <Text style={[s.chipText, contactPref === cp.key && s.chipTextActive]}>{t(cp.labelKey, lang)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[s.fieldLabel, { marginTop: 14 }]}>District</Text>
          <View style={s.chipRow}>
            {DISTRICTS.map(d => (
              <TouchableOpacity
                key={d}
                style={[s.chip, district === d && s.chipActive]}
                onPress={() => setDistrict(d)}
              >
                <Text style={[s.chipText, district === d && s.chipTextActive]}>{t(DISTRICT_KEYS[d], lang)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[s.fieldLabel, { marginTop: 14 }]}>Services offered</Text>
          <View style={s.chipRow}>
            {CATEGORIES.map(cat => (
              <TouchableOpacity
                key={cat.key}
                style={[s.chip, serviceTypes.includes(cat.key) && s.chipActive]}
                onPress={() => toggleService(cat.key)}
              >
                <Ionicons name={cat.icon} size={13} color={serviceTypes.includes(cat.key) ? '#fff' : colors.textSecondary} style={{ marginRight: 4 }} />
                <Text style={[s.chipText, serviceTypes.includes(cat.key) && s.chipTextActive]}>{t(cat.labelKey, lang)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[s.fieldLabel, { marginTop: 14 }]}>Description (optional)</Text>
          <TextInput
            style={[s.input, { minHeight: 80, textAlignVertical: 'top' }]}
            value={description}
            onChangeText={v => setDescription(v.slice(0, 300))}
            placeholder="Brief description of your services…"
            placeholderTextColor={colors.textSecondary}
            multiline
            maxLength={300}
          />

          {error && <Text style={s.errorText}>{error}</Text>}

          <TouchableOpacity
            style={[s.saveBtn, (saving || saved) && { opacity: 0.7 }]}
            onPress={save}
            disabled={saving || saved}
          >
            {saving
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={s.saveBtnText}>{saved ? 'Submitted for review' : 'Save & Resubmit'}</Text>
            }
          </TouchableOpacity>
        </View>

        {/* ── Delete account ───────────────────────────────────── */}
        <View style={[s.card, { marginBottom: 32 }]}>
          <Text style={s.sectionTitle}>ACCOUNT</Text>
          <TouchableOpacity
            style={[s.saveBtn, { backgroundColor: colors.dangerLight, marginTop: 12 }]}
            onPress={async () => {
              const { error: err } = await supabase.rpc('delete_own_account')
              if (!err) await supabase.auth.signOut()
            }}
          >
            <Text style={[s.saveBtnText, { color: colors.danger }]}>Delete Account</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: colors.background },
  center:          { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerLogo:      { width: 72, height: 28 },
  signOutBtn:      { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.dangerLight },
  signOutText:     { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.danger },
  scroll:          { padding: 16, gap: 12 },
  card:            { backgroundColor: colors.surface, borderRadius: 14, padding: 16, ...shadow },
  statusRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  statusLabel:     { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textSecondary, letterSpacing: 0.5 },
  statusPill:      { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusPillText:  { fontSize: 12, fontFamily: 'Inter_700Bold' },
  statusNote:      { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  rejectionBox:    { backgroundColor: colors.dangerLight, borderRadius: 10, padding: 12, marginTop: 4 },
  rejectionLabel:  { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.danger, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  rejectionText:   { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.danger },
  rejectionHint:   { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.danger, marginTop: 6, opacity: 0.75 },
  sectionTitle:    { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, letterSpacing: 1, marginBottom: 14 },
  fieldLabel:      { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  input:           { borderWidth: 1.5, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.text, backgroundColor: colors.background },
  chipRow:         { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:            { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.background },
  chipActive:      { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText:        { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
  chipTextActive:  { color: '#fff' },
  errorText:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.danger, marginTop: 10 },
  saveBtn:         { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  saveBtnText:     { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
})
