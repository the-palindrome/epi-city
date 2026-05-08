import * as PIXI from 'pixi.js'
import {
  ENTITY_RENDER_DEBUG_CONFIG,
  HOME_BUILDING_TYPES,
  INFECTION_CONFIG,
  NPC_CONFIG,
  SCHOOL_BUILDING_TYPES,
  WORK_BUILDING_TYPES
} from '../core/constants.js'
import { createSeededRandom, createSystemRandom } from '../core/random.js'
import { hourInRange, normalizeHour } from '../core/time.js'
import { buildingHasAnyType } from '../map/buildings.js'
import { createNpcSpriteRenderer } from '../render/npc-sprite-renderer.js'
import {
  createNpcSpriteState,
  faceNpcSprite,
  idleNpcSprite,
  stepNpcSpriteAnimation
} from '../render/npc-sprite.js'
import { toSimulationSeconds } from './simulation-clock.js'

const STATIC_CLOCK = Object.freeze({
  getTimeOfDayHours: () => 0
})
const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 3600
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR
const MAX_TRANSMISSION_EVENTS = 1024
const MAX_TRANSMISSION_EVENT_AGE_SECONDS = 2 * SECONDS_PER_HOUR
const DEFAULT_CONTACT_EVENT_RETENTION_SECONDS = ENTITY_RENDER_DEBUG_CONFIG.contactEdgeDurationMinutes * SECONDS_PER_MINUTE
const MIN_INFECTION_GRID_CELL_SIZE = 8
const INFECTION_STATE_IDS = Object.freeze({
  susceptible: 0,
  exposed: 1,
  infectious: 2,
  recovered: 3
})
const INFECTION_STATE_NAMES = Object.freeze([
  'susceptible',
  'exposed',
  'infectious',
  'recovered'
])
const NPC_MOVEMENT_CURVE_SAMPLE_COUNT = 12
const NPC_MOVEMENT_CURVE_TANGENT_SCALE = 0.36
const NPC_MOVEMENT_CURVE_MAX_TANGENT_TILES = 0.5
const ADULT_MIN_AGE = 18
const ADULT_MAX_AGE = 99
const SCHOOL_MIN_AGE = 6
const SCHOOL_MAX_AGE_EXCLUSIVE = 18
const CHILD_MIN_AGE = 0
const CHILD_MAX_AGE = 17
const MAX_PARTNER_AGE_DIFFERENCE = 6
const MIN_PARENT_AGE_GAP = 18
const MAX_PARENT_AGE_GAP = 45

export function createNpcSimulation(city, entityLayer, config) {
  const random = config.random || createSystemRandom()
  const infectionRandom = config.infectionRandom || (random.seed ? createSeededRandom(`${random.seed}:infection`) : createSystemRandom())
  const zorder = Number.isFinite(config.zorder) ? config.zorder : NPC_CONFIG.zorder
  const clock = config.clock || STATIC_CLOCK
  const visibleTileCounts = new Uint8Array(city.tiles.length)
  const visibleTileIndexes = []
  const slotOffsets = createNpcSlotOffsets(city, config)
  const spawnTiles = collectNpcSpawnTiles(city)
  const buildingsByPurpose = collectBuildingsByPurpose(city)
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
  let entityDebugOptions = { ...(config.entityDebugOptions || {}) }
  const npcProfiles = createNpcFamilyProfiles(buildingsByPurpose, random, config.count, config)

  entityLayer.eventMode = 'none'
  entityLayer.sortableChildren = true

  for (let id = 0; id < npcProfiles.length; id += 1) {
    const profile = npcProfiles[id]
    const timetable = createNpcTimetable(city, profile.buildingAssignment, profile.age, random, config)
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
      buildingAssignment: profile.buildingAssignment,
      age: profile.age,
      timetable,
      random,
      zorder,
      config
    }))
  }

  const infection = new NpcInfectionDynamics(npcs, city, config, infectionRandom, clock)
  infection.setContactTracingEnabled(
    Boolean(entityDebugOptions.contactEdgesVisible),
    entityDebugOptions.contactEdgeDurationSeconds
  )
  const npcRenderer = createNpcSpriteRenderer(npcs, city, config, infection, {
    pixi: PIXI,
    visibleTileCounts,
    visibleTileIndexes,
    clock,
    getContactEvents: (options) => infection.getRecentContactEvents(options),
    getTransmissionEvents: (options) => infection.getRecentTransmissionEvents(options),
    entityDebugOptions
  })
  const display = npcRenderer.display
  const graphics = npcRenderer.spriteDisplay || display

  entityLayer.addChild(display)

  function update(deltaSeconds) {
    if (destroyed) {
      return
    }

    const safeDelta = Math.min(Math.max(deltaSeconds, 0), 0.1)
    const movementDelta = toSimulationSeconds(clock, safeDelta)
    const timeOfDayHours = clock.getTimeOfDayHours()

    for (const npc of npcs) {
      refreshNpcGoal(npc, timeOfDayHours, context)
    }

    for (const npc of npcs) {
      prepareNpcForRouting(npc, movementDelta, context)
    }

    routePlanner.process(context)

    for (const npc of npcs) {
      updateNpcMovement(npc, movementDelta, context)
    }

    infection.update(safeDelta)
  }

  function render() {
    if (destroyed) {
      return
    }

    npcRenderer.render(npcs, infection)
  }

  function setEntityRenderMode(mode) {
    if (typeof npcRenderer.setRenderMode === 'function') {
      npcRenderer.setRenderMode(mode)
      render()
    }
  }

  function setEntityDebugOptions(options) {
    entityDebugOptions = {
      ...entityDebugOptions,
      ...(options || {})
    }
    infection.setContactTracingEnabled(Boolean(entityDebugOptions.contactEdgesVisible), entityDebugOptions.contactEdgeDurationSeconds)

    if (typeof npcRenderer.setDebugOptions === 'function') {
      npcRenderer.setDebugOptions(options)
      render()
    }
  }

  render()

  return {
    npcs,
    tileCapacity: config.tileCapacity,
    routePlanner,
    infection,
    graphics,
    update,
    render,
    setEntityRenderMode,
    setEntityDebugOptions,
    destroy() {
      destroyed = true

      npcRenderer.destroy()
    }
  }
}

