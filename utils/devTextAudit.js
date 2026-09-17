import { useContext } from 'react'
import { StyleSheet, View } from 'react-native'
import { OnSafeSurface, photoBackdrop } from '../components/SurfaceContext'
import { devKeysForString } from '../constants/i18n'
import { TRUNCATION_ALLOWED, ON_PHOTO_ALLOWED } from '../constants/textAuditAllowlist'
import { colors, contrastRatio } from '../constants/theme'

// ─── The dev-only UI audit: text that clipped, and text on the photo ────────
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
// (2) CONTRAST. A low-contrast label sitting directly on PageBackground's photo, outside
//     any card. That is the 'EĞİTİM' bug. Measured, not guessed — see PHOTO_BACKDROP.
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

// Sentinels, not i18n strings, so they can never collide with real copy.
const POSITIVE_PROBE = 'ADA_AUDIT_POSITIVE_CONTROL_this_string_is_far_too_long_to_fit_on_one_short_line'
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

// ─── The backdrop the contrast rule measures against ───────────────────────
//
// PageBackground is a photo under a 0.30 black scrim, and a photo has no single colour, so
// there is no honest way to compute a ratio against "the background". What CAN be done is
// to measure against a representative mid-tone of that scrimmed photo and require the text
// to clear WCAG AA there.
//
// Measured for the real tokens (2026-09-17), ratio against this backdrop:
//     textSecondary #64748B -> 1.45:1   fails — this is the 'EĞİTİM' bug
//     textPrimary   #1A2B33 -> 2.12:1   fails — dark ink on a photo is the same bug
//     white         #FFFFFF -> 6.90:1   passes — which is ADA's own on-photo convention
// So the rule fires on the defect and not on the pattern the app already uses correctly.
// That was checked before this was written, rather than assumed after.
const PHOTO_BACKDROP = '#5a5a5a'
const MIN_RATIO = 4.5

// React's own flattening rules, because the source length has to be what React would
// render. null/undefined/booleans contribute nothing, numbers stringify, arrays recurse,
// and a nested <Text> contributes its children (an inline <Image> or icon contributes
// nothing, which is correct — it occupies space but no characters).
function flattenChildren(node, out) {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (typeof node === 'string') { out.push(node); return }
  if (typeof node === 'number')  { out.push(String(node)); return }
  if (Array.isArray(node)) { for (const child of node) flattenChildren(child, out); return }
  if (node.props && node.props.children !== undefined) flattenChildren(node.props.children, out)
}

// Two normalisations, and the split matters.
//
// `display` is for the message a human reads.
//
// `dense` — ALL whitespace removed — is what the lengths are compared on, and it is the
// one doing real work. A line break eats the space it broke on, and whether the engine
// reports that space at the end of line N, the start of line N+1, or not at all is a
// platform detail nobody should have to be right about. Comparing raw lengths would flag
// every wrapped label in the app; comparing collapsed whitespace still depends on which
// side the space landed. Counting only non-whitespace characters is immune to all of it,
// and truncation removes real characters, so nothing that matters is lost.
const display = s => s.replace(/\s+/g, ' ').trim()
const dense   = s => s.replace(/\s+/g, '')

function report(kind, key, message) {
  const id = `${kind}:${key}`
  if (state.seen.has(id)) return
  state.seen.add(id)
  console.warn(message)
}

function handleTruncation(source, lines) {
  const rendered = lines.map(l => (typeof l.text === 'string' ? l.text : '')).join('')

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

  report('truncate', keys.join('|'),
    `[ada-audit] TEXT CLIPPED  ${keys.map(k => `t('${k}')`).join(' or ')}\n` +
    `            wanted : "${display(source)}"\n` +
    `            drew   : "${display(rendered)}"\n` +
    `            This label does not fit in its allowed lines in the current language.\n` +
    `            If the clipping is intended, add the key to ALLOW_TRUNCATION in\n` +
    `            constants/textAuditAllowlist.js with a reason.`)
}

function checkContrast(source, style) {
  // ► NOT gated on the controls, unlike truncation, and the asymmetry is deliberate.
  //   The controls prove that onTextLayout fires and reports honestly. This check never
  //   asks the layout engine anything — it reads a colour off a style at render time — so
  //   coupling it to an onTextLayout capability would silently switch off a working check
  //   on any platform where that event is missing. What it DOES depend on is the patch
  //   having landed, and install() verifies that directly.
  if (photoBackdrop.count === 0) return      // no photo on screen, nothing to sit on
  const flat = StyleSheet.flatten(style)
  const color = flat && flat.color
  if (typeof color !== 'string') return      // inherited colour — not resolvable here
  const ratio = contrastRatio(color, PHOTO_BACKDROP)
  if (ratio == null || ratio >= MIN_RATIO) return

  const keys = devKeysForString(source)
  if (keys.length === 0) return
  if (keys.some(k => ON_PHOTO_ALLOWED.has(k))) return

  report('contrast', keys.join('|'),
    `[ada-audit] LOW CONTRAST ON PHOTO  ${keys.map(k => `t('${k}')`).join(' or ')}\n` +
    `            "${display(source)}"\n` +
    `            ${color} on the scrimmed photo measures ${ratio.toFixed(2)}:1 (needs ${MIN_RATIO}:1).\n` +
    `            ADA's answer to this is a ContentCard — that is what every readable label\n` +
    `            in the app sits on. If this one is legible anyway, add the key to\n` +
    `            ALLOW_ON_PHOTO in constants/textAuditAllowlist.js with a reason.`)
}

// ─── The patch ─────────────────────────────────────────────────────────────
//
// react-native exports Text through a lazy getter (node_modules/react-native/index.js:112
// — `get Text() { return require('./Libraries/Text/Text').default }`), which re-reads
// `.default` on EVERY access. So replacing that one property reaches all 72 files that
// render text, with no edit to any of them — including the three Student Hub files this
// task must not touch.
//
// Note what is NOT possible here: Text is a Flow `component()` in 0.81.5, so it is a plain
// function with no `.render` to wrap, and React 19 removed defaultProps for function
// components. Those are the two obvious approaches and both are dead ends.
export function install() {
  if (state.installed) return
  state.installed = true

  const TextModule = require('react-native/Libraries/Text/Text')
  const OriginalText = TextModule.default

  function AuditedText(props) {
    const onSafeSurface = useContext(OnSafeSurface)

    let source = null
    const needsSource = props.numberOfLines > 0 || (!onSafeSurface && photoBackdrop.count > 0)
    if (needsSource) {
      const parts = []
      flattenChildren(props.children, parts)
      source = parts.join('')
    }

    if (source && !onSafeSurface) checkContrast(source, props.style)

    // onTextLayout is attached ONLY where numberOfLines is set. It makes Fabric measure
    // every line of that node, so putting it on all text would be a real dev-mode cost for
    // nodes that cannot truncate in the first place.
    if (!source || !(props.numberOfLines > 0)) return <OriginalText {...props} />

    const existing = props.onTextLayout
    return (
      <OriginalText
        {...props}
        onTextLayout={event => {
          if (existing) existing(event)          // chain, never replace (0 callers today)
          const lines = event && event.nativeEvent && event.nativeEvent.lines
          if (Array.isArray(lines) && lines.length > 0) handleTruncation(source, lines)
        }}
      />
    )
  }
  AuditedText.displayName = 'AuditedText'

  TextModule.default = AuditedText

  // Did the patch actually land? A monkey-patch that silently did nothing looks exactly
  // like an app with no problems, and this file exists because that failure mode is the
  // one that costs you two months.
  const applied = require('react-native').Text
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
