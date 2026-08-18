import { useState, useEffect } from 'react'
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase, isGuest } from '../lib/supabase'
import { colors, shadow, radius } from '../constants/theme'
import { t } from '../constants/i18n'
import BackButton from '../components/BackButton'

const AUDIENCES = [
  { key: 'tourist', icon: 'airplane-outline', labelKey: 'esimAudienceTourist' },
  { key: 'student', icon: 'school-outline',   labelKey: 'esimAudienceStudent' },
]

export default function EsimScreen({ lang, session, onBack, onRequireAccount }) {
  const signedIn = !!session && !isGuest(session)

  const [loading, setLoading]       = useState(signedIn)
  const [joined, setJoined]         = useState(false)
  const [audience, setAudience]     = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState(null)

  useEffect(() => {
    if (!signedIn) { setLoading(false); return }
    let active = true
    ;(async () => {
      const { data } = await supabase
        .from('esim_waitlist')
        .select('audience')
        .eq('user_id', session.user.id)
        .maybeSingle()
      if (!active) return
      if (data) { setJoined(true); setAudience(data.audience) }
      setLoading(false)
    })()
    return () => { active = false }
  }, [signedIn, session?.user?.id])

  async function handleSubmit() {
    if (!audience || submitting) return
    setSubmitting(true)
    setError(null)
    const { error: err } = await supabase
      .from('esim_waitlist')
      .upsert(
        { user_id: session.user.id, email: session.user.email ?? null, audience },
        { onConflict: 'user_id' },
      )
    setSubmitting(false)
    if (err) { setError(t('esimErrorGeneric', lang)); return }
    setJoined(true)
  }

  function renderJoinSection() {
    if (loading) {
      return <View style={s.loadingBox}><ActivityIndicator color={colors.primary} /></View>
    }

    if (!signedIn) {
      return (
        <TouchableOpacity
          style={s.ctaBtn}
          onPress={() => onRequireAccount?.('gateEsim')}
          activeOpacity={0.85}
        >
          <Ionicons name="log-in-outline" size={18} color="#fff" />
          <Text style={s.ctaBtnText}>{t('esimSignInPrompt', lang)}</Text>
        </TouchableOpacity>
      )
    }

    if (joined) {
      return (
        <View style={s.joinedCard}>
          <Ionicons name="checkmark-circle" size={40} color={colors.success} style={{ marginBottom: 10 }} />
          <Text style={s.joinedTitle}>{t('esimJoinedTitle', lang)}</Text>
          <Text style={s.joinedBody}>{t('esimJoinedBody', lang)}</Text>
          <TouchableOpacity onPress={() => setJoined(false)} activeOpacity={0.7} style={s.updateLink}>
            <Text style={s.updateLinkText}>{t('esimJoinedUpdate', lang)}</Text>
          </TouchableOpacity>
        </View>
      )
    }

    return (
      <View style={s.formCard}>
        <Text style={s.formLabel}>{t('esimFormAudienceLabel', lang)}</Text>
        <View style={s.audienceRow}>
          {AUDIENCES.map(a => {
            const selected = audience === a.key
            return (
              <TouchableOpacity
                key={a.key}
                style={[s.audiencePill, selected && s.audiencePillActive]}
                onPress={() => setAudience(a.key)}
                activeOpacity={0.8}
              >
                <Ionicons name={a.icon} size={20} color={selected ? '#fff' : colors.textSecondary} />
                <Text style={[s.audiencePillText, selected && s.audiencePillTextActive]}>
                  {t(a.labelKey, lang)}
                </Text>
              </TouchableOpacity>
            )
          })}
        </View>

        {error && <Text style={s.errorText}>{error}</Text>}

        <TouchableOpacity
          style={[s.submitBtn, (!audience || submitting) && s.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={!audience || submitting}
          activeOpacity={0.85}
        >
          {submitting
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.submitBtnText}>{t('esimSubmit', lang)}</Text>}
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <BackButton lang={lang} onPress={onBack} style={s.backPill} />
        <Text style={s.headerTitle}>{t('esimTitle', lang)}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>

        {/* Coming-soon hero */}
        <View style={s.heroCard}>
          <View style={s.heroIconWrap}>
            <Ionicons name="cellular-outline" size={30} color={colors.primary} />
          </View>
          <View style={s.badge}>
            <Text style={s.badgeText}>{t('esimComingSoonBadge', lang)}</Text>
          </View>
          <Text style={s.heroTitle}>{t('esimHeroTitle', lang)}</Text>
          <Text style={s.heroBody}>{t('esimHeroBody', lang)}</Text>
        </View>

        {/* What is an eSIM */}
        <View style={s.infoCard}>
          <Text style={s.infoCardTitle}>{t('esimWhatTitle', lang)}</Text>
          <Text style={s.infoCardBody}>{t('esimWhatBody', lang)}</Text>
        </View>

        {/* Join the waitlist */}
        <Text style={s.sectionHeader}>{t('esimJoinCta', lang)}</Text>
        {renderJoinSection()}

      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: colors.bg },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.cardBg, borderBottomWidth: 1, borderBottomColor: colors.border },
  backPill:      { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.bg, borderRadius: 22, paddingVertical: 6, paddingHorizontal: 12 },
  headerTitle:   { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, flex: 1, textAlign: 'center' },
  scroll:        { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 48 },

  sectionHeader: { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textSecondary, marginBottom: 10, marginTop: 20, textTransform: 'uppercase', letterSpacing: 0.6 },

  heroCard:      { backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 20, alignItems: 'center', ...shadow },
  heroIconWrap:  { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.tintServiceBg, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  badge:         { backgroundColor: colors.tintServiceBg, borderRadius: 20, paddingVertical: 4, paddingHorizontal: 12, marginBottom: 12 },
  badgeText:     { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.tintServiceFg, textTransform: 'uppercase', letterSpacing: 0.6 },
  heroTitle:     { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textAlign: 'center', marginBottom: 8 },
  heroBody:      { fontSize: 14, color: colors.textSecondary, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20 },

  infoCard:      { backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 16, marginTop: 12, ...shadow },
  infoCardTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 6 },
  infoCardBody:  { fontSize: 14, color: colors.textSecondary, fontFamily: 'Inter_400Regular', lineHeight: 20 },

  loadingBox:    { paddingVertical: 28, alignItems: 'center' },

  ctaBtn:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: radius.card, paddingVertical: 15, ...shadow },
  ctaBtnText:    { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },

  formCard:      { backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 16, ...shadow },
  formLabel:     { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 12 },
  audienceRow:   { flexDirection: 'row', gap: 10 },
  audiencePill:  { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, backgroundColor: 'transparent' },
  audiencePillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  audiencePillText:   { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
  audiencePillTextActive: { color: '#fff' },

  errorText:     { fontSize: 13, color: colors.danger, fontFamily: 'Inter_400Regular', marginTop: 12 },

  submitBtn:     { backgroundColor: colors.primary, borderRadius: radius.card, paddingVertical: 15, alignItems: 'center', marginTop: 16 },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },

  joinedCard:    { backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 24, alignItems: 'center', ...shadow },
  joinedTitle:   { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 8 },
  joinedBody:    { fontSize: 14, color: colors.textSecondary, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20 },
  updateLink:    { marginTop: 16 },
  updateLinkText:{ fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.primary },
})
