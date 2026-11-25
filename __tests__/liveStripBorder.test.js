// RN 0.81 Android: a card with overflow:'hidden' + borderRadius whose borderWidth prop is REMOVED gets NaN border
// insets and clips every child (the blank Nöbetçi tile, #592). The strip's duty card must always carry a numeric
// borderWidth: 1 in the alert state, 0 once fresh.
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }))
jest.mock('../components/ui', () => ({ RemoteImage: () => null }))
jest.mock('../components/Skeleton', () => ({ Skeleton: () => null }))
jest.mock('../utils/homeStripResolver', () => ({ rememberStripKind: () => {} }))

import React from 'react'
import { StyleSheet } from 'react-native'
import TestRenderer, { act } from 'react-test-renderer'
import LiveStrip from '../components/home/LiveStrip'
import { DUTY_FRESH, DUTY_STALE } from '../utils/dutyStatus'

const dutyCardStyle = r => {
  const cards = r.root.findAll(n => typeof n.type === 'string' && n.props.style && StyleSheet.flatten(n.props.style).overflow === 'hidden')
  return StyleSheet.flatten(cards[cards.length - 1].props.style)
}

const render = dutyStatus => <LiveStrip item={{ generic: true, titleKey: 'stripEventsTitle' }} loading={false} lang="Turkish" dutyStatus={dutyStatus} />

test('strip duty card keeps a numeric borderWidth from alert to fresh', () => {
  let r
  act(() => { r = TestRenderer.create(render(DUTY_STALE)) })
  const alertStyle = dutyCardStyle(r)
  expect(alertStyle.borderRadius).toBeGreaterThan(0)
  expect(alertStyle.borderWidth).toBe(1)

  act(() => { r.update(render(DUTY_FRESH)) })
  const freshStyle = dutyCardStyle(r)
  expect(typeof freshStyle.borderWidth).toBe('number')
  expect(freshStyle.borderWidth).toBe(0)
})
