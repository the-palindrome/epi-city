import { describe, expect, it } from 'vitest'
import { compileCityMap, validateCityMap, validateCityTextureBindings } from './city-map.js'

function createMap(overrides = {}) {
  return {
    width: 3,
    height: 3,
    tileSize: 32,
    textureSet: 'test',
    legend: {
      r: { category: 'road', walkable: false, drivable: true, parkable: false },
      s: { category: 'sidewalk', walkable: true, drivable: false, parkable: false },
      b: { category: 'building', walkable: false, drivable: false, parkable: false }
    },
    buildings: {
      encoding: 'row-spans-v1',
      defaultType: 'residential',
      items: [
        { id: 'building-0001', type: 'residential', spans: [[1, 1, 1]] }
      ]
    },
    rows: [
      'sss',
      'sbs',
      'rrr'
    ],
    textureRows: [
      [0, 0, 0],
      [0, 1, 0],
      [2, 2, 2]
    ],
    ...overrides
  }
}

describe('city map validation and compile', () => {
  it('normalizes valid authoring JSON into the runtime city API', () => {
    const map = validateCityMap(createMap())
    const city = compileCityMap(map)

    expect(city.getTile(0, 0)).toBe('sidewalk')
    expect(city.getTileVariant(1, 1)).toMatchObject({
      category: 'building',
      textureId: 1,
      buildingId: 'building-0001',
      buildingType: 'residential'
    })
    expect(city.isWalkable(0, 0)).toBe(true)
    expect(city.isDrivable(0, 2)).toBe(true)
  })

  it('rejects building metadata that does not cover building tiles', () => {
    expect(() => validateCityMap(createMap({
      buildings: {
        encoding: 'row-spans-v1',
        defaultType: 'residential',
        items: []
      }
    }))).toThrow(/do not cover building tile 1,1/)
  })

  it('finds pedestrian paths around blocked cells while reusing path scratch state', () => {
    const city = compileCityMap(validateCityMap(createMap()))

    const first = city.findPath({ x: 0, y: 0 }, { x: 2, y: 1 }, 'pedestrian')
    const second = city.findPath({ x: 2, y: 1 }, { x: 0, y: 0 }, 'pedestrian')

    expect(first.at(0)).toEqual({ x: 0, y: 0 })
    expect(first.at(-1)).toEqual({ x: 2, y: 1 })
    expect(first).not.toContainEqual({ x: 1, y: 1 })
    expect(second.at(0)).toEqual({ x: 2, y: 1 })
    expect(second.at(-1)).toEqual({ x: 0, y: 0 })
  })

  it('validates texture IDs against the loaded texture set', () => {
    const city = compileCityMap(validateCityMap(createMap()))

    expect(() => validateCityTextureBindings(city, {
      name: 'test',
      tileSize: 32,
      frames: [[], [], []]
    })).not.toThrow()

    expect(() => validateCityTextureBindings(city, {
      name: 'test',
      tileSize: 32,
      frames: [[], []]
    })).toThrow(/Texture ID 2/)
  })
})
