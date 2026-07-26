import { useState, useEffect, useRef } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import AsyncStorage from '@react-native-async-storage/async-storage'
import ScreenHeader from '../../components/ScreenHeader'
import ContentCard from '../../components/ContentCard'
import { colors, spacing, radius, fontSize, shadow } from '../../constants/theme'
import { t } from '../../constants/i18n'

const STATS_KEY = 'ada_games_xox_v1'
const EMPTY_STATS = {
  vsAi:     { wins: 0, losses: 0, draws: 0 },
  vsFriend: { xWins: 0, oWins: 0, draws: 0 },
}

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
]

function calcWinner(board) {
  for (const line of LINES) {
    const [a, b, c] = line
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return { winner: board[a], line }
  }
  return null
}

// Oli plays 'O', human plays 'X'. Competent, not unbeatable:
// win > block > center > corner > random.
function bestAiMove(board) {
  const empty = board.map((v, i) => (v ? null : i)).filter(i => i !== null)
  for (const i of empty) {
    const next = [...board]; next[i] = 'O'
    if (calcWinner(next)) return i
  }
  for (const i of empty) {
    const next = [...board]; next[i] = 'X'
    if (calcWinner(next)) return i
  }
  if (board[4] === null) return 4
  const corners = [0, 2, 6, 8].filter(i => board[i] === null)
  if (corners.length) return corners[Math.floor(Math.random() * corners.length)]
  return empty[Math.floor(Math.random() * empty.length)]
}

const freshBoard = () => Array(9).fill(null)

// Mark art: Maki is the X (human) mark, Oli the O mark — in both modes.
const MARK_IMG = {
  X: require('../../assets/maki-button.png'),
  O: require('../../assets/oli-button.png'),
}

