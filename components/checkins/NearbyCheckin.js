// "Buradayım" without a place (CHECKINS gate): one GPS fix, then the places within 100 m —
// ADA's own first, then Google's (google-places Edge Function), each nearest first — and a
// check-in on the one you are at. Google is called ONLY on this tap, never while browsing.
// The rules are the server's (20261078 check_in, 20261091 check_in_google); the distance shown
// and the pre-check are UX only. "Not here?" hands the fix to the add-place form.
import { useState, useEffect } from 'react'
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { requestWithPrimer } from '../../utils/permissionPrimer'
import { loadCheckinPrefs, checkIn, precheck, CHECKIN_ACCURACY_M } from '../../utils/checkins'
import { nearbyAda, nearbyGoogle, checkInGoogle, googleWithinReach } from '../../utils/googlePlaces'
import { bestFix, Outcome, CheckinNoticeSheet } from './CheckinAction'
import GoogleMapsAttribution from './GoogleMapsAttribution'
import { CATEGORY_LABEL_KEY, GROUP_META, categoryToGroup } from '../../constants/exploreCategories'
import { Button, BottomSheet, CategoryIcon } from '../ui'
import { colors, type, radii, press } from '../../constants/theme'
import { t, LANG_CODES } from '../../constants/i18n'

function adaName(p, lang) {
  const code = LANG_CODES[lang] ?? lang
  return (p.name_i18n && (p.name_i18n[code] ?? p.name_i18n.en)) || p.name || ''
}

function PlaceRow({ title, subtitle, icon, category, state, onPress, lang }) {
  const done = state?.code === 'DONE'
  return (
    <View style={s.rowWrap}>
      <TouchableOpacity style={s.row} onPress={onPress} disabled={state?.busy || done} activeOpacity={press.card}
        accessibilityRole="button" accessibilityLabel={`${title}, ${subtitle}, ${t('checkinCta', lang)}`}>
        <CategoryIcon icon={icon} category={category} size={40} />
        <View style={s.rowText}>
          <Text style={s.rowTitle} numberOfLines={2}>{title}</Text>
          <Text style={s.rowSub} numberOfLines={1}>{subtitle}</Text>
        </View>
        {state?.busy ? <ActivityIndicator color={colors.primary} />
          : done ? <Ionicons name="checkmark-circle" size={26} color={colors.primaryDark} />
          : <Ionicons name="location" size={22} color={colors.primary} />}
      </TouchableOpacity>
      {!!state?.code && <Outcome {...state} lang={lang} />}
    </View>
  )
}

function NearbySheet({ visible, lang, onClose, onCheckedIn, onAddPlace }) {
  const [phase, setPhase] = useState('idle')     // idle | locating | list | error
  const [errCode, setErrCode] = useState(null)
  const [fix, setFix] = useState(null)
  const [ada, setAda] = useState([])
  const [google, setGoogle] = useState([])
  const [googleFailed, setGoogleFailed] = useState(false)
  const [states, setStates] = useState({})       // key → { busy, code, already, metres }

  async function locate() {
    setPhase('locating'); setErrCode(null); setStates({})
    const perm = await requestWithPrimer('location')
    if (perm.status !== 'granted') { setErrCode('NO_LOCATION'); setPhase('error'); return }
    let f = null
    try { f = await bestFix() } catch { f = null }
    if (!f) { setErrCode('NO_LOCATION'); setPhase('error'); return }
    const [a, g] = await Promise.all([nearbyAda(supabase, f), nearbyGoogle(supabase, f, lang)])
    setFix(f); setAda(a.places); setGoogle(g.places); setGoogleFailed(!g.ok)
    setPhase('list')
  }

  // Opening the sheet starts the fix; closing resets so the next tap measures afresh.
  useEffect(() => { if (visible === true && phase === 'idle') locate() }, [visible])

  function close() { setPhase('idle'); onClose() }

  async function go(key, run) {
    setStates(st => ({ ...st, [key]: { busy: true } }))
    const res = await run()
    setStates(st => ({ ...st, [key]: res.ok ? { code: 'DONE', already: res.already } : res }))
    if (res.ok) onCheckedIn?.()
  }

  function checkAda(p) {
    const pre = precheck(p, fix)
    if (pre) { setStates(st => ({ ...st, [p.id]: { code: pre, metres: pre === 'TOO_FAR' ? p.metres : null } })); return }
    go(p.id, () => checkIn(supabase, p.id, fix))
  }

  function checkGoogle(p) {
    if (!(fix.accuracy > 0 && fix.accuracy <= CHECKIN_ACCURACY_M)) { setStates(st => ({ ...st, [p.id]: { code: 'LOW_ACCURACY' } })); return }
    if (!googleWithinReach(p, fix)) { setStates(st => ({ ...st, [p.id]: { code: 'TOO_FAR', metres: p.metres } })); return }
    go(p.id, () => checkInGoogle(supabase, p.id, fix))
  }

  const metres = n => t('checkinMetres', lang).replace('{n}', String(n))
  const empty = phase === 'list' && ada.length === 0 && google.length === 0

  return (
    <BottomSheet visible={visible === true} onClose={close} title={t('checkinNearbyTitle', lang)} lang={lang}>
      {phase === 'locating' || phase === 'idle' ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} />
          <Text style={s.muted}>{t('checkinLocating', lang)}</Text>
        </View>
      ) : phase === 'error' ? (
        <View style={s.center}>
          <Outcome code={errCode} lang={lang} />
          <Button variant="secondary" title={t('uiRetry', lang)} onPress={locate} />
        </View>
      ) : (
        <ScrollView style={s.scroll} contentContainerStyle={s.scrollBody} showsVerticalScrollIndicator={false}>
          {fix && !(fix.accuracy <= CHECKIN_ACCURACY_M) && <Text style={s.warn}>{t('checkinLowAccuracy', lang)}</Text>}
          {ada.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>{t('checkinNearbyAda', lang)}</Text>
              {ada.map(p => {
                const group = categoryToGroup(p.category)
                return (
                  <PlaceRow key={p.id} lang={lang} title={adaName(p, lang)}
                    subtitle={[CATEGORY_LABEL_KEY[p.category] ? t(CATEGORY_LABEL_KEY[p.category], lang) : null, metres(p.metres)].filter(Boolean).join(' · ')}
                    icon={GROUP_META[group]?.icon ?? 'location-outline'} category="explore"
                    state={states[p.id]} onPress={() => checkAda(p)} />
                )
              })}
            </View>
          )}
          {google.length > 0 && (
            <View style={s.section}>
              <View style={s.sectionHead}>
                <Text style={s.sectionTitle}>{t('checkinNearbyOther', lang)}</Text>
                <GoogleMapsAttribution />
              </View>
              {google.map(p => (
                <PlaceRow key={p.id} lang={lang} title={p.name || t('checkinUnnamedPlace', lang)} subtitle={metres(p.metres)}
                  icon="location-outline" category="explore" state={states[p.id]} onPress={() => checkGoogle(p)} />
              ))}
            </View>
          )}
          {empty && <Text style={s.muted}>{t('checkinNearbyEmpty', lang)}</Text>}
          {googleFailed && <Text style={s.mutedSmall}>{t('checkinNearbyGoogleFailed', lang)}</Text>}
          <TouchableOpacity style={s.add} onPress={() => { close(); onAddPlace?.(fix) }} activeOpacity={press.card}
            accessibilityRole="button" accessibilityLabel={`${t('checkinNotHere', lang)} ${t('checkinAddPlace', lang)}`}>
            <Ionicons name="add-circle-outline" size={22} color={colors.primary} />
            <View style={s.rowText}>
              <Text style={s.addQ}>{t('checkinNotHere', lang)}</Text>
              <Text style={s.addCta}>{t('checkinAddPlace', lang)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        </ScrollView>
      )}
    </BottomSheet>
  )
}

