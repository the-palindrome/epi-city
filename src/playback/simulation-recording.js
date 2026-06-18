import {
  getScriptDuration,
  normalizeEpiScript
} from '../scripting/epi-script.js'

export const SIMULATION_RECORDING_FORMAT = 'epi-city-simulation-recording'
export const SIMULATION_RECORDING_VERSION = 1

const REPLAY_ENTITY_ACTIONS = new Set([
  'setNpcPosition',
  'moveNpc',
  'setCarPosition',
  'moveCar'
])

const REPLAY_ALLOWED_ACTIONS = new Set([
  'playback',
  'setCamera',
  'moveCamera',
  'followEntity',
  'call'
])

const REPLAY_SAFE_CALL_METHODS = new Set([
  'setDayNightOverlayEnabled',
  'setMapTextureEnabled',
  'setMapTextureOpacity',
  'setEntityRenderMode',
  'setInfectionRadiusVisible',
  'setInfectionEdgesVisible',
  'setContactEdgesVisible',
  'setPathTrailsVisible',
  'setPathTrailLength',
  'setHeatmapRadius',
  'dashboard.setOverlay',
  'dashboard.setMapTextureEnabled',
  'dashboard.setMapTextureOpacity',
  'dashboard.setEntityRenderMode',
  'dashboard.setInfectionRadiusVisible',
  'dashboard.setInfectionEdgesVisible',
  'dashboard.setContactEdgesVisible',
  'dashboard.setPathTrailsVisible',
  'dashboard.setPathTrailLength',
  'dashboard.setHeatmapRadius',
  'dashboard.setTileOverlayScheme',
  'dashboard.setTileOverlayOpacity'
])

export function createSimulationRecordingFile({ script, recording, summary = {}, createdAt = new Date().toISOString() }) {
  const normalizedScript = normalizeEpiScript(script)
  const normalizedRecording = normalizeSimulationRecording(recording)

  return {
    format: SIMULATION_RECORDING_FORMAT,
    version: SIMULATION_RECORDING_VERSION,
    createdAt,
    script: normalizedScript,
    recording: normalizedRecording,
    summary: {
      duration: getScriptDuration(normalizedScript),
      recordingDuration: getRecordingDurationSeconds(normalizedRecording),
      snapshotCount: normalizedRecording.snapshots.length,
      ...summary
    }
  }
}

export function normalizeSimulationRecordingFile(input) {
  const source = parseJsonInput(input, 'simulation recording')

  if (source?.format === SIMULATION_RECORDING_FORMAT || source?.recording) {
    const recording = normalizeSimulationRecording(source.recording)

    return {
      format: source.format || SIMULATION_RECORDING_FORMAT,
      version: source.version || SIMULATION_RECORDING_VERSION,
      createdAt: source.createdAt || null,
      script: source.script ? normalizeEpiScript(source.script) : null,
      recording,
      summary: source.summary && typeof source.summary === 'object' && !Array.isArray(source.summary)
        ? { ...source.summary }
        : {
            recordingDuration: getRecordingDurationSeconds(recording),
            snapshotCount: recording.snapshots.length
          }
    }
  }

  return {
    format: SIMULATION_RECORDING_FORMAT,
    version: SIMULATION_RECORDING_VERSION,
    createdAt: null,
    script: null,
    recording: normalizeSimulationRecording(source),
    summary: {}
  }
}

export function createReplayScript(recordingFileInput, overrideScriptInput = null) {
  const recordingFile = normalizeSimulationRecordingFile(recordingFileInput)
  const baseScript = overrideScriptInput == null
    ? recordingFile.script
    : normalizeEpiScript(overrideScriptInput)

  if (!baseScript) {
    const durationSeconds = Math.max(1, getRecordingDurationSeconds(recordingFile.recording))

    return {
      simulation: createReplaySimulation(recordingFile.recording, { durationSeconds }),
      render: { durationSeconds },
      cameraStart: recordingFile.recording.snapshots[0]?.camera || null,
      actions: [
        { at: 0, action: 'playback', from: 0, to: durationSeconds, duration: durationSeconds }
      ]
    }
  }

  validateReplayScript(baseScript, {
    allowSimulationActions: overrideScriptInput == null
  })

  return {
    ...baseScript,
    simulation: createReplaySimulation(recordingFile.recording, baseScript.simulation),
    cameraStart: baseScript.cameraStart || recordingFile.recording.snapshots[0]?.camera || null
  }
}

