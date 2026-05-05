export const LANE_GRAPH_ENCODING = 'directed-lanes-v1'
export const TRAFFIC_SIGNAL_ENCODING = 'traffic-signals-v1'

const DEFAULT_DRIVING_SIDE = 'right'
const DEFAULT_COORDINATE_SPACE = 'tile'
const DIRECTIONS = Object.freeze(['north', 'east', 'south', 'west'])
const TRAFFIC_SIGNAL_MOVEMENTS = Object.freeze(['north-south', 'east-west', 'all'])
const TRAFFIC_SIGNAL_STATES = Object.freeze(['green', 'yellow', 'red'])
export const DEFAULT_TRAFFIC_SIGNAL_PHASES = Object.freeze([
  Object.freeze({ movement: 'north-south', state: 'green', duration: 6 }),
  Object.freeze({ movement: 'north-south', state: 'yellow', duration: 2 }),
  Object.freeze({ movement: 'all', state: 'red', duration: 1 }),
  Object.freeze({ movement: 'east-west', state: 'green', duration: 6 }),
  Object.freeze({ movement: 'east-west', state: 'yellow', duration: 2 }),
  Object.freeze({ movement: 'all', state: 'red', duration: 1 })
])
const DIRECTION_OFFSETS = Object.freeze({
  north: { dx: 0, dy: -1 },
  east: { dx: 1, dy: 0 },
  south: { dx: 0, dy: 1 },
  west: { dx: -1, dy: 0 }
})
const EDGE_TYPES = Object.freeze(['lane', 'turn'])
const TURN_TYPES = Object.freeze(['left', 'right', 'straight', 'u-turn', 'merge'])
const LEGACY_NODE_FIELDS = Object.freeze(['axis', 'laneIndex', 'laneCount', 'bandId', 'layer', 'orientation'])
const LEGACY_EDGE_FIELDS = Object.freeze(['axis', 'laneIndex', 'laneCount', 'bandId', 'layer', 'orientation'])

export class LaneNode {
  constructor(node, tileSize) {
    this.id = node.id
    this.x = node.x
    this.y = node.y
    this.worldX = node.x * tileSize
    this.worldY = node.y * tileSize
    this.tile = Object.freeze({ ...node.tile })
    this.direction = node.direction
    Object.freeze(this)
  }
}

export class LaneEdge {
  constructor(edge, nodesById, tileSize) {
    this.id = edge.id
    this.from = edge.from
    this.to = edge.to
    this.fromNode = nodesById.get(edge.from)
    this.toNode = nodesById.get(edge.to)
    this.type = edge.type
    this.direction = edge.direction
    this.turn = edge.turn
    this.speedLimit = edge.speedLimit
    this.path = Object.freeze(edge.path.map((point) => Object.freeze([...point])))
    this.worldPath = Object.freeze(edge.path.map(([x, y]) => Object.freeze([x * tileSize, y * tileSize])))
    this.length = measurePolyline(edge.path)
    this.worldLength = this.length * tileSize
    Object.freeze(this)
  }
}

export class LaneGraph {
  constructor(layout, tileSize) {
    this.encoding = layout.encoding
    this.drivingSide = layout.drivingSide
    this.coordinateSpace = layout.coordinateSpace
    this.nodes = Object.freeze(layout.nodes.map((node) => new LaneNode(node, tileSize)))
    this.nodeById = new Map(this.nodes.map((node) => [node.id, node]))
    this.edges = Object.freeze(layout.edges.map((edge) => new LaneEdge(edge, this.nodeById, tileSize)))
    this.edgeById = new Map(this.edges.map((edge) => [edge.id, edge]))
    this.outgoingEdgesByNodeId = buildEdgeIndex(this.nodes, this.edges, 'from')
    this.incomingEdgesByNodeId = buildEdgeIndex(this.nodes, this.edges, 'to')
    this.trafficSignals = compileTrafficSignalLayout(layout.trafficSignals, this.nodes, this.edges)
  }

  getNode(id) {
    return this.nodeById.get(id) || null
  }

  getEdge(id) {
    return this.edgeById.get(id) || null
  }

  getOutgoingEdges(nodeId) {
    return this.outgoingEdgesByNodeId.get(nodeId) || []
  }

