import { useState, useEffect, useRef } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import AsyncStorage from '@react-native-async-storage/async-storage'
import ScreenHeader from '../../components/ScreenHeader'
import ContentCard from '../../components/ContentCard'
import { colors, spacing, radius, fontSize, shadow, gameColors } from '../../constants/theme'
import { t } from '../../constants/i18n'

const BEST_KEY = 'ada_games_memory_v1'
const EMPTY_BEST = { easy: null, hard: null }

// Nine distinct hues drawn from the theme palette; cycled across the faces so
// the first 8 (Easy) are all different colours and no pair reads alike.
const PALETTE = gameColors.memoryTints

// 18 recognisable, non-confusable filled Ionicons. Easy uses the first 8.
const ICONS = [
  'paw', 'heart', 'star', 'medkit', 'car', 'boat', 'umbrella', 'key',
  'cafe', 'bicycle', 'bulb', 'balloon', 'fish', 'gift', 'moon', 'musical-notes', 'rocket', 'leaf',
]
const FACES = ICONS.map((icon, i) => ({ icon, tint: PALETTE[i % PALETTE.length] }))

const DIFF = {
  easy: { cols: 4, pairs: 8,  icon: 34 },
  hard: { cols: 6, pairs: 18, icon: 22 },
}

const MAX_CARDS = DIFF.hard.pairs * 2

