import { useState, useEffect, useCallback, useRef } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Image, AppState, RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { colors, type, radii, press, TAP } from '../constants/theme'
import { t, dateLocale } from '../constants/i18n'
import {
  ScreenHeader as UiHeader, FilterBar, ErrorState, EmptyState, CardSkeleton, Card, ModuleScreen, OnPhotoLabel,
} from '../components/ui'

// Canlı Skor: TRNC football only (KTFF Süper Lig + 1. Lig). Reads Supabase tables that a
// server-side sync fills from the KTFF API (ktff_leagues / ktff_standings / ktff_fixtures);
// the phone never calls KTFF. No live data: results land after the match, so a refresh is
// a re-query, not a subscription. Every API-derived string is rendered as plain <Text>.

const LEAGUES = [1, 2]
const LEAGUE_FALLBACK = { 1: 'lsLeagueSuper', 2: 'lsLeagueFirst' }
const HEX = /^#[0-9A-Fa-f]{6}$/
const OUR_LOGOS = '/storage/v1/object/public/team-logos/'
const isEn = lang => lang === 'English'
const pick = (row, base, lang) => (isEn(lang) && row[`${base}_en`]) || row[`${base}_tr`] || row[`${base}_en`] || ''
const fill = (s, vars) => Object.entries(vars).reduce((a, [k, v]) => a.replace(`{${k}}`, String(v)), s)

// match_local is 'YYYY-MM-DD HH:mm' in TRNC time already: split it, never run it through a
// timezone. The Date is built from parts only to get a weekday/month name in the app language.
function parseLocal(ml) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}:\d{2}))?/.exec(ml || '')
  return m ? { day: `${m[1]}-${m[2]}-${m[3]}`, y: +m[1], mo: +m[2], d: +m[3], time: m[4] || null } : null
}
function dayLabel(p, lang) {
  try {
    return new Date(p.y, p.mo - 1, p.d).toLocaleDateString(dateLocale(lang), { weekday: 'long', day: 'numeric', month: 'long' })
  } catch { return p.day }
}

function useAppActive(onActive) {
  const cb = useRef(onActive)
  cb.current = onActive
  useEffect(() => {
    const sub = AppState.addEventListener('change', st => { if (st === 'active') cb.current() })
    return () => sub.remove()
  }, [])
}

// Our team-logos bucket and nothing else: a phone never requests another host.
function TeamLogo({ uri }) {
  if (!uri || !uri.includes(OUR_LOGOS)) {
    return <View style={[s.logo, s.logoBlank]}><Ionicons name="shield-outline" size={14} color={colors.textSecondary} /></View>
  }
  return <Image source={{ uri }} style={s.logo} resizeMode="contain" accessibilityIgnoresInvertColors />
}

