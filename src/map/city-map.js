import {
  BUILDING_LAYOUT_ENCODING,
  CATEGORY_TO_TILE,
  CROSSWALK_SIGNAL_PHASES,
  DEFAULT_BUILDING_TYPE,
  DIRECTIONS,
  MOVEMENT_PROPERTY_BY_MODE,
  TILE_NAMES,
  TILE_ZORDERS
} from '../core/constants.js'
import { clamp, indexOf, octileDistance } from '../core/math.js'
import { compileLaneGraphLayout, normalizeLaneGraphLayout } from './lane-graph.js'

const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193
const NAVIGATION_CACHE_LIMIT = 4
const ROUTE_FIELD_CACHE_LIMIT = 384
const ROUTE_FIELD_UNREACHABLE = 0xffffffff
const DEFAULT_ROUTE_VARIATION_CHANCE = 0.35
const DEFAULT_ROUTE_VARIATION_SLACK = 20
const SIGNAL_STATE_KEYS = Object.freeze(['red', 'green', 'yellow'])
const SIGNAL_STATE_INDEX = Object.freeze({
  red: 0,
  green: 1,
  yellow: 2
})
const DIRECTION_DX = Object.freeze(DIRECTIONS.map((direction) => direction.dx))
const DIRECTION_DY = Object.freeze(DIRECTIONS.map((direction) => direction.dy))
const DIRECTION_COST = Object.freeze(DIRECTIONS.map((direction) => direction.cost))
const OPPOSITE_DIRECTION = Object.freeze([1, 0, 3, 2, 7, 6, 5, 4])
const DIRECTION_INDEX_BY_OFFSET = new Int8Array([7, 3, 5, 1, -1, 0, 6, 2, 4])
const routeCandidateDirections = new Uint8Array(8)
const routeCandidateScores = new Float64Array(8)
const navigationCache = new Map()

export async function loadCityMap(url, textureRowsUrl) {
  const data = await fetchJson(url, 'map')
  const textureRowsData = await loadTextureRows(textureRowsUrl, data)

  return validateCityMap({
    ...data,
    textureSet: textureRowsData.textureSet || data.textureSet,
    textureRows: textureRowsData.textureRows
  })
}

async function loadTextureRows(url, mapData) {
  if (!url) {
    throw new Error('Texture rows URL is required.')
  }

  const data = await fetchJson(url, 'texture rows')

  validateTextureRowsLayout(data, mapData)
  return data
}

