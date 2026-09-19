import * as React from 'react'
import { useRef, useState, useEffect } from 'react'
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
  watched:        0,      // Text nodes with numberOfLines that this audit is watching
  verdicts:       0,      // measurements actually evaluated
  reported:       0,
  probes:         0,      // `needs` probes raised — see THE `needs` PROBE below
  installed:      false,
  positivePassed: false,
  negativePassed: false,
  positiveFired:  false,
  negativeFired:  false,
  needsControlFired:  false,
  needsControlPassed: false,
  seen:           new Set(),
}


// ─── WHERE did this render? ─────────────────────────────────────────────────
//
// The reverse lookup answers WHAT string broke, and it is deliberately unable to answer
// WHERE: four modules each define their own key for "Nicosia" with the same Turkish value,
// so "Lefkoşa" maps to four keys and the audit cannot tell which. That is not a bug in the
// lookup — it is a dictionary, and a dictionary does not know who read it.
//
// React 19's captureOwnerStack() answers it, in dev builds only. Read DURING RENDER and
// carried into the layout callback, because it is meaningless outside one.
//
// ► THREE FRAMES, NOT ONE. t('back') clipped on 2026-09-19 and a one-frame report said
//   "at BackButton" — a shared control on ~35 screens, so the only name it gave was the
//   only name that narrowed nothing. A component is half an address; the other half is who
//   rendered it, because the constraint that squeezes the text usually lives in the parent.
//
// ► AND NO ASSUMPTION ABOUT WHAT A FRAME LOOKS LIKE. The first attempt at three frames
//   filtered on /screens\/|components\// and shipped with NO owner line at all. The filter
//   had never matched anything: the version before it ended `|| frames[0] || null`, and
//   that fallback was doing the entire job while the regex quietly matched nothing. Taking
//   the fallback away took the feature with it.
//
//   Which frame format React actually produces here — component names, bundle URLs, or
//   real file paths from the JSX source transform — was never measured, only assumed. So
//   this no longer guesses: it drops only the audit's OWN frames, keeps whatever remains,
//   and PRINTS THE RAW STACK ONCE so the format stops being a guess for the next person.
const OWNER_FRAMES = 3
let rawStackShown = false

function ownerLocation() {
  try {
    const stack = React.captureOwnerStack && React.captureOwnerStack()
    if (!stack) return null
    const frames = stack.split('\n').map(l => l.trim()).filter(Boolean)
    if (frames.length === 0) return null

    // Once per session, and only once: the raw first frames, verbatim. An assumption about
    // this format is what broke the owner line, and a value nobody has ever looked at is
    // exactly the kind that gets assumed again.
    if (!rawStackShown) {
      rawStackShown = true
      console.log('[ada-audit] owner-stack format (raw, first 3 frames):\n  ' +
                  frames.slice(0, 3).join('\n  '))
    }

    const useful = frames.filter(l => !/devTextAudit|AuditedText/.test(l))
    return (useful.length ? useful : frames).slice(0, OWNER_FRAMES).join('  <-  ')
  } catch {
    return null
  }
}

// ─── claim, then print — and they are now two steps, not one ───────────────
//
// These used to be one `report()` that deduped and printed together. They had to split
// when the report started waiting on a `needs` probe: the claim has to happen the moment
// a clip is found (or a second measurement of the same node queues a second probe before
// the first has answered), while the print happens once the probe replies — by which time
// the id is already in `seen` and the old guard would have swallowed the only copy.
//
// A dedupe that silently eats the finding it was meant to deduplicate is precisely the
// instrument failure this file exists to avoid, so: claim returns whether it won the race,
// and print is unconditional.
function claim(id) {
  if (state.seen.has(id)) return false
  state.seen.add(id)
  return true
}

function print(message) {
  state.reported += 1
  console.warn(message)
}

