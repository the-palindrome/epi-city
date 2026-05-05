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
  it('extracts repeated destination index routes at least 10x faster from cached route fields', () => {
    const city = loadLibertyCity()
    const target = city.buildings.find((building) => building.id === 'building-0007')?.entrance

    expect(target).toBeTruthy()

    city.setCrosswalkSignalState('green')

    const starts = collectLongEntranceRoutes(city, target, 300)

    expect(starts.length).toBeGreaterThanOrEqual(256)

    const uncachedMs = measure(() => {
      for (const start of starts) {
        expect(city.findPath(start, target, 'pedestrian').length).toBeGreaterThan(0)
      }
    })

    const startIndexes = starts.map((start) => city.index(start.x, start.y))
    const targetIndex = city.index(target.x, target.y)

    city.findCachedPathIndexesByIndex(startIndexes[0], targetIndex, 'pedestrian')

    const cachedMs = measure(() => {
      for (const startIndex of startIndexes) {
        expect(city.findCachedPathIndexesByIndex(startIndex, targetIndex, 'pedestrian').length).toBeGreaterThan(0)
      }
    })
    const speedup = uncachedMs / Math.max(cachedMs, 0.001)

    expect(speedup).toBeGreaterThanOrEqual(10)
  }, 30000)

  it('extracts NPC-ready index routes at least 10x faster than uncached routes', () => {
    const city = loadLibertyCity()
    const target = city.buildings.find((building) => building.id === 'building-0007')?.entrance

    expect(target).toBeTruthy()

    city.setCrosswalkSignalState('green')

    const starts = collectLongEntranceRoutes(city, target, 300)

    expect(starts.length).toBeGreaterThanOrEqual(256)

    const uncachedMs = measure(() => {
      for (const start of starts) {
        expect(city.findPath(start, target, 'pedestrian').length).toBeGreaterThan(0)
      }
    })

    const startIndexes = starts.map((start) => city.index(start.x, start.y))
    const targetIndex = city.index(target.x, target.y)

    city.findCachedPathIndexesByIndex(startIndexes[0], targetIndex, 'pedestrian')

    const cachedIndexMs = measure(() => {
      for (const startIndex of startIndexes) {
        expect(city.findCachedPathIndexesByIndex(startIndex, targetIndex, 'pedestrian').length).toBeGreaterThan(0)
      }
    })
    const speedup = uncachedMs / Math.max(cachedIndexMs, 0.001)

    expect(speedup).toBeGreaterThanOrEqual(10)
  }, 30000)
})
