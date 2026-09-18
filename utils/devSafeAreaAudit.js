import { initialWindowMetrics } from 'react-native-safe-area-context'

// ─── The dev-only safe-area audit: things you cannot tap ────────────────────
//
// The 2026-09-17 compose-bar bug: the message input and its send button sat UNDERNEATH the
// Android three-button navigation bar. Visible, laid out, completely untappable, because
// the screen's SafeAreaView claimed `edges={['top']}` and nothing paid the bottom inset.
//
// This watches for the same shape at runtime: an interactive element whose bottom edge
// lands inside the band the system bar occupies.
//
// ─── THIS IS THE WEAKEST OF THE THREE AUDITS AND IT SHOULD BE JUDGED HARSHLY ─
//
// "Bottom-anchored" is a layout fact, not a syntactic one — there is no marker in the
// source to grep for, which is why this is a runtime measurement and not a lint rule. The
// cost is that a lot of things legitimately pass through that band:
//
//   * any row of a scrolling list, while it is scrolling past the bottom edge
//   * a sheet or modal mid-animation
//   * a deliberately edge-to-edge surface that handles its own inset internally
//
// Two filters keep that down — a settle delay before the first measurement, and a SECOND
// measurement RECHECK_MS later that must agree (anything moving has moved on) — but they
// will not catch everything, and a check that cries wolf gets muted, at which point it is
// worse than nothing because it still looks like coverage.
//
// ► So: run it, and if the first pass on Home reports more than a couple of things that
//   are not bugs, delete it rather than living with it. That is a real possible outcome of
//   this file and it was written expecting it. It has NOT been run — the machine it was
//   written on has no device attached and no emulator — so the noise level is genuinely
//   unknown and is not being guessed at here.
//
// ─── FRAMES OF REFERENCE ───────────────────────────────────────────────────
//
// The failure mode of a check like this is reading two numbers in two coordinate systems
// and comparing them anyway — the hazard CLAUDE.md lists five instances of. The frame is
// held to one source: `initialWindowMetrics` supplies BOTH the window frame and the
// insets, so they cannot disagree with each other. `measureInWindow` is then the only
// value from anywhere else, and every warning prints the raw numbers it compared, so a
// mismatched frame is visible in the report instead of being silently believed.

const SETTLE_MS  = 1200   // let the first layout, fonts and any entry animation finish
const RECHECK_MS = 600    // a scrolling row will have moved by the time we look again
const MAX_REPORTS = 12    // a floor-to-ceiling flood is itself the finding; stop after this

const state = { installed: false, reports: 0, seen: new Set(), frame: null, inset: 0 }

function describe(kind, x, y, w, h) {
  return `${kind}@${Math.round(x)},${Math.round(w)}x${Math.round(h)}`
}

function considerNode(node, kind) {
  if (!node || typeof node.measureInWindow !== 'function') return
  if (state.reports >= MAX_REPORTS) return

  node.measureInWindow((x, y, w, h) => {
    if (!(w > 0 && h > 0)) return
    const limit = state.frame.height - state.inset
    if (y + h <= limit) return                       // clears the system bar — nothing to say

    const id = describe(kind, x, y, w, h)
    if (state.seen.has(id)) return

    // Second look. Anything that was merely passing through has moved.
    setTimeout(() => {
      if (state.reports >= MAX_REPORTS || state.seen.has(id)) return
      node.measureInWindow((x2, y2, w2, h2) => {
        if (!(w2 > 0 && h2 > 0)) return
        if (y2 + h2 <= limit) return                 // it moved — it was scrolling
        if (Math.abs(y2 - y) > 1) return             // still moving — not a fixed bar

        state.seen.add(id)
        state.reports += 1
        console.warn(
          `[ada-audit] UNDER THE SYSTEM BAR  <${kind}>\n` +
          `            bottom edge ${Math.round(y2 + h2)}px, usable height ${Math.round(limit)}px ` +
          `(frame ${Math.round(state.frame.height)} - inset ${Math.round(state.inset)})\n` +
          `            overlapped by ${Math.round(y2 + h2 - limit)}px, and it did not move between two measurements.\n` +
          `            If this is a fixed bottom bar it is probably untappable. ADA's fix for this is\n` +
          `            paddingBottom: Math.max(insets.bottom, 12) — the expression PropertyDetail,\n` +
          `            TowingDetail and DormPartner already use.`)
      })
    }, RECHECK_MS)
  })
}

// Same patch mechanism as utils/devTextAudit.js: react-native exports these through lazy
// ► NO DEEP IMPORTS, AND NO ASSIGNMENT. Both were learned the hard way, one launch apart.
//   The first version iterated a table of `react-native/Libraries/...` paths and called
//   `require(path)`. Metro resolves dependencies statically from string literals, so that
//   failed the BUNDLE for the whole app. Thunks with literals fixed the bundle but kept the
//   deep imports, which react-native then warns about on every launch — and worse, the
//   module body ran those requires whether or not this audit was wanted.
//
//   Patching the four PUBLIC exports instead solves all of it: no deep paths, no
//   deprecation warnings, and the same reach, because compiled screens reference
//   `_reactNative.TouchableOpacity` at each call site. The property must be REDEFINED
//   rather than assigned — react-native/index.js declares these as object-literal getters,
//   which have no setter but are `configurable: true`. See utils/devTextAudit.js for the
//   full account of why assignment throws.
const TARGET_NAMES = ['Pressable', 'TouchableOpacity', 'TouchableHighlight', 'TextInput']

export function installSafeAreaAudit() {
  if (state.installed) return
  state.installed = true

  const metrics = initialWindowMetrics
  if (!metrics || !metrics.frame || !metrics.insets) {
    console.warn('[ada-audit] SAFE-AREA AUDIT OFF — initialWindowMetrics is null on this platform.')
    return
  }
  state.frame = metrics.frame
  state.inset = metrics.insets.bottom || 0

  // An honest no-op is better than a check that runs against a zero-width band and reports
  // nothing forever while looking like it is working.
  if (state.inset <= 0) {
    console.log('[ada-audit] SAFE-AREA AUDIT OFF — bottom inset is 0 here, so there is no band to intrude into.')
    return
  }
  console.log(`[ada-audit] safe-area audit armed — frame ${Math.round(state.frame.height)}px, bottom inset ${Math.round(state.inset)}px.`)

  const RN = require('react-native')

  for (const kind of TARGET_NAMES) {
    const Original = RN[kind]
    if (!Original) continue

    function Audited(props) {
      const userRef = props.ref
      const setRef = node => {
        // The caller's ref is honoured first and unchanged — a dev audit that breaks a
        // real ref would break scrollTo, focus() and every measurement the app does.
        if (typeof userRef === 'function') userRef(node)
        else if (userRef && typeof userRef === 'object') userRef.current = node
        if (node) setTimeout(() => considerNode(node, kind), SETTLE_MS)
      }
      return <Original {...props} ref={setRef} />
    }
    Audited.displayName = `Audited(${kind})`
    try {
      Object.defineProperty(RN, kind, { value: Audited, configurable: true, enumerable: true, writable: true })
    } catch (e) {
      console.warn(`[ada-audit] could not wrap ${kind}: ${e && e.message}`)
    }
  }
}
