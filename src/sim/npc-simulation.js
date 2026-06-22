import {
  ENTITY_RENDER_DEBUG_CONFIG,
  HOME_BUILDING_TYPES,
  INFECTION_CONFIG,
  NIGHTCLUB_BUILDING_TYPES,
  NPC_CONFIG,
  RESTAURANT_BUILDING_TYPES,
  SCHOOL_BUILDING_TYPES,
  SHOPPING_BUILDING_TYPES,
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
import { createGraphicsPixiShim } from '../render/pixi-shim.js'
import { toMovementSeconds, toSimulationSeconds } from './simulation-clock.js'

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
const DESIRE_NAMES = Object.freeze(['hunger', 'energy', 'fun', 'social'])
const DESIRE_INDEX = Object.freeze({
  hunger: 0,
  energy: 1,
  fun: 2,
  social: 3
})
const DESIRE_COUNT = DESIRE_NAMES.length
const DESIRE_DESTINATION_IDS = Object.freeze({
  hunger: 'desire:hunger',
  energy: 'desire:energy',
  fun: 'desire:fun',
  social: 'desire:social'
})
const DESIRE_DESTINATION_IDS_BY_INDEX = Object.freeze(DESIRE_NAMES.map((need) => DESIRE_DESTINATION_IDS[need]))
const DESIRE_ACTIONS = Object.freeze({
  hunger: 'eat',
  energy: 'rest',
  fun: 'have fun',
  social: 'socialize'
})
const DESIRE_ACTIONS_BY_INDEX = Object.freeze(DESIRE_NAMES.map((need) => DESIRE_ACTIONS[need]))
const NIGHTCLUB_DESIRE_START_HOUR = 20
const NIGHTCLUB_DESIRE_END_HOUR = 4
const NPC_CROWDING_SPARSE_UPDATE_LIMIT = 3000
const DESIRE_ZERO_RATES = new Float64Array(DESIRE_COUNT)
const DEFAULT_SOCIAL_GRAPH_CONFIG = Object.freeze({
  minFriends: 2,
  maxFriends: 8,
  candidateAttemptsPerFriend: 16,
  ageBucketYears: 8,
  sameHomeWeight: 4,
  sameWorkOrSchoolWeight: 5,
  agePeerWeight: 3,
  randomWeight: 1
})
const DEFAULT_SOCIAL_GROUP_MIN_FRIENDS = 1
const DEFAULT_SOCIAL_GROUP_MAX_FRIENDS = 3
const CONTACT_PAIR_KEY_BASE = 0x4000000
const desireCityDataCache = new WeakMap()

export function createNpcSimulation(city, entityLayer, config) {
  const random = config.random || createSystemRandom()
  const infectionRandom = config.infectionRandom || (random.seed ? createSeededRandom(`${random.seed}:infection`) : createSystemRandom())
  const policyRandom = config.policyRandom || (random.seed ? createSeededRandom(`${random.seed}:policy`) : createSystemRandom())
  const desireRandom = config.desireRandom || (random.seed ? createSeededRandom(`${random.seed}:desires`) : createSystemRandom())
  const socialRandom = config.socialRandom || (random.seed ? createSeededRandom(`${random.seed}:social`) : createSystemRandom())
  const renderEnabled = config.render !== false
  const pixi = config.pixi || globalThis.PIXI || createGraphicsPixiShim()
  const zorder = Number.isFinite(config.zorder) ? config.zorder : NPC_CONFIG.zorder
  const visualSlotCount = resolveNpcVisualSlotCount(config)
  const clock = config.clock || STATIC_CLOCK
  const visibleTileCounts = new Uint8Array(city.tiles.length)
  const visibleTileIndexes = []
  const slotOffsets = createNpcSlotOffsets(city, config, visualSlotCount)
  const spawnTiles = collectNpcSpawnTiles(city)
  const desireCityData = getDesireCityData(city)
  const buildingsByPurpose = desireCityData.buildingsByPurpose
  const unlimitedCapacityTiles = collectBuildingEntranceTiles(city)
  const routePlanner = new NpcRoutePlanner(config)
  const policyController = new NpcPolicyController(city, policyRandom, clock)
  const npcs = []
  const crowding = createNpcCrowdingState(city, config)
  const context = {
    city,
    clock,
    slotOffsets,
    unlimitedCapacityTiles,
    crowding,
    random,
    policies: policyController,
    routePlanner,
    visualSlotCount,
    renderEnabled,
    zorder,
    config
  }
  let destroyed = false
  let entityDebugOptions = { ...(config.entityDebugOptions || {}) }
  const npcProfiles = createNpcFamilyProfiles(city, buildingsByPurpose, random, config.count, config)

  if (renderEnabled && entityLayer) {
    entityLayer.eventMode = 'none'
    entityLayer.sortableChildren = true
  }

  for (let id = 0; id < npcProfiles.length; id += 1) {
    const profile = npcProfiles[id]
    const timetable = createNpcTimetable(city, profile.buildingAssignment, profile.age, random, config)
    const spawnState = createNpcSpawnState(city, spawnTiles, timetable, clock, random, config, slotOffsets, visualSlotCount)

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
      renderEnabled,
      zorder,
      config
    }))
  }

  const desires = new NpcDesireDynamics(npcs, city, desireCityData, config, desireRandom, clock)
  const socialGraph = createNpcSocialGraph(npcs, socialRandom, config.socialGraph)
  desires.setSocialGraph(socialGraph, routePlanner)
  context.desires = desires
  const infection = new NpcInfectionDynamics(npcs, city, config, infectionRandom, clock)
  setPolicyEffects(config.policyEffects)
  infection.setContactTracingEnabled(
    Boolean(entityDebugOptions.contactEdgesVisible),
    entityDebugOptions.contactEdgeDurationSeconds
  )
  const npcRenderer = renderEnabled
    ? createNpcSpriteRenderer(npcs, city, config, infection, {
        pixi,
        visibleTileCounts,
        visibleTileIndexes,
        clock,
        getContactEvents: (options) => infection.getRecentContactEvents(options),
        getTransmissionEvents: (options) => infection.getRecentTransmissionEvents(options),
        entityDebugOptions
      })
    : createNoopNpcRenderer()
  const display = npcRenderer.display
  const graphics = npcRenderer.spriteDisplay || display

  if (renderEnabled && entityLayer && display) {
    entityLayer.addChild(display)
    if (npcRenderer.debugDisplay && npcRenderer.debugDisplay !== display) {
      entityLayer.addChild(npcRenderer.debugDisplay)
    }
  }

  function update(deltaSeconds) {
    if (destroyed) {
      return
    }

    const safeDelta = Math.min(Math.max(deltaSeconds, 0), 0.1)
    const movementDelta = toMovementSeconds(safeDelta, config.movementTimeScale)
    const timeOfDayHours = clock.getTimeOfDayHours()

    updateNpcCrowdingState(crowding, npcs)

    for (let index = 0; index < npcs.length; index += 1) {
      const npc = npcs[index]
      refreshNpcGoal(npc, timeOfDayHours, context)
    }

    for (let index = 0; index < npcs.length; index += 1) {
      const npc = npcs[index]
      prepareNpcForRouting(npc, movementDelta, context)
    }

    routePlanner.process(context)

    for (let index = 0; index < npcs.length; index += 1) {
      const npc = npcs[index]
      updateNpcMovement(npc, movementDelta, context)
    }

    desires.update(safeDelta)
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

  function setPolicyEffects(effects) {
    policyController.setEffects(effects)

    if (infection) {
      infection.setPolicyInfectionProbabilityMultiplier(policyController.effects.infectionProbabilityMultiplier)
    }
  }

  render()

  return {
    npcs,
    socialGraph,
    visualSlotCount,
    routePlanner,
    desires,
    infection,
    graphics,
    update,
    render,
    setEntityRenderMode,
    setEntityDebugOptions,
    setPolicyEffects,
    destroy() {
      destroyed = true

      npcRenderer.destroy()
    }
  }
}

function createNoopNpcRenderer() {
  return {
    display: null,
    spriteDisplay: null,
    debugDisplay: null,
    render() {},
    setRenderMode() {},
    setDebugOptions() {},
    destroy() {}
  }
}

class NpcEntity {
  constructor({ id, position, tile, slot, present, locationState, buildingAssignment, age, timetable, random, renderEnabled, zorder, config }) {
    this.id = id
    this.zorder = zorder
    this.renderEnabled = renderEnabled !== false
    this.age = age
    this.home = buildingAssignment.home ? buildingAssignment.home.id : null
    this.school = buildingAssignment.school ? buildingAssignment.school.id : null
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
    this.desires = null
    this.activeDesire = null
    this.friendIds = []
  }

  getActiveTimetableElement(timeOfDayHours) {
    return this.timetable.getActiveElement(timeOfDayHours)
  }