async function fetchJson(url, description) {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Could not load ${url}: ${response.status} ${response.statusText}`)
  }

  try {
    return await response.json()
  } catch (error) {
    throw new Error(`Could not parse ${description} JSON from ${url}: ${error.message}`)
  }
}

export function validateCityMap(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Map JSON must contain a JSON object.')
  }

  if (!Number.isInteger(data.width) || data.width <= 0) {
    throw new Error('Map JSON width must be a positive integer.')
  }

  if (!Number.isInteger(data.height) || data.height <= 0) {
    throw new Error('Map JSON height must be a positive integer.')
  }

  if (!Number.isInteger(data.tileSize) || data.tileSize <= 0) {
    throw new Error('Map JSON tileSize must be a positive integer.')
  }

  if (typeof data.textureSet !== 'string' || data.textureSet.length === 0) {
    throw new Error('Map JSON textureSet must be a non-empty string.')
  }

  if (!data.legend || typeof data.legend !== 'object' || Array.isArray(data.legend)) {
    throw new Error('Map JSON legend must be an object.')
  }

  const legendEntries = normalizeLegend(data.legend)

  if (!Array.isArray(data.rows) || data.rows.length !== data.height) {
    throw new Error(`Map JSON rows must contain exactly ${data.height} rows.`)
  }

  for (let y = 0; y < data.height; y += 1) {
    const row = data.rows[y]

    if (typeof row !== 'string') {
      throw new Error(`Map JSON row ${y} must be a string.`)
    }

    if (row.length !== data.width) {
      throw new Error(`Map JSON row ${y} must be ${data.width} symbols long.`)
    }

    for (let x = 0; x < data.width; x += 1) {
      if (!legendEntries[row[x]]) {
        throw new Error(`Map JSON has unknown symbol "${row[x]}" at ${x},${y}.`)
      }
    }
  }

  const buildings = normalizeBuildingsLayout(data.buildings, data, legendEntries)
  const laneGraph = normalizeLaneGraphLayout(data.laneGraph, data, legendEntries)

  if (data.textureRows !== undefined) {
    validateTextureRowsLayout(data, data)
  }

  return {
    ...data,
    legend: legendEntries,
    buildings,
    laneGraph
  }
}

function validateTextureRowsLayout(data, mapData) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Texture rows JSON must contain a JSON object.')
  }

  if (data.width !== mapData.width || data.height !== mapData.height) {
    throw new Error(`Texture rows JSON must be ${mapData.width}x${mapData.height}.`)
  }

  if (data.textureSet !== undefined && (typeof data.textureSet !== 'string' || data.textureSet.length === 0)) {
    throw new Error('Texture rows JSON textureSet must be a non-empty string when present.')
  }

  if (!Array.isArray(data.textureRows) || data.textureRows.length !== mapData.height) {
    throw new Error(`Texture rows JSON textureRows must contain exactly ${mapData.height} rows.`)
  }

  for (let y = 0; y < mapData.height; y += 1) {
    const row = data.textureRows[y]

    if (!Array.isArray(row) || row.length !== mapData.width) {
      throw new Error(`Texture rows JSON row ${y} must contain exactly ${mapData.width} texture IDs.`)
    }

    for (let x = 0; x < mapData.width; x += 1) {
      if (!Number.isInteger(row[x]) || row[x] < 0) {
        throw new Error(`Texture rows JSON has invalid texture ID at ${x},${y}.`)
      }
    }
  }
}

function normalizeBuildingsLayout(buildings, mapData, legendEntries) {
  if (buildings === undefined) {
    return {
      encoding: BUILDING_LAYOUT_ENCODING,
      defaultType: DEFAULT_BUILDING_TYPE,
      items: []
    }
  }

  if (!buildings || typeof buildings !== 'object' || Array.isArray(buildings)) {
    throw new Error('Map JSON buildings must be an object when present.')
  }

  if (buildings.encoding !== BUILDING_LAYOUT_ENCODING) {
    throw new Error(`Map JSON buildings.encoding must be "${BUILDING_LAYOUT_ENCODING}".`)
  }

  if (buildings.defaultType !== undefined && (typeof buildings.defaultType !== 'string' || buildings.defaultType.length === 0)) {
    throw new Error('Map JSON buildings.defaultType must be a non-empty string when present.')
  }

  if (!Array.isArray(buildings.items)) {
    throw new Error('Map JSON buildings.items must be an array.')
  }

  const { width, height, rows } = mapData
  const covered = new Int32Array(width * height)
  const ids = new Set()
  let expectedBuildingTiles = 0
  let coveredBuildingTiles = 0

  covered.fill(-1)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (legendEntries[rows[y][x]].category === 'building') {
        expectedBuildingTiles += 1
      }
    }
  }

  const items = buildings.items.map((building, buildingIndex) => {
    if (!building || typeof building !== 'object' || Array.isArray(building)) {
      throw new Error(`Map JSON buildings.items[${buildingIndex}] must be an object.`)
    }

    if (typeof building.id !== 'string' || building.id.length === 0) {
      throw new Error(`Map JSON buildings.items[${buildingIndex}].id must be a non-empty string.`)
    }

    if (ids.has(building.id)) {
      throw new Error(`Map JSON buildings has duplicate id "${building.id}".`)
    }

    if (typeof building.type !== 'string' || building.type.length === 0) {
      throw new Error(`Map JSON building "${building.id}" must include a non-empty type string.`)
    }

    if (!Array.isArray(building.spans) || building.spans.length === 0) {
      throw new Error(`Map JSON building "${building.id}" must include non-empty spans.`)
    }

    ids.add(building.id)

    const spans = []
    const componentCells = []

    for (let spanIndex = 0; spanIndex < building.spans.length; spanIndex += 1) {
      const span = building.spans[spanIndex]

      if (!Array.isArray(span) || span.length !== 3 || span.some((value) => !Number.isInteger(value))) {
        throw new Error(`Map JSON building "${building.id}" span ${spanIndex} must be [y, x, length].`)
      }

      const [y, x, length] = span

      if (y < 0 || y >= height || x < 0 || length <= 0 || x + length > width) {
        throw new Error(`Map JSON building "${building.id}" span ${spanIndex} is out of bounds.`)
      }

      spans.push([y, x, length])

      for (let offset = 0; offset < length; offset += 1) {
        const tileX = x + offset
        const tileIndex = indexOf(tileX, y, width)

        if (legendEntries[rows[y][tileX]].category !== 'building') {
          throw new Error(`Map JSON building "${building.id}" covers non-building tile ${tileX},${y}.`)
        }

        if (covered[tileIndex] !== -1) {
          throw new Error(`Map JSON building "${building.id}" overlaps another building at ${tileX},${y}.`)
        }

        covered[tileIndex] = buildingIndex
        componentCells.push(tileIndex)
        coveredBuildingTiles += 1
      }
    }

    validateBuildingComponentConnectivity(componentCells, width, height, building.id)

    const entrance = normalizeBuildingEntrance(building, componentCells, width)

    return {
      id: building.id,
      type: building.type,
      entrance,
      spans
    }
  })

  if (coveredBuildingTiles !== expectedBuildingTiles) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const tileIndex = indexOf(x, y, width)

        if (legendEntries[rows[y][x]].category === 'building' && covered[tileIndex] === -1) {
          throw new Error(`Map JSON buildings do not cover building tile ${x},${y}.`)
        }
      }
    }

    throw new Error(`Map JSON buildings cover ${coveredBuildingTiles} building tiles, expected ${expectedBuildingTiles}.`)
  }

  return {
    encoding: buildings.encoding,
    defaultType: buildings.defaultType || DEFAULT_BUILDING_TYPE,
    items
  }
}

function normalizeBuildingEntrance(building, componentCells, width) {
  if (building.entrance === undefined) {
    return null
  }

  const entrance = building.entrance

  if (!entrance || typeof entrance !== 'object' || Array.isArray(entrance)) {
    throw new Error(`Map JSON building "${building.id}" entrance must be an object with integer x and y.`)
  }

  if (!Number.isInteger(entrance.x) || !Number.isInteger(entrance.y)) {
    throw new Error(`Map JSON building "${building.id}" entrance must include integer x and y.`)
  }

  const entranceIndex = indexOf(entrance.x, entrance.y, width)

  if (!componentCells.includes(entranceIndex)) {
    throw new Error(`Map JSON building "${building.id}" entrance must be inside that building.`)
  }

  return {
    x: entrance.x,
    y: entrance.y
  }
}

function validateBuildingComponentConnectivity(componentCells, width, height, buildingId) {
  if (componentCells.length <= 1) {
    return
  }

  const componentSet = new Set(componentCells)
  const visited = new Set([componentCells[0]])
  const stack = [componentCells[0]]

  while (stack.length > 0) {
    const current = stack.pop()
    const x = current % width
    const y = Math.floor(current / width)

    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) {
          continue
        }

        const nx = x + dx
        const ny = y + dy

        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
          continue
        }

        const neighbor = indexOf(nx, ny, width)

        if (componentSet.has(neighbor) && !visited.has(neighbor)) {
          visited.add(neighbor)
          stack.push(neighbor)
        }
      }
    }
  }

  if (visited.size !== componentCells.length) {
    throw new Error(`Map JSON building "${buildingId}" spans must form one 8-connected component.`)
  }
}

function normalizeLegend(legend) {
  const entries = {}

  for (const [symbol, value] of Object.entries(legend)) {
    if (symbol.length !== 1) {
      throw new Error(`Map JSON legend symbol "${symbol}" must be one character.`)
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Map JSON legend entry "${symbol}" must be an object.`)
    }

    const category = value.category

    if (!Object.prototype.hasOwnProperty.call(CATEGORY_TO_TILE, category)) {
      throw new Error(`Map JSON legend entry "${symbol}" has unknown category "${category}".`)
    }

    for (const property of ['walkable', 'drivable', 'parkable']) {
      if (typeof value[property] !== 'boolean') {
        throw new Error(`Map JSON legend entry "${symbol}" must include boolean ${property}.`)
      }
    }

    entries[symbol] = {
      category,
      walkable: value.walkable,
      drivable: value.drivable,
      parkable: value.parkable
    }
  }

  return entries
}

