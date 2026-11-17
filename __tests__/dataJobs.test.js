// Pure helpers behind the admin "Data jobs" screen. The server computes `state` and `attention`; these only group,
// count and format. Attention comes ONLY from the boolean, never from the state string.
import { countAttention, countNoRecord, groupJobs, isUsableJobs, isValidJob, ageParts, formatFamagusta } from '../utils/dataJobs'

const job = (key, state, attention, extra = {}) => ({ key, state, attention, ...extra })
const keys = g => g.jobs.map(j => j.key)

describe('countAttention / countNoRecord', () => {
  const rows = [
    job('a', 'failed', true), job('b', 'failed', false), job('c', 'inactive', true),
    job('d', 'inactive', false), job('e', 'no_record', false), job('f', 'no_record', true), job('g', 'ok', false),
  ]
  test('attention is the boolean only: a failed row with attention:false is not counted', () => {
    expect(countAttention(rows)).toBe(3)
    expect(countAttention([job('x', 'failed', false)])).toBe(0)
  })
  test('a truthy non-boolean does not count', () => {
    expect(countAttention([job('x', 'failed', 'true'), job('y', 'failed', 1)])).toBe(0)
  })
  test('no_record counted by state, regardless of attention', () => { expect(countNoRecord(rows)).toBe(2) })
  test('null / undefined / holes do not throw', () => {
    expect(countAttention(null)).toBe(0); expect(countNoRecord(undefined)).toBe(0); expect(countAttention([null, undefined, job('a', 'ok', true)])).toBe(1)
  })
})

describe('groupJobs', () => {
  test('order: attention, paused / off, no record, healthy; server order kept inside a group', () => {
    const g = groupJobs([
      job('ok1', 'ok', false), job('nr1', 'no_record', false), job('p1', 'paused', false), job('f1', 'failed', true),
      job('ok2', 'ok', false), job('s1', 'stale', true), job('i1', 'inactive', false), job('nr2', 'no_record', false),
    ])
    expect(g.map(x => x.id)).toEqual(['attention', 'paused', 'noRecord', 'ok'])
    expect(g.map(keys)).toEqual([['f1', 's1'], ['p1', 'i1'], ['nr1', 'nr2'], ['ok1', 'ok2']])
  })
  test('empty groups are dropped', () => {
    expect(groupJobs([job('a', 'ok', false)]).map(x => x.id)).toEqual(['ok'])
    expect(groupJobs([job('a', 'failed', true), job('b', 'ok', false)]).map(x => x.id)).toEqual(['attention', 'ok'])
    expect(groupJobs([])).toEqual([])
    expect(groupJobs(null)).toEqual([])
  })
  test('a failed row with attention:false is not in the attention group (it is not "ok" either: no-record bucket)', () => {
    const g = groupJobs([job('f', 'failed', false)])
    expect(g.map(x => x.id)).toEqual(['noRecord'])
  })
  test('an inactive row with attention:false lands in paused / off; with attention:true in attention', () => {
    expect(groupJobs([job('i', 'inactive', false)]).map(x => x.id)).toEqual(['paused'])
    expect(groupJobs([job('i', 'inactive', true)]).map(x => x.id)).toEqual(['attention'])
  })
  test('an ok row with attention:true is in attention; an unknown state falls to no record', () => {
    expect(groupJobs([job('o', 'ok', true)]).map(x => x.id)).toEqual(['attention'])
    expect(groupJobs([job('u', 'weird', false)]).map(x => x.id)).toEqual(['noRecord'])
  })
})

describe('isUsableJobs / isValidJob', () => {
  test('empty or non-array is unusable (the registry cannot legitimately be empty)', () => {
    expect(isUsableJobs([])).toBe(false)
    expect(isUsableJobs(null)).toBe(false)
    expect(isUsableJobs(undefined)).toBe(false)
    expect(isUsableJobs({ length: 1 })).toBe(false)
    expect(isUsableJobs('x')).toBe(false)
    expect(isUsableJobs([job('a', 'ok', false)])).toBe(true)
  })
  test('valid: boolean attention, string key, string state', () => {
    expect(isValidJob(job('a', 'ok', false))).toBe(true)
    expect(isValidJob(job('a', 'ok', true))).toBe(true)
  })
  test('an unknown state string is still valid', () => { expect(isValidJob(job('a', 'brand_new', false))).toBe(true) })
  test('missing or non-boolean attention is invalid', () => {
    expect(isValidJob({ key: 'a', state: 'ok' })).toBe(false)
    expect(isValidJob(job('a', 'ok', null))).toBe(false)
    expect(isValidJob(job('a', 'ok', 'true'))).toBe(false)
    expect(isValidJob(job('a', 'ok', 0))).toBe(false)
  })
  test('missing key or state, or a non-object, is invalid', () => {
    expect(isValidJob({ state: 'ok', attention: false })).toBe(false)
    expect(isValidJob({ key: 'a', attention: false })).toBe(false)
    expect(isValidJob({ key: 1, state: 'ok', attention: false })).toBe(false)
    expect(isValidJob({ key: 'a', state: null, attention: false })).toBe(false)
    expect(isValidJob(null)).toBe(false)
    expect(isValidJob(undefined)).toBe(false)
    expect(isValidJob('x')).toBe(false)
  })
})

describe('ageParts', () => {
  const NOW = Date.parse('2026-11-15T12:00:00Z')
  const ago = ms => new Date(NOW - ms).toISOString()
  const S = 1000, M = 60 * S, H = 60 * M
  test('59 s is just now; 60 s is 1 min', () => {
    expect(ageParts(ago(59 * S), NOW)).toEqual({ key: 'AgoNow' })
    expect(ageParts(ago(60 * S), NOW)).toEqual({ key: 'AgoMin', n: 1 })
  })
  test('59 min is minutes; 60 min is 1 hour', () => {
    expect(ageParts(ago(59 * M), NOW)).toEqual({ key: 'AgoMin', n: 59 })
    expect(ageParts(ago(60 * M), NOW)).toEqual({ key: 'AgoHour', n: 1 })
  })
  test('47 h is hours; 48 h is 2 days', () => {
    expect(ageParts(ago(47 * H), NOW)).toEqual({ key: 'AgoHour', n: 47 })
    expect(ageParts(ago(48 * H), NOW)).toEqual({ key: 'AgoDay', n: 2 })
    expect(ageParts(ago(100 * H), NOW)).toEqual({ key: 'AgoDay', n: 4 })
  })
  test('a future timestamp (clock skew) reads as just now, never negative', () => {
    expect(ageParts(ago(-5 * M), NOW)).toEqual({ key: 'AgoNow' })
  })
  test('garbage, empty and null give null', () => {
    expect(ageParts('not a date', NOW)).toBeNull()
    expect(ageParts('', NOW)).toBeNull()
    expect(ageParts(null, NOW)).toBeNull()
    expect(ageParts(undefined, NOW)).toBeNull()
  })
})

describe('formatFamagusta', () => {
  test('winter instant is UTC+2', () => { expect(formatFamagusta('2026-01-15T12:30:00Z')).toBe('15 Jan, 14:30') })
  test('summer instant is UTC+3', () => { expect(formatFamagusta('2026-07-15T12:30:00Z')).toBe('15 Jul, 15:30') })
  test('the day rolls over in Cyprus time, not UTC', () => { expect(formatFamagusta('2026-01-15T22:30:00Z')).toBe('16 Jan, 00:30') })
  test('garbage, empty and null give null', () => {
    expect(formatFamagusta('nope')).toBeNull(); expect(formatFamagusta('')).toBeNull(); expect(formatFamagusta(null)).toBeNull()
  })
})
