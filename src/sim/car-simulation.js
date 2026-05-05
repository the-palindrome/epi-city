import * as PIXI from 'pixi.js'
import { CAR_CONFIG } from '../core/constants.js'
import { createSystemRandom } from '../core/random.js'
import { fillRect } from '../render/pixi-rendering.js'

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
  const graphics = new PIXI.Graphics()
  const random = resolvedConfig.random || createSystemRandom()
  const clock = resolvedConfig.clock || STATIC_CLOCK
  const network = getCarTrafficNetwork(city)
  const router = createCarRoutePlanner(city, resolvedConfig, network)
  const parking = createParkingManager(city, network, resolvedConfig)
  const trafficReservations = createTrafficSignalReservationManager(city)
  const residentialBuildings = collectBuildings(city, 'residential')
  const commercialBuildings = collectBuildings(city, 'commercial')
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
    config: resolvedConfig
  }
  let destroyed = false

  graphics.eventMode = 'none'
  graphics.zIndex = resolvedConfig.zorder
  graphics.zorder = resolvedConfig.zorder
  entityLayer.eventMode = 'none'
  entityLayer.sortableChildren = true
  entityLayer.addChild(graphics)

  for (let id = 0; id < resolvedConfig.count; id += 1) {
    const car = createCarEntity(id, city, residentialBuildings, commercialBuildings, buildingsById, ownerPools, parking, random, resolvedConfig)

    if (!car) {
      break
    }

    cars.push(car)
  }

  function update(deltaSeconds) {
    if (destroyed || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
      return
    }

    const safeDelta = Math.min(deltaSeconds, 0.1)
    const hour = clock.getTimeOfDayHours()

    for (const car of cars) {
      clearCarOwnerWaitingState(car)
    }

    for (const car of cars) {
      if (car.state === 'parked') {
        maybeStartCarTrip(car, hour, context)
      }
    }

    for (const car of cars) {
      if (car.state === 'driving') {
        updateDrivingCar(car, safeDelta, context)
      }
    }
  }

  function render() {
    if (destroyed) {
      return
    }

    drawCars(graphics, cars, city, resolvedConfig)
  }

  render()

  return {
    cars,
    graphics,
    parking,
    router,
    update,
    render,
    destroy() {
      destroyed = true
      trafficReservations.clear()
      parking.clear()

      if (graphics.parent) {
        graphics.parent.removeChild(graphics)
      }

      graphics.destroy()
    }
  }
}

export function createCarRoutePlanner(city, config = {}, network = getCarTrafficNetwork(city)) {
  const routeFields = new Map()

  function findRoute(startNodeIndex, endNodeIndex) {
    if (!Number.isInteger(startNodeIndex) ||
        !Number.isInteger(endNodeIndex) ||
        startNodeIndex < 0 ||
        endNodeIndex < 0 ||
        startNodeIndex >= network.nodeCount ||
        endNodeIndex >= network.nodeCount) {
      return []
    }

    if (startNodeIndex === endNodeIndex) {
      return []
    }

    const field = getRouteField(endNodeIndex)
    return extractLaneRoute(field, startNodeIndex, endNodeIndex, network)
  }

  function getRouteField(endNodeIndex) {
    const cached = routeFields.get(endNodeIndex)

    if (cached) {
      routeFields.delete(endNodeIndex)
      routeFields.set(endNodeIndex, cached)
      return cached
    }

    const field = buildLaneRouteField(network, endNodeIndex)

    routeFields.set(endNodeIndex, field)

    while (routeFields.size > 256) {
      routeFields.delete(routeFields.keys().next().value)
    }

    return field
  }

  return {
    findRoute,
    network,
    clearRouteCache() {
      routeFields.clear()
    },
    getRouteCacheStats() {
      return { fields: routeFields.size }
    }
  }
}

