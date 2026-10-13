import { useState, useEffect, useCallback } from 'react'
import { View, Text, Image, ScrollView, TouchableOpacity, StyleSheet, Linking } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { t } from '../constants/i18n'
import { MODULE_FLAGS } from '../constants/flags'
import { EHLIYET } from '../constants/redesign'
import { colors, type, radii, elevation, press } from '../constants/theme'
import { REGION_LABEL_KEY } from '../constants/regions'
import { partnerAsset } from '../constants/partnerAssets'
import {
  EHLIYET_BRIGHT, EHLIYET_DARK, EHLIYET_WA, PREVIEW_DRIVING_SCHOOLS,
  usesFixture, shouldLogContact, telUrl, hasWhatsApp, whatsAppUrl, hasInstagram, sortedBranches,
} from '../constants/ehliyet'
import { logContactEvent } from '../utils/logContactEvent'
import { ScreenHeader, ErrorState, CardSkeleton, BottomSheet } from '../components/ui'

// ─── Ehliyet: driving schools ───────────────────────────────────────────────
// Rows come from public.driving_schools (+ nested driving_school_branches); RLS returns active rows only.
// Dark module: while MODULE_FLAGS.ehliyet is off, dev / ADA Preview read PREVIEW_DRIVING_SCHOOLS and
// never query (constants/ehliyet.js says why). Fixture rows never log contact events.
// The partner logo has no onDark variant: it only ever sits on the white card.

const FROM_FIXTURE = usesFixture(MODULE_FLAGS.ehliyet, EHLIYET)
const COLS = 'id, name, logo_key, phones, whatsapp, instagram_url, featured, sort_order, driving_school_branches(region, lat, lng, sort_order)'

function ActionButton({ icon, label, onPress, bg, fg, outlined }) {
  return (
    <TouchableOpacity
      style={[s.action, outlined ? s.actionOutlined : { backgroundColor: bg }]}
      onPress={onPress} activeOpacity={press.small}
      accessibilityRole="button" accessibilityLabel={label}
    >
      <Ionicons name={icon} size={18} color={fg} />
      <Text style={[s.actionText, { color: fg }]}>{label}</Text>
    </TouchableOpacity>
  )
}

