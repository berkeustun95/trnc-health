import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, Image, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
  Modal, TextInput, Switch, ScrollView, Alert, KeyboardAvoidingView, Platform
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather, Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { colors, shadow } from '../constants/theme'

const FACILITY_TYPES = ['pharmacy', 'clinic', 'hospital', 'dentist']
const TYPE_ICONS = { pharmacy: '💊', clinic: '🩺', hospital: '🏥', dentist: '🦷' }
const ROLES = ['customer', 'provider', 'admin']
const TABS = ['Dashboard', 'Changes', 'Claims', 'Providers', 'Facilities', 'Duty', 'Users', 'Bookings', 'Broadcast']

async function sendPushNotification(token, title, body, data = {}) {
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ to: token, title, body, sound: 'default', data }),
    })
  } catch {}
}

async function recordNotification(userId, title, body) {
  try { await supabase.from('notifications').insert({ user_id: userId, title, body }) } catch {}
}

// ─── Shared ────────────────────────────────────────────────────────────────

function Field({ label, children }) {
  return (
    <View style={s.fieldGroup}>
      <Text style={s.fieldLabel}>{label}</Text>
      {children}
    </View>
  )
}

function StatCard({ label, value, color }) {
  return (
    <View style={s.statCard}>
      <Text style={[s.statValue, color && { color }]}>{value ?? '—'}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  )
}

function SectionEmpty({ text }) {
  return <Text style={s.empty}>{text}</Text>
}

// ─── Dashboard Tab ──────────────────────────────────────────────────────────

