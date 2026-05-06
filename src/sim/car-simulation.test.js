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
      const rect = this.rects[this.rects.length - 1]
      return {
        fill(options) {
          rect.fill = options
        }
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

function createFirstEdgeCrosswalkCity() {
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
        { id: 'home', type: 'residential', entrance: { x: 2, y: 1 }, spans: [[1, 2, 1]] },
        { id: 'work', type: 'commercial', entrance: { x: 5, y: 1 }, spans: [[1, 5, 1]] }
      ]
    },
    rows: [
      'sssssss',
      'ssbssbs',
      'ppppppp',
      'rrrcrrr',
      'sssssss'
    ],
    textureRows: [
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 1, 0, 0, 1, 0],
      [0, 0, 0, 0, 0, 0, 0],
      [2, 2, 2, 3, 2, 2, 2],
      [0, 0, 0, 0, 0, 0, 0]
    ],
    laneGraph: createLineLaneGraph(7, 3)
  }))
}

function createLaneChangeTrafficCity() {
  return compileCityMap(validateCityMap({
    width: 8,
    height: 6,
    tileSize: 32,
    textureSet: 'test',
    legend: {
      s: { category: 'sidewalk', walkable: true, drivable: false, parkable: false },
      p: { category: 'sidewalk', walkable: true, drivable: false, parkable: true },
      r: { category: 'road', walkable: false, drivable: true, parkable: false },
      b: { category: 'building', walkable: false, drivable: false, parkable: false }
    },
    buildings: {
      encoding: 'row-spans-v1',
      defaultType: 'residential',
      items: [
        { id: 'home', type: 'residential', entrance: { x: 1, y: 1 }, spans: [[1, 1, 1]] },
        { id: 'work', type: 'commercial', entrance: { x: 6, y: 5 }, spans: [[5, 6, 1]] }
      ]
    },
    rows: [
      'ssssssss',
      'sbssssss',
      'pprrrrrr',
      'rrrrrrss',
      'ssssppss',
      'ssssssbs'
    ],
    textureRows: [
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 1, 0, 0, 0, 0, 0, 0],
      [0, 0, 2, 2, 2, 2, 2, 2],
      [2, 2, 2, 2, 2, 2, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 1, 0]
    ],
    laneGraph: createLaneChangeTrafficLaneGraph()
  }))
}

function createTrafficSignalCity() {
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
      'sssrsss',
      'sbsrsbs',
      'ppprppp',
      'rrrcrrr',
      'sssrsss'
    ],
    textureRows: [
      [0, 0, 0, 2, 0, 0, 0],
      [0, 1, 0, 2, 0, 1, 0],
      [0, 0, 0, 2, 0, 0, 0],
      [2, 2, 2, 3, 2, 2, 2],
      [0, 0, 0, 2, 0, 0, 0]
    ],
    laneGraph: createTrafficSignalLaneGraph()
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

function createTrafficSignalLaneGraph() {
  const nodes = []
  const edges = []
  const nodeIds = new Map()

  function ensureNode(x, y, direction) {
    const key = `${x},${y}`
    const existing = nodeIds.get(key)

    if (existing) {
      return existing
    }

    const node = {
      id: `node-${x}-${y}`,
      x: x + 0.5,
      y: y + 0.5,
      tile: { x, y },
      direction
    }

    nodeIds.set(key, node)
    nodes.push(node)
    return node
  }

  for (let x = 0; x < 7; x += 1) {
    ensureNode(x, 3, 'east')
  }

  for (let y = 0; y < 5; y += 1) {
    ensureNode(3, y, 'south')
  }

  for (let x = 0; x < 6; x += 1) {
    edges.push(createLaneEdge(`east-${x}`, `node-${x}-3`, `node-${x + 1}-3`, 'east', x, 3, x + 1, 3))
    edges.push(createLaneEdge(`west-${x + 1}`, `node-${x + 1}-3`, `node-${x}-3`, 'west', x + 1, 3, x, 3))
  }

  for (let y = 0; y < 4; y += 1) {
    edges.push(createLaneEdge(`south-${y}`, `node-3-${y}`, `node-3-${y + 1}`, 'south', 3, y, 3, y + 1))
    edges.push(createLaneEdge(`north-${y + 1}`, `node-3-${y + 1}`, `node-3-${y}`, 'north', 3, y + 1, 3, y))
  }

  return {
    encoding: 'directed-lanes-v1',
    drivingSide: 'right',
    coordinateSpace: 'tile',
    nodes,
    edges,
    trafficSignals: {
      encoding: 'traffic-signals-v1',
      overrides: [
        { id: 'traffic-signal-3-3', tile: { x: 3, y: 3 }, phaseOffset: 0 }
      ]
    }
  }
}