function tileZorderForCategory(category) {
  return category === 'building' ? TILE_ZORDERS.building : TILE_ZORDERS.default
}

export function compileCityMap(data) {
  const width = data.width
  const height = data.height
  const tileSize = data.tileSize
  const legendEntries = data.legend
  const tiles = new Uint8Array(width * height)
  const tileTextureIds = new Uint32Array(width * height)
  const tileWalkable = new Uint8Array(width * height)
  const tileDrivable = new Uint8Array(width * height)
  const tileParkable = new Uint8Array(width * height)
  const tileCrosswalk = new Uint8Array(width * height)
  const tileZOrders = new Int16Array(width * height)
  const tileLegendSymbols = new Array(width * height)
  const tileBuildingIndexes = new Int32Array(width * height)
  const pathScratch = createPathScratch(width * height)
  const crosswalkSignals = createCrosswalkSignalController(CROSSWALK_SIGNAL_PHASES)
  const laneGraph = compileLaneGraphLayout(data.laneGraph, tileSize)

  tileBuildingIndexes.fill(-1)

  for (let y = 0; y < height; y += 1) {
    const row = data.rows[y]
    const textureRow = data.textureRows[y]

    for (let x = 0; x < width; x += 1) {
      const symbol = row[x]
      const entry = legendEntries[symbol]
      const tileIndex = indexOf(x, y, width)

      if (!entry) {
        throw new Error(`Map JSON has unknown symbol "${symbol}" at ${x},${y}.`)
      }

      tiles[tileIndex] = CATEGORY_TO_TILE[entry.category]
      tileTextureIds[tileIndex] = textureRow[x]
      tileWalkable[tileIndex] = entry.walkable ? 1 : 0
      tileDrivable[tileIndex] = entry.drivable ? 1 : 0
      tileParkable[tileIndex] = entry.parkable ? 1 : 0
      tileCrosswalk[tileIndex] = entry.category === 'crosswalk' ? 1 : 0
      tileZOrders[tileIndex] = tileZorderForCategory(entry.category)
      tileLegendSymbols[tileIndex] = symbol
    }
  }

  const buildings = data.buildings.items.map((building, buildingIndex) => {
    const runtimeBuilding = {
      id: building.id,
      type: building.type,
      entrance: building.entrance ? { ...building.entrance } : null,
      spans: building.spans.map((span) => [...span])
    }

    for (const [y, x, length] of building.spans) {
      for (let offset = 0; offset < length; offset += 1) {
        tileBuildingIndexes[indexOf(x + offset, y, width)] = buildingIndex
      }
    }

    if (runtimeBuilding.entrance) {
      tileWalkable[indexOf(runtimeBuilding.entrance.x, runtimeBuilding.entrance.y, width)] = 1
    }

    return runtimeBuilding
  })
  const navigation = getNavigationData(width, height, tileWalkable, tileDrivable, tileCrosswalk)

  function inBounds(x, y) {
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < width && y < height
  }

  function getTileId(x, y) {
    if (!inBounds(x, y)) {
      return null
    }

    return tiles[indexOf(x, y, width)]
  }

  function getTile(x, y) {
    const tileId = getTileId(x, y)
    return tileId === null ? null : TILE_NAMES[tileId]
  }

  function getTileVariant(x, y) {
    if (!inBounds(x, y)) {
      return null
    }

    const tileIndex = indexOf(x, y, width)
    const legendEntry = legendEntries[tileLegendSymbols[tileIndex]]
    const building = getBuilding(x, y)
    const buildingEntrance = Boolean(
      building &&
      building.entrance &&
      building.entrance.x === x &&
      building.entrance.y === y
    )

    return {
      category: legendEntry.category,
      walkable: tileWalkable[tileIndex] === 1,
      drivable: tileDrivable[tileIndex] === 1,
      parkable: tileParkable[tileIndex] === 1,
      textureId: tileTextureIds[tileIndex],
      zorder: tileZOrders[tileIndex],
      buildingId: building ? building.id : null,
      buildingType: building ? building.type : null,
      buildingEntrance
    }
  }

  function getTextureId(x, y) {
    if (!inBounds(x, y)) {
      return null
    }

    return tileTextureIds[indexOf(x, y, width)]
  }

  function getBuildingIndex(x, y) {
    if (!inBounds(x, y)) {
      return null
    }

    const buildingIndex = tileBuildingIndexes[indexOf(x, y, width)]
    return buildingIndex === -1 ? null : buildingIndex
  }

  function getBuildingId(x, y) {
    const buildingIndex = getBuildingIndex(x, y)
    return buildingIndex === null ? null : buildings[buildingIndex].id
  }

  function getBuilding(x, y) {
    const buildingIndex = getBuildingIndex(x, y)
    return buildingIndex === null ? null : buildings[buildingIndex]
  }

  const tilePropertyLayers = {
    walkable: tileWalkable,
    drivable: tileDrivable,
    parkable: tileParkable
  }

  function modeProperty(mode) {
    const property = MOVEMENT_PROPERTY_BY_MODE[mode]

    if (!property) {
      throw new Error(`Unknown pathfinding mode "${mode}". Use "pedestrian" or "vehicle".`)
    }

    return property
  }

  function hasTileProperty(x, y, property) {
    if (!inBounds(x, y)) {
      return false
    }

    const layer = tilePropertyLayers[property]

    if (!layer) {
      throw new Error(`Unknown tile property "${property}".`)
    }

    return layer[indexOf(x, y, width)] === 1
  }

  function isCrosswalk(x, y) {
    if (!inBounds(x, y)) {
      return false
    }

    return tileCrosswalk[indexOf(x, y, width)] === 1
  }

  function isPassable(x, y, mode) {
    return hasTileProperty(x, y, modeProperty(mode))
  }

  function canStepWithProperty(fromX, fromY, toX, toY, property) {
    if (!inBounds(fromX, fromY) || !inBounds(toX, toY)) {
      return false
    }

    const dx = toX - fromX
    const dy = toY - fromY

    if (dx === 0 && dy === 0) {
      return hasTileProperty(toX, toY, property)
    }

    if (dx < -1 || dx > 1 || dy < -1 || dy > 1) {
      return false
    }

    const directionIndex = DIRECTION_INDEX_BY_OFFSET[(dy + 1) * 3 + dx + 1]

    if (directionIndex === -1) {
      return false
    }

    const stepMasks = getStepMasksForProperty(navigation, property, crosswalkSignals.getState())
    return (stepMasks.outgoing[indexOf(fromX, fromY, width)] & (1 << directionIndex)) !== 0
  }

  function canStep(fromX, fromY, toX, toY, mode) {
    return canStepWithProperty(fromX, fromY, toX, toY, modeProperty(mode))
  }

  function canStepIndex(fromIndex, toIndex, mode) {
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= tiles.length || toIndex >= tiles.length) {
      return false
    }

    const property = modeProperty(mode)

    if (fromIndex === toIndex) {
      return tilePropertyLayers[property][toIndex] === 1
    }

    const fromX = fromIndex % width
    const toX = toIndex % width
    const dx = toX - fromX

    if (dx < -1 || dx > 1) {
      return false
    }

    const dy = Math.floor(toIndex / width) - Math.floor(fromIndex / width)

    if (dy < -1 || dy > 1) {
      return false
    }

    const directionIndex = DIRECTION_INDEX_BY_OFFSET[(dy + 1) * 3 + dx + 1]

    if (directionIndex === -1) {
      return false
    }

    const stepMasks = getStepMasksForProperty(navigation, property, crosswalkSignals.getState())
    return (stepMasks.outgoing[fromIndex] & (1 << directionIndex)) !== 0
  }

  function nearestPassableTile(x, y, mode, maxRadius = Math.max(width, height)) {
    const property = modeProperty(mode)
    const startX = clamp(Math.round(x), 0, width - 1)
    const startY = clamp(Math.round(y), 0, height - 1)

    if (hasTileProperty(startX, startY, property)) {
      return { x: startX, y: startY }
    }

    for (let radius = 1; radius <= maxRadius; radius += 1) {
      const minX = Math.max(0, startX - radius)
      const maxX = Math.min(width - 1, startX + radius)
      const minY = Math.max(0, startY - radius)
      const maxY = Math.min(height - 1, startY + radius)

      for (let yy = minY; yy <= maxY; yy += 1) {
        for (let xx = minX; xx <= maxX; xx += 1) {
          const onRing = xx === minX || xx === maxX || yy === minY || yy === maxY

          if (onRing && hasTileProperty(xx, yy, property)) {
            return { x: xx, y: yy }
          }
        }
      }
    }

    return null
  }

  function findPath(start, end, mode) {
    const property = modeProperty(mode)
    const startTile = nearestPassableTile(start.x, start.y, mode)
    const endTile = nearestPassableTile(end.x, end.y, mode)

    if (!startTile || !endTile) {
      return []
    }

    const startIndex = indexOf(startTile.x, startTile.y, width)
    const endIndex = indexOf(endTile.x, endTile.y, width)

    if (startIndex === endIndex) {
      return [startTile]
    }

    const stepMasks = getStepMasksForProperty(navigation, property, crosswalkSignals.getState())
    const searchRun = beginSearchRun(pathScratch)
    const { open, closedRuns, cameFromRuns, scoreRuns, cameFrom, gScore } = pathScratch

    open.clear()
    gScore[startIndex] = 0
    scoreRuns[startIndex] = searchRun
    cameFrom[startIndex] = -1
    cameFromRuns[startIndex] = searchRun
    open.push(startIndex, octileDistance(startTile.x, startTile.y, endTile.x, endTile.y))

    while (open.length > 0) {
      const currentIndex = open.pop()

      if (closedRuns[currentIndex] === searchRun) {
        continue
      }

      if (currentIndex === endIndex) {
        return reconstructStampedPath(cameFrom, cameFromRuns, currentIndex, width, searchRun)
      }

      closedRuns[currentIndex] = searchRun

      const currentX = currentIndex % width
      const currentY = Math.floor(currentIndex / width)
      let directionMask = stepMasks.outgoing[currentIndex]

      for (let directionIndex = 0; directionMask !== 0; directionIndex += 1, directionMask >>>= 1) {
        if ((directionMask & 1) === 0) {
          continue
        }

        const nextIndex = currentIndex + navigation.offsets[directionIndex]

        if (closedRuns[nextIndex] === searchRun) {
          continue
        }

        const tentativeScore = gScore[currentIndex] + DIRECTION_COST[directionIndex]

        if (scoreRuns[nextIndex] !== searchRun || tentativeScore < gScore[nextIndex]) {
          const nextX = currentX + DIRECTION_DX[directionIndex]
          const nextY = currentY + DIRECTION_DY[directionIndex]

          cameFrom[nextIndex] = currentIndex
          cameFromRuns[nextIndex] = searchRun
          gScore[nextIndex] = tentativeScore
          scoreRuns[nextIndex] = searchRun
          open.push(nextIndex, tentativeScore + octileDistance(nextX, nextY, endTile.x, endTile.y))
        }
      }
    }

    return []
  }

  function findCachedPath(start, end, mode, options = null) {
    const pathIndexes = findCachedPathIndexes(start, end, mode, options)

    return indexesToPath(pathIndexes, width)
  }

  function findCachedPathIndexes(start, end, mode, options = null) {
    const property = modeProperty(mode)
    const startTile = nearestPassableTile(start.x, start.y, mode)
    const endTile = nearestPassableTile(end.x, end.y, mode)

    if (!startTile || !endTile) {
      return []
    }

    const startIndex = indexOf(startTile.x, startTile.y, width)
    const endIndex = indexOf(endTile.x, endTile.y, width)

    if (startIndex === endIndex) {
      return [startIndex]
    }

    const stepMasks = getStepMasksForProperty(navigation, property, crosswalkSignals.getState())
    const field = navigation.routeFields.get(endIndex, stepMasks.cacheKey, stepMasks.incoming)

    return reconstructRouteFieldPathIndexes(field, stepMasks, navigation.offsets, startIndex, endIndex, options)
  }

  return {
    width,
    height,
    tileSize,
    textureSetName: data.textureSet,
    tiles,
    tileTextureIds,
    tileWalkable,
    tileDrivable,
    tileParkable,
    tileCrosswalk,
    tileZOrders,
    tileBuildingIndexes,
    legend: legendEntries,
    buildings,
    laneGraph,
    index: (x, y) => indexOf(x, y, width),
    getTile,
    getTileId,
    getTileVariant,
    getTextureId,
    getBuildingId,
    getBuilding,
    inBounds,
    canStep,
    canStepIndex,
    isWalkable: (x, y) => hasTileProperty(x, y, 'walkable'),
    isDrivable: (x, y) => hasTileProperty(x, y, 'drivable'),
    isParkable: (x, y) => hasTileProperty(x, y, 'parkable'),
    isCrosswalk,
    getCrosswalkSignalState: () => crosswalkSignals.getState(),
    setCrosswalkSignalState: (state) => crosswalkSignals.setState(state),
    resetCrosswalkSignals: () => crosswalkSignals.reset(),
    updateCrosswalkSignals: (deltaSeconds) => crosswalkSignals.update(deltaSeconds),
    isPassable,
    nearestPassableTile,
    findPath,
    findCachedPath,
    findCachedPathIndexes,
    navigationCacheKey: navigation.cacheKey,
    getNavigationCacheStats: () => ({
      cacheKey: navigation.cacheKey,
      routeFields: navigation.routeFields.size,
      routeFieldHits: navigation.routeFields.hits,
      routeFieldMisses: navigation.routeFields.misses,
      routeFieldLimit: navigation.routeFields.limit
    })
  }
}

