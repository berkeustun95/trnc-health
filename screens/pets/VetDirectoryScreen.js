import { useState, useEffect } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Linking } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons, Feather } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { colors, shadow, radius, typeColors } from '../../constants/theme'
import { t } from '../../constants/i18n'

function VetCard({ vet, lang, onPress }) {
  const vetColors = typeColors.vet
  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={0.85}>
      <View style={s.cardHeader}>
        <View style={[s.typeBadge, { backgroundColor: vetColors.bg }]}>
          <Text style={[s.typeBadgeText, { color: vetColors.text }]}>{t('petsVetType', lang)}</Text>
        </View>
        {vet.verified && (
          <View style={s.verifiedBadge}>
            <Ionicons name="checkmark-circle" size={13} color={colors.success} />
            <Text style={s.verifiedText}>{t('verified', lang)}</Text>
          </View>
        )}
      </View>
      <Text style={s.cardName}>{vet.name}</Text>
      {vet.address ? (
        <View style={s.cardRow}>
          <Feather name="map-pin" size={13} color={colors.textSecondary} />
          <Text style={s.cardRowText} numberOfLines={1}>{vet.address}</Text>
        </View>
      ) : null}
      {vet.phone ? (
        <View style={s.cardRow}>
          <Feather name="phone" size={13} color={colors.textSecondary} />
          <Text style={s.cardRowText}>{vet.phone}</Text>
        </View>
      ) : null}
      {vet.specialties?.length > 0 && (
        <View style={s.specialtiesRow}>
          {vet.specialties.slice(0, 3).map(sp => (
            <View key={sp} style={s.specialtyPill}>
              <Text style={s.specialtyPillText}>{sp}</Text>
            </View>
          ))}
          {vet.specialties.length > 3 && (
            <Text style={s.specialtyMore}>+{vet.specialties.length - 3}</Text>
          )}
        </View>
      )}
      <View style={s.cardFooter}>
        <Text style={s.viewProfile}>{t('viewProfile', lang)}</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.primary} />
      </View>
    </TouchableOpacity>
  )
}

export default function VetDirectoryScreen({ lang, onBack, onOpenVet }) {
  const [vets, setVets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    loadVets()
  }, [])

  async function loadVets() {
    setLoading(true)
    setError(false)
    const { data, error: err } = await supabase
      .from('facilities')
      .select('*')
      .eq('type', 'vet')
      .order('verified', { ascending: false })
      .order('name', { ascending: true })
    if (err) {
      setError(true)
    } else {
      setVets(data || [])
    }
    setLoading(false)
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity style={s.backPill} onPress={onBack}>
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
          <Text style={s.backPillText}>{t('back', lang)}</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>{t('petsVetDirectoryTitle', lang)}</Text>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error ? (
        <View style={s.center}>
          <Ionicons name="wifi-outline" size={40} color={colors.border} style={{ marginBottom: 12 }} />
          <Text style={s.emptyTitle}>{t('facilityLoadError', lang)}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={loadVets}>
            <Text style={s.retryBtnText}>{t('tryAgain', lang)}</Text>
          </TouchableOpacity>
        </View>
      ) : vets.length === 0 ? (
        <View style={s.center}>
          <View style={s.emptyIcon}>
            <Ionicons name="paw-outline" size={36} color={colors.border} />
          </View>
          <Text style={s.emptyTitle}>{t('petsNoVets', lang)}</Text>
          <Text style={s.emptySub}>{t('petsNoVetsSub', lang)}</Text>
        </View>
      ) : (
        <FlatList
          data={vets}
          keyExtractor={item => item.id}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <VetCard vet={item} lang={lang} onPress={() => onOpenVet(item)} />
          )}
        />
      )}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: colors.bg },
  header:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.cardBg, borderBottomWidth: 1, borderBottomColor: colors.border },
  backPill:         { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.bg, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12 },
  backPillText:     { fontSize: 14, color: colors.textPrimary, fontFamily: 'Inter_400Regular' },
  headerTitle:      { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, flex: 1, textAlign: 'center' },
  center:           { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyIcon:        { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.border, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  emptyTitle:       { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textAlign: 'center', marginBottom: 8 },
  emptySub:         { fontSize: 14, color: colors.textSecondary, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20 },
  retryBtn:         { marginTop: 16, backgroundColor: colors.primary, borderRadius: radius.sm, paddingVertical: 10, paddingHorizontal: 24 },
  retryBtnText:     { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
  list:             { padding: 16, paddingBottom: 40 },
  card:             { backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 16, marginBottom: 12, ...shadow },
  cardHeader:       { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  typeBadge:        { borderRadius: 8, paddingVertical: 3, paddingHorizontal: 10 },
  typeBadgeText:    { fontSize: 12, fontFamily: 'Inter_700Bold' },
  verifiedBadge:    { flexDirection: 'row', alignItems: 'center', gap: 4 },
  verifiedText:     { fontSize: 12, color: colors.success, fontFamily: 'Inter_400Regular' },
  cardName:         { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 8 },
  cardRow:          { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 5 },
  cardRowText:      { fontSize: 13, color: colors.textSecondary, fontFamily: 'Inter_400Regular', flex: 1 },
  specialtiesRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6, marginBottom: 4 },
  specialtyPill:    { backgroundColor: colors.bg, borderRadius: 8, paddingVertical: 3, paddingHorizontal: 8, borderWidth: 1, borderColor: colors.border },
  specialtyPillText: { fontSize: 11, color: colors.textSecondary, fontFamily: 'Inter_400Regular' },
  specialtyMore:    { fontSize: 12, color: colors.textSecondary, fontFamily: 'Inter_400Regular', alignSelf: 'center' },
  cardFooter:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 10, gap: 4 },
  viewProfile:      { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary },
})
