import { normalizeRunConfig } from './config.js'
import { HeadlessEventRecorder } from './event-recorder.js'
import { loadDefaultHeadlessCity } from './map-loader.js'
import { createHeadlessRuntime } from './runtime.js'
import {
  createHeadlessWorldFile,
  getInitialSeirStateByNpcId,
  readHeadlessWorldFile
} from './world.js'

export const HEADLESS_RESULTS_FORMAT = 'epi-city-headless-results'
export const HEADLESS_RESULTS_VERSION = 1

export async function runHeadlessSimulation(runConfigInput, options = {}) {
  const config = normalizeRunConfig(runConfigInput, options.overrides || {})
  const world = options.worldPath
    ? await readHeadlessWorldFile(options.worldPath)
    : await createHeadlessWorldFile(config.world)
  const city = await loadDefaultHeadlessCity()
  const eventRecorder = new HeadlessEventRecorder({ city })
  const runtime = createHeadlessRuntime({
    city,
    worldConfig: config.world,
    infectionConfig: config.infection,
    policies: config.policies,
    world,
    eventRecorder
  })

  eventRecorder.clock = runtime.simulationClock

  try {
    runRuntime(runtime, config.run)
    eventRecorder.flushContacts(runtime.simulationClock.getElapsedSimulationSeconds())

    return createResultsFile({
      config,
      world,
      worldPath: options.worldPath || null,
      worldSource: options.worldPath ? 'file' : 'generated',
      runtime,
      events: eventRecorder.getEvents()
    })
  } finally {
    runtime.destroy()
  }
}

function runRuntime(runtime, run) {
  const durationSeconds = run.durationSeconds
  const stepSeconds = run.stepSeconds
  const simRate = runtime.simulationClock.getSimulationSecondsPerRealSecond()

  while (runtime.simulationClock.getElapsedSimulationSeconds() < durationSeconds) {
    const remainingSimulationSeconds = durationSeconds - runtime.simulationClock.getElapsedSimulationSeconds()
    const deltaSimulationSeconds = Math.min(stepSeconds, remainingSimulationSeconds)

    runtime.update(deltaSimulationSeconds / simRate)
  }
}

function createResultsFile({ config, world, worldPath, worldSource, runtime, events }) {
  const initialStates = getInitialSeirStateByNpcId(world, runtime.npcs.length)

  return {
    format: HEADLESS_RESULTS_FORMAT,
    version: HEADLESS_RESULTS_VERSION,
    createdAt: new Date().toISOString(),
    config,
    world: {
      source: worldSource,
      path: worldPath,
      runConfigWorldIgnored: Boolean(worldPath)
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
      initialSeirState: initialStates.get(`npc_${npc.id}`) || 'susceptible'
    })),
    events
  }
}
