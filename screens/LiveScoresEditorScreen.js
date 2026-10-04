import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, Alert, Platform, Modal,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker'
import { supabase } from '../lib/supabase'
import { colors, type, radii, press, TAP } from '../constants/theme'
import { t } from '../constants/i18n'
import {
  ScreenHeader as UiHeader, Card, Button, ErrorState, EmptyState, CardSkeleton, haptic,
} from '../components/ui'

// Skor editörü — hand entry for TRNC (KTFF) football, which no API covers.
//
// WHO GETS HERE: an admin (AdminScreen) or a user with a live_score_editors row (the pencil
// on LiveScoresScreen). The screen is not the boundary — RLS is: an editor can write only
// source='manual' rows in a manual league (20261070). A write the database refuses shows
// the save error and the screen rolls back to what it had.
//
// Everything is written straight to the row, so viewers see it within a second through
// Realtime. Built for the touchline: one-thumb, 64pt score buttons, no typing needed for
// a goal (the scorer name is optional).

const pad2 = n => String(n).padStart(2, '0')
const fmtKickoff = iso => { const d = new Date(iso); return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)} · ${pad2(d.getHours())}:${pad2(d.getMinutes())}` }
const fill = (s, vars) => Object.entries(vars).reduce((a, [k, v]) => a.replace(`{${k}}`, String(v)), s)
const FIXTURE_COLS = 'id, league_id, status, period, minute, home_score, away_score, kickoff_at, '
  + 'home:teams!matches_home_team_fkey(id, name), away:teams!matches_away_team_fkey(id, name)'

function defaultKickoff() {
  const d = new Date()
  d.setHours(19, 0, 0, 0)
  if (d < new Date()) d.setDate(d.getDate() + 1)
  return d
}

function saveFailed(lang) { Alert.alert(t('lsEditSaveError', lang)) }

// ─── Fixture list ────────────────────────────────────────────────────────────
function FixtureRow({ f, lang, onPress }) {
  const live = f.status === 'live' || f.status === 'ht'
  return (
    <Card onPress={onPress} accessibilityLabel={`${f.home?.name} – ${f.away?.name}`}>
      <View style={s.fxHead}>
        <Text style={s.fxWhen}>{fmtKickoff(f.kickoff_at)}</Text>
        {live && <View style={s.livePill}><View style={s.liveDot} /><Text style={s.livePillText}>{t('lsLive', lang)}</Text></View>}
        {f.status === 'ft' && <Text style={s.fxWhen}>{t('lsFullTime', lang)}</Text>}
      </View>
      <View style={s.fxTeams}>
        <Text style={s.fxTeam} numberOfLines={1}>{f.home?.name}</Text>
        <Text style={s.fxScore}>{f.status === 'scheduled' ? '–' : `${f.home_score ?? 0} : ${f.away_score ?? 0}`}</Text>
        <Text style={[s.fxTeam, s.fxTeamAway]} numberOfLines={1}>{f.away?.name}</Text>
      </View>
    </Card>
  )
}

// ─── New fixture ─────────────────────────────────────────────────────────────
function TeamPicker({ label, teams, value, onChange, otherId }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <View style={s.chips}>
        {teams.map(tm => {
          const on = value === tm.id
          const off = otherId === tm.id
          return (
            <TouchableOpacity key={tm.id} disabled={off} onPress={() => onChange(tm.id)} activeOpacity={press.small}
              style={[s.chip, on && s.chipOn, off && s.chipOff]} accessibilityRole="radio" accessibilityState={{ selected: on, disabled: off }}>
              <Text style={[s.chipText, on && s.chipTextOn]} numberOfLines={1}>{tm.name}</Text>
            </TouchableOpacity>
          )
        })}
      </View>
    </View>
  )
}

function NewFixture({ lang, league, teams, onTeamAdded, onCreated }) {
  const [homeId, setHomeId] = useState(null)
  const [awayId, setAwayId] = useState(null)
  const [kickoff, setKickoff] = useState(defaultKickoff)
  const [iosPicker, setIosPicker] = useState(false)
  const [newTeam, setNewTeam] = useState('')
  const [busy, setBusy] = useState(false)

  function openPicker() {
    if (Platform.OS === 'ios') { setIosPicker(true); return }
    // Android has no combined date-time picker: date, then time.
    DateTimePickerAndroid.open({
      value: kickoff, mode: 'date',
      onChange: (_, date) => {
        if (!date) return
        DateTimePickerAndroid.open({
          value: kickoff, mode: 'time', is24Hour: true,
          onChange: (__, time) => {
            if (!time) return
            const d = new Date(date); d.setHours(time.getHours(), time.getMinutes(), 0, 0); setKickoff(d)
          },
        })
      },
    })
  }

  async function addTeam() {
    const name = newTeam.trim().slice(0, 80)
    if (!name) return
    setBusy(true)
    const { data, error } = await supabase.from('teams')
      .insert({ sport: 'football', name, source: 'manual' }).select('id, name').single()
    setBusy(false)
    if (error) { saveFailed(lang); return }
    setNewTeam('')
    onTeamAdded(data)
    if (!homeId) setHomeId(data.id); else if (!awayId) setAwayId(data.id)
  }

  async function create() {
    if (!homeId || !awayId || homeId === awayId) { Alert.alert(t('lsEditSameTeam', lang)); return }
    setBusy(true)
    const { data, error } = await supabase.from('matches').insert({
      sport: 'football', league_id: league.id, home_team_id: homeId, away_team_id: awayId,
      kickoff_at: kickoff.toISOString(), source: 'manual',
    }).select('id').single()
    setBusy(false)
    if (error) { saveFailed(lang); return }
    onCreated(data.id)
  }

  return (
    <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
      <Card>
        <Text style={s.cardTitle}>{league.name}</Text>
        <TeamPicker label={t('lsEditHome', lang)} teams={teams} value={homeId} onChange={setHomeId} otherId={awayId} />
        <TeamPicker label={t('lsEditAway', lang)} teams={teams} value={awayId} onChange={setAwayId} otherId={homeId} />
        <View style={s.addTeamRow}>
          <TextInput style={s.input} value={newTeam} onChangeText={setNewTeam} placeholder={t('lsEditNewTeam', lang)}
            placeholderTextColor={colors.textSecondary} maxLength={80} returnKeyType="done" onSubmitEditing={addTeam} />
          <Button variant="secondary" icon="add" title={t('lsEditAddTeam', lang)} onPress={addTeam} disabled={!newTeam.trim() || busy} />
        </View>
        <View style={s.field}>
          <Text style={s.fieldLabel}>{t('lsEditKickoff', lang)}</Text>
          <TouchableOpacity style={s.dateBtn} onPress={openPicker} activeOpacity={press.small} accessibilityRole="button">
            <Ionicons name="calendar-outline" size={18} color={colors.primaryDark} />
            <Text style={s.dateText}>{fmtKickoff(kickoff.toISOString())}</Text>
          </TouchableOpacity>
        </View>
        <Button title={t('lsEditCreate', lang)} onPress={create} loading={busy} disabled={!homeId || !awayId} fullWidth style={s.createBtn} />
      </Card>

      <Modal visible={iosPicker === true} transparent animationType="fade" onRequestClose={() => setIosPicker(false)}>
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={() => setIosPicker(false)} />
        <View style={s.sheet}>
          <View style={s.sheetHead}>
            <Text style={s.cardTitle}>{t('lsEditKickoff', lang)}</Text>
            <TouchableOpacity onPress={() => setIosPicker(false)} hitSlop={12}><Text style={s.done}>{t('lsEditDone', lang)}</Text></TouchableOpacity>
          </View>
          <DateTimePicker value={kickoff} mode="datetime" display="spinner" onChange={(_, d) => d && setKickoff(d)} style={{ alignSelf: 'stretch' }} />
        </View>
      </Modal>
    </ScrollView>
  )
}

// ─── Live control ────────────────────────────────────────────────────────────
function BigButton({ icon, onPress, label, disabled }) {
  return (
    <TouchableOpacity style={[s.bigBtn, icon === 'remove' && s.bigBtnMinus, disabled && s.off]} onPress={onPress} disabled={disabled}
      activeOpacity={press.small} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={34} color={icon === 'remove' ? colors.primaryDark : colors.onPrimary} />
    </TouchableOpacity>
  )
}

function SideControl({ name, score, scorer, setScorer, onPlus, onMinus, lang, enabled }) {
  return (
    <View style={s.side}>
      <Text style={s.sideName} numberOfLines={2}>{name}</Text>
      <Text style={s.bigScore} accessibilityLiveRegion="polite">{score ?? 0}</Text>
      <View style={s.bigRow}>
        <BigButton icon="remove" onPress={onMinus} disabled={!enabled || !score} label={fill(t('lsEditScoreDown', lang), { team: name })} />
        <BigButton icon="add" onPress={onPlus} disabled={!enabled} label={fill(t('lsEditScoreUp', lang), { team: name })} />
      </View>
      <TextInput style={[s.input, s.scorerInput]} value={scorer} onChangeText={setScorer} placeholder={t('lsEditScorer', lang)}
        placeholderTextColor={colors.textSecondary} maxLength={80} editable={enabled} />
    </View>
  )
}

function MatchControl({ lang, matchId, onDeleted }) {
  const [m, setM] = useState(null)
  const [events, setEvents] = useState([])
  const [error, setError] = useState(false)
  const [scorer, setScorer] = useState({ home: '', away: '' })

  const load = useCallback(async () => {
    const [mr, er] = await Promise.all([
      supabase.from('matches').select(FIXTURE_COLS).eq('id', matchId).maybeSingle(),
      supabase.from('match_events').select('id, type, team_side, player_name, minute').eq('match_id', matchId).order('id'),
    ])
    if (mr.error || er.error || !mr.data) { setError(true); return }
    setM(mr.data); setEvents(er.data); setError(false)
  }, [matchId])

  useEffect(() => { load() }, [load])

  // Optimistic: the screen moves first, the row follows; a refused write rolls back.
  async function patch(p) {
    const before = m
    setM({ ...m, ...p })
    const { error: e } = await supabase.from('matches').update(p).eq('id', matchId)
    if (e) { setM(before); saveFailed(lang) }
  }

  async function goal(side) {
    haptic()
    const key = side === 'home' ? 'home_score' : 'away_score'
    const before = m
    const next = { [key]: (m[key] ?? 0) + 1 }
    setM({ ...m, ...next })
    const { error: e1 } = await supabase.from('matches').update(next).eq('id', matchId)
    if (e1) { setM(before); saveFailed(lang); return }
    const name = scorer[side].trim().slice(0, 80) || null
    const { data, error: e2 } = await supabase.from('match_events')
      .insert({ match_id: matchId, type: 'goal', team_side: side, player_name: name, minute: m.minute ?? null })
      .select('id, type, team_side, player_name, minute').single()
    if (e2) { saveFailed(lang); return }
    setEvents(ev => [...ev, data])
    setScorer(sc => ({ ...sc, [side]: '' }))
  }

  async function ungoal(side) {
    const key = side === 'home' ? 'home_score' : 'away_score'
    if (!m[key]) return
    haptic()
    await patch({ [key]: m[key] - 1 })
    const last = [...events].reverse().find(e => e.team_side === side && e.type === 'goal')
    if (last) removeEvent(last.id)
  }

  async function removeEvent(id) {
    const before = events
    setEvents(ev => ev.filter(e => e.id !== id))
    const { error: e } = await supabase.from('match_events').delete().eq('id', id)
    if (e) { setEvents(before); saveFailed(lang) }
  }

  function confirmDelete() {
    Alert.alert(t('lsEditDeleteConfirm', lang), undefined, [
      { text: t('lsEditCancel', lang), style: 'cancel' },
      { text: t('lsEditDelete', lang), style: 'destructive', onPress: async () => {
        const { error: e } = await supabase.from('matches').delete().eq('id', matchId)
        if (e) saveFailed(lang); else onDeleted()
      } },
    ])
  }

  if (error) return <ErrorState lang={lang} onRetry={load} />
  if (!m) return <View style={s.scroll}><CardSkeleton /></View>

  const live = m.status === 'live'
  const enabled = live || m.status === 'ht' || m.status === 'ft'
  // The next step of a match, in order. Full-time stays reachable from any live state.
  let primary = null
  if (m.status === 'scheduled') primary = { title: t('lsEditStart', lang), p: { status: 'live', period: '1H', minute: 1, home_score: m.home_score ?? 0, away_score: m.away_score ?? 0 } }
  else if (live && m.period !== '2H') primary = { title: t('lsEditHalfTime', lang), p: { status: 'ht', period: 'HT' } }
  else if (m.status === 'ht') primary = { title: t('lsEditSecondHalf', lang), p: { status: 'live', period: '2H', minute: Math.max(46, m.minute ?? 46) } }
  else if (live) primary = { title: t('lsEditFullTime', lang), p: { status: 'ft', period: null, minute: null } }
  const showFullTime = (live && m.period !== '2H') || m.status === 'ht'

  return (
    <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
      <Card>
        <View style={s.fxHead}>
          <Text style={s.fxWhen}>{fmtKickoff(m.kickoff_at)}</Text>
          {live && <View style={s.livePill}><View style={s.liveDot} /><Text style={s.livePillText}>{m.minute != null ? `${m.minute}'` : t('lsLive', lang)}</Text></View>}
          {m.status === 'ht' && <Text style={s.htText}>{t('lsHalfTime', lang)}</Text>}
          {m.status === 'ft' && <Text style={s.fxWhen}>{t('lsFullTime', lang)}</Text>}
        </View>
        <View style={s.board}>
          <SideControl name={m.home?.name} score={m.home_score} scorer={scorer.home} setScorer={v => setScorer(sc => ({ ...sc, home: v }))}
            onPlus={() => goal('home')} onMinus={() => ungoal('home')} lang={lang} enabled={enabled} />
          <SideControl name={m.away?.name} score={m.away_score} scorer={scorer.away} setScorer={v => setScorer(sc => ({ ...sc, away: v }))}
            onPlus={() => goal('away')} onMinus={() => ungoal('away')} lang={lang} enabled={enabled} />
        </View>

        {live && (
          <View style={s.minuteRow}>
            <Text style={s.fieldLabel}>{t('lsEditMinute', lang)}</Text>
            <View style={s.stepper}>
              <TouchableOpacity style={s.stepBtn} onPress={() => patch({ minute: Math.max(0, (m.minute ?? 0) - 1) })}
                accessibilityRole="button" accessibilityLabel="-1"><Ionicons name="remove" size={22} color={colors.primaryDark} /></TouchableOpacity>
              <Text style={s.minuteValue}>{m.minute ?? 0}'</Text>
              <TouchableOpacity style={s.stepBtn} onPress={() => patch({ minute: Math.min(200, (m.minute ?? 0) + 1) })}
                accessibilityRole="button" accessibilityLabel="+1"><Ionicons name="add" size={22} color={colors.primaryDark} /></TouchableOpacity>
              <TouchableOpacity style={s.stepBtn} onPress={() => patch({ minute: Math.min(200, (m.minute ?? 0) + 5) })}
                accessibilityRole="button" accessibilityLabel="+5"><Text style={s.stepText}>+5</Text></TouchableOpacity>
            </View>
          </View>
        )}

        {!!primary && <Button title={primary.title} onPress={() => patch(primary.p)} fullWidth style={s.createBtn} />}
        {showFullTime && (
          <Button variant="secondary" title={t('lsEditFullTime', lang)} onPress={() => patch({ status: 'ft', period: null, minute: null })} fullWidth style={s.gap8} />
        )}
      </Card>

      {events.length > 0 && (
        <Card padding={0}>
          <Text style={[s.cardTitle, s.cardTitlePad]}>{t('lsEditGoals', lang)}</Text>
          {events.map(e => (
            <View key={e.id} style={s.eventRow}>
              <Ionicons name="football-outline" size={16} color={colors.textSecondary} />
              <Text style={s.eventText} numberOfLines={1}>
                {`${e.minute != null ? `${e.minute}' ` : ''}${e.player_name || '—'} · ${e.team_side === 'home' ? m.home?.name : m.away?.name}`}
              </Text>
              <TouchableOpacity onPress={() => removeEvent(e.id)} style={s.removeBtn} accessibilityRole="button" accessibilityLabel={t('lsEditRemove', lang)}>
                <Text style={s.removeText}>{t('lsEditRemove', lang)}</Text>
              </TouchableOpacity>
            </View>
          ))}
        </Card>
      )}

      <Button variant="text" icon="trash-outline" title={t('lsEditDelete', lang)} onPress={confirmDelete} />
    </ScrollView>
  )
}

