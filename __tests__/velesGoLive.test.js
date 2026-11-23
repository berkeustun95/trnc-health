// The Preview check cannot see VELES_LIVE (Preview shows the banner with the flag off), so this pins what a
// PRODUCTION build resolves: not __DEV__, not the preview variant. Velesbit on; house banner and Settings row off.
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }))

test('production build: Velesbit banner on, house banner and Work with ADA row off', () => {
  const dev = global.__DEV__
  global.__DEV__ = false
  try {
    jest.isolateModules(() => {
      const r = require('../constants/redesign')
      expect({ VELES: r.VELES, HOUSE_BANNER: r.HOUSE_BANNER, WORK_WITH_ADA_ROW: r.WORK_WITH_ADA_ROW })
        .toEqual({ VELES: true, HOUSE_BANNER: false, WORK_WITH_ADA_ROW: false })
    })
  } finally {
    global.__DEV__ = dev
  }
})
