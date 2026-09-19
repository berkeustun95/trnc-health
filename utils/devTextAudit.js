import * as React from 'react'
import { useRef } from 'react'
import { StyleSheet, View, PixelRatio } from 'react-native'
import { sourceTextOf, renderedTextOf, display, dense } from './textAuditVerdict'
import { devKeysForString } from '../constants/i18n'
import { TRUNCATION_ALLOWED } from '../constants/textAuditAllowlist'
import { colors } from '../constants/theme'

// ─── The dev-only UI audit: text that clipped ───────────────────────────────
//
// Written 2026-09-17, after four UI bugs were found by one person looking at one Android
// phone. Three of the four were visual, and the worst of them — tab labels overflowing in
// eight of nine languages — survived because nobody reads Greek.
//
// The investigation that preceded this rejected screenshot baselines for the job. The
// short version, because it is the reason this file has the shape it does: a screenshot
// suite records whatever is on a NEW screen as its baseline, defect included, and goes
// green forever; and certifying 693 baselines (77 screens x 9 locales) means somebody
// approving 77 images in Greek. That does not fix "nobody reads Greek", it relocates it to
// approval time and puts a check mark on it.
//
// This does something narrower and deterministic instead: it asks the layout engine what
// it actually drew, in whatever language is on screen, and says so. No baselines, no
// images, no approval step, and it is right or wrong for a reason you can read.
//
// ─── WHAT IT WATCHES ───────────────────────────────────────────────────────
//
// (1) TRUNCATION. A <Text numberOfLines={n}> whose rendered text is shorter than the text
//     it was given. That is the Greek tab bug, and it fires in every language at once.
//
//     ► The test is NOT `lines.length === numberOfLines`. That is true of every label that
//       legitimately fills its allowed lines, so it cannot tell healthy from broken — the
//       exact instrument failure CLAUDE.md spends three paragraphs on. The test is
//       RENDERED vs SOURCE: join what the engine laid out, compare it to what we passed
//       in, and if characters went missing the string did not fit.
//
// ─── WHAT THIS USED TO ALSO WATCH, AND WHY IT NO LONGER DOES ───────────────
//
// A second rule flagged low-contrast text sitting on PageBackground's photo — the
// 'EĞİTİM' bug. It is deleted, and the reason is worth more than the rule was.
//
// IT FOUND THE ORIGINAL BUG. It then produced THIRTY-PLUS hits in a single Turkish pass
// on 2026-09-19: every module tile on Home, the tab bar, the search placeholder, every
// district chip, the Student Hub tabs and header, and t('back'). Not one of them was
// real — each sits on a tile, a bar or a pill that is perfectly opaque.
//
// At 30:1 it would have been muted long before it found a second real bug, and a muted
// check is worse than no check because it still looks like coverage. That is the same
// verdict the safe-area audit got, on the same evidence, for the same reason.
//
// ► IT WAS NOT A WEAK IMPLEMENTATION OF A GOOD IDEA. The fact it needed is not
//   observable from where it stood:
//     * Compositing is the renderer's business. Nothing in React Native reports what is
//       painted beneath a node — measureInWindow returns geometry, never colour.
//     * Geometry cannot substitute. PageBackground is absoluteFill, so it is behind every
//       pixel; overlap is universal and says nothing about occlusion.
//     * Context could carry it, but only if EVERY opaque surface declares itself — a
//       hand-kept list where anything new defaults to "unsafe", so the false positives
//       regenerate with each component somebody adds. That is the failure this repo
//       removed twice in one day (the 72 unguarded constraints; the remembered policy
//       list), and rebuilding it here would have been the third.
//
// A STATIC source-level rule could work, because in source the nesting is literal: a
// low-contrast <Text> that is a syntactic descendant of a screen rendering
// <PageBackground> and is inside nothing with a backgroundColor IN THE SAME FILE. All
// four of the 2026-09-17 bugs had exactly that shape, and it fails safe across component
// boundaries. That is a different tool, not a repair of this one, and it is not built.
//
// ─── SCOPE: i18n STRINGS ONLY, AND THAT IS DELIBERATE ──────────────────────
//
// Nothing is reported unless the rendered string reverse-resolves to a key in
// constants/i18n.js. A display name, an address, a price or a facility title has no key,
// and is skipped.
//
// Not laziness — truncating user data is almost always CORRECT (a long name clipping in a
// list row is the design working), so reporting it would bury the signal under exactly the
// noise that gets a check muted. Every one of the four bugs this exists for was UI chrome,
// which is always an i18n string. The cost is stated plainly under KNOWN MISSES.
//
// ─── KNOWN MISSES (false negatives — the safe direction) ───────────────────
//
//   * Interpolated strings. `tCity()` output and any template carrying {n}/{name} is
//     assembled after the dict is read, so it reverse-resolves to nothing and is
//     UNAUDITED. It will not warn and it will not lie; it simply is not watched.
//   * ellipsizeMode 'head'/'middle'. Android lays the full text out on one line and
//     replaces the middle at draw time, so rendered === source and nothing is reported.
//   * A string that overflows only WITHIN its last allowed line. Android's getLineEnd can
//     include the characters the ellipsis covers, so the join can come back full length.
//     Overflow PAST numberOfLines — the case that matters — drops whole lines and is seen.
//   * Animated.Text. It captured the original component when react-native was first
//     imported, which is before this file can patch anything. Not audited.
//
// ─── THE CONTROLS, AND WHY NOTHING IS REPORTED BEFORE THEY PASS ────────────
//
// The whole thing rests on onTextLayout firing on Fabric Android with a populated per-line
// `text`. That chain was traced through nine files in react-native 0.81.5 and it is sound
// (ParagraphShadowNode.cpp:347 -> TextLayoutManager.h:71 -> TextLayoutManager.kt:1184 ->
// FontMetricsUtil.kt:60 -> TextMeasureCache.cpp:42 -> ParagraphEventEmitter.cpp:24), but
// tracing is not running, and this file was written on a machine with no device attached.
//
// So it proves it at startup, on the real device, before it trusts itself:
//
//   POSITIVE control — a string that MUST clip. If it does not report, onTextLayout is not
//     firing, and a silent audit would read as "no truncations anywhere" — an instrument
//     that cannot fail, reporting a clean bill of health it never checked.
//   NEGATIVE control — a string that WRAPS across lines without clipping, and MUST NOT be
//     reported. This is the one that catches the nastier failure: TextMeasureCache.cpp:42
//     defaults the per-line text to "" if the key is ever missing, which would make EVERY
//     string in the app look truncated — a check that reports everything is as useless as
//     one that reports nothing, and much louder about it. It also proves the multi-line
//     join is sound, which is why it has to wrap rather than fit on one line.
//
// Real reporting is gated on the positive control passing. If neither control has fired
// after CONTROL_TIMEOUT_MS, it says so loudly rather than staying quiet.

