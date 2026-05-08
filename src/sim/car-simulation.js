import * as PIXI from 'pixi.js'
import { CAR_CONFIG, HOME_BUILDING_TYPES, WORK_BUILDING_TYPES } from '../core/constants.js'
import { IndexPriorityQueue } from '../core/index-priority-queue.js'
import { createSystemRandom } from '../core/random.js'
import { hourInRange } from '../core/time.js'
import { buildingHasAnyType } from '../map/buildings.js'
import { createCarSpriteRenderer } from '../render/car-sprite.js'
import { toSimulationSeconds } from './simulation-clock.js'

const STATIC_CLOCK = Object.freeze({
  getTimeOfDayHours: () => 0
})

const CARDINAL_OFFSETS = Object.freeze([
  Object.freeze({ dx: 1, dy: 0 }),
  Object.freeze({ dx: -1, dy: 0 }),
  Object.freeze({ dx: 0, dy: 1 }),
  Object.freeze({ dx: 0, dy: -1 })
])

const DIRECTION_OFFSET = Object.freeze({
  east: Object.freeze({ dx: 1, dy: 0 }),
  west: Object.freeze({ dx: -1, dy: 0 }),
  south: Object.freeze({ dx: 0, dy: 1 }),
  north: Object.freeze({ dx: 0, dy: -1 })
})

const LANE_CHANGE_MIN_FORWARD_TILES = 3
const LANE_CHANGE_MAX_FORWARD_TILES = 6
const LANE_CHANGE_LATERAL_TILES = 1
const LANE_CHANGE_CURVE_SAMPLES = 9
const LANE_CHANGE_SPEED_LIMIT = 18
const LANE_CHANGE_ADAPTIVE_LOOKAHEAD_EDGES = 2
const LANE_CHANGE_AHEAD_GAP_TILES = 0.5
const MIN_EDGE_DURATION_SECONDS = 0.05
const TRAFFIC_SIGNAL_CLEARANCE_GAP_TILES = 1
const RIGHT_HAND_LOOKAHEAD_EDGES = 6

const RIGHT_TURN_DIRECTION = Object.freeze({
  north: 'east',
  east: 'south',
  south: 'west',
  west: 'north'
})
const LEFT_TURN_DIRECTION = Object.freeze({
  north: 'west',
  west: 'south',
  south: 'east',
  east: 'north'
})
const OPPOSITE_DIRECTION = Object.freeze({
  north: 'south',
  east: 'west',
  south: 'north',
  west: 'east'
})
const DIRECTION_FROM_RIGHT = Object.freeze({
  north: 'west',
  east: 'north',
  south: 'east',
  west: 'south'
})
const TURN_PRIORITY = Object.freeze({
  right: 3,
  straight: 2,
  merge: 2,
  left: 1,
  'u-turn': 0
})

const networkCache = new WeakMap()

export function createCarSimulation(city, entityLayer, config = {}) {
  const resolvedConfig = { ...CAR_CONFIG, ...config }
  const random = resolvedConfig.random || createSystemRandom()
  const clock = resolvedConfig.clock || STATIC_CLOCK
  const network = getCarTrafficNetwork(city)
  const router = createCarRoutePlanner(city, network)
  const parking = new ParkingManager(city, network, resolvedConfig)
  const trafficReservations = new TrafficSignalReservationManager(city)
  const homeBuildings = collectBuildings(city, HOME_BUILDING_TYPES)
  const workBuildings = collectBuildings(city, WORK_BUILDING_TYPES)
  const buildingsById = new Map((city.buildings || []).map((building) => [building.id, building]))
  const ownerPools = collectCarOwnerPools(resolvedConfig.npcs, buildingsById)
  const cars = []
  const context = {
    city,
    clock,
    random,
    network,
    router,
    parking,
    trafficReservations,
    cars,
    buildingsById,
    yieldIndex: null,
    config: resolvedConfig
  }
  let destroyed = false

  entityLayer.eventMode = 'none'
  entityLayer.sortableChildren = true

  for (let id = 0; id < resolvedConfig.count; id += 1) {
    const car = createCarEntity(id, city, homeBuildings, workBuildings, buildingsById, ownerPools, parking, random, resolvedConfig)

    if (!car) {
      break
    }

    cars.push(car)
  }

  const carRenderer = createCarSpriteRenderer(cars, city, resolvedConfig, {
    pixi: PIXI,
    entityDebugOptions: resolvedConfig.entityDebugOptions
  })
  const display = carRenderer.display
  const graphics = carRenderer.spriteDisplay || display

  entityLayer.addChild(display)

  function update(deltaSeconds) {
    if (destroyed || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
      return
    }

    const safeDelta = Math.min(deltaSeconds, 0.1)
    const movementDelta = toSimulationSeconds(clock, safeDelta)
    const hour = clock.getTimeOfDayHours()

    for (const car of cars) {
      clearCarOwnerWaitingState(car)
    }

    for (const car of cars) {
      if (car.state === 'parked') {
        maybeStartCarTrip(car, hour, context)
      }
    }

    context.yieldIndex = createTrafficYieldIndex(context)

    for (const car of cars) {
      if (car.state === 'driving') {
        updateDrivingCar(car, movementDelta, context)
      }
    }

    context.yieldIndex = null
  }

  function render() {
    if (destroyed) {
      return
    }

    carRenderer.render(cars)
  }

  function setEntityRenderMode(mode) {
    if (typeof carRenderer.setRenderMode === 'function') {
      carRenderer.setRenderMode(mode)
      render()
    }
  }

  function setEntityDebugOptions(options) {
    if (typeof carRenderer.setDebugOptions === 'function') {
      carRenderer.setDebugOptions(options)
      render()
    }
  }

  render()

  return {
    cars,
    graphics,
    parking,
    router,
    update,
    render,
    setEntityRenderMode,
    setEntityDebugOptions,
    destroy() {
      destroyed = true
      trafficReservations.clear()
      parking.clear()
      carRenderer.destroy()
    }
  }
}

class CarRoutePlanner {
  constructor(network) {
    this.network = network
    this.routeFields = new Map()
  }

  findRoute(startNodeIndex, endNodeIndex) {
    if (!Number.isInteger(startNodeIndex) ||
        !Number.isInteger(endNodeIndex) ||
        startNodeIndex < 0 ||
        endNodeIndex < 0 ||
        startNodeIndex >= this.network.nodeCount ||
        endNodeIndex >= this.network.nodeCount) {
      return []
    }

    if (startNodeIndex === endNodeIndex) {
      return []
    }

    const field = this.getRouteField(endNodeIndex)
    return extractLaneRoute(field, startNodeIndex, endNodeIndex, this.network)
  }

  getRouteField(endNodeIndex) {
    const cached = this.routeFields.get(endNodeIndex)

    if (cached) {
      this.routeFields.delete(endNodeIndex)
      this.routeFields.set(endNodeIndex, cached)
      return cached
    }

    const field = buildLaneRouteField(this.network, endNodeIndex)

    this.routeFields.set(endNodeIndex, field)

    while (this.routeFields.size > 256) {
      this.routeFields.delete(this.routeFields.keys().next().value)
    }

    return field
  }

  clearRouteCache() {
    this.routeFields.clear()
  }
}

export function createCarRoutePlanner(city, network = getCarTrafficNetwork(city)) {
  return new CarRoutePlanner(network)
}

function getCarTrafficNetwork(city) {
  if (networkCache.has(city.laneGraph)) {
    return networkCache.get(city.laneGraph)
  }

  const network = buildCarTrafficNetwork(city)

  networkCache.set(city.laneGraph, network)
  return network
}

