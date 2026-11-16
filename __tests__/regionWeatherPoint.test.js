// constants/regions.js REGION_WEATHER_POINT: one weather point per region, each inside its own region.
import { REGIONS, REGION_WEATHER_POINT, weatherPointFor } from '../constants/regions'
import { resolveRegion } from '../utils/resolveRegion'

describe('REGION_WEATHER_POINT', () => {
  test('every REGIONS slug has a point', () => {
    const missing = REGIONS.filter(slug => !(slug in REGION_WEATHER_POINT))
    expect(missing).toEqual([])
  })

  test('no point for a slug outside REGIONS', () => {
    const extra = Object.keys(REGION_WEATHER_POINT).filter(slug => !REGIONS.includes(slug))
    expect(extra).toEqual([])
  })

  test.each(REGIONS)('%s point resolves to itself', slug => {
    const p = REGION_WEATHER_POINT[slug]
    expect(p).toBeDefined()
    expect(resolveRegion(p.latitude, p.longitude)).toBe(slug)
  })

  test('non-region home reads the nicosia point', () => {
    expect(weatherPointFor('visiting')).toBe(REGION_WEATHER_POINT.nicosia)
    expect(weatherPointFor(null)).toBe(REGION_WEATHER_POINT.nicosia)
    expect(weatherPointFor('kyrenia')).toBe(REGION_WEATHER_POINT.kyrenia)
  })
})
