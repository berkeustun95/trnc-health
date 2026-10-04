import { useState, useEffect, useCallback, useRef } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Image, AppState, RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase, isGuest } from '../lib/supabase'
import { colors, type, radii, press, TAP } from '../constants/theme'
import { t } from '../constants/i18n'
import {
  ScreenHeader as UiHeader, FilterBar, ErrorState, EmptyState, CardSkeleton, Card, ModuleScreen, OnPhotoLabel,
} from '../components/ui'
import LiveScoresEditorScreen from './LiveScoresEditorScreen'

// Canlı Skor. Reads Supabase only — matches/teams/match_events and f1_* — and keeps them
// current through Realtime. It never calls a sports API: the sync is server-side
// (supabase/functions/live-scores-*), and the free-plan quota is shared by every user.
//
// ONE CHANNEL, ONLY WHILE LOOKED AT. Each tab mounts its own view, which subscribes on
// mount and unsubscribes on unmount, and drops the channel while the app is backgrounded.
// Realtime connections are a project-wide quota; a channel per idle phone would spend it.

const SPORTS = ['football', 'basketball', 'f1']
const SPORT_LABEL = { football: 'lsTabFootball', basketball: 'lsTabBasketball', f1: 'lsTabF1' }
const MATCH_COLS = 'id, league_id, source, status, period, minute, clock, home_score, away_score, kickoff_at, last_synced_at, updated_at, '
  + 'home:teams!matches_home_team_fkey(name, short_name, logo_url), away:teams!matches_away_team_fkey(name, short_name, logo_url)'
const STATUS_ORDER = { live: 0, ht: 0, scheduled: 1, ft: 2, postponed: 3, suspended: 3, cancelled: 3 }

const pad2 = n => String(n).padStart(2, '0')
const hhmm = iso => { const d = new Date(iso); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}` }
const dayKey = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
const fill = (s, vars) => Object.entries(vars).reduce((a, [k, v]) => a.replace(`{${k}}`, String(v)), s)

function dayLabel(iso, lang) {
  const d = new Date(iso), now = new Date()
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  if (dayKey(d) === dayKey(now)) return t('lsToday', lang)
  if (dayKey(d) === dayKey(tomorrow)) return t('lsTomorrow', lang)
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}`
}

function updatedAgo(iso, lang) {
  if (!iso) return null
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return t('lsUpdatedJustNow', lang)
  if (mins < 60) return fill(t('lsUpdatedMinAgo', lang), { n: mins })
  return fill(t('lsUpdatedHoursAgo', lang), { n: Math.floor(mins / 60) })
}

// Re-renders every 30 s so "updated X min ago" and the F1 countdown stay true.
function useTicker(ms = 30000) {
  const [, setN] = useState(0)
  useEffect(() => { const id = setInterval(() => setN(n => n + 1), ms); return () => clearInterval(id) }, [ms])
}

function useAppActive() {
  const [active, setActive] = useState(AppState.currentState === 'active')
  useEffect(() => {
    const sub = AppState.addEventListener('change', st => setActive(st === 'active'))
    return () => sub.remove()
  }, [])
  return active
}

// ─── Status column ───────────────────────────────────────────────────────────
function StatusCell({ m, sport, lang }) {
  if (m.status === 'live') {
    const txt = sport === 'football'
      ? (m.minute != null ? `${m.minute}'` : t('lsLive', lang))
      : [m.period, m.clock != null ? `${m.clock}'` : null].filter(Boolean).join(' ')
    return (
      <View style={s.statusCol}>
        <Text style={s.statusLive} numberOfLines={1}>{txt || t('lsLive', lang)}</Text>
        <View style={s.liveDotSmall} />
      </View>
    )
  }
  const label = {
    ht: t('lsHalfTime', lang), ft: t('lsFullTime', lang), postponed: t('lsPostponed', lang),
    cancelled: t('lsCancelled', lang), suspended: t('lsSuspended', lang),
  }[m.status]
  return (
    <View style={s.statusCol}>
      <Text style={[s.statusText, m.status === 'ht' && s.statusHt]} numberOfLines={2}>{label || hhmm(m.kickoff_at)}</Text>
    </View>
  )
}