function buildCarTrafficNetwork(city) {
  const laneGraph = city.laneGraph
  const nodeCount = laneGraph.nodes.length
  const nodeTileIndexes = new Int32Array(nodeCount)
  const nodeIndexById = new Map()
  const tileToNodeIndex = new Int32Array(city.tiles.length)

  tileToNodeIndex.fill(-1)

  for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
    const node = laneGraph.nodes[nodeIndex]
    const tileIndex = city.index(node.tile.x, node.tile.y)

    nodeIndexById.set(node.id, nodeIndex)
    nodeTileIndexes[nodeIndex] = tileIndex
    tileToNodeIndex[tileIndex] = nodeIndex
  }

  const edges = [
    ...laneGraph.edges,
    ...buildGeneratedLaneChangeEdges(city, laneGraph, tileToNodeIndex)
  ]
  const edgeCount = edges.length
  const authoredEdgeCount = laneGraph.edges.length
  const edgeFrom = new Int32Array(edgeCount)
  const edgeTo = new Int32Array(edgeCount)
  const edgeCosts = new Int32Array(edgeCount)
  const incomingCounts = new Int32Array(nodeCount)
  const outgoingCounts = new Int32Array(nodeCount)

  for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex += 1) {
    const edge = edges[edgeIndex]
    const fromIndex = edge.fromNodeIndex ?? nodeIndexById.get(edge.from)
    const toIndex = edge.toNodeIndex ?? nodeIndexById.get(edge.to)

    edgeFrom[edgeIndex] = fromIndex
    edgeTo[edgeIndex] = toIndex
    edgeCosts[edgeIndex] = edgeBaseCost(edge)
    incomingCounts[toIndex] += 1
    outgoingCounts[fromIndex] += 1
  }

  const incomingOffsets = new Int32Array(nodeCount + 1)
  const outgoingOffsets = new Int32Array(nodeCount + 1)

  for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
    incomingOffsets[nodeIndex + 1] = incomingOffsets[nodeIndex] + incomingCounts[nodeIndex]
    outgoingOffsets[nodeIndex + 1] = outgoingOffsets[nodeIndex] + outgoingCounts[nodeIndex]
  }

  const incomingCursors = new Int32Array(incomingOffsets)
  const outgoingCursors = new Int32Array(outgoingOffsets)
  const incomingEdges = new Int32Array(edgeCount)
  const outgoingEdges = new Int32Array(edgeCount)

  for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex += 1) {
    incomingEdges[incomingCursors[edgeTo[edgeIndex]]] = edgeIndex
    incomingCursors[edgeTo[edgeIndex]] += 1
    outgoingEdges[outgoingCursors[edgeFrom[edgeIndex]]] = edgeIndex
    outgoingCursors[edgeFrom[edgeIndex]] += 1
  }

  const network = {
    city,
    laneGraph,
    nodeCount,
    edgeCount,
    authoredEdgeCount,
    generatedLaneChangeEdgeCount: edgeCount - authoredEdgeCount,
    edges: Object.freeze(edges),
    nodeTileIndexes,
    edgeFrom,
    edgeTo,
    edgeCosts,
    incomingOffsets,
    incomingEdges,
    outgoingOffsets,
    outgoingEdges,
    tileToNodeIndex,
    nearestNodeByTile: buildNearestLaneNodeByTile(city, tileToNodeIndex),
    edgeGeometry: edges.map(createEdgeGeometry),
    edgeFootprintsByLength: new Map()
  }

  precomputeEdgeFootprints(network, 2)
  precomputeEdgeFootprints(network, 3)

  return network
}

function buildGeneratedLaneChangeEdges(city, laneGraph, tileToNodeIndex) {
  const edges = []

  for (let nodeIndex = 0; nodeIndex < laneGraph.nodes.length; nodeIndex += 1) {
    const fromNode = laneGraph.nodes[nodeIndex]
    const heading = DIRECTION_OFFSET[fromNode.direction]

    if (!heading || city.tileCrosswalk[city.index(fromNode.tile.x, fromNode.tile.y)] === 1) {
      continue
    }

    for (const lateral of laneChangeLateralOffsets(heading)) {
      edges.push(...validLaneChangeEdges(city, laneGraph, tileToNodeIndex, fromNode, nodeIndex, heading, lateral))
    }
  }

  return edges
}

function laneChangeLateralOffsets(heading) {
  return [
    Object.freeze({ dx: heading.dy * LANE_CHANGE_LATERAL_TILES, dy: -heading.dx * LANE_CHANGE_LATERAL_TILES, side: 'left' }),
    Object.freeze({ dx: -heading.dy * LANE_CHANGE_LATERAL_TILES, dy: heading.dx * LANE_CHANGE_LATERAL_TILES, side: 'right' })
  ]
}

function validLaneChangeEdges(city, laneGraph, tileToNodeIndex, fromNode, fromNodeIndex, heading, lateral) {
  const edges = []

  for (let forwardTiles = LANE_CHANGE_MIN_FORWARD_TILES; forwardTiles <= LANE_CHANGE_MAX_FORWARD_TILES; forwardTiles += 1) {
    const targetX = fromNode.tile.x + heading.dx * forwardTiles + lateral.dx
    const targetY = fromNode.tile.y + heading.dy * forwardTiles + lateral.dy

    if (targetX < 0 || targetY < 0 || targetX >= city.width || targetY >= city.height) {
      continue
    }

    const targetIndex = city.index(targetX, targetY)
    const toNodeIndex = tileToNodeIndex[targetIndex]

    if (toNodeIndex === -1) {
      continue
    }

    const toNode = laneGraph.nodes[toNodeIndex]

    if (toNode.direction !== fromNode.direction ||
        city.tileCrosswalk[targetIndex] === 1) {
      continue
    }

    const sweptTiles = laneChangeSweptTiles(city, tileToNodeIndex, fromNode.tile, toNode.tile)

    if (!sweptTiles) {
      continue
    }

    const path = smoothLaneChangePath(fromNode, toNode, heading, forwardTiles)
    const length = measureTilePolyline(path)
    const worldPath = path.map(([x, y]) => Object.freeze([x * city.tileSize, y * city.tileSize]))

    edges.push(Object.freeze({
      id: `generated-lane-change-${fromNode.id}-${toNode.id}`,
      from: fromNode.id,
      to: toNode.id,
      fromNode,
      toNode,
      fromNodeIndex,
      toNodeIndex,
      type: 'lane-change',
      direction: fromNode.direction,
      turn: null,
      speedLimit: LANE_CHANGE_SPEED_LIMIT,
      lateral: lateral.side,
      forwardTiles,
      path: Object.freeze(path.map((point) => Object.freeze(point))),
      worldPath: Object.freeze(worldPath),
      length,
      worldLength: length * city.tileSize,
      sweptTiles: Object.freeze(sweptTiles)
    }))
  }

  return edges
}

function laneChangeSweptTiles(city, tileToNodeIndex, fromTile, toTile) {
  const minX = Math.min(fromTile.x, toTile.x)
  const maxX = Math.max(fromTile.x, toTile.x)
  const minY = Math.min(fromTile.y, toTile.y)
  const maxY = Math.max(fromTile.y, toTile.y)
  const tiles = []

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const tileIndex = city.index(x, y)

      if (!isLaneChangeDrivableTile(city, tileToNodeIndex, tileIndex)) {
        return null
      }

      tiles.push(tileIndex)
    }
  }

  return tiles
}

function isLaneChangeDrivableTile(city, tileToNodeIndex, tileIndex) {
  return city.tileCrosswalk[tileIndex] !== 1 && (city.tileDrivable[tileIndex] === 1 || tileToNodeIndex[tileIndex] !== -1)
}

function smoothLaneChangePath(fromNode, toNode, heading, forwardTiles) {
  const controlDistance = Math.max(1, forwardTiles * 0.55)
  const start = [fromNode.x, fromNode.y]
  const controlA = [fromNode.x + heading.dx * controlDistance, fromNode.y + heading.dy * controlDistance]
  const controlB = [toNode.x - heading.dx * controlDistance, toNode.y - heading.dy * controlDistance]
  const end = [toNode.x, toNode.y]
  const path = []

  for (let sample = 0; sample < LANE_CHANGE_CURVE_SAMPLES; sample += 1) {
    path.push(cubicBezierPoint(start, controlA, controlB, end, sample / (LANE_CHANGE_CURVE_SAMPLES - 1)))
  }

  return path
}

function cubicBezierPoint(a, b, c, d, t) {
  const mt = 1 - t
  const mt2 = mt * mt
  const t2 = t * t
  const x = mt2 * mt * a[0] + 3 * mt2 * t * b[0] + 3 * mt * t2 * c[0] + t2 * t * d[0]
  const y = mt2 * mt * a[1] + 3 * mt2 * t * b[1] + 3 * mt * t2 * c[1] + t2 * t * d[1]

  return [x, y]
}

function buildNearestLaneNodeByTile(city, tileToNodeIndex) {
  const nearest = new Int32Array(city.tiles.length)
  const queue = new Int32Array(city.tiles.length)
  let head = 0
  let tail = 0

  nearest.fill(-1)

  for (let tileIndex = 0; tileIndex < tileToNodeIndex.length; tileIndex += 1) {
    const nodeIndex = tileToNodeIndex[tileIndex]

    if (nodeIndex !== -1) {
      nearest[tileIndex] = nodeIndex
      queue[tail] = tileIndex
      tail += 1
    }
  }

  while (head < tail) {
    const tileIndex = queue[head]
    const sourceNode = nearest[tileIndex]
    const x = tileIndex % city.width
    const y = Math.floor(tileIndex / city.width)

    head += 1

    for (const offset of CARDINAL_OFFSETS) {
      const nx = x + offset.dx
      const ny = y + offset.dy

      if (nx < 0 || ny < 0 || nx >= city.width || ny >= city.height) {
        continue
      }

      const nextIndex = city.index(nx, ny)

      if (nearest[nextIndex] !== -1) {
        continue
      }

      nearest[nextIndex] = sourceNode
      queue[tail] = nextIndex
      tail += 1
    }
  }

  return nearest
}

