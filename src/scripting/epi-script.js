const DEFAULT_RENDER_DURATION_SECONDS = 10

const TIMELINE_ACTION_ALIASES = new Map([
  ['setCamera', 'setCamera'],
  ['cameraSet', 'setCamera'],
  ['moveCamera', 'moveCamera'],
  ['cameraMove', 'moveCamera'],
  ['panCamera', 'moveCamera'],
  ['playback', 'playback'],
  ['playSimulation', 'playback'],
  ['call', 'call'],
  ['apiCall', 'call'],
  ['callApi', 'call'],
  ['followEntity', 'followEntity'],
  ['followNpc', 'followEntity'],
  ['followCar', 'followEntity'],
  ['setNpcPosition', 'setNpcPosition'],
  ['teleportNpc', 'setNpcPosition'],
  ['moveNpc', 'moveNpc'],
  ['setCarPosition', 'setCarPosition'],
  ['teleportCar', 'setCarPosition'],
  ['moveCar', 'moveCar']
])

const SIMULATION_ACTION_ALIASES = new Map([
  ['call', 'call'],
  ['apiCall', 'call'],
  ['callApi', 'call'],
  ['setNpcPosition', 'setNpcPosition'],
  ['teleportNpc', 'setNpcPosition'],
  ['moveNpc', 'setNpcPosition'],
  ['setCarPosition', 'setCarPosition'],
  ['teleportCar', 'setCarPosition'],
  ['moveCar', 'setCarPosition']
])

export function normalizeEpiScript(input) {
  const source = parseInput(input)
  const root = Array.isArray(source) ? { actions: source } : source

  assertPlainObject(root, 'script')

  if (root.actions !== undefined && root.script !== undefined) {
    throw new Error('Epi script can specify either "script" or "actions", not both')
  }

  const actionInput = root.script ?? root.actions
  const actionPath = root.script !== undefined ? 'script' : 'actions'
  const actions = normalizeActionList(actionInput, TIMELINE_ACTION_ALIASES, actionPath)
  const render = normalizeRender(root.render, actions)
  const simulation = normalizeSimulation(root.simulation, render.durationSeconds)

  return {
    simulation,
    render,
    cameraStart: root.cameraStart ?? null,
    actions
  }
}

export function getScriptDuration(script) {
  const normalized = isNormalizedScript(script) ? script : normalizeEpiScript(script)

  return Math.max(
    normalized.render.durationSeconds,
    getActionsEndTime(normalized.actions)
  )
}

export function getTimelineActionsAt(actions, time) {
  const point = toFiniteNumber(time, 'time')

  return actions.filter((action) => {
    const start = action.at ?? 0
    const duration = action.duration ?? 0

    return point >= start && point <= start + duration
  })
}

export function interpolateNumber(a, b, t) {
  return toFiniteNumber(a, 'a') + (toFiniteNumber(b, 'b') - toFiniteNumber(a, 'a')) * clamp01(t)
}

export function easingValue(name, t) {
  const amount = clamp01(t)

  switch (name) {
    case undefined:
    case null:
    case 'linear':
      return amount
    case 'smooth':
    case 'ease-in-out':
      return amount * amount * (3 - 2 * amount)
    case 'ease-in':
      return amount * amount
    case 'ease-out':
      return 1 - (1 - amount) * (1 - amount)
    default:
      throw new Error(`Unknown easing "${name}"`)
  }
}

function parseInput(input) {
  if (typeof input === 'string') {
    try {
      return JSON.parse(input)
    } catch (error) {
      throw new Error(`Invalid Epi script JSON: ${error.message}`)
    }
  }

  if (Array.isArray(input) || isPlainObject(input)) {
    return input
  }

  throw new TypeError('Epi script input must be a JSON string, action array, or object')
}

function normalizeSimulation(simulationInput = {}, defaultDurationSeconds) {
  assertPlainObject(simulationInput, 'simulation')

  const durationSeconds = readDurationSeconds(simulationInput, 'simulation', false) ?? defaultDurationSeconds
  validatePositive(durationSeconds, 'simulation.durationSeconds')
  const sampleIntervalSeconds = readPositiveAlias(
    simulationInput,
    ['sampleIntervalSeconds', 'sampleInterval'],
    'simulation.sampleIntervalSeconds'
  ) ?? 60
  const stepSeconds = readPositiveAlias(
    simulationInput,
    ['stepSeconds', 'step'],
    'simulation.stepSeconds'
  ) ?? Math.min(sampleIntervalSeconds, 2)
  const actions = normalizeActionList(
    simulationInput.actions,
    SIMULATION_ACTION_ALIASES,
    'simulation.actions'
  )

  return {
    durationSeconds,
    sampleIntervalSeconds,
    stepSeconds,
    parameters: simulationInput.parameters ?? {},
    actions
  }
}

