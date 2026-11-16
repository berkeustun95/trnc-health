// utils/previewTools.js: the Preview-only "reset onboarding" row must never be usable in production.
// PREVIEW_TOOLS_SRC / SETTINGS_SRC point the source scans at scratch copies (red-first checks).
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const read = (env, rel) => fs.readFileSync(process.env[env] || path.join(root, rel), 'utf8')

function load({ channel, appVariant }) {
  let mod
  jest.isolateModules(() => {
    jest.doMock('expo-updates', () => ({ channel, reloadAsync: jest.fn(() => Promise.resolve()) }))
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: { expoConfig: { extra: appVariant === undefined ? {} : { appVariant } } },
    }))
    jest.doMock('@react-native-async-storage/async-storage', () => ({ multiRemove: jest.fn(() => Promise.resolve()) }))
    jest.doMock('../utils/signOut', () => ({ signOutThisDevice: jest.fn(() => Promise.resolve({ error: null })) }))
    mod = require('../utils/previewTools')
  })
  return mod
}

describe('CAN_RESET_ONBOARDING', () => {
  test('preview channel + preview variant -> true (positive control)', () => {
    expect(load({ channel: 'preview', appVariant: 'preview' }).CAN_RESET_ONBOARDING).toBe(true)
  })
  test('production channel, even with a preview bundle -> false', () => {
    expect(load({ channel: 'production', appVariant: 'preview' }).CAN_RESET_ONBOARDING).toBe(false)
  })
  test('preview channel without appVariant -> false', () => {
    expect(load({ channel: 'preview', appVariant: undefined }).CAN_RESET_ONBOARDING).toBe(false)
  })
  test('no channel (dev bundle, Expo Go) -> false', () => {
    expect(load({ channel: null, appVariant: 'preview' }).CAN_RESET_ONBOARDING).toBe(false)
  })
})

describe('reset keys', () => {
  test('every onboarding key except the language, plus the home city', () => {
    const { RESET_ONBOARDING_KEYS } = load({ channel: 'preview', appVariant: 'preview' })
    expect([...RESET_ONBOARDING_KEYS].sort()).toEqual([
      '@trnc_city_asked', '@trnc_city_home', '@trnc_duty_offer', '@trnc_duty_reoffer',
      '@trnc_onb2_pending', '@trnc_onboarded', '@trnc_policy_seen', '@trnc_tour_chip',
    ])
    expect(RESET_ONBOARDING_KEYS).not.toContain('@trnc_lang')
  })
})

describe('source', () => {
  const tools = read('PREVIEW_TOOLS_SRC', 'utils/previewTools.js')

  test('the gate is the literal channel check AND the variant check', () => {
    expect(tools).toContain("export const CAN_RESET_ONBOARDING = Updates.channel === 'preview' && Constants.expoConfig?.extra?.appVariant === 'preview'")
  })

  test('the handler re-checks the gate, and the reset re-checks it before signing out', () => {
    const confirm = tools.slice(tools.indexOf('export function confirmResetOnboarding('))
    expect(confirm).toMatch(/^export function confirmResetOnboarding\(lang\) \{\s*if \(!CAN_RESET_ONBOARDING\) return/)
    const reset = tools.slice(tools.indexOf('async function resetOnboarding('))
    expect(reset).toMatch(/^async function resetOnboarding\(lang\) \{\s*if \(!CAN_RESET_ONBOARDING\) return/)
    expect(reset.indexOf('signOutThisDevice()')).toBeLessThan(reset.indexOf('AsyncStorage.multiRemove(RESET_ONBOARDING_KEYS)'))
    expect(reset.indexOf('AsyncStorage.multiRemove(RESET_ONBOARDING_KEYS)')).toBeLessThan(reset.indexOf('Updates.reloadAsync()'))
  })

  test('Profil renders the row only behind the gate, and App passes the handler only behind it', () => {
    const settings = read('SETTINGS_SRC', 'components/shell/Settings.js')
    expect(settings).toMatch(/\{CAN_RESET_ONBOARDING && !!a\.onResetOnboarding &&\s*row\('refresh-outline', 'health', 'devResetOnboarding', a\.onResetOnboarding/)
    expect((settings.match(/devResetOnboarding/g) || []).length).toBe(1)
    const app = read('ONB_APP_SRC', 'App.js')
    expect(app).toContain('onResetOnboarding: CAN_RESET_ONBOARDING ? () => confirmResetOnboarding(lang) : null,')
    expect((app.match(/confirmResetOnboarding\(/g) || []).length).toBe(1)
  })

  test('no source overrides the update URL or request headers', () => {
    const offenders = []
    const walk = dir => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', '.git', 'android', 'ios', '__tests__', '.expo', 'dist', 'web-build'].includes(e.name)) continue
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.(js|jsx|ts|tsx|mjs|cjs)$/.test(e.name) &&
          /setUpdateRequestHeadersOverride|setUpdateURLAndRequestHeadersOverride/.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(root, p))
      }
    }
    walk(root)
    expect(offenders).toEqual([])
  })
})