function createGeneratedLaneChangeCity(laneGraph) {
  return compileCityMap(validateCityMap({
    width: 6,
    height: 3,
    tileSize: 32,
    textureSet: 'test',
    legend: {
      r: { category: 'road', walkable: false, drivable: true, parkable: false }
    },
    rows: [
      'rrrrrr',
      'rrrrrr',
      'rrrrrr'
    ],
    textureRows: [
      [0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0]
    ],
    laneGraph
  }))
}

function createParallelLaneGraph({ bottomDirection = 'east' } = {}) {
  const nodes = []
  const edges = []

  for (let x = 0; x < 6; x += 1) {
    nodes.push({ id: `upper-${x}`, x: x + 0.5, y: 0.5, tile: { x, y: 0 }, direction: 'east' })
    nodes.push({ id: `lower-${x}`, x: x + 0.5, y: 1.5, tile: { x, y: 1 }, direction: bottomDirection })
  }

  for (let x = 0; x < 5; x += 1) {
    edges.push(createLaneEdge(`upper-${x}-${x + 1}`, `upper-${x}`, `upper-${x + 1}`, 'east', x, 0, x + 1, 0))

    if (bottomDirection === 'east') {
      edges.push(createLaneEdge(`lower-${x}-${x + 1}`, `lower-${x}`, `lower-${x + 1}`, 'east', x, 1, x + 1, 1))
    } else {
      edges.push(createLaneEdge(`lower-${x + 1}-${x}`, `lower-${x + 1}`, `lower-${x}`, 'west', x + 1, 1, x, 1))
    }
  }

  return {
    encoding: 'directed-lanes-v1',
    drivingSide: 'right',
    coordinateSpace: 'tile',
    nodes,
    edges
  }
}

