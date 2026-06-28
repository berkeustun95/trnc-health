import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import PageBackground from '../../components/PageBackground'
import { colors, shadow, radius } from '../../constants/theme'
import { t } from '../../constants/i18n'

const JOURNEYS = [
  {
    titleKey:  'petsJourney1Title',
    subKey:    'petsJourney1Sub',
    icon:      'airplane-outline',
    iconBg:    '#E6F4F4',
    iconColor: colors.primary,
    dest:      'bringing',
  },
  {
    titleKey:  'petsJourney2Title',
    subKey:    'petsJourney2Sub',
    icon:      'compass-outline',
    iconBg:    '#FFF0EB',
    iconColor: colors.accent,
    dest:      'travel',
  },
  {
    titleKey:  'petsJourney3Title',
    subKey:    'petsJourney3Sub',
    icon:      'paw-outline',
    iconBg:    '#E6F5ED',
    iconColor: colors.success,
    dest:      'owning',
  },
]

function JourneyCard({ item, lang, onPress }) {
  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={0.8}>
      <View style={[s.iconWrap, { backgroundColor: item.iconBg }]}>
        <Ionicons name={item.icon} size={26} color={item.iconColor} />
      </View>
      <View style={s.cardBody}>
        <Text style={s.cardTitle}>{t(item.titleKey, lang)}</Text>
        <Text style={s.cardSub} numberOfLines={2}>{t(item.subKey, lang)}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
    </TouchableOpacity>
  )
}

export default function PetsHomeScreen({ lang, onBack, onNavigate }) {
  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <PageBackground topic="pets" />
      <View style={s.header}>
        <TouchableOpacity style={s.backPill} onPress={onBack}>
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
          <Text style={s.backPillText}>{t('back', lang)}</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>{t('petsTitle', lang)}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.heroBadge}>
          <Ionicons name="paw" size={28} color={colors.primary} />
        </View>
        <Text style={s.heroText}>{t('petsSubtitle', lang)}</Text>

        {JOURNEYS.map((item, i) => (
          <JourneyCard
            key={i}
            item={item}
            lang={lang}
            onPress={() => onNavigate(item.dest)}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: colors.bg },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.cardBg, borderBottomWidth: 1, borderBottomColor: colors.border },
  backPill:      { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.bg, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12 },
  backPillText:  { fontSize: 14, color: colors.textPrimary, fontFamily: 'Inter_400Regular' },
  headerTitle:   { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, flex: 1, textAlign: 'center' },
  scroll:        { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  heroBadge:     { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.primaryLight, justifyContent: 'center', alignItems: 'center', alignSelf: 'center', marginBottom: 8, marginTop: 8 },
  heroText:      { fontSize: 14, color: colors.textSecondary, textAlign: 'center', fontFamily: 'Inter_400Regular', marginBottom: 24, paddingHorizontal: 20, lineHeight: 20 },
  card:          { backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 16, flexDirection: 'row', alignItems: 'center', marginBottom: 12, ...shadow },
  iconWrap:      { width: 48, height: 48, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginRight: 14, flexShrink: 0 },
  cardBody:      { flex: 1 },
  cardTitle:     { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 3 },
  cardSub:       { fontSize: 13, color: colors.textSecondary, fontFamily: 'Inter_400Regular', lineHeight: 18 },
})