function normalizeRender(renderInput = {}, actions = []) {
  assertPlainObject(renderInput, 'render')

  const explicitDurationSeconds = readDurationSeconds(renderInput, 'render', false)
  const durationSeconds = explicitDurationSeconds ?? getDefaultRenderDuration(actions)

  validatePositive(durationSeconds, 'render.durationSeconds')

  return { durationSeconds }
}

function normalizeActionList(actionsInput = [], aliases, path) {
  if (actionsInput == null) {
    return []
  }

  if (!Array.isArray(actionsInput)) {
    throw new TypeError(`${path} must be an array`)
  }

  return actionsInput
    .map((action, originalIndex) => ({
      action: normalizeAction(action, aliases, `${path}[${originalIndex}]`),
      originalIndex
    }))
    .sort(compareIndexedActions)
    .map(({ action }) => action)
}

function normalizeAction(actionInput, aliases, path) {
  assertPlainObject(actionInput, path)

  const at = Math.max(0, readNumber(actionInput.at ?? 0, `${path}.at`))
  const normalized = {
    ...actionInput,
    at,
    action: canonicalAction(actionInput.action, aliases, `${path}.action`)
  }

  if (actionInput.action === 'followNpc' && normalized.kind === undefined) {
    normalized.kind = 'npc'
  } else if (actionInput.action === 'followCar' && normalized.kind === undefined) {
    normalized.kind = 'car'
  }

  if (actionInput.duration !== undefined) {
    normalized.duration = readNumber(actionInput.duration, `${path}.duration`)
    validatePositive(normalized.duration, `${path}.duration`)
  }

  return normalized
}

function compareIndexedActions(left, right) {
  if (left.action.at !== right.action.at) {
    return left.action.at - right.action.at
  }

  const leftIndex = Number.isFinite(left.action.index) ? left.action.index : left.originalIndex
  const rightIndex = Number.isFinite(right.action.index) ? right.action.index : right.originalIndex

  return leftIndex - rightIndex
}

function canonicalAction(action, aliases, path) {
  if (typeof action !== 'string' || action.length === 0) {
    throw new TypeError(`${path} must be a non-empty string`)
  }

  return aliases.get(action) ?? action
}

function readDurationSeconds(input, path, required) {
  const duration = readPositiveAlias(
    input,
    ['durationSeconds', 'duration'],
    `${path}.durationSeconds`
  )
  const durationHours = readOptionalNumber(input.durationHours, `${path}.durationHours`)

  if (duration !== undefined && durationHours !== undefined) {
    throw new Error(`${path} can specify durationSeconds/duration or durationHours, not both`)
  }

  const durationSeconds = duration ?? (
    durationHours === undefined ? undefined : durationHours * 60 * 60
  )

  if (required && durationSeconds === undefined) {
    throw new Error(`${path}.durationSeconds is required`)
  }

  if (durationSeconds !== undefined) {
    validatePositive(durationSeconds, `${path}.durationSeconds`)
  }

  return durationSeconds
}

function readPositiveAlias(input, keys, path) {
  let value
  let foundKey

  for (const key of keys) {
    if (input[key] !== undefined) {
      if (foundKey !== undefined) {
        throw new Error(`${path} has multiple aliases`)
      }

      value = readNumber(input[key], `${path}`)
      foundKey = key
    }
  }

  if (foundKey === undefined) {
    return undefined
  }

  validatePositive(value, path)

  return value
}

function readOptionalNumber(value, path) {
  if (value === undefined) {
    return undefined
  }

  return readNumber(value, path)
}

function readNumber(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number`)
  }

  return value
}

function toFiniteNumber(value, path) {
  return readNumber(value, path)
}

function validatePositive(value, path) {
  if (value <= 0) {
    throw new RangeError(`${path} must be positive`)
  }
}

function getDefaultRenderDuration(actions) {
  const endTime = getActionsEndTime(actions)

  return endTime > 0 ? endTime : DEFAULT_RENDER_DURATION_SECONDS
}

function getActionsEndTime(actions) {
  return actions.reduce((end, action) => {
    return Math.max(end, action.at + (action.duration ?? 0))
  }, 0)
}

function clamp01(value) {
  const number = toFiniteNumber(value, 't')

  return Math.min(1, Math.max(0, number))
}

function assertPlainObject(value, path) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${path} must be an object`)
  }
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function isNormalizedScript(script) {
  return isPlainObject(script)
    && isPlainObject(script.simulation)
    && isPlainObject(script.render)
    && Array.isArray(script.actions)
}
