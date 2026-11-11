// "Mark available again" relists a sold listing, so it is a post action and asks the terms gate; "Mark as sold" takes content down and does not.
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native'
import { t } from '../constants/i18n'

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default)
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, Feather: () => null }))
jest.mock('../components/ContentReportMenu', () => () => null)
jest.mock('../utils/marketplaceApi', () => ({
  getListing: jest.fn(), photosFor: jest.fn(async id => ({ [id[0]]: [] })), signedUrls: jest.fn(async () => ({})), sellerName: jest.fn(async () => 'Ben'),
  setSold: jest.fn(async () => {}), deleteListing: jest.fn(), renewListing: jest.fn(), reportListing: jest.fn(), blockSeller: jest.fn(),
}))
const api = require('../utils/marketplaceApi')
const MarketplaceListingScreen = require('../screens/MarketplaceListingScreen').default
const L = 'English'
const base = { id: 'L1', owner_id: 'me', title: 'Bisiklet', category: 'other', condition: 'good', district: 'girne', description: 'd', price: 10, currency: 'EUR',
  expires_at: new Date(Date.now() + 20 * 864e5).toISOString(), hidden_at: null }
const open = async (status, onPostAction) => {
  api.getListing.mockResolvedValue({ ...base, status })
  await render(<MarketplaceListingScreen id="L1" lang={L} session={{ user: { id: 'me' } }} onBack={() => {}} onEdit={() => {}} onPostAction={onPostAction} />)
}
beforeEach(() => api.setSold.mockClear())

test('sold -> mark available again asks first (onPostAction), and runs only when the gate lets it', async () => {
  const asked = []
  await open('sold', run => asked.push(run))
  fireEvent.press(await screen.findByText(t('mkMarkAvailable', L)))
  expect(asked).toHaveLength(1); expect(api.setSold).not.toHaveBeenCalled()
  await asked[0]()
  expect(api.setSold).toHaveBeenCalledWith('L1', false)
})
test('active -> mark as sold is not gated', async () => {
  const asked = jest.fn()
  await open('active', asked)
  fireEvent.press(await screen.findByText(t('mkMarkSold', L)))
  await waitFor(() => expect(api.setSold).toHaveBeenCalledWith('L1', true))
  expect(asked).not.toHaveBeenCalled()
})