// ─── SILENCE MUST NOT MEAN TWO THINGS ──────────────────────────────────────
//
// "No output" currently reads as both "nothing is wrong" and "the audit is dead", and
// those were indistinguishable on 2026-09-19 — a broken owner line looked exactly like a
// quiet screen. An instrument whose failure and success print the same thing is the
// hazard CLAUDE.md names: ask what a healthy system prints here, and make a broken one
// print something else.
//
// So it says it is alive, on a timer, and only when the numbers have moved. Navigating to
// a new screen makes `watched` climb; if it stops climbing while you move around, the
// audit is not watching any more and the silence is its own, not the app's.
//
// ► `watched` COUNTS APP TEXT ONLY, AND THE `needs` PROBES DO NOT ENTER IT.
//   A probe carries no numberOfLines, so AuditedText's own `props.numberOfLines > 0`
//   test skips it before the counter is reached. `probes` is printed as its own figure
//   instead — additive, so the number Berke reads to know the audit is alive keeps
//   meaning exactly what it has always meant, and the probe machinery is still visible
//   rather than being a silent third thing.
let lastBeat = { watched: -1, verdicts: -1, probes: -1 }
function heartbeat() {
  if (!state.positivePassed) return
  if (state.watched === lastBeat.watched &&
      state.verdicts === lastBeat.verdicts &&
      state.probes === lastBeat.probes) return
  lastBeat = { watched: state.watched, verdicts: state.verdicts, probes: state.probes }
  console.log(`[ada-audit] alive — ${state.watched} node(s) watched, ` +
              `${state.verdicts} measurement(s) checked, ${state.reported} reported, ` +
              `${state.probes} needs-probe(s)`)
}

// ─── THE `needs` PROBE: the one number the report never had ────────────────
//
// Until 2026-09-19 a clip report printed two widths and NEITHER of them was what the
// string needs. `room` was the Text's own laid-out box; `drew` was the width painted on
// line 1 — that is, the width of the ALREADY-TRUNCATED string. Both are facts about the
// failure. Neither says how much width the full string was asking for.
//
// The cost was a week. Eight clips across four components (BackButton, HomeHero,
// LiveStrip, EventsScreen) were REASONED about instead — `room` against a hand-summed
// advance table built from the real .ttf files — and the reasoning eliminated three
// hypotheses and produced no cause, because the only comparison that decides anything
// (needed vs available) could not be made from the numbers on the screen. The geometry
// block below was added to abolish exactly that stylesheet arithmetic, and it did not,
// because it printed the numbers this file already had rather than the number it lacked.
//
// So it is measured now. When a string is found clipped, the SAME text in the SAME
// resolved style is rendered a second time with nothing constraining it, and its width
// is printed beside the box it was actually given:
//
//   needs >  box    the Text really was too narrow. Go and measure the PARENT.
//   needs <= box    the box was wide enough and it ellipsized anyway — the cut is in the
//                   ellipsize comparison, not in the layout.
//
// ► THE PROBE MUST NOT AUDIT ITSELF — AND IT NEEDS NO SENTINEL TO AVOID IT.
//   A deliberately unconstrained Text can never clip, so a probe that reported would be
//   the instrument measuring its own reflection; and it would inflate `watched`, the one
//   number the heartbeat uses to prove the audit is alive.
//   Both are excluded STRUCTURALLY, by the predicate AuditedText already gates on:
//   `props.numberOfLines > 0`. A probe sets no numberOfLines, so `source` stays null,
//   `state.watched` is never incremented, no onTextLayout wrapper is attached, and
//   handleTruncation is never reached for it. The early `<OriginalText {...props} />`
//   forwards the probe's OWN onLayout/onTextLayout untouched, which is how it reports
//   back here instead.
//   A name check or a sentinel string would have been a second thing to keep in sync with
//   the first, and the kind of hand-kept list this file already deleted once. This is the
//   same predicate that defines the watch set, or it is nothing.
//
// ► AND IT MUST NEVER MAKE THE AUDIT QUIETER THAN IT ALREADY WAS.
//   Deferring the report until a probe answers invents a new way for a finding to be
//   found and never printed, which is the failure this whole file is built against. So
//   every probe carries a hard timeout that prints the report WITHOUT `needs`, and it
//   settles on whichever of the two layout events arrives rather than requiring both.
//   The floor is today's report; `needs` is only ever an addition to it.
const NEEDS_SETTLE_MS   = 120    // supersede intermediate probe measurements, as SETTLE_MS does
const NEEDS_TIMEOUT_MS  = 2500   // past this, print without `needs` rather than not at all
const NEEDS_HOST_WIDTH  = 4000   // wider than any chrome string can ask for; see `needsHost`

