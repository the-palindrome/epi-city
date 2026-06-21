import {
  CAR_CONFIG,
  INFECTION_CONFIG,
  NPC_CONFIG,
  SIMULATION_CONFIG
} from '../core/constants.js'
import { createSeededRandom, createSystemRandom } from '../core/random.js'
import { createCarSimulation } from '../sim/car-simulation.js'
import { createNpcSimulation } from '../sim/npc-simulation.js'
import { createSignalUpdateSystem } from '../sim/signal-update-system.js'
import { SimulationClock } from '../sim/simulation-clock.js'
import { formatNpcId, parseNpcId } from './event-recorder.js'
import {
  createPolicyEffects,
  createPolicyEvaluator,
  getPolicyEffectsKey
} from './policies.js'

export function createHeadlessRuntime({
  city,
  seed,
  population,
  initialSeir = {},
  infectionConfig,
  policies = [],
  world = null,
  eventRecorder = null
}) {
  const effectiveSeed = seed || { enabled: true, value: 'epi-city' }
  const effectivePopulation = normalizeRuntimePopulation(population, world)
  const simulationClock = new SimulationClock(SIMULATION_CONFIG.clock)
  const signalSystem = createSignalUpdateSystem(city, simulationClock)
  const npcRandom = createRandom(effectiveSeed, '')
  const carRandom = createRandom(effectiveSeed, ':cars')
  const initialSeirRandom = createRandom(effectiveSeed, ':initial-seir')
  const policyEvaluator = createPolicyEvaluator(policies, effectivePopulation.npcCount)
  const emptyPolicyEffects = createPolicyEffects([])
  let policyEffectsKey = ''

  const npcSimulation = createNpcSimulation(city, createEntityLayer(), {
    ...NPC_CONFIG,
    count: effectivePopulation.npcCount,
    initialInfectiousCount: 0,
    inoculatedPercent: 0,
    infectionDistance: infectionConfig.distanceWorldUnits,
    infectionProbability: infectionConfig.transmissionProbabilityPerMinute,
    incubationDays: infectionConfig.incubationDays,
    infectionDays: infectionConfig.infectiousDays,
    immunityDays: infectionConfig.immunityDays,
    infectionColors: INFECTION_CONFIG.colors,
    clock: simulationClock,
    random: npcRandom,
    render: false,
    eventRecorder,
    policyEffects: emptyPolicyEffects
  })

  if (world) {
    applySerializedNpcState(npcSimulation.npcs, world.npcs)
  }

  const initialSeirStateByNpcId = applyRunInitialSeir(npcSimulation.infection, initialSeir, initialSeirRandom)

  const carSimulation = createCarSimulation(city, createEntityLayer(), {
    ...CAR_CONFIG,
    count: effectivePopulation.carCount,
    clock: simulationClock,
    random: carRandom,
    npcs: npcSimulation.npcs,
    render: false
  })

  function update(deltaSeconds) {
    simulationClock.update(deltaSeconds)
    signalSystem.update(deltaSeconds)
    applyPolicyEffects()
    carSimulation.update(deltaSeconds)
    npcSimulation.update(deltaSeconds)
  }

  function applyPolicyEffects() {
    const effects = policies.length > 0
      ? policyEvaluator.evaluate(npcSimulation.infection.getStats())
      : emptyPolicyEffects
    const nextKey = getPolicyEffectsKey(effects)

    if (nextKey !== policyEffectsKey) {
      policyEffectsKey = nextKey
      npcSimulation.setPolicyEffects(effects)
      if (policies.length > 0) {
        eventRecorder?.recordPolicyEffectChange?.(effects, simulationClock.getElapsedSimulationSeconds())
      }
    }
  }

  applyPolicyEffects()

  return {
    city,
    simulationClock,
    npcSimulation,
    carSimulation,
    get npcs() {
      return npcSimulation.npcs
    },
    get cars() {
      return carSimulation.cars
    },
    initialSeirStateByNpcId,
    update,
    getFinalSeir() {
      return npcSimulation.infection.getStats()
    },
    destroy() {
      npcSimulation.destroy()
      carSimulation.destroy()
    }
  }
}

export function applyRunInitialSeir(infection, initialSeir = {}, random = createSystemRandom()) {
  const npcs = infection.npcs || []
  const explicitInfected = parseNpcIdSet(initialSeir.infectedNpcIds, npcs, 'infectedNpcIds')
  const explicitInoculated = parseNpcIdSet(initialSeir.inoculatedNpcIds, npcs, 'inoculatedNpcIds')
  const infected = new Set(explicitInfected)
  const inoculated = new Set(explicitInoculated)

  for (const id of infected) {
    validateNpcIndex(id, npcs, 'infectedNpcIds')
  }

  for (const id of inoculated) {
    validateNpcIndex(id, npcs, 'inoculatedNpcIds')
    if (infected.has(id)) {
      throw new Error(`NPC ${id} cannot be both infected and inoculated.`)
    }
  }

  if (explicitInoculated.length === 0) {
    const inoculatedCount = clampInteger((npcs.length * (Number(initialSeir.inoculatedPercent) || 0)) / 100, 0, npcs.length)

    for (const id of chooseRandomNpcIndexes(npcs, inoculatedCount, random, infected)) {
      inoculated.add(id)
    }
  }

  if (explicitInfected.length === 0) {
    const infectionCount = clampInteger(Number(initialSeir.initialInfectiousCount) || 0, 0, npcs.length)
    const excluded = new Set([...inoculated])

    for (const id of chooseRandomNpcIndexes(npcs, infectionCount, random, excluded)) {
      infected.add(id)
    }
  }

  const states = new Map()

  for (let index = 0; index < npcs.length; index += 1) {
    infection.setNpcState(index, 'susceptible', 0, { emit: false })
    states.set(formatNpcId(index), 'susceptible')
  }

  for (const id of inoculated) {
    infection.setNpcState(id, 'recovered', null, { emit: false })
    states.set(formatNpcId(id), 'recovered')
  }

  for (const id of infected) {
    infection.setNpcState(id, 'infectious', null, { emit: false })
    states.set(formatNpcId(id), 'infectious')
  }

  return states
}