export function getCarTrafficNetwork(city) {
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
    ...buildGeneratedLaneChangeEdges(city, laneGraph, tileToNodeIndex, nodeIndexById)
  ]
  const edgeCount = edges.length
  const authoredEdgeCount = laneGraph.edges.length
  const edgeFrom = new Int32Array(edgeCount)
  const edgeTo = new Int32Array(edgeCount)
  const edgeCosts = new Int32Array(edgeCount)
  const incomingCounts = new Int32Array(nodeCount)

  for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex += 1) {
    const edge = edges[edgeIndex]
    const fromIndex = edge.fromNodeIndex ?? nodeIndexById.get(edge.from)
    const toIndex = edge.toNodeIndex ?? nodeIndexById.get(edge.to)

    edgeFrom[edgeIndex] = fromIndex
    edgeTo[edgeIndex] = toIndex
    edgeCosts[edgeIndex] = edgeBaseCost(edge)
    incomingCounts[toIndex] += 1
  }

  const incomingOffsets = new Int32Array(nodeCount + 1)

  for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
    incomingOffsets[nodeIndex + 1] = incomingOffsets[nodeIndex] + incomingCounts[nodeIndex]
  }

  const incomingCursors = new Int32Array(incomingOffsets)
  const incomingEdges = new Int32Array(edgeCount)

  for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex += 1) {
    incomingEdges[incomingCursors[edgeTo[edgeIndex]]] = edgeIndex
    incomingCursors[edgeTo[edgeIndex]] += 1
  }

  return {
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
    tileToNodeIndex,
    nearestNodeByTile: buildNearestLaneNodeByTile(city, tileToNodeIndex)
  }
}

function buildGeneratedLaneChangeEdges(city, laneGraph, tileToNodeIndex, nodeIndexById) {
  const edges = []
  const strongComponentByNode = buildAuthoredStrongComponents(laneGraph, nodeIndexById)

  for (let nodeIndex = 0; nodeIndex < laneGraph.nodes.length; nodeIndex += 1) {
    const fromNode = laneGraph.nodes[nodeIndex]
    const heading = DIRECTION_OFFSET[fromNode.direction]

    if (!heading || city.tileCrosswalk[city.index(fromNode.tile.x, fromNode.tile.y)] === 1) {
      continue
    }

    for (const lateral of laneChangeLateralOffsets(heading)) {
      const edge = firstValidLaneChangeEdge(city, laneGraph, tileToNodeIndex, strongComponentByNode, fromNode, nodeIndex, heading, lateral)

      if (edge) {
        edges.push(edge)
      }
    }
  }

  return edges
}

function buildAuthoredStrongComponents(laneGraph, nodeIndexById) {
  const nodeCount = laneGraph.nodes.length
  const edgeFromIndexes = []
  const edgeToIndexes = []
  const outgoingCounts = new Int32Array(nodeCount)
  const incomingCounts = new Int32Array(nodeCount)

  for (const edge of laneGraph.edges) {
    const fromIndex = nodeIndexById.get(edge.from)
    const toIndex = nodeIndexById.get(edge.to)

    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) {
      continue
    }

    edgeFromIndexes.push(fromIndex)
    edgeToIndexes.push(toIndex)
    outgoingCounts[fromIndex] += 1
    incomingCounts[toIndex] += 1
  }

  const outgoingOffsets = prefixOffsets(outgoingCounts)
  const incomingOffsets = prefixOffsets(incomingCounts)
  const outgoingCursors = new Int32Array(outgoingOffsets)
  const incomingCursors = new Int32Array(incomingOffsets)
  const outgoingTargets = new Int32Array(edgeFromIndexes.length)
  const incomingTargets = new Int32Array(edgeFromIndexes.length)

  for (let edgeIndex = 0; edgeIndex < edgeFromIndexes.length; edgeIndex += 1) {
    const fromIndex = edgeFromIndexes[edgeIndex]
    const toIndex = edgeToIndexes[edgeIndex]

    outgoingTargets[outgoingCursors[fromIndex]] = toIndex
    outgoingCursors[fromIndex] += 1
    incomingTargets[incomingCursors[toIndex]] = fromIndex
    incomingCursors[toIndex] += 1
  }

  const visitOrder = authoredGraphVisitOrder(nodeCount, outgoingOffsets, outgoingTargets)
  const componentByNode = new Int32Array(nodeCount)
  const stack = new Int32Array(nodeCount)
  let componentIndex = 0

  componentByNode.fill(-1)

  for (let orderIndex = visitOrder.length - 1; orderIndex >= 0; orderIndex -= 1) {
    const startNode = visitOrder[orderIndex]

    if (componentByNode[startNode] !== -1) {
      continue
    }

    let stackLength = 1
    stack[0] = startNode
    componentByNode[startNode] = componentIndex

    while (stackLength > 0) {
      stackLength -= 1
      const nodeIndex = stack[stackLength]

      for (let cursor = incomingOffsets[nodeIndex]; cursor < incomingOffsets[nodeIndex + 1]; cursor += 1) {
        const nextNode = incomingTargets[cursor]

        if (componentByNode[nextNode] !== -1) {
          continue
        }

        componentByNode[nextNode] = componentIndex
        stack[stackLength] = nextNode
        stackLength += 1
      }
    }

    componentIndex += 1
  }

  return componentByNode
}

