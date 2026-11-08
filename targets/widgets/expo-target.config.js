// ADA home-screen widgets (WidgetKit). Bundle id <app id>.widgets; App Group = the app's
// (app.config.js IOS_APP_GROUP, one per variant). iOS 17+: containerBackground and the
// widget gallery we target; older iPhones simply don't offer the widgets.
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = config => ({
  type: 'widget',
  name: 'ADAWidgets',
  displayName: 'ADA',
  bundleIdentifier: '.widgets',
  deploymentTarget: '17.0',
  frameworks: ['SwiftUI', 'WidgetKit'],
  colors: {
    $accent: '#0E7C7B',
    $widgetBackground: '#FFFFFF',
  },
  entitlements: {
    'com.apple.security.application-groups': config.ios.entitlements['com.apple.security.application-groups'],
  },
})