function buildLaneRouteField(network, endNodeIndex) {
  const nextEdgeByNode = new Int32Array(network.nodeCount)
  const distance = new Int32Array(network.nodeCount)
  const visited = new Uint8Array(network.nodeCount)
  const heap = new IndexPriorityQueue(Math.max(network.nodeCount, 16))

  nextEdgeByNode.fill(-1)
  distance.fill(0x7fffffff)
  nextEdgeByNode[endNodeIndex] = -2
  distance[endNodeIndex] = 0
  heap.push(endNodeIndex, 0)

  while (heap.length > 0) {
    const currentNode = heap.pop()

    if (visited[currentNode]) {
      continue
    }

    visited[currentNode] = 1

    for (let cursor = network.incomingOffsets[currentNode]; cursor < network.incomingOffsets[currentNode + 1]; cursor += 1) {
      const edgeIndex = network.incomingEdges[cursor]
      const previousNode = network.edgeFrom[edgeIndex]

      if (visited[previousNode]) {
        continue
      }

      const tentative = distance[currentNode] + network.edgeCosts[edgeIndex]

      if (tentative < distance[previousNode]) {
        distance[previousNode] = tentative
        nextEdgeByNode[previousNode] = edgeIndex
        heap.push(previousNode, tentative)
      }
    }
  }

  return {
    endNodeIndex,
    nextEdgeByNode,
    pathsByStart: new Map()
  }
}

function extractLaneRoute(field, startNodeIndex, endNodeIndex, network) {
  const cached = field.pathsByStart.get(startNodeIndex)

  if (cached) {
    return cached
  }

  const route = []
  let currentNode = startNodeIndex
  let guard = 0

  while (currentNode !== endNodeIndex && guard < network.nodeCount) {
    const edgeIndex = field.nextEdgeByNode[currentNode]

    if (edgeIndex < 0) {
      return []
    }

    route.push(edgeIndex)
    currentNode = network.edgeTo[edgeIndex]
    guard += 1
  }

  if (currentNode !== endNodeIndex) {
    return []
  }

  field.pathsByStart.set(startNodeIndex, route)
  return route
}

function edgeBaseCost(edge) {
  return Math.max(1, Math.round(edge.length * 1000))
}

function measureTilePolyline(path) {
  let length = 0

  for (let index = 1; index < path.length; index += 1) {
    length += Math.hypot(path[index][0] - path[index - 1][0], path[index][1] - path[index - 1][1])
  }

  return length
}

class ParkingManager {
  constructor(city, network, config) {
    this.city = city
    this.network = network
    this.config = config
    this.occupancy = new Int32Array(city.tiles.length)
    this.reservations = new Int32Array(city.tiles.length)
    this.candidateCache = new Map()
    this.occupancy.fill(-1)
    this.reservations.fill(-1)
  }

  findAndReserveSpot(building, carId, lengthTiles) {
    const candidates = this.parkingCandidatesForBuilding(building)

    for (const anchorIndex of candidates) {
      for (const direction of CARDINAL_OFFSETS) {
        const tileIndexes = this.parkingFootprint(anchorIndex, direction, lengthTiles)

        if (tileIndexes && this.canReserveParking(tileIndexes, carId)) {
          this.reserveParking(tileIndexes, carId)
          return {
            anchorIndex,
            tileIndexes,
            direction,
            roadOffset: this.parkedRoadOffset(anchorIndex)
          }
        }
      }
    }

    return null
  }

  parkingCandidatesForBuilding(building) {
    if (this.candidateCache.has(building.id)) {
      return this.candidateCache.get(building.id)
    }

    const city = this.city
    const entrance = building.entrance
    const radius = positiveIntegerOrDefault(this.config.parkingSearchRadius, CAR_CONFIG.parkingSearchRadius)
    const candidates = []

    if (!entrance) {
      this.candidateCache.set(building.id, candidates)
      return candidates
    }

    const minX = Math.max(0, entrance.x - radius)
    const maxX = Math.min(city.width - 1, entrance.x + radius)
    const minY = Math.max(0, entrance.y - radius)
    const maxY = Math.min(city.height - 1, entrance.y + radius)

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const tileIndex = city.index(x, y)

        if (city.tileParkable[tileIndex] !== 1) {
          continue
        }

        const distance = Math.abs(x - entrance.x) + Math.abs(y - entrance.y)

        if (distance <= radius) {
          candidates.push(tileIndex)
        }
      }
    }

    candidates.sort((a, b) => {
      const ax = a % city.width
      const ay = Math.floor(a / city.width)
      const bx = b % city.width
      const by = Math.floor(b / city.width)
      return (Math.abs(ax - entrance.x) + Math.abs(ay - entrance.y)) -
        (Math.abs(bx - entrance.x) + Math.abs(by - entrance.y))
    })

    this.candidateCache.set(building.id, candidates)
    return candidates
  }

  parkingFootprint(anchorIndex, direction, lengthTiles) {
    const city = this.city
    const anchorX = anchorIndex % city.width
    const anchorY = Math.floor(anchorIndex / city.width)
    const tiles = []

    for (let offset = 0; offset < lengthTiles; offset += 1) {
      const x = anchorX + direction.dx * offset
      const y = anchorY + direction.dy * offset

      if (x < 0 || y < 0 || x >= city.width || y >= city.height) {
        return null
      }

      const tileIndex = city.index(x, y)

      if (city.tileParkable[tileIndex] !== 1) {
        return null
      }

      tiles.push(tileIndex)
    }

    return tiles
  }

  parkedRoadOffset(anchorIndex) {
    const city = this.city
    const x = anchorIndex % city.width
    const y = Math.floor(anchorIndex / city.width)

    for (const offset of CARDINAL_OFFSETS) {
      const nx = x + offset.dx
      const ny = y + offset.dy

      if (nx < 0 || ny < 0 || nx >= city.width || ny >= city.height) {
        continue
      }

      const tileIndex = city.index(nx, ny)

      if (city.tileDrivable[tileIndex] === 1 || this.network.tileToNodeIndex[tileIndex] !== -1) {
        return offset
      }
    }

    return { dx: 0, dy: 0 }
  }

  canReserveParking(tileIndexes, carId) {
    for (const tileIndex of tileIndexes) {
      if ((this.occupancy[tileIndex] !== -1 && this.occupancy[tileIndex] !== carId) ||
          (this.reservations[tileIndex] !== -1 && this.reservations[tileIndex] !== carId)) {
        return false
      }
    }

    return true
  }

  reserveParking(tileIndexes, carId) {
    for (const tileIndex of tileIndexes) {
      this.reservations[tileIndex] = carId
    }
  }

  releaseParkingReservation(tileIndexes, carId) {
    for (const tileIndex of tileIndexes || []) {
      if (this.reservations[tileIndex] === carId) {
        this.reservations[tileIndex] = -1
      }
    }
  }

  occupyTiles(car, tileIndexes) {
    this.releaseOccupiedTiles(car)

    for (const tileIndex of tileIndexes) {
      this.occupancy[tileIndex] = car.id
    }

    car.occupiedTiles = tileIndexes
  }

  releaseOccupiedTiles(car) {
    for (const tileIndex of car.occupiedTiles || []) {
      if (this.occupancy[tileIndex] === car.id) {
        this.occupancy[tileIndex] = -1
      }
    }

    car.occupiedTiles = []
  }

  canOccupy(tileIndexes, carId) {
    for (const tileIndex of tileIndexes) {
      if (this.occupancy[tileIndex] !== -1 && this.occupancy[tileIndex] !== carId) {
        return false
      }
    }

    return true
  }

  clear() {
    this.occupancy.fill(-1)
    this.reservations.fill(-1)
    this.candidateCache.clear()
  }
}

class TrafficSignalReservationManager {
  constructor(city) {
    this.tileIndexesByGroupId = new Map()
    this.groupReservations = new Map()
    this.tileReservations = new Int32Array(city.tiles.length)
    this.reservedTilesByCarId = new Map()
    this.tileReservations.fill(-1)

    for (const group of city.trafficSignals?.groups || []) {
      this.tileIndexesByGroupId.set(group.id, new Set(group.tiles.map((tile) => city.index(tile.x, tile.y))))
    }
  }

  canOccupy(tileIndexes, carId) {
    for (const tileIndex of tileIndexes || []) {
      if (this.tileReservations[tileIndex] !== -1 && this.tileReservations[tileIndex] !== carId) {
        return false
      }
    }

    return true
  }

