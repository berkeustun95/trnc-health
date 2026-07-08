import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import PageBackground from '../../components/PageBackground'
import ScreenHeader from '../../components/ScreenHeader'
import ModuleMascotBadge from '../../components/ModuleMascotBadge'
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
      <ScreenHeader onBack={onBack} title={t('petsTitle', lang)} lang={lang} />

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.heroCard}>
          <ModuleMascotBadge module="pets" style={s.heroMascot} />
          <Text style={s.heroText}>{t('petsSubtitle', lang)}</Text>
        </View>

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
  scroll:        { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  heroCard:      { backgroundColor: colors.cardBg, borderRadius: 16, padding: 16, alignItems: 'center', marginBottom: 16, ...shadow },
  heroMascot:    { marginBottom: 8 },
  heroText:      { fontSize: 14, color: colors.textSecondary, textAlign: 'center', fontFamily: 'Inter_400Regular', paddingHorizontal: 8, lineHeight: 20 },
  card:          { backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 16, flexDirection: 'row', alignItems: 'center', marginBottom: 12, ...shadow },
  iconWrap:      { width: 48, height: 48, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginRight: 14, flexShrink: 0 },
  cardBody:      { flex: 1 },
  cardTitle:     { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 3 },
  cardSub:       { fontSize: 13, color: colors.textSecondary, fontFamily: 'Inter_400Regular', lineHeight: 18 },
})
