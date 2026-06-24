import { promises as fs } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runHeadlessSimulation } from './simulation.js'
import { createHeadlessWorldFile } from './world.js'

const SECONDS_PER_DAY = 24 * 60 * 60
const HEADLESS_TEST_TIMEOUT_MS = 15000

describe('headless simulation runner', () => {
  it('requires a supplied world file', async () => {
    await expect(runHeadlessSimulation(createRunConfig())).rejects.toThrow(/requires a generated world file/)
  }, HEADLESS_TEST_TIMEOUT_MS)

  it('applies explicit run config initial SEIR ids', async () => {
    const worldPath = await writeTestWorld('headless-explicit-world.test.json', {
      population: { npcCount: 100, carCount: 0 }
    })

    const results = await runHeadlessSimulation(createRunConfig({
      initialInfectiousCount: 20,
      inoculatedPercent: 10,
      infectedNpcIds: ['npc_0'],
      inoculatedNpcIds: ['npc_1']
    }), { worldPath })

    expect(results.world).toEqual({
      source: 'file',
      path: worldPath
    })
    expect(results.npcs).toHaveLength(100)
    expect(results.npcs.find((npc) => npc.id === 'npc_0').initialSeirState).toBe('infectious')
    expect(results.npcs.find((npc) => npc.id === 'npc_1').initialSeirState).toBe('recovered')
    expect(results.summary.finalSeir).toMatchObject({
      susceptible: 98,
      infectious: 1,
      recovered: 1
    })
  }, HEADLESS_TEST_TIMEOUT_MS)

  it('applies count and percent initial SEIR without overlap', async () => {
    const worldPath = await writeTestWorld('headless-random-world.test.json', {
      population: { npcCount: 100, carCount: 0 }
    })

    const results = await runHeadlessSimulation(createRunConfig({
      initialInfectiousCount: 4,
      inoculatedPercent: 5,
      infectedNpcIds: [],
      inoculatedNpcIds: []
    }), { worldPath })
    const initialStateCounts = results.npcs.reduce((counts, npc) => {
      counts[npc.initialSeirState] = (counts[npc.initialSeirState] || 0) + 1
      return counts
    }, {})

    expect(initialStateCounts).toMatchObject({
      susceptible: 91,
      infectious: 4,
      recovered: 5
    })
    expect(results.summary.finalSeir).toMatchObject({
      susceptible: 91,
      infectious: 4,
      recovered: 5
    })
  }, HEADLESS_TEST_TIMEOUT_MS)

  it('does not add an implicit seed when the run config omits seed', async () => {
    const worldPath = await writeTestWorld('headless-seedless-world.test.json', {
      population: { npcCount: 100, carCount: 0 }
    })
    const config = createRunConfig({}, { seed: undefined })

    delete config.seed

    const results = await runHeadlessSimulation(config, { worldPath })

    expect(results.config.seed).toBeUndefined()
  }, HEADLESS_TEST_TIMEOUT_MS)

  it('exports every adjacent SEIR event when a headless step spans multiple phases', async () => {
    const worldPath = await writeTestWorld('headless-phase-events-world.test.json', {
      population: { npcCount: 100, carCount: 0 }
    })

    const results = await runHeadlessSimulation(createRunConfig({
      infectedNpcIds: ['npc_0']
    }, {
      run: { durationSeconds: 3, stepSeconds: 3 },
      infection: {
        infectiousDays: 1 / SECONDS_PER_DAY,
        immunityDays: 1 / SECONDS_PER_DAY
      }
    }), { worldPath })

    expect(results.events.filter((event) => event.npc === 'npc_0').map((event) => event.event)).toEqual([
      'recovery',
      'immunity_waned'
    ])
    expect(results.npcs.find((npc) => npc.id === 'npc_0').initialSeirState).toBe('infectious')
    expect(results.summary.finalSeir).toMatchObject({
      susceptible: 100,
      infectious: 0,
      recovered: 0
    })
  }, HEADLESS_TEST_TIMEOUT_MS)

  it('rejects explicit initial SEIR ids outside the supplied world', async () => {
    const worldPath = await writeTestWorld('headless-invalid-seir-world.test.json', {
      population: { npcCount: 100, carCount: 0 }
    })

    await expect(runHeadlessSimulation(createRunConfig({
      infectedNpcIds: ['npc_100']
    }), { worldPath })).rejects.toThrow(/unknown NPC id/)
  }, HEADLESS_TEST_TIMEOUT_MS)

  it('produces identical seeded results for identical configs and worlds', async () => {
    const worldPath = await writeTestWorld('headless-deterministic-world.test.json', {
      population: { npcCount: 100, carCount: 0 }
    })
    const config = createRunConfig({
      initialInfectiousCount: 1
    }, {
      run: { durationSeconds: 20, stepSeconds: 2 },
      infection: {
        distanceMeters: 2,
        transmissionProbabilityPerMinute: 0.001
      }
    })

    const first = stripVolatileResultFields(await runHeadlessSimulation(config, { worldPath }))
    const second = stripVolatileResultFields(await runHeadlessSimulation(config, { worldPath }))

    expect(first.events.length).toBeGreaterThan(0)
    expect(second).toEqual(first)
  }, HEADLESS_TEST_TIMEOUT_MS)
})

async function writeTestWorld(fileName, config) {
  const world = await createHeadlessWorldFile({
    seed: { enabled: true, value: fileName },
    ...config
  })
  const worldPath = path.resolve('tmp', fileName)

  await fs.mkdir(path.dirname(worldPath), { recursive: true })
  await fs.writeFile(worldPath, JSON.stringify(world), 'utf8')

  return worldPath
}

function createRunConfig(initialSeir = {}, overrides = {}) {
  return {
    seed: overrides.seed || { enabled: true, value: 'run-seed' },
    initialSeir: {
      initialInfectiousCount: 0,
      inoculatedPercent: 0,
      infectedNpcIds: [],
      inoculatedNpcIds: [],
      ...initialSeir
    },
    run: { durationSeconds: 1, stepSeconds: 1, ...(overrides.run || {}) },
    infection: {
      distanceMeters: 0,
      transmissionProbabilityPerMinute: 0,
      incubationDays: 1,
      infectiousDays: 7,
      immunityDays: 90,
      ...(overrides.infection || {})
    },
    policies: overrides.policies || []
  }
}

function stripVolatileResultFields(result) {
  const clone = structuredClone(result)

  delete clone.createdAt
  return clone
}