// Our team-logos bucket and nothing else (20261071): a phone never requests the provider's
// media host. The database enforces the same rule; this keeps it true if a row ever slips.
const OUR_LOGOS = '/storage/v1/object/public/team-logos/'
function TeamLogo({ uri }) {
  if (!uri || !uri.includes(OUR_LOGOS)) return <View style={[s.logo, s.logoBlank]}><Ionicons name="shield-outline" size={12} color={colors.textSecondary} /></View>
  return <Image source={{ uri }} style={s.logo} resizeMode="contain" accessibilityIgnoresInvertColors />
}

function scorerLine(events, side, lang) {
  return events
    .filter(e => e.team_side === side && (e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal'))
    .map(e => {
      const min = e.minute != null ? ` ${e.minute}${e.extra_minute ? `+${e.extra_minute}` : ''}'` : ''
      const tag = e.type === 'penalty' ? ` (${t('lsPenaltyShort', lang)})` : e.type === 'own_goal' ? ` (${t('lsOwnGoalShort', lang)})` : ''
      return `${e.player_name || '—'}${min}${tag}`
    })
    .join(', ')
}

function MatchRow({ m, sport, events, lang }) {
  const started = m.status !== 'scheduled' && m.status !== 'postponed' && m.status !== 'cancelled'
  const live = m.status === 'live' || m.status === 'ht'
  const homeName = m.home?.name || '—', awayName = m.away?.name || '—'
  const homeGoals = sport === 'football' && events?.length ? scorerLine(events, 'home', lang) : ''
  const awayGoals = sport === 'football' && events?.length ? scorerLine(events, 'away', lang) : ''
  const winHome = m.status === 'ft' && m.home_score > m.away_score
  const winAway = m.status === 'ft' && m.away_score > m.home_score
  return (
    <View style={s.row}
      accessible
      accessibilityLabel={`${homeName} ${started ? m.home_score ?? 0 : ''} – ${started ? m.away_score ?? 0 : ''} ${awayName}`}>
      <StatusCell m={m} sport={sport} lang={lang} />
      <View style={s.teams}>
        <View style={s.teamLine}>
          <TeamLogo uri={m.home?.logo_url} />
          <Text style={[s.teamName, winHome && s.winner]} numberOfLines={1}>{homeName}</Text>
          <Text style={[s.score, live && s.scoreLive, winHome && s.winner]}>{started ? (m.home_score ?? 0) : ''}</Text>
        </View>
        {!!homeGoals && <Text style={s.scorers} numberOfLines={2}>{homeGoals}</Text>}
        <View style={s.teamLine}>
          <TeamLogo uri={m.away?.logo_url} />
          <Text style={[s.teamName, winAway && s.winner]} numberOfLines={1}>{awayName}</Text>
          <Text style={[s.score, live && s.scoreLive, winAway && s.winner]}>{started ? (m.away_score ?? 0) : ''}</Text>
        </View>
        {!!awayGoals && <Text style={s.scorers} numberOfLines={2}>{awayGoals}</Text>}
      </View>
    </View>
  )
}

function LeagueSection({ league, matches, sport, eventsByMatch, connected, lang }) {
  const manual = league.source === 'manual'
  const lastSync = manual ? null : matches.reduce((a, m) => (m.last_synced_at && (!a || m.last_synced_at > a) ? m.last_synced_at : a), null)
  let lastDay = null
  return (
    <View style={s.section}>
      <View style={s.sectionHead}>
        <OnPhotoLabel style={s.leaguePill} accessibilityRole="header">{league.name}</OnPhotoLabel>
        {manual
          ? connected && (
            <View style={s.livePill}>
              <View style={s.liveDot} />
              <Text style={s.livePillText}>{t('lsLiveUpdates', lang)}</Text>
            </View>
          )
          : !!lastSync && <OnPhotoLabel style={s.metaPill} textStyle={s.metaPillText}>{updatedAgo(lastSync, lang)}</OnPhotoLabel>}
      </View>
      <Card padding={0}>
        {matches.map((m, i) => {
          const dk = dayKey(new Date(m.kickoff_at))
          const showDay = dk !== lastDay
          lastDay = dk
          return (
            <View key={m.id}>
              {showDay && <Text style={[s.dayDivider, i > 0 && s.dayDividerGap]}>{dayLabel(m.kickoff_at, lang)}</Text>}
              {!showDay && <View style={s.hairline} />}
              <MatchRow m={m} sport={sport} events={eventsByMatch[m.id]} lang={lang} />
            </View>
          )
        })}
      </Card>
    </View>
  )
}

// ─── Football / basketball ───────────────────────────────────────────────────
function MatchesView({ sport, lang }) {
  const [leagues, setLeagues] = useState([])
  const [matches, setMatches] = useState([])
  const [eventsByMatch, setEventsByMatch] = useState({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(false)
  const [connected, setConnected] = useState(false)
  const appActive = useAppActive()
  const reloadTimer = useRef(null)
  // The ids on screen, for the Realtime handler: a state updater runs later, so it cannot
  // tell the handler whether the row was already known.
  const idsRef = useRef(new Set())
  useEffect(() => { idsRef.current = new Set(matches.map(m => m.id)) }, [matches])
  useTicker()

  const load = useCallback(async () => {
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const from = new Date(Math.min(startOfToday.getTime(), now.getTime() - 6 * 3600000)).toISOString()
    const to = new Date(startOfToday.getTime() + 2 * 86400000).toISOString()
    const [lg, mt] = await Promise.all([
      supabase.from('leagues').select('id, name, source, sort_order').eq('sport', sport).eq('enabled', true).order('sort_order'),
      supabase.from('matches').select(MATCH_COLS).eq('sport', sport).gte('kickoff_at', from).lt('kickoff_at', to).order('kickoff_at'),
    ])
    if (lg.error || mt.error) { setError(true); setLoading(false); setRefreshing(false); return }
    setLeagues(lg.data)
    setMatches(mt.data)
    if (sport === 'football') {
      const ids = mt.data.filter(m => m.status !== 'scheduled').map(m => m.id)
      if (ids.length) {
        const { data: ev, error: evErr } = await supabase.from('match_events')
          .select('id, match_id, type, team_side, player_name, minute, extra_minute')
          .in('match_id', ids).order('minute', { ascending: true, nullsFirst: false })
        if (!evErr) {
          const by = {}
          for (const e of ev) (by[e.match_id] ||= []).push(e)
          setEventsByMatch(by)
        }
      } else setEventsByMatch({})
    }
    setError(false); setLoading(false); setRefreshing(false)
  }, [sport])

  const scheduleReload = useCallback(() => {
    clearTimeout(reloadTimer.current)
    reloadTimer.current = setTimeout(load, 1500)
  }, [load])

  useEffect(() => () => clearTimeout(reloadTimer.current), [])

  // Load + subscribe while the app is in front; drop the channel in the background and
  // reload on return, since anything that changed meanwhile was not delivered.
  useEffect(() => {
    if (!appActive) return
    load()
    const ch = supabase.channel(`ls-${sport}-${Date.now()}`)
      // DELETE unfiltered as well: a deleted KTFF fixture must leave every screen at once.
      // REPLICA IDENTITY FULL (20261071) lets the filtered stream carry it too; removing an
      // id that is not on screen is a no-op, so receiving it twice is harmless.
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'matches' }, p => {
        setMatches(ms => ms.filter(m => m.id !== p.old?.id))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `sport=eq.${sport}` }, p => {
        if (p.eventType === 'DELETE') { setMatches(ms => ms.filter(m => m.id !== p.old?.id)); return }
        // A match not on screen (new, or moved into the window) needs the joined read for its teams.
        if (!idsRef.current.has(p.new.id)) { scheduleReload(); return }
        setMatches(ms => ms.map(m => (m.id === p.new.id ? { ...m, ...p.new, home: m.home, away: m.away } : m)))
      })
    if (sport === 'football') {
      ch.on('postgres_changes', { event: '*', schema: 'public', table: 'match_events' }, p => {
        if (p.eventType === 'DELETE') {
          setEventsByMatch(by => {
            const next = {}
            for (const [k, list] of Object.entries(by)) next[k] = list.filter(e => e.id !== p.old.id)
            return next
          })
        } else if (p.eventType === 'INSERT') {
          setEventsByMatch(by => {
            const list = [...(by[p.new.match_id] || []).filter(e => e.id !== p.new.id), p.new]
            list.sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999))
            return { ...by, [p.new.match_id]: list }
          })
        }
      })
    }
    ch.subscribe(st => setConnected(st === 'SUBSCRIBED'))
    return () => { setConnected(false); supabase.removeChannel(ch) }
  }, [sport, appActive, load, scheduleReload])

  if (loading) return <View style={s.pad}><CardSkeleton /><CardSkeleton /><CardSkeleton /></View>
  if (error) return <ErrorState lang={lang} onRetry={() => { setLoading(true); load() }} />

  const sections = leagues
    .map(l => ({
      league: l,
      matches: matches.filter(m => m.league_id === l.id).sort((a, b) =>
        (dayKey(new Date(a.kickoff_at)) === dayKey(new Date(b.kickoff_at))
          ? (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || a.kickoff_at.localeCompare(b.kickoff_at)
          : a.kickoff_at.localeCompare(b.kickoff_at))),
    }))
    .filter(sec => sec.matches.length)

  return (
    <ScrollView contentContainerStyle={s.scroll}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor="#FFFFFF" onRefresh={() => { setRefreshing(true); load() }} />}>
      {sections.length === 0
        ? <EmptyState icon={sport === 'football' ? 'football-outline' : 'basketball-outline'} category="explore"
            title={t('lsEmptyTitle', lang)} message={t('lsEmptyBody', lang)} />
        : sections.map(sec => (
          <LeagueSection key={sec.league.id} league={sec.league} matches={sec.matches} sport={sport}
            eventsByMatch={eventsByMatch} connected={connected} lang={lang} />
        ))}
    </ScrollView>
  )
}