  getIncomingEdges(nodeId) {
    return this.incomingEdgesByNodeId.get(nodeId) || []
  }
}

export function createEmptyLaneGraphLayout() {
  return {
    encoding: LANE_GRAPH_ENCODING,
    drivingSide: DEFAULT_DRIVING_SIDE,
    coordinateSpace: DEFAULT_COORDINATE_SPACE,
    nodes: [],
    edges: [],
    trafficSignals: createEmptyTrafficSignalLayout()
  }
}

export function normalizeLaneGraphLayout(laneGraph, mapData, legendEntries) {
  if (laneGraph === undefined || laneGraph === null) {
    return createEmptyLaneGraphLayout()
  }

  if (!laneGraph || typeof laneGraph !== 'object' || Array.isArray(laneGraph)) {
    throw new Error('Lane graph must be a JSON object.')
  }

  if (laneGraph.encoding !== LANE_GRAPH_ENCODING) {
    throw new Error('Lane graph encoding must be "' + LANE_GRAPH_ENCODING + '".')
  }

  if (laneGraph.drivingSide !== DEFAULT_DRIVING_SIDE) {
    throw new Error('Lane graph currently supports right-side driving only.')
  }

  if (laneGraph.coordinateSpace !== DEFAULT_COORDINATE_SPACE) {
    throw new Error('Lane graph coordinateSpace must be "tile".')
  }

  if (Object.prototype.hasOwnProperty.call(laneGraph, 'laneOffset')) {
    throw new Error('Lane graph laneOffset is not supported; nodes must be centered on tiles.')
  }

  if (Object.prototype.hasOwnProperty.call(laneGraph, 'generated')) {
    throw new Error('Generated lane graph metadata is not supported.')
  }

  if (!Array.isArray(laneGraph.nodes)) {
    throw new Error('Lane graph nodes must be an array.')
  }

  if (!Array.isArray(laneGraph.edges)) {
    throw new Error('Lane graph edges must be an array.')
  }

  const nodeIds = new Set()
  const nodeTiles = new Set()
  const normalizedNodes = laneGraph.nodes.map((node, index) => normalizeLaneNode(node, index, nodeIds, nodeTiles, mapData, legendEntries))
  const nodesById = new Map(normalizedNodes.map((node) => [node.id, node]))
  const edgeIds = new Set()
  const uniqueEdges = uniqueDirectedLaneEdges(laneGraph.edges)
  const normalizedEdges = uniqueEdges.map((edge, index) => normalizeLaneEdge(edge, index, edgeIds, nodesById, mapData))
  const trafficSignals = normalizeTrafficSignalLayout(laneGraph.trafficSignals, normalizedNodes, normalizedEdges)

  return {
    encoding: LANE_GRAPH_ENCODING,
    drivingSide: DEFAULT_DRIVING_SIDE,
    coordinateSpace: DEFAULT_COORDINATE_SPACE,
    nodes: normalizedNodes,
    edges: normalizedEdges,
    trafficSignals
  }
}

export function compileLaneGraphLayout(laneGraph, tileSize) {
  return new LaneGraph(laneGraph || createEmptyLaneGraphLayout(), tileSize)
}

function normalizeLaneNode(node, index, nodeIds, nodeTiles, mapData, legendEntries) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    throw new Error('Lane graph node ' + index + ' must be an object.')
  }

  if (typeof node.id !== 'string' || node.id.length === 0) {
    throw new Error('Lane graph node ' + index + ' must include a non-empty id.')
  }

  if (nodeIds.has(node.id)) {
    throw new Error('Lane graph node id "' + node.id + '" is duplicated.')
  }

  nodeIds.add(node.id)
  rejectLegacyFields('Lane graph node "' + node.id + '"', node, LEGACY_NODE_FIELDS)

  if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
    throw new Error('Lane graph node "' + node.id + '" must include finite x and y coordinates.')
  }

  if (!DIRECTIONS.includes(node.direction)) {
    throw new Error('Lane graph node "' + node.id + '" has invalid direction.')
  }

  const tile = validateNodeTile(node, mapData)
  const tileKey = tile.x + ',' + tile.y

  if (nodeTiles.has(tileKey)) {
    throw new Error('Lane graph has more than one node on tile ' + tileKey + '.')
  }

  nodeTiles.add(tileKey)
  validateDrivableNodeTile(node.id, tile, mapData, legendEntries)

  if (node.x !== tile.x + 0.5 || node.y !== tile.y + 0.5) {
    throw new Error('Lane graph node "' + node.id + '" must be centered on its tile.')
  }

  return {
    id: node.id,
    x: node.x,
    y: node.y,
    tile,
    direction: node.direction
  }
}

