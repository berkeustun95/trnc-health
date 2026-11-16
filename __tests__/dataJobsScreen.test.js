// The admin "Data jobs" tab rendered over a mocked admin_data_jobs RPC. Evidence about states and wiring (error / empty /
// malformed payload fail closed, the no-success and no-record lines), not about layout on a phone. The RPC is not live.
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default)
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }))
jest.mock('../lib/supabase', () => ({ supabase: { rpc: jest.fn() } }))

import { render, screen, fireEvent } from '@testing-library/react-native'
import { t } from '../constants/i18n'
const { supabase } = require('../lib/supabase')
const DataJobsTab = require('../components/AdminDataJobs').default
const L = 'English'
jest.setTimeout(20000)

const iso = ms => new Date(Date.now() - ms).toISOString()
const row = (key, state, extra = {}) => ({
  key, runner: 'github', kind: 'sync', switchable: false, paused: false, paused_note: null, paused_at: null,
  expected_every_seconds: 86400, schedule: 'daily', cron_active: null, last_run: null, last_ok_at: null,
  record_source: 'x', state, attention: false, ...extra,
})
const okRun = { started_at: iso(3600e3), finished_at: iso(3590e3), outcome: 'ok', error_class: null, source: 'x' }
const failRun = { started_at: iso(3600e3), finished_at: iso(3590e3), outcome: 'failed', error_class: 'timeout', source: 'x' }
const mount = async data => {
  supabase.rpc.mockResolvedValue(data)
  await render(<DataJobsTab lang={L} />)
}
const lastLine = () => screen.queryByText(/^Last run:/)
const lastOk = () => screen.queryByText(/^Last OK:/)

beforeEach(() => supabase.rpc.mockReset())

describe('fails closed', () => {
  test('RPC error: error text and a retry that reloads', async () => {
    await mount({ data: null, error: { message: 'boom' } })
    expect(await screen.findByText(t('adminJobsLoadError', L))).toBeTruthy()
    supabase.rpc.mockResolvedValue({ data: [row('job_a', 'ok', { last_run: okRun, last_ok_at: okRun.started_at })], error: null })
    await fireEvent.press(screen.getByText(t('adminJobsRetry', L)))
    expect(await screen.findByText('job_a')).toBeTruthy()
    expect(screen.queryByText(t('adminJobsLoadError', L))).toBeNull()
    expect(supabase.rpc).toHaveBeenCalledTimes(2)
    expect(supabase.rpc).toHaveBeenCalledWith('admin_data_jobs')
  })
  test('an error wins even if rows come with it', async () => {
    await mount({ data: [row('job_a', 'ok')], error: { message: 'partial' } })
    expect(await screen.findByText(t('adminJobsLoadError', L))).toBeTruthy()
    expect(screen.queryByText('job_a')).toBeNull()
  })
  test('a thrown rpc (offline) is the error state, not a crash', async () => {
    supabase.rpc.mockRejectedValue(new Error('Network request failed'))
    await render(<DataJobsTab lang={L} />)
    expect(await screen.findByText(t('adminJobsLoadError', L))).toBeTruthy()
  })
  test('empty array: error state, not an empty list', async () => {
    await mount({ data: [], error: null })
    expect(await screen.findByText(t('adminJobsLoadError', L))).toBeTruthy()
    expect(screen.queryByText(t('adminJobsIntro', L))).toBeNull()
  })
  test('null data: error state', async () => {
    await mount({ data: null, error: null })
    expect(await screen.findByText(t('adminJobsLoadError', L))).toBeTruthy()
  })
  test('one row without attention: the whole screen is the error state', async () => {
    const bad = row('job_bad', 'failed'); delete bad.attention
    await mount({ data: [row('job_a', 'ok'), bad], error: null })
    expect(await screen.findByText(t('adminJobsLoadError', L))).toBeTruthy()
    expect(screen.queryByText('job_a')).toBeNull()
  })
})

describe('row lines', () => {
  test('a failed row that never succeeded shows the "no successful run" text, with the error', async () => {
    await mount({ data: [row('job_f', 'failed', { attention: true, last_run: failRun, last_ok_at: null })], error: null })
    expect(await screen.findByText('job_f')).toBeTruthy()
    expect(screen.getByText(t('adminJobsNoOk', L))).toBeTruthy()
    expect(lastLine()).toBeTruthy()
    expect(screen.getByText('Error: timeout')).toBeTruthy()
  })
  test('a no_record row shows the note and NO time lines (no run, no OK, no "no run on record")', async () => {
    await mount({ data: [row('job_n', 'no_record')], error: null })
    expect(await screen.findByText('job_n')).toBeTruthy()
    expect(screen.getByText(t('adminJobsNoRecordNote', L))).toBeTruthy()
    expect(lastLine()).toBeNull(); expect(lastOk()).toBeNull()
    expect(screen.queryByText(t('adminJobsNoRun', L))).toBeNull()
    expect(screen.queryByText(t('adminJobsNoOk', L))).toBeNull()
  })
  test('an ok row whose last run is ok shows Last run only (no duplicate Last OK)', async () => {
    await mount({ data: [row('job_o', 'ok', { last_run: okRun, last_ok_at: okRun.started_at })], error: null })
    expect(await screen.findByText('job_o')).toBeTruthy()
    expect(lastLine()).toBeTruthy(); expect(lastOk()).toBeNull()
  })
  test('groups render in server order with counts in the headers', async () => {
    await mount({ data: [row('job_ok', 'ok', { last_run: okRun, last_ok_at: okRun.started_at }), row('job_x', 'failed', { attention: true, last_run: failRun })], error: null })
    expect(await screen.findByText(t('adminJobsGroupAttention', L).replace('{count}', '1'))).toBeTruthy()
    expect(screen.getByText(t('adminJobsGroupOk', L).replace('{count}', '1'))).toBeTruthy()
    expect(screen.queryByText(t('adminJobsGroupPaused', L).replace('{count}', '0'))).toBeNull()
  })
  test('an unknown state shows the Unknown pill rather than crashing', async () => {
    await mount({ data: [row('job_u', 'brand_new')], error: null })
    expect(await screen.findByText(t('adminJobsStateUnknown', L))).toBeTruthy()
  })
})
