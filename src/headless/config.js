import {
  CAR_CONFIG,
  INFECTION_CONFIG,
  NPC_CONFIG
} from '../core/constants.js'
import { metersToWorldUnits } from '../core/scale.js'
import { normalizePolicyList } from './policies.js'

export const HEADLESS_WORLD_CONFIG_FORMAT = 'epi-city-headless-world-config'
export const HEADLESS_RUN_CONFIG_FORMAT = 'epi-city-headless-run-config'
export const HEADLESS_CONFIG_VERSION = 1

const DEFAULT_RUN_DURATION_SECONDS = 24 * 60 * 60
const DEFAULT_RUN_STEP_SECONDS = 2

export function normalizeWorldConfig(input = {}) {
  const source = parseObjectInput(input, 'headless world config')

  return {
    format: HEADLESS_WORLD_CONFIG_FORMAT,
    version: HEADLESS_CONFIG_VERSION,
    seed: normalizeSeed(source.seed),
    population: normalizePopulation(source.population),
    initialSeir: normalizeInitialSeir(source.initialSeir)
  }
}

export function normalizeRunConfig(input = {}, overrides = {}) {
  const source = parseObjectInput(input, 'headless run config')

  return {
    format: HEADLESS_RUN_CONFIG_FORMAT,
    version: HEADLESS_CONFIG_VERSION,
    world: normalizeWorldConfig(source.world || {}),
    run: normalizeRunBlock(source.run, overrides),
    infection: normalizeInfectionBlock(source.infection),
    policies: normalizePolicyList(source.policies)
  }
}

export function normalizeSeed(seed = {}) {
  const source = seed && typeof seed === 'object' && !Array.isArray(seed) ? seed : {}

  return {
    enabled: source.enabled !== false,
    value: String(source.value ?? 'epi-city')
  }
}

export function normalizePopulation(population = {}) {
  const source = population && typeof population === 'object' && !Array.isArray(population) ? population : {}

  return {
    npcCount: clampInteger(source.npcCount ?? NPC_CONFIG.count, 100, 10000),
    carCount: clampInteger(source.carCount ?? CAR_CONFIG.count, 0, 2000)
  }
}

export function normalizeInitialSeir(initialSeir = {}) {
  const source = initialSeir && typeof initialSeir === 'object' && !Array.isArray(initialSeir) ? initialSeir : {}

  return {
    initialInfectiousCount: clampInteger(
      source.initialInfectiousCount ?? INFECTION_CONFIG.initialInfectiousCount,
      INFECTION_CONFIG.initialInfectiousCountRange.min,
      INFECTION_CONFIG.initialInfectiousCountRange.max
    ),
    inoculatedPercent: clampNumber(
      source.inoculatedPercent ?? INFECTION_CONFIG.inoculatedPercent,
      INFECTION_CONFIG.inoculatedPercentRange.min,
      INFECTION_CONFIG.inoculatedPercentRange.max
    )
  }
}

export function normalizeRunBlock(run = {}, overrides = {}) {
  const source = run && typeof run === 'object' && !Array.isArray(run) ? run : {}
  const durationSeconds = resolveDurationSeconds(source, overrides)

  return {
    durationSeconds: positiveNumber(durationSeconds, DEFAULT_RUN_DURATION_SECONDS),
    stepSeconds: positiveNumber(overrides.stepSeconds ?? source.stepSeconds, DEFAULT_RUN_STEP_SECONDS)
  }
}

export function normalizeInfectionBlock(infection = {}) {
  const source = infection && typeof infection === 'object' && !Array.isArray(infection) ? infection : {}
  const distanceMeters = clampNumber(
    source.distanceMeters ?? 2,
    0,
    25
  )

  return {
    distanceMeters,
    distanceWorldUnits: metersToWorldUnits(distanceMeters),
    transmissionProbabilityPerMinute: clampNumber(
      source.transmissionProbabilityPerMinute ?? INFECTION_CONFIG.infectionProbability,
      INFECTION_CONFIG.infectionProbabilityRange.min,
      INFECTION_CONFIG.infectionProbabilityRange.max
    ),
    incubationDays: clampNumber(
      source.incubationDays ?? INFECTION_CONFIG.incubationDays,
      INFECTION_CONFIG.incubationDaysRange.min,
      INFECTION_CONFIG.incubationDaysRange.max
    ),
    infectiousDays: clampNumber(
      source.infectiousDays ?? INFECTION_CONFIG.infectionDays,
      INFECTION_CONFIG.infectionDaysRange.min,
      INFECTION_CONFIG.infectionDaysRange.max
    ),
    immunityDays: clampNumber(
      source.immunityDays ?? INFECTION_CONFIG.immunityDays,
      INFECTION_CONFIG.immunityDaysRange.min,
      INFECTION_CONFIG.immunityDaysRange.max
    )
  }
}

function parseObjectInput(input, label) {
  if (typeof input === 'string') {
    try {
      return parseObjectInput(JSON.parse(input), label)
    } catch (error) {
      throw new Error(`Invalid ${label} JSON: ${error.message}`)
    }
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError(`${label} must be a JSON object.`)
  }

  return input
}

function resolveDurationSeconds(source, overrides) {
  const explicitOverrides = [
    overrides.durationSeconds,
    overrides.durationHours == null ? null : overrides.durationHours * 60 * 60,
    overrides.durationDays == null ? null : overrides.durationDays * 24 * 60 * 60
  ].filter((value) => value != null)

  if (explicitOverrides.length > 1) {
    throw new Error('Use only one duration override.')
  }

  if (explicitOverrides.length === 1) {
    return explicitOverrides[0]
  }

  if (source.durationSeconds != null) {
    return source.durationSeconds
  }

  if (source.durationHours != null) {
    return Number(source.durationHours) * 60 * 60
  }

  return DEFAULT_RUN_DURATION_SECONDS
}

function positiveNumber(value, fallback) {
  const number = Number(value)

  return Number.isFinite(number) && number > 0 ? number : fallback
}

function clampNumber(value, min, max) {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    return min
  }

  return Math.min(Math.max(number, min), max)
}

function clampInteger(value, min, max) {
  const number = Math.round(Number(value))

  if (!Number.isFinite(number)) {
    return min
  }

  return Math.min(Math.max(number, min), max)
}
