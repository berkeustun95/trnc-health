// An EDIT whose row update (and photo removals) already committed, then a photo insert refused with TERMS_REQUIRED:
// the terms gate opens, but if the user cancels it the form must still say the save is incomplete (mkErrPhotosPartial).
// A refusal on the FIRST write (nothing saved) keeps no error line.
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native'
import { t } from '../constants/i18n'

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default)
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, Feather: () => null }))
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: 'file:///a.jpg', base64: 'x' }] })),
  MediaTypeOptions: { Images: 'Images' },
}))
jest.mock('../components/PageBackground', () => () => null)
jest.mock('../utils/marketplaceApi', () => ({
  createListing: jest.fn(), updateListing: jest.fn(), removePhoto: jest.fn(async () => {}), uploadPhoto: jest.fn(),
  photosFor: jest.fn(async ids => Object.fromEntries(ids.map(i => [i, [{ id: 'p1', position: 0, status: 'approved', storage_path: 'x/p1' }]]))),
  signedUrls: jest.fn(async () => ({})),
}))
const api = require('../utils/marketplaceApi')
const MarketplaceFormScreen = require('../screens/MarketplaceFormScreen').default
const L = 'English'
const LISTING = { id: 'L1', title: 'Şehir bisikleti', category: 'other', condition: 'used', district: 'nicosia', is_free: false, price_tl: 100,
  description: 'Temiz, az kullanılmış bir bisiklet.' }
const refused = () => Object.assign(new Error('TERMS_REQUIRED'), { code: 'P0001' })

async function openAndSave(onTermsRequired) {
  await render(<MarketplaceFormScreen lang={L} session={{ user: { id: 'u1' } }} listing={LISTING} onBack={() => {}} onSaved={() => {}} onTermsRequired={onTermsRequired} />)
  await fireEvent.press(screen.getByLabelText(t('mkAddPhotos', L)))
  await screen.findAllByLabelText(t('uiRemove', L))
  await fireEvent.press(screen.getByText(t('mkSave', L)))
}

beforeEach(() => jest.clearAllMocks())

test('edit: the row update committed, a photo insert refused with TERMS_REQUIRED -> the gate opens AND the "saved, some photos did not upload" line shows', async () => {
  api.updateListing.mockResolvedValue(undefined)
  api.uploadPhoto.mockRejectedValue(refused())
  const onTermsRequired = jest.fn()
  await openAndSave(onTermsRequired)
  await waitFor(() => expect(onTermsRequired).toHaveBeenCalledTimes(1))
  expect(await screen.findByText(t('mkErrPhotosPartial', L))).toBeTruthy()
})

test('edit: the first write (the row update) refused with TERMS_REQUIRED -> the gate opens and there is no error line', async () => {
  api.updateListing.mockRejectedValue(refused())
  const onTermsRequired = jest.fn()
  await openAndSave(onTermsRequired)
  await waitFor(() => expect(onTermsRequired).toHaveBeenCalledTimes(1))
  expect(api.uploadPhoto).not.toHaveBeenCalled()
  expect(screen.queryByText(t('mkErrPhotosPartial', L))).toBeNull()
})
