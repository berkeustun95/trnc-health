import { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { colors } from '../constants/theme'
import { t } from '../constants/i18n'
import BackButton from '../components/BackButton'
import { legalDoc, isLegalFallback, LEGAL_TITLE_KEY } from '../constants/legal'

// ─── THE DOCUMENTS MOVED OUT (2026-09-12) ───────────────────────────────────
//
// PRIVACY and TERMS used to be two ~13KB template literals at the top of this file.
// There are four of them now — privacy and terms, English and Turkish — and they live in
// constants/legal/. See that file's header for why, and note that BOTH repo guards
// extract from there now, not from here.
//
// This screen no longer knows what any document says. It asks legalDoc() for one.

export default function LegalScreen({ onBack, lang, initialTab = 'privacy' }) {
  const [tab, setTab] = useState(initialTab)

  // DERIVED, never a list of the seven locales without a translation. The day a body is
  // added for one of them, this stops firing for that locale on its own — a hardcoded
  // list would go on telling a Greek reader their document is English-only while they
  // are reading it in Greek.
  const body     = legalDoc(tab, lang)
  const fallback = isLegalFallback(tab, lang)

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.container}>
        <View style={s.header}>
          <BackButton lang={lang} onPress={onBack} style={s.backBtn} />
          <Text style={s.title}>{t(LEGAL_TITLE_KEY[tab], lang)}</Text>
          <View style={s.headerRight} />
        </View>

        <View style={s.tabRow}>
          <TouchableOpacity
            style={[s.tabBtn, tab === 'privacy' && s.tabBtnActive]}
            onPress={() => setTab('privacy')}
          >
            <Text style={[s.tabText, tab === 'privacy' && s.tabTextActive]}>{t('privacyPolicy', lang)}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.tabBtn, tab === 'terms' && s.tabBtnActive]}
            onPress={() => setTab('terms')}
          >
            <Text style={[s.tabText, tab === 'terms' && s.tabTextActive]}>{t('termsOfService', lang)}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.body}>
          {/* Shown at the TOP of the document rather than only at the tick, because this
              is the moment a reader discovers the language is not theirs and it should
              not be a surprise they have to infer. Same key as the signup checkbox. */}
          {fallback && <Text style={s.fallbackNote}>{t('legalAvailableInEnTr', lang)}</Text>}
          <Text style={s.bodyText}>{body}</Text>
        </ScrollView>
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: colors.bg },
  container:   { flex: 1, paddingHorizontal: 16 },
  header:      { flexDirection: 'row', alignItems: 'center', paddingTop: 16, paddingBottom: 16 },
  backBtn:     { flexDirection: 'row', alignItems: 'center', gap: 2, minWidth: 70 },
  title:       { flex: 1, fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textAlign: 'center' },
  headerRight: { minWidth: 70 },
  tabRow:      { flexDirection: 'row', backgroundColor: colors.border, borderRadius: 12, padding: 3, marginBottom: 20 },
  tabBtn:      { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center' },
  tabBtnActive:{ backgroundColor: colors.surface, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  tabText:     { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  tabTextActive:{ fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  body:        { paddingBottom: 48 },
  bodyText:    { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 22 },
  fallbackNote:{ fontSize: 12.5, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                 lineHeight: 19, marginBottom: 16, paddingBottom: 14,
                 borderBottomWidth: 1, borderBottomColor: colors.border },
})