// ─── Formula 1 ───────────────────────────────────────────────────────────────
// API-Sports' free plan sees yesterday/today/tomorrow only, so this tab is honest about
// that: today's and tomorrow's sessions, and the live or last race result. No calendar and
// no standings — there is no free source for either that a commercial app may use.
function Countdown({ iso, lang }) {
  const ms = Math.max(0, new Date(iso).getTime() - Date.now())
  const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000)
  return <Text style={s.countdown}>{fill(t('lsF1Countdown', lang), { d, h, m })}</Text>
}

const SESSION_LABEL = {
  race: 'lsF1Race', sprint: 'lsF1Sprint', qualifying: 'lsF1Qualifying', sprint_qualifying: 'lsF1SprintQualifying',
}
function sessionLabel(type, lang) {
  const p = /^practice([123])$/.exec(type)
  return p ? fill(t('lsF1Practice', lang), { n: p[1] }) : t(SESSION_LABEL[type] || 'lsF1Race', lang)
}

function SessionRow({ x, isNext, suffix, lang }) {
  return (
    <View style={s.f1Row}>
      <Text style={s.f1Time}>{hhmm(x.race_at)}</Text>
      <View style={s.f1Who}>
        <Text style={s.teamName} numberOfLines={1}>{sessionLabel(x.session_type, lang)}{suffix ? ` · ${suffix}` : ''}</Text>
        <Text style={s.f1Team} numberOfLines={1}>{x.name}</Text>
      </View>
      {x.status === 'live'
        ? <View style={[s.livePill, s.f1LiveInline]}><View style={s.liveDot} /><Text style={s.livePillText}>{t('lsLive', lang)}</Text></View>
        : x.status === 'finished'
          ? <Text style={s.f1Right}>{t('lsF1Finished', lang)}</Text>
          : x.status === 'cancelled' || x.status === 'postponed'
            ? <Text style={s.f1Right}>{t(x.status === 'cancelled' ? 'lsCancelled' : 'lsPostponed', lang)}</Text>
            : isNext ? <Countdown iso={x.race_at} lang={lang} /> : null}
    </View>
  )
}

