// Bandabuliya admin (slice 5): the data calls behind AdminScreen's Bandabuliya tab and the Reports tab's listing
// branch. Real path: the photo decision goes to marketplace-photo-review with the right body, and its error code
// reaches the admin. Sample data: the queue / hide / restore behave as the server will.

const MISSING = { data: null, error: { code: 'PGRST202', message: 'Could not find the function in the schema cache' } }
const thenable = () => { const c = new Proxy({}, { get: (_, k) => (k === 'then' ? res => res(MISSING) : () => c) }); return c }
jest.mock('../lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(async () => MISSING),
    from: jest.fn(() => thenable()),
    functions: { invoke: jest.fn() },
  },
}))
jest.mock('../constants/redesign', () => ({ MARKETPLACE: true }))
jest.mock('../constants/flags', () => ({ MODULE_FLAGS: { marketplace: false } }))
jest.mock('../utils/notify', () => ({ notifyAdmins: jest.fn() }))

describe('real path: marketplace-photo-review', () => {
  let api, supabase
  beforeEach(() => {
    jest.resetModules()
    supabase = require('../lib/supabase').supabase
    api = require('../utils/marketplaceApi')         // fresh: not on the sample data
  })

  test('approve and reject send exactly { photo_id, action, reason }', async () => {
    supabase.functions.invoke.mockResolvedValue({ data: { status: 'approved' }, error: null })
    await api.adminReviewPhoto('p1', 'approve')
    await api.adminReviewPhoto('p2', 'reject', 'contact_info')
    expect(supabase.functions.invoke.mock.calls).toEqual([
      ['marketplace-photo-review', { body: { photo_id: 'p1', action: 'approve', reason: null } }],
      ['marketplace-photo-review', { body: { photo_id: 'p2', action: 'reject', reason: 'contact_info' } }],
    ])
  })

  test("the function's error code reaches the admin; a non-JSON failure is REVIEW_FAILED", async () => {
    supabase.functions.invoke.mockResolvedValueOnce({ data: null, error: { context: { json: async () => ({ error: 'ALREADY_REVIEWED' }) } } })
    await expect(api.adminReviewPhoto('p1', 'approve')).rejects.toThrow('ALREADY_REVIEWED')
    supabase.functions.invoke.mockResolvedValueOnce({ data: null, error: { context: { json: async () => { throw new Error('html') } } } })
    await expect(api.adminReviewPhoto('p1', 'approve')).rejects.toThrow('REVIEW_FAILED')
  })

  test('the reasons are exactly the six the function and 20261183 accept', () => {
    expect(api.MK_REJECT_REASONS).toEqual(['not_item', 'inappropriate', 'prohibited', 'contact_info', 'low_quality', 'other'])
  })
})

describe('sample data', () => {
  let api
  beforeAll(async () => {
    jest.resetModules()
    api = require('../utils/marketplaceApi')
    await api.listListings()
    api.setFixtureUser('admin-uid', 'Admin')
  })

  test('the queue: a pending photo with its listing, oldest first; approve takes it out; a second decision is refused', async () => {
    const q = await api.adminPhotoQueue()
    expect(q).toHaveLength(1)
    expect(q[0]).toMatchObject({ id: 'fx-p-0', listing: { id: 'fx-1' } })
    const sum = await api.adminPendingPhotoSummary()
    expect(sum).toEqual({ count: 1, oldestAt: q[0].created_at })
    await api.adminReviewPhoto('fx-p-0', 'approve')
    expect(await api.adminPhotoQueue()).toHaveLength(0)
    await expect(api.adminReviewPhoto('fx-p-0', 'reject', 'other')).rejects.toThrow('ALREADY_REVIEWED')
  })

  test('hidden by a report is listed (red in the tab); restore puts it back in browse; hide takes it out', async () => {
    const hidden = await api.adminListings('hidden')
    expect(hidden.find(l => l.id === 'fx-6')).toMatchObject({ hidden_reason: 'auto_reports' })
    expect((await api.listListings()).rows.map(l => l.id)).not.toContain('fx-6')
    await api.adminSetHidden('fx-6', false)
    expect((await api.listListings()).rows.map(l => l.id)).toContain('fx-6')
    await api.adminSetHidden('fx-6', true)
    expect((await api.adminListings('hidden')).find(l => l.id === 'fx-6')).toMatchObject({ hidden_reason: 'admin_removed' })
    expect((await api.listListings()).rows.map(l => l.id)).not.toContain('fx-6')
  })
})