  canReserve(group, tileIndexes, carId) {
    const reservedBy = this.groupReservations.get(group.id)

    return (reservedBy === undefined || reservedBy === carId) && this.canOccupy(tileIndexes, carId)
  }

  reserve(group, tileIndexes, car) {
    this.releaseReservedTiles(car.id)
    this.groupReservations.set(group.id, car.id)

    const uniqueTiles = uniqueTileIndexes(tileIndexes)

    for (const tileIndex of uniqueTiles) {
      this.tileReservations[tileIndex] = car.id
    }

    this.reservedTilesByCarId.set(car.id, uniqueTiles)
    car.trafficSignalReservation = group.id
  }

  releaseReservedTiles(carId) {
    const tileIndexes = this.reservedTilesByCarId.get(carId)

    if (!tileIndexes) {
      return
    }

    for (const tileIndex of tileIndexes) {
      if (this.tileReservations[tileIndex] === carId) {
        this.tileReservations[tileIndex] = -1
      }
    }

    this.reservedTilesByCarId.delete(carId)
  }

  releaseForCar(car) {
    if (car.trafficSignalReservation && this.groupReservations.get(car.trafficSignalReservation) === car.id) {
      this.groupReservations.delete(car.trafficSignalReservation)
    }

    this.releaseReservedTiles(car.id)
    car.trafficSignalReservation = null
  }

  releaseIfClear(car) {
    if (!car.trafficSignalReservation || !car.route) {
      return
    }

    const tileIndexes = this.tileIndexesByGroupId.get(car.trafficSignalReservation)

    if (!tileIndexes || !(car.occupiedTiles || []).some((tileIndex) => tileIndexes.has(tileIndex))) {
      this.releaseForCar(car)
    }
  }

  groupTileIndexes(groupId) {
    return this.tileIndexesByGroupId.get(groupId) || null
  }

  clear() {
    this.groupReservations.clear()
    this.reservedTilesByCarId.clear()
    this.tileReservations.fill(-1)
  }
}

function createCarEntity(id, city, homeBuildings, workBuildings, buildingsById, ownerPools, parking, random, config) {
  const ownerHome = takeOwnerHome(ownerPools, random)
  const home = ownerHome
    ? buildingsById.get(ownerHome.homeBuildingId)
    : takeRandomItem(homeBuildings, random)

  if (!home) {
    return null
  }

  const lengthTiles = random.next() < positiveNumberOrDefault(config.twoTileChance, CAR_CONFIG.twoTileChance) ? 2 : 3
  const parkingSpot = parking.findAndReserveSpot(home, id, lengthTiles)

  if (!parkingSpot) {
    return null
  }

  const owners = ownerHome
    ? takeNpcOwnersForCar(id, ownerHome.homeBuildingId, ownerPools, random, config)
    : createSyntheticOwnersForCar(id, home, workBuildings, random, config)

  if (owners.length === 0) {
    parking.releaseParkingReservation(parkingSpot.tileIndexes, id)
    return null
  }

  const position = parkedCarPosition(city, parkingSpot, config)
  const car = {
    id,
    owners,
    homeBuildingId: home.id,
    state: 'parked',
    parkedAt: 'home',
    parkedBuildingId: home.id,
    parkingSpot,
    destinationParkingSpot: null,
    lengthTiles,
    color: config.colorPalette[id % config.colorPalette.length],
    position,
    direction: parkingSpot.direction,
    occupiedTiles: [],
    route: null,
    movement: null,
    adaptiveSpeed: createCarAdaptiveSpeed(random, config),
    trafficSignalReservation: null,
    driverOwnerId: null,
    riderOwners: []
  }

  parking.occupyTiles(car, parkingSpot.tileIndexes)
  parking.releaseParkingReservation(parkingSpot.tileIndexes, car.id)
  assignCarToNpcOwners(car)
  return car
}

function collectCarOwnerPools(npcs, buildingsById) {
  const byHome = new Map()
  const homeIds = []

  for (const npc of npcs || []) {
    if (!npc || npc.carId !== null || !npc.home || !npc.work || !buildingsById.has(npc.home)) {
      continue
    }

    if (!byHome.has(npc.home)) {
      byHome.set(npc.home, [])
      homeIds.push(npc.home)
    }

    byHome.get(npc.home).push(npc)
  }

  return { byHome, homeIds }
}

function takeOwnerHome(ownerPools, random) {
  while (ownerPools.homeIds.length > 0) {
    const homeIndex = random.int(ownerPools.homeIds.length)
    const homeBuildingId = ownerPools.homeIds[homeIndex]
    const pool = ownerPools.byHome.get(homeBuildingId)

    if (pool && pool.length > 0) {
      return { homeBuildingId }
    }

    ownerPools.homeIds.splice(homeIndex, 1)
  }

  return null
}

function takeNpcOwnersForCar(carId, homeBuildingId, ownerPools, random, config) {
  const pool = ownerPools.byHome.get(homeBuildingId)

  if (!pool || pool.length === 0) {
    return []
  }

  const maxOwners = Math.min(2, positiveIntegerOrDefault(config.maxOwners, CAR_CONFIG.maxOwners))
  const requestedOwners = maxOwners >= 2 && random.next() < positiveNumberOrDefault(config.twoOwnerChance, CAR_CONFIG.twoOwnerChance) ? 2 : 1
  const ownerCount = Math.min(pool.length, requestedOwners)
  const commuteOwnerIndex = random.int(ownerCount)
  const owners = []

  for (let ownerIndex = 0; ownerIndex < ownerCount; ownerIndex += 1) {
    const npcIndex = random.int(pool.length)
    const npc = pool[npcIndex]

    pool.splice(npcIndex, 1)

    const commuteByCar = ownerIndex === commuteOwnerIndex && random.next() < positiveNumberOrDefault(config.commuteChance, CAR_CONFIG.commuteChance)

    owners.push({
      id: `npc-${npc.id}`,
      npcId: npc.id,
      npc,
      homeBuildingId: npc.home,
      workBuildingId: npc.work,
      commuteByCar
    })
  }

  return owners
}

function createSyntheticOwnersForCar(carId, home, workBuildings, random, config) {
  const maxOwners = Math.min(2, positiveIntegerOrDefault(config.maxOwners, CAR_CONFIG.maxOwners))
  const ownerCount = maxOwners >= 2 && random.next() < positiveNumberOrDefault(config.twoOwnerChance, CAR_CONFIG.twoOwnerChance) ? 2 : 1
  const commuteOwnerIndex = random.int(ownerCount)
  const owners = []

  for (let ownerIndex = 0; ownerIndex < ownerCount; ownerIndex += 1) {
    const work = takeRandomItem(workBuildings, random)
    owners.push({
      id: `car-${carId}-owner-${ownerIndex}`,
      npcId: null,
      npc: null,
      homeBuildingId: home.id,
      workBuildingId: work ? work.id : null,
      commuteByCar: ownerIndex === commuteOwnerIndex && Boolean(work) && random.next() < positiveNumberOrDefault(config.commuteChance, CAR_CONFIG.commuteChance)
    })
  }

  return owners
}

function assignCarToNpcOwners(car) {
  for (const owner of car.owners) {
    if (!owner.npc) {
      continue
    }

    owner.npc.carId = car.id
    owner.npc.commuteByCar = owner.commuteByCar
  }
}

function maybeStartCarTrip(car, hour, context) {
  const owner = car.owners.find((candidate) => candidate.commuteByCar)

  if (!owner) {
    return
  }

  if (car.parkedAt === 'home' && hourInRange(hour, context.config.workDepartureHour, context.config.workDepartureEndHour)) {
    const workBuilding = context.buildingsById.get(owner.workBuildingId)

    if (workBuilding && isOwnerReadyForCarTrip(owner, 'work', car.homeBuildingId, workBuilding.id, hour)) {
      markOwnerWaitingForCar(owner)
      startCarTrip(car, workBuilding, 'work', owner, context)
    }
  } else if (car.parkedAt === 'work' && hourInRange(hour, context.config.homeDepartureHour, context.config.homeDepartureEndHour)) {
    const homeBuilding = context.buildingsById.get(owner.homeBuildingId)

    if (homeBuilding && isOwnerReadyForCarTrip(owner, 'home', car.parkedBuildingId, homeBuilding.id, hour)) {
      markOwnerWaitingForCar(owner)
      startCarTrip(car, homeBuilding, 'home', owner, context)
    }
  }
}

function clearCarOwnerWaitingState(car) {
  for (const owner of car.owners) {
    if (owner.npc && !owner.npc.vehicleTrip) {
      owner.npc.waitingForCar = false
    }
  }
}

function markOwnerWaitingForCar(owner) {
  if (owner.npc && !owner.npc.vehicleTrip) {
    owner.npc.waitingForCar = true
  }
}

