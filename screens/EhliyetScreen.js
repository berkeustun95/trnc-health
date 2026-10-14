import { useState, useEffect, useCallback } from 'react'
import { View, Text, Image, ScrollView, TouchableOpacity, StyleSheet, Linking, useWindowDimensions } from 'react-native'
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
  usesFixture, shouldLogContact, telUrl, primaryPhone, hasWhatsApp, whatsAppUrl, hasInstagram, hasFacebook,
  hasEmail, mailtoUrl, emailDisplay, licenceClasses, branchAddress, mapsSearchUrl, sortedBranches,
  SOCIAL_LABEL_PX, SOCIAL_LAYOUT, socialSideBySide,
} from '../constants/ehliyet'
import { logContactEvent } from '../utils/logContactEvent'
import { ScreenHeader, ErrorState, CardSkeleton } from '../components/ui'

// ─── Ehliyet: driving schools ───────────────────────────────────────────────
// Rows come from public.driving_schools (+ nested driving_school_branches); RLS returns active rows only.
// Dark module: while MODULE_FLAGS.ehliyet is off, dev / ADA Preview read PREVIEW_DRIVING_SCHOOLS and
// never query (constants/ehliyet.js says why). Fixture rows never log contact events.
// The partner logo has no onDark variant: it only ever sits on the white card.

const FROM_FIXTURE = usesFixture(MODULE_FLAGS.ehliyet, EHLIYET)
const COLS = 'id, name, logo_key, phones, whatsapp, instagram_url, facebook_url, email, licence_classes, featured, sort_order, driving_school_branches(region, address, lat, lng, geocode_source, sort_order)'

function ActionButton({ icon, label, onPress, bg, fg, outlined, compact }) {
  return (
    <TouchableOpacity
      style={[s.action, outlined ? s.actionOutlined : { backgroundColor: bg }, compact && s.actionCompact]}
      onPress={onPress} activeOpacity={press.small}
      accessibilityRole="button" accessibilityLabel={label}
    >
      <Ionicons name={icon} size={18} color={fg} />
      <Text style={[s.actionText, compact && s.actionTextCompact, { color: fg }]}>{label}</Text>
    </TouchableOpacity>
  )
}

function SchoolCard({ school, lang, featured, onAction }) {
  const logo = partnerAsset(school.logo_key)
  const { width, fontScale } = useWindowDimensions()
  const branches = sortedBranches(school).filter(b => REGION_LABEL_KEY[b.region])
  const addressed = branches.filter(b => branchAddress(b))
  const classes = licenceClasses(school)
  const ig = hasInstagram(school), fb = hasFacebook(school)
  const social = ig && fb && socialSideBySide(width, fontScale)
  const igButton = <ActionButton icon="logo-instagram" label={t('ehliyetInstagram', lang)} onPress={() => onAction(school, 'instagram', school.instagram_url)} fg={EHLIYET_DARK} outlined compact={social} />
  const fbButton = <ActionButton icon="logo-facebook" label={t('ehliyetFacebook', lang)} onPress={() => onAction(school, 'facebook', school.facebook_url)} fg={EHLIYET_DARK} outlined compact={social} />
  return (
    <View style={s.card}>
      {logo ? (
        <Image source={logo} resizeMode="contain" style={featured ? s.logo : s.logoSmall}
          accessibilityIgnoresInvertColors accessibilityRole="image" accessibilityLabel={school.name} />
      ) : (
        // The logo carries the name (it is in the image); a school without one still needs its name on screen.
        <Text style={s.nameFallback} accessibilityRole="header">{school.name}</Text>
      )}

      {classes.length > 0 && (
        <View style={s.branchBlock}>
          <Text style={s.branchLabel}>{t('ehliyetClasses', lang)}</Text>
          <View style={s.chips}>
            {classes.map(c => (
              <View key={c} style={s.chip}><Text style={s.chipText}>{c}</Text></View>
            ))}
          </View>
        </View>
      )}

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
          {addressed.map(b => (
            <TouchableOpacity key={b.region} style={s.addressRow} activeOpacity={press.card}
              onPress={() => onAction(school, 'maps', mapsSearchUrl(branchAddress(b)))}
              accessibilityRole="link" accessibilityLabel={`${t('ehliyetMapLabel', lang)}: ${branchAddress(b)}`}>
              <Ionicons name="location-outline" size={16} color={EHLIYET_DARK} />
              <Text style={s.addressText}>{branchAddress(b)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={s.actions}>
        {!!primaryPhone(school) && (
          <ActionButton icon="call" label={t('ehliyetCall', lang)} onPress={() => onAction(school, 'call', telUrl(primaryPhone(school)))} bg={EHLIYET_BRIGHT} fg="#FFFFFF" />
        )}
        {hasWhatsApp(school) && (
          <ActionButton icon="logo-whatsapp" label={t('ehliyetWhatsApp', lang)} onPress={() => onAction(school, 'whatsapp', whatsAppUrl(school))} bg={EHLIYET_WA} fg="#FFFFFF" />
        )}
        {social ? (
          <View style={s.socialRow}>{igButton}{fbButton}</View>
        ) : (
          <>{ig && igButton}{fb && fbButton}</>
        )}
      </View>

      {hasEmail(school) && (
        <TouchableOpacity style={s.emailRow} activeOpacity={press.card}
          onPress={() => onAction(school, 'email', mailtoUrl(school))}
          accessibilityRole="link" accessibilityLabel={`${t('ehliyetEmailLabel', lang)}: ${school.email}`}>
          <Ionicons name="mail-outline" size={16} color={EHLIYET_DARK} />
          <Text style={s.emailText}>{emailDisplay(school.email)}</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

export default function EhliyetScreen({ lang, onBack }) {
  const [schools, setSchools] = useState([])
  const [loading, setLoading] = useState(!FROM_FIXTURE)
  const [error, setError]     = useState(false)
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

  const onAction = (school, action, url) => {
    if (shouldLogContact(FROM_FIXTURE)) logContactEvent('ehliyet', school.id, action)
    Linking.openURL(url).catch(() => {})
  }

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
              onAction={onAction} />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32, gap: 14 },

  card:         { backgroundColor: '#FFFFFF', borderRadius: radii.card, padding: 18, ...elevation.card },
  logo:         { width: '100%', height: 96, marginBottom: 12 },
  logoSmall:    { width: '60%', height: 56, marginBottom: 10 },
  nameFallback: { ...type.sectionHeading, color: EHLIYET_DARK },

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
  // Instagram + Facebook pair: widths come from socialSideBySide (constants/ehliyet.js); padding and gap mirror SOCIAL_LAYOUT.
  socialRow:     { flexDirection: 'row', gap: SOCIAL_LAYOUT.gap },
  actionCompact: { flex: 1, minHeight: 44, paddingHorizontal: SOCIAL_LAYOUT.padX },
  actionTextCompact: { fontSize: SOCIAL_LABEL_PX },

  addressRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 6, minHeight: 44, paddingTop: 12 },
  addressText: { ...type.small, color: EHLIYET_DARK, flex: 1, textDecorationLine: 'underline' },
  emailRow:    { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: 6, minHeight: 44, marginTop: 6 },
  emailText:   { ...type.small, color: EHLIYET_DARK, flexShrink: 1, textDecorationLine: 'underline' },
})
