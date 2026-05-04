import { describe, expect, it } from 'vitest'
import { createSeededRandom } from './random.js'

describe('seeded random source', () => {
  it('repeats the same sequence for the same seed', () => {
    const first = createSeededRandom('liberty')
    const second = createSeededRandom('liberty')

    expect(Array.from({ length: 8 }, () => first.next()))
      .toEqual(Array.from({ length: 8 }, () => second.next()))
  })

  it('uses different sequences for different seeds', () => {
    const first = createSeededRandom('liberty')
    const second = createSeededRandom('san-andreas')

    expect(Array.from({ length: 8 }, () => first.next()))
      .not.toEqual(Array.from({ length: 8 }, () => second.next()))
  })

  it('keeps integer values inside the requested range', () => {
    const random = createSeededRandom('bounded')
    const values = Array.from({ length: 100 }, () => random.int(3))

    expect(values.every((value) => Number.isInteger(value) && value >= 0 && value < 3)).toBe(true)
  })
})
