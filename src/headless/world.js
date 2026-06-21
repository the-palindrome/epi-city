import { promises as fs } from 'node:fs'
import { normalizeInfectionBlock, normalizeWorldConfig } from './config.js'
import { formatCarId, formatNpcId } from './event-recorder.js'
import { loadDefaultHeadlessCity } from './map-loader.js'
import { createHeadlessRuntime } from './runtime.js'

export const HEADLESS_WORLD_FORMAT = 'epi-city-headless-world'
export const HEADLESS_WORLD_VERSION = 1

export async function createHeadlessWorldFile(worldConfigInput) {
  const config = normalizeWorldConfig(worldConfigInput)
  const city = await loadDefaultHeadlessCity()
  const runtime = createHeadlessRuntime({
    city,
    worldConfig: config,
    infectionConfig: normalizeInfectionBlock({}),
    policies: []
  })

  try {
    return serializeHeadlessWorld(runtime, config)
  } finally {
    runtime.destroy()
  }
}

export async function readHeadlessWorldFile(filePath) {
  return normalizeHeadlessWorld(JSON.parse(await fs.readFile(filePath, 'utf8')))
}

export function normalizeHeadlessWorld(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Headless world must be a JSON object.')
  }

  if (input.format && input.format !== HEADLESS_WORLD_FORMAT) {
    throw new Error(`Unsupported world format "${input.format}".`)
  }

  const config = normalizeWorldConfig(input.config || {})
  const npcs = Array.isArray(input.npcs) ? input.npcs.map(normalizeWorldNpc) : []
  const cars = Array.isArray(input.cars) ? input.cars.map(normalizeWorldCar) : []
  const initialSeir = normalizeExplicitInitialSeir(input.initialSeir, npcs)

  return {
    format: HEADLESS_WORLD_FORMAT,
    version: HEADLESS_WORLD_VERSION,
    generatedAt: input.generatedAt || null,
    config,
    npcs,
    cars,
    initialSeir
  }
}

export function serializeHeadlessWorld(runtime, config) {
  return {
    format: HEADLESS_WORLD_FORMAT,
    version: HEADLESS_WORLD_VERSION,
    generatedAt: new Date().toISOString(),
    config,
    npcs: runtime.npcs.map(serializeNpc),
    cars: runtime.cars.map(serializeCar),
    initialSeir: serializeInitialSeir(runtime.npcSimulation.infection)
  }
}

export function getInitialSeirStateByNpcId(world, npcCount) {
  const states = new Map()

  for (let index = 0; index < npcCount; index += 1) {
    states.set(formatNpcId(index), 'susceptible')
  }

  for (const id of world?.initialSeir?.inoculatedNpcIds || []) {
    states.set(id, 'recovered')
  }

  for (const id of world?.initialSeir?.infectedNpcIds || []) {
    states.set(id, 'infectious')
  }

  return states
}

function serializeNpc(npc) {
  return {
    id: formatNpcId(npc.id),
    index: npc.id,
    age: npc.age,
    homeBuildingId: npc.home,
    schoolBuildingId: npc.school,
    workBuildingId: npc.work,
    friendIds: (npc.friendIds || []).map(formatNpcId),
    timetable: (npc.timetable?.elements || []).map((element) => ({
      ...element,
      location: element.location ? { ...element.location } : null
    })),
    position: { ...npc.position },
    tile: { ...npc.tile },
    slot: { ...npc.slot },
    present: npc.present !== false,
    locationState: npc.locationState ? cloneLocationState(npc.locationState) : null
  }
}

function serializeCar(car) {
  return {
    id: formatCarId(car.id),
    index: car.id,
    ownerNpcIds: (car.owners || [])
      .filter((owner) => Number.isInteger(owner.npcId))
      .map((owner) => formatNpcId(owner.npcId)),
    homeBuildingId: car.homeBuildingId,
    parkedBuildingId: car.parkedBuildingId,
    state: car.state,
    position: { ...car.position }
  }
}

