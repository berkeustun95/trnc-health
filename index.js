import { registerRootComponent } from 'expo';
import App from './App';

// In development the root is wrapped so the UI audits can install and the
// EXPO_PUBLIC_DEV_LANG / EXPO_PUBLIC_DEV_ONBOARDED launch arguments can be seeded before
// App reads them. See utils/devRoot.js.
//
// The `if (__DEV__) require(...)` form is deliberate, and it was MEASURED rather than
// assumed — twice, because the first measurement was only half the pipeline.
//
// Babel alone (babel-preset-expo with `caller.isDev = false`) emits
// `if (false) { Root = require("./utils/devRoot").default }` — the branch is dead, but the
// require is still textually in the AST, which is where Metro collects dependencies. On
// that evidence alone the honest claim was "it never runs, but it may still ship as dead
// weight".
//
// The full pipeline does better. Metro's own production bundle
// (`/index.bundle?platform=android&dev=false&minify=true`, 2026-09-18) contains **zero**
// occurrences of `ada-audit`, `POSITIVE control PASSED`, `safe-area audit armed` or
// `EXPO_PUBLIC_DEV_SAFEAREA` — 5.2 MB against 13.5 MB for the dev bundle. The minifier
// eliminates the `if (false)` branch and the modules go with it.
//
// So both claims hold in production: none of utils/devRoot.js, utils/devTextAudit.js or
// utils/devSafeAreaAudit.js runs, and none of it is present. Recorded with the method
// because "stripped from the bundle" is what everyone ASSUMES this idiom does, and the
// assumption happens to be right here only because of the minifier — not because of
// `__DEV__`.
//
// A static `import` would break both: it would ship, and it would run at startup.
let Root = App;
if (__DEV__) {
  Root = require('./utils/devRoot').default;
}

registerRootComponent(Root);
