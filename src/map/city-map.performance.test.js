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
  const value = fn()

  return {
    value,
    ms: performance.now() - start
  }
}

function recordMeasurement(label, measurement, details = {}) {
  const suffix = Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : ''

  process.stdout.write(`[perf] ${label}: ${measurement.ms.toFixed(3)}ms${suffix}\n`)
}

describe('city map performance', () => {
  it('profiles cached destination index route extraction', () => {
    const city = loadLibertyCity()
    const target = city.buildings.find((building) => building.id === 'building-0007')?.entrance

    expect(target).toBeTruthy()

    city.setCrosswalkSignalState('green')

    const starts = collectLongEntranceRoutes(city, target, 300)

    expect(starts.length).toBeGreaterThan(0)

    const startIndexes = starts.map((start) => city.index(start.x, start.y))
    const targetIndex = city.index(target.x, target.y)

    city.findCachedPathIndexesByIndex(startIndexes[0], targetIndex, 'pedestrian')

    const cached = measure(() => {
      let routeLength = 0

      for (const startIndex of startIndexes) {
        routeLength += city.findCachedPathIndexesByIndex(startIndex, targetIndex, 'pedestrian').length
      }

      return routeLength
    })

    expect(cached.value).toBeGreaterThan(0)
    expect(Number.isFinite(cached.ms)).toBe(true)
    recordMeasurement('cached destination index routes', cached, { routeCount: startIndexes.length })
  }, 30000)

  it('profiles NPC-ready cached index route extraction', () => {
    const city = loadLibertyCity()
    const target = city.buildings.find((building) => building.id === 'building-0008')?.entrance

    expect(target).toBeTruthy()

    city.setCrosswalkSignalState('green')

    const starts = collectLongEntranceRoutes(city, target, 300)

    expect(starts.length).toBeGreaterThan(0)

    const startIndexes = starts.map((start) => city.index(start.x, start.y))
    const targetIndex = city.index(target.x, target.y)

    city.findCachedPathIndexesByIndex(startIndexes[0], targetIndex, 'pedestrian')

    const cachedIndex = measure(() => {
      let routeLength = 0

      for (const startIndex of startIndexes) {
        routeLength += city.findCachedPathIndexesByIndex(startIndex, targetIndex, 'pedestrian').length
      }

      return routeLength
    })

    expect(cachedIndex.value).toBeGreaterThan(0)
    expect(Number.isFinite(cachedIndex.ms)).toBe(true)
    recordMeasurement('NPC-ready cached index routes', cachedIndex, { routeCount: startIndexes.length })
  }, 30000)

  it('profiles route-field handle assignment', () => {
    const city = loadLibertyCity()
    const target = city.buildings.find((building) => building.id === 'building-0009')?.entrance

    expect(target).toBeTruthy()

    city.setCrosswalkSignalState('green')

    const starts = collectLongEntranceRoutes(city, target, 300)

    expect(starts.length).toBeGreaterThan(0)

    const startIndexes = starts.map((start) => city.index(start.x, start.y))
    const targetIndex = city.index(target.x, target.y)
    const field = city.getCachedRouteFieldByIndex(targetIndex, 'pedestrian')

    const fieldHandle = measure(() => {
      let nextHopChecksum = 0

      for (const startIndex of startIndexes) {
        nextHopChecksum += city.getRouteFieldNextIndex(field, startIndex)
      }

      return nextHopChecksum
    })

    expect(fieldHandle.value).toBeGreaterThan(0)
    expect(Number.isFinite(fieldHandle.ms)).toBe(true)
    recordMeasurement('route-field handle assignment', fieldHandle, { routeCount: startIndexes.length })
  }, 30000)
})