function DashboardTab({ onNavigate }) {
  const [stats, setStats] = useState(null)

  useEffect(() => {
    async function load() {
      const [
        { count: facilities },
        { count: users },
        { count: pendingAppts },
        { count: pendingClaims },
        { count: pendingChanges },
        { count: pendingProviders },
      ] = await Promise.all([
        supabase.from('facilities').select('*', { count: 'exact', head: true }),
        supabase.from('profiles').select('*', { count: 'exact', head: true }),
        supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('claim_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('facility_change_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('facilities').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      ])
      setStats({ facilities, users, pendingAppts, pendingClaims, pendingChanges, pendingProviders })
    }
    load()
  }, [])

  if (!stats) return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>

  const urgencies = [
    stats.pendingChanges  > 0 && { label: 'Profile change requests', count: stats.pendingChanges,  tab: 'Changes',   color: colors.accent },
    stats.pendingClaims   > 0 && { label: 'Pending facility claims',  count: stats.pendingClaims,   tab: 'Claims',    color: colors.danger },
    stats.pendingProviders > 0 && { label: 'Providers awaiting approval', count: stats.pendingProviders, tab: 'Providers', color: colors.danger },
    stats.pendingAppts    > 0 && { label: 'Pending appointments',     count: stats.pendingAppts,    tab: 'Bookings',  color: colors.primary },
  ].filter(Boolean)

  return (
    <ScrollView contentContainerStyle={s.tabContent} showsVerticalScrollIndicator={false}>
      <View style={s.statsGrid}>
        <StatCard label="Facilities" value={stats.facilities} />
        <StatCard label="Users" value={stats.users} />
        <StatCard label="Appt. pending" value={stats.pendingAppts} color={stats.pendingAppts > 0 ? colors.accent : undefined} />
      </View>

      {urgencies.length > 0 && (
        <>
          <Text style={[s.sectionTitle, { marginTop: 24 }]}>Needs attention</Text>
          {urgencies.map(u => (
            <TouchableOpacity key={u.tab} style={s.urgencyCard} onPress={() => onNavigate(u.tab)} activeOpacity={0.75}>
              <View style={[s.urgencyDot, { backgroundColor: u.color }]} />
              <Text style={s.urgencyLabel}>{u.label}</Text>
              <View style={[s.urgencyBadge, { backgroundColor: u.color }]}>
                <Text style={s.urgencyCount}>{u.count}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          ))}
        </>
      )}

      {urgencies.length === 0 && (
        <View style={s.allClearBox}>
          <Ionicons name="checkmark-circle" size={32} color={colors.success} />
          <Text style={s.allClearText}>All clear — nothing needs attention.</Text>
        </View>
      )}
    </ScrollView>
  )
}

// ─── Facilities Tab ─────────────────────────────────────────────────────────

const BLANK = {
  name: '', type: 'pharmacy', address: '',
  latitude: '', longitude: '', opening_hours: '',
  languages: '', is_public: true, verified: false, provider_id: '',
}

function FacilityActivityModal({ facility, visible, onClose }) {
  const [data, setData] = useState(null)
  const [loadingActivity, setLoadingActivity] = useState(false)

  useEffect(() => {
    if (!visible || !facility) return
    let cancelled = false
    setData(null)
    setLoadingActivity(true)
    async function load() {
      const [
        { count: pending },
        { count: total },
        { data: reviewRows },
        { data: recent },
        providerRes,
      ] = await Promise.all([
        supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('facility_id', facility.id).eq('status', 'pending'),
        supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('facility_id', facility.id),
        supabase.from('reviews').select('rating').eq('facility_id', facility.id),
        supabase.from('appointments').select('id, status, requested_time').eq('facility_id', facility.id).order('requested_time', { ascending: false }).limit(4),
        facility.provider_id
          ? supabase.from('profiles').select('full_name').eq('id', facility.provider_id).single()
          : Promise.resolve({ data: null }),
      ])
      if (cancelled) return
      const avgRating = reviewRows?.length
        ? (reviewRows.reduce((sum, r) => sum + r.rating, 0) / reviewRows.length).toFixed(1)
        : null
      setData({ pending: pending ?? 0, total: total ?? 0, avgRating, reviewCount: reviewRows?.length ?? 0, recent: recent ?? [], providerName: providerRes.data?.full_name ?? null })
      setLoadingActivity(false)
    }
    load()
    return () => { cancelled = true }
  }, [visible, facility])

  if (!facility) return null

  function statusColor(status) {
    if (status === 'confirmed') return colors.success
    if (status === 'pending') return colors.accent
    if (status === 'completed') return colors.primary
    return colors.textSecondary
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={s.modalHeader}>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="chevron-down" size={24} color={colors.textSecondary} />
          </TouchableOpacity>
          <Text style={s.modalTitle} numberOfLines={1}>{facility.name}</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={[s.modalBody, { paddingTop: 16 }]} showsVerticalScrollIndicator={false}>
          <View style={[s.cardRow, { gap: 10, marginBottom: 20 }]}>
            <Text style={{ fontSize: 28 }}>{TYPE_ICONS[facility.type] ?? '🏥'}</Text>
            <View>
              <Text style={[s.cardSub, { textTransform: 'capitalize' }]}>{facility.type}</Text>
              <View style={[s.cardRow, { gap: 6, marginTop: 4 }]}>
                {facility.verified
                  ? <View style={s.pillGreen}><Text style={s.pillText}>Verified</Text></View>
                  : <View style={s.pillOrange}><Text style={s.pillText}>Unverified</Text></View>
                }
                {!facility.provider_id && <View style={s.pillGrey}><Text style={s.pillText}>Unclaimed</Text></View>}
              </View>
            </View>
          </View>

          {loadingActivity
            ? <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
            : data && (
              <>
                <Text style={[s.sectionTitle, { marginBottom: 10 }]}>Activity</Text>
                <View style={[s.statsGrid, { marginBottom: 20 }]}>
                  <StatCard label="Pending" value={data.pending} color={data.pending > 0 ? colors.accent : undefined} />
                  <StatCard label="Total bookings" value={data.total} />
                  <StatCard label="Avg rating" value={data.avgRating ? `⭐ ${data.avgRating}` : '—'} />
                  <StatCard label="Reviews" value={data.reviewCount} />
                </View>

                {data.providerName && (
                  <>
                    <Text style={[s.sectionTitle, { marginBottom: 8 }]}>Provider</Text>
                    <View style={[s.card, { marginBottom: 20 }]}>
                      <Text style={s.cardTitle}>{data.providerName}</Text>
                      <Text style={s.cardSub}>{facility.verified ? 'Verified provider' : 'Pending verification'}</Text>
                    </View>
                  </>
                )}

                {data.recent.length > 0 && (
                  <>
                    <Text style={[s.sectionTitle, { marginBottom: 8 }]}>Recent bookings</Text>
                    {data.recent.map(appt => (
                      <View key={appt.id} style={[s.card, { marginBottom: 8 }]}>
                        <View style={[s.cardRow, { justifyContent: 'space-between' }]}>
                          <Text style={s.cardSub}>
                            {new Date(appt.requested_time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </Text>
                          <Text style={{ fontSize: 12, fontFamily: 'Inter_700Bold', color: statusColor(appt.status), textTransform: 'capitalize' }}>
                            {appt.status}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </>
                )}

                {data.total === 0 && <Text style={s.empty}>No bookings yet.</Text>}
              </>
            )
          }
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

function FacilitiesTab() {
  const [facilities, setFacilities] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [activityFacility, setActivityFacility] = useState(null)
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('facilities').select('*').order('name')
    setFacilities(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function openAdd() {
    setEditingId(null)
    setForm(BLANK)
    setError(null)
    setModalVisible(true)
  }

  function openEdit(f) {
    setEditingId(f.id)
    setForm({
      name: f.name ?? '',
      type: f.type ?? 'pharmacy',
      address: f.address ?? '',
      latitude: f.latitude?.toString() ?? '',
      longitude: f.longitude?.toString() ?? '',
      opening_hours: f.opening_hours ?? '',
      languages: f.languages ?? '',
      is_public: f.is_public ?? true,
      verified: f.verified ?? false,
      provider_id: f.provider_id ?? '',
    })
    setError(null)
    setModalVisible(true)
  }

  async function save() {
    if (!form.name.trim()) { setError('Name is required.'); return }
    setSaving(true)
    setError(null)
    const payload = {
      name: form.name.trim(),
      type: form.type,
      address: form.address.trim(),
      latitude: form.latitude ? parseFloat(form.latitude) : null,
      longitude: form.longitude ? parseFloat(form.longitude) : null,
      opening_hours: form.opening_hours.trim() || null,
      languages: form.languages.trim() || null,
      is_public: form.is_public,
      verified: form.verified,
      provider_id: form.provider_id.trim() || null,
    }
    const { error: err } = editingId
      ? await supabase.from('facilities').update(payload).eq('id', editingId)
      : await supabase.from('facilities').insert(payload)
    if (err) { setError(err.message); setSaving(false); return }
    setModalVisible(false)
    load()
    setSaving(false)
  }

  function confirmDelete(id, name) {
    Alert.alert('Delete facility', `Delete "${name}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await supabase.from('facilities').delete().eq('id', id); load() } },
    ])
  }

  const set = key => val => setForm(f => ({ ...f, [key]: val }))

  if (loading) return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>

  return (
    <View style={{ flex: 1 }}>
      <TouchableOpacity style={s.primaryBtn} onPress={openAdd}>
        <Text style={s.primaryBtnText}>+ Add facility</Text>
      </TouchableOpacity>

      <FlatList
        data={facilities}
        keyExtractor={f => f.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.listContent}
        ListEmptyComponent={<SectionEmpty text="No facilities yet." />}
        renderItem={({ item }) => (
          <View style={s.card}>
            <View style={s.cardRow}>
              <TouchableOpacity style={{ flex: 1 }} onPress={() => setActivityFacility(item)} activeOpacity={0.7}>
                <Text style={s.cardTitle} numberOfLines={1}>{item.name}</Text>
                <Text style={s.cardSub}>{item.type} · {item.address}</Text>
                <View style={[s.cardRow, { marginTop: 6, gap: 6 }]}>
                  {item.verified && <View style={s.pillGreen}><Text style={s.pillText}>Verified</Text></View>}
                  {item.is_public && <View style={s.pillBlue}><Text style={s.pillText}>Public</Text></View>}
                  {!item.verified && <View style={s.pillOrange}><Text style={s.pillText}>Unverified</Text></View>}
                </View>
              </TouchableOpacity>
              <View style={s.rowActions}>
                <TouchableOpacity style={s.ghostBtn} onPress={() => openEdit(item)}>
                  <Text style={s.ghostBtnText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.dangerGhostBtn} onPress={() => confirmDelete(item.id, item.name)}>
                  <Text style={s.dangerGhostText}>Del</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      />

      <FacilityActivityModal facility={activityFacility} visible={!!activityFacility} onClose={() => setActivityFacility(null)} />

      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
            <View style={s.modalHeader}>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Text style={s.modalCancel}>Cancel</Text>
              </TouchableOpacity>
              <Text style={s.modalTitle}>{editingId ? 'Edit facility' : 'Add facility'}</Text>
              <TouchableOpacity onPress={save} disabled={saving}>
                <Text style={[s.modalSave, saving && { opacity: 0.4 }]}>{saving ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={s.modalBody} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Field label="Name *">
                <TextInput style={s.input} value={form.name} onChangeText={set('name')} />
              </Field>

              <Text style={s.fieldLabel}>Type</Text>
              <View style={[s.chipRow, { marginBottom: 16 }]}>
                {FACILITY_TYPES.map(t => (
                  <TouchableOpacity key={t} style={[s.chip, form.type === t && s.chipActive]} onPress={() => set('type')(t)}>
                    <Text style={[s.chipText, form.type === t && s.chipTextActive]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Field label="Address">
                <TextInput style={s.input} value={form.address} onChangeText={set('address')} />
              </Field>
              <Field label="Latitude">
                <TextInput style={s.input} value={form.latitude} onChangeText={set('latitude')} keyboardType="decimal-pad" placeholder="e.g. 35.1856" placeholderTextColor={colors.border} />
              </Field>
              <Field label="Longitude">
                <TextInput style={s.input} value={form.longitude} onChangeText={set('longitude')} keyboardType="decimal-pad" placeholder="e.g. 33.3823" placeholderTextColor={colors.border} />
              </Field>
              <Field label="Opening hours">
                <TextInput style={s.input} value={form.opening_hours} onChangeText={set('opening_hours')} placeholder="Mon-Fri 08:00-18:00 or 24/7" placeholderTextColor={colors.border} />
              </Field>
              <Field label="Languages (comma-separated)">
                <TextInput style={s.input} value={form.languages} onChangeText={set('languages')} placeholder="English, Turkish" placeholderTextColor={colors.border} />
              </Field>
              <Field label="Provider ID (UUID)">
                <TextInput style={s.input} value={form.provider_id} onChangeText={set('provider_id')} autoCapitalize="none" placeholder="Leave blank if none" placeholderTextColor={colors.border} />
              </Field>

              <View style={s.switchRow}>
                <Text style={s.fieldLabel}>Public facility</Text>
                <Switch value={form.is_public} onValueChange={set('is_public')} trackColor={{ true: colors.primary }} thumbColor="#fff" />
              </View>
              <View style={s.switchRow}>
                <Text style={s.fieldLabel}>Verified</Text>
                <Switch value={form.verified} onValueChange={set('verified')} trackColor={{ true: colors.success }} thumbColor="#fff" />
              </View>

              {error && <Text style={s.errorText}>{error}</Text>}
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}

// ─── Duty Schedule Tab ──────────────────────────────────────────────────────

function DutyTab() {
  const [pharmacies, setPharmacies] = useState([])
  const [date, setDate] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  const [selectedId, setSelectedId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [upcoming, setUpcoming] = useState([])
  const [notifying, setNotifying] = useState(false)
  const [notified, setNotified] = useState(false)
  const [pharmacySearch, setPharmacySearch] = useState('')

  const [swapDate, setSwapDate] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  const [dutyEntries, setDutyEntries] = useState([])
  const [loadingEntries, setLoadingEntries] = useState(false)
  const [swapTarget, setSwapTarget] = useState(null)
  const [swapModalVisible, setSwapModalVisible] = useState(false)
  const [swapSearch, setSwapSearch] = useState('')
  const [swapSelectedPharmacy, setSwapSelectedPharmacy] = useState(null)
  const [swapPhone, setSwapPhone] = useState('')
  const [swapping, setSwapping] = useState(false)
  const [swapDone, setSwapDone] = useState(false)

  useEffect(() => {
    supabase.from('facilities').select('id, name').eq('type', 'pharmacy').order('name')
      .then(({ data }) => {
        const unique = [...new Map((data ?? []).map(p => [p.id, p])).values()]
        setPharmacies(unique)
      })

    supabase.from('duty_schedule').select('date, facility_id, facilities(name)').gte('date', new Date().toISOString().slice(0, 10)).order('date').limit(10)
      .then(({ data }) => setUpcoming(data ?? []))
  }, [])

  useEffect(() => {
    supabase.from('duty_schedule').select('facility_id').eq('date', date).maybeSingle()
      .then(({ data }) => setSelectedId(data?.facility_id ?? null))
  }, [date])

  useEffect(() => {
    async function loadEntries() {
      setLoadingEntries(true)
      const { data } = await supabase
        .from('duty_list')
        .select('id, name, address, phone, region, open_from, open_until')
        .eq('duty_date', swapDate)
        .order('region').order('name')
      setDutyEntries(data ?? [])
      setLoadingEntries(false)
    }
    loadEntries()
  }, [swapDate])

  async function saveDuty() {
    if (!selectedId) return
    setSaving(true)
    const { error } = await supabase.from('duty_schedule').upsert({ date, facility_id: selectedId }, { onConflict: 'date' })
    setSaving(false)
    if (!error) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      const { data } = await supabase.from('duty_schedule').select('date, facility_id, facilities(name)').gte('date', new Date().toISOString().slice(0, 10)).order('date').limit(10)
      setUpcoming(data ?? [])
    }
  }

  async function notifyDuty() {
    if (!selectedId) return
    setNotifying(true)
    const pharmacyName = pharmacies.find(p => p.id === selectedId)?.name ?? 'Duty pharmacy'
    const title = '💊 Duty Pharmacy Tonight'
    const { data: customers } = await supabase.from('profiles').select('id, push_token').eq('role', 'customer')
    for (const c of customers ?? []) {
      await recordNotification(c.id, title, pharmacyName)
      if (c.push_token) await sendPushNotification(c.push_token, title, pharmacyName, { screen: 'duty' })
    }
    setNotifying(false)
    setNotified(true)
    setTimeout(() => setNotified(false), 3000)
  }

  async function removeDuty(d) {
    await supabase.from('duty_schedule').delete().eq('date', d)
    const { data } = await supabase.from('duty_schedule').select('date, facility_id, facilities(name)').gte('date', new Date().toISOString().slice(0, 10)).order('date').limit(10)
    setUpcoming(data ?? [])
  }

  function openSwap(entry) {
    setSwapTarget(entry)
    setSwapSearch('')
    setSwapSelectedPharmacy(null)
    setSwapPhone('')
    setSwapModalVisible(true)
  }

  async function confirmSwap() {
    if (!swapSelectedPharmacy || !swapTarget) return
    setSwapping(true)
    const { error } = await supabase
      .from('duty_list')
      .update({
        name: swapSelectedPharmacy.name,
        address: swapSelectedPharmacy.address ?? '',
        phone: swapPhone.trim() || null,
      })
      .eq('id', swapTarget.id)
    if (!error) {
      const title = '💊 Duty pharmacy updated'
      const body = `${swapSelectedPharmacy.name} is now the duty pharmacy for ${swapDate}.`
      const { data: customers } = await supabase.from('profiles').select('id, push_token').eq('role', 'customer')
      for (const c of customers ?? []) {
        await recordNotification(c.id, title, body)
        if (c.push_token) await sendPushNotification(c.push_token, title, body, { screen: 'duty' })
      }
      setSwapModalVisible(false)
      setSwapDone(true)
      setTimeout(() => setSwapDone(false), 3000)
      const { data } = await supabase
        .from('duty_list')
        .select('id, name, address, phone, region, open_from, open_until')
        .eq('duty_date', swapDate)
        .order('region').order('name')
      setDutyEntries(data ?? [])
    }
    setSwapping(false)
  }

  return (
    <View style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={s.tabContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <Text style={s.sectionTitle}>Swap duty list entry</Text>

        <Field label="Date (YYYY-MM-DD)">
          <TextInput style={s.input} value={swapDate} onChangeText={v => { setSwapDate(v); setSwapDone(false) }} keyboardType="numbers-and-punctuation" />
        </Field>

        {swapDone && (
          <View style={s.broadcastResult}>
            <Ionicons name="checkmark-circle" size={20} color={colors.success} />
            <Text style={s.broadcastResultText}>Swap saved successfully!</Text>
          </View>
        )}

        {loadingEntries
          ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} />
          : dutyEntries.length === 0
          ? <Text style={s.empty}>No duty entries for this date.</Text>
          : dutyEntries.map(entry => (
            <View key={entry.id} style={[s.card, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle} numberOfLines={1}>{entry.name}</Text>
                {(entry.region || entry.open_from) ? (
                  <Text style={s.cardSub}>
                    {[entry.region, entry.open_from && `${entry.open_from}–${entry.open_until}`].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
              </View>
              <TouchableOpacity
                style={[s.ghostBtn, { backgroundColor: colors.accentLight, marginLeft: 8 }]}
                onPress={() => openSwap(entry)}
              >
                <Text style={[s.ghostBtnText, { color: colors.accent }]}>Swap</Text>
              </TouchableOpacity>
            </View>
          ))
        }

        <View style={s.divider} />
        <Text style={s.sectionTitle}>Set duty schedule</Text>

        <Field label="Date (YYYY-MM-DD)">
          <TextInput style={s.input} value={date} onChangeText={setDate} keyboardType="numbers-and-punctuation" />
        </Field>

        <Text style={[s.fieldLabel, { marginBottom: 8 }]}>Select pharmacy</Text>
        <TextInput
          style={[s.input, { marginBottom: 10 }]}
          value={pharmacySearch}
          onChangeText={setPharmacySearch}
          placeholder="Search pharmacies…"
        />
        {pharmacies.filter(p => p.name.toLowerCase().includes(pharmacySearch.toLowerCase())).map(p => (
          <TouchableOpacity key={p.id} style={[s.card, selectedId === p.id && s.cardSelected]} onPress={() => setSelectedId(p.id)}>
            <Text style={[s.cardTitle, selectedId === p.id && { color: colors.primary }]}>{p.name}</Text>
          </TouchableOpacity>
        ))}

        <TouchableOpacity
          style={[s.primaryBtn, { marginTop: 16 }, (!selectedId || saving) && s.primaryBtnDisabled]}
          onPress={saveDuty}
          disabled={!selectedId || saving}
        >
          <Text style={s.primaryBtnText}>{saved ? 'Saved!' : saving ? 'Saving…' : 'Save duty schedule'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.ghostBtn, { marginTop: 10, paddingVertical: 12, alignItems: 'center' }, (!selectedId || notifying) && s.primaryBtnDisabled]}
          onPress={notifyDuty}
          disabled={!selectedId || notifying}
        >
          <Text style={s.ghostBtnText}>{notified ? 'Notified!' : notifying ? 'Sending…' : "Notify users about tonight's duty"}</Text>
        </TouchableOpacity>

        {upcoming.length > 0 && (
          <>
            <Text style={[s.sectionTitle, { marginTop: 28 }]}>Upcoming duty</Text>
            {upcoming.map(u => (
              <View key={u.date} style={[s.card, s.cardRow]}>
                <View style={{ flex: 1 }}>
                  <Text style={s.cardSub}>{u.date}</Text>
                  <Text style={s.cardTitle}>{u.facilities?.name ?? '—'}</Text>
                </View>
                <TouchableOpacity style={s.dangerGhostBtn} onPress={() => removeDuty(u.date)}>
                  <Text style={s.dangerGhostText}>Remove</Text>
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <Modal visible={swapModalVisible} animationType="slide" presentationStyle="pageSheet">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
            <View style={s.modalHeader}>
              <TouchableOpacity onPress={() => setSwapModalVisible(false)}>
                <Text style={s.modalCancel}>Cancel</Text>
              </TouchableOpacity>
              <Text style={s.modalTitle}>Replace pharmacy</Text>
              <TouchableOpacity onPress={confirmSwap} disabled={!swapSelectedPharmacy || swapping}>
                <Text style={[s.modalSave, (!swapSelectedPharmacy || swapping) && { opacity: 0.35 }]}>
                  {swapping ? 'Saving…' : 'Confirm'}
                </Text>
              </TouchableOpacity>
            </View>

            {swapTarget && (
              <View style={s.swapFromBanner}>
                <Text style={s.swapFromLabel}>Replacing</Text>
                <Text style={s.swapFromName} numberOfLines={1}>{swapTarget.name}</Text>
              </View>
            )}

            <ScrollView contentContainerStyle={s.modalBody} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <TextInput
                style={[s.input, { marginBottom: 10 }]}
                value={swapSearch}
                onChangeText={setSwapSearch}
                placeholder="Search pharmacies…"
                placeholderTextColor={colors.border}
              />
              {pharmacies
                .filter(p => p.name.toLowerCase().includes(swapSearch.toLowerCase()))
                .map(p => (
                  <TouchableOpacity
                    key={p.id}
                    style={[s.card, swapSelectedPharmacy?.id === p.id && s.cardSelected]}
                    onPress={() => setSwapSelectedPharmacy(p)}
                  >
                    <Text style={[s.cardTitle, swapSelectedPharmacy?.id === p.id && { color: colors.primary }]}>{p.name}</Text>
                    {p.address ? <Text style={s.cardSub} numberOfLines={1}>{p.address}</Text> : null}
                  </TouchableOpacity>
                ))
              }
              {swapSelectedPharmacy && (
                <Field label="Phone number (optional)">
                  <TextInput
                    style={s.input}
                    value={swapPhone}
                    onChangeText={setSwapPhone}
                    placeholder="e.g. 0548 831 00 00"
                    placeholderTextColor={colors.border}
                    keyboardType="phone-pad"
                  />
                </Field>
              )}
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}

// ─── Claims Tab ─────────────────────────────────────────────────────────────

function ClaimsTab() {
  const [claims, setClaims] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('claim_requests')
      .select('id, requester_id, requested_tier, created_at, registration_number, facilities(id, name, type)')
      .eq('status', 'pending')
      .order('created_at')
    const rows = data ?? []
    const ids = [...new Set(rows.map(r => r.requester_id).filter(Boolean))]
    const { data: profilesData } = ids.length
      ? await supabase.from('profiles').select('id, full_name').in('id', ids)
      : { data: [] }
    const pm = Object.fromEntries((profilesData ?? []).map(p => [p.id, p]))
    setClaims(rows.map(r => ({ ...r, _profile: pm[r.requester_id] })))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function approve(claim) {
    const trialEnd = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()
    const { error: err } = await supabase.from('facilities').update({
      provider_id:     claim.requester_id,
      status:          'trial',
      membership_tier: claim.requested_tier,
      trial_ends_at:   trialEnd,
      is_public:       true,
      verified:        true,
    }).eq('id', claim.facilities.id)
    if (err) { Alert.alert('Error', err.message); return }
    await supabase.from('claim_requests').update({ status: 'approved' }).eq('id', claim.id)
    const { data: p } = await supabase.from('profiles').select('push_token').eq('id', claim.requester_id).maybeSingle()
    const title = 'Claim approved!'
    const body = `${claim.facilities?.name ?? 'Your facility'} is now live with a 5-day trial.`
    if (p?.push_token) await sendPushNotification(p.push_token, title, body)
    await recordNotification(claim.requester_id, title, body)
    load()
  }

  async function reject(claim) {
    await supabase.from('claim_requests').update({ status: 'rejected' }).eq('id', claim.id)
    const { data: p } = await supabase.from('profiles').select('push_token').eq('id', claim.requester_id).maybeSingle()
    const title = 'Claim not approved'
    const body = `Your claim for ${claim.facilities?.name ?? 'the facility'} was not approved. Contact us for details.`
    if (p?.push_token) await sendPushNotification(p.push_token, title, body)
    await recordNotification(claim.requester_id, title, body)
    load()
  }

  if (loading) return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>

  return (
    <ScrollView contentContainerStyle={s.listContent} showsVerticalScrollIndicator={false}>
      <Text style={s.sectionTitle}>Pending claims ({claims.length})</Text>
      {claims.length === 0
        ? <SectionEmpty text="No pending claim requests." />
        : claims.map(c => (
          <View key={c.id} style={s.card}>
            <Text style={s.cardTitle} numberOfLines={1}>
              {TYPE_ICONS[c.facilities?.type] ?? '🏥'} {c.facilities?.name ?? '—'}
            </Text>
            <Text style={s.cardSub}>{c.facilities?.type} · {c.requested_tier === 'pro' ? 'Pro' : 'Basic'}</Text>
            <Text style={[s.cardSub, { marginTop: 4 }]} numberOfLines={1}>{c._profile?.full_name || c.requester_id.slice(0, 8).toUpperCase()}</Text>
            {c.registration_number ? <Text style={[s.cardSub, { fontSize: 11, marginTop: 2 }]} numberOfLines={1}>Reg: {c.registration_number}</Text> : null}
            <Text style={[s.cardSub, { fontSize: 10, marginTop: 2 }]}>
              {new Date(c.created_at).toLocaleDateString()}
            </Text>
            <View style={[s.cardRow, { marginTop: 10, gap: 8 }]}>
              <TouchableOpacity
                style={[s.ghostBtn, { backgroundColor: colors.successLight, flex: 1 }]}
                onPress={() => Alert.alert(
                  'Approve claim',
                  `Assign ${c.facilities?.name ?? 'this facility'} to this provider with a 5-day trial?`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Approve', onPress: () => approve(c) },
                  ]
                )}
              >
                <Text style={[s.ghostBtnText, { color: colors.success }]}>Approve (5-day trial)</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.dangerGhostBtn} onPress={() => reject(c)}>
                <Text style={s.dangerGhostText}>Reject</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))
      }
    </ScrollView>
  )
}

// ─── Providers Tab ──────────────────────────────────────────────────────────

function ProvidersTab() {
  const [pending,  setPending]  = useState([])
  const [active,   setActive]   = useState([])
  const [loading,  setLoading]  = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('facilities')
      .select('id, name, type, status, membership_tier, trial_ends_at, verified, provider_id, registration_number')
      .not('provider_id', 'is', null)
      .order('name')
    const rows = data ?? []
    const ids = [...new Set(rows.map(r => r.provider_id).filter(Boolean))]
    const { data: profilesData } = ids.length
      ? await supabase.from('profiles').select('id, full_name').in('id', ids)
      : { data: [] }
    const pm = Object.fromEntries((profilesData ?? []).map(p => [p.id, p]))
    const enriched = rows.map(r => ({ ...r, _profile: pm[r.provider_id] }))
    setPending(enriched.filter(f => f.status === 'pending'))
    setActive(enriched.filter(f => f.status !== 'pending'))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function approve(facilityId) {
    const facility = [...pending, ...active].find(f => f.id === facilityId)
    const trialEnd = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()
    await supabase.from('facilities').update({
      status: 'trial',
      trial_ends_at: trialEnd,
      is_public: true,
      verified: true,
    }).eq('id', facilityId)
    if (facility?.provider_id) {
      const { data: p } = await supabase.from('profiles').select('push_token').eq('id', facility.provider_id).maybeSingle()
      const title = 'Application approved!'
      const body = `${facility.name} is now live with a 5-day trial.`
      if (p?.push_token) await sendPushNotification(p.push_token, title, body)
      await recordNotification(facility.provider_id, title, body)
    }
    load()
  }

  async function reject(facilityId) {
    const facility = [...pending, ...active].find(f => f.id === facilityId)
    await supabase.from('facilities').update({ status: 'suspended' }).eq('id', facilityId)
    if (facility?.provider_id) {
      const { data: p } = await supabase.from('profiles').select('push_token').eq('id', facility.provider_id).maybeSingle()
      const title = 'Application not approved'
      const body = `Your application for ${facility.name} was not approved. Contact us for details.`
      if (p?.push_token) await sendPushNotification(p.push_token, title, body)
      await recordNotification(facility.provider_id, title, body)
    }
    load()
  }

  async function activate(facilityId) {
    const facility = active.find(f => f.id === facilityId)
    await supabase.from('facilities').update({ status: 'active', trial_ends_at: null }).eq('id', facilityId)
    if (facility?.provider_id) {
      const { data: p } = await supabase.from('profiles').select('push_token').eq('id', facility.provider_id).maybeSingle()
      const title = 'Account activated!'
      const body = `${facility.name} is now fully active. Thank you!`
      if (p?.push_token) await sendPushNotification(p.push_token, title, body)
      await recordNotification(facility.provider_id, title, body)
    }
    load()
  }

  async function suspend(facilityId) {
    const facility = active.find(f => f.id === facilityId)
    await supabase.from('facilities').update({ status: 'suspended' }).eq('id', facilityId)
    if (facility?.provider_id) {
      const { data: p } = await supabase.from('profiles').select('push_token').eq('id', facility.provider_id).maybeSingle()
      const title = 'Account suspended'
      const body = `${facility.name} has been suspended. Contact us for details.`
      if (p?.push_token) await sendPushNotification(p.push_token, title, body)
      await recordNotification(facility.provider_id, title, body)
    }
    load()
  }

  async function toggleTier(facilityId, currentTier) {
    const newTier = currentTier === 'pro' ? 'basic' : 'pro'
    await supabase.from('facilities').update({ membership_tier: newTier }).eq('id', facilityId)
    load()
  }

  if (loading) return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>

  const trialDaysLeft = f => f.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(f.trial_ends_at) - new Date()) / 86400000))
    : null

  return (
    <ScrollView contentContainerStyle={s.listContent} showsVerticalScrollIndicator={false}>
      <Text style={s.sectionTitle}>Pending approval ({pending.length})</Text>
      {pending.length === 0
        ? <SectionEmpty text="No pending applications." />
        : pending.map(f => (
          <View key={f.id} style={s.card}>
            <Text style={s.cardTitle}>{f.name}</Text>
            <Text style={s.cardSub}>{f.type} · {f.membership_tier === 'pro' ? 'Pro' : 'Basic'}</Text>
            <Text style={[s.cardSub, { marginTop: 4 }]} numberOfLines={1}>{f._profile?.full_name || f.provider_id.slice(0, 8).toUpperCase()}</Text>
            {f.registration_number ? <Text style={[s.cardSub, { fontSize: 11, marginTop: 2 }]} numberOfLines={1}>Reg: {f.registration_number}</Text> : null}
            <View style={[s.cardRow, { marginTop: 10, gap: 8 }]}>
              <TouchableOpacity style={[s.ghostBtn, { backgroundColor: colors.successLight, flex: 1 }]} onPress={() => approve(f.id)}>
                <Text style={[s.ghostBtnText, { color: colors.success }]}>Approve (5-day trial)</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.dangerGhostBtn]} onPress={() => reject(f.id)}>
                <Text style={s.dangerGhostText}>Reject</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))
      }

      <Text style={[s.sectionTitle, { marginTop: 24 }]}>Active providers ({active.length})</Text>
      {active.length === 0
        ? <SectionEmpty text="No active providers yet." />
        : active.map(f => {
          const days = trialDaysLeft(f)
          const isTrialExpired = f.status === 'trial' && days !== null && days <= 0
          const statusPill = f.status === 'active' ? s.pillGreen : f.status === 'trial' ? s.pillOrange : s.pillRed
          const statusLabel = f.status === 'active' ? 'Active'
            : f.status === 'trial' ? (isTrialExpired ? 'Trial expired' : `Trial · ${days}d left`)
            : 'Suspended'
          return (
            <View key={f.id} style={s.card}>
              <View style={[s.cardRow, { justifyContent: 'space-between' }]}>
                <View style={{ flex: 1 }}>
                  <Text style={s.cardTitle} numberOfLines={1}>{f.name}</Text>
                  <Text style={s.cardSub}>{f.type} · {f.membership_tier === 'pro' ? 'Pro' : 'Basic'}</Text>
                </View>
                <View style={statusPill}>
                  <Text style={s.pillText}>{statusLabel}</Text>
                </View>
              </View>
              <View style={[s.cardRow, { marginTop: 10, gap: 8, flexWrap: 'wrap' }]}>
                {(f.status === 'trial' || f.status === 'suspended') && (
                  <TouchableOpacity style={[s.ghostBtn, { backgroundColor: colors.successLight }]} onPress={() => activate(f.id)}>
                    <Text style={[s.ghostBtnText, { color: colors.success }]}>Mark as Paid</Text>
                  </TouchableOpacity>
                )}
                {f.status === 'active' && (
                  <TouchableOpacity style={s.dangerGhostBtn} onPress={() => suspend(f.id)}>
                    <Text style={s.dangerGhostText}>Suspend</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[s.ghostBtn, { backgroundColor: f.membership_tier === 'pro' ? '#F3F0FF' : '#FFF8E1' }]}
                  onPress={() => toggleTier(f.id, f.membership_tier)}
                >
                  <Text style={[s.ghostBtnText, { color: f.membership_tier === 'pro' ? '#7C3AED' : '#B45309' }]}>
                    {f.membership_tier === 'pro' ? 'Downgrade to Basic' : 'Upgrade to Pro'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )
        })
      }
    </ScrollView>
  )
}

// ─── Users Tab ──────────────────────────────────────────────────────────────

function UsersTab() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('profiles').select('id, role, full_name, preferred_language').order('role')
    setUsers(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function setRole(id, newRole) {
    if (newRole === 'admin') {
      Alert.alert('Promote to admin?', 'This gives full admin access. Are you sure?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Promote', style: 'destructive', onPress: async () => { await supabase.from('profiles').update({ role: newRole }).eq('id', id); load() } },
      ])
    } else {
      await supabase.from('profiles').update({ role: newRole }).eq('id', id)
      load()
    }
  }

  if (loading) return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>

  return (
    <FlatList
      data={users}
      keyExtractor={u => u.id}
      contentContainerStyle={s.listContent}
      showsVerticalScrollIndicator={false}
      ListEmptyComponent={<SectionEmpty text="No users yet." />}
      renderItem={({ item }) => (
        <View style={s.card}>
          <Text style={s.cardTitle} numberOfLines={1}>{item.full_name || 'Unnamed user'}</Text>
          <Text style={s.cardSub} numberOfLines={1}>ID: {item.id.slice(0, 8)}…  {item.preferred_language ? `· ${item.preferred_language}` : ''}</Text>
          <View style={[s.cardRow, { marginTop: 8, alignItems: 'center' }]}>
            <View style={
              item.role === 'admin' ? s.pillPurple
              : item.role === 'provider' ? s.pillBlue
              : s.pillGrey
            }>
              <Text style={s.pillText}>{item.role}</Text>
            </View>
          </View>
          <View style={[s.chipRow, { marginTop: 10 }]}>
            {ROLES.map(r => (
              <TouchableOpacity
                key={r}
                style={[s.chip, item.role === r && s.chipActive]}
                onPress={() => r !== item.role && setRole(item.id, r)}
              >
                <Text style={[s.chipText, item.role === r && s.chipTextActive]}>{r}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
    />
  )
}

// ─── Bookings Tab ───────────────────────────────────────────────────────────

function BookingsTab() {
  const [appointments, setAppointments] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('pending')

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('appointments')
      .select('id, requested_time, status, customer_id, facility_id, facilities(name)')
      .eq('status', filter)
      .order('requested_time', { ascending: false })
      .limit(50)
    setAppointments(data ?? [])
    setLoading(false)
  }, [filter])

  useEffect(() => { load() }, [load])

  async function updateStatus(id, status) {
    await supabase.from('appointments').update({ status }).eq('id', id)
    load()
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={s.chipRow}>
        {['pending', 'confirmed', 'cancelled'].map(f => (
          <TouchableOpacity key={f} style={[s.chip, filter === f && s.chipActive]} onPress={() => setFilter(f)}>
            <Text style={[s.chipText, filter === f && s.chipTextActive]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading
        ? <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
        : (
          <FlatList
            data={appointments}
            keyExtractor={a => a.id}
            contentContainerStyle={s.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={<SectionEmpty text={`No ${filter} bookings.`} />}
            renderItem={({ item }) => (
              <View style={s.card}>
                <Text style={s.cardTitle}>{item.facilities?.name ?? 'Unknown facility'}</Text>
                <Text style={s.cardSub}>{new Date(item.requested_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</Text>
                <Text style={[s.cardSub, { marginTop: 2 }]} numberOfLines={1}>Customer: {item.customer_id.slice(0, 8)}…</Text>
                {filter === 'pending' && (
                  <View style={[s.cardRow, { marginTop: 10, gap: 8 }]}>
                    <TouchableOpacity style={[s.ghostBtn, { backgroundColor: colors.successLight }]} onPress={() => updateStatus(item.id, 'confirmed')}>
                      <Text style={[s.ghostBtnText, { color: colors.success }]}>Confirm</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.ghostBtn, { backgroundColor: colors.dangerLight }]} onPress={() => updateStatus(item.id, 'cancelled')}>
                      <Text style={[s.ghostBtnText, { color: colors.danger }]}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}
          />
        )
      }
    </View>
  )
}

// ─── Changes Tab ────────────────────────────────────────────────────────────

const CHANGE_FIELD_LABELS = {
  phone: 'Phone', address: 'Address', opening_hours: 'Opening Hours',
  description: 'About', languages: 'Languages',
}

function formatVal(val) {
  if (val == null || val === '') return '(empty)'
  if (Array.isArray(val)) return val.join(', ')
  return String(val)
}

function DiffRow({ field, current, proposed }) {
  const cur = current?.[field] ?? null
  const prop = proposed?.[field] ?? null
  if (JSON.stringify(cur) === JSON.stringify(prop)) return null
  return (
    <View style={s.diffRow}>
      <Text style={s.diffField}>{CHANGE_FIELD_LABELS[field] ?? field}</Text>
      <Text style={s.diffCurrent} numberOfLines={2}>{formatVal(cur)}</Text>
      <Ionicons name="arrow-forward" size={12} color={colors.textSecondary} style={{ marginHorizontal: 4 }} />
      <Text style={s.diffProposed} numberOfLines={2}>{formatVal(prop)}</Text>
    </View>
  )
}

function ChangesTab() {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('facility_change_requests')
      .select('id, facility_id, provider_id, proposed_changes, created_at, facilities(name, phone, address, opening_hours, description, languages)')
      .eq('status', 'pending')
      .order('created_at')
    const rows = data ?? []
    const ids = [...new Set(rows.map(r => r.provider_id).filter(Boolean))]
    const { data: profilesData } = ids.length
      ? await supabase.from('profiles').select('id, full_name').in('id', ids)
      : { data: [] }
    const pm = Object.fromEntries((profilesData ?? []).map(p => [p.id, p]))
    setRequests(rows.map(r => ({ ...r, _provider: pm[r.provider_id] })))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function approve(req) {
    setActionLoading(req.id)
    const { error } = await supabase
      .from('facilities')
      .update(req.proposed_changes)
      .eq('id', req.facility_id)
    if (!error) {
      await supabase.from('facility_change_requests').update({ status: 'approved' }).eq('id', req.id)
      const { data: p } = await supabase.from('profiles').select('push_token').eq('id', req.provider_id).maybeSingle()
      const title = 'Changes approved'
      const body = `Your updates to ${req.facilities?.name ?? 'your facility'} are now live.`
      if (p?.push_token) await sendPushNotification(p.push_token, title, body)
      await recordNotification(req.provider_id, title, body)
      load()
    }
    setActionLoading(null)
  }

  async function reject(req) {
    setActionLoading(req.id)
    await supabase.from('facility_change_requests').update({ status: 'rejected' }).eq('id', req.id)
    const { data: p } = await supabase.from('profiles').select('push_token').eq('id', req.provider_id).maybeSingle()
    const title = 'Changes not approved'
    const body = `Your updates to ${req.facilities?.name ?? 'your facility'} were not approved. Contact us for details.`
    if (p?.push_token) await sendPushNotification(p.push_token, title, body)
    await recordNotification(req.provider_id, title, body)
    setActionLoading(null)
    load()
  }

  if (loading) return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>

  return (
    <ScrollView contentContainerStyle={s.listContent} showsVerticalScrollIndicator={false}>
      <Text style={s.sectionTitle}>Pending changes ({requests.length})</Text>
      {requests.length === 0
        ? <SectionEmpty text="No pending change requests." />
        : requests.map(req => {
          const facility = req.facilities ?? {}
          const isLoading = actionLoading === req.id
          return (
            <View key={req.id} style={s.card}>
              <View style={[s.cardRow, { justifyContent: 'space-between', marginBottom: 4 }]}>
                <Text style={s.cardTitle} numberOfLines={1}>{facility.name ?? '—'}</Text>
                <Text style={s.cardSub}>{new Date(req.created_at).toLocaleDateString()}</Text>
              </View>
              <Text style={[s.cardSub, { marginBottom: 12 }]}>
                by {req._provider?.full_name || req.provider_id?.slice(0, 8)}
              </Text>
              {Object.keys(CHANGE_FIELD_LABELS).map(field => (
                <DiffRow key={field} field={field} current={facility} proposed={req.proposed_changes} />
              ))}
              <View style={[s.cardRow, { marginTop: 14, gap: 8 }]}>
                <TouchableOpacity
                  style={[s.ghostBtn, { backgroundColor: colors.successLight, flex: 1 }, isLoading && { opacity: 0.5 }]}
                  onPress={() => approve(req)}
                  disabled={isLoading}
                >
                  {isLoading
                    ? <ActivityIndicator size="small" color={colors.success} />
                    : <Text style={[s.ghostBtnText, { color: colors.success }]}>Approve & go live</Text>
                  }
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.dangerGhostBtn, isLoading && { opacity: 0.5 }]}
                  onPress={() => reject(req)}
                  disabled={isLoading}
                >
                  <Text style={s.dangerGhostText}>Reject</Text>
                </TouchableOpacity>
              </View>
            </View>
          )
        })
      }
    </ScrollView>
  )
}

// ─── Broadcast Tab ──────────────────────────────────────────────────────────

function BroadcastTab() {
  const [title, setTitle]   = useState('')
  const [body, setBody]     = useState('')
  const [target, setTarget] = useState('all')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError]   = useState(null)

  async function send() {
    if (!title.trim() || !body.trim()) { setError('Title and message are required.'); return }
    setSending(true)
    setError(null)
    setResult(null)

    let query = supabase.from('profiles').select('id, push_token')
    if (target === 'customers') query = query.eq('role', 'customer')
    else if (target === 'providers') query = query.eq('role', 'provider')

    const { data: profiles, error: fetchErr } = await query
    if (fetchErr) { setError(fetchErr.message); setSending(false); return }

    const t = title.trim()
    const b = body.trim()
    let pushCount = 0

    for (const p of profiles ?? []) {
      await recordNotification(p.id, t, b)
      if (p.push_token) { await sendPushNotification(p.push_token, t, b); pushCount++ }
    }

    setResult({ total: (profiles ?? []).length, pushCount })
    setSending(false)
  }

  return (
    <ScrollView contentContainerStyle={s.tabContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <Text style={s.sectionTitle}>Broadcast notification</Text>

      <Field label="Title">
        <TextInput
          style={s.input}
          value={title}
          onChangeText={v => { setTitle(v); setResult(null) }}
          placeholder="e.g. Duty pharmacy update"
          placeholderTextColor={colors.border}
          maxLength={100}
        />
      </Field>

      <Field label="Message">
        <TextInput
          style={[s.input, { minHeight: 90, textAlignVertical: 'top' }]}
          value={body}
          onChangeText={v => { setBody(v); setResult(null) }}
          placeholder="Enter your message…"
          placeholderTextColor={colors.border}
          multiline
          maxLength={300}
        />
      </Field>

      <Text style={[s.fieldLabel, { marginBottom: 8 }]}>Send to</Text>
      <View style={[s.chipRow, { marginBottom: 20 }]}>
        {[
          { key: 'all',       label: 'All users'  },
          { key: 'customers', label: 'Customers'  },
          { key: 'providers', label: 'Providers'  },
        ].map(opt => (
          <TouchableOpacity
            key={opt.key}
            style={[s.chip, target === opt.key && s.chipActive]}
            onPress={() => { setTarget(opt.key); setResult(null) }}
          >
            <Text style={[s.chipText, target === opt.key && s.chipTextActive]}>{opt.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {error ? <Text style={s.errorText}>{error}</Text> : null}

      {result ? (
        <View style={s.broadcastResult}>
          <Ionicons name="checkmark-circle" size={20} color={colors.success} />
          <Text style={s.broadcastResultText}>
            Delivered to {result.total} users · {result.pushCount} push sent
          </Text>
        </View>
      ) : null}

      <TouchableOpacity
        style={[s.primaryBtn, (!title.trim() || !body.trim() || sending) && s.primaryBtnDisabled]}
        onPress={send}
        disabled={!title.trim() || !body.trim() || sending}
      >
        {sending
          ? <ActivityIndicator color="#fff" />
          : <Text style={s.primaryBtnText}>Send broadcast</Text>
        }
      </TouchableOpacity>

      <Text style={s.broadcastNote}>
        Sends an in-app notification to all matching users, plus a push notification to those with push enabled.
      </Text>
    </ScrollView>
  )
}

// ─── Main ───────────────────────────────────────────────────────────────────

export default function AdminScreen({ session }) {
  const [tab, setTab] = useState('Dashboard')
  const navigateTo = t => setTab(t)

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.container}>
        <View style={s.header}>
          <View style={s.headerLeft}>
            <Image source={require('../assets/adalogo.png')} style={s.headerIcon} resizeMode="contain" />
            <Text style={s.headerLabel}>Admin</Text>
          </View>
          <TouchableOpacity style={s.signOutBtn} onPress={() => supabase.auth.signOut()}>
            <Text style={s.signOutText}>Sign out</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.tabBar}
          contentContainerStyle={s.tabBarContent}
        >
          {TABS.map(t => (
            <TouchableOpacity key={t} style={[s.tabBtn, tab === t && s.tabBtnActive]} onPress={() => setTab(t)}>
              <Text style={[s.tabBtnText, tab === t && s.tabBtnTextActive]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={{ flex: 1 }}>
          {tab === 'Dashboard'  && <DashboardTab onNavigate={navigateTo} />}
          {tab === 'Changes'    && <ChangesTab />}
          {tab === 'Claims'     && <ClaimsTab />}
          {tab === 'Providers'  && <ProvidersTab />}
          {tab === 'Facilities' && <FacilitiesTab />}
          {tab === 'Duty'       && <DutyTab />}
          {tab === 'Users'      && <UsersTab />}
          {tab === 'Bookings'   && <BookingsTab />}
          {tab === 'Broadcast'  && <BroadcastTab />}
        </View>
      </View>
    </SafeAreaView>
  )
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:               { flex: 1, backgroundColor: colors.bg },
  container:          { flex: 1, paddingHorizontal: 16 },
  center:             { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header:             { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, paddingBottom: 12 },
  wordmark:           { fontSize: 20, fontFamily: 'Inter_700Bold', color: colors.textPrimary, letterSpacing: -0.5 },
  headerLeft:         { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIcon:         { width: 36, height: 36, borderRadius: 8 },
  headerLabel:        { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  signOutBtn:         { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.dangerLight },
  signOutText:        { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.danger },

  tabBar:             { flexGrow: 0, marginBottom: 16 },
  tabBarContent:      { gap: 8, paddingRight: 4 },
  tabBtn:             { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.cardBg },
  tabBtnActive:       { backgroundColor: colors.primary },
  tabBtnText:         { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  tabBtnTextActive:   { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#fff' },

  tabContent:         { paddingBottom: 40 },
  listContent:        { paddingBottom: 40 },
  sectionTitle:       { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },

  statsGrid:          { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard:           { backgroundColor: colors.cardBg, borderRadius: 16, padding: 16, minWidth: '45%', flex: 1, ...shadow },
  statValue:          { fontSize: 28, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 4 },
  statLabel:          { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary },

  card:               { backgroundColor: colors.cardBg, borderRadius: 16, padding: 14, marginBottom: 10, ...shadow },
  cardSelected:       { borderWidth: 1.5, borderColor: colors.primary },
  cardRow:            { flexDirection: 'row', alignItems: 'flex-start' },
  cardTitle:          { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 3 },
  cardSub:            { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary },

  rowActions:         { flexDirection: 'row', gap: 6, marginLeft: 8 },
  ghostBtn:           { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: colors.primaryLight },
  ghostBtnText:       { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary },
  dangerGhostBtn:     { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: colors.dangerLight },
  dangerGhostText:    { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.danger },

  primaryBtn:         { backgroundColor: colors.primary, borderRadius: 14, padding: 15, alignItems: 'center', marginBottom: 12 },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText:     { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },

  chipRow:            { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:               { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  chipActive:         { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  chipText:           { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  chipTextActive:     { fontFamily: 'Inter_700Bold', color: colors.primary },

  fieldGroup:         { marginBottom: 16 },
  fieldLabel:         { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 7 },
  input:              { borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, padding: 13, fontSize: 15, fontFamily: 'Inter_400Regular', backgroundColor: colors.surface, color: colors.textPrimary },
  switchRow:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  errorText:          { fontFamily: 'Inter_400Regular', color: colors.danger, fontSize: 13, marginTop: 8 },
  empty:              { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', marginTop: 40 },

  modalHeader:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalTitle:         { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  modalCancel:        { fontSize: 16, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  modalSave:          { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.primary },
  modalBody:          { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 60 },

  broadcastResult:    { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.successLight, borderRadius: 10, padding: 12, marginBottom: 16 },
  broadcastResultText:{ fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.success, flex: 1 },
  broadcastNote:      { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', marginTop: 12, lineHeight: 18 },
  divider:            { height: 1, backgroundColor: colors.border, marginVertical: 24 },
  swapFromBanner:     { backgroundColor: colors.accentLight, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  swapFromLabel:      { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.accent, textTransform: 'uppercase', letterSpacing: 0.5 },
  swapFromName:       { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginTop: 2 },

  // urgency cards
  urgencyCard:        { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.cardBg, borderRadius: 14, padding: 14, marginBottom: 8, ...shadow },
  urgencyDot:         { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  urgencyLabel:       { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  urgencyBadge:       { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, minWidth: 24, alignItems: 'center' },
  urgencyCount:       { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#fff' },
  allClearBox:        { alignItems: 'center', gap: 10, marginTop: 40 },
  allClearText:       { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary },

  // diff rows
  diffRow:            { flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap', gap: 4, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border },
  diffField:          { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', width: 80, paddingTop: 1, flexShrink: 0 },
  diffCurrent:        { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.danger, flex: 1 },
  diffProposed:       { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.success, flex: 1 },

  // status pills
  statusPill:         { alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  pillText:           { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#fff', textTransform: 'capitalize' },
  pillGreen:          { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: colors.success },
  pillOrange:         { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: colors.accent },
  pillRed:            { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: colors.danger },
  pillBlue:           { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: colors.primary },
  pillPurple:         { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: '#7C3AED' },
  pillGrey:           { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: colors.textSecondary },
})
