import { normalizeRunConfig } from './config.js'
import { HeadlessEventRecorder } from './event-recorder.js'
import { loadDefaultHeadlessCity } from './map-loader.js'
import { createHeadlessRuntime } from './runtime.js'
import { readHeadlessWorldFile } from './world.js'

export const HEADLESS_RESULTS_FORMAT = 'epi-city-headless-results'
export const HEADLESS_RESULTS_VERSION = 1

export async function runHeadlessSimulation(runConfigInput, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null

  emitProgress(onProgress, 0, 'Normalizing config')
  const config = normalizeRunConfig(runConfigInput, options.overrides || {})

  if (!options.worldPath) {
    throw new Error('Headless simulation requires a generated world file. Pass --world <path>.')
  }

  emitProgress(onProgress, 0.03, 'Reading world')
  const world = await readHeadlessWorldFile(options.worldPath)

  emitProgress(onProgress, 0.06, 'Loading map')
  const city = await loadDefaultHeadlessCity()
  const eventRecorder = new HeadlessEventRecorder({ city })

  emitProgress(onProgress, 0.1, 'Initializing runtime')
  const runtime = createHeadlessRuntime({
    city,
    seed: config.seed,
    population: {
      npcCount: world.npcs.length,
      carCount: world.cars.length
    },
    initialSeir: config.initialSeir,
    infectionConfig: config.infection,
    policies: config.policies,
    world,
    eventRecorder
  })

  eventRecorder.clock = runtime.simulationClock

  try {
    runRuntime(runtime, config.run, (progress) => {
      emitProgress(onProgress, 0.1 + progress * 0.85, 'Running simulation')
    })
    emitProgress(onProgress, 0.96, 'Flushing contacts')
    eventRecorder.flushContacts(runtime.simulationClock.getElapsedSimulationSeconds())

    emitProgress(onProgress, 0.98, 'Creating results')
    const results = createResultsFile({
      config,
      world,
      worldPath: options.worldPath,
      runtime,
      events: eventRecorder.getEvents()
    })

    emitProgress(onProgress, 1, 'Simulation complete')
    return results
  } finally {
    runtime.destroy()
  }
}

function runRuntime(runtime, run, onProgress = null) {
  const durationSeconds = run.durationSeconds
  const stepSeconds = run.stepSeconds
  const simRate = runtime.simulationClock.getSimulationSecondsPerRealSecond()

  while (runtime.simulationClock.getElapsedSimulationSeconds() < durationSeconds) {
    const remainingSimulationSeconds = durationSeconds - runtime.simulationClock.getElapsedSimulationSeconds()
    const deltaSimulationSeconds = Math.min(stepSeconds, remainingSimulationSeconds)

    runtime.update(deltaSimulationSeconds / simRate)
    onProgress?.(runtime.simulationClock.getElapsedSimulationSeconds() / durationSeconds)
  }
}

function createResultsFile({ config, worldPath, runtime, events }) {
  return {
    format: HEADLESS_RESULTS_FORMAT,
    version: HEADLESS_RESULTS_VERSION,
    createdAt: new Date().toISOString(),
    config,
    world: {
      source: 'file',
      path: worldPath
    },
    summary: {
      durationSeconds: config.run.durationSeconds,
      stepSeconds: config.run.stepSeconds,
      npcCount: runtime.npcs.length,
      carCount: runtime.cars.length,
      eventCount: events.length,
      finalSeir: runtime.getFinalSeir()
    },
    npcs: runtime.npcs.map((npc) => ({
      id: `npc_${npc.id}`,
      index: npc.id,
      initialSeirState: runtime.initialSeirStateByNpcId.get(`npc_${npc.id}`) || 'susceptible'
    })),
    events
  }
}

function emitProgress(onProgress, progress, message) {
  onProgress?.({ progress, message })
}