export function applySerializedNpcState(npcs, worldNpcs = []) {
  if (!Array.isArray(worldNpcs) || worldNpcs.length === 0) {
    return
  }

  if (worldNpcs.length !== npcs.length) {
    throw new Error(`World NPC count ${worldNpcs.length} does not match generated NPC count ${npcs.length}.`)
  }

  for (const worldNpc of worldNpcs) {
    const index = parseNpcId(worldNpc.id)
    const npc = npcs[index]

    if (!npc) {
      throw new Error(`World references unknown NPC id "${worldNpc.id}".`)
    }

    npc.age = Number.isInteger(worldNpc.age) ? worldNpc.age : npc.age
    npc.home = worldNpc.homeBuildingId ?? npc.home
    npc.school = worldNpc.schoolBuildingId ?? npc.school
    npc.work = worldNpc.workBuildingId ?? npc.work
    npc.friendIds = (worldNpc.friendIds || []).map(parseNpcId).filter(Number.isInteger)
    npc.present = worldNpc.present !== false
    npc.position = clonePoint(worldNpc.position, npc.position)
    npc.tile = cloneTile(worldNpc.tile, npc.tile)
    npc.slot = worldNpc.slot && typeof worldNpc.slot === 'object' ? { ...worldNpc.slot } : npc.slot
    npc.locationState = worldNpc.locationState ? cloneLocationState(worldNpc.locationState) : null
  }
}

function validateNpcIndex(index, npcs, field) {
  if (!Number.isInteger(index) || index < 0 || index >= npcs.length) {
    throw new Error(`${field} references unknown NPC id "npc_${index}".`)
  }
}

function parseNpcIdSet(ids, npcs, field) {
  if (!Array.isArray(ids)) {
    return []
  }

  const parsed = []
  const seen = new Set()

  for (const rawId of ids) {
    const id = parseNpcId(rawId)

    if (!Number.isInteger(id)) {
      throw new Error(`${field} references invalid NPC id "${rawId}".`)
    }

    validateNpcIndex(id, npcs, field)

    if (seen.has(id)) {
      throw new Error(`${field} contains duplicate NPC id "${formatNpcId(id)}".`)
    }

    seen.add(id)
    parsed.push(id)
  }

  return parsed
}

function chooseRandomNpcIndexes(npcs, count, random, excluded = new Set()) {
  const candidates = []

  for (let index = 0; index < npcs.length; index += 1) {
    if (!excluded.has(index)) {
      candidates.push(index)
    }
  }

  const selectedCount = Math.min(clampInteger(count, 0, candidates.length), candidates.length)
  const selected = []

  for (let index = 0; index < selectedCount; index += 1) {
    const selectedIndex = index + random.int(candidates.length - index)
    const npcIndex = candidates[selectedIndex]

    candidates[selectedIndex] = candidates[index]
    candidates[index] = npcIndex
    selected.push(npcIndex)
  }

  return selected
}

function normalizeRuntimePopulation(population, world) {
  return {
    npcCount: nonNegativeInteger(population?.npcCount ?? world?.npcs?.length ?? NPC_CONFIG.count),
    carCount: nonNegativeInteger(population?.carCount ?? world?.cars?.length ?? CAR_CONFIG.count)
  }
}

function nonNegativeInteger(value) {
  const number = Math.round(Number(value))

  return Number.isFinite(number) && number >= 0 ? number : 0
}

function clampInteger(value, min, max) {
  const number = Math.round(Number(value))

  if (!Number.isFinite(number)) {
    return min
  }

  return Math.min(Math.max(number, min), max)
}

function createRandom(seed, suffix) {
  if (seed?.enabled === false) {
    return createSystemRandom()
  }

  return createSeededRandom(`${seed?.value ?? 'epi-city'}${suffix}`)
}

function clonePoint(point, fallback) {
  return {
    x: Number.isFinite(Number(point?.x)) ? Number(point.x) : fallback.x,
    y: Number.isFinite(Number(point?.y)) ? Number(point.y) : fallback.y
  }
}

function cloneTile(tile, fallback) {
  return {
    x: Number.isInteger(Number(tile?.x)) ? Number(tile.x) : fallback.x,
    y: Number.isInteger(Number(tile?.y)) ? Number(tile.y) : fallback.y,
    index: Number.isInteger(Number(tile?.index)) ? Number(tile.index) : fallback.index
  }
}

function cloneLocationState(locationState) {
  return {
    ...locationState,
    location: locationState.location ? { ...locationState.location } : null
  }
}

function createEntityLayer() {
  return {
    children: [],
    addChild(child) {
      this.children.push(child)
      child.parent = this
    },
    removeChild(child) {
      this.children = this.children.filter((item) => item !== child)
      child.parent = null
    }
  }
}