export function validateReplayScript(scriptInput, options = {}) {
  const script = normalizeEpiScript(scriptInput)

  if (!options.allowSimulationActions && script.simulation.actions.length > 0) {
    throw new Error('Pre-recorded replay cannot use simulation.actions because those mutations must be baked into the recording.')
  }

  for (const action of script.actions) {
    if (REPLAY_ENTITY_ACTIONS.has(action.action)) {
      throw new Error(`Pre-recorded replay cannot use render action "${action.action}" because entity positions are baked into the recording.`)
    }

    if (!REPLAY_ALLOWED_ACTIONS.has(action.action)) {
      throw new Error(`Pre-recorded replay cannot use unknown render action "${action.action}".`)
    }

    if (action.action === 'call') {
      validateReplayCall(action)
    }
  }

  return script
}

export function normalizeSimulationRecording(recordingInput) {
  const recording = parseJsonInput(recordingInput, 'simulation recording')

  if (!recording || typeof recording !== 'object' || Array.isArray(recording)) {
    throw new TypeError('Simulation recording must be an object.')
  }

  if (!Array.isArray(recording.snapshots) || recording.snapshots.length === 0) {
    throw new Error('Simulation recording must include at least one snapshot.')
  }

  let previousSeconds = -Infinity
  const snapshots = recording.snapshots.map((snapshot, index) => {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      throw new TypeError(`Simulation recording snapshot ${index} must be an object.`)
    }

    const simulationSeconds = Number(snapshot.simulationSeconds)

    if (!Number.isFinite(simulationSeconds) || simulationSeconds < 0) {
      throw new Error(`Simulation recording snapshot ${index} has invalid simulationSeconds.`)
    }

    if (simulationSeconds < previousSeconds) {
      throw new Error('Simulation recording snapshots must be sorted by simulationSeconds.')
    }

    previousSeconds = simulationSeconds

    return {
      ...snapshot,
      simulationSeconds,
      npcs: Array.isArray(snapshot.npcs) ? snapshot.npcs.map((npc) => ({ ...npc })) : [],
      cars: Array.isArray(snapshot.cars) ? snapshot.cars.map((car) => ({ ...car })) : []
    }
  })

  return {
    durationSeconds: finitePositive(recording.durationSeconds, snapshots[snapshots.length - 1].simulationSeconds),
    sampleIntervalSeconds: finitePositive(recording.sampleIntervalSeconds, 0),
    stepSeconds: finitePositive(recording.stepSeconds, 0),
    parameters: recording.parameters && typeof recording.parameters === 'object' && !Array.isArray(recording.parameters)
      ? { ...recording.parameters }
      : {},
    snapshots
  }
}

function createReplaySimulation(recording, simulation) {
  const firstSnapshot = recording.snapshots[0]

  return {
    durationSeconds: getRecordingDurationSeconds(recording),
    sampleIntervalSeconds: recording.sampleIntervalSeconds || simulation.sampleIntervalSeconds || 60,
    stepSeconds: recording.stepSeconds || simulation.stepSeconds || 2,
    parameters: {
      ...simulation.parameters,
      ...recording.parameters,
      npcCount: recording.parameters.npcCount ?? firstSnapshot.npcs.length,
      carCount: recording.parameters.carCount ?? firstSnapshot.cars.length
    },
    actions: []
  }
}

function validateReplayCall(action) {
  const method = typeof action.method === 'string' ? action.method.trim() : ''

  if (!REPLAY_SAFE_CALL_METHODS.has(method)) {
    throw new Error(`Pre-recorded replay cannot use call action method "${method || '<missing>'}" because it may change baked simulation state.`)
  }
}

function getRecordingDurationSeconds(recording) {
  return recording.snapshots[recording.snapshots.length - 1]?.simulationSeconds || 0
}

function parseJsonInput(input, label) {
  if (typeof input === 'string') {
    try {
      return JSON.parse(input)
    } catch (error) {
      throw new Error(`Invalid ${label} JSON: ${error.message}`)
    }
  }

  return input
}

function finitePositive(value, fallback) {
  const number = Number(value)

  return Number.isFinite(number) && number > 0 ? number : fallback
}
