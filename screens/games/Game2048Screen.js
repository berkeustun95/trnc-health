import { useState, useEffect, useRef } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, PanResponder } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import AsyncStorage from '@react-native-async-storage/async-storage'
import ScreenHeader from '../../components/ScreenHeader'
import ContentCard from '../../components/ContentCard'
import { colors, spacing, radius, fontSize, shadow, gameColors } from '../../constants/theme'
import { t } from '../../constants/i18n'

const STORE_KEY = 'ada_games_2048_v1'
const SIZE = 4
const SWIPE_MIN = 24

const tileStyle = v => gameColors.tile2048[v] || gameColors.tile2048.high

const emptyBoard = () => Array.from({ length: SIZE }, () => Array(SIZE).fill(0))

function spawn(board) {
  const empties = []
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (board[r][c] === 0) empties.push([r, c])
  if (!empties.length) return board
  const [r, c] = empties[Math.floor(Math.random() * empties.length)]
  const next = board.map(row => [...row])
  next[r][c] = Math.random() < 0.9 ? 2 : 4
  return next
}

function newBoard() {
  return spawn(spawn(emptyBoard()))
}

// Slide + merge a single row to the LEFT. Returns [row, gained].
function slideRow(row) {
  const nums = row.filter(v => v !== 0)
  let gained = 0
  for (let i = 0; i < nums.length - 1; i++) {
    if (nums[i] === nums[i + 1]) {
      nums[i] *= 2
      gained += nums[i]
      nums.splice(i + 1, 1)
    }
  }
  while (nums.length < SIZE) nums.push(0)
  return [nums, gained]
}

const transpose = b => b[0].map((_, c) => b.map(row => row[c]))
const reverseRows = b => b.map(row => [...row].reverse())

// Apply a move in `dir`. Returns { board, gained, changed }.
function move(board, dir) {
  let work = board.map(row => [...row])
  if (dir === 'up') work = transpose(work)
  else if (dir === 'down') work = reverseRows(transpose(work))
  else if (dir === 'right') work = reverseRows(work)

  let gained = 0
  work = work.map(row => {
    const [slid, g] = slideRow(row)
    gained += g
    return slid
  })

  if (dir === 'up') work = transpose(work)
  else if (dir === 'down') work = transpose(reverseRows(work))
  else if (dir === 'right') work = reverseRows(work)

  const changed = JSON.stringify(work) !== JSON.stringify(board)
  return { board: work, gained, changed }
}

function isGameOver(board) {
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    if (board[r][c] === 0) return false
    if (c < SIZE - 1 && board[r][c] === board[r][c + 1]) return false
    if (r < SIZE - 1 && board[r][c] === board[r + 1][c]) return false
  }
  return true
}

const maxTile = board => Math.max(...board.flat())