function Pill({ label, on, onPress }) {
  return (
    <TouchableOpacity style={[s.tab, on && s.tabOn]} onPress={onPress} activeOpacity={press.small}
      accessibilityRole="tab" accessibilityState={{ selected: on }}>
      <Text style={[s.tabText, on && s.tabTextOn]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  )
}

function FixtureRow({ m, lang }) {
  const home = pick(m, 'home_team', lang), away = pick(m, 'away_team', lang)
  const played = m.home_score != null && m.away_score != null && m.home_score !== '' && m.away_score !== ''
  const time = parseLocal(m.match_local)?.time
  return (
    <View style={s.row} accessible
      accessibilityLabel={`${home} ${played ? `${m.home_score} – ${m.away_score}` : time || 'VS'} ${away}`}>
      <View style={[s.side, s.sideHome]}>
        <Text style={[s.teamName, s.nameHome]} numberOfLines={2}>{home || '—'}</Text>
        <TeamLogo uri={m.home_logo_url} />
      </View>
      <View style={s.mid}>
        <Text style={played ? s.score : s.vs}>{played ? `${m.home_score} – ${m.away_score}` : 'VS'}</Text>
        {!played && !!time && <Text style={s.kick}>{time}</Text>}
      </View>
      <View style={s.side}>
        <TeamLogo uri={m.away_logo_url} />
        <Text style={s.teamName} numberOfLines={2}>{away || '—'}</Text>
      </View>
    </View>
  )
}

function FixtureList({ fixtures, lang }) {
  const days = []
  for (const m of fixtures) {
    const p = parseLocal(m.match_local)
    const key = p?.day || ''
    if (!days.length || days[days.length - 1].key !== key) days.push({ key, p, list: [] })
    days[days.length - 1].list.push(m)
  }
  return days.map(d => (
    <View key={d.key || 'undated'} style={s.section}>
      {!!d.p && <OnPhotoLabel style={s.dayPill} accessibilityRole="header">{dayLabel(d.p, lang)}</OnPhotoLabel>}
      <Card padding={0}>
        {d.list.map((m, i) => (
          <View key={m.match_id}>
            {i > 0 && <View style={s.hairline} />}
            <FixtureRow m={m} lang={lang} />
          </View>
        ))}
      </Card>
    </View>
  ))
}

function StandingRow({ r, lang }) {
  const bar = HEX.test(r.marker_color || '') ? r.marker_color : null
  const chipText = HEX.test(r.marker_text_color || '') ? r.marker_text_color : '#FFFFFF'
  return (
    <View style={s.stRow} accessible
      accessibilityLabel={`${r.rank}. ${pick(r, 'team', lang)}, ${r.points}`}>
      <View style={[s.bar, bar && { backgroundColor: bar }]} />
      <View style={[s.rankChip, bar && { backgroundColor: bar }]}>
        <Text style={[s.rankText, bar && { color: chipText }]}>{r.rank}</Text>
      </View>
      <TeamLogo uri={r.logo_url} />
      <Text style={s.stTeam} numberOfLines={1}>{pick(r, 'team', lang)}</Text>
      <Text style={s.stNum}>{r.played}</Text>
      <Text style={s.stNum}>{r.won}</Text>
      <Text style={s.stNum}>{r.drawn}</Text>
      <Text style={s.stNum}>{r.lost}</Text>
      <Text style={s.stNumWide}>{r.goal_difference}</Text>
      <Text style={[s.stNum, s.stPts]}>{r.points}</Text>
    </View>
  )
}

function StandingsHead({ lang }) {
  return (
    <View style={s.stRow}>
      <View style={s.bar} />
      <View style={s.rankChip} />
      <View style={s.logo} />
      <Text style={[s.stTeam, s.stHead]} />
      <Text style={[s.stNum, s.stHead]}>{t('lsColPlayed', lang)}</Text>
      <Text style={[s.stNum, s.stHead]}>{t('lsColWon', lang)}</Text>
      <Text style={[s.stNum, s.stHead]}>{t('lsColDrawn', lang)}</Text>
      <Text style={[s.stNum, s.stHead]}>{t('lsColLost', lang)}</Text>
      <Text style={[s.stNumWide, s.stHead]}>{t('lsColGD', lang)}</Text>
      <Text style={[s.stNum, s.stHead]}>{t('lsColPts', lang)}</Text>
    </View>
  )
}

function Legend({ items, lang }) {
  return (
    <Card style={s.legend}>
      {items.map((it, i) => (
        <View key={it.id ?? i} style={s.legendRow}>
          <View style={[s.legendDot, HEX.test(it.color || '') && { backgroundColor: it.color }]} />
          <Text style={s.legendText}>{pick({ label_tr: it.label_tr, label_en: it.label_en }, 'label', lang)}</Text>
        </View>
      ))}
    </Card>
  )
}

function WeekPicker({ weeks, week, onChange, lang }) {
  const i = weeks.indexOf(week)
  const prev = i > 0 ? weeks[i - 1] : null
  const next = i >= 0 && i < weeks.length - 1 ? weeks[i + 1] : null
  return (
    <View style={s.weekBar}>
      <TouchableOpacity style={[s.weekBtn, prev == null && s.weekOff]} disabled={prev == null}
        onPress={() => onChange(prev)} activeOpacity={press.small}
        accessibilityRole="button" accessibilityLabel={t('lsWeekPrev', lang)}>
        <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
      </TouchableOpacity>
      <Text style={s.weekLabel} accessibilityRole="header">{fill(t('lsWeekN', lang), { n: week })}</Text>
      <TouchableOpacity style={[s.weekBtn, next == null && s.weekOff]} disabled={next == null}
        onPress={() => onChange(next)} activeOpacity={press.small}
        accessibilityRole="button" accessibilityLabel={t('lsWeekNext', lang)}>
        <Ionicons name="chevron-forward" size={20} color={colors.textPrimary} />
      </TouchableOpacity>
    </View>
  )
}

export default function LiveScoresScreen({ lang, onBack }) {
  const [tab, setTab] = useState('fixtures')
  const [leagueId, setLeagueId] = useState(1)
  const [weekSel, setWeekSel] = useState(null)
  const [leagues, setLeagues] = useState([])
  const [fixtures, setFixtures] = useState([])
  const [standings, setStandings] = useState([])
  const [week, setWeek] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(false)
  const reqRef = useRef(0)

  const load = useCallback(async () => {
    const req = ++reqRef.current
    const done = () => { if (req === reqRef.current) { setLoading(false); setRefreshing(false) } }
    const fail = () => { if (req === reqRef.current) setError(true); done() }
    const lg = await supabase.from('ktff_leagues')
      .select('league_id,name_tr,name_en,logo_url,available_weeks,current_week,legend')
    if (lg.error) return fail()
    const L = (lg.data || []).find(x => x.league_id === leagueId)
    const weeks = L?.available_weeks || []
    const w = weekSel != null && weeks.includes(weekSel) ? weekSel : (L?.current_week ?? weeks[weeks.length - 1] ?? null)
    let fx = [], st = []
    if (tab === 'fixtures') {
      if (w != null) {
        const r = await supabase.from('ktff_fixtures').select('*').eq('league_id', leagueId).eq('week', w)
          .order('kickoff_at', { nullsFirst: false }).order('match_id')
        if (r.error) return fail()
        fx = r.data || []
      }
    } else {
      const r = await supabase.from('ktff_standings').select('*').eq('league_id', leagueId).order('rank')
      if (r.error) return fail()
      st = r.data || []
    }
    if (req !== reqRef.current) return
    setLeagues(lg.data || []); setWeek(w); setFixtures(fx); setStandings(st)
    setError(false); done()
  }, [leagueId, weekSel, tab])

  useEffect(() => { setLoading(true); load() }, [load])
  useAppActive(load)

  const leagueName = id => {
    const l = leagues.find(x => x.league_id === id)
    return (l && pick(l, 'name', lang)) || t(LEAGUE_FALLBACK[id], lang)
  }
  const cur = leagues.find(x => x.league_id === leagueId)
  const weeks = cur?.available_weeks || []
  const legend = Array.isArray(cur?.legend) ? cur.legend : []

  const body = () => {
    if (loading) return <View style={s.pad}><CardSkeleton /><CardSkeleton /><CardSkeleton /></View>
    if (error) return <ErrorState lang={lang} onRetry={() => { setLoading(true); load() }} />
    return (
      <ScrollView contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor="#FFFFFF" onRefresh={() => { setRefreshing(true); load() }} />}>
        {tab === 'fixtures' ? (
          week == null || weeks.length === 0
            ? <EmptyState icon="football-outline" category="explore" title={t('lsNoFixturesTitle', lang)} message={t('lsNoFixturesBody', lang)} />
            : <>
                <WeekPicker weeks={weeks} week={week} onChange={setWeekSel} lang={lang} />
                {fixtures.length === 0
                  ? <EmptyState icon="football-outline" category="explore" title={t('lsNoFixturesTitle', lang)} message={t('lsNoFixturesBody', lang)} />
                  : <FixtureList fixtures={fixtures} lang={lang} />}
              </>
        ) : (
          standings.length === 0
            ? <EmptyState icon="list-outline" category="explore" title={t('lsNoStandingsTitle', lang)} message={t('lsNoStandingsBody', lang)} />
            : <>
                <Card padding={0}>
                  <StandingsHead lang={lang} />
                  {standings.map(r => (
                    <View key={r.team_id}>
                      <View style={s.hairline} />
                      <StandingRow r={r} lang={lang} />
                    </View>
                  ))}
                </Card>
                {legend.length > 0 && <Legend items={legend} lang={lang} />}
              </>
        )}
        <OnPhotoLabel style={s.credit}>{t('lsSourceKtff', lang)}</OnPhotoLabel>
      </ScrollView>
    )
  }

  return (
    <ModuleScreen>
      <SafeAreaView style={s.safe} edges={['top']}>
        <UiHeader lang={lang} title={t('menuLiveScores', lang)} onBack={onBack} />
        <FilterBar>
          <Pill label={t('lsTabFixtures', lang)} on={tab === 'fixtures'} onPress={() => setTab('fixtures')} />
          <Pill label={t('lsTabStandings', lang)} on={tab === 'standings'} onPress={() => setTab('standings')} />
        </FilterBar>
        <FilterBar style={s.leagueBar}>
          {LEAGUES.map(id => (
            <Pill key={id} label={leagueName(id)} on={leagueId === id}
              onPress={() => { if (id !== leagueId) { setLeagueId(id); setWeekSel(null) } }} />
          ))}
        </FilterBar>
        {body()}
      </SafeAreaView>
    </ModuleScreen>
  )
}

