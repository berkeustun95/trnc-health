// Display-name availability — ONE implementation, two screens.
//
// The wizard collects a display name; ProfileScreen (Slice 3a) lets the user change it.
// Both need the identical five-state answer, and a second copy would be the same
// two-halves drift as utils/profanity.js vs contains_blocked_term(): the client mirrors
// that must agree character-for-character. A divergence here does not look like a bug —
// it looks like the app rejecting a name it just called available, on one screen only.
//
// ─── WHY THE ORDER OF THE THREE CHECKS IS LOAD-BEARING ──────────────────────
// The two CLIENT mirrors run first because they are free and instant: a reserved or
// profane name never costs a round trip. The RPC is the authority on "taken", which no
// client can answer — profiles denies a customer every row but their own (measured:
// a signed-in customer reads exactly 1 row), so a client-side lookup would report
// "available" for every name in the database. See 20261002's header.
//
// display_name_available() excludes the caller's own row (`id <> auth.uid()`), which is
// what makes this safe to run on ProfileScreen: a user who opens the screen and changes
// nothing is not told their own name is taken.
import { useState, useEffect, useRef } from 'react'
import { View, Text, TouchableOpacity, Linking, StyleSheet } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { colors } from '../constants/theme'
import { t } from '../constants/i18n'
import { DISPLAY_NAME_MIN, DISPLAY_NAME_MAX, DEBOUNCE_MS, SUPPORT_EMAIL } from '../constants/profileGate'
import { isReservedDisplayName } from '../utils/reservedNames'
import { containsBlockedTerm } from '../utils/profanity'

export function useDisplayNameCheck(displayName) {
  const [nameState, setNameState] = useState(null)   // {status, suggestions?}
  const nameReqId = useRef(0)

  useEffect(() => {
    const name = displayName.trim()
    const id = ++nameReqId.current
    if (!name) { setNameState(null); return }
    if (name.length < DISPLAY_NAME_MIN) { setNameState({ status: 'short' }); return }
    if (name.length > DISPLAY_NAME_MAX) { setNameState({ status: 'long' }); return }
    if (isReservedDisplayName(name)) { setNameState({ status: 'reserved' }); return }

    setNameState({ status: 'checking' })
    const handle = setTimeout(async () => {
      if (await containsBlockedTerm(name)) {
        if (nameReqId.current === id) setNameState({ status: 'blocked' })
        return
      }
      const { data, error } = await supabase.rpc('display_name_available', { p_name: name })
      if (nameReqId.current !== id) return
      // Fail OPEN on a network error: the unique index is the real boundary, so the worst
      // case is a 23505 on save, which displayNameSaveError() handles. Blocking on a
      // flaky connection would strand a user inside a gate they cannot skip.
      if (error || !data) { setNameState(null); return }
      setNameState({ status: data.status, suggestions: data.suggestions ?? [] })
    }, DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [displayName])

  return [nameState, setNameState]
}

// Translate a failed profiles UPDATE into a name state, or null if the failure was not
// about the display name and belongs to the caller's generic error path. Async because
// the race branch re-asks for fresh suggestions — the stale ones are the name that was
// just taken.
export async function displayNameSaveError(error, name) {
  if (!error) return null
  if (error.code === '23505') {
    const { data } = await supabase.rpc('display_name_available', { p_name: name })
    return { status: 'race', suggestions: data?.suggestions ?? [] }
  }
  if (error.message?.includes('DISPLAY_NAME_RESERVED')) return { status: 'reserved' }
  if (error.message?.includes('BLOCKED_TERM')) return { status: 'blocked' }
  return null
}

// Five states, five distinct messages. A RESERVED name is not an obscenity and must not
// be told it is one — "Ada" is a common Turkish woman's name, so that false positive is
// predictable rather than hypothetical, and the message offers a way out.
export function NameFeedback({ state, lang, onPick }) {
  if (!state) return null
  const { status, suggestions = [] } = state

  if (status === 'checking') return <Text style={s.muted}>{t('pgChecking', lang)}</Text>
  if (status === 'short') return <Text style={s.err}>{t('pgTooShort', lang)}</Text>
  if (status === 'long' || status === 'invalid') return <Text style={s.err}>{t('pgTooLong', lang)}</Text>
  if (status === 'blocked') return <Text style={s.err}>{t('contentBlockedTerm', lang)}</Text>
  if (status === 'available') {
    return (
      <View style={s.okRow}>
        <Feather name="check-circle" size={14} color={colors.success} />
        <Text style={s.ok}>{t('pgAvailable', lang)}</Text>
      </View>
    )
  }
  if (status === 'reserved') {
    return (
      <View>
        <Text style={s.err}>{t('pgReserved', lang)}</Text>
        <TouchableOpacity
          onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('ADA – display name')}`)}
          activeOpacity={0.7}
        >
          <Text style={s.link}>{t('pgReservedEmail', lang)}</Text>
        </TouchableOpacity>
      </View>
    )
  }
  // taken | race
  return (
    <View>
      {/* Two separate lookups rather than one ternary INSIDE the call. The i18n guard
          finds keys by scanning for a literal single-quoted argument, so passing it a
          conditional hides BOTH keys from coverage.
          NB: do not write the example out in this comment — the scanner reads comments
          too, and the first version of it registered a phantom key called "key". */}
      <Text style={s.err}>{status === 'race' ? t('pgNameRace', lang) : t('pgTaken', lang)}</Text>
      {suggestions.length > 0 && (
        <>
          {status !== 'race' && <Text style={s.muted}>{t('pgTakenSuggest', lang)}</Text>}
          <View style={s.chips}>
            {suggestions.map(n => (
              <TouchableOpacity key={n} style={s.suggest} onPress={() => onPick(n)} activeOpacity={0.8}>
                <Text style={s.suggestText}>{n}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  okRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 7 },
  ok: { color: colors.success, fontSize: 13, fontWeight: '600' },
  err: { color: colors.danger, fontSize: 13, marginTop: 7, lineHeight: 19 },
  muted: { color: colors.textSecondary, fontSize: 13, marginTop: 7 },
  link: { color: colors.primary, fontSize: 13, fontWeight: '700', marginTop: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  suggest: {
    paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999,
    backgroundColor: colors.primaryLight, borderWidth: 1, borderColor: colors.primary,
  },
  suggestText: { fontSize: 13.5, color: colors.primaryDark, fontWeight: '700' },
})
