import { useState, useEffect } from 'react'
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors, radius } from '../constants/theme'
import { t } from '../constants/i18n'
import BackButton from '../components/BackButton'
import { fetchOperator } from '../lib/connectivity'

// Bağlantı & eSIM — module landing (screen 1 of 3).
//
// SLICE 1 SCAFFOLD. The data path, the states and the route are real; the KKTCELL hero
// (brand band, logo slot, partner badge, headline, CTA) and the "Cyprus eSIM" warning card
// are slice 2. Kept deliberately plain rather than half-designed so the design pass has
// one obvious place to land.
export default function ConnectivityLandingScreen({ lang, onBack, onOpenOperator }) {
  const [operator, setOperator] = useState(null)
  const [loading, setLoading]   = useState(true)
  const [failed, setFailed]     = useState(false)

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data, error } = await fetchOperator()
      if (!active) return
      // An empty table and a failed request are DIFFERENT states and must not collapse
      // into one: "no partner configured" is a content problem, a network error is not.
      if (error) setFailed(true)
      setOperator(data)
      setLoading(false)
    })()
    return () => { active = false }
  }, [])

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <BackButton lang={lang} onPress={onBack} />
        <Text style={s.headerTitle}>{t('connTitle', lang)}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
        ) : (
          <View style={s.card}>
            <Text style={s.name}>{operator?.name ?? '—'}</Text>
            <Text style={s.meta}>
              {failed ? 'could not load' : operator ? 'operator loaded' : 'no active operator'}
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: colors.bg },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.cardBg, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle:   { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, flex: 1, textAlign: 'center' },
  scroll:        { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 48 },
  center:        { paddingVertical: 40, alignItems: 'center' },
  card:          { backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 16 },
  name:          { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  meta:          { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 4 },
})
