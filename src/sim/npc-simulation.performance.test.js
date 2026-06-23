import fs from 'node:fs'
import { performance } from 'node:perf_hooks'
import { describe, expect, it, vi } from 'vitest'
import { NPC_CONFIG } from '../core/constants.js'
import { createSeededRandom } from '../core/random.js'
import { compileCityMap, validateCityMap } from '../map/city-map.js'
import { createNpcCrowdingState, createNpcSimulation, updateNpcCrowdingState } from './npc-simulation.js'

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
    visualSlotCount: NPC_CONFIG.visualSlotCount,
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

function optimizedSharedLocationGroupingChecksum(simulation, repetitions) {
  let checksum = 0

  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    simulation.infection.sharedLocationGroupsAt = NaN
    simulation.infection.elapsedSimulationSeconds += 1

    for (const group of simulation.infection.getSharedLocationGroups()) {
      checksum += group.length
    }
  }

  return checksum
}

function optimizedSharedLocationTransmissionChecksum(simulation, probability, repetitions) {
  let checksum = 0

  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    simulation.infection.transmitSharedLocations(probability)
    checksum += simulation.infection.counts[0]
  }

  return checksum
}

function createCrowdingFixture(count, tileCount = 256 * 256, visualSlotCount = NPC_CONFIG.visualSlotCount) {
  const city = {
    tiles: new Uint8Array(tileCount)
  }
  const npcs = new Array(count)

  for (let index = 0; index < count; index += 1) {
    const tileIndex = (index * 37) % tileCount
    const targetIndex = (tileIndex + 257) % tileCount

    npcs[index] = {
      present: true,
      tile: { index: tileIndex },
      slot: { id: index % visualSlotCount },
      movement: index % 2 === 0
        ? {
            target: {
              tile: { index: targetIndex },
              slot: { id: (index + 3) % visualSlotCount }
            }
          }
        : { target: null }
    }
  }

  return {
    city,
    npcs,
    config: {
      visualSlotCount,
      crowding: NPC_CONFIG.crowding
    }
  }
}

function crowdingChecksum(crowding, npcs) {
  let checksum = 0

  for (const npc of npcs) {
    checksum += crowdingCount(crowding, 'tile', npc.tile.index)
    checksum += crowdingCount(crowding, 'slot', npc.tile.index * crowding.visualSlotCount + npc.slot.id)

    if (npc.movement.target) {
      checksum += crowdingCount(crowding, 'incoming', npc.movement.target.tile.index)
      checksum += crowdingCount(crowding, 'slot', npc.movement.target.tile.index * crowding.visualSlotCount + npc.movement.target.slot.id)
    }
  }

  return checksum
}

function crowdingCount(crowding, type, index) {
  if (type === 'slot') {
    return crowding.slotStamps && !crowding.dense
      ? (crowding.slotStamps[index] === crowding.stamp ? crowding.slotCounts[index] : 0)
      : crowding.slotCounts[index]
  }

  if (type === 'incoming') {
    return crowding.incomingTileStamps && !crowding.dense
      ? (crowding.incomingTileStamps[index] === crowding.stamp ? crowding.incomingTileCounts[index] : 0)
      : crowding.incomingTileCounts[index]
  }

  return crowding.tileStamps && !crowding.dense
    ? (crowding.tileStamps[index] === crowding.stamp ? crowding.tileCounts[index] : 0)
    : crowding.tileCounts[index]
}

function recordMeasurement(label, measurement, details = {}) {
  const suffix = Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : ''

  process.stdout.write(`[perf] ${label}: ${measurement.ms.toFixed(3)}ms${suffix}\n`)
}

