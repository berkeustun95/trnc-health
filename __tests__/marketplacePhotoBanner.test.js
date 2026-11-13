// "Fotoğraflar inceleniyor" is the seller's note about a PENDING photo. It must not show for a listing with no photo or
// whose only photo was rejected (then both banners showed), and a non-owner (RLS: approved photos only) gets no review
// banner at all, just the category placeholder. İlanlarım's card derives the same from the photo statuses.
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default)
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }))
jest.mock('../components/ContentReportMenu', () => () => null)
jest.mock('../lib/supabase', () => ({ supabase: { rpc: jest.fn(), from: jest.fn() }, isGuest: () => false }))
jest.mock('../constants/redesign', () => ({ MARKETPLACE: true, REDESIGN: true }))
jest.mock('../utils/marketplaceApi', () => ({
  getListing: jest.fn(), photosFor: jest.fn(), signedUrls: jest.fn(async () => ({})), sellerName: jest.fn(async () => 'Ayşe'),
  myListings: jest.fn(), setSold: jest.fn(), deleteListing: jest.fn(), renewListing: jest.fn(), reportListing: jest.fn(), blockSeller: jest.fn(),
}))

jest.setTimeout(20000)   // the first render compiles the whole screen tree on a cold transform cache
import { render, screen } from '@testing-library/react-native'
import { t } from '../constants/i18n'
const api = require('../utils/marketplaceApi')
const ListingScreen = require('../screens/MarketplaceListingScreen').default
const MineScreen = require('../screens/MarketplaceMineScreen').default
const L = 'Turkish'
const ME = 'me'
const listing = { id: 'l1', owner_id: ME, title: 'Bisiklet', description: 'd', category: 'other', condition: 'good', district: 'girne',
  price_tl: 100, is_free: false, status: 'active', hidden_at: null, expires_at: new Date(Date.now() + 20 * 864e5).toISOString() }
const ph = (id, status) => ({ id, listing_id: 'l1', position: 0, status, storage_path: `p/${id}` })

async function open(photos, who = ME) {
  api.getListing.mockResolvedValue(listing)
  api.photosFor.mockResolvedValue({ l1: photos })
  await render(<ListingScreen id="l1" lang={L} session={{ user: { id: who } }} onBack={() => {}} />)
  await screen.findByText('Bisiklet')
}
const review = () => screen.queryByText(t('mkPhotosInReview', L))
const rejectedNote = () => screen.queryByText(t('mkPhotosRejectedTitle', L))

describe('listing page, seller', () => {
  test('a pending photo: review banner', async () => { await open([ph('a', 'pending')]); expect(review()).toBeTruthy(); expect(rejectedNote()).toBeNull() })
  test('only a rejected photo: just the rejected note', async () => { await open([ph('a', 'rejected')]); expect(review()).toBeNull(); expect(rejectedNote()).toBeTruthy() })
  test('no photos: neither', async () => { await open([]); expect(review()).toBeNull(); expect(rejectedNote()).toBeNull() })
  test('approved + pending: the review banner still shows', async () => { await open([ph('a', 'approved'), ph('b', 'pending')]); expect(review()).toBeTruthy() })
  test('approved only: no banner', async () => { await open([ph('a', 'approved')]); expect(review()).toBeNull() })
})

describe('listing page, non-owner', () => {
  test('no approved photo: no review banner (placeholder only)', async () => { await open([], 'someone-else'); expect(review()).toBeNull(); expect(rejectedNote()).toBeNull() })
})

describe('İlanlarım card', () => {
  async function mine(photos) {
    api.myListings.mockResolvedValue([listing])
    api.photosFor.mockResolvedValue({ l1: photos })
    await render(<MineScreen lang={L} session={{ user: { id: ME } }} profile={{ date_of_birth: '1990-01-01' }} onBack={() => {}} onOpen={() => {}} onPost={() => {}} />)
    await screen.findByText('Bisiklet')
  }
  test('only rejected: the rejected line, not "inceleniyor"', async () => {
    await mine([ph('a', 'rejected')])
    expect(await screen.findByText(t('mkPhotosRejectedTitle', L))).toBeTruthy(); expect(review()).toBeNull()
  })
  test('no photos: neither', async () => { await mine([]); expect(review()).toBeNull(); expect(rejectedNote()).toBeNull() })
  test('pending: the review line', async () => { await mine([ph('a', 'pending')]); expect(await screen.findByText(t('mkPhotosInReview', L))).toBeTruthy() })
})
