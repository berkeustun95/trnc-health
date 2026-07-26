import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import ScreenHeader from '../../components/ScreenHeader'
import ContentCard from '../../components/ContentCard'
import { colors, spacing, radius, fontSize } from '../../constants/theme'
import { t } from '../../constants/i18n'

// Locked-game display names are hardcoded proper nouns this slice — each gets a
// real i18n key when its own slice ships (Memory Match → 2, 2048 → 3, Sudoku → 4).
const LOCKED = []

export default function GamesHubScreen({ lang, onBack, onNavigate }) {
  const tint = { bg: colors.tintLifestyleBg, fg: colors.tintLifestyleFg }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <ScreenHeader onBack={onBack} lang={lang} title={t('gamesHubTitle', lang)} />

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.grid}>
          <TouchableOpacity
            style={s.tileWrap}
            activeOpacity={0.85}
            onPress={() => onNavigate('xox')}
          >
            <ContentCard style={s.tile}>
              <View style={[s.iconCircle, { backgroundColor: tint.bg }]}>
                <Ionicons name="grid-outline" size={30} color={tint.fg} />
              </View>
              <Text style={s.tileLabel} numberOfLines={1}>{t('gamesXoxTitle', lang)}</Text>
            </ContentCard>
          </TouchableOpacity>

          <TouchableOpacity
            style={s.tileWrap}
            activeOpacity={0.85}
            onPress={() => onNavigate('memory')}
          >
            <ContentCard style={s.tile}>
              <View style={[s.iconCircle, { backgroundColor: tint.bg }]}>
                <Ionicons name="copy-outline" size={30} color={tint.fg} />
              </View>
              <Text style={s.tileLabel} numberOfLines={1}>{t('gamesMemoryTitle', lang)}</Text>
            </ContentCard>
          </TouchableOpacity>

          <TouchableOpacity
            style={s.tileWrap}
            activeOpacity={0.85}
            onPress={() => onNavigate('2048')}
          >
            <ContentCard style={s.tile}>
              <View style={[s.iconCircle, { backgroundColor: tint.bg }]}>
                <Ionicons name="dice-outline" size={30} color={tint.fg} />
              </View>
              <Text style={s.tileLabel} numberOfLines={1}>{t('games2048Title', lang)}</Text>
            </ContentCard>
          </TouchableOpacity>

          <TouchableOpacity
            style={s.tileWrap}
            activeOpacity={0.85}
            onPress={() => onNavigate('sudoku')}
          >
            <ContentCard style={s.tile}>
              <View style={[s.iconCircle, { backgroundColor: tint.bg }]}>
                <Ionicons name="apps-outline" size={30} color={tint.fg} />
              </View>
              <Text style={s.tileLabel} numberOfLines={1}>{t('gamesSudokuTitle', lang)}</Text>
            </ContentCard>
          </TouchableOpacity>

          {LOCKED.map(g => (
            <TouchableOpacity
              key={g.id}
              style={s.tileWrap}
              activeOpacity={0.85}
              onPress={() => Alert.alert(g.name, t('gamesComingSoon', lang))}
            >
              <ContentCard style={[s.tile, s.tileLocked]}>
                <View style={[s.iconCircle, { backgroundColor: colors.border }]}>
                  <Ionicons name={g.icon} size={30} color={colors.textSecondary} />
                </View>
                <Text style={[s.tileLabel, { color: colors.textSecondary }]} numberOfLines={1}>{g.name}</Text>
                <View style={s.badge}>
                  <Ionicons name="lock-closed" size={11} color={colors.textSecondary} />
                  <Text style={s.badgeText}>{t('gamesComingSoon', lang)}</Text>
                </View>
              </ContentCard>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: colors.bg },
  scroll:     { padding: spacing.md },
  grid:       { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  tileWrap:   { width: '48%', marginBottom: spacing.md },
  tile:       { alignItems: 'center', paddingVertical: spacing.lg, minHeight: 148, justifyContent: 'center' },
  tileLocked: { opacity: 0.9 },
  iconCircle: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  tileLabel:  { fontSize: fontSize.md, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textAlign: 'center' },
  badge:      { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm,
                backgroundColor: colors.border, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm },
  badgeText:  { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: colors.textSecondary },
})
