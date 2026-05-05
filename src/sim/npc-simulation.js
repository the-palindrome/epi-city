import * as PIXI from 'pixi.js'
import { NPC_CONFIG } from '../core/constants.js'
import { createSystemRandom } from '../core/random.js'
import { hourInRange, normalizeHour } from '../core/time.js'
import { fillRect } from '../render/pixi-rendering.js'

const STATIC_CLOCK = Object.freeze({
  getTimeOfDayHours: () => 0
})

export function createNpcSimulation(city, entityLayer, config) {
  const graphics = new PIXI.Graphics()
  const random = config.random || createSystemRandom()
  const zorder = Number.isFinite(config.zorder) ? config.zorder : NPC_CONFIG.zorder
  const clock = config.clock || STATIC_CLOCK
  const visibleTileCounts = new Uint8Array(city.tiles.length)
  const visibleTileIndexes = []
  const slotOffsets = createNpcSlotOffsets(city, config)
  const spawnTiles = collectNpcSpawnTiles(city)
  const buildingsByType = collectBuildingsByType(city)
  const unlimitedCapacityTiles = collectBuildingEntranceTiles(city)
  const routePlanner = new NpcRoutePlanner(config)
  const npcs = []
  const context = {
    city,
    clock,
    slotOffsets,
    unlimitedCapacityTiles,
    random,
    routePlanner,
    zorder,
    config
  }
  let destroyed = false

  graphics.eventMode = 'none'
  graphics.zIndex = zorder
  graphics.zorder = zorder
  entityLayer.eventMode = 'none'
  entityLayer.sortableChildren = true
  entityLayer.addChild(graphics)

  for (let id = 0; id < config.count; id += 1) {
    const buildingAssignment = createNpcBuildingAssignment(buildingsByType, random)
    const timetable = createNpcTimetable(city, buildingAssignment, random, config)
    const spawnState = createNpcSpawnState(city, spawnTiles, timetable, clock, random, config, slotOffsets)

    if (!spawnState) {
      break
    }

    npcs.push(new NpcEntity({
      id,
      position: spawnState.position,
      tile: spawnState.tile,
      slot: spawnState.slot,
      present: spawnState.present,
      locationState: spawnState.locationState,
      buildingAssignment,
      timetable,
      random,
      zorder,
      config
    }))
  }

  function update(deltaSeconds) {
    if (destroyed) {
      return
    }

    const safeDelta = Math.min(Math.max(deltaSeconds, 0), 0.1)
    const timeOfDayHours = clock.getTimeOfDayHours()

    for (const npc of npcs) {
      refreshNpcGoal(npc, timeOfDayHours, context)
    }

    for (const npc of npcs) {
      prepareNpcForRouting(npc, safeDelta, context)
    }

    routePlanner.process(context)

    for (const npc of npcs) {
      updateNpcMovement(npc, safeDelta, context)
    }
  }

  function render() {
    if (destroyed) {
      return
    }

    drawNpcs(graphics, npcs, city, config, visibleTileCounts, visibleTileIndexes)
  }

  render()

  return {
    npcs,
    tileCapacity: config.tileCapacity,
    routePlanner,
    graphics,
    update,
    render,
    destroy() {
      destroyed = true

      if (graphics.parent) {
        graphics.parent.removeChild(graphics)
      }

      graphics.destroy()
    }
  }
}

class NpcEntity {
  constructor({ id, position, tile, slot, present, locationState, buildingAssignment, timetable, random, zorder, config }) {
    this.id = id
    this.zorder = zorder
    this.home = buildingAssignment.home ? buildingAssignment.home.id : null
    this.work = buildingAssignment.work ? buildingAssignment.work.id : null
    this.timetable = timetable
    this.goal = null
    this.present = present
    this.locationState = locationState
    this.position = { x: position.x, y: position.y }
    this.tile = { x: tile.x, y: tile.y, index: tile.index }
    this.slot = { id: slot.id, index: slot.index }
    this.movement = {
      speed: random.between(config.minSpeed, config.maxSpeed),
      target: null
    }
    this.routing = createEmptyRouteState()
    this.vehicleTrip = null
    this.waitingForCar = false
    this.carId = null
    this.commuteByCar = false
  }