class NpcEntity {
  constructor({ id, position, tile, slot, present, locationState, buildingAssignment, age, timetable, random, zorder, config }) {
    this.id = id
    this.zorder = zorder
    this.age = age
    this.home = buildingAssignment.home ? buildingAssignment.home.id : null
    this.work = buildingAssignment.work ? buildingAssignment.work.id : null
    this.timetable = timetable
    this.goal = null
    this.present = present
    this.locationState = locationState
    this.position = { x: position.x, y: position.y }
    this.tile = { x: tile.x, y: tile.y, index: tile.index }
    this.slot = { id: slot.id }
    this.movement = {
      speed: random.between(config.minSpeed, config.maxSpeed),
      target: null,
      headingX: 0,
      headingY: 0
    }
    this.sprite = createNpcSpriteState(id)
    this.routing = createEmptyRouteState()
    this.vehicleTrip = null
    this.waitingForCar = false
    this.carId = null
    this.commuteByCar = false
    this.infection = 'susceptible'
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
    clearNpcMovementHeading(this)
    idleNpcSprite(this)
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
    this.slot = { id: -1 }
    this.movement.target = null
    clearNpcMovementHeading(this)
    idleNpcSprite(this)
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

class NpcInfectionDynamics {
  constructor(npcs, city, config, random, clock) {
    this.npcs = npcs
    this.city = city
    this.random = random
    this.clock = clock
    this.infectionDistance = nonNegativeNumberOrDefault(config.infectionDistance, INFECTION_CONFIG.infectionDistance)
    this.infectionProbability = clampUnitInterval(config.infectionProbability ?? INFECTION_CONFIG.infectionProbability)
    this.incubationSeconds = daysToSeconds(nonNegativeNumberOrDefault(config.incubationDays, INFECTION_CONFIG.incubationDays))
    this.infectionSeconds = daysToSeconds(nonNegativeNumberOrDefault(config.infectionDays, INFECTION_CONFIG.infectionDays))
    this.immunitySeconds = daysToSeconds(nonNegativeNumberOrDefault(config.immunityDays, INFECTION_CONFIG.immunityDays))
    this.colors = normalizeInfectionColors(config.infectionColors)
    this.states = new Uint8Array(npcs.length)
    this.timers = new Float64Array(npcs.length)
    this.counts = new Int32Array(INFECTION_STATE_NAMES.length)
    this.gridCellSize = Math.max(MIN_INFECTION_GRID_CELL_SIZE, this.infectionDistance)
    this.gridColumns = Math.max(1, Math.ceil(city.width * city.tileSize / this.gridCellSize))
    this.gridRows = Math.max(1, Math.ceil(city.height * city.tileSize / this.gridCellSize))
    this.gridHeads = new Int32Array(this.gridColumns * this.gridRows)
    this.gridStamps = new Uint32Array(this.gridHeads.length)
    this.gridNext = new Int32Array(npcs.length)
    this.gridStamp = 0
    this.elapsedSimulationSeconds = 0
    this.transmissionEvents = []
    this.contactEvents = []
    this.contactEventsByPair = new Map()
    this.nextTransmissionEventId = 1
    this.nextContactEventId = 1
    this.contactTracingEnabled = false
    this.contactEventRetentionSeconds = DEFAULT_CONTACT_EVENT_RETENTION_SECONDS

    this.counts[INFECTION_STATE_IDS.susceptible] = npcs.length

    for (const npc of npcs) {
      npc.infection = 'susceptible'
    }

    this.seedInitialInfections(config.initialInfectiousCount)
  }

  update(deltaSeconds) {
    const simulationDeltaSeconds = toSimulationSeconds(this.clock, deltaSeconds)

    if (!Number.isFinite(simulationDeltaSeconds) || simulationDeltaSeconds <= 0) {
      return
    }

    this.elapsedSimulationSeconds += simulationDeltaSeconds
    this.advanceTimers(simulationDeltaSeconds)
    this.recordRecentContacts()
    this.transmit(simulationDeltaSeconds)
    this.pruneTransmissionEvents(this.getElapsedSimulationSeconds() - MAX_TRANSMISSION_EVENT_AGE_SECONDS)
    this.pruneContactEvents(this.getElapsedSimulationSeconds() - this.contactEventRetentionSeconds)
  }

  getStats() {
    return {
      susceptible: this.counts[INFECTION_STATE_IDS.susceptible],
      exposed: this.counts[INFECTION_STATE_IDS.exposed],
      infectious: this.counts[INFECTION_STATE_IDS.infectious],
      recovered: this.counts[INFECTION_STATE_IDS.recovered]
    }
  }

  getRecentTransmissionEvents(options = {}) {
    const sinceId = Number(options.sinceId)
    const maxAgeSeconds = Number(options.maxAgeSeconds)
    const minId = Number.isFinite(sinceId) ? sinceId : 0
    const minSeconds = Number.isFinite(maxAgeSeconds)
      ? this.getElapsedSimulationSeconds() - Math.max(0, maxAgeSeconds)
      : -Infinity

    return this.transmissionEvents
      .filter((event) => event.id > minId && event.simulationSeconds >= minSeconds)
      .map(cloneTransmissionEvent)
  }

  getRecentContactEvents(options = {}) {
    const sinceId = Number(options.sinceId)
    const maxAgeSeconds = Number(options.maxAgeSeconds)
    const minId = Number.isFinite(sinceId) ? sinceId : 0
    const minSeconds = Number.isFinite(maxAgeSeconds)
      ? this.getElapsedSimulationSeconds() - Math.max(0, maxAgeSeconds)
      : -Infinity

    return this.contactEvents
      .filter((event) => event.id > minId && event.simulationSeconds >= minSeconds)
      .map(cloneContactEvent)
  }

  clearTransmissionEvents() {
    this.transmissionEvents.length = 0
  }

  clearContactEvents() {
    this.contactEvents.length = 0
    this.contactEventsByPair.clear()
  }

  setContactTracingEnabled(enabled, retentionSeconds = null) {
    this.contactTracingEnabled = Boolean(enabled)

    if (Number.isFinite(Number(retentionSeconds)) && Number(retentionSeconds) > 0) {
      this.contactEventRetentionSeconds = Number(retentionSeconds)
    }

    if (!this.contactTracingEnabled) {
      this.clearContactEvents()
    }
  }

  getNpcColor(npc) {
    return this.colors[npc.infection] ?? this.colors.susceptible
  }

  getNpcStatus(npcOrIndex) {
    const index = typeof npcOrIndex === 'number' ? npcOrIndex : npcOrIndex?.id

    if (!Number.isInteger(index) || index < 0 || index >= this.npcs.length) {
      return null
    }

    const state = this.states[index]
    const infection = INFECTION_STATE_NAMES[state]
    const remainingSeconds = Math.max(0, this.timers[index])

    return {
      id: this.npcs[index].id,
      infection,
      color: this.colors[infection],
      contagious: state === INFECTION_STATE_IDS.infectious,
      canBeInfected: state === INFECTION_STATE_IDS.susceptible,
      immune: state === INFECTION_STATE_IDS.recovered,
      nextState: this.getNextStateName(state),
      remainingSeconds,
      remainingDays: remainingSeconds / SECONDS_PER_DAY
    }
  }

  setNpcState(npcOrIndex, infection, timerSeconds = null) {
    const index = typeof npcOrIndex === 'number' ? npcOrIndex : npcOrIndex?.id
    const state = INFECTION_STATE_IDS[infection]

    if (!Number.isInteger(index) || index < 0 || index >= this.npcs.length) {
      throw new Error('NPC infection index is out of bounds.')
    }

    if (!Number.isInteger(state)) {
      throw new Error(`Unknown NPC infection state "${infection}".`)
    }

    this.setStateByIndex(index, state, timerSeconds ?? this.getDefaultTimerSeconds(state))
  }

  getElapsedSimulationSeconds() {
    if (this.clock && typeof this.clock.getElapsedSimulationSeconds === 'function') {
      const seconds = this.clock.getElapsedSimulationSeconds()

      if (Number.isFinite(seconds)) {
        return seconds
      }
    }

    return this.elapsedSimulationSeconds
  }

  recordTransmissionEvent(sourceNpc, targetNpc, dx, dy) {
    const event = {
      id: this.nextTransmissionEventId,
      simulationSeconds: this.getElapsedSimulationSeconds(),
      sourceNpcId: sourceNpc.id,
      targetNpcId: targetNpc.id,
      sourcePosition: clonePosition(sourceNpc.position),
      targetPosition: clonePosition(targetNpc.position),
      sourceTile: cloneTile(sourceNpc.tile),
      targetTile: cloneTile(targetNpc.tile),
      distance: Math.hypot(dx, dy),
      targetState: 'exposed'
    }

    this.nextTransmissionEventId += 1
    this.transmissionEvents.push(event)

    if (this.transmissionEvents.length > MAX_TRANSMISSION_EVENTS) {
      this.transmissionEvents.splice(0, this.transmissionEvents.length - MAX_TRANSMISSION_EVENTS)
    }
  }

  recordContactEvent(sourceNpc, targetNpc, dx, dy) {
    const pairKey = contactPairKey(sourceNpc.id, targetNpc.id)
    const existing = this.contactEventsByPair.get(pairKey)
    const event = existing || {
      id: this.nextContactEventId,
      sourceNpcId: Math.min(sourceNpc.id, targetNpc.id),
      targetNpcId: Math.max(sourceNpc.id, targetNpc.id)
    }
    const source = sourceNpc.id === event.sourceNpcId ? sourceNpc : targetNpc
    const target = targetNpc.id === event.targetNpcId ? targetNpc : sourceNpc

    event.simulationSeconds = this.getElapsedSimulationSeconds()
    event.sourcePosition = clonePosition(source.position)
    event.targetPosition = clonePosition(target.position)
    event.sourceTile = cloneTile(source.tile)
    event.targetTile = cloneTile(target.tile)
    event.distance = Math.hypot(dx, dy)

    if (!existing) {
      this.nextContactEventId += 1
      this.contactEvents.push(event)
      this.contactEventsByPair.set(pairKey, event)
    }
  }

  pruneTransmissionEvents(minSimulationSeconds) {
    if (!Number.isFinite(minSimulationSeconds)) {
      return
    }

    let firstKept = 0

    while (
      firstKept < this.transmissionEvents.length &&
      this.transmissionEvents[firstKept].simulationSeconds < minSimulationSeconds
    ) {
      firstKept += 1
    }

    if (firstKept > 0) {
      this.transmissionEvents.splice(0, firstKept)
    }
  }

  pruneContactEvents(minSimulationSeconds) {
    if (!Number.isFinite(minSimulationSeconds) || this.contactEvents.length === 0) {
      return
    }

    let writeIndex = 0

    for (let index = 0; index < this.contactEvents.length; index += 1) {
      const event = this.contactEvents[index]

      if (event.simulationSeconds < minSimulationSeconds) {
        this.contactEventsByPair.delete(contactPairKey(event.sourceNpcId, event.targetNpcId))
        continue
      }

      this.contactEvents[writeIndex] = event
      writeIndex += 1
    }

    this.contactEvents.length = writeIndex
  }

  seedInitialInfections(initialInfectiousCount) {
    const count = clampInteger(
      initialInfectiousCount ?? INFECTION_CONFIG.initialInfectiousCount,
      0,
      this.npcs.length
    )

    if (count === 0) {
      return
    }

    const indexes = new Int32Array(this.npcs.length)

    for (let index = 0; index < indexes.length; index += 1) {
      indexes[index] = index
    }

    for (let index = 0; index < count; index += 1) {
      const selectedIndex = index + this.random.int(indexes.length - index)
      const npcIndex = indexes[selectedIndex]

      indexes[selectedIndex] = indexes[index]
      indexes[index] = npcIndex
      this.setStateByIndex(npcIndex, INFECTION_STATE_IDS.infectious, this.infectionSeconds)
    }
  }

  advanceTimers(deltaSeconds) {
    for (let index = 0; index < this.states.length; index += 1) {
      const initialState = this.states[index]

      if (initialState === INFECTION_STATE_IDS.susceptible) {
        continue
      }

      let state = initialState
      let remainingSeconds = this.timers[index] - deltaSeconds
      let transitions = 0

      while (remainingSeconds <= 0 && state !== INFECTION_STATE_IDS.susceptible && transitions < 4) {
        if (state === INFECTION_STATE_IDS.exposed) {
          state = INFECTION_STATE_IDS.infectious
          remainingSeconds += this.infectionSeconds
        } else if (state === INFECTION_STATE_IDS.infectious) {
          state = this.immunitySeconds > 0
            ? INFECTION_STATE_IDS.recovered
            : INFECTION_STATE_IDS.susceptible
          remainingSeconds += this.immunitySeconds
        } else if (state === INFECTION_STATE_IDS.recovered) {
          state = INFECTION_STATE_IDS.susceptible
          remainingSeconds = 0
        }

        transitions += 1
      }

      this.setStateByIndex(
        index,
        state,
        state === INFECTION_STATE_IDS.susceptible ? 0 : Math.max(0, remainingSeconds)
      )
    }
  }

  transmit(deltaSeconds) {
    if (
      this.infectionDistance <= 0 ||
      this.infectionProbability <= 0 ||
      this.counts[INFECTION_STATE_IDS.infectious] === 0 ||
      this.counts[INFECTION_STATE_IDS.susceptible] === 0
    ) {
      return
    }

    const transmissionProbability = probabilityForDeltaSeconds(this.infectionProbability, deltaSeconds)

    if (transmissionProbability <= 0) {
      return
    }

    this.indexInfectiousNpcs()

    const infectionDistanceSquared = this.infectionDistance * this.infectionDistance

    susceptibleLoop:
    for (let index = 0; index < this.npcs.length; index += 1) {
      if (this.states[index] !== INFECTION_STATE_IDS.susceptible) {
        continue
      }

      const npc = this.npcs[index]

      if (!canParticipateInInfection(npc)) {
        continue
      }

      const cellX = this.cellXAt(npc.position.x)
      const cellY = this.cellYAt(npc.position.y)

      if (cellX < 0 || cellY < 0) {
        continue
      }

      for (let neighborY = Math.max(0, cellY - 1); neighborY <= Math.min(this.gridRows - 1, cellY + 1); neighborY += 1) {
        for (let neighborX = Math.max(0, cellX - 1); neighborX <= Math.min(this.gridColumns - 1, cellX + 1); neighborX += 1) {
          const cellIndex = neighborY * this.gridColumns + neighborX

          if (this.gridStamps[cellIndex] !== this.gridStamp) {
            continue
          }

          for (let infectiousIndex = this.gridHeads[cellIndex]; infectiousIndex !== -1; infectiousIndex = this.gridNext[infectiousIndex]) {
            const infectiousNpc = this.npcs[infectiousIndex]
            const dx = infectiousNpc.position.x - npc.position.x
            const dy = infectiousNpc.position.y - npc.position.y

            if (dx * dx + dy * dy > infectionDistanceSquared) {
              continue
            }

            if (this.random.next() < transmissionProbability) {
              this.recordTransmissionEvent(infectiousNpc, npc, dx, dy)
              this.setStateByIndex(index, INFECTION_STATE_IDS.exposed, this.incubationSeconds)
              continue susceptibleLoop
            }
          }
        }
      }
    }
  }

  recordRecentContacts() {
    if (!this.contactTracingEnabled || this.infectionDistance <= 0) {
      return
    }

    this.gridStamp += 1

    if (this.gridStamp === 0) {
      this.gridStamps.fill(0)
      this.gridStamp = 1
    }

    const infectionDistanceSquared = this.infectionDistance * this.infectionDistance

    for (let index = 0; index < this.npcs.length; index += 1) {
      const npc = this.npcs[index]

      if (!canParticipateInInfection(npc)) {
        continue
      }

      const cellX = this.cellXAt(npc.position.x)
      const cellY = this.cellYAt(npc.position.y)

      if (cellX < 0 || cellY < 0) {
        continue
      }

      for (let neighborY = Math.max(0, cellY - 1); neighborY <= Math.min(this.gridRows - 1, cellY + 1); neighborY += 1) {
        for (let neighborX = Math.max(0, cellX - 1); neighborX <= Math.min(this.gridColumns - 1, cellX + 1); neighborX += 1) {
          const cellIndex = neighborY * this.gridColumns + neighborX

          if (this.gridStamps[cellIndex] !== this.gridStamp) {
            continue
          }

          for (let otherIndex = this.gridHeads[cellIndex]; otherIndex !== -1; otherIndex = this.gridNext[otherIndex]) {
            const otherNpc = this.npcs[otherIndex]
            const dx = otherNpc.position.x - npc.position.x
            const dy = otherNpc.position.y - npc.position.y

            if (dx * dx + dy * dy <= infectionDistanceSquared) {
              this.recordContactEvent(otherNpc, npc, dx, dy)
            }
          }
        }
      }

      const cellIndex = cellY * this.gridColumns + cellX

      if (this.gridStamps[cellIndex] !== this.gridStamp) {
        this.gridStamps[cellIndex] = this.gridStamp
        this.gridHeads[cellIndex] = -1
      }

      this.gridNext[index] = this.gridHeads[cellIndex]
      this.gridHeads[cellIndex] = index
    }
  }

  indexInfectiousNpcs() {
    this.gridStamp += 1

    if (this.gridStamp === 0) {
      this.gridStamps.fill(0)
      this.gridStamp = 1
    }

    for (let index = 0; index < this.npcs.length; index += 1) {
      if (this.states[index] !== INFECTION_STATE_IDS.infectious) {
        continue
      }

      const npc = this.npcs[index]

      if (!canParticipateInInfection(npc)) {
        continue
      }

      const cellIndex = this.cellIndexAt(npc.position)

      if (cellIndex === -1) {
        continue
      }

      if (this.gridStamps[cellIndex] !== this.gridStamp) {
        this.gridStamps[cellIndex] = this.gridStamp
        this.gridHeads[cellIndex] = -1
      }

      this.gridNext[index] = this.gridHeads[cellIndex]
      this.gridHeads[cellIndex] = index
    }
  }

  cellIndexAt(position) {
    const cellX = this.cellXAt(position.x)
    const cellY = this.cellYAt(position.y)

    if (cellX < 0 || cellY < 0) {
      return -1
    }

    return cellY * this.gridColumns + cellX
  }

  cellXAt(x) {
    const cellX = Math.floor(x / this.gridCellSize)

    return cellX >= 0 && cellX < this.gridColumns ? cellX : -1
  }

  cellYAt(y) {
    const cellY = Math.floor(y / this.gridCellSize)

    return cellY >= 0 && cellY < this.gridRows ? cellY : -1
  }

  getDefaultTimerSeconds(state) {
    if (state === INFECTION_STATE_IDS.exposed) {
      return this.incubationSeconds
    }

    if (state === INFECTION_STATE_IDS.infectious) {
      return this.infectionSeconds
    }

    if (state === INFECTION_STATE_IDS.recovered) {
      return this.immunitySeconds
    }

    return 0
  }

  getNextStateName(state) {
    if (state === INFECTION_STATE_IDS.exposed) {
      return 'infectious'
    }

    if (state === INFECTION_STATE_IDS.infectious) {
      return this.immunitySeconds > 0 ? 'recovered' : 'susceptible'
    }

    if (state === INFECTION_STATE_IDS.recovered) {
      return 'susceptible'
    }

    return null
  }

  setStateByIndex(index, state, timerSeconds) {
    const previousState = this.states[index]

    if (previousState !== state) {
      this.counts[previousState] -= 1
      this.counts[state] += 1
      this.states[index] = state
    }

    this.timers[index] = timerSeconds
    this.npcs[index].infection = INFECTION_STATE_NAMES[state]
  }
}

function collectBuildingsByPurpose(city) {
  const buildingsByPurpose = {
    home: [],
    school: [],
    work: []
  }

  for (const building of city.buildings || []) {
    if (!building.entrance) {
      continue
    }

    if (buildingHasAnyType(building, HOME_BUILDING_TYPES)) {
      buildingsByPurpose.home.push(building)
    }

    if (buildingHasAnyType(building, WORK_BUILDING_TYPES)) {
      buildingsByPurpose.work.push(building)
    }

    if (buildingHasAnyType(building, SCHOOL_BUILDING_TYPES)) {
      buildingsByPurpose.school.push(building)
    }
  }

  return buildingsByPurpose
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

function takeRandomItem(items, random) {
  if (!items || items.length === 0) {
    return null
  }

  return items[random.int(items.length)]
}

function createNpcFamilyProfiles(buildingsByPurpose, random, count, config) {
  const profiles = []
  const targetCount = nonNegativeIntegerOrDefault(count, NPC_CONFIG.count)

  while (profiles.length < targetCount) {
    const remaining = targetCount - profiles.length
    const home = takeRandomItem(buildingsByPurpose.home, random)
    const familySize = chooseFamilySize(remaining, random, config)
    const ages = createFamilyAges(familySize, random)

    for (const age of ages) {
      profiles.push({
        age,
        buildingAssignment: createNpcBuildingAssignmentForAge(buildingsByPurpose, home, age, random)
      })
    }
  }

  return profiles
}

function createNpcBuildingAssignmentForAge(buildingsByPurpose, home, age, random) {
  return {
    home,
    school: isSchoolAge(age) ? takeRandomItem(buildingsByPurpose.school, random) : null,
    work: isAdultAge(age) ? takeRandomItem(buildingsByPurpose.work, random) : null
  }
}

function chooseFamilySize(remaining, random, config) {
  if (remaining <= 1) {
    return 1
  }

  const choices = familyTypeChoicesForRemaining(remaining, config, false)
  const type = weightedChoice(choices.length > 0 ? choices : familyTypeChoicesForRemaining(remaining, config, true), random)

  if (!type || type.id === 'single') {
    return 1
  }

  if (type.id === 'marriedWithoutChildren') {
    return 2
  }

  const childCount = chooseFamilyChildCount(remaining - 2, random, config)

  return 2 + childCount
}

function familyTypeChoicesForRemaining(remaining, config, useDefaults) {
  const weights = useDefaults ? NPC_CONFIG.familyTypeWeights : (config.familyTypeWeights || NPC_CONFIG.familyTypeWeights)
  const choices = []

  appendWeightedChoice(choices, 'single', weights?.single)

  if (remaining >= 2) {
    appendWeightedChoice(choices, 'marriedWithoutChildren', weights?.marriedWithoutChildren)
  }

  if (remaining >= 3) {
    appendWeightedChoice(choices, 'marriedWithChildren', weights?.marriedWithChildren)
  }

  return choices
}

function appendWeightedChoice(choices, id, weight) {
  if (Number.isFinite(weight) && weight > 0) {
    choices.push({ id, weight })
  }
}

function chooseFamilyChildCount(maxChildren, random, config) {
  const choices = familyChildCountChoicesForRemaining(maxChildren, config, false)
  const choice = weightedChoice(choices.length > 0 ? choices : familyChildCountChoicesForRemaining(maxChildren, config, true), random)

  return choice ? choice.count : 1
}

function familyChildCountChoicesForRemaining(maxChildren, config, useDefaults) {
  const weights = useDefaults
    ? NPC_CONFIG.familyChildCountWeights
    : (config.familyChildCountWeights || NPC_CONFIG.familyChildCountWeights)
  const choices = []

  for (const option of weights || []) {
    if (Number.isInteger(option?.count) && option.count >= 1 && option.count <= maxChildren &&
        Number.isFinite(option.weight) && option.weight > 0) {
      choices.push({ count: option.count, weight: option.weight })
    }
  }

  return choices
}

function weightedChoice(choices, random) {
  let totalWeight = 0

  for (const choice of choices || []) {
    totalWeight += choice.weight
  }

  if (totalWeight <= 0) {
    return null
  }

  let threshold = random.next() * totalWeight

  for (const choice of choices) {
    threshold -= choice.weight

    if (threshold <= 0) {
      return choice
    }
  }

  return choices[choices.length - 1]
}

function createFamilyAges(familySize, random) {
  if (familySize <= 1) {
    return [randomIntegerInclusive(ADULT_MIN_AGE, ADULT_MAX_AGE, random)]
  }

  if (familySize === 2) {
    return createPartnerAges(random)
  }

  const childAges = []

  for (let index = 0; index < familySize - 2; index += 1) {
    childAges.push(randomIntegerInclusive(CHILD_MIN_AGE, CHILD_MAX_AGE, random))
  }

  const oldestChildAge = Math.max(...childAges)
  const minParentAge = Math.max(ADULT_MIN_AGE, oldestChildAge + MIN_PARENT_AGE_GAP)
  const maxParentAge = Math.min(ADULT_MAX_AGE, oldestChildAge + MAX_PARENT_AGE_GAP)
  const firstParentAge = randomIntegerInclusive(minParentAge, maxParentAge, random)
  const secondParentAge = createPartnerAge(firstParentAge, random, minParentAge, ADULT_MAX_AGE)

  return [firstParentAge, secondParentAge, ...childAges]
}

function createPartnerAges(random) {
  const firstAge = randomIntegerInclusive(ADULT_MIN_AGE, ADULT_MAX_AGE, random)

  return [
    firstAge,
    createPartnerAge(firstAge, random, ADULT_MIN_AGE, ADULT_MAX_AGE)
  ]
}

function createPartnerAge(firstAge, random, minAge, maxAge) {
  return randomIntegerInclusive(
    Math.max(minAge, firstAge - MAX_PARTNER_AGE_DIFFERENCE),
    Math.min(maxAge, firstAge + MAX_PARTNER_AGE_DIFFERENCE),
    random
  )
}

function randomIntegerInclusive(min, max, random) {
  const safeMin = Math.ceil(min)
  const safeMax = Math.floor(Math.max(min, max))

  return safeMin + random.int(safeMax - safeMin + 1)
}

function isSchoolAge(age) {
  return Number.isInteger(age) && age >= SCHOOL_MIN_AGE && age < SCHOOL_MAX_AGE_EXCLUSIVE
}

function isAdultAge(age) {
  return Number.isInteger(age) && age >= ADULT_MIN_AGE && age <= ADULT_MAX_AGE
}

function createNpcTimetable(city, buildingAssignment, age, random, config) {
  if (!buildingAssignment.home) {
    return new NpcTimetable([])
  }

  if (isSchoolAge(age)) {
    return buildingAssignment.school
      ? createCommuteTimetable(city, buildingAssignment.home, buildingAssignment.school, 'school', random, config)
      : createHomeOnlyTimetable(city, buildingAssignment.home)
  }

  if (isAdultAge(age) && buildingAssignment.work) {
    return createCommuteTimetable(city, buildingAssignment.home, buildingAssignment.work, 'work', random, config)
  }

  return createHomeOnlyTimetable(city, buildingAssignment.home)
}

function createHomeOnlyTimetable(city, home) {
  return new NpcTimetable([
    createTimetableElement('home', home, 0, 0, city)
  ])
}

function createCommuteTimetable(city, home, destination, destinationId, random, config) {
  if (!home || !destination) {
    return new NpcTimetable([])
  }

  const variationHours = finiteNumberOrDefault(config.scheduleVariationHours, NPC_CONFIG.scheduleVariationHours)
  const commuteStartHour = normalizeHour(
    finiteNumberOrDefault(config.workStartHour, NPC_CONFIG.workStartHour) + random.between(-variationHours, variationHours)
  )
  const commuteEndHour = normalizeHour(
    finiteNumberOrDefault(config.workEndHour, NPC_CONFIG.workEndHour) + random.between(-variationHours, variationHours)
  )

  return new NpcTimetable([
    createTimetableElement('home', home, commuteEndHour, commuteStartHour, city),
    createTimetableElement(destinationId, destination, commuteStartHour, commuteEndHour, city)
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
      slot: { id: -1 },
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
    position: tileSlotPosition(city, tileX, tileY, slot, slotOffsets),
    tile: { x: tileX, y: tileY, index: tileIndex },
    slot: { id: slot },
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
    idleNpcSprite(npc)
    return
  }

  if (!npc.present) {
    idleNpcSprite(npc)
    return
  }

  if (npc.movement.target) {
    moveNpcTowardTarget(npc, deltaSeconds, context)

    if (!npc.movement.target && npc.isAtGoalTile()) {
      enterGoalLocation(npc, context)
    }

    return
  }

  idleNpcSprite(npc)

  if (npc.goal) {
    followRoute(npc, deltaSeconds, context)
  }
}

function moveNpcTowardTarget(npc, deltaSeconds, context) {
  const target = npc.movement.target
  const maxStep = npc.movement.speed * deltaSeconds
  const nextDistance = Math.min(target.distanceTravelled + maxStep, target.curve.length)
  const previousX = npc.position.x
  const previousY = npc.position.y
  const nextPosition = target.nextPosition || (target.nextPosition = { x: previousX, y: previousY })

  pointOnNpcMovementCurve(target.curve, nextDistance, nextPosition)

  const deltaX = nextPosition.x - previousX
  const deltaY = nextPosition.y - previousY
  const movedDistance = Math.hypot(deltaX, deltaY)
  const directionX = movedDistance > 0.0001 ? deltaX / movedDistance : target.directionX
  const directionY = movedDistance > 0.0001 ? deltaY / movedDistance : target.directionY

  stepNpcSpriteAnimation(npc, directionX, directionY, movedDistance)
  npc.movement.headingX = directionX
  npc.movement.headingY = directionY

  if (nextDistance >= target.curve.length || target.remainingDistance <= maxStep || target.remainingDistance === 0) {
    npc.position.x = target.position.x
    npc.position.y = target.position.y
    npc.tile.x = target.tile.x
    npc.tile.y = target.tile.y
    npc.tile.index = target.tile.index
    npc.slot.id = target.slot.id
    setNpcMovementHeading(npc, target.endDirectionX, target.endDirectionY)
    npc.movement.target = null
    return
  }

  npc.position.x = nextPosition.x
  npc.position.y = nextPosition.y
  target.distanceTravelled = nextDistance
  target.remainingDistance = target.curve.length - nextDistance
  target.directionX = directionX
  target.directionY = directionY
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
  return context.city.getRouteFieldNextIndex(npc.routing.routeField, npc.tile.index)
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
  const nextIndex = context.city.getRouteFieldNextIndex(routeField, npc.tile.index)

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
    context.unlimitedCapacityTiles,
    npc.slot.id
  )

  const target = targetSlot.unlimited
    ? tileCenterPosition(city, tileX, tileY)
    : tileSlotPosition(city, tileX, tileY, targetSlot.slot, context.slotOffsets)
  const movementTarget = createNpcMovementTarget(npc, target, {
    tileX,
    tileY,
    targetIndex,
    slot: targetSlot.slot
  }, context)

  npc.movement.target = movementTarget
  faceNpcSprite(npc, movementTarget.directionX, movementTarget.directionY)

  return true
}

function createNpcMovementTarget(npc, target, targetState, context) {
  const start = { x: npc.position.x, y: npc.position.y }
  const directDirection = normalizeVector(target.x - start.x, target.y - start.y) || { x: 0, y: 0 }
  const startDirection = npcMovementHeading(npc, directDirection)
  const curve = createNpcMovementCurve(
    start,
    target,
    startDirection,
    directDirection,
    context.city.tileSize
  )

  return {
    position: target,
    directionX: startDirection.x,
    directionY: startDirection.y,
    endDirectionX: directDirection.x,
    endDirectionY: directDirection.y,
    distanceTravelled: 0,
    remainingDistance: curve.length,
    curve,
    tile: {
      x: targetState.tileX,
      y: targetState.tileY,
      index: targetState.targetIndex
    },
    slot: {
      id: targetState.slot
    }
  }
}

function createNpcMovementCurve(start, end, startDirection, endDirection, tileSize) {
  const straightDistance = Math.hypot(end.x - start.x, end.y - start.y)
  const tangentDistance = Math.min(
    straightDistance * NPC_MOVEMENT_CURVE_TANGENT_SCALE,
    tileSize * NPC_MOVEMENT_CURVE_MAX_TANGENT_TILES
  )
  const p0 = { x: start.x, y: start.y }
  const p1 = {
    x: start.x + startDirection.x * tangentDistance,
    y: start.y + startDirection.y * tangentDistance
  }
  const p2 = {
    x: end.x - endDirection.x * tangentDistance,
    y: end.y - endDirection.y * tangentDistance
  }
  const p3 = { x: end.x, y: end.y }
  const samples = createNpcMovementCurveSamples(p0, p1, p2, p3)
  const length = samples[samples.length - 1].distance

  return {
    p0,
    p1,
    p2,
    p3,
    samples,
    length
  }
}

function createNpcMovementCurveSamples(p0, p1, p2, p3) {
  const samples = [{ t: 0, distance: 0, point: { x: p0.x, y: p0.y } }]
  let previous = samples[0].point
  let distance = 0

  for (let index = 1; index <= NPC_MOVEMENT_CURVE_SAMPLE_COUNT; index += 1) {
    const t = index / NPC_MOVEMENT_CURVE_SAMPLE_COUNT
    const point = cubicBezierPoint(p0, p1, p2, p3, t)

    distance += Math.hypot(point.x - previous.x, point.y - previous.y)
    samples.push({ t, distance, point })
    previous = point
  }

  return samples
}

function pointOnNpcMovementCurve(curve, distance, out = { x: 0, y: 0 }) {
  if (curve.length === 0 || distance <= 0) {
    out.x = curve.p0.x
    out.y = curve.p0.y
    return out
  }

  if (distance >= curve.length) {
    out.x = curve.p3.x
    out.y = curve.p3.y
    return out
  }

  const samples = curve.samples

  for (let index = 1; index < samples.length; index += 1) {
    const sample = samples[index]

    if (distance > sample.distance) {
      continue
    }

    const previous = samples[index - 1]
    const span = sample.distance - previous.distance
    const ratio = span === 0 ? 0 : (distance - previous.distance) / span
    const t = previous.t + (sample.t - previous.t) * ratio

    return cubicBezierPointInto(out, curve.p0, curve.p1, curve.p2, curve.p3, t)
  }

  out.x = curve.p3.x
  out.y = curve.p3.y
  return out
}

function cubicBezierPoint(p0, p1, p2, p3, t) {
  return cubicBezierPointInto({ x: 0, y: 0 }, p0, p1, p2, p3, t)
}

function cubicBezierPointInto(out, p0, p1, p2, p3, t) {
  const inverse = 1 - t
  const a = inverse * inverse * inverse
  const b = 3 * inverse * inverse * t
  const c = 3 * inverse * t * t
  const d = t * t * t

  out.x = a * p0.x + b * p1.x + c * p2.x + d * p3.x
  out.y = a * p0.y + b * p1.y + c * p2.y + d * p3.y
  return out
}

function npcMovementHeading(npc, fallback) {
  const heading = normalizeVector(npc.movement.headingX, npc.movement.headingY)

  if (!heading) {
    return fallback
  }

  if (fallback.x === 0 && fallback.y === 0) {
    return heading
  }

  return heading.x * fallback.x + heading.y * fallback.y < -0.2 ? fallback : heading
}

function setNpcMovementHeading(npc, x, y) {
  const direction = normalizeVector(x, y)

  if (!direction) {
    return
  }

  npc.movement.headingX = direction.x
  npc.movement.headingY = direction.y
}

function clearNpcMovementHeading(npc) {
  npc.movement.headingX = 0
  npc.movement.headingY = 0
}

function normalizeVector(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null
  }

  const length = Math.hypot(x, y)

  if (length <= 0.0001) {
    return null
  }

  return {
    x: x / length,
    y: y / length
  }
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
    : tileSlotPosition(context.city, location.x, location.y, targetSlot.slot, context.slotOffsets)

  npc.present = true
  npc.locationState = null
  npc.position.x = position.x
  npc.position.y = position.y
  npc.tile.x = location.x
  npc.tile.y = location.y
  npc.tile.index = location.index
  npc.slot.id = targetSlot.slot
  clearNpcMovementHeading(npc)
  idleNpcSprite(npc)

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
  npc.slot = { id: -1 }
  npc.movement.target = null
  clearNpcMovementHeading(npc)
  idleNpcSprite(npc)
  npc.routing = createEmptyRouteState()
}

function findAvailableNpcSlot(tileIndex, random, tileCapacity, unlimitedCapacityTiles, preferredSlot = null) {
  if (unlimitedCapacityTiles && unlimitedCapacityTiles[tileIndex]) {
    return { slot: -1, unlimited: true }
  }

  if (Number.isInteger(preferredSlot) && preferredSlot >= 0 && preferredSlot < tileCapacity) {
    return { slot: preferredSlot, unlimited: false }
  }

  return { slot: random.int(tileCapacity), unlimited: false }
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

function tileSlotPosition(city, tileX, tileY, slot, slotOffsets) {
  const centerX = (tileX + 0.5) * city.tileSize
  const centerY = (tileY + 0.5) * city.tileSize
  const offset = slotOffsets[slot]

  return {
    x: centerX + offset.x,
    y: centerY + offset.y
  }
}

function tileCenterPosition(city, tileX, tileY) {
  return {
    x: (tileX + 0.5) * city.tileSize,
    y: (tileY + 0.5) * city.tileSize
  }
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

function nonNegativeIntegerOrDefault(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback
}

function nonNegativeNumberOrDefault(value, fallback) {
  const number = Number(value)

  return Number.isFinite(number) && number >= 0 ? number : fallback
}

function clampUnitInterval(value) {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    return INFECTION_CONFIG.infectionProbability
  }

  return Math.min(Math.max(number, 0), 1)
}

function clampInteger(value, min, max) {
  const number = Math.round(Number(value))

  if (!Number.isFinite(number)) {
    return min
  }

  return Math.min(Math.max(number, min), max)
}

function daysToSeconds(days) {
  return days * SECONDS_PER_DAY
}

function probabilityForDeltaSeconds(probabilityPerMinute, deltaSeconds) {
  return 1 - ((1 - probabilityPerMinute) ** (deltaSeconds / SECONDS_PER_MINUTE))
}

function canParticipateInInfection(npc) {
  return Boolean(
    npc &&
    !npc.vehicleTrip &&
    npc.position &&
    Number.isFinite(npc.position.x) &&
    Number.isFinite(npc.position.y)
  )
}

function clonePosition(position) {
  return {
    x: Number(position && position.x) || 0,
    y: Number(position && position.y) || 0
  }
}

function cloneTile(tile) {
  return tile
    ? {
        x: tile.x,
        y: tile.y,
        index: tile.index
      }
    : null
}

function cloneTransmissionEvent(event) {
  return {
    ...event,
    sourcePosition: { ...event.sourcePosition },
    targetPosition: { ...event.targetPosition },
    sourceTile: event.sourceTile ? { ...event.sourceTile } : null,
    targetTile: event.targetTile ? { ...event.targetTile } : null
  }
}

function cloneContactEvent(event) {
  return {
    ...event,
    sourcePosition: { ...event.sourcePosition },
    targetPosition: { ...event.targetPosition },
    sourceTile: event.sourceTile ? { ...event.sourceTile } : null,
    targetTile: event.targetTile ? { ...event.targetTile } : null
  }
}

function contactPairKey(firstNpcId, secondNpcId) {
  return firstNpcId < secondNpcId
    ? `${firstNpcId}:${secondNpcId}`
    : `${secondNpcId}:${firstNpcId}`
}

function normalizeInfectionColors(colors = {}) {
  const palette = colors || {}
  const fallback = INFECTION_CONFIG.colors

  return {
    susceptible: finiteColorOrDefault(palette.susceptible, fallback.susceptible),
    exposed: finiteColorOrDefault(palette.exposed, fallback.exposed),
    infectious: finiteColorOrDefault(palette.infectious, fallback.infectious),
    recovered: finiteColorOrDefault(palette.recovered, fallback.recovered)
  }
}

function finiteColorOrDefault(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}