export default function Game2048Screen({ lang, onBack }) {
  const [board, setBoard] = useState(newBoard)
  const [score, setScore] = useState(0)
  const [best, setBest] = useState(0)
  const [highest, setHighest] = useState(0)
  const [over, setOver] = useState(false)

  // Live refs so the once-created PanResponder never reads stale state (OliGuide pattern).
  const boardRef = useRef(board)
  const scoreRef = useRef(0)
  const bestRef = useRef(0)
  const highestRef = useRef(0)
  const overRef = useRef(false)
  boardRef.current = board
  scoreRef.current = score
  overRef.current = over

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const raw = await AsyncStorage.getItem(STORE_KEY)
        if (raw && alive) {
          const p = JSON.parse(raw)
          if (typeof p?.bestScore === 'number') { setBest(p.bestScore); bestRef.current = p.bestScore }
          if (typeof p?.highestTile === 'number') { setHighest(p.highestTile); highestRef.current = p.highestTile }
        }
      } catch {}
    })()
    return () => { alive = false }
  }, [])

  async function persist(nextBest, nextHighest) {
    try { await AsyncStorage.setItem(STORE_KEY, JSON.stringify({ bestScore: nextBest, highestTile: nextHighest })) } catch {}
  }

  function applyMove(dir) {
    if (overRef.current) return
    const { board: moved, gained, changed } = move(boardRef.current, dir)
    if (!changed) return

    const spawned = spawn(moved)
    boardRef.current = spawned
    setBoard(spawned)

    const nextScore = scoreRef.current + gained
    scoreRef.current = nextScore
    setScore(nextScore)

    const nextBest = Math.max(bestRef.current, nextScore)
    if (nextBest !== bestRef.current) { bestRef.current = nextBest; setBest(nextBest) }

    const top = maxTile(spawned)
    const nextHighest = Math.max(highestRef.current, top)
    if (nextHighest !== highestRef.current) { highestRef.current = nextHighest; setHighest(nextHighest) }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})

    if (isGameOver(spawned)) {
      overRef.current = true
      setOver(true)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
      persist(nextBest, nextHighest)
    }
  }

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderRelease: (_, g) => {
        if (Math.max(Math.abs(g.dx), Math.abs(g.dy)) < SWIPE_MIN) return
        const dir = Math.abs(g.dx) > Math.abs(g.dy)
          ? (g.dx > 0 ? 'right' : 'left')
          : (g.dy > 0 ? 'down' : 'up')
        applyMove(dir)
      },
    }),
  ).current

  function newGame() {
    const b = newBoard()
    boardRef.current = b; setBoard(b)
    scoreRef.current = 0; setScore(0)
    overRef.current = false; setOver(false)
    const top = maxTile(b)
    const nextHighest = Math.max(highestRef.current, top)
    if (nextHighest !== highestRef.current) { highestRef.current = nextHighest; setHighest(nextHighest) }
  }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <ScreenHeader onBack={onBack} lang={lang} title={t('games2048Title', lang)} />

      <View style={s.body}>
        <View style={s.scoreRow}>
          <View style={s.scoreBox}>
            <Text style={s.scoreLabel}>{t('games2048Score', lang)}</Text>
            <Text style={s.scoreVal}>{score}</Text>
          </View>
          <View style={s.scoreBox}>
            <Text style={s.scoreLabel}>{t('games2048Best', lang)}</Text>
            <Text style={s.scoreVal}>{best}</Text>
          </View>
          <View style={s.scoreBox}>
            <Text style={s.scoreLabel}>{t('games2048HighestTile', lang)}</Text>
            <Text style={s.scoreVal}>{highest}</Text>
          </View>
        </View>

        <View style={s.boardWrap}>
          <View style={s.board} {...pan.panHandlers}>
            {board.map((row, r) => (
              <View key={r} style={s.row}>
                {row.map((v, c) => {
                  const st = tileStyle(v)
                  const digits = String(v).length
                  const fs = digits >= 4 ? 22 : digits === 3 ? 28 : 34
                  return (
                    <View key={c} style={[s.cell, { backgroundColor: v ? st.bg : colors.border }]}>
                      {v > 0 && <Text style={[s.tileText, { color: st.text, fontSize: fs }]}>{v}</Text>}
                    </View>
                  )
                })}
              </View>
            ))}
          </View>

          {over && (
            <View style={s.overlay}>
              <ContentCard style={s.overCard}>
                <Text style={s.overTitle}>{t('games2048GameOver', lang)}</Text>
                <Text style={s.overScore}>{t('games2048Score', lang)}: <Text style={s.overScoreNum}>{score}</Text></Text>
                <TouchableOpacity style={s.overBtn} onPress={newGame} activeOpacity={0.85}>
                  <Text style={s.overBtnText}>{t('games2048NewGame', lang)}</Text>
                </TouchableOpacity>
              </ContentCard>
            </View>
          )}
        </View>

        <TouchableOpacity style={s.newBtn} onPress={newGame} activeOpacity={0.85}>
          <Text style={s.newBtnText}>{t('games2048NewGame', lang)}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: colors.bg },
  body:       { flex: 1, padding: spacing.md },

  scoreRow:   { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  scoreBox:   { flex: 1, backgroundColor: colors.cardBg, borderRadius: radius.card, paddingVertical: spacing.sm, alignItems: 'center', ...shadow },
  scoreLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  scoreVal:   { fontSize: fontSize.lg, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginTop: 2 },

  boardWrap:  { position: 'relative' },
  board:      { backgroundColor: colors.cardBg, borderRadius: radius.lg, padding: 6, ...shadow },
  row:        { flexDirection: 'row' },
  cell:       { flex: 1, aspectRatio: 1, margin: 4, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  tileText:   { fontFamily: 'Inter_700Bold' },

  overlay:    { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  overCard:   { alignItems: 'center', paddingHorizontal: spacing.xl },
  overTitle:  { fontSize: fontSize.xl, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: spacing.sm },
  overScore:  { fontSize: fontSize.md, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginBottom: spacing.md },
  overScoreNum: { fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  overBtn:    { backgroundColor: colors.primary, paddingVertical: 12, paddingHorizontal: spacing.xl, borderRadius: radius.md },
  overBtnText: { fontSize: fontSize.md, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },

  newBtn:     { marginTop: spacing.lg, backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.border, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center' },
  newBtnText: { fontSize: fontSize.md, fontFamily: 'Inter_600SemiBold', color: colors.textPrimary },
})
