import { promises as fs } from 'node:fs'
import { normalizeInfectionBlock, normalizeWorldConfig } from './config.js'
import { formatCarId, formatNpcId } from './event-recorder.js'
import { createSeededRandom, createSystemRandom } from '../core/random.js'
import { loadDefaultHeadlessCity } from './map-loader.js'
import { createHeadlessRuntime } from './runtime.js'

export const HEADLESS_WORLD_FORMAT = 'epi-city-headless-world'
export const HEADLESS_WORLD_VERSION = 3

const CLASS_SIZE_DISTRIBUTION = Object.freeze({ min: 18, mode: 24, max: 30 })
const OFFICE_SIZE_DISTRIBUTION = Object.freeze({ min: 4, mode: 8, max: 14 })

export async function createHeadlessWorldFile(worldConfigInput, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null

  emitProgress(onProgress, 0, 'Normalizing config')
  const config = normalizeWorldConfig(worldConfigInput)

  emitProgress(onProgress, 0.1, 'Loading map')
  const city = await loadDefaultHeadlessCity()

  emitProgress(onProgress, 0.35, `Generating ${config.population.npcCount} NPCs and ${config.population.carCount} cars`)
  const runtime = createHeadlessRuntime({
    city,
    seed: config.seed,
    population: config.population,
    initialSeir: { initialInfectiousCount: 0, inoculatedPercent: 0 },
    infectionConfig: normalizeInfectionBlock({}),
    policies: []
  })

  try {
    emitProgress(onProgress, 0.85, 'Serializing world')
    const world = serializeHeadlessWorld(runtime, {
      random: createWorldGroupRandom(config.seed)
    })

    emitProgress(onProgress, 1, 'World generated')
    return world
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

  const npcs = Array.isArray(input.npcs) ? input.npcs.map(normalizeWorldNpc) : []
  const npcIds = new Set(npcs.map((npc) => npc.id))
  const groupSource = input.groups && typeof input.groups === 'object' && !Array.isArray(input.groups)
    ? input.groups
    : input
  const families = normalizeGroupArray(groupSource.families, 'family', 'memberIds', npcIds, normalizeFamilyGroup)
  const classes = normalizeGroupArray(groupSource.classes, 'class', 'studentIds', npcIds, normalizeClassGroup)
  const offices = normalizeGroupArray(groupSource.offices, 'office', 'workerIds', npcIds, normalizeOfficeGroup)
  const cars = Array.isArray(input.cars) ? input.cars.map(normalizeWorldCar) : []
  const buildings = normalizeWorldBuildings(input.buildings)

  applyGroupBacklinks(npcs, families, 'memberIds', 'familyId')
  applyGroupBacklinks(npcs, classes, 'studentIds', 'classId')
  applyGroupBacklinks(npcs, offices, 'workerIds', 'officeId')
  validateNpcGroupReferences(npcs, families, 'familyId', 'family')
  validateNpcGroupReferences(npcs, classes, 'classId', 'class')
  validateNpcGroupReferences(npcs, offices, 'officeId', 'office')
  validateBuildingReferences(npcs, families, classes, offices, buildings)

  return {
    format: HEADLESS_WORLD_FORMAT,
    version: HEADLESS_WORLD_VERSION,
    generatedAt: input.generatedAt || null,
    npcs,
    cars,
    buildings,
    families,
    classes,
    offices
  }
}

export function serializeHeadlessWorld(runtime, options = {}) {
  const npcs = runtime.npcs.map(serializeNpc)
  const groups = createGeneratedGroups(npcs, options.random || createSystemRandom())

  return {
    format: HEADLESS_WORLD_FORMAT,
    version: HEADLESS_WORLD_VERSION,
    generatedAt: new Date().toISOString(),
    npcs,
    cars: runtime.cars.map(serializeCar),
    buildings: (runtime.city?.buildings || []).map(serializeBuilding),
    families: groups.families,
    classes: groups.classes,
    offices: groups.offices
  }
}

function serializeNpc(npc) {
  return {
    id: formatNpcId(npc.id),
    index: npc.id,
    age: npc.age,
    familyId: formatGroupId('family', npc.familyId),
    familyRole: npc.familyRole || null,
    classId: formatGroupId('class', npc.classId),
    officeId: formatGroupId('office', npc.officeId),
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

function serializeBuilding(building) {
  return {
    id: building.id,
    types: [...building.types],
    entrance: building.entrance ? { ...building.entrance } : null,
    spans: building.spans.map((span) => [...span])
  }
}

function normalizeWorldNpc(npc) {
  return {
    ...npc,
    id: normalizeEntityId(npc?.id, 'npc'),
    index: Math.max(0, Math.round(Number(npc?.index ?? parseEntityIndex(npc?.id, 'npc'))) || 0),
    familyId: normalizeOptionalGroupId(npc?.familyId, 'family'),
    familyRole: npc?.familyRole == null ? null : String(npc.familyRole),
    classId: normalizeOptionalGroupId(npc?.classId, 'class'),
    officeId: normalizeOptionalGroupId(npc?.officeId, 'office'),
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

function normalizeWorldBuildings(buildings) {
  if (!Array.isArray(buildings)) {
    return []
  }

  const ids = new Set()

  return buildings.map((building, index) => {
    const normalized = normalizeWorldBuilding(building, index)

    if (ids.has(normalized.id)) {
      throw new Error(`Duplicate building id "${normalized.id}".`)
    }

    ids.add(normalized.id)
    return normalized
  })
}

function normalizeWorldBuilding(building, index) {
  if (!building || typeof building !== 'object' || Array.isArray(building)) {
    throw new Error(`World building ${index} must be an object.`)
  }

  const id = normalizeBuildingId(building.id, `buildings[${index}].id`)

  return {
    id,
    types: normalizeBuildingTypes(building.types, id),
    entrance: normalizeBuildingEntrance(building.entrance, id),
    spans: normalizeBuildingSpans(building.spans, id)
  }
}

function normalizeBuildingTypes(types, buildingId) {
  if (!Array.isArray(types) || types.length === 0) {
    throw new Error(`World building "${buildingId}" types must be a non-empty array.`)
  }

  const normalized = []
  const seen = new Set()

  for (const type of types) {
    if (typeof type !== 'string' || type.length === 0) {
      throw new Error(`World building "${buildingId}" types must contain non-empty strings.`)
    }

    if (!seen.has(type)) {
      seen.add(type)
      normalized.push(type)
    }
  }

  return normalized
}

function normalizeBuildingEntrance(entrance, buildingId) {
  if (entrance == null) {
    return null
  }

  if (!entrance || typeof entrance !== 'object' || Array.isArray(entrance)) {
    throw new Error(`World building "${buildingId}" entrance must be an object or null.`)
  }

  return {
    x: normalizeInteger(entrance.x, `World building "${buildingId}" entrance.x`),
    y: normalizeInteger(entrance.y, `World building "${buildingId}" entrance.y`)
  }
}

function normalizeBuildingSpans(spans, buildingId) {
  if (!Array.isArray(spans) || spans.length === 0) {
    throw new Error(`World building "${buildingId}" spans must be a non-empty array.`)
  }

  return spans.map((span, index) => {
    if (!Array.isArray(span) || span.length !== 3) {
      throw new Error(`World building "${buildingId}" span ${index} must be [y, x, length].`)
    }

    const y = normalizeInteger(span[0], `World building "${buildingId}" span ${index} y`)
    const x = normalizeInteger(span[1], `World building "${buildingId}" span ${index} x`)
    const length = normalizeInteger(span[2], `World building "${buildingId}" span ${index} length`)

    if (length <= 0) {
      throw new Error(`World building "${buildingId}" span ${index} length must be positive.`)
    }

    return [y, x, length]
  })
}

function createGeneratedGroups(npcs, random) {
  return {
    families: createFamilyGroups(npcs),
    classes: createPartitionedNpcGroups({
      npcs: npcs.filter((npc) => npc.schoolBuildingId),
      random,
      buildingField: 'schoolBuildingId',
      npcGroupField: 'classId',
      idPrefix: 'class',
      sizeDistribution: CLASS_SIZE_DISTRIBUTION,
      createGroup: (id, buildingId, memberIds) => ({
        id,
        schoolBuildingId: buildingId,
        studentIds: memberIds,
        size: memberIds.length
      })
    }),
    offices: createPartitionedNpcGroups({
      npcs: npcs.filter((npc) => npc.workBuildingId),
      random,
      buildingField: 'workBuildingId',
      npcGroupField: 'officeId',
      idPrefix: 'office',
      sizeDistribution: OFFICE_SIZE_DISTRIBUTION,
      createGroup: (id, buildingId, memberIds) => ({
        id,
        workBuildingId: buildingId,
        workerIds: memberIds,
        size: memberIds.length
      })
    })
  }
}

function createFamilyGroups(npcs) {
  const byFamilyId = new Map()

  for (const npc of npcs) {
    if (!npc.familyId) {
      continue
    }

    let family = byFamilyId.get(npc.familyId)

    if (!family) {
      family = []
      byFamilyId.set(npc.familyId, family)
    }

    family.push(npc)
  }

  return [...byFamilyId.entries()]
    .sort(([left], [right]) => groupIdIndex(left, 'family') - groupIdIndex(right, 'family'))
    .map(([id, members]) => {
      members.sort((left, right) => left.index - right.index)

      return {
        id,
        type: familyTypeForMembers(members),
        homeBuildingId: members[0]?.homeBuildingId || null,
        memberIds: members.map((npc) => npc.id),
        adultIds: members.filter((npc) => Number(npc.age) >= 18).map((npc) => npc.id),
        childIds: members.filter((npc) => Number(npc.age) < 18).map((npc) => npc.id)
      }
    })
}

function familyTypeForMembers(members) {
  const roles = new Set(members.map((npc) => npc.familyRole).filter(Boolean))

  if (roles.has('parent') || roles.has('child')) {
    return 'marriedWithChildren'
  }

  if (roles.has('partner')) {
    return 'marriedWithoutChildren'
  }

  return 'single'
}

function createPartitionedNpcGroups({
  npcs,
  random,
  buildingField,
  npcGroupField,
  idPrefix,
  sizeDistribution,
  createGroup
}) {
  const byBuildingId = new Map()
  const groups = []

  for (const npc of npcs) {
    const buildingId = npc[buildingField]

    if (!buildingId) {
      continue
    }

    let members = byBuildingId.get(buildingId)

    if (!members) {
      members = []
      byBuildingId.set(buildingId, members)
    }

    members.push(npc)
  }

  const buildingIds = [...byBuildingId.keys()].sort((left, right) => String(left).localeCompare(String(right)))

  for (const buildingId of buildingIds) {
    const members = shuffleCopy(byBuildingId.get(buildingId).sort((left, right) => left.index - right.index), random)
    let cursor = 0

    while (cursor < members.length) {
      const remaining = members.length - cursor
      const targetSize = chooseGroupSize(remaining, sizeDistribution, random)
      const id = `${idPrefix}_${groups.length}`
      const groupMembers = members.slice(cursor, cursor + targetSize)
      const memberIds = groupMembers
        .sort((left, right) => left.index - right.index)
        .map((npc) => npc.id)

      for (const npc of groupMembers) {
        npc[npcGroupField] = id
      }

      groups.push(createGroup(id, buildingId, memberIds))
      cursor += targetSize
    }
  }

  return groups
}

function chooseGroupSize(remaining, distribution, random) {
  if (remaining <= distribution.min) {
    return remaining
  }

  let size = Math.min(remaining, triangularInteger(distribution.min, distribution.mode, distribution.max, random))
  const leftover = remaining - size

  if (leftover > 0 && leftover < distribution.min) {
    size = Math.ceil(remaining / 2)
  }

  return Math.max(1, Math.min(size, remaining))
}

function triangularInteger(min, mode, max, random) {
  const u = random.next()
  const range = max - min
  const modeOffset = mode - min
  const split = modeOffset / range
  const value = u < split
    ? min + Math.sqrt(u * range * modeOffset)
    : max - Math.sqrt((1 - u) * range * (max - mode))

  return Math.round(value)
}

function shuffleCopy(items, random) {
  const shuffled = [...items]

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const selectedIndex = random.int(index + 1)
    const selected = shuffled[selectedIndex]

    shuffled[selectedIndex] = shuffled[index]
    shuffled[index] = selected
  }

  return shuffled
}

function createWorldGroupRandom(seed) {
  return seed?.enabled === false
    ? createSystemRandom()
    : createSeededRandom(`${seed?.value ?? 'epi-city'}:world-groups`)
}

function normalizeGroupArray(groups, kind, memberField, npcIds, normalizeGroup) {
  if (!Array.isArray(groups)) {
    return []
  }

  const ids = new Set()
  const members = new Map()

  return groups.map((group) => {
    const normalized = normalizeGroup(group, npcIds)

    if (ids.has(normalized.id)) {
      throw new Error(`Duplicate ${kind} group id "${normalized.id}".`)
    }

    ids.add(normalized.id)

    for (const memberId of normalized[memberField]) {
      if (members.has(memberId)) {
        throw new Error(`NPC ${memberId} appears in multiple ${kind} groups.`)
      }

      members.set(memberId, normalized.id)
    }

    return normalized
  })
}

function normalizeFamilyGroup(group, npcIds) {
  const memberIds = normalizeNpcIdArray(group?.memberIds, 'family.memberIds', npcIds)

  return {
    id: normalizeGroupId(group?.id, 'family'),
    type: group?.type == null ? null : String(group.type),
    homeBuildingId: group?.homeBuildingId == null ? null : String(group.homeBuildingId),
    memberIds,
    adultIds: normalizeNpcIdArray(group?.adultIds, 'family.adultIds', npcIds, memberIds),
    childIds: normalizeNpcIdArray(group?.childIds, 'family.childIds', npcIds, memberIds)
  }
}

function normalizeClassGroup(group, npcIds) {
  const studentIds = normalizeNpcIdArray(group?.studentIds, 'class.studentIds', npcIds)

  return {
    id: normalizeGroupId(group?.id, 'class'),
    schoolBuildingId: group?.schoolBuildingId == null ? null : String(group.schoolBuildingId),
    studentIds,
    size: studentIds.length
  }
}

function normalizeOfficeGroup(group, npcIds) {
  const workerIds = normalizeNpcIdArray(group?.workerIds, 'office.workerIds', npcIds)

  return {
    id: normalizeGroupId(group?.id, 'office'),
    workBuildingId: group?.workBuildingId == null ? null : String(group.workBuildingId),
    workerIds,
    size: workerIds.length
  }
}

function normalizeNpcIdArray(ids, label, npcIds, allowedIds = null) {
  if (!Array.isArray(ids)) {
    return []
  }

  const normalized = []
  const seen = new Set()
  const allowed = allowedIds ? new Set(allowedIds) : null

  for (const id of ids) {
    const normalizedId = normalizeEntityId(id, 'npc')

    if (seen.has(normalizedId)) {
      throw new Error(`${label} contains duplicate NPC id "${normalizedId}".`)
    }

    if (!npcIds.has(normalizedId)) {
      throw new Error(`${label} references unknown NPC id "${normalizedId}".`)
    }

    if (allowed && !allowed.has(normalizedId)) {
      throw new Error(`${label} references NPC ${normalizedId} outside the group members.`)
    }

    seen.add(normalizedId)
    normalized.push(normalizedId)
  }

  return normalized
}

function applyGroupBacklinks(npcs, groups, memberField, npcField) {
  const npcsById = new Map(npcs.map((npc) => [npc.id, npc]))

  for (const group of groups) {
    for (const memberId of group[memberField]) {
      const npc = npcsById.get(memberId)

      if (!npc) {
        continue
      }

      if (npc[npcField] && npc[npcField] !== group.id) {
        throw new Error(`NPC ${memberId} ${npcField} "${npc[npcField]}" does not match group "${group.id}".`)
      }

      npc[npcField] = group.id
    }
  }
}

function validateNpcGroupReferences(npcs, groups, npcField, kind) {
  const groupIds = new Set(groups.map((group) => group.id))

  for (const npc of npcs) {
    if (npc[npcField] && !groupIds.has(npc[npcField])) {
      throw new Error(`NPC ${npc.id} references unknown ${kind} group "${npc[npcField]}".`)
    }
  }
}

function validateBuildingReferences(npcs, families, classes, offices, buildings) {
  if (buildings.length === 0) {
    return
  }

  const buildingIds = new Set(buildings.map((building) => building.id))

  for (const npc of npcs) {
    validateOptionalBuildingId(npc.homeBuildingId, buildingIds, `NPC ${npc.id} homeBuildingId`)
    validateOptionalBuildingId(npc.schoolBuildingId, buildingIds, `NPC ${npc.id} schoolBuildingId`)
    validateOptionalBuildingId(npc.workBuildingId, buildingIds, `NPC ${npc.id} workBuildingId`)

    for (const element of npc.timetable || []) {
      validateOptionalBuildingId(element?.buildingId, buildingIds, `NPC ${npc.id} timetable buildingId`)
    }

    validateOptionalBuildingId(npc.locationState?.buildingId, buildingIds, `NPC ${npc.id} locationState buildingId`)
  }

  for (const family of families) {
    validateOptionalBuildingId(family.homeBuildingId, buildingIds, `Family ${family.id} homeBuildingId`)
  }

  for (const schoolClass of classes) {
    validateOptionalBuildingId(schoolClass.schoolBuildingId, buildingIds, `Class ${schoolClass.id} schoolBuildingId`)
  }

  for (const office of offices) {
    validateOptionalBuildingId(office.workBuildingId, buildingIds, `Office ${office.id} workBuildingId`)
  }
}

function validateOptionalBuildingId(value, buildingIds, label) {
  if (value == null) {
    return
  }

  const id = String(value)

  if (!buildingIds.has(id)) {
    throw new Error(`${label} references unknown building id "${id}".`)
  }
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

function normalizeBuildingId(id, label) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`${label} must be a non-empty string.`)
  }

  return id
}

function normalizeOptionalGroupId(id, kind) {
  if (id == null) {
    return null
  }

  return normalizeGroupId(id, kind)
}

function normalizeGroupId(id, kind) {
  const normalized = formatGroupId(kind, id)

  if (!normalized) {
    throw new Error(`Invalid ${kind} group id "${id}".`)
  }

  return normalized
}

function formatGroupId(kind, id) {
  const prefix = `${kind}_`

  if (typeof id === 'string' && id.startsWith(prefix)) {
    const index = Number(id.slice(prefix.length))

    return Number.isInteger(index) && index >= 0 ? `${prefix}${index}` : null
  }

  if (Number.isInteger(id) && id >= 0) {
    return `${prefix}${id}`
  }

  return null
}

function groupIdIndex(id, kind) {
  const prefix = `${kind}_`
  const index = typeof id === 'string' && id.startsWith(prefix)
    ? Number(id.slice(prefix.length))
    : NaN

  return Number.isInteger(index) ? index : Number.MAX_SAFE_INTEGER
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

function normalizeInteger(value, label) {
  const number = Number(value)

  if (!Number.isInteger(number)) {
    throw new Error(`${label} must be an integer.`)
  }

  return number
}

function cloneLocationState(locationState) {
  return {
    ...locationState,
    location: locationState.location ? { ...locationState.location } : null
  }
}

function emitProgress(onProgress, progress, message) {
  onProgress?.({ progress, message })
}
