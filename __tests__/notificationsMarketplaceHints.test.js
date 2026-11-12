// Bildirimler rows that open something Bandabuliya show what a tap does: a photo decision tied to a listing opens the
// listing, an untied one İlanlarım, a Bandabuliya chat row the chat; a Student Hub message row is inert and shows nothing.
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default)
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }))
jest.mock('expo-notifications', () => ({ getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })) }))
jest.mock('../constants/redesign', () => ({ MARKETPLACE: true, REDESIGN: true }))
jest.mock('../components/PageBackground', () => () => null)
jest.setTimeout(20000)

import { render, screen, fireEvent } from '@testing-library/react-native'
import { t } from '../constants/i18n'
const NotificationsScreen = require('../screens/NotificationsScreen').default
const L = 'Turkish'
const now = new Date().toISOString()
const row = o => ({ id: 'n', title: 'Başlık', body: 'Gövde', read: false, created_at: now, ...o })

async function show(rows, onNotifPress = jest.fn()) {
  await render(<NotificationsScreen notifications={rows} loading={false} lang={L} onBack={() => {}} onMarkAllRead={() => {}} onClearAll={() => {}}
    onNotifPress={onNotifPress} onMarkRead={() => {}} />)
  return onNotifPress
}

test('photo decision tied to a listing: "İlanı açmak için dokun", and the tap goes to the app', async () => {
  const rows = [row({ id: 'a', type: 'marketplace', listing_id: 'l1' })]
  const press = await show(rows)
  expect(screen.getByText(t('mkTapOpenListing', L))).toBeTruthy()
  expect(screen.queryByText(t('mkTapViewMine', L))).toBeNull()
  await fireEvent.press(screen.getByText('Başlık'))
  expect(press).toHaveBeenCalledWith(rows[0])
})
test('photo decision without a listing id: keeps the İlanlarım hint', async () => {
  await show([row({ type: 'marketplace' })])
  expect(screen.getByText(t('mkTapViewMine', L))).toBeTruthy()
  expect(screen.queryByText(t('mkTapOpenListing', L))).toBeNull()
})