function createSameComponentLaneChangeLoopGraph() {
  const nodes = []
  const edges = []

  for (let x = 0; x < 6; x += 1) {
    nodes.push({ id: `upper-${x}`, x: x + 0.5, y: 0.5, tile: { x, y: 0 }, direction: 'east' })
    nodes.push({ id: `lower-${x}`, x: x + 0.5, y: 1.5, tile: { x, y: 1 }, direction: 'east' })
  }

  for (let x = 0; x < 5; x += 1) {
    edges.push(createLaneEdge(`upper-${x}-${x + 1}`, `upper-${x}`, `upper-${x + 1}`, 'east', x, 0, x + 1, 0))
    edges.push(createLaneEdge(`lower-${x + 1}-${x}`, `lower-${x + 1}`, `lower-${x}`, 'west', x + 1, 1, x, 1))
  }

  edges.push(createLaneEdge('upper-5-lower-5', 'upper-5', 'lower-5', 'south', 5, 0, 5, 1, { type: 'turn', turn: 'merge' }))
  edges.push(createLaneEdge('lower-0-upper-0', 'lower-0', 'upper-0', 'north', 0, 1, 0, 0, { type: 'turn', turn: 'merge' }))

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

function createLaneChangeTrafficLaneGraph() {
  const nodes = []
  const edges = []

  for (let x = 2; x < 8; x += 1) {
    nodes.push({ id: `upper-${x}`, x: x + 0.5, y: 2.5, tile: { x, y: 2 }, direction: 'east' })
  }

  for (let x = 0; x < 6; x += 1) {
    nodes.push({ id: `lower-${x}`, x: x + 0.5, y: 3.5, tile: { x, y: 3 }, direction: 'east' })
  }

  for (let x = 2; x < 7; x += 1) {
    edges.push(createLaneEdge(`upper-${x}-${x + 1}`, `upper-${x}`, `upper-${x + 1}`, 'east', x, 2, x + 1, 2))
  }

  for (let x = 0; x < 5; x += 1) {
    edges.push(createLaneEdge(`lower-${x}-${x + 1}`, `lower-${x}`, `lower-${x + 1}`, 'east', x, 3, x + 1, 3))
  }

  return {
    encoding: 'directed-lanes-v1',
    drivingSide: 'right',
    coordinateSpace: 'tile',
    nodes,
    edges
  }
}

function routeEdgeIds(planner, startNodeId, endNodeId) {
  const nodeIndexes = new Map(planner.network.laneGraph.nodes.map((node, index) => [node.id, index]))
  const route = planner.findRoute(nodeIndexes.get(startNodeId), nodeIndexes.get(endNodeId))

  return route.map((edgeIndex) => planner.network.edges[edgeIndex].id)
}

function routeEdges(planner, startNodeId, endNodeId) {
  const nodeIndexes = new Map(planner.network.laneGraph.nodes.map((node, index) => [node.id, index]))
  const route = planner.findRoute(nodeIndexes.get(startNodeId), nodeIndexes.get(endNodeId))

  return route.map((edgeIndex) => planner.network.edges[edgeIndex])
}

function routeIndexesByEdgeId(network, edgeIds) {
  return edgeIds.map((edgeId) => {
    const edgeIndex = network.edges.findIndex((edge) => edge.id === edgeId)

    expect(edgeIndex).toBeGreaterThanOrEqual(0)
    return edgeIndex
  })
}

function isGeneratedLaneChangeEdge(edge) {
  return edge !== null && edge !== undefined && (
    edge.type === 'lane-change' ||
    edge.turn === 'lane-change' ||
    edge.generated === 'lane-change' ||
    edge.id.includes('lane-change')
  )
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
    expect(simulation.graphics.rects.length).toBeGreaterThan(simulation.cars.length * 10)
    expect(simulation.graphics.rects.some((rect) => rect.fill?.color === simulation.cars[0].color)).toBe(true)

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

  it('does not occupy a red first crosswalk edge before movement starts', () => {
    const city = createFirstEdgeCrosswalkCity()
    const simulation = createCarSimulation(city, createEntityLayer(), {
      count: 1,
      clock: createClock(8.5),
      random: createSeededRandom('first-crosswalk'),
      commuteChance: 1,
      twoOwnerChance: 0,
      twoTileChance: 1,
      maxSpeed: 10,
      speedLimitScale: 1
    })
    const car = simulation.cars[0]
    const crosswalkIndex = city.index(3, 3)

    city.setCrosswalkSignalState('red')
    simulation.update(0.1)

    expect(car.state).toBe('driving')
    expect(car.movement).toBeNull()
    expect(car.occupiedTiles).not.toContain(crosswalkIndex)
    expect(car.occupiedTiles.every((tileIndex) => city.tileParkable[tileIndex] === 1)).toBe(true)

    city.setCrosswalkSignalState('green')
    simulation.update(0.1)

    expect(car.movement).not.toBeNull()
    expect(car.occupiedTiles).toContain(crosswalkIndex)

    simulation.destroy()
  })

  it('keeps the car footprint to its body length during generated lane changes', () => {
    const city = createLaneChangeTrafficCity()
    const simulation = createCarSimulation(city, createEntityLayer(), {
      count: 1,
      clock: createClock(8.5),
      random: createSeededRandom('lane-change-drive'),
      commuteChance: 1,
      twoOwnerChance: 0,
      twoTileChance: 1,
      maxSpeed: 10,
      speedLimitScale: 1
    })
    const car = simulation.cars[0]

    simulation.update(0.1)

    expect(car.state).toBe('driving')
    expect(car.movement?.edge.type).toBe('lane-change')
    expect(car.movement.edge.sweptTiles.length).toBeGreaterThan(car.lengthTiles)
    expect(car.occupiedTiles).toHaveLength(car.lengthTiles)
    expect(new Set(car.occupiedTiles).size).toBe(car.lengthTiles)

    simulation.destroy()
  })

  it('waits before entering an intersection traffic signal and proceeds on the matching green phase', () => {
    const city = createTrafficSignalCity()
    const simulation = createCarSimulation(city, createEntityLayer(), {
      count: 1,
      clock: createClock(8.5),
      random: createSeededRandom('traffic-signal'),
      commuteChance: 1,
      twoOwnerChance: 0,
      twoTileChance: 1,
      maxSpeed: 1000,
      speedLimitScale: 100
    })
    const car = simulation.cars[0]
    const signalTileIndex = city.index(3, 3)

    city.setCrosswalkSignalState('green')
    city.resetTrafficSignals()
    simulation.update(0.1)

    expect(car.state).toBe('driving')
    expect(car.movement).toBeNull()
    expect(car.occupiedTiles).not.toContain(signalTileIndex)
    expect(city.getTrafficSignalState('traffic-signal-3-3')).toMatchObject({
      movement: 'north-south',
      state: 'green'
    })

    city.updateTrafficSignals(9)
    simulation.update(0.01)

    expect(city.getTrafficSignalState('traffic-signal-3-3')).toMatchObject({
      movement: 'east-west',
      state: 'green'
    })
    expect(car.movement?.edge.id).toBe('east-2')
    expect(car.occupiedTiles).toContain(signalTileIndex)

    simulation.destroy()
  })

  it('waits before a green intersection when the exit clearance is blocked', () => {
    const city = createTrafficSignalCity()
    const simulation = createCarSimulation(city, createEntityLayer(), {
      count: 1,
      clock: createClock(8.5),
      random: createSeededRandom('traffic-signal-clearance'),
      commuteChance: 1,
      twoOwnerChance: 0,
      twoTileChance: 1,
      maxSpeed: 1000,
      speedLimitScale: 100
    })
    const car = simulation.cars[0]
    const blocker = { id: 999, occupiedTiles: [] }
    const signalTileIndex = city.index(3, 3)

    city.setCrosswalkSignalState('green')
    city.resetTrafficSignals()
    city.updateTrafficSignals(9)
    simulation.parking.occupyTiles(blocker, [city.index(5, 3)])
    simulation.update(0.1)

    expect(car.state).toBe('driving')
    expect(car.movement).toBeNull()
    expect(car.occupiedTiles).not.toContain(signalTileIndex)

    simulation.parking.releaseOccupiedTiles(blocker)
    simulation.update(0.01)

    expect(car.movement?.edge.id).toBe('east-2')
    expect(car.occupiedTiles).toContain(signalTileIndex)

    simulation.destroy()
  })

  it('uses the right-hand rule so a left turn yields to oncoming straight traffic', () => {
    const city = createTrafficSignalCity()
    const simulation = createCarSimulation(city, createEntityLayer(), {
      count: 0,
      clock: createClock(8.5),
      random: createSeededRandom('right-hand-rule'),
      commuteChance: 1,
      twoOwnerChance: 0,
      twoTileChance: 1,
      maxSpeed: 1000,
      speedLimitScale: 100
    })
    const network = simulation.router.network
    const leftEntryEdge = routeIndexesByEdgeId(network, ['east-2'])[0]
    const straightEntryEdge = routeIndexesByEdgeId(network, ['west-4'])[0]
    const leftTurningCar = {
      id: 1,
      owners: [],
      state: 'driving',
      route: {
        edges: routeIndexesByEdgeId(network, ['east-2', 'north-3', 'north-2']),
        cursor: 0,
        currentNode: network.edgeFrom[leftEntryEdge]
      },
      movement: null,
      trafficSignalReservation: null,
      lengthTiles: 2,
      occupiedTiles: [],
      direction: { dx: 1, dy: 0 }
    }
    const straightCar = {
      id: 2,
      owners: [],
      state: 'driving',
      route: {
        edges: routeIndexesByEdgeId(network, ['west-4', 'west-3', 'west-2']),
        cursor: 0,
        currentNode: network.edgeFrom[straightEntryEdge]
      },
      movement: null,
      trafficSignalReservation: null,
      lengthTiles: 2,
      occupiedTiles: [],
      direction: { dx: -1, dy: 0 }
    }

    simulation.cars.push(leftTurningCar, straightCar)
    simulation.parking.occupyTiles(straightCar, [city.index(4, 3), city.index(5, 3)])
    city.setCrosswalkSignalState('green')
    city.resetTrafficSignals()
    city.updateTrafficSignals(9)
    simulation.update(0.01)

    expect(leftTurningCar.movement).toBeNull()
    expect(leftTurningCar.occupiedTiles).not.toContain(city.index(3, 3))
    expect(straightCar.movement?.edge.id).toBe('west-4')
    expect(straightCar.occupiedTiles).toContain(city.index(3, 3))

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
    const routeIds = route.map((edgeIndex) => planner.network.edges[edgeIndex].id)

    expect(routeIds).toEqual(['a-b', 'b-d'])
  })
})

