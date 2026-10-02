// Profile → Check-in'lerim (CHECKINS gate). The switch only decides whether the user's
// check-ins appear in the two feeds (decision 2026-10-02: feeds only, no profile history).
// It writes profiles.checkins_public, owner-writable like route_badges_public. NULL (never
// chosen, not yet consented) reads as hidden, so the switch shows ON for it.
// Loads its own columns rather than widening the screen's profiles select (RouteBadges' rule).
import { useEffect, useState } from 'react'
import { View, Text, Switch, StyleSheet } from 'react-native'
import { supabase, isGuest } from '../../lib/supabase'
import { loadCheckinPrefs, loadMine, deleteCheckin, setCheckinsPublic } from '../../utils/checkins'
import { IconButton, ConfirmDialog } from '../ui'
import { colors, type } from '../../constants/theme'
import { t, LANG_CODES } from '../../constants/i18n'

function placeLabel(place, lang) {
  if (!place) return t('checkinPlaceGone', lang)
  const code = LANG_CODES[lang] ?? lang
  return (place.name_i18n && (place.name_i18n[code] ?? place.name_i18n.en)) || place.name || ''
}

export default function MyCheckins({ session, lang, sectionStyle, titleStyle, labelStyle, rowStyle, hintStyle }) {
  const uid = session?.user?.id
  const [hidden, setHidden] = useState(true)
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(null)     // the row being deleted
  const [delBusy, setDelBusy] = useState(false)
  const [delError, setDelError] = useState(null)

  useEffect(() => {
    if (!uid || isGuest(session)) return
    let gone = false
    Promise.all([loadCheckinPrefs(supabase, uid), loadMine(supabase, uid)]).then(([p, m]) => {
      if (gone) return
      if (p) setHidden(p.checkins_public !== true)
      setRows(m)
    })
    return () => { gone = true }
  }, [uid, session])

  async function toggle(nextHidden) {
    if (busy) return
    setBusy(true); setHidden(nextHidden)
    const res = await setCheckinsPublic(supabase, uid, !nextHidden)
    setHidden(res === null ? !nextHidden : !res)
    setBusy(false)
  }

  async function doDelete() {
    setDelBusy(true); setDelError(null)
    const ok = await deleteCheckin(supabase, confirm.id)
    setDelBusy(false)
    if (!ok) { setDelError(t('checkinDeleteFailed', lang)); return }
    setRows(r => r.filter(x => x.id !== confirm.id)); setConfirm(null)
  }

  if (!uid || isGuest(session) || rows === null) return null
  return (
    <View style={sectionStyle}>
      <Text style={titleStyle}>{t('checkinMineTitle', lang)}</Text>
      <View style={rowStyle}>
        <Text style={labelStyle}>{t('checkinHideLabel', lang)}</Text>
        <Switch value={hidden} onValueChange={toggle} disabled={busy}
          trackColor={{ true: colors.primary }} thumbColor="#fff" accessibilityLabel={t('checkinHideLabel', lang)} />
      </View>
      <Text style={hintStyle}>{t('checkinHideHint', lang)}</Text>
      {rows.length === 0
        ? <Text style={s.empty}>{t('checkinMineEmpty', lang)}</Text>
        : rows.map(r => (
          <View key={r.id} style={s.row}>
            <View style={s.text}>
              <Text style={s.place} numberOfLines={1}>{placeLabel(r.places, lang)}</Text>
              <Text style={s.date}>{new Date(r.created_at).toLocaleDateString(LANG_CODES[lang] ?? 'en', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
            </View>
            <IconButton icon="trash-outline" color={colors.textSecondary} onPress={() => { setDelError(null); setConfirm(r) }}
              accessibilityLabel={t('checkinDelete', lang)} />
          </View>
        ))}
      <ConfirmDialog visible={!!confirm} lang={lang} destructive title={t('checkinDeleteTitle', lang)}
        message={confirm ? placeLabel(confirm.places, lang) : ''} confirmLabel={t('checkinDelete', lang)}
        onConfirm={doDelete} onCancel={() => setConfirm(null)} loading={delBusy} error={delError} />
    </View>
  )
}

const s = StyleSheet.create({
  empty: { ...type.small, color: colors.textSecondary, marginTop: 10 },
  row:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6,
           borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 6 },
  text:  { flex: 1 },
  place: { ...type.rowTitle, color: colors.textPrimary },
  date:  { ...type.meta, color: colors.textSecondary },
})
