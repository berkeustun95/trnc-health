import { useState, useEffect, useCallback } from 'react'
import { View, Text, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { t } from '../constants/i18n'
import { CRUNCHY_EXPRESS, EATERY_PREVIEW_DATA } from '../constants/redesign'
import { REGION_LABEL_KEY } from '../constants/regions'
import { EATERY_CATEGORY_KEY, eateryOpenStatus, eateryPartnerVisible } from '../constants/eatery'
import { colors, type, space, listBottomPad } from '../constants/theme'
import { ScreenHeader, ErrorState, Card, CardSkeleton } from '../components/ui'
import { EateryLogo, PlaceholderTag } from '../components/EateryBits'
import EateryPartnerScreen from './EateryPartnerScreen'

// ─── Yeme-İçme: the partner list ────────────────────────────────────────────
// Rows come from public.eatery_partners with their menu items and photos embedded; RLS returns
// active partners only. Built from rows, so restaurant #2 is data only.
// The table cannot legitimately be empty while the section is live: zero rows is an ERROR STATE.
// On dev / ADA Preview a partner the database has no row for yet falls back to its placeholder.
const PREVIEW_PARTNERS = EATERY_PREVIEW_DATA ? require('../constants/eateryPreview').EATERY_PREVIEW_PARTNERS : null

// A partner behind its own dark flag stays out of a live section (CRUNCHY_EXPRESS_LIVE).
const PARTNER_LIVE = { 'crunchy-express': CRUNCHY_EXPRESS }

const COLS = 'id, slug, name, category, phone, whatsapp, website_url, menu_url, maps_url, region, address, opening_hours, logo_path, menu_verified_on, sort_order, ' +
  'eatery_menu_items(id, section, section_order, name, description, price, currency, sort_order, is_available), ' +
  'eatery_photos(id, kind, storage_path, width, height, sort_order)'

function PartnerCard({ partner, lang, onPress }) {
  const open = eateryOpenStatus(partner, lang)
  const regionKey = REGION_LABEL_KEY[partner.region]
  const category = t(EATERY_CATEGORY_KEY[partner.category] || 'eateryCatRestaurant', lang)
  return (
    <Card onPress={onPress} accessibilityLabel={[partner.name, category, open?.text].filter(Boolean).join(', ')}>
      <View style={s.row}>
        <EateryLogo partner={partner} width={64} height={64} lang={lang} />
        <View style={s.text}>
          <Text style={s.name} numberOfLines={2}>{partner.name}</Text>
          <Text style={s.cat} numberOfLines={1}>{category}</Text>
          <View style={s.meta}>
            {!!regionKey && (
              <View style={s.metaItem}>
                <Ionicons name="location-outline" size={13} color={colors.textSecondary} />
                <Text style={s.metaText} numberOfLines={1}>{t(regionKey, lang)}</Text>
              </View>
            )}
            {!!open && (
              <Text style={[s.metaText, open.tone === 'ok' ? s.ok : open.tone === 'warn' ? s.warn : null]} numberOfLines={1}>{open.text}</Text>
            )}
          </View>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
      </View>
      {!!partner.placeholder && <PlaceholderTag lang={lang} style={s.tag} />}
    </Card>
  )
}

export default function EateryScreen({ lang, partner, onOpenPartner, onClosePartner, onBack }) {
  const insets = useSafeAreaInsets()
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(false)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => { setError(false); setLoading(true); setAttempt(a => a + 1) }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data, error: err } = await supabase
        .from('eatery_partners')
        .select(COLS)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true })
      if (!alive) return
      if (err) { setError(true); setLoading(false); return }
      let list = data ?? []
      if (PREVIEW_PARTNERS) {
        for (const p of PREVIEW_PARTNERS) if (!list.some(r => r.slug === p.slug)) list = [...list, p]
      }
      list = list.filter(r => eateryPartnerVisible(r, PARTNER_LIVE))
      if (!list.length) { setError(true); setLoading(false); return }
      setRows(list)
      setLoading(false)
    })().catch(() => { if (alive) { setError(true); setLoading(false) } })
    return () => { alive = false }
  }, [attempt])

  if (partner) return <EateryPartnerScreen partner={partner} lang={lang} onBack={onClosePartner} />

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScreenHeader lang={lang} title={t('menuEatery', lang)} onBack={onBack} />
      {loading ? (
        <View style={s.content}><CardSkeleton height={96} /></View>
      ) : error ? (
        <ErrorState onRetry={retry} lang={lang} />
      ) : (
        <ScrollView contentContainerStyle={[s.content, { paddingBottom: listBottomPad(insets) }]} showsVerticalScrollIndicator={false}>
          {rows.map(p => <PartnerCard key={p.id} partner={p} lang={lang} onPress={() => onOpenPartner(p)} />)}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: colors.canvas },
  content:  { paddingHorizontal: 16, paddingTop: space[8], gap: 14 },
  row:      { flexDirection: 'row', alignItems: 'center', gap: space[12] },
  text:     { flex: 1 },
  name:     { ...type.rowTitle, color: colors.textPrimary },
  cat:      { ...type.small, color: colors.textSecondary, marginTop: 2 },
  meta:     { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space[12], rowGap: 2, marginTop: 6 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 },
  metaText: { ...type.meta, color: colors.textSecondary, flexShrink: 1 },
  ok:       { color: colors.primaryDark },
  warn:     { color: colors.dangerInk },
  tag:      { marginTop: space[12] },
})
