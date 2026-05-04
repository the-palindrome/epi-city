import fs from 'node:fs'
import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { compileCityMap, validateCityMap } from './city-map.js'

function loadLibertyCity() {
  const tileLayout = JSON.parse(fs.readFileSync('public/maps/liberty-city/tile-layout.json', 'utf8'))
  const textureLayout = JSON.parse(fs.readFileSync('public/maps/liberty-city/texture-layout.json', 'utf8'))

  return compileCityMap(validateCityMap({
    ...tileLayout,
    textureSet: textureLayout.textureSet || tileLayout.textureSet,
    textureRows: textureLayout.textureRows
  }))
}

function collectLongEntranceRoutes(city, target, count) {
  const starts = []

  for (const building of city.buildings) {
    if (!building.entrance || (building.entrance.x === target.x && building.entrance.y === target.y)) {
      continue
    }

    const path = city.findPath(building.entrance, target, 'pedestrian')

    if (path.length >= 120) {
      starts.push(building.entrance)
    }

    if (starts.length >= count) {
      break
    }
  }

  return starts
}

function measure(fn) {
  const start = performance.now()

  fn()

  return performance.now() - start
}

describe('city map performance', () => {
  it('extracts repeated destination routes at least 10x faster from cached route fields', () => {
    const city = loadLibertyCity()
    const target = city.buildings.find((building) => building.id === 'building-0007')?.entrance

    expect(target).toBeTruthy()

    city.setCrosswalkSignalState('green')

    const starts = collectLongEntranceRoutes(city, target, 80)

    expect(starts.length).toBeGreaterThanOrEqual(64)

    const uncachedMs = measure(() => {
      for (const start of starts) {
        expect(city.findPath(start, target, 'pedestrian').length).toBeGreaterThan(0)
      }
    })

    city.findCachedPath(starts[0], target, 'pedestrian')

    const cachedMs = measure(() => {
      for (const start of starts) {
        expect(city.findCachedPath(start, target, 'pedestrian').length).toBeGreaterThan(0)
      }
    })
    const speedup = uncachedMs / Math.max(cachedMs, 0.001)

    expect(speedup).toBeGreaterThanOrEqual(10)
  })

  it('extracts NPC-ready index routes with route variation at least 10x faster than uncached routes', () => {
    const city = loadLibertyCity()
    const target = city.buildings.find((building) => building.id === 'building-0007')?.entrance

    expect(target).toBeTruthy()

    city.setCrosswalkSignalState('green')

    const starts = collectLongEntranceRoutes(city, target, 300)

    expect(starts.length).toBeGreaterThanOrEqual(256)

    const routeOptions = {
      variation: {
        random: {
          next: () => 1,
          int: () => 0
        },
        chance: 1,
        slack: 20
      }
    }

    const uncachedMs = measure(() => {
      for (const start of starts) {
        expect(city.findPath(start, target, 'pedestrian').length).toBeGreaterThan(0)
      }
    })

    city.findCachedPathIndexes(starts[0], target, 'pedestrian', routeOptions)

    const cachedIndexMs = measure(() => {
      for (const start of starts) {
        expect(city.findCachedPathIndexes(start, target, 'pedestrian', routeOptions).length).toBeGreaterThan(0)
      }
    })
    const speedup = uncachedMs / Math.max(cachedIndexMs, 0.001)

    expect(speedup).toBeGreaterThanOrEqual(10)
  })
})
