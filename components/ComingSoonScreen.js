import { useState, useEffect } from 'react'
import { View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { colors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'
import BackButton from './BackButton'

// Reusable "Coming soon" gate screen for marketplace modules that are empty in
// prod. Content-light (mascot + message) so an empty module reads as deliberate,
// plus a one-tap Notify-me that captures demand into module_waitlist. Guests are
// allowed to join (the app signs them in anonymously), so there is no account
// prompt. Idempotent: a second tap can't duplicate (composite PK + ON CONFLICT),
// and a returning user sees the "on the list" state.
export default function ComingSoonScreen({ lang, moduleKey, titleKey, session, onBack }) {
  const uid = session?.user?.id

  const [checking, setChecking]     = useState(!!uid)
  const [joined, setJoined]         = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState(null)

  useEffect(() => {
    if (!uid) { setChecking(false); return }
    let active = true
    ;(async () => {
      const { data } = await supabase
        .from('module_waitlist')
        .select('user_id')
        .eq('user_id', uid)
        .eq('module', moduleKey)
        .maybeSingle()
      if (!active) return
      if (data) setJoined(true)
      setChecking(false)
    })()
    return () => { active = false }
  }, [uid, moduleKey])

  async function handleNotify() {
    if (!uid || submitting || joined) return
    setSubmitting(true)
    setError(null)
    const { error: err } = await supabase
      .from('module_waitlist')
      .upsert({ user_id: uid, module: moduleKey }, { onConflict: 'user_id,module', ignoreDuplicates: true })
    setSubmitting(false)
    if (err) { setError(t('notifyMeError', lang)); return }
    setJoined(true)
  }

  function renderNotify() {
    if (checking) {
      return <View style={s.notifyLoading}><ActivityIndicator color={colors.primary} /></View>
    }
    if (joined) {
      return (
        <View style={s.joinedPill}>
          <Ionicons name="checkmark-circle" size={20} color={colors.success} />
          <Text style={s.joinedPillText}>{t('notifyMeJoined', lang)}</Text>
        </View>
      )
    }
    return (
      <View style={s.notifyWrap}>
        {error && <Text style={s.errorText}>{error}</Text>}
        <TouchableOpacity
          style={[s.notifyBtn, submitting && s.notifyBtnDisabled]}
          onPress={handleNotify}
          disabled={submitting}
          activeOpacity={0.85}
        >
          {submitting
            ? <ActivityIndicator color="#fff" />
            : (
              <>
                <Ionicons name="notifications-outline" size={18} color="#fff" />
                <Text style={s.notifyBtnText}>{t('notifyMeCta', lang)}</Text>
              </>
            )}
        </TouchableOpacity>
        <Text style={s.hint}>{t('notifyMeHint', lang)}</Text>
      </View>
    )
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <BackButton lang={lang} onPress={onBack} style={s.backPill} />
        <Text style={s.headerTitle} numberOfLines={1}>{t(titleKey, lang)}</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={s.body}>
        <View style={s.mascotWrap}>
          <Image source={require('../assets/oli-button.png')} style={s.mascot} resizeMode="cover" />
        </View>

        <View style={s.badge}>
          <Text style={s.badgeText}>{t('comingSoonBadge', lang)}</Text>
        </View>

        <Text style={s.title}>{t(titleKey, lang)}</Text>
        <Text style={s.bodyText}>{t('comingSoonBody', lang)}</Text>

        {renderNotify()}
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: colors.bg },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.cardBg, borderBottomWidth: 1, borderBottomColor: colors.border },
  backPill:     { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.bg, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12 },
  headerTitle:  { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, flex: 1, textAlign: 'center' },

  body:         { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingBottom: 48 },
  mascotWrap:   { width: 132, height: 132, borderRadius: 66, backgroundColor: colors.tintServiceBg, alignItems: 'center', justifyContent: 'center', marginBottom: 20, ...shadow },
  mascot:       { width: 116, height: 116, borderRadius: 58 },

  badge:        { backgroundColor: colors.tintServiceBg, borderRadius: 20, paddingVertical: 5, paddingHorizontal: 14, marginBottom: 14 },
  badgeText:    { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.tintServiceFg, textTransform: 'uppercase', letterSpacing: 0.6 },

  title:        { fontSize: 22, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textAlign: 'center', marginBottom: 10 },
  bodyText:     { fontSize: 15, color: colors.textSecondary, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 22 },

  notifyWrap:   { alignSelf: 'stretch', alignItems: 'center', marginTop: 28 },
  notifyLoading:{ marginTop: 28, height: 52, justifyContent: 'center' },
  notifyBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, alignSelf: 'stretch', backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 15, ...shadow },
  notifyBtnDisabled: { opacity: 0.6 },
  notifyBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
  hint:         { fontSize: 13, color: colors.textSecondary, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 12 },

  joinedPill:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 28, backgroundColor: colors.cardBg, borderRadius: 24, paddingVertical: 12, paddingHorizontal: 20, ...shadow },
  joinedPillText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary },

  errorText:    { fontSize: 13, color: colors.danger, fontFamily: 'Inter_400Regular', textAlign: 'center', marginBottom: 12 },
})
