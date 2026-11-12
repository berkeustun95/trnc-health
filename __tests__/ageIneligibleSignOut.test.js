// AgeIneligibleScreen is the under-13 exit: its sign-out must end the session on every device.
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native'
import { t } from '../constants/i18n'

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default)
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }))
jest.mock('../lib/supabase', () => ({ supabase: { auth: { signOut: jest.fn(async () => ({ error: null })) } } }))
jest.mock('../components/ui/PageCanvas', () => ({ children }) => children)
jest.mock('../components/SplashStatusBar', () => () => null)

const { supabase } = require('../lib/supabase')
const AgeIneligibleScreen = require('../screens/AgeIneligibleScreen').default

test('under-13 sign-out is global', async () => {
  await render(<AgeIneligibleScreen lang="English" />)
  await fireEvent.press(await screen.findByText(t('pgAgeSignOut', 'English')))
  await waitFor(() => expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'global' }))
}, 30000)
