import { CAR_CONFIG, NPC_CONFIG } from '../core/constants.js'
import { faceNpcSprite, idleNpcSprite, stepNpcSpriteAnimation } from '../render/npc-sprite.js'
import { toSimulationSeconds } from '../sim/simulation-clock.js'

const MOVEMENT_KEYS = Object.freeze({
  ArrowUp: Object.freeze({ x: 0, y: -1 }),
  ArrowDown: Object.freeze({ x: 0, y: 1 }),
  ArrowLeft: Object.freeze({ x: -1, y: 0 }),
  ArrowRight: Object.freeze({ x: 1, y: 0 }),
  KeyW: Object.freeze({ x: 0, y: -1 }),
  KeyS: Object.freeze({ x: 0, y: 1 }),
  KeyA: Object.freeze({ x: -1, y: 0 }),
  KeyD: Object.freeze({ x: 1, y: 0 })
})
const CONTROLLED_CAR_STATE = 'manual'

export function createEntityControl({
  city,
  getClock,
  getCarSimulation,
  getNpcSimulation,
  requestRender
}) {
  const pressedKeys = new Set()
  let controlled = null
  let destroyed = false

  function assumeControl(kind, id) {
    const selection = resolveEntity(kind, id)

    if (!selection) {
      return false
    }

    clearControl()
    controlled = { kind: selection.kind, id: selection.entity.id }
    prepareEntityForControl(selection.kind, selection.entity)

    if (typeof requestRender === 'function') {
      requestRender()
    }

    return true
  }

  function clearControl() {
    const selection = controlledEntity()

    if (selection) {
      releaseEntityControl(selection.kind, selection.entity)
    }

    controlled = null
    pressedKeys.clear()
  }

  function update(deltaSeconds) {
    if (destroyed || !controlled || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
      return
    }

    const selection = controlledEntity()

    if (!selection) {
      clearControl()
      return
    }

    const direction = movementDirection()

    if (!direction) {
      idleControlledEntity(selection.kind, selection.entity)
      return
    }

    const movementDelta = toSimulationSeconds(getClock?.(), Math.min(deltaSeconds, 0.1))
    const moved = selection.kind === 'car'
      ? moveControlledCar(selection.entity, direction, movementDelta)
      : moveControlledNpc(selection.entity, direction, movementDelta)

    if (moved && typeof requestRender === 'function') {
      requestRender()
    }
  }

  function onKeyDown(event) {
    const key = movementKey(event)

    if (!key || !controlled || isTextEntryTarget(event.target)) {
      return
    }

    pressedKeys.add(key)
    event.preventDefault?.()
    event.stopImmediatePropagation?.()
  }

  function onKeyUp(event) {
    const key = movementKey(event)

    if (!key) {
      return
    }

    pressedKeys.delete(key)

    if (controlled && !isTextEntryTarget(event.target)) {
      event.preventDefault?.()
      event.stopImmediatePropagation?.()
    }
  }

  function controlledEntity() {
    return controlled ? resolveEntity(controlled.kind, controlled.id) : null
  }

  function resolveEntity(kind, id) {
    const normalizedKind = kind === 'car' ? 'car' : kind === 'npc' ? 'npc' : null

    if (!normalizedKind) {
      return null
    }

    const entities = normalizedKind === 'car'
      ? getCarSimulation?.()?.cars || []
      : getNpcSimulation?.()?.npcs || []
    const entity = entities.find((candidate) => candidate.id === id)

    return entity ? { kind: normalizedKind, entity } : null
  }

  function movementDirection() {
    let x = 0
    let y = 0

    for (const key of pressedKeys) {
      const offset = MOVEMENT_KEYS[key]

      x += offset.x
      y += offset.y
    }

    const length = Math.hypot(x, y)

    if (length <= 0.0001) {
      return null
    }

    return { x: x / length, y: y / length }
  }

  function moveControlledNpc(npc, direction, deltaSeconds) {
    if (!npc?.present || !npc.position) {
      return false
    }

    const speed = positiveNumberOrDefault(npc.movement?.speed, NPC_CONFIG.maxSpeed)
    const distance = speed * deltaSeconds
    const movedDistance = movePositionWithSlide(
      npc.position,
      direction.x * distance,
      direction.y * distance,
      (x, y) => canPlaceNpcAt(npc, x, y),
      (x, y) => applyNpcPosition(npc, x, y, direction)
    )

    if (movedDistance > 0) {
      stepNpcSpriteAnimation(npc, direction.x, direction.y, movedDistance)
      npc.movement.headingX = direction.x
      npc.movement.headingY = direction.y
      return true
    }

    faceNpcSprite(npc, direction.x, direction.y)
    idleNpcSprite(npc)
    return false
  }

  function moveControlledCar(car, direction, deltaSeconds) {
    if (!car?.position) {
      return false
    }

    const speed = positiveNumberOrDefault(
      car.manualControlSpeed,
      positiveNumberOrDefault(CAR_CONFIG.maxSpeed, 18) * positiveNumberOrDefault(CAR_CONFIG.speedLimitScale, 0.4)
    )
    const distance = speed * deltaSeconds
    const carDirection = cardinalDirection(direction)
    const movedDistance = movePositionWithSlide(
      car.position,
      direction.x * distance,
      direction.y * distance,
      (x, y) => canPlaceCarAt(car, x, y, carDirection),
      (x, y) => applyCarPosition(car, x, y, carDirection)
    )

    return movedDistance > 0
  }

  function destroy() {
    if (destroyed) {
      return
    }

    destroyed = true
    clearControl()
    document.removeEventListener('keydown', onKeyDown)
    document.removeEventListener('keyup', onKeyUp)
  }

  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('keyup', onKeyUp)

  return {
    assumeControl,
    clearControl,
    update,
    destroy,
    get controlled() {
      return controlled ? { ...controlled } : null
    }
  }

  function prepareEntityForControl(kind, entity) {
    entity.manualControl = true

    if (kind === 'npc') {
      prepareNpcForControl(entity)
    } else {
      prepareCarForControl(entity)
    }
  }

  function releaseEntityControl(kind, entity) {
    entity.manualControl = false

    if (kind === 'npc') {
      idleNpcSprite(entity)
    }
  }

  function idleControlledEntity(kind, entity) {
    if (kind === 'npc') {
      idleNpcSprite(entity)
    }
  }

  function prepareNpcForControl(npc) {
    npc.present = true
    npc.waitingForCar = false
    npc.locationState = null
    npc.vehicleTrip = null

    if (npc.movement) {
      npc.movement.target = null
      npc.movement.headingX = 0
      npc.movement.headingY = 0
    }

    npc.routing = createEmptyNpcRouteState()
    idleNpcSprite(npc)
  }

  function prepareCarForControl(car) {
    const carSimulation = getCarSimulation?.()

    carSimulation?.trafficReservations?.releaseForCar?.(car)
    carSimulation?.parking?.releaseParkingReservation?.(car.destinationParkingSpot?.tileIndexes, car.id)
    carSimulation?.parking?.releaseOccupiedTiles?.(car)

    car.manualControl = true
    car.state = CONTROLLED_CAR_STATE
    car.parkedAt = null
    car.parkedBuildingId = null
    car.parkingSpot = null
    car.destinationParkingSpot = null
    car.destinationKind = null
    car.destinationBuildingId = null
    car.route = null
    car.movement = null
    car.trafficYield = null

    const currentTile = tileAtWorldPosition(car.position.x, car.position.y)
    const passableTile = currentTile && isVehiclePassableTile(currentTile.x, currentTile.y)
      ? currentTile
      : city.nearestPassableTile?.(currentTile?.x ?? 0, currentTile?.y ?? 0, 'vehicle', 4)

    if (passableTile) {
      car.position.x = tileCenterX(passableTile.x)
      car.position.y = tileCenterY(passableTile.y)
    }

    const direction = cardinalDirection(car.direction || { dx: 1, dy: 0 })

    car.direction = { dx: direction.dx, dy: direction.dy }

    const footprint = carFootprintAt(car, car.position.x, car.position.y, direction)

    if (footprint && carSimulation?.parking?.canOccupy?.(footprint, car.id)) {
      carSimulation.parking.occupyTiles(car, footprint)
    }
  }

  function canPlaceNpcAt(npc, x, y) {
    const tile = tileAtWorldPosition(x, y)

    if (!tile || !city.isPassable(tile.x, tile.y, 'pedestrian')) {
      return false
    }

    const fromIndex = Number.isInteger(npc.tile?.index)
      ? npc.tile.index
      : city.index(tile.x, tile.y)

    return tile.index === fromIndex || city.canStepIndex(fromIndex, tile.index, 'pedestrian')
  }

  function applyNpcPosition(npc, x, y, direction) {
    const tile = tileAtWorldPosition(x, y)

    npc.position.x = x
    npc.position.y = y

    if (tile) {
      npc.tile.x = tile.x
      npc.tile.y = tile.y
      npc.tile.index = tile.index
      npc.slot.id = -1
    }

    if (npc.movement) {
      npc.movement.target = null
      npc.movement.headingX = direction.x
      npc.movement.headingY = direction.y
    }
  }

  function canPlaceCarAt(car, x, y, direction) {
    const previousTile = tileAtWorldPosition(car.position.x, car.position.y)
    const nextTile = tileAtWorldPosition(x, y)

    if (!previousTile || !nextTile) {
      return false
    }

    if (previousTile.index !== nextTile.index && !city.canStepIndex(previousTile.index, nextTile.index, 'vehicle')) {
      return false
    }

    const footprint = carFootprintAt(car, x, y, direction)
    const carSimulation = getCarSimulation?.()

    return Boolean(
      footprint &&
      footprint.every((tileIndex) => isVehiclePassableIndex(tileIndex)) &&
      (!carSimulation?.parking || carSimulation.parking.canOccupy(footprint, car.id)) &&
      (!carSimulation?.trafficReservations || carSimulation.trafficReservations.canOccupy(footprint, car.id))
    )
  }

  function applyCarPosition(car, x, y, direction) {
    const footprint = carFootprintAt(car, x, y, direction)
    const carSimulation = getCarSimulation?.()

    car.position.x = x
    car.position.y = y
    car.direction = { dx: direction.dx, dy: direction.dy }
    car.route = null
    car.movement = null

    if (footprint && carSimulation?.parking) {
      carSimulation.parking.occupyTiles(car, footprint)
    }
  }

  function carFootprintAt(car, x, y, direction) {
    const frontTile = tileAtWorldPosition(x, y)

    if (!frontTile) {
      return null
    }

    const lengthTiles = Math.max(1, Math.round(car.lengthTiles || 1))
    const footprint = []

    for (let offset = 0; offset < lengthTiles; offset += 1) {
      const tileX = frontTile.x - direction.dx * offset
      const tileY = frontTile.y - direction.dy * offset

      if (!city.inBounds(tileX, tileY)) {
        return null
      }

      footprint.push(city.index(tileX, tileY))
    }

    return footprint
  }

  function isVehiclePassableIndex(tileIndex) {
    const x = tileIndex % city.width
    const y = Math.floor(tileIndex / city.width)

    return isVehiclePassableTile(x, y)
  }

  function isVehiclePassableTile(x, y) {
    return city.isPassable(x, y, 'vehicle') || city.isCrosswalk(x, y)
  }

  function tileAtWorldPosition(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null
    }

    const tileX = Math.floor(x / city.tileSize)
    const tileY = Math.floor(y / city.tileSize)

    if (!city.inBounds(tileX, tileY)) {
      return null
    }

    return {
      x: tileX,
      y: tileY,
      index: city.index(tileX, tileY)
    }
  }

  function tileCenterX(tileX) {
    return (tileX + 0.5) * city.tileSize
  }

  function tileCenterY(tileY) {
    return (tileY + 0.5) * city.tileSize
  }
}