function isOwnerReadyForCarTrip(owner, destinationKind, originBuildingId, destinationBuildingId, hour) {
  if (!owner.npc) {
    return true
  }

  if (owner.npc.vehicleTrip) {
    return false
  }

  const activeElement = typeof owner.npc.getActiveTimetableElement === 'function'
    ? owner.npc.getActiveTimetableElement(hour)
    : null

  return Boolean(
    activeElement &&
    activeElement.id === destinationKind &&
    activeElement.buildingId === destinationBuildingId &&
    owner.npc.locationState &&
    owner.npc.locationState.buildingId === originBuildingId
  )
}

function startCarTrip(car, destinationBuilding, destinationKind, owner, context) {
  const destinationParking = context.parking.findAndReserveSpot(destinationBuilding, car.id, car.lengthTiles)

  if (!destinationParking) {
    return
  }

  const startNode = context.network.nearestNodeByTile[car.parkingSpot.anchorIndex]
  const endNode = context.network.nearestNodeByTile[destinationParking.anchorIndex]
  const route = context.router.findRoute(startNode, endNode)

  if (route.length === 0) {
    context.parking.releaseParkingReservation(destinationParking.tileIndexes, car.id)
    return
  }

  car.state = 'driving'
  car.destinationParkingSpot = destinationParking
  car.destinationKind = destinationKind
  car.destinationBuildingId = destinationBuilding.id
  car.route = {
    edges: route,
    cursor: 0,
    currentNode: startNode,
    destinationNode: endNode
  }
  car.movement = null
  car.trafficSignalReservation = null
  car.driverOwnerId = owner.id
  car.riderOwners = [owner]
  car.position = laneNodePosition(context.network, startNode)
  boardCarRiders(car, destinationKind, destinationBuilding)
}

function boardCarRiders(car, destinationKind, destinationBuilding) {
  for (const owner of car.riderOwners || []) {
    if (owner.npc && typeof owner.npc.startVehicleTrip === 'function') {
      owner.npc.startVehicleTrip({
        carId: car.id,
        destinationKind,
        destinationBuildingId: destinationBuilding.id
      })
    }
  }
}

function updateDrivingCar(car, deltaSeconds, context) {
  let remaining = deltaSeconds

  ensureCarAdaptiveSpeed(car, context)

  while (remaining > 0 && car.state === 'driving') {
    if (!car.movement && !startNextDrivingEdge(car, context, remaining)) {
      return
    }

    const movement = car.movement

    updateCarAdaptiveSpeed(car, context, remaining)

    if (!car.position) {
      car.position = { x: 0, y: 0 }
    }

    const speed = Math.max(0.001, movement.speed)
    const remainingDistance = Math.max(0, movement.distance - movement.distanceTravelled)
    const stepDistance = Math.min(remainingDistance, speed * remaining)
    const stepSeconds = stepDistance > 0 ? stepDistance / speed : remaining

    movement.elapsed += stepSeconds
    movement.distanceTravelled += stepDistance
    remaining -= stepSeconds
    setCarPositionAt(car.position, movement.geometry, movement.distanceTravelled / movement.distance)

    if (movement.distanceTravelled + 0.0001 < movement.distance) {
      return
    }

    setCarPositionAt(car.position, movement.geometry, 1)
    car.route.currentNode = movement.toNodeIndex
    context.trafficReservations.releaseIfClear(car)
    car.movement = null
  }
}

function startNextDrivingEdge(car, context, attemptDeltaSeconds = 0) {
  if (!car.route || car.route.cursor >= car.route.edges.length) {
    parkCarAtDestination(car, context)
    return false
  }

  ensureCarAdaptiveSpeed(car, context)

  const edgeIndex = car.route.edges[car.route.cursor]
  const edge = context.network.edges[edgeIndex]
  const toNodeIndex = context.network.edgeTo[edgeIndex]
  const fromNodeIndex = context.network.edgeFrom[edgeIndex]
  const nextFootprint = edgeDrivingFootprint(context.network, edgeIndex, car.lengthTiles)
  const clearanceTiles = edgeClearanceTiles(edge)
  const trafficSignalGroup = activeTrafficSignalGroup(context.city, edge)

  if (trafficSignalGroup && isBlockedByTrafficSignal(context.city, edge)) {
    return false
  }

  const trafficSignalClearanceTiles = trafficSignalGroup
    ? exitClearanceTilesForTrafficSignal(car, context, trafficSignalGroup)
    : null

  if (trafficSignalGroup &&
      (!trafficSignalClearanceTiles ||
       !context.parking.canOccupy(trafficSignalClearanceTiles, car.id) ||
       !context.trafficReservations.canReserve(trafficSignalGroup, trafficSignalClearanceTiles, car.id))) {
    return false
  }

  const rightHandMovement = getRightHandMovementForCar(car, context)

  if (rightHandMovement && shouldYieldByRightHandRule(car, rightHandMovement, context)) {
    return false
  }

  if (!trafficSignalGroup &&
      !car.trafficSignalReservation &&
      isBlockedByCrosswalkSignal(context.city, context.network, fromNodeIndex, toNodeIndex)) {
    return false
  }

  if (clearanceTiles &&
      (!context.parking.canOccupy(clearanceTiles, car.id) ||
       !context.trafficReservations.canOccupy(clearanceTiles, car.id))) {
    if (handleBlockedLaneChange(car, context, edgeIndex, clearanceTiles, attemptDeltaSeconds)) {
      return startNextDrivingEdge(car, context, attemptDeltaSeconds)
    }

    return false
  }

  if (!context.parking.canOccupy(nextFootprint, car.id) ||
      !context.trafficReservations.canOccupy(nextFootprint, car.id)) {
    return false
  }

  if (trafficSignalGroup) {
    context.trafficReservations.reserve(trafficSignalGroup, trafficSignalClearanceTiles, car)
  }

  resetLaneChangeWait(car)
  context.parking.occupyTiles(car, nextFootprint)
  car.direction = DIRECTION_OFFSET[edge.direction] || car.direction
  car.route.cursor += 1
  const speedLimit = edgeSpeedLimit(edge, context.config)
  const speed = edgeSpeedForCar(edge, car, context.config, speedLimit)
  const distance = Math.max(0.001, edge.worldLength)

  car.movement = {
    edgeIndex,
    edge,
    geometry: context.network.edgeGeometry[edgeIndex],
    toNodeIndex,
    elapsed: 0,
    distance,
    distanceTravelled: 0,
    speedLimit,
    speed,
    duration: distance / speed
  }
  return true
}

function handleBlockedLaneChange(car, context, blockedEdgeIndex, clearanceTiles, deltaSeconds) {
  const blockedEdge = context.network.edges[blockedEdgeIndex]

  if (blockedEdge?.type !== 'lane-change') {
    return false
  }

  const blockers = movingBlockersForTiles(car, context, clearanceTiles)
  const adaptiveSpeed = ensureCarAdaptiveSpeed(car, context)

  if (blockers.length > 0) {
    const intent = applyLaneChangeSpeedIntent(car, context, blockedEdgeIndex, blockers)
    const waitSeconds = positiveNumberOrDefault(
      context.config.movingLaneChangeWaitSeconds,
      CAR_CONFIG.movingLaneChangeWaitSeconds
    )

    adaptiveSpeed.laneChangeWaitSeconds += Math.max(0, finiteNumberOrZero(deltaSeconds))

    if (intent === 'slow' && adaptiveSpeed.laneChangeWaitSeconds < waitSeconds) {
      return false
    }
  }

  if (!deferBlockedLaneChange(car, context, blockedEdgeIndex)) {
    return false
  }

  adaptiveSpeed.laneChangeWaitSeconds = 0
  return true
}

function deferBlockedLaneChange(car, context, blockedEdgeIndex) {
  const blockedEdge = context.network.edges[blockedEdgeIndex]

  if (blockedEdge?.type !== 'lane-change' || !car.route) {
    return false
  }

  const currentNode = context.network.edgeFrom[blockedEdgeIndex]
  const destinationNode = routeDestinationNode(car.route, context.network)

  if (!Number.isInteger(currentNode) ||
      !Number.isInteger(destinationNode) ||
      currentNode < 0 ||
      destinationNode < 0 ||
      currentNode >= context.network.nodeCount ||
      destinationNode >= context.network.nodeCount) {
    return false
  }

  let bestEdges = null
  let bestCost = Infinity

  // A blocked generated lane change is treated like a missed merge gap: keep
  // moving forward in the current lane and re-plan from the next lane node.
  for (let cursor = context.network.outgoingOffsets[currentNode]; cursor < context.network.outgoingOffsets[currentNode + 1]; cursor += 1) {
    const edgeIndex = context.network.outgoingEdges[cursor]
    const edge = context.network.edges[edgeIndex]

    if (edgeIndex === blockedEdgeIndex ||
        edge.type === 'lane-change' ||
        edge.direction !== blockedEdge.direction) {
      continue
    }

    const toNode = context.network.edgeTo[edgeIndex]
    const tail = toNode === destinationNode
      ? []
      : context.router.findRoute(toNode, destinationNode)

    if (toNode !== destinationNode && tail.length === 0) {
      continue
    }

    const cost = context.network.edgeCosts[edgeIndex] + routeCost(tail, context.network)

    if (cost < bestCost) {
      bestCost = cost
      bestEdges = [edgeIndex, ...tail]
    }
  }

  if (!bestEdges) {
    return false
  }

  car.route = {
    ...car.route,
    edges: bestEdges,
    cursor: 0,
    currentNode,
    destinationNode
  }

  return true
}

