import { describe, expect, it, vi } from 'vitest'
import { createSeededRandom } from '../core/random.js'
import { compileCityMap, validateCityMap } from '../map/city-map.js'
import { createCarRoutePlanner, createCarSimulation } from './car-simulation.js'
import { createNpcSimulation } from './npc-simulation.js'

vi.mock('pixi.js', () => ({
  Graphics: class {
    constructor() {
      this.eventMode = 'auto'
      this.parent = null
      this.rects = []
    }

    clear() {
      this.rects.length = 0
    }

    rect(x, y, width, height) {
      this.rects.push({ x, y, width, height })
      return {
        fill() {}
      }
    }

    destroy() {
      this.destroyed = true
    }
  }
}))

function createEntityLayer() {
  return {
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
    getTimeOfDayHours() {
      return this.hour
    }
  }
}

function createNpcSimulationForTraffic(city, clock) {
  return createNpcSimulation(city, createEntityLayer(), {
    count: 1,
    zorder: 1,
    tileCapacity: 9,
    maxVisiblePerTile: 9,
    slotSpacing: 11,
    color: 0xe5c748,
    size: 9,
    minSpeed: 34,
    maxSpeed: 58,
    workStartHour: 9,
    workEndHour: 17,
    scheduleVariationHours: 0,
    routePlanBudget: 24,
    routeRetrySeconds: 1,
    routeBlockedReplanSeconds: 2,
    clock,
    random: createSeededRandom('npc-car-owner')
  })
}

function createTrafficCity() {
  return compileCityMap(validateCityMap({
    width: 7,
    height: 5,
    tileSize: 32,
    textureSet: 'test',
    legend: {
      s: { category: 'sidewalk', walkable: true, drivable: false, parkable: false },
      p: { category: 'sidewalk', walkable: true, drivable: false, parkable: true },
      r: { category: 'road', walkable: false, drivable: true, parkable: false },
      c: { category: 'crosswalk', walkable: true, drivable: true, parkable: false },
      b: { category: 'building', walkable: false, drivable: false, parkable: false }
    },
    buildings: {
      encoding: 'row-spans-v1',
      defaultType: 'residential',
      items: [
        { id: 'home', type: 'residential', entrance: { x: 1, y: 1 }, spans: [[1, 1, 1]] },
        { id: 'work', type: 'commercial', entrance: { x: 5, y: 1 }, spans: [[1, 5, 1]] }
      ]
    },
    rows: [
      'sssssss',
      'sbsssbs',
      'ppppppp',
      'rrrcrrr',
      'sssssss'
    ],
    textureRows: [
      [0, 0, 0, 0, 0, 0, 0],
      [0, 1, 0, 0, 0, 1, 0],
      [0, 0, 0, 0, 0, 0, 0],
      [2, 2, 2, 3, 2, 2, 2],
      [0, 0, 0, 0, 0, 0, 0]
    ],
    laneGraph: createLineLaneGraph(7, 3)
  }))
}

function createLineLaneGraph(width, y) {
  const nodes = []
  const edges = []

  for (let x = 0; x < width; x += 1) {
    nodes.push({ id: `lane-${x}`, x: x + 0.5, y: y + 0.5, tile: { x, y }, direction: 'east' })
  }

  for (let x = 0; x < width - 1; x += 1) {
    edges.push(createLaneEdge(`east-${x}`, `lane-${x}`, `lane-${x + 1}`, 'east', x, y, x + 1, y))
    edges.push(createLaneEdge(`west-${x + 1}`, `lane-${x + 1}`, `lane-${x}`, 'west', x + 1, y, x, y))
  }

  return {
    encoding: 'directed-lanes-v1',
    drivingSide: 'right',
    coordinateSpace: 'tile',
    nodes,
    edges
  }
}

function createLaneEdge(id, from, to, direction, fromX, fromY, toX, toY, options = {}) {
  return {
    id,
    from,
    to,
    type: options.type || 'lane',
    direction,
    turn: options.turn,
    speedLimit: options.speedLimit || 28,
    path: [[fromX + 0.5, fromY + 0.5], [toX + 0.5, toY + 0.5]]
  }
}

