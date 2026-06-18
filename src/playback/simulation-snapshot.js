const INFECTION_STATES = new Set(['susceptible', 'exposed', 'infectious', 'recovered'])

export function createSimulationSnapshot(citySim) {
  const npcs = Array.isArray(citySim?.npcs) ? citySim.npcs : []
  const cars = Array.isArray(citySim?.cars) ? citySim.cars : []
  const clock = citySim?.simulationClock

  return {
    simulationSeconds: finiteNumber(clock?.getElapsedSimulationSeconds?.(), 0),
    timeOfDay: clock?.formatTimeOfDay?.() ?? '',
    infectionStats: citySim?.npcSimulation?.infection?.getStats?.() ?? null,
    camera: getCameraSnapshot(citySim?.camera),
    npcs: npcs.map(snapshotNpc),
    cars: cars.map(snapshotCar)
  }
}

export function applySimulationSnapshot(citySim, recording, simulationSeconds) {
  const snapshot = sampleSimulationRecording(recording, simulationSeconds)

  if (!snapshot) {
    return null
  }

  applySnapshotToEntities(citySim, snapshot)
  return snapshot
}

export function sampleSimulationRecording(recording, simulationSeconds) {
  const snapshots = recording?.snapshots

  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return null
  }

  const targetSeconds = finiteNumber(simulationSeconds, 0)

  if (targetSeconds <= snapshots[0].simulationSeconds || snapshots.length === 1) {
    return cloneSnapshot(snapshots[0])
  }

  const lastSnapshot = snapshots[snapshots.length - 1]

  if (targetSeconds >= lastSnapshot.simulationSeconds) {
    return cloneSnapshot(lastSnapshot)
  }

  let low = 0
  let high = snapshots.length - 1

  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2)

    if (snapshots[middle].simulationSeconds <= targetSeconds) {
      low = middle
    } else {
      high = middle
    }
  }

  return interpolateSnapshot(snapshots[low], snapshots[high], targetSeconds)
}

export function applySnapshotToEntities(citySim, snapshot) {
  const npcs = Array.isArray(citySim?.npcs) ? citySim.npcs : []
  const cars = Array.isArray(citySim?.cars) ? citySim.cars : []
  const npcById = new Map(npcs.map((npc) => [npc.id, npc]))
  const carById = new Map(cars.map((car) => [car.id, car]))

  for (const npcSnapshot of snapshot.npcs || []) {
    const npc = npcById.get(npcSnapshot.id)

    if (!npc) {
      continue
    }

    npc.present = npcSnapshot.present
    npc.infection = normalizeInfectionState(npcSnapshot.infection)
    npc.position.x = npcSnapshot.x
    npc.position.y = npcSnapshot.y
    npc.tile.x = npcSnapshot.tileX
    npc.tile.y = npcSnapshot.tileY
    npc.tile.index = npcSnapshot.tileIndex
    npc.slot.id = npcSnapshot.slotId

    if (npc.movement) {
      npc.movement.headingX = npcSnapshot.headingX
      npc.movement.headingY = npcSnapshot.headingY
      npc.movement.target = null
    }

    npc.sprite = {
      facing: npcSnapshot.facing,
      walking: npcSnapshot.walking,
      walkDistance: npcSnapshot.walkDistance
    }
  }

  for (const carSnapshot of snapshot.cars || []) {
    const car = carById.get(carSnapshot.id)

    if (!car) {
      continue
    }

    car.position.x = carSnapshot.x
    car.position.y = carSnapshot.y
    car.direction = { dx: carSnapshot.dx, dy: carSnapshot.dy }
    car.state = carSnapshot.state
    car.route = null
    car.movement = null
  }
}

export function setEntityPosition(citySim, action, ratio = 1) {
  const kind = normalizeEntityKind(action.kind)
  const id = Number(action.id ?? action.entityId ?? action.npcId ?? action.carId)
  const entity = resolveEntity(citySim, kind, id)

  if (!entity?.position) {
    return false
  }

  const from = parsePosition(action.from) ?? { x: entity.position.x, y: entity.position.y }
  const to = parsePosition(action.to ?? action.position ?? action.target)

  if (!to) {
    return false
  }

  const t = clamp01(ratio)
  const x = lerp(from.x, to.x, t)
  const y = lerp(from.y, to.y, t)

  entity.position.x = x
  entity.position.y = y
  applyTileForPosition(citySim?.city, entity, x, y)

  if (kind === 'npc') {
    entity.present = action.present == null ? true : Boolean(action.present)
    entity.locationState = null
    if (entity.movement) {
      entity.movement.target = null
      entity.movement.headingX = to.x - from.x
      entity.movement.headingY = to.y - from.y
    }
  }

  return true
}

export function getRecordingDuration(recording) {
  const snapshots = recording?.snapshots

  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return 0
  }

  return snapshots[snapshots.length - 1].simulationSeconds
}

function snapshotNpc(npc) {
  return {
    id: npc.id,
    present: npc.present !== false,
    x: finiteNumber(npc.position?.x, 0),
    y: finiteNumber(npc.position?.y, 0),
    tileX: finiteNumber(npc.tile?.x, 0),
    tileY: finiteNumber(npc.tile?.y, 0),
    tileIndex: finiteNumber(npc.tile?.index, -1),
    slotId: finiteNumber(npc.slot?.id, -1),
    infection: normalizeInfectionState(npc.infection),
    headingX: finiteNumber(npc.movement?.headingX, 0),
    headingY: finiteNumber(npc.movement?.headingY, 0),
    facing: typeof npc.sprite?.facing === 'string' ? npc.sprite.facing : 'south',
    walking: Boolean(npc.sprite?.walking),
    walkDistance: finiteNumber(npc.sprite?.walkDistance, 0)
  }
}