function routeDestinationNode(route, network) {
  if (Number.isInteger(route.destinationNode)) {
    return route.destinationNode
  }

  const lastEdgeIndex = route.edges?.[route.edges.length - 1]

  return Number.isInteger(lastEdgeIndex) ? network.edgeTo[lastEdgeIndex] : -1
}

function routeCost(edgeIndexes, network) {
  let cost = 0

  for (const edgeIndex of edgeIndexes) {
    cost += network.edgeCosts[edgeIndex]
  }

  return cost
}

function updateCarAdaptiveSpeed(car, context, deltaSeconds) {
  const adaptiveSpeed = ensureCarAdaptiveSpeed(car, context)
  const laneChangeBlock = upcomingMovingLaneChangeBlock(car, context)

  if (laneChangeBlock) {
    applyLaneChangeSpeedIntent(car, context, laneChangeBlock.edgeIndex, laneChangeBlock.blockers)
  } else {
    adaptiveSpeed.targetScale = adaptiveSpeed.cruiseScale
    adaptiveSpeed.intent = null
  }

  const adjustmentRate = positiveNumberOrDefault(
    context.config.speedAdjustmentRate,
    CAR_CONFIG.speedAdjustmentRate
  )

  adaptiveSpeed.currentScale = moveToward(
    adaptiveSpeed.currentScale,
    adaptiveSpeed.targetScale,
    adjustmentRate * Math.max(0, finiteNumberOrZero(deltaSeconds))
  )

  if (car.movement) {
    car.movement.speedLimit = edgeSpeedLimit(car.movement.edge, context.config)
    car.movement.speed = edgeSpeedForCar(car.movement.edge, car, context.config, car.movement.speedLimit)
    car.movement.duration = car.movement.distance / car.movement.speed
  }
}

function upcomingMovingLaneChangeBlock(car, context) {
  if (!car.route) {
    return null
  }

  const routeEdges = car.route.edges || []
  const startCursor = Math.max(0, car.route.cursor)
  const endCursor = Math.min(routeEdges.length, startCursor + LANE_CHANGE_ADAPTIVE_LOOKAHEAD_EDGES)

  for (let cursor = startCursor; cursor < endCursor; cursor += 1) {
    const edgeIndex = routeEdges[cursor]
    const edge = context.network.edges[edgeIndex]

    if (edge?.type !== 'lane-change') {
      continue
    }

    const clearanceTiles = edgeClearanceTiles(edge)

    if (!clearanceTiles) {
      return null
    }

    const blockers = movingBlockersForTiles(car, context, clearanceTiles)

    return blockers.length > 0 ? { edgeIndex, blockers } : null
  }

  return null
}

function applyLaneChangeSpeedIntent(car, context, edgeIndex, blockers) {
  const adaptiveSpeed = ensureCarAdaptiveSpeed(car, context)
  const intent = laneChangeGapIntent(context, edgeIndex, blockers)
  const configuredScale = intent === 'overtake'
    ? positiveNumberOrDefault(context.config.laneChangeOvertakeSpeedScale, CAR_CONFIG.laneChangeOvertakeSpeedScale)
    : positiveNumberOrDefault(context.config.laneChangeSlowSpeedScale, CAR_CONFIG.laneChangeSlowSpeedScale)

  adaptiveSpeed.targetScale = clampAdaptiveSpeedScale(configuredScale, context.config)
  adaptiveSpeed.intent = intent
  return intent
}

function laneChangeGapIntent(context, edgeIndex, blockers) {
  const edge = context.network.edges[edgeIndex]
  const heading = DIRECTION_OFFSET[edge.direction]

  if (!heading) {
    return 'slow'
  }

  const fromNode = context.network.laneGraph.nodes[context.network.edgeFrom[edgeIndex]]
  const startProjection = fromNode.worldX * heading.dx + fromNode.worldY * heading.dy
  const aheadGap = context.city.tileSize * LANE_CHANGE_AHEAD_GAP_TILES

  for (const blocker of blockers) {
    if (!blocker.position) {
      continue
    }

    const blockerProjection = blocker.position.x * heading.dx + blocker.position.y * heading.dy

    if (blockerProjection - startProjection > aheadGap) {
      return 'slow'
    }
  }

  return 'overtake'
}

function movingBlockersForTiles(car, context, tileIndexes) {
  const occupancy = context.parking.occupancy
  const blockers = []
  const seen = new Set()

  if (!occupancy) {
    return blockers
  }

  for (const tileIndex of tileIndexes || []) {
    const carId = occupancy[tileIndex]

    if (carId === -1 || carId === car.id || seen.has(carId)) {
      continue
    }

    const blocker = findCarById(context, carId)

    if (!blocker || blocker.state !== 'driving') {
      continue
    }

    seen.add(carId)
    blockers.push(blocker)
  }

  return blockers
}

function findCarById(context, carId) {
  for (const car of context.cars) {
    if (car.id === carId) {
      return car
    }
  }

  return null
}

function resetLaneChangeWait(car) {
  if (car.adaptiveSpeed) {
    car.adaptiveSpeed.laneChangeWaitSeconds = 0
  }
}

function parkCarAtDestination(car, context) {
  context.trafficReservations.releaseForCar(car)
  context.parking.releaseOccupiedTiles(car)
  context.parking.occupyTiles(car, car.destinationParkingSpot.tileIndexes)
  context.parking.releaseParkingReservation(car.destinationParkingSpot.tileIndexes, car.id)
  dropOffCarRiders(car, context)
  car.state = 'parked'
  car.parkedAt = car.destinationKind
  car.parkedBuildingId = car.destinationBuildingId
  car.parkingSpot = car.destinationParkingSpot
  car.destinationParkingSpot = null
  car.route = null
  car.movement = null
  car.driverOwnerId = null
  car.riderOwners = []
  car.direction = car.parkingSpot.direction
  car.position = parkedCarPosition(context.city, car.parkingSpot, context.config)
}

function dropOffCarRiders(car, context) {
  const destinationBuilding = context.buildingsById.get(car.destinationBuildingId)

  for (const owner of car.riderOwners || []) {
    if (owner.npc && typeof owner.npc.finishVehicleTrip === 'function') {
      owner.npc.finishVehicleTrip(context.city, car.destinationKind, destinationBuilding)
    }
  }
}

function isBlockedByCrosswalkSignal(city, network, fromNodeIndex, toNodeIndex) {
  const fromTile = network.nodeTileIndexes[fromNodeIndex]
  const toTile = network.nodeTileIndexes[toNodeIndex]

  if (city.tileCrosswalk[toTile] !== 1 || city.tileCrosswalk[fromTile] === 1) {
    return false
  }

  return city.getCrosswalkSignalState() !== 'green'
}

function isBlockedByTrafficSignal(city, edge) {
  return typeof city.canEnterTrafficSignal === 'function' && !city.canEnterTrafficSignal(edge)
}

function activeTrafficSignalGroup(city, edge) {
  const group = trafficConflictGroup(city, edge)

  return group?.enabled ? group : null
}

function trafficConflictGroup(city, edge) {
  const group = typeof city.getTrafficSignalForEdge === 'function'
    ? city.getTrafficSignalForEdge(edge.id)
    : null

  return group || null
}

