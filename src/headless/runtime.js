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
import { parseNpcId } from './event-recorder.js'
import {
  createPolicyEffects,
  createPolicyEvaluator,
  getPolicyEffectsKey
} from './policies.js'

export function createHeadlessRuntime({
  city,
  worldConfig,
  infectionConfig,
  policies = [],
  world = null,
  eventRecorder = null
}) {
  const effectiveWorldConfig = world?.config || worldConfig
  const seed = effectiveWorldConfig.seed
  const population = effectiveWorldConfig.population
  const initialSeir = world ? { initialInfectiousCount: 0, inoculatedPercent: 0 } : effectiveWorldConfig.initialSeir
  const simulationClock = new SimulationClock(SIMULATION_CONFIG.clock)
  const signalSystem = createSignalUpdateSystem(city, simulationClock)
  const npcRandom = createRandom(seed, '')
  const carRandom = createRandom(seed, ':cars')
  const policyEvaluator = createPolicyEvaluator(policies, population.npcCount)
  const emptyPolicyEffects = createPolicyEffects([])
  let policyEffectsKey = ''

  const npcSimulation = createNpcSimulation(city, createEntityLayer(), {
    ...NPC_CONFIG,
    count: population.npcCount,
    initialInfectiousCount: initialSeir.initialInfectiousCount,
    inoculatedPercent: initialSeir.inoculatedPercent,
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
    applyWorldInitialSeir(npcSimulation.infection, world)
  }

  const carSimulation = createCarSimulation(city, createEntityLayer(), {
    ...CAR_CONFIG,
    count: population.carCount,
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

export function applyWorldInitialSeir(infection, world) {
  const npcs = infection.npcs || []
  const infected = new Set((world.initialSeir?.infectedNpcIds || []).map(parseNpcId))
  const inoculated = new Set((world.initialSeir?.inoculatedNpcIds || []).map(parseNpcId))

  for (const id of infected) {
    validateNpcIndex(id, npcs, 'infectedNpcIds')
  }

  for (const id of inoculated) {
    validateNpcIndex(id, npcs, 'inoculatedNpcIds')
    if (infected.has(id)) {
      throw new Error(`NPC ${id} cannot be both infected and inoculated.`)
    }
  }

  for (let index = 0; index < npcs.length; index += 1) {
    infection.setNpcState(index, 'susceptible', 0, { emit: false })
  }

  for (const id of inoculated) {
    infection.setNpcState(id, 'recovered', null, { emit: false })
  }

  for (const id of infected) {
    infection.setNpcState(id, 'infectious', null, { emit: false })
  }
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