  getActiveTimetableElement(timeOfDayHours) {
    return this.timetable.getActiveElement(timeOfDayHours)
  }

  setGoal(element) {
    this.goal = element
      ? {
          id: element.id,
          buildingId: element.buildingId,
          location: { ...element.location }
        }
      : null
    this.routing = createEmptyRouteState()
  }

  isInsideGoal() {
    return Boolean(
      this.goal &&
      this.locationState &&
      this.locationState.timetableElementId === this.goal.id &&
      this.locationState.buildingId === this.goal.buildingId
    )
  }

  isAtGoalTile() {
    return Boolean(
      this.present &&
      this.goal &&
      this.tile.x === this.goal.location.x &&
      this.tile.y === this.goal.location.y
    )
  }

  startVehicleTrip({ carId, destinationKind, destinationBuildingId }) {
    this.vehicleTrip = {
      carId,
      destinationKind,
      destinationBuildingId
    }
    this.waitingForCar = false
    this.present = false
    this.locationState = null
    this.movement.target = null
    this.routing = createEmptyRouteState()
  }

  finishVehicleTrip(city, destinationKind, building) {
    if (!building || !building.entrance) {
      this.vehicleTrip = null
      return
    }

    const location = {
      x: building.entrance.x,
      y: building.entrance.y,
      index: city.index(building.entrance.x, building.entrance.y)
    }

    this.vehicleTrip = null
    this.waitingForCar = false
    this.present = false
    this.locationState = {
      timetableElementId: destinationKind,
      buildingId: building.id,
      location
    }
    this.goal = {
      id: destinationKind,
      buildingId: building.id,
      location: { ...location }
    }
    this.position = tileCenterPosition(city, location.x, location.y)
    this.tile = { ...location }
    this.slot = { id: -1, index: -1 }
    this.movement.target = null
    this.routing = createEmptyRouteState()
  }
}

class NpcTimetable {
  constructor(elements) {
    this.elements = elements
  }

  getActiveElement(timeOfDayHours) {
    const hour = normalizeHour(timeOfDayHours)

    return this.elements.find((element) => hourInRange(hour, element.startHour, element.endHour)) || null
  }
}

class NpcRoutePlanner {
  constructor(config) {
    this.planBudget = positiveIntegerOrDefault(config.routePlanBudget, NPC_CONFIG.routePlanBudget)
    this.queue = []
    this.head = 0
  }

  request(npc) {
    if (!npc.present || !npc.goal || npc.routing.queued || npc.routing.retrySeconds > 0) {
      return
    }

    npc.routing.queued = true
    this.queue.push(npc)
  }

  process(context) {
    let planned = 0

    while (planned < this.planBudget && this.head < this.queue.length) {
      const npc = this.queue[this.head]

      this.queue[this.head] = null
      this.head += 1

      npc.routing.queued = false

      if (npc.present && npc.goal) {
        planRouteForNpc(npc, context)
        planned += 1
      }
    }

    this.compactQueue()
  }

  compactQueue() {
    if (this.head === 0) {
      return
    }

    if (this.head >= this.queue.length) {
      this.queue.length = 0
      this.head = 0
      return
    }

    if (this.head > 1024 && this.head * 2 > this.queue.length) {
      this.queue.splice(0, this.head)
      this.head = 0
    }
  }
}

function collectBuildingsByType(city) {
  const buildingsByType = {
    residential: [],
    commercial: []
  }

  for (const building of city.buildings || []) {
    if (Object.prototype.hasOwnProperty.call(buildingsByType, building.type) && building.entrance) {
      buildingsByType[building.type].push(building)
    }
  }

  return buildingsByType
}

function collectBuildingEntranceTiles(city) {
  const entranceTiles = new Uint8Array(city.tiles.length)

  for (const building of city.buildings || []) {
    if (building.entrance) {
      entranceTiles[city.index(building.entrance.x, building.entrance.y)] = 1
    }
  }

  return entranceTiles
}