const CONTROL_TIMEOUT_MS = 6000

// ─── WHY A SETTLE WINDOW, AND NOT JUST "REPORT WHAT THE EVENT SAID" ─────────
//
// onTextLayout fires on EVERY measurement that differs from the last one —
// ParagraphEventEmitter.cpp:42 suppresses only an identical repeat, not an intermediate
// pass. So a Text can be measured narrow while its row is still resolving, measured again
// correctly a frame later, and the first of those is a truncation that never reached a
// human eye.
//
// Reporting the first event therefore produces a bug report for a layout that is fine —
// which is the most expensive kind of false positive, because somebody goes and "fixes" a
// screen that was never broken. Only the LAST measurement for a given node describes what
// is actually on screen, so each node's verdict is deferred and superseded until it stops
// changing.
const SETTLE_MS = 400

// Sentinels, not i18n strings, so they can never collide with real copy.
//
// ► ORDINARY SPACED WORDS, AND IT MUST OVERFLOW PAST ITS LINE LIMIT, NOT WITHIN IT.
//   Both details are load-bearing and both were nearly got wrong.
//
//   The detection this control is proving works by whole lines going MISSING: at
//   numberOfLines={1} in a 40px box (~6 characters per line at 12px), this string needs
//   ~15 lines and 14 of them are never laid out, so the join comes back far shorter than
//   the source. It does NOT work by the ellipsis — Android's getLineEnd can report the
//   full character range of the last line with the ellipsis applied only at draw time,
//   which is listed above as a known miss. A probe that overflowed only WITHIN its last
//   allowed line would therefore fail on a perfectly healthy platform and switch the whole
//   audit off.
//
//   And the words are separated by real spaces rather than underscores, because an
//   unbreakable 79-character token has no break opportunity and relies on the engine
//   breaking mid-word to wrap at all. The control must not depend on the one behaviour
//   nobody can predict; it should be the most ordinary text in the app.
const POSITIVE_PROBE = 'ADA audit positive control this string is far too long to fit on one short line and has to clip'
// Long enough that it cannot fail to wrap in a 200px box, because a negative control that
// happens to fit on one line proves only that one line works — and the failure it exists
// to catch (an empty per-line `text`, which would make every string look clipped) is a
// multi-line failure. Given ~6 lines to fill, it must come back whole.
const NEGATIVE_PROBE = 'ADA audit negative control string which has to wrap across several lines and must never be reported as clipped'

