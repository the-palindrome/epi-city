import fs from 'node:fs'
import { performance } from 'node:perf_hooks'
import { describe, expect, it, vi } from 'vitest'
import { NPC_CONFIG } from '../core/constants.js'
import { createSeededRandom } from '../core/random.js'
import { buildingHasAnyType } from '../map/buildings.js'
import { compileCityMap, validateCityMap } from '../map/city-map.js'
import { createNpcSimulation } from './npc-simulation.js'

vi.mock('pixi.js', () => ({
  Graphics: class {
    constructor() {
      this.eventMode = 'auto'
      this.parent = null
      this.zIndex = 0
      this.zorder = 0
    }

    clear() {
      return this
    }

    rect() {
      return {
        fill() {}
      }
    }

    destroy() {}
  }
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

function createActorLayer() {
  return {
    eventMode: 'auto',
    children: [],
    addChild(child) {
      this.children.push(child)
      child.parent = this
    },
    removeChild(child) {
      this.children = this.children.filter((item) => item !== child)
      child.parent = null
    }
  }
}

function createClock(hour) {
  return {
    hour,
    secondsPerSimulationHour: 60,
    getTimeOfDayHours() {
      return this.hour
    }
  }
}

function createMeasuredNpcSimulation(city, count, hour = 18) {
  return createConfiguredNpcSimulation(city, count, hour)
}

function createConfiguredNpcSimulation(city, count, hour = 18, overrides = {}) {
  return createNpcSimulation(city, createActorLayer(), {
    count,
    zorder: 1,
    tileCapacity: NPC_CONFIG.tileCapacity,
    maxVisiblePerTile: NPC_CONFIG.maxVisiblePerTile,
    slotSpacing: NPC_CONFIG.slotSpacing,
    color: NPC_CONFIG.color,
    size: NPC_CONFIG.size,
    minSpeed: 34,
    maxSpeed: 58,
    workStartHour: 9,
    workEndHour: 17,
    scheduleVariationHours: 0,
    shoppingChance: 0,
    nightclubChance: 0,
    routePlanBudget: 256,
    routeRetrySeconds: 1,
    routeBlockedReplanSeconds: 2,
    initialInfectiousCount: 0,
    infectionDistance: 48,
    infectionProbability: 0,
    incubationDays: 5,
    infectionDays: 7,
    immunityDays: 90,
    clock: createClock(hour),
    random: createSeededRandom(`npc-performance-${count}-${hour}`),
    ...overrides
  })
}

function buildingsWithAnyType(city, types) {
  return city.buildings.filter((building) => building.entrance && buildingHasAnyType(building, types))
}

function prepareLowHungerCandidates(simulation, count) {
  const candidates = []

  for (const npc of simulation.npcs) {
    const activeElement = npc.getActiveTimetableElement(18)

    if (npc.age < 6 || activeElement?.id !== 'home') {
      continue
    }

    npc.desires.hunger = 5
    npc.desires.energy = 90
    npc.desires.fun = 90
    npc.desires.social = 90
    npc.activeDesire = null
    candidates.push(npc)

    if (candidates.length >= count) {
      break
    }
  }

  return candidates
}

function prepareLowSocialCandidates(simulation, count) {
  const candidates = []

  for (const npc of simulation.npcs) {
    const activeElement = npc.getActiveTimetableElement(21)

    if (npc.age < 18 || activeElement?.id !== 'home') {
      continue
    }

    npc.desires.hunger = 90
    npc.desires.energy = 90
    npc.desires.fun = 90
    npc.desires.social = 5
    npc.activeDesire = null
    candidates.push(npc)

    if (candidates.length >= count) {
      break
    }
  }

  return candidates
}

function legacyNearestBuilding(buildings, originBuilding, candidateCount) {
  if (!buildings || buildings.length === 0) {
    return null
  }

  if (!originBuilding?.entrance) {
    return buildings[0]
  }

  const nearby = buildings
    .map((building) => ({
      building,
      distance: squaredEntranceDistance(originBuilding, building)
    }))
    .sort((a, b) => a.distance - b.distance || String(a.building.id).localeCompare(String(b.building.id)))

  return nearby[Math.min(candidateCount, nearby.length) - 1]?.building || null
}

function legacyLowHungerDestination(npc, buildingsById, restaurants, supermarkets) {
  const home = buildingsById.get(npc.home) || null
  const origin = buildingsById.get(npc.locationState?.buildingId) || home
  const building = legacyNearestBuilding(restaurants, origin, 4) ||
    legacyNearestBuilding(supermarkets, origin, 4) ||
    home

  return building
    ? {
        id: 'desire:hunger',
        buildingId: building.id,
        location: {
          x: building.entrance.x,
          y: building.entrance.y
        }
      }
    : null
}

function legacyLowSocialDestination(npc, buildingsById, nightclubs, malls) {
  const home = buildingsById.get(npc.home) || null
  const origin = buildingsById.get(npc.locationState?.buildingId) || home
  const building = legacyNearestTypedBuilding(nightclubs, origin, ['nightclub'], 4) ||
    legacyNearestTypedBuilding(malls, origin, ['mall'], 4) ||
    home

  return building
    ? {
        id: 'desire:social',
        buildingId: building.id,
        location: {
          x: building.entrance.x,
          y: building.entrance.y
        }
      }
    : null
}

function legacyNearestTypedBuilding(buildings, originBuilding, types, candidateCount) {
  if (!buildings || buildings.length === 0) {
    return null
  }

  const nearby = []

  for (const building of buildings) {
    if (!building.entrance || !buildingHasAnyType(building, types)) {
      continue
    }

    nearby.push({
      building,
      distance: squaredEntranceDistance(originBuilding, building)
    })
  }

  nearby.sort((a, b) => a.distance - b.distance || String(a.building.id).localeCompare(String(b.building.id)))

  return nearby[Math.min(candidateCount, nearby.length) - 1]?.building || null
}

function legacyActiveDestinationElement(npc, needs, buildingsById, restaurants, supermarkets) {
  const scheduledElement = npc.getActiveTimetableElement(18)

  if (!scheduledElement || scheduledElement.id !== 'home' || npc.age < 6) {
    return scheduledElement
  }

  let selected = null

  for (const need of ['hunger', 'energy', 'fun', 'social']) {
    const score = needs[need]

    if (score >= 35) {
      continue
    }

    if (need === 'hunger') {
      const element = legacyLowHungerDestination(npc, buildingsById, restaurants, supermarkets)

      if (element && (!selected || score < selected.score)) {
        selected = { score, element }
      }
    }
  }

  return selected?.element || scheduledElement
}

function legacySocialDestinationElement(npc, buildingsById, nightclubs, malls) {
  const scheduledElement = npc.getActiveTimetableElement(21)

  if (!scheduledElement || scheduledElement.id !== 'home' || npc.age < 18) {
    return scheduledElement
  }

  return legacyLowSocialDestination(npc, buildingsById, nightclubs, malls) || scheduledElement
}

function squaredEntranceDistance(first, second) {
  if (!first?.entrance || !second?.entrance) {
    return Infinity
  }

  const dx = first.entrance.x - second.entrance.x
  const dy = first.entrance.y - second.entrance.y

  return dx * dx + dy * dy
}

function runUpdates(simulation, frames) {
  let checksum = 0

  for (let frame = 0; frame < frames; frame += 1) {
    simulation.update(1 / 60)
  }

  for (let index = 0; index < simulation.npcs.length; index += 128) {
    const npc = simulation.npcs[index]

    checksum += npc.tile.index + Math.round(npc.desires.hunger)
  }

  return checksum
}

describe('NPC simulation performance', () => {
  it('generates family-heavy NPC social profiles with near-linear creation cost', () => {
    const city = loadLibertyCity()
    const familyOptions = {
      familyTypeWeights: {
        single: 0,
        marriedWithoutChildren: 0,
        marriedWithChildren: 1
      },
      familyChildCountWeights: [
        { count: 2, weight: 1 }
      ]
    }

    const createFamilySimulation = (count) => {
      const simulation = createConfiguredNpcSimulation(city, count, 18, familyOptions)
      const friendEdgeTotal = simulation.npcs.reduce((total, npc) => total + npc.friendIds.length, 0)
      const checksum = simulation.npcs.reduce((total, npc) => total + npc.age + String(npc.home || '').length + npc.friendIds.length, 0)

      expect(simulation.npcs.length).toBe(count)
      expect(simulation.npcs.filter((npc) => npc.age < 18).length).toBe(count / 2)
      expect(friendEdgeTotal).toBeGreaterThan(count)

      simulation.destroy()

      return checksum
    }

    const small = measureBest(() => createFamilySimulation(1000), 3)
    const large = measureBest(() => createFamilySimulation(4000), 3)
    const smallPerNpc = small.ms / 1000
    const largePerNpc = large.ms / 4000

    expect(small.value).toBeGreaterThan(0)
    expect(large.value).toBeGreaterThan(small.value)
    expect(largePerNpc).toBeLessThanOrEqual(smallPerNpc * 3)
  }, 30000)

  it('assigns NPC route-field handles at least 10x faster than per-NPC path object arrays', () => {
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
          const routeState = {
            cursor: 0,
            path: Array.from(path, (tileIndex) => ({ tileIndex }))
          }
          const npcRoute = routeState.path

          for (let index = 0; index < npcRoute.length; index += 1) {
            arrayRouteTotal += npcRoute[index].tileIndex
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

  it('selects low-desire destinations at least 10x faster with precomputed venue candidates', () => {
    const city = loadLibertyCity()
    const simulation = createMeasuredNpcSimulation(city, 5000, 18)
    const candidates = prepareLowHungerCandidates(simulation, 2500)
    const buildingsById = new Map(city.buildings.map((building) => [building.id, building]))
    const restaurants = buildingsWithAnyType(city, ['restaurant'])
    const supermarkets = buildingsWithAnyType(city, ['supermarket'])
    const legacyNeeds = new Map(candidates.map((npc) => [npc.id, {
      hunger: 5,
      energy: 90,
      fun: 90,
      social: 90
    }]))
    const repetitions = 12

    expect(candidates.length).toBeGreaterThanOrEqual(2000)
    expect(restaurants.length).toBeGreaterThan(0)

    const legacy = measureBest(() => {
      let checksum = 0

      for (let repetition = 0; repetition < repetitions; repetition += 1) {
        for (const npc of candidates) {
          const destination = legacyActiveDestinationElement(
            npc,
            legacyNeeds.get(npc.id),
            buildingsById,
            restaurants,
            supermarkets
          )

          checksum += destination?.location?.x || 0
        }
      }

      return checksum
    }, 4)
    const optimized = measureBest(() => {
      let checksum = 0

      for (let repetition = 0; repetition < repetitions; repetition += 1) {
        for (const npc of candidates) {
          npc.activeDesire = null
          const destination = npc.getActiveDestinationElement(18)

          checksum += destination?.location?.x || 0
        }
      }

      return checksum
    }, 4)
    const speedup = legacy.ms / Math.max(optimized.ms, 0.001)

    expect(legacy.value).toBeGreaterThan(0)
    expect(optimized.value).toBeGreaterThan(0)
    expect(speedup).toBeGreaterThanOrEqual(10)

    simulation.destroy()
  }, 30000)

  it('coordinates low-social desire destinations at least 10x faster with precomputed venue candidates', () => {
    const city = loadLibertyCity()
    const simulation = createConfiguredNpcSimulation(city, 5000, 21, {
      familyTypeWeights: {
        single: 1,
        marriedWithoutChildren: 0,
        marriedWithChildren: 0
      }
    })
    const candidates = prepareLowSocialCandidates(simulation, 2500)
    const buildingsById = new Map(city.buildings.map((building) => [building.id, building]))
    const allBuildings = city.buildings
    const nightclubs = buildingsWithAnyType(city, ['nightclub'])
    const malls = buildingsWithAnyType(city, ['mall'])
    const repetitions = 12

    expect(candidates.length).toBeGreaterThanOrEqual(2000)
    expect(nightclubs.length + malls.length).toBeGreaterThan(0)

    const legacy = measureBest(() => {
      let checksum = 0

      for (let repetition = 0; repetition < repetitions; repetition += 1) {
        for (const npc of candidates) {
          const destination = legacySocialDestinationElement(npc, buildingsById, allBuildings, allBuildings)

          checksum += destination?.location?.x || 0
        }
      }

      return checksum
    }, 4)
    const optimized = measureBest(() => {
      let checksum = 0

      for (let repetition = 0; repetition < repetitions; repetition += 1) {
        for (const npc of candidates) {
          npc.activeDesire = null
          const destination = npc.getActiveDestinationElement(21)

          checksum += destination?.location?.x || 0
        }
      }

      return checksum
    }, 4)
    const speedup = legacy.ms / Math.max(optimized.ms, 0.001)

    expect(legacy.value).toBeGreaterThan(0)
    expect(optimized.value).toBeGreaterThan(0)
    expect(speedup).toBeGreaterThanOrEqual(10)

    simulation.destroy()
  }, 30000)

  it('keeps steady-state NPC update cost close to linear as population grows', () => {
    const city = loadLibertyCity()
    const small = createMeasuredNpcSimulation(city, 1000, 18)
    const large = createMeasuredNpcSimulation(city, 4000, 18)

    runUpdates(small, 20)
    runUpdates(large, 20)

    const smallResult = measureBest(() => runUpdates(small, 90), 3)
    const largeResult = measureBest(() => runUpdates(large, 90), 3)
    const smallPerNpc = smallResult.ms / small.npcs.length
    const largePerNpc = largeResult.ms / large.npcs.length

    expect(smallResult.value).toBeGreaterThan(0)
    expect(largeResult.value).toBeGreaterThan(0)
    expect(large.npcs.length).toBeGreaterThanOrEqual(4000)
    expect(largePerNpc).toBeLessThanOrEqual(smallPerNpc * 2.5)

    small.destroy()
    large.destroy()
  }, 30000)
})