// ─── Screen ──────────────────────────────────────────────────────────────────
export default function LiveScoresEditorScreen({ lang, onBack, backRef = null }) {
  const [view, setView] = useState('list')        // 'list' | 'new' | <match id>
  const [league, setLeague] = useState(null)
  const [teams, setTeams] = useState([])
  const [fixtures, setFixtures] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 3 * 86400000).toISOString()
    const [lg, tm, fx] = await Promise.all([
      supabase.from('leagues').select('id, name').eq('sport', 'football').eq('source', 'manual').order('sort_order').limit(1),
      supabase.from('teams').select('id, name').eq('sport', 'football').eq('source', 'manual').order('name'),
      supabase.from('matches').select(FIXTURE_COLS).eq('sport', 'football').eq('source', 'manual')
        .gte('kickoff_at', since).order('kickoff_at'),
    ])
    if (lg.error || tm.error || fx.error) { setError(true); setLoading(false); return }
    setLeague(lg.data[0] || null); setTeams(tm.data); setFixtures(fx.data); setError(false); setLoading(false)
  }, [])

  useEffect(() => { if (view === 'list') load() }, [view, load])

  useEffect(() => {
    if (!backRef) return
    backRef.current = () => { if (view !== 'list') { setView('list'); return true } return false }
    return () => { backRef.current = null }
  }, [backRef, view])

  const back = view === 'list' ? onBack : () => setView('list')
  const title = view === 'new' ? t('lsEditNewFixture', lang) : t('lsEditOpen', lang)

  let body
  if (loading) body = <View style={s.scroll}><CardSkeleton /><CardSkeleton /></View>
  else if (error) body = <ErrorState lang={lang} onRetry={() => { setLoading(true); load() }} />
  else if (!league) body = <ErrorState lang={lang} message={t('uiLoadFailed', lang)} onRetry={load} />
  else if (view === 'new') {
    body = <NewFixture lang={lang} league={league} teams={teams}
      onTeamAdded={tm => setTeams(ts => [...ts, tm].sort((a, b) => a.name.localeCompare(b.name)))}
      onCreated={id => setView(id)} />
  } else if (view !== 'list') {
    body = <MatchControl lang={lang} matchId={view} onDeleted={() => setView('list')} />
  } else {
    body = (
      <ScrollView contentContainerStyle={s.scroll}>
        <Button icon="add" title={t('lsEditNewFixture', lang)} onPress={() => setView('new')} fullWidth />
        {fixtures.length === 0
          ? <EmptyState icon="football-outline" category="explore" title={league.name} message={t('lsEditNoFixtures', lang)} />
          : fixtures.map(f => <FixtureRow key={f.id} f={f} lang={lang} onPress={() => setView(f.id)} />)}
      </ScrollView>
    )
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <UiHeader lang={lang} title={title} onBack={back} />
      {body}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: colors.canvas },
  scroll:      { padding: 16, paddingBottom: 48, gap: 12 },
  cardTitle:   { ...type.sheetTitle, color: colors.textPrimary },
  cardTitlePad:{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },

  fxHead:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  fxWhen:      { ...type.meta, color: colors.textSecondary },
  fxTeams:     { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8 },
  fxTeam:      { ...type.rowTitle, color: colors.textPrimary, flex: 1 },
  fxTeamAway:  { textAlign: 'right' },
  fxScore:     { ...type.sectionHeading, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  livePill:    { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.dangerLight,
                 borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 3 },
  liveDot:     { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.dangerInk },
  livePillText:{ ...type.meta, fontFamily: 'Inter_700Bold', color: colors.dangerInk },
  htText:      { ...type.meta, fontFamily: 'Inter_600SemiBold', color: colors.dangerInk },

  field:       { marginTop: 16, gap: 8 },
  fieldLabel:  { ...type.meta, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  chips:       { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:        { minHeight: 40, maxWidth: '100%', paddingHorizontal: 14, justifyContent: 'center', borderRadius: radii.pill,
                 borderWidth: 1, borderColor: colors.fieldBorder, backgroundColor: 'transparent' },
  chipOn:      { backgroundColor: colors.primary, borderColor: colors.primary },
  chipOff:     { opacity: 0.35 },
  chipText:    { ...type.small, fontFamily: 'Inter_600SemiBold', color: colors.textPrimary },
  chipTextOn:  { color: colors.onPrimary },
  addTeamRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  input:       { flex: 1, minHeight: TAP, borderWidth: 1, borderColor: colors.fieldBorder, borderRadius: radii.sm,
                 paddingHorizontal: 12, ...type.body, color: colors.textPrimary, backgroundColor: colors.card },
  dateBtn:     { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: TAP, paddingHorizontal: 12,
                 borderWidth: 1, borderColor: colors.fieldBorder, borderRadius: radii.sm, backgroundColor: 'transparent' },
  dateText:    { ...type.body, color: colors.textPrimary },
  createBtn:   { marginTop: 20 },
  gap8:        { marginTop: 8 },

  board:       { flexDirection: 'row', gap: 12, marginTop: 12 },
  side:        { flex: 1, alignItems: 'center', gap: 10 },
  sideName:    { ...type.rowTitle, color: colors.textPrimary, textAlign: 'center', minHeight: 40 },
  bigScore:    { fontSize: 56, lineHeight: 64, fontFamily: 'Inter_700Bold', color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  bigRow:      { flexDirection: 'row', gap: 10 },
  bigBtn:      { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  bigBtnMinus: { backgroundColor: colors.primaryLight },
  off:         { opacity: 0.35 },
  scorerInput: { flex: 0, alignSelf: 'stretch' },

  minuteRow:   { marginTop: 20, gap: 8 },
  stepper:     { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn:     { width: TAP + 4, height: TAP + 4, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center',
                 backgroundColor: colors.primaryLight },
  stepText:    { ...type.rowTitle, color: colors.primaryDark },
  minuteValue: { ...type.detailTitle, color: colors.textPrimary, minWidth: 64, textAlign: 'center', fontVariant: ['tabular-nums'] },

  eventRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, minHeight: TAP + 4,
                 borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  eventText:   { ...type.body, color: colors.textPrimary, flex: 1 },
  removeBtn:   { minHeight: TAP, justifyContent: 'center', paddingHorizontal: 4 },
  removeText:  { ...type.small, fontFamily: 'Inter_600SemiBold', color: colors.dangerInk },

  backdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet:       { backgroundColor: colors.card, borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet, padding: 16, paddingBottom: 32 },
  sheetHead:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  done:        { ...type.rowTitle, color: colors.primaryDark },
})