function createCrosswalkSignalController(phases) {
  let phaseIndex = 0
  let elapsedSeconds = 0

  function currentPhase() {
    return phases[phaseIndex]
  }

  function getState() {
    return currentPhase().state
  }

  function setState(state) {
    const nextIndex = phases.findIndex((phase) => phase.state === state)

    if (nextIndex === -1) {
      throw new Error(`Unknown crosswalk signal state "${state}".`)
    }

    phaseIndex = nextIndex
    elapsedSeconds = 0
  }

  function reset() {
    phaseIndex = 0
    elapsedSeconds = 0
  }

  function update(deltaSeconds) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
      return
    }

    elapsedSeconds += deltaSeconds

    while (elapsedSeconds >= currentPhase().duration) {
      elapsedSeconds -= currentPhase().duration
      phaseIndex = (phaseIndex + 1) % phases.length
    }
  }

  return {
    getState,
    setState,
    reset,
    update
  }
}

function createPathScratch(length) {
  return {
    open: new IndexPriorityQueue(Math.min(Math.max(length, 16), 65536)),
    closedRuns: new Uint32Array(length),
    cameFromRuns: new Uint32Array(length),
    scoreRuns: new Uint32Array(length),
    cameFrom: new Int32Array(length),
    gScore: new Int32Array(length),
    runId: 0
  }
}