function createNpcBuildingAssignment(buildingsByType, random) {
  return {
    home: takeRandomItem(buildingsByType.residential, random),
    work: takeRandomItem(buildingsByType.commercial, random)
  }
}

function takeRandomItem(items, random) {
  if (!items || items.length === 0) {
    return null
  }

  return items[random.int(items.length)]
}

function createNpcTimetable(city, buildingAssignment, random, config) {
  if (!buildingAssignment.home || !buildingAssignment.work) {
    return new NpcTimetable([])
  }

  const variationHours = finiteNumberOrDefault(config.scheduleVariationHours, NPC_CONFIG.scheduleVariationHours)
  const workStartHour = normalizeHour(
    finiteNumberOrDefault(config.workStartHour, NPC_CONFIG.workStartHour) + random.between(-variationHours, variationHours)
  )
  const workEndHour = normalizeHour(
    finiteNumberOrDefault(config.workEndHour, NPC_CONFIG.workEndHour) + random.between(-variationHours, variationHours)
  )

  return new NpcTimetable([
    createTimetableElement('home', buildingAssignment.home, workEndHour, workStartHour, city),
    createTimetableElement('work', buildingAssignment.work, workStartHour, workEndHour, city)
  ])
}

function createTimetableElement(id, building, startHour, endHour, city) {
  const location = {
    x: building.entrance.x,
    y: building.entrance.y,
    index: city.index(building.entrance.x, building.entrance.y)
  }

  return {
    id,
    buildingId: building.id,
    location,
    startHour,
    endHour
  }
}

function createNpcSpawnState(city, spawnTiles, timetable, clock, random, config, slotOffsets) {
  const activeElement = timetable.getActiveElement(clock.getTimeOfDayHours())

  if (activeElement) {
    return {
      present: false,
      position: tileCenterPosition(city, activeElement.location.x, activeElement.location.y),
      tile: { ...activeElement.location },
      slot: { id: -1, index: -1 },
      locationState: {
        timetableElementId: activeElement.id,
        buildingId: activeElement.buildingId,
        location: { ...activeElement.location }
      }
    }
  }

  if (spawnTiles.length === 0) {
    return null
  }

  const spawnAnchor = random.int(spawnTiles.length * config.tileCapacity)
  const tileIndex = spawnTiles[Math.floor(spawnAnchor / config.tileCapacity)]
  const slot = spawnAnchor % config.tileCapacity
  const tileX = tileIndex % city.width
  const tileY = Math.floor(tileIndex / city.width)

  return {
    present: true,
    position: tileSlotPosition(city, tileX, tileY, slot, config, slotOffsets),
    tile: { x: tileX, y: tileY, index: tileIndex },
    slot: { id: slot, index: -1 },
    locationState: null
  }
}

function collectNpcSpawnTiles(city) {
  const tiles = []

  for (let index = 0; index < city.tileWalkable.length; index += 1) {
    if (city.tileWalkable[index] && !city.tileCrosswalk[index]) {
      tiles.push(index)
    }
  }

  return tiles
}

function refreshNpcGoal(npc, timeOfDayHours, context) {
  if (npc.vehicleTrip) {
    return
  }

  const activeElement = npc.getActiveTimetableElement(timeOfDayHours)

  if (!activeElement) {
    if (npc.goal) {
      npc.setGoal(null)
    }

    return
  }

  if (!npc.goal || npc.goal.id !== activeElement.id || npc.goal.buildingId !== activeElement.buildingId) {
    npc.setGoal(activeElement)

    if (npc.present) {
      context.routePlanner.request(npc)
    }
  }
}

