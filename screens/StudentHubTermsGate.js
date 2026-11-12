import { useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'
import { t } from '../constants/i18n'
import { LEGAL_VERSION, legalDoc, isLegalFallback, legalLocaleFor, LEGAL_TITLE_KEY } from '../constants/legal'
import { ScreenHeader, Button, InlineAlert } from '../components/ui'
import { colors, type, radii } from '../constants/theme'

// Student Hub terms re-ask (constants/legal STUDENT_HUB_TERMS_MIN). Shown INSTEAD of Student Hub to a
// signed-in, non-guest account on older terms; nothing else in the app is interrupted. "Kabul
// ediyorum" records acceptance through the accept_terms RPC (20261191), like sign-up (ProfileSetupScreen):
// only a returned version equal to the one sent counts. The server acts on the signed-in caller, so
// `userId` is kept for callers but no longer used by the write. terms_accepted_at is stamped by the server. "Vazgeç" / back = close.
// Bandabuliya reuses it as an overlay (MarketplaceChatScreen's MarketplaceTermsLayer) by passing its own title/body keys;
// the defaults are Student Hub's, so its call is unchanged.
export default function StudentHubTermsGate({ lang, userId, onAccepted, onCancel, titleKey = 'shTermsTitle', bodyKey = 'shTermsBody' }) {
  const [tab, setTab] = useState('terms')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const insets = useSafeAreaInsets()

  async function accept() {
    setSaving(true); setError(null)
    const { data, error: err } = await supabase.rpc('accept_terms', { p_version: LEGAL_VERSION, p_locale: legalLocaleFor('terms', lang) })
    // >=, not ===: the server never lowers, so an account already on a newer version returns that row
    if (err || !(data?.terms_version >= LEGAL_VERSION)) {
      setError(t('shTermsSaveError', lang)); setSaving(false); return
    }
    onAccepted(data)
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScreenHeader title={t(titleKey, lang)} onBack={onCancel} lang={lang} />
      <Text style={s.intro}>{t(bodyKey, lang)}</Text>
      <View style={s.tabs}>
        {['terms', 'privacy'].map(k => (
          <TouchableOpacity key={k} style={[s.tab, tab === k && s.tabOn]} onPress={() => setTab(k)}
            accessibilityRole="tab" accessibilityState={{ selected: tab === k }}>
            <Text style={[s.tabText, tab === k && s.tabTextOn]}>{t(LEGAL_TITLE_KEY[k], lang)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <ScrollView style={s.doc} contentContainerStyle={s.docBody}>
        {isLegalFallback(tab, lang) && <Text style={s.fallback}>{t('legalAvailableInEnTr', lang)}</Text>}
        <Text style={s.docText}>{legalDoc(tab, lang)}</Text>
      </ScrollView>
      <View style={[s.footer, { paddingBottom: insets.bottom + 12 }]}>
        <InlineAlert message={error} style={{ marginBottom: 10 }} />
        <Button size="lg" title={t('shTermsAccept', lang)} onPress={accept} loading={saving} fullWidth />
        <Button variant="text" title={t('shTermsCancel', lang)} onPress={onCancel} disabled={saving} fullWidth />
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: colors.canvas },
  intro:    { ...type.body, color: colors.textPrimary, paddingHorizontal: 16, marginTop: 4, marginBottom: 12 },
  tabs:     { flexDirection: 'row', marginHorizontal: 16, padding: 3, borderRadius: radii.md, backgroundColor: colors.soft, flexShrink: 0 },
  tab:      { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md - 2 },
  tabOn:    { backgroundColor: colors.card },
  tabText:  { ...type.small, color: colors.textSecondary },
  tabTextOn:{ fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  doc:      { flex: 1, marginTop: 12, marginHorizontal: 16, borderRadius: radii.card, backgroundColor: colors.card },
  docBody:  { padding: 16, paddingBottom: 24 },
  fallback: { ...type.small, color: colors.textSecondary, marginBottom: 12 },
  docText:  { fontSize: 13, lineHeight: 22, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  footer:   { paddingHorizontal: 16, paddingTop: 12, flexShrink: 0 },
})
