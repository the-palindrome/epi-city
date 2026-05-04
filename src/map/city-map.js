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
import { clamp, indexOf, octileDistance, reconstructPath } from '../core/math.js'
import { MinHeap } from '../core/min-heap.js'

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

  if (data.textureRows !== undefined) {
    validateTextureRowsLayout(data, data)
  }

  return {
    ...data,
    legend: legendEntries,
    buildings
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

    return {
      id: building.id,
      type: building.type,
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
      spans: building.spans.map((span) => [...span])
    }

    for (const [y, x, length] of building.spans) {
      for (let offset = 0; offset < length; offset += 1) {
        tileBuildingIndexes[indexOf(x + offset, y, width)] = buildingIndex
      }
    }

    return runtimeBuilding
  })

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
    const building = getBuilding(x, y)

    return {
      ...legendEntries[tileLegendSymbols[tileIndex]],
      textureId: tileTextureIds[tileIndex],
      zorder: tileZOrders[tileIndex],
      buildingId: building ? building.id : null,
      buildingType: building ? building.type : null
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
    if (!hasTileProperty(toX, toY, property)) {
      return false
    }

    if (property === 'walkable' && isCrosswalk(toX, toY)) {
      const signalState = crosswalkSignals.getState()

      if (signalState === 'green') {
        return true
      }

      return signalState === 'yellow' && isCrosswalk(fromX, fromY)
    }

    const dx = toX - fromX
    const dy = toY - fromY

    if (property !== 'walkable' && Math.abs(dx) === 1 && Math.abs(dy) === 1) {
      return hasTileProperty(fromX + dx, fromY, property) && hasTileProperty(fromX, fromY + dy, property)
    }

    return true
  }

  function canStep(fromX, fromY, toX, toY, mode) {
    return canStepWithProperty(fromX, fromY, toX, toY, modeProperty(mode))
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

    const { open, closed, cameFrom, gScore } = pathScratch

    open.clear()
    closed.fill(0)
    cameFrom.fill(-1)
    gScore.fill(Number.POSITIVE_INFINITY)
    gScore[startIndex] = 0
    open.push({ index: startIndex, f: octileDistance(startTile.x, startTile.y, endTile.x, endTile.y) })

    while (open.length > 0) {
      const current = open.pop()

      if (closed[current.index]) {
        continue
      }

      if (current.index === endIndex) {
        return reconstructPath(cameFrom, current.index, width)
      }

      closed[current.index] = 1

      const currentX = current.index % width
      const currentY = Math.floor(current.index / width)

      for (const direction of DIRECTIONS) {
        const nextX = currentX + direction.dx
        const nextY = currentY + direction.dy

        if (!canStepWithProperty(currentX, currentY, nextX, nextY, property)) {
          continue
        }

        const nextIndex = indexOf(nextX, nextY, width)

        if (closed[nextIndex]) {
          continue
        }

        const tentativeScore = gScore[current.index] + direction.cost

        if (tentativeScore < gScore[nextIndex]) {
          cameFrom[nextIndex] = current.index
          gScore[nextIndex] = tentativeScore
          open.push({
            index: nextIndex,
            f: tentativeScore + octileDistance(nextX, nextY, endTile.x, endTile.y)
          })
        }
      }
    }

    return []
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
    index: (x, y) => indexOf(x, y, width),
    getTile,
    getTileId,
    getTileVariant,
    getTextureId,
    getBuildingId,
    getBuilding,
    inBounds,
    canStep,
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
    findPath
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
    open: new MinHeap((a, b) => a.f - b.f),
    closed: new Uint8Array(length),
    cameFrom: new Int32Array(length),
    gScore: new Float64Array(length)
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
