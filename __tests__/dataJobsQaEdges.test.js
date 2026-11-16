// QA edge cases for the Data jobs pause sheet: the five fixed error keys, and note lengths 0 / 1 / 200 / 201 / whitespace.
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default)
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }))
jest.mock('../utils/useKeyboardTop', () => ({ __esModule: true, default: () => null }))
jest.mock('../lib/supabase', () => ({ supabase: { rpc: jest.fn() } }))

import { render, screen, fireEvent } from '@testing-library/react-native'
import { t, LANGUAGES } from '../constants/i18n'
import { switchErrorKey } from '../utils/dataJobs'
const { supabase } = require('../lib/supabase')
const DataJobsTab = require('../components/AdminDataJobs').default
const L = 'English'
jest.setTimeout(20000)

describe('switchErrorKey maps every server error to one of the five fixed keys', () => {
  const cases = [
    [{ message: 'NOTE_REQUIRED' }, 'adminJobsErrNote'],
    [{ message: 'NOT_SWITCHABLE' }, 'adminJobsErrNotSwitchable'],
    [{ message: 'ADMIN_ONLY' }, 'adminJobsErrAdminOnly'],
    [{ code: 'PGRST202', message: 'x' }, 'adminJobsErrUnavailable'],
    [{ status: 404 }, 'adminJobsErrUnavailable'],
    [{ message: 'UNKNOWN_JOB' }, 'adminJobsErrGeneric'],
    [{ message: 'BAD_ARGS' }, 'adminJobsErrGeneric'],
    [{ message: 'boom' }, 'adminJobsErrGeneric'],
    [null, 'adminJobsErrGeneric'],
    [undefined, 'adminJobsErrGeneric'],
  ]
  test.each(cases)('%j -> %s', (err, want) => { expect(switchErrorKey(err)).toBe(want) })
  test('each of the five keys exists in every language', () => {
    for (const k of ['adminJobsErrNote', 'adminJobsErrNotSwitchable', 'adminJobsErrAdminOnly', 'adminJobsErrUnavailable', 'adminJobsErrGeneric']) {
      for (const lang of Object.keys(LANGUAGES)) expect({ k, lang, v: !!t(k, lang) && t(k, lang) !== k }).toEqual({ k, lang, v: true })
    }
  })
})

describe('pause note boundaries', () => {
  const row = { key: 'job_s', runner: 'github', kind: 'sync', switchable: true, paused: false, paused_note: null, paused_at: null,
    expected_every_seconds: 86400, schedule: 'daily', cron_active: null, last_run: null, last_ok_at: null, record_source: 'x', state: 'ok', attention: false }
  const calls = []
  const setup = async () => {
    calls.length = 0
    supabase.rpc.mockReset()
    supabase.rpc.mockImplementation(async (name, args) => { if (name === 'admin_data_jobs') return { data: [row], error: null }; calls.push(args); return { data: null, error: { message: 'x' } } })
    await render(<DataJobsTab lang={L} />)
    await screen.findByText('job_s')
    await fireEvent(screen.getByLabelText(t('adminJobsSwitchLabel', L).replace('{job}', 'job_s')), 'valueChange', false)
    await screen.findByText(t('adminJobsPauseTitle', L).replace('{job}', 'job_s'))
  }
  const type = txt => fireEvent.changeText(screen.getByLabelText(t('adminJobsPauseReason', L)), txt)
  const press = () => fireEvent.press(screen.getByText(t('adminJobsPauseConfirm', L)))
  test.each([['0 chars', ''], ['whitespace only', ' \n\t  ']])('%s: confirm sends nothing', async (_n, txt) => {
    await setup(); await type(txt); await press(); expect(calls).toHaveLength(0)
  })
  test('1 char is sent', async () => { await setup(); await type('x'); await press(); expect(calls).toEqual([{ p_job: 'job_s', p_paused: true, p_note: 'x' }]) })
  test('200 chars is sent whole', async () => {
    await setup(); await type('a'.repeat(200)); expect(screen.getByText('200/200')).toBeTruthy(); await press()
    expect(calls[0].p_note).toHaveLength(200)
  })
  test('NOTE: 201 chars (changeText bypasses the native maxLength) reaches the RPC as 201: the server NOTE_REQUIRED check is the only backstop', async () => {
    await setup(); await type('a'.repeat(201)); await press()
    expect(calls[0].p_note).toHaveLength(201)
  })
})
