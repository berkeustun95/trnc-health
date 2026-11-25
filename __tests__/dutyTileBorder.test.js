// RN 0.81 Android: a card with overflow:'hidden' + borderRadius whose borderWidth prop is REMOVED gets NaN border
// insets and clips every child (blank Nöbetçi tile after offline recovery). The card must always carry a numeric
// borderWidth: 1.5 in the alert/error state, 0 once fresh.
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }))
jest.mock('../components/ui', () => ({ Bone: () => null, IconButton: () => null, RemoteImage: () => null }))
jest.mock('../components/EateryBits', () => ({ PlaceholderTag: () => null, eateryImageUrl: () => null }))
jest.mock('../utils/homeStripResolver', () => ({ rememberStripKind: () => {} }))
jest.mock('../utils/eateryBasket', () => ({ EATERY_DEMO: false }))

import React from 'react'
import { StyleSheet } from 'react-native'
import TestRenderer, { act } from 'react-test-renderer'
import { DutyTile } from '../components/home/redesign/Widgets'
import { DUTY_FRESH } from '../utils/dutyStatus'

const cardStyle = r => {
  const card = r.root.findAll(n => typeof n.type === 'string' && n.props.style && StyleSheet.flatten(n.props.style).overflow === 'hidden')[0]
  return StyleSheet.flatten(card.props.style)
}

const render = summary => <DutyTile summary={summary} lang="Turkish" height={120} />

test('duty tile card keeps a numeric borderWidth from error to fresh', () => {
  let r
  act(() => { r = TestRenderer.create(render({ loaded: true, error: true })) })
  const alertStyle = cardStyle(r)
  expect(alertStyle.borderRadius).toBeGreaterThan(0)
  expect(typeof alertStyle.borderWidth).toBe('number')
  expect(alertStyle.borderWidth).toBe(1.5)

  act(() => { r.update(render({ loaded: true, error: null, status: DUTY_FRESH, count: 5, until: '08:00' })) })
  const freshStyle = cardStyle(r)
  expect(typeof freshStyle.borderWidth).toBe('number')
  expect(freshStyle.borderWidth).toBe(0)
})
