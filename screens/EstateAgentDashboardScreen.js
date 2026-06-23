import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Image, ActivityIndicator, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons, Feather } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { colors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'
import PropertySubmitScreen from './PropertySubmitScreen'

const CURRENCIES = { GBP: '£', TRY: '₺', EUR: '€' }

function statusColor(status) {
  if (status === 'active')   return colors.success
  if (status === 'pending')  return colors.accent
  if (status === 'rejected') return colors.danger
  return colors.textSecondary
}

function statusLabel(status, lang) {
  if (status === 'active')   return t('accomListingActive', lang)
  if (status === 'pending')  return t('pendingVerification', lang)
  if (status === 'rejected') return t('accomListingRejected', lang)
  if (status === 'archived') return t('accomListingArchived', lang)
  return status
}

function priceDisplay(price, currency, period, lang) {
  const sym = CURRENCIES[currency] || currency
  const fmt = Number(price).toLocaleString('en-GB', { maximumFractionDigits: 0 })
  if (period === 'monthly') return `${sym}${fmt}${t('accomPerMonth', lang)}`
  if (period === 'nightly') return `${sym}${fmt}${t('accomPerNight', lang)}`
  return `${sym}${fmt}`
}

function ListingCard({ item, lang, onEdit, onArchive }) {
  const cover = item.property_images?.[0]?.url
  return (
    <View style={ds.listingCard}>
      {cover
        ? <Image source={{ uri: cover }} style={ds.listingCover} resizeMode="cover" />
        : <View style={[ds.listingCover, ds.listingCoverPlaceholder]}>
            <Ionicons name="home-outline" size={28} color={colors.border} />
          </View>
      }
      <View style={ds.listingBody}>
        <View style={ds.listingTitleRow}>
          <Text style={ds.listingTitle} numberOfLines={2}>{item.title}</Text>
          <View style={[ds.statusPill, { backgroundColor: statusColor(item.status) + '22' }]}>
            <Text style={[ds.statusPillText, { color: statusColor(item.status) }]}>
              {statusLabel(item.status, lang)}
            </Text>
          </View>
        </View>
        <Text style={ds.listingPrice}>{priceDisplay(item.price, item.currency, item.price_period, lang)}</Text>
        {item.rejection_reason && (
          <View style={ds.rejectionBox}>
            <Text style={ds.rejectionText}>{item.rejection_reason}</Text>
          </View>
        )}
        <View style={ds.listingActions}>
          <TouchableOpacity style={ds.actionBtn} onPress={() => onEdit(item)}>
            <Feather name="edit-2" size={14} color={colors.primary} />
            <Text style={ds.actionBtnText}>{t('accomEditListing', lang)}</Text>
          </TouchableOpacity>
          {item.status !== 'archived' && (
            <TouchableOpacity style={[ds.actionBtn, ds.archiveBtn]} onPress={() => onArchive(item)}>
              <Feather name="archive" size={14} color={colors.textSecondary} />
              <Text style={[ds.actionBtnText, { color: colors.textSecondary }]}>{t('accomArchiveListing', lang)}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  )
}

export default function EstateAgentDashboardScreen({ session, lang }) {
  const [agentRecord, setAgentRecord]   = useState(null)
  const [agencyRecord, setAgencyRecord] = useState(null)
  const [listings, setListings]         = useState([])
  const [loading, setLoading]           = useState(true)
  const [showSubmit, setShowSubmit]     = useState(false)
  const [editListing, setEditListing]   = useState(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    const { data: agent } = await supabase
      .from('estate_agents')
      .select('id, full_name, status, rejection_reason, agency_id')
      .eq('user_id', session.user.id)
      .maybeSingle()
    setAgentRecord(agent)

    if (agent?.agency_id) {
      const { data: agency } = await supabase
        .from('estate_agencies')
        .select('id, name, logo_url, status')
        .eq('id', agent.agency_id)
        .maybeSingle()
      setAgencyRecord(agency)
    }

    if (agent?.id) {
      const { data: props } = await supabase
        .from('properties')
        .select('*, property_images(id, url, sort_order)')
        .eq('agent_id', agent.id)
        .order('created_at', { ascending: false })
      setListings((props || []).map(p => ({
        ...p,
        property_images: (p.property_images || []).sort((a, b) => a.sort_order - b.sort_order),
      })))
    }
    setLoading(false)
  }, [session.user.id])

  useEffect(() => { loadData() }, [loadData])

  async function archiveListing(item) {
    Alert.alert('Archive listing', `Archive "${item.title}"? It will no longer be visible to browsers.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Archive', style: 'destructive',
        onPress: async () => {
          await supabase.from('properties').update({ status: 'archived' }).eq('id', item.id)
          loadData()
        },
      },
    ])
  }

  if (showSubmit || editListing) {
    return (
      <PropertySubmitScreen
        session={session}
        lang={lang}
        property={editListing}
        onClose={() => { setShowSubmit(false); setEditListing(null) }}
        onSubmitted={() => { setShowSubmit(false); setEditListing(null); loadData() }}
      />
    )
  }

  if (loading) {
    return (
      <SafeAreaView style={ds.safe} edges={['top', 'bottom']}>
        <ActivityIndicator size="large" color={colors.primary} style={{ flex: 1 }} />
      </SafeAreaView>
    )
  }

  // No agent record yet
  if (!agentRecord) {
    return (
      <SafeAreaView style={ds.safe} edges={['top', 'bottom']}>
        <View style={ds.center}>
          <Text style={{ fontSize: 48, marginBottom: 16 }}>🏡</Text>
          <Text style={ds.centerTitle}>{t('accomBecomeAgent', lang)}</Text>
          <Text style={ds.centerSub}>{t('accomBecomeAgentSub', lang)}</Text>
        </View>
      </SafeAreaView>
    )
  }

  // Pending
  if (agentRecord.status === 'pending') {
    return (
      <SafeAreaView style={ds.safe} edges={['top', 'bottom']}>
        <View style={ds.center}>
          <Text style={{ fontSize: 48, marginBottom: 16 }}>⏳</Text>
          <Text style={ds.centerTitle}>{t('accomPendingAgent', lang)}</Text>
          <Text style={ds.centerSub}>{t('accomPendingAgentSub', lang)}</Text>
          <TouchableOpacity onPress={() => supabase.auth.signOut()} style={{ marginTop: 32 }}>
            <Text style={ds.signOutLink}>{t('signOut', lang)}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  // Rejected
  if (agentRecord.status === 'rejected') {
    return (
      <SafeAreaView style={ds.safe} edges={['top', 'bottom']}>
        <View style={ds.center}>
          <Text style={{ fontSize: 48, marginBottom: 16 }}>❌</Text>
          <Text style={ds.centerTitle}>{t('accomRejectedAgent', lang)}</Text>
          {agentRecord.rejection_reason && (
            <View style={ds.rejectionBox}>
              <Text style={ds.rejectionText}>{agentRecord.rejection_reason}</Text>
            </View>
          )}
          <TouchableOpacity onPress={() => supabase.auth.signOut()} style={{ marginTop: 32 }}>
            <Text style={ds.signOutLink}>{t('signOut', lang)}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={ds.safe} edges={['top']}>
      {/* Header */}
      <View style={ds.header}>
        <View style={ds.headerLeft}>
          {agencyRecord?.logo_url
            ? <Image source={{ uri: agencyRecord.logo_url }} style={ds.headerLogo} resizeMode="contain" />
            : <View style={[ds.headerLogo, ds.headerLogoPlaceholder]}>
                <Ionicons name="business-outline" size={20} color={colors.textSecondary} />
              </View>
          }
          <View>
            <Text style={ds.headerName}>{agentRecord.full_name}</Text>
            {agencyRecord?.name && <Text style={ds.headerAgency}>{agencyRecord.name}</Text>}
          </View>
        </View>
        <TouchableOpacity style={ds.addBtn} onPress={() => setShowSubmit(true)}>
          <Ionicons name="add" size={20} color="#fff" />
          <Text style={ds.addBtnText}>{t('accomAddListing', lang)}</Text>
        </TouchableOpacity>
      </View>

      {/* Stats row */}
      <View style={ds.statsRow}>
        {[
          { label: 'Active',   count: listings.filter(l => l.status === 'active').length,   color: colors.success },
          { label: 'Pending',  count: listings.filter(l => l.status === 'pending').length,  color: colors.accent },
          { label: 'Rejected', count: listings.filter(l => l.status === 'rejected').length, color: colors.danger },
        ].map(stat => (
          <View key={stat.label} style={ds.statCard}>
            <Text style={[ds.statCount, { color: stat.color }]}>{stat.count}</Text>
            <Text style={ds.statLabel}>{stat.label}</Text>
          </View>
        ))}
      </View>

      {/* Listings */}
      <FlatList
        data={listings}
        keyExtractor={i => i.id}
        contentContainerStyle={ds.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={ds.emptyWrap}>
            <Ionicons name="home-outline" size={40} color={colors.border} />
            <Text style={ds.emptyText}>No listings yet. Tap + Add listing to get started.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <ListingCard
            item={item}
            lang={lang}
            onEdit={setEditListing}
            onArchive={archiveListing}
          />
        )}
      />
    </SafeAreaView>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const ds = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: colors.bg },
  center:          { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  centerTitle:     { fontSize: 20, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textAlign: 'center' },
  centerSub:       { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  signOutLink:     { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.danger },

  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  headerLeft:      { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerLogo:      { width: 38, height: 38, borderRadius: 8 },
  headerLogoPlaceholder: { backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  headerName:      { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  headerAgency:    { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  addBtn:          { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, backgroundColor: colors.primary },
  addBtnText:      { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#fff' },

  statsRow:        { flexDirection: 'row', paddingHorizontal: 16, gap: 10, marginBottom: 16 },
  statCard:        { flex: 1, backgroundColor: colors.cardBg, borderRadius: 12, padding: 12, alignItems: 'center', ...shadow },
  statCount:       { fontSize: 24, fontFamily: 'Inter_700Bold' },
  statLabel:       { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 2 },

  listContent:     { paddingHorizontal: 16, paddingBottom: 40 },
  listingCard:     { flexDirection: 'row', backgroundColor: colors.cardBg, borderRadius: 16, marginBottom: 12, overflow: 'hidden', ...shadow },
  listingCover:    { width: 100, height: '100%', minHeight: 110 },
  listingCoverPlaceholder: { backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  listingBody:     { flex: 1, padding: 12, gap: 4 },
  listingTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  listingTitle:    { flex: 1, fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  listingPrice:    { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.primary },
  statusPill:      { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusPillText:  { fontSize: 11, fontFamily: 'Inter_700Bold' },
  rejectionBox:    { backgroundColor: colors.dangerLight, borderRadius: 8, padding: 8, marginTop: 4 },
  rejectionText:   { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.danger },
  listingActions:  { flexDirection: 'row', gap: 8, marginTop: 6 },
  actionBtn:       { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.primaryLight },
  archiveBtn:      { backgroundColor: colors.surface },
  actionBtnText:   { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary },

  emptyWrap:       { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyText:       { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center' },
})
