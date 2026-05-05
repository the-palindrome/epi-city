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

  fn()

  return performance.now() - start
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
    let arrayRouteTotal = 0
    let fieldRouteTotal = 0

    const pathArrayMs = measure(() => {
      for (const startIndex of startIndexes) {
        arrayRouteTotal += city.findCachedPathIndexesByIndex(startIndex, targetIndex, 'pedestrian').length
      }
    })

    const fieldHandleMs = measure(() => {
      for (const startIndex of startIndexes) {
        fieldRouteTotal += city.getRouteFieldNextIndex(field, startIndex)
      }
    })

    expect(arrayRouteTotal).toBeGreaterThan(0)
    expect(fieldRouteTotal).toBeGreaterThan(0)
    expect(pathArrayMs / Math.max(fieldHandleMs, 0.001)).toBeGreaterThanOrEqual(10)
  }, 30000)
})
