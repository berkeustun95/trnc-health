// Müze Pasaportu on the owner's Profil (Explore stage 5). Private by construction: it reads the
// caller's OWN check-ins (owner-only RLS, like Check-in'lerim) and the public EEMD site list, and has
// no other-profile variant (Berke 2026-11-07: no public per-person history).
import { useEffect, useMemo, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { colors, category as CAT, press } from '../constants/theme'
import { t } from '../constants/i18n'
import { placeName } from '../screens/ExploreScreen'
import { passportState, passportOrder } from '../constants/museumPassport'
import { medalDate } from '../utils/routeMedals'
import { cyprusDate } from '../utils/officialVisit'

const INK = CAT.explore.ink
const COLLAPSED = 9

function Medal({ m, lang }) {
  const label = m.key === 'all' ? t('passportMedalAll', lang) : t('passportMedalN', lang).replace('{n}', m.need)
  return (
    <View style={s.medal} accessibilityLabel={`${label}${m.earned ? '' : ` — ${t('passportLocked', lang)}`}`}>
      <View style={[s.coin, m.earned ? s.coinOn : s.coinOff]}>
        <Ionicons name={m.earned ? (m.key === 'all' ? 'trophy' : 'ribbon') : 'lock-closed-outline'} size={m.earned ? 24 : 18}
          color={m.earned ? '#fff' : '#9CA3AF'} />
      </View>
      <Text style={[s.medalText, !m.earned && s.off]} numberOfLines={2}>{label}</Text>
    </View>
  )
}

export default function MuseumPassport({ session, lang, sectionStyle, titleStyle, hintStyle }) {
  const uid = session?.user?.id
  const [sites, setSites] = useState(null)
  const [mine, setMine] = useState([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!uid) return
    let gone = false
    ;(async () => {
      const { data: rows, error } = await supabase.from('places')
        .select('id, name, name_i18n, region, official_visit').not('official_visit', 'is', null).limit(500)
      if (gone || error) { if (!gone) setSites([]); return }
      // A site EEMD lists as closed cannot be visited: it is not in the passport (or 'all' would be unreachable).
      const list = (rows ?? []).filter(p => p.official_visit?.status !== 'closed')
      const { data: cis } = await supabase.from('checkins').select('place_id, created_at')
        .eq('user_id', uid).in('place_id', list.map(p => p.id)).limit(1000)   // ≤ one row per site per day
      if (gone) return
      setSites(list)
      setMine(cis ?? [])
    })()
    return () => { gone = true }
  }, [uid])

  const st = useMemo(() => passportState(sites ?? [], mine), [sites, mine])
  const ordered = useMemo(() => passportOrder(sites ?? [], st.stamps, p => placeName(p, lang)), [sites, st, lang])
  if (!sites?.length) return null
  const shown = open ? ordered : ordered.slice(0, COLLAPSED)

  return (
    <View style={sectionStyle}>
      <Text style={titleStyle}>{t('passportTitle', lang)}</Text>
      <Text style={s.progress}>
        {t('passportProgress', lang).replace('{n}', st.count).replace('{total}', st.total)}
        {st.next != null && <Text style={s.next}>{`  ·  ${t('passportNext', lang).replace('{n}', st.next - st.count)}`}</Text>}
      </Text>
      <View style={s.bar}><View style={[s.fill, { width: `${Math.round((st.count / st.total) * 100)}%` }]} /></View>
      <View style={s.medals}>{st.medals.map(m => <Medal key={m.key} m={m} lang={lang} />)}</View>
      <View style={s.grid}>
        {shown.map(p => {
          const at = st.stamps.get(p.id)
          return (
            <View key={p.id} style={s.cell} accessibilityLabel={`${placeName(p, lang)} — ${at ? medalDate(cyprusDate(new Date(at)), lang) : t('passportStampHow', lang)}`}>
              <View style={[s.stamp, at ? s.stampOn : s.stampOff]}>
                <Ionicons name={at ? 'checkmark' : 'library-outline'} size={at ? 22 : 18} color={at ? '#fff' : '#9CA3AF'} />
              </View>
              <Text style={[s.name, !at && s.off]} numberOfLines={2}>{placeName(p, lang)}</Text>
              {!!at && <Text style={s.date}>{medalDate(cyprusDate(new Date(at)), lang)}</Text>}
            </View>
          )
        })}
      </View>
      {ordered.length > COLLAPSED && (
        <TouchableOpacity onPress={() => setOpen(v => !v)} activeOpacity={press.small} accessibilityRole="button" style={s.more}>
          <Text style={s.moreText}>{open ? t('passportLess', lang) : t('passportAll', lang).replace('{n}', ordered.length)}</Text>
        </TouchableOpacity>
      )}
      <Text style={hintStyle}>{t('passportHint', lang)}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  progress:  { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  next:      { fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  bar:       { height: 8, borderRadius: 4, backgroundColor: CAT.explore.bg, marginTop: 8, overflow: 'hidden' },
  fill:      { height: 8, borderRadius: 4, backgroundColor: INK },
  medals:    { flexDirection: 'row', justifyContent: 'space-around', marginTop: 16 },
  medal:     { alignItems: 'center', width: '30%' },
  coin:      { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  coinOn:    { backgroundColor: INK, borderWidth: 3, borderColor: colors.accent },
  coinOff:   { borderWidth: 2, borderColor: '#D1D5DB' },
  medalText: { marginTop: 6, fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textAlign: 'center' },
  grid:      { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14, marginTop: 18 },
  cell:      { width: '33.33%', alignItems: 'center', paddingHorizontal: 4 },
  stamp:     { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  stampOn:   { backgroundColor: INK },
  stampOff:  { borderWidth: 2, borderStyle: 'dashed', borderColor: '#D1D5DB' },
  name:      { marginTop: 6, fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.textPrimary, textAlign: 'center' },
  date:      { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  off:       { color: colors.textSecondary },
  more:      { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 16, marginTop: 6 },
  moreText:  { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.primaryDark },
})
