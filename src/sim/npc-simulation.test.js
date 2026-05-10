import { describe, expect, it, vi } from 'vitest'
import { INFECTION_CONFIG, NPC_CONFIG } from '../core/constants.js'
import { createSeededRandom } from '../core/random.js'
import { compileCityMap, validateCityMap } from '../map/city-map.js'
import { createNpcSimulation } from './npc-simulation.js'

const SECONDS_PER_DAY = 24 * 60 * 60

vi.mock('pixi.js', () => ({
  Graphics: class {
    constructor() {
      this.eventMode = 'auto'
      this.parent = null
      this.drawnRects = 0
      this.fills = []
    }

    clear() {
      this.drawnRects = 0
      this.fills.length = 0
    }

    rect() {
      this.drawnRects += 1
      const fills = this.fills

      return {
        fill(options) {
          fills.push(options)
        }
      }
    }

    destroy() {}
  }
}))

function createCity(overrides = {}) {
  return compileCityMap(validateCityMap({
    width: 4,
    height: 3,
    tileSize: 32,
    textureSet: 'test',
    legend: {
      s: { category: 'sidewalk', walkable: true, drivable: false, parkable: false }
    },
    rows: [
      'ssss',
      'ssss',
      'ssss'
    ],
    textureRows: [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0]
    ],
    ...overrides
  }))
}

function createCityWithBuildingTypes() {
  return createCity({
    width: 9,
    height: 3,
    legend: {
      s: { category: 'sidewalk', walkable: true, drivable: false, parkable: false },
      b: { category: 'building', walkable: false, drivable: false, parkable: false }
    },
    buildings: {
      encoding: 'row-spans-v1',
      defaultTypes: ['residential'],
      items: [
        { id: 'home-1', types: ['residential'], entrance: { x: 1, y: 1 }, spans: [[1, 1, 1]] },
        { id: 'home-2', types: ['residential'], entrance: { x: 3, y: 1 }, spans: [[1, 3, 1]] },
        { id: 'work-1', types: ['school'], entrance: { x: 5, y: 1 }, spans: [[1, 5, 1]] },
        { id: 'work-2', types: ['supermarket'], entrance: { x: 7, y: 1 }, spans: [[1, 7, 1]] }
      ]
    },
    rows: [
      'sssssssss',
      'sbsbsbsbs',
      'sssssssss'
    ],
    textureRows: [
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0]
    ]
  })
}

function createCityWithSharedBuildings() {
  return createCity({
    width: 5,
    height: 3,
    legend: {
      s: { category: 'sidewalk', walkable: true, drivable: false, parkable: false },
      b: { category: 'building', walkable: false, drivable: false, parkable: false }
    },
    buildings: {
      encoding: 'row-spans-v1',
      defaultTypes: ['residential'],
      items: [
        { id: 'home-1', types: ['residential'], entrance: { x: 1, y: 1 }, spans: [[1, 1, 1]] },
        { id: 'work-1', types: ['commercial'], entrance: { x: 3, y: 1 }, spans: [[1, 3, 1]] }
      ]
    },
    rows: [
      'sssss',
      'sbsbs',
      'sssss'
    ],
    textureRows: [
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0]
    ]
  })
}

function createCityWithDailyLifeBuildings() {
  return createCity({
    width: 15,
    height: 3,
    legend: {
      s: { category: 'sidewalk', walkable: true, drivable: false, parkable: false },
      b: { category: 'building', walkable: false, drivable: false, parkable: false }
    },
    buildings: {
      encoding: 'row-spans-v1',
      defaultTypes: ['residential'],
      items: [
        { id: 'home', types: ['residential'], entrance: { x: 1, y: 1 }, spans: [[1, 1, 1]] },
        { id: 'office', types: ['commercial'], entrance: { x: 3, y: 1 }, spans: [[1, 3, 1]] },
        { id: 'diner', types: ['restaurant'], entrance: { x: 5, y: 1 }, spans: [[1, 5, 1]] },
        { id: 'bistro', types: ['restaurant'], entrance: { x: 7, y: 1 }, spans: [[1, 7, 1]] },
        { id: 'market', types: ['supermarket'], entrance: { x: 9, y: 1 }, spans: [[1, 9, 1]] },
        { id: 'mall', types: ['mall'], entrance: { x: 11, y: 1 }, spans: [[1, 11, 1]] },
        { id: 'club', types: ['nightclub'], entrance: { x: 13, y: 1 }, spans: [[1, 13, 1]] }
      ]
    },
    rows: [
      'sssssssssssssss',
      'sbsbsbsbsbsbsbs',
      'sssssssssssssss'
    ],
    textureRows: [
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    ]
  })
}

function createCornerCity() {
  return createCity({
    width: 3,
    height: 2,
    legend: {
      s: { category: 'sidewalk', walkable: true, drivable: false, parkable: false },
      o: { category: 'obstacle', walkable: false, drivable: false, parkable: false }
    },
    rows: [
      'sss',
      'oss'
    ],
    textureRows: [
      [0, 0, 0],
      [0, 0, 0]
    ]
  })
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

function createMutableClock(hour) {
  return {
    hour,
    getTimeOfDayHours() {
      return this.hour
    }
  }
}

const SINGLE_ADULT_FAMILIES = Object.freeze({
  single: 1,
  marriedWithoutChildren: 0,
  marriedWithChildren: 0
})

const MARRIED_WITH_CHILDREN_FAMILIES = Object.freeze({
  single: 0,
  marriedWithoutChildren: 0,
  marriedWithChildren: 1
})

const TWO_CHILDREN_FAMILY = Object.freeze([
  Object.freeze({ count: 2, weight: 1 })
])

function createSimulation(seed, city = createCity(), options = {}) {
  const simulation = createNpcSimulation(city, createActorLayer(), {
    count: options.count ?? 8,
    zorder: 1,
    tileCapacity: options.tileCapacity ?? NPC_CONFIG.tileCapacity,
    maxVisiblePerTile: options.maxVisiblePerTile ?? NPC_CONFIG.maxVisiblePerTile,
    slotSpacing: NPC_CONFIG.slotSpacing,
    color: 0xe5c748,
    size: NPC_CONFIG.size,
    minSpeed: 34,
    maxSpeed: 58,
    crowding: options.crowding,
    workStartHour: 9,
    workEndHour: 17,
    scheduleVariationHours: options.scheduleVariationHours ?? 0.75,
    lunchStartHour: options.lunchStartHour,
    lunchEndHour: options.lunchEndHour,
    lunchDurationHours: options.lunchDurationHours,
    lunchRestaurantCandidateCount: options.lunchRestaurantCandidateCount,
    shoppingChance: options.shoppingChance,
    shoppingDurationHours: options.shoppingDurationHours,
    nightclubChance: options.nightclubChance,
    nightclubStartHour: options.nightclubStartHour,
    nightclubLatestStartHour: options.nightclubLatestStartHour,
    nightclubDurationHours: options.nightclubDurationHours,
    desires: options.desires,
    socialGraph: options.socialGraph,
    familyTypeWeights: options.familyTypeWeights,
    familyChildCountWeights: options.familyChildCountWeights,
    routePlanBudget: options.routePlanBudget || 24,
    routeRetrySeconds: 1,
    routeBlockedReplanSeconds: 2,
    initialInfectiousCount: options.initialInfectiousCount ?? 0,
    inoculatedPercent: options.inoculatedPercent,
    policyEffects: options.policyEffects,
    infectionDistance: options.infectionDistance ?? INFECTION_CONFIG.infectionDistance,
    infectionProbability: options.infectionProbability ?? 0.03,
    incubationDays: options.incubationDays ?? 5,
    infectionDays: options.infectionDays ?? 7,
    immunityDays: options.immunityDays ?? 90,
    infectionColors: options.infectionColors,
    entityDebugOptions: options.entityDebugOptions,
    clock: options.clock,
    random: createSeededRandom(seed)
  })

  if (options.initialUpdate !== false) {
    simulation.update(1 / 60)
  }

  return simulation
}

function snapshot(simulation) {
  return simulation.npcs.map((npc) => ({
    zorder: npc.zorder,
    age: npc.age,
    home: npc.home,
    work: npc.work,
    position: { ...npc.position },
    tile: { ...npc.tile },
    slot: { ...npc.slot },
    speed: npc.movement.speed,
    target: npc.movement.target
      ? {
          position: { ...npc.movement.target.position },
          tile: { ...npc.movement.target.tile },
          slot: { ...npc.movement.target.slot }
        }
      : null
  }))
}

function createSimulationWithNpc(seedPrefix, city, options, predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const simulation = createSimulation(`${seedPrefix}-${attempt}`, city, options)
    const npc = simulation.npcs.find(predicate)

    if (npc) {
      return { simulation, npc }
    }

    simulation.destroy()
  }

  throw new Error(`Could not generate matching NPC for ${seedPrefix}.`)
}