function normalizeLaneEdge(edge, index, edgeIds, nodesById, mapData) {
  if (!edge || typeof edge !== 'object' || Array.isArray(edge)) {
    throw new Error('Lane graph edge ' + index + ' must be an object.')
  }

  if (typeof edge.id !== 'string' || edge.id.length === 0) {
    throw new Error('Lane graph edge ' + index + ' must include a non-empty id.')
  }

  if (edgeIds.has(edge.id)) {
    throw new Error('Lane graph edge id "' + edge.id + '" is duplicated.')
  }

  edgeIds.add(edge.id)
  rejectLegacyFields('Lane graph edge "' + edge.id + '"', edge, LEGACY_EDGE_FIELDS)

  const fromNode = nodesById.get(edge.from)
  const toNode = nodesById.get(edge.to)

  if (!fromNode) {
    throw new Error('Lane graph edge "' + edge.id + '" references unknown from node "' + edge.from + '".')
  }

  if (!toNode) {
    throw new Error('Lane graph edge "' + edge.id + '" references unknown to node "' + edge.to + '".')
  }

  const type = edge.type

  if (!EDGE_TYPES.includes(type)) {
    throw new Error('Lane graph edge "' + edge.id + '" has invalid type.')
  }

  const direction = edge.direction

  if (!DIRECTIONS.includes(direction)) {
    throw new Error('Lane graph edge "' + edge.id + '" has invalid direction.')
  }

  const turn = edge.turn ?? null

  if (turn !== null && !TURN_TYPES.includes(turn)) {
    throw new Error('Lane graph edge "' + edge.id + '" has invalid turn type.')
  }

  if (type === 'lane' && turn !== null) {
    throw new Error('Lane graph lane edge "' + edge.id + '" must not include a turn type.')
  }

  if (type === 'turn' && turn === null) {
    throw new Error('Lane graph turn edge "' + edge.id + '" must include a turn type.')
  }

  const expectedDirection = directionBetweenTiles(fromNode.tile, toNode.tile)

  if (expectedDirection === null) {
    throw new Error('Lane graph edge "' + edge.id + '" must connect neighboring tiles.')
  }

  if (direction !== expectedDirection) {
    throw new Error('Lane graph edge "' + edge.id + '" direction does not match its tile order.')
  }

  const speedLimit = edge.speedLimit

  if (!Number.isFinite(speedLimit) || speedLimit <= 0) {
    throw new Error('Lane graph edge "' + edge.id + '" speedLimit must be positive.')
  }

  if (!Array.isArray(edge.path) || edge.path.length !== 2) {
    throw new Error('Lane graph edge "' + edge.id + '" path must contain exactly two points.')
  }

  const path = edge.path.map((point, pointIndex) => normalizePathPoint(edge.id, point, pointIndex, mapData))

  if (path[0][0] !== fromNode.x ||
      path[0][1] !== fromNode.y ||
      path[1][0] !== toNode.x ||
      path[1][1] !== toNode.y) {
    throw new Error('Lane graph edge "' + edge.id + '" path must connect its centered endpoint nodes.')
  }

  return {
    id: edge.id,
    from: edge.from,
    to: edge.to,
    type,
    direction,
    turn,
    speedLimit,
    path
  }
}

function uniqueDirectedLaneEdges(edges) {
  const seen = new Set()
  const uniqueEdges = []

  for (const edge of edges) {
    if (!edge || typeof edge !== 'object' || Array.isArray(edge) ||
        typeof edge.from !== 'string' ||
        typeof edge.to !== 'string') {
      uniqueEdges.push(edge)
      continue
    }

    const edgeKey = edge.from + '->' + edge.to

    if (seen.has(edgeKey)) {
      continue
    }

    seen.add(edgeKey)
    uniqueEdges.push(edge)
  }

  return uniqueEdges
}