function prepareNpcForRouting(npc, deltaSeconds, context) {
  if (npc.vehicleTrip || npc.waitingForCar) {
    return
  }

  if (!npc.goal) {
    return
  }

  if (npc.routing.retrySeconds > 0) {
    npc.routing.retrySeconds = Math.max(0, npc.routing.retrySeconds - deltaSeconds)
  }

  if (npc.locationState) {
    if (npc.isInsideGoal()) {
      return
    }

    if (tryExitCurrentLocation(npc, context)) {
      context.routePlanner.request(npc)
    }

    return
  }

  if (npc.movement.target) {
    return
  }

  if (npc.isAtGoalTile()) {
    enterGoalLocation(npc, context)
    return
  }

  if (!npc.routing.routeField && npc.routing.retrySeconds === 0) {
    context.routePlanner.request(npc)
  }
}

function updateNpcMovement(npc, deltaSeconds, context) {
  if (npc.vehicleTrip || npc.waitingForCar) {
    return
  }

  if (!npc.present) {
    return
  }

  if (npc.movement.target) {
    moveNpcTowardTarget(npc, deltaSeconds, context)

    if (!npc.movement.target && npc.isAtGoalTile()) {
      enterGoalLocation(npc, context)
    }

    return
  }

  if (npc.goal) {
    followRoute(npc, deltaSeconds, context)
  }
}

function moveNpcTowardTarget(npc, deltaSeconds, context) {
  const target = npc.movement.target
  const maxStep = npc.movement.speed * deltaSeconds

  if (target.remainingDistance <= maxStep || target.remainingDistance === 0) {
    npc.position.x = target.position.x
    npc.position.y = target.position.y
    npc.tile.x = target.tile.x
    npc.tile.y = target.tile.y
    npc.tile.index = target.tile.index
    npc.slot.id = target.slot.id
    npc.slot.index = target.slot.index
    npc.movement.target = null
    return
  }

  npc.position.x += target.directionX * maxStep
  npc.position.y += target.directionY * maxStep
  target.remainingDistance -= maxStep
}

function followRoute(npc, deltaSeconds, context) {
  if (npc.isAtGoalTile()) {
    enterGoalLocation(npc, context)
    return
  }

  if (!npc.routing.routeField) {
    context.routePlanner.request(npc)
    return
  }

  const nextIndex = nextRouteTileIndex(npc, context)

  if (nextIndex === -1) {
    context.routePlanner.request(npc)
    return
  }

  if (!areNeighborTileIndexes(context.city, npc.tile.index, nextIndex)) {
    npc.routing.routeField = null
    context.routePlanner.request(npc)
    return
  }

  if (tryStartMoveToIndex(npc, nextIndex, context)) {
    npc.routing.blockedSeconds = 0
    return
  }

  npc.routing.blockedSeconds += deltaSeconds

  if (npc.routing.blockedSeconds >= finiteNumberOrDefault(context.config.routeBlockedReplanSeconds, NPC_CONFIG.routeBlockedReplanSeconds)) {
    npc.routing.blockedSeconds = 0
    npc.routing.routeField = null
    context.routePlanner.request(npc)
  }
}

function nextRouteTileIndex(npc, context) {
  return routeFieldNextIndex(npc.routing.routeField, npc.tile.index)
}

function areNeighborTileIndexes(city, fromIndex, toIndex) {
  const fromX = fromIndex % city.width
  const toX = toIndex % city.width
  const dx = toX - fromX

  if (dx < -1 || dx > 1) {
    return false
  }

  const dy = Math.floor(toIndex / city.width) - Math.floor(fromIndex / city.width)

  return dy >= -1 && dy <= 1
}

function planRouteForNpc(npc, context) {
  const routeField = context.city.getCachedRouteFieldByIndex(npc.goal.location.index, 'pedestrian')
  const nextIndex = routeFieldNextIndex(routeField, npc.tile.index)

  if (!routeField || (npc.tile.index !== npc.goal.location.index && nextIndex === -1)) {
    npc.routing.routeField = null
    npc.routing.retrySeconds = finiteNumberOrDefault(context.config.routeRetrySeconds, NPC_CONFIG.routeRetrySeconds)
    return
  }

  npc.routing.routeField = routeField
  npc.routing.destination = { ...npc.goal.location }
  npc.routing.destinationIndex = npc.goal.location.index
  npc.routing.retrySeconds = 0
  npc.routing.blockedSeconds = 0
}