function beginSearchRun(scratch) {
  scratch.runId += 1

  if (scratch.runId >= 0xffffffff) {
    scratch.closedRuns.fill(0)
    scratch.cameFromRuns.fill(0)
    scratch.scoreRuns.fill(0)
    scratch.runId = 1
  }

  return scratch.runId
}

function getNavigationData(width, height, tileWalkable, tileDrivable, tileCrosswalk) {
  const cacheKey = createNavigationCacheKey(width, height, tileWalkable, tileDrivable, tileCrosswalk)
  const cached = navigationCache.get(cacheKey)

  if (cached) {
    navigationCache.delete(cacheKey)
    navigationCache.set(cacheKey, cached)
    return cached
  }

  const navigation = createNavigationData(cacheKey, width, height, tileWalkable, tileDrivable, tileCrosswalk)

  navigationCache.set(cacheKey, navigation)

  while (navigationCache.size > NAVIGATION_CACHE_LIMIT) {
    navigationCache.delete(navigationCache.keys().next().value)
  }

  return navigation
}

function createNavigationData(cacheKey, width, height, tileWalkable, tileDrivable, tileCrosswalk) {
  const length = width * height
  const offsets = DIRECTIONS.map((direction) => direction.dy * width + direction.dx)
  const pedestrian = {}

  for (const signalState of SIGNAL_STATE_KEYS) {
    pedestrian[signalState] = buildMovementMasks({
      width,
      height,
      layer: tileWalkable,
      tileCrosswalk,
      property: 'walkable',
      signalState,
      offsets
    })
  }

  return {
    cacheKey,
    offsets,
    pedestrian,
    vehicle: buildMovementMasks({
      width,
      height,
      layer: tileDrivable,
      tileCrosswalk,
      property: 'drivable',
      signalState: null,
      offsets
    }),
    routeFields: createRouteFieldCache(length, offsets)
  }
}

