import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, Image, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
  Modal, TextInput, Switch, ScrollView, Alert, KeyboardAvoidingView, Platform, Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather, Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { colors, placeColors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'

const FACILITY_TYPES = ['pharmacy', 'clinic', 'hospital', 'dentist']
const TYPE_ICONS = { pharmacy: '💊', clinic: '🩺', hospital: '🏥', dentist: '🦷' }
const ROLES = ['customer', 'provider', 'organizer', 'admin']
const TABS = ['Dashboard', 'Reports', 'Changes', 'Claims', 'Providers', 'Credentials', 'Facilities', 'Duty', 'Users', 'Bookings', 'Broadcast', 'Events', 'Properties', 'Agents', 'HomeServices', 'Transport', 'Insurance', 'BusRoutes', 'Places', 'JobPostings']

async function sendPushNotification(token, title, body, data = {}) {
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ to: token, title, body, sound: 'default', data }),
    })
  } catch {}
}

// Broadcast push to many tokens. Expo's push API caps a single request at 100
// messages, so we chunk. Each chunk is one fetch carrying an array payload.
async function sendPushBatch(tokens, title, body, data = {}) {
  for (let i = 0; i < tokens.length; i += 100) {
    const chunk = tokens.slice(i, i + 100)
    try {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(chunk.map(to => ({ to, title, body, sound: 'default', data }))),
      })
    } catch {}
  }
}

// Writes via the insert_notification RPC (SECURITY DEFINER) — a direct insert is
// always rejected, because the only INSERT policy on notifications is
// WITH CHECK (false). The error is surfaced rather than swallowed: this helper
// failed silently for every call site until now, and supabase-js returns
// { error } instead of throwing, so a try/catch would not have caught it either.
async function recordNotification(userId, title, body) {
  const { error } = await supabase.rpc('insert_notification', {
    p_user_id: userId, p_title: title, p_body: body,
  })
  if (error) console.warn('recordNotification failed:', error.message)
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

function RejectModal({ visible, entityName, onConfirm, onCancel }) {
  const [reason, setReason] = useState('')
  function handleConfirm() { onConfirm(reason.trim()); setReason('') }
  function handleCancel()  { onCancel(); setReason('') }
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <TouchableOpacity style={s.rejectOverlay} activeOpacity={1} onPress={handleCancel}>
        <TouchableOpacity style={s.rejectSheet} activeOpacity={1}>
          <Text style={s.rejectTitle}>Reject{entityName ? ` "${entityName}"` : ''}?</Text>
          <Text style={s.rejectSub}>Add a reason so the provider knows what to fix.</Text>
          <TextInput
            style={s.rejectInput}
            value={reason}
            onChangeText={setReason}
            placeholder="e.g. Could not verify registration number"
            placeholderTextColor={colors.textSecondary}
            multiline
            maxLength={300}
            textAlignVertical="top"
          />
          <View style={s.rejectBtnRow}>
            <TouchableOpacity style={s.rejectCancelBtn} onPress={handleCancel}>
              <Text style={s.rejectCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.rejectConfirmBtn} onPress={handleConfirm}>
              <Text style={s.rejectConfirmText}>Reject</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  )
}

// Admin-only. Payment wording is fine HERE (internal panel) but must never
// appear in a consumer screen — see 20260722_job_postings_business_paid_tier.sql.
function ActivateJobModal({ visible, jobTitle, isRenew, onConfirm, onCancel }) {
  const [ref, setRef] = useState('')
  function handleConfirm() { onConfirm(ref.trim()); setRef('') }
  function handleCancel()  { onCancel(); setRef('') }
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <TouchableOpacity style={s.rejectOverlay} activeOpacity={1} onPress={handleCancel}>
        <TouchableOpacity style={s.rejectSheet} activeOpacity={1}>
          <Text style={s.rejectTitle}>{isRenew ? 'Renew' : 'Activate'}{jobTitle ? ` "${jobTitle}"` : ''}?</Text>
          <Text style={s.rejectSub}>
            Confirm the bank transfer has landed. This publishes the listing for 30 days.
          </Text>
          <TextInput
            style={[s.rejectInput, { minHeight: 40 }]}
            value={ref}
            onChangeText={setRef}
            placeholder="Bank reference (optional)"
            placeholderTextColor={colors.textSecondary}
            maxLength={120}
          />
          <View style={s.rejectBtnRow}>
            <TouchableOpacity style={s.rejectCancelBtn} onPress={handleCancel}>
              <Text style={s.rejectCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.rejectConfirmBtn, { backgroundColor: colors.primary }]} onPress={handleConfirm}>
              <Text style={s.rejectConfirmText}>{isRenew ? 'Renew' : 'Activate'}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  )
}

