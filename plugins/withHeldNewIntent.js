const { withMainActivity } = require('expo/config-plugins');

const MARKER = 'ada-held-new-intent';

const MEMBERS = `  // @generated ${MARKER}
  // expo-updates delays the app load, and the Expo wrapper drops onNewIntent until then, so a tap that
  // recreates the activity (process reclaimed, task kept) never reaches expo-notifications. Hold it and replay once.
  private var adaAppLoaded = false
  private var adaHeldIntent: Intent? = null

  override fun onNewIntent(intent: Intent) {
    if (!adaAppLoaded) {
      adaHeldIntent = intent
    }
    super.onNewIntent(intent)
  }

  private fun adaDeliverHeldIntent() {
    adaAppLoaded = true
    val held = adaHeldIntent
    adaHeldIntent = null
    if (held != null) {
      super.onNewIntent(held)
    }
  }

`;

const DELEGATE_BODY = ` {
              override fun loadApp(appKey: String?) {
                super.loadApp(appKey)
                adaDeliverHeldIntent()
              }
          }`;

function applyHeldNewIntent(src) {
  if (src.includes(MARKER)) return src;

  if (/override\s+fun\s+onNewIntent\b/.test(src)) {
    throw new Error('withHeldNewIntent: MainActivity already overrides onNewIntent (another plugin?)');
  }
  if (/override\s+fun\s+loadApp\b/.test(src)) {
    throw new Error('withHeldNewIntent: MainActivity already overrides loadApp (another plugin?)');
  }

  const delegateRe = /(object\s*:\s*DefaultReactActivityDelegate\s*\([^)]*\))\s*\{\s*\}/;
  if (!delegateRe.test(src)) {
    throw new Error('withHeldNewIntent: anchor not found: "object : DefaultReactActivityDelegate(...){}"');
  }
  const classRe = /class\s+MainActivity\b[^\n{]*\{[ \t]*\n/;
  if (!classRe.test(src)) {
    throw new Error('withHeldNewIntent: anchor not found: "class MainActivity ... {"');
  }

  let out = src.replace(delegateRe, (_, head) => head + DELEGATE_BODY);
  out = out.replace(classRe, (m) => m + MEMBERS);
  if (!/^import android\.content\.Intent\s*$/m.test(out)) {
    if (!/^import .*$/m.test(out)) {
      throw new Error('withHeldNewIntent: anchor not found: an import line');
    }
    out = out.replace(/^import .*$/m, (m) => `import android.content.Intent\n${m}`);
  }
  return out;
}

const withHeldNewIntent = (config) =>
  withMainActivity(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      throw new Error('withHeldNewIntent: MainActivity is not Kotlin');
    }
    cfg.modResults.contents = applyHeldNewIntent(cfg.modResults.contents);
    return cfg;
  });

module.exports = withHeldNewIntent;
module.exports.applyHeldNewIntent = applyHeldNewIntent;
