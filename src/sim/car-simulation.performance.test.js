import fs from 'node:fs'
import { performance } from 'node:perf_hooks'
import { describe, expect, it, vi } from 'vitest'
import { compileCityMap, validateCityMap } from '../map/city-map.js'
import { __test__findCarById, createCarRoutePlanner } from './car-simulation.js'

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

function recordMeasurement(label, measurement, details = {}) {
  const suffix = Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : ''

  process.stdout.write(`[perf] ${label}: ${measurement.ms.toFixed(3)}ms${suffix}\n`)
}

describe('car simulation performance', () => {
  it('profiles cached destination lane route extraction', () => {
    const city = loadLibertyCity()
    const planner = createCarRoutePlanner(city)
    const { destination, starts } = collectReachableStarts(planner, 120)

    expect(destination).not.toBe(-1)
    expect(starts.length).toBeGreaterThan(0)

    planner.clearRouteCache()

    for (const start of starts) {
      expect(planner.findRoute(start, destination).length).toBeGreaterThan(0)
    }

    const cached = measureBest(() => {
      let cachedRouteLength = 0

      for (const start of starts) {
        cachedRouteLength += planner.findRoute(start, destination).length
      }

      return cachedRouteLength
    })

    expect(cached.value).toBeGreaterThan(0)
    expect(Number.isFinite(cached.ms)).toBe(true)
    recordMeasurement('cached destination lane routes', cached, { routeCount: starts.length })
  }, 30000)

  it('profiles precomputed edge footprint lookup', () => {
    const city = loadLibertyCity()
    const planner = createCarRoutePlanner(city)
    const network = planner.network
    const edgeIndexes = []

    for (let edgeIndex = 0; edgeIndex < network.edgeCount; edgeIndex += 1) {
      edgeIndexes.push(edgeIndex)
    }

    expect(edgeIndexes.length).toBeGreaterThan(0)

    const lengthTiles = 3
    const repetitions = 10
    const footprints = network.edgeFootprintsByLength.get(lengthTiles)

    const precomputedMs = measureBest(() => {
      let precomputedTotal = 0

      for (let repetition = 0; repetition < repetitions; repetition += 1) {
        for (const edgeIndex of edgeIndexes) {
          precomputedTotal += footprints[edgeIndex].length
        }
      }

      return precomputedTotal
    })

    expect(precomputedMs.value).toBeGreaterThan(0)
    expect(Number.isFinite(precomputedMs.ms)).toBe(true)
    recordMeasurement('precomputed edge footprint lookup', precomputedMs, {
      edgeCount: edgeIndexes.length,
      repetitions
    })
  }, 30000)

  it('profiles dense car id lookup', () => {
    const cars = Array.from({ length: 5000 }, (_, id) => ({ id }))
    const context = { cars, carsById: cars }
    const lookupIds = new Int32Array(20000)

    for (let index = 0; index < lookupIds.length; index += 1) {
      lookupIds[index] = (index * 997) % cars.length
    }

    const indexedMs = measureBest(() => {
      let indexedChecksum = 0

      for (let repetition = 0; repetition < 20; repetition += 1) {
        for (const carId of lookupIds) {
          indexedChecksum += __test__findCarById(context, carId)?.id ?? -1
        }
      }

      return indexedChecksum
    })

    expect(indexedMs.value).toBeGreaterThan(0)
    expect(Number.isFinite(indexedMs.ms)).toBe(true)
    recordMeasurement('dense car id lookup', indexedMs, { lookupCount: lookupIds.length })
  }, 30000)
})