function createEmptyTrafficSignalLayout() {
  return {
    encoding: TRAFFIC_SIGNAL_ENCODING,
    overrides: []
  }
}

function normalizeTrafficSignalLayout(trafficSignals, nodes, edges) {
  if (trafficSignals === undefined || trafficSignals === null) {
    return createEmptyTrafficSignalLayout()
  }

  if (!trafficSignals || typeof trafficSignals !== 'object' || Array.isArray(trafficSignals)) {
    throw new Error('Traffic signal metadata must be a JSON object.')
  }

  if (trafficSignals.encoding !== TRAFFIC_SIGNAL_ENCODING) {
    throw new Error('Traffic signal encoding must be "' + TRAFFIC_SIGNAL_ENCODING + '".')
  }

  if (!Array.isArray(trafficSignals.overrides)) {
    throw new Error('Traffic signal overrides must be an array.')
  }

  const autoGroupsById = new Map(buildAutoTrafficSignalGroups(nodes, edges).map((group) => [group.id, group]))
  const overrideIds = new Set()
  const overrides = trafficSignals.overrides.map((override, index) => normalizeTrafficSignalOverride(override, index, overrideIds, autoGroupsById))

  return {
    encoding: TRAFFIC_SIGNAL_ENCODING,
    overrides
  }
}

function normalizeTrafficSignalOverride(override, index, overrideIds, autoGroupsById) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    throw new Error('Traffic signal override ' + index + ' must be an object.')
  }

  if (typeof override.id !== 'string' || override.id.length === 0) {
    throw new Error('Traffic signal override ' + index + ' must include a non-empty id.')
  }

  if (overrideIds.has(override.id)) {
    throw new Error('Traffic signal override id "' + override.id + '" is duplicated.')
  }

  const autoGroup = autoGroupsById.get(override.id)

  if (!autoGroup) {
    throw new Error('Traffic signal override "' + override.id + '" does not match an auto-generated intersection signal.')
  }

  overrideIds.add(override.id)

  const normalized = {
    id: override.id,
    tile: normalizeTrafficSignalOverrideTile(override, autoGroup),
    enabled: override.enabled !== false,
    phaseOffset: normalizePhaseOffset(override.phaseOffset)
  }

  if (override.phases !== undefined) {
    normalized.phases = normalizeTrafficSignalPhases(override.phases, 'Traffic signal override "' + override.id + '"')
  }

  return normalized
}

function normalizeTrafficSignalOverrideTile(override, autoGroup) {
  if (override.tile === undefined) {
    return { ...autoGroup.tile }
  }

  if (!override.tile || typeof override.tile !== 'object' || Array.isArray(override.tile) ||
      !Number.isInteger(override.tile.x) ||
      !Number.isInteger(override.tile.y)) {
    throw new Error('Traffic signal override "' + override.id + '" tile must include integer x and y.')
  }

  if (!autoGroup.tiles.some((tile) => tile.x === override.tile.x && tile.y === override.tile.y)) {
    throw new Error('Traffic signal override "' + override.id + '" tile must belong to that generated signal group.')
  }

  return { x: override.tile.x, y: override.tile.y }
}

function normalizePhaseOffset(value) {
  if (value === undefined) {
    return 0
  }

  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Traffic signal phaseOffset must be a non-negative number.')
  }

  return value
}

function normalizeTrafficSignalPhases(phases, subject) {
  if (!Array.isArray(phases) || phases.length === 0) {
    throw new Error(subject + ' phases must be a non-empty array.')
  }

  return phases.map((phase, index) => {
    if (!phase || typeof phase !== 'object' || Array.isArray(phase)) {
      throw new Error(subject + ' phase ' + index + ' must be an object.')
    }

    if (!TRAFFIC_SIGNAL_MOVEMENTS.includes(phase.movement)) {
      throw new Error(subject + ' phase ' + index + ' has an invalid movement.')
    }

    if (!TRAFFIC_SIGNAL_STATES.includes(phase.state)) {
      throw new Error(subject + ' phase ' + index + ' has an invalid state.')
    }

    if (!Number.isFinite(phase.duration) || phase.duration <= 0) {
      throw new Error(subject + ' phase ' + index + ' duration must be positive.')
    }

    return {
      movement: phase.movement,
      state: phase.state,
      duration: phase.duration
    }
  })
}

