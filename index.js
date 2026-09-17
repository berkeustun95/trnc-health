import { registerRootComponent } from 'expo';
import App from './App';

// In development the root is wrapped so the UI audits can install and the
// EXPO_PUBLIC_DEV_LANG / EXPO_PUBLIC_DEV_ONBOARDED launch arguments can be seeded before
// App reads them. See utils/devRoot.js.
//
// The `if (__DEV__) require(...)` form is deliberate, and what it does and does not promise
// was checked rather than assumed — transforming this file through babel-preset-expo with
// `caller.isDev = false` emits `if (false) { Root = require("./utils/devRoot").default }`.
//
// So: in production the branch is dead and **none of utils/devRoot.js, utils/devTextAudit.js
// or utils/devSafeAreaAudit.js ever runs** — no patched components, no probes, no listeners.
// That is the guarantee that matters and it is absolute.
//
// What it does NOT promise is absence. The `require(...)` call is still in the AST when
// Metro collects dependencies, so those modules can still be pulled into the bundle graph
// as dead weight even though the minifier drops the `if (false)` statement itself. The
// marginal cost is small (they import App, AsyncStorage, i18n and theme, all of which ship
// anyway). Said plainly here because "stripped from the bundle" is the claim everyone
// assumes this idiom makes, and it is a stronger claim than the one it actually supports.
//
// A static `import` would be worse on both counts: it would run at startup in production.
let Root = App;
if (__DEV__) {
  Root = require('./utils/devRoot').default;
}

registerRootComponent(Root);