describe('car simulation', () => {
  it('creates parked cars with one or two owners from the same home building', () => {
    const city = createTrafficCity()
    const simulation = createCarSimulation(city, createEntityLayer(), {
      count: 2,
      random: createSeededRandom('cars'),
      twoOwnerChance: 1,
      commuteChance: 0
    })

    expect(simulation.cars).toHaveLength(2)

    for (const car of simulation.cars) {
      expect(car.state).toBe('parked')
      expect(car.owners).toHaveLength(2)
      expect(car.owners.every((owner) => owner.homeBuildingId === car.homeBuildingId)).toBe(true)
      expect(car.occupiedTiles).toHaveLength(car.lengthTiles)
    }

    const occupiedTiles = simulation.cars.flatMap((car) => car.occupiedTiles)
    expect(new Set(occupiedTiles).size).toBe(occupiedTiles.length)

    simulation.render()
    expect(simulation.graphics.rects).toHaveLength(2)

    simulation.destroy()
  })

  it('drives commuting owners to work and parks near the destination', () => {
    const city = createTrafficCity()
    const simulation = createCarSimulation(city, createEntityLayer(), {
      count: 1,
      clock: createClock(8.5),
      random: createSeededRandom('commute'),
      commuteChance: 1,
      twoOwnerChance: 0,
      twoTileChance: 1,
      maxSpeed: 1000,
      speedLimitScale: 100
    })
    const car = simulation.cars[0]

    city.setCrosswalkSignalState('green')

    for (let step = 0; step < 20 && car.parkedAt !== 'work'; step += 1) {
      simulation.update(0.1)
    }

    expect(car.state).toBe('parked')
    expect(car.parkedAt).toBe('work')
    expect(car.parkedBuildingId).toBe('work')
    expect(car.occupiedTiles.every((tileIndex) => city.tileParkable[tileIndex] === 1)).toBe(true)

    simulation.destroy()
  })

  it('binds car owners to real NPCs so commuters ride instead of walking', () => {
    const city = createTrafficCity()
    const clock = createClock(8)
    const npcSimulation = createNpcSimulationForTraffic(city, clock)
    const npc = npcSimulation.npcs[0]
    const simulation = createCarSimulation(city, createEntityLayer(), {
      count: 1,
      clock,
      random: createSeededRandom('real-owner'),
      npcs: npcSimulation.npcs,
      commuteChance: 1,
      twoOwnerChance: 0,
      twoTileChance: 1,
      maxSpeed: 1000,
      speedLimitScale: 100
    })
    const car = simulation.cars[0]

    expect(car.owners[0].npc).toBe(npc)
    expect(npc.carId).toBe(car.id)
    expect(npc.commuteByCar).toBe(true)
    expect(npc.locationState.buildingId).toBe(npc.home)

    city.setCrosswalkSignalState('green')
    clock.hour = 9.5
    simulation.update(0.1)
    npcSimulation.update(0.1)

    expect(car.state).toBe('driving')
    expect(npc.vehicleTrip).toMatchObject({
      carId: car.id,
      destinationKind: 'work',
      destinationBuildingId: npc.work
    })
    expect(npc.present).toBe(false)
    expect(npc.locationState).toBeNull()

    for (let step = 0; step < 20 && car.parkedAt !== 'work'; step += 1) {
      simulation.update(0.1)
      npcSimulation.update(0.1)
    }

    expect(car.parkedAt).toBe('work')
    expect(npc.vehicleTrip).toBeNull()
    expect(npc.present).toBe(false)
    expect(npc.locationState).toMatchObject({
      timetableElementId: 'work',
      buildingId: npc.work
    })

    simulation.destroy()
    npcSimulation.destroy()
  })

  it('waits before entering a red crosswalk and can leave after entering', () => {
    const city = createTrafficCity()
    const simulation = createCarSimulation(city, createEntityLayer(), {
      count: 1,
      clock: createClock(8.5),
      random: createSeededRandom('crosswalk'),
      commuteChance: 1,
      twoOwnerChance: 0,
      twoTileChance: 1,
      maxSpeed: 1000,
      speedLimitScale: 100
    })
    const car = simulation.cars[0]
    const crosswalkIndex = city.index(3, 3)

    city.setCrosswalkSignalState('red')
    simulation.update(0.1)

    expect(car.state).toBe('driving')
    expect(car.occupiedTiles).not.toContain(crosswalkIndex)

    city.setCrosswalkSignalState('green')

    for (let step = 0; step < 20 && car.parkedAt !== 'work'; step += 1) {
      simulation.update(0.1)
    }

    expect(car.parkedAt).toBe('work')

    simulation.destroy()
  })

  it('chooses the shortest lane route even when it includes a merge edge', () => {
    const city = compileCityMap(validateCityMap({
      width: 2,
      height: 3,
      tileSize: 32,
      textureSet: 'test',
      legend: {
        r: { category: 'road', walkable: false, drivable: true, parkable: false }
      },
      rows: [
        'rr',
        'rr',
        'rr'
      ],
      textureRows: [
        [0, 0],
        [0, 0],
        [0, 0]
      ],
      laneGraph: {
        encoding: 'directed-lanes-v1',
        drivingSide: 'right',
        coordinateSpace: 'tile',
        nodes: [
          { id: 'a', x: 0.5, y: 2.5, tile: { x: 0, y: 2 }, direction: 'east' },
          { id: 'b', x: 1.5, y: 2.5, tile: { x: 1, y: 2 }, direction: 'north' },
          { id: 'c', x: 0.5, y: 1.5, tile: { x: 0, y: 1 }, direction: 'north' },
          { id: 'e', x: 0.5, y: 0.5, tile: { x: 0, y: 0 }, direction: 'east' },
          { id: 'f', x: 1.5, y: 0.5, tile: { x: 1, y: 0 }, direction: 'south' },
          { id: 'd', x: 1.5, y: 1.5, tile: { x: 1, y: 1 }, direction: 'north' }
        ],
        edges: [
          createLaneEdge('a-b', 'a', 'b', 'east', 0, 2, 1, 2),
          createLaneEdge('b-d', 'b', 'd', 'north', 1, 2, 1, 1, { type: 'turn', turn: 'merge' }),
          createLaneEdge('a-c', 'a', 'c', 'north', 0, 2, 0, 1),
          createLaneEdge('c-e', 'c', 'e', 'north', 0, 1, 0, 0),
          createLaneEdge('e-f', 'e', 'f', 'east', 0, 0, 1, 0),
          createLaneEdge('f-d', 'f', 'd', 'south', 1, 0, 1, 1)
        ]
      }
    }))
    const planner = createCarRoutePlanner(city)
    const nodeIndexes = new Map(planner.network.laneGraph.nodes.map((node, index) => [node.id, index]))
    const route = planner.findRoute(nodeIndexes.get('a'), nodeIndexes.get('d'))
    const routeIds = route.map((edgeIndex) => planner.network.laneGraph.edges[edgeIndex].id)

    expect(routeIds).toEqual(['a-b', 'b-d'])
  })
})
