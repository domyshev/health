import { describe, expect, it } from 'vitest'
import { defaultFields } from './activityFields'

describe('default activity fields', () => {
  it.each(['cardio', 'elliptical', 'strength'] as const)('hides distance for %s in both views', (type) => {
    expect(defaultFields(type, 'list')).not.toContain('distanceM')
    expect(defaultFields(type, 'detail')).not.toContain('distanceM')
  })
  it('keeps distance for activities where it is useful', () => {
    expect(defaultFields('cycling', 'list')).toContain('distanceM')
    expect(defaultFields('swimming', 'detail')).toContain('distanceM')
  })
})
