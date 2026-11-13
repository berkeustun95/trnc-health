// AgeIneligibleScreen is the under-13 exit: its sign-out must end the session on every device.
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native'
import { t } from '../constants/i18n'

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default)
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }))
// Order matters: the token clear (a profiles update) is attempted before the global sign-out.
const mockOrder = []
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(async () => 'ExponentPushToken[x]'), setItem: jest.fn(), removeItem: jest.fn() } }))
jest.mock('../lib/supabase', () => {
  const q = { eq: () => q, then: res => { mockOrder.push('clear'); return Promise.resolve({ error: null }).then(res) } }
  return {
    isGuest: () => false,
    supabase: { auth: {
      getSession: jest.fn(async () => ({ data: { session: { user: { id: 'u1' } } } })),
      signOut: jest.fn(async () => { mockOrder.push('signOut'); return { error: null } }),
    }, from: () => ({ update: () => q }) },
  }
})
jest.mock('../components/ui/PageCanvas', () => ({ children }) => children)
jest.mock('../components/SplashStatusBar', () => () => null)

const { supabase } = require('../lib/supabase')
const AgeIneligibleScreen = require('../screens/AgeIneligibleScreen').default

test('under-13 sign-out is global', async () => {
  await render(<AgeIneligibleScreen lang="English" />)
  await fireEvent.press(await screen.findByText(t('pgAgeSignOut', 'English')))
  await waitFor(() => expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'global' }))
  expect(mockOrder).toEqual(['clear', 'signOut'])
}, 30000)