function compileTrafficSignalLayout(layout, nodes, edges) {
  const overridesById = new Map((layout?.overrides || []).map((override) => [override.id, override]))
  const groups = buildAutoTrafficSignalGroups(nodes, edges).map((group) => {
    const override = overridesById.get(group.id)
    const phases = override?.phases || DEFAULT_TRAFFIC_SIGNAL_PHASES
    const phaseOffset = override?.phaseOffset ?? defaultTrafficSignalPhaseOffset(group.tile)

    return Object.freeze({
      ...group,
      enabled: override?.enabled !== false,
      phaseOffset,
      phases: Object.freeze(phases.map((phase) => Object.freeze({ ...phase }))),
      cycleDuration: trafficSignalCycleDuration(phases),
      overridden: Boolean(override)
    })
  })

  return Object.freeze({
    encoding: TRAFFIC_SIGNAL_ENCODING,
    groups: Object.freeze(groups),
    overrides: Object.freeze((layout?.overrides || []).map((override) => Object.freeze({
      ...override,
      tile: Object.freeze({ ...override.tile }),
      phases: override.phases ? Object.freeze(override.phases.map((phase) => Object.freeze({ ...phase }))) : undefined
    })))
  })
}

export function buildAutoTrafficSignalGroups(nodes, edges) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const axesByNodeId = new Map(nodes.map((node) => [node.id, new Set()]))

  for (const edge of edges) {
    const axis = axisForDirection(edge.direction)

    if (!axis) {
      continue
    }

    const fromNode = edge.fromNode || nodesById.get(edge.from)
    const toNode = edge.toNode || nodesById.get(edge.to)

    if (fromNode && axesByNodeId.has(fromNode.id)) {
      axesByNodeId.get(fromNode.id).add(axis)
    }

    if (toNode && axesByNodeId.has(toNode.id)) {
      axesByNodeId.get(toNode.id).add(axis)
    }
  }

  const candidateTiles = []
  const candidateKeys = new Set()

  for (const node of nodes) {
    const axes = axesByNodeId.get(node.id)

    if (!axes || axes.size < 2) {
      continue
    }

    const key = tileKey(node.tile)
    candidateKeys.add(key)
    candidateTiles.push({ x: node.tile.x, y: node.tile.y })
  }

  candidateTiles.sort(compareTiles)

  const groups = []
  const visited = new Set()

  for (const tile of candidateTiles) {
    const startKey = tileKey(tile)

    if (visited.has(startKey)) {
      continue
    }

    const tiles = []
    const stack = [tile]
    visited.add(startKey)

    while (stack.length > 0) {
      const current = stack.pop()
      tiles.push(current)

      for (const offset of Object.values(DIRECTION_OFFSETS)) {
        const nextTile = { x: current.x + offset.dx, y: current.y + offset.dy }
        const nextKey = tileKey(nextTile)

        if (!candidateKeys.has(nextKey) || visited.has(nextKey)) {
          continue
        }

        visited.add(nextKey)
        stack.push(nextTile)
      }
    }

    tiles.sort(compareTiles)
    const entryEdges = trafficSignalEntryEdges(edges, nodesById, tiles)
    const entryAxes = new Set(entryEdges.map((entry) => entry.axis))

    if (entryAxes.size < 2) {
      continue
    }

    const anchor = tiles[0]

    groups.push(Object.freeze({
      id: `traffic-signal-${anchor.x}-${anchor.y}`,
      tile: Object.freeze({ ...anchor }),
      tiles: Object.freeze(tiles.map((groupTile) => Object.freeze({ ...groupTile }))),
      entryEdges: Object.freeze(entryEdges.map((entry) => Object.freeze(entry)))
    }))
  }

  return Object.freeze(groups)
}