function SubscribeModal({ visible, agentName, isExtend, onConfirm, onCancel }) {
  const [days, setDays] = useState(30)
  const OPTIONS = [30, 90, 180, 365]
  function handleConfirm() { onConfirm(days) }
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <TouchableOpacity style={s.rejectOverlay} activeOpacity={1} onPress={onCancel}>
        <TouchableOpacity style={s.rejectSheet} activeOpacity={1}>
          <Text style={s.rejectTitle}>{isExtend ? 'Extend Subscription' : 'Approve & Subscribe'}</Text>
          <Text style={s.rejectSub}>{agentName ? `Agent: ${agentName}` : ''}</Text>
          <Text style={[s.rejectSub, { marginTop: 12, marginBottom: 8, fontFamily: 'Inter_700Bold', color: colors.textPrimary }]}>
            Subscription duration
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
            {OPTIONS.map(d => (
              <TouchableOpacity
                key={d}
                onPress={() => setDays(d)}
                style={[
                  s.chip,
                  days === d && s.chipActive,
                  { paddingHorizontal: 16, paddingVertical: 9 },
                ]}
              >
                <Text style={[s.chipText, days === d && s.chipTextActive]}>
                  {d === 365 ? '1 year' : `${d} days`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={s.rejectBtnRow}>
            <TouchableOpacity style={s.rejectCancelBtn} onPress={onCancel}>
              <Text style={s.rejectCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.rejectConfirmBtn} onPress={handleConfirm}>
              <Text style={s.rejectConfirmText}>{isExtend ? 'Extend' : 'Approve'}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  )
}

function fmtExpiry(expiresAt) {
  if (!expiresAt) return { label: 'No subscription', color: colors.danger }
  const exp = new Date(expiresAt)
  const now = new Date()
  const dateStr = exp.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  if (exp < now) return { label: `Expired ${dateStr}`, color: colors.danger }
  const daysLeft = Math.ceil((exp - now) / (1000 * 60 * 60 * 24))
  if (daysLeft <= 7) return { label: `Expires ${dateStr} (${daysLeft}d)`, color: colors.accent }
  return { label: `Active until ${dateStr}`, color: colors.success }
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
        { count: pendingCredentials },
        { count: pendingDocs },
        { count: pendingEvents },
        { count: pendingProperties },
        { count: pendingAgents },
        { count: pendingHomeServices },
        { count: pendingTransport },
        { count: pendingInsurance },
        { count: pendingBeaches },
        { count: pendingLandmarks },
        { count: pendingJobPostings },
        { count: pendingReports },
      ] = await Promise.all([
        supabase.from('facilities').select('*', { count: 'exact', head: true }),
        supabase.from('profiles').select('*', { count: 'exact', head: true }),
        supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('claim_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('facility_change_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('facilities').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('provider_credentials').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('provider_documents').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('events').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('properties').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('estate_agents').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('home_services').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('transport_providers').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('insurance_companies').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('beaches').select('*',   { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('landmarks').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('job_postings').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('content_reports').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      ])
      const pendingPlaces = (pendingBeaches ?? 0) + (pendingLandmarks ?? 0)
      setStats({ facilities, users, pendingAppts, pendingClaims, pendingChanges, pendingProviders, pendingCredentials, pendingDocs, pendingEvents, pendingProperties, pendingAgents, pendingHomeServices, pendingTransport, pendingInsurance, pendingPlaces, pendingJobPostings, pendingReports })
    }
    load()
  }, [])

  if (!stats) return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>

  const urgencies = [
    (stats.pendingReports ?? 0) > 0 && { label: 'Reported content — 24h SLA', count: stats.pendingReports, tab: 'Reports', color: colors.danger },
    stats.pendingChanges     > 0 && { label: 'Profile change requests',     count: stats.pendingChanges,     tab: 'Changes',     color: colors.accent },
    stats.pendingClaims      > 0 && { label: 'Pending facility claims',      count: stats.pendingClaims,      tab: 'Claims',      color: colors.danger },
    stats.pendingProviders   > 0 && { label: 'Providers awaiting approval',  count: stats.pendingProviders,   tab: 'Providers',   color: colors.danger },
    stats.pendingCredentials > 0 && { label: 'Credentials awaiting review',  count: stats.pendingCredentials, tab: 'Credentials', color: '#7C3AED' },
    (stats.pendingDocs ?? 0) > 0 && { label: 'ID documents to verify',       count: stats.pendingDocs,        tab: 'Claims',      color: colors.accent },
    stats.pendingAppts           > 0 && { label: 'Pending appointments',          count: stats.pendingAppts,           tab: 'Bookings',    color: colors.primary },
    (stats.pendingEvents ?? 0)   > 0 && { label: 'Events awaiting approval',      count: stats.pendingEvents,          tab: 'Events',      color: colors.primary },
    (stats.pendingProperties ?? 0) > 0 && { label: 'Property listings to review', count: stats.pendingProperties,      tab: 'Properties',  color: colors.primary },
    (stats.pendingAgents ?? 0)      > 0 && { label: 'Agent applications pending',       count: stats.pendingAgents,         tab: 'Agents',       color: '#7C3AED' },
    (stats.pendingHomeServices ?? 0) > 0 && { label: 'Home service providers pending',  count: stats.pendingHomeServices,   tab: 'HomeServices', color: colors.primary },
    (stats.pendingTransport ?? 0)    > 0 && { label: 'Transport providers pending',      count: stats.pendingTransport,       tab: 'Transport',    color: colors.primary },
    (stats.pendingInsurance ?? 0)    > 0 && { label: 'Insurance companies pending',      count: stats.pendingInsurance,       tab: 'Insurance',    color: colors.primary },
    (stats.pendingPlaces ?? 0)       > 0 && { label: 'Beaches & landmarks to review',   count: stats.pendingPlaces,          tab: 'Places',       color: placeColors.beach.text },
    (stats.pendingJobPostings ?? 0)  > 0 && { label: 'Job postings awaiting approval',  count: stats.pendingJobPostings,     tab: 'JobPostings',  color: colors.primary },
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

// ─── Reports Tab (UGC moderation — App Store Guideline 1.2) ─────────────────
// Reports are grouped by the content they point at, so N reports on one review
// are one triage decision, not N. Oldest first: the queue is SLA-bound (we
// publish a 24h removal commitment in the Terms).

const REASON_LABELS  = { offensive: 'Offensive', harassment: 'Harassment', spam: 'Spam', false_info: 'False info', other: 'Other' }
const CONTENT_TABLE  = { review: 'reviews', question: 'questions', answer: 'answers' }
const AUTHOR_COL     = { review: 'customer_id', question: 'customer_id', answer: 'provider_id' }
const TEXT_COL       = { review: 'comment', question: 'body', answer: 'body' }

function timeAgo(iso) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function ReportsTab({ session }) {
  const [groups, setGroups] = useState(null)
  const [busy, setBusy]     = useState(null)

  const load = useCallback(async () => {
    const { data: reports } = await supabase
      .from('content_reports')
      .select('id, content_type, content_id, reason, details, created_at, reporter_id')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
    if (!reports?.length) { setGroups([]); return }

    const reporterIds = [...new Set(reports.map(r => r.reporter_id))]
    const { data: reporters } = await supabase.from('profiles').select('id, full_name').in('id', reporterIds)
    const nameById = new Map((reporters ?? []).map(p => [p.id, p.full_name]))

    // content_reports is polymorphic and has no FK, so the content is fetched per
    // type. It may be missing entirely — delete_own_account hard-deletes a user's
    // reviews, which leaves their reports dangling.
    const contentByKey = new Map()
    for (const type of ['review', 'question', 'answer']) {
      const ids = [...new Set(reports.filter(r => r.content_type === type).map(r => r.content_id))]
      if (!ids.length) continue
      const { data } = await supabase
        .from(CONTENT_TABLE[type])
        .select(`id, ${TEXT_COL[type]}, ${AUTHOR_COL[type]}, hidden_at, hidden_reason`)
        .in('id', ids)
      for (const row of data ?? []) contentByKey.set(`${type}:${row.id}`, row)
    }

    const byKey = new Map()
    for (const r of reports) {
      const key = `${r.content_type}:${r.content_id}`
      if (!byKey.has(key)) {
        byKey.set(key, {
          key, contentType: r.content_type, contentId: r.content_id,
          content: contentByKey.get(key) ?? null,
          reports: [],
        })
      }
      byKey.get(key).reports.push({ ...r, reporterName: nameById.get(r.reporter_id) ?? 'Unknown' })
    }
    setGroups([...byKey.values()])
  }, [])

  useEffect(() => { load() }, [load])

  async function resolveReports(g, status) {
    await supabase.from('content_reports')
      .update({ status, resolved_at: new Date().toISOString(), resolved_by: session.user.id })
      .eq('content_type', g.contentType).eq('content_id', g.contentId).eq('status', 'pending')
  }

  async function notifyAuthor(g, title, body) {
    const authorId = g.content?.[AUTHOR_COL[g.contentType]]
    if (!authorId) return
    const { data: p } = await supabase.from('profiles').select('push_token').eq('id', authorId).maybeSingle()
    if (p?.push_token) await sendPushNotification(p.push_token, title, body)
    await recordNotification(authorId, title, body)
  }

  async function removeContent(g) {
    setBusy(g.key)
    await supabase.from(CONTENT_TABLE[g.contentType])
      .update({ hidden_at: new Date().toISOString(), hidden_reason: 'admin_removed' })
      .eq('id', g.contentId)
    await resolveReports(g, 'actioned')
    await notifyAuthor(g, 'Content removed', `Your ${g.contentType} was removed for violating ADA's content policy.`)
    setBusy(null); load()
  }

  async function restoreContent(g) {
    setBusy(g.key)
    await supabase.from(CONTENT_TABLE[g.contentType])
      .update({ hidden_at: null, hidden_reason: null })
      .eq('id', g.contentId)
    await resolveReports(g, 'dismissed')
    setBusy(null); load()
  }

  async function dismiss(g) {
    setBusy(g.key)
    await resolveReports(g, 'dismissed')
    setBusy(null); load()
  }

  // Banning also removes the content — the content is why they are being banned,
  // and leaving it visible while clearing the queue would defeat the 24h promise.
  async function applyBan(g, authorId, days) {
    setBusy(g.key)
    const until = days ? new Date(Date.now() + days * 86400000) : new Date('2999-01-01')
    await supabase.from('profiles').update({ ugc_banned_until: until.toISOString() }).eq('id', authorId)
    await supabase.from(CONTENT_TABLE[g.contentType])
      .update({ hidden_at: new Date().toISOString(), hidden_reason: 'admin_removed' })
      .eq('id', g.contentId)
    await resolveReports(g, 'actioned')
    await notifyAuthor(
      g,
      'Posting suspended',
      days
        ? `Your ${g.contentType} was removed and you cannot post reviews or questions for ${days} days.`
        : `Your ${g.contentType} was removed and you can no longer post reviews or questions.`,
    )
    setBusy(null); load()
  }

  function confirmBan(g) {
    const authorId = g.content?.[AUTHOR_COL[g.contentType]]
    if (!authorId) { Alert.alert('Cannot ban', 'This content no longer exists, so its author cannot be identified.'); return }
    Alert.alert(
      'Remove content & ban author',
      'Removes this content and blocks the author from posting reviews and questions. Their bookings are not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: '7 days',  onPress: () => applyBan(g, authorId, 7) },
        { text: '30 days', onPress: () => applyBan(g, authorId, 30) },
        { text: 'Permanent', style: 'destructive', onPress: () => applyBan(g, authorId, null) },
      ],
    )
  }

  if (!groups) return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
  if (!groups.length) return <SectionEmpty text="No pending reports. Nothing to moderate." />

  return (
    <ScrollView contentContainerStyle={s.tabContent} showsVerticalScrollIndicator={false}>
      <Text style={s.sectionTitle}>{groups.length} item{groups.length !== 1 ? 's' : ''} awaiting review · oldest first</Text>

      {groups.map(g => {
        const oldest      = g.reports[0]
        const missing     = !g.content
        const hidden      = !!g.content?.hidden_at
        const autoHidden  = g.content?.hidden_reason === 'auto_reports'
        const text        = g.content?.[TEXT_COL[g.contentType]]
        const reasonCount = g.reports.reduce((acc, r) => ({ ...acc, [r.reason]: (acc[r.reason] ?? 0) + 1 }), {})
        const isBusy      = busy === g.key

        return (
          <View key={g.key} style={s.card}>
            <View style={s.reportHead}>
              <View style={s.reportBadge}>
                <Text style={s.reportBadgeText}>{g.contentType.toUpperCase()}</Text>
              </View>
              {hidden && (
                <View style={[s.reportBadge, { backgroundColor: colors.dangerLight }]}>
                  <Text style={[s.reportBadgeText, { color: colors.danger }]}>
                    {autoHidden ? 'AUTO-HIDDEN' : 'HIDDEN'}
                  </Text>
                </View>
              )}
              <View style={{ flex: 1 }} />
              <Text style={s.cardSub}>{timeAgo(oldest.created_at)}</Text>
            </View>

            {missing
              ? <Text style={s.reportMissing}>Content no longer exists — the author likely deleted their account. Dismiss to clear.</Text>
              : <Text style={s.reportBody}>{text || <Text style={s.reportMissing}>(rating only, no text)</Text>}</Text>}

            <Text style={s.reportMeta}>
              {g.reports.length} report{g.reports.length !== 1 ? 's' : ''} ·{' '}
              {Object.entries(reasonCount).map(([k, n]) => `${REASON_LABELS[k] ?? k}${n > 1 ? ` ×${n}` : ''}`).join(', ')}
            </Text>

            {g.reports.filter(r => r.details).map(r => (
              <Text key={r.id} style={s.reportDetail}>“{r.details}” — {r.reporterName}</Text>
            ))}

            <View style={s.reportActions}>
              {isBusy ? (
                <ActivityIndicator color={colors.primary} style={{ paddingVertical: 7 }} />
              ) : (
                <>
                  {!missing && (hidden
                    ? <TouchableOpacity style={s.ghostBtn} onPress={() => restoreContent(g)}>
                        <Text style={s.ghostBtnText}>Restore</Text>
                      </TouchableOpacity>
                    : <TouchableOpacity style={s.dangerGhostBtn} onPress={() => removeContent(g)}>
                        <Text style={s.dangerGhostText}>Remove</Text>
                      </TouchableOpacity>
                  )}
                  {!missing && (
                    <TouchableOpacity style={s.dangerGhostBtn} onPress={() => confirmBan(g)}>
                      <Text style={s.dangerGhostText}>Ban author</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={s.ghostBtn} onPress={() => dismiss(g)}>
                    <Text style={s.ghostBtnText}>Dismiss</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        )
      })}
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
                <TextInput style={s.input} value={form.latitude} onChangeText={set('latitude')} keyboardType="decimal-pad" placeholder="e.g. 35.1856" placeholderTextColor={colors.textSecondary} />
              </Field>
              <Field label="Longitude">
                <TextInput style={s.input} value={form.longitude} onChangeText={set('longitude')} keyboardType="decimal-pad" placeholder="e.g. 33.3823" placeholderTextColor={colors.textSecondary} />
              </Field>
              <Field label="Opening hours">
                <TextInput style={s.input} value={form.opening_hours} onChangeText={set('opening_hours')} placeholder="Mon-Fri 08:00-18:00 or 24/7" placeholderTextColor={colors.textSecondary} />
              </Field>
              <Field label="Languages (comma-separated)">
                <TextInput style={s.input} value={form.languages} onChangeText={set('languages')} placeholder="English, Turkish" placeholderTextColor={colors.textSecondary} />
              </Field>
              <Field label="Provider ID (UUID)">
                <TextInput style={s.input} value={form.provider_id} onChangeText={set('provider_id')} autoCapitalize="none" placeholder="Leave blank if none" placeholderTextColor={colors.textSecondary} />
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
    const { data: customers } = await supabase.from('profiles').select('id, push_token, preferred_language').eq('role', 'customer')
    for (const c of customers ?? []) {
      const lang = c.preferred_language || 'English'
      const title = t('notifDutyTitle', lang)
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
      const { data: customers } = await supabase.from('profiles').select('id, push_token, preferred_language').eq('role', 'customer')
      for (const c of customers ?? []) {
        const lang = c.preferred_language || 'English'
        const title = t('notifDutySwapTitle', lang)
        const body = t('notifDutySwapBody', lang).replace('{name}', swapSelectedPharmacy.name).replace('{date}', swapDate)
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
          placeholderTextColor={colors.textSecondary}
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
                placeholderTextColor={colors.textSecondary}
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
                    placeholderTextColor={colors.textSecondary}
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

function ClaimsTab({ session }) {
  const [claims, setClaims] = useState([])
  const [loading, setLoading] = useState(true)
  const [rejectTarget, setRejectTarget] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('claim_requests')
      .select('id, requester_id, requested_tier, created_at, registration_number, tax_registration_no, facilities(id, name, type, address, phone)')
      .eq('status', 'pending')
      .order('created_at')
    const rows = data ?? []
    const providerIds = [...new Set(rows.map(r => r.requester_id).filter(Boolean))]
    const facilityIds = [...new Set(rows.map(r => r.facilities?.id).filter(Boolean))]

    const [{ data: profilesData }, { data: docsData }] = await Promise.all([
      providerIds.length ? supabase.from('profiles').select('id, full_name').in('id', providerIds) : { data: [] },
      facilityIds.length ? supabase.from('provider_documents').select('id, facility_id, doc_type, document_url, status').in('facility_id', facilityIds) : { data: [] },
    ])

    const pm  = Object.fromEntries((profilesData ?? []).map(p => [p.id, p]))
    const dm  = (docsData ?? []).reduce((acc, d) => {
      if (!acc[d.facility_id]) acc[d.facility_id] = []
      acc[d.facility_id].push(d)
      return acc
    }, {})
    setClaims(rows.map(r => ({ ...r, _profile: pm[r.requester_id], _docs: dm[r.facilities?.id] ?? [] })))
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
    await Promise.all([
      supabase.from('claim_requests').update({
        status:            'approved',
        business_verified: true,
        verified_by:       session.user.id,
        verified_at:       new Date().toISOString(),
      }).eq('id', claim.id),
      supabase.from('provider_documents').update({ status: 'approved' }).eq('facility_id', claim.facilities.id),
    ])
    const { data: p } = await supabase.from('profiles').select('push_token, preferred_language').eq('id', claim.requester_id).maybeSingle()
    const lang = p?.preferred_language || 'English'
    const facilityName = claim.facilities?.name ?? 'Your facility'
    const title = t('notifClaimApprovedTitle', lang)
    const body = t('notifClaimApprovedBody', lang).replace('{name}', facilityName)
    if (p?.push_token) await sendPushNotification(p.push_token, title, body)
    await recordNotification(claim.requester_id, title, body)
    load()
  }

  async function reject(claim, reason) {
    await supabase.from('claim_requests').update({ status: 'rejected', rejection_reason: reason || null }).eq('id', claim.id)
    const { data: p } = await supabase.from('profiles').select('push_token, preferred_language').eq('id', claim.requester_id).maybeSingle()
    const lang = p?.preferred_language || 'English'
    const facilityName = claim.facilities?.name ?? 'the facility'
    const title = t('notifClaimRejectedTitle', lang)
    const body = reason
      ? t('notifClaimRejectedBodyReason', lang).replace('{name}', facilityName).replace('{reason}', reason)
      : t('notifClaimRejectedBody', lang).replace('{name}', facilityName)
    if (p?.push_token) await sendPushNotification(p.push_token, title, body)
    await recordNotification(claim.requester_id, title, body)
    load()
  }

  const DOC_LABELS = { medical_license: 'Medical License', registration_cert: 'Registration Cert', business_license: 'Business License', national_id: 'National ID' }

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

            {/* Business identity — what the admin cross-checks before approving. */}
            <View style={s.claimIdentity}>
              <Text style={s.claimIdentityLabel}>BUSINESS IDENTITY — VERIFY BEFORE APPROVING</Text>
              <View style={s.claimDetailRow}>
                <Text style={s.claimDetailKey}>Tax Registration No.</Text>
                <Text style={[s.claimDetailVal, s.claimDetailKey_tax]} selectable>{c.tax_registration_no || '—'}</Text>
              </View>
              <View style={s.claimDetailRow}>
                <Text style={s.claimDetailKey}>Registration No.</Text>
                <Text style={s.claimDetailVal} selectable>{c.registration_number || '—'}</Text>
              </View>
              {c.facilities?.address ? (
                <View style={s.claimDetailRow}>
                  <Text style={s.claimDetailKey}>Address</Text>
                  <Text style={s.claimDetailVal} numberOfLines={2}>{c.facilities.address}</Text>
                </View>
              ) : null}
              {c.facilities?.phone ? (
                <View style={s.claimDetailRow}>
                  <Text style={s.claimDetailKey}>Phone</Text>
                  <Text style={s.claimDetailVal} selectable>{c.facilities.phone}</Text>
                </View>
              ) : null}
            </View>

            <Text style={[s.cardSub, { fontSize: 10, marginTop: 6 }]}>
              {new Date(c.created_at).toLocaleDateString()}
            </Text>

            {c._docs.length > 0 && (
              <View style={s.docsSection}>
                <Text style={s.docsSectionLabel}>ID DOCUMENTS ({c._docs.length})</Text>
                {c._docs.map(doc => (
                  <TouchableOpacity key={doc.id} style={s.docRow} onPress={() => Linking.openURL(doc.document_url)}>
                    <Feather name="file-text" size={13} color={colors.primary} />
                    <Text style={s.docRowText}>{DOC_LABELS[doc.doc_type] ?? doc.doc_type}</Text>
                    <Feather name="external-link" size={12} color={colors.primary} />
                  </TouchableOpacity>
                ))}
              </View>
            )}

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
              <TouchableOpacity style={s.dangerGhostBtn} onPress={() => setRejectTarget(c)}>
                <Text style={s.dangerGhostText}>Reject</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))
      }
      <RejectModal
        visible={!!rejectTarget}
        entityName={rejectTarget?.facilities?.name}
        onConfirm={reason => { reject(rejectTarget, reason); setRejectTarget(null) }}
        onCancel={() => setRejectTarget(null)}
      />
    </ScrollView>
  )
}

// ─── Providers Tab ──────────────────────────────────────────────────────────

function ProvidersTab() {
  const [pending,      setPending]      = useState([])
  const [active,       setActive]       = useState([])
  const [loading,      setLoading]      = useState(true)
  const [rejectTarget, setRejectTarget] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('facilities')
      .select('id, name, type, status, membership_tier, trial_ends_at, verified, provider_id, registration_number')
      .not('provider_id', 'is', null)
      .order('name')
    const rows = data ?? []
    const ids        = [...new Set(rows.map(r => r.provider_id).filter(Boolean))]
    const facilityIds = [...new Set(rows.map(r => r.id).filter(Boolean))]

    const [{ data: profilesData }, { data: docsData }] = await Promise.all([
      ids.length        ? supabase.from('profiles').select('id, full_name').in('id', ids) : { data: [] },
      facilityIds.length ? supabase.from('provider_documents').select('id, facility_id, doc_type, document_url').in('facility_id', facilityIds) : { data: [] },
    ])

    const pm = Object.fromEntries((profilesData ?? []).map(p => [p.id, p]))
    const dm = (docsData ?? []).reduce((acc, d) => { if (!acc[d.facility_id]) acc[d.facility_id] = []; acc[d.facility_id].push(d); return acc }, {})
    const enriched = rows.map(r => ({ ...r, _profile: pm[r.provider_id], _docs: dm[r.id] ?? [] }))
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
      const { data: p } = await supabase.from('profiles').select('push_token, preferred_language').eq('id', facility.provider_id).maybeSingle()
      const lang = p?.preferred_language || 'English'
      const title = t('notifAppApprovedTitle', lang)
      const body = t('notifAppApprovedBody', lang).replace('{name}', facility.name)
      if (p?.push_token) await sendPushNotification(p.push_token, title, body)
      await recordNotification(facility.provider_id, title, body)
    }
    load()
  }

  async function reject(facilityId, reason) {
    const facility = [...pending, ...active].find(f => f.id === facilityId)
    await supabase.from('facilities').update({ status: 'suspended' }).eq('id', facilityId)
    if (facility?.provider_id) {
      const { data: p } = await supabase.from('profiles').select('push_token, preferred_language').eq('id', facility.provider_id).maybeSingle()
      const lang = p?.preferred_language || 'English'
      const title = t('notifAppRejectedTitle', lang)
      const body = reason
        ? t('notifAppRejectedBodyReason', lang).replace('{name}', facility.name).replace('{reason}', reason)
        : t('notifAppRejectedBody', lang).replace('{name}', facility.name)
      if (p?.push_token) await sendPushNotification(p.push_token, title, body)
      await recordNotification(facility.provider_id, title, body)
    }
    load()
  }

  async function activate(facilityId) {
    const facility = active.find(f => f.id === facilityId)
    await supabase.from('facilities').update({ status: 'active', trial_ends_at: null }).eq('id', facilityId)
    if (facility?.provider_id) {
      const { data: p } = await supabase.from('profiles').select('push_token, preferred_language').eq('id', facility.provider_id).maybeSingle()
      const lang = p?.preferred_language || 'English'
      const title = t('notifActivatedTitle', lang)
      const body = t('notifActivatedBody', lang).replace('{name}', facility.name)
      if (p?.push_token) await sendPushNotification(p.push_token, title, body)
      await recordNotification(facility.provider_id, title, body)
    }
    load()
  }

  async function suspend(facilityId) {
    const facility = active.find(f => f.id === facilityId)
    await supabase.from('facilities').update({ status: 'suspended' }).eq('id', facilityId)
    if (facility?.provider_id) {
      const { data: p } = await supabase.from('profiles').select('push_token, preferred_language').eq('id', facility.provider_id).maybeSingle()
      const lang = p?.preferred_language || 'English'
      const title = t('notifSuspendedTitle', lang)
      const body = t('notifSuspendedBody', lang).replace('{name}', facility.name)
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

            {f._docs.length > 0 && (
              <View style={s.docsSection}>
                <Text style={s.docsSectionLabel}>ID DOCUMENTS ({f._docs.length})</Text>
                {f._docs.map(doc => (
                  <TouchableOpacity key={doc.id} style={s.docRow} onPress={() => Linking.openURL(doc.document_url)}>
                    <Feather name="file-text" size={13} color={colors.primary} />
                    <Text style={s.docRowText}>{{ medical_license: 'Medical License', registration_cert: 'Registration Cert', business_license: 'Business License', national_id: 'National ID' }[doc.doc_type] ?? doc.doc_type}</Text>
                    <Feather name="external-link" size={12} color={colors.primary} />
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <View style={[s.cardRow, { marginTop: 10, gap: 8 }]}>
              <TouchableOpacity style={[s.ghostBtn, { backgroundColor: colors.successLight, flex: 1 }]} onPress={() => approve(f.id)}>
                <Text style={[s.ghostBtnText, { color: colors.success }]}>Approve (5-day trial)</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.dangerGhostBtn} onPress={() => setRejectTarget(f)}>
                <Text style={s.dangerGhostText}>Reject</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))
      }

      <RejectModal
        visible={!!rejectTarget}
        entityName={rejectTarget?.name}
        onConfirm={reason => { reject(rejectTarget.id, reason); setRejectTarget(null) }}
        onCancel={() => setRejectTarget(null)}
      />

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
  const [rejectTarget, setRejectTarget] = useState(null)

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
    const changes = { ...req.proposed_changes }
    if (typeof changes.languages === 'string') {
      changes.languages = changes.languages.split(',').map(l => l.trim()).filter(Boolean)
    }
    const { error } = await supabase
      .from('facilities')
      .update(changes)
      .eq('id', req.facility_id)
    if (error) {
      setActionLoading(null)
      Alert.alert('Approval failed', error.message)
      return
    }
    await supabase.from('facility_change_requests').update({ status: 'approved' }).eq('id', req.id)
    const { data: p } = await supabase.from('profiles').select('push_token').eq('id', req.provider_id).maybeSingle()
    const title = 'Changes approved'
    const body = `Your updates to ${req.facilities?.name ?? 'your facility'} are now live.`
    if (p?.push_token) await sendPushNotification(p.push_token, title, body)
    await recordNotification(req.provider_id, title, body)
    load()
    setActionLoading(null)
  }

  async function reject(req, reason) {
    setActionLoading(req.id)
    await supabase.from('facility_change_requests').update({ status: 'rejected', rejection_reason: reason || null }).eq('id', req.id)
    const { data: p } = await supabase.from('profiles').select('push_token').eq('id', req.provider_id).maybeSingle()
    const title = 'Changes not approved'
    const body = reason
      ? `Your updates to ${req.facilities?.name ?? 'your facility'} were not approved: ${reason}`
      : `Your updates to ${req.facilities?.name ?? 'your facility'} were not approved. Contact us for details.`
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
                  onPress={() => setRejectTarget(req)}
                  disabled={isLoading}
                >
                  <Text style={s.dangerGhostText}>Reject</Text>
                </TouchableOpacity>
              </View>
            </View>
          )
        })
      }
      <RejectModal
        visible={!!rejectTarget}
        entityName={rejectTarget?.facilities?.name}
        onConfirm={reason => { reject(rejectTarget, reason); setRejectTarget(null) }}
        onCancel={() => setRejectTarget(null)}
      />
    </ScrollView>
  )
}

// ─── Credentials Tab ─────────────────────────────────────────────────────────

const CRED_LABELS = { diploma: '🎓 Diploma', certificate: '📜 Certificate' }
const DOC_TYPE_LABELS = { medical_license: 'Medical License', registration_cert: 'Registration Cert', business_license: 'Business License', national_id: 'National ID' }

function CredentialsTab() {
  const [credentials, setCredentials]   = useState([])
  const [loading, setLoading]           = useState(true)
  const [actionLoading, setActionLoading] = useState(null)
  const [rejectTarget, setRejectTarget] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('provider_credentials')
      .select('id, facility_id, provider_id, cred_type, title, institution, year, document_url, created_at, facilities(name, type)')
      .eq('status', 'pending')
      .order('created_at')
    const rows = data ?? []
    const ids = [...new Set(rows.map(r => r.provider_id).filter(Boolean))]
    const { data: profilesData } = ids.length
      ? await supabase.from('profiles').select('id, full_name').in('id', ids)
      : { data: [] }
    const pm = Object.fromEntries((profilesData ?? []).map(p => [p.id, p]))
    setCredentials(rows.map(r => ({ ...r, _provider: pm[r.provider_id] })))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function approve(cred) {
    setActionLoading(cred.id)
    await supabase.from('provider_credentials').update({ status: 'approved' }).eq('id', cred.id)
    const { data: p } = await supabase.from('profiles').select('push_token').eq('id', cred.provider_id).maybeSingle()
    const title = 'Credential approved'
    const body = `Your ${cred.cred_type} "${cred.title}" is now visible on your profile.`
    if (p?.push_token) await sendPushNotification(p.push_token, title, body)
    await recordNotification(cred.provider_id, title, body)
    setActionLoading(null)
    load()
  }

  async function reject(cred, reason) {
    setActionLoading(cred.id)
    await supabase.from('provider_credentials').update({ status: 'rejected', rejection_reason: reason || null }).eq('id', cred.id)
    const { data: p } = await supabase.from('profiles').select('push_token').eq('id', cred.provider_id).maybeSingle()
    const title = 'Credential not approved'
    const body = reason
      ? `Your ${cred.cred_type} "${cred.title}" was not approved: ${reason}`
      : `Your ${cred.cred_type} "${cred.title}" was not approved. Contact us for details.`
    if (p?.push_token) await sendPushNotification(p.push_token, title, body)
    await recordNotification(cred.provider_id, title, body)
    setActionLoading(null)
    load()
  }

  if (loading) return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>

  return (
    <ScrollView contentContainerStyle={s.listContent} showsVerticalScrollIndicator={false}>
      <Text style={s.sectionTitle}>Pending credentials ({credentials.length})</Text>
      {credentials.length === 0
        ? <SectionEmpty text="No pending credentials." />
        : credentials.map(cred => {
          const isLoading = actionLoading === cred.id
          return (
            <View key={cred.id} style={s.card}>
              <View style={[s.cardRow, { justifyContent: 'space-between', marginBottom: 2 }]}>
                <Text style={s.cardTitle} numberOfLines={1}>{CRED_LABELS[cred.cred_type] ?? cred.cred_type} — {cred.title}</Text>
              </View>
              <Text style={s.cardSub}>{cred.institution}{cred.year ? ` · ${cred.year}` : ''}</Text>
              <Text style={[s.cardSub, { marginTop: 2 }]}>{TYPE_ICONS[cred.facilities?.type] ?? '🏥'} {cred.facilities?.name ?? '—'}</Text>
              <Text style={[s.cardSub, { marginTop: 2 }]}>Provider: {cred._provider?.full_name ?? cred.provider_id?.slice(0, 8)}</Text>
              <Text style={[s.cardSub, { fontSize: 10, marginTop: 2 }]}>{new Date(cred.created_at).toLocaleDateString()}</Text>

              {cred.document_url ? (
                <TouchableOpacity style={[s.docRow, { marginTop: 8 }]} onPress={() => Linking.openURL(cred.document_url)}>
                  <Feather name="file-text" size={13} color={colors.primary} />
                  <Text style={s.docRowText}>View document</Text>
                  <Feather name="external-link" size={12} color={colors.primary} />
                </TouchableOpacity>
              ) : null}

              <View style={[s.cardRow, { marginTop: 12, gap: 8 }]}>
                <TouchableOpacity
                  style={[s.ghostBtn, { backgroundColor: colors.successLight, flex: 1 }, isLoading && { opacity: 0.5 }]}
                  onPress={() => approve(cred)}
                  disabled={isLoading}
                >
                  {isLoading
                    ? <ActivityIndicator size="small" color={colors.success} />
                    : <Text style={[s.ghostBtnText, { color: colors.success }]}>Approve</Text>
                  }
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.dangerGhostBtn, isLoading && { opacity: 0.5 }]}
                  onPress={() => setRejectTarget(cred)}
                  disabled={isLoading}
                >
                  <Text style={s.dangerGhostText}>Reject</Text>
                </TouchableOpacity>
              </View>
            </View>
          )
        })
      }
      <RejectModal
        visible={!!rejectTarget}
        entityName={rejectTarget?.title}
        onConfirm={reason => { reject(rejectTarget, reason); setRejectTarget(null) }}
        onCancel={() => setRejectTarget(null)}
      />
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

    const trimmedTitle = title.trim()
    const b = body.trim()
    const recipients = profiles ?? []

    // DB inserts: the insert_notification RPC is one-row-per-call, so we can't do
    // a single multi-row insert without a new RPC. Fire them in parallel chunks
    // of 25 instead of awaiting each serially. recordNotification swallows its
    // own errors, so one failure won't abort the batch.
    for (let i = 0; i < recipients.length; i += 25) {
      await Promise.all(
        recipients.slice(i, i + 25).map(p => recordNotification(p.id, trimmedTitle, b))
      )
    }

    // Pushes: one array-payload fetch per 100 tokens (Expo's per-request cap).
    const tokens = recipients.filter(p => p.push_token).map(p => p.push_token)
    await sendPushBatch(tokens, trimmedTitle, b)

    setResult({ total: recipients.length, pushCount: tokens.length })
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
          placeholderTextColor={colors.textSecondary}
          maxLength={100}
        />
      </Field>

      <Field label="Message">
        <TextInput
          style={[s.input, { minHeight: 90, textAlignVertical: 'top' }]}
          value={body}
          onChangeText={v => { setBody(v); setResult(null) }}
          placeholder="Enter your message…"
          placeholderTextColor={colors.textSecondary}
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

// ─── Events Tab ─────────────────────────────────────────────────────────────

function eventStatusColor(status) {
  if (status === 'approved') return colors.success
  if (status === 'rejected') return colors.danger
  if (status === 'pending')  return '#C2410C'
  return colors.textSecondary
}

function EventDetailModal({ event, visible, onClose, onApprove, onReject, onDelete }) {
  if (!event) return null

  const fmt = (iso, withTime) => iso
    ? new Date(iso).toLocaleString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric',
        ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
      })
    : '—'

  const images = event.images || []

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={s.modalHeader}>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="chevron-down" size={24} color={colors.textSecondary} />
          </TouchableOpacity>
          <Text style={s.modalTitle} numberOfLines={1}>Event review</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={s.modalBody} showsVerticalScrollIndicator={false}>
          <View style={[s.pillGrey, { backgroundColor: eventStatusColor(event.status) + '20', marginBottom: 14 }]}>
            <Text style={[s.pillText, { color: eventStatusColor(event.status) }]}>{event.status}</Text>
          </View>

          <Text style={[s.cardTitle, { fontSize: 20, marginBottom: 18 }]}>{event.title}</Text>

          <Text style={s.sectionTitle}>Photos ({images.length})</Text>
          {images.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
              {images.map((uri, i) => (
                <TouchableOpacity key={i} activeOpacity={0.9} onPress={() => Linking.openURL(uri)}>
                  <Image
                    source={{ uri }}
                    style={{ width: 220, height: 150, borderRadius: 12, marginRight: 10, backgroundColor: colors.border }}
                    resizeMode="cover"
                  />
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : (
            <Text style={[s.cardSub, { marginBottom: 20 }]}>No images attached.</Text>
          )}

          <Text style={s.sectionTitle}>Organiser</Text>
          <View style={[s.card, { marginBottom: 20 }]}>
            <Text style={s.cardTitle}>{event.organizer_name || '—'}</Text>
            <Text style={s.cardSub}>Account: {event.profiles?.full_name || 'Unknown'}</Text>
            {event.profiles?.phone ? (
              <TouchableOpacity onPress={() => Linking.openURL(`tel:${event.profiles.phone}`)} style={{ marginTop: 6 }}>
                <Text style={[s.cardSub, { color: colors.primary }]}>📞 {event.profiles.phone}</Text>
              </TouchableOpacity>
            ) : null}
            <Text style={[s.cardSub, { marginTop: 6 }]}>Submitted: {fmt(event.created_at, true)}</Text>
          </View>

          <Text style={s.sectionTitle}>When</Text>
          <View style={[s.card, { marginBottom: 20 }]}>
            <Text style={s.cardSub}>Starts: <Text style={{ color: colors.textPrimary }}>{fmt(event.start_date, true)}</Text></Text>
            <Text style={[s.cardSub, { marginTop: 6 }]}>Ends: <Text style={{ color: colors.textPrimary }}>{fmt(event.end_date, true)}</Text></Text>
          </View>

          <Text style={s.sectionTitle}>Where</Text>
          <View style={[s.card, { marginBottom: 20 }]}>
            <Text style={s.cardSub}>{event.location || 'No location given.'}</Text>
            {event.location_url ? (
              <TouchableOpacity onPress={() => Linking.openURL(event.location_url)} style={{ marginTop: 8 }}>
                <Text style={[s.cardSub, { color: colors.primary }]}>🗺️  Open in Maps</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <Text style={s.sectionTitle}>Description</Text>
          <View style={[s.card, { marginBottom: 20 }]}>
            <Text style={[s.cardSub, { lineHeight: 20 }]}>{event.description || '—'}</Text>
          </View>

          {event.status === 'rejected' && event.rejection_reason ? (
            <>
              <Text style={s.sectionTitle}>Rejection reason</Text>
              <View style={[s.card, { marginBottom: 20 }]}>
                <Text style={[s.cardSub, { color: colors.danger }]}>{event.rejection_reason}</Text>
              </View>
            </>
          ) : null}

          <View style={[s.rowActions, { marginLeft: 0, marginTop: 4 }]}>
            {event.status !== 'approved' && (
              <TouchableOpacity style={s.ghostBtn} onPress={() => onApprove(event.id)}>
                <Text style={s.ghostBtnText}>Approve</Text>
              </TouchableOpacity>
            )}
            {event.status !== 'rejected' && (
              <TouchableOpacity style={s.dangerGhostBtn} onPress={() => onReject(event)}>
                <Text style={s.dangerGhostText}>Reject</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={s.dangerGhostBtn} onPress={() => onDelete(event.id)}>
              <Text style={s.dangerGhostText}>Delete</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

function EventsTab() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('pending')
  const [rejectTarget, setRejectTarget] = useState(null)
  const [detailTarget, setDetailTarget] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('events')
      .select('id, title, description, organizer_name, start_date, end_date, location, location_url, images, status, rejection_reason, organizer_id, created_at, profiles(full_name, phone)')
      .order('created_at', { ascending: false })
    if (filter !== 'all') query = query.eq('status', filter)
    const { data } = await query
    setEvents(data ?? [])
    setLoading(false)
  }, [filter])

  useEffect(() => { load() }, [load])

  async function approve(id) {
    await supabase.from('events').update({ status: 'approved', rejection_reason: null }).eq('id', id)
    setDetailTarget(null)
    load()
  }

  async function reject(id, reason) {
    await supabase.from('events').update({ status: 'rejected', rejection_reason: reason || 'Does not meet guidelines.' }).eq('id', id)
    setRejectTarget(null)
    load()
  }

  async function deleteEvent(id) {
    Alert.alert('Delete event?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await supabase.from('events').delete().eq('id', id); setDetailTarget(null); load() } },
    ])
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={[s.chipRow, { marginBottom: 12 }]}>
        {['pending', 'approved', 'rejected', 'all'].map(f => (
          <TouchableOpacity key={f} style={[s.chip, filter === f && s.chipActive]} onPress={() => setFilter(f)}>
            <Text style={[s.chipText, filter === f && s.chipTextActive]}>{f.charAt(0).toUpperCase() + f.slice(1)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading
        ? <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
        : (
          <FlatList
            data={events}
            keyExtractor={e => e.id}
            contentContainerStyle={s.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={<SectionEmpty text={`No ${filter} events.`} />}
            renderItem={({ item }) => (
              <View style={s.card}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => setDetailTarget(item)}
                  style={[s.cardRow, { justifyContent: 'space-between', alignItems: 'flex-start' }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.cardTitle} numberOfLines={2}>{item.title}</Text>
                    <Text style={s.cardSub}>{item.organizer_name || item.profiles?.full_name || 'Unknown organiser'}</Text>
                    {item.start_date && (
                      <Text style={[s.cardSub, { marginTop: 2 }]}>
                        {new Date(item.start_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </Text>
                    )}
                    <Text style={[s.cardSub, { color: colors.primary, marginTop: 4 }]}>Tap to review details ›</Text>
                  </View>
                  <View style={[s.pillGrey, { backgroundColor: eventStatusColor(item.status) + '20', marginLeft: 8 }]}>
                    <Text style={[s.pillText, { color: eventStatusColor(item.status) }]}>{item.status}</Text>
                  </View>
                </TouchableOpacity>

                {item.status === 'rejected' && item.rejection_reason ? (
                  <Text style={[s.cardSub, { color: colors.danger, marginTop: 6 }]}>Reason: {item.rejection_reason}</Text>
                ) : null}

                <View style={[s.rowActions, { marginTop: 10, marginLeft: 0 }]}>
                  {item.status !== 'approved' && (
                    <TouchableOpacity style={s.ghostBtn} onPress={() => approve(item.id)}>
                      <Text style={s.ghostBtnText}>Approve</Text>
                    </TouchableOpacity>
                  )}
                  {item.status !== 'rejected' && (
                    <TouchableOpacity style={s.dangerGhostBtn} onPress={() => setRejectTarget(item)}>
                      <Text style={s.dangerGhostText}>Reject</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={s.dangerGhostBtn} onPress={() => deleteEvent(item.id)}>
                    <Text style={s.dangerGhostText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
        )
      }

      <EventDetailModal
        event={detailTarget}
        visible={!!detailTarget}
        onClose={() => setDetailTarget(null)}
        onApprove={approve}
        onReject={ev => { setDetailTarget(null); setRejectTarget(ev) }}
        onDelete={deleteEvent}
      />

      <RejectModal
        visible={!!rejectTarget}
        entityName={rejectTarget?.title}
        onConfirm={reason => reject(rejectTarget.id, reason)}
        onCancel={() => setRejectTarget(null)}
      />
    </View>
  )
}

// ─── Properties Tab ─────────────────────────────────────────────────────────

function PropertiesTab() {
  const [properties, setProperties] = useState([])
  const [loading, setLoading]       = useState(true)
  const [filter, setFilter]         = useState('pending')
  const [rejectTarget, setRejectTarget] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('properties')
      .select('*, estate_agents(full_name, phone)')
      .eq('status', filter)
      .order('created_at', { ascending: false })
    setProperties(data || [])
    setLoading(false)
  }, [filter])

  useEffect(() => { load() }, [load])

  async function approve(id) {
    await supabase.from('properties').update({ status: 'active', rejection_reason: null }).eq('id', id)
    load()
  }

  async function reject(id, reason) {
    await supabase.from('properties').update({ status: 'rejected', rejection_reason: reason }).eq('id', id)
    setRejectTarget(null)
    load()
  }

  const CURRENCIES = { GBP: '£', TRY: '₺', EUR: '€' }

  return (
    <View style={{ flex: 1 }}>
      <View style={s.chipRow}>
        {['pending', 'active', 'rejected', 'archived'].map(f => (
          <TouchableOpacity key={f} style={[s.chip, filter === f && s.chipActive]} onPress={() => setFilter(f)}>
            <Text style={[s.chipText, filter === f && s.chipTextActive]}>{f.charAt(0).toUpperCase() + f.slice(1)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {loading
        ? <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
        : (
          <FlatList
            data={properties}
            keyExtractor={i => i.id}
            contentContainerStyle={s.listContent}
            ListEmptyComponent={<SectionEmpty text={`No ${filter} listings.`} />}
            renderItem={({ item }) => {
              const sym = CURRENCIES[item.currency] || item.currency
              return (
                <View style={s.card}>
                  <Text style={s.cardTitle} numberOfLines={2}>{item.title}</Text>
                  <Text style={s.cardSub}>{item.property_type} · {item.intent} · {sym}{Number(item.price).toLocaleString()}</Text>
                  <Text style={s.cardSub}>Agent: {item.estate_agents?.full_name || '—'} · {item.district}</Text>
                  {item.rejection_reason && <Text style={[s.cardSub, { color: colors.danger }]}>Reason: {item.rejection_reason}</Text>}
                  {filter === 'pending' && (
                    <View style={s.rowActions}>
                      <TouchableOpacity style={s.ghostBtn} onPress={() => approve(item.id)}>
                        <Text style={s.ghostBtnText}>Approve</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={s.dangerGhostBtn} onPress={() => setRejectTarget(item)}>
                        <Text style={s.dangerGhostText}>Reject</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )
            }}
          />
        )
      }
      <RejectModal
        visible={!!rejectTarget}
        entityName={rejectTarget?.title}
        onConfirm={reason => reject(rejectTarget.id, reason)}
        onCancel={() => setRejectTarget(null)}
      />
    </View>
  )
}

// ─── Agents Tab ──────────────────────────────────────────────────────────────

function AgentsTab() {
  const [agents, setAgents]       = useState([])
  const [agencies, setAgencies]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [view, setView]           = useState('agents')  // 'agents' | 'agencies'
  const [filter, setFilter]       = useState('pending')
  const [rejectTarget, setRejectTarget]       = useState(null)
  const [subscribeTarget, setSubscribeTarget] = useState(null)  // { id, userId, isExtend, name, currentExpiry }

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: ag }, { data: acy }] = await Promise.all([
      supabase.from('estate_agents').select('*, profiles(push_token)').eq('status', filter).order('created_at', { ascending: false }),
      supabase.from('estate_agencies').select('*').eq('status', filter).order('created_at', { ascending: false }),
    ])
    setAgents(ag || [])
    setAgencies(acy || [])
    setLoading(false)
  }, [filter])

  useEffect(() => { load() }, [load])

  async function approveAgentWithSub(id, userId, days) {
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
    await supabase.from('estate_agents').update({ status: 'active', rejection_reason: null, subscription_expires_at: expiresAt }).eq('id', id)
    await supabase.from('profiles').update({ role: 'estate_agent' }).eq('id', userId)
    setSubscribeTarget(null)
    load()
  }

  async function extendSubscription(id, days, currentExpiry) {
    const base = currentExpiry && new Date(currentExpiry) > new Date() ? new Date(currentExpiry) : new Date()
    const expiresAt = new Date(base.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
    await supabase.from('estate_agents').update({ subscription_expires_at: expiresAt }).eq('id', id)
    setSubscribeTarget(null)
    load()
  }

  async function rejectAgent(id, reason) {
    await supabase.from('estate_agents').update({ status: 'rejected', rejection_reason: reason }).eq('id', id)
    setRejectTarget(null)
    load()
  }

  async function approveAgency(id) {
    await supabase.from('estate_agencies').update({ status: 'active', rejection_reason: null }).eq('id', id)
    load()
  }

  async function rejectAgency(id, reason) {
    await supabase.from('estate_agencies').update({ status: 'rejected', rejection_reason: reason }).eq('id', id)
    setRejectTarget(null)
    load()
  }

  return (
    <View style={{ flex: 1 }}>
      {/* View toggle */}
      <View style={[s.chipRow, { marginBottom: 8 }]}>
        <TouchableOpacity style={[s.chip, view === 'agents' && s.chipActive]} onPress={() => setView('agents')}>
          <Text style={[s.chipText, view === 'agents' && s.chipTextActive]}>Agents</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.chip, view === 'agencies' && s.chipActive]} onPress={() => setView('agencies')}>
          <Text style={[s.chipText, view === 'agencies' && s.chipTextActive]}>Agencies</Text>
        </TouchableOpacity>
      </View>
      {/* Status filter */}
      <View style={[s.chipRow, { marginBottom: 12 }]}>
        {['pending', 'active', 'rejected'].map(f => (
          <TouchableOpacity key={f} style={[s.chip, filter === f && s.chipActive]} onPress={() => setFilter(f)}>
            <Text style={[s.chipText, filter === f && s.chipTextActive]}>{f.charAt(0).toUpperCase() + f.slice(1)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading
        ? <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
        : view === 'agents'
          ? (
            <FlatList
              data={agents}
              keyExtractor={i => i.id}
              contentContainerStyle={s.listContent}
              ListEmptyComponent={<SectionEmpty text={`No ${filter} agents.`} />}
              renderItem={({ item }) => {
                const { label: subLabel, color: subColor } = fmtExpiry(item.subscription_expires_at)
                return (
                  <View style={s.card}>
                    <Text style={s.cardTitle}>{item.full_name}</Text>
                    <Text style={s.cardSub}>{item.phone}{item.email ? ` · ${item.email}` : ''}</Text>
                    {item.id_document_url && (
                      <TouchableOpacity onPress={() => Linking.openURL(item.id_document_url)}>
                        <Text style={[s.cardSub, { color: colors.primary }]}>View ID document</Text>
                      </TouchableOpacity>
                    )}
                    {item.rejection_reason && <Text style={[s.cardSub, { color: colors.danger }]}>Reason: {item.rejection_reason}</Text>}
                    {filter === 'active' && (
                      <Text style={[s.cardSub, { color: subColor, marginTop: 2 }]}>{subLabel}</Text>
                    )}
                    <View style={s.rowActions}>
                      {filter === 'pending' && (
                        <TouchableOpacity style={s.ghostBtn} onPress={() => setSubscribeTarget({ id: item.id, userId: item.user_id, isExtend: false, name: item.full_name })}>
                          <Text style={s.ghostBtnText}>Approve</Text>
                        </TouchableOpacity>
                      )}
                      {filter === 'active' && (
                        <TouchableOpacity style={s.ghostBtn} onPress={() => setSubscribeTarget({ id: item.id, userId: item.user_id, isExtend: true, name: item.full_name, currentExpiry: item.subscription_expires_at })}>
                          <Text style={s.ghostBtnText}>Extend</Text>
                        </TouchableOpacity>
                      )}
                      {filter === 'pending' && (
                        <TouchableOpacity style={s.dangerGhostBtn} onPress={() => setRejectTarget({ ...item, _type: 'agent' })}>
                          <Text style={s.dangerGhostText}>Reject</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                )
              }}
            />
          )
          : (
            <FlatList
              data={agencies}
              keyExtractor={i => i.id}
              contentContainerStyle={s.listContent}
              ListEmptyComponent={<SectionEmpty text={`No ${filter} agencies.`} />}
              renderItem={({ item }) => (
                <View style={s.card}>
                  <Text style={s.cardTitle}>{item.name}</Text>
                  <Text style={s.cardSub}>{item.address}</Text>
                  <Text style={s.cardSub}>{item.phone}{item.email ? ` · ${item.email}` : ''}</Text>
                  {item.rejection_reason && <Text style={[s.cardSub, { color: colors.danger }]}>Reason: {item.rejection_reason}</Text>}
                  {filter === 'pending' && (
                    <View style={s.rowActions}>
                      <TouchableOpacity style={s.ghostBtn} onPress={() => approveAgency(item.id)}>
                        <Text style={s.ghostBtnText}>Approve</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={s.dangerGhostBtn} onPress={() => setRejectTarget({ ...item, _type: 'agency' })}>
                        <Text style={s.dangerGhostText}>Reject</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )}
            />
          )
      }
      <RejectModal
        visible={!!rejectTarget}
        entityName={rejectTarget?.full_name || rejectTarget?.name}
        onConfirm={reason => rejectTarget?._type === 'agency'
          ? rejectAgency(rejectTarget.id, reason)
          : rejectAgent(rejectTarget.id, reason)
        }
        onCancel={() => setRejectTarget(null)}
      />
      <SubscribeModal
        visible={!!subscribeTarget}
        agentName={subscribeTarget?.name}
        isExtend={subscribeTarget?.isExtend}
        onConfirm={days => subscribeTarget?.isExtend
          ? extendSubscription(subscribeTarget.id, days, subscribeTarget.currentExpiry)
          : approveAgentWithSub(subscribeTarget.id, subscribeTarget.userId, days)
        }
        onCancel={() => setSubscribeTarget(null)}
      />
    </View>
  )
}

// ─── Home Services Tab ────────────────────────────────────────────────────────

function HomeServicesTab() {
  const [providers, setProviders]           = useState([])
  const [loading, setLoading]               = useState(true)
  const [filter, setFilter]                 = useState('pending')
  const [rejectTarget, setRejectTarget]     = useState(null)

  const SERVICE_LABELS = {
    plumber: 'Plumber', electrician: 'Electrician', carpenter: 'Carpenter',
    painter: 'Painter', sewer: 'Sewer/Drain', ac_tech: 'AC Tech',
    locksmith: 'Locksmith', tiler: 'Tiler', handyman: 'Handyman',
  }

  const load = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('home_services')
      .select('id, name, phone, whatsapp, contact_pref, district, service_types, status, rejection_reason, owner_id, verified')
      .order('created_at', { ascending: false })
    if (filter !== 'all') query = query.eq('status', filter)
    const { data } = await query
    setProviders(data ?? [])
    setLoading(false)
  }, [filter])

  useEffect(() => { load() }, [load])

  async function approve(item) {
    await supabase.from('home_services').update({ status: 'active', rejection_reason: null }).eq('id', item.id)
    if (item.owner_id) {
      await supabase.from('profiles').update({ role: 'home_service_provider' }).eq('id', item.owner_id)
    }
    load()
  }

  async function reject(id, reason) {
    await supabase.from('home_services').update({ status: 'rejected', rejection_reason: reason || 'Does not meet our guidelines.' }).eq('id', id)
    setRejectTarget(null)
    load()
  }

  async function deleteProvider(id) {
    Alert.alert('Delete listing?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await supabase.from('home_services').delete().eq('id', id); load() } },
    ])
  }

  function statusColor(status) {
    if (status === 'active')   return colors.success
    if (status === 'rejected') return colors.danger
    if (status === 'pending')  return '#C2410C'
    return colors.textSecondary
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={[s.chipRow, { marginBottom: 12 }]}>
        {['pending', 'active', 'rejected', 'all'].map(f => (
          <TouchableOpacity key={f} style={[s.chip, filter === f && s.chipActive]} onPress={() => setFilter(f)}>
            <Text style={[s.chipText, filter === f && s.chipTextActive]}>{f.charAt(0).toUpperCase() + f.slice(1)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading
        ? <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
        : (
          <FlatList
            data={providers}
            keyExtractor={p => p.id}
            contentContainerStyle={s.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={<SectionEmpty text={`No ${filter} home service providers.`} />}
            renderItem={({ item }) => (
              <View style={s.card}>
                <View style={[s.cardRow, { justifyContent: 'space-between', alignItems: 'flex-start' }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.cardTitle} numberOfLines={1}>{item.name}</Text>
                    <Text style={s.cardSub}>{item.district} · {item.phone}</Text>
                    {item.service_types?.length > 0 && (
                      <Text style={s.cardSub}>{item.service_types.map(k => SERVICE_LABELS[k] || k).join(', ')}</Text>
                    )}
                    {item.owner_id
                      ? <Text style={[s.cardSub, { color: colors.textSecondary }]}>Self-registered</Text>
                      : <Text style={[s.cardSub, { color: colors.textSecondary }]}>Admin-seeded</Text>
                    }
                  </View>
                  <View style={[s.pillGrey, { backgroundColor: statusColor(item.status) + '20', marginLeft: 8 }]}>
                    <Text style={[s.pillText, { color: statusColor(item.status) }]}>{item.status}</Text>
                  </View>
                </View>

                {item.status === 'rejected' && item.rejection_reason && (
                  <Text style={[s.cardSub, { color: colors.danger, marginTop: 6 }]}>Reason: {item.rejection_reason}</Text>
                )}

                <View style={[s.rowActions, { marginTop: 10, marginLeft: 0 }]}>
                  {item.status !== 'active' && (
                    <TouchableOpacity style={s.ghostBtn} onPress={() => approve(item)}>
                      <Text style={s.ghostBtnText}>Approve</Text>
                    </TouchableOpacity>
                  )}
                  {item.status !== 'rejected' && (
                    <TouchableOpacity style={s.dangerGhostBtn} onPress={() => setRejectTarget(item)}>
                      <Text style={s.dangerGhostText}>Reject</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={s.dangerGhostBtn} onPress={() => deleteProvider(item.id)}>
                    <Text style={s.dangerGhostText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
        )
      }

      <RejectModal
        visible={!!rejectTarget}
        entityName={rejectTarget?.name}
        onConfirm={reason => reject(rejectTarget.id, reason)}
        onCancel={() => setRejectTarget(null)}
      />
    </View>
  )
}

// ─── Insurance Tab ────────────────────────────────────────────────────────────

function InsuranceTab() {
  const [companies, setCompanies]           = useState([])
  const [loading, setLoading]               = useState(true)
  const [filter, setFilter]                 = useState('pending')
  const [rejectTarget, setRejectTarget]     = useState(null)

  const TYPE_LABELS = { health: 'Health', car: 'Car', home: 'Home', travel: 'Travel' }

  const load = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('insurance_companies')
      .select('id, name, phone, whatsapp, email, contact_pref, district, insurance_types, status, rejection_reason, owner_id, verified')
      .order('created_at', { ascending: false })
    if (filter !== 'all') query = query.eq('status', filter)
    const { data } = await query
    setCompanies(data ?? [])
    setLoading(false)
  }, [filter])

  useEffect(() => { load() }, [load])

  async function approve(item) {
    await supabase.from('insurance_companies').update({ status: 'active', rejection_reason: null }).eq('id', item.id)
    if (item.owner_id) {
      await supabase.from('profiles').update({ role: 'insurance_provider' }).eq('id', item.owner_id)
    }
    load()
  }

  async function reject(id, reason) {
    await supabase.from('insurance_companies').update({ status: 'rejected', rejection_reason: reason || 'Does not meet our guidelines.' }).eq('id', id)
    setRejectTarget(null)
    load()
  }

  async function deleteCompany(id) {
    Alert.alert('Delete listing?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await supabase.from('insurance_companies').delete().eq('id', id); load() } },
    ])
  }

  function statusColor(status) {
    if (status === 'active')   return colors.success
    if (status === 'rejected') return colors.danger
    if (status === 'pending')  return '#C2410C'
    return colors.textSecondary
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={[s.chipRow, { marginBottom: 12 }]}>
        {['pending', 'active', 'rejected', 'all'].map(f => (
          <TouchableOpacity key={f} style={[s.chip, filter === f && s.chipActive]} onPress={() => setFilter(f)}>
            <Text style={[s.chipText, filter === f && s.chipTextActive]}>{f.charAt(0).toUpperCase() + f.slice(1)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading
        ? <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
        : (
          <FlatList
            data={companies}
            keyExtractor={p => p.id}
            contentContainerStyle={s.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={<SectionEmpty text={`No ${filter} insurance companies.`} />}
            renderItem={({ item }) => (
              <View style={s.card}>
                <View style={[s.cardRow, { justifyContent: 'space-between', alignItems: 'flex-start' }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.cardTitle} numberOfLines={1}>{item.name}</Text>
                    <Text style={s.cardSub}>{item.district} · {item.phone}</Text>
                    {item.insurance_types?.length > 0 && (
                      <Text style={s.cardSub}>{item.insurance_types.map(k => TYPE_LABELS[k] || k).join(', ')}</Text>
                    )}
                    {item.owner_id
                      ? <Text style={[s.cardSub, { color: colors.textSecondary }]}>Self-registered</Text>
                      : <Text style={[s.cardSub, { color: colors.textSecondary }]}>Admin-seeded</Text>
                    }
                  </View>
                  <View style={[s.pillGrey, { backgroundColor: statusColor(item.status) + '20', marginLeft: 8 }]}>
                    <Text style={[s.pillText, { color: statusColor(item.status) }]}>{item.status}</Text>
                  </View>
                </View>

                {item.status === 'rejected' && item.rejection_reason && (
                  <Text style={[s.cardSub, { color: colors.danger, marginTop: 6 }]}>Reason: {item.rejection_reason}</Text>
                )}

                <View style={[s.rowActions, { marginTop: 10, marginLeft: 0 }]}>
                  {item.status !== 'active' && (
                    <TouchableOpacity style={s.ghostBtn} onPress={() => approve(item)}>
                      <Text style={s.ghostBtnText}>Approve</Text>
                    </TouchableOpacity>
                  )}
                  {item.status !== 'rejected' && (
                    <TouchableOpacity style={s.dangerGhostBtn} onPress={() => setRejectTarget(item)}>
                      <Text style={s.dangerGhostText}>Reject</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={s.dangerGhostBtn} onPress={() => deleteCompany(item.id)}>
                    <Text style={s.dangerGhostText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
        )
      }

      <RejectModal
        visible={!!rejectTarget}
        entityName={rejectTarget?.name}
        onConfirm={reason => reject(rejectTarget.id, reason)}
        onCancel={() => setRejectTarget(null)}
      />
    </View>
  )
}

// ─── Transport Tab ────────────────────────────────────────────────────────────

function TransportTab() {
  const [providers,    setProviders]    = useState([])
  const [loading,      setLoading]      = useState(true)
  const [filter,       setFilter]       = useState('pending')
  const [rejectTarget, setRejectTarget] = useState(null)

  const TYPE_LABELS  = { taxi: 'Taxi', car_rental: 'Car Rental', airport_transfer: 'Airport Transfer' }
  const AIRPORT_LABELS = { ercan: 'Ercan', larnaca: 'Larnaca', both: 'Both' }

  const load = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('transport_providers')
      .select('id, name, phone, type, airport, district, status, rejection_reason, owner_id, verified')
      .order('created_at', { ascending: false })
    if (filter !== 'all') query = query.eq('status', filter)
    const { data } = await query
    setProviders(data ?? [])
    setLoading(false)
  }, [filter])

  useEffect(() => { load() }, [load])

  async function approve(item) {
    await supabase.from('transport_providers').update({ status: 'active', rejection_reason: null }).eq('id', item.id)
    // No role change for transport providers (decision: no provider dashboard in v1)
    load()
  }

  async function reject(id, reason) {
    await supabase.from('transport_providers').update({ status: 'rejected', rejection_reason: reason || 'Does not meet our guidelines.' }).eq('id', id)
    setRejectTarget(null)
    load()
  }

  async function deleteProvider(id) {
    Alert.alert('Delete listing?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await supabase.from('transport_providers').delete().eq('id', id); load() } },
    ])
  }

  function statusColor(status) {
    if (status === 'active')   return colors.success
    if (status === 'rejected') return colors.danger
    if (status === 'pending')  return '#C2410C'
    return colors.textSecondary
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={[s.chipRow, { marginBottom: 12 }]}>
        {['pending', 'active', 'rejected', 'all'].map(f => (
          <TouchableOpacity key={f} style={[s.chip, filter === f && s.chipActive]} onPress={() => setFilter(f)}>
            <Text style={[s.chipText, filter === f && s.chipTextActive]}>{f.charAt(0).toUpperCase() + f.slice(1)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading
        ? <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
        : (
          <FlatList
            data={providers}
            keyExtractor={p => p.id}
            contentContainerStyle={s.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={<SectionEmpty text={`No ${filter} transport providers.`} />}
            renderItem={({ item }) => (
              <View style={s.card}>
                <View style={[s.cardRow, { justifyContent: 'space-between', alignItems: 'flex-start' }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.cardTitle} numberOfLines={1}>{item.name}</Text>
                    <Text style={s.cardSub}>{TYPE_LABELS[item.type] || item.type} · {item.district} · {item.phone}</Text>
                    {item.type === 'airport_transfer' && item.airport && (
                      <Text style={s.cardSub}>Airport: {AIRPORT_LABELS[item.airport] || item.airport}</Text>
                    )}
                    {item.owner_id
                      ? <Text style={[s.cardSub, { color: colors.textSecondary }]}>Self-registered</Text>
                      : <Text style={[s.cardSub, { color: colors.textSecondary }]}>Admin-seeded</Text>
                    }
                  </View>
                  <View style={[s.pillGrey, { backgroundColor: statusColor(item.status) + '20', marginLeft: 8 }]}>
                    <Text style={[s.pillText, { color: statusColor(item.status) }]}>{item.status}</Text>
                  </View>
                </View>

                {item.status === 'rejected' && item.rejection_reason && (
                  <Text style={[s.cardSub, { color: colors.danger, marginTop: 6 }]}>Reason: {item.rejection_reason}</Text>
                )}

                <View style={[s.rowActions, { marginTop: 10, marginLeft: 0 }]}>
                  {item.status !== 'active' && (
                    <TouchableOpacity style={s.ghostBtn} onPress={() => approve(item)}>
                      <Text style={s.ghostBtnText}>Approve</Text>
                    </TouchableOpacity>
                  )}
                  {item.status !== 'rejected' && (
                    <TouchableOpacity style={s.dangerGhostBtn} onPress={() => setRejectTarget(item)}>
                      <Text style={s.dangerGhostText}>Reject</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={s.dangerGhostBtn} onPress={() => deleteProvider(item.id)}>
                    <Text style={s.dangerGhostText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
        )
      }

      <RejectModal
        visible={!!rejectTarget}
        entityName={rejectTarget?.name}
        onConfirm={reason => reject(rejectTarget.id, reason)}
        onCancel={() => setRejectTarget(null)}
      />
    </View>
  )
}

// ─── Bus Routes Tab ───────────────────────────────────────────────────────────

const DISTRICTS_ADMIN = ['nicosia', 'kyrenia', 'famagusta', 'morphou', 'iskele', 'lefke', 'karpaz']
const DISTRICT_LABELS_ADMIN = {
  nicosia: 'Nicosia', kyrenia: 'Kyrenia', famagusta: 'Famagusta',
  morphou: 'Morphou', iskele: 'İskele', lefke: 'Lefke', karpaz: 'Karpaz',
}

function BusRoutesTab() {
  const EMPTY_FORM = { origin_district: null, destination_district: null, terminal: '', frequency: '', fare_note: '', route_note: '' }

  const [routes,      setRoutes]      = useState([])
  const [loading,     setLoading]     = useState(true)
  const [editTarget,  setEditTarget]  = useState(null)   // null=list, {}=new, {id,...}=edit
  const [form,        setForm]        = useState(EMPTY_FORM)
  const [saving,      setSaving]      = useState(false)
  const [formError,   setFormError]   = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('bus_routes').select('*').order('origin_district').order('destination_district')
    setRoutes(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function startNew() {
    setForm(EMPTY_FORM)
    setFormError(null)
    setEditTarget({})
  }

  function startEdit(item) {
    setForm({
      origin_district:      item.origin_district,
      destination_district: item.destination_district,
      terminal:   item.terminal   ?? '',
      frequency:  item.frequency  ?? '',
      fare_note:  item.fare_note  ?? '',
      route_note: item.route_note ?? '',
    })
    setFormError(null)
    setEditTarget(item)
  }

  async function saveRoute() {
    setFormError(null)
    if (!form.origin_district)      { setFormError('Origin district is required.'); return }
    if (!form.destination_district) { setFormError('Destination district is required.'); return }

    setSaving(true)
    const payload = {
      origin_district:      form.origin_district,
      destination_district: form.destination_district,
      terminal:   form.terminal.trim()   || null,
      frequency:  form.frequency.trim()  || null,
      fare_note:  form.fare_note.trim()  || null,
      route_note: form.route_note.trim() || null,
    }

    const { error } = editTarget?.id
      ? await supabase.from('bus_routes').update(payload).eq('id', editTarget.id)
      : await supabase.from('bus_routes').insert(payload)

    setSaving(false)
    if (error) { setFormError(error.message); return }
    setEditTarget(null)
    load()
  }

  async function deleteRoute(id) {
    Alert.alert('Delete route?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await supabase.from('bus_routes').delete().eq('id', id); load() } },
    ])
  }

  // ── Form view ──────────────────────────────────────────────────────────────

  if (editTarget !== null) {
    return (
      <ScrollView contentContainerStyle={s.listContent} keyboardShouldPersistTaps="handled">
        <Text style={[s.cardTitle, { marginBottom: 16 }]}>{editTarget.id ? 'Edit Route' : 'New Route'}</Text>

        <Text style={s.fieldLabel}>Origin district *</Text>
        <View style={[s.chipRow, { marginBottom: 16 }]}>
          {DISTRICTS_ADMIN.map(d => (
            <TouchableOpacity
              key={d}
              style={[s.chip, form.origin_district === d && s.chipActive]}
              onPress={() => setForm(f => ({ ...f, origin_district: d }))}
            >
              <Text style={[s.chipText, form.origin_district === d && s.chipTextActive]}>{DISTRICT_LABELS_ADMIN[d]}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={s.fieldLabel}>Destination district *</Text>
        <View style={[s.chipRow, { marginBottom: 16 }]}>
          {DISTRICTS_ADMIN.map(d => (
            <TouchableOpacity
              key={d}
              style={[s.chip, form.destination_district === d && s.chipActive]}
              onPress={() => setForm(f => ({ ...f, destination_district: d }))}
            >
              <Text style={[s.chipText, form.destination_district === d && s.chipTextActive]}>{DISTRICT_LABELS_ADMIN[d]}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {[
          { key: 'terminal',   label: 'Terminal / Pickup point',     placeholder: 'e.g. Lefkoşa Terminal, Bay 4' },
          { key: 'frequency',  label: 'Frequency',                   placeholder: 'e.g. Every 30 min, 07:00–22:00' },
          { key: 'fare_note',  label: 'Fare note',                   placeholder: 'e.g. ~40 TL' },
          { key: 'route_note', label: 'Notes (via points, context)', placeholder: 'e.g. Also serves Ercan Airport' },
        ].map(field => (
          <View key={field.key} style={{ marginBottom: 16 }}>
            <Text style={s.fieldLabel}>{field.label}</Text>
            <TextInput
              style={[s.rejectInput, { minHeight: 40 }]}
              value={form[field.key]}
              onChangeText={v => setForm(f => ({ ...f, [field.key]: v }))}
              placeholder={field.placeholder}
              placeholderTextColor={colors.textSecondary}
            />
          </View>
        ))}

        {!!formError && <Text style={[s.fieldLabel, { color: colors.danger, marginBottom: 12 }]}>{formError}</Text>}

        <View style={s.rejectBtnRow}>
          <TouchableOpacity style={s.rejectCancelBtn} onPress={() => setEditTarget(null)}>
            <Text style={s.rejectCancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.rejectConfirmBtn, saving && { opacity: 0.6 }]} onPress={saveRoute} disabled={saving}>
            <Text style={s.rejectConfirmText}>{saving ? 'Saving…' : 'Save'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    )
  }

  // ── List view ──────────────────────────────────────────────────────────────

  return (
    <View style={{ flex: 1 }}>
      <TouchableOpacity style={[s.ghostBtn, { alignSelf: 'flex-start', marginBottom: 8 }]} onPress={startNew}>
        <Text style={s.ghostBtnText}>+ Add Route</Text>
      </TouchableOpacity>

      {loading
        ? <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
        : (
          <FlatList
            data={routes}
            keyExtractor={r => r.id}
            contentContainerStyle={s.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={<SectionEmpty text="No bus routes yet." />}
            renderItem={({ item }) => (
              <View style={s.card}>
                <Text style={s.cardTitle}>
                  {DISTRICT_LABELS_ADMIN[item.origin_district]} → {DISTRICT_LABELS_ADMIN[item.destination_district]}
                </Text>
                {!!item.terminal  && <Text style={s.cardSub}>Terminal: {item.terminal}</Text>}
                {!!item.frequency && <Text style={s.cardSub}>Frequency: {item.frequency}</Text>}
                {!!item.fare_note && <Text style={s.cardSub}>Fare: {item.fare_note}</Text>}
                {!!item.route_note && <Text style={s.cardSub}>Note: {item.route_note}</Text>}
                <View style={[s.rowActions, { marginTop: 10, marginLeft: 0 }]}>
                  <TouchableOpacity style={s.ghostBtn} onPress={() => startEdit(item)}>
                    <Text style={s.ghostBtnText}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.dangerGhostBtn} onPress={() => deleteRoute(item.id)}>
                    <Text style={s.dangerGhostText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
        )
      }
    </View>
  )
}

// ─── Places Tab ─────────────────────────────────────────────────────────────

function PlacesTab() {
  const [places,       setPlaces]       = useState([])
  const [loading,      setLoading]      = useState(true)
  const [filter,       setFilter]       = useState('pending')
  const [rejectTarget, setRejectTarget] = useState(null)

  const CATEGORY_LABELS = {
    castle_fortress: 'Castle & Fortress', ancient_ruins: 'Ancient Ruins',
    museum: 'Museum', religious_site: 'Religious Site',
    monument: 'Monument', nature_scenic: 'Nature & Scenic',
  }

  const load = useCallback(async () => {
    setLoading(true)
    const fetchTable = async (table, tag) => {
      let q = supabase.from(table).select('id, name, district, status, rejection_reason, submitted_by, photo_urls, category, access_type, blue_flag').order('created_at', { ascending: false })
      if (filter !== 'all') q = q.eq('status', filter)
      const { data } = await q
      return (data ?? []).map(r => ({ ...r, _type: tag }))
    }
    const [beaches, landmarks] = await Promise.all([
      fetchTable('beaches',   'beach'),
      fetchTable('landmarks', 'landmark'),
    ])
    const n = p => (typeof p.name === 'object' ? (p.name.en ?? p.name.tr ?? '') : (p.name ?? ''))
    setPlaces([...beaches, ...landmarks].sort((a, b) => n(a).localeCompare(n(b))))
    setLoading(false)
  }, [filter])

  useEffect(() => { load() }, [load])

  async function approve(item) {
    const table = item._type === 'beach' ? 'beaches' : 'landmarks'
    await supabase.from(table).update({ status: 'active', rejection_reason: null }).eq('id', item.id)
    load()
  }

  async function reject(item, reason) {
    const table = item._type === 'beach' ? 'beaches' : 'landmarks'
    await supabase.from(table).update({ status: 'rejected', rejection_reason: reason || 'Does not meet our guidelines.' }).eq('id', item.id)
    setRejectTarget(null)
    load()
  }

  async function deletePlace(item) {
    const table = item._type === 'beach' ? 'beaches' : 'landmarks'
    const nameStr = typeof item.name === 'object' ? (item.name.en ?? item.name.tr ?? '') : item.name
    Alert.alert('Delete place?', `"${nameStr}" will be permanently removed.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await supabase.from(table).delete().eq('id', item.id); load() } },
    ])
  }

  function statusColor(status) {
    if (status === 'active')   return colors.success
    if (status === 'rejected') return colors.danger
    if (status === 'pending')  return '#C2410C'
    return colors.textSecondary
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={[s.chipRow, { marginBottom: 12 }]}>
        {['pending', 'active', 'rejected', 'all'].map(f => (
          <TouchableOpacity key={f} style={[s.chip, filter === f && s.chipActive]} onPress={() => setFilter(f)}>
            <Text style={[s.chipText, filter === f && s.chipTextActive]}>{f.charAt(0).toUpperCase() + f.slice(1)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading
        ? <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
        : (
          <FlatList
            data={places}
            keyExtractor={p => `${p._type}-${p.id}`}
            contentContainerStyle={s.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={<SectionEmpty text={`No ${filter} places.`} />}
            renderItem={({ item }) => {
              const isBeach = item._type === 'beach'
              const pc = isBeach ? placeColors.beach : placeColors.landmark
              return (
                <View style={s.card}>
                  <View style={[s.cardRow, { justifyContent: 'space-between', alignItems: 'flex-start' }]}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <View style={[s.pillGrey, { backgroundColor: pc.bg }]}>
                          <Text style={[s.pillText, { color: pc.text }]}>{isBeach ? 'Beach' : 'Landmark'}</Text>
                        </View>
                      </View>
                      <Text style={s.cardTitle} numberOfLines={1}>{(() => { const n = item.name; if (!n) return ''; if (typeof n !== 'object') return String(n); const r = n.en ?? n.tr ?? Object.values(n)[0]; return typeof r === 'object' ? (r.en ?? r.tr ?? '') : String(r ?? '') })()}</Text>
                      <Text style={s.cardSub}>{item.district}{isBeach && item.access_type ? ` · ${item.access_type}` : ''}{!isBeach && item.category ? ` · ${CATEGORY_LABELS[item.category] ?? item.category}` : ''}</Text>
                      <Text style={s.cardSub}>
                        {item.submitted_by ? `User: ${item.submitted_by.slice(0, 8)}…` : 'Admin-seeded'}
                        {item.photo_urls?.length > 0 ? ` · ${item.photo_urls.length} photo${item.photo_urls.length > 1 ? 's' : ''}` : ' · No photos'}
                      </Text>
                    </View>
                    <View style={[s.pillGrey, { backgroundColor: statusColor(item.status) + '20', marginLeft: 8 }]}>
                      <Text style={[s.pillText, { color: statusColor(item.status) }]}>{item.status}</Text>
                    </View>
                  </View>

                  {item.status === 'rejected' && item.rejection_reason && (
                    <Text style={[s.cardSub, { color: colors.danger, marginTop: 6 }]}>Reason: {item.rejection_reason}</Text>
                  )}

                  <View style={[s.rowActions, { marginTop: 10, marginLeft: 0 }]}>
                    {item.status !== 'active' && (
                      <TouchableOpacity style={s.ghostBtn} onPress={() => approve(item)}>
                        <Text style={s.ghostBtnText}>Approve</Text>
                      </TouchableOpacity>
                    )}
                    {item.status !== 'rejected' && (
                      <TouchableOpacity style={s.dangerGhostBtn} onPress={() => setRejectTarget(item)}>
                        <Text style={s.dangerGhostText}>Reject</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity style={s.dangerGhostBtn} onPress={() => deletePlace(item)}>
                      <Text style={s.dangerGhostText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )
            }}
          />
        )
      }

      <RejectModal
        visible={!!rejectTarget}
        entityName={rejectTarget?.name}
        onConfirm={reason => reject(rejectTarget, reason)}
        onCancel={() => setRejectTarget(null)}
      />
    </View>
  )
}

// ─── Job Postings Tab ────────────────────────────────────────────────────────

function JobPostingsTab() {
  const [jobs,           setJobs]           = useState([])
  const [loading,        setLoading]        = useState(true)
  const [filter,         setFilter]         = useState('pending')
  const [rejectTarget,   setRejectTarget]   = useState(null)
  const [activateTarget, setActivateTarget] = useState(null)  // { item, isRenew }

  const CATEGORY_LABELS = {
    hospitality: 'Hospitality', construction: 'Construction', retail: 'Retail',
    healthcare: 'Healthcare', admin_office: 'Admin/Office', education: 'Education',
    driving_logistics: 'Driving/Logistics', beauty_wellness: 'Beauty/Wellness',
    agriculture: 'Agriculture', domestic: 'Domestic', other: 'Other',
  }

  const load = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('job_postings')
      .select('id, job_title, employer_name, category, employment_type, district, phone, status, rejection_reason, owner_id, created_at, expires_at, poster_type, payment_status, paid_at, payment_ref')
      .order('created_at', { ascending: false })
    if (filter === 'awaiting_payment') {
      query = query.eq('payment_status', 'awaiting_payment').eq('status', 'pending')
    } else if (filter === 'expired') {
      // Auto-expire flips active→expired hourly; also catch active rows already
      // past expiry but not yet swept by the cron.
      const nowIso = new Date().toISOString()
      query = query.or(`status.eq.expired,and(status.eq.active,expires_at.lt.${nowIso})`)
    } else if (filter !== 'all') {
      query = query.eq('status', filter)
    }
    const { data } = await query
    setJobs(data ?? [])
    setLoading(false)
  }, [filter])

  useEffect(() => { load() }, [load])

  // Uses the insert_notification RPC, not recordNotification(): the only INSERT
  // policy on notifications is WITH CHECK (false), so a direct client insert is
  // always rejected. The RPC is SECURITY DEFINER and bypasses it.
  // No payment wording — this reaches the consumer app.
  async function notifyJobLive(ownerId, jobTitle) {
    if (!ownerId) return
    const { data: p } = await supabase.from('profiles')
      .select('push_token, preferred_language').eq('id', ownerId).maybeSingle()
    const lang  = p?.preferred_language || 'English'
    const title = t('notifJobLiveTitle', lang)
    const body  = t('notifJobLiveBody', lang).replace('{title}', jobTitle || '')
    if (p?.push_token) await sendPushNotification(p.push_token, title, body)
    await supabase.rpc('insert_notification', { p_user_id: ownerId, p_title: title, p_body: body })
  }

  async function approve(item) {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    await supabase.from('job_postings')
      .update({ status: 'active', expires_at: expiresAt, rejection_reason: null })
      .eq('id', item.id)
    await notifyJobLive(item.owner_id, item.job_title)
    load()
  }

  // Business posts: publish once the off-app bank transfer has landed. Renewal
  // extends from the current expiry when it is still in the future, else from
  // now — same semantics as extendSubscription() for estate agents.
  async function activate(item, isRenew, paymentRef) {
    const base = isRenew && item.expires_at && new Date(item.expires_at) > new Date()
      ? new Date(item.expires_at)
      : new Date()
    const expiresAt = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
    await supabase.from('job_postings')
      .update({
        status:           'active',
        payment_status:   'paid',
        paid_at:          new Date().toISOString(),
        payment_ref:      paymentRef || null,
        expires_at:       expiresAt,
        rejection_reason: null,
      })
      .eq('id', item.id)
    setActivateTarget(null)
    await notifyJobLive(item.owner_id, item.job_title)
    load()
  }

  async function reject(id, reason) {
    await supabase.from('job_postings')
      .update({ status: 'rejected', rejection_reason: reason || 'Does not meet our guidelines.' })
      .eq('id', id)
    setRejectTarget(null)
    load()
  }

  async function deleteJob(id) {
    Alert.alert('Delete listing?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await supabase.from('job_postings').delete().eq('id', id)
        load()
      }},
    ])
  }

  function statusColor(status) {
    if (status === 'active')   return colors.success
    if (status === 'rejected') return colors.danger
    if (status === 'filled')   return '#7C3AED'
    if (status === 'pending')  return '#C2410C'
    return colors.textSecondary
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
        <View style={[s.chipRow, { marginBottom: 12 }]}>
          {['pending', 'awaiting_payment', 'active', 'rejected', 'filled', 'expired', 'all'].map(f => (
            <TouchableOpacity key={f} style={[s.chip, filter === f && s.chipActive]} onPress={() => setFilter(f)}>
              <Text style={[s.chipText, filter === f && s.chipTextActive]}>
                {f === 'awaiting_payment' ? 'Awaiting payment' : f.charAt(0).toUpperCase() + f.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {loading
        ? <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
        : (
          <FlatList
            data={jobs}
            keyExtractor={j => j.id}
            contentContainerStyle={s.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={<SectionEmpty text={`No ${filter.replace('_', ' ')} job postings.`} />}
            renderItem={({ item }) => {
              const isBusiness = item.poster_type === 'business'
              const awaitingPayment = isBusiness && item.payment_status === 'awaiting_payment'
              return (
              <View style={s.card}>
                <View style={[s.cardRow, { justifyContent: 'space-between', alignItems: 'flex-start' }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.cardTitle} numberOfLines={1}>{item.job_title}</Text>
                    <Text style={s.cardSub}>{item.employer_name} · {item.district}</Text>
                    <Text style={s.cardSub}>{CATEGORY_LABELS[item.category] || item.category} · {(item.employment_type || '').replace('_', ' ')}</Text>
                    <Text style={s.cardSub}>{item.phone}</Text>
                    {item.expires_at && (
                      <Text style={s.cardSub}>Expires: {new Date(item.expires_at).toLocaleDateString('en-GB')}</Text>
                    )}
                  </View>
                  <View style={{ alignItems: 'flex-end', marginLeft: 8, gap: 4 }}>
                    <View style={[s.pillGrey, { backgroundColor: statusColor(item.status) + '20' }]}>
                      <Text style={[s.pillText, { color: statusColor(item.status) }]}>{item.status}</Text>
                    </View>
                    {isBusiness && (
                      <View style={[s.pillGrey, { backgroundColor: (awaitingPayment ? colors.accent : colors.success) + '20' }]}>
                        <Text style={[s.pillText, { color: awaitingPayment ? colors.accent : colors.success }]}>
                          {awaitingPayment ? 'unpaid' : 'business'}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>

                {item.status === 'rejected' && item.rejection_reason && (
                  <Text style={[s.cardSub, { color: colors.danger, marginTop: 6 }]}>Reason: {item.rejection_reason}</Text>
                )}
                {isBusiness && item.payment_ref && (
                  <Text style={[s.cardSub, { marginTop: 6 }]}>Ref: {item.payment_ref}</Text>
                )}

                <View style={[s.rowActions, { marginTop: 10, marginLeft: 0 }]}>
                  {/* Business posts publish through Activate (confirms the off-app
                      transfer landed); individuals keep the free Approve path. */}
                  {isBusiness
                    ? item.status !== 'filled' && (
                      <TouchableOpacity style={s.ghostBtn} onPress={() => setActivateTarget({ item, isRenew: item.status === 'active' || item.status === 'expired' })}>
                        <Text style={s.ghostBtnText}>{item.status === 'active' || item.status === 'expired' ? 'Renew' : 'Activate'}</Text>
                      </TouchableOpacity>
                    )
                    : item.status !== 'active' && item.status !== 'filled' && (
                      <TouchableOpacity style={s.ghostBtn} onPress={() => approve(item)}>
                        <Text style={s.ghostBtnText}>Approve</Text>
                      </TouchableOpacity>
                    )}
                  {item.status !== 'rejected' && item.status !== 'filled' && (
                    <TouchableOpacity style={s.dangerGhostBtn} onPress={() => setRejectTarget(item)}>
                      <Text style={s.dangerGhostText}>Reject</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={s.dangerGhostBtn} onPress={() => deleteJob(item.id)}>
                    <Text style={s.dangerGhostText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
              )
            }}
          />
        )
      }

      <RejectModal
        visible={!!rejectTarget}
        entityName={rejectTarget?.job_title}
        onConfirm={reason => reject(rejectTarget.id, reason)}
        onCancel={() => setRejectTarget(null)}
      />

      <ActivateJobModal
        visible={!!activateTarget}
        jobTitle={activateTarget?.item?.job_title}
        isRenew={activateTarget?.isRenew}
        onConfirm={ref => activate(activateTarget.item, activateTarget.isRenew, ref)}
        onCancel={() => setActivateTarget(null)}
      />
    </View>
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
          {tab === 'Dashboard'   && <DashboardTab onNavigate={navigateTo} />}
          {tab === 'Reports'     && <ReportsTab session={session} />}
          {tab === 'Changes'     && <ChangesTab />}
          {tab === 'Claims'      && <ClaimsTab session={session} />}
          {tab === 'Providers'   && <ProvidersTab />}
          {tab === 'Credentials' && <CredentialsTab />}
          {tab === 'Facilities'  && <FacilitiesTab />}
          {tab === 'Duty'        && <DutyTab />}
          {tab === 'Users'       && <UsersTab />}
          {tab === 'Bookings'    && <BookingsTab />}
          {tab === 'Broadcast'   && <BroadcastTab />}
          {tab === 'Events'      && <EventsTab />}
          {tab === 'Properties'    && <PropertiesTab />}
          {tab === 'Agents'        && <AgentsTab />}
          {tab === 'HomeServices'  && <HomeServicesTab />}
          {tab === 'Transport'     && <TransportTab />}
          {tab === 'Insurance'     && <InsuranceTab />}
          {tab === 'BusRoutes'     && <BusRoutesTab />}
          {tab === 'Places'        && <PlacesTab />}
          {tab === 'JobPostings'   && <JobPostingsTab />}
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

  reportHead:         { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  reportBadge:        { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: colors.primaryLight },
  reportBadgeText:    { fontSize: 10, fontFamily: 'Inter_700Bold', color: colors.primary, letterSpacing: 0.5 },
  reportBody:         { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 20, marginBottom: 10 },
  reportMissing:      { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, fontStyle: 'italic', marginBottom: 10 },
  reportMeta:         { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.danger, marginBottom: 6 },
  reportDetail:       { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 17, marginBottom: 3 },
  reportActions:      { flexDirection: 'row', gap: 6, marginTop: 12 },

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

  // reject modal
  rejectOverlay:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  rejectSheet:        { backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36 },
  rejectTitle:        { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 4 },
  rejectSub:          { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginBottom: 14 },
  rejectInput:        { borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, padding: 13, fontSize: 14, fontFamily: 'Inter_400Regular', backgroundColor: colors.surface, color: colors.textPrimary, minHeight: 88, marginBottom: 16 },
  rejectBtnRow:       { flexDirection: 'row', gap: 10 },
  rejectCancelBtn:    { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center' },
  rejectCancelText:   { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
  rejectConfirmBtn:   { flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: colors.danger, alignItems: 'center' },
  rejectConfirmText:  { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },

  // document rows
  docsSection:        { marginTop: 10, backgroundColor: colors.primaryLight, borderRadius: 10, padding: 10, gap: 6 },
  docsSectionLabel:   { fontSize: 10, fontFamily: 'Inter_700Bold', color: colors.primary, letterSpacing: 0.5, marginBottom: 2 },
  claimIdentity:      { marginTop: 8, backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 10, gap: 5 },
  claimIdentityLabel: { fontSize: 9, fontFamily: 'Inter_700Bold', color: colors.textSecondary, letterSpacing: 0.5, marginBottom: 3 },
  claimDetailRow:     { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  claimDetailKey:     { width: 118, fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  claimDetailVal:     { flex: 1, fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  claimDetailKey_tax: { fontSize: 14, color: colors.primary },
  docRow:             { flexDirection: 'row', alignItems: 'center', gap: 6 },
  docRowText:         { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.primary },

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