// The button + its two sheets: the first-time notice (no check-in without it), then the list.
export default function NearbyCheckin({ session, lang, onRequireAccount, onCheckedIn, onAddPlace, style }) {
  const uid = session?.user?.id
  const [busy, setBusy] = useState(false)
  const [errCode, setErrCode] = useState(null)
  const [notice, setNotice] = useState(null)
  const [open, setOpen] = useState(false)

  async function press_() {
    if (onRequireAccount?.('checkinGuestGate')) return
    setBusy(true); setErrCode(null)
    const { prefs, code } = await loadCheckinPrefs(supabase, uid)
    setBusy(false)
    if (!prefs) { setErrCode(code); return }
    if (!prefs.display_name || !prefs.checkins_notice_at) { setNotice(prefs); return }
    setOpen(true)
  }

  return (
    <View style={style}>
      <Button icon="location" title={t('checkinCta', lang)} onPress={press_} loading={busy} fullWidth />
      {!!errCode && <Outcome code={errCode} lang={lang} />}
      <CheckinNoticeSheet visible={!!notice} uid={uid} currentName={notice?.display_name} lang={lang}
        onClose={() => setNotice(null)} onAccepted={() => { setNotice(null); setOpen(true) }} />
      <NearbySheet visible={open} lang={lang} onClose={() => setOpen(false)}
        onCheckedIn={onCheckedIn} onAddPlace={onAddPlace} />
    </View>
  )
}

const s = StyleSheet.create({
  center:       { alignItems: 'center', gap: 12, paddingVertical: 28 },
  scroll:       { flexGrow: 0 },
  scrollBody:   { paddingBottom: 8, gap: 16 },
  section:      { gap: 4 },
  sectionHead:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sectionTitle: { ...type.meta, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6, flexShrink: 1 },
  rowWrap:      { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingBottom: 6 },
  row:          { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 6 },
  rowText:      { flex: 1, gap: 2 },
  rowTitle:     { ...type.rowTitle, color: colors.textPrimary },
  rowSub:       { ...type.small, color: colors.textSecondary },
  muted:        { ...type.body, color: colors.textSecondary, textAlign: 'center' },
  mutedSmall:   { ...type.small, color: colors.textSecondary, textAlign: 'center' },
  warn:         { ...type.small, color: colors.dangerInk, textAlign: 'center' },
  add:          { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 14,
                  borderRadius: radii.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: 'transparent' },
  addQ:         { ...type.small, color: colors.textSecondary },
  addCta:       { ...type.rowTitle, color: colors.primary },
})