function prefixOffsets(counts) {
  const offsets = new Int32Array(counts.length + 1)

  for (let index = 0; index < counts.length; index += 1) {
    offsets[index + 1] = offsets[index] + counts[index]
  }

  return offsets
}

function authoredGraphVisitOrder(nodeCount, outgoingOffsets, outgoingTargets) {
  const visited = new Uint8Array(nodeCount)
  const nodeStack = new Int32Array(nodeCount)
  const cursorStack = new Int32Array(nodeCount)
  const order = []

  for (let startNode = 0; startNode < nodeCount; startNode += 1) {
    if (visited[startNode]) {
      continue
    }

    let stackTop = 0
    nodeStack[0] = startNode
    cursorStack[0] = outgoingOffsets[startNode]
    visited[startNode] = 1

    while (stackTop >= 0) {
      const nodeIndex = nodeStack[stackTop]
      const endCursor = outgoingOffsets[nodeIndex + 1]
      let cursor = cursorStack[stackTop]
      let advanced = false

      while (cursor < endCursor) {
        const nextNode = outgoingTargets[cursor]
        cursor += 1

        if (visited[nextNode]) {
          continue
        }

        cursorStack[stackTop] = cursor
        stackTop += 1
        nodeStack[stackTop] = nextNode
        cursorStack[stackTop] = outgoingOffsets[nextNode]
        visited[nextNode] = 1
        advanced = true
        break
      }

      if (!advanced) {
        order.push(nodeIndex)
        stackTop -= 1
      }
    }
  }

  return order
}

function laneChangeLateralOffsets(heading) {
  return [
    Object.freeze({ dx: heading.dy * LANE_CHANGE_LATERAL_TILES, dy: -heading.dx * LANE_CHANGE_LATERAL_TILES, side: 'left' }),
    Object.freeze({ dx: -heading.dy * LANE_CHANGE_LATERAL_TILES, dy: heading.dx * LANE_CHANGE_LATERAL_TILES, side: 'right' })
  ]
}

function firstValidLaneChangeEdge(city, laneGraph, tileToNodeIndex, strongComponentByNode, fromNode, fromNodeIndex, heading, lateral) {
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
        strongComponentByNode[toNodeIndex] === strongComponentByNode[fromNodeIndex] ||
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

    return Object.freeze({
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
    })
  }

  return null
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

