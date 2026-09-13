import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, radius, shadow } from '../constants/theme'
import { t } from '../constants/i18n'

// ─── Bağlantı & eSIM — the "we have nothing to show and that is WRONG" state ──
//
// ⚠ THIS IS AN ERROR STATE, NOT AN EMPTY STATE, AND THE DISTINCTION IS THE WHOLE POINT.
//   Neither of the tables behind this module can legitimately be empty: a live partner
//   module with no operator, or an operator with no active packages, is a fault. Rendering
//   either as a calm empty list is the duty_list failure repeated — the app telling users
//   there is nothing tonight when the truth is that we lost the list.
//
// ⚠ IT MUST NEVER BE MISTAKEN FOR EsimScreen'S COMING-SOON SURFACE. If a data fault looks
//   like the pre-launch state, the reading is "the flag is off" when the truth is "the
//   query is broken" — so the two are separated by three cues, only one of which is copy:
//
//     ICON    alert-circle-outline in colors.danger on dangerLight
//             (coming-soon uses cellular-outline in teal on tintServiceBg)
//     BADGE   none at all
//             (coming-soon always carries a "ÇOK YAKINDA" pill)
//     ACTION  a retry button
//             (coming-soon offers a waitlist FORM)
//
//   Red never appears on the coming-soon screen and a retry button never appears beside a
//   waitlist form, so the two cannot be confused at a glance. Do not "harmonise" this with
//   the rest of the module's styling — the visual distance IS the feature.
//
// ─── ONE USER-FACING STATE FOR TWO CAUSES, ON PURPOSE ───────────────────────
//
// A failed request and a successful request that returned zero rows both land here. The
// user has exactly one useful action for either, so a second screen would be a distinction
// only we can act on. They stay apart in the CALLER (the `failed` boolean) because they are
// different problems for us: a network error is the user's connection, zero rows is our
// content — and zero rows is the dangerous half, because nothing is broken and it can sit
// in production looking like a load failure to the user and like nothing at all to us.
//
// There is no client-side error-logging path in this app to wire that into, and adding one
// would need a migration (contact_events.action is CHECK-constrained) and would cut against
// the deliberate anti-telemetry stance in utils/moduleUsage.js. It is caught server-side
// instead, by `npm run conn:health` — see scripts/check-connectivity-content.mjs.
//
// The retry callback is INJECTED rather than assumed: this component is used by the landing
// (which re-runs the operator query) and by the operator screen (which re-runs packages).
// Coupling them would make one screen's retry silently re-fetch the other's data.
// TITLE NAMES WHAT ACTUALLY FAILED; body and retry are shared. One string everywhere would
// tell a user on screen 2 that the operator list broke, when they have just watched it load
// — so the caller supplies the title key and the defaults serve the landing.
export default function ConnectivityErrorState({
  lang,
  onRetry,
  retrying = false,
  titleKey = 'connErrorTitle',
  bodyKey  = 'connErrorBody',
}) {
  return (
    <View style={s.card}>
      <View style={s.iconWrap}>
        <Ionicons name="alert-circle-outline" size={30} color={colors.danger} />
      </View>

      <Text style={s.title}>{t(titleKey, lang)}</Text>
      <Text style={s.body}>{t(bodyKey, lang)}</Text>

      <TouchableOpacity
        style={[s.retryBtn, retrying && s.retryBtnDisabled]}
        onPress={onRetry}
        disabled={retrying || !onRetry}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={t('connRetry', lang)}
      >
        {retrying
          ? <ActivityIndicator color="#fff" />
          : (
            <>
              <Ionicons name="refresh" size={17} color="#fff" />
              <Text style={s.retryText}>{t('connRetry', lang)}</Text>
            </>
          )}
      </TouchableOpacity>
    </View>
  )
}

const s = StyleSheet.create({
  card:      { backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 24, alignItems: 'center', ...shadow },
  iconWrap:  { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.dangerLight, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  title:     { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textAlign: 'center', marginBottom: 8 },
  body:      { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  // Full-width so the affordance is unmistakable — a fault screen is not the place for a
  // subtle text link.
  retryBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, alignSelf: 'stretch', backgroundColor: colors.primary, borderRadius: radius.card, paddingVertical: 14, marginTop: 20 },
  retryBtnDisabled: { opacity: 0.6 },
  retryText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
})
