import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Image,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import ExploreSubmitScreen from './ExploreSubmitScreen'
import ScreenHeader from '../components/ScreenHeader'
import PageBackground from '../components/PageBackground'
import { colors, placeColors, shadow, radius } from '../constants/theme'
import { t, LANG_CODES } from '../constants/i18n'
import { categoryToGroup, GROUP_META, CATEGORY_LABEL_KEY } from '../constants/exploreCategories'

// The submitter's own rows at ANY status (places_select RLS permits submitted_by = auth.uid()).
// Columns cover what a rejected row needs to pre-fill the edit form (ExploreSubmitScreen).
const SELECT_COLS =
  'id, category, name, name_i18n, description_i18n, region, latitude, longitude, ' +
  'cover_image_url, photos, blue_flag, access_type, status, rejection_reason, created_at'

function extractI18n(obj, lang) {
  if (!obj) return ''
  if (typeof obj !== 'object') return String(obj)
  const code = LANG_CODES[lang] ?? lang
  let result = obj[code] ?? obj.en ?? Object.values(obj)[0]
  if (result != null && typeof result === 'object') result = result[code] ?? result.en ?? Object.values(result)[0]
  return result != null ? String(result) : ''
}
function placeName(p, lang) { return extractI18n(p.name_i18n, lang) || p.name || '' }
function categoryLabel(c, lang) {
  const key = CATEGORY_LABEL_KEY[c]
  return key ? t(key, lang) : c
}
function statusStyle(status) {
  if (status === 'active')   return { bg: colors.successLight, text: colors.success }
  if (status === 'rejected') return { bg: colors.dangerLight, text: colors.danger }
  return { bg: '#FFF7ED', text: '#C2410C' }   // pending
}
function statusLabel(status, lang) {
  if (status === 'active')   return t('placeStatusActive', lang)
  if (status === 'rejected') return t('placeStatusRejected', lang)
  return t('placeStatusPending', lang)
}
function groupEmoji(group) {
  if (group === 'nature')   return '🏖️'
  if (group === 'heritage') return '🏛️'
  return '📍'
}

function SubmissionCard({ item, lang, onResubmit }) {
  const group      = categoryToGroup(item.category)
  const pc         = GROUP_META[group]?.colorToken || placeColors.landmark
  const ss         = statusStyle(item.status)
  const photo      = item.cover_image_url || item.photos?.[0]
  const isRejected = item.status === 'rejected'
  return (
    <View style={s.card}>
      <View style={s.cardRow}>
        {photo
          ? <Image source={{ uri: photo }} style={s.thumb} resizeMode="cover" />
          : <View style={[s.thumb, s.thumbFallback, { backgroundColor: pc.bg }]}><Text style={s.thumbEmoji}>{groupEmoji(group)}</Text></View>}
        <View style={{ flex: 1 }}>
          <Text style={s.cardName} numberOfLines={1}>{placeName(item, lang)}</Text>
          <Text style={s.cardCat} numberOfLines={1}>{categoryLabel(item.category, lang)}</Text>
          <View style={[s.statusPill, { backgroundColor: ss.bg }]}>
            <Text style={[s.statusPillText, { color: ss.text }]}>{statusLabel(item.status, lang)}</Text>
          </View>
        </View>
      </View>
      {isRejected && item.rejection_reason ? (
        <Text style={s.rejectedReason}>{t('placeRejectedReason', lang).replace('{reason}', item.rejection_reason)}</Text>
      ) : null}
      {isRejected && (
        <TouchableOpacity style={s.resubmitBtn} onPress={() => onResubmit(item)} activeOpacity={0.85}>
          <Ionicons name="create-outline" size={16} color={colors.primary} />
          <Text style={s.resubmitBtnText}>{t('exploreEditResubmit', lang)}</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

export default function ExploreMySubmissionsScreen({ lang, session, onBack }) {
  const [items,   setItems]   = useState([])
  const [loading, setLoading] = useState(true)
  const [editPlace, setEditPlace] = useState(null)   // set → resubmit form (ExploreSubmitScreen edit mode)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('places')
      .select(SELECT_COLS)
      .eq('submitted_by', session.user.id)
      .order('created_at', { ascending: false })
    setItems(data || [])
    setLoading(false)
  }, [session.user.id])

  useEffect(() => { load() }, [load])

  if (editPlace) {
    return (
      <ExploreSubmitScreen
        session={session}
        lang={lang}
        place={editPlace}
        onBack={() => setEditPlace(null)}
        onSubmitted={() => { setEditPlace(null); load() }}
      />
    )
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <PageBackground topic="beaches_landmarks" />
      <ScreenHeader onBack={onBack} title={t('exploreMySubmissions', lang)} lang={lang} />
      {loading ? (
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={it => it.id}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => <SubmissionCard item={item} lang={lang} onResubmit={setEditPlace} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name="document-text-outline" size={40} color={colors.border} style={{ marginBottom: 10 }} />
              <Text style={s.emptyText}>{t('blNoPlaces', lang)}</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:  { flex: 1, backgroundColor: colors.bg },
  list:  { padding: 16, gap: 14, paddingBottom: 40 },

  card:  { backgroundColor: colors.cardBg, borderRadius: radius.card, borderWidth: 1,
           borderColor: colors.border, padding: 14, ...shadow },
  cardRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  thumb:         { width: 60, height: 60, borderRadius: 12, flexShrink: 0 },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  thumbEmoji:    { fontSize: 26 },
  cardName: { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  cardCat:  { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 1, marginBottom: 6 },
  statusPill:     { alignSelf: 'flex-start', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3 },
  statusPillText: { fontSize: 11, fontFamily: 'Inter_700Bold' },

  rejectedReason: { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.danger,
                    lineHeight: 18, marginTop: 10 },
  resubmitBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                    marginTop: 12, backgroundColor: colors.primaryLight, borderRadius: radius.md, paddingVertical: 11 },
  resubmitBtnText:{ fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.primary },

  empty:     { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyText: { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center' },
})
