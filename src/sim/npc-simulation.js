import * as PIXI from 'pixi.js'
import { DIRECTIONS, NPC_CONFIG } from '../core/constants.js'
import { createSystemRandom } from '../core/random.js'
import { fillRect } from '../render/pixi-rendering.js'

const STATIC_CLOCK = Object.freeze({
  getTimeOfDayHours: () => 0
})

export function createNpcSimulation(city, entityLayer, config) {
  const graphics = new PIXI.Graphics()
  const random = config.random || createSystemRandom()
  const zorder = Number.isFinite(config.zorder) ? config.zorder : NPC_CONFIG.zorder
  const clock = config.clock || STATIC_CLOCK
  const occupiedSlots = new Int32Array(city.tiles.length * config.tileCapacity)
  const reservedSlots = new Int32Array(city.tiles.length * config.tileCapacity)
  const spawnSlots = collectNpcSpawnSlots(city, config.tileCapacity)
  const buildingsByType = collectBuildingsByType(city)
  const unlimitedCapacityTiles = collectBuildingEntranceTiles(city)
  const routePlanner = new NpcRoutePlanner(config)
  const npcs = []
  const context = {
    city,
    clock,
    occupiedSlots,
    reservedSlots,
    unlimitedCapacityTiles,
    random,
    routePlanner,
    zorder,
    config
  }
  let destroyed = false

  occupiedSlots.fill(-1)
  reservedSlots.fill(-1)
  graphics.eventMode = 'none'
  graphics.zIndex = zorder
  graphics.zorder = zorder
  entityLayer.eventMode = 'none'
  entityLayer.sortableChildren = true
  entityLayer.addChild(graphics)

  for (let id = 0; id < config.count; id += 1) {
    const buildingAssignment = createNpcBuildingAssignment(buildingsByType, random)
    const timetable = createNpcTimetable(city, buildingAssignment, random, config)
    const spawnState = createNpcSpawnState(city, spawnSlots, timetable, clock, random, config)

    if (!spawnState) {
      break
    }

    if (spawnState.present) {
      occupiedSlots[spawnState.slot.index] = id
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

    drawNpcs(graphics, npcs, config)
  }

  render()

  return {
    npcs,
    occupiedSlots,
    reservedSlots,
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

    while (planned < this.planBudget && this.queue.length > 0) {
      const npc = this.queue.shift()

      npc.routing.queued = false

      if (npc.present && npc.goal) {
        planRouteForNpc(npc, context)
        planned += 1
      }
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

function createNpcSpawnState(city, spawnSlots, timetable, clock, random, config) {
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

  if (spawnSlots.length === 0) {
    return null
  }

  const spawnSlotIndex = takeRandomArrayItem(spawnSlots, random)
  const spawnSlot = npcSlotFromIndex(spawnSlotIndex, config.tileCapacity)
  const tileIndex = spawnSlot.tileIndex
  const tileX = tileIndex % city.width
  const tileY = Math.floor(tileIndex / city.width)

  return {
    present: true,
    position: tileSlotPosition(city, tileX, tileY, spawnSlot.slot, config),
    tile: { x: tileX, y: tileY, index: tileIndex },
    slot: { id: spawnSlot.slot, index: spawnSlotIndex },
    locationState: null
  }
}

function collectNpcSpawnSlots(city, tileCapacity) {
  const slots = []

  for (let index = 0; index < city.tileWalkable.length; index += 1) {
    if (city.tileWalkable[index] && !city.tileCrosswalk[index]) {
      for (let slot = 0; slot < tileCapacity; slot += 1) {
        slots.push(npcSlotIndex(index, slot, tileCapacity))
      }
    }
  }

  return slots
}

function refreshNpcGoal(npc, timeOfDayHours, context) {
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

  if (!npc.routing.path && npc.routing.retrySeconds === 0) {
    context.routePlanner.request(npc)
  }
}

function updateNpcMovement(npc, deltaSeconds, context) {
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
    return
  }

  chooseRandomNextTile(npc, context)
}

function moveNpcTowardTarget(npc, deltaSeconds, context) {
  const { occupiedSlots, reservedSlots } = context
  const target = npc.movement.target
  const dx = target.position.x - npc.position.x
  const dy = target.position.y - npc.position.y
  const distance = Math.hypot(dx, dy)
  const maxStep = npc.movement.speed * deltaSeconds

  if (distance <= maxStep || distance === 0) {
    if (npc.slot.index >= 0) {
      occupiedSlots[npc.slot.index] = -1
    }

    if (target.slot.index >= 0) {
      reservedSlots[target.slot.index] = -1
      occupiedSlots[target.slot.index] = npc.id
    }

    npc.position.x = target.position.x
    npc.position.y = target.position.y
    npc.tile.x = target.tile.x
    npc.tile.y = target.tile.y
    npc.tile.index = target.tile.index
    npc.slot.id = target.slot.id
    npc.slot.index = target.slot.index
    if (Number.isInteger(target.routeCursor) && npc.routing.cursor <= target.routeCursor) {
      npc.routing.cursor = target.routeCursor + 1
    }

    npc.movement.target = null
    return
  }

  const ratio = maxStep / distance
  npc.position.x += dx * ratio
  npc.position.y += dy * ratio
}

function followRoute(npc, deltaSeconds, context) {
  if (npc.isAtGoalTile()) {
    enterGoalLocation(npc, context)
    return
  }

  const route = npc.routing.path

  if (!route || npc.routing.cursor >= route.length) {
    context.routePlanner.request(npc)
    return
  }

  const nextTile = nextRouteTile(npc)

  if (!nextTile) {
    context.routePlanner.request(npc)
    return
  }

  if (Math.abs(nextTile.x - npc.tile.x) > 1 || Math.abs(nextTile.y - npc.tile.y) > 1) {
    npc.routing.path = null
    context.routePlanner.request(npc)
    return
  }

  if (tryStartMoveToTile(npc, nextTile.x, nextTile.y, context, npc.routing.cursor)) {
    npc.routing.blockedSeconds = 0
    return
  }

  npc.routing.blockedSeconds += deltaSeconds

  if (npc.routing.blockedSeconds >= finiteNumberOrDefault(context.config.routeBlockedReplanSeconds, NPC_CONFIG.routeBlockedReplanSeconds)) {
    npc.routing.blockedSeconds = 0
    npc.routing.path = null
    context.routePlanner.request(npc)
  }
}

function nextRouteTile(npc) {
  while (
    npc.routing.path &&
    npc.routing.cursor < npc.routing.path.length &&
    npc.routing.path[npc.routing.cursor].x === npc.tile.x &&
    npc.routing.path[npc.routing.cursor].y === npc.tile.y
  ) {
    npc.routing.cursor += 1
  }

  return npc.routing.path && npc.routing.path[npc.routing.cursor] ? npc.routing.path[npc.routing.cursor] : null
}

function planRouteForNpc(npc, context) {
  const path = context.city.findPath(
    { x: npc.tile.x, y: npc.tile.y },
    { x: npc.goal.location.x, y: npc.goal.location.y },
    'pedestrian'
  )

  if (path.length === 0) {
    npc.routing.path = null
    npc.routing.cursor = 0
    npc.routing.retrySeconds = finiteNumberOrDefault(context.config.routeRetrySeconds, NPC_CONFIG.routeRetrySeconds)
    return
  }

  npc.routing.path = path
  npc.routing.cursor = path[0].x === npc.tile.x && path[0].y === npc.tile.y ? 1 : 0
  npc.routing.destination = { ...npc.goal.location }
  npc.routing.retrySeconds = 0
  npc.routing.blockedSeconds = 0
}

function chooseRandomNextTile(npc, context) {
  const { random } = context
  const start = random.int(DIRECTIONS.length)

  for (let offset = 0; offset < DIRECTIONS.length; offset += 1) {
    const direction = DIRECTIONS[(start + offset) % DIRECTIONS.length]
    const candidateX = npc.tile.x + direction.dx
    const candidateY = npc.tile.y + direction.dy

    if (tryStartMoveToTile(npc, candidateX, candidateY, context)) {
      return
    }
  }
}

function tryStartMoveToTile(npc, tileX, tileY, context, routeCursor = null) {
  const { city, occupiedSlots, reservedSlots, random, config } = context

  if (!city.canStep(npc.tile.x, npc.tile.y, tileX, tileY, 'pedestrian')) {
    return false
  }

  const targetIndex = city.index(tileX, tileY)
  const targetSlot = findAvailableNpcSlot(targetIndex, occupiedSlots, reservedSlots, random, config.tileCapacity, context.unlimitedCapacityTiles)

  if (!targetSlot) {
    return false
  }

  const target = targetSlot.unlimited
    ? tileCenterPosition(city, tileX, tileY)
    : tileSlotPosition(city, tileX, tileY, targetSlot.slot, config)

  if (targetSlot.slotIndex >= 0) {
    reservedSlots[targetSlot.slotIndex] = npc.id
  }

  npc.movement.target = {
    position: target,
    tile: {
      x: tileX,
      y: tileY,
      index: targetIndex
    },
    slot: {
      id: targetSlot.slot,
      index: targetSlot.slotIndex
    },
    routeCursor
  }

  return true
}

function tryExitCurrentLocation(npc, context) {
  const location = npc.locationState.location
  const targetSlot = findAvailableNpcSlot(
    location.index,
    context.occupiedSlots,
    context.reservedSlots,
    context.random,
    context.config.tileCapacity,
    context.unlimitedCapacityTiles
  )

  if (!targetSlot) {
    return false
  }

  const position = targetSlot.unlimited
    ? tileCenterPosition(context.city, location.x, location.y)
    : tileSlotPosition(context.city, location.x, location.y, targetSlot.slot, context.config)

  if (targetSlot.slotIndex >= 0) {
    context.occupiedSlots[targetSlot.slotIndex] = npc.id
  }

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

  releaseNpcSlot(npc, context)
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

function releaseNpcSlot(npc, context) {
  if (npc.slot.index >= 0) {
    context.occupiedSlots[npc.slot.index] = -1
  }
}

function findAvailableNpcSlot(tileIndex, occupiedSlots, reservedSlots, random, tileCapacity, unlimitedCapacityTiles) {
  if (unlimitedCapacityTiles && unlimitedCapacityTiles[tileIndex]) {
    return { slot: -1, slotIndex: -1, unlimited: true }
  }

  const startSlot = random.int(tileCapacity)

  for (let offset = 0; offset < tileCapacity; offset += 1) {
    const slot = (startSlot + offset) % tileCapacity
    const slotIndex = npcSlotIndex(tileIndex, slot, tileCapacity)

    if (occupiedSlots[slotIndex] === -1 && reservedSlots[slotIndex] === -1) {
      return { slot, slotIndex, unlimited: false }
    }
  }

  return null
}

function npcSlotIndex(tileIndex, slot, tileCapacity) {
  return tileIndex * tileCapacity + slot
}

function npcSlotFromIndex(slotIndex, tileCapacity) {
  return {
    tileIndex: Math.floor(slotIndex / tileCapacity),
    slot: slotIndex % tileCapacity
  }
}

function tileSlotPosition(city, tileX, tileY, slot, config) {
  const centerX = (tileX + 0.5) * city.tileSize
  const centerY = (tileY + 0.5) * city.tileSize
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

function drawNpcs(graphics, npcs, config) {
  graphics.clear()

  for (const npc of npcs) {
    if (!npc.present) {
      continue
    }

    drawNpcBlob(graphics, npc.position.x, npc.position.y, config.size, config.color)
  }
}

function drawNpcBlob(graphics, x, y, size, color) {
  const px = Math.round(x - size / 2)
  const py = Math.round(y - size / 2)

  fillRect(graphics, px + 1, py, size - 2, size, color)
  fillRect(graphics, px, py + 2, size, size - 4, color)
}

function takeRandomArrayItem(items, random) {
  const index = random.int(items.length)
  const item = items[index]

  items[index] = items[items.length - 1]
  items.pop()

  return item
}

function createEmptyRouteState() {
  return {
    path: null,
    cursor: 0,
    destination: null,
    queued: false,
    retrySeconds: 0,
    blockedSeconds: 0
  }
}

function hourInRange(hour, startHour, endHour) {
  if (startHour === endHour) {
    return true
  }

  if (startHour < endHour) {
    return hour >= startHour && hour < endHour
  }

  return hour >= startHour || hour < endHour
}

function normalizeHour(hour) {
  return ((hour % 24) + 24) % 24
}

function finiteNumberOrDefault(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}

function positiveIntegerOrDefault(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback
}