function trafficSignalEntryEdges(edges, nodesById, tiles) {
  const tileKeys = new Set(tiles.map(tileKey))
  const entryEdges = []

  for (const edge of edges) {
    const fromNode = edge.fromNode || nodesById.get(edge.from)
    const toNode = edge.toNode || nodesById.get(edge.to)

    if (!fromNode || !toNode) {
      continue
    }

    const fromInside = tileKeys.has(tileKey(fromNode.tile))
    const toInside = tileKeys.has(tileKey(toNode.tile))

    if (fromInside || !toInside) {
      continue
    }

    const axis = axisForDirection(edge.direction)

    if (!axis) {
      continue
    }

    entryEdges.push({
      edgeId: edge.id,
      axis,
      direction: edge.direction
    })
  }

  entryEdges.sort((a, b) => a.edgeId.localeCompare(b.edgeId))
  return entryEdges
}

function axisForDirection(direction) {
  if (direction === 'north' || direction === 'south') {
    return 'north-south'
  }

  if (direction === 'east' || direction === 'west') {
    return 'east-west'
  }

  return null
}

function defaultTrafficSignalPhaseOffset(tile) {
  const cycleDuration = trafficSignalCycleDuration(DEFAULT_TRAFFIC_SIGNAL_PHASES)
  return ((tile.x * 3 + tile.y * 5) % cycleDuration)
}

export function trafficSignalCycleDuration(phases) {
  return phases.reduce((total, phase) => total + phase.duration, 0)
}

function tileKey(tile) {
  return tile.x + ',' + tile.y
}

function compareTiles(a, b) {
  return a.y - b.y || a.x - b.x
}

function validateNodeTile(node, mapData) {
  const width = mapData.width
  const height = mapData.height

  if (!node.tile || typeof node.tile !== 'object' || Array.isArray(node.tile)) {
    throw new Error('Lane graph node "' + node.id + '" tile must be an object.')
  }

  if (!Number.isInteger(node.tile.x) || !Number.isInteger(node.tile.y)) {
    throw new Error('Lane graph node "' + node.id + '" tile coordinates must be integers.')
  }

  if (node.tile.x < 0 || node.tile.y < 0 || node.tile.x >= width || node.tile.y >= height) {
    throw new Error('Lane graph node "' + node.id + '" tile is outside the map.')
  }

  return { x: node.tile.x, y: node.tile.y }
}

function validateDrivableNodeTile(nodeId, tile, mapData, legendEntries) {
  const row = mapData.rows[tile.y]
  const symbol = row[tile.x]
  const entry = legendEntries[symbol]

  if (!entry || (entry.category !== 'road' && entry.category !== 'crosswalk')) {
    throw new Error('Lane graph node "' + nodeId + '" must be on a road or crosswalk tile.')
  }
}

function normalizePathPoint(edgeId, point, pointIndex, mapData) {
  if (!Array.isArray(point) || point.length !== 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
    throw new Error('Lane graph edge "' + edgeId + '" path point ' + pointIndex + ' must be [x, y].')
  }

  validatePointBounds(point[0], point[1], mapData, 'Lane graph edge "' + edgeId + '" path point ' + pointIndex)
  return [point[0], point[1]]
}

function validatePointBounds(x, y, mapData, subject) {
  if (x < 0 || y < 0 || x > mapData.width || y > mapData.height) {
    throw new Error(subject + ' is outside the map bounds.')
  }
}

function directionBetweenTiles(fromTile, toTile) {
  const dx = toTile.x - fromTile.x
  const dy = toTile.y - fromTile.y

  for (const [direction, offset] of Object.entries(DIRECTION_OFFSETS)) {
    if (offset.dx === dx && offset.dy === dy) {
      return direction
    }
  }

  return null
}

function rejectLegacyFields(subject, value, fields) {
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(subject + ' includes unsupported legacy field "' + field + '".')
    }
  }
}

function buildEdgeIndex(nodes, edges, endpointProperty) {
  const index = new Map(nodes.map((node) => [node.id, []]))

  for (const edge of edges) {
    index.get(edge[endpointProperty]).push(edge)
  }

  for (const [nodeId, nodeEdges] of index) {
    index.set(nodeId, Object.freeze(nodeEdges))
  }

  return index
}

function measurePolyline(path) {
  let length = 0

  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1]
    const current = path[index]
    length += Math.hypot(current[0] - previous[0], current[1] - previous[1])
  }

  return length
}
