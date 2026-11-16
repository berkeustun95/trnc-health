import { parseAdaRoute } from '../utils/deepLinkRoutes'

describe('parseAdaRoute', () => {
  test.each([
    ['ada://duty', { route: 'duty', id: null }],
    ['ada://kesfet', { route: 'kesfet', id: null }],
    ['ada://eatery', { route: 'eatery', id: null }],
    ['ada://emlak', { route: 'emlak', id: null }],
    ['ada://duyurular', { route: 'duyurular', id: null }],
    ['ada://duyurular/1234', { route: 'duyurular', id: '1234' }],
    ['ada://events/9f1c2b7e-0000-4000-8000-000000000001', { route: 'events', id: '9f1c2b7e-0000-4000-8000-000000000001' }],
    ['ada:///duty', { route: 'duty', id: null }],
    ['ada://duty/', { route: 'duty', id: null }],
    ['ada://araclar', { route: 'araclar', id: null }],
    ['ada://dukkan', { route: 'dukkan', id: null }],
  ])('%s', (url, expected) => {
    expect(parseAdaRoute(url)).toEqual(expected)
  })

  test.each([
    // Sign-in links belong to App.js's auth handler, never to the router.
    'ada://',
    'ada://?token_hash=abc&type=signup',
    'ada://?code=abc',
    'ada://#access_token=a&refresh_token=b&type=recovery',
    'ada://duty?code=abc',
    'ada://#error=access_denied&error_code=otp_expired',
    // Unknown, foreign or malformed.
    'ada://nope',
    'ada://profile',
    'https://getadaapp.com/duty',
    'exp://192.168.1.2:8081/--/duty',
    null,
    undefined,
  ])('%s → null', url => {
    expect(parseAdaRoute(url)).toBeNull()
  })
})