function serializeInitialSeir(infection) {
  const infectedNpcIds = []
  const inoculatedNpcIds = []

  for (const npc of infection.npcs || []) {
    const status = infection.getNpcStatus(npc.id)

    if (status?.infection === 'infectious') {
      infectedNpcIds.push(formatNpcId(npc.id))
    } else if (status?.infection === 'recovered') {
      inoculatedNpcIds.push(formatNpcId(npc.id))
    }
  }

  return { infectedNpcIds, inoculatedNpcIds }
}

function normalizeWorldNpc(npc) {
  return {
    ...npc,
    id: normalizeEntityId(npc?.id, 'npc'),
    index: Math.max(0, Math.round(Number(npc?.index ?? parseEntityIndex(npc?.id, 'npc'))) || 0),
    friendIds: Array.isArray(npc?.friendIds) ? npc.friendIds.map((id) => normalizeEntityId(id, 'npc')) : [],
    timetable: Array.isArray(npc?.timetable) ? npc.timetable.map((element) => ({ ...element })) : [],
    position: normalizePoint(npc?.position),
    tile: normalizeTile(npc?.tile),
    slot: npc?.slot && typeof npc.slot === 'object' ? { ...npc.slot } : { id: -1 },
    present: npc?.present !== false,
    locationState: npc?.locationState && typeof npc.locationState === 'object'
      ? cloneLocationState(npc.locationState)
      : null
  }
}

function normalizeWorldCar(car) {
  return {
    ...car,
    id: normalizeEntityId(car?.id, 'car'),
    index: Math.max(0, Math.round(Number(car?.index ?? parseEntityIndex(car?.id, 'car'))) || 0),
    ownerNpcIds: Array.isArray(car?.ownerNpcIds) ? car.ownerNpcIds.map((id) => normalizeEntityId(id, 'npc')) : [],
    position: normalizePoint(car?.position)
  }
}

function normalizeExplicitInitialSeir(initialSeir = {}, npcs) {
  const validIds = new Set(npcs.map((npc) => npc.id))
  const infectedNpcIds = normalizeNpcIdList(initialSeir?.infectedNpcIds, validIds, 'infectedNpcIds')
  const inoculatedNpcIds = normalizeNpcIdList(initialSeir?.inoculatedNpcIds, validIds, 'inoculatedNpcIds')
  const infected = new Set(infectedNpcIds)

  for (const id of inoculatedNpcIds) {
    if (infected.has(id)) {
      throw new Error(`NPC ${id} cannot be both infected and inoculated.`)
    }
  }

  return { infectedNpcIds, inoculatedNpcIds }
}

function normalizeNpcIdList(ids, validIds, label) {
  if (!Array.isArray(ids)) {
    return []
  }

  return ids.map((id) => {
    const normalized = normalizeEntityId(id, 'npc')

    if (!validIds.has(normalized)) {
      throw new Error(`${label} references unknown NPC id "${normalized}".`)
    }

    return normalized
  })
}

function normalizeEntityId(id, kind) {
  const prefix = `${kind}_`

  if (typeof id === 'string' && id.startsWith(prefix)) {
    return id
  }

  const index = parseEntityIndex(id, kind)

  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid ${kind} id "${id}".`)
  }

  return `${prefix}${index}`
}

function parseEntityIndex(id, kind) {
  if (Number.isInteger(id)) {
    return id
  }

  const match = String(id || '').match(new RegExp(`^${kind}_(\\d+)$`))

  return match ? Number(match[1]) : NaN
}

function normalizePoint(point) {
  return {
    x: Number(point?.x) || 0,
    y: Number(point?.y) || 0
  }
}

function normalizeTile(tile) {
  return {
    x: Math.round(Number(tile?.x)) || 0,
    y: Math.round(Number(tile?.y)) || 0,
    index: Math.round(Number(tile?.index)) || 0
  }
}

function cloneLocationState(locationState) {
  return {
    ...locationState,
    location: locationState.location ? { ...locationState.location } : null
  }
}
