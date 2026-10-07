// "Buradayım" on a place page (CHECKINS gate). Who may check in and from how far is decided
// by check_in() in 20261078; this file asks for location, pre-checks the fix and explains
// each refusal. The first check-in goes through CheckinNoticeSheet: a username and the
// "others will see this" notice, or nothing is saved (approved 2026-10-02).
import { useState } from 'react'
import { View, Text, TextInput, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as Location from 'expo-location'
import { supabase } from '../../lib/supabase'
import { askedFix } from '../../utils/locationServices'
import { requestWithPrimer } from '../../utils/permissionPrimer'
import { metresBetween } from '../../constants/walkingRoutes'
import { loadCheckinPrefs, acceptNotice, checkIn, precheck, CHECKIN_ACCURACY_M } from '../../utils/checkins'
import { useDisplayNameCheck, displayNameSaveError, NameFeedback } from '../DisplayNameCheck'
import { Button, BottomSheet } from '../ui'
import { colors, type, radii } from '../../constants/theme'
import { t } from '../../constants/i18n'

// A first fix is often coarse; one more try at the best accuracy before giving up.
export async function bestFix() {
  let best = null
  for (let i = 0; i < 2; i++) {
    const loc = await askedFix(Location.Accuracy.Highest)
    if (!loc) break
    const fix = { latitude: loc.coords.latitude, longitude: loc.coords.longitude, accuracy: loc.coords.accuracy }
    if (!best || fix.accuracy < best.accuracy) best = fix
    if (best.accuracy <= CHECKIN_ACCURACY_M) break
  }
  return best
}

// One line per outcome. Literal t() calls, so the i18n coverage scan sees every key.
export function Outcome({ code, already, metres, lang }) {
  if (already) return <Text style={s.ok}>{t('checkinAlready', lang)}</Text>
  if (code === 'DONE') return <Text style={s.ok}>{t('checkinDone', lang)}</Text>
  let msg
  if (code === 'TOO_FAR') {
    msg = t('checkinTooFar', lang)
    if (metres) msg += ' ' + t('checkinDistance', lang).replace('{n}', String(metres))
  }
  else if (code === 'LOW_ACCURACY' || code === 'BAD_FIX') msg = t('checkinLowAccuracy', lang)
  else if (code === 'NO_LOCATION') msg = t('checkinNoLocation', lang)
  else if (code === 'TOO_FAST') msg = t('checkinTooFast', lang)
  else if (code === 'DAILY_LIMIT') msg = t('checkinDailyLimit', lang)
  else if (code === 'BANNED' || code === 'NOT_ELIGIBLE') msg = t('checkinNotAllowed', lang)
  else if (code === 'PLACE_NOT_FOUND') msg = t('checkinPlaceGone', lang)
  else if (code === 'NETWORK') msg = t('checkinOffline', lang)
  else msg = t('checkinFailed', lang)
  return <Text style={s.err}>{msg}</Text>
}

export function CheckinNoticeSheet({ visible, uid, currentName, lang, onClose, onAccepted }) {
  const [name, setName] = useState('')
  const [nameState, setNameState] = useDisplayNameCheck(currentName ? '' : name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const needsName = !currentName
  const canGo = !busy && (!needsName || nameState?.status === 'available')

  async function confirm() {
    setBusy(true); setError(null)
    if (needsName) {
      const { error: err, status } = await supabase.from('profiles').update({ display_name: name.trim() }).eq('id', uid)
      if (err) {
        const nameErr = await displayNameSaveError(err, name.trim())
        if (nameErr) setNameState(nameErr); else setError(status === 0 ? t('checkinOffline', lang) : t('checkinFailed', lang))
        setBusy(false); return
      }
    }
    const res = await acceptNotice(supabase)
    setBusy(false)
    if (!res.ok) { setError(res.code === 'NETWORK' ? t('checkinOffline', lang) : t('checkinFailed', lang)); return }
    onAccepted(res.isPublic)
  }

  return (
    <BottomSheet visible={visible === true} onClose={onClose} title={t('checkinNoticeTitle', lang)} lang={lang}>
      <View style={s.sheet}>
        <View style={s.noticeRow}>
          <Ionicons name="eye-outline" size={20} color={colors.primaryDark} />
          <Text style={s.body}>{t('checkinNoticeBody', lang)}</Text>
        </View>
        {needsName ? (
          <View>
            <Text style={s.label}>{t('checkinNameLabel', lang)}</Text>
            <TextInput style={s.input} value={name} onChangeText={setName} autoCapitalize="none" autoCorrect={false}
              placeholder={t('checkinNamePlaceholder', lang)} placeholderTextColor={colors.textSecondary}
              accessibilityLabel={t('checkinNameLabel', lang)} />
            <NameFeedback state={nameState} lang={lang} onPick={setName} />
          </View>
        ) : (
          <Text style={s.body}>{t('checkinShownAs', lang).replace('{name}', currentName)}</Text>
        )}
        {!!error && <Text style={s.err}>{error}</Text>}
        <Button title={t('checkinNoticeConfirm', lang)} onPress={confirm} loading={busy} disabled={!canGo} fullWidth />
      </View>
    </BottomSheet>
  )
}

export default function CheckinAction({ place, session, lang, onRequireAccount, onCheckedIn, style }) {
  const uid = session?.user?.id
  const [phase, setPhase] = useState('idle')        // idle | working | done
  const [outcome, setOutcome] = useState(null)      // { code, already, metres }
  const [notice, setNotice] = useState(null)        // prefs while the sheet is open

  async function run() {
    setPhase('working'); setOutcome(null)
    const perm = await requestWithPrimer('location')
    if (perm.status !== 'granted') { setPhase('idle'); setOutcome({ code: 'NO_LOCATION' }); return }
    let fix = null
    try { fix = await bestFix() } catch { fix = null }
    if (!fix) { setPhase('idle'); setOutcome({ code: 'NO_LOCATION' }); return }
    const pre = precheck(place, fix)
    if (pre) {
      setPhase('idle')
      setOutcome({ code: pre, metres: pre === 'TOO_FAR' ? Math.round(metresBetween(fix, place)) : null })
      return
    }
    const res = await checkIn(supabase, place.id, fix)
    if (!res.ok) { setPhase('idle'); setOutcome({ code: res.code }); return }
    setPhase('done'); setOutcome({ code: 'DONE', already: res.already })
    onCheckedIn?.()
  }

  async function press() {
    if (onRequireAccount?.('checkinGuestGate')) return
    setPhase('working'); setOutcome(null)
    const { prefs, code } = await loadCheckinPrefs(supabase, uid)
    if (!prefs) { setPhase('idle'); setOutcome({ code }); return }
    if (!prefs.display_name || !prefs.checkins_notice_at) { setPhase('idle'); setNotice(prefs); return }
    run()
  }

  return (
    <View style={style}>
      <Button variant={phase === 'done' ? 'secondary' : 'primary'} icon={phase === 'done' ? 'checkmark-circle' : 'location'}
        title={t('checkinCta', lang)} onPress={press} loading={phase === 'working'} disabled={phase === 'done'} fullWidth />
      {!!outcome && <Outcome {...outcome} lang={lang} />}
      <CheckinNoticeSheet visible={!!notice} uid={uid} currentName={notice?.display_name} lang={lang}
        onClose={() => setNotice(null)}
        onAccepted={() => { setNotice(null); run() }} />
    </View>
  )
}

const s = StyleSheet.create({
  sheet:     { gap: 14, paddingBottom: 8 },
  noticeRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: colors.primaryLight,
               borderRadius: radii.md, padding: 12 },
  body:      { ...type.body, color: colors.textPrimary, flex: 1 },
  label:     { ...type.meta, color: colors.textSecondary, marginBottom: 6 },
  input:     { ...type.body, color: colors.textPrimary, borderWidth: 1.5, borderColor: colors.border,
               borderRadius: radii.md, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: colors.card },
  ok:        { ...type.small, color: colors.primaryDark, marginTop: 8, textAlign: 'center' },
  err:       { ...type.small, color: colors.dangerInk, marginTop: 8, textAlign: 'center' },
})