const state = {
  installed:      false,
  positivePassed: false,
  negativePassed: false,
  positiveFired:  false,
  negativeFired:  false,
  seen:           new Set(),
}


// ─── WHERE did this render? ─────────────────────────────────────────────────
//
// The reverse lookup answers WHAT string broke, and it is deliberately unable to answer
// WHERE: four modules each define their own key for "Nicosia" with the same Turkish value,
// so "Lefkoşa" maps to four keys and the audit cannot tell which of them rendered. That is
// not a bug in the lookup — it is a dictionary, and a dictionary genuinely does not know
// who read it.
//
// React 19 can answer it. captureOwnerStack() returns the chain of components that OWN the
// currently-rendering element (dev builds only), so the app frames in it name the component
// that wrote the <Text> and the ones that placed it.
//
// ► THREE FRAMES, NOT ONE, AND THE FIRST VERSION'S SINGLE FRAME WAS USELESS FOR EXACTLY
//   THE CASE THAT MATTERED. t('back') clipped on 2026-09-19 and the report said
//   "at BackButton" — a shared control on roughly 35 screens, so the one name it gave was
//   the one name that could not narrow anything. A component is only half the address;
//   the other half is who rendered it, because the constraint that squeezed the text
//   almost always lives in the parent rather than in the shared child.
//
// Degrades to null rather than throwing: it is a dev-only API, it returns null outside
// render, and a report with no location is still worth having.
const OWNER_FRAMES = 3

