// Onboarding v2 — the pure rules. Imports nothing, so jest exercises the routing and the
// second-offer eligibility without mocks. The AsyncStorage reads/writes live in App.js.

// --- storage keys -----------------------------------------------------------

export const KEY_ONBOARDED   = '@trnc_onboarded'    // 'true'
export const KEY_LANG        = '@trnc_lang'
export const KEY_POLICY_SEEN = '@trnc_policy_seen'  // LEGAL_VERSION
export const KEY_PENDING     = '@trnc_onb2_pending' // PENDING_SIGNUP | PENDING_DUTY | PENDING_SIGNIN
export const KEY_DUTY_OFFER  = '@trnc_duty_offer'   // OFFER_GRANTED | OFFER_DENIED | OFFER_LATER
export const KEY_REOFFER     = '@trnc_duty_reoffer' // REOFFER_SHOWN, once per device ever
export const KEY_TOUR_CHIP   = '@trnc_tour_chip'    // TOUR_CHIP_ON

export const PENDING_SIGNUP = 'signup'
export const PENDING_DUTY   = 'duty'
export const PENDING_SIGNIN = 'signin'

export const OFFER_GRANTED = 'granted'
export const OFFER_DENIED  = 'denied'
export const OFFER_LATER   = 'later'

export const REOFFER_SHOWN = 'shown'
export const TOUR_CHIP_ON  = '1'

// --- onboarding_events.event values ------------------------------------------

export const START_SHOWN_EVENT = 'start_shown'

// Start's three choices, logged on the tap before anything else runs.
export const START_CHOICE_EVENTS = {
  signup: 'start_choice_signup',
  signin: 'start_choice_signin',
  guest:  'start_choice_guest',
}

export const OFFER_EVENTS = {
  shown: 'offer_shown',
  [OFFER_GRANTED]: 'offer_granted',
  [OFFER_DENIED]: 'offer_denied',
  [OFFER_LATER]: 'offer_later',
}

export const REOFFER_EVENTS = {
  later:    { shown: 'reoffer_shown',          granted: 'reoffer_granted',          declined: 'reoffer_declined' },
  existing: { shown: 'reoffer_existing_shown', granted: 'reoffer_existing_granted', declined: 'reoffer_existing_declined' },
}

// --- routing ----------------------------------------------------------------
//
// Returns { step, writeOnboarded, clearPending }; step is 'start' | 'app' | 'duty' | 'wait'.
// 'app' means "the normal selector decides": the age screen and the profile wizard sit above
// Screen 2 there, so those cases leave pending untouched and the wizard can hand 'signup' on.
// `perm` is this device's notification permission (getPermissionsAsync), read only for 'signin'.
export function decideOnboardingStep({ onboarded, pending, hasSession, isGuest, role, ageIneligible, gateActive, profileLoaded, perm }) {
  const result = (step, writeOnboarded = false, clearPending = false) => ({ step, writeOnboarded, clearPending })

  if (!hasSession) return result('start')

  // No pending key with a session = an existing user (or an onboarded device): heal the flag.
  if (pending !== PENDING_DUTY && pending !== PENDING_SIGNUP && pending !== PENDING_SIGNIN) {
    return result('app', onboarded !== 'true', pending != null)
  }

  // Role and wizard state are unknown until the profile arrives; rendering Home now would flash it.
  if (!profileLoaded) return result('wait')

  if (ageIneligible) return result('app')

  // Allowlist: every provider-type role (provider, estate_agent, organizer, ...) is out of scope.
  if (!(isGuest || role === 'customer')) return result('app', onboarded !== 'true', true)

  if (gateActive) return result('app')

  if (pending === PENDING_DUTY) return result('duty')

  // "Giriş yap": Screen 2 only while the OS can still show its prompt. Android 13+ reports a never-asked
  // permission as 'denied' (notifications off) with canAskAgain true, so 'undetermined' alone would never
  // match there; iOS 'denied' always carries canAskAgain false. Granted or blocked: straight to Home.
  if (pending === PENDING_SIGNIN) {
    if (!perm || typeof perm.status !== 'string') return result('wait')
    if (perm.status !== 'granted' && perm.canAskAgain !== false) return result('duty')
    return result('app', onboarded !== 'true', true)
  }

  // pending 'signup' on a profile that never needed the wizard: an existing complete account.
  return result('app', onboarded !== 'true', true)
}

// An already-onboarded device that signed out never gets Screen 2 again.
export function shouldArmPending({ onboarded }) {
  return onboarded !== 'true'
}

// 'signin' stays 'signin': it is decided on the permission once the wizard is done.
export function pendingAfterWizard(pending) {
  return pending === PENDING_SIGNUP ? PENDING_DUTY : pending
}

// --- push registration at launch -------------------------------------------
//
// A launch registers silently unless Screen 2 said "Şimdi değil": Android <= 12 reports notifications
// granted by default, so 'later' would otherwise still register. 'denied' is not blocked: an OS grant
// after it means the user allowed notifications in Settings. A tap (the inbox's "Bildirimleri aç",
// the second offer) is not governed by this.
export function launchMayRegisterPush(offer) {
  return offer !== OFFER_LATER
}

// --- S4 second offer ----------------------------------------------------------
//
// Returns null | 'later' | 'existing'. The caller writes KEY_REOFFER BEFORE showing, so anything
// unknown (no permission read yet) must answer null: a wrong yes burns the only offer.
// 'later' is offered even when the OS reports granted (Android <= 12 by default): launches do not
// register for 'later', so the sheet is that user's way back. 'existing' needs the OS to be able to ask.
export function decideReoffer({ offer, reoffer, onboarded, fromPush, canRender, perm }) {
  if (reoffer === REOFFER_SHOWN || fromPush || !canRender) return null
  if (!perm || typeof perm.status !== 'string') return null
  const granted = perm.status === 'granted'

  if (offer === OFFER_LATER) return granted || perm.canAskAgain !== false ? 'later' : null
  if (offer == null && onboarded === 'true' && !granted && perm.canAskAgain !== false) return 'existing'
  return null
}

// The sheet's second sentence promises the home city's pharmacies on top. With no home city
// (@trnc_city_home unset or 'visiting') and no GPS fix there is no such list, so it is left out.
export function reofferNoCity({ home, hasFix }) {
  return !hasFix && (home == null || home === 'visiting')
}
