import fs from 'node:fs'
import { performance } from 'node:perf_hooks'
import { describe, expect, it, vi } from 'vitest'
import { compileCityMap, validateCityMap } from '../map/city-map.js'
import { createCarRoutePlanner } from './car-simulation.js'

vi.mock('pixi.js', () => ({
  Graphics: class {}
}))

function loadLibertyCity() {
  const tileLayout = JSON.parse(fs.readFileSync('public/maps/liberty-city/tile-layout.json', 'utf8'))
  const textureLayout = JSON.parse(fs.readFileSync('public/maps/liberty-city/texture-layout.json', 'utf8'))

  return compileCityMap(validateCityMap({
    ...tileLayout,
    textureSet: textureLayout.textureSet || tileLayout.textureSet,
    textureRows: textureLayout.textureRows
  }))
}

function collectReachableStarts(planner, count) {
  const network = planner.network
  const destinationStep = Math.max(1, Math.floor(network.nodeCount / 16))
  const scanStep = Math.max(1, Math.floor(network.nodeCount / (count * 8)))

  for (let destination = Math.floor(destinationStep / 2); destination < network.nodeCount; destination += destinationStep) {
    const starts = []

    planner.clearRouteCache()

    for (let nodeIndex = 0; nodeIndex < network.nodeCount && starts.length < count; nodeIndex += scanStep) {
      if (nodeIndex === destination) {
        continue
      }

      if (planner.findRoute(nodeIndex, destination).length >= 12) {
        starts.push(nodeIndex)
      }
    }

    if (starts.length >= count) {
      planner.clearRouteCache()
      return { destination, starts }
    }
  }

  return { destination: -1, starts: [] }
}

function measure(fn) {
  const start = performance.now()

  fn()

  return performance.now() - start
}

describe('car simulation performance', () => {
  it('extracts repeated destination lane routes at least 10x faster from cached route data', () => {
    const city = loadLibertyCity()
    const planner = createCarRoutePlanner(city)
    const { destination, starts } = collectReachableStarts(planner, 120)

    expect(destination).toBeGreaterThanOrEqual(0)
    expect(starts.length).toBeGreaterThanOrEqual(120)

    let uncachedRouteLength = 0
    const uncachedMs = measure(() => {
      for (const start of starts) {
        planner.clearRouteCache()
        uncachedRouteLength += planner.findRoute(start, destination).length
      }
    })

    planner.clearRouteCache()

    for (const start of starts) {
      expect(planner.findRoute(start, destination).length).toBeGreaterThan(0)
    }

    let cachedRouteLength = 0
    const cachedMs = measure(() => {
      for (const start of starts) {
        cachedRouteLength += planner.findRoute(start, destination).length
      }
    })
    const speedup = uncachedMs / Math.max(cachedMs, 0.001)

    expect(uncachedRouteLength).toBeGreaterThan(0)
    expect(cachedRouteLength).toBe(uncachedRouteLength)
    expect(speedup).toBeGreaterThanOrEqual(10)
  })
})