  getActiveDestinationElement(timeOfDayHours) {
    return this.getActiveTimetableElement(timeOfDayHours)
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
      this.locationState.buildingId === this.goal.buildingId &&
      (
        this.locationState.timetableElementId === this.goal.id ||
        isDesireElementId(this.goal.id)
      )
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
    if (this.renderEnabled) {
      idleNpcSprite(this)
    }
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
    if (this.renderEnabled) {
      idleNpcSprite(this)
    }
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

class NpcPolicyController {
  constructor(city, random, clock) {
    this.city = city
    this.random = random
    this.clock = clock
    this.effects = normalizeNpcPolicyEffects(null)
    this.decisions = new Map()
    this.effectKey = getNpcPolicyEffectsKey(this.effects)
    this.hasEventCancellations = hasNpcPolicyEventCancellations(this.effects)
  }

  setEffects(effects) {
    const nextEffects = normalizeNpcPolicyEffects(effects)
    const nextKey = getNpcPolicyEffectsKey(nextEffects)

    if (nextKey !== this.effectKey) {
      this.decisions.clear()
      this.effectKey = nextKey
    }

    this.effects = nextEffects
    this.hasEventCancellations = hasNpcPolicyEventCancellations(nextEffects)
  }

  getAdjustedDestinationElement(npc, element) {
    if (!this.hasEventCancellations) {
      return element
    }

    const eventAction = getPolicyEventActionForElement(this.city, element)

    if (!eventAction) {
      return element
    }

    const probability = this.effects.eventCancellationProbabilities[eventAction] || 0

    if (probability <= 0) {
      return element
    }

    return this.shouldCancelEvent(npc, element, eventAction, probability)
      ? getNpcHomeTimetableElement(npc) || element
      : element
  }

  shouldKeepDistanceFromTile(tileIndex) {
    return Boolean(this.effects.socialDistancingEnabled && Number.isInteger(tileIndex) && tileIndex >= 0)
  }

  shouldCancelEvent(npc, element, eventAction, probability) {
    if (probability >= 1) {
      return true
    }

    const key = createNpcPolicyDecisionKey(npc, element, eventAction, probability, this.clock)

    if (!this.decisions.has(key)) {
      this.decisions.set(key, this.random.next() < probability)
    }

    return this.decisions.get(key)
  }
}

class NpcDesireDynamics {
  constructor(npcs, city, cityData, config, random, clock) {
    this.npcs = npcs
    this.city = city
    this.cityData = cityData
    this.buildingsByPurpose = cityData.buildingsByPurpose
    this.config = normalizeDesireConfig(config.desires)
    this.random = random
    this.clock = clock
    this.elapsedSimulationSeconds = 0
    this.needScores = Array.from({ length: DESIRE_COUNT }, () => new Float64Array(npcs.length))
    this.cooldowns = Array.from({ length: DESIRE_COUNT }, () => new Float64Array(npcs.length))
    this.buildingsById = cityData.buildingsById
    this.homesWithMinors = collectHomesWithMinors(npcs)
    this.decayPerHour = needRatesToArray(this.config.decayPerHour)
    this.homeSatisfactionRates = needRatesToArray(this.config.satisfactionPerHour.home)
    this.restaurantSatisfactionRates = needRatesToArray(this.config.satisfactionPerHour.restaurant)
    this.supermarketSatisfactionRates = needRatesToArray(this.config.satisfactionPerHour.supermarket)
    this.mallSatisfactionRates = needRatesToArray(this.config.satisfactionPerHour.mall)
    this.nightclubSatisfactionRates = needRatesToArray(this.config.satisfactionPerHour.nightclub)
    this.baseSatisfactionByBuildingId = buildBaseDesireSatisfactionByBuildingId(
      city.buildings || [],
      this.restaurantSatisfactionRates,
      this.supermarketSatisfactionRates,
      this.mallSatisfactionRates,
      this.nightclubSatisfactionRates
    )
    this.destinationCache = Array.from({ length: DESIRE_COUNT }, () => new Map())
    this.socialGraph = null
    this.routePlanner = null
    this.nextSocialGroupId = 1

    for (let index = 0; index < npcs.length; index += 1) {
      const npc = npcs[index]

      for (let needIndex = 0; needIndex < DESIRE_COUNT; needIndex += 1) {
        this.needScores[needIndex][index] = clampNeedScore(this.random.between(this.config.initialMin, this.config.initialMax))
      }

      npc.desires = createNpcDesireView(this.needScores, index)
      npc.activeDesire = null
      Object.defineProperty(npc, 'getActiveDestinationElement', {
        value: (timeOfDayHours) => this.getActiveDestinationElement(npc, timeOfDayHours),
        configurable: true,
        writable: true
      })
    }
  }

  setSocialGraph(socialGraph, routePlanner = null) {
    this.socialGraph = socialGraph || null
    this.routePlanner = routePlanner || null
  }

  update(deltaSeconds) {
    const simulationDeltaSeconds = toSimulationSeconds(this.clock, deltaSeconds)

    if (!Number.isFinite(simulationDeltaSeconds) || simulationDeltaSeconds <= 0) {
      return
    }

    this.elapsedSimulationSeconds += simulationDeltaSeconds
    const deltaHours = simulationDeltaSeconds / SECONDS_PER_HOUR

    for (let index = 0; index < this.npcs.length; index += 1) {
      this.decayNeeds(index, deltaHours)
      this.satisfyNeeds(this.npcs[index], index, deltaHours)
    }
  }

  getActiveDestinationElement(npc, timeOfDayHours) {
    const scheduledElement = npc.getActiveTimetableElement(timeOfDayHours)

    if (!this.canUseDesireDestination(npc, scheduledElement)) {
      this.clearActiveDesire(npc)
      return scheduledElement
    }

    this.refreshActiveDesire(npc, timeOfDayHours)

    return npc.activeDesire?.element || scheduledElement
  }

  handleRouteFailure(npc) {
    if (!npc.activeDesire) {
      return
    }

    if (npc.activeDesire.socialGroupId) {
      this.clearSocialGroupDesire(npc.activeDesire, true)
      return
    }

    this.startCooldown(npc, npc.activeDesire.needIndex)
    this.clearActiveDesire(npc)
  }

  canUseDesireDestination(npc, scheduledElement) {
    return Boolean(
      scheduledElement &&
      scheduledElement.id === 'home' &&
      Number.isInteger(npc.age) &&
      npc.age >= SCHOOL_MIN_AGE &&
      npc.desires
    )
  }

  refreshActiveDesire(npc, timeOfDayHours) {
    if (npc.activeDesire) {
      if (this.shouldContinueActiveDesire(npc)) {
        return
      }

      this.startCooldown(npc, npc.activeDesire.needIndex)
      this.clearActiveDesire(npc)
    }

    const nextDesire = this.chooseNextDesire(npc, timeOfDayHours)

    if (nextDesire) {
      npc.activeDesire = nextDesire
    }
  }

  shouldContinueActiveDesire(npc) {
    const needIndex = npc.activeDesire?.needIndex

    if (npc.activeDesire?.socialGroupId) {
      return Boolean(
        Number.isInteger(needIndex) &&
        npc.desires &&
        (
          npc.locationState?.buildingId !== npc.activeDesire.buildingId ||
          this.needScores[needIndex][npc.id] < this.config.satisfiedThreshold
        )
      )
    }

    return Boolean(
      Number.isInteger(needIndex) &&
      npc.desires &&
      this.needScores[needIndex][npc.id] < this.config.satisfiedThreshold
    )
  }

  chooseNextDesire(npc, timeOfDayHours) {
    const npcIndex = npc.id
    const elapsedSeconds = this.getElapsedSimulationSeconds()
    let selectedNeedIndex = -1
    let selectedScore = this.config.lowThreshold

    for (let needIndex = 0; needIndex < DESIRE_COUNT; needIndex += 1) {
      const score = this.needScores[needIndex][npcIndex]

      if (score < selectedScore && this.cooldowns[needIndex][npcIndex] <= elapsedSeconds) {
        selectedNeedIndex = needIndex
        selectedScore = score
      }
    }

    if (selectedNeedIndex === -1) {
      return null
    }

    const destination = this.createDestinationForNeed(npc, selectedNeedIndex, timeOfDayHours)

    if (!destination) {
      return null
    }

    const activeDesire = {
      needIndex: selectedNeedIndex,
      need: destination.need,
      action: DESIRE_ACTIONS_BY_INDEX[selectedNeedIndex],
      buildingId: destination.building.id,
      element: destination.element,
      startedAtSeconds: elapsedSeconds
    }

    return selectedNeedIndex === DESIRE_INDEX.social
      ? this.createSocialGroupDesire(npc, activeDesire, timeOfDayHours)
      : activeDesire
  }

  createDestinationForNeed(npc, needIndex, timeOfDayHours) {
    const building = this.chooseBuildingForNeed(npc, needIndex, timeOfDayHours)

    if (!building?.entrance) {
      return null
    }

    const cache = this.destinationCache[needIndex]
    const cached = cache.get(building.id)

    if (cached) {
      return cached
    }

    const need = DESIRE_NAMES[needIndex]
    const element = createTimetableElement(DESIRE_DESTINATION_IDS_BY_INDEX[needIndex], building, 0, 0, this.city)

    element.desire = need
    element.action = DESIRE_ACTIONS_BY_INDEX[needIndex]

    const destination = { need, building, element }

    cache.set(building.id, destination)
    return destination
  }

  chooseBuildingForNeed(npc, needIndex, timeOfDayHours) {
    const home = this.buildingsById.get(npc.home) || null
    const origin = this.buildingsById.get(npc.locationState?.buildingId) || home

    if (needIndex === DESIRE_INDEX.energy) {
      return home
    }

    if (needIndex === DESIRE_INDEX.hunger) {
      return this.takeNearbyBuilding('restaurant', origin) ||
        this.takeNearbyBuilding('supermarket', origin) ||
        home
    }

    if (needIndex === DESIRE_INDEX.fun) {
      return this.takeNearbyBuilding('mall', origin) ||
        (this.canUseNightclub(npc, timeOfDayHours) ? this.takeNearbyBuilding('nightclub', origin) : null) ||
        home
    }

    if (needIndex === DESIRE_INDEX.social) {
      return (this.canUseNightclub(npc, timeOfDayHours) ? this.takeNearbyBuilding('nightclub', origin) : null) ||
        this.takeNearbyBuilding('mall', origin) ||
        this.takeNearbyBuilding('restaurant', origin) ||
        home
    }

    return null
  }

  createSocialGroupDesire(npc, activeDesire, timeOfDayHours) {
    const participantIds = this.chooseSocialCompanions(npc, timeOfDayHours)

    if (participantIds.length <= 1) {
      return activeDesire
    }

    const groupId = this.nextSocialGroupId

    this.nextSocialGroupId += 1

    for (let index = 1; index < participantIds.length; index += 1) {
      const friend = this.npcs[participantIds[index]]

      if (!friend) {
        continue
      }

      const friendDesire = cloneSocialActiveDesire(activeDesire, groupId, npc.id, participantIds)

      friend.activeDesire = friendDesire

      if (typeof friend.setGoal === 'function') {
        friend.setGoal(friendDesire.element)

        if (friend.present) {
          this.routePlanner?.request(friend)
        }
      }
    }

    return cloneSocialActiveDesire(activeDesire, groupId, npc.id, participantIds)
  }

  chooseSocialCompanions(npc, timeOfDayHours) {
    const friendIds = this.socialGraph?.getFriendIds(npc) || npc.friendIds || []
    const maxFriends = Math.max(0, this.config.socialGroupMaxFriends)

    if (friendIds.length === 0 || maxFriends === 0) {
      return [npc.id]
    }

    const targetFriendCount = Math.min(
      friendIds.length,
      maxFriends,
      Math.max(this.config.socialGroupMinFriends, this.random.int(maxFriends + 1))
    )
    const participants = [npc.id]
    const startIndex = this.random.int(friendIds.length)

    for (let offset = 0; offset < friendIds.length && participants.length <= targetFriendCount; offset += 1) {
      const friendId = friendIds[(startIndex + offset) % friendIds.length]
      const friend = this.npcs[friendId]

      if (this.canInviteFriendToSocialTrip(npc, friend, timeOfDayHours)) {
        participants.push(friend.id)
      }
    }

    return participants
  }

  canInviteFriendToSocialTrip(npc, friend, timeOfDayHours) {
    if (!friend ||
        friend === npc ||
        friend.manualControl ||
        friend.vehicleTrip ||
        friend.waitingForCar ||
        friend.activeDesire ||
        !friend.desires) {
      return false
    }

    const scheduledElement = friend.getActiveTimetableElement(timeOfDayHours)

    return this.canUseDesireDestination(friend, scheduledElement) &&
      this.needScores[DESIRE_INDEX.social][friend.id] <= this.config.socialInviteThreshold
  }

  canUseNightclub(npc, timeOfDayHours) {
    return Boolean(
      isAdultAge(npc.age) &&
      !this.homesWithMinors.has(npc.home) &&
      hourInRange(normalizeHour(timeOfDayHours), NIGHTCLUB_DESIRE_START_HOUR, NIGHTCLUB_DESIRE_END_HOUR)
    )
  }

  takeNearbyBuilding(purpose, originBuilding) {
    const buildings = this.buildingsByPurpose[purpose]

    if (!buildings || buildings.length === 0) {
      return null
    }

    const candidates = originBuilding?.id
      ? this.cityData.nearestBuildingsByPurpose[purpose]?.get(originBuilding.id)
      : buildings

    if (!candidates || candidates.length === 0) {
      return null
    }

    const candidateCount = Math.min(candidates.length, this.config.destinationCandidateCount)

    return candidates[this.random.int(Math.min(candidateCount, candidates.length))]
  }

  startCooldown(npc, need) {
    const needIndex = Number.isInteger(need) ? need : DESIRE_INDEX[need]

    if (Number.isInteger(needIndex)) {
      this.cooldowns[needIndex][npc.id] = this.getElapsedSimulationSeconds() + this.config.tripCooldownHours * SECONDS_PER_HOUR
    }
  }

  clearActiveDesire(npc) {
    npc.activeDesire = null
  }

  clearSocialGroupDesire(activeDesire, startCooldown = false) {
    const participantIds = activeDesire?.participantIds || []

    for (const participantId of participantIds) {
      const participant = this.npcs[participantId]

      if (!participant?.activeDesire ||
          participant.activeDesire.socialGroupId !== activeDesire.socialGroupId) {
        continue
      }

      if (startCooldown) {
        this.startCooldown(participant, participant.activeDesire.needIndex)
      }

      this.clearActiveDesire(participant)
    }
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

  decayNeeds(index, deltaHours) {
    for (let needIndex = 0; needIndex < DESIRE_COUNT; needIndex += 1) {
      const scores = this.needScores[needIndex]

      scores[index] = clampNeedScore(scores[index] - this.decayPerHour[needIndex] * deltaHours)
    }
  }

  satisfyNeeds(npc, index, deltaHours) {
    const locationState = npc.locationState

    if (!locationState?.buildingId) {
      return
    }

    const rates = this.satisfactionRatesForLocation(npc, locationState)

    if (rates === DESIRE_ZERO_RATES) {
      return
    }

    for (let needIndex = 0; needIndex < DESIRE_COUNT; needIndex += 1) {
      const rate = rates[needIndex]

      if (rate > 0) {
        const scores = this.needScores[needIndex]

        scores[index] = clampNeedScore(scores[index] + rate * deltaHours)
      }
    }
  }

  satisfactionRatesForLocation(npc, locationState) {
    if (
      locationState.desireBuildingId === locationState.buildingId &&
      locationState.desireHomeId === npc.home &&
      locationState.desireSatisfactionRates
    ) {
      return locationState.desireSatisfactionRates
    }

    const baseRates = this.baseSatisfactionByBuildingId.get(locationState.buildingId) || DESIRE_ZERO_RATES
    const rates = locationState.buildingId === npc.home
      ? addNeedRateArrays(baseRates, this.homeSatisfactionRates)
      : baseRates

    locationState.desireBuildingId = locationState.buildingId
    locationState.desireHomeId = npc.home
    locationState.desireSatisfactionRates = rates

    return rates
  }
}

class NpcInfectionDynamics {
  constructor(npcs, city, config, random, clock) {
    this.npcs = npcs
    this.city = city
    this.random = random
    this.clock = clock
    this.eventRecorder = config.eventRecorder || null
    this.infectionDistance = nonNegativeNumberOrDefault(config.infectionDistance, INFECTION_CONFIG.infectionDistance)
    this.baseInfectionProbability = clampUnitInterval(config.infectionProbability ?? INFECTION_CONFIG.infectionProbability)
    this.policyInfectionProbabilityMultiplier = 1
    this.infectionProbability = this.baseInfectionProbability
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
    this.participantGridStamp = -1
    this.participantIndexes = new Int32Array(npcs.length)
    this.participantCount = 0
    this.numericContactPairKeys = npcs.length < CONTACT_PAIR_KEY_BASE
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

    this.seedInitialInoculations(config.inoculatedPercent)
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
    this.eventRecorder?.closeInactiveContacts?.(this.getElapsedSimulationSeconds())
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

  setPolicyInfectionProbabilityMultiplier(multiplier) {
    const value = Number(multiplier)

    this.policyInfectionProbabilityMultiplier = Number.isFinite(value)
      ? Math.min(Math.max(value, 0), 1)
      : 1
    this.infectionProbability = clampUnitInterval(
      this.baseInfectionProbability * this.policyInfectionProbabilityMultiplier
    )
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

  setNpcState(npcOrIndex, infection, timerSeconds = null, options = {}) {
    const index = typeof npcOrIndex === 'number' ? npcOrIndex : npcOrIndex?.id
    const state = INFECTION_STATE_IDS[infection]

    if (!Number.isInteger(index) || index < 0 || index >= this.npcs.length) {
      throw new Error('NPC infection index is out of bounds.')
    }

    if (!Number.isInteger(state)) {
      throw new Error(`Unknown NPC infection state "${infection}".`)
    }

    this.setStateByIndex(index, state, timerSeconds ?? this.getDefaultTimerSeconds(state), options)
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
    const distance = Math.hypot(dx, dy)
    const event = {
      id: this.nextTransmissionEventId,
      simulationSeconds: this.getElapsedSimulationSeconds(),
      sourceNpcId: sourceNpc.id,
      targetNpcId: targetNpc.id,
      sourcePosition: clonePosition(sourceNpc.position),
      targetPosition: clonePosition(targetNpc.position),
      sourceTile: cloneTile(sourceNpc.tile),
      targetTile: cloneTile(targetNpc.tile),
      distance,
      targetState: 'exposed'
    }

    this.nextTransmissionEventId += 1
    this.transmissionEvents.push(event)
    event.exportedEventId = this.eventRecorder?.recordInfection?.({
      sourceNpc,
      targetNpc,
      distanceWorldUnits: distance,
      at: event.simulationSeconds
    }) || null

    if (this.transmissionEvents.length > MAX_TRANSMISSION_EVENTS) {
      this.transmissionEvents.splice(0, this.transmissionEvents.length - MAX_TRANSMISSION_EVENTS)
    }

    return event
  }

  recordContactEvent(sourceNpc, targetNpc, dx, dy, simulationSeconds = this.getElapsedSimulationSeconds()) {
    const distanceSquared = dx * dx + dy * dy

    if (!this.contactTracingEnabled) {
      if (typeof this.eventRecorder?.recordOrderedContactObservationSquared === 'function') {
        const sourceId = sourceNpc.id
        const targetId = targetNpc.id
        const firstNpcId = sourceId <= targetId ? sourceId : targetId
        const secondNpcId = sourceId <= targetId ? targetId : sourceId
        const pairKey = this.numericContactPairKeys
          ? firstNpcId * CONTACT_PAIR_KEY_BASE + secondNpcId
          : `${firstNpcId}:${secondNpcId}`

        this.eventRecorder.recordOrderedContactObservationSquared(
          sourceNpc,
          targetNpc,
          firstNpcId,
          secondNpcId,
          pairKey,
          distanceSquared,
          simulationSeconds
        )
      } else if (typeof this.eventRecorder?.recordContactObservationSquared === 'function') {
        this.eventRecorder.recordContactObservationSquared(sourceNpc, targetNpc, distanceSquared, simulationSeconds)
      } else {
        this.eventRecorder?.recordContactObservation?.(sourceNpc, targetNpc, Math.sqrt(distanceSquared), simulationSeconds)
      }
      return
    }

    const distance = Math.sqrt(distanceSquared)

    const pairKey = contactPairKey(sourceNpc.id, targetNpc.id)
    const existing = this.contactEventsByPair.get(pairKey)
    const event = existing || {
      id: this.nextContactEventId,
      sourceNpcId: Math.min(sourceNpc.id, targetNpc.id),
      targetNpcId: Math.max(sourceNpc.id, targetNpc.id)
    }
    const source = sourceNpc.id === event.sourceNpcId ? sourceNpc : targetNpc
    const target = targetNpc.id === event.targetNpcId ? targetNpc : sourceNpc

    event.simulationSeconds = simulationSeconds
    event.sourcePosition = clonePosition(source.position)
    event.targetPosition = clonePosition(target.position)
    event.sourceTile = cloneTile(source.tile)
    event.targetTile = cloneTile(target.tile)
    event.distance = distance
    this.eventRecorder?.recordContactObservation?.(source, target, event.distance, event.simulationSeconds)

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
    const indexes = new Int32Array(this.npcs.length)
    let susceptibleCount = 0

    for (let index = 0; index < indexes.length; index += 1) {
      if (this.states[index] === INFECTION_STATE_IDS.susceptible) {
        indexes[susceptibleCount] = index
        susceptibleCount += 1
      }
    }

    const count = clampInteger(
      initialInfectiousCount ?? INFECTION_CONFIG.initialInfectiousCount,
      0,
      susceptibleCount
    )

    if (count === 0) {
      return
    }

    for (let index = 0; index < count; index += 1) {
      const selectedIndex = index + this.random.int(susceptibleCount - index)
      const npcIndex = indexes[selectedIndex]

      indexes[selectedIndex] = indexes[index]
      indexes[index] = npcIndex
      this.setStateByIndex(npcIndex, INFECTION_STATE_IDS.infectious, this.infectionSeconds, { emit: false })
    }
  }

  seedInitialInoculations(inoculatedPercent) {
    const percent = clampPercent(inoculatedPercent ?? INFECTION_CONFIG.inoculatedPercent)
    const count = clampInteger((this.npcs.length * percent) / 100, 0, this.npcs.length)

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
      this.setStateByIndex(npcIndex, INFECTION_STATE_IDS.recovered, this.immunitySeconds, { emit: false })
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

    const useParticipantGrid = this.participantGridStamp === this.gridStamp

    if (!useParticipantGrid) {
      this.indexInfectiousNpcs()
    }

    const infectionDistanceSquared = this.infectionDistance * this.infectionDistance

    const candidateCount = useParticipantGrid ? this.participantCount : this.npcs.length

    susceptibleLoop:
    for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex += 1) {
      const index = useParticipantGrid ? this.participantIndexes[candidateIndex] : candidateIndex

      if (this.states[index] !== INFECTION_STATE_IDS.susceptible) {
        continue
      }

      const npc = this.npcs[index]

      if (!useParticipantGrid && !canParticipateInInfection(npc)) {
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
            if (useParticipantGrid && this.states[infectiousIndex] !== INFECTION_STATE_IDS.infectious) {
              continue
            }

            const infectiousNpc = this.npcs[infectiousIndex]
            const dx = infectiousNpc.position.x - npc.position.x
            const dy = infectiousNpc.position.y - npc.position.y

            if (dx * dx + dy * dy > infectionDistanceSquared) {
              continue
            }

            if (this.random.next() < transmissionProbability) {
              this.recordTransmissionEvent(infectiousNpc, npc, dx, dy)
              this.setStateByIndex(index, INFECTION_STATE_IDS.exposed, this.incubationSeconds, { emit: false })
              continue susceptibleLoop
            }
          }
        }
      }
    }
  }

  recordRecentContacts() {
    if ((!this.contactTracingEnabled && !this.eventRecorder) || this.infectionDistance <= 0) {
      return
    }

    this.gridStamp += 1

    if (this.gridStamp === 0) {
      this.gridStamps.fill(0)
      this.gridStamp = 1
    }

    const infectionDistanceSquared = this.infectionDistance * this.infectionDistance
    const simulationSeconds = this.getElapsedSimulationSeconds()
    const useFastEventRecorder = !this.contactTracingEnabled &&
      typeof this.eventRecorder?.recordOrderedContactObservationSquared === 'function'
    const eventRecorder = this.eventRecorder
    const numericContactPairKeys = this.numericContactPairKeys

    this.participantCount = 0

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

            const distanceSquared = dx * dx + dy * dy

            if (distanceSquared <= infectionDistanceSquared) {
              if (useFastEventRecorder) {
                const pairKey = numericContactPairKeys
                  ? otherIndex * CONTACT_PAIR_KEY_BASE + index
                  : `${otherIndex}:${index}`

                eventRecorder.recordOrderedContactObservationSquared(
                  otherNpc,
                  npc,
                  otherIndex,
                  index,
                  pairKey,
                  distanceSquared,
                  simulationSeconds
                )
              } else {
                this.recordContactEvent(otherNpc, npc, dx, dy, simulationSeconds)
              }
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
      this.participantIndexes[this.participantCount] = index
      this.participantCount += 1
    }

    this.participantGridStamp = this.gridStamp
  }

  indexInfectiousNpcs() {
    this.gridStamp += 1
    this.participantGridStamp = -1

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

  setStateByIndex(index, state, timerSeconds, options = {}) {
    const previousState = this.states[index]

    if (previousState !== state) {
      this.counts[previousState] -= 1
      this.counts[state] += 1
      this.states[index] = state
      this.recordStateTransitionEvent(index, previousState, state, options)
    }

    this.timers[index] = timerSeconds
    this.npcs[index].infection = INFECTION_STATE_NAMES[state]
  }

  recordStateTransitionEvent(index, previousState, state, options) {
    if (!this.eventRecorder || options.emit === false) {
      return
    }

    const npc = this.npcs[index]
    const at = this.getElapsedSimulationSeconds()

    if (previousState === INFECTION_STATE_IDS.exposed && state === INFECTION_STATE_IDS.infectious) {
      this.eventRecorder.recordIncubation(npc, at)
      return
    }

    if (previousState === INFECTION_STATE_IDS.infectious && state === INFECTION_STATE_IDS.recovered) {
      this.eventRecorder.recordRecovery(npc, at)
      return
    }

    if (previousState === INFECTION_STATE_IDS.recovered && state === INFECTION_STATE_IDS.susceptible) {
      this.eventRecorder.recordImmunityWaned(npc, at)
    }
  }
}

function collectBuildingsByPurpose(city) {
  const buildingsByPurpose = {
    home: [],
    mall: [],
    nightclub: [],
    restaurant: [],
    school: [],
    shopping: [],
    supermarket: [],
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

    if (buildingHasAnyType(building, RESTAURANT_BUILDING_TYPES)) {
      buildingsByPurpose.restaurant.push(building)
    }

    if (buildingHasAnyType(building, SHOPPING_BUILDING_TYPES)) {
      buildingsByPurpose.shopping.push(building)
    }

    if (buildingHasAnyType(building, ['mall'])) {
      buildingsByPurpose.mall.push(building)
    }

    if (buildingHasAnyType(building, ['supermarket'])) {
      buildingsByPurpose.supermarket.push(building)
    }

    if (buildingHasAnyType(building, NIGHTCLUB_BUILDING_TYPES)) {
      buildingsByPurpose.nightclub.push(building)
    }
  }

  return buildingsByPurpose
}

function getDesireCityData(city) {
  const signature = cityBuildingSignature(city)
  const cached = desireCityDataCache.get(city)

  if (cached && cached.signature === signature) {
    return cached
  }

  const buildings = city.buildings || []
  const buildingsByPurpose = collectBuildingsByPurpose(city)
  const data = {
    signature,
    buildingsByPurpose,
    buildingsById: new Map(buildings.map((building) => [building.id, building])),
    nearestBuildingsByPurpose: {
      mall: precomputeNearestBuildings(city, buildings, buildingsByPurpose.mall),
      nightclub: precomputeNearestBuildings(city, buildings, buildingsByPurpose.nightclub),
      restaurant: precomputeNearestBuildings(city, buildings, buildingsByPurpose.restaurant),
      supermarket: precomputeNearestBuildings(city, buildings, buildingsByPurpose.supermarket)
    }
  }

  desireCityDataCache.set(city, data)
  return data
}

function cityBuildingSignature(city) {
  const buildings = city.buildings || []
  const parts = [String(buildings.length)]

  for (const building of buildings) {
    const entrance = building.entrance ? `${building.entrance.x},${building.entrance.y}` : 'none'
    const types = Array.isArray(building.types) ? building.types.join(',') : ''

    parts.push(`${building.id}:${entrance}:${types}`)
  }

  return parts.join('|')
}

function precomputeNearestBuildings(city, origins, targets) {
  const byOriginId = new Map()

  if (!targets || targets.length === 0) {
    return byOriginId
  }

  for (const origin of origins) {
    if (!origin?.id || !origin.entrance) {
      continue
    }

    byOriginId.set(origin.id, targets.filter((building) => buildingReachableFromBuilding(city, origin, building)).sort(
      (a, b) => squaredEntranceDistance(origin, a) - squaredEntranceDistance(origin, b) ||
        String(a.id).localeCompare(String(b.id))
    ))
  }

  return byOriginId
}

function collectHomesWithMinors(npcs) {
  const homes = new Set()

  for (const npc of npcs) {
    if (npc.home && Number.isInteger(npc.age) && npc.age < ADULT_MIN_AGE) {
      homes.add(npc.home)
    }
  }

  return homes
}

function createNpcSocialGraph(npcs, random, options = {}) {
  const config = normalizeSocialGraphConfig(options)
  const friendSets = Array.from({ length: npcs.length }, () => new Set())
  const buckets = createSocialGraphBuckets(npcs, config)

  for (const npc of npcs) {
    const targetFriends = Math.min(
      Math.max(0, npcs.length - 1),
      config.minFriends + random.int(config.maxFriends - config.minFriends + 1)
    )
    let attempts = Math.max(1, targetFriends * config.candidateAttemptsPerFriend)

    while (friendSets[npc.id].size < targetFriends && attempts > 0) {
      attempts -= 1
      const candidate = chooseSocialGraphCandidate(npc, buckets, npcs, config, random)

      addFriendship(friendSets, npc.id, candidate?.id, config.maxFriends)
    }
  }

  const friendIdsByNpc = friendSets.map((friends, npcId) => {
    const ids = Object.freeze([...friends].sort((a, b) => a - b))

    npcs[npcId].friendIds = ids
    return ids
  })

  return Object.freeze({
    friendIdsByNpc: Object.freeze(friendIdsByNpc),
    getFriendIds(npcOrIndex) {
      const index = typeof npcOrIndex === 'number' ? npcOrIndex : npcOrIndex?.id

      return Number.isInteger(index) && index >= 0 && index < friendIdsByNpc.length
        ? friendIdsByNpc[index]
        : []
    }
  })
}

function createSocialGraphBuckets(npcs, config) {
  const home = new Map()
  const activity = new Map()
  const age = new Map()

  for (const npc of npcs) {
    appendSocialBucket(home, npc.home, npc)
    appendSocialBucket(activity, socialActivityKey(npc), npc)
    appendSocialBucket(age, socialAgeBucket(npc.age, config), npc)
  }

  return { home, activity, age }
}

function appendSocialBucket(buckets, key, npc) {
  if (key === null || key === undefined) {
    return
  }

  let bucket = buckets.get(key)

  if (!bucket) {
    bucket = []
    buckets.set(key, bucket)
  }

  bucket.push(npc)
}

function chooseSocialGraphCandidate(npc, buckets, npcs, config, random) {
  const weightedBuckets = []

  appendWeightedSocialBucket(weightedBuckets, buckets.home.get(npc.home), config.sameHomeWeight)
  appendWeightedSocialBucket(weightedBuckets, buckets.activity.get(socialActivityKey(npc)), config.sameWorkOrSchoolWeight)
  appendWeightedSocialBucket(weightedBuckets, buckets.age.get(socialAgeBucket(npc.age, config)), config.agePeerWeight)
  appendWeightedSocialBucket(weightedBuckets, npcs, config.randomWeight)

  const bucket = weightedSocialBucket(weightedBuckets, random)

  return bucket ? bucket[random.int(bucket.length)] : null
}

function appendWeightedSocialBucket(weightedBuckets, bucket, weight) {
  if (bucket && bucket.length > 1 && Number.isFinite(weight) && weight > 0) {
    weightedBuckets.push({ bucket, weight })
  }
}

function weightedSocialBucket(weightedBuckets, random) {
  let totalWeight = 0

  for (const bucket of weightedBuckets) {
    totalWeight += bucket.weight
  }

  if (totalWeight <= 0) {
    return null
  }

  let threshold = random.next() * totalWeight

  for (const weightedBucket of weightedBuckets) {
    threshold -= weightedBucket.weight

    if (threshold <= 0) {
      return weightedBucket.bucket
    }
  }

  return weightedBuckets[weightedBuckets.length - 1].bucket
}

function addFriendship(friendSets, firstId, secondId, maxFriends) {
  if (!Number.isInteger(firstId) ||
      !Number.isInteger(secondId) ||
      firstId === secondId ||
      firstId < 0 ||
      secondId < 0 ||
      firstId >= friendSets.length ||
      secondId >= friendSets.length ||
      friendSets[firstId].has(secondId) ||
      friendSets[firstId].size >= maxFriends ||
      friendSets[secondId].size >= maxFriends) {
    return false
  }

  friendSets[firstId].add(secondId)
  friendSets[secondId].add(firstId)
  return true
}

function socialActivityKey(npc) {
  if (npc.school) {
    return `school:${npc.school}`
  }

  if (npc.work) {
    return `work:${npc.work}`
  }

  return null
}

function socialAgeBucket(age, config) {
  if (!Number.isInteger(age)) {
    return null
  }

  return Math.floor(age / config.ageBucketYears)
}

function normalizeSocialGraphConfig(options = {}) {
  const source = options || {}
  const maxFriends = positiveIntegerOrDefault(source.maxFriends, DEFAULT_SOCIAL_GRAPH_CONFIG.maxFriends)
  const minFriends = Math.min(
    maxFriends,
    nonNegativeIntegerOrDefault(source.minFriends, DEFAULT_SOCIAL_GRAPH_CONFIG.minFriends)
  )

  return {
    minFriends,
    maxFriends,
    candidateAttemptsPerFriend: positiveIntegerOrDefault(
      source.candidateAttemptsPerFriend,
      DEFAULT_SOCIAL_GRAPH_CONFIG.candidateAttemptsPerFriend
    ),
    ageBucketYears: positiveIntegerOrDefault(source.ageBucketYears, DEFAULT_SOCIAL_GRAPH_CONFIG.ageBucketYears),
    sameHomeWeight: nonNegativeNumberOrDefault(source.sameHomeWeight, DEFAULT_SOCIAL_GRAPH_CONFIG.sameHomeWeight),
    sameWorkOrSchoolWeight: nonNegativeNumberOrDefault(source.sameWorkOrSchoolWeight, DEFAULT_SOCIAL_GRAPH_CONFIG.sameWorkOrSchoolWeight),
    agePeerWeight: nonNegativeNumberOrDefault(source.agePeerWeight, DEFAULT_SOCIAL_GRAPH_CONFIG.agePeerWeight),
    randomWeight: nonNegativeNumberOrDefault(source.randomWeight, DEFAULT_SOCIAL_GRAPH_CONFIG.randomWeight)
  }
}

function cloneSocialActiveDesire(activeDesire, socialGroupId, organizerNpcId, participantIds) {
  return {
    ...activeDesire,
    element: cloneTimetableElement(activeDesire.element),
    socialGroupId,
    organizerNpcId,
    participantIds: Object.freeze([...participantIds])
  }
}

function cloneTimetableElement(element) {
  return element
    ? {
        ...element,
        location: element.location ? { ...element.location } : element.location
      }
    : element
}

function getPolicyEventActionForElement(city, element) {
  if (!element) {
    return null
  }

  if (element.id === 'work') {
    return 'homeOffice'
  }

  if (element.id === 'school') {
    return 'closeSchools'
  }

  if (element.id === 'shopping') {
    return 'reduceShopping'
  }

  if (element.id === 'nightclub') {
    return 'reduceNightlife'
  }

  const building = getPolicyElementBuilding(city, element)

  if (buildingHasAnyType(building, NIGHTCLUB_BUILDING_TYPES)) {
    return 'reduceNightlife'
  }

  if (buildingHasAnyType(building, SHOPPING_BUILDING_TYPES)) {
    return 'reduceShopping'
  }

  return null
}

function getPolicyElementBuilding(city, element) {
  if (element?.location && typeof city.getBuilding === 'function') {
    const building = city.getBuilding(element.location.x, element.location.y)

    if (building) {
      return building
    }
  }

  return (city.buildings || []).find((building) => building.id === element?.buildingId) || null
}

function getNpcHomeTimetableElement(npc) {
  return npc?.timetable?.elements?.find((element) => element.id === 'home') || null
}

function createNpcPolicyDecisionKey(npc, element, eventAction, probability, clock) {
  const dayIndex = clock && typeof clock.getDayIndex === 'function'
    ? clock.getDayIndex()
    : 0

  return [
    eventAction,
    formatPolicyProbabilityKey(probability),
    dayIndex,
    npc?.id ?? -1,
    element?.id || '',
    element?.buildingId || ''
  ].join(':')
}

function formatPolicyProbabilityKey(probability) {
  return Number(normalizePolicyProbability(probability).toFixed(4)).toString()
}

function normalizeNpcPolicyEffects(effects) {
  return {
    infectionProbabilityMultiplier: normalizePolicyProbability(effects?.infectionProbabilityMultiplier ?? 1),
    socialDistancingEnabled: Boolean(effects?.socialDistancingEnabled),
    eventCancellationProbabilities: {
      closeSchools: normalizePolicyProbability(effects?.eventCancellationProbabilities?.closeSchools),
      homeOffice: normalizePolicyProbability(effects?.eventCancellationProbabilities?.homeOffice),
      reduceShopping: normalizePolicyProbability(effects?.eventCancellationProbabilities?.reduceShopping),
      reduceNightlife: normalizePolicyProbability(effects?.eventCancellationProbabilities?.reduceNightlife)
    }
  }
}

function hasNpcPolicyEventCancellations(effects) {
  const cancellations = effects?.eventCancellationProbabilities

  return Boolean(
    cancellations &&
    (
      cancellations.closeSchools > 0 ||
      cancellations.homeOffice > 0 ||
      cancellations.reduceShopping > 0 ||
      cancellations.reduceNightlife > 0
    )
  )
}

function getNpcPolicyEffectsKey(effects) {
  return [
    formatPolicyProbabilityKey(effects.infectionProbabilityMultiplier),
    effects.socialDistancingEnabled ? '1' : '0',
    formatPolicyProbabilityKey(effects.eventCancellationProbabilities.closeSchools),
    formatPolicyProbabilityKey(effects.eventCancellationProbabilities.homeOffice),
    formatPolicyProbabilityKey(effects.eventCancellationProbabilities.reduceShopping),
    formatPolicyProbabilityKey(effects.eventCancellationProbabilities.reduceNightlife)
  ].join(':')
}

function normalizeDesireConfig(overrides = {}) {
  const fallback = NPC_CONFIG.desires
  const config = overrides || {}
  const initialMin = clampNeedScore(config.initialMin ?? fallback.initialMin)
  const initialMax = clampNeedScore(config.initialMax ?? fallback.initialMax)
  const socialGroupMaxFriends = positiveIntegerOrDefault(
    config.socialGroupMaxFriends,
    fallback.socialGroupMaxFriends ?? DEFAULT_SOCIAL_GROUP_MAX_FRIENDS
  )
  const socialGroupMinFriends = Math.min(
    socialGroupMaxFriends,
    nonNegativeIntegerOrDefault(
      config.socialGroupMinFriends,
      fallback.socialGroupMinFriends ?? DEFAULT_SOCIAL_GROUP_MIN_FRIENDS
    )
  )

  return {
    initialMin: Math.min(initialMin, initialMax),
    initialMax: Math.max(initialMin, initialMax),
    lowThreshold: clampNeedScore(config.lowThreshold ?? fallback.lowThreshold),
    urgentThreshold: clampNeedScore(config.urgentThreshold ?? fallback.urgentThreshold),
    satisfiedThreshold: clampNeedScore(config.satisfiedThreshold ?? fallback.satisfiedThreshold),
    tripCooldownHours: nonNegativeNumberOrDefault(config.tripCooldownHours, fallback.tripCooldownHours),
    destinationCandidateCount: positiveIntegerOrDefault(
      config.destinationCandidateCount,
      fallback.destinationCandidateCount
    ),
    socialGroupMinFriends,
    socialGroupMaxFriends,
    socialInviteThreshold: clampNeedScore(config.socialInviteThreshold ?? fallback.socialInviteThreshold ?? fallback.lowThreshold),
    decayPerHour: normalizeNeedRates(config.decayPerHour, fallback.decayPerHour),
    satisfactionPerHour: {
      home: normalizeNeedRates(config.satisfactionPerHour?.home, fallback.satisfactionPerHour.home),
      restaurant: normalizeNeedRates(config.satisfactionPerHour?.restaurant, fallback.satisfactionPerHour.restaurant),
      supermarket: normalizeNeedRates(config.satisfactionPerHour?.supermarket, fallback.satisfactionPerHour.supermarket),
      mall: normalizeNeedRates(config.satisfactionPerHour?.mall, fallback.satisfactionPerHour.mall),
      nightclub: normalizeNeedRates(config.satisfactionPerHour?.nightclub, fallback.satisfactionPerHour.nightclub)
    }
  }
}

function normalizeNeedRates(overrides = {}, fallback = {}) {
  const rates = {}
  const source = overrides || {}

  for (const need of DESIRE_NAMES) {
    rates[need] = nonNegativeNumberOrDefault(source[need], fallback[need] ?? 0)
  }

  return rates
}

function needRatesToArray(rates) {
  const values = new Float64Array(DESIRE_COUNT)

  for (const need of DESIRE_NAMES) {
    values[DESIRE_INDEX[need]] = nonNegativeNumberOrDefault(rates?.[need], 0)
  }

  return values
}

function addNeedRateArrays(first, second) {
  if (first === DESIRE_ZERO_RATES && second === DESIRE_ZERO_RATES) {
    return DESIRE_ZERO_RATES
  }

  const values = new Float64Array(DESIRE_COUNT)
  let hasRates = false

  for (let index = 0; index < DESIRE_COUNT; index += 1) {
    const value = first[index] + second[index]

    values[index] = value
    hasRates ||= value > 0
  }

  return hasRates ? values : DESIRE_ZERO_RATES
}

function buildBaseDesireSatisfactionByBuildingId(buildings, restaurantRates, supermarketRates, mallRates, nightclubRates) {
  const byBuildingId = new Map()

  for (const building of buildings) {
    let rates = DESIRE_ZERO_RATES

    if (buildingHasAnyType(building, RESTAURANT_BUILDING_TYPES)) {
      rates = addNeedRateArrays(rates, restaurantRates)
    }

    if (buildingHasAnyType(building, ['supermarket'])) {
      rates = addNeedRateArrays(rates, supermarketRates)
    }

    if (buildingHasAnyType(building, ['mall'])) {
      rates = addNeedRateArrays(rates, mallRates)
    }

    if (buildingHasAnyType(building, NIGHTCLUB_BUILDING_TYPES)) {
      rates = addNeedRateArrays(rates, nightclubRates)
    }

    if (rates !== DESIRE_ZERO_RATES) {
      byBuildingId.set(building.id, rates)
    }
  }

  return byBuildingId
}

function createNpcDesireView(needScores, npcIndex) {
  const view = {}

  for (const need of DESIRE_NAMES) {
    const needIndex = DESIRE_INDEX[need]

    Object.defineProperty(view, need, {
      enumerable: true,
      get() {
        return needScores[needIndex][npcIndex]
      },
      set(value) {
        needScores[needIndex][npcIndex] = clampNeedScore(value)
      }
    })
  }

  return view
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

function createNpcFamilyProfiles(city, buildingsByPurpose, random, count, config) {
  const profiles = []
  const targetCount = nonNegativeIntegerOrDefault(count, NPC_CONFIG.count)

  while (profiles.length < targetCount) {
    const remaining = targetCount - profiles.length
    const home = takeRandomItem(buildingsByPurpose.home, random)
    const familySize = chooseFamilySize(remaining, random, config)
    const ages = createFamilyAges(familySize, random)
    const familyHasChildren = familySize > 2

    for (const age of ages) {
      profiles.push({
        age,
        buildingAssignment: createNpcBuildingAssignmentForAge(city, buildingsByPurpose, home, age, !familyHasChildren, random, config)
      })
    }
  }

  return profiles
}

function createNpcBuildingAssignmentForAge(city, buildingsByPurpose, home, age, adultWithoutChildren, random, config) {
  const work = isAdultAge(age) ? takeRandomReachableBuilding(city, buildingsByPurpose.work, home, random) : null

  return {
    home,
    school: isSchoolAge(age) ? takeRandomReachableBuilding(city, buildingsByPurpose.school, home, random) : null,
    work,
    lunch: work ? takeNearbyBuilding(city, buildingsByPurpose.restaurant, work, random, config) : null,
    shopping: work && random.next() < unitIntervalOrDefault(config.shoppingChance, NPC_CONFIG.shoppingChance)
      ? takeRandomReachableBuilding(city, buildingsByPurpose.shopping, work, random)
      : null,
    nightclub: work && adultWithoutChildren && random.next() < unitIntervalOrDefault(config.nightclubChance, NPC_CONFIG.nightclubChance)
      ? takeRandomReachableBuilding(city, buildingsByPurpose.nightclub, work, random)
      : null
  }
}

function takeRandomReachableBuilding(city, buildings, originBuilding, random) {
  if (!buildings || buildings.length === 0) {
    return null
  }

  if (!originBuilding?.entrance || typeof city?.arePedestrianConnectedByIndex !== 'function') {
    return takeRandomItem(buildings, random)
  }

  const originIndex = city.index(originBuilding.entrance.x, originBuilding.entrance.y)
  const candidates = []

  for (const building of buildings) {
    if (buildingReachableFromIndex(city, originIndex, building)) {
      candidates.push(building)
    }
  }

  return takeRandomItem(candidates, random)
}

function takeNearbyBuilding(city, buildings, originBuilding, random, config) {
  if (!buildings || buildings.length === 0 || !originBuilding?.entrance) {
    return null
  }

  const candidateCount = Math.min(
    buildings.length,
    positiveIntegerOrDefault(config.lunchRestaurantCandidateCount, NPC_CONFIG.lunchRestaurantCandidateCount)
  )
  const nearby = buildings
    .filter((building) => buildingReachableFromBuilding(city, originBuilding, building))
    .map((building) => ({
      building,
      distance: squaredEntranceDistance(originBuilding, building)
    }))
    .sort((a, b) => a.distance - b.distance || String(a.building.id).localeCompare(String(b.building.id)))

  if (nearby.length === 0) {
    return null
  }

  return nearby[random.int(Math.min(candidateCount, nearby.length))].building
}

function buildingReachableFromBuilding(city, originBuilding, building) {
  if (!originBuilding?.entrance) {
    return true
  }

  const originIndex = city?.index(originBuilding.entrance.x, originBuilding.entrance.y)

  return buildingReachableFromIndex(city, originIndex, building)
}

function buildingReachableFromIndex(city, originIndex, building) {
  if (!building?.entrance || typeof city?.arePedestrianConnectedByIndex !== 'function') {
    return true
  }

  const targetIndex = city.index(building.entrance.x, building.entrance.y)

  return city.arePedestrianConnectedByIndex(originIndex, targetIndex)
}

function squaredEntranceDistance(first, second) {
  if (!first?.entrance || !second?.entrance) {
    return Infinity
  }

  const dx = first.entrance.x - second.entrance.x
  const dy = first.entrance.y - second.entrance.y

  return dx * dx + dy * dy
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

function isDesireElementId(id) {
  return typeof id === 'string' && id.startsWith('desire:')
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
    return createAdultTimetable(city, buildingAssignment, random, config)
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

  const { startHour, endHour } = createWorkHours(random, config)

  return new NpcTimetable([
    createTimetableElement(destinationId, destination, startHour, endHour, city),
    createTimetableElement('home', home, 0, 0, city)
  ])
}

function createAdultTimetable(city, buildingAssignment, random, config) {
  const { home, work } = buildingAssignment
  const { startHour, endHour } = createWorkHours(random, config)
  const elements = []

  if (buildingAssignment.lunch) {
    const lunchHours = createLunchHours(random, config)

    if (lunchHours) {
      elements.push(createTimetableElement('lunch', buildingAssignment.lunch, lunchHours.startHour, lunchHours.endHour, city))
    }
  }

  if (buildingAssignment.shopping) {
    elements.push(createTimetableElement(
      'shopping',
      buildingAssignment.shopping,
      endHour,
      normalizeHour(endHour + positiveNumberOrDefault(config.shoppingDurationHours, NPC_CONFIG.shoppingDurationHours)),
      city
    ))
  }

  if (buildingAssignment.nightclub) {
    const nightclubStartHour = random.between(
      finiteNumberOrDefault(config.nightclubStartHour, NPC_CONFIG.nightclubStartHour),
      finiteNumberOrDefault(config.nightclubLatestStartHour, NPC_CONFIG.nightclubLatestStartHour)
    )

    elements.push(createTimetableElement(
      'nightclub',
      buildingAssignment.nightclub,
      normalizeHour(nightclubStartHour),
      normalizeHour(nightclubStartHour + positiveNumberOrDefault(config.nightclubDurationHours, NPC_CONFIG.nightclubDurationHours)),
      city
    ))
  }

  elements.push(createTimetableElement('work', work, startHour, endHour, city))
  elements.push(createTimetableElement('home', home, 0, 0, city))

  return new NpcTimetable(elements)
}

function createWorkHours(random, config) {
  const variationHours = finiteNumberOrDefault(config.scheduleVariationHours, NPC_CONFIG.scheduleVariationHours)

  return {
    startHour: normalizeHour(
      finiteNumberOrDefault(config.workStartHour, NPC_CONFIG.workStartHour) + random.between(-variationHours, variationHours)
    ),
    endHour: normalizeHour(
      finiteNumberOrDefault(config.workEndHour, NPC_CONFIG.workEndHour) + random.between(-variationHours, variationHours)
    )
  }
}

function createLunchHours(random, config) {
  const lunchStartHour = finiteNumberOrDefault(config.lunchStartHour, NPC_CONFIG.lunchStartHour)
  const lunchEndHour = finiteNumberOrDefault(config.lunchEndHour, NPC_CONFIG.lunchEndHour)
  const lunchDurationHours = positiveNumberOrDefault(config.lunchDurationHours, NPC_CONFIG.lunchDurationHours)
  const latestStartHour = lunchEndHour - lunchDurationHours

  if (latestStartHour < lunchStartHour) {
    return null
  }

  const startHour = random.between(lunchStartHour, latestStartHour)

  return {
    startHour: normalizeHour(startHour),
    endHour: normalizeHour(startHour + lunchDurationHours)
  }
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

function createNpcSpawnState(city, spawnTiles, timetable, clock, random, config, slotOffsets, visualSlotCount) {
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

  const tileIndex = spawnTiles[random.int(spawnTiles.length)]
  const slot = random.int(visualSlotCount)
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
  if (npc.manualControl || npc.vehicleTrip) {
    return
  }

  let activeElement = typeof npc.getActiveDestinationElement === 'function'
    ? npc.getActiveDestinationElement(timeOfDayHours)
    : npc.getActiveTimetableElement(timeOfDayHours)

  activeElement = context.policies?.getAdjustedDestinationElement(npc, activeElement) || activeElement

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
  if (npc.manualControl) {
    return
  }

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
      npc.routing.blockedSeconds = 0
      context.routePlanner.request(npc)
    } else {
      npc.routing.blockedSeconds += deltaSeconds
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
  if (npc.manualControl) {
    return
  }

  if (npc.vehicleTrip || npc.waitingForCar) {
    if (context.renderEnabled) {
      idleNpcSprite(npc)
    }
    return
  }

  if (!npc.present) {
    if (context.renderEnabled) {
      idleNpcSprite(npc)
    }
    return
  }

  if (npc.movement.target) {
    moveNpcTowardTarget(npc, deltaSeconds, context)

    if (!npc.movement.target && npc.isAtGoalTile()) {
      enterGoalLocation(npc, context)
    }

    return
  }

  if (context.renderEnabled) {
    idleNpcSprite(npc)
  }

  if (npc.goal) {
    followRoute(npc, deltaSeconds, context)
  }
}

function moveNpcTowardTarget(npc, deltaSeconds, context) {
  const target = npc.movement.target
  const maxStep = npc.movement.speed * deltaSeconds * npcCrowdSpeedScale(npc, target, context)
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

  if (context.renderEnabled) {
    stepNpcSpriteAnimation(npc, directionX, directionY, movedDistance)
  }
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

  const blockedReplanSeconds = Math.max(
    0,
    finiteNumberOrDefault(context.config.routeBlockedReplanSeconds, NPC_CONFIG.routeBlockedReplanSeconds)
  )

  if (npc.routing.blockedSeconds >= blockedReplanSeconds && tryStartMoveToIndex(npc, nextIndex, context)) {
    npc.routing.blockedSeconds = 0
    return
  }

  if (npc.routing.blockedSeconds >= blockedReplanSeconds) {
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
    context.desires?.handleRouteFailure(npc)
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
    context.visualSlotCount,
    context.unlimitedCapacityTiles,
    npc.slot.id,
    context.crowding
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
  reserveNpcCrowdingTarget(targetIndex, targetSlot.slot, context)
  if (context.renderEnabled) {
    faceNpcSprite(npc, movementTarget.directionX, movementTarget.directionY)
  }

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
    sampleCursor: 1,
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
  let startIndex = curve.sampleCursor || 1

  if (startIndex >= samples.length || distance <= samples[startIndex - 1].distance) {
    startIndex = 1
  }

  for (let index = startIndex; index < samples.length; index += 1) {
    const sample = samples[index]

    if (distance > sample.distance) {
      continue
    }

    curve.sampleCursor = index
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
    context.visualSlotCount,
    context.unlimitedCapacityTiles,
    null,
    context.crowding
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
  if (context.renderEnabled) {
    idleNpcSprite(npc)
  }

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
  if (context.renderEnabled) {
    idleNpcSprite(npc)
  }
  npc.routing = createEmptyRouteState()
}

function findAvailableNpcSlot(tileIndex, random, visualSlotCount, unlimitedCapacityTiles, preferredSlot = null, crowding = null) {
  if (unlimitedCapacityTiles && unlimitedCapacityTiles[tileIndex]) {
    return { slot: -1, unlimited: true }
  }

  const avoidedSlot = chooseAvoidanceNpcSlot(tileIndex, visualSlotCount, preferredSlot, crowding)

  if (avoidedSlot !== -1) {
    return { slot: avoidedSlot, unlimited: false }
  }

  if (Number.isInteger(preferredSlot) && preferredSlot >= 0 && preferredSlot < visualSlotCount) {
    return { slot: preferredSlot, unlimited: false }
  }

  return { slot: random.int(visualSlotCount), unlimited: false }
}

function chooseAvoidanceNpcSlot(tileIndex, visualSlotCount, preferredSlot, crowding) {
  if (!crowding?.slotCounts || visualSlotCount <= 0 || tileIndex < 0) {
    return -1
  }

  const baseIndex = tileIndex * visualSlotCount
  let bestSlot = -1
  let bestCount = Infinity
  let occupiedCount = 0

  for (let slot = 0; slot < visualSlotCount; slot += 1) {
    const count = npcCrowdingSlotCount(crowding, baseIndex + slot)
    occupiedCount += count

    if (count < bestCount) {
      bestCount = count
      bestSlot = slot
    }
  }

  if (bestSlot === -1) {
    return -1
  }

  if (Number.isInteger(preferredSlot) && preferredSlot >= 0 && preferredSlot < visualSlotCount) {
    const preferredCount = npcCrowdingSlotCount(crowding, baseIndex + preferredSlot)

    if (preferredCount <= bestCount) {
      return preferredSlot
    }
  }

  return occupiedCount > 0 ? bestSlot : -1
}

function reserveNpcCrowdingTarget(tileIndex, slotId, context) {
  if (!context.crowding) {
    return
  }

  addNpcCrowdingOccupancy(context.crowding, tileIndex, slotId, false)
}

export function createNpcCrowdingState(city, config) {
  const visualSlotCount = resolveNpcVisualSlotCount(config)

  return {
    config: normalizeNpcCrowdingConfig(config.crowding),
    visualSlotCount,
    tileCounts: new Uint16Array(city.tiles.length),
    incomingTileCounts: new Uint16Array(city.tiles.length),
    slotCounts: new Uint16Array(city.tiles.length * visualSlotCount),
    tileStamps: new Uint32Array(city.tiles.length),
    incomingTileStamps: new Uint32Array(city.tiles.length),
    slotStamps: new Uint32Array(city.tiles.length * visualSlotCount),
    stamp: 0,
    dense: false,
    occupancyCount: 0,
    lastOccupancyCount: 0
  }
}

export function updateNpcCrowdingState(crowding, npcs) {
  if (crowding.lastOccupancyCount > NPC_CROWDING_SPARSE_UPDATE_LIMIT) {
    updateDenseNpcCrowdingState(crowding, npcs)
    return
  }

  beginSparseNpcCrowdingUpdate(crowding)

  for (const npc of npcs) {
    if (!npc.present) {
      continue
    }

    addNpcCrowdingOccupancy(crowding, npc.tile?.index, npc.slot?.id, true)

    if (npc.movement.target) {
      addNpcCrowdingOccupancy(
        crowding,
        npc.movement.target.tile?.index,
        npc.movement.target.slot?.id,
        false
      )
    }
  }

  finishNpcCrowdingUpdate(crowding)
}

function updateDenseNpcCrowdingState(crowding, npcs) {
  crowding.dense = true
  crowding.occupancyCount = 0
  crowding.tileCounts.fill(0)
  crowding.incomingTileCounts.fill(0)
  crowding.slotCounts.fill(0)

  for (const npc of npcs) {
    if (!npc.present) {
      continue
    }

    addNpcCrowdingOccupancy(crowding, npc.tile?.index, npc.slot?.id, true)

    if (npc.movement.target) {
      addNpcCrowdingOccupancy(
        crowding,
        npc.movement.target.tile?.index,
        npc.movement.target.slot?.id,
        false
      )
    }
  }

  finishNpcCrowdingUpdate(crowding)
}

function beginSparseNpcCrowdingUpdate(crowding) {
  crowding.dense = false
  crowding.occupancyCount = 0
  crowding.stamp += 1

  if (crowding.stamp < 0xffffffff) {
    return
  }

  crowding.tileStamps.fill(0)
  crowding.incomingTileStamps.fill(0)
  crowding.slotStamps.fill(0)
  crowding.stamp = 1
}

function finishNpcCrowdingUpdate(crowding) {
  crowding.lastOccupancyCount = crowding.occupancyCount
}

function addNpcCrowdingOccupancy(crowding, tileIndex, slotId, isCurrentTile) {
  if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= crowding.tileCounts.length) {
    return
  }

  const counts = isCurrentTile ? crowding.tileCounts : crowding.incomingTileCounts
  const stamps = isCurrentTile ? crowding.tileStamps : crowding.incomingTileStamps

  if (!crowding.dense && stamps[tileIndex] !== crowding.stamp) {
    stamps[tileIndex] = crowding.stamp
    counts[tileIndex] = 0
  }

  counts[tileIndex] += 1
  crowding.occupancyCount += 1

  if (Number.isInteger(slotId) && slotId >= 0 && slotId < crowding.visualSlotCount) {
    const slotIndex = tileIndex * crowding.visualSlotCount + slotId

    if (!crowding.dense && crowding.slotStamps[slotIndex] !== crowding.stamp) {
      crowding.slotStamps[slotIndex] = crowding.stamp
      crowding.slotCounts[slotIndex] = 0
    }

    crowding.slotCounts[slotIndex] += 1
  }
}

function npcCrowdCount(tileIndex, context) {
  const crowding = context.crowding

  if (!crowding || !Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= crowding.tileCounts.length) {
    return 0
  }

  if (crowding.dense) {
    return crowding.tileCounts[tileIndex] + crowding.incomingTileCounts[tileIndex]
  }

  return npcCrowdingStampedCount(crowding.tileCounts, crowding.tileStamps, crowding.stamp, tileIndex) +
    npcCrowdingStampedCount(crowding.incomingTileCounts, crowding.incomingTileStamps, crowding.stamp, tileIndex)
}

function npcCrowdingSlotCount(crowding, slotIndex) {
  if (crowding.dense) {
    return crowding.slotCounts[slotIndex]
  }

  return npcCrowdingStampedCount(crowding.slotCounts, crowding.slotStamps, crowding.stamp, slotIndex)
}

function npcCrowdingStampedCount(counts, stamps, stamp, index) {
  return stamps[index] === stamp ? counts[index] : 0
}

function npcCrowdSpeedScale(npc, target, context) {
  const config = context.crowding?.config

  if (!config) {
    return 1
  }

  const crowdedCount = Math.max(
    npcCrowdCount(npc.tile.index, context),
    npcCrowdCount(target.tile.index, context)
  )
  const overCapacity = crowdedCount - config.softTileCapacity

  if (overCapacity <= 0) {
    return 1
  }

  const crowdRatio = Math.min(1, overCapacity / config.softTileCapacity)
  return Math.max(1 - config.maxSpeedPenalty, 1 - config.maxSpeedPenalty * crowdRatio)
}

function normalizeNpcCrowdingConfig(config = NPC_CONFIG.crowding) {
  const fallback = NPC_CONFIG.crowding

  return {
    softTileCapacity: positiveIntegerOrDefault(config?.softTileCapacity, fallback.softTileCapacity),
    maxSpeedPenalty: Math.min(0.95, Math.max(0, finiteNumberOrDefault(config?.maxSpeedPenalty, fallback.maxSpeedPenalty)))
  }
}

function resolveNpcVisualSlotCount(config) {
  return positiveIntegerOrDefault(
    config?.visualSlotCount,
    NPC_CONFIG.visualSlotCount
  )
}

function createNpcSlotOffsets(city, config, visualSlotCount) {
  const offsets = new Array(visualSlotCount)
  const columns = Math.ceil(Math.sqrt(visualSlotCount))
  const rows = Math.ceil(visualSlotCount / columns)
  const horizontalSpacing = columns > 1
    ? Math.min(config.slotSpacing, Math.max(0, city.tileSize - config.size) / (columns - 1))
    : 0
  const verticalSpacing = rows > 1
    ? Math.min(config.slotSpacing, Math.max(0, city.tileSize - config.size) / (rows - 1))
    : 0

  for (let slot = 0; slot < visualSlotCount; slot += 1) {
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

function positiveNumberOrDefault(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback
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

function clampPercent(value) {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    return INFECTION_CONFIG.inoculatedPercent
  }

  return Math.min(Math.max(number, 0), 100)
}

function normalizePolicyProbability(value) {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    return 0
  }

  return Math.min(Math.max(number, 0), 1)
}

function unitIntervalOrDefault(value, fallback) {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    return fallback
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

function clampNeedScore(value) {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    return 0
  }

  return Math.min(Math.max(number, 0), 100)
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