function routeFieldNextIndex(field, fromIndex) {
  if (!field || fromIndex === field.endIndex) {
    return -1
  }

  const directionIndex = field.nextDirection[fromIndex]

  return directionIndex <= 7 ? fromIndex + field.offsets[directionIndex] : -1
}

function tryStartMoveToIndex(npc, targetIndex, context) {
  const tileX = targetIndex % context.city.width
  const tileY = Math.floor(targetIndex / context.city.width)
  return tryStartMoveToTile(npc, tileX, tileY, context, targetIndex)
}

function tryStartMoveToTile(npc, tileX, tileY, context, knownTargetIndex = null) {
  const { city, random, config } = context
  const targetIndex = knownTargetIndex ?? city.index(tileX, tileY)

  if (!city.canStepPedestrianIndex(npc.tile.index, targetIndex)) {
    return false
  }

  const targetSlot = findAvailableNpcSlot(
    targetIndex,
    random,
    config.tileCapacity,
    context.unlimitedCapacityTiles
  )

  const target = targetSlot.unlimited
    ? tileCenterPosition(city, tileX, tileY)
    : tileSlotPosition(city, tileX, tileY, targetSlot.slot, config, context.slotOffsets)
  const dx = target.x - npc.position.x
  const dy = target.y - npc.position.y
  const distance = Math.hypot(dx, dy)

  npc.movement.target = {
    position: target,
    directionX: distance === 0 ? 0 : dx / distance,
    directionY: distance === 0 ? 0 : dy / distance,
    remainingDistance: distance,
    tile: {
      x: tileX,
      y: tileY,
      index: targetIndex
    },
    slot: {
      id: targetSlot.slot,
      index: targetSlot.slotIndex
    }
  }

  return true
}

function tryExitCurrentLocation(npc, context) {
  const location = npc.locationState.location
  const targetSlot = findAvailableNpcSlot(
    location.index,
    context.random,
    context.config.tileCapacity,
    context.unlimitedCapacityTiles
  )

  const position = targetSlot.unlimited
    ? tileCenterPosition(context.city, location.x, location.y)
    : tileSlotPosition(context.city, location.x, location.y, targetSlot.slot, context.config, context.slotOffsets)

  npc.present = true
  npc.locationState = null
  npc.position.x = position.x
  npc.position.y = position.y
  npc.tile.x = location.x
  npc.tile.y = location.y
  npc.tile.index = location.index
  npc.slot.id = targetSlot.slot
  npc.slot.index = targetSlot.slotIndex

  return true
}

function enterGoalLocation(npc, context) {
  if (!npc.goal) {
    return
  }

  npc.present = false
  npc.locationState = {
    timetableElementId: npc.goal.id,
    buildingId: npc.goal.buildingId,
    location: { ...npc.goal.location }
  }
  npc.position = tileCenterPosition(context.city, npc.goal.location.x, npc.goal.location.y)
  npc.tile = { ...npc.goal.location }
  npc.slot = { id: -1, index: -1 }
  npc.movement.target = null
  npc.routing = createEmptyRouteState()
}

function findAvailableNpcSlot(tileIndex, random, tileCapacity, unlimitedCapacityTiles) {
  if (unlimitedCapacityTiles && unlimitedCapacityTiles[tileIndex]) {
    return { slot: -1, slotIndex: -1, unlimited: true }
  }

  return { slot: random.int(tileCapacity), slotIndex: -1, unlimited: false }
}