function ownerLocation() {
  try {
    const stack = React.captureOwnerStack && React.captureOwnerStack()
    if (!stack) return null
    const frames = stack.split('\n').map(l => l.trim()).filter(Boolean)
      .filter(l => /screens\/|components\//.test(l) && !/devTextAudit/.test(l))
    if (frames.length === 0) return null
    // Innermost first, then outward — read it as "this component, inside this one, inside
    // that one". The separator is an arrow rather than a newline so one finding stays one
    // greppable line in a console that is already busy.
    return frames.slice(0, OWNER_FRAMES).join('  <-  ')
  } catch {
    return null
  }
}

function report(kind, key, message) {
  const id = `${kind}:${key}`
  if (state.seen.has(id)) return
  state.seen.add(id)
  console.warn(message)
}

function handleTruncation(source, lines, owner, boxWidth) {
  const rendered = renderedTextOf(lines)

  // ─── Control routing ─────────────────────────────────────────────────────
  if (source === POSITIVE_PROBE) {
    state.positiveFired = true
    state.positivePassed = dense(rendered).length < dense(source).length
    console.log(state.positivePassed
      ? '[ada-audit] POSITIVE control PASSED — onTextLayout fires and truncation is detectable.'
      : `[ada-audit] POSITIVE control FAILED — a string that must clip reported as complete.\n` +
        `            rendered ${dense(rendered).length} chars, source ${dense(source).length} (whitespace excluded).\n` +
        `            Truncation reporting stays OFF. onTextLayout may not be supported here.`)
    return
  }
  if (source === NEGATIVE_PROBE) {
    state.negativeFired = true
    const renderedLen = dense(rendered).length
    if (renderedLen === 0) {
      state.negativePassed = false
      console.warn('[ada-audit] NEGATIVE control FAILED — per-line `text` came back EMPTY.\n' +
                   '            Every string would look truncated. Reporting stays OFF.')
    } else if (renderedLen < dense(source).length) {
      state.negativePassed = false
      console.warn('[ada-audit] NEGATIVE control FAILED — a string that fits reported as clipped.\n' +
                   `            rendered "${display(rendered)}" vs source "${display(source)}".\n` +
                   '            Reporting stays OFF rather than crying wolf on every label.')
    } else {
      state.negativePassed = true
      console.log('[ada-audit] NEGATIVE control PASSED — text that fits is not reported.')
    }
    return
  }

  // ─── Real findings, only once the instrument has proved itself ───────────
  if (!state.positivePassed || !state.negativePassed) return
  if (dense(rendered).length >= dense(source).length) return

  const keys = devKeysForString(source)
  if (keys.length === 0) return                                  // not UI chrome — see SCOPE
  if (keys.some(k => TRUNCATION_ALLOWED.has(k))) return

  // ─── THE GEOMETRY, BECAUSE "IT CLIPPED" IS NOT A DIAGNOSIS ────────────────
  //
  // A report that says only WHAT was cut sends you to the stylesheet to derive what the
  // width must have been — which is exactly what went wrong with the first real finding:
  // the arithmetic said ~190dp available for a ~55dp word, and the arithmetic was wrong.
  // Deriving a runtime width from a stylesheet means modelling flex, gaps, siblings, the
  // parent chain and the font, and being right about all of them at once.
  //
  // So the audit now prints the numbers it already has. `room` is the Text's own laid-out
  // width; `drew` is what the engine actually painted on the first line. Between them the
  // diagnosis forks immediately:
  //
  //   room is SMALL  -> something upstream is squeezing this Text; go and measure the
  //                     parent, the problem is not the string.
  //   room is LARGE  -> the Text had space and the glyphs still did not fit; suspect the
  //                     font scale, which is why it is printed too.
  //
  // fontScale is the user's accessibility text-size setting. At 1.3 or 1.5 every label in
  // the app is a third wider than any figure derived on a desk, and it is invisible in code.
  //
  // ► ONE DECIMAL, NOT WHOLE dp, AND THE PRECISION IS THE POINT.
  //   The first real finding printed `room 55dp · drew 52dp`, and the explanation for it
  //   turns on a deficit of well under a point: Yoga force-CEILS a text node's own frame
  //   (PixelGrid.cpp:85 — "we never want to round down its size as this could lead to
  //   unwanted text truncation") but a content-hugging ANCESTOR is NodeType::Default and
  //   gets plain round-to-nearest, so it can discard the fraction that the text needed.
  //
  //   Whole-dp output rounds away exactly that quantity. It made the instrument report the
  //   symptom while hiding the evidence, and left the deficit to be inferred from 55 vs 52
  //   rather than read off. Layout lands on the physical pixel grid, so a real width is a
  //   multiple of 1/density dp — 54.9 and 55.3 are both "55" and mean different things.
  const fmt = v => v.toFixed(1)
  const lineW = lines[0] && typeof lines[0].width === 'number' ? lines[0].width : null
  const geom = [
    boxWidth != null ? `room ${fmt(boxWidth)}dp` : null,
    lineW != null ? `drew ${fmt(lineW)}dp` : null,
    `fontScale ${PixelRatio.getFontScale()}`,
    `${lines.length} line(s)`,
  ].filter(Boolean).join(' · ')

  report('truncate', keys.join('|'),
    `[ada-audit] TEXT CLIPPED  ${keys.map(k => `t('${k}')`).join(' or ')}\n` +
    (owner ? `            at     : ${owner}\n` : '') +
    `            wanted : "${display(source)}"\n` +
    `            drew   : "${display(rendered)}"\n` +
    `            box    : ${geom}\n` +
    `            This label does not fit in its allowed lines in the current language.\n` +
    `            If the clipping is intended, add the key to ALLOW_TRUNCATION in\n` +
    `            constants/textAuditAllowlist.js with a reason.`)
}


// ─── The patch, on the FOURTH attempt ───────────────────────────────────────
//
// Compiled screens reference `_reactNative.Text` at each JSX site (verified by running
// babel-preset-expo over a probe file), not a value hoisted at import time. So replacing
// ONE property on the `react-native` module object reaches all 72 files that render text,
// with no edit to any of them — including the three Student Hub files this task must not
// touch. That part was right from the start. Getting AT the property took four goes, and
// the three failures are recorded because each one looks reasonable until you try it:
//
//   1. `Text.render = ...` — the forwardRef trick. Dead: Text is a Flow `component()` in
//      0.81.5, a plain function with no `.render`.
//   2. `Text.defaultProps` — dead: React 19 removed defaultProps for function components.
//   3. `require('react-native/Libraries/Text/Text').default = ...` — dead, and this is the
//      one that shipped and crashed the app on launch:
//          TypeError: Cannot assign to property 'default' which has only a getter
//      Babel compiles `export default` to an accessor with NO setter, and measuring the
//      descriptor shows it is also `configurable: false` — so `Object.defineProperty`
//      cannot rescue it either. That module is genuinely sealed.
//
//   4. `Object.defineProperty(require('react-native'), 'Text', ...)` — works, and the
//      reason is a real difference rather than a lucky guess. react-native/index.js:32 is a
//      plain OBJECT LITERAL (`module.exports = { get Text() {...} }`), and accessors
//      declared in an object literal are `configurable: true`. Assignment still throws
//      (same error as #3 — there is no setter), but a configurable property can be
//      REDEFINED. Measured both descriptors side by side before writing this; index.js
//      contains no freeze, seal or preventExtensions.
//
// The lesson worth keeping: "it has only a getter" and "it cannot be replaced" are
// different statements, and the difference is `configurable`.
export function install() {
  if (state.installed) return
  state.installed = true

  // No deep import. `require('react-native')` is the public entry, which also means this
  // file emits none of the "Deep imports from the 'react-native' package are deprecated"
  // warnings that the earlier version did.
  const RN = require('react-native')
  const OriginalText = RN.Text        // reading the getter once resolves the real component
  if (typeof OriginalText !== 'function' && typeof OriginalText !== 'object') {
    console.warn('[ada-audit] INSTALL FAILED — react-native.Text did not resolve to a component. Nothing is audited.')
    return
  }

  function AuditedText(props) {
    const pending = useRef(null)
    const boxWidth = useRef(null)

    let source = null
    const needsSource = props.numberOfLines > 0
    if (needsSource) {
      source = sourceTextOf(props.children)
    }

    // captureOwnerStack() is only meaningful DURING render, so it is read here and carried
    // into the layout callback rather than being read from inside it.
    const owner = source ? ownerLocation() : null

    // onTextLayout is attached ONLY where numberOfLines is set. It makes Fabric measure
    // every line of that node, so putting it on all text would be a real dev-mode cost for
    // nodes that cannot truncate in the first place.
    if (!source || !(props.numberOfLines > 0)) return <OriginalText {...props} />

    const existing = props.onTextLayout
    const existingLayout = props.onLayout
    return (
      <OriginalText
        {...props}
        onLayout={event => {
          if (existingLayout) existingLayout(event)   // chain, never replace
          const w = event && event.nativeEvent && event.nativeEvent.layout
            ? event.nativeEvent.layout.width : null
          if (typeof w === 'number') boxWidth.current = w
        }}
        onTextLayout={event => {
          if (existing) existing(event)          // chain, never replace (0 callers today)
          const lines = event && event.nativeEvent && event.nativeEvent.lines
          if (!Array.isArray(lines) || lines.length === 0) return

          // Supersede any verdict still waiting on this node. An intermediate measurement
          // is not what the user sees; only the one nothing follows is.
          if (pending.current) clearTimeout(pending.current)
          pending.current = setTimeout(() => {
            pending.current = null
            handleTruncation(source, lines, owner, boxWidth.current)
          }, SETTLE_MS)
        }}
      />
    )
  }
  AuditedText.displayName = 'AuditedText'

  // defineProperty, never assignment. See attempt #3 in the header — assignment throws on
  // an accessor with no setter, and it throws at import time, which takes the whole app
  // down before anything renders. Wrapped so that a future React Native which DOES seal
  // this object degrades to a warning instead of the same crash.
  try {
    Object.defineProperty(RN, 'Text', {
      value: AuditedText,
      configurable: true,
      enumerable: true,
      writable: true,
    })
  } catch (e) {
    console.warn('[ada-audit] INSTALL FAILED — react-native.Text could not be redefined.\n' +
                 '            The export is sealed in this version. Nothing is being audited.\n' +
                 `            (${e && e.message})`)
    return
  }

  // Did the patch actually land? A monkey-patch that silently did nothing looks exactly
  // like an app with no problems, and this file exists because that failure mode is the
  // one that costs you two months.
  const applied = RN.Text
  if (applied !== AuditedText) {
    console.warn('[ada-audit] INSTALL FAILED — react-native.Text is not the audited component.\n' +
                 '            Nothing will be reported. The export is probably read-only in this\n' +
                 '            build; the audit needs another way in.')
    return
  }

  setTimeout(() => {
    if (!state.positiveFired && !state.negativeFired) {
      console.warn('[ada-audit] INACTIVE — neither control fired within ' + CONTROL_TIMEOUT_MS + 'ms.\n' +
                   '            onTextLayout is not reaching JS on this platform, so NOTHING is\n' +
                   '            being audited. Do not read the silence as "no problems found".')
    }
  }, CONTROL_TIMEOUT_MS)
}

// ─── The controls, rendered once at the root ───────────────────────────────
//
// Invisible (opacity 0, zero height, not hit-testable) but really laid out — an
// unmeasured node fires no layout event, so `display: none` would defeat the point.
// Both run through the PATCHED component, so what they prove is the whole path this
// audit depends on, not a lookalike of it.
export function AuditControls() {
  const { Text } = require('react-native')
  return (
    <View style={s.probeHost} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={s.probeNarrow}>
        <Text numberOfLines={1} style={s.probeText}>{POSITIVE_PROBE}</Text>
      </View>
      <View style={s.probeWide}>
        <Text numberOfLines={6} style={s.probeText}>{NEGATIVE_PROBE}</Text>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  // Parked off-screen at full size rather than collapsed to height 0. A node that is
  // clipped to nothing is exactly the node a layout engine is entitled to skip measuring,
  // and a control that is never measured fires no event — which this file would then
  // report as "onTextLayout is not supported here". The control must be the most ordinary
  // text in the app, just somewhere nobody looks.
  probeHost:   { position: 'absolute', left: 0, top: -9999, width: 220, opacity: 0 },
  probeNarrow: { width: 40 },
  probeWide:   { width: 200 },
  probeText:   { fontSize: 12, color: colors.textPrimary },
})