function buildMovementMasks({ width, height, layer, tileCrosswalk, property, signalState }) {
  const length = width * height
  const outgoing = new Uint8Array(length)
  const incoming = new Uint8Array(length)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const currentIndex = indexOf(x, y, width)
      let mask = 0

      for (let directionIndex = 0; directionIndex < DIRECTIONS.length; directionIndex += 1) {
        const nextX = x + DIRECTION_DX[directionIndex]
        const nextY = y + DIRECTION_DY[directionIndex]

        if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
          continue
        }

        const nextIndex = indexOf(nextX, nextY, width)

        if (!canUsePrecomputedStep({
          currentIndex,
          nextIndex,
          directionIndex,
          width,
          layer,
          tileCrosswalk,
          property,
          signalState
        })) {
          continue
        }

        mask |= 1 << directionIndex
        incoming[nextIndex] |= 1 << OPPOSITE_DIRECTION[directionIndex]
      }

      outgoing[currentIndex] = mask
    }
  }

  return {
    outgoing,
    incoming,
    cacheKey: property === 'walkable' ? `walkable:${signalState}` : property
  }
}

function canUsePrecomputedStep({ currentIndex, nextIndex, directionIndex, width, layer, tileCrosswalk, property, signalState }) {
  if (layer[nextIndex] !== 1) {
    return false
  }

  if (property === 'walkable') {
    if (tileCrosswalk[nextIndex] !== 1) {
      return true
    }

    if (tileCrosswalk[currentIndex] === 1) {
      return true
    }

    if (signalState === 'green') {
      return true
    }

    return false
  }

  if (Math.abs(DIRECTION_DX[directionIndex]) === 1 && Math.abs(DIRECTION_DY[directionIndex]) === 1) {
    return layer[currentIndex + DIRECTION_DX[directionIndex]] === 1 &&
      layer[currentIndex + (DIRECTION_DY[directionIndex] * width)] === 1
  }

  return true
}

