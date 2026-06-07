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
const TABS = ['Dashboard', 'Facilities', 'Duty', 'Providers', 'Claims', 'Users', 'Bookings']

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

function DashboardTab() {
  const [stats, setStats] = useState(null)
  const [recent, setRecent] = useState([])

  useEffect(() => {
    async function load() {
      const [
        { count: facilities },
        { count: users },
        { count: pending },
        { count: confirmed },
        { count: cancelled },
        { data: recentAppts },
      ] = await Promise.all([
        supabase.from('facilities').select('*', { count: 'exact', head: true }),
        supabase.from('profiles').select('*', { count: 'exact', head: true }),
        supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('status', 'confirmed'),
        supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('status', 'cancelled'),
        supabase.from('appointments').select('id, requested_time, status, facility_id').order('requested_time', { ascending: false }).limit(5),
      ])
      setStats({ facilities, users, pending, confirmed, cancelled })
      setRecent(recentAppts ?? [])
    }
    load()
  }, [])

  if (!stats) return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>

  return (
    <ScrollView contentContainerStyle={s.tabContent} showsVerticalScrollIndicator={false}>
      <Text style={s.sectionTitle}>Overview</Text>
      <View style={s.statsGrid}>
        <StatCard label="Facilities" value={stats.facilities} />
        <StatCard label="Users" value={stats.users} />
        <StatCard label="Pending" value={stats.pending} color={colors.accent} />
        <StatCard label="Confirmed" value={stats.confirmed} color={colors.success} />
        <StatCard label="Cancelled" value={stats.cancelled} color={colors.danger} />
      </View>

      <Text style={[s.sectionTitle, { marginTop: 24 }]}>Recent bookings</Text>
      {recent.length === 0
        ? <SectionEmpty text="No bookings yet." />
        : recent.map(a => (
          <View key={a.id} style={s.card}>
            <Text style={s.cardSub}>{new Date(a.requested_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</Text>
            <View style={[s.statusPill, a.status === 'confirmed' ? s.pillGreen : a.status === 'cancelled' ? s.pillRed : s.pillOrange]}>
              <Text style={s.pillText}>{a.status}</Text>
            </View>
          </View>
        ))
      }
    </ScrollView>
  )
}

// ─── Facilities Tab ─────────────────────────────────────────────────────────

const BLANK = {
  name: '', type: 'pharmacy', address: '',
  latitude: '', longitude: '', opening_hours: '',
  languages: '', is_public: true, verified: false, provider_id: '',
}

function FacilitiesTab() {
  const [facilities, setFacilities] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingId, setEditingId] = useState(null)
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
              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle} numberOfLines={1}>{item.name}</Text>
                <Text style={s.cardSub}>{item.type} · {item.address}</Text>
                <View style={[s.cardRow, { marginTop: 6, gap: 6 }]}>
                  {item.verified && <View style={s.pillGreen}><Text style={s.pillText}>Verified</Text></View>}
                  {item.is_public && <View style={s.pillBlue}><Text style={s.pillText}>Public</Text></View>}
                  {!item.verified && <View style={s.pillOrange}><Text style={s.pillText}>Unverified</Text></View>}
                </View>
              </View>
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

  useEffect(() => {
    supabase.from('facilities').select('id, name').eq('type', 'pharmacy').order('name')
      .then(({ data }) => setPharmacies(data ?? []))

    supabase.from('duty_schedule').select('date, facility_id, facilities(name)').gte('date', new Date().toISOString().slice(0, 10)).order('date').limit(10)
      .then(({ data }) => setUpcoming(data ?? []))
  }, [])

  useEffect(() => {
    supabase.from('duty_schedule').select('facility_id').eq('date', date).maybeSingle()
      .then(({ data }) => setSelectedId(data?.facility_id ?? null))
  }, [date])

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

  async function removeDuty(d) {
    await supabase.from('duty_schedule').delete().eq('date', d)
    const { data } = await supabase.from('duty_schedule').select('date, facility_id, facilities(name)').gte('date', new Date().toISOString().slice(0, 10)).order('date').limit(10)
    setUpcoming(data ?? [])
  }

  return (
    <ScrollView contentContainerStyle={s.tabContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <Text style={s.sectionTitle}>Set duty pharmacy</Text>

      <Field label="Date (YYYY-MM-DD)">
        <TextInput style={s.input} value={date} onChangeText={setDate} keyboardType="numbers-and-punctuation" />
      </Field>

      <Text style={[s.fieldLabel, { marginBottom: 8 }]}>Select pharmacy</Text>
      {pharmacies.map(p => (
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
      .select('id, requester_id, requested_tier, created_at, facilities(id, name, type)')
      .eq('status', 'pending')
      .order('created_at')
    setClaims(data ?? [])
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
    load()
  }

  async function reject(claim) {
    await supabase.from('claim_requests').update({ status: 'rejected' }).eq('id', claim.id)
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
            <Text style={[s.cardSub, { marginTop: 2, fontSize: 10 }]} numberOfLines={1}>
              Requester ID: {c.requester_id.replace(/-/g, '').slice(0, 12).toUpperCase()}
            </Text>
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
      .select('id, name, type, status, membership_tier, trial_ends_at, verified, provider_id')
      .not('provider_id', 'is', null)
      .order('name')
    const rows = data ?? []
    setPending(rows.filter(f => f.status === 'pending'))
    setActive(rows.filter(f => f.status !== 'pending'))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function approve(facilityId) {
    const trialEnd = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()
    await supabase.from('facilities').update({
      status: 'trial',
      trial_ends_at: trialEnd,
      is_public: true,
      verified: true,
    }).eq('id', facilityId)
    load()
  }

  async function reject(facilityId) {
    await supabase.from('facilities').update({ status: 'suspended' }).eq('id', facilityId)
    load()
  }

  async function activate(facilityId) {
    await supabase.from('facilities').update({ status: 'active', trial_ends_at: null }).eq('id', facilityId)
    load()
  }

  async function suspend(facilityId) {
    await supabase.from('facilities').update({ status: 'suspended' }).eq('id', facilityId)
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
            <Text style={[s.cardSub, { marginTop: 2, fontSize: 10 }]} numberOfLines={1}>Provider: {f.provider_id}</Text>
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

// ─── Main ───────────────────────────────────────────────────────────────────

export default function AdminScreen({ session }) {
  const [tab, setTab] = useState('Dashboard')

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
          {tab === 'Dashboard'  && <DashboardTab />}
          {tab === 'Facilities' && <FacilitiesTab />}
          {tab === 'Duty'       && <DutyTab />}
          {tab === 'Providers'  && <ProvidersTab />}
          {tab === 'Claims'     && <ClaimsTab />}
          {tab === 'Users'      && <UsersTab />}
          {tab === 'Bookings'   && <BookingsTab />}
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
