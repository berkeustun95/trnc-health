// Onboarding v2 — the pure rules. Imports nothing, so jest exercises the routing and the
// second-offer eligibility without mocks. The AsyncStorage reads/writes live in App.js.

// --- storage keys -----------------------------------------------------------

export const KEY_ONBOARDED   = '@trnc_onboarded'    // 'true'
export const KEY_LANG        = '@trnc_lang'
export const KEY_POLICY_SEEN = '@trnc_policy_seen'  // LEGAL_VERSION
export const KEY_PENDING     = '@trnc_onb2_pending' // PENDING_SIGNUP | PENDING_DUTY
export const KEY_DUTY_OFFER  = '@trnc_duty_offer'   // OFFER_GRANTED | OFFER_DENIED | OFFER_LATER
export const KEY_REOFFER     = '@trnc_duty_reoffer' // REOFFER_SHOWN, once per device ever
export const KEY_TOUR_CHIP   = '@trnc_tour_chip'    // TOUR_CHIP_ON

export const PENDING_SIGNUP = 'signup'
export const PENDING_DUTY   = 'duty'

export const OFFER_GRANTED = 'granted'
export const OFFER_DENIED  = 'denied'
export const OFFER_LATER   = 'later'

export const REOFFER_SHOWN = 'shown'
export const TOUR_CHIP_ON  = '1'

// --- onboarding_events.event values ------------------------------------------

export const START_SHOWN_EVENT = 'start_shown'

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
export function decideOnboardingStep({ onboarded, pending, hasSession, isGuest, role, ageIneligible, gateActive, profileLoaded }) {
  const result = (step, writeOnboarded = false, clearPending = false) => ({ step, writeOnboarded, clearPending })

  if (!hasSession) return result('start')

  // No pending key with a session = an existing user (or an onboarded device): heal the flag.
  if (pending !== PENDING_DUTY && pending !== PENDING_SIGNUP) {
    return result('app', onboarded !== 'true', pending != null)
  }

  // Role and wizard state are unknown until the profile arrives; rendering Home now would flash it.
  if (!profileLoaded) return result('wait')

  if (ageIneligible) return result('app')

  // Allowlist: every provider-type role (provider, estate_agent, organizer, ...) is out of scope.
  if (!(isGuest || role === 'customer')) return result('app', onboarded !== 'true', true)

  if (gateActive) return result('app')

  if (pending === PENDING_DUTY) return result('duty')

  // pending 'signup' on a profile that never needed the wizard: an existing complete account.
  return result('app', onboarded !== 'true', true)
}

// An already-onboarded device that signed out never gets Screen 2 again.
export function shouldArmPending({ onboarded }) {
  return onboarded !== 'true'
}

export function pendingAfterWizard(pending) {
  return pending === PENDING_SIGNUP ? PENDING_DUTY : pending
}

// --- push registration at launch -------------------------------------------
//
// A launch registers silently only if Screen 2 was not declined: Android <= 12 reports notifications
// granted by default, so "Şimdi değil" would otherwise still register. No offer stored (existing
// users) or granted: unchanged. A tap (the inbox's "Bildirimleri aç") is not governed by this.
export function launchMayRegisterPush(offer) {
  return offer !== OFFER_LATER && offer !== OFFER_DENIED
}

// --- S4 second offer ----------------------------------------------------------
//
// Returns null | 'later' | 'existing'. The caller writes KEY_REOFFER BEFORE showing, so anything
// unknown (no permission read yet) must answer null: a wrong yes burns the only offer.
export function decideReoffer({ offer, reoffer, onboarded, fromPush, canRender, perm }) {
  if (reoffer === REOFFER_SHOWN || fromPush || !canRender) return null
  if (!perm || typeof perm.status !== 'string') return null
  if (perm.status === 'granted') return null
  if (perm.canAskAgain === false) return null

  if (offer === OFFER_LATER) return 'later'
  if (offer == null && onboarded === 'true') return 'existing'
  return null
}