function getStepMasksForProperty(navigation, property, signalState) {
  if (property === 'walkable') {
    const normalizedState = SIGNAL_STATE_INDEX[signalState] === undefined ? 'red' : signalState

    return navigation.pedestrian[normalizedState]
  }

  if (property === 'drivable') {
    return navigation.vehicle
  }

  throw new Error(`Unknown tile property "${property}".`)
}

function createRouteFieldCache(length, offsets) {
  const fields = new Map()
  const scratch = createPathScratch(length)
  const cache = {
    limit: ROUTE_FIELD_CACHE_LIMIT,
    hits: 0,
    misses: 0,
    get size() {
      return fields.size
    },
    get(endIndex, movementCacheKey, incomingMasks) {
      const fieldKey = `${movementCacheKey}:${endIndex}`
      const cached = fields.get(fieldKey)

      if (cached) {
        fields.delete(fieldKey)
        fields.set(fieldKey, cached)
        cache.hits += 1
        return cached
      }

      const field = buildRouteField(endIndex, incomingMasks, scratch, offsets, length)

      fields.set(fieldKey, field)
      cache.misses += 1

      while (fields.size > ROUTE_FIELD_CACHE_LIMIT) {
        fields.delete(fields.keys().next().value)
      }

      return field
    }
  }

  return cache
}

function buildRouteField(endIndex, incomingMasks, scratch, offsets, length) {
  const nextDirection = new Uint8Array(length)
  const distance = new Uint32Array(length)
  const runId = beginSearchRun(scratch)
  const { open, closedRuns, scoreRuns, gScore } = scratch

  nextDirection.fill(255)
  distance.fill(ROUTE_FIELD_UNREACHABLE)
  open.clear()
  gScore[endIndex] = 0
  scoreRuns[endIndex] = runId
  nextDirection[endIndex] = 254
  distance[endIndex] = 0
  open.push(endIndex, 0)

  while (open.length > 0) {
    const currentIndex = open.pop()

    if (closedRuns[currentIndex] === runId) {
      continue
    }

    closedRuns[currentIndex] = runId

    let directionMask = incomingMasks[currentIndex]

    for (let directionIndex = 0; directionMask !== 0; directionIndex += 1, directionMask >>>= 1) {
      if ((directionMask & 1) === 0) {
        continue
      }

      const previousIndex = currentIndex + offsets[directionIndex]

      if (closedRuns[previousIndex] === runId) {
        continue
      }

      const tentativeScore = gScore[currentIndex] + DIRECTION_COST[directionIndex]

      if (scoreRuns[previousIndex] !== runId || tentativeScore < gScore[previousIndex]) {
        gScore[previousIndex] = tentativeScore
        scoreRuns[previousIndex] = runId
        nextDirection[previousIndex] = OPPOSITE_DIRECTION[directionIndex]
        distance[previousIndex] = tentativeScore
        open.push(previousIndex, tentativeScore)
      }
    }
  }

  return { nextDirection, distance }
}

function reconstructStampedPath(cameFrom, cameFromRuns, endIndex, width, runId) {
  const indexes = []
  let current = endIndex

  while (current !== -1 && cameFromRuns[current] === runId) {
    indexes.push(current)
    current = cameFrom[current]
  }

  indexes.reverse()
  return indexesToPath(indexes, width)
}

function reconstructRouteFieldPathIndexes(field, stepMasks, offsets, startIndex, endIndex, options) {
  const { nextDirection, distance } = field

  if (nextDirection[startIndex] === 255) {
    return []
  }

  const indexes = [startIndex]
  let current = startIndex
  let guard = 0

  while (current !== endIndex && guard < nextDirection.length) {
    const directionIndex = chooseRouteFieldDirection(field, stepMasks, offsets, current, options)

    if (directionIndex > 7) {
      return []
    }

    current += offsets[directionIndex]
    indexes.push(current)
    guard += 1
  }

  return current === endIndex ? indexes : []
}