function SchoolCard({ school, lang, featured, onCall, onInstagram, onWhatsApp }) {
  const logo = partnerAsset(school.logo_key)
  const branches = sortedBranches(school).filter(b => REGION_LABEL_KEY[b.region])
  return (
    <View style={s.card}>
      {!!logo && (
        <Image source={logo} resizeMode="contain" style={featured ? s.logo : s.logoSmall}
          accessibilityIgnoresInvertColors accessibilityLabel={school.name} />
      )}
      <Text style={s.name} accessibilityRole="header">{school.name}</Text>

      {branches.length > 0 && (
        <View style={s.branchBlock}>
          <Text style={s.branchLabel}>{t('ehliyetBranches', lang)}</Text>
          <View style={s.chips}>
            {branches.map(b => (
              <View key={b.region} style={s.chip}>
                <Text style={s.chipText}>{t(REGION_LABEL_KEY[b.region], lang)}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      <View style={s.actions}>
        {(school.phones || []).length > 0 && (
          <ActionButton icon="call" label={t('ehliyetCall', lang)} onPress={() => onCall(school)} bg={EHLIYET_BRIGHT} fg="#FFFFFF" />
        )}
        {hasInstagram(school) && (
          <ActionButton icon="logo-instagram" label={t('ehliyetInstagram', lang)} onPress={() => onInstagram(school)} fg={EHLIYET_DARK} outlined />
        )}
        {hasWhatsApp(school) && (
          <ActionButton icon="logo-whatsapp" label={t('ehliyetWhatsApp', lang)} onPress={() => onWhatsApp(school)} bg={EHLIYET_WA} fg="#FFFFFF" />
        )}
      </View>
    </View>
  )
}

function PhoneRow({ phone, onPress }) {
  return (
    <TouchableOpacity style={s.phoneRow} onPress={onPress} activeOpacity={press.card}
      accessibilityRole="link" accessibilityLabel={phone}>
      <View style={s.phoneIcon}><Ionicons name="call" size={18} color="#FFFFFF" /></View>
      <Text style={s.phoneText}>{phone}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
    </TouchableOpacity>
  )
}

export default function EhliyetScreen({ lang, onBack, backRef = null }) {
  const [schools, setSchools] = useState([])
  const [loading, setLoading] = useState(!FROM_FIXTURE)
  const [error, setError]     = useState(false)
  const [callSchool, setCallSchool] = useState(null)   // kept while the sheet slides out
  const [callOpen, setCallOpen] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => { setError(false); setLoading(true); setAttempt(a => a + 1) }, [])

  useEffect(() => {
    if (FROM_FIXTURE) { setSchools(PREVIEW_DRIVING_SCHOOLS); setLoading(false); return }
    let alive = true
    ;(async () => {
      const { data, error: err } = await supabase
        .from('driving_schools')
        .select(COLS)
        .eq('is_active', true)
        .order('featured', { ascending: false })
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true })
      if (!alive) return
      // The table cannot legitimately be empty: zero rows is an error state, like a failed query.
      if (err || !data?.length) { setError(true); setLoading(false); return }
      setSchools(data)
      setLoading(false)
    })().catch(() => { if (alive) { setError(true); setLoading(false) } })
    return () => { alive = false }
  }, [attempt])

  // App.js asks this first: true = consumed (the call sheet closed), false = leave the module.
  useEffect(() => {
    if (!backRef) return
    backRef.current = () => { if (callOpen) { setCallOpen(false); return true } return false }
    return () => { backRef.current = null }
  })

  const log = (school, action) => { if (shouldLogContact(FROM_FIXTURE)) logContactEvent('ehliyet', school.id, action) }
  const open = (url) => { Linking.openURL(url).catch(() => {}) }
  const openCall = (school) => { setCallSchool(school); setCallOpen(true) }
  const onCallNumber = (phone) => { log(callSchool, 'call'); open(telUrl(phone)) }
  const onInstagram = (school) => { log(school, 'website'); open(school.instagram_url) }
  const onWhatsApp = (school) => { log(school, 'whatsapp'); open(whatsAppUrl(school)) }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScreenHeader lang={lang} title={t('menuEhliyet', lang)} onBack={onBack} />
      {loading ? (
        <View style={s.content}><CardSkeleton height={230} /></View>
      ) : error ? (
        <ErrorState onRetry={retry} lang={lang} />
      ) : (
        <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
          {schools.map(sc => (
            <SchoolCard key={sc.id} school={sc} lang={lang} featured={!!sc.featured}
              onCall={openCall} onInstagram={onInstagram} onWhatsApp={onWhatsApp} />
          ))}
        </ScrollView>
      )}

      <BottomSheet visible={callOpen === true} onClose={() => setCallOpen(false)} title={t('ehliyetCallTitle', lang)} lang={lang}>
        <View style={s.sheetBody}>
          {(callSchool?.phones || []).map(p => <PhoneRow key={p} phone={p} onPress={() => onCallNumber(p)} />)}
        </View>
      </BottomSheet>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32, gap: 14 },

  card:         { backgroundColor: '#FFFFFF', borderRadius: radii.card, padding: 18, ...elevation.card },
  logo:         { width: '100%', height: 96, marginBottom: 12 },
  logoSmall:    { width: '60%', height: 56, marginBottom: 10 },
  name:         { ...type.sectionHeading, color: EHLIYET_DARK },

  branchBlock: { marginTop: 14 },
  branchLabel: { ...type.meta, color: colors.textSecondary, marginBottom: 6 },
  chips:       { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:        { backgroundColor: '#E8EDF8', borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 6 },
  chipText:    { ...type.small, fontFamily: 'Inter_600SemiBold', color: EHLIYET_DARK },

  actions:       { gap: 10, marginTop: 18 },
  action:        { alignSelf: 'stretch', minHeight: 48, borderRadius: radii.md, flexDirection: 'row',
                   alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12 },
  actionOutlined: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: EHLIYET_DARK },
  actionText:    { ...type.rowTitle, flexShrink: 1, textAlign: 'center' },

  sheetBody: { paddingTop: 4, paddingBottom: 8 },
  phoneRow:  { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 14,
               borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  phoneIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: EHLIYET_BRIGHT, alignItems: 'center', justifyContent: 'center' },
  phoneText: { ...type.sheetTitle, color: colors.textPrimary, flex: 1 },
})
