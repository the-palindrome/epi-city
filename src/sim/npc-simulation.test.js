import { describe, expect, it, vi } from 'vitest'
import { NPC_CONFIG } from '../core/constants.js'
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
      defaultType: 'residential',
      items: [
        { id: 'home-1', type: 'residential', entrance: { x: 1, y: 1 }, spans: [[1, 1, 1]] },
        { id: 'home-2', type: 'residential', entrance: { x: 3, y: 1 }, spans: [[1, 3, 1]] },
        { id: 'work-1', type: 'commercial', entrance: { x: 5, y: 1 }, spans: [[1, 5, 1]] },
        { id: 'work-2', type: 'commercial', entrance: { x: 7, y: 1 }, spans: [[1, 7, 1]] }
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
      defaultType: 'residential',
      items: [
        { id: 'home-1', type: 'residential', entrance: { x: 1, y: 1 }, spans: [[1, 1, 1]] },
        { id: 'work-1', type: 'commercial', entrance: { x: 3, y: 1 }, spans: [[1, 3, 1]] }
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

function createSimulation(seed, city = createCity(), options = {}) {
  const simulation = createNpcSimulation(city, createActorLayer(), {
    count: options.count || 8,
    zorder: 1,
    tileCapacity: options.tileCapacity ?? NPC_CONFIG.tileCapacity,
    maxVisiblePerTile: options.maxVisiblePerTile ?? NPC_CONFIG.maxVisiblePerTile,
    slotSpacing: NPC_CONFIG.slotSpacing,
    color: 0xe5c748,
    size: NPC_CONFIG.size,
    minSpeed: 34,
    maxSpeed: 58,
    workStartHour: 9,
    workEndHour: 17,
    scheduleVariationHours: options.scheduleVariationHours ?? 0.75,
    routePlanBudget: options.routePlanBudget || 24,
    routeRetrySeconds: 1,
    routeBlockedReplanSeconds: 2,
    initialInfectiousCount: options.initialInfectiousCount ?? 0,
    infectionDistance: options.infectionDistance ?? 48,
    infectionProbability: options.infectionProbability ?? 0.03,
    incubationDays: options.incubationDays ?? 5,
    infectionDays: options.infectionDays ?? 7,
    immunityDays: options.immunityDays ?? 90,
    infectionColors: options.infectionColors,
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
    expect(simulation.npcs.every((npc) => npc.slot.index === -1)).toBe(true)
    expect(simulation.npcs.every((npc) => npc.slot.id >= 0 && npc.slot.id < simulation.tileCapacity)).toBe(true)
    expect(simulation.npcs.every((npc) => npc.tile.x === 0 && npc.tile.y === 0)).toBe(true)
    expect(simulation.npcs.every((npc) => (
      npc.position.x >= minCenter &&
      npc.position.x <= maxCenter &&
      npc.position.y >= minCenter &&
      npc.position.y <= maxCenter
    ))).toBe(true)
    expect(simulation.graphics.drawnRects).toBe(NPC_CONFIG.maxVisiblePerTile * 2)

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
    npc.slot = { id: 0, index: -1 }
    npc.movement.target = null

    simulation.update(1 / 60)

    expect(npc.movement.target).toBeNull()
    expect(npc.tile).toMatchObject({ x: 0, y: 0, index: 0 })

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

    expect(simulation.graphics.fills.map((fill) => fill.color)).toEqual([
      colors.susceptible,
      colors.susceptible,
      colors.exposed,
      colors.exposed,
      colors.infectious,
      colors.infectious,
      colors.recovered,
      colors.recovered
    ])

    simulation.destroy()
  })

  it('assigns each NPC a residential home and commercial work building', () => {
    const city = createCityWithBuildingTypes()
    const simulation = createSimulation('building-assignments', city)
    const repeated = createSimulation('building-assignments', city)
    const homeIds = new Set(['home-1', 'home-2'])
    const workIds = new Set(['work-1', 'work-2'])
    const assignments = simulation.npcs.map((npc) => ({ home: npc.home, work: npc.work }))

    expect(simulation.npcs.every((npc) => homeIds.has(npc.home))).toBe(true)
    expect(simulation.npcs.every((npc) => workIds.has(npc.work))).toBe(true)
    expect(assignments).toEqual(repeated.npcs.map((npc) => ({ home: npc.home, work: npc.work })))

    simulation.destroy()
    repeated.destroy()
  })

  it('creates timetable elements that target home and work entrances', () => {
    const city = createCityWithBuildingTypes()
    const simulation = createSimulation('timetable', city, {
      count: 1,
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
      scheduleVariationHours: 0,
      initialUpdate: false
    })

    expect(simulation.npcs.every((npc) => npc.present === false && npc.locationState.buildingId === 'home-1')).toBe(true)

    clock.hour = 10
    simulation.update(1 / 60)

    expect(simulation.npcs.every((npc) => npc.present)).toBe(true)
    expect(simulation.npcs.every((npc) => npc.tile.x === 1 && npc.tile.y === 1)).toBe(true)
    expect(simulation.npcs.every((npc) => npc.slot.index === -1)).toBe(true)

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
