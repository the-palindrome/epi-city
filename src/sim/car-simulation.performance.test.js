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

  fn()

  return performance.now() - start
}

function measureBest(fn, attempts = 5) {
  fn()

  let bestMs = Infinity

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    bestMs = Math.min(bestMs, measure(fn))
  }

  return bestMs
}

function legacyFindCarById(context, carId) {
  for (const car of context.cars) {
    if (car.id === carId) {
      return car
    }
  }

  return null
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
  }, 30000)

  it('looks up precomputed edge footprints at least 10x faster than rebuilding them', () => {
    const city = loadLibertyCity()
    const planner = createCarRoutePlanner(city)
    const network = planner.network
    const edgeIndexes = []

    for (let edgeIndex = 0; edgeIndex < network.edgeCount; edgeIndex += 1) {
      edgeIndexes.push(edgeIndex)
    }

    expect(edgeIndexes.length).toBeGreaterThanOrEqual(10000)

    const lengthTiles = 3
    const repetitions = 10
    let dynamicTotal = 0
    const dynamicMs = measureBest(() => {
      dynamicTotal = 0

      for (let repetition = 0; repetition < repetitions; repetition += 1) {
        for (const edgeIndex of edgeIndexes) {
          dynamicTotal += dynamicDrivingFootprint(city, network, edgeIndex, lengthTiles).length
        }
      }
    })

    const footprints = network.edgeFootprintsByLength.get(lengthTiles)
    let precomputedTotal = 0
    const precomputedMs = measureBest(() => {
      precomputedTotal = 0

      for (let repetition = 0; repetition < repetitions; repetition += 1) {
        for (const edgeIndex of edgeIndexes) {
          precomputedTotal += footprints[edgeIndex].length
        }
      }
    })
    const speedup = dynamicMs / Math.max(precomputedMs, 0.001)

    expect(precomputedTotal).toBe(dynamicTotal)
    expect(speedup).toBeGreaterThanOrEqual(10)
  }, 30000)

  it('looks up cars by dense id at least 10x faster than scanning all cars', () => {
    const cars = Array.from({ length: 5000 }, (_, id) => ({ id }))
    const context = { cars, carsById: cars }
    const lookupIds = new Int32Array(20000)

    for (let index = 0; index < lookupIds.length; index += 1) {
      lookupIds[index] = (index * 997) % cars.length
    }

    let legacyChecksum = 0
    const legacyMs = measureBest(() => {
      legacyChecksum = 0

      for (let repetition = 0; repetition < 20; repetition += 1) {
        for (const carId of lookupIds) {
          legacyChecksum += legacyFindCarById(context, carId)?.id ?? -1
        }
      }
    })

    let indexedChecksum = 0
    const indexedMs = measureBest(() => {
      indexedChecksum = 0

      for (let repetition = 0; repetition < 20; repetition += 1) {
        for (const carId of lookupIds) {
          indexedChecksum += __test__findCarById(context, carId)?.id ?? -1
        }
      }
    })
    const speedup = legacyMs / Math.max(indexedMs, 0.001)

    expect(indexedChecksum).toBe(legacyChecksum)
    expect(speedup).toBeGreaterThanOrEqual(10)
  }, 30000)
})

function dynamicDrivingFootprint(city, network, edgeIndex, lengthTiles) {
  const edge = network.edges[edgeIndex]
  const nodeIndex = network.edgeTo[edgeIndex]
  const node = network.laneGraph.nodes[nodeIndex]
  const offset = directionOffset(edge.direction)
  const tiles = []

  for (let index = 0; index < lengthTiles; index += 1) {
    const x = node.tile.x - offset.dx * index
    const y = node.tile.y - offset.dy * index

    if (x < 0 || y < 0 || x >= city.width || y >= city.height) {
      break
    }

    const tileIndex = city.index(x, y)

    if (city.tileDrivable[tileIndex] !== 1 && city.tileCrosswalk[tileIndex] !== 1 && network.tileToNodeIndex[tileIndex] === -1) {
      break
    }

    tiles.push(tileIndex)
  }

  return tiles.length > 0 ? tiles : [network.nodeTileIndexes[nodeIndex]]
}

function directionOffset(direction) {
  if (direction === 'east') {
    return { dx: 1, dy: 0 }
  }

  if (direction === 'west') {
    return { dx: -1, dy: 0 }
  }

  if (direction === 'south') {
    return { dx: 0, dy: 1 }
  }

  if (direction === 'north') {
    return { dx: 0, dy: -1 }
  }

  return { dx: 0, dy: 0 }
}
