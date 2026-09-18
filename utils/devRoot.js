import { useState, useEffect } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import App from '../App'
import { LANGUAGES } from '../constants/i18n'
import { install as installTextAudit, AuditControls } from './devTextAudit'
import { installSafeAreaAudit } from './devSafeAreaAudit'

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
    // The text audit always runs — it is the one worth having.
    installTextAudit()

    // ► THE SAFE-AREA AUDIT IS OPT-IN, AND IT EARNED THAT.
    //   It is the weakest of the three by its own header, its noise level has never been
    //   measured because it has never been run, and on its first contact with a real
    //   bundler it took the whole app down with a dynamic require — a check nobody had
    //   validated yet stopped the app from starting. That is a bad trade to make by
    //   default for the check you are least sure about.
    //
    //   So it stays out of the way until asked for:
    //       EXPO_PUBLIC_DEV_SAFEAREA=1 npx expo start -c
    //   The overflow detector, which is the point of all this, no longer depends on it.
    if (process.env.EXPO_PUBLIC_DEV_SAFEAREA === '1') installSafeAreaAudit()
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