// Stripped from the captured style: everything that CONSTRAINS or POSITIONS. What stays is
// everything that changes how wide the glyphs and their box come out — fontSize, fontFamily,
// fontWeight, letterSpacing, fontVariant, textTransform, includeFontPadding, padding and
// border. Padding stays on purpose: `box` is a border-box width, so `needs` has to be one
// too or the two numbers being subtracted are not the same kind of thing.
const PROBE_STRIP = new Set([
  'width', 'minWidth', 'maxWidth', 'height', 'minHeight', 'maxHeight',
  'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'alignSelf',
  'position', 'top', 'left', 'right', 'bottom', 'start', 'end',
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
  'marginHorizontal', 'marginVertical', 'marginStart', 'marginEnd',
  'transform',
])

// Strings only. A nested <Text> span carries its own font, and an inline icon occupies
// width with no characters — a probe rendering flattened text for either measures a
// different thing than the node it is explaining, which is this repo's standing hazard
// (the check and the thing checked in two different frames of reference). Refused and
// SAID, rather than measured and wrong.
function isPlainChildren(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return true
  if (typeof node === 'string' || typeof node === 'number') return true
  if (Array.isArray(node)) return node.every(isPlainChildren)
  return false
}

function probeFromProps(props) {
  if (!isPlainChildren(props.children)) {
    return { ok: false, why: 'nested spans or inline elements — the probe cannot model mixed fonts' }
  }
  const flat = StyleSheet.flatten(props.style) || {}
  const style = {}
  for (const k of Object.keys(flat)) if (!PROBE_STRIP.has(k)) style[k] = flat[k]

  // From PROPS, not style, and just as load-bearing: a Text that opted out of font scaling
  // must be measured with it off, or `needs` is computed at a size the original never uses.
  const textProps = {}
  if (props.allowFontScaling !== undefined) textProps.allowFontScaling = props.allowFontScaling
  if (props.maxFontSizeMultiplier !== undefined) textProps.maxFontSizeMultiplier = props.maxFontSizeMultiplier

  return { ok: true, style, textProps, shrinks: !!props.adjustsFontSizeToFit }
}

// Probes stay mounted once raised. They are invisible and bounded by the number of DISTINCT
// findings (`claim` admits each key once), and unmounting one races the layout event it
// exists to deliver — a probe torn down a frame early reports nothing and looks exactly
// like a probe that failed.
const needsQueue = []
let needsListener = null
let probeSeq = 0

function completeProbe(entry) {
  if (entry.done) return
  entry.done = true
  if (entry.settle) clearTimeout(entry.settle)
  if (entry.deadline) clearTimeout(entry.deadline)
  // Its own try/catch: this runs from a layout event or a timer, OUTSIDE the one wrapping
  // handleTruncation, so an exception here escapes to the global handler and the finding is
  // lost behind a dismissible redbox.
  try {
    entry.finish({ box: entry.box, glyphs: entry.glyphs, lineCount: entry.lineCount })
  } catch (e) {
    console.warn('[ada-audit] a needs-probe result threw while being reported — this is a bug in\n' +
                 '            utils/devTextAudit.js, not in the screen. The audit keeps running.\n' +
                 `            ${e && e.message}`)
  }
}

