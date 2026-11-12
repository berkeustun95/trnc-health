// Every client writer of a terms acceptance goes through the accept_terms RPC (20261191), never a direct profiles update.
// (a) source guard over App.js / screens / components / utils; (b) the StudentHubTermsGate behaviour.
// flushPendingConsent is module-private in App.js: its decision is covered by the source guard only.
import fs from 'fs'
import path from 'path'
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native'
import { t } from '../constants/i18n'

const mockRpc = jest.fn()
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default)
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, Feather: () => null }))
jest.mock('../lib/supabase', () => ({ supabase: { rpc: (...a) => mockRpc(...a), from: jest.fn() }, isGuest: () => false }))

const legal = require('../constants/legal')
const Gate = require('../screens/StudentHubTermsGate').default
const root = path.join(__dirname, '..')

const sourceFiles = () => {
  const out = [path.join(root, 'App.js')]
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.js$/.test(e.name)) out.push(p)
  })
  ;['screens', 'components', 'utils'].forEach(d => walk(path.join(root, d)))
  return out
}
const UPDATE_WITH_TERMS = /\.update\(\s*\{[^}]*\bterms_(version|locale)\b/
const offenders = () => sourceFiles().filter(f => UPDATE_WITH_TERMS.test(fs.readFileSync(f, 'utf8'))).map(f => path.relative(root, f))

describe('source guard', () => {
  test('the pattern catches a restored direct writer (the guard can go red)', () => {
    const old = `await supabase.from('profiles')\n  .update({ terms_version: LEGAL_VERSION, terms_locale: x })\n  .eq('id', id)`
    expect(UPDATE_WITH_TERMS.test(old)).toBe(true)
  })
  test('no client file writes terms_version / terms_locale with a direct update', () => {
    expect(sourceFiles().length).toBeGreaterThan(20)
    expect(offenders()).toEqual([])
  })
  test('the three writers call accept_terms', () => {
    for (const f of ['App.js', 'screens/ProfileSetupScreen.js', 'screens/StudentHubTermsGate.js']) {
      expect(fs.readFileSync(path.join(root, f), 'utf8')).toMatch(/rpc\('accept_terms'/)
    }
  })
})

describe('StudentHubTermsGate', () => {
  const L = 'English'
  const row = v => ({ terms_version: v, terms_locale: 'English', terms_accepted_at: '2026-11-12T10:00:00Z' })
  const open = async onAccepted => render(<Gate lang={L} userId="u1" onAccepted={onAccepted} onCancel={() => {}} />)
  const accept = async () => fireEvent.press(await screen.findByText(t('shTermsAccept', L)))
  beforeEach(() => mockRpc.mockReset())

  test('equal version: onAccepted gets the row; rpc sent version + locale only', async () => {
    mockRpc.mockResolvedValue({ data: row(legal.LEGAL_VERSION), error: null })
    const onAccepted = jest.fn()
    await open(onAccepted); await accept()
    await waitFor(() => expect(onAccepted).toHaveBeenCalledWith(row(legal.LEGAL_VERSION)))
    expect(mockRpc).toHaveBeenCalledWith('accept_terms', { p_version: legal.LEGAL_VERSION, p_locale: 'English' })
  })
  test('rpc error (e.g. not deployed): save-error text, no onAccepted, no crash', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
    const onAccepted = jest.fn()
    await open(onAccepted); await accept()
    expect(await screen.findByText(t('shTermsSaveError', L))).toBeTruthy()
    expect(onAccepted).not.toHaveBeenCalled()
  })
  test('a different version back (server kept a higher one): no onAccepted, save-error text', async () => {
    mockRpc.mockResolvedValue({ data: row('2099-01-01'), error: null })
    const onAccepted = jest.fn()
    await open(onAccepted); await accept()
    expect(await screen.findByText(t('shTermsSaveError', L))).toBeTruthy()
    expect(onAccepted).not.toHaveBeenCalled()
  })
})
