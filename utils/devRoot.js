import { useState, useEffect } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import App from '../App'
import { LANGUAGES } from '../constants/i18n'
import { install as installTextAudit, AuditControls } from './devTextAudit'

// ─── The __DEV__ root: launch arguments, and the audits ─────────────────────
//
// index.js registers this instead of App when __DEV__, and Metro strips the whole module
// from a production bundle. Nothing here ships.
//
// ─── WHY A LAUNCH ARGUMENT FOR THE LANGUAGE ────────────────────────────────
//
// ADA's language is not a device setting. It is `profiles.preferred_language` with an
// AsyncStorage `@trnc_lang` fallback (App.js:1189), and expo-localization appears nowhere
// in the repo — which means there is no way to start the app in Greek from outside it.
// Checking a layout in nine languages by hand therefore costs nine trips through the
// in-app picker, every time, and that friction is a large part of why nobody looks at
// Greek.
//
//   EXPO_PUBLIC_DEV_LANG=Greek npx expo start -c
//
// ─── THE ONE THING THAT WILL LOOK LIKE A BUG ───────────────────────────────
//
// App.js:1189 is `profile?.preferred_language || pendingLang`. **A logged-in profile
// wins.** Seeding `@trnc_lang` steers the guest and pre-profile paths only; if you are
// signed in as a user whose profile says Turkish, you will get Turkish no matter what you
// put in this variable, and the variable is not broken. Sign out, or change the language
// in-app once so it is written to the profile.
//
// Guests can set a language and reach most of the app, so the guest path is the one this
// is for, and it is the cheaper identity to test with anyway.
//
// ─── VALUES ────────────────────────────────────────────────────────────────
//
//   EXPO_PUBLIC_DEV_LANG       a LANGUAGES key — 'Greek', 'Turkish', 'Arabic', …
//                              FULL ENGLISH NAMES, never 'el'/'tr'. An ISO code never
//                              errors anywhere in this app, it just matches nothing, so it
//                              is validated here and refused loudly.
//   EXPO_PUBLIC_DEV_ONBOARDED  'true' to skip the onboarding carousel on a fresh install.
//   EXPO_PUBLIC_DEV_POLICY_NOTICE_RESET
//                              any token (e.g. a timestamp). Clears `@trnc_policy_seen` ONCE
//                              per token, so the policy-update notice shows again on a device
//                              that already dismissed it. One-shot on purpose: later launches
//                              with the same token leave it alone, so kill-and-reopen really
//                              tests that the notice STAYS closed. "Seen" is device-only
//                              (never on the account), which is why this is the only reset.

const VALID_LANGS = new Set(LANGUAGES.map(l => l.key))

async function seedLaunchArgs() {
  const lang = process.env.EXPO_PUBLIC_DEV_LANG
  const onboarded = process.env.EXPO_PUBLIC_DEV_ONBOARDED

  if (lang) {
    if (VALID_LANGS.has(lang)) {
      await AsyncStorage.setItem('@trnc_lang', lang)
      console.log(`[ada-dev] @trnc_lang seeded to '${lang}'. A logged-in profile still overrides this.`)
    } else {
      console.warn(`[ada-dev] EXPO_PUBLIC_DEV_LANG='${lang}' is not a language this app has.\n` +
                   `          Expected one of: ${[...VALID_LANGS].join(', ')}\n` +
                   `          (full English names — 'tr' and 'el' match nothing here). Ignored.`)
    }
  }

  const policyReset = process.env.EXPO_PUBLIC_DEV_POLICY_NOTICE_RESET
  if (policyReset) {
    const done = await AsyncStorage.getItem('@trnc_dev_policy_reset')
    if (done !== policyReset) {
      await AsyncStorage.removeItem('@trnc_policy_seen')
      await AsyncStorage.setItem('@trnc_dev_policy_reset', policyReset)
      console.log(`[ada-dev] @trnc_policy_seen cleared (token ${policyReset}) — the policy notice shows once.`)
    } else {
      console.log(`[ada-dev] policy-notice reset already used for token ${policyReset} — not clearing again.`)
    }
  }

  if (onboarded === 'true') {
    await AsyncStorage.setItem('@trnc_onboarded', 'true')
    console.log('[ada-dev] @trnc_onboarded seeded — the carousel is skipped.')
  }
}

export default function DevRoot() {
  // The seed must land BEFORE App reads these keys (App.js:810 reads both in its first
  // effect). Rendering App only once the write has resolved is what makes that ordering a
  // fact rather than a race — the alternative loses the argument roughly half the time and
  // looks like the flag not working.
  const [seeded, setSeeded] = useState(false)

  useEffect(() => {
    let cancelled = false
    installTextAudit()

    // Always resolves. A dev convenience that could stop the app from starting would be a
    // worse bug than the one it exists to help find.
    seedLaunchArgs()
      .catch(e => console.warn('[ada-dev] launch-arg seeding failed, continuing:', e?.message))
      .finally(() => { if (!cancelled) setSeeded(true) })
    return () => { cancelled = true }
  }, [])

  if (!seeded) return null

  return (
    <>
      <App />
      <AuditControls />
    </>
  )
}