// API-Sports splits qualifying into three sessions; on screen they read Q1 / Q2 / Q3
// (SQ1-SQ3 for sprint qualifying), numbered in time order within the day.
function qualiPart(list, x) {
  if (x.session_type !== 'qualifying' && x.session_type !== 'sprint_qualifying') return null
  const same = list.filter(y => y.session_type === x.session_type)
  if (same.length < 2) return null
  return `${x.session_type === 'qualifying' ? 'Q' : 'SQ'}${same.indexOf(x) + 1}`
}

function F1View({ lang }) {
  const [sessions, setSessions] = useState([])
  const [race, setRace] = useState(null)
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const appActive = useAppActive()
  useTicker()

  const load = useCallback(async () => {
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const [ss, lr] = await Promise.all([
      supabase.from('f1_races').select('id, name, circuit, session_type, race_at, status')
        .gte('race_at', startOfToday.toISOString())
        .lt('race_at', new Date(startOfToday.getTime() + 2 * 86400000).toISOString())
        .order('race_at'),
      supabase.from('f1_races').select('id, name, circuit, race_at, status')
        .eq('session_type', 'race').in('status', ['live', 'finished'])
        .order('race_at', { ascending: false }).limit(1),
    ])
    if (ss.error || lr.error) { setError(true); setLoading(false); return }
    const last = lr.data[0] || null
    let res = []
    if (last) {
      const r = await supabase.from('f1_results').select('position, driver_name, driver_code, team, time_text')
        .eq('race_id', last.id).order('position', { ascending: true, nullsFirst: false }).limit(10)
      if (r.error) { setError(true); setLoading(false); return }
      res = r.data
    }
    setSessions(ss.data); setRace(last); setResults(res); setError(false); setLoading(false)
  }, [])

  useEffect(() => {
    if (!appActive) return
    load()
    let timer = null
    const ch = supabase.channel(`ls-f1-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'f1_results' }, () => {
        clearTimeout(timer); timer = setTimeout(load, 1500)
      })
      .subscribe()
    return () => { clearTimeout(timer); supabase.removeChannel(ch) }
  }, [appActive, load])

  if (loading) return <View style={s.pad}><CardSkeleton /><CardSkeleton /></View>
  if (error) return <ErrorState lang={lang} onRetry={() => { setLoading(true); load() }} />
  if (!sessions.length && !race) return <EmptyState icon="flag-outline" category="explore" title={t('lsF1Empty', lang)} />

  const now = Date.now()
  const next = sessions.find(x => x.status === 'scheduled' && new Date(x.race_at).getTime() > now)
  const days = []
  for (const x of sessions) {
    const k = dayKey(new Date(x.race_at))
    if (!days.length || days[days.length - 1].key !== k) days.push({ key: k, iso: x.race_at, list: [] })
    days[days.length - 1].list.push(x)
  }

  return (
    <ScrollView contentContainerStyle={s.scroll}>
      {days.length === 0
        ? <Card><Text style={s.f1Meta}>{t('lsF1NoSessions', lang)}</Text></Card>
        : days.map(d => (
          <View key={d.key} style={s.section}>
            <OnPhotoLabel style={s.leaguePill} accessibilityRole="header">{dayLabel(d.iso, lang)}</OnPhotoLabel>
            <Card padding={0}>
              {d.list.map((x, i) => (
                <View key={x.id}>
                  {i > 0 && <View style={s.hairline} />}
                  <SessionRow x={x} isNext={next?.id === x.id} suffix={qualiPart(d.list, x)} lang={lang} />
                </View>
              ))}
            </Card>
          </View>
        ))}

      {!!race && results.length > 0 && (
        <View style={s.section}>
          <View style={s.sectionHead}>
            <OnPhotoLabel style={s.leaguePill} accessibilityRole="header">
              {`${race.status === 'live' ? t('lsF1Live', lang) : t('lsF1LastRace', lang)} · ${race.name}`}
            </OnPhotoLabel>
          </View>
          <Card padding={0}>
            {results.map((r, i) => (
              <View key={r.driver_name}>
                {i > 0 && <View style={s.hairline} />}
                <View style={s.f1Row}>
                  <Text style={s.f1Pos}>{r.position ?? '–'}</Text>
                  <View style={s.f1Who}>
                    <Text style={s.teamName} numberOfLines={1}>{r.driver_name}</Text>
                    {!!r.team && <Text style={s.f1Team} numberOfLines={1}>{r.team}</Text>}
                  </View>
                  <Text style={s.f1Right} numberOfLines={1}>{r.time_text || ''}</Text>
                </View>
              </View>
            ))}
          </Card>
        </View>
      )}
    </ScrollView>
  )
}

// ─── Screen ──────────────────────────────────────────────────────────────────
export default function LiveScoresScreen({ lang, session, onBack, backRef = null }) {
  const [sport, setSport] = useState('football')
  const [isEditor, setIsEditor] = useState(false)
  const [editing, setEditing] = useState(false)
  const editorBackRef = useRef(null)

  // Only a signed-in, non-guest user can be an editor; the database decides (is_score_editor).
  useEffect(() => {
    if (!session || isGuest(session)) { setIsEditor(false); return }
    let alive = true
    supabase.rpc('is_score_editor').then(({ data, error }) => { if (alive) setIsEditor(!error && data === true) })
    return () => { alive = false }
  }, [session])

  // App's central back chain asks this first: the editor's own layers, then the editor.
  useEffect(() => {
    if (!backRef) return
    backRef.current = () => {
      if (!editing) return false
      if (editorBackRef.current?.()) return true
      setEditing(false)
      return true
    }
    return () => { backRef.current = null }
  }, [backRef, editing])

  if (editing) return <LiveScoresEditorScreen lang={lang} onBack={() => setEditing(false)} backRef={editorBackRef} />

  return (
    <ModuleScreen>
      <SafeAreaView style={s.safe} edges={['top']}>
        <UiHeader lang={lang} title={t('menuLiveScores', lang)} onBack={onBack}
          actions={isEditor ? [{ icon: 'create-outline', onPress: () => setEditing(true), accessibilityLabel: t('lsEditOpen', lang) }] : []} />
        <FilterBar>
          {SPORTS.map(sp => (
            <TouchableOpacity key={sp} style={[s.tab, sport === sp && s.tabOn]} onPress={() => setSport(sp)}
              activeOpacity={press.small} accessibilityRole="tab" accessibilityState={{ selected: sport === sp }}>
              <Text style={[s.tabText, sport === sp && s.tabTextOn]}>{t(SPORT_LABEL[sp], lang)}</Text>
            </TouchableOpacity>
          ))}
        </FilterBar>
        {sport === 'f1' ? <F1View lang={lang} /> : <MatchesView key={sport} sport={sport} lang={lang} />}
      </SafeAreaView>
    </ModuleScreen>
  )
}

const s = StyleSheet.create({
  safe:        { flex: 1 },
  pad:         { padding: 16, gap: 12 },
  scroll:      { padding: 16, paddingBottom: 48, gap: 20 },

  tab:         { minHeight: 36, paddingHorizontal: 16, justifyContent: 'center', borderRadius: radii.pill,
                 backgroundColor: 'rgba(0,0,0,0.45)' },
  tabOn:       { backgroundColor: colors.card },
  tabText:     { ...type.small, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF' },
  tabTextOn:   { color: colors.textPrimary },

  section:     { gap: 8 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  leaguePill:  { flexShrink: 1 },
  metaPill:    { paddingHorizontal: 10, paddingVertical: 4 },
  metaPillText:{ ...type.meta, color: '#FFFFFF' },
  livePill:    { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.55)',
                 borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4 },
  livePillText:{ ...type.meta, color: '#FFFFFF' },
  liveDot:     { width: 8, height: 8, borderRadius: 4, backgroundColor: '#22C55E' },

  dayDivider:  { ...type.caption, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6,
                 paddingHorizontal: 16, paddingTop: 12, paddingBottom: 2 },
  dayDividerGap: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider, marginTop: 4 },
  hairline:    { height: StyleSheet.hairlineWidth, backgroundColor: colors.divider, marginLeft: 72 },

  row:         { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingRight: 16, minHeight: TAP + 12 },
  statusCol:   { width: 64, alignItems: 'center', justifyContent: 'center', gap: 3 },
  statusText:  { ...type.meta, color: colors.textSecondary, textAlign: 'center' },
  statusHt:    { color: colors.dangerInk, fontFamily: 'Inter_600SemiBold' },
  statusLive:  { ...type.meta, fontFamily: 'Inter_700Bold', color: colors.dangerInk },
  liveDotSmall:{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.dangerInk },
  teams:       { flex: 1, gap: 4 },
  teamLine:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logo:        { width: 20, height: 20 },
  logoBlank:   { alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.soft },
  teamName:    { ...type.body, color: colors.textPrimary, flex: 1 },
  winner:      { fontFamily: 'Inter_700Bold' },
  score:       { ...type.rowTitle, color: colors.textPrimary, minWidth: 28, textAlign: 'right', fontVariant: ['tabular-nums'] },
  scoreLive:   { color: colors.dangerInk },
  scorers:     { ...type.caption, color: colors.textSecondary, marginLeft: 28 },

  f1Meta:      { ...type.small, color: colors.textSecondary, marginTop: 4 },
  countdown:   { ...type.meta, fontFamily: 'Inter_600SemiBold', color: colors.primaryDark, fontVariant: ['tabular-nums'] },
  f1Time:      { ...type.rowTitle, color: colors.textPrimary, width: 48, fontVariant: ['tabular-nums'] },
  f1LiveInline:{ backgroundColor: colors.dangerInk },
  f1Row:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 16, gap: 12, minHeight: TAP },
  f1Pos:       { ...type.rowTitle, color: colors.textSecondary, width: 24, textAlign: 'right', fontVariant: ['tabular-nums'] },
  f1Who:       { flex: 1 },
  f1Team:      { ...type.meta, color: colors.textSecondary },
  f1Right:     { ...type.meta, color: colors.textSecondary, maxWidth: 110, textAlign: 'right' },

})