function requestNeeds(text, probe, finish) {
  const entry = {
    key: `needs-${probeSeq++}`,
    text,
    style: probe.style,
    textProps: probe.textProps,
    box: null, glyphs: null, lineCount: null,
    settle: null, deadline: null, done: false,
    finish,
  }
  entry.arrived = () => {
    if (entry.done) return
    if (entry.settle) clearTimeout(entry.settle)
    entry.settle = setTimeout(() => completeProbe(entry), NEEDS_SETTLE_MS)
  }
  // Armed BEFORE the host is told to render, so a host that never mounts — or a platform
  // where the probe fires no layout event — still produces the report.
  entry.deadline = setTimeout(() => completeProbe(entry), NEEDS_TIMEOUT_MS)

  needsQueue.push(entry)
  state.probes += 1
  if (needsListener) needsListener()
  return entry
}

const fmt = v => v.toFixed(1)

// `box` is a border-box width and `glyphs` is a content width, so comparing them needs the
// horizontal padding and border taken off the first. Kept explicit rather than folded into
// the subtraction, because these two are the numbers that separate the two live hypotheses
// and a silent off-by-a-padding would point the diagnosis at the wrong pass.
function horizontalInset(st) {
  const n = v => (typeof v === 'number' ? v : 0)
  return n(st.paddingLeft ?? st.paddingStart ?? st.paddingHorizontal ?? st.padding) +
         n(st.paddingRight ?? st.paddingEnd ?? st.paddingHorizontal ?? st.padding) +
         n(st.borderLeftWidth ?? st.borderWidth) +
         n(st.borderRightWidth ?? st.borderWidth)
}

// What `needs` is allowed to claim, and what it must refuse to. Each refusal names its own
// reason: an "unmeasured" that does not say why is a dead end, and the next person debugs
// the screen instead of the instrument.
function needsReport(r, probe) {
  if (!probe.ok) return { text: `unmeasured — ${probe.why}`, box: null }
  if (r.box == null && r.glyphs == null) {
    return { text: `unmeasured — the probe did not report within ${NEEDS_TIMEOUT_MS}ms`, box: null }
  }
  if (r.lineCount != null && r.lineCount > 1) {
    return { text: `unmeasured — the probe itself wrapped onto ${r.lineCount} lines, so no single ` +
                   `line width describes it. Widen NEEDS_HOST_WIDTH in utils/devTextAudit.js.`,
             box: null }
  }
  const parts = []
  if (r.box != null) parts.push(`${fmt(r.box)}dp   the FULL string, unconstrained          (incl. padding)`)
  if (r.glyphs != null) {
    parts.push(`${parts.length ? '\n                      ' : ''}` +
               `${fmt(r.glyphs)}dp   …its glyphs alone, on one line          (glyphs only)`)
  }
  return { text: parts.join(''), box: r.box }
}

