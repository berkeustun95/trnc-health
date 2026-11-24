// AdHouseBanner's stepped headline shrink, driven by a simulated native layout: the harness answers onLayout only
// when a size CHANGED (as RN does) and onTextLayout on every re-layout. Evidence about the state machine (settles,
// terminates, un-hides, resets on language change), not about pixels on a phone.
jest.mock('../constants/ads', () => ({ adRatioFor: () => 3.2 }))
jest.mock('../constants/i18n', () => ({
  t: (key, lang) => ({ adHouseTitle: `T:${lang}`, adHouseLine: `L:${lang}`, adHouseCta: `C:${lang}` }[key]),
}))

import React from 'react'
import { StyleSheet } from 'react-native'
import TestRenderer, { act } from 'react-test-renderer'
import AdHouseBanner from '../components/AdHouseBanner'

const FRAME_INSET = 11 // 2 * (1.5 border + 4 pad), mirrored from the component
const BASE_FS = 15
const BASE_LH = 20

function makeWorld({ frameH, titleChars, lineLines = 1 }) {
  const world = { frameH, titleChars, lineLines, fired: new Map(), events: 0 }
  world.lines = (lang, fs) => Math.ceil((world.titleChars[lang] * fs) / 600)
  return world
}

function settle(r, world) {
  for (let i = 0; i < 60; i++) {
    const root = r.root
    const hosts = root.findAll(n => typeof n.type === 'string')
    let any = false
    const fire = (id, sig, cb) => {
      if (world.fired.get(id) === sig) return
      world.fired.set(id, sig)
      any = true
      world.events++
      cb()
    }
    const frame = hosts.find(n => typeof n.props.onLayout === 'function' && n.props.style && StyleSheet.flatten(n.props.style).borderStyle === 'dashed')
    fire('frame', world.frameH, () => act(() => frame.props.onLayout({ nativeEvent: { layout: { height: world.frameH } } })))
    const probes = r.root.findAll(n => typeof n.type === 'string' && n.props.onTextLayout)
    const [title, line] = probes
    const st = StyleSheet.flatten(title.props.style)
    const lang = title.props.children
    const tl = world.lines(lang.slice(2), st.fontSize)
    const th = tl * st.lineHeight
    fire('title-tl', `${tl}|${st.fontSize}`, () => act(() => title.props.onTextLayout({ nativeEvent: { lines: new Array(tl).fill({}) } })))
    fire('title-h', th, () => act(() => title.props.onLayout({ nativeEvent: { layout: { height: th } } })))
    fire('line-tl', world.lineLines, () => act(() => line.props.onTextLayout({ nativeEvent: { lines: new Array(world.lineLines).fill({}) } })))
    fire('line-h', world.lineLines * 16, () => act(() => line.props.onLayout({ nativeEvent: { layout: { height: world.lineLines * 16 } } })))
    if (!any) return
  }
  throw new Error('layout did not quiesce in 60 rounds (setK loop?)')
}

const visible = r => {
  const hosts = r.root.findAll(n => typeof n.type === 'string' && n.props.numberOfLines === 2)
  const title = hosts.find(n => n.props.maxFontSizeMultiplier && !n.props.onTextLayout)
  // the title's direct parent View carries `hidden` (opacity 0) until settled
  let p = title.parent
  while (p && typeof p.type !== 'string') p = p.parent
  const st = StyleSheet.flatten(p.props.style) || {}
  return { hidden: st.opacity === 0, fs: StyleSheet.flatten(title.props.style).fontSize, lh: StyleSheet.flatten(title.props.style).lineHeight, hasLine: r.root.findAll(n => typeof n.type === 'string' && n.props.numberOfLines === 2).length > 1, fit: title.props.adjustsFontSizeToFit }
}

const mount = lang => {
  let r
  act(() => { r = TestRenderer.create(<AdHouseBanner position="home" lang={lang} onPress={() => {}} />) })
  return r
}
const setLang = (r, lang) => act(() => r.update(<AdHouseBanner position="home" lang={lang} onPress={() => {}} />))

describe('AdHouseBanner stepped headline shrink', () => {
  const frameH = 40 + FRAME_INSET

  test('a headline that fits at k=1 shows at once, line kept', () => {
    const w = makeWorld({ frameH, titleChars: { A: 10 } })
    const r = mount('A')
    settle(r, w)
    const v = visible(r)
    expect(v).toMatchObject({ hidden: false, fs: BASE_FS, lh: BASE_LH })
    expect(v.hasLine).toBe(true)
  })

  test('a long headline shrinks font AND line height together, drops the line, settles visible', () => {
    const w = makeWorld({ frameH, titleChars: { A: 100 } })
    const r = mount('A')
    settle(r, w)
    const v = visible(r)
    const k = v.fs / BASE_FS
    console.log('raw: fs', v.fs, 'lh', v.lh, 'k', k, 'events', w.events)
    expect(v.hidden).toBe(false)
    expect(v.lh / BASE_LH).toBeCloseTo(k, 5)
    expect(k).toBeLessThan(1)
    expect(k).toBeGreaterThanOrEqual(0.6 - 1e-9)
    expect(v.hasLine).toBe(false)
    expect(w.lines('A', v.fs)).toBeLessThanOrEqual(2)
  })

  test('hits the 0.6 floor, still settles visible, falls back to adjustsFontSizeToFit', () => {
    const w = makeWorld({ frameH, titleChars: { A: 100000 } })
    const r = mount('A')
    settle(r, w)
    const v = visible(r)
    console.log('raw floor: fs', v.fs, 'k', v.fs / BASE_FS)
    expect(v.fs / BASE_FS).toBeCloseTo(0.6, 5)
    expect(v).toMatchObject({ hidden: false, fit: true })
  })

  test('language change after a shrink resets k to 1 and settles visible', () => {
    const w = makeWorld({ frameH, titleChars: { A: 100, B: 10 } })
    const r = mount('A')
    settle(r, w)
    expect(visible(r).fs).toBeLessThan(BASE_FS)
    setLang(r, 'B')
    settle(r, w)
    const v = visible(r)
    console.log('raw after lang change: fs', v.fs, 'hidden', v.hidden)
    expect(v).toMatchObject({ hidden: false, fs: BASE_FS, hasLine: true })
  })

  test('language change between two long headlines re-shrinks from 1 and settles visible', () => {
    const w = makeWorld({ frameH, titleChars: { A: 100, B: 120 } })
    const r = mount('A')
    settle(r, w)
    setLang(r, 'B')
    settle(r, w)
    const v = visible(r)
    expect(v.hidden).toBe(false)
    expect(w.lines('B', v.fs)).toBeLessThanOrEqual(2)
  })

  test('frame height change (rotation / font scale) re-settles visible, never stuck hidden', () => {
    const w = makeWorld({ frameH, titleChars: { A: 100 } })
    const r = mount('A')
    settle(r, w)
    w.frameH = 30 + FRAME_INSET
    settle(r, w)
    expect(visible(r).hidden).toBe(false)
    w.frameH = 80 + FRAME_INSET
    settle(r, w)
    expect(visible(r).hidden).toBe(false)
  })
})
