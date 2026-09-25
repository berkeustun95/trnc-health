// ─── Version compare for the store-update popup ─────────────────────────────
//
// No dependency: "no new native module" is a hard constraint on this feature (it ships by
// OTA onto binaries that are already installed), and a semver package would be dead weight
// for two version strings that are always plain N.N.N.
//
// ─── NULL IS A RESULT, AND EVERY CALLER MUST TREAT IT AS "DO NOTHING" ───────
//
// Anything that is not a pure dotted number returns null rather than a guess. That is the
// fail-open direction the feature requires: a version this cannot read must never produce
// a popup, least of all a BLOCKING one. `null` is deliberately not -1/0/1, so a caller
// that forgets to handle it gets `null === -1` → false → no popup, rather than an
// accidental comparison that happens to be falsy in the wrong direction.
//
// It is strict on purpose. A tolerant parser that reads '1.2.0-beta' as 1.2.0 would be
// silently WRONG about a pre-release binary, and this app has no pre-release channel to
// justify the risk — iOS CFBundleShortVersionString and Android versionName both come
// from `version` in app.config.js, which is N.N.N and is CHECK-constrained to N.N.N on the
// app_versions row it is compared against (20261051).
const NUMERIC_DOTTED = /^\d+(\.\d+)*$/

function parse(v) {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s || !NUMERIC_DOTTED.test(s)) return null
  const parts = s.split('.').map(Number)
  // Number('007') is 7, and '1.2.00000000000000000001' is not a version anyone ships, but
  // Number.isSafeInteger is what stops a 20-digit segment comparing as Infinity.
  if (parts.some(n => !Number.isSafeInteger(n) || n < 0)) return null
  if (parts.length > 4) return null
  return parts
}

// -1 if a < b, 0 if equal, 1 if a > b, null if either side is unreadable.
// '1.2' and '1.2.0' compare EQUAL — the shorter side is zero-padded, never treated as less.
export function compareVersions(a, b) {
  const pa = parse(a)
  const pb = parse(b)
  if (!pa || !pb) return null
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

// The one question this module exists to answer, named so call sites read as English and
// cannot accidentally treat null as "yes".
export function isOlderThan(installed, target) {
  return compareVersions(installed, target) === -1
}