function handleTruncation(source, lines, owner, boxWidth, makeProbe) {
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

    // ► THE PROBE MACHINERY GETS A CONTROL OF ITS OWN, ON THE SAME PRINCIPLE AS THE TWO
    //   ABOVE. Without it, the first time the `needs` path ever runs is on a real finding,
    //   and if it is dead that report says `unmeasured` — a whole device launch spent
    //   learning nothing, which is the cost this was built to stop paying.
    //   The positive control is a ~95-character string in a 40dp box, so a working probe
    //   must come back with a width in the hundreds. A number near 40 would mean the probe
    //   is being constrained by its host rather than measuring freely.
    if (state.positivePassed && !state.needsControlFired) {
      state.needsControlFired = true
      const probe = probeFromProps({ children: POSITIVE_PROBE, style: s.probeText })
      requestNeeds(POSITIVE_PROBE, probe, r => {
        if (r.box == null && r.glyphs == null) {
          console.warn('[ada-audit] NEEDS probe DID NOT REPORT — every clip report will say\n' +
                       `            "needs: unmeasured". The second render is not being laid out.\n` +
                       '            Check that <AuditControls /> is still mounted in utils/devRoot.js.')
        } else if (r.box != null && r.box < 100) {
          console.warn('[ada-audit] NEEDS probe SUSPECT — an unconstrained ~95-character string\n' +
                       `            measured only ${fmt(r.box)}dp. The probe host is squeezing it, so\n` +
                       '            every `needs` figure would be an underestimate. Reported anyway,\n' +
                       '            but treat them as a floor until this line goes away.')
        } else {
          state.needsControlPassed = true
          console.log('[ada-audit] NEEDS probe PASSED — the positive control, which is laid out in a ' +
                      `40dp box,\n            measures ${fmt(r.box)}dp unconstrained. ` +
                      '`needs` is live.')
        }
      })
    }
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

  // Claimed HERE, before the probe is raised — not at print time. A node measured twice
  // would otherwise queue two probes for one finding, and the settle window above does not
  // cover it because each measurement arrives as its own verdict.
  if (!claim(`truncate:${keys.join('|')}`)) return

  // ─── THE GEOMETRY, BECAUSE "IT CLIPPED" IS NOT A DIAGNOSIS ────────────────
  //
  // A report that says only WHAT was cut sends you to the stylesheet to derive what the
  // width must have been. Deriving a runtime width from a stylesheet means modelling flex,
  // gaps, siblings, the parent chain and the font, and being right about all of them at
  // once — so the audit prints measured widths instead.
  //
  // ► EVERY WIDTH SAYS WHAT IT IS, IN THE LINE THAT PRINTS IT. Three numbers that all
  //   read as "how wide the text is" is how a week went sideways: `room` and `drew` were
  //   taken to mean "what the string needs", and they mean the box it got and the width
  //   of the ALREADY-TRUNCATED string. Both labels were accurate and neither was safe.
  //   The rule now is that no width appears without the phrase that disambiguates it,
  //   including the two that have been here since the beginning.
  //
  // ► THE FORK IS `needs` vs `box`, AND IT REPLACES A WRONG ONE.
  //   This block used to fork on "room is SMALL → measure the parent / room is LARGE →
  //   suspect the font scale", and offered a Yoga ceil-vs-round model (PixelGrid.cpp:85)
  //   as the explanation for sub-point deficits. THAT MODEL LOST ITS OWN TEST. Eight
  //   clips measured on 2026-09-19 at fontScale 1 had `room` ALREADY LARGER than the sum
  //   of their glyph advances — by +0.40 to +3.14dp — and truncated regardless, which no
  //   rounding story survives; the quantum is 0.36dp and the gaps are up to 3. Commit
  //   38289d0 records the same retraction in components/home/HomeHero.js, and the two
  //   must not be allowed to disagree.
  //   What replaces it is not a better model. It is a measurement: `needs`.
  //
  // ► ONE DECIMAL, NOT WHOLE dp, AND THE PRECISION IS THE POINT.
  //   Layout lands on the physical pixel grid, so a real width is a multiple of 1/density
  //   dp — 54.9 and 55.3 are both "55" and mean different things. Whole-dp output would
  //   round away the entire quantity under discussion.
  //
  // fontScale is the user's accessibility text-size setting. At 1.3 or 1.5 every label in
  // the app is a third wider than any figure derived on a desk, and it is invisible in code.
  const lineW = lines[0] && typeof lines[0].width === 'number' ? lines[0].width : null
  const probe = makeProbe ? makeProbe() : { ok: false, why: 'the caller supplied no style to measure' }

  const emit = r => {
    const needs = needsReport(r, probe)
    const deficit = (needs.box != null && boxWidth != null) ? needs.box - boxWidth : null

    // ► EACH BRANCH STATES WHAT WAS MEASURED AND WHAT TO DO. None of them names a
    //   mechanism it did not measure — that is the habit which produced the ceil-vs-round
    //   model retired above, and a plausible cause printed in an instrument's own voice is
    //   read as a finding.
    let verdict
    if (deficit == null) {
      const missing = boxWidth == null
        ? 'the box width never arrived (onLayout did not fire for this node)'
        : 'see the `needs` line above'
      verdict = `not enough to diagnose — ${missing}.`
    } else if (deficit > 0.5) {
      verdict = `the box is ${fmt(deficit)}dp NARROWER than this string needs. ` +
                'The constraint is upstream:\n              measure the PARENT, not the string.'
    } else if (deficit > 0) {
      verdict = `the box is short by ${fmt(deficit)}dp. A pixel of slack on this Text covers it.`
    } else {
      // The box was big enough and it clipped regardless. Two different passes can be at
      // fault and they take different fixes, so the glyph width decides between them rather
      // than one of them being asserted.
      const inset = probe.ok ? horizontalInset(probe.style) : 0
      const contentBox = boxWidth - inset
      if (r.glyphs != null && r.glyphs > contentBox) {
        verdict = `the box measured ${fmt(-deficit)}dp WIDER than needed, yet the full string's\n` +
                  `              glyphs are ${fmt(r.glyphs)}dp against ${fmt(contentBox)}dp of content box` +
                  (inset ? ` (${fmt(boxWidth)} − ${fmt(inset)} padding/border)` : '') + '.\n' +
                  '              The MEASURE pass gave this Text less than the DRAW pass needs.'
      } else {
        verdict = `the box was ${fmt(-deficit)}dp WIDER than the string needs, and the glyphs ` +
                  `(${r.glyphs != null ? fmt(r.glyphs) + 'dp' : '?'})\n` +
                  `              fit inside ${fmt(contentBox)}dp of content box. It ellipsized anyway:\n` +
                  '              the cut is in the ellipsize comparison, not in either measurement.'
      }
    }

    print(
      `[ada-audit] TEXT CLIPPED  ${keys.map(k => `t('${k}')`).join(' or ')}\n` +
      (owner ? `            at      : ${owner}\n` : '') +
      `            wanted  : "${display(source)}"\n` +
      `            painted : "${display(rendered)}"\n` +
      `            box     : ${boxWidth != null ? fmt(boxWidth) + 'dp' : '   ?  '}   the width this Text was LAID OUT at     (incl. padding)\n` +
      `            painted : ${lineW != null ? fmt(lineW) + 'dp' : '   ?  '}   that TRUNCATED string, on line 1        (glyphs only)\n` +
      `            needs   : ${needs.text}\n` +
      `            ⇒ ${verdict}\n` +
      `            fontScale ${PixelRatio.getFontScale()} · ${lines.length} line(s)` +
      (probe.shrinks ? '\n            NOTE: this Text sets adjustsFontSizeToFit, so it shrinks its own font to\n' +
                       '                  fit. `needs` is measured at the UNSHRUNK size.' : '') + '\n' +
      `            If the clipping is intended, add the key to ALLOW_TRUNCATION in\n` +
      `            constants/textAuditAllowlist.js with a reason.`)
  }

  if (!probe.ok) { emit({ box: null, glyphs: null, lineCount: null }); return }
  requestNeeds(source, probe, emit)
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
    const counted = useRef(false)

    let source = null
    const needsSource = props.numberOfLines > 0
    if (needsSource) {
      source = sourceTextOf(props.children)
    }
    // Counted at render rather than at layout: a node this audit is WATCHING is the number
    // that should climb as you navigate, whether or not anything about it is wrong.
    if (needsSource && !counted.current) { counted.current = true; state.watched += 1 }

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
            state.verdicts += 1
            // ► A THROW IN HERE MUST NOT BE ABLE TO SILENCE THE AUDIT.
            //   This runs from a timer, so an exception escapes to the global handler and
            //   whatever redbox it raises can be dismissed — after which the screen looks
            //   exactly like an app with nothing to report. A verdict that cannot be
            //   formatted is a bug in this file, not in the app, and it must say so rather
            //   than costing another launch to diagnose.
            try {
              // The probe's style is built LAZILY, from this render's props, and only if a
              // clip is actually found. Flattening a style on every measurement of every
              // watched node in the app would be real dev-mode cost for the ~99% that are
              // fine; this closure already holds the props, so deferring it is free.
              handleTruncation(source, lines, owner, boxWidth.current, () => probeFromProps(props))
            } catch (e) {
              console.warn('[ada-audit] a verdict threw while being reported — this is a bug in\n' +
                           '            utils/devTextAudit.js, not in the screen. The audit keeps running.\n' +
                           `            ${e && e.message}`)
            }
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

  setInterval(heartbeat, 10000)

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

  // The `needs` probes are raised from a layout callback, which is outside React. This is
  // the subscription that turns one into a rendered node. It holds no copy of the queue —
  // the queue is the module-level array, and this only asks to be re-run when it grows.
  const [, bump] = useState(0)
  useEffect(() => {
    needsListener = () => bump(v => v + 1)
    // An effect runs AFTER the first commit, so anything queued in the gap has no listener
    // to wake it and would sit unrendered until the next finding. Its report is safe either
    // way — the deadline covers that — but the startup NEEDS control would report DID NOT
    // REPORT and condemn a probe path that is fine.
    if (needsQueue.length) bump(v => v + 1)
    return () => { needsListener = null }
  }, [])

  return (
    <View style={s.probeHost} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={s.probeNarrow}>
        <Text numberOfLines={1} style={s.probeText}>{POSITIVE_PROBE}</Text>
      </View>
      <View style={s.probeWide}>
        <Text numberOfLines={6} style={s.probeText}>{NEGATIVE_PROBE}</Text>
      </View>

      {/* ► NO numberOfLines ON ANY OF THESE, AND THAT IS THE WHOLE EXCLUSION.
          It is what keeps a probe out of `state.watched` and out of handleTruncation —
          see THE `needs` PROBE above. Do not add one "to be safe": it would make the
          instrument audit its own reflection and inflate the heartbeat at the same time.

          alignItems:'flex-start' on the host is what makes each probe HUG its text. A
          column container stretches its children by default, which would hand every probe
          the host's full width and make `needs` a constant — a probe that always returns
          the same number being the textbook instrument that cannot fail. */}
      <View style={s.needsHost}>
        {needsQueue.map(entry => (
          <Text
            key={entry.key}
            {...entry.textProps}
            style={entry.style}
            onLayout={e => {
              const w = e && e.nativeEvent && e.nativeEvent.layout ? e.nativeEvent.layout.width : null
              if (typeof w === 'number') { entry.box = w; entry.arrived() }
            }}
            onTextLayout={e => {
              const ls = e && e.nativeEvent && e.nativeEvent.lines
              if (!Array.isArray(ls) || ls.length === 0) return
              entry.lineCount = ls.length
              if (typeof ls[0].width === 'number') entry.glyphs = ls[0].width
              entry.arrived()
            }}
          >{entry.text}</Text>
        ))}
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

  // Its OWN host, deliberately not probeHost's 220dp. A `needs` probe that hits the edge
  // of its container wraps, and a wrapped probe is refused rather than reported (see
  // needsReport) — so the width has to be far past anything UI chrome could ask for, and
  // it is free: the host is absolutely positioned, off-screen and never painted.
  // If a real string ever does wrap here, the report says so BY NAME and points at this
  // constant, rather than quietly returning a width that means nothing.
  needsHost:   { width: NEEDS_HOST_WIDTH, alignItems: 'flex-start' },
})