function movePositionWithSlide(position, dx, dy, canMoveTo, applyMove) {
  const startX = position.x
  const startY = position.y
  const candidates = [
    { x: startX + dx, y: startY + dy },
    { x: startX + dx, y: startY },
    { x: startX, y: startY + dy }
  ]

  for (const candidate of candidates) {
    if (canMoveTo(candidate.x, candidate.y)) {
      applyMove(candidate.x, candidate.y)
      return Math.hypot(candidate.x - startX, candidate.y - startY)
    }
  }

  return 0
}

function cardinalDirection(direction) {
  const x = Number(direction?.x ?? direction?.dx) || 0
  const y = Number(direction?.y ?? direction?.dy) || 0

  if (Math.abs(x) >= Math.abs(y)) {
    return { dx: x < 0 ? -1 : 1, dy: 0 }
  }

  return { dx: 0, dy: y < 0 ? -1 : 1 }
}

function movementKey(event) {
  if (typeof event?.code === 'string' && MOVEMENT_KEYS[event.code]) {
    return event.code
  }

  if (typeof event?.key !== 'string') {
    return null
  }

  if (MOVEMENT_KEYS[event.key]) {
    return event.key
  }

  const letterCode = `Key${event.key.toUpperCase()}`

  return MOVEMENT_KEYS[letterCode] ? letterCode : null
}

function isTextEntryTarget(target) {
  if (!target || typeof target !== 'object') {
    return false
  }

  if (target.isContentEditable) {
    return true
  }

  const tagName = typeof target.tagName === 'string' ? target.tagName.toUpperCase() : ''

  return tagName === 'INPUT' || tagName === 'TEXTAREA'
}

function createEmptyNpcRouteState() {
  return {
    routeField: null,
    destination: null,
    destinationIndex: -1,
    queued: false,
    retrySeconds: 0,
    blockedSeconds: 0
  }
}

function positiveNumberOrDefault(value, fallback) {
  const number = Number(value)

  return Number.isFinite(number) && number > 0 ? number : fallback
}
