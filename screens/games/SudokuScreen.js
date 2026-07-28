import { useState, useEffect, useRef } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, InteractionManager } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import AsyncStorage from '@react-native-async-storage/async-storage'
import ScreenHeader from '../../components/ScreenHeader'
import ContentCard from '../../components/ContentCard'
import { colors, spacing, radius, fontSize, shadow, gameColors } from '../../constants/theme'
import { t } from '../../constants/i18n'
import { generate } from './sudokuEngine'

const STORE_KEY = 'ada_games_sudoku_v1'
const EMPTY_BEST = { easy: null, medium: null, hard: null }

const DARK = colors.textPrimary
const LIGHT = colors.border
const boxOf = i => Math.floor(Math.floor(i / 9) / 3) * 3 + Math.floor((i % 9) / 3)

function fmtTime(sec) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function SudokuScreen({ lang, onBack }) {
  const [diff, setDiff] = useState('easy')
  const [generating, setGenerating] = useState(true)
  const [solution, setSolution] = useState([])
  const [given, setGiven] = useState([])
  const [cells, setCells] = useState([])              // [{ value, notes:number[] }]
  const [selected, setSelected] = useState(null)
  const [notesMode, setNotesMode] = useState(false)
  const [checkMode, setCheckMode] = useState(false)   // default OFF (purist)
  const [undo, setUndo] = useState([])
  const [seconds, setSeconds] = useState(0)
  const [won, setWon] = useState(false)
  const [best, setBest] = useState(EMPTY_BEST)

  const timerRef = useRef(null)

  function stopTimer() { clearInterval(timerRef.current); timerRef.current = null }
  function startTimer() {
    if (timerRef.current) return
    timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000)
  }

  function startGeneration(d) {
    stopTimer()
    setGenerating(true); setWon(false); setSelected(null); setUndo([]); setSeconds(0)
    InteractionManager.runAfterInteractions(() => {
      const { puzzle, solution: sol } = generate(d)
      setSolution(sol)
      setGiven(puzzle.map(v => v !== 0))
      setCells(puzzle.map(v => ({ value: v, notes: [] })))
      setGenerating(false)
      startTimer()
    })
  }

  // Load best + generate the first puzzle.
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const raw = await AsyncStorage.getItem(STORE_KEY)
        if (raw && alive) {
          const p = JSON.parse(raw)
          setBest({ easy: p?.easy ?? null, medium: p?.medium ?? null, hard: p?.hard ?? null })
        }
      } catch {}
    })()
    startGeneration('easy')
    return () => { alive = false; stopTimer() }
  }, [])

  function changeDifficulty(d) {
    if (d === diff) return
    setDiff(d)
    startGeneration(d)
  }

  function commit(index, newCell, nextCellsForWin = true) {
    setUndo(u => [...u, { index, value: cells[index].value, notes: [...cells[index].notes] }])
    const next = [...cells]
    next[index] = newCell
    setCells(next)
    if (nextCellsForWin) maybeWin(next)
  }

  function maybeWin(next) {
    if (won || generating) return
    if (next.length === 81 && next.every((c, i) => c.value === solution[i])) {
      setWon(true)
      stopTimer()
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      const prev = best[diff]
      if (!prev || seconds < prev.bestTimeSec) {
        const merged = { ...best, [diff]: { bestTimeSec: seconds } }
        setBest(merged)
        ;(async () => { try { await AsyncStorage.setItem(STORE_KEY, JSON.stringify(merged)) } catch {} })()
      }
    }
  }

  function pressNumber(n) {
    if (won || generating || selected == null || given[selected]) return
    const cell = cells[selected]
    if (notesMode) {
      if (cell.value !== 0) return
      const has = cell.notes.includes(n)
      const notes = has ? cell.notes.filter(x => x !== n) : [...cell.notes, n].sort((a, b) => a - b)
      commit(selected, { value: 0, notes }, false)
    } else {
      commit(selected, { value: n, notes: [] })
      if (n === solution[selected]) Haptics.selectionAsync().catch(() => {})
    }
  }

  function erase() {
    if (won || generating || selected == null || given[selected]) return
    if (cells[selected].value === 0 && cells[selected].notes.length === 0) return
    commit(selected, { value: 0, notes: [] }, false)
  }

  function hint() {
    if (won || generating) return
    let target = (selected != null && !given[selected] && cells[selected].value === 0) ? selected : null
    if (target == null) target = cells.findIndex((c, i) => !given[i] && c.value === 0)
    if (target == null || target < 0) return
    setSelected(target)
    commit(target, { value: solution[target], notes: [] })
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
  }

  function doUndo() {
    if (won || generating || undo.length === 0) return
    const last = undo[undo.length - 1]
    setUndo(u => u.slice(0, -1))
    const next = [...cells]
    next[last.index] = { value: last.value, notes: [...last.notes] }
    setCells(next)
  }

  const selVal = selected != null ? cells[selected]?.value : 0
  const selR = selected != null ? Math.floor(selected / 9) : -1
  const selC = selected != null ? selected % 9 : -1
  const selBox = selected != null ? boxOf(selected) : -1
  const bestForDiff = best[diff]

  function cellBg(i) {
    if (selected == null) return colors.cardBg
    if (i === selected) return gameColors.sudoku.selected
    const c = cells[i]
    if (selVal > 0 && c.value === selVal) return gameColors.sudoku.sameValue
    const r = Math.floor(i / 9), col = i % 9
    if (r === selR || col === selC || boxOf(i) === selBox) return gameColors.sudoku.peer
    return colors.cardBg
  }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <ScreenHeader onBack={onBack} lang={lang} title={t('gamesSudokuTitle', lang)} />

      <View style={s.body}>
        <View style={s.diffRow}>
          {[['easy', t('gamesSudokuEasy', lang)], ['medium', t('gamesSudokuMedium', lang)], ['hard', t('gamesSudokuHard', lang)]].map(([key, label]) => (
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

        <View style={s.infoRow}>
          <Text style={s.timer}>{t('gamesSudokuTime', lang)} <Text style={s.timerNum}>{fmtTime(seconds)}</Text></Text>
          <TouchableOpacity
            style={[s.checkPill, checkMode && s.checkPillActive]}
            onPress={() => setCheckMode(v => !v)}
            activeOpacity={0.8}
          >
            <Ionicons name={checkMode ? 'checkmark-circle' : 'ellipse-outline'} size={15} color={checkMode ? '#FFFFFF' : colors.textSecondary} />
            <Text style={[s.checkText, checkMode && s.checkTextActive]} numberOfLines={1}>{t('gamesSudokuCheck', lang)}</Text>
          </TouchableOpacity>
        </View>

        <View style={s.boardWrap}>
          {generating ? (
            <View style={[s.board, s.generating]}>
              <ActivityIndicator color={colors.primary} />
              <Text style={s.generatingText}>{t('gamesSudokuGenerating', lang)}</Text>
            </View>
          ) : (
            <View style={s.board}>
              {cells.map((cell, i) => {
                const r = Math.floor(i / 9), c = i % 9
                const isGiven = given[i]
                const wrong = checkMode && !isGiven && cell.value !== 0 && cell.value !== solution[i]
                return (
                  <TouchableOpacity
                    key={i}
                    activeOpacity={0.7}
                    onPress={() => setSelected(i)}
                    style={[s.cell, {
                      backgroundColor: cellBg(i),
                      borderTopWidth: r % 3 === 0 ? 2 : 0.5,   borderTopColor: r % 3 === 0 ? DARK : LIGHT,
                      borderLeftWidth: c % 3 === 0 ? 2 : 0.5,  borderLeftColor: c % 3 === 0 ? DARK : LIGHT,
                      borderRightWidth: c === 8 ? 2 : 0,       borderRightColor: DARK,
                      borderBottomWidth: r === 8 ? 2 : 0,      borderBottomColor: DARK,
                    }]}
                  >
                    {cell.value > 0 ? (
                      <Text style={[s.cellText, { color: wrong ? colors.danger : isGiven ? colors.textPrimary : colors.primary,
                                                  fontFamily: isGiven ? 'Inter_700Bold' : 'Inter_600SemiBold' }]}>
                        {cell.value}
                      </Text>
                    ) : cell.notes.length > 0 ? (
                      <View style={s.notes}>
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
                          <Text key={n} style={s.noteDigit}>{cell.notes.includes(n) ? n : ''}</Text>
                        ))}
                      </View>
                    ) : null}
                  </TouchableOpacity>
                )
              })}
            </View>
          )}

          {won && (
            <View style={s.overlay}>
              <ContentCard style={s.overCard}>
                <Text style={s.overTitle}>{t('gamesSudokuWin', lang)}</Text>
                <Text style={s.overStat}>{t('gamesSudokuTime', lang)}: <Text style={s.overNum}>{fmtTime(seconds)}</Text></Text>
                {bestForDiff && <Text style={s.overBest}>{t('gamesSudokuBest', lang)}: {fmtTime(bestForDiff.bestTimeSec)}</Text>}
                <View style={s.overActions}>
                  <TouchableOpacity style={[s.overBtn, s.overPrimary]} onPress={() => startGeneration(diff)} activeOpacity={0.85}>
                    <Text style={s.overPrimaryText}>{t('gamesSudokuNewGame', lang)}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.overBtn, s.overSecondary]} onPress={() => changeDifficulty(diff === 'easy' ? 'medium' : diff === 'medium' ? 'hard' : 'easy')} activeOpacity={0.85}>
                    <Text style={s.overSecondaryText}>{t('gamesSudokuChangeDifficulty', lang)}</Text>
                  </TouchableOpacity>
                </View>
              </ContentCard>
            </View>
          )}
        </View>

        <View style={s.pad}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
            <TouchableOpacity key={n} style={s.padBtn} onPress={() => pressNumber(n)} activeOpacity={0.7}>
              <Text style={s.padText}>{n}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={s.helperRow}>
          {[
            { key: 'notes', icon: 'create-outline',      label: t('gamesSudokuNotes', lang), onPress: () => setNotesMode(v => !v), active: notesMode },
            { key: 'hint',  icon: 'bulb-outline',        label: t('gamesSudokuHint', lang),  onPress: hint },
            { key: 'undo',  icon: 'arrow-undo-outline',  label: t('gamesSudokuUndo', lang),  onPress: doUndo },
            { key: 'erase', icon: 'backspace-outline',   label: t('gamesSudokuErase', lang), onPress: erase },
          ].map(b => (
            <TouchableOpacity key={b.key} style={[s.helperBtn, b.active && s.helperBtnActive]} onPress={b.onPress} activeOpacity={0.75}>
              <Ionicons name={b.icon} size={22} color={b.active ? colors.primary : colors.textSecondary} />
              <Text style={[s.helperLabel, b.active && { color: colors.primary }]}>{b.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: colors.bg },
  body:      { flex: 1, padding: spacing.md },

  diffRow:   { flexDirection: 'row', alignSelf: 'center', backgroundColor: colors.border, borderRadius: radius.lg, padding: 4, marginBottom: spacing.sm },
  diffBtn:   { paddingVertical: 8, paddingHorizontal: 18, borderRadius: radius.md },
  diffBtnActive: { backgroundColor: colors.cardBg, ...shadow },
  diffText:  { fontSize: fontSize.sm, fontFamily: 'Inter_600SemiBold', color: colors.textSecondary },
  diffTextActive: { color: colors.textPrimary },

  infoRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  timer:     { fontSize: fontSize.md, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  timerNum:  { fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  checkPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.lg, backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.border },
  checkPillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkText: { fontSize: fontSize.sm, fontFamily: 'Inter_600SemiBold', color: colors.textSecondary },
  checkTextActive: { color: '#FFFFFF' },

  boardWrap: { position: 'relative' },
  board:     { width: '100%', aspectRatio: 1, flexDirection: 'row', flexWrap: 'wrap', borderWidth: 2, borderColor: DARK, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.cardBg },
  generating: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  generatingText: { fontSize: fontSize.md, fontFamily: 'Inter_600SemiBold', color: colors.textSecondary },
  cell:      { width: `${100 / 9}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  cellText:  { fontSize: 22 },
  notes:     { width: '100%', height: '100%', flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 1 },
  noteDigit: { width: `${100 / 3}%`, height: `${100 / 3}%`, fontSize: 8, textAlign: 'center', color: colors.textSecondary, fontFamily: 'Inter_400Regular' },

  overlay:   { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  overCard:  { alignItems: 'center', paddingHorizontal: spacing.lg },
  overTitle: { fontSize: fontSize.xl, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: spacing.sm },
  overStat:  { fontSize: fontSize.md, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  overNum:   { fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  overBest:  { fontSize: fontSize.sm, fontFamily: 'Inter_600SemiBold', color: colors.primary, marginTop: 4, marginBottom: spacing.md },
  overActions: { flexDirection: 'row', gap: spacing.md },
  overBtn:   { flex: 1, paddingVertical: 12, paddingHorizontal: spacing.md, borderRadius: radius.md, alignItems: 'center' },
  overPrimary: { backgroundColor: colors.primary },
  overPrimaryText: { fontSize: fontSize.sm, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  overSecondary: { backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.border },
  overSecondaryText: { fontSize: fontSize.sm, fontFamily: 'Inter_600SemiBold', color: colors.textPrimary },

  pad:       { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md },
  padBtn:    { flex: 1, marginHorizontal: 2, aspectRatio: 1, maxHeight: 48, backgroundColor: colors.cardBg, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', ...shadow },
  padText:   { fontSize: fontSize.lg, fontFamily: 'Inter_700Bold', color: colors.primary },

  helperRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: spacing.md },
  helperBtn: { alignItems: 'center', gap: 3, paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.md },
  helperBtnActive: { backgroundColor: colors.primaryLight },
  helperLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: colors.textSecondary },
})
