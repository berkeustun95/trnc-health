// utils/onboardingState.js: Onboarding v2 routing (Start -> Screen 2 -> Home) and the once-per-device second offer.
const S = require('../utils/onboardingState')

const ALLOWED_EVENTS = [
  'start_shown', 'offer_shown', 'offer_granted', 'offer_denied', 'offer_later',
  'reoffer_shown', 'reoffer_granted', 'reoffer_declined',
  'reoffer_existing_shown', 'reoffer_existing_granted', 'reoffer_existing_declined',
]

const base = {
  onboarded: null, pending: null, hasSession: true, isGuest: false, role: 'customer',
  ageIneligible: false, gateActive: false, profileLoaded: true,
}
const step = over => S.decideOnboardingStep({ ...base, ...over })
const r = (s, writeOnboarded = false, clearPending = false) => ({ step: s, writeOnboarded, clearPending })

describe('decideOnboardingStep', () => {
  test('fresh device, no session -> start', () => {
    expect(step({ hasSession: false, profileLoaded: false })).toEqual(r('start'))
  })
  test('flag set + no session (signed out) -> start', () => {
    expect(step({ onboarded: 'true', hasSession: false })).toEqual(r('start'))
  })
  test('flag set + session -> app, nothing to write', () => {
    expect(step({ onboarded: 'true' })).toEqual(r('app'))
  })
  test('session without flag and no pending -> app + heal onboarded (existing user), even before the profile loads', () => {
    expect(step({ profileLoaded: false })).toEqual(r('app', true, false))
  })
  test('unknown pending value -> app, cleared', () => {
    expect(step({ onboarded: 'true', pending: 'bogus' })).toEqual(r('app', false, true))
  })
  test('pending duty + guest session -> duty', () => {
    expect(step({ pending: 'duty', isGuest: true })).toEqual(r('duty'))
  })
  test('pending duty + guest with no role read -> duty', () => {
    expect(step({ pending: 'duty', isGuest: true, role: undefined })).toEqual(r('duty'))
  })
  test('pending duty while the profile is not loaded -> wait (no Home flash)', () => {
    expect(step({ pending: 'duty', isGuest: true, profileLoaded: false })).toEqual(r('wait'))
  })
  test('pending signup while the profile is not loaded -> wait', () => {
    expect(step({ pending: 'signup', profileLoaded: false })).toEqual(r('wait'))
  })
  test('pending signup + wizard active -> app, pending kept for the wizard hand-off, no writes', () => {
    expect(step({ pending: 'signup', gateActive: true })).toEqual(r('app', false, false))
  })
  test('pending duty + wizard active -> app, pending kept (wizard first, Screen 2 after)', () => {
    expect(step({ pending: 'duty', gateActive: true })).toEqual(r('app', false, false))
  })
  test('after the wizard: signup becomes duty and routes to Screen 2', () => {
    const pending = S.pendingAfterWizard('signup')
    expect(pending).toBe('duty')
    expect(step({ pending })).toEqual(r('duty'))
  })
  test('pendingAfterWizard leaves other values alone', () => {
    expect(S.pendingAfterWizard('duty')).toBe('duty')
    expect(S.pendingAfterWizard(null)).toBe(null)
  })
  test('pending signup + complete existing account -> app + clearPending + writeOnboarded', () => {
    expect(step({ pending: 'signup' })).toEqual(r('app', true, true))
  })
  test.each(['admin', 'provider', 'home_service_provider', 'estate_agent', 'organizer', 'insurance_provider'])(
    '%s with pending -> app + clearPending, never duty', role => {
      expect(step({ pending: 'duty', role })).toEqual(r('app', true, true))
      expect(step({ pending: 'signup', role })).toEqual(r('app', true, true))
    })
  test('ageIneligible -> never duty, writes nothing', () => {
    expect(step({ pending: 'duty', ageIneligible: true })).toEqual(r('app', false, false))
    expect(step({ pending: 'duty', isGuest: true, ageIneligible: true })).toEqual(r('app', false, false))
  })
  test('pending duty on an onboarded device (app died between the resolve writes) -> duty again', () => {
    expect(step({ onboarded: 'true', pending: 'duty' })).toEqual(r('duty'))
  })
  test('applying the returned writes converges: a second decision asks for nothing more', () => {
    const cases = [
      {}, { pending: 'signup' }, { pending: 'duty', role: 'admin' }, { pending: 'bogus' }, { onboarded: 'true' },
    ]
    for (const c of cases) {
      const first = step(c)
      const next = { ...c }
      if (first.writeOnboarded) next.onboarded = 'true'
      if (first.clearPending) next.pending = null
      expect(step(next)).toEqual(r(first.step))
    }
  })
})

describe('shouldArmPending', () => {
  test('fresh device arms pending', () => {
    expect(S.shouldArmPending({ onboarded: null })).toBe(true)
  })
  test('already-onboarded device does not arm pending', () => {
    expect(S.shouldArmPending({ onboarded: 'true' })).toBe(false)
  })
})

