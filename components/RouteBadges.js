// Route badges (ROUTE_MEDALS_LIVE) — one per walking route, earned by walking it.
// Server half and who-sees-what: supabase/migrations/20261056_route_medals.sql.
//
//   OwnRouteBadges      ProfileScreen. Every route: earned in colour WITH the date, the rest
//                       greyed "walk it to earn". Plus the switch that shows them to others.
//   ProfileRouteBadges  StudentProfileScreen. Earned routes only, NEVER dates, through
//                       get_profile_route_badges — which is gated by get_student_profile,
//                       so it shows exactly when the profile itself does. Renders nothing
//                       for zero badges or any error: an empty badge row reads as "has
//                       walked nothing", which is not what a failed read means.
//
// Each loads its own data rather than widening the screen's profiles select: a column the
// migration has not added would fail that whole read, and with it the profile screen.

import { useEffect, useState } from 'react'
import { View, Text, Switch, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { REGION_LABEL_KEY } from '../constants/regions'
import { ROUTE_COLOR } from '../constants/walkingRoutes'
import { colors } from '../constants/theme'
import { t } from '../constants/i18n'
import { medalDate } from '../utils/routeMedals'

const loadRoutes = () => supabase.from('walking_routes')
  .select('id, region, sort_order').eq('is_active', true).order('sort_order')

const cityOf = (route, lang) => (REGION_LABEL_KEY[route.region] ? t(REGION_LABEL_KEY[route.region], lang) : route.region)

function Badge({ route, lang, earned, sub }) {
  return (
    <View style={b.cell} accessibilityLabel={`${cityOf(route, lang)} — ${sub}`}>
      <View style={[b.coin, earned ? b.coinOn : b.coinOff]}>
        <Ionicons name={earned ? 'medal' : 'walk-outline'} size={earned ? 26 : 22} color={earned ? '#fff' : '#9CA3AF'} />
      </View>
      <Text style={[b.city, !earned && b.cityOff]} numberOfLines={1}>{cityOf(route, lang)}</Text>
      <Text style={b.sub} numberOfLines={2}>{sub}</Text>
    </View>
  )
}

export function OwnRouteBadges({ session, lang, sectionStyle, titleStyle, labelStyle, rowStyle, hintStyle }) {
  const uid = session?.user?.id
  const [routes, setRoutes] = useState(null)
  const [earned, setEarned] = useState(new Map())
  const [isPublic, setIsPublic] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!uid) return
    let gone = false
    Promise.all([
      loadRoutes(),
      supabase.from('route_medals').select('route_id, completed_on').eq('user_id', uid),
      supabase.from('profiles').select('route_badges_public').eq('id', uid).maybeSingle(),
    ]).then(([r, m, p]) => {
      if (gone) return
      if (r.error || m.error) { setRoutes([]); return }
      setRoutes(r.data ?? [])
      setEarned(new Map((m.data ?? []).map(x => [x.route_id, x.completed_on])))
      if (!p.error && p.data) setIsPublic(p.data.route_badges_public !== false)
    })
    return () => { gone = true }
  }, [uid])

  async function toggle(next) {
    if (busy) return
    setBusy(true)
    setIsPublic(next)
    const { data, error } = await supabase.from('profiles')
      .update({ route_badges_public: next }).eq('id', uid)
      .select('route_badges_public').single()
    setIsPublic(error ? !next : data?.route_badges_public !== false)
    setBusy(false)
  }

  if (!routes?.length) return null
  return (
    <View style={sectionStyle}>
      <Text style={titleStyle}>{t('badgesTitle', lang)}</Text>
      <View style={b.grid}>
        {routes.map(r => (
          <Badge key={r.id} route={r} lang={lang} earned={earned.has(r.id)}
            sub={earned.has(r.id) ? medalDate(earned.get(r.id)) : t('badgeWalkToEarn', lang)} />
        ))}
      </View>
      <View style={[rowStyle, { marginTop: 14 }]}>
        <Text style={labelStyle}>{t('badgesPublicLabel', lang)}</Text>
        <Switch value={isPublic} onValueChange={toggle} disabled={busy}
          trackColor={{ true: colors.primary }} thumbColor="#fff" />
      </View>
      <Text style={hintStyle}>{t('badgesPublicHint', lang)}</Text>
    </View>
  )
}

export function ProfileRouteBadges({ userId, lang, titleStyle, frame = c => c }) {
  const [shown, setShown] = useState([])
  useEffect(() => {
    let gone = false
    Promise.all([loadRoutes(), supabase.rpc('get_profile_route_badges', { p_user_id: userId })])
      .then(([r, m]) => {
        if (gone || r.error || m.error) return
        const ids = new Set((m.data ?? []).map(x => x.route_id))
        setShown((r.data ?? []).filter(x => ids.has(x.id)))
      })
    return () => { gone = true }
  }, [userId])

  if (!shown.length) return null
  return frame(
    <View>
      <Text style={titleStyle}>{t('badgesTitle', lang)}</Text>
      <View style={b.grid}>
        {shown.map(r => <Badge key={r.id} route={r} lang={lang} earned sub={t('badgeWalked', lang)} />)}
      </View>
    </View>
  )
}

const b = StyleSheet.create({
  grid:    { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 },
  cell:    { width: '33.33%', alignItems: 'center', paddingHorizontal: 4 },
  coin:    { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  coinOn:  { backgroundColor: ROUTE_COLOR, borderWidth: 3, borderColor: colors.accent },
  coinOff: { backgroundColor: 'transparent', borderWidth: 2, borderColor: '#D1D5DB' },
  city:    { marginTop: 6, fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textAlign: 'center' },
  cityOff: { color: colors.textSecondary },
  sub:     { marginTop: 1, fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center' },
})