function buildingsWithType(city, type) {
  return city.buildings.filter((building) => (
    building.types.includes(type)
  ))
}

function nearestBuildingByEntrance(origin, buildings) {
  return buildings
    .map((building) => ({
      building,
      distance: squaredEntranceDistance(origin, building)
    }))
    .sort((a, b) => a.distance - b.distance || String(a.building.id).localeCompare(String(b.building.id)))[0]?.building || null
}

function squaredEntranceDistance(first, second) {
  const dx = first.entrance.x - second.entrance.x
  const dy = first.entrance.y - second.entrance.y

  return dx * dx + dy * dy
}

function setNpcDesires(npc, overrides) {
  Object.assign(npc.desires, {
    hunger: 80,
    energy: 80,
    fun: 80,
    social: 80,
    ...overrides
  })
  npc.activeDesire = null
}

describe('NPC simulation randomness', () => {
  it('allows more NPCs than visual slots to occupy one normal walkable tile', () => {
    const city = createCity({
      width: 1,
      height: 1,
      rows: ['s'],
      textureRows: [[0]]
    })
    const simulation = createSimulation('unlimited-tile-capacity', city, {
      count: 24,
      initialUpdate: false
    })
    const minCenter = NPC_CONFIG.size / 2
    const maxCenter = city.tileSize - NPC_CONFIG.size / 2

    expect(simulation.tileCapacity).toBe(9)
    expect(simulation.npcs).toHaveLength(24)
    expect(simulation.npcs.every((npc) => !Object.prototype.hasOwnProperty.call(npc.slot, 'index'))).toBe(true)
    expect(simulation.npcs.every((npc) => npc.slot.id >= 0 && npc.slot.id < simulation.tileCapacity)).toBe(true)
    expect(simulation.npcs.every((npc) => npc.tile.x === 0 && npc.tile.y === 0)).toBe(true)
    expect(simulation.npcs.every((npc) => (
      npc.position.x >= minCenter &&
      npc.position.x <= maxCenter &&
      npc.position.y >= minCenter &&
      npc.position.y <= maxCenter
    ))).toBe(true)
    expect(simulation.graphics.drawnRects).toBeGreaterThan(NPC_CONFIG.maxVisiblePerTile * 2)

    simulation.destroy()
  })

  it('keeps goal-less NPCs idle instead of choosing random path tiles', () => {
    const city = createCity({
      width: 2,
      height: 1,
      rows: ['ss'],
      textureRows: [[0, 0]]
    })
    const simulation = createSimulation('over-capacity-move', city, {
      count: 1,
      initialUpdate: false
    })
    const npc = simulation.npcs[0]

    npc.position = { x: city.tileSize / 2, y: city.tileSize / 2 }
    npc.tile = { x: 0, y: 0, index: 0 }
    npc.slot = { id: 0 }
    npc.movement.target = null

    simulation.update(1 / 60)

    expect(npc.movement.target).toBeNull()
    expect(npc.tile).toMatchObject({ x: 0, y: 0, index: 0 })

    simulation.destroy()
  })

  it('keeps the same visual slot when moving across normal route tiles', () => {
    const city = createCity({
      width: 2,
      height: 1,
      rows: ['ss'],
      textureRows: [[0, 0]]
    })
    const simulation = createSimulation('stable-slot', city, {
      count: 1,
      initialUpdate: false
    })
    const npc = simulation.npcs[0]
    const targetLocation = { x: 1, y: 0, index: city.index(1, 0) }

    npc.present = true
    npc.locationState = null
    npc.position = { x: 16, y: 16 }
    npc.tile = { x: 0, y: 0, index: city.index(0, 0) }
    npc.slot = { id: 4 }
    npc.timetable = {
      getActiveElement: () => ({
        id: 'walk',
        buildingId: 'target',
        location: targetLocation
      })
    }

    simulation.update(1 / 60)

    expect(npc.movement.target).toBeTruthy()
    expect(npc.movement.target.slot.id).toBe(4)

    simulation.destroy()
  })

  it('advances walking movement using the presentation movement scale', () => {
    const city = createCity({
      width: 2,
      height: 1,
      rows: ['ss'],
      textureRows: [[0, 0]]
    })
    const clock = {
      secondsPerSimulationHour: 60,
      getTimeOfDayHours: () => 8
    }
    const simulation = createSimulation('clock-walk', city, {
      count: 1,
      tileCapacity: 1,
      clock,
      initialUpdate: false
    })
    const npc = simulation.npcs[0]
    const targetLocation = { x: 1, y: 0, index: city.index(1, 0) }

    npc.present = true
    npc.locationState = null
    npc.position = { x: 16, y: 16 }
    npc.tile = { x: 0, y: 0, index: city.index(0, 0) }
    npc.slot = { id: 0 }
    npc.movement.speed = 8
    npc.movement.target = null
    npc.timetable = {
      getActiveElement: () => ({
        id: 'walk',
        buildingId: 'target',
        location: targetLocation
      })
    }

    simulation.update(1 / 60)

    const startX = npc.position.x

    simulation.update(1 / 60)

    expect(npc.position.x).toBeGreaterThan(startX)
    expect(npc.position.x).toBeLessThan(startX + 1)
    expect(npc.position.x).toBeLessThan(48)

    simulation.destroy()
  })

  it('slows pedestrians while their current tile is over soft crowd capacity', () => {
    const city = createCity({
      width: 2,
      height: 1,
      rows: ['ss'],
      textureRows: [[0, 0]]
    })
    const targetLocation = { x: 1, y: 0, index: city.index(1, 0) }
    const createWalker = (seed, count) => {
      const simulation = createSimulation(seed, city, {
        count,
        tileCapacity: 1,
        crowding: {
          softTileCapacity: 1,
          doorwayQueueCapacity: 9,
          crosswalkQueueCapacity: 9,
          maxSpeedPenalty: 0.5
        },
        initialUpdate: false
      })

      for (const npc of simulation.npcs) {
        npc.present = true
        npc.locationState = null
        npc.position = { x: 16, y: 16 }
        npc.tile = { x: 0, y: 0, index: city.index(0, 0) }
        npc.slot = { id: 0 }
        npc.movement.speed = 8
        npc.movement.target = null
        npc.timetable = { getActiveElement: () => null }
      }

      simulation.npcs[0].timetable = {
        getActiveElement: () => ({
          id: 'walk',
          buildingId: 'target',
          location: targetLocation
        })
      }

      return simulation
    }
    const solitary = createWalker('solitary-crowd-speed', 1)
    const crowded = createWalker('crowded-crowd-speed', 4)

    solitary.update(1 / 60)
    crowded.update(1 / 60)

    const solitaryStartX = solitary.npcs[0].position.x
    const crowdedStartX = crowded.npcs[0].position.x

    solitary.update(1 / 60)
    crowded.update(1 / 60)

    expect(crowded.npcs[0].position.x - crowdedStartX).toBeLessThan(solitary.npcs[0].position.x - solitaryStartX)

    solitary.destroy()
    crowded.destroy()
  })

  it('keeps pedestrians inside a location while the doorway tile is queued', () => {
    const city = createCity({
      width: 2,
      height: 1,
      rows: ['ss'],
      textureRows: [[0, 0]]
    })
    const simulation = createSimulation('doorway-queue', city, {
      count: 3,
      crowding: {
        softTileCapacity: 1,
        doorwayQueueCapacity: 2,
        crosswalkQueueCapacity: 9,
        maxSpeedPenalty: 0.5
      },
      initialUpdate: false
    })
    const doorway = { x: 0, y: 0, index: city.index(0, 0) }
    const destination = { x: 1, y: 0, index: city.index(1, 0) }
    const exitingNpc = simulation.npcs[0]

    for (const npc of simulation.npcs.slice(1)) {
      npc.present = true
      npc.locationState = null
      npc.position = { x: 16, y: 16 }
      npc.tile = { ...doorway }
      npc.slot = { id: 0 }
      npc.movement.target = null
      npc.timetable = { getActiveElement: () => null }
    }

    exitingNpc.present = false
    exitingNpc.locationState = {
      timetableElementId: 'home',
      buildingId: 'home',
      location: doorway
    }
    exitingNpc.tile = { ...doorway }
    exitingNpc.position = { x: 16, y: 16 }
    exitingNpc.slot = { id: -1 }
    exitingNpc.timetable = {
      getActiveElement: () => ({
        id: 'work',
        buildingId: 'work',
        location: destination
      })
    }

    simulation.update(1 / 60)

    expect(exitingNpc.present).toBe(false)
    expect(exitingNpc.locationState).toMatchObject({ buildingId: 'home' })
    expect(exitingNpc.movement.target).toBeNull()

    simulation.destroy()
  })

  it('queues before entering a crowded crosswalk', () => {
    const city = createCity({
      width: 3,
      height: 1,
      legend: {
        s: { category: 'sidewalk', walkable: true, drivable: false, parkable: false },
        c: { category: 'crosswalk', walkable: true, drivable: true, parkable: false }
      },
      rows: ['scs'],
      textureRows: [[0, 0, 0]]
    })
    city.setCrosswalkSignalState('green')

    const simulation = createSimulation('crosswalk-queue', city, {
      count: 2,
      crowding: {
        softTileCapacity: 1,
        doorwayQueueCapacity: 9,
        crosswalkQueueCapacity: 1,
        maxSpeedPenalty: 0.5
      },
      initialUpdate: false
    })
    const waitingNpc = simulation.npcs[0]
    const crosswalkNpc = simulation.npcs[1]
    const start = { x: 0, y: 0, index: city.index(0, 0) }
    const crosswalk = { x: 1, y: 0, index: city.index(1, 0) }
    const destination = { x: 2, y: 0, index: city.index(2, 0) }

    waitingNpc.present = true
    waitingNpc.locationState = null
    waitingNpc.position = { x: 16, y: 16 }
    waitingNpc.tile = { ...start }
    waitingNpc.slot = { id: 0 }
    waitingNpc.movement.target = null
    waitingNpc.timetable = {
      getActiveElement: () => ({
        id: 'walk',
        buildingId: 'target',
        location: destination
      })
    }

    crosswalkNpc.present = true
    crosswalkNpc.locationState = null
    crosswalkNpc.position = { x: 48, y: 16 }
    crosswalkNpc.tile = { ...crosswalk }
    crosswalkNpc.slot = { id: 0 }
    crosswalkNpc.movement.target = null
    crosswalkNpc.timetable = { getActiveElement: () => null }

    simulation.update(1 / 60)

    expect(waitingNpc.movement.target).toBeNull()
    expect(waitingNpc.tile).toMatchObject(start)
    expect(waitingNpc.routing.blockedSeconds).toBeGreaterThan(0)

    simulation.destroy()
  })

  it('counts same-tick crosswalk reservations when queueing pedestrians', () => {
    const city = createCity({
      width: 3,
      height: 1,
      legend: {
        s: { category: 'sidewalk', walkable: true, drivable: false, parkable: false },
        c: { category: 'crosswalk', walkable: true, drivable: true, parkable: false }
      },
      rows: ['scs'],
      textureRows: [[0, 0, 0]]
    })
    city.setCrosswalkSignalState('green')

    const simulation = createSimulation('crosswalk-reservation-queue', city, {
      count: 2,
      crowding: {
        softTileCapacity: 1,
        doorwayQueueCapacity: 9,
        crosswalkQueueCapacity: 1,
        maxSpeedPenalty: 0.5
      },
      initialUpdate: false
    })
    const start = { x: 0, y: 0, index: city.index(0, 0) }
    const destination = { x: 2, y: 0, index: city.index(2, 0) }

    for (const npc of simulation.npcs) {
      npc.present = true
      npc.locationState = null
      npc.position = { x: 16, y: 16 }
      npc.tile = { ...start }
      npc.slot = { id: 0 }
      npc.movement.target = null
      npc.timetable = {
        getActiveElement: () => ({
          id: 'walk',
          buildingId: 'target',
          location: destination
        })
      }
    }

    simulation.update(1 / 60)

    expect(simulation.npcs[0].movement.target).not.toBeNull()
    expect(simulation.npcs[1].movement.target).toBeNull()
    expect(simulation.npcs[1].routing.blockedSeconds).toBeGreaterThan(0)

    simulation.destroy()
  })

  it('spreads target visual slots away from occupied slots on crowded tiles', () => {
    const city = createCity({
      width: 2,
      height: 1,
      rows: ['ss'],
      textureRows: [[0, 0]]
    })
    const simulation = createSimulation('crowded-slot-avoidance', city, {
      count: 2,
      tileCapacity: 5,
      initialUpdate: false
    })
    const walker = simulation.npcs[0]
    const occupant = simulation.npcs[1]
    const start = { x: 0, y: 0, index: city.index(0, 0) }
    const destination = { x: 1, y: 0, index: city.index(1, 0) }

    walker.present = true
    walker.locationState = null
    walker.position = { x: 16, y: 16 }
    walker.tile = { ...start }
    walker.slot = { id: 4 }
    walker.movement.target = null
    walker.timetable = {
      getActiveElement: () => ({
        id: 'walk',
        buildingId: 'target',
        location: destination
      })
    }

    occupant.present = true
    occupant.locationState = null
    occupant.position = { x: 48, y: 16 }
    occupant.tile = { ...destination }
    occupant.slot = { id: 4 }
    occupant.movement.target = null
    occupant.timetable = { getActiveElement: () => null }

    simulation.update(1 / 60)

    expect(walker.movement.target.slot.id).toBe(0)

    simulation.destroy()
  })

  it('rounds route turns with a bezier movement curve', () => {
    const city = createCornerCity()
    const simulation = createSimulation('bezier-turn', city, {
      count: 1,
      tileCapacity: 1,
      initialUpdate: false
    })
    const npc = simulation.npcs[0]
    const cornerIndex = city.index(1, 0)
    const targetLocation = { x: 2, y: 1, index: city.index(2, 1) }

    npc.present = true
    npc.locationState = null
    npc.position = { x: 16, y: 16 }
    npc.tile = { x: 0, y: 0, index: city.index(0, 0) }
    npc.slot = { id: 0 }
    npc.movement.speed = 64
    npc.movement.target = null
    npc.movement.headingX = 0
    npc.movement.headingY = 0
    npc.timetable = {
      getActiveElement: () => ({
        id: 'walk',
        buildingId: 'target',
        location: targetLocation
      })
    }

    simulation.update(1 / 60)

    expect(npc.movement.target.tile).toMatchObject({ x: 1, y: 0, index: cornerIndex })

    for (let step = 0; step < 120 && npc.tile.index !== cornerIndex; step += 1) {
      simulation.update(1 / 60)
    }

    expect(npc.tile.index).toBe(cornerIndex)
    expect(npc.movement.target).toBeNull()

    simulation.update(1 / 60)

    const turnTarget = npc.movement.target
    const start = { ...npc.position }
    const end = { ...turnTarget.position }

    expect(turnTarget.tile).toMatchObject(targetLocation)
    expect(turnTarget.curve.p1.x).toBeGreaterThan(turnTarget.curve.p0.x)
    expect(turnTarget.curve.p1.y).toBeCloseTo(turnTarget.curve.p0.y)

    simulation.update(0.1)

    const straightProgress = (npc.position.x - start.x) / (end.x - start.x)
    const straightY = start.y + (end.y - start.y) * straightProgress

    expect(npc.position.y).toBeLessThan(straightY)
    expect(npc.movement.headingX).toBeGreaterThan(0)

    simulation.destroy()
  })

  it('assigns NPC entities and their graphics layer to zorder 1', () => {
    const simulation = createSimulation('zorder')

    expect(simulation.npcs.every((npc) => npc.zorder === 1)).toBe(true)
    expect(simulation.graphics.zorder).toBe(1)
    expect(simulation.graphics.zIndex).toBe(1)

    simulation.destroy()
  })

  it('adds inspectable SEIR infection state to each NPC and seeds initial infectious cases', () => {
    const simulation = createSimulation('infection-seed', createCity(), {
      count: 8,
      initialInfectiousCount: 2,
      initialUpdate: false
    })
    const stats = simulation.infection.getStats()

    expect(simulation.npcs.every((npc) => typeof npc.infection === 'string')).toBe(true)
    expect(stats).toEqual({
      susceptible: 6,
      exposed: 0,
      infectious: 2,
      recovered: 0
    })
    expect(simulation.npcs.filter((npc) => npc.infection === 'infectious')).toHaveLength(2)

    simulation.destroy()
  })

  it('starts inoculated NPCs as recovered and seeds infections from the remaining susceptible population', () => {
    const simulation = createSimulation('infection-inoculated', createCity(), {
      count: 10,
      inoculatedPercent: 40,
      initialInfectiousCount: 4,
      initialUpdate: false
    })
    const stats = simulation.infection.getStats()

    expect(stats).toEqual({
      susceptible: 2,
      exposed: 0,
      infectious: 4,
      recovered: 4
    })
    expect(simulation.npcs.filter((npc) => npc.infection === 'recovered')).toHaveLength(4)
    expect(simulation.npcs.filter((npc) => npc.infection === 'infectious')).toHaveLength(4)

    simulation.destroy()
  })

  it('prevents seeded infections when the whole population is inoculated', () => {
    const simulation = createSimulation('infection-fully-inoculated', createCity(), {
      count: 8,
      inoculatedPercent: 100,
      initialInfectiousCount: 4,
      initialUpdate: false
    })

    expect(simulation.infection.getStats()).toEqual({
      susceptible: 0,
      exposed: 0,
      infectious: 0,
      recovered: 8
    })

    simulation.destroy()
  })

  it('spreads infection from infectious NPCs to susceptible NPCs within distance', () => {
    const city = createCity({
      width: 2,
      height: 1,
      rows: ['ss'],
      textureRows: [[0, 0]]
    })
    const simulation = createSimulation('infection-spread', city, {
      count: 2,
      initialInfectiousCount: 0,
      infectionDistance: 10,
      infectionProbability: 1,
      initialUpdate: false
    })

    simulation.npcs[0].position = { x: 16, y: 16 }
    simulation.npcs[1].position = { x: 22, y: 16 }
    simulation.infection.setNpcState(0, 'infectious')
    simulation.infection.setNpcState(1, 'susceptible')

    simulation.update(1 / 60)

    expect(simulation.npcs[1].infection).toBe('exposed')
    expect(simulation.infection.getStats()).toMatchObject({
      susceptible: 0,
      exposed: 1,
      infectious: 1,
      recovered: 0
    })
    expect(simulation.infection.getRecentTransmissionEvents()).toEqual([
      expect.objectContaining({
        id: 1,
        sourceNpcId: simulation.npcs[0].id,
        targetNpcId: simulation.npcs[1].id,
        sourcePosition: { x: 16, y: 16 },
        targetPosition: { x: 22, y: 16 },
        distance: 6,
        targetState: 'exposed'
      })
    ])

    simulation.destroy()
  })

  it('applies policy transmission multipliers without changing the base infection probability', () => {
    const city = createCity({
      width: 2,
      height: 1,
      rows: ['ss'],
      textureRows: [[0, 0]]
    })
    const simulation = createSimulation('infection-policy-multiplier', city, {
      count: 2,
      initialInfectiousCount: 0,
      infectionDistance: 10,
      infectionProbability: 1,
      initialUpdate: false
    })

    simulation.npcs[0].position = { x: 16, y: 16 }
    simulation.npcs[1].position = { x: 22, y: 16 }
    simulation.infection.setNpcState(0, 'infectious')
    simulation.infection.setNpcState(1, 'susceptible')
    simulation.infection.setPolicyInfectionProbabilityMultiplier(0)

    simulation.update(1 / 60)

    expect(simulation.npcs[1].infection).toBe('susceptible')
    expect(simulation.infection.infectionProbability).toBe(0)

    simulation.infection.setPolicyInfectionProbabilityMultiplier(1)
    simulation.update(1 / 60)

    expect(simulation.npcs[1].infection).toBe('exposed')
    expect(simulation.infection.baseInfectionProbability).toBe(1)
    expect(simulation.infection.infectionProbability).toBe(1)

    simulation.destroy()
  })

  it('cancels matching timetable events according to active policy probabilities', () => {
    const cases = [
      {
        name: 'school',
        hour: 10,
        createCity: createCityWithBuildingTypes,
        options: { count: 6, familyTypeWeights: MARRIED_WITH_CHILDREN_FAMILIES },
        action: 'closeSchools',
        canceledId: 'home',
        allowedId: 'school',
        predicate: (npc) => npc.age >= 6 && npc.age < 18 && npc.school
      },
      {
        name: 'home-office',
        hour: 10,
        options: { shoppingChance: 0, nightclubChance: 0 },
        action: 'homeOffice',
        canceledId: 'home',
        allowedId: 'work'
      },
      {
        name: 'shopping',
        hour: 17.5,
        options: { shoppingChance: 1, nightclubChance: 0 },
        action: 'reduceShopping',
        canceledId: 'home',
        allowedId: 'shopping'
      },
      {
        name: 'nightlife',
        hour: 22,
        options: {
          shoppingChance: 0,
          nightclubChance: 1,
          nightclubStartHour: 21,
          nightclubLatestStartHour: 21,
          nightclubDurationHours: 3
        },
        action: 'reduceNightlife',
        canceledId: 'home',
        allowedId: 'nightclub'
      }
    ]

    for (const testCase of cases) {
      const city = (testCase.createCity || createCityWithDailyLifeBuildings)()
      const createPolicySimulation = (probability) => createSimulationWithNpc(
        `policy-cancel-${testCase.name}-${probability}`,
        city,
        {
          count: 1,
          familyTypeWeights: SINGLE_ADULT_FAMILIES,
          scheduleVariationHours: 0,
          clock: createMutableClock(testCase.hour),
          policyEffects: {
            infectionProbabilityMultiplier: 1,
            eventCancellationProbabilities: {
              closeSchools: 0,
              homeOffice: 0,
              reduceShopping: 0,
              reduceNightlife: 0,
              [testCase.action]: probability
            }
          },
          ...testCase.options,
          initialUpdate: false
        },
        testCase.predicate || (() => true)
      )
      const canceled = createPolicySimulation(1)
      const allowed = createPolicySimulation(0)

      canceled.simulation.update(1 / 60)
      allowed.simulation.update(1 / 60)

      expect(canceled.npc.goal.id).toBe(testCase.canceledId)
      expect(allowed.npc.goal.id).toBe(testCase.allowedId)

      canceled.simulation.destroy()
      allowed.simulation.destroy()
    }
  })

  it('enforces social distancing by queuing pedestrians before occupied tiles', () => {
    const city = createCity({
      width: 2,
      height: 1,
      rows: ['ss'],
      textureRows: [[0, 0]]
    })
    const createWalker = (socialDistancingEnabled) => {
      const simulation = createSimulation(`social-distance-${socialDistancingEnabled}`, city, {
        count: 2,
        policyEffects: {
          infectionProbabilityMultiplier: 1,
          socialDistancingEnabled,
          eventCancellationProbabilities: {
            closeSchools: 0,
            homeOffice: 0,
            reduceShopping: 0,
            reduceNightlife: 0
          }
        },
        initialUpdate: false
      })
      const walker = simulation.npcs[0]
      const occupant = simulation.npcs[1]
      const start = { x: 0, y: 0, index: city.index(0, 0) }
      const destination = { x: 1, y: 0, index: city.index(1, 0) }

      walker.present = true
      walker.locationState = null
      walker.position = { x: 16, y: 16 }
      walker.tile = { ...start }
      walker.slot = { id: 0 }
      walker.movement.target = null
      walker.timetable = {
        getActiveElement: () => ({
          id: 'walk',
          buildingId: 'target',
          location: destination
        })
      }

      occupant.present = true
      occupant.locationState = null
      occupant.position = { x: 48, y: 16 }
      occupant.tile = { ...destination }
      occupant.slot = { id: 0 }
      occupant.movement.target = null
      occupant.timetable = { getActiveElement: () => null }

      return { simulation, walker }
    }
    const distanced = createWalker(true)
    const normal = createWalker(false)

    distanced.simulation.update(1 / 60)
    normal.simulation.update(1 / 60)

    expect(distanced.walker.movement.target).toBeNull()
    expect(normal.walker.movement.target).toBeTruthy()

    distanced.simulation.destroy()
    normal.simulation.destroy()
  })

  it('records recent contact events when contact edge display is enabled', () => {
    const city = createCity({
      width: 2,
      height: 1,
      rows: ['ss'],
      textureRows: [[0, 0]]
    })
    const simulation = createSimulation('contact-edges', city, {
      count: 2,
      initialInfectiousCount: 0,
      infectionDistance: 10,
      infectionProbability: 0,
      initialUpdate: false,
      entityDebugOptions: {
        contactEdgesVisible: true,
        contactEdgeDurationSeconds: 60
      }
    })

    simulation.npcs[0].position = { x: 16, y: 16 }
    simulation.npcs[1].position = { x: 22, y: 16 }

    simulation.update(1 / 60)

    expect(simulation.infection.getRecentContactEvents()).toEqual([
      expect.objectContaining({
        id: 1,
        sourceNpcId: simulation.npcs[0].id,
        targetNpcId: simulation.npcs[1].id,
        sourcePosition: { x: 16, y: 16 },
        targetPosition: { x: 22, y: 16 },
        distance: 6
      })
    ])
    expect(simulation.infection.getRecentTransmissionEvents()).toEqual([])

    simulation.destroy()
  })

  it('advances infection through exposed, infectious, recovered, and susceptible phases', () => {
    const oneTickDays = 0.1 / SECONDS_PER_DAY
    const simulation = createSimulation('infection-phases', createCity(), {
      count: 1,
      initialInfectiousCount: 0,
      infectionProbability: 0,
      incubationDays: oneTickDays,
      infectionDays: oneTickDays,
      immunityDays: oneTickDays,
      initialUpdate: false
    })
    const npc = simulation.npcs[0]

    simulation.infection.setNpcState(0, 'exposed')
    simulation.update(0.1)

    expect(npc.infection).toBe('infectious')

    simulation.update(0.1)

    expect(npc.infection).toBe('recovered')

    simulation.update(0.1)

    expect(npc.infection).toBe('susceptible')
    expect(simulation.infection.getStats()).toMatchObject({
      susceptible: 1,
      exposed: 0,
      infectious: 0,
      recovered: 0
    })

    simulation.destroy()
  })

  it('reports full infection status for an NPC', () => {
    const twoDays = 2 * SECONDS_PER_DAY
    const simulation = createSimulation('infection-status', createCity(), {
      count: 1,
      initialInfectiousCount: 0,
      initialUpdate: false
    })

    simulation.infection.setNpcState(0, 'exposed', twoDays)

    expect(simulation.infection.getNpcStatus(simulation.npcs[0])).toMatchObject({
      id: 0,
      infection: 'exposed',
      color: 0xf0a33a,
      contagious: false,
      canBeInfected: false,
      immune: false,
      nextState: 'infectious',
      remainingSeconds: twoDays,
      remainingDays: 2
    })

    simulation.destroy()
  })

  it('renders NPC infection states with their configured colors', () => {
    const colors = {
      susceptible: 0x111111,
      exposed: 0x222222,
      infectious: 0x333333,
      recovered: 0x444444
    }
    const simulation = createSimulation('infection-colors', createCity(), {
      count: 4,
      initialInfectiousCount: 0,
      infectionColors: colors,
      initialUpdate: false
    })

    simulation.infection.setNpcState(0, 'susceptible')
    simulation.infection.setNpcState(1, 'exposed')
    simulation.infection.setNpcState(2, 'infectious')
    simulation.infection.setNpcState(3, 'recovered')
    simulation.render()

    const drawnColors = simulation.graphics.fills.map((fill) => fill.color)

    expect(drawnColors.filter((color) => color === colors.susceptible)).toHaveLength(1)
    expect(drawnColors.filter((color) => color === colors.exposed)).toHaveLength(1)
    expect(drawnColors.filter((color) => color === colors.infectious)).toHaveLength(1)
    expect(drawnColors.filter((color) => color === colors.recovered)).toHaveLength(1)

    simulation.destroy()
  })

  it('initializes deterministic desire scores for seeded NPCs', () => {
    const simulation = createSimulation('desire-seed', createCityWithDailyLifeBuildings(), {
      count: 4,
      initialUpdate: false
    })
    const repeated = createSimulation('desire-seed', createCityWithDailyLifeBuildings(), {
      count: 4,
      initialUpdate: false
    })
    const desires = simulation.npcs.map((npc) => ({ ...npc.desires }))

    expect(desires).toEqual(repeated.npcs.map((npc) => ({ ...npc.desires })))
    expect(simulation.desires).toBeTruthy()
    expect(simulation.npcs.every((npc) => npc.activeDesire === null)).toBe(true)
    expect(simulation.npcs.every((npc) => (
      ['hunger', 'energy', 'fun', 'social'].every((need) => npc.desires[need] >= 55 && npc.desires[need] <= 95)
    ))).toBe(true)

    simulation.destroy()
    repeated.destroy()
  })

  it('generates a deterministic reciprocal NPC friendship graph', () => {
    const options = {
      count: 16,
      familyTypeWeights: SINGLE_ADULT_FAMILIES,
      socialGraph: {
        minFriends: 2,
        maxFriends: 5
      },
      initialUpdate: false
    }
    const simulation = createSimulation('social-graph-seed', createCityWithDailyLifeBuildings(), options)
    const repeated = createSimulation('social-graph-seed', createCityWithDailyLifeBuildings(), options)
    const friendLists = simulation.npcs.map((npc) => npc.friendIds)

    expect(friendLists).toEqual(repeated.npcs.map((npc) => npc.friendIds))
    expect(friendLists.some((friends) => friends.length > 0)).toBe(true)

    for (const npc of simulation.npcs) {
      expect(npc.friendIds.length).toBeLessThanOrEqual(5)

      for (const friendId of npc.friendIds) {
        expect(simulation.npcs[friendId].friendIds).toContain(npc.id)
      }
    }

    expect(simulation.socialGraph.getFriendIds(simulation.npcs[0])).toBe(simulation.npcs[0].friendIds)

    simulation.destroy()
    repeated.destroy()
  })

  it('decays desire scores using simulation time', () => {
    const simulation = createSimulation('desire-decay', createCityWithDailyLifeBuildings(), {
      count: 1,
      initialUpdate: false
    })
    const npc = simulation.npcs[0]

    setNpcDesires(npc, {})
    npc.locationState = null
    simulation.desires.update(3600)

    expect(npc.desires.hunger).toBe(76)
    expect(npc.desires.energy).toBe(77)
    expect(npc.desires.fun).toBe(78)
    expect(npc.desires.social).toBe(78.5)

    simulation.destroy()
  })

  it('satisfies desires at home and typed venues', () => {
    const simulation = createSimulation('desire-satisfaction', createCityWithDailyLifeBuildings(), {
      count: 1,
      desires: {
        decayPerHour: {
          hunger: 0,
          energy: 0,
          fun: 0,
          social: 0
        }
      },
      initialUpdate: false
    })
    const npc = simulation.npcs[0]

    function satisfyAt(buildingId) {
      setNpcDesires(npc, {
        hunger: 50,
        energy: 50,
        fun: 50,
        social: 50
      })
      npc.locationState = {
        timetableElementId: 'test',
        buildingId,
        location: { x: 0, y: 0, index: 0 }
      }
      simulation.desires.update(3600)
      return { ...npc.desires }
    }

    expect(satisfyAt(npc.home)).toMatchObject({
      hunger: 52,
      energy: 62,
      fun: 51,
      social: 51
    })
    expect(satisfyAt('diner').hunger).toBe(95)
    expect(satisfyAt('market').hunger).toBe(75)
    expect(satisfyAt('mall')).toMatchObject({
      fun: 68,
      social: 62
    })
    expect(satisfyAt('club')).toMatchObject({
      fun: 78,
      social: 78
    })

    simulation.destroy()
  })

  it('uses low desires as flexible home-time destinations', () => {
    const city = createCityWithDailyLifeBuildings()

    function activeElementFor(need, hour = 18) {
      const clock = createMutableClock(hour)
      const simulation = createSimulation(`desire-destination-${need}`, city, {
        count: 1,
        familyTypeWeights: SINGLE_ADULT_FAMILIES,
        clock,
        scheduleVariationHours: 0,
        shoppingChance: 0,
        nightclubChance: 0,
        desires: {
          destinationCandidateCount: 1
        },
        initialUpdate: false
      })
      const npc = simulation.npcs[0]

      setNpcDesires(npc, { [need]: 10 })

      const element = npc.getActiveDestinationElement(hour)
      const result = {
        id: element.id,
        buildingId: element.buildingId,
        activeDesire: npc.activeDesire
          ? {
              need: npc.activeDesire.need,
              action: npc.activeDesire.action,
              buildingId: npc.activeDesire.buildingId
            }
          : null,
        home: npc.home
      }

      simulation.destroy()
      return result
    }

    expect(activeElementFor('hunger')).toMatchObject({
      id: 'desire:hunger',
      buildingId: 'diner',
      activeDesire: { need: 'hunger', action: 'eat', buildingId: 'diner' }
    })
    expect(activeElementFor('energy')).toMatchObject({
      id: 'desire:energy',
      buildingId: 'home'
    })
    expect(activeElementFor('fun')).toMatchObject({
      id: 'desire:fun',
      buildingId: 'mall'
    })
    expect(activeElementFor('social', 21)).toMatchObject({
      id: 'desire:social',
      buildingId: 'club'
    })
  })

  it('coordinates social desire trips with available friends', () => {
    const city = createCityWithDailyLifeBuildings()
    const simulation = createSimulation('social-trip-group', city, {
      count: 3,
      familyTypeWeights: SINGLE_ADULT_FAMILIES,
      scheduleVariationHours: 0,
      shoppingChance: 0,
      nightclubChance: 0,
      desires: {
        destinationCandidateCount: 1,
        socialGroupMinFriends: 2,
        socialGroupMaxFriends: 2
      },
      initialUpdate: false
    })
    const [host, firstFriend, secondFriend] = simulation.npcs

    simulation.desires.socialGraph = {
      getFriendIds: (npc) => npc.id === host.id ? [firstFriend.id, secondFriend.id] : []
    }

    setNpcDesires(host, { social: 5 })
    setNpcDesires(firstFriend, { social: 90 })
    setNpcDesires(secondFriend, { social: 90 })

    const element = host.getActiveDestinationElement(18)
    const groupId = host.activeDesire.socialGroupId

    expect(element).toMatchObject({
      id: 'desire:social',
      buildingId: 'mall'
    })
    expect(groupId).toBeGreaterThan(0)

    for (const friend of [firstFriend, secondFriend]) {
      expect(friend.activeDesire).toMatchObject({
        need: 'social',
        action: 'socialize',
        buildingId: 'mall',
        socialGroupId: groupId,
        organizerNpcId: host.id
      })
      expect([...friend.activeDesire.participantIds].sort((a, b) => a - b)).toEqual([host.id, firstFriend.id, secondFriend.id])
      expect(friend.goal).toMatchObject({
        id: 'desire:social',
        buildingId: 'mall'
      })
      expect(friend.getActiveDestinationElement(18)).toMatchObject({
        id: 'desire:social',
        buildingId: 'mall'
      })
    }

    simulation.desires.handleRouteFailure(host)

    expect(host.activeDesire).toBeNull()
    expect(firstFriend.activeDesire).toBeNull()
    expect(secondFriend.activeDesire).toBeNull()

    simulation.destroy()
  })

  it('keeps hard timetable stops ahead of desires', () => {
    const city = createCityWithDailyLifeBuildings()
    const simulation = createSimulation('desire-hard-stops', city, {
      count: 1,
      familyTypeWeights: SINGLE_ADULT_FAMILIES,
      initialUpdate: false
    })
    const npc = simulation.npcs[0]
    const office = city.buildings.find((building) => building.id === 'office')
    const location = {
      x: office.entrance.x,
      y: office.entrance.y,
      index: city.index(office.entrance.x, office.entrance.y)
    }

    setNpcDesires(npc, { hunger: 5 })

    for (const id of ['work', 'school', 'lunch', 'shopping', 'nightclub']) {
      const hardStop = { id, buildingId: office.id, location }

      npc.timetable = {
        getActiveElement: () => hardStop
      }

      expect(npc.getActiveDestinationElement(12)).toBe(hardStop)
      expect(npc.activeDesire).toBeNull()
    }

    simulation.destroy()
  })

  it('keeps preschoolers home-only and blocks minors from nightclub desire trips', () => {
    const city = createCityWithDailyLifeBuildings()
    const preschool = createSimulationWithNpc('desire-preschool', city, {
      count: 6,
      familyTypeWeights: MARRIED_WITH_CHILDREN_FAMILIES,
      familyChildCountWeights: [
        { count: 4, weight: 1 }
      ],
      initialUpdate: false
    }, (candidate) => candidate.age >= 0 && candidate.age < 6)
    const schoolAge = createSimulationWithNpc('desire-school-age', city, {
      count: 6,
      familyTypeWeights: MARRIED_WITH_CHILDREN_FAMILIES,
      familyChildCountWeights: [
        { count: 4, weight: 1 }
      ],
      initialUpdate: false
    }, (candidate) => candidate.age >= 6 && candidate.age < 18)

    setNpcDesires(preschool.npc, { hunger: 5 })
    setNpcDesires(schoolAge.npc, { social: 5 })

    expect(preschool.npc.getActiveDestinationElement(21)).toMatchObject({
      id: 'home',
      buildingId: preschool.npc.home
    })
    expect(preschool.npc.activeDesire).toBeNull()
    expect(schoolAge.npc.getActiveDestinationElement(21)).toMatchObject({
      id: 'desire:social',
      buildingId: 'mall'
    })

    preschool.simulation.destroy()
    schoolAge.simulation.destroy()
  })

  it('continues desire trips until satisfied and falls back home after route failure', () => {
    const clock = createMutableClock(18)
    const simulation = createSimulation('desire-lifecycle', createCityWithDailyLifeBuildings(), {
      count: 1,
      familyTypeWeights: SINGLE_ADULT_FAMILIES,
      clock,
      scheduleVariationHours: 0,
      shoppingChance: 0,
      nightclubChance: 0,
      desires: {
        destinationCandidateCount: 1
      },
      initialUpdate: false
    })
    const npc = simulation.npcs[0]

    setNpcDesires(npc, { hunger: 5 })

    expect(npc.getActiveDestinationElement(18)).toMatchObject({
      id: 'desire:hunger',
      buildingId: 'diner'
    })

    npc.desires.hunger = 69
    expect(npc.getActiveDestinationElement(18)).toMatchObject({
      id: 'desire:hunger',
      buildingId: 'diner'
    })

    npc.desires.hunger = 70
    expect(npc.getActiveDestinationElement(18)).toMatchObject({
      id: 'home',
      buildingId: npc.home
    })
    expect(npc.activeDesire).toBeNull()

    npc.desires.hunger = 5
    simulation.desires.update(3600)
    expect(npc.getActiveDestinationElement(18)).toMatchObject({
      id: 'desire:hunger'
    })
    simulation.desires.handleRouteFailure(npc)
    expect(npc.activeDesire).toBeNull()
    expect(npc.getActiveDestinationElement(18)).toMatchObject({
      id: 'home',
      buildingId: npc.home
    })

    simulation.destroy()
  })

  it('assigns adult NPCs a residential home and public-place work building from type sets', () => {
    const city = createCityWithBuildingTypes()
    const options = { familyTypeWeights: SINGLE_ADULT_FAMILIES }
    const simulation = createSimulation('building-assignments', city, options)
    const repeated = createSimulation('building-assignments', city, options)
    const homeIds = new Set(['home-1', 'home-2'])
    const workIds = new Set(['work-1', 'work-2'])
    const assignments = simulation.npcs.map((npc) => ({ age: npc.age, home: npc.home, work: npc.work }))

    expect(simulation.npcs.every((npc) => npc.age >= 18 && npc.age <= 99)).toBe(true)
    expect(simulation.npcs.every((npc) => homeIds.has(npc.home))).toBe(true)
    expect(simulation.npcs.every((npc) => workIds.has(npc.work))).toBe(true)
    expect(assignments).toEqual(repeated.npcs.map((npc) => ({ age: npc.age, home: npc.home, work: npc.work })))

    simulation.destroy()
    repeated.destroy()
  })

  it('generates whole families under one home and stores only per-NPC attributes', () => {
    const city = createCityWithBuildingTypes()
    const simulation = createSimulation('family-household', city, {
      count: 4,
      familyTypeWeights: MARRIED_WITH_CHILDREN_FAMILIES,
      familyChildCountWeights: TWO_CHILDREN_FAMILY,
      initialUpdate: false
    })
    const homes = new Set(simulation.npcs.map((npc) => npc.home))
    const adults = simulation.npcs.filter((npc) => npc.age >= 18)
    const children = simulation.npcs.filter((npc) => npc.age < 18)

    expect(simulation.npcs).toHaveLength(4)
    expect(homes.size).toBe(1)
    expect(adults).toHaveLength(2)
    expect(children).toHaveLength(2)
    expect(simulation.npcs.every((npc) => Number.isInteger(npc.age))).toBe(true)
    expect(simulation.npcs.every((npc) => !Object.prototype.hasOwnProperty.call(npc, 'familyType'))).toBe(true)
    expect(simulation.npcs.every((npc) => !Object.prototype.hasOwnProperty.call(npc, 'familyId'))).toBe(true)
    expect(simulation.npcs.every((npc) => !Object.prototype.hasOwnProperty.call(npc, 'children'))).toBe(true)

    simulation.destroy()
  })

  it('keeps the requested NPC count when the final family must fit remaining slots', () => {
    const city = createCityWithBuildingTypes()
    const simulation = createSimulation('family-exact-count', city, {
      count: 5,
      familyTypeWeights: {
        single: 0,
        marriedWithoutChildren: 1,
        marriedWithChildren: 0
      },
      initialUpdate: false
    })

    expect(simulation.npcs).toHaveLength(5)
    expect(simulation.npcs.every((npc) => npc.age >= 18 && npc.age <= 99)).toBe(true)

    simulation.destroy()
  })

  it('creates timetable elements that target home and work entrances', () => {
    const city = createCityWithBuildingTypes()
    const simulation = createSimulation('timetable', city, {
      count: 1,
      familyTypeWeights: SINGLE_ADULT_FAMILIES,
      scheduleVariationHours: 0,
      initialUpdate: false
    })
    const npc = simulation.npcs[0]
    const home = city.buildings.find((building) => building.id === npc.home)
    const work = city.buildings.find((building) => building.id === npc.work)
    const homeElement = npc.timetable.elements.find((element) => element.id === 'home')
    const workElement = npc.timetable.elements.find((element) => element.id === 'work')

    expect(homeElement).toMatchObject({
      buildingId: npc.home,
      location: { x: home.entrance.x, y: home.entrance.y }
    })
    expect(workElement).toMatchObject({
      buildingId: npc.work,
      location: { x: work.entrance.x, y: work.entrance.y },
      startHour: 9,
      endHour: 17
    })

    simulation.destroy()
  })

  it('adds an adult lunch break at a nearby restaurant around midday', () => {
    const city = createCityWithDailyLifeBuildings()
    const simulation = createSimulation('adult-lunch', city, {
      count: 1,
      familyTypeWeights: SINGLE_ADULT_FAMILIES,
      scheduleVariationHours: 0,
      lunchRestaurantCandidateCount: 1,
      shoppingChance: 0,
      nightclubChance: 0,
      initialUpdate: false
    })
    const npc = simulation.npcs[0]
    const work = city.buildings.find((building) => building.id === npc.work)
    const nearestRestaurant = nearestBuildingByEntrance(work, buildingsWithType(city, 'restaurant'))
    const lunchElement = npc.timetable.elements.find((element) => element.id === 'lunch')

    expect(lunchElement).toBeTruthy()
    expect(lunchElement.buildingId).toBe(nearestRestaurant.id)
    expect(lunchElement.startHour).toBeGreaterThanOrEqual(11)
    expect(lunchElement.endHour).toBeLessThanOrEqual(13)

    simulation.destroy()
  })

  it('randomly sends adults shopping after work before home', () => {
    const city = createCityWithDailyLifeBuildings()
    const simulation = createSimulation('adult-shopping', city, {
      count: 1,
      familyTypeWeights: SINGLE_ADULT_FAMILIES,
      scheduleVariationHours: 0,
      shoppingChance: 1,
      shoppingDurationHours: 1.25,
      nightclubChance: 0,
      initialUpdate: false
    })
    const npc = simulation.npcs[0]
    const shoppingElement = npc.timetable.elements.find((element) => element.id === 'shopping')
    const shoppingBuilding = city.buildings.find((building) => building.id === shoppingElement?.buildingId)

    expect(shoppingElement).toMatchObject({
      startHour: 17,
      endHour: 18.25
    })
    expect(
      (typeof shoppingBuilding?.hasAnyType === 'function' && shoppingBuilding.hasAnyType(['supermarket', 'mall'])) ||
      buildingsWithType(city, 'supermarket').includes(shoppingBuilding) ||
      buildingsWithType(city, 'mall').includes(shoppingBuilding)
    ).toBe(true)

    simulation.destroy()
  })

  it('only gives nightclub plans to adults from childless households', () => {
    const city = createCityWithDailyLifeBuildings()
    const childless = createSimulation('childless-nightclub', city, {
      count: 1,
      familyTypeWeights: SINGLE_ADULT_FAMILIES,
      scheduleVariationHours: 0,
      shoppingChance: 0,
      nightclubChance: 1,
      nightclubStartHour: 22,
      nightclubLatestStartHour: 22,
      nightclubDurationHours: 3,
      initialUpdate: false
    })
    const withChildren = createSimulation('parent-nightclub', city, {
      count: 3,
      familyTypeWeights: MARRIED_WITH_CHILDREN_FAMILIES,
      familyChildCountWeights: [
        { count: 1, weight: 1 }
      ],
      scheduleVariationHours: 0,
      shoppingChance: 0,
      nightclubChance: 1,
      initialUpdate: false
    })
    const childlessAdult = childless.npcs[0]
    const parents = withChildren.npcs.filter((npc) => npc.age >= 18)
    const nightclubElement = childlessAdult.timetable.elements.find((element) => element.id === 'nightclub')

    expect(nightclubElement).toMatchObject({
      buildingId: 'club',
      startHour: 22,
      endHour: 1
    })
    expect(parents).toHaveLength(2)
    expect(parents.every((npc) => !npc.timetable.elements.some((element) => element.id === 'nightclub'))).toBe(true)

    childless.destroy()
    withChildren.destroy()
  })

  it('routes school-age NPCs between home and school when a school exists', () => {
    const city = createCityWithBuildingTypes()
    const { simulation, npc } = createSimulationWithNpc('school-age', city, {
      count: 6,
      familyTypeWeights: MARRIED_WITH_CHILDREN_FAMILIES,
      familyChildCountWeights: [
        { count: 4, weight: 1 }
      ],
      scheduleVariationHours: 0,
      initialUpdate: false
    }, (candidate) => candidate.age >= 6 && candidate.age < 18)
    const schoolElement = npc.timetable.elements.find((element) => element.id === 'school')

    expect(npc.work).toBeNull()
    expect(schoolElement).toMatchObject({
      buildingId: 'work-1',
      startHour: 9,
      endHour: 17
    })

    simulation.destroy()
  })

  it('keeps preschool NPCs home-only', () => {
    const city = createCityWithBuildingTypes()
    const { simulation, npc } = createSimulationWithNpc('preschool-age', city, {
      count: 6,
      familyTypeWeights: MARRIED_WITH_CHILDREN_FAMILIES,
      familyChildCountWeights: [
        { count: 4, weight: 1 }
      ],
      initialUpdate: false
    }, (candidate) => candidate.age >= 0 && candidate.age < 6)

    expect(npc.work).toBeNull()
    expect(npc.timetable.elements).toEqual([
      expect.objectContaining({
        id: 'home',
        buildingId: npc.home,
        startHour: 0,
        endHour: 0
      })
    ])

    simulation.destroy()
  })

  it('keeps school-age NPCs home-only when the map has no school buildings', () => {
    const city = createCityWithSharedBuildings()
    const { simulation, npc } = createSimulationWithNpc('no-school-age', city, {
      count: 6,
      familyTypeWeights: MARRIED_WITH_CHILDREN_FAMILIES,
      familyChildCountWeights: [
        { count: 4, weight: 1 }
      ],
      initialUpdate: false
    }, (candidate) => candidate.age >= 6 && candidate.age < 18)

    expect(npc.work).toBeNull()
    expect(npc.timetable.elements.map((element) => element.id)).toEqual(['home'])
    expect(npc.timetable.elements[0]).toMatchObject({
      buildingId: npc.home,
      startHour: 0,
      endHour: 0
    })

    simulation.destroy()
  })

  it('routes from home to the work entrance when the work timetable becomes active', () => {
    const city = createCityWithBuildingTypes()
    const clock = createMutableClock(8)
    const simulation = createSimulation('route-to-work', city, {
      count: 1,
      clock,
      scheduleVariationHours: 0,
      initialUpdate: false
    })
    const npc = simulation.npcs[0]

    expect(npc.present).toBe(false)
    expect(npc.locationState.buildingId).toBe(npc.home)

    clock.hour = 10
    simulation.update(1 / 60)

    expect(npc.present).toBe(true)
    expect(npc.goal).toMatchObject({ id: 'work', buildingId: npc.work })
    expect(npc.routing.destination).toMatchObject(npc.goal.location)
    expect(npc.routing.destinationIndex).toBe(city.index(npc.goal.location.x, npc.goal.location.y))
    expect(npc.routing.routeField).toBeTruthy()

    simulation.destroy()
  })

  it('waits inside the origin building while a car commute is pending', () => {
    const city = createCityWithBuildingTypes()
    const clock = createMutableClock(8)
    const simulation = createSimulation('wait-for-car', city, {
      count: 1,
      clock,
      scheduleVariationHours: 0,
      initialUpdate: false
    })
    const npc = simulation.npcs[0]

    npc.waitingForCar = true
    clock.hour = 10
    simulation.update(1 / 60)

    expect(npc.goal).toMatchObject({ id: 'work', buildingId: npc.work })
    expect(npc.present).toBe(false)
    expect(npc.locationState).toMatchObject({ buildingId: npc.home })
    expect(npc.routing.routeField).toBeNull()

    simulation.destroy()
  })

  it('enters the work building after reaching the routed entrance', () => {
    const city = createCityWithBuildingTypes()
    const clock = createMutableClock(8)
    const simulation = createSimulation('arrive-work', city, {
      count: 1,
      clock,
      scheduleVariationHours: 0,
      initialUpdate: false
    })
    const npc = simulation.npcs[0]

    clock.hour = 10

    for (let step = 0; step < 420 && npc.locationState?.buildingId !== npc.work; step += 1) {
      simulation.update(1 / 60)
    }

    expect(npc.present).toBe(false)
    expect(npc.locationState).toMatchObject({
      timetableElementId: 'work',
      buildingId: npc.work,
      location: npc.goal.location
    })

    simulation.destroy()
  })

  it('treats building entrance tiles as unlimited capacity while NPCs enter and exit buildings', () => {
    const city = createCityWithSharedBuildings()
    const clock = createMutableClock(8)
    const simulation = createSimulation('shared-entrances', city, {
      count: 4,
      clock,
      familyTypeWeights: SINGLE_ADULT_FAMILIES,
      scheduleVariationHours: 0,
      initialUpdate: false
    })

    expect(simulation.npcs.every((npc) => npc.present === false && npc.locationState.buildingId === 'home-1')).toBe(true)

    clock.hour = 10
    simulation.update(1 / 60)

    expect(simulation.npcs.every((npc) => npc.present)).toBe(true)
    expect(simulation.npcs.every((npc) => npc.tile.x === 1 && npc.tile.y === 1)).toBe(true)
    expect(simulation.npcs.every((npc) => !Object.prototype.hasOwnProperty.call(npc.slot, 'index'))).toBe(true)

    simulation.destroy()
  })

  it('recreates the same spawn and first movement state with the same seed', () => {
    const first = createSimulation('repeatable')
    const second = createSimulation('repeatable')

    expect(snapshot(first)).toEqual(snapshot(second))

    first.destroy()
    second.destroy()
  })

  it('changes spawn or speed state when the seed changes', () => {
    const first = createSimulation('repeatable')
    const second = createSimulation('different')

    expect(snapshot(first)).not.toEqual(snapshot(second))

    first.destroy()
    second.destroy()
  })
})