function snapshotCar(car) {
  return {
    id: car.id,
    x: finiteNumber(car.position?.x, 0),
    y: finiteNumber(car.position?.y, 0),
    dx: finiteNumber(car.direction?.dx, 1),
    dy: finiteNumber(car.direction?.dy, 0),
    state: typeof car.state === 'string' ? car.state : 'unknown'
  }
}

function interpolateSnapshot(left, right, simulationSeconds) {
  const duration = right.simulationSeconds - left.simulationSeconds
  const ratio = duration <= 0 ? 0 : clamp01((simulationSeconds - left.simulationSeconds) / duration)

  return {
    simulationSeconds,
    timeOfDay: ratio < 0.5 ? left.timeOfDay : right.timeOfDay,
    infectionStats: ratio < 0.5 ? left.infectionStats : right.infectionStats,
    camera: interpolateCamera(left.camera, right.camera, ratio),
    npcs: interpolateEntityArray(left.npcs, right.npcs, ratio, interpolateNpcSnapshot),
    cars: interpolateEntityArray(left.cars, right.cars, ratio, interpolateCarSnapshot)
  }
}

function interpolateEntityArray(leftArray, rightArray, ratio, interpolate) {
  const rightById = new Map((rightArray || []).map((item) => [item.id, item]))

  return (leftArray || []).map((leftItem) => {
    const rightItem = rightById.get(leftItem.id)

    return rightItem ? interpolate(leftItem, rightItem, ratio) : { ...leftItem }
  })
}

function interpolateNpcSnapshot(left, right, ratio) {
  const discrete = ratio < 0.5 ? left : right

  return {
    ...discrete,
    id: left.id,
    x: lerp(left.x, right.x, ratio),
    y: lerp(left.y, right.y, ratio),
    headingX: lerp(left.headingX, right.headingX, ratio),
    headingY: lerp(left.headingY, right.headingY, ratio),
    walkDistance: lerp(left.walkDistance, right.walkDistance, ratio)
  }
}

function interpolateCarSnapshot(left, right, ratio) {
  const discrete = ratio < 0.5 ? left : right

  return {
    ...discrete,
    id: left.id,
    x: lerp(left.x, right.x, ratio),
    y: lerp(left.y, right.y, ratio)
  }
}

function interpolateCamera(left, right, ratio) {
  if (!left || !right) {
    return left || right || null
  }

  return {
    x: lerp(left.x, right.x, ratio),
    y: lerp(left.y, right.y, ratio),
    zoom: lerp(left.zoom, right.zoom, ratio)
  }
}

function cloneSnapshot(snapshot) {
  return {
    ...snapshot,
    camera: snapshot.camera ? { ...snapshot.camera } : null,
    infectionStats: snapshot.infectionStats ? { ...snapshot.infectionStats } : null,
    npcs: (snapshot.npcs || []).map((npc) => ({ ...npc })),
    cars: (snapshot.cars || []).map((car) => ({ ...car }))
  }
}

function getCameraSnapshot(camera) {
  return camera
    ? {
        x: finiteNumber(camera.x, 0),
        y: finiteNumber(camera.y, 0),
        zoom: finiteNumber(camera.zoom, 1)
      }
    : null
}

function resolveEntity(citySim, kind, id) {
  if (!Number.isInteger(id)) {
    return null
  }

  const list = kind === 'car' ? citySim?.cars : citySim?.npcs

  return Array.isArray(list) ? list.find((entity) => entity.id === id) : null
}

function normalizeEntityKind(kind) {
  return kind === 'car' ? 'car' : 'npc'
}

function parsePosition(value) {
  if (Array.isArray(value)) {
    const [x, y] = value.map(Number)

    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
  }

  if (!value || typeof value !== 'object') {
    return null
  }

  const x = Number(value.x ?? value.worldX)
  const y = Number(value.y ?? value.worldY)

  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}

function applyTileForPosition(city, entity, x, y) {
  if (!city || !entity?.tile || !Number.isFinite(x) || !Number.isFinite(y)) {
    return
  }

  const tileX = Math.floor(x / city.tileSize)
  const tileY = Math.floor(y / city.tileSize)

  if (!city.inBounds(tileX, tileY)) {
    return
  }

  entity.tile.x = tileX
  entity.tile.y = tileY
  entity.tile.index = city.index(tileX, tileY)

  if (entity.slot) {
    entity.slot.id = -1
  }
}

function normalizeInfectionState(state) {
  return INFECTION_STATES.has(state) ? state : 'susceptible'
}

function finiteNumber(value, fallback) {
  const number = Number(value)

  return Number.isFinite(number) ? number : fallback
}

function clamp01(value) {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    return 0
  }

  return Math.min(Math.max(number, 0), 1)
}

function lerp(a, b, t) {
  return finiteNumber(a, 0) + (finiteNumber(b, 0) - finiteNumber(a, 0)) * clamp01(t)
}
