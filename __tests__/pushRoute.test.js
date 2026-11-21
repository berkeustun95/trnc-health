import { pushRoute, pushIntake } from '../utils/pushRoute'

const on = { studentHub: true }
const resp = (id, data) => ({ notification: { request: { identifier: id, content: { data } } } })

describe('pushRoute', () => {
  test.each([
    ['duty', 'duty'], ['weekend', 'weekend'], ['profile', 'profile'], ['notifications', 'notifications'],
    ['conversation', 'conversation'], ['eatery_order', 'eatery_order'], ['admin', 'admin'],
    ['marketplace', 'marketplace'], ['marketplace_conversation', 'marketplace'],
  ])('screen %s -> %s', (screen, kind) => {
    expect(pushRoute({ screen }, on)).toBe(kind)
  })

  test('conversation is null unless studentHub is true', () => {
    expect(pushRoute({ screen: 'conversation' }, { studentHub: false })).toBeNull()
    expect(pushRoute({ screen: 'conversation' }, {})).toBeNull()
    expect(pushRoute({ screen: 'conversation' })).toBeNull()
  })

  test('other kinds do not depend on studentHub', () => {
    expect(pushRoute({ screen: 'duty' }, { studentHub: false })).toBe('duty')
    expect(pushRoute({ screen: 'marketplace' })).toBe('marketplace')
  })

  test('unknown screen and non-object data -> null', () => {
    expect(pushRoute({ screen: 'nope' }, on)).toBeNull()
    expect(pushRoute({}, on)).toBeNull()
    for (const bad of [null, undefined, 'duty', 42, true]) expect(pushRoute(bad, on)).toBeNull()
  })
})

describe('pushIntake', () => {
  test('no or malformed response -> none', () => {
    for (const bad of [null, undefined, {}, { notification: null }, { notification: {} }, 'x', 5]) {
      expect(pushIntake(bad, { hasSession: true, handled: new Set() }).action).toBe('none')
    }
    const throwing = { get notification() { throw new Error('boom') } }
    expect(pushIntake(throwing, { hasSession: true, handled: new Set() }).action).toBe('none')
  })

  test('route with a session', () => {
    expect(pushIntake(resp('a', { screen: 'duty' }), { hasSession: true, handled: new Set() }))
      .toEqual({ action: 'route', id: 'a', data: { screen: 'duty' } })
  })

  test('park without a session', () => {
    expect(pushIntake(resp('a', { screen: 'duty' }), { hasSession: false, handled: new Set() }).action).toBe('park')
  })

  test('dup when the id was already handled, even without a session', () => {
    const handled = new Set(['a'])
    expect(pushIntake(resp('a', {}), { hasSession: true, handled }).action).toBe('dup')
    expect(pushIntake(resp('a', {}), { hasSession: false, handled }).action).toBe('dup')
    expect(pushIntake(resp('b', {}), { hasSession: true, handled }).action).toBe('route')
  })

  test('missing data -> {}', () => {
    expect(pushIntake({ notification: { request: { identifier: 'a', content: {} } } }, { hasSession: true, handled: new Set() }).data).toEqual({})
  })

  test('the caller adds the id: a second intake of the same tap is a dup', () => {
    const handled = new Set()
    const r = resp('a', { screen: 'duty' })
    const first = pushIntake(r, { hasSession: true, handled })
    handled.add(first.id)
    expect(pushIntake(r, { hasSession: true, handled }).action).toBe('dup')
  })
})