function createParkingManager(city, network, config) {
  const occupancy = new Int32Array(city.tiles.length)
  const reservations = new Int32Array(city.tiles.length)
  const candidateCache = new Map()

  occupancy.fill(-1)
  reservations.fill(-1)

  function findAndReserveSpot(building, carId, lengthTiles) {
    const candidates = parkingCandidatesForBuilding(building)

    for (const anchorIndex of candidates) {
      for (const direction of CARDINAL_OFFSETS) {
        const tileIndexes = parkingFootprint(anchorIndex, direction, lengthTiles)

        if (tileIndexes && canReserveParking(tileIndexes, carId)) {
          reserveParking(tileIndexes, carId)
          return {
            anchorIndex,
            tileIndexes,
            direction,
            roadOffset: parkedRoadOffset(anchorIndex)
          }
        }
      }
    }

    return null
  }

  function parkingCandidatesForBuilding(building) {
    if (candidateCache.has(building.id)) {
      return candidateCache.get(building.id)
    }

    const entrance = building.entrance
    const radius = positiveIntegerOrDefault(config.parkingSearchRadius, CAR_CONFIG.parkingSearchRadius)
    const candidates = []

    if (!entrance) {
      candidateCache.set(building.id, candidates)
      return candidates
    }

    for (let tileIndex = 0; tileIndex < city.tileParkable.length; tileIndex += 1) {
      if (city.tileParkable[tileIndex] !== 1) {
        continue
      }

      const x = tileIndex % city.width
      const y = Math.floor(tileIndex / city.width)
      const distance = Math.abs(x - entrance.x) + Math.abs(y - entrance.y)

      if (distance <= radius) {
        candidates.push(tileIndex)
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

    candidateCache.set(building.id, candidates)
    return candidates
  }

  function parkingFootprint(anchorIndex, direction, lengthTiles) {
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

  function parkedRoadOffset(anchorIndex) {
    const x = anchorIndex % city.width
    const y = Math.floor(anchorIndex / city.width)

    for (const offset of CARDINAL_OFFSETS) {
      const nx = x + offset.dx
      const ny = y + offset.dy

      if (nx < 0 || ny < 0 || nx >= city.width || ny >= city.height) {
        continue
      }

      const tileIndex = city.index(nx, ny)

      if (city.tileDrivable[tileIndex] === 1 || network.tileToNodeIndex[tileIndex] !== -1) {
        return offset
      }
    }

    return { dx: 0, dy: 0 }
  }

  function canReserveParking(tileIndexes, carId) {
    for (const tileIndex of tileIndexes) {
      if ((occupancy[tileIndex] !== -1 && occupancy[tileIndex] !== carId) ||
          (reservations[tileIndex] !== -1 && reservations[tileIndex] !== carId)) {
        return false
      }
    }

    return true
  }

  function reserveParking(tileIndexes, carId) {
    for (const tileIndex of tileIndexes) {
      reservations[tileIndex] = carId
    }
  }

  function releaseParkingReservation(tileIndexes, carId) {
    for (const tileIndex of tileIndexes || []) {
      if (reservations[tileIndex] === carId) {
        reservations[tileIndex] = -1
      }
    }
  }

  function occupyTiles(car, tileIndexes) {
    releaseOccupiedTiles(car)

    for (const tileIndex of tileIndexes) {
      occupancy[tileIndex] = car.id
    }

    car.occupiedTiles = tileIndexes
  }

  function releaseOccupiedTiles(car) {
    for (const tileIndex of car.occupiedTiles || []) {
      if (occupancy[tileIndex] === car.id) {
        occupancy[tileIndex] = -1
      }
    }

    car.occupiedTiles = []
  }

  function canOccupy(tileIndexes, carId) {
    for (const tileIndex of tileIndexes) {
      if (occupancy[tileIndex] !== -1 && occupancy[tileIndex] !== carId) {
        return false
      }
    }

    return true
  }

  return {
    occupancy,
    reservations,
    findAndReserveSpot,
    occupyTiles,
    releaseOccupiedTiles,
    releaseParkingReservation,
    canOccupy,
    clear() {
      occupancy.fill(-1)
      reservations.fill(-1)
      candidateCache.clear()
    }
  }
}

function createTrafficSignalReservationManager(city) {
  const tileIndexesByGroupId = new Map()
  const groupReservations = new Map()
  const tileReservations = new Int32Array(city.tiles.length)
  const reservedTilesByCarId = new Map()

  tileReservations.fill(-1)

  for (const group of city.trafficSignals?.groups || []) {
    tileIndexesByGroupId.set(group.id, new Set(group.tiles.map((tile) => city.index(tile.x, tile.y))))
  }

  function canOccupy(tileIndexes, carId) {
    for (const tileIndex of tileIndexes || []) {
      if (tileReservations[tileIndex] !== -1 && tileReservations[tileIndex] !== carId) {
        return false
      }
    }

    return true
  }

  function canReserve(group, tileIndexes, carId) {
    const reservedBy = groupReservations.get(group.id)

    return (reservedBy === undefined || reservedBy === carId) && canOccupy(tileIndexes, carId)
  }

  function reserve(group, tileIndexes, car) {
    releaseReservedTiles(car.id)
    groupReservations.set(group.id, car.id)

    const uniqueTiles = uniqueTileIndexes(tileIndexes)

    for (const tileIndex of uniqueTiles) {
      tileReservations[tileIndex] = car.id
    }

    reservedTilesByCarId.set(car.id, uniqueTiles)
    car.trafficSignalReservation = group.id
  }

  function releaseReservedTiles(carId) {
    const tileIndexes = reservedTilesByCarId.get(carId)

    if (!tileIndexes) {
      return
    }

    for (const tileIndex of tileIndexes) {
      if (tileReservations[tileIndex] === carId) {
        tileReservations[tileIndex] = -1
      }
    }

    reservedTilesByCarId.delete(carId)
  }

  function releaseForCar(car) {
    if (car.trafficSignalReservation && groupReservations.get(car.trafficSignalReservation) === car.id) {
      groupReservations.delete(car.trafficSignalReservation)
    }

    releaseReservedTiles(car.id)
    car.trafficSignalReservation = null
  }

  function releaseIfClear(car) {
    if (!car.trafficSignalReservation || !car.route) {
      return
    }

    const tileIndexes = tileIndexesByGroupId.get(car.trafficSignalReservation)

    if (!tileIndexes || !(car.occupiedTiles || []).some((tileIndex) => tileIndexes.has(tileIndex))) {
      releaseForCar(car)
    }
  }

  function groupTileIndexes(groupId) {
    return tileIndexesByGroupId.get(groupId) || null
  }

  return {
    groupTileIndexes,
    canOccupy,
    canReserve,
    reserve,
    releaseForCar,
    releaseIfClear,
    clear() {
      groupReservations.clear()
      reservedTilesByCarId.clear()
      tileReservations.fill(-1)
    }
  }
}

function createCarEntity(id, city, residentialBuildings, commercialBuildings, buildingsById, ownerPools, parking, random, config) {
  const ownerHome = takeOwnerHome(ownerPools, random)
  const home = ownerHome
    ? buildingsById.get(ownerHome.homeBuildingId)
    : takeRandomItem(residentialBuildings, random)

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
    : createSyntheticOwnersForCar(id, home, commercialBuildings, random, config)

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

function createSyntheticOwnersForCar(carId, home, commercialBuildings, random, config) {
  const maxOwners = Math.min(2, positiveIntegerOrDefault(config.maxOwners, CAR_CONFIG.maxOwners))
  const ownerCount = maxOwners >= 2 && random.next() < positiveNumberOrDefault(config.twoOwnerChance, CAR_CONFIG.twoOwnerChance) ? 2 : 1
  const commuteOwnerIndex = random.int(ownerCount)
  const owners = []

  for (let ownerIndex = 0; ownerIndex < ownerCount; ownerIndex += 1) {
    const work = takeRandomItem(commercialBuildings, random)
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
    return false
  }

  const startNode = context.network.nearestNodeByTile[car.parkingSpot.anchorIndex]
  const endNode = context.network.nearestNodeByTile[destinationParking.anchorIndex]
  const route = context.router.findRoute(startNode, endNode)

  if (route.length === 0) {
    context.parking.releaseParkingReservation(destinationParking.tileIndexes, car.id)
    return false
  }

  car.state = 'driving'
  car.destinationParkingSpot = destinationParking
  car.destinationKind = destinationKind
  car.destinationBuildingId = destinationBuilding.id
  car.route = {
    edges: route,
    cursor: 0,
    currentNode: startNode
  }
  car.movement = null
  car.trafficSignalReservation = null
  car.driverOwnerId = owner.id
  car.riderOwners = [owner]
  car.position = laneNodePosition(context.network, startNode)
  boardCarRiders(car, destinationKind, destinationBuilding)
  return true
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

  while (remaining > 0 && car.state === 'driving') {
    if (!car.movement && !startNextDrivingEdge(car, context)) {
      return
    }

    const movement = car.movement
    const step = Math.min(remaining, movement.duration - movement.elapsed)

    movement.elapsed += step
    remaining -= step
    car.position = edgePositionAt(movement.edge, movement.elapsed / movement.duration)

    if (movement.elapsed < movement.duration) {
      return
    }

    car.position = edgePositionAt(movement.edge, 1)
    car.route.currentNode = movement.toNodeIndex
    context.trafficReservations.releaseIfClear(car)
    car.movement = null
  }
}

function startNextDrivingEdge(car, context) {
  if (!car.route || car.route.cursor >= car.route.edges.length) {
    parkCarAtDestination(car, context)
    return false
  }

  const edgeIndex = car.route.edges[car.route.cursor]
  const edge = context.network.edges[edgeIndex]
  const toNodeIndex = context.network.edgeTo[edgeIndex]
  const fromNodeIndex = context.network.edgeFrom[edgeIndex]
  const nextFootprint = edgeDrivingFootprint(context.city, context.network, edge, toNodeIndex, car.lengthTiles)
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

  const rightHandMovement = createRightHandMovement(car, context)

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
    return false
  }

  if (!context.parking.canOccupy(nextFootprint, car.id) ||
      !context.trafficReservations.canOccupy(nextFootprint, car.id)) {
    return false
  }

  if (trafficSignalGroup) {
    context.trafficReservations.reserve(trafficSignalGroup, trafficSignalClearanceTiles, car)
  }

  context.parking.occupyTiles(car, nextFootprint)
  car.direction = DIRECTION_OFFSET[edge.direction] || car.direction
  car.route.cursor += 1
  car.movement = {
    edgeIndex,
    edge,
    toNodeIndex,
    elapsed: 0,
    duration: edgeDuration(edge, context.config)
  }
  return true
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

    appendUniqueTileIndexes(tileIndexes, edgeDrivingFootprint(context.city, context.network, edge, toNodeIndex, car.lengthTiles))

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

function shouldYieldByRightHandRule(car, movement, context) {
  for (const other of context.cars) {
    if (other === car ||
        other.state !== 'driving' ||
        other.movement ||
        !other.route ||
        other.route.cursor >= other.route.edges.length) {
      continue
    }

    const otherMovement = createRightHandMovement(other, context)

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

function rightHandCandidateCanEnter(car, movement, context) {
  const edge = movement.edge
  const nextFootprint = edgeDrivingFootprint(context.city, context.network, edge, movement.toNodeIndex, car.lengthTiles)
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

  const bTiles = new Set(b.tileIndexes)

  return a.tileIndexes.some((tileIndex) => bTiles.has(tileIndex))
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
    appendUniqueTileIndexes(clearanceTiles, edgeDrivingFootprint(context.city, context.network, edge, toNodeIndex, car.lengthTiles))

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

function drivingFootprint(city, network, nodeIndex, directionName, lengthTiles) {
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

function edgeDrivingFootprint(city, network, edge, toNodeIndex, lengthTiles) {
  return drivingFootprint(city, network, toNodeIndex, edge.direction, lengthTiles)
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

function edgeDuration(edge, config) {
  const speedLimit = Math.max(1, Math.min(positiveNumberOrDefault(config.maxSpeed, CAR_CONFIG.maxSpeed), edge.speedLimit * positiveNumberOrDefault(config.speedLimitScale, CAR_CONFIG.speedLimitScale)))
  return Math.max(0.05, edge.worldLength / speedLimit)
}

function interpolate(from, to, ratio) {
  return {
    x: from.x + (to.x - from.x) * ratio,
    y: from.y + (to.y - from.y) * ratio
  }
}

function edgePositionAt(edge, ratio) {
  const path = edge.worldPath

  if (!path || path.length === 0) {
    return { x: 0, y: 0 }
  }

  if (ratio <= 0 || path.length === 1) {
    return { x: path[0][0], y: path[0][1] }
  }

  if (ratio >= 1) {
    const end = path[path.length - 1]
    return { x: end[0], y: end[1] }
  }

  const targetDistance = edge.worldLength * ratio
  let walkedDistance = 0

  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1]
    const to = path[index]
    const segmentLength = Math.hypot(to[0] - from[0], to[1] - from[1])

    if (walkedDistance + segmentLength >= targetDistance) {
      const segmentRatio = segmentLength === 0 ? 0 : (targetDistance - walkedDistance) / segmentLength
      return interpolate(
        { x: from[0], y: from[1] },
        { x: to[0], y: to[1] },
        segmentRatio
      )
    }

    walkedDistance += segmentLength
  }

  const end = path[path.length - 1]
  return { x: end[0], y: end[1] }
}

function drawCars(graphics, cars, city, config) {
  graphics.clear()

  for (const car of cars) {
    drawCar(graphics, car, city, config)
  }
}

function drawCar(graphics, car, city, config) {
  const direction = car.direction || { dx: 1, dy: 0 }
  const length = car.state === 'parked'
    ? car.lengthTiles * city.tileSize * 0.82
    : positiveNumberOrDefault(config.roadBodyLength, CAR_CONFIG.roadBodyLength)
  const width = positiveNumberOrDefault(config.bodyWidth, CAR_CONFIG.bodyWidth)
  const horizontal = Math.abs(direction.dx) >= Math.abs(direction.dy)
  const rectWidth = horizontal ? length : width
  const rectHeight = horizontal ? width : length

  fillRect(
    graphics,
    Math.round(car.position.x - rectWidth / 2),
    Math.round(car.position.y - rectHeight / 2),
    Math.round(rectWidth),
    Math.round(rectHeight),
    car.color
  )
}

function collectBuildings(city, type) {
  return (city.buildings || []).filter((building) => building.type === type && building.entrance)
}

function takeRandomItem(items, random) {
  if (!items || items.length === 0) {
    return null
  }

  return items[random.int(items.length)]
}

function hourInRange(hour, start, end) {
  const normalized = ((hour % 24) + 24) % 24

  if (start === end) {
    return true
  }

  if (start < end) {
    return normalized >= start && normalized < end
  }

  return normalized >= start || normalized < end
}

function positiveIntegerOrDefault(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function positiveNumberOrDefault(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

class IndexPriorityQueue {
  constructor(initialCapacity) {
    this.indexes = new Int32Array(initialCapacity)
    this.priorities = new Int32Array(initialCapacity)
    this.length = 0
  }

  push(index, priority) {
    this.ensureCapacity(this.length + 1)

    let cursor = this.length

    this.length += 1

    while (cursor > 0) {
      const parent = (cursor - 1) >> 1

      if (this.priorities[parent] <= priority) {
        break
      }

      this.indexes[cursor] = this.indexes[parent]
      this.priorities[cursor] = this.priorities[parent]
      cursor = parent
    }

    this.indexes[cursor] = index
    this.priorities[cursor] = priority
  }

  pop() {
    const first = this.indexes[0]
    const lastIndex = this.indexes[this.length - 1]
    const lastPriority = this.priorities[this.length - 1]

    this.length -= 1

    if (this.length > 0) {
      this.sinkRoot(lastIndex, lastPriority)
    }

    return first
  }

  sinkRoot(index, priority) {
    let cursor = 0

    while (true) {
      const left = cursor * 2 + 1

      if (left >= this.length) {
        break
      }

      const right = left + 1
      let child = left

      if (right < this.length && this.priorities[right] < this.priorities[left]) {
        child = right
      }

      if (this.priorities[child] >= priority) {
        break
      }

      this.indexes[cursor] = this.indexes[child]
      this.priorities[cursor] = this.priorities[child]
      cursor = child
    }

    this.indexes[cursor] = index
    this.priorities[cursor] = priority
  }

  ensureCapacity(size) {
    if (size <= this.indexes.length) {
      return
    }

    const nextCapacity = this.indexes.length * 2
    const nextIndexes = new Int32Array(nextCapacity)
    const nextPriorities = new Int32Array(nextCapacity)

    nextIndexes.set(this.indexes)
    nextPriorities.set(this.priorities)
    this.indexes = nextIndexes
    this.priorities = nextPriorities
  }
}