function createNpcSlotOffsets(city, config) {
  const offsets = new Array(config.tileCapacity)
  const columns = Math.ceil(Math.sqrt(config.tileCapacity))
  const rows = Math.ceil(config.tileCapacity / columns)
  const horizontalSpacing = columns > 1
    ? Math.min(config.slotSpacing, Math.max(0, city.tileSize - config.size) / (columns - 1))
    : 0
  const verticalSpacing = rows > 1
    ? Math.min(config.slotSpacing, Math.max(0, city.tileSize - config.size) / (rows - 1))
    : 0

  for (let slot = 0; slot < config.tileCapacity; slot += 1) {
    const column = slot % columns
    const row = Math.floor(slot / columns)

    offsets[slot] = {
      x: (column - (columns - 1) / 2) * horizontalSpacing,
      y: (row - (rows - 1) / 2) * verticalSpacing
    }
  }

  return offsets
}

function tileSlotPosition(city, tileX, tileY, slot, config, slotOffsets = null) {
  const centerX = (tileX + 0.5) * city.tileSize
  const centerY = (tileY + 0.5) * city.tileSize

  if (slotOffsets) {
    const offset = slotOffsets[slot]

    return {
      x: centerX + offset.x,
      y: centerY + offset.y
    }
  }

  const columns = Math.ceil(Math.sqrt(config.tileCapacity))
  const rows = Math.ceil(config.tileCapacity / columns)
  const column = slot % columns
  const row = Math.floor(slot / columns)
  const horizontalSpacing = columns > 1
    ? Math.min(config.slotSpacing, Math.max(0, city.tileSize - config.size) / (columns - 1))
    : 0
  const verticalSpacing = rows > 1
    ? Math.min(config.slotSpacing, Math.max(0, city.tileSize - config.size) / (rows - 1))
    : 0

  return {
    x: centerX + (column - (columns - 1) / 2) * horizontalSpacing,
    y: centerY + (row - (rows - 1) / 2) * verticalSpacing
  }
}

function tileCenterPosition(city, tileX, tileY) {
  return {
    x: (tileX + 0.5) * city.tileSize,
    y: (tileY + 0.5) * city.tileSize
  }
}

function drawNpcs(graphics, npcs, city, config, visibleTileCounts, visibleTileIndexes) {
  graphics.clear()
  const visibleLimit = Math.min(
    positiveIntegerOrDefault(config.maxVisiblePerTile, NPC_CONFIG.maxVisiblePerTile),
    positiveIntegerOrDefault(config.tileCapacity, NPC_CONFIG.tileCapacity)
  )

  for (const npc of npcs) {
    if (!npc.present) {
      continue
    }

    if (!reserveVisibleNpcTile(tileIndexAtPosition(city, npc.position), visibleLimit, visibleTileCounts, visibleTileIndexes)) {
      continue
    }

    drawNpcBlob(graphics, npc.position.x, npc.position.y, config.size, config.color)
  }

  for (const tileIndex of visibleTileIndexes) {
    visibleTileCounts[tileIndex] = 0
  }

  visibleTileIndexes.length = 0
}

function tileIndexAtPosition(city, position) {
  const tileX = Math.floor(position.x / city.tileSize)
  const tileY = Math.floor(position.y / city.tileSize)

  if (tileX < 0 || tileY < 0 || tileX >= city.width || tileY >= city.height) {
    return -1
  }

  return tileY * city.width + tileX
}

function reserveVisibleNpcTile(tileIndex, visibleLimit, visibleTileCounts, visibleTileIndexes) {
  if (tileIndex < 0) {
    return true
  }

  const count = visibleTileCounts[tileIndex]

  if (count >= visibleLimit) {
    return false
  }

  if (count === 0) {
    visibleTileIndexes.push(tileIndex)
  }

  visibleTileCounts[tileIndex] = count + 1

  return true
}

function drawNpcBlob(graphics, x, y, size, color) {
  const px = Math.round(x - size / 2)
  const py = Math.round(y - size / 2)

  fillRect(graphics, px + 1, py, size - 2, size, color)
  fillRect(graphics, px, py + 2, size, size - 4, color)
}

function createEmptyRouteState() {
  return {
    routeField: null,
    destination: null,
    destinationIndex: -1,
    queued: false,
    retrySeconds: 0,
    blockedSeconds: 0
  }
}

function finiteNumberOrDefault(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}

function positiveIntegerOrDefault(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback
}