const s = StyleSheet.create({
  safe:        { flex: 1 },
  pad:         { padding: 16, gap: 12 },
  scroll:      { padding: 16, paddingBottom: 48, gap: 16 },
  leagueBar:   { marginTop: -4 },

  tab:         { minHeight: 36, paddingHorizontal: 16, justifyContent: 'center', borderRadius: radii.pill,
                 backgroundColor: 'rgba(0,0,0,0.45)' },
  tabOn:       { backgroundColor: colors.card },
  tabText:     { ...type.small, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF' },
  tabTextOn:   { color: colors.textPrimary },

  weekBar:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  weekBtn:     { width: TAP, height: TAP, borderRadius: TAP / 2, alignItems: 'center', justifyContent: 'center',
                 backgroundColor: colors.card },
  weekOff:     { opacity: 0.4 },
  weekLabel:   { ...type.rowTitle, color: '#FFFFFF', flex: 1, textAlign: 'center',
                 textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 },

  section:     { gap: 8 },
  dayPill:     { maxWidth: '100%' },
  hairline:    { height: StyleSheet.hairlineWidth, backgroundColor: colors.divider },

  row:         { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 12, minHeight: TAP + 12 },
  side:        { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  sideHome:    { justifyContent: 'flex-end' },
  teamName:    { ...type.small, fontFamily: 'Inter_600SemiBold', color: colors.textPrimary, flexShrink: 1 },
  nameHome:    { textAlign: 'right' },
  mid:         { width: 68, alignItems: 'center', justifyContent: 'center' },
  score:       { ...type.sheetTitle, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  vs:          { ...type.meta, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
  kick:        { ...type.caption, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
  logo:        { width: 24, height: 24 },
  logoBlank:   { alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.soft },

  stRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingRight: 10, gap: 6, minHeight: 40 },
  bar:         { width: 4, alignSelf: 'stretch', backgroundColor: 'transparent' },
  rankChip:    { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.soft },
  rankText:    { ...type.meta, fontFamily: 'Inter_700Bold', color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  stTeam:      { ...type.small, fontFamily: 'Inter_600SemiBold', color: colors.textPrimary, flex: 1 },
  stNum:       { ...type.small, color: colors.textPrimary, width: 24, textAlign: 'center', fontVariant: ['tabular-nums'] },
  stNumWide:   { ...type.small, color: colors.textPrimary, width: 32, textAlign: 'center', fontVariant: ['tabular-nums'] },
  stPts:       { width: 28, fontFamily: 'Inter_700Bold' },
  stHead:      { ...type.caption, fontFamily: 'Inter_700Bold', color: colors.textSecondary },

  legend:      { gap: 8 },
  legendRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  legendDot:   { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.soft },
  legendText:  { ...type.small, color: colors.textPrimary, flex: 1 },

  credit:      { alignSelf: 'center' },
})