function chooseRouteFieldDirection(field, stepMasks, offsets, currentIndex, options) {
  const { nextDirection, distance } = field
  const fallbackDirection = nextDirection[currentIndex]
  const variation = options && options.variation ? options.variation : null

  if (!variation || fallbackDirection > 7) {
    return fallbackDirection
  }

  const currentDistance = distance[currentIndex]

  if (currentDistance === ROUTE_FIELD_UNREACHABLE) {
    return fallbackDirection
  }

  const variationTriggered = shouldVaryRouteStep(variation)

  if (!variationTriggered) {
    return fallbackDirection
  }

  const variationSlack = variation ? nonNegativeNumberOrDefault(variation.slack, DEFAULT_ROUTE_VARIATION_SLACK) : 0
  let directionMask = stepMasks.outgoing[currentIndex]
  let bestDirection = fallbackDirection
  let bestScore = Number.POSITIVE_INFINITY
  let candidateCount = 0

  for (let directionIndex = 0; directionMask !== 0; directionIndex += 1, directionMask >>>= 1) {
    if ((directionMask & 1) === 0) {
      continue
    }

    const nextIndex = currentIndex + offsets[directionIndex]
    const nextDistance = distance[nextIndex]

    if (nextDistance === ROUTE_FIELD_UNREACHABLE || nextDistance >= currentDistance) {
      continue
    }

    const routeCost = DIRECTION_COST[directionIndex] + nextDistance

    if (routeCost > currentDistance + variationSlack) {
      continue
    }

    routeCandidateDirections[candidateCount] = directionIndex
    routeCandidateScores[candidateCount] = routeCost
    candidateCount += 1

    if (routeCost < bestScore) {
      bestScore = routeCost
      bestDirection = directionIndex
    }
  }

  if (bestScore !== Number.POSITIVE_INFINITY) {
    return chooseNearGoodRouteFieldDirection(candidateCount, variationSlack, bestDirection, bestScore, variation)
  }

  return bestDirection
}

function shouldVaryRouteStep(variation) {
  if (!variation || !variation.random || typeof variation.random.next !== 'function') {
    return false
  }

  const chance = boundedNumberOrDefault(variation.chance, DEFAULT_ROUTE_VARIATION_CHANCE, 0, 1)

  return chance > 0 && variation.random.next() < chance
}

function chooseNearGoodRouteFieldDirection(totalCandidates, scoreSlack, bestDirection, bestScore, variation) {
  let nearGoodCount = 0

  for (let index = 0; index < totalCandidates; index += 1) {
    if (routeCandidateScores[index] <= bestScore + scoreSlack) {
      nearGoodCount += 1
    }
  }

  if (nearGoodCount <= 1) {
    return bestDirection
  }

  let candidateIndex = randomInteger(variation.random, nearGoodCount)

  for (let index = 0; index < totalCandidates; index += 1) {
    if (routeCandidateScores[index] > bestScore + scoreSlack) {
      continue
    }

    if (candidateIndex === 0) {
      return routeCandidateDirections[index]
    }

    candidateIndex -= 1
  }

  return bestDirection
}

function nonNegativeNumberOrDefault(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

function boundedNumberOrDefault(value, fallback, min, max) {
  return Number.isFinite(value) ? clamp(value, min, max) : fallback
}

function randomInteger(random, maxExclusive) {
  if (typeof random.int === 'function') {
    return random.int(maxExclusive)
  }

  return Math.floor(random.next() * maxExclusive)
}

function indexesToPath(indexes, width) {
  const path = new Array(indexes.length)

  for (let index = 0; index < indexes.length; index += 1) {
    const tileIndex = indexes[index]

    path[index] = {
      x: tileIndex % width,
      y: Math.floor(tileIndex / width)
    }
  }

  return path
}

function createNavigationCacheKey(width, height, tileWalkable, tileDrivable, tileCrosswalk) {
  let hash = FNV_OFFSET_BASIS

  hash = hashNumber(hash, width)
  hash = hashNumber(hash, height)
  hash = hashBytes(hash, tileWalkable)
  hash = hashBytes(hash, tileDrivable)
  hash = hashBytes(hash, tileCrosswalk)

  return `nav-v1:${width}x${height}:${hash >>> 0}`
}

function hashBytes(hash, bytes) {
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index]
    hash = Math.imul(hash, FNV_PRIME)
  }

  return hash >>> 0
}

function hashNumber(hash, value) {
  let number = value >>> 0

  for (let byteIndex = 0; byteIndex < 4; byteIndex += 1) {
    hash ^= number & 0xff
    hash = Math.imul(hash, FNV_PRIME)
    number >>>= 8
  }

  return hash >>> 0
}

class IndexPriorityQueue {
  constructor(initialCapacity) {
    this.indexes = new Int32Array(initialCapacity)
    this.priorities = new Int32Array(initialCapacity)
    this.length = 0
  }

  clear() {
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
    const firstIndex = this.indexes[0]
    const lastIndex = this.indexes[this.length - 1]
    const lastPriority = this.priorities[this.length - 1]

    this.length -= 1

    if (this.length > 0) {
      this.sinkRoot(lastIndex, lastPriority)
    }

    return firstIndex
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

export function validateCityTextureBindings(city, textureSet) {
  if (!textureSet) {
    return
  }

  if (Number.isInteger(textureSet.tileSize) && textureSet.tileSize !== city.tileSize) {
    throw new Error(`Texture set "${textureSet.name}" tileSize ${textureSet.tileSize} does not match map tileSize ${city.tileSize}.`)
  }

  const frameCount = textureSet.frames.length

  for (let index = 0; index < city.tileTextureIds.length; index += 1) {
    const textureId = city.tileTextureIds[index]

    if (textureId >= frameCount) {
      const x = index % city.width
      const y = Math.floor(index / city.width)
      throw new Error(`Texture ID ${textureId} at ${x},${y} is outside texture set "${textureSet.name}" (${frameCount} frames).`)
    }
  }
}