function createRightHandMovement(car, context) {
  if (!car.route || car.movement || car.route.cursor >= car.route.edges.length) {
    return null
  }

  const routeEdges = car.route.edges
  const startCursor = car.route.cursor
  const startEdgeIndex = routeEdges[startCursor]
  const startEdge = context.network.edges[startEdgeIndex]
  const startDirection = startEdge.direction
  const signalGroup = trafficConflictGroup(context.city, startEdge)
  const signalTileIndexes = signalGroup
    ? context.trafficReservations.groupTileIndexes(signalGroup.id)
    : null
  const tileIndexes = []
  let explicitTurn = normalizeMovementTurn(startEdge.turn)
  let lastDirection = startDirection
  let sawDirectionChange = false
  let sawInsideSignal = false
  let outsideSignalEdges = 0

  for (let cursor = startCursor; cursor < routeEdges.length && cursor < startCursor + RIGHT_HAND_LOOKAHEAD_EDGES; cursor += 1) {
    const edgeIndex = routeEdges[cursor]
    const edge = context.network.edges[edgeIndex]
    const toNodeIndex = context.network.edgeTo[edgeIndex]
    const toTileIndex = context.network.nodeTileIndexes[toNodeIndex]

    appendUniqueTileIndexes(tileIndexes, edgeDrivingFootprint(context.network, edgeIndex, car.lengthTiles))

    if (edge.direction !== startDirection) {
      sawDirectionChange = true
    }

    explicitTurn = explicitTurn || normalizeMovementTurn(edge.turn)
    lastDirection = edge.direction

    if (signalTileIndexes) {
      if (signalTileIndexes.has(toTileIndex)) {
        sawInsideSignal = true
        continue
      }

      if (sawInsideSignal) {
        outsideSignalEdges += 1

        if (outsideSignalEdges >= 1) {
          break
        }
      }

      continue
    }

    if (cursor > startCursor && sawDirectionChange) {
      break
    }
  }

  if (!signalGroup && !sawDirectionChange && !explicitTurn) {
    return null
  }

  const turn = explicitTurn || classifyTurn(startDirection, lastDirection)

  return {
    edgeIndex: startEdgeIndex,
    edge: startEdge,
    fromNodeIndex: context.network.edgeFrom[startEdgeIndex],
    toNodeIndex: context.network.edgeTo[startEdgeIndex],
    approachDirection: startDirection,
    turn,
    priority: TURN_PRIORITY[turn] ?? TURN_PRIORITY.straight,
    signalGroupId: signalGroup?.id || null,
    tileIndexes: uniqueTileIndexes(tileIndexes)
  }
}

function createTrafficYieldIndex(context) {
  const movementByCarId = new Map()
  const bySignalGroupId = new Map()
  const byTileIndex = new Map()

  for (const car of context.cars) {
    if (car.state !== 'driving' || car.movement || !car.route || car.route.cursor >= car.route.edges.length) {
      continue
    }

    const movement = createRightHandMovement(car, context)

    if (!movement) {
      continue
    }

    movementByCarId.set(car.id, movement)

    if (movement.signalGroupId) {
      appendIndexedCar(bySignalGroupId, movement.signalGroupId, car)
    }

    for (const tileIndex of movement.tileIndexes) {
      appendIndexedCar(byTileIndex, tileIndex, car)
    }
  }

  return {
    movementByCarId,
    bySignalGroupId,
    byTileIndex
  }
}

function appendIndexedCar(index, key, car) {
  let cars = index.get(key)

  if (!cars) {
    cars = []
    index.set(key, cars)
  }

  cars.push(car)
}

function getRightHandMovementForCar(car, context) {
  return context.yieldIndex?.movementByCarId.get(car.id) || createRightHandMovement(car, context)
}

function shouldYieldByRightHandRule(car, movement, context) {
  for (const other of rightHandCandidates(movement, context)) {
    if (other === car ||
        other.state !== 'driving' ||
        other.movement ||
        !other.route ||
        other.route.cursor >= other.route.edges.length) {
      continue
    }

    const otherMovement = getRightHandMovementForCar(other, context)

    if (!otherMovement ||
        !rightHandMovementsConflict(movement, otherMovement) ||
        !rightHandCandidateCanEnter(other, otherMovement, context)) {
      continue
    }

    if (rightHandMovementMustYield(car, movement, other, otherMovement)) {
      return true
    }
  }

  return false
}

function rightHandCandidates(movement, context) {
  const yieldIndex = context.yieldIndex

  if (!yieldIndex) {
    return context.cars
  }

  const candidates = []
  const seen = new Set()

  if (movement.signalGroupId) {
    appendRightHandCandidates(candidates, seen, yieldIndex.bySignalGroupId.get(movement.signalGroupId))
  }

  for (const tileIndex of movement.tileIndexes) {
    appendRightHandCandidates(candidates, seen, yieldIndex.byTileIndex.get(tileIndex))
  }

  return candidates
}

function appendRightHandCandidates(candidates, seen, cars) {
  if (!cars) {
    return
  }

  for (const car of cars) {
    if (seen.has(car.id)) {
      continue
    }

    seen.add(car.id)
    candidates.push(car)
  }
}

function rightHandCandidateCanEnter(car, movement, context) {
  const edge = movement.edge
  const nextFootprint = edgeDrivingFootprint(context.network, movement.edgeIndex, car.lengthTiles)
  const clearanceTiles = edgeClearanceTiles(edge)
  const trafficSignalGroup = activeTrafficSignalGroup(context.city, edge)

  if (trafficSignalGroup && isBlockedByTrafficSignal(context.city, edge)) {
    return false
  }

  if (trafficSignalGroup) {
    const trafficSignalClearanceTiles = exitClearanceTilesForTrafficSignal(car, context, trafficSignalGroup)

    if (!trafficSignalClearanceTiles ||
        !context.parking.canOccupy(trafficSignalClearanceTiles, car.id) ||
        !context.trafficReservations.canReserve(trafficSignalGroup, trafficSignalClearanceTiles, car.id)) {
      return false
    }
  } else if (!car.trafficSignalReservation &&
      isBlockedByCrosswalkSignal(context.city, context.network, movement.fromNodeIndex, movement.toNodeIndex)) {
    return false
  }

  if (clearanceTiles &&
      (!context.parking.canOccupy(clearanceTiles, car.id) ||
       !context.trafficReservations.canOccupy(clearanceTiles, car.id))) {
    return false
  }

  return context.parking.canOccupy(nextFootprint, car.id) &&
    context.trafficReservations.canOccupy(nextFootprint, car.id)
}

function rightHandMovementsConflict(a, b) {
  if (a.signalGroupId && a.signalGroupId === b.signalGroupId) {
    return true
  }

  for (const aTileIndex of a.tileIndexes) {
    for (const bTileIndex of b.tileIndexes) {
      if (aTileIndex === bTileIndex) {
        return true
      }
    }
  }

  return false
}

function rightHandMovementMustYield(car, movement, other, otherMovement) {
  const oncoming = OPPOSITE_DIRECTION[movement.approachDirection] === otherMovement.approachDirection

  if (oncoming) {
    const myLeftTurnYields = movement.turn === 'left' &&
      otherMovement.turn !== 'left' &&
      otherMovement.turn !== 'u-turn'

    if (myLeftTurnYields) {
      return true
    }

    const otherLeftTurnYields = otherMovement.turn === 'left' &&
      movement.turn !== 'left' &&
      movement.turn !== 'u-turn'

    if (otherLeftTurnYields) {
      return false
    }
  }

  if (movement.priority !== otherMovement.priority) {
    return movement.priority < otherMovement.priority
  }

  if (otherMovement.approachDirection === DIRECTION_FROM_RIGHT[movement.approachDirection]) {
    return true
  }

  if (movement.approachDirection === DIRECTION_FROM_RIGHT[otherMovement.approachDirection]) {
    return false
  }

  return car.id > other.id
}

function normalizeMovementTurn(turn) {
  return turn === 'right' ||
    turn === 'straight' ||
    turn === 'left' ||
    turn === 'u-turn' ||
    turn === 'merge'
    ? turn
    : null
}

function classifyTurn(fromDirection, toDirection) {
  if (fromDirection === toDirection) {
    return 'straight'
  }

  if (RIGHT_TURN_DIRECTION[fromDirection] === toDirection) {
    return 'right'
  }

  if (LEFT_TURN_DIRECTION[fromDirection] === toDirection) {
    return 'left'
  }

  if (OPPOSITE_DIRECTION[fromDirection] === toDirection) {
    return 'u-turn'
  }

  return 'merge'
}

function exitClearanceTilesForTrafficSignal(car, context, group) {
  const groupTileIndexes = context.trafficReservations.groupTileIndexes(group.id)

  if (!groupTileIndexes || !car.route) {
    return null
  }

  const routeEdges = car.route.edges
  const requiredOutsideNodes = car.lengthTiles + TRAFFIC_SIGNAL_CLEARANCE_GAP_TILES
  const clearanceTiles = []
  let outsideNodeCount = 0
  let hasExitedSignal = false

  for (let cursor = car.route.cursor; cursor < routeEdges.length; cursor += 1) {
    const edgeIndex = routeEdges[cursor]
    const edge = context.network.edges[edgeIndex]
    const toNodeIndex = context.network.edgeTo[edgeIndex]
    const toTileIndex = context.network.nodeTileIndexes[toNodeIndex]

    if (groupTileIndexes.has(toTileIndex)) {
      if (hasExitedSignal) {
        outsideNodeCount = 0
      }

      continue
    }

    hasExitedSignal = true
    outsideNodeCount += 1
    appendUniqueTileIndexes(clearanceTiles, edgeDrivingFootprint(context.network, edgeIndex, car.lengthTiles))

    if (outsideNodeCount >= requiredOutsideNodes) {
      return clearanceTiles
    }
  }

  return hasExitedSignal ? clearanceTiles : null
}