describe('NPC simulation performance', () => {
  it('profiles family-heavy NPC social profile creation', () => {
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
    expect(Number.isFinite(small.ms)).toBe(true)
    expect(Number.isFinite(large.ms)).toBe(true)
    recordMeasurement('family-heavy NPC creation small', small, { npcCount: 1000, msPerNpc: smallPerNpc })
    recordMeasurement('family-heavy NPC creation large', large, { npcCount: 4000, msPerNpc: largePerNpc })
  }, 30000)

  it('profiles NPC route-field handle assignment', () => {
    const city = loadLibertyCity()
    const target = city.buildings.find((building) => building.id === 'building-0010')?.entrance

    expect(target).toBeTruthy()

    city.setCrosswalkSignalState('green')

    const starts = collectLongEntranceRoutes(city, target, 300)

    expect(starts.length).toBeGreaterThan(0)

    const startIndexes = starts.map((start) => city.index(start.x, start.y))
    const targetIndex = city.index(target.x, target.y)
    const field = city.getCachedRouteFieldByIndex(targetIndex, 'pedestrian')
    const repetitions = 10

    const fieldHandle = measureBest(() => {
      let fieldRouteTotal = 0

      for (let repetition = 0; repetition < repetitions; repetition += 1) {
        for (const startIndex of startIndexes) {
          fieldRouteTotal += city.getRouteFieldNextIndex(field, startIndex)
        }
      }

      return fieldRouteTotal
    })

    expect(fieldHandle.value).toBeGreaterThan(0)
    expect(Number.isFinite(fieldHandle.ms)).toBe(true)
    recordMeasurement('NPC route-field handles', fieldHandle, {
      routeCount: startIndexes.length,
      repetitions
    })
  }, 30000)

  it('profiles low-desire destination selection', () => {
    const city = loadLibertyCity()
    const simulation = createMeasuredNpcSimulation(city, 5000, 18)
    const candidates = prepareLowHungerCandidates(simulation, 2500)
    const repetitions = 12

    expect(candidates.length).toBeGreaterThan(0)

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

    expect(optimized.value).toBeGreaterThan(0)
    expect(Number.isFinite(optimized.ms)).toBe(true)
    recordMeasurement('low-desire destination selection', optimized, {
      candidateCount: candidates.length,
      repetitions
    })

    simulation.destroy()
  }, 30000)

  it('profiles low-social destination coordination', () => {
    const city = loadLibertyCity()
    const simulation = createConfiguredNpcSimulation(city, 5000, 21, {
      familyTypeWeights: {
        single: 1,
        marriedWithoutChildren: 0,
        marriedWithChildren: 0
      }
    })
    const candidates = prepareLowSocialCandidates(simulation, 2500)
    const repetitions = 12

    expect(candidates.length).toBeGreaterThan(0)

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

    expect(optimized.value).toBeGreaterThan(0)
    expect(Number.isFinite(optimized.ms)).toBe(true)
    recordMeasurement('low-social destination coordination', optimized, {
      candidateCount: candidates.length,
      repetitions
    })

    simulation.destroy()
  }, 30000)

  it('profiles sparse NPC crowding updates', () => {
    const { city, npcs, config } = createCrowdingFixture(250, 512 * 512)
    const sparseCrowding = createNpcCrowdingState(city, config)
    const repetitions = 250

    updateNpcCrowdingState(sparseCrowding, npcs)

    expect(crowdingChecksum(sparseCrowding, npcs)).toBeGreaterThan(0)

    const sparse = measureBest(() => {
      for (let repetition = 0; repetition < repetitions; repetition += 1) {
        updateNpcCrowdingState(sparseCrowding, npcs)
      }

      return crowdingChecksum(sparseCrowding, npcs)
    }, 4)

    expect(sparse.value).toBeGreaterThan(0)
    expect(Number.isFinite(sparse.ms)).toBe(true)
    recordMeasurement('sparse NPC crowding updates', sparse, {
      npcCount: npcs.length,
      tileCount: city.tiles.length,
      repetitions
    })
  }, 30000)

  it('profiles indoor contact location grouping', () => {
    const city = loadLibertyCity()
    const simulation = createConfiguredNpcSimulation(city, 3000, 12, {
      infectionProbability: 0.03,
      initialInfectiousCount: 20
    })
    const repetitions = 4
    const indoorCount = simulation.npcs.filter((npc) => !npc.present && npc.locationState?.buildingId).length

    expect(indoorCount).toBeGreaterThan(0)

    const optimized = measureBest(() => optimizedSharedLocationGroupingChecksum(simulation, repetitions), 4)

    expect(optimized.value).toBeGreaterThan(0)
    expect(Number.isFinite(optimized.ms)).toBe(true)
    recordMeasurement('indoor contact location grouping', optimized, {
      indoorCount,
      repetitions
    })

    simulation.destroy()
  }, 30000)

  it('profiles shared indoor transmission evaluation', () => {
    const city = loadLibertyCity()
    const simulation = createConfiguredNpcSimulation(city, 5000, 12, {
      infectionProbability: 0.03,
      initialInfectiousCount: 0
    })
    const group = Array.from({ length: simulation.npcs.length }, (_, index) => index)
    const states = simulation.infection.states
    const counts = simulation.infection.counts
    const repetitions = 4
    const probability = 0.000001

    for (let index = 0; index < states.length; index += 1) {
      states[index] = index < states.length / 2 ? 2 : 0
    }
    counts[0] = states.length / 2
    counts[1] = 0
    counts[2] = states.length / 2
    counts[3] = 0
    simulation.infection.random = { next: () => 1 }
    simulation.infection.sharedLocationGroups = [group]
    simulation.infection.sharedLocationGroupsAt = simulation.infection.getElapsedSimulationSeconds()

    const optimized = measureBest(() => optimizedSharedLocationTransmissionChecksum(simulation, probability, repetitions), 5)

    expect(optimized.value).toBeGreaterThan(0)
    expect(Number.isFinite(optimized.ms)).toBe(true)
    recordMeasurement('shared indoor transmission evaluation', optimized, {
      npcCount: simulation.npcs.length,
      repetitions
    })

    simulation.destroy()
  }, 30000)

  it('profiles steady-state NPC update cost as population grows', () => {
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
    expect(Number.isFinite(smallResult.ms)).toBe(true)
    expect(Number.isFinite(largeResult.ms)).toBe(true)
    recordMeasurement('steady-state NPC updates small', smallResult, {
      npcCount: small.npcs.length,
      frames: 90,
      msPerNpc: smallPerNpc
    })
    recordMeasurement('steady-state NPC updates large', largeResult, {
      npcCount: large.npcs.length,
      frames: 90,
      msPerNpc: largePerNpc
    })

    small.destroy()
    large.destroy()
  }, 30000)
})