describe('decideReoffer', () => {
  const denied = { status: 'denied', canAskAgain: true }
  const rbase = { offer: null, reoffer: null, onboarded: 'true', fromPush: false, canRender: true, perm: denied }
  const re = over => S.decideReoffer({ ...rbase, ...over })

  test("'later' at Screen 2 -> re-offer once; with reoffer 'shown' -> null", () => {
    expect(re({ offer: 'later', perm: { status: 'undetermined', canAskAgain: true } })).toBe('later')
    expect(re({ offer: 'later', reoffer: 'shown', perm: { status: 'undetermined', canAskAgain: true } })).toBe(null)
  })
  test("'later' but the OS will not ask again -> null", () => {
    expect(re({ offer: 'later', perm: { status: 'denied', canAskAgain: false } })).toBe(null)
  })
  test('existing user, permission denied but can ask again -> existing', () => {
    expect(re({})).toBe('existing')
    expect(re({ offer: undefined })).toBe('existing')
  })
  test('existing user permanently denied -> null', () => {
    expect(re({ perm: { status: 'denied', canAskAgain: false } })).toBe(null)
  })
  test('existing user, once only', () => {
    expect(re({ reoffer: 'shown' })).toBe(null)
  })
  test('not onboarded and no offer -> null', () => {
    expect(re({ onboarded: null })).toBe(null)
  })
  test('opened from a push -> null', () => {
    expect(re({ fromPush: true })).toBe(null)
    expect(re({ offer: 'later', fromPush: true })).toBe(null)
  })
  test('cannot render now -> null', () => {
    expect(re({ canRender: false })).toBe(null)
  })
  test('permission granted -> null', () => {
    expect(re({ perm: { status: 'granted', canAskAgain: true } })).toBe(null)
    expect(re({ offer: 'later', perm: { status: 'granted', canAskAgain: true } })).toBe(null)
  })
  test("'denied' or 'granted' at Screen 2 -> null", () => {
    expect(re({ offer: 'denied' })).toBe(null)
    expect(re({ offer: 'granted' })).toBe(null)
  })
  test('permission not read yet -> null, never throws', () => {
    expect(re({ perm: undefined })).toBe(null)
    expect(re({ offer: 'later', perm: null })).toBe(null)
    expect(re({ perm: {} })).toBe(null)
  })
})

describe('events', () => {
  test('exported event strings are exactly the 11 allowed, no duplicates', () => {
    const exported = [
      S.START_SHOWN_EVENT,
      ...Object.values(S.OFFER_EVENTS),
      ...Object.values(S.REOFFER_EVENTS).flatMap(v => Object.values(v)),
    ]
    expect(exported).toHaveLength(11)
    expect(new Set(exported).size).toBe(11)
    expect([...exported].sort()).toEqual([...ALLOWED_EVENTS].sort())
  })
  test('lookups by the stored offer values and decideReoffer results are defined', () => {
    for (const k of ['shown', S.OFFER_GRANTED, S.OFFER_DENIED, S.OFFER_LATER]) expect(ALLOWED_EVENTS).toContain(S.OFFER_EVENTS[k])
    for (const k of ['later', 'existing']) {
      for (const a of ['shown', 'granted', 'declined']) expect(ALLOWED_EVENTS).toContain(S.REOFFER_EVENTS[k][a])
    }
  })
})

describe('launchMayRegisterPush', () => {
  test('declined offers block the silent launch registration', () => {
    expect(S.launchMayRegisterPush('later')).toBe(false)
    expect(S.launchMayRegisterPush('denied')).toBe(false)
  })
  test('granted and no stored offer (existing users) register as before', () => {
    expect(S.launchMayRegisterPush('granted')).toBe(true)
    expect(S.launchMayRegisterPush(null)).toBe(true)
    expect(S.launchMayRegisterPush(undefined)).toBe(true)
  })
})

describe('constants', () => {
  test('keys and values are exact', () => {
    expect([S.KEY_ONBOARDED, S.KEY_LANG, S.KEY_POLICY_SEEN, S.KEY_PENDING, S.KEY_DUTY_OFFER, S.KEY_REOFFER, S.KEY_TOUR_CHIP])
      .toEqual(['@trnc_onboarded', '@trnc_lang', '@trnc_policy_seen', '@trnc_onb2_pending', '@trnc_duty_offer', '@trnc_duty_reoffer', '@trnc_tour_chip'])
    expect([S.PENDING_SIGNUP, S.PENDING_DUTY, S.OFFER_GRANTED, S.OFFER_DENIED, S.OFFER_LATER, S.REOFFER_SHOWN, S.TOUR_CHIP_ON])
      .toEqual(['signup', 'duty', 'granted', 'denied', 'later', 'shown', '1'])
  })
})