export default function XoxGameScreen({ lang, onBack }) {
  const [mode, setMode] = useState('ai')          // 'ai' | 'friend'
  const [board, setBoard] = useState(freshBoard)
  const [result, setResult] = useState(null)      // { winner, line } | 'draw' | null
  const [stats, setStats] = useState(EMPTY_STATS)

  const cellAnims = useRef([...Array(9)].map(() => new Animated.Value(0))).current
  const winPulse  = useRef(new Animated.Value(0)).current
  const finishedRef = useRef(false)
  const aiTimer = useRef(null)

  // Load persisted stats once.
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const raw = await AsyncStorage.getItem(STATS_KEY)
        if (raw && alive) {
          const parsed = JSON.parse(raw)
          setStats({
            vsAi:     { ...EMPTY_STATS.vsAi, ...(parsed?.vsAi || {}) },
            vsFriend: { ...EMPTY_STATS.vsFriend, ...(parsed?.vsFriend || {}) },
          })
        }
      } catch {}
    })()
    return () => { alive = false }
  }, [])

  async function persist(next) {
    setStats(next)
    try { await AsyncStorage.setItem(STATS_KEY, JSON.stringify(next)) } catch {}
  }

  function finalize(res) {
    if (finishedRef.current) return
    finishedRef.current = true
    setResult(res)

    if (res !== 'draw') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      Animated.loop(
        Animated.sequence([
          Animated.timing(winPulse, { toValue: 1, duration: 450, useNativeDriver: false }),
          Animated.timing(winPulse, { toValue: 0, duration: 450, useNativeDriver: false }),
        ]),
      ).start()
    }

    const next = { vsAi: { ...stats.vsAi }, vsFriend: { ...stats.vsFriend } }
    if (mode === 'ai') {
      if (res === 'draw') next.vsAi.draws += 1
      else if (res.winner === 'X') next.vsAi.wins += 1
      else next.vsAi.losses += 1
    } else {
      if (res === 'draw') next.vsFriend.draws += 1
      else if (res.winner === 'X') next.vsFriend.xWins += 1
      else next.vsFriend.oWins += 1
    }
    persist(next)
  }

  function placeMark(index, symbol) {
    setBoard(prev => {
      if (prev[index]) return prev
      const next = [...prev]
      next[index] = symbol
      return next
    })
    cellAnims[index].setValue(0)
    Animated.spring(cellAnims[index], { toValue: 1, friction: 5, tension: 140, useNativeDriver: true }).start()
  }

  // Board-driven engine: detect end, else drive Oli's turn.
  useEffect(() => {
    if (finishedRef.current) return
    const win = calcWinner(board)
    if (win) { finalize(win); return }
    if (board.every(Boolean)) { finalize('draw'); return }

    const xCount = board.filter(v => v === 'X').length
    const oCount = board.filter(v => v === 'O').length
    const turn = xCount === oCount ? 'X' : 'O'
    if (mode === 'ai' && turn === 'O') {
      aiTimer.current = setTimeout(() => placeMark(bestAiMove(board), 'O'), 420)
      return () => clearTimeout(aiTimer.current)
    }
  }, [board, mode])

  function handlePress(index) {
    if (result || board[index]) return
    const xCount = board.filter(v => v === 'X').length
    const oCount = board.filter(v => v === 'O').length
    const turn = xCount === oCount ? 'X' : 'O'
    if (mode === 'ai' && turn === 'O') return   // Oli is thinking
    placeMark(index, turn)
  }

  function resetGame() {
    if (aiTimer.current) clearTimeout(aiTimer.current)
    finishedRef.current = false
    winPulse.stopAnimation(); winPulse.setValue(0)
    cellAnims.forEach(a => a.setValue(0))
    setResult(null)
    setBoard(freshBoard())
  }

  function switchMode(next) {
    if (next === mode) return
    setMode(next)
    resetGame()
  }

  // Turn / result banner text.
  const xCount = board.filter(v => v === 'X').length
  const oCount = board.filter(v => v === 'O').length
  const turn = xCount === oCount ? 'X' : 'O'

  let banner
  if (result === 'draw') {
    banner = t('gamesXoxDraw', lang)
  } else if (result) {
    if (mode === 'ai') banner = result.winner === 'X' ? t('gamesXoxWin', lang) : t('gamesXoxLose', lang)
    else banner = `🏆 ${result.winner}`
  } else if (mode === 'ai' && turn === 'O') {
    banner = 'Oli…'
  } else if (mode === 'friend') {
    banner = turn === 'X' ? t('gamesXoxMakisTurn', lang) : t('gamesXoxOlisTurnLocal', lang)
  } else {
    banner = t('gamesXoxYourTurn', lang)
  }

  const winLine = result && result !== 'draw' ? result.line : []
  const modeStats = mode === 'ai' ? stats.vsAi : stats.vsFriend
  const xStat = mode === 'ai' ? modeStats.wins : modeStats.xWins
  const oStat = mode === 'ai' ? modeStats.losses : modeStats.oWins

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <ScreenHeader onBack={onBack} lang={lang} title={t('gamesXoxTitle', lang)} />

      <View style={s.body}>
        <View style={s.modeRow}>
          {[['ai', t('gamesXoxVsAi', lang)], ['friend', t('gamesXoxVsFriend', lang)]].map(([key, label]) => (
            <TouchableOpacity
              key={key}
              style={[s.modeBtn, mode === key && s.modeBtnActive]}
              onPress={() => switchMode(key)}
              activeOpacity={0.8}
            >
              <Text style={[s.modeText, mode === key && s.modeTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={s.banner}>{banner}</Text>

        <View style={s.board}>
          {board.map((cell, i) => {
            const inWin = winLine.includes(i)
            const bg = inWin
              ? winPulse.interpolate({ inputRange: [0, 1], outputRange: [colors.primaryLight, colors.tintLifestyleBg] })
              : colors.cardBg
            return (
              <TouchableOpacity key={i} style={s.cellWrap} activeOpacity={0.7} onPress={() => handlePress(i)}>
                <Animated.View style={[s.cell, { backgroundColor: bg }]}>
                  {cell && (
                    <Animated.Image
                      source={MARK_IMG[cell]}
                      resizeMode="contain"
                      style={[s.mark, { transform: [{ scale: cellAnims[i] }], opacity: cellAnims[i] }]}
                    />
                  )}
                </Animated.View>
              </TouchableOpacity>
            )
          })}
        </View>

        <ContentCard style={s.statsCard}>
          <View style={s.statCol}>
            <Text style={[s.statNum, { color: colors.primary }]}>{xStat}</Text>
            <Text style={s.statLabel}>X</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.statCol}>
            <Text style={[s.statNum, { color: colors.accent }]}>{oStat}</Text>
            <Text style={s.statLabel}>O</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.statCol}>
            <Text style={s.statNum}>{modeStats.draws}</Text>
            <Text style={s.statLabel}>{t('gamesXoxDraw', lang)}</Text>
          </View>
        </ContentCard>

        {result && (
          <View style={s.actions}>
            <TouchableOpacity style={[s.actionBtn, s.actionPrimary]} onPress={resetGame} activeOpacity={0.85}>
              <Text style={s.actionPrimaryText}>{t('gamesXoxPlayAgain', lang)}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.actionBtn, s.actionSecondary]}
              onPress={() => switchMode(mode === 'ai' ? 'friend' : 'ai')}
              activeOpacity={0.85}
            >
              <Text style={s.actionSecondaryText}>{t('gamesXoxChangeMode', lang)}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: colors.bg },
  body:      { flex: 1, padding: spacing.md, alignItems: 'center' },

  modeRow:   { flexDirection: 'row', backgroundColor: colors.border, borderRadius: radius.lg, padding: 4, marginBottom: spacing.md },
  modeBtn:   { paddingVertical: 8, paddingHorizontal: 20, borderRadius: radius.md },
  modeBtnActive: { backgroundColor: colors.cardBg, ...shadow },
  modeText:  { fontSize: fontSize.sm, fontFamily: 'Inter_600SemiBold', color: colors.textSecondary },
  modeTextActive: { color: colors.textPrimary },

  banner:    { fontSize: fontSize.lg, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: spacing.md, minHeight: 28 },

  board:     { width: 300, height: 300, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  cellWrap:  { width: '31%', height: '31%' },
  cell:      { flex: 1, borderRadius: radius.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  mark:      { width: '78%', height: '78%' },

  statsCard: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg, paddingVertical: spacing.md, width: '100%' },
  statCol:   { flex: 1, alignItems: 'center' },
  statNum:   { fontSize: fontSize.lg, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  statLabel: { fontSize: fontSize.sm, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 2 },
  statDivider: { width: 1, height: 32, backgroundColor: colors.border },

  actions:   { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg, width: '100%' },
  actionBtn: { flex: 1, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center' },
  actionPrimary: { backgroundColor: colors.primary },
  actionPrimaryText: { fontSize: fontSize.md, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  actionSecondary: { backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.border },
  actionSecondaryText: { fontSize: fontSize.md, fontFamily: 'Inter_600SemiBold', color: colors.textPrimary },
})