describe('generated lane-change maneuver routing', () => {
  it('routes between nearby parallel lane components using generated lane-change edges', () => {
    const city = createGeneratedLaneChangeCity(createParallelLaneGraph())
    const planner = createCarRoutePlanner(city)
    const routeEdgesResult = routeEdges(planner, 'upper-0', 'lower-5')

    expect(routeEdgesResult.length).toBeGreaterThan(0)
    expect(routeEdgesResult.some((edge) => isGeneratedLaneChangeEdge(edge))).toBe(true)
    expect(planner.network.generatedLaneChangeEdgeCount).toBeGreaterThan(0)
  })

  it('chooses the lowest-distance generated lane change instead of the earliest maneuver', () => {
    const city = createGeneratedLaneChangeCity(createParallelLaneGraph())
    const planner = createCarRoutePlanner(city)

    expect(routeEdgeIds(planner, 'upper-0', 'lower-5')).toEqual(['generated-lane-change-upper-0-lower-5'])
  })

  it('uses same-component lane changes when they make the route shorter', () => {
    const city = createGeneratedLaneChangeCity(createSameComponentLaneChangeLoopGraph())
    const planner = createCarRoutePlanner(city)

    expect(routeEdgeIds(planner, 'upper-0', 'lower-1')).toEqual([
      'generated-lane-change-upper-0-lower-3',
      'lower-3-2',
      'lower-2-1'
    ])
  })

  it('does not generate lane changes between lanes facing opposite directions', () => {
    const city = createGeneratedLaneChangeCity(createParallelLaneGraph({ bottomDirection: 'west' }))
    const planner = createCarRoutePlanner(city)
    const laneChangeEdges = planner.network.edges.filter(isGeneratedLaneChangeEdge)

    expect(laneChangeEdges).toHaveLength(0)
    expect(routeEdgeIds(planner, 'upper-0', 'lower-0')).toEqual([])
  })

  it('does not generate one-tile lateral switches between parallel lanes', () => {
    const city = createGeneratedLaneChangeCity(createParallelLaneGraph())
    const planner = createCarRoutePlanner(city)
    const sharpSwitches = planner.network.edges.filter((edge) => {
      if (!isGeneratedLaneChangeEdge(edge)) {
        return false
      }

      const from = edge.fromNode.tile
      const to = edge.toNode.tile

      return Math.abs(from.x - to.x) === 0 && Math.abs(from.y - to.y) === 1
    })

    expect(sharpSwitches).toEqual([])
  })

  it('defers a blocked generated lane change by moving forward in the current lane', () => {
    const city = createGeneratedLaneChangeCity(createParallelLaneGraph())
    const simulation = createCarSimulation(city, createEntityLayer(), {
      count: 0,
      maxSpeed: 1000,
      speedLimitScale: 100
    })
    const network = simulation.router.network
    const nodeIndexes = new Map(network.laneGraph.nodes.map((node, index) => [node.id, index]))
    const startNode = nodeIndexes.get('upper-0')
    const destinationNode = nodeIndexes.get('lower-5')
    const laneChangeEdgeIndex = network.edges.findIndex((edge) => edge.id === 'generated-lane-change-upper-0-lower-3')
    const forwardEdgeIndex = network.edges.findIndex((edge) => edge.id === 'upper-0-1')
    const tail = simulation.router.findRoute(nodeIndexes.get('lower-3'), destinationNode)
    const car = {
      id: 1,
      owners: [],
      state: 'driving',
      route: {
        edges: [laneChangeEdgeIndex, ...tail],
        cursor: 0,
        currentNode: startNode,
        destinationNode
      },
      movement: null,
      trafficSignalReservation: null,
      lengthTiles: 2,
      occupiedTiles: [],
      direction: { dx: 1, dy: 0 }
    }
    const blocker = { id: 2, occupiedTiles: [] }

    expect(laneChangeEdgeIndex).toBeGreaterThanOrEqual(0)
    expect(forwardEdgeIndex).toBeGreaterThanOrEqual(0)
    expect(isGeneratedLaneChangeEdge(network.edges[laneChangeEdgeIndex])).toBe(true)

    simulation.cars.push(car)
    simulation.parking.occupyTiles(car, [city.index(0, 0)])
    simulation.parking.occupyTiles(blocker, [city.index(1, 1)])
    simulation.update(0.01)

    expect(car.movement?.edgeIndex).toBe(forwardEdgeIndex)
    expect(car.route.destinationNode).toBe(destinationNode)

    simulation.destroy()
  })
})
