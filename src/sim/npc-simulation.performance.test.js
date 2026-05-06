import fs from 'node:fs'
import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { compileCityMap, validateCityMap } from '../map/city-map.js'

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

function measureBest(fn, attempts = 5) {
  fn()

  let best = { value: null, ms: Infinity }

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = measure(fn)

    if (result.ms < best.ms) {
      best = result
    }
  }

  return best
}

describe('NPC simulation performance', () => {
  it('assigns NPC route-field handles at least 10x faster than per-NPC path arrays', () => {
    const city = loadLibertyCity()
    const target = city.buildings.find((building) => building.id === 'building-0010')?.entrance

    expect(target).toBeTruthy()

    city.setCrosswalkSignalState('green')

    const starts = collectLongEntranceRoutes(city, target, 300)

    expect(starts.length).toBeGreaterThanOrEqual(256)

    const startIndexes = starts.map((start) => city.index(start.x, start.y))
    const targetIndex = city.index(target.x, target.y)
    const field = city.getCachedRouteFieldByIndex(targetIndex, 'pedestrian')
    const repetitions = 10

    const pathArray = measureBest(() => {
      let arrayRouteTotal = 0

      for (let repetition = 0; repetition < repetitions; repetition += 1) {
        for (const startIndex of startIndexes) {
          const path = city.findCachedPathIndexesByIndex(startIndex, targetIndex, 'pedestrian')
          const npcRoute = Array.from(path)

          for (let index = 0; index < npcRoute.length; index += 1) {
            arrayRouteTotal += npcRoute[index]
          }
        }
      }

      return arrayRouteTotal
    })

    const fieldHandle = measureBest(() => {
      let fieldRouteTotal = 0

      for (let repetition = 0; repetition < repetitions; repetition += 1) {
        for (const startIndex of startIndexes) {
          fieldRouteTotal += city.getRouteFieldNextIndex(field, startIndex)
        }
      }

      return fieldRouteTotal
    })

    expect(pathArray.value).toBeGreaterThan(0)
    expect(fieldHandle.value).toBeGreaterThan(0)
    expect(pathArray.ms / Math.max(fieldHandle.ms, 0.001)).toBeGreaterThanOrEqual(10)
  }, 30000)
})