function buildDeck(pairs) {
  const ids = []
  for (let i = 0; i < pairs; i++) ids.push(i, i)
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
  }
  return ids
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function MemoryMatchScreen({ lang, onBack }) {
  const [diff, setDiff] = useState('easy')
  const [deck, setDeck] = useState(() => buildDeck(DIFF.easy.pairs))
  const [flipped, setFlipped] = useState([])
  const [matched, setMatched] = useState([])
  const [lock, setLock] = useState(false)
  const [moves, setMoves] = useState(0)
  const [seconds, setSeconds] = useState(0)
  const [won, setWon] = useState(false)
  const [best, setBest] = useState(EMPTY_BEST)

  const anims = useRef([...Array(MAX_CARDS)].map(() => new Animated.Value(0))).current
  const timerRef = useRef(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const raw = await AsyncStorage.getItem(BEST_KEY)
        if (raw && alive) {
          const p = JSON.parse(raw)
          setBest({ easy: p?.easy ?? null, hard: p?.hard ?? null })
        }
      } catch {}
    })()
    return () => { alive = false; clearInterval(timerRef.current) }
  }, [])

  function startTimer() {
    if (timerRef.current) return
    timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000)
  }
  function stopTimer() {
    clearInterval(timerRef.current)
    timerRef.current = null
  }

  function newGame(d = diff) {
    stopTimer()
    anims.forEach(a => a.setValue(0))
    setFlipped([]); setMatched([]); setLock(false)
    setMoves(0); setSeconds(0); setWon(false)
    setDeck(buildDeck(DIFF[d].pairs))
  }

  function changeDifficulty(d) {
    if (d === diff) return
    setDiff(d)
    newGame(d)
  }

  // Win detection: every card matched.
  useEffect(() => {
    if (!won && deck.length && matched.length === deck.length) {
      setWon(true)
      stopTimer()
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})

      const prev = best[diff]
      const next = {
        bestMoves:   prev?.bestMoves   == null ? moves   : Math.min(prev.bestMoves, moves),
        bestTimeSec: prev?.bestTimeSec == null ? seconds : Math.min(prev.bestTimeSec, seconds),
      }
      const merged = { ...best, [diff]: next }
      setBest(merged)
      ;(async () => { try { await AsyncStorage.setItem(BEST_KEY, JSON.stringify(merged)) } catch {} })()
    }
  }, [matched, deck])

  function flipUp(i) {
    Animated.timing(anims[i], { toValue: 1, duration: 240, useNativeDriver: true }).start()
  }
  function flipDown(i) {
    Animated.timing(anims[i], { toValue: 0, duration: 240, useNativeDriver: true }).start()
  }

  function handlePress(i) {
    if (lock || won) return
    if (flipped.includes(i) || matched.includes(i) || flipped.length === 2) return

    startTimer()
    flipUp(i)
    const next = [...flipped, i]
    setFlipped(next)

    if (next.length === 2) {
      setMoves(m => m + 1)
      const [a, b] = next
      if (deck[a] === deck[b]) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
        setMatched(prev => [...prev, a, b])
        setFlipped([])
      } else {
        setLock(true)
        setTimeout(() => {
          flipDown(a); flipDown(b)
          setFlipped([])
          setLock(false)
        }, 800)
      }
    }
  }

  const { cols, icon: iconSize } = DIFF[diff]
  const bestForDiff = best[diff]

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <ScreenHeader onBack={onBack} lang={lang} title={t('gamesMemoryTitle', lang)} />

      <View style={s.body}>
        <View style={s.diffRow}>
          {[['easy', t('gamesMemoryEasy', lang)], ['hard', t('gamesMemoryHard', lang)]].map(([key, label]) => (
            <TouchableOpacity
              key={key}
              style={[s.diffBtn, diff === key && s.diffBtnActive]}
              onPress={() => changeDifficulty(key)}
              activeOpacity={0.8}
            >
              <Text style={[s.diffText, diff === key && s.diffTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={s.statsRow}>
          <Text style={s.stat}>{t('gamesMemoryMoves', lang)}: <Text style={s.statNum}>{moves}</Text></Text>
          <Text style={s.stat}>{t('gamesMemoryTime', lang)}: <Text style={s.statNum}>{fmtTime(seconds)}</Text></Text>
        </View>

        <View style={s.board}>
          {deck.map((faceId, i) => {
            const face = FACES[faceId]
            const a = anims[i]
            const frontRot = a.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] })
            const backRot  = a.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] })
            return (
              <View key={i} style={[s.cellWrap, { width: `${100 / cols}%` }]}>
                <TouchableOpacity style={s.cell} activeOpacity={0.85} onPress={() => handlePress(i)}>
                  <Animated.View style={[s.face, s.faceFront, { transform: [{ perspective: 1000 }, { rotateY: frontRot }] }]}>
                    <Ionicons name={face.icon} size={iconSize} color={face.tint} />
                  </Animated.View>
                  <Animated.View style={[s.face, s.faceBack, { transform: [{ perspective: 1000 }, { rotateY: backRot }] }]}>
                    <Ionicons name="game-controller-outline" size={iconSize - 4} color="rgba(255,255,255,0.9)" />
                  </Animated.View>
                </TouchableOpacity>
              </View>
            )
          })}
        </View>

        {won && (
          <ContentCard style={s.winCard}>
            <Text style={s.winTitle}>{t('gamesMemoryWin', lang)}</Text>
            <Text style={s.winStat}>
              {t('gamesMemoryMoves', lang)}: <Text style={s.statNum}>{moves}</Text>   ·   {t('gamesMemoryTime', lang)}: <Text style={s.statNum}>{fmtTime(seconds)}</Text>
            </Text>
            {bestForDiff && (
              <Text style={s.winBest}>
                {t('gamesMemoryBest', lang)}: {bestForDiff.bestMoves} {t('gamesMemoryMoves', lang).toLowerCase()} · {fmtTime(bestForDiff.bestTimeSec)}
              </Text>
            )}
            <View style={s.actions}>
              <TouchableOpacity style={[s.actionBtn, s.actionPrimary]} onPress={() => newGame()} activeOpacity={0.85}>
                <Text style={s.actionPrimaryText}>{t('gamesMemoryPlayAgain', lang)}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.actionBtn, s.actionSecondary]}
                onPress={() => changeDifficulty(diff === 'easy' ? 'hard' : 'easy')}
                activeOpacity={0.85}
              >
                <Text style={s.actionSecondaryText}>{t('gamesMemoryChangeDifficulty', lang)}</Text>
              </TouchableOpacity>
            </View>
          </ContentCard>
        )}
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: colors.bg },
  body:      { flex: 1, padding: spacing.md },

  diffRow:   { flexDirection: 'row', alignSelf: 'center', backgroundColor: colors.border, borderRadius: radius.lg, padding: 4, marginBottom: spacing.md },
  diffBtn:   { paddingVertical: 8, paddingHorizontal: 24, borderRadius: radius.md },
  diffBtnActive: { backgroundColor: colors.cardBg, ...shadow },
  diffText:  { fontSize: fontSize.sm, fontFamily: 'Inter_600SemiBold', color: colors.textSecondary },
  diffTextActive: { color: colors.textPrimary },

  statsRow:  { flexDirection: 'row', justifyContent: 'space-around', marginBottom: spacing.md },
  stat:      { fontSize: fontSize.md, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  statNum:   { fontFamily: 'Inter_700Bold', color: colors.textPrimary },

  board:     { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  cellWrap:  { padding: 4 },
  cell:      { width: '100%', aspectRatio: 1 },
  face:      { ...StyleSheet.absoluteFillObject, borderRadius: radius.card, alignItems: 'center', justifyContent: 'center', backfaceVisibility: 'hidden' },
  faceFront: { backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.border },
  faceBack:  { backgroundColor: colors.primary },

  winCard:   { marginTop: spacing.lg, alignItems: 'center' },
  winTitle:  { fontSize: fontSize.xl, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: spacing.sm },
  winStat:   { fontSize: fontSize.md, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginBottom: 4 },
  winBest:   { fontSize: fontSize.sm, fontFamily: 'Inter_600SemiBold', color: colors.primary, marginBottom: spacing.md },
  actions:   { flexDirection: 'row', gap: spacing.md, width: '100%' },
  actionBtn: { flex: 1, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center' },
  actionPrimary: { backgroundColor: colors.primary },
  actionPrimaryText: { fontSize: fontSize.md, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  actionSecondary: { backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.border },
  actionSecondaryText: { fontSize: fontSize.md, fontFamily: 'Inter_600SemiBold', color: colors.textPrimary },
})