function appendUniqueTileIndexes(target, tileIndexes) {
  for (const tileIndex of tileIndexes) {
    if (!target.includes(tileIndex)) {
      target.push(tileIndex)
    }
  }
}

function uniqueTileIndexes(tileIndexes) {
  const unique = []
  appendUniqueTileIndexes(unique, tileIndexes || [])
  return unique
}

function drivingFootprint(network, nodeIndex, directionName, lengthTiles) {
  const city = network.city
  const node = network.laneGraph.nodes[nodeIndex]
  const offset = DIRECTION_OFFSET[directionName] || { dx: 0, dy: 0 }
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

function edgeDrivingFootprint(network, edgeIndex, lengthTiles) {
  let footprints = network.edgeFootprintsByLength.get(lengthTiles)

  if (!footprints) {
    footprints = precomputeEdgeFootprints(network, lengthTiles)
  }

  return footprints[edgeIndex]
}

function edgeClearanceTiles(edge) {
  return edge.type === 'lane-change' && edge.sweptTiles && edge.sweptTiles.length > 0
    ? edge.sweptTiles
    : null
}

function laneNodePosition(network, nodeIndex) {
  const node = network.laneGraph.nodes[nodeIndex]
  return { x: node.worldX, y: node.worldY }
}

function parkedCarPosition(city, parkingSpot, config) {
  const anchorX = parkingSpot.anchorIndex % city.width
  const anchorY = Math.floor(parkingSpot.anchorIndex / city.width)
  const offsetScale = positiveNumberOrDefault(config.parkedRoadOffset, CAR_CONFIG.parkedRoadOffset)

  return {
    x: (anchorX + 0.5 + parkingSpot.roadOffset.dx * offsetScale) * city.tileSize,
    y: (anchorY + 0.5 + parkingSpot.roadOffset.dy * offsetScale) * city.tileSize
  }
}

function createCarAdaptiveSpeed(random, config) {
  const minCruiseScale = positiveNumberOrDefault(config.minCruiseSpeedScale, CAR_CONFIG.minCruiseSpeedScale)
  const maxCruiseScale = Math.max(
    minCruiseScale,
    positiveNumberOrDefault(config.maxCruiseSpeedScale, CAR_CONFIG.maxCruiseSpeedScale)
  )
  const cruiseScale = clampAdaptiveSpeedScale(random.between(minCruiseScale, maxCruiseScale), config)

  return {
    cruiseScale,
    currentScale: cruiseScale,
    targetScale: cruiseScale,
    intent: null,
    laneChangeWaitSeconds: 0
  }
}

function ensureCarAdaptiveSpeed(car, context) {
  if (!car.adaptiveSpeed) {
    const cruiseScale = clampAdaptiveSpeedScale(deterministicCarCruiseScale(car.id, context.config), context.config)

    car.adaptiveSpeed = {
      cruiseScale,
      currentScale: cruiseScale,
      targetScale: cruiseScale,
      intent: null,
      laneChangeWaitSeconds: 0
    }
  }

  return car.adaptiveSpeed
}

function deterministicCarCruiseScale(carId, config) {
  const minCruiseScale = positiveNumberOrDefault(config.minCruiseSpeedScale, CAR_CONFIG.minCruiseSpeedScale)
  const maxCruiseScale = Math.max(
    minCruiseScale,
    positiveNumberOrDefault(config.maxCruiseSpeedScale, CAR_CONFIG.maxCruiseSpeedScale)
  )
  const value = Math.sin((Number(carId) + 1) * 12.9898) * 43758.5453
  const unit = value - Math.floor(value)

  return minCruiseScale + unit * (maxCruiseScale - minCruiseScale)
}

function edgeSpeedLimit(edge, config) {
  const configuredLimit = Math.max(
    1,
    Math.min(
      positiveNumberOrDefault(config.maxSpeed, CAR_CONFIG.maxSpeed),
      edge.speedLimit * positiveNumberOrDefault(config.speedLimitScale, CAR_CONFIG.speedLimitScale)
    )
  )
  const durationLimitedSpeed = Math.max(1, edge.worldLength / MIN_EDGE_DURATION_SECONDS)

  return Math.min(configuredLimit, durationLimitedSpeed)
}

function edgeSpeedForCar(edge, car, config, knownSpeedLimit = null) {
  const speedLimit = knownSpeedLimit ?? edgeSpeedLimit(edge, config)
  const speedScale = clampAdaptiveSpeedScale(car.adaptiveSpeed?.currentScale, config)

  return Math.max(0.001, speedLimit * speedScale)
}

function clampAdaptiveSpeedScale(value, config) {
  const minScale = positiveNumberOrDefault(config.minAdaptiveSpeedScale, CAR_CONFIG.minAdaptiveSpeedScale)
  const number = Number(value)

  if (!Number.isFinite(number)) {
    return minScale
  }

  return Math.min(1, Math.max(minScale, number))
}

function moveToward(value, target, maxStep) {
  if (value < target) {
    return Math.min(target, value + maxStep)
  }

  if (value > target) {
    return Math.max(target, value - maxStep)
  }

  return target
}

function createEdgeGeometry(edge) {
  const path = edge.worldPath

  if (!path || path.length === 0) {
    return { point: true, x: 0, y: 0 }
  }

  if (path.length === 1) {
    return { point: true, x: path[0][0], y: path[0][1] }
  }

  if (path.length === 2) {
    return {
      straight: true,
      x0: path[0][0],
      y0: path[0][1],
      x1: path[1][0],
      y1: path[1][1]
    }
  }

  const cumulative = new Float32Array(path.length)
  let distance = 0

  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1]
    const to = path[index]

    distance += Math.hypot(to[0] - from[0], to[1] - from[1])
    cumulative[index] = distance
  }

  return { path, cumulative, distance }
}

function setCarPositionAt(position, geometry, ratio) {
  if (geometry.point) {
    position.x = geometry.x
    position.y = geometry.y
    return
  }

  if (ratio <= 0) {
    if (geometry.straight) {
      position.x = geometry.x0
      position.y = geometry.y0
    } else {
      position.x = geometry.path[0][0]
      position.y = geometry.path[0][1]
    }
    return
  }

  if (ratio >= 1) {
    if (geometry.straight) {
      position.x = geometry.x1
      position.y = geometry.y1
    } else {
      const end = geometry.path[geometry.path.length - 1]
      position.x = end[0]
      position.y = end[1]
    }
    return
  }

  if (geometry.straight) {
    position.x = geometry.x0 + (geometry.x1 - geometry.x0) * ratio
    position.y = geometry.y0 + (geometry.y1 - geometry.y0) * ratio
    return
  }

  const targetDistance = geometry.distance * ratio
  const cumulative = geometry.cumulative

  for (let index = 1; index < cumulative.length; index += 1) {
    if (cumulative[index] >= targetDistance) {
      const from = geometry.path[index - 1]
      const to = geometry.path[index]
      const previousDistance = cumulative[index - 1]
      const segmentDistance = cumulative[index] - previousDistance
      const segmentRatio = segmentDistance === 0 ? 0 : (targetDistance - previousDistance) / segmentDistance

      position.x = from[0] + (to[0] - from[0]) * segmentRatio
      position.y = from[1] + (to[1] - from[1]) * segmentRatio
      return
    }
  }

  const end = geometry.path[geometry.path.length - 1]
  position.x = end[0]
  position.y = end[1]
}

function precomputeEdgeFootprints(network, lengthTiles) {
  const footprints = new Array(network.edgeCount)

  for (let edgeIndex = 0; edgeIndex < network.edgeCount; edgeIndex += 1) {
    const edge = network.edges[edgeIndex]
    const toNodeIndex = network.edgeTo[edgeIndex]

    footprints[edgeIndex] = drivingFootprint(network, toNodeIndex, edge.direction, lengthTiles)
  }

  network.edgeFootprintsByLength.set(lengthTiles, footprints)
  return footprints
}

function collectBuildings(city, types) {
  return (city.buildings || []).filter((building) => buildingHasAnyType(building, types) && building.entrance)
}

function takeRandomItem(items, random) {
  if (!items || items.length === 0) {
    return null
  }

  return items[random.int(items.length)]
}

function positiveIntegerOrDefault(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function positiveNumberOrDefault(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function finiteNumberOrZero(value) {
  return Number.isFinite(value) ? value : 0
}
